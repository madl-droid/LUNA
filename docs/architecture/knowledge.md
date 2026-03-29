# LUNA — Knowledge Base: Arquitectura

> Base de conocimiento v2 con búsqueda híbrida (pgvector + FTS), sync automático, y degradación graceful.

## Principio central

**Búsqueda híbrida: vector + FTS en paralelo.** Si embeddings no están disponibles, degrada a FTS-only sin perder funcionalidad.

## Componentes

```
src/modules/knowledge/
├── manifest.ts           — lifecycle, API routes (25+), servicios
├── types.ts              — KnowledgeInjection, SearchResult, etc.
├── knowledge-manager.ts  — orquestador de todas las operaciones
├── pg-store.ts           — 10 tablas PostgreSQL
├── search-engine.ts      — búsqueda híbrida vector + FTS + FAQ
├── embedding-service.ts  — Google Gemini embeddings con circuit breaker
├── vectorize-worker.ts   — BullMQ worker para vectorización async
├── sync-manager.ts       — sync periódico Google Drive + URLs
├── faq-manager.ts        — CRUD FAQs (manual, Sheets, file)
├── api-connector.ts      — APIs externas read-only
├── web-source-manager.ts — cache de páginas web
├── item-manager.ts       — Google Sheets/Docs/Drive items (v3)
├── cache.ts              — Redis cache (injection, embeddings)
├── extractors/           — extractores por MIME type + chunker
└── templates.ts          — UI SSR console
```

## Tres capas de conocimiento

### Capa 1: Core Documents (max 3)
- Siempre inyectados en Phase 1 como catálogo (título + descripción)
- Auto-downgrade: si 0 hits en N días, pierden flag core
- Upgade suggestions: docs con más hits que no son core

### Capa 2: Documentos + FAQs + Categorías
- Documentos organizados en categorías (max 25)
- FAQs con variantes de pregunta para mejor matching
- Búsqueda on-demand via tool `search_knowledge` en Phase 3

### Capa 3: Fuentes externas
- **Sync sources**: Google Drive folders + URLs con frecuencia configurable (6h-1m)
- **Web sources**: Páginas web cacheadas (max 5), smart cache (skip si <5% cambio)
- **API connectors**: APIs externas read-only (max 10) con auth (bearer/api_key/basic)

## Búsqueda híbrida

### Algoritmo

3 búsquedas en paralelo con timeout protection:

| Tipo | Timeout | Peso (con embeddings) | Peso (sin embeddings) |
|------|---------|----------------------|----------------------|
| Vector (pgvector cosine) | 5s | 60% | - |
| FTS (tsvector) | 3s | 30% | 80% |
| FAQ | 2s | 10% | 20% |

**Category boost**: +0.2 al score si `searchHint` coincide con categoría del doc.

### Pipeline de integración

1. **Phase 1**: `getInjection()` → catálogo de core docs, categorías, API connectors (cached 5min en Redis)
2. **Phase 2**: Evaluador recibe catálogo, produce `search_query` + `search_hint` (categoría)
3. **Phase 3**: Tool `search_knowledge` ejecuta búsqueda híbrida

## Embeddings

| Aspecto | Valor |
|---------|-------|
| Modelo | Google Gemini embedding-exp-03-07 |
| Dimensiones | 1536 |
| Circuit breaker | 3 fallas en 5 min → cooldown 5 min |
| Rate limit | 5000 RPM (tier 2) |
| Procesamiento | Async via BullMQ (no bloquea upload) |
| Batch | Max 100 textos por batch |
| Índice | IVFFlat (approximate nearest neighbors) |

**Degradación graceful**: sin API key o circuit breaker abierto → embeddings deshabilitados, búsqueda usa solo FTS.

## Tablas PostgreSQL

| Tabla | Propósito |
|-------|-----------|
| `knowledge_categories` | Categorías de documentos (max 25) |
| `knowledge_documents` | Registros de documentos (título, source, core flag, hit count) |
| `knowledge_document_categories` | M:N docs ↔ categorías |
| `knowledge_chunks` | Chunks con embedding vector(1536) + tsvector |
| `knowledge_faqs` | Preguntas frecuentes con variantes |
| `knowledge_sync_sources` | Fuentes de sync (Drive, URL) |
| `knowledge_gaps` | Queries sin resultados (gap detection) |
| `knowledge_api_connectors` | APIs externas configuradas |
| `knowledge_web_sources` | URLs web cacheadas |
| `knowledge_items` | Google Sheets/Docs/Drive items (v3) |

## Extractores soportados

Markdown, texto plano, JSON, PDF (pdfjs), Word (.docx), Excel/CSV (.xlsx/.xls/.csv), imágenes (Gemini Vision), Google Docs/Sheets/Slides nativos.

**Chunking**: ~500-1000 tokens por chunk, preserva headers de sección, metadata (section, page, chunk_index).

## Caching (Redis)

| Key | TTL | Contenido |
|-----|-----|-----------|
| `knowledge:injection` | 5 min | Core docs + categorías + connectors |
| Query embedding hash | 10 min | Vector de embedding para query |
| `knowledge:core:hash` | Configurable | Hash de staleness del contenido core |

Invalidación: manual vía `cache.invalidate()` o automática en `console:config_applied`.

## Jobs en background

| Job | Frecuencia | Descripción |
|-----|-----------|-------------|
| Auto-downgrade | 24h | Core docs sin hits en N días → is_core=false |
| Sync sources | Per-source (6h-1m) | Pull de Google Drive + URLs |
| BullMQ vectorize | On-demand / bulk (cooldown 1h) | Genera embeddings para chunks pendientes |

## Servicios expuestos

| Servicio | Descripción |
|----------|-------------|
| `knowledge:manager` | KnowledgeManager — orquestador principal |
| `knowledge:renderSection` | Renderer UI para console |

## Tool registrada

- **`search_knowledge`** — categoría: `knowledge`
  - Params: `query` (required), `category_hint` (optional)
  - Retorna: results con content, source, score, type

## Config: env vars principales

| Variable | Default | Descripción |
|----------|---------|-------------|
| `KNOWLEDGE_DIR` | `instance/knowledge` | Directorio de archivos |
| `KNOWLEDGE_FAQ_SHEET_URL` | `''` | Google Sheet de FAQs |
| `KNOWLEDGE_GOOGLE_AI_API_KEY` | `''` | API key para embeddings |
| `KNOWLEDGE_EMBEDDING_ENABLED` | `true` | Habilitar embeddings |
| `KNOWLEDGE_MAX_CORE_DOCS` | `3` | Máximo de docs core |
| `KNOWLEDGE_AUTO_DOWNGRADE_DAYS` | `60` | Días sin hits antes de perder core |
| `KNOWLEDGE_SYNC_ENABLED` | `true` | Habilitar sync periódico |
| `KNOWLEDGE_MAX_FILE_SIZE_MB` | `50` | Tamaño máximo de archivo |

## Seguridad

- **SSRF protection**: Validación de URLs en API connectors y web sources (no IPs privadas)
- **Content hash dedup**: Previene uploads duplicados
- **Rate limiting**: Embedding service limitado a 5000 RPM
- **Auth**: Bearer, API key (header custom), Basic auth en connectors
