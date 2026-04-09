# Plan 4 — Pipeline Retry para Mensajes Reactivos
**Items**: Q4 (sin retry para pipelines que fallan en Phases 1→agentic)
**Esfuerzo**: ~2h
**Dependencias externas**: Ninguna

---

## Problema

El pipeline reactivo es fire-and-forget. Si falla en cualquier punto entre Phase 1 (intake) y el agentic loop, el mensaje se pierde. Solo existe:
- **Retry de envío** en `delivery.ts` (Phase 5): 2 intentos con backoff para el `sendMessage()` — solo cubre errores de red al enviar.
- **Orphan recovery**: job pasivo que detecta mensajes sin respuesta periódicamente — no es retry en tiempo real.

Errores transitorios (timeout de LLM, rate limit, fallo de conexión DB momentáneo) deberían tener un segundo intento antes de rendirse.

## Estado actual del pipeline

**Archivo**: `src/engine/engine.ts`

El flujo reactivo (`processMessageInner` o similar):
```
1. Semaphore acquire → Contact lock
2. Phase 1: normalize, resolve user, classify attachments → ContextBundle
3. ACK message (señal de "escribiendo")
4. Gates: test mode, unregistered, email triage
5. Agentic pipeline: effort router → agentic loop → post-process → delivery
6. Release locks
```

El error handling actual (envolviendo todo):
```typescript
try {
  // Phases 1 through delivery
} catch (err) {
  // Send error fallback message to user
  // Log error
  // Return PipelineResult { success: false }
}
```

## Diseño: Pipeline Retry

### Principio
Reintentar la ejecución del pipeline cuando falla por errores transitorios, SOLO si no se ha enviado ninguna respuesta al usuario.

### Ubicación del retry
Envolver la llamada a `runAgenticDelivery()` (o equivalente) — no todo el pipeline. Phase 1 (intake) y las gates son baratas y no fallan de forma transitoria. El punto de fallo es el agentic loop (LLM calls, tool execution).

### Implementación

```typescript
// Constantes
const PIPELINE_MAX_RETRIES = 2
const PIPELINE_RETRY_BASE_MS = 1500  // 1.5s, 3s

// En el flujo del pipeline, reemplazar la llamada directa:
// ANTES:
//   const result = await runAgenticDelivery(ctx, config, registry)

// DESPUÉS:
let lastError: Error | null = null
for (let attempt = 0; attempt <= PIPELINE_MAX_RETRIES; attempt++) {
  try {
    if (attempt > 0) {
      const delayMs = PIPELINE_RETRY_BASE_MS * Math.pow(2, attempt - 1)
      logger.info({ traceId, attempt, delayMs }, 'Pipeline retry — backing off')
      await new Promise(r => setTimeout(r, delayMs))
    }
    const result = await runAgenticDelivery(ctx, config, registry)
    return result  // Éxito — salir del loop
  } catch (err) {
    lastError = err as Error
    if (!isRetriableError(err)) {
      logger.warn({ traceId, err, attempt }, 'Pipeline failed with non-retriable error — no retry')
      break
    }
    if (attempt < PIPELINE_MAX_RETRIES) {
      logger.warn({ traceId, err, attempt }, 'Pipeline failed — will retry')
    }
  }
}
// Todos los intentos agotados
throw lastError  // El catch externo envía error fallback
```

### Clasificación de errores

```typescript
function isRetriableError(err: unknown): boolean {
  if (!(err instanceof Error)) return true  // Desconocido — intentar

  const msg = err.message.toLowerCase()

  // NO retriable — errores permanentes
  if (msg.includes('authentication') || msg.includes('unauthorized')) return false
  if (msg.includes('not found') || msg.includes('no existe')) return false
  if (msg.includes('invalid config') || msg.includes('schema')) return false
  if (msg.includes('permission denied') || msg.includes('forbidden')) return false

  // Retriable — errores transitorios
  if (msg.includes('timeout') || msg.includes('timed out')) return true
  if (msg.includes('rate limit') || msg.includes('429')) return true
  if (msg.includes('econnreset') || msg.includes('econnrefused')) return true
  if (msg.includes('socket hang up') || msg.includes('network')) return true
  if (msg.includes('overloaded') || msg.includes('529')) return true
  if (msg.includes('pool') || msg.includes('connection')) return true

  // Default: retriable (mejor intentar de más que de menos)
  return true
}
```

### Guard contra doble-delivery

**Pregunta clave**: ¿puede `runAgenticDelivery()` haber enviado una respuesta parcial al usuario antes de fallar?

