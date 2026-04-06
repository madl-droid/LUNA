# Fase 4: Integrar Voice al Pipeline de Compresión de Memoria

## Objetivo
Que las llamadas de voz pasen por el mismo pipeline de memoria que WhatsApp y Gmail: session → archive → summary → chunk → embed → cleanup. Eliminar el `generateCallSummary()` custom.

## Prerequisitos
- **Fase 0**: conexión Gemini funcional
- **Independiente** de Fases 1, 2, 3

## Problema actual

`voice-engine.ts:persistToMemory()` (líneas 143-199):
- Crea pseudo-session ID: `voice-${Date.now()}`
- Guarda turns como mensajes individuales via `memory:manager.saveMessage()`
- **NO crea entrada en tabla `sessions`**
- **NO dispara compresión** (archive → summary → chunk → embed)
- **NO genera embeddings** — la memoria de llamadas NO es buscable semánticamente

Resultado: las llamadas de voz son ciudadanos de segunda clase en memoria. Un agente que habló 30 minutos por teléfono con un lead no puede recordar esa conversación en futuras interacciones por otros canales.

## Pipeline existente (WhatsApp/Gmail)

```
Sesión cierra (inactividad/reopen)
  → compression-worker.ts enqueue()
    → session-archiver.ts archiveSessionLegal()      // backup legal
    → session-archiver.ts generateSessionSummary()    // LLM summary estructurado
    → session-chunker.ts chunkSession()               // chunks por tipo + linking
    → session-embedder.ts embedSessionChunks()         // pgvector embeddings
    → cleanup: delete messages, purge Redis
    → mark sessions.compression_status = 'done'
```

## Solución: conectar voice al pipeline existente

### 1. `call-manager.ts` — Crear sesión real al iniciar llamada
**Líneas afectadas**: onMediaStreamStart (~147-162), endCall()

**Al iniciar llamada** (onMediaStreamStart):
```typescript
// Crear sesión real en tabla sessions (via memory:manager o query directa)
const sessionId = await createVoiceSession(db, {
  contactId: call.contactId,
  channelName: 'voice',
  status: 'active',
  metadata: {
    callId: call.callId,
    callSid: call.callSid,
    direction: call.direction,
    from: call.from,
    to: call.to
  }
})
call.sessionId = sessionId  // guardar en ActiveCall
```

**Query**:
```sql
INSERT INTO sessions (id, contact_id, channel_name, status, started_at, last_activity_at)
VALUES (gen_random_uuid(), $1, 'voice', 'active', NOW(), NOW())
RETURNING id
```

### 2. `types.ts` — sessionId en ActiveCall
```typescript
interface ActiveCall {
  // ... campos existentes ...
  sessionId: string | null    // ID real en tabla sessions
}
```

### 3. `voice-engine.ts` — Reescribir persistToMemory()
**Líneas afectadas**: persistToMemory (143-199), generateCallSummary (112-138)

**Nuevo `persistToMemory()`**:
```typescript
async persistToMemory(
  call: ActiveCall,
  registry: ModuleRegistry
): Promise<void> {
  if (!call.contactId || !call.sessionId) return
  if (call.transcript.length === 0) return

  const memMgr = registry.getOptional<MemoryManager>('memory:manager')
  if (!memMgr) return

  const db = registry.get<Pool>('db')

  // 1. Guardar mensajes significativos en tabla messages (vinculados a sessionId real)
  for (const entry of call.transcript) {
    if (entry.speaker === 'system') continue       // skip system notes
    if (entry.text.length < 5) continue             // skip ruido

    await memMgr.saveMessage({
      id: crypto.randomUUID(),
      contactId: call.contactId,
      sessionId: call.sessionId,                    // ← session real, no pseudo-ID
      channelName: 'voice',
      senderType: entry.speaker === 'caller' ? 'user' : 'agent',
      content: { type: 'text', text: entry.text },
      role: entry.speaker === 'caller' ? 'user' : 'assistant',
      contentText: entry.text,
      contentType: 'text',
      createdAt: new Date(call.startedAt.getTime() + entry.timestampMs)
    })
  }

  // 2. Cerrar sesión
  await db.query(
    `UPDATE sessions SET status = 'closed', last_activity_at = NOW() WHERE id = $1`,
    [call.sessionId]
  )

  // 3. Encolar compresión (mismo pipeline que WhatsApp/Gmail)
  const compressionWorker = registry.getOptional<CompressionWorkerService>('memory:compression-worker')
  if (compressionWorker) {
    await compressionWorker.enqueue({
      sessionId: call.sessionId,
      contactId: call.contactId,
      channel: 'voice',
      triggerType: 'reopen_expired'
    })
  }
  // Si no hay compression worker (BullMQ no disponible), el nightly batch lo recoge
}
```

