# Plan 02 — Engine Pipeline Core

**Prioridad:** CRITICAL
**Módulo:** Engine (pipeline de procesamiento central)
**Objetivo:** Eliminar mensajes duplicados, respuestas vacías, leaks de razonamiento interno, y asegurar shutdown limpio.

## Archivos target

| Archivo | Líneas | Scope |
|---------|--------|-------|
| `src/engine/engine.ts` | ~694 | Dedup, shutdown, hot-reload, rate limit pre-check |
| `src/engine/concurrency/contact-lock.ts` | ~67 | Timeout de lock |
| `src/engine/agentic/agentic-loop.ts` | ~475 | Guardia respuesta vacía, partial text |
| `src/engine/proactive/orphan-recovery.ts` | ~140 | Race condition con pipelines activos |

## Paso 0 — Verificación obligatoria

Antes de cualquier fix, leer los 4 archivos completos y confirmar cada bug. En particular:
- Verificar que NO existe dedup de mensajes en engine.ts (E1)
- Verificar el valor de timeout en contact-lock.ts (E2)
- Verificar qué pasa cuando el LLM retorna texto vacío en agentic-loop.ts (E3)
- Verificar que stopEngine() no drena pipelines activos (E6)

## Fixes

### FIX-01: Dedup de mensajes entrantes [CRITICAL]
**Fuente:** E1 del análisis profundo
**Archivo:** `src/engine/engine.ts` ~líneas 58-88
**Bug:** WhatsApp reenvía webhooks frecuentemente. Sin dedup en el engine, el mismo mensaje se procesa 2 veces → respuesta doble al cliente.
**Fix:**
1. Leer la función `processMessage()` o equivalente entry point del engine
2. Agregar dedup basado en `channelMessageId` (ID único del mensaje del canal):
   - Mantener un Set/Map en Redis: `dedup:{channelMessageId}` con TTL de 5 minutos
   - Antes de procesar: `SETNX` en Redis. Si ya existe → log WARN "Duplicate message, skipping" + retornar early
   - Después de procesar exitosamente: la key ya existe y expira sola
3. Si Redis no está disponible: usar un Map in-memory como fallback (LRU, max 10K entries)
4. El dedup debe ser el PRIMER check antes de cualquier otro procesamiento (antes del contact lock, antes de rate limit)

### FIX-02: ContactLock timeout = pipeline timeout [CRITICAL]
**Fuente:** E2 del análisis profundo
**Archivo:** `src/engine/concurrency/contact-lock.ts` línea 9
**Bug:** `DEFAULT_LOCK_TIMEOUT_MS = 60_000` (60s) pero el pipeline puede tardar hasta 120s. Si el lock expira antes que el pipeline termine, el siguiente mensaje entra al pipeline → respuesta duplicada.
**Fix:**
1. Leer dónde se define el timeout del pipeline (buscar en engine.ts o config)
2. Alinear el lock timeout con el pipeline timeout: `DEFAULT_LOCK_TIMEOUT_MS = 150_000` (150s, con margen de 30s sobre el pipeline max)
3. Alternativamente, hacer que el lock timeout sea configurable y se lea del engine config
4. Agregar log WARN cuando un lock se acerca al 80% de su timeout (señal de pipeline lento)

### FIX-03: Guardia contra respuesta vacía del LLM [CRITICAL]
**Fuente:** E3 del análisis profundo
**Archivo:** `src/engine/agentic/agentic-loop.ts` ~línea 128
**Bug:** Si el LLM retorna texto vacío, la respuesta vacía llega al usuario. El cliente recibe un mensaje en blanco.
**Fix:**
1. Leer el path de retorno del agentic-loop (~línea 128: "No tool calls: LLM is done. Return text.")
2. Después de obtener `responseText` del LLM, agregar guardia:
   ```typescript
   if (!responseText || responseText.trim().length === 0) {
     logger.warn({ traceId }, 'LLM returned empty response — using fallback')
     responseText = '...' // placeholder, el fallback real viene del módulo prompts/fallbacks
   }
   ```
3. El fallback debe ser un mensaje del sistema de fallbacks existente, NO un string hardcodeado en el engine
4. Buscar cómo se cargan los fallback messages (probablemente vía hook o registry) y usar el mismo mecanismo
5. También verificar la línea 218 (turn-limit): misma guardia si la respuesta forzada es vacía