Analizar el flujo:
1. Agentic loop: LLM calls + tool execution → NO envía nada al usuario
2. Post-processor: format + TTS → NO envía nada al usuario  
3. Delivery: validate → **SEND** → persist

La respuesta solo se envía en Phase 5 (delivery). Si el error ocurre ANTES de delivery, no se envió nada. Si ocurre DURANTE delivery, el retry de `sendMessage()` en delivery.ts ya maneja eso.

**Conclusión**: Si `runAgenticDelivery()` lanza un error, significa que NO llegó a completar delivery (o delivery ya reintentó y falló). Es seguro reintentar todo el agentic pipeline.

**PERO**: Hay un edge case. Si el agentic loop ejecutó tools con side effects (crear commitment, enviar notificación HITL, etc.) y luego falla, el retry re-ejecutaría esos tools. Mitigaciones:
- El dedup cache del agentic loop (`tool-dedup-cache.ts`) previene calls idénticos dentro de una ejecución, pero se resetea entre ejecuciones.
- Para el retry, pasar el mismo `ctx` (incluye traceId). Si los tools son idempotentes, no hay problema.
- **Aceptación de riesgo**: Es mejor re-ejecutar un tool que perder el mensaje del usuario. Los tools críticos (HITL, commitments) son idempotentes por diseño (usan INSERT con checks).

### El ACK no se re-envía

El ACK message ("escribiendo...") se envía ANTES del agentic pipeline (fuera del retry loop). No se duplica en retries. Esto es correcto — el usuario ya sabe que Luna está "pensando".

---

## Archivos a modificar

### 1. `src/engine/engine.ts` — Agregar retry loop

Ubicar donde se llama `runAgenticDelivery()` (o la función equivalente que ejecuta el agentic pipeline). Envolver en retry loop como se describe arriba.

Agregar `isRetriableError()` como función privada en el mismo archivo (o en un nuevo `src/engine/utils/retry-classifier.ts` si se prefiere separación — pero NO sobre-ingenierar; una función privada es suficiente).

### 2. `src/engine/CLAUDE.md` — Documentar retry

Agregar sección:

```markdown
## Pipeline Retry (mensajes reactivos)

El agentic pipeline se reintenta hasta 2 veces si falla por error transitorio (timeout LLM, rate limit, error de red). Backoff exponencial: 1.5s, 3s.

**NO se reintenta si**:
- Error de autenticación, config inválido, o permiso denegado
- La respuesta ya fue entregada al usuario (delivery completó)

**Guard de side effects**: Tools ejecutados antes del fallo pueden re-ejecutarse en el retry. Los tools críticos (HITL, commitments) son idempotentes. El dedup cache se resetea entre intentos — esto es aceptado.

**Nota**: El retry de envío en delivery.ts (2 intentos, backoff 1s/2s) es SEPARADO y cubre errores de red al enviar el mensaje final. El pipeline retry cubre fallos en LLM/tools.
```

---

## Lo que NO hacer

- **NO reintentar Phase 1 (intake)** — es barata y no falla transitoriamente. El retry solo envuelve el agentic pipeline.
- **NO reintentar si ya se envió respuesta** — `runAgenticDelivery()` incluye delivery; si lanza error, no completó el envío.
- **NO crear un sistema de retry queue con BullMQ** — el retry es sincrónico dentro del mismo request. El orphan recovery job ya existe para fallos que no se recuperan.
- **NO modificar delivery.ts** — su retry de envío es correcto y separado.
- **NO agregar más de 2 retries** — con 3 intentos totales (1 original + 2 retries) y backoff de 1.5s+3s = 4.5s extra max. Suficiente sin retrasar demasiado la respuesta.
- **NO loggear el error como ERROR en los intentos intermedios** — usar WARN. Solo loggear ERROR si todos los intentos fallaron.

---

## Métricas y observabilidad

Agregar al log de pipeline (`pipeline_logs` si existe):
- `retryCount: number` — cuántos retries se necesitaron (0 = primer intento exitoso)
- Si hay campos de timing, el tiempo total incluye los retries

En el log info de éxito:
```typescript
logger.info({ traceId, attempt, totalAttempts: attempt + 1 }, 'Pipeline completed')
```

---

## Checklist final
- [ ] Retry loop envuelve `runAgenticDelivery()` en engine.ts
- [ ] `isRetriableError()` implementada con clasificación de errores
- [ ] Max 2 retries, backoff exponencial (1.5s, 3s)
- [ ] ACK no se re-envía en retries
- [ ] Logs: WARN para intentos intermedios, ERROR solo en fallo final
- [ ] engine CLAUDE.md actualizado con sección de retry
- [ ] `tsc --noEmit` pasa sin errores
