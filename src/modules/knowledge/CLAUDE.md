# Knowledge v2 — Base de conocimiento del agente

Almacena, indexa y busca documentos, FAQs, web sources y API connectors. Búsqueda híbrida: pgvector cosine + FTS PostgreSQL. Categorías como tabla (max 25). Core docs como flag (max 3). Embeddings via Google gemini-embedding-exp-03-07 (1536 dims, multimodal: texto/imágenes/PDF/audio/video).

## Archivos
- `manifest.ts` — lifecycle v2, configSchema (14 params), ~25 apiRoutes, tool registration
- `types.ts` — KnowledgeDocument, KnowledgeCategory, KnowledgeApiConnector, KnowledgeWebSource, KnowledgeInjection, EmbeddingStatus, DocumentSourceType (incluye 'attachment')
- `knowledge-manager.ts` — orquestador: addDocument con **router dual TEXT/VISUAL**, setCore(), getInjection(), triggerBulkVectorization()
- `pg-store.ts` — 8 tablas: documents, chunks, faqs, sync_sources, gaps, categories, document_categories, api_connectors, web_sources. Métodos de binary lifecycle: markBinariesForCleanup(), getDocumentsForBinaryCleanup(), clearBinaryCleanupFlag()
- `search-engine.ts` — búsqueda híbrida: pgvector cosine + FTS + FAQ FTS. Category boost via searchHint. Degradación a FTS si sin embeddings.
- `cache.ts` — Redis cache para KnowledgeInjection (TTL 5min), invalidación en cambios core/categorías/connectors
- `embedding-service.ts` — Google gemini-embedding-exp-03-07 (1536 dims) via @google/generative-ai. Circuit breaker (3 fallas → 5min down). Rate limit 5000 RPM (tier 2). Soporta multimodal (generateFileEmbedding).
- `embedding-queue.ts` — BullMQ cola unificada. Circuit breaker, HITL escalation (retry 5 y 10), reconcileDocumentStatus, generateMultimodalEmbedding (lee mediaRefs de disco), runNightlyBinaryCleanup.
- `embedding-limits.ts` — Constantes de embedding: MAX_PDF_PAGES_PER_REQUEST=3, MAX_TEXT_WORDS, TEXT_OVERLAP_WORDS. Tipos: EmbeddableChunk, LinkedEmbeddableChunk, MediaRef, ChunkMetadata, ChunkContentType.
- `vectorize-worker.ts` — BullMQ cola knowledge:vectorize. Jobs: document (inmediato) y bulk (cooldown 1hr). Redis mutex para bulk. Delega a embedding-queue para procesamiento real.
- `sync-manager.ts` — sync periódico: Google Drive + URLs. Frecuencias: 6h-1m. autoCategoryId.
- `faq-manager.ts` — CRUD FAQs + import desde file/sheets
- `api-connector.ts` — CRUD API connectors read-only (max 10). queryApi() con auth (bearer/api_key/basic/none).
- `web-source-manager.ts` — CRUD web sources (max 3). Smart cache: skip si <5% cambio y <1 semana.
- `extractors/smart-chunker.ts` — 11 funciones de chunking tipo-específicas (ver sección Chunking)
- `extractors/temporal-splitter.ts` — corte temporal de audio/video con ffmpeg `-c copy` (sin re-encode)
- `extractors/` — shim re-exports de extractores globales (src/extractors/)
- `item-manager.ts` — CRUD knowledge items (Google Sheets/Docs/Drive/PDF/Web/YouTube), **router dual por MIME type**, carga de contenido
- `console-section.ts` — renderizado SSR del panel de knowledge items en la consola

## Manifest
- type: `feature`, removable: true, activateByDefault: true
- depends: `['tools']`
- configSchema: KNOWLEDGE_DIR, MAX_FILE_SIZE_MB, CORE_MAX_CHUNKS, CACHE_TTL_MIN, AUTO_DOWNGRADE_DAYS, FAQ_SOURCE, SYNC_ENABLED, GOOGLE_AI_API_KEY, EMBEDDING_ENABLED, VECTORIZE_CONCURRENCY, MAX_WEB_SOURCES, MAX_API_CONNECTORS, MAX_CATEGORIES, MAX_CORE_DOCS

## Servicios registrados
- `knowledge:manager` — instancia de KnowledgeManager
- `knowledge:renderSection` — renderizado SSR del panel de items

## Pipeline dual TEXT / VISUAL

### Decisión de pipeline
El router en `addDocument()` / `loadDriveFile()` elige pipeline basándose en:
- MIME type (pdf → VISUAL, audio/video/image → multimedia, xlsx → sheets, text → TEXT)
- `metadata.hasImages` (DOCX con imágenes → VISUAL via LibreOffice→PDF)
- `pdfBuffer` en resultado (disponible → VISUAL)
- Fallback siempre a TEXT (chunkDocs) si la conversión falla

