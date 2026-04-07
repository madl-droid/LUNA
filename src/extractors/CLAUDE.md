# src/extractors/ — Extractores Globales

## Propósito
Funciones de extracción de contenido unificadas. **CUALQUIER** módulo, agente, subagente o proceso que necesite extraer información de un archivo DEBE usar estas funciones. No se duplica lógica de extracción en ningún otro lugar.

## Archivos
- `types.ts` — Tipos: ExtractedContent (con `llmEnrichment?` opcional), ExtractorResult (unión discriminada), LLMEnrichment (con `visualDescriptions?`), ImageResult, AudioResult, VideoResult, DocumentMetadata (~25 campos), ExtractedImage (con `url?` para web)
- `utils.ts` — Utilidades: resolveMimeType, isImplicitTitle, computeMD5, isSmallImage, parseDualDescription, countWords, constantes
- `index.ts` — Registry central: extractContent(), enrichWithLLM(), isSupportedMimeType(), classifyMimeType(), MIGRATED_EXTRACTORS. Re-exporta VISUAL_SECTION_MARKER, OCR_SECTION_MARKER de pdf.ts
- `convert-to-pdf.ts` — Conversión DOCX/PPTX→PDF via LibreOffice headless (120s timeout, tmpdir con UUID)
- Extractores por formato: text.ts, docx.ts, sheets.ts, pdf.ts, slides.ts, image.ts, web.ts, youtube.ts, video.ts, audio.ts

## Pipeline dual: TEXT vs VISUAL

Los extractores alimentan 2 pipelines de chunking distintos en knowledge:

### Pipeline TEXT (chunkDocs — headings/word overlap)
- `.txt`, `.md`, `.json` → extractMarkdown / extractPlainText / extractJSON
- `.docx` sin imágenes → extractDocxSmart detecta `hasImages=false` → texto mammoth
- `.xlsx`, `.csv`, `.ods` → extractXlsx (1 row = 1 chunk)

### Pipeline VISUAL (chunkPdf — 3 páginas, 1 página overlap)
- `.pdf` → extractPDF (con vision OCR para scanned)
- `.docx` con imágenes → extractDocxSmart detecta `hasImages=true` → LibreOffice → PDF → chunkPdf
- `.pptx` / `.odp` → extractPptx (XML text + LibreOffice → PDF) → chunkSlidesAsPdf + speaker notes
- Google Slides → API export → PDF → chunkSlidesAsPdf

### Pipeline multimedia
- **Imagen** → extractImage (code) + describeImage (LLM dual) → chunkImage (1 chunk, multimodal)
- **Audio** → extractAudio (ffprobe) + transcribeAudioContent (STT) → splitMediaFile (60/60/10s) → chunkAudio (multimodal, `contentType: 'audio'`)
- **Video** → extractVideo (ffprobe) + describeVideo (LLM triple) → splitMediaFile (50/60/10s) → chunkVideo (`contentType: 'video_frames'`)
- **Web** → extractWeb (secciones H1-H3 + imágenes) → chunkWeb (1 chunk/sección)
- **YouTube** → extractYouTube (chapters, transcript, thumbnail) → chunkYoutube (por chapter o 5min)

### Decisión de pipeline
El caller (knowledge-manager) elige pipeline basándose en:
- `metadata.hasImages` → DOCX con imágenes va a VISUAL
- `metadata.isScanned` → PDF scanned tiene vision OCR previo
- `pdfBuffer` en resultado → disponible para pipeline VISUAL
- MIME type → audio/video/image van a sus pipelines específicos

## Extracción dual (2 resultados)
Cada extractor multimedia produce 2 resultados:
1. **Code result**: metadata rica (~25 campos) + formato preparado — para embeddings
2. **LLM result**: descripción/transcripción via Gemini — para conversación e interacción

### LLM dual description
Una sola llamada LLM produce descripción detallada + resumen de 1 línea:
- Formato: `[DESCRIPCIÓN]\n...\n[RESUMEN]\n...` (imagen, slides)
- Formato triple: `[DESCRIPCIÓN]\n...\n[RESUMEN]\n...\n[TRANSCRIPCIÓN]\n...` (video)
- Helper: `parseDualDescription(rawText)` en utils.ts (DRY, usado por image.ts, video.ts, slides.ts)
- Fallback: si el LLM no sigue el formato, texto completo va a `description`, `shortDescription` queda undefined

