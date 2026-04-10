# Memory — Sistema de memoria tres-tier (v3) + Compresión v2

3 niveles: caliente (messages Redis+PG), tibio (session_summaries_v2), frío (contact_memory en agent_contacts). Incluye búsqueda híbrida FTS+vector, compromisos, archivo legal, pipeline logs, y compresión v2 con memoria a largo plazo multimodal.

## Archivos
- `manifest.ts` — lifecycle, configSchema (27 params), servicios: `memory:manager`, `memory:compression-worker`, `memory:search`
- `memory-manager.ts` — orquestador, API pública: hybrid search, compress (con archive previo), merge, fact correction
- `redis-buffer.ts` — ops Redis: mensajes (lista circular), metadata (hash), lead_status cache, context cache
- `pg-store.ts` — persistencia PG: messages, agent_contacts, session_summaries_v2, commitments, session_archives, pipeline_logs
- `types.ts` — StoredMessage, SessionSummary, AgentContact, ContactMemory, Commitment, SessionArchive, SessionSummaryV2, SessionMemoryChunk, CompressionStatus
- `session-chunker.ts` — split sesión en chunks multimodales (texto, imágenes, PDF, slides, video, audio, spreadsheets) con linking
- `session-archiver.ts` — archivo legal (texto+metadata adjuntos) + summary LLM estructurado (título/descripción/resumen completo)
- `session-embedder.ts` — embedding de chunks: texto batch via generateBatchEmbeddings, multimodal individual via generateFileEmbedding
- `compression-worker.ts` — BullMQ worker cola `session:compress`: archive → summarize → chunk+embed → cleanup → done
- `memory-search.ts` — búsqueda en memoria a largo plazo: vector cosine + FTS en session_memory_chunks, enriquecido con session_summaries_v2

## Servicios registrados
- `memory:manager` — instancia de MemoryManager
- `memory:compression-worker` — CompressionWorker (enqueue para compresión asíncrona)
- `memory:search` — búsqueda en memoria a largo plazo (.search(contactId, query, limit))

## Tablas PG (v2-only)
- `messages` — nivel caliente: mensajes raw
- `session_archives` — archivo legal: mensajes texto + metadata adjuntos (migración 020)
- `session_summaries_v2` — resúmenes LLM: título, descripción, summary completo (migración 020)
- `session_memory_chunks` — chunks multimodales con pgvector + FTS (migración 020); `source_type='session_summary'` para chunks de resumen
- `sessions.compression_status` — tracking: queued/archiving/summarizing/embedding/cleaning/done/failed (migración 020)
- `agent_contacts` — nivel frío: contact_memory JSONB
- `commitments` — compromisos (PERMANENTE)
- `pipeline_logs` — observabilidad

> Tablas v1 eliminadas: `session_summaries`, `conversation_archives`, `summary_chunks` — ya no existen en código ni en el schema SQL (eliminadas en Plans 2+3).

## Compresión v2 — Flujo (v2-only)
1. Trigger: 5 min después de expirar ventana de reapertura → enqueue en BullMQ `session:compress`
2. `archiving`: guarda mensajes texto + metadata adjuntos en `session_archives`
3. `summarizing`: genera título/descripción/summary vía LLM → `session_summaries_v2`
4. `embedding`: split en chunks multimodales → embed vía Gemini Embedding 2 → `session_memory_chunks` (source_type='session_summary')
5. `cleaning`: DELETE mensajes raw + attachment_extractions
6. `done`: marca compressed_at, limpia error
- Retries: 3 intentos con backoff exponencial (30s, 60s, 120s)
- Safety net: nightly batch comprime sesiones >24h sin compression_status

## Resiliencia
- **PG write retry**: `saveMessage` en memory-manager.ts reintenta 3 veces (500ms/1s/2s) errores transitorios. No reintenta constraint violations.
- **Compression safety**: `compressSession()` aborta si `archiveSession()` falla — jamás borra mensajes sin respaldo. `compression-worker.ts` verifica `session_archives` y `session_summaries_v2` antes de DELETE.
- **Redis saveMessage try/catch**: redis-buffer.ts tiene try/catch — error de Redis no crashea el pipeline.
- **SessionMeta persist PG**: `updateSessionMeta` sincroniza a PG fire-and-forget. `getSessionMeta` hace fallback a PG si Redis está vacío y re-popula Redis.
- **updateContactMemory upsert**: usa `INSERT ON CONFLICT DO UPDATE` — nunca pierde datos si no existe el row.
- **Contact merge fix**: `mergeQualificationData` lee de `agent_contacts` ANTES de que `mergeContactMemory` lo borre. El DELETE ahora ocurre después de ambos merges.
- **BullMQ reconnect**: `enableReadyCheck: false` en connection config + listeners `error`/`stalled`.

## Trampas
- **compressSession() aborta si archiveSession() falla** — nunca borrar originales sin respaldo; archiva en `session_archives` (v2)
- **NO cambiar fire-and-forget de pipeline_logs a await** — bloquearía pipeline
- Tablas fundacionales las crea el migrador del kernel (`src/migrations/*.sql`)
- pgvector requiere `CREATE EXTENSION vector` — ver phase0 migration
- **Config helpers**: usa `numEnv`, `boolEnv` de `kernel/config-helpers.js`
- Nightly batch usa compression worker si disponible, fallback a compresión legacy
- **saveChunks() ahora requiere sessionId** — tercer parámetro después de contactId
- **updateSummaryEmbedding() es no-op** — embeddings en chunks, no en summaries v2
- **getSummariesWithoutEmbeddings() retorna []** — usar getChunksWithoutEmbeddings() en su lugar

### Race condition en trimKeepingTurns (aceptado)
`lrange` y `ltrim` no son atómicos. En la ventana entre ambas operaciones (microsegundos),
un mensaje nuevo podría ser eliminado del buffer. Riesgo aceptado porque:
1. La ventana es extremadamente pequeña
2. El buffer es solo caché — PG es la fuente de verdad y el mensaje queda ahí
3. El costo de un Lua script no justifica la mejora en este caso
