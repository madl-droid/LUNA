# src/extractors/ — Extractores Globales

## Propósito
Funciones de extracción de contenido unificadas. **CUALQUIER** módulo, agente, subagente o proceso que necesite extraer información de un archivo DEBE usar estas funciones. No se duplica lógica de extracción en ningún otro lugar.

## Archivos
- `types.ts` — Tipos: ExtractedContent, ExtractorResult (unión discriminada), LLMEnrichment, ImageResult, AudioResult, VideoResult, etc.
- `utils.ts` — Utilidades: resolveMimeType, isImplicitTitle, computeMD5, isSmallImage, constantes
- `index.ts` — Registry central: extractContent(), enrichWithLLM(), isSupportedMimeType(), classifyMimeType()
- Extractores por formato: text.ts, docx.ts, sheets.ts, pdf.ts, slides.ts, image.ts, web.ts, youtube.ts, video.ts, audio.ts

## Extracción dual (2 resultados)
Cada extractor multimedia produce 2 resultados:
1. **Code result**: metadata + formato preparado (dimensiones, duración, formato) — para embeddings
2. **LLM result**: descripción/transcripción via Gemini — para conversación e interacción

### Funciones de enriquecimiento LLM
- `describeImage(imageResult, registry)` → ImageResult con llmEnrichment (Gemini Vision)
- `transcribeAudioContent(audioResult, registry)` → AudioResult con llmEnrichment (STT)
- `describeVideo(videoResult, registry)` → VideoResult con llmEnrichment (multimodal)
- `describeSlideScreenshots(slidesResult, registry)` → SlidesResult con screenshotDescription per slide
- `describeThumbnail(youtubeResult, registry)` → YouTubeResult con thumbnailDescription
- `enrichWithLLM(result, registry)` → orchestrador que llama a la función correcta según kind

### Uso
```typescript
import { extractContent, enrichWithLLM } from '../../extractors/index.js'
// Paso 1: extracción de código (rápido, sin LLM)
const result = await extractContent(buffer, fileName, mimeType, registry)
// Paso 2: enriquecimiento LLM (requiere registry con llm:chat)
const enriched = await enrichWithLLM(result, registry)
```

## Tipos de resultado
- `ExtractedContent` — resultado genérico (text + sections + metadata). Lo devuelven: MD, TXT, JSON, DOCX, PDF.
- `ExtractorResult` — unión discriminada por `kind` para resultados tipados por formato.
- `LLMEnrichment` — { description, transcription?, provider, generatedAt }
- `toExtractedContent(result)` — convierte cualquier ExtractorResult a ExtractedContent (incluye LLM si disponible).

## Detección de títulos
Todos los extractores de texto usan `isImplicitTitle()` de utils.ts:
- ALL CAPS, < 15 palabras, termina en ":", seguida de texto más largo
- Se necesitan ≥ 2 criterios para ser título

## Imágenes en documentos
DOCX, PDF y Web extraen imágenes embebidas. Filtros: mínimo 75×75px, dedup por MD5.

## Trampas
- `registry` es opcional para code extraction, pero NECESARIO para LLM enrichment
- Los extractores legacy de `src/modules/knowledge/extractors/` se mantienen como shim re-export
- `parseFAQsFromXlsx` NO migra — lógica de negocio de knowledge
- Smart chunker NO migra — chunking es concern de knowledge/embedding
- Audio extractor NO transcribe — usa `transcribeAudioContent()` para STT
- Video extractor NO analiza — usa `describeVideo()` para multimodal
- Web NO se describe con LLM aquí — eso lo hace el subagent de búsqueda por seguridad
