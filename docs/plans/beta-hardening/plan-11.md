# Plan 11 — Operational Fixes (Post Beta-Hardening)

**Prioridad:** HIGH
**Objetivo:** Cerrar gaps de seguridad y fiabilidad que afectan la operacion con clientes reales.

## Archivos target

| Archivo | Scope |
|---------|-------|
| `src/modules/knowledge/manifest.ts` | `expand_knowledge` tool sin filtro de categoria |
| `src/modules/whatsapp/adapter.ts` | `flushOutgoingQueue` sin rate limiting |
| `src/modules/medilink/security.ts` | `medilink_is_lead` flag no se limpia; no se dispara hook |

## Paso 0 — Verificacion obligatoria

1. Leer `src/modules/knowledge/manifest.ts` lineas 1340-1440 — confirmar que `search_knowledge` usa `(input, context)` y `expand_knowledge` usa `(input)` sin context
2. Leer `src/modules/whatsapp/adapter.ts` lineas 437-451 — confirmar que `flushOutgoingQueue` no tiene delay entre envios
3. Leer `src/modules/medilink/security.ts` lineas 388-413 — confirmar que `linkContactToPatient` no limpia `medilink_is_lead`

## FIX-01: Filtro de categoria en `expand_knowledge` [CRITICAL — gap de seguridad]
**Archivo:** `src/modules/knowledge/manifest.ts` ~linea 1427
**Bug:** `expand_knowledge` handler recibe solo `(input)` sin `context`. Cualquier contacto puede leer cualquier documento por ID, saltandose las restricciones de categoria configuradas en `KNOWLEDGE_CONTACT_CATEGORY_MAP`.
**Impacto:** Si un contacto tipo "lead" descubre un documentId de una categoria restringida (o si el LLM lo expone en un search previo filtrado), puede hacer expand directo sin filtro.

**Fix:**
1. Cambiar la firma del handler de `async (input) =>` a `async (input, context) =>`
2. Antes de llamar `expandKnowledge(documentId)`, verificar acceso:
   a. Leer la config `KNOWLEDGE_CONTACT_CATEGORY_MAP` con `resolveKnowledgeConfig(_registry!)`
   b. Si hay mapping y `context.contactType` tiene mapping configurado:
      - Obtener las categorias del documento: `SELECT dc.category_id FROM knowledge_document_categories dc WHERE dc.document_id = $1`
      - Si el documento tiene categorias Y ninguna esta en `allowedCategoryIds` → retornar `{ success: false, error: 'Document not accessible' }`
      - Si el documento NO tiene categorias (uncategorized) → permitir (fail-open, igual que search)
   c. Si no hay mapping configurado → permitir todo (fail-open)
3. Reutilizar el mismo patron de parsing JSON del mapping que usa `search_knowledge` (lineas 1368-1381)

**Verificacion:**
- Configurar `KNOWLEDGE_CONTACT_CATEGORY_MAP` con `{"lead": ["cat-1"]}` y un documento en `cat-2`
- Llamar expand_knowledge con un contacto tipo "lead" y documentId de cat-2 → debe fallar
- Llamar con contacto tipo "lead" y documentId de cat-1 → debe funcionar
- Llamar con contacto sin mapping → debe funcionar (fail-open)
- Llamar con documento sin categorias → debe funcionar (uncategorized = siempre visible)

**Nota:** La query de categorias del documento necesita acceso a DB. Hay 2 opciones:
- Opcion A: Usar `knowledgeManager` — agregar metodo `getDocumentCategoryIds(docId): Promise<string[]>`
- Opcion B: Hacer query directa al pool de la DB (ya disponible via `registry.get('db')`)
Preferir opcion A para mantener el patron del modulo.

## FIX-02: Rate limiting en flush de cola WhatsApp [HIGH]
**Archivo:** `src/modules/whatsapp/adapter.ts` ~lineas 437-451
**Bug:** `flushOutgoingQueue()` envia todos los mensajes encolados secuencialmente pero sin delay entre ellos. Si hay 50 mensajes acumulados durante un downtime, se envian todos de golpe al reconectarse, pudiendo triggerar rate limits de WhatsApp.
**Impacto:** WhatsApp puede banear temporalmente el numero por envio masivo rapido.

**Fix:**
1. Agregar un delay configurable entre envios durante el flush
2. Usar una constante `QUEUE_FLUSH_DELAY_MS = 200` (200ms entre mensajes)
3. En el loop `for (const item of items)`:
   - Despues de cada `_doSendMessage` exitoso, agregar `await new Promise(r => setTimeout(r, QUEUE_FLUSH_DELAY_MS))`
   - No agregar delay despues de mensajes expirados (TTL) ni del ultimo mensaje
4. Log al inicio del flush con count y estimated time: `count * QUEUE_FLUSH_DELAY_MS / 1000` segundos

