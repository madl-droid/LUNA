# Plan 03 — Memory, Data Integrity & Redis

**Prioridad:** CRITICAL
**Módulo:** Memory + Redis infrastructure
**Objetivo:** Garantizar que ningún mensaje se pierda en persistencia, que la compresión no borre datos sin respaldo, y que Redis sea resiliente.

## Archivos target

| Archivo | Líneas | Scope |
|---------|--------|-------|
| `src/modules/memory/memory-manager.ts` | ~487 | PG write, archive, compression flow |
| `src/modules/memory/redis-buffer.ts` | ~240 | saveMessage Redis |
| `src/modules/memory/pg-store.ts` | ~895 | updateContactMemory upsert |
| `src/modules/memory/compression-worker.ts` | ~358 | Verify archive before delete, reconnect |
| `src/modules/memory/contact-merge.ts` | ~309 | Merge order of operations |
| `src/kernel/redis.ts` | ~33 | maxRetries, reconnect strategy |
| `src/modules/llm/usage-tracker.ts` | ~309 | Redis INCR+EXPIRE atomicity, budget |

## Paso 0 — Verificación obligatoria

Leer cada archivo y confirmar:
- `memory-manager.ts:65` — que el PG write es fire-and-forget (sin retry)
- `redis-buffer.ts:25-36` — que saveMessage no tiene try/catch
- `memory-manager.ts:246-299` — que archive failure no aborta el flujo de compresión
- `compression-worker.ts:197-200` — que los mensajes se borran sin verificar archive
- `pg-store.ts:155-166` — que updateContactMemory es UPDATE sin upsert
- `contact-merge.ts:215-241` — que mergeQualificationData falla por orden de operaciones
- `redis.ts:9-17` — que maxRetries no tiene backoff
- `usage-tracker.ts:275-298` — que usa pipeline() no Lua script

## Fixes

### FIX-01: PG message write con retry [CRITICAL]
**Fuente:** M1 del análisis profundo
**Archivo:** `src/modules/memory/memory-manager.ts` ~línea 65
**Bug:** El write de mensajes a PostgreSQL es fire-and-forget. Si el proceso muere o PG falla transitoriamente entre el write a Redis y el commit a PG, el mensaje se pierde permanentemente.
**Fix:**
1. Leer el flujo de persistencia de mensajes (~líneas 60-70)
2. Envolver el PG write en un retry: 3 intentos con backoff (500ms, 1s, 2s)
3. Si todos los retries fallan:
   - Log CRITICAL con el contenido del mensaje
   - NO perder el mensaje de Redis (que aún existe)
   - Marcar en Redis que el PG sync está pendiente para este mensaje
4. Considerar un reconciliation job que periódicamente sincroniza mensajes de Redis que no llegaron a PG
5. El retry debe ser por error transitorio (connection reset, timeout), NO por constraint violation

### FIX-02: Compresión — verificar archive antes de delete [CRITICAL]
**Fuente:** M2 + M3 del análisis profundo
**Archivo:** `src/modules/memory/memory-manager.ts` ~líneas 246-299, `src/modules/memory/compression-worker.ts` ~líneas 197-200
**Bug DOBLE:**
1. `compression-worker.ts`: borra mensajes sin verificar que el archivo/resumen existe
2. `memory-manager.ts`: si `archiveSession()` falla, el flujo continúa a `deleteAllSessionMessages()` — los mensajes se borran sin respaldo

**Fix en memory-manager.ts (líneas 246-299):**
1. Leer el flujo completo de `closeAndCompressSession` o similar
2. El `archiveSession()` está en try/catch con log warn "non-fatal" (~línea 264)
3. Cambiar: si archive falla, abortar TODO el flujo de compresión (no borrar mensajes)
4. Retornar un error que indique que la compresión no se completó
5. El retry de compresión puede intentar de nuevo después

**Fix en compression-worker.ts (líneas 197-200):**
1. Antes de `DELETE FROM messages WHERE session_id = $1`:
   - Verificar que existe al menos 1 registro en `session_archives` para este `session_id`
   - Verificar que existe al menos 1 registro en `session_summaries_v2` para este `session_id`
2. Si alguna verificación falla: abortar el delete, log ERROR, marcar la compresión como failed
3. El principio es: **nunca borrar el original sin verificar que el respaldo existe**

### FIX-03: Redis saveMessage con try/catch [CRITICAL]
**Fuente:** M4 del análisis profundo
**Archivo:** `src/modules/memory/redis-buffer.ts` ~líneas 25-36
**Bug:** `saveMessage()` no tiene try/catch. Un error de Redis crashea el pipeline entero.
**Fix:**
1. Envolver todo el cuerpo de saveMessage en try/catch
2. En el catch: log ERROR (no CRITICAL, porque el mensaje se persistirá a PG)
3. Retornar un indicador de fallo para que el caller sepa que Redis falló
4. El pipeline NO debe morir por un error de Redis en saveMessage — PG es la fuente de verdad

### FIX-04: Redis reconnect con backoff [CRITICAL]
**Fuente:** M5 del análisis profundo
**Archivo:** `src/kernel/redis.ts` ~líneas 9-17
**Bug:** `maxRetries: 3` sin backoff. Un blip breve de Redis (ej: restart del container, 2-3 segundos) agota los 3 retries inmediatamente → `process.exit(1)`. Luna muere por un problema transitorio de Redis.
**Fix:**
1. Leer la configuración actual de Redis (~líneas 9-17)
2. Agregar `retryStrategy` con backoff exponencial: 100ms, 500ms, 1s, 2s, 5s (total ~8.6s)
3. Aumentar `maxRetries` a 10 (con el backoff, toma ~30s antes de darse por vencido)
4. NO hacer `process.exit(1)` en el error handler — log CRITICAL y dejar que el health check lo detecte
5. Agregar `reconnectOnError` para reconectar automáticamente en errores específicos (READONLY, etc.)
6. Verificar que esta configuración se aplica a TODAS las instancias de Redis (no solo la del kernel)

