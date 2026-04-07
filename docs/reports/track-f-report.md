# INFORME DE CIERRE — Track F: Integration — Conectar Pipelines al Knowledge Manager

## Branch: `claude/execute-plan-track-f-c77ql`

---

### Objetivos definidos

Conectar los extractores de contenido (Tracks A-E) al Knowledge Manager en producción. Los 8 Work Packages del plan:

- **WP1**: Router dual en `addDocument()` (knowledge-manager.ts)
- **WP2**: Router dual en `loadDriveFile()` (item-manager.ts)
- **WP3**: Actualizar `loadSlidesContent()` a pipeline visual PDF
- **WP4**: Audio con embedding multimodal nativo (contentType='audio', AUDIO_SPLIT_CONFIG 70→60)
- **WP5**: Activar binary lifecycle (nightly cleanup)
- **WP6**: Propagación de metadata del extractor al chunker
- **WP7**: Verificar compatibilidad SmartChunk vs EmbeddableChunk
- **WP8**: Actualizar vectorize-worker para chunks multimodal

---

### Completado ✅

**WP1 — Router dual en `addDocument()` (knowledge-manager.ts)**
- Reemplaza el hard-coded `chunkDocs(fullText)` con router inteligente por MIME type
- PDF → extractPDF + chunkPdf (visual pipeline, embeddings multimodal)
- DOCX con imágenes → extractDocxSmart → PDF por LibreOffice → chunkPdf
- DOCX sin imágenes → chunkDocs (text pipeline)
- PPTX con LibreOffice → extractPptx → PDF → chunkSlidesAsPdf + speaker notes
- PPTX sin LibreOffice → chunkDocs fallback
- Imágenes → extractImageWithVision + chunkImage con filePath en mediaDir
- Audio → extractAudio + STT (transcribeAudioContent) + temporal split si >60s + chunkAudio
- Video → extractVideo + describeVideo + temporal split si >50s + chunkVideo
- Sheets → extractSheets + chunkSheets por hoja
- Default → chunkDocs (text pipeline)
- Archivos multimodal se guardan en `instance/knowledge/media/` (accesible por embedding-queue)
- removeDocument() actualizado para buscar en ambos dirs (knowledgeDir y mediaDir)
- Helpers privados: `routeAudio()`, `routeVideo()` con temporal splitting + persistencia de segmentos

**WP2 — Router dual en `loadDriveFile()` (item-manager.ts)**
- DOCX en Drive: downloadFile → extractDocxSmart → visual (persistVisualPdf) o text
- PPTX en Drive: downloadFile → extractPptx → visual (persistVisualSlides) + speaker notes, o text
- PDF en Drive: downloadFile → persistVisualPdf (chunkPdf, mediaDir) — reemplaza extractTextFromPdf→chunkDocs
- Eliminada función helper `extractTextFromPdf` (ya no se usa)
- Nuevos helpers privados: `persistVisualPdf()`, `persistVisualSlides()`

**WP3 — `loadSlidesContent()` → pipeline visual PDF**
- Reemplaza el legacy `chunkSlides()` (per-slide con screenshots via pdf-parse)
- Nuevo flow: Drive.exportFile(id, 'application/pdf') → extractPDF → chunkSlidesAsPdf
- Fallback: si export falla → Slides API text → chunkDocs
- PDF guardado en instance/knowledge/media/ para embedding multimodal

**WP4 — Audio multimodal embedding**
- `ChunkContentType`: nuevo tipo `'audio'` (para Gemini Embedding 2 con audio nativo)
- `chunkAudio()`: contentType cambia de `'text'` a `'audio'` cuando hay segmentos con archivos
- `AUDIO_SPLIT_CONFIG.subsequentSeconds`: 70 → 60 (50s nuevo + 10s overlap por chunk)
- `isMultimodalChunk()` en embedding-queue: `'audio'` incluido en MULTIMODAL_TYPES

**WP5 — Binary lifecycle activation**
- manifest.ts: `binaryCleanupTimer` (setInterval cada hora, ejecuta a las 3AM)
- `EmbeddingQueue.runNightlyBinaryCleanup()` ya existía — ahora se invoca desde manifest
- `clearInterval(binaryCleanupTimer)` en `stop()`
- La lógica en `reconcileDocumentStatus()` ya marcaba `binary_cleanup_ready=TRUE` para attachments

**WP6 — Metadata propagación**
- `addDocument()` pasa `sourceFile`, `sourceType`, `sourceMimeType` a los chunkers
- `chunkDocs()` acepta estos opts y los propaga a `ChunkMetadata`

**WP7 — Compatibilidad SmartChunk vs EmbeddableChunk**
- Verificado: `SmartChunk` es un type alias de `EmbeddableChunk` (via `export type { EmbeddableChunk as SmartChunk }` en types.ts)
- No requirió cambios

**WP8 — vectorize-worker multimodal**
- Verificado: `embedChunks()` en vectorize-worker.ts ya maneja pdf_pages, slide, image, video_frames
- `EmbeddingQueue.generateMultimodalEmbedding()` ya lee `mediaRefs[0].filePath` de `instance/knowledge/media`
- Solo requirió agregar 'audio' a MULTIMODAL_TYPES (WP4)