**Eliminar `generateCallSummary()`** (líneas 112-138):
- Ya no se necesita. El pipeline de compresión genera un summary mejor (estructurado con secciones temáticas, via `session-archiver.ts:generateSessionSummary()`).
- Eliminar también la llamada a `generateCallSummary()` en el flujo de endCall.

### 4. `call-manager.ts` — Actualizar last_activity_at durante llamada
**Líneas afectadas**: onMediaReceived (~276), handleToolCall (~422)

Periódicamente actualizar `sessions.last_activity_at` para que el nightly batch no recoja la sesión mientras está activa:
```typescript
// Cada 60s durante la llamada (no en cada frame de audio)
private lastActivityUpdate = new Map<string, number>()

private updateSessionActivity(call: ActiveCall): void {
  if (!call.sessionId) return
  const now = Date.now()
  const last = this.lastActivityUpdate.get(call.callId) ?? 0
  if (now - last < 60_000) return  // throttle: max 1 update/min

  this.lastActivityUpdate.set(call.callId, now)
  this.db.query(
    'UPDATE sessions SET last_activity_at = NOW() WHERE id = $1',
    [call.sessionId]
  ).catch(() => {})  // fire-and-forget, no bloquear audio
}
```

### 5. `voice-engine.ts` — Cargar memoria de llamadas previas en preloadContext()
**Líneas afectadas**: preloadContext (24-107)

El `preloadContext()` actual carga `contactMemory`, `pendingCommitments`, `recentSummaries` via `memory:manager`. Estos ya leen de `session_summaries_v2` y `session_memory_chunks`.

**No se necesita cambio** aquí — una vez que las llamadas crean sesiones reales y pasan por compresión, sus summaries y chunks aparecen automáticamente en las queries existentes de `memory:manager`.

Verificar que `loadSummaries()` (línea 56) no filtre por canal — debería devolver summaries de TODOS los canales (WhatsApp, Gmail, voice).

### 6. No se necesita migración SQL
La tabla `sessions` ya existe y acepta `channel_name = 'voice'`. No hay restricción de canal. La tabla `messages` ya acepta mensajes de cualquier canal.

## Flujo completo post-cambios

```
Llamada inicia
  → Crear sesión en tabla sessions (status='active', channel='voice')
  → call.sessionId = session real
  
Llamada en curso
  → Guardar transcript entries como messages (vinculados a sessionId)
  → Actualizar sessions.last_activity_at cada 60s

Llamada termina
  → persistToMemory():
    1. Guardar mensajes restantes
    2. UPDATE sessions SET status='closed'
    3. compressionWorker.enqueue() → pipeline existente
  
Pipeline de compresión (async, BullMQ)
  → archiveSessionLegal()     // backup JSON de la conversación
  → generateSessionSummary()  // LLM: title, description, sections, full_summary
  → chunkSession()            // chunks de texto (turns agrupados por tamaño)
  → embedSessionChunks()      // pgvector embeddings
  → cleanup messages
  → compression_status = 'done'

Próxima interacción (cualquier canal)
  → preloadContext() encuentra summaries + chunks de la llamada
  → Agente recuerda lo que habló por teléfono
```

## Verificación
- [ ] Llamada crea sesión real en tabla sessions con channel='voice'
- [ ] Transcript se guarda como messages vinculados al session_id
- [ ] Al terminar, sesión se marca 'closed' y se encola compresión
- [ ] Pipeline genera summary, chunks, embeddings correctamente
- [ ] Próxima llamada del mismo contacto: agente recuerda conversación anterior
- [ ] Próximo mensaje de WhatsApp del mismo contacto: agente recuerda la llamada
- [ ] generateCallSummary() eliminado sin romper nada
- [ ] sessions.last_activity_at se actualiza durante llamada activa
- [ ] Si compression worker no disponible, nightly batch recoge la sesión

## Riesgos
- **Llamadas muy largas (>30 min)**: generan muchos mensajes. El chunker debería manejarlos bien (agrupa por tamaño), pero verificar que no exceda límites de la tabla messages.
- **Doble guardado**: actualmente `persistToMemory()` guarda en messages. Si no se elimina `generateCallSummary()`, habría summary duplicado. Por eso es importante eliminar el viejo.
- **Sesión huérfana**: si la llamada se corta abruptamente (crash, network), la sesión queda en status='active' forever. Mitigación: el nightly batch puede incluir un sweep de sesiones active > 2h → marcarlas closed.
