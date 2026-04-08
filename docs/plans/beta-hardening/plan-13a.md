# Plan 13a — Quick Fixes (Drive, TTS, Embedding UI, Voice Rate Limit)

**Prioridad:** MEDIUM
**Objetivo:** 4 fixes independientes de scope pequeño-mediano.

## Archivos target

| Archivo | Scope |
|---------|-------|
| `src/modules/knowledge/item-manager.ts` | Drive scanTabs pagination |
| `src/modules/tts/tts-service.ts` | Integrar con LLM gateway: CB, timeout, modelo |
| `src/modules/tts/manifest.ts` | Config, model validation |
| `src/modules/knowledge/console-section.ts` | UI progress embedding |
| `src/modules/knowledge/pg-store.ts` | Query progress per-item |
| `src/modules/knowledge/manifest.ts` | API endpoint progress |
| `src/modules/twilio-voice/call-manager.ts` | Inbound per-number rate limit |

## Paso 0 — Verificacion obligatoria

1. Leer `item-manager.ts` funcion `scanTabs()` — confirmar que NO pagina (solo 1 call a `listFiles` sin `pageToken` loop)
2. Leer `tts-service.ts` completo — confirmar que usa `fetch()` directo a `generativelanguage.googleapis.com` sin pasar por LLM gateway
3. Leer `console-section.ts` — confirmar que no hay polling de progreso de embedding
4. Leer `call-manager.ts` — confirmar que solo hay rate limit outbound, no inbound per-number

---

## FIX-01: Drive scanTabs pagination [SMALL]
**Archivo:** `src/modules/knowledge/item-manager.ts` ~linea 398
**Bug:** `scanTabs()` llama `listFiles({ folderId, pageSize: 100 })` una sola vez. Carpetas con >100 archivos pierden el resto.
**Fix:**
1. Localizar la llamada a `listFiles` en `scanTabs()`
2. Convertir a loop con `pageToken` (mismo patron que el crawl recursivo en lineas 801-838):
   ```typescript
   let allFiles: DriveFile[] = []
   let pageToken: string | undefined
   do {
     const result = await driveService.listFiles({ folderId, pageSize: 100, pageToken })
     allFiles.push(...result.files)
     pageToken = result.nextPageToken
   } while (pageToken)
   ```
3. Verificar que `listFiles` retorna `nextPageToken` — si no, verificar que el metodo del Drive service lo soporta
4. Aplicar el mismo limit de profundidad que ya existe

---

## FIX-02: TTS — Integrar con LLM gateway [HIGH]
**Archivos:** `src/modules/tts/tts-service.ts`, `src/modules/tts/manifest.ts`
**Bug:** TTS hace `fetch()` directo a Google Gemini TTS API sin pasar por el LLM gateway. Consecuencias:
- Sin circuit breaker: si Google TTS cae, cada request falla sin backoff
- Sin timeout: si la API cuelga, bloquea el post-processor indefinidamente
- Sin usage tracking: costos TTS invisibles al sistema de budget
- Sin validacion de modelo: modelo hardcoded puede estar deprecado

**Fix en 4 partes:**

### A. Timeout en fetch (CRITICO — evita hang indefinido)
En `tts-service.ts`, en el metodo que hace fetch (~linea 169):
1. Agregar `AbortController` con timeout de 30 segundos:
   ```typescript
   const controller = new AbortController()
   const timer = setTimeout(() => controller.abort(), 30_000)
   try {
     const res = await fetch(url, { ...options, signal: controller.signal })
     // ... process response
   } finally {
     clearTimeout(timer)
   }
   ```

### B. Circuit breaker simple (evita cascade failures)
En `tts-service.ts`, agregar un circuit breaker ligero (NO migrar a LLM gateway completo — demasiado riesgo):
1. Agregar estado interno al TTSService:
   ```typescript
   private failures = 0
   private cbOpenUntil = 0
   private static CB_THRESHOLD = 5  // 5 fallas consecutivas
   private static CB_COOLDOWN_MS = 5 * 60_000  // 5 min
   ```
2. Antes de cada `fetch`, verificar: `if (Date.now() < this.cbOpenUntil) return null`
3. En success: `this.failures = 0`
4. En failure: `if (++this.failures >= CB_THRESHOLD) this.cbOpenUntil = Date.now() + CB_COOLDOWN_MS`
5. Log cuando CB abre y cuando se recupera

### C. Validacion de modelo contra model-scanner
En `manifest.ts` init():
1. Obtener `registry.getOptional<() => ModelInfo[]>('model-scanner:getGoogleModels')` (o el service equivalente)
2. Si el scanner esta disponible, verificar que `TTS_MODEL` existe en la lista de modelos
3. Si NO existe, logear WARNING con sugerencia de modelos TTS disponibles
4. NO bloquear — solo advertir (el modelo podria ser nuevo y no estar en el cache del scanner)

