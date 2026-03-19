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
- configSchema: buffer, compresión, modelos, retención, purga, batch crons (20+ params)

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
- `content` column en messages cambió de JSONB a TEXT (`content_text`). Durante dual-write ambas se escriben.
- `qualification_*` migró de contacts a agent_contacts. Lead-scoring usa agentId.
- El FTS trigger mapea `summary_language` al diccionario PG automáticamente.
- pgvector requiere `CREATE EXTENSION vector` — ver phase0 migration.