### FIX-04: Drain pipelines en shutdown [CRITICAL]
**Fuente:** E6 del análisis profundo
**Archivo:** `src/engine/engine.ts` ~línea 532
**Bug:** `stopEngine()` no espera que los pipelines activos terminen. Un deploy mata mensajes que están siendo procesados sin re-queue.
**Fix:**
1. Leer `stopEngine()` completa (~línea 532+)
2. Implementar graceful drain:
   a. Poner un flag `shuttingDown = true` que rechace nuevos mensajes
   b. Esperar a que los pipelines activos terminen (con timeout de 30s)
   c. Los mensajes rechazados durante shutdown deben loguearse para re-process manual
3. El semaphore/execution-queue del engine probablemente ya trackea pipelines activos — usarlo para saber cuándo están todos terminados
4. Si después de 30s aún hay pipelines activos, forzar stop con log CRITICAL

### FIX-05: Orphan recovery check in-progress [HIGH]
**Fuente:** E10 del análisis profundo
**Archivo:** `src/engine/proactive/orphan-recovery.ts` ~líneas 39-71
**Bug:** Un pipeline sin log en `pipeline_logs` es detectado como "huérfano" y se re-despacha, pero puede ser un pipeline que aún está ejecutándose (aún no escribió su log). Resultado: respuesta duplicada.
**Fix:**
1. Leer la lógica de detección de huérfanos (~líneas 39-71)
2. Antes de re-despachar un "huérfano", verificar que NO está activo:
   - Opción A: Consultar el semaphore/execution-queue del engine para ver si hay un pipeline activo para ese contacto
   - Opción B: Agregar un grace period: solo considerar huérfano si el mensaje tiene > 5 minutos de antigüedad Y no tiene pipeline_log
3. Si el mensaje SÍ tiene un pipeline activo → ignorar, no es huérfano
4. Log INFO cuando se detecta un falso huérfano

### FIX-06: Hot-reload semaphore drain [HIGH]
**Fuente:** F1 del análisis profundo
**Archivo:** `src/engine/engine.ts` ~líneas 548-565
**Bug:** Cuando el hot-reload cambia la config de concurrency, el semaphore se reemplaza inmediatamente. Los mensajes encolados en el semaphore viejo quedan permanentemente stuck.
**Fix:**
1. Leer la lógica de hot-reload (~líneas 548-565)
2. Al reemplazar el semaphore:
   a. Marcar el semaphore viejo como "draining" (no aceptar nuevos)
   b. Esperar a que todos los tasks del semaphore viejo terminen (timeout 30s)
   c. Solo entonces reemplazar con el nuevo semaphore
3. Alternativa más simple: no reemplazar el semaphore completo, solo ajustar su concurrency limit in-place

### FIX-07: Partial reasoning text guard [HIGH]
**Fuente:** F13 del análisis profundo
**Archivo:** `src/engine/agentic/agentic-loop.ts` ~líneas 189-195
**Bug:** En caso de error mid-loop, el catch block puede enviar fragmentos de razonamiento interno al usuario. Ej: "voy a usar la herramienta X" como respuesta final.
**Fix:**
1. Leer el error catch block (~líneas 189-195)
2. Si hay `partialText` del LLM antes del error:
   - NO usarlo como respuesta final si contiene patrones de razonamiento interno
   - Patrones a detectar: `"voy a"`, `"let me"`, `"I'll"`, `"using tool"`, `"herramienta"`, `"tool call"`, `"I need to"`
   - Si se detecta razonamiento interno → descartar y usar fallback
3. Si no hay partialText o es razonamiento: usar el sistema de fallback existente del engine
4. Log WARN con el texto descartado para debugging

### FIX-08: Rate limit check antes de processing [HIGH]
**Fuente:** LAB BUG-18 del audit report
**Archivo:** `src/engine/engine.ts`
**Bug:** El sistema procesa el mensaje completo (gastando tokens LLM) y luego descarta la respuesta al encontrar rate limit en delivery. Gasto innecesario.
**Fix:**
1. Buscar dónde se verifica rate limit actualmente (probablemente en delivery/Phase 5)
2. Mover el check de rate limit al INICIO de processMessage(), antes del agentic loop
3. Si el contacto está rate-limited:
   - NO procesar el mensaje (no gastar tokens)
   - Encolar el mensaje para procesarlo cuando el rate limit expire
   - Retornar early con un indicador de "rate-limited, queued"
4. Alternativa más simple si no se puede encolar: retornar un mensaje de fallback ("Un momento, estoy atendiendo tu consulta anterior") sin procesamiento LLM

## Verificación post-fix

```bash
docker run --rm -v /docker/luna-repo:/app -w /app node:22-alpine npx tsc --noEmit
```

## Archivos de documentación a actualizar

- `src/engine/CLAUDE.md` — documentar: dedup de mensajes, graceful shutdown/drain, rate limit pre-check, partial text guard
- `src/engine/concurrency/CLAUDE.md` (si existe) — documentar timeout alignment