### D. Uso del modelo seleccionado (verificar)
1. Confirmar que `tts-service.ts` lee `this.config.TTS_MODEL` y NO tiene un hardcode que lo sobreescriba
2. Confirmar que el downgrade model (`TTS_DOWNGRADE_MODEL`) tambien se lee del config
3. Si hay hardcodes, reemplazar por lectura del config

---

## FIX-03: UI progress para embedding [MEDIUM]
**Archivos:** `src/modules/knowledge/pg-store.ts`, `src/modules/knowledge/manifest.ts`, `src/modules/knowledge/console-section.ts`

### A. Query de progreso por item (pg-store.ts)
Agregar metodo al pg-store:
```typescript
async getEmbeddingProgress(itemId: string): Promise<{
  total: number
  embedded: number
  failed: number
  processing: number
}> {
  const { rows } = await this.pool.query(`
    SELECT
      COUNT(*)::int AS total,
      COUNT(*) FILTER (WHERE c.embedding_status = 'embedded')::int AS embedded,
      COUNT(*) FILTER (WHERE c.embedding_status = 'failed' AND c.retry_count >= 10)::int AS failed,
      COUNT(*) FILTER (WHERE c.embedding_status IN ('queued','processing'))::int AS processing
    FROM knowledge_chunks c
    JOIN knowledge_documents d ON d.id = c.document_id
    WHERE d.item_id = $1
  `, [itemId])
  return rows[0] ?? { total: 0, embedded: 0, failed: 0, processing: 0 }
}
```

### B. API endpoint (manifest.ts)
Agregar ruta en `apiRoutes`:
```
GET /console/api/knowledge/items/:itemId/progress
→ { total, embedded, failed, processing, percent }
```
Donde `percent = Math.round((embedded / total) * 100)` (o 0 si total=0)

### C. Client-side polling (console-section.ts)
1. Cuando el usuario hace click en "Train" (ya sea single item o bulk):
   - Iniciar polling con `setInterval` cada 3 segundos
   - Llamar al endpoint de progress
   - Actualizar el badge del item con: `"45/100 (45%)"` o progress bar
2. Cuando `percent === 100` o `status` es terminal (`embedded` | `failed`):
   - Detener polling
   - Actualizar badge final
3. Si hay items en estado `processing` al cargar la pagina:
   - Iniciar polling automaticamente para esos items

### D. Visual
- Reemplazar el dot estatico por una mini progress bar cuando `status = processing`
- Formato: `[████░░░░░░] 45%` o simplemente `45/100 chunks`
- Color: verde para embedded, rojo para failed, amarillo para processing

---

## FIX-04: Voice inbound per-number rate limit [SMALL]
**Archivo:** `src/modules/twilio-voice/call-manager.ts` ~linea 76
**Estado actual:** Solo hay `VOICE_MAX_CONCURRENT_CALLS` (cap global) y `VOICE_OUTBOUND_RATE_LIMIT_HOUR` (outbound per-number)
**Bug:** Un mismo numero puede llamar repetidamente sin limite (solo el cap global de concurrencia lo frena)

**Fix:**
1. Agregar config `VOICE_INBOUND_RATE_LIMIT_HOUR` al configSchema del manifest (~default 10)
2. En el handler de incoming call (~linea 76), despues del check de concurrencia:
   ```typescript
   // Check per-number inbound rate limit
   const recentInbound = await pgStore.countRecentCalls(from, 'inbound', 60) // last 60 min
   if (recentInbound >= config.VOICE_INBOUND_RATE_LIMIT_HOUR) {
     logger.warn({ from, count: recentInbound }, 'Inbound rate limit exceeded')
     // Return busy/voicemail response
     return
   }
   ```
3. Reutilizar `pgStore.countRecentCalls()` que ya existe para outbound (mismo patron)

---

## Verificacion post-fix

1. `scanTabs()` con carpeta de 150+ archivos → retorna todos
2. TTS con Google API caido → circuit breaker abre despues de 5 fallas, retorna null (texto fallback), no cuelga
3. TTS fetch con API lenta → timeout a 30s, no bloquea indefinidamente
4. Click "Train" en knowledge item → progress bar se actualiza cada 3s
5. Llamada inbound repetida 11 veces en 1 hora → call 11 rechazada
6. Compilar: `npx tsc --noEmit` — 0 errores nuevos

## Notas de paralelismo

Los 4 fixes tocan archivos diferentes y pueden ejecutarse en paralelo:
- FIX-01: `item-manager.ts` (knowledge)
- FIX-02: `tts-service.ts`, `tts/manifest.ts` (tts)
- FIX-03: `pg-store.ts`, `manifest.ts`, `console-section.ts` (knowledge — distinto de FIX-01)
- FIX-04: `call-manager.ts` (twilio-voice)

**Excepcion:** FIX-01 y FIX-03 tocan ambos el modulo knowledge pero archivos distintos. Si se ejecutan en paralelo, no hay conflicto.