### Pipeline TEXT
`chunkDocs()`: split por H1/H2 headings → si sección > MAX_WORDS → split con word overlap → contentType 'text'

### Pipeline VISUAL
`chunkPdf()`: bloques de 3 páginas, 1 página overlap, prefijo texto `[...]` de página anterior → contentType 'pdf_pages', mediaRefs al PDF en disco

### Pipeline multimedia
- **Imagen**: `chunkImage()` → 1 chunk, contentType 'image', mediaRef a imagen
- **Audio**: temporal split (60/60/10s) → `chunkAudio()` → contentType 'audio', mediaRef a segmento de audio. STT corre una vez sobre el audio completo, transcripción se divide post-hoc por timestamps.
- **Video**: temporal split (50/60/10s) → `chunkVideo()` → contentType 'video_frames', mediaRef a segmento de video
- **Sheets**: `chunkSheets()` → 1 row = 1 chunk con headers, contentType 'csv'
- **Slides**: `chunkSlidesAsPdf()` → delega a chunkPdf (3 slides/chunk) + speaker notes como chunks texto separados (no participan en linking)
- **Web**: `chunkWeb()` → 1 chunk/sección con imágenes, contentType 'web'
- **YouTube**: `chunkYoutube()` → por chapter o segmentos de 5min. `routeVideo()` acepta `opts.transcription` + `opts.transcriptSegments` para enriquecer chunks con transcript preciso.

## Chunking (smart-chunker.ts)

11 funciones exportadas:
- `chunkDocs(text, opts?)` — TEXT pipeline
- `chunkSheets(headers, rows, opts?)` — 1 row = 1 chunk
- `chunkSlides(slides, opts?)` — legacy: 1 slide = 1 chunk (Google Slides con screenshots)
- `chunkSlidesAsPdf(pageTexts, pdfPath, totalPages, notes, opts?)` — VISUAL: delega a chunkPdf + notes extras
- `chunkPdf(pageTexts, pdfPath, totalPages, opts?)` — 3 páginas/chunk, 1 overlap, mediaRef a PDF
- `chunkWeb(blocks, opts?)` — secciones semánticas + imágenes
- `chunkYoutube(data, opts?)` — header + transcript por chapter/5min
- `chunkImage(data, opts?)` — 1 chunk multimodal
- `chunkAudio(opts?)` — con segmentos temporales opcionales, contentType 'audio'
- `chunkVideo(opts?)` — con segmentos temporales opcionales, contentType 'video_frames'
- `chunkDriveLink(text, opts?)` — fallback para Drive no resuelto
- `linkChunks(sourceId, chunks)` — asigna IDs, prev/next linking, chunkIndex/chunkTotal

## Temporal splitting (temporal-splitter.ts)

Corte de audio/video con ffmpeg `-c copy` (sin re-encode, rápido):
- `calculateSegments(duration, config)` → array de {startSeconds, endSeconds}
- `splitMediaFile(buffer, mimeType, duration, config)` → TemporalSegment[] con paths en tmpdir
- `cleanupSegments(segments)` — elimina archivos temporales
- **AUDIO_SPLIT_CONFIG**: first=60s, subsequent=60s (50s nuevo + 10s overlap), overlap=10s
- **VIDEO_SPLIT_CONFIG**: first=50s, subsequent=60s, overlap=10s

## Binary lifecycle
- Knowledge source: binarios viven mientras exista el documento en KB. Se borran con el doc.
- Attachment source: binarios viven hasta que todos los chunks estén embebidos → `markBinariesForCleanup()` → nightly cleanup los borra.
- Video attachment: NO se almacena binario (solo descripción LLM como texto).
- Todos los binarios se almacenan chunkeados en `instance/knowledge/media/`.
- Migration 041: columna `binary_cleanup_ready` + partial index.
- `runNightlyBinaryCleanup()` en embedding-queue.ts con path traversal guard.

## Embedding flow
```
addDocument() / loadContent()
  → extractContent() + router dual
  → chunkXxx() → EmbeddableChunk[]
  → linkChunks() → LinkedEmbeddableChunk[]
  → persistSmartChunks() → DB (knowledge_chunks)
  → vectorizeWorker.enqueueDocument(docId) [async]
    → embeddingQueue.enqueueDocument(docId)
      → processJob(): loadChunk → text o multimodal embedding → persistEmbedding
      → reconcileDocumentStatus()
```

## Knowledge Items (v3)
- Items basados en Google Sheets/Docs/Slides/Drive/PDF/Web/YouTube
- Cada item: título, descripción, categoría, URL, sourceId extraído
- Escaneo de tabs (sheets=tabs, docs=documento, drive=archivos en carpeta)
- Carga de contenido con router por sourceType → loader específico
- Drive files: bajan binario y usan extractores (no export texto plano)
- Toggle active/inactive, checkbox core, delete (solo si inactive)
- DB: knowledge_items, knowledge_item_tabs, knowledge_item_columns