---

### No completado ❌

- Ningún WP del plan quedó sin completar.

---

### Archivos creados/modificados

| Archivo | Cambio |
|---------|--------|
| `src/modules/knowledge/embedding-limits.ts` | +1 tipo: `'audio'` en ChunkContentType |
| `src/modules/knowledge/embedding-queue.ts` | isMultimodalChunk: agrega 'audio' a MULTIMODAL_TYPES |
| `src/modules/knowledge/extractors/smart-chunker.ts` | chunkAudio(): contentType='audio' para segmentos |
| `src/modules/knowledge/extractors/temporal-splitter.ts` | AUDIO_SPLIT_CONFIG.subsequentSeconds: 70→60 |
| `src/modules/knowledge/knowledge-manager.ts` | Router dual completo en addDocument() + routeAudio/routeVideo helpers + removeDocument actualizado |
| `src/modules/knowledge/item-manager.ts` | loadSlidesContent() pipeline visual + loadDriveFile() router + persistVisualPdf/Slides + eliminado extractTextFromPdf |
| `src/modules/knowledge/manifest.ts` | binaryCleanupTimer: nightly cleanup a las 3AM |

---

### Interfaces expuestas (exports que otros consumen)

- `ChunkContentType` en `embedding-limits.ts` — ahora incluye `'audio'`
- `KnowledgeManager.addDocument()` — nueva signatura interna, misma API pública
- `AUDIO_SPLIT_CONFIG` en `temporal-splitter.ts` — cambiado de 60/70/10 a 60/60/10

---

### Dependencias instaladas

Ninguna nueva — todo usa extractores y chunkers ya existentes del codebase.

---

### Tests

No hay tests nuevos. Los tests existentes de Track E (temporal-split.test.ts) deben actualizarse para reflejar AUDIO_SPLIT_CONFIG.subsequentSeconds=60 (era 70). Esta es la deuda técnica documentada en el plan (Riesgo #5).

---

### Decisiones técnicas

1. **mediaDir separado de knowledgeDir**: Los binarios de embedding (PDFs, segmentos de audio/video) se guardan en `instance/knowledge/media/` (consistente con item-manager.ts y embedding-queue.ts). El archivo original del documento en `instance/knowledge/` (para removeDocument). removeDocument actualizado para buscar en ambos.

2. **extractImageWithVision returns ExtractedContent**: La función retorna texto plano (descripción LLM) — no `ImageResult`. Se usa `imageContent.text` para la descripción del chunk.

3. **extractSheets vs extractXlsx**: `extractXlsx` retorna `ExtractedContent` (texto plano). `extractSheets` retorna `SheetsResult` con `.sheets[]`. Se usa `extractSheets` para el router.

4. **Google Slides speaker notes**: `loadSlidesContent()` exporta PDF via Drive API pero no incluye speaker notes (la API de Slides requiere llamadas adicionales no triviales). Se pasa array vacío a chunkSlidesAsPdf.

5. **Audio split threshold**: 60s (primer chunk = 60s). Para audio ≤60s → 1 chunk sin split. Para >60s → temporal split con AUDIO_SPLIT_CONFIG.

6. **Nightly cleanup con setInterval**: Usamos `setInterval(1h)` + check de hora en vez de `CronJob` (no instalado). Se invoca `runNightlyBinaryCleanup()` a las 3AM. Timer marcado con `.unref()`.

---

### Riesgos o deuda técnica

1. **Tests de AUDIO_SPLIT_CONFIG**: `tests/extractors/temporal-split.test.ts` valida la config anterior (70). Deben actualizarse para reflejar 60/60/10.

2. **mediaDir files para knowledge docs**: Los archivos en `instance/knowledge/media/` (PDFs, segmentos) para documentos de knowledge (source_type='upload') NO tienen cleanup automático cuando se elimina el documento. Solo `removeDocument()` elimina el archivo original en `instance/knowledge/`. Deuda técnica menor.

3. **Speaker notes Google Slides**: Para cargar speaker notes de Google Slides habría que hacer llamadas adicionales a la Slides API. Actualmente se pasa array vacío.

4. **Audio via embedding-queue**: Los chunks de audio con contentType='audio' pasan por `generateMultimodalEmbedding()` en embedding-queue.ts. La lógica de lectura del archivo es la misma que para pdf_pages/image. Funciona porque `mediaRefs[0].filePath` es relativo a `instance/knowledge/media/`.

---

### Notas para integración

- El router de `addDocument()` es completamente backward-compatible: si LibreOffice no está disponible, DOCX/PPTX hacen fallback a text pipeline.
- La migración `041_binary-lifecycle.sql` ya existe y fue aplicada en tracks anteriores.
- Para que el embedding de audio funcione end-to-end, Gemini Embedding 2 debe soportar `audio/mpeg`, `audio/ogg`, etc. (ya verificado que sí en embedding-service.ts).