### Funciones de enriquecimiento LLM
- `describeImage(imageResult, registry)` → ImageResult con llmEnrichment + shortDescription
- `transcribeAudioContent(audioResult, registry)` → AudioResult con llmEnrichment (STT)
- `describeVideo(videoResult, registry)` → VideoResult con llmEnrichment (triple: desc + resumen + transcripción)
- `describeSlideScreenshots(slidesResult, registry)` → SlidesResult con screenshotDescription per slide
- `describeThumbnail(youtubeResult, registry)` → YouTubeResult con thumbnailDescription
- `enrichWithLLM(result, registry)` → orchestrador que llama a la función correcta según kind:
  - `case 'document'`: para PDFs con imágenes/scanned, empaqueta secciones con `VISUAL_SECTION_MARKER`/`OCR_SECTION_MARKER` como `visualDescriptions` en llmEnrichment (NO llama LLM, reorganiza datos existentes de extractPDF)
  - Otros kinds multimedia: delegan a sus funciones específicas (describeImage, etc.)
  - `case 'sheets'`/`'web'`: no-op, retorna sin enriquecer

### Temperatura
Todos los extractores usan task router centralizado. Tarea: `media` (via TASK_ALIASES en llm/task-router.ts). Temperatura: `0.2`. **NO hardcodear temperature en extractores.**

## Metadata rica (DocumentMetadata)
Todos los extractores populan metadata tipada (~25 campos opcionales):
- **Texto**: wordCount, lineCount, sectionCount, hasExplicitHeadings
- **Imagen**: width, height, md5, format, mimeType
- **Audio/Video**: durationSeconds, format, mimeType, hasAudio, wasConverted
- **Web**: domain, title, fetchedAt, imageUrls, sectionCount, imageCount
- **YouTube**: videoId, duration, hasChapters, chapterCount, hasTranscript, hasThumbnail
- **Sheets**: sheetCount, totalRows + csvBuffer
- **DOCX**: wordCount, hasImages, imageCount, sectionCount, hasExplicitHeadings
- **Slides**: slideCount, hasScreenshots
- **PDF**: wordCount, hasImages, isScanned, imagePages, pages (total de páginas)

Helper: `countWords(text)` en utils.ts (DRY, usado por text.ts, pdf.ts, docx.ts)

## Conversión a PDF (convert-to-pdf.ts)
- `convertToPdf(input, fileName)` → Buffer | null. LibreOffice headless, tmpdir UUID, 120s timeout.
- `isLibreOfficeAvailable()` → boolean. Chequea `libreoffice --version`.
- Usado por: extractDocxSmart (DOCX con imágenes), extractPptx (PPTX local).
- Requiere en Dockerfile: `apk add --no-cache libreoffice-writer libreoffice-impress libreoffice-calc`

## MIGRATED_EXTRACTORS
Mapa MIME type → función extractora en index.ts:
- text/markdown, text/plain, application/json → text.ts
- application/vnd.openxmlformats...wordprocessingml, application/msword → **extractDocxSmart** (router)
- application/vnd.openxmlformats...spreadsheetml, application/vnd.ms-excel, text/csv, application/vnd.oasis.opendocument.spreadsheet → sheets.ts
- application/pdf → pdf.ts
- application/vnd.openxmlformats...presentationml, application/vnd.ms-powerpoint, application/vnd.oasis.opendocument.presentation → **extractPptxAsContent**

## REGLA: Uso obligatorio de extractores en todos los canales

**TODOS los canales que reciban adjuntos DEBEN pasarlos al engine via `message.attachments: AttachmentMeta[]`.**
El engine los procesa con los extractores globales en `processAttachments()` (src/engine/attachments/processor.ts).
NUNCA procesar adjuntos fuera del pipeline de extractores.

### Checklist para canales con adjuntos
- [ ] Adapter extrae metadata del payload del canal (id, filename, mimeType, size)
- [ ] Adapter provee lazy loader `getData()` que retorna `Promise<Buffer>`
- [ ] Manifest pasa `attachments[]` en `IncomingMessage` al hook `message:incoming`
- [ ] Channel config define `enabledCategories` en `buildAttachmentConfig()`
- [ ] Platform capabilities registradas en `engine/attachments/types.ts` → `CHANNEL_PLATFORM_CAPABILITIES`

### Canales implementados
- **WhatsApp**: ✅ completo (images, documents, audio, video, spreadsheets, text)
- **Gmail**: ✅ completo (images, documents, spreadsheets, presentations, text, audio)
- **Google Chat**: ✅ completo (images, documents)

## Trampas
- `registry` es opcional para code extraction, pero NECESARIO para LLM enrichment
- Los extractores legacy de `src/modules/knowledge/extractors/` se mantienen como shim re-export
- `parseFAQsFromXlsx` NO migra — lógica de negocio de knowledge
- Smart chunker NO migra — chunking es concern de knowledge/embedding
- Audio extractor NO transcribe — usa `transcribeAudioContent()` para STT
- Video extractor NO analiza — usa `describeVideo()` para multimodal
- Web NO se describe con LLM aquí — eso lo hace el subagent de búsqueda por seguridad
- `extractDocxSmart` reemplaza `extractDocx` en MIGRATED_EXTRACTORS — backward compatible
- `extractPptx` es para PPTX local (ZIP). Google Slides usa `extractGoogleSlides` (API)
- Web images guardan URL en `ExtractedImage.url`, no en `.data` — `.data` es Buffer vacío para web
