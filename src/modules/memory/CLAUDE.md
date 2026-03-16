# Memory — Sistema de memoria dos-tier

Redis (buffer rápido) + PostgreSQL (persistente). Redis es primario para lectura; PG es backup y log permanente.

## Archivos
- `manifest.ts` — lifecycle, configSchema, servicio `memory:manager`
- `memory-manager.ts` — orquestador, API pública del módulo
- `redis-buffer.ts` — operaciones Redis: mensajes (lista circular) y metadata (hash)
- `pg-store.ts` — persistencia PostgreSQL, tabla messages
- `types.ts` — StoredMessage, SessionMeta, SenderType

## Manifest
- type: `core-module`, removable: false, activateByDefault: true
- configSchema: MEMORY_BUFFER_MESSAGE_COUNT (50), MEMORY_SESSION_MAX_TTL_HOURS (24), MEMORY_COMPRESSION_THRESHOLD (30), MEMORY_COMPRESSION_KEEP_RECENT (10)

## Servicio registrado
- `memory:manager` — instancia de MemoryManager

## Patrones
- Redis primary para reads. PG fallback solo cuando Redis devuelve array vacío.
- PG writes son **fire-and-forget**: async, no bloquean pipeline. Errores se loguean pero no propagan.
- Compresión: `needsCompression()` checa messageCount >= compressionThreshold.
- Raw SQL con queries parametrizadas ($1, $2). NO usar ORM.
- Usa `registry.getDb()` y `registry.getRedis()` para conexiones (no crea las suyas).

## Redis keys
- `session:{sessionId}:messages` — lista circular, trim a bufferMessageCount
- `session:{sessionId}:meta` — hash con metadata (start, contact, channel, messageCount)
- TTL basado en sessionMaxTTLHours

## PG schema
- Tabla `messages`: id (UUID PK), session_id, channel_name, sender_type, sender_id, content (JSONB), created_at
- INSERT con ON CONFLICT DO NOTHING (idempotente)
- Índice en (session_id, created_at)

## Trampas
- **NO cambiar fire-and-forget de PG a await** — bloquearía el pipeline en tiempo real
- `getSessionMessages()` cae a PG solo si Redis está vacío. Datos parciales en Redis se retornan tal cual.
- Los types de este módulo (StoredMessage) son SEPARADOS de los types de channels — no confundir
