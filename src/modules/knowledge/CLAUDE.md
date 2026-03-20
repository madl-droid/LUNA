# Knowledge — Base de conocimiento del agente

Almacena, indexa y busca documentos y FAQs. Dos modos: core (inyectado siempre) y consultable (bajo demanda via tool). Sync desde Drive y URLs.

## Archivos
- `manifest.ts` — lifecycle, configSchema, oficina fields + apiRoutes, tool registration
- `types.ts` — KnowledgeDocument, KnowledgeChunk, KnowledgeFAQ, SyncSource, SearchResult, Config
- `knowledge-manager.ts` — orquestador: add/remove/reprocess docs, search, auto-downgrade
- `pg-store.ts` — tablas: knowledge_documents, knowledge_chunks, knowledge_faqs, knowledge_sync_sources, knowledge_gaps
- `search-engine.ts` — búsqueda híbrida: FTS PostgreSQL + fuse.js fuzzy + FAQ match
- `cache.ts` — Redis cache para índice core (TTL configurable)
- `sync-manager.ts` — sync periódico: Google Drive (via google:drive) + URLs (fetch)
- `faq-manager.ts` — CRUD FAQs + import desde file (xlsx/csv) o Google Sheets
- `extractors/index.ts` — registry de extractores por MIME type
- `extractors/chunker.ts` — split en chunks con overlap (1500 chars, 200 overlap)
- `extractors/markdown.ts` — .md, .txt, .json
- `extractors/pdf.ts` — .pdf (pdf-parse)
- `extractors/docx.ts` — .docx (mammoth)
- `extractors/xlsx.ts` — .xlsx/.csv (xlsx) + parseo de FAQs
- `extractors/image.ts` — imágenes (LLM vision via llm:gateway)
- `extractors/slides.ts` — presentaciones (solo si google:slides activo)

## Manifest
- type: `feature`, removable: true, activateByDefault: true
- depends: `['tools']`
- configSchema: KNOWLEDGE_DIR, KNOWLEDGE_MAX_FILE_SIZE_MB, KNOWLEDGE_CORE_MAX_CHUNKS, KNOWLEDGE_CACHE_TTL_MIN, KNOWLEDGE_AUTO_DOWNGRADE_DAYS, KNOWLEDGE_FAQ_SOURCE, KNOWLEDGE_SYNC_ENABLED

## Servicio registrado
- `knowledge:manager` — instancia de KnowledgeManager

## Tool registrada
- `search_knowledge` — busca en conocimiento consultable (Phase 3)

## Coherencia con memoria
- Core ≈ memoria Caliente/Fría — siempre inyectado en Phase 1
- Consultable ≈ memoria Tibia — bajo demanda via tool (como memory_lookup)
- FAQs son siempre core

## Auto-downgrade
- Job diario: docs core sin hits en KNOWLEDGE_AUTO_DOWNGRADE_DAYS → consultable
- Upgrade consultable→core: solo manual por el usuario
- Sugerencias de upgrade: docs consultable con ≥5 hits

## API routes (bajo /oficina/api/knowledge/)
- Documents: GET /documents, POST /documents/upload, PUT /documents/category, POST /documents/delete, POST /documents/reprocess
- FAQs: GET /faqs, POST /faqs, PUT /faqs, POST /faqs/delete, POST /faqs/import
- Sync: GET /sync-sources, POST /sync-sources, PUT /sync-sources, POST /sync-sources/delete, POST /sync-sources/sync-now
- Search: GET /search?q=&mode=core|consultable
- Stats: GET /stats, GET /suggestions, POST /rebuild-index

## Trampas
- pdf-parse, mammoth, xlsx son dependencias opcionales — dynamic import con fallback
- Slides solo disponible si google:slides está activo (no se puede extraer sin Google Auth)
- Imágenes usan LLM vision — costoso, solo cuando se sube imagen explícitamente
- FAQs: usuario elige UNA fuente (manual/sheets/file). Cambiar fuente borra existentes.
- Frecuencias de sync: 6h, 12h, 24h, 1w, 1m (default 24h). Configurable por fuente.
- **Helpers**: usa `jsonResponse`, `parseBody`, `parseQuery` de kernel. NO redefinir.
