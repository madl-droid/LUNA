# Plan 07a — Scheduled Tasks & Proactive Messaging

**Prioridad:** HIGH
**Módulo:** Scheduled Tasks + Proactive Engine
**Objetivo:** Que las tareas programadas y mensajes proactivos respeten rate limits, persistan en memoria, no se dupliquen, y no crasheen.

## Archivos target

| Archivo | Líneas | Scope |
|---------|--------|-------|
| `src/modules/scheduled-tasks/executor.ts` | ~296 | Rate limit bypass, message persistence |
| `src/modules/scheduled-tasks/scheduler.ts` | ~167+ | jobId uniqueness |
| `src/modules/scheduled-tasks/manifest.ts` | — | Cron validation |
| `src/engine/proactive/proactive-runner.ts` | ~259 | Job idempotency |

## Paso 0 — Verificación obligatoria

Leer cada archivo y confirmar:
- `executor.ts:161-196` — que el path de `message` action envía directo por hook `message:send` sin pasar por rate limits del engine
- `executor.ts` — que los mensajes enviados por scheduled tasks NO se persisten en el módulo memory
- `scheduler.ts:159-167` — que `addDelayedJob` usa un jobId fijo que BullMQ deduplica
- `manifest.ts` — que no hay validación de expresiones cron antes de registrarlas
- `proactive-runner.ts:203+` — que hay una ventana de race condition para ejecución doble

## Fixes

### FIX-01: Scheduled tasks / Medilink respetan rate limits [CRITICAL]
**Fuente:** E9 del análisis profundo
**Archivo:** `src/modules/scheduled-tasks/executor.ts` ~líneas 161-196
**Bug:** Los mensajes enviados por scheduled tasks y Medilink bypasean TODOS los rate limits — envían directo por hook `message:send` sin pasar por el pipeline del engine. Un cron mal configurado = spam ilimitado a clientes.
**Fix:**
1. Leer el path de envío de mensajes en executor.ts (~líneas 161-196)
2. En vez de llamar `registry.runHook('message:send', ...)` directamente, usar el mecanismo de delivery del engine que incluye rate limiting
3. Opciones:
   - **Opción A (preferida):** Llamar al servicio de delivery del engine: `registry.callHook('engine:delivery', { contactId, channel, text, ... })` si existe
   - **Opción B:** Antes de enviar, consultar el rate limiter: `registry.callHook('engine:check-rate-limit', { contactId })`. Si rate-limited, encolar para después
   - **Opción C (mínima):** Implementar un rate limiter simple in-situ: máximo N mensajes proactivos por contacto por hora (configurable)
4. Verificar qué approach usa el engine para rate limiting y replicar o reusar

### FIX-02: Mensajes de scheduled tasks persisten en memory [HIGH]
**Fuente:** F8 del análisis profundo
**Archivo:** `src/modules/scheduled-tasks/executor.ts` ~líneas 161-197
**Bug:** Los mensajes enviados por tareas programadas no se guardan en el módulo de memoria. El agente no sabe qué ya mandó; los guards de repetición no los ven.
**Fix:**
1. Después de enviar un mensaje proactivo exitosamente:
   ```typescript
   await registry.runHook('message:persist', {
     contactId,
     channel,
     role: 'assistant',
     text: messageText,
     source: 'scheduled-task',
     taskId: task.id,
   })
   ```
2. Verificar cuál es el hook correcto para persistir mensajes (puede ser `memory:save` o similar)
3. Si no existe un hook específico, usar el servicio de memoria directamente:
   ```typescript
   const memory = registry.getOptional<MemoryService>('memory:service')
   if (memory) await memory.saveMessage(...)
   ```
4. El mensaje debe incluir metadata de que fue generado por scheduled task (para auditoría)

### FIX-03: addDelayedJob con jobId único [HIGH]
**Fuente:** F15 del análisis profundo + VER-07 del LAB audit
**Archivo:** `src/modules/scheduled-tasks/scheduler.ts` ~líneas 159-167
**Bug DOBLE:**
1. `addDelayedJob` usa un jobId fijo basado en el task/contact. Si se reprograma rápido, BullMQ deduplica silenciosamente → el job reprogramado nunca se ejecuta.
2. El jobId puede contener `:` que es inválido para BullMQ Custom IDs → error al crear follow-up.

**Fix:**
1. Hacer el jobId único por ejecución, no por task/contact:
   ```typescript
   // ANTES (fijo):
   const jobId = `${taskType}:${contactId}`
   
   // DESPUÉS (único):
   const jobId = `${taskType}-${contactId}-${Date.now()}`
   ```
2. Reemplazar `:` con `-` o `_` en el jobId (BullMQ no permite `:`)
3. Si el intento es cancelar el job anterior al reprogramar:
   - Primero cancelar/remover el job existente por su jobId pattern
   - Luego crear el nuevo job con ID único
4. Verificar si otros lugares del código crean jobs con `:` en el ID

### FIX-04: Validación de expresiones cron [MEDIUM]
**Fuente:** QA BUG-4 del QA report
**Archivo:** `src/modules/scheduled-tasks/manifest.ts`
**Bug:** Una expresión cron inválida (día de mes fuera de rango) crashea el módulo completo al activarse: `Error: Invalid explicit day of month definition`.
**Fix:**
1. Buscar dónde se parsean/registran las expresiones cron en manifest.ts o en el scheduler
2. Envolver el parsing de cada cron expression en try/catch:
   ```typescript
   try {
     CronExpression.parse(cronExpression)
   } catch (err) {
     logger.error({ err, cronExpression, taskId }, 'Invalid cron expression — skipping task')
     continue // o return — no dejar que una tarea inválida mate el módulo
   }
   ```
3. El módulo debe activarse exitosamente incluso si hay una tarea con cron inválido
4. Log ERROR claro para que el operador sepa qué tarea tiene el cron malo

### FIX-05: Proactive jobs con idempotencia [HIGH]
**Fuente:** F11 del análisis profundo
**Archivo:** `src/engine/proactive/proactive-runner.ts` ~línea 203+
**Bug:** Un proactive job puede ejecutarse doble por una race condition entre BullMQ re-queue y orphan recovery. El cliente recibe el follow-up duplicado.
**Fix:**
1. Leer cómo se ejecutan los proactive jobs (~línea 203+)
2. Implementar idempotencia basada en un lock:
   - Antes de ejecutar: `SETNX proactive:lock:{jobId} 1 EX 300` (5 min TTL)
   - Si SETNX retorna 0 (ya existe): skip con log WARN "Proactive job already running"
   - Después de ejecutar: el lock expira solo (no borrar manualmente por si hay crash)
3. Alternativa: usar el mecanismo de BullMQ para evitar re-queue (configurar `removeOnComplete: true` + `removeOnFail: { age: 300 }`)
4. Complementar con un check en `proactive_outreach_log`: si ya hay un log con el mismo tipo + contacto en las últimas N horas, skip

## Verificación post-fix

```bash
docker run --rm -v /docker/luna-repo:/app -w /app node:22-alpine npx tsc --noEmit
```

## Archivos de documentación a actualizar

- `src/modules/scheduled-tasks/CLAUDE.md` — documentar: rate limit compliance, message persistence, jobId uniqueness, cron validation
- `src/engine/proactive/CLAUDE.md` (si existe) — documentar: job idempotency