**Codigo conceptual:**
```typescript
private async flushOutgoingQueue(): Promise<void> {
  if (this._outgoingQueue.length === 0) return
  const items = this._outgoingQueue.splice(0)
  logger.info({ count: items.length, estimatedMs: items.length * 200 }, 'Flushing outgoing queue after reconnect')
  const now = Date.now()
  for (let i = 0; i < items.length; i++) {
    const item = items[i]!
    if (now - item.enqueuedAt > BaileysAdapter.QUEUE_TTL_MS) {
      logger.warn({ to: item.to, ageMs: now - item.enqueuedAt }, 'Dropping expired queued message')
      item.resolve({ success: false, error: 'Message expired in outgoing queue (TTL: 5min)' })
      continue
    }
    const result = await this._doSendMessage(item.to, item.message)
    item.resolve(result)
    // Rate limit: don't spam WhatsApp servers during bulk flush
    if (i < items.length - 1) {
      await new Promise(r => setTimeout(r, 200))
    }
  }
}
```

## FIX-03: Limpiar flag `medilink_is_lead` al vincular paciente [MEDIUM]
**Archivo:** `src/modules/medilink/security.ts` ~lineas 388-413
**Bug:** Cuando un lead se vincula a un paciente Medilink, `linkContactToPatient()` actualiza `contact_type` a `client_active` pero deja el flag `medilink_is_lead: true` en `agent_data`. Esto puede confundir logica futura que chequee el flag para decidir si buscar paciente o no.

**Fix:**
1. En `linkContactToPatient()`, agregar `medilink_is_lead: false` al JSON que se mergea en `agent_data` (linea 398):
   ```typescript
   JSON.stringify({
     medilink_patient_id: String(patientId),
     medilink_verified: level,
     medilink_verified_at: new Date().toISOString(),
     medilink_is_lead: false,  // ← AGREGAR: limpiar flag de lead
   })
   ```
2. Esto se aplica automaticamente porque usa `||` (merge) en jsonb, que sobreescribe keys existentes.

**Verificacion:**
- Vincular un contacto que previamente tenia `medilink_is_lead: true`
- Verificar que despues de link, `agent_data.medilink_is_lead` es `false`
- Verificar que `tryAutoLink()` en linea 70 (`if (ctx.medilinkPatientId) return ctx`) sigue siendo el guard principal

## FIX-04: Disparar hook `contact:type_changed` al promover lead [MEDIUM]
**Archivo:** `src/modules/medilink/security.ts` ~linea 412
**Bug:** Cuando `linkContactToPatient()` cambia `contact_type` de `lead` a `client_active`, ningun hook se dispara. Otros modulos (knowledge, scheduled-tasks) no se enteran del cambio y pueden seguir tratando al contacto como lead.
**Impacto:** Con knowledge filtering por tipo, un contacto que acaba de ser vinculado como paciente podria seguir viendo knowledge de "leads" hasta que su sesion se reinicie (el contactType se lee en intake, al inicio de cada mensaje).

**Fix:**
1. Despues del UPDATE de `contact_type` (linea 409), verificar si realmente hubo cambio (el UPDATE tiene `WHERE contact_type = 'lead'`, asi que si retorna `rowCount > 0`, hubo cambio)
2. Si hubo cambio, leer el registry (pasarlo como parametro al constructor de `SecurityService` o al metodo):
   ```typescript
   const result = await this.db.query(
     `UPDATE contacts SET contact_type = 'client_active' WHERE id = $1 AND contact_type = 'lead'`,
     [contactId],
   )
   if (result.rowCount && result.rowCount > 0) {
     await this.registry.runHook('contact:type_changed', {
       contactId,
       previousType: 'lead',
       newType: 'client_active',
       reason: 'medilink_patient_linked',
     })
   }
   ```
3. **Pre-requisito:** Verificar que `SecurityService` tiene acceso al registry. Si no lo tiene:
   - Opcion A: Pasarlo en el constructor (preferido)
   - Opcion B: Importar `registry` via singleton (no recomendado — viola regla de modulos)
   - Opcion C: Retornar un flag `promoted: boolean` de `linkContactToPatient()` y disparar el hook desde el caller (manifest.ts)
4. **NO crear listeners del hook por ahora** — solo disparar el evento. Los modulos que quieran reaccionar (knowledge cache invalidation, etc.) se suscriben en su propio init.

**Verificacion:**
- Verificar que el hook solo se dispara cuando `contact_type` realmente cambia (no si ya era `client_active`)
- Verificar que si el registry no tiene listeners, el hook pasa silenciosamente (comportamiento default de `runHook`)

## Verificacion post-fix

1. `expand_knowledge` con contacto filtrado no retorna docs fuera de sus categorias
2. `flushOutgoingQueue` con 10 mensajes tarda ~2s (10 * 200ms)
3. `medilink_is_lead` es `false` despues de vincular
4. Hook `contact:type_changed` se dispara al promover lead
5. Compilar: `npx tsc --noEmit` — 0 errores nuevos

## Notas de paralelismo

Los 4 fixes son independientes entre si y pueden ejecutarse en paralelo:
- FIX-01 toca solo `src/modules/knowledge/manifest.ts` (+ posible nuevo metodo en knowledge-manager.ts o pg-store.ts)
- FIX-02 toca solo `src/modules/whatsapp/adapter.ts`
- FIX-03 y FIX-04 tocan el mismo archivo (`security.ts`) pero en la misma funcion — deben ir juntos
