# Plan 01 — WhatsApp Channel Hardening

**Prioridad:** CRITICAL
**Módulo:** WhatsApp (canal principal de comunicación)
**Objetivo:** Garantizar que ningún mensaje se pierda, que el bot no se cuelgue, y que no haya mensajes duplicados ni basura.

## Archivos target

| Archivo | Líneas | Scope |
|---------|--------|-------|
| `src/modules/whatsapp/adapter.ts` | ~697 | Conexión, envío, descarga media, reconexión |
| `src/channels/message-batcher.ts` | ~130 | Agrupación y retry de mensajes entrantes |
| `src/modules/whatsapp/manifest.ts` | ~613 | Lifecycle, batch dispatch, flood, precloseTimers |

## Paso 0 — Verificación obligatoria

Antes de cualquier fix, leer los 3 archivos completos y confirmar que cada bug existe en la ubicación indicada. Si la ubicación difiere, buscar la real. Si el bug no existe, documentar y saltar.

## Fixes

### FIX-01: Batch handler retry robusto [CRITICAL]
**Fuente:** Bug #4 del análisis profundo
**Archivo:** `src/channels/message-batcher.ts` ~línea 100
**Bug:** Si el batch handler falla 2 veces, `pending.delete()` borra los mensajes sin recuperación. Los mensajes del usuario se pierden.
**Fix:**
1. Leer la lógica actual de retry en líneas ~94-103
2. Cambiar de 1 retry a 3 retries con backoff exponencial (1s, 2s, 4s)
3. Si todos los retries fallan, NO borrar `pending` — mover los mensajes a un dead-letter log
4. Agregar log CRITICAL con los message IDs perdidos para alertar
5. Asegurar que `pending.delete()` solo se llama después de éxito confirmado

### FIX-02: sendMessage con reintentos [CRITICAL]
**Fuente:** Bug #5 del análisis profundo
**Archivo:** `src/modules/whatsapp/adapter.ts` ~línea 360
**Bug:** `sendMessage()` falla 1 vez y se pierde la respuesta del bot. No hay retry.
**Fix:**
1. Leer la función `sendMessage()` completa (~líneas 360-399)
2. Envolver la llamada WA en un retry loop: 3 intentos con backoff (1s, 2s, 4s)
3. Solo reintentar en errores transitorios (network, timeout), NO en errores de validación
4. Retornar `{ success: false, error }` solo después de agotar retries
5. Log con traceId en cada retry

### FIX-03: Memory leaks — jidTypeMap, precloseTimers, activePresences [CRITICAL]
**Fuente:** Bug #6 del análisis profundo
**Archivo:** `src/modules/whatsapp/adapter.ts` ~línea 115, `src/modules/whatsapp/manifest.ts` ~línea 587
**Bug:** 3 Maps crecen sin límite:
- `jidTypeMap` (adapter.ts): cache de tipo de JID, nunca se limpia
- `precloseTimers` (manifest.ts): timers de pre-cierre de sesión
- `activePresences` (adapter.ts o manifest.ts): presencias activas
**Fix:**
1. Buscar las 3 estructuras en ambos archivos
2. `jidTypeMap`: agregar LRU eviction (máx 10,000 entries) o usar un Map con TTL. Alternativa simple: limpiar entries > 24h viejos en un interval
3. `precloseTimers`: verificar que se limpian en `stop()`. Agregar `clearTimeout` + `delete` cuando la sesión se cierra
4. `activePresences`: verificar cleanup. Agregar `delete` cuando la presencia se detiene o en un sweep periódico
5. En `stop()` del manifest, asegurar que las 3 estructuras se limpian completamente

### FIX-04: Media download con timeout y límite de tamaño [CRITICAL]
**Fuente:** Bug #12 del análisis profundo
**Archivo:** `src/modules/whatsapp/adapter.ts` ~línea 589
**Bug:** `downloadMediaMessage` no tiene timeout ni límite de tamaño. Un archivo grande puede causar OOM.
**Fix:**
1. Leer la sección de media download (~líneas 589-630)
2. Agregar timeout de 30s al download: `AbortController` + `setTimeout`
3. Agregar límite de tamaño: 50MB máximo. Si `content-length > 50MB`, abortar
4. Si no hay `content-length` header, ir acumulando y abortar si supera el límite
5. En ambos casos (timeout y size), retornar error descriptivo, NO crashear
6. Log el tamaño del archivo descargado y el tiempo de descarga

### FIX-05: Mutex en initialize() contra reconexiones concurrentes [CRITICAL]
**Fuente:** E5 del análisis profundo
**Archivo:** `src/modules/whatsapp/adapter.ts` ~línea 141
**Bug:** Si initialize() se llama concurrentemente (ej: hot-reload + reconexión automática), se crean sockets duplicados → mensajes duplicados, credenciales corruptas.
**Fix:**
1. Leer `initialize()` completa (~líneas 141-308)
2. Agregar un mutex/flag: `private initializing = false`
3. Al entrar: si `initializing` es true, retornar early (o esperar con una Promise)
4. Poner `initializing = true` al inicio, `initializing = false` en finally
5. Alternativa más robusta: usar un `Mutex` class simple con `acquire()`/`release()`
6. Asegurar que el flag se resetea incluso si initialize() falla (try/finally)

