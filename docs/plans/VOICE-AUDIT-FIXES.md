# Plan: Voice Audit Fixes & Cleanup

## Contexto
Auditoría post-implementación identificó 3 bugs, 2 código muerto, 5 deudas técnicas, y 3 incoherencias.
Este plan prioriza por impacto y agrupa cambios por archivo para minimizar conflictos.

## Batch 1: Fixes críticos (BUG-1 + DEBT-2)

### Fix 1A: `getLocalDayOfWeek()` timezone bug — BUG-1 (ALTA)
**Archivo:** `call-manager.ts` (líneas ~823-835)

Reemplazar ambos helpers:
```typescript
// ANTES (buggy):
function getLocalDayOfWeek(date: Date, timezone: string): number {
  return new Date(date.toLocaleString('en-US', { timeZone: timezone })).getDay()
}

// DESPUÉS (correcto):
function getLocalDayOfWeek(date: Date, tz: string): number {
  try {
    const weekday = new Intl.DateTimeFormat('en-US', { weekday: 'short', timeZone: tz }).format(date)
    return ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].indexOf(weekday)
  } catch {
    return date.getUTCDay()
  }
}

function getLocalHour(date: Date, tz: string): number {
  try {
    return parseInt(new Intl.DateTimeFormat('en-US', { hour: 'numeric', hour12: false, timeZone: tz }).format(date), 10)
  } catch {
    return date.getUTCHours()
  }
}
```

### Fix 1B: Sessions huérfanas — DEBT-2 (MEDIA)
**Archivo:** `call-manager.ts` (endCall), `voice-engine.ts` (persistToMemory)

En `endCall()`, después de `persistToMemory`, agregar safety close:
```typescript
// Safety: close session if persistToMemory didn't (e.g., empty transcript, no contactId)
if (call.sessionId) {
  this.db.query(
    `UPDATE sessions SET status = 'closed', last_activity_at = NOW()
     WHERE id = $1 AND status = 'active'`,
    [call.sessionId]
  ).catch(() => {})
}
```

La condición `AND status = 'active'` hace idempotente — si `persistToMemory` ya cerró, este no-op.

## Batch 2: Cleanup de código muerto (DEAD-1, DEAD-2, INCO-3)

### Fix 2A: Eliminar outboundCallInfo — DEAD-1
**Archivo:** `call-manager.ts`, `types.ts`

Eliminar:
- `private outboundCallInfo = new Map<string, OutboundCallInfo>()`
- `private outboundInfoCleanupTimers = new Map<string, ReturnType<typeof setTimeout>>()`
- Bloque en `initiateOutboundCall()` que almacena en el Map + crea timer
- `getOutboundCallInfo()` método público
- Cleanup en `endCall()` (~6 líneas)
- Cleanup en `stopAll()` (~5 líneas)
- `OutboundCallInfo` interface en `types.ts`

~30 líneas eliminadas. El `reason` ya fluye por `preloadContext → buildSystemInstruction`.

### Fix 2B: Eliminar VOICE_ANSWER_DELAY_RINGS — DEAD-2
**Archivos:** `manifest.ts`, `types.ts`

- Eliminar `VOICE_ANSWER_DELAY_RINGS` de `configSchema`
- Eliminar de `TwilioVoiceConfig` interface
- Eliminar console field asociado (si queda alguno)

### Fix 2C: Limpiar param summary de completeCall — INCO-3
**Archivo:** `pg-store.ts`

```typescript
// ANTES:
export async function completeCall(db, callSid, endReason, summary, modelUsed)
// summary siempre es null

// DESPUÉS:
export async function completeCall(db, callSid, endReason, modelUsed)
// Eliminar summary del UPDATE SQL
```

Actualizar la llamada en `call-manager.ts` (quitar el `null`).

## Batch 3: Fixes menores (BUG-2, DEBT-4)

### Fix 3A: Timer leak en Promise.race — BUG-2 (BAJA)
**Archivo:** `call-manager.ts` (handleToolCall)

```typescript
// ANTES:
result = await Promise.race([
  toolRegistry.executeTool(toolName, args, context),
  new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error('tool_timeout')), timeout),
  ),
])

// DESPUÉS:
let timeoutTimer: ReturnType<typeof setTimeout> | null = null
result = await Promise.race([
  toolRegistry.executeTool(toolName, args, context),
  new Promise<never>((_, reject) => {
    timeoutTimer = setTimeout(() => reject(new Error('tool_timeout')), timeout)
  }),
]).finally(() => {
  if (timeoutTimer) clearTimeout(timeoutTimer)
})
```

### Fix 3B: Validar min ≤ max rings — DEBT-4
**Archivo:** `call-manager.ts` (handleIncomingCall)

```typescript
const minRings = this.config.VOICE_ANSWER_DELAY_MIN_RINGS
const maxRings = Math.max(minRings, this.config.VOICE_ANSWER_DELAY_MAX_RINGS) // guard
const answerDelayRings = Math.floor(Math.random() * (maxRings - minRings + 1)) + minRings
```

## Batch 4: Mejora arquitectural (BUG-3, DEBT-1)

### Fix 4A: Gemini fallback event listeners — BUG-3 (MEDIA)
**Archivo:** `gemini-live.ts` (connect, connectWithModel)

Suprimir events durante fallback: en `connect()`, antes de intentar fallback:
```typescript
// Suppress events during fallback attempt to prevent stale onClose/onError
const originalOnClose = this.events.onClose
const originalOnError = this.events.onError
this.events.onClose = () => {} // no-op during fallback
this.events.onError = () => {} // no-op during fallback

try {
  await this.connectWithModel(fallbackModel)
  // Restore events
  this.events.onClose = originalOnClose
  this.events.onError = originalOnError
} catch {
  // Restore events before throwing
  this.events.onClose = originalOnClose
  this.events.onError = originalOnError
  throw ...
}
```

### Fix 4B: Context promise Map tipado — DEBT-1
**Archivo:** `call-manager.ts`

```typescript
// ANTES:
;(this as unknown as Record<string, unknown>)[`_ctx_${callSid}`] = contextPromise

// DESPUÉS:
private contextPromises = new Map<string, Promise<PreloadedContext>>()
// En initiateOutboundCall/handleIncomingCall:
this.contextPromises.set(callSid, contextPromise)
// En onMediaStreamStart:
const context = await this.contextPromises.get(callSid)
this.contextPromises.delete(callSid)
```

## NO incluido en este plan

- **DEBT-3** (cancelledToolCalls Set crece): riesgo demasiado bajo para justificar el cambio. Las llamadas duran max 30 min con pocas tools. No actuar.
- **DEBT-5** (rate limit por teléfono vs contactId): la decisión de la implementación (teléfono) es más pragmática — no requiere lookup extra. Mantener.
- **INCO-1** (throw vs return en business hours): ambos funcionan, el route handler tiene catch. No vale el cambio.

## Orden de ejecución

```
Batch 1 (críticos)     → implementar primero, estos son bugs reales
Batch 2 (cleanup)      → independiente, puede ir en paralelo
Batch 3 (menores)      → independiente, puede ir en paralelo
Batch 4 (arquitectura) → implementar al final, toca puntos sensibles
```

Batches 1-3 pueden correr como PRs separadas en paralelo.
Batch 4 debería ir después porque toca `gemini-live.ts` (punto sensible).
