# Memory — Sistema de memoria tres-tier (v3)

3 niveles: caliente (messages Redis+PG), tibio (session_summaries), frío (contact_memory en agent_contacts). Incluye búsqueda híbrida FTS+vector, compromisos, archivo legal, y pipeline logs.

## Archivos
- `manifest.ts` — lifecycle, configSchema (20+ params), servicio `memory:manager`
- `memory-manager.ts` — orquestador, API pública: hybrid search, compress, merge, fact correction
- `redis-buffer.ts` — ops Redis: mensajes (lista circular), metadata (hash), lead_status cache, context cache
- `pg-store.ts` — persistencia PG: messages, agent_contacts, session_summaries, commitments, archives, pipeline_logs
- `types.ts` — StoredMessage, SessionSummary, AgentContact, ContactMemory, Commitment, FactCorrection, HybridSearchResult

## Manifest
- type: `core-module`, removable: false, activateByDefault: true
- configSchema (27 params):
  - **Buffer/sesiones**: MEMORY_BUFFER_MESSAGE_COUNT (50), MEMORY_SESSION_INACTIVITY_TIMEOUT_MIN (30), MEMORY_SESSION_MAX_TTL_HOURS (24)
  - **Compresión**: MEMORY_COMPRESSION_THRESHOLD (30), MEMORY_COMPRESSION_KEEP_RECENT (10), MEMORY_COMPRESSION_MODEL ('claude-haiku-4-5-20251001')
  - **Modelos**: MEMORY_EMBEDDING_MODEL ('text-embedding-3-small'), MEMORY_MAX_CONTACT_MEMORY_WORDS (2000)
  - **Retención**: MEMORY_SUMMARY_RETENTION_DAYS (90), MEMORY_ARCHIVE_RETENTION_YEARS (5), MEMORY_PIPELINE_LOGS_RETENTION_DAYS (90), MEMORY_MEDIA_IMAGE_RETENTION_YEARS (5)
  - **Purga**: MEMORY_HOT_MESSAGES_PURGE_AFTER_COMPRESS (true), MEMORY_PURGE_MERGED_SUMMARIES (false), MEMORY_RECOMPRESSION_INTERVAL_DAYS (30)
  - **Batch crons**: MEMORY_BATCH_COMPRESS_CRON ('0 2 * * *'), MEMORY_BATCH_EMBEDDINGS_CRON ('30 2 * * *'), MEMORY_BATCH_MERGE_CRON ('0 3 * * *'), MEMORY_BATCH_RECOMPRESS_CRON ('0 4 1 * *'), MEMORY_BATCH_MEDIA_PURGE_CRON ('0 5 * * 0'), MEMORY_BATCH_LOGS_PURGE_CRON ('0 5 * * 0'), MEMORY_BATCH_ARCHIVE_PURGE_CRON ('0 5 1 * *')

## Servicio registrado
- `memory:manager` — instancia de MemoryManager

## Tablas PG (v3)
- `messages` — nivel caliente: dual-write (old + new columns) durante migración
- `agent_contacts` — nivel frío: relación agente↔contacto, lead_status, qualification_data, contact_memory JSONB
- `session_summaries` — nivel tibio: resúmenes comprimidos con FTS dinámico + embeddings vector(1536)
- `commitments` — compromisos y seguimiento (PERMANENTE, nunca se borran)
- `conversation_archives` — backup legal (5 años retención)
- `pipeline_logs` — observabilidad (90 días retención)
- `agents` — registro de agentes
- `companies` — empresas B2B

## Redis keys
- `session:{sessionId}:messages` — lista circular hot messages
- `session:{sessionId}:meta` — hash metadata sesión
- `lead_status:{contactId}:{agentId}` — cache lead status (12h TTL)
- `context:{contactId}:{agentId}` — cache context bundle (5min TTL)

## Patrones
- Redis primary para reads. PG fallback solo cuando Redis vacío.
- PG writes de pipeline_logs son **fire-and-forget**
- Búsqueda híbrida: FTS (plainto_tsquery dinámico por idioma) + vector cosine + recency re-rank
- Compresión: caller provee resultado LLM, memory-manager maneja storage
- Fact correction: busca key_fact existente, lo reemplaza con supersedes tracking
- Contact memory merge: warm→cold, marca summaries como merged

## Trampas
- **NO cambiar fire-and-forget de pipeline_logs/messages a await** — bloquearía pipeline
- Las tablas fundacionales (messages, agents, contacts, etc.) las crea el migrador del kernel (`src/migrations/*.sql`), NO este módulo. `ensureTable()` fue eliminado.
- `content` column en messages cambió de JSONB a TEXT (`content_text`). Código migrado a columnas nuevas (sin dual-write).
- `qualification_*` migró de contacts a agent_contacts. Lead-scoring usa agentId.
- El FTS trigger mapea `summary_language` al diccionario PG automáticamente.
- pgvector requiere `CREATE EXTENSION vector` — ver phase0 migration.
- **Config helpers**: usa `numEnv`, `boolEnv` de `kernel/config-helpers.js` en configSchema. NO escribir `.transform(Number).pipe(...)` manualmente.