### FIX-05: SessionMeta persist a PG [HIGH]
**Fuente:** M6 del análisis profundo
**Archivo:** `src/modules/memory/memory-manager.ts` ~línea 85
**Bug:** SessionMeta (messageCount, status, compressed flag) solo vive en Redis. Si Redis se reinicia, las sesiones pierden su metadata.
**Fix:**
1. Leer cómo se crea/actualiza SessionMeta (~línea 85+)
2. Implementar persist a PG: cuando SessionMeta cambia, escribir a la tabla `sessions` (o equivalent)
3. Al iniciar: si Redis no tiene SessionMeta para una sesión activa, cargarla desde PG
4. La persistencia puede ser eventual (cada N updates o cada M segundos), no tiene que ser sincrónica en cada cambio
5. Campos mínimos a persistir: sessionId, contactId, messageCount, status, isCompressed, lastMessageAt

### FIX-06: updateContactMemory con upsert [HIGH]
**Fuente:** M7 del análisis profundo
**Archivo:** `src/modules/memory/pg-store.ts` ~líneas 155-166
**Bug:** `updateContactMemory()` usa UPDATE sin upsert. Si `agent_contacts` no tiene un row para este contact_id, 0 rows affected — preferencias y datos clave del contacto se pierden silenciosamente.
**Fix:**
1. Leer `updateContactMemory()` y `ensureAgentContact()` (~líneas 125-166)
2. Cambiar el UPDATE a un INSERT ON CONFLICT DO UPDATE (upsert):
   ```sql
   INSERT INTO agent_contacts (contact_id, contact_memory)
   VALUES ($1, $2)
   ON CONFLICT (contact_id) DO UPDATE SET contact_memory = $2
   ```
3. Alternativamente: llamar `ensureAgentContact()` antes del UPDATE (pero es una query extra)
4. Verificar si hay otros UPDATE-only en pg-store que tengan el mismo problema

### FIX-07: Contact merge — leer antes de borrar [HIGH]
**Fuente:** M8 del análisis profundo
**Archivo:** `src/modules/memory/contact-merge.ts` ~líneas 215-241
**Bug:** `mergeQualificationData()` intenta leer datos del contact source DESPUÉS de que el source row ya fue borrado. La calificación del contacto mergeado nunca se transfiere.
**Fix:**
1. Leer el flujo completo de merge (~líneas 215-241 y más arriba para ver el orden de operaciones)
2. Reordenar: leer TODOS los datos del source contact ANTES de borrar cualquier cosa
3. Flujo correcto:
   a. Leer qualification data del source
   b. Leer qualification data del target
   c. Merge ambos (priorizar target si hay conflicto)
   d. Escribir el resultado al target
   e. AHORA borrar el source
4. Envolver todo en una transacción PG para consistencia

### FIX-08: BullMQ compression worker con reconnect [HIGH]
**Fuente:** M9 del análisis profundo
**Archivo:** `src/modules/memory/compression-worker.ts` ~líneas 52-58
**Bug:** El BullMQ worker no tiene reconnect strategy. Si pierde conexión a Redis, queda bloqueado indefinidamente.
**Fix:**
1. Leer cómo se instancia el BullMQ worker (~líneas 52-58)
2. Agregar a la configuración del worker:
   ```typescript
   connection: {
     ...redisConfig,
     maxRetriesPerRequest: null, // BullMQ requiere esto para reconnect
     enableReadyCheck: false,
   }
   ```
3. Agregar event listener en `worker.on('error')` para log y recovery
4. Agregar event listener en `worker.on('stalled')` para re-process
5. Verificar que otros BullMQ workers en el sistema (scheduled-tasks, etc.) tengan la misma configuración

### FIX-09: Redis INCR+EXPIRE atómico con Lua script [MEDIUM]
**Fuente:** F3 del análisis profundo
**Archivo:** `src/modules/llm/usage-tracker.ts` ~líneas 275-298
**Bug:** Usa `pipeline()` que no es atómico. Si Redis crashea entre INCR y EXPIRE, el counter key se vuelve inmortal → rate limit permanente post-crash.
**Fix:**
1. Leer `updateRedisCounters()` (~líneas 271-299)
2. Reemplazar el pipeline por un Lua script que ejecute todas las operaciones atómicamente:
   ```lua
   local rpm = redis.call('INCR', KEYS[1])
   redis.call('EXPIRE', KEYS[1], ARGV[1])
   redis.call('INCRBY', KEYS[2], ARGV[2])
   redis.call('EXPIRE', KEYS[2], ARGV[3])
   redis.call('INCRBYFLOAT', KEYS[3], ARGV[4])
   redis.call('EXPIRE', KEYS[3], ARGV[5])
   redis.call('INCRBYFLOAT', KEYS[4], ARGV[6])
   redis.call('EXPIRE', KEYS[4], ARGV[7])
   return rpm
   ```
3. Definir el script como constante y usar `redis.eval()` o `redis.defineCommand()`
4. Mantener el try/catch existente para manejar errores de Redis

## Verificación post-fix

```bash
docker run --rm -v /docker/luna-repo:/app -w /app node:22-alpine npx tsc --noEmit
```

## Archivos de documentación a actualizar

- `src/modules/memory/CLAUDE.md` — documentar: PG write retry, compression safety checks, SessionMeta persist, upsert, merge order fix
- `src/kernel/CLAUDE.md` — documentar: Redis reconnect con backoff, Lua script para counters atómicos