## Tool registrada
- `search_knowledge` — busca en conocimiento con category_hint para boosting (Phase 3)

## Pipeline integration (v2)
- Phase 1: `getInjection()` → catálogo de docs core, categorías, API connectors
- Phase 2: Evaluador ve catálogo, produce search_query + search_hint
- Phase 3: Ejecuta search_knowledge con vector search + category boost
- Fallback: si knowledge module inactivo → rag-local.ts (fuse.js sobre archivos locales)

## Auto-downgrade
- Job diario: docs con is_core=true sin hits en AUTO_DOWNGRADE_DAYS → is_core=false

## API routes (bajo /console/api/knowledge/)
- Documents: GET /documents, POST /documents/upload, PUT /documents/core, POST /documents/delete
- Categories: GET /categories, POST /categories, PUT /categories, POST /categories/delete
- API Connectors: GET /api-connectors, POST /api-connectors, POST /api-connectors/delete
- Web Sources: GET /web-sources, POST /web-sources, POST /web-sources/delete, POST /web-sources/cache
- Vectorize: POST /vectorize, GET /vectorize/status
- FAQs: GET /faqs, POST /faqs, PUT /faqs, POST /faqs/delete, POST /faqs/import
- Sync: GET /sync-sources, POST /sync-sources, PUT /sync-sources, POST /sync-sources/delete, POST /sync-sources/sync-now
- Search: GET /search?q=&hint=&limit=
- Stats: GET /stats, GET /suggestions, POST /rebuild-index
- Items: GET /items, POST /items, PUT /items, PUT /items/active, PUT /items/core, POST /items/delete
- Items scan: POST /items/scan-tabs, POST /items/scan-columns
- Items content: POST /items/load-content, PUT /items/tab-description, PUT /items/column-description

## YouTube adapter (src/extractors/youtube-adapter.ts)
5 escenarios cubiertos:
1. **Video individual**: `getVideoMeta()` + `getTranscript()` (español primero, luego default, luego STT fallback via yt-dlp). STT fallback limitado a videos ≤30 min.
2. **Playlist**: `listPlaylistVideos()` — máx 250 videos (5 páginas × 50). Trunca con warning si hay más.
3. **Canal**: `getChannelMeta()` — metadata + playlists. Sin descarga de videos.
4. **Attachment handler**: `processYouTubeAttachment()` en engine/attachments/youtube-handler.ts.
5. **Download**: `downloadVideo()` via yt-dlp, máx 720p, máx 500MB. `downloadAudio()` para STT.

## Drive folder crawl (item-manager.ts)
- `loadDriveFile()` rutea por MIME type: Sheets/Docs/Slides/DOCX/PPTX/PDF/plain text/audio/video.
- Audio y video de Drive usan `extractAudio`/`extractVideo` + `transcribeAudioContent`/`describeVideo` + temporal split → `chunkAudio`/`chunkVideo`.
- Sync incremental via `hasFileChanged()`: `false` → sin cambios, `true` (default cuando sin datos) → re-procesar.

## Seguridad: YouTube API Key
La key va en query string (limitación de YouTube Data API v3).
La key DEBE tener restricciones de IP en Google Cloud Console.
Rotar si se expone en logs.

## csvBuffer (Sheets)
`extractSheets()` genera `csvBuffer` pero no se persiste a disco. Sheets se indexan como texto; no requieren binario para embedding multimodal. Esto es by design.

## Trampas
- pgvector requiere CREATE EXTENSION vector (ya instalado en prod por módulo memory)
- BullMQ: primer uso real en el proyecto. Worker corre en mismo proceso. Comparte instancia ioredis.
- Embeddings opcionales — si no hay API key o circuit breaker abierto → búsqueda degrada a solo FTS
- Bulk vectorization tiene cooldown 1hr y Redis mutex (30min TTL)
- **Helpers**: usa `jsonResponse`, `parseBody`, `parseQuery` de kernel. NO redefinir.
- **SmartChunk vs EmbeddableChunk**: los chunkers producen EmbeddableChunk (de embedding-limits.ts). persistSmartChunks() debe aceptar este tipo.
- **knowledge_chunks schema**: verificar que tenga columnas content_type, media_refs (JSONB), extra_metadata (JSONB). Si no, crear migración.
- **Notes en slides**: speaker notes NO deben participar en linkChunks() — tienen `isNote: true` en metadata.
- **KNOWLEDGE_MEDIA_DIR**: importar de `./constants.js`. NO redefinir `resolve(process.cwd(), 'instance/knowledge/media')` en cada módulo.
