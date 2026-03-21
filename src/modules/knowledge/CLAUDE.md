# Knowledge v2 — Base de conocimiento del agente

Almacena, indexa y busca documentos, FAQs, web sources y API connectors. Búsqueda híbrida: pgvector cosine + FTS PostgreSQL. Categorías como tabla (max 25). Core docs como flag (max 3). Embeddings via Google text-embedding-004 (768 dims).

## Archivos
- `manifest.ts` — lifecycle v2, configSchema (14 params), ~25 apiRoutes, tool registration
- `types.ts` — KnowledgeDocument, KnowledgeCategory, KnowledgeApiConnector, KnowledgeWebSource, KnowledgeInjection, EmbeddingStatus
- `knowledge-manager.ts` — orquestador: addDocument (categoryIds[]), setCore(), getInjection(), triggerBulkVectorization()
- `pg-store.ts` — 8 tablas: documents, chunks, faqs, sync_sources, gaps, categories, document_categories, api_connectors, web_sources
- `search-engine.ts` — búsqueda híbrida: pgvector cosine + FTS + FAQ FTS. Category boost via searchHint. Degradación a FTS si sin embeddings.
- `cache.ts` — Redis cache para KnowledgeInjection (TTL 5min), invalidación en cambios core/categorías/connectors
- `embedding-service.ts` — Google text-embedding-004 via @google/generative-ai. Circuit breaker (3 fallas → 5min down). Rate limit 1500 RPM.
- `vectorize-worker.ts` — BullMQ cola knowledge:vectorize. Jobs: document (inmediato) y bulk (cooldown 1hr). Redis mutex para bulk.
- `sync-manager.ts` — sync periódico: Google Drive + URLs. Frecuencias: 6h-1m. autoCategoryId en vez de autoCategory string.
- `faq-manager.ts` — CRUD FAQs + import desde file/sheets
- `api-connector.ts` — CRUD API connectors read-only (max 10). queryApi() con auth (bearer/api_key/basic/none).
- `web-source-manager.ts` — CRUD web sources (max 3). Smart cache: skip si <5% cambio y <1 semana.
- `extractors/` — registry de extractores por MIME type (md, pdf, docx, xlsx, image, slides)

## Manifest
- type: `feature`, removable: true, activateByDefault: true
- depends: `['tools']`
- configSchema: KNOWLEDGE_DIR, MAX_FILE_SIZE_MB, CORE_MAX_CHUNKS, CACHE_TTL_MIN, AUTO_DOWNGRADE_DAYS, FAQ_SOURCE, SYNC_ENABLED, GOOGLE_AI_API_KEY, EMBEDDING_ENABLED, VECTORIZE_CONCURRENCY, MAX_WEB_SOURCES, MAX_API_CONNECTORS, MAX_CATEGORIES, MAX_CORE_DOCS

## Servicios registrados
- `knowledge:manager` — instancia de KnowledgeManager

## Tool registrada
- `search_knowledge` — busca en conocimiento con category_hint para boosting (Phase 3)

## Pipeline integration (v2)
- Phase 1: `getInjection()` → catálogo de docs core, categorías, API connectors
- Phase 2: Evaluador ve catálogo, produce search_query + search_hint
- Phase 3: Ejecuta search_knowledge con vector search + category boost
- Fallback: si knowledge module inactivo → rag-local.ts (fuse.js sobre archivos locales)

## Auto-downgrade
- Job diario: docs con is_core=true sin hits en AUTO_DOWNGRADE_DAYS → is_core=false

## API routes (bajo /oficina/api/knowledge/)
- Documents: GET /documents, POST /documents/upload, PUT /documents/core, POST /documents/delete
- Categories: GET /categories, POST /categories, PUT /categories, POST /categories/delete
- API Connectors: GET /api-connectors, POST /api-connectors, POST /api-connectors/delete
- Web Sources: GET /web-sources, POST /web-sources, POST /web-sources/delete, POST /web-sources/cache
- Vectorize: POST /vectorize, GET /vectorize/status
- FAQs: GET /faqs, POST /faqs, PUT /faqs, POST /faqs/delete, POST /faqs/import
- Sync: GET /sync-sources, POST /sync-sources, PUT /sync-sources, POST /sync-sources/delete, POST /sync-sources/sync-now
- Search: GET /search?q=&hint=&limit=
- Stats: GET /stats, GET /suggestions, POST /rebuild-index

## Trampas
- pgvector requiere CREATE EXTENSION vector (ya instalado en prod por módulo memory)
- BullMQ: primer uso real en el proyecto. Worker corre en mismo proceso. Comparte instancia ioredis.
- Embeddings opcionales — si no hay API key o circuit breaker abierto → búsqueda degrada a solo FTS
- Bulk vectorization tiene cooldown 1hr y Redis mutex (30min TTL)
- **Helpers**: usa `jsonResponse`, `parseBody`, `parseQuery` de kernel. NO redefinir.