### FIX-06: Attachments perdidos en batch merge [HIGH]
**Fuente:** E7 del análisis profundo
**Archivo:** `src/modules/whatsapp/manifest.ts` ~líneas 379-392
**Bug:** Cuando el batcher agrupa mensajes rápidos, la función `dispatchBatch` hace `allTexts.join('\n')` pero pierde los attachments de mensajes 2..N. Solo se conservan los attachments del primer mensaje.
**Fix:**
1. Leer `dispatchBatch` (~líneas 379-392) y ver cómo se construye el mensaje merged
2. Además de `allTexts.join('\n')`, concatenar todos los `attachments` arrays de todos los mensajes del batch
3. El mensaje resultante debe tener: texto combinado + todos los attachments combinados
4. Preservar el orden de attachments (por timestamp del mensaje original)

### FIX-07: Queue de mensajes durante reconexión [HIGH]
**Fuente:** E8 del análisis profundo
**Archivo:** `src/modules/whatsapp/adapter.ts` ~líneas 192-224
**Bug:** `sendMessage()` durante reconexión retorna `{ success: false }` silenciosamente. La respuesta del bot se pierde.
**Fix:**
1. Leer qué pasa en `sendMessage()` cuando no hay socket activo
2. Implementar un outgoing queue: si el socket no está conectado, encolar el mensaje
3. Al reconectar exitosamente, flush del queue (enviar todos los encolados en orden)
4. TTL del queue: 5 minutos. Mensajes más viejos se descartan con log WARN
5. Tamaño máx del queue: 100 mensajes. Si se llena, descartar los más viejos con log

### FIX-08: disconnect() con try/finally [MEDIUM]
**Fuente:** F2 del análisis profundo
**Archivo:** `src/modules/whatsapp/adapter.ts` ~línea 342
**Bug:** Si `logout()` falla dentro de `disconnect()`, el socket nunca se limpia. La siguiente reconexión falla porque el socket viejo sigue referenciado.
**Fix:**
1. Leer `disconnect()` (~líneas 342-358)
2. Envolver en try/finally: el cleanup de socket, listeners, y estado debe ocurrir en el `finally` block, incluso si logout falla
3. Asegurar que `this.sock = null` (o equivalente) se ejecuta siempre

### FIX-09: floodThreshold pasado al batcher [MEDIUM]
**Fuente:** F9 del análisis profundo
**Archivo:** `src/modules/whatsapp/manifest.ts` ~línea 553
**Bug:** `floodThreshold: 20` está definido en el manifest pero nunca se pasa al batcher. La protección contra flood está deshabilitada.
**Fix:**
1. Verificar cómo se instancia el batcher en manifest.ts
2. Leer la interfaz del batcher en `src/channels/message-batcher.ts` para ver si acepta un `floodThreshold` param
3. Si lo acepta: pasar el valor del manifest al constructor/config del batcher
4. Si no lo acepta: agregar el parámetro al batcher e implementar la lógica de flood protection (ej: si un contacto envía > N mensajes en M segundos, ignorar los siguientes con log WARN)
5. El threshold debe ser configurable vía config del módulo

### FIX-10: Filtrar reactions, stickers, viewOnce [MEDIUM]
**Fuente:** F10 / C1 del análisis profundo
**Archivo:** `src/modules/whatsapp/adapter.ts` ~líneas 448-498
**Bug:** Reactions (👍), stickers y mensajes viewOnce llegan al LLM como texto vacío. El LLM responde a un mensaje fantasma.
**Fix:**
1. Leer el handler de mensajes entrantes (~líneas 448-498)
2. Detectar y filtrar:
   - Reactions: `message.reactionMessage` → ignorar silenciosamente (log DEBUG)
   - Stickers: `message.stickerMessage` → ignorar silenciosamente
   - ViewOnce: `message.viewOnceMessage` → ignorar silenciosamente
3. Estos mensajes NO deben llegar al pipeline del engine
4. No enviar ninguna respuesta al usuario por estos tipos de mensaje

## Verificación post-fix

```bash
docker run --rm -v /docker/luna-repo:/app -w /app node:22-alpine npx tsc --noEmit
```

## Archivos de documentación a actualizar

- `src/modules/whatsapp/CLAUDE.md` — documentar: mutex en initialize, retry en sendMessage, media limits, outgoing queue, flood threshold, filtro de reactions/stickers
- `src/channels/CLAUDE.md` (si existe) — documentar retry mejorado en message-batcher
