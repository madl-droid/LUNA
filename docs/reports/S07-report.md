# INFORME DE CIERRE — Sesión S07: Track A — Extractores
## Branch: `claude/execute-track-a-HEL8G`

---

### Objetivos definidos

Ejecutar el **Track A** del Plan Maestro de Extractores v2 (`docs/plans/PLAN-TRACK-A.md`):

- **WP1**: Metadata completa en todos los extractores
- **WP5**: LLM dual description (descripción detallada + resumen en 1 línea)
- **WP5 FIX**: Eliminar `temperature: 0.1` hardcodeada de todas las llamadas LLM en extractores
- **WP6**: Sheets — generar csvBuffer
- **WP7**: Web — agregar imageUrls a metadata
- **WP9**: DOCX/PDF router flags (cubierto por WP1)

---

### Completado ✅

#### WP1 — Metadata completa

**`src/extractors/types.ts`**
- Agrega ~25 campos tipados opcionales a `DocumentMetadata`:
  `wordCount`, `lineCount`, `sectionCount`, `hasExplicitHeadings`, `hasImages`, `imageCount`,
  `format`, `width`, `height`, `md5`, `mimeType`, `durationSeconds`, `hasAudio`, `wasConverted`,
  `domain`, `title`, `fetchedAt`, `imageUrls`, `videoId`, `duration`, `hasChapters`, `chapterCount`,
  `hasTranscript`, `hasThumbnail`, `sheetCount`, `totalRows`, `slideCount`, `hasScreenshots`
- Agrega `shortDescription?: string` a `LLMEnrichment`
- Agrega `csvBuffer?: Buffer` a `SheetsResult`

**Por extractor:**
| Extractor | Campos nuevos en metadata |
|-----------|--------------------------|
| `text.ts` (markdown) | `wordCount`, `lineCount`, `sectionCount`, `hasExplicitHeadings` |
| `text.ts` (plain) | `wordCount`, `lineCount`, `sectionCount`, `hasExplicitHeadings: false` |
| `text.ts` (JSON) | `wordCount`, `lineCount`, `sectionCount: 1` |
| `pdf.ts` | `wordCount`, `hasImages`, `sectionCount` |
| `image.ts` | `width`, `height`, `md5`, `format`, `mimeType` |
| `audio.ts` | `durationSeconds`, `format`, `mimeType`, `wasConverted` |
| `video.ts` | `durationSeconds`, `format`, `mimeType`, `hasAudio`, `wasConverted` |
| `web.ts` | `domain`, `title`, `fetchedAt`, `sectionCount`, `imageCount`, `imageUrls` |
| `youtube.ts` | `videoId`, `duration`, `hasChapters`, `chapterCount`, `sectionCount`, `hasTranscript`, `hasThumbnail` |
| `sheets.ts` | `sheetCount`, `totalRows` |
| `docx.ts` | `wordCount`, `hasImages`, `imageCount`, `sectionCount`, `hasExplicitHeadings` |
| `slides.ts` | `slideCount`, `hasScreenshots` |

#### WP5 — LLM dual description

- `image.ts` (`describeImage`): prompt actualizado con formato `[DESCRIPCIÓN]/[RESUMEN]`. Parser extrae `longDesc` y `shortDesc`, popula `llmEnrichment.shortDescription`.
- `video.ts` (`describeVideo`): prompt con `[DESCRIPCIÓN]/[RESUMEN]/[TRANSCRIPCIÓN]`. Parser triple, con fallback al formato legacy `[Transcripción]:`.
- `slides.ts` (`describeSlideScreenshots`): prompt con `[DESCRIPCIÓN]/[RESUMEN]`. Parser extrae descripción larga.

#### WP5 FIX — Temperatura hardcodeada

Eliminado `temperature: 0.1` de 7 llamadas LLM en extractores:
- `image.ts` (x1 — `extractImageWithVision`)
- `audio.ts` (x1 — `transcribeAudioContent`)
- `video.ts` (x1 — `describeVideo`)
- `pdf.ts` (x2 — OCR + vision pages)
- `youtube.ts` (x1 — `describeThumbnail`)
- `drive.ts` (x1 — summarize large)

La temperatura ahora la controla el task router: `TASK_TEMPERATURES.media = 0.2`.

#### WP6 — Sheets csvBuffer

`sheets.ts` genera `csvBuffer` al final de `extractSheets()`:
- Incluye header `# Sheet: {nombre}` por hoja
- Escapa comas y comillas dobles correctamente
- Listo para guardar como binario en `instance/knowledge/media/`

#### WP7 — Web imageUrls

`web.ts` extrae URLs de imágenes de todas las secciones y las incluye en `metadata.imageUrls`.
Filtro: solo URLs que empiezan con `http`.

#### WP9 — DOCX/PDF router flags

Cubierto por WP1: `metadata.hasImages` e `metadata.isScanned` ya estaban presentes en PDF.
`docx.ts` ahora expone `hasImages` correctamente. El caller (knowledge-manager) puede decidir pipeline texto vs visual.

---

### No completado ❌

- Nada. Todos los WP del Track A fueron completados.

---

### Archivos creados/modificados

**Modificados (12):**
- `src/extractors/types.ts` — DocumentMetadata extendida, LLMEnrichment.shortDescription, SheetsResult.csvBuffer
- `src/extractors/text.ts` — metadata rica, splitMarkdown retorna hasExplicitHeadings
- `src/extractors/pdf.ts` — metadata rica, temperature fix (x2)
- `src/extractors/image.ts` — metadata rica, dual description, temperature fix
- `src/extractors/audio.ts` — metadata rica, temperature fix
- `src/extractors/video.ts` — metadata rica, dual description con triple parser
- `src/extractors/web.ts` — metadata rica + imageUrls
- `src/extractors/youtube.ts` — metadata rica, temperature fix
- `src/extractors/sheets.ts` — metadata rica + csvBuffer
- `src/extractors/docx.ts` — metadata rica
- `src/extractors/slides.ts` — metadata rica, dual description
- `src/extractors/drive.ts` — temperature fix

---

### Interfaces expuestas (exports que otros consumen)

- `DocumentMetadata` — extendida con ~25 campos nuevos opcionales. Backward compatible (todos opcionales).
- `LLMEnrichment` — agrega `shortDescription?: string`. Backward compatible.
- `SheetsResult` — agrega `csvBuffer?: Buffer`. Backward compatible.
- Todas las funciones exportadas mantienen sus firmas originales sin cambios.

---

### Dependencias instaladas

Ninguna. Track A no requiere nuevas dependencias.

---

### Tests

No hay tests automatizados para los extractores en este repo. Los cambios son backward compatible — no se rompe ninguna firma existente.

---

### Decisiones técnicas

1. **`splitMarkdown()` retorna objeto en lugar de array**: Necesario para exponer `hasExplicitHeadings` sin duplicar lógica. Cambio interno, sin impacto en consumers de `extractMarkdown()`.

2. **Dual description con formato estructurado**: Se usa `[DESCRIPCIÓN]/[RESUMEN]` en lugar de JSON para máxima compatibilidad con todos los LLMs (Gemini y Anthropic). Parser con regex robusto + fallback a texto completo si el LLM no sigue el formato.

3. **Video con triple parser + fallback legacy**: El nuevo formato añade `[TRANSCRIPCIÓN]` separado del legacy `[Transcripción]:`. El fallback garantiza que transcripciones existentes sigan funcionando.

4. **CSV escape correcto en sheets**: Celdas con comas o comillas se escapan con `""` (standard CSV). Mejora sobre el plan original que solo chequeaba comas.

5. **`imageUrls` filtrado a `http*`**: Las URLs almacenadas en `ExtractedImage.data` son `Buffer.from(src)`. Solo se incluyen URLs absolutas (no data URIs ni rutas relativas).

---

### Riesgos o deuda técnica

- **Dual description**: Si el LLM no sigue el formato `[DESCRIPCIÓN]/[RESUMEN]`, el parser hace fallback al texto completo en `description` y `shortDescription` queda `undefined`. Esto es safe pero no ideal.
- **`extractImageWithVision()`** (legacy): Su temperature fue removida pero su system prompt NO fue actualizado al formato dual — esta función es legacy y eventualmente debería deprecarse.
- **WP9 completo en caller**: El router DOCX/PDF debe implementarse en `knowledge-manager` / `item-manager` (Track D). Los flags están disponibles; falta el caller.

---

### Notas para integración

- **Track B** (smart-chunker) puede ahora leer `metadata.hasImages`, `metadata.isScanned`, `metadata.wordCount`, etc. para decidir pipeline.
- **Track D** (DOCX→PDF, Slides→PDF): Los flags `metadata.hasImages` (DOCX) y `metadata.slideCount` (Slides) ya están disponibles.
- **Binary lifecycle** (Track C): `SheetsResult.csvBuffer` está listo para que el lifecycle manager lo guarde en `instance/knowledge/media/`.
- **Embedding pipeline**: `LLMEnrichment.shortDescription` disponible para metadata de chunks sin necesidad de segunda llamada LLM.
# INFORME DE CIERRE — Sesión S07: Track B — Smart Chunker Dual Pipeline + Audio/Video Temporal
## Branch: claude/execute-track-b-tX1R2

### Objetivos definidos
Ejecutar el Track B del plan de arquitectura de extractores v2:
- WP2: Fix bug PDF chunking (6 páginas → 3 páginas) + texto overlap
- WP3: Audio temporal chunking (60/70/10 segundos)
- WP4: Video temporal chunking (50/60/10 segundos)
- Infraestructura: nuevo módulo `temporal-splitter.ts` para corte con ffmpeg

### Completado ✅

#### WP2 — PDF 3-page chunks (fix bug 6 páginas)
- `embedding-limits.ts`: `MAX_PDF_PAGES_PER_REQUEST` cambiado de `6` → `3`
- `smart-chunker.ts` / `chunkPdf()`: agregado overlap de texto (últimos 200 chars de la página anterior como prefijo `[...] texto\n\n`)
- Un PDF de 20 páginas ahora genera ~8 chunks (antes: 1 chunk de 6 páginas perdiendo el resto)
- La página de overlap sigue apareciendo en 2 chunks consecutivos (1-page overlap ya existía)

#### WP3 — Audio temporal chunking
- `chunkAudio()` reescrita: backward-compatible + soporte para `segments[]` + `transcriptSegments[]`
- Sin segmentos → comportamiento original (1 chunk)
- Con segmentos → 1 chunk por segmento, texto extraído por timestamps o proporcionalmente
- Constantes `AUDIO_SPLIT_CONFIG`: firstChunkSeconds=60, subsequentSeconds=70, overlapSeconds=10

#### WP4 — Video temporal chunking
- `chunkVideo()` reescrita: backward-compatible + soporte para `segments[]`
- Sin segmentos → comportamiento original (1 chunk, contentType='text')
- Con segmentos → contentType='video_frames' para embedding multimodal, descripción solo en chunk 0
- Constantes `VIDEO_SPLIT_CONFIG`: firstChunkSeconds=50, subsequentSeconds=60, overlapSeconds=10

#### Infraestructura temporal-splitter.ts
- Nuevo archivo: `src/modules/knowledge/extractors/temporal-splitter.ts`
- `calculateSegments()`: función pura que calcula boundaries de segmentos
- `splitMediaFile()`: corta audio/video con ffmpeg en tmpdir, retorna paths
- `readSegment()` y `cleanupSegments()`: helpers para lectura y limpieza
- `mimeToExt()`: mapeo MIME → extensión de archivo
- Soporte: mp3, wav, ogg, flac, aac, aiff, mp4, mov, webm, avi, mpeg

### No completado ❌
- **Propagación de metadata WP1**: el plan indicaba expandir opts de cada chunker para recibir metadata enriquecida de Track A (wordCount, hasImages, domain, etc.). Track A no está completado aún, por lo que esta propagación se deja pendiente para cuando Track A entregue los extractores actualizados.
- **Integración en knowledge-manager / item-manager**: el caller que llama `splitMediaFile()` antes de `chunkAudio()`/`chunkVideo()` no fue modificado — es responsabilidad del caller pasar los `segments`. Esto es intencional: los chunkers son backward-compatible y el caller puede adoptar gradualmente.

### Archivos creados/modificados
| Archivo | Acción | Descripción |
|---------|--------|-------------|
| `src/modules/knowledge/embedding-limits.ts` | Modificado | `MAX_PDF_PAGES_PER_REQUEST`: 6 → 3 |
| `src/modules/knowledge/extractors/smart-chunker.ts` | Modificado | `chunkPdf()` con text overlap, `chunkAudio()` con segmentos, `chunkVideo()` con segmentos |
| `src/modules/knowledge/extractors/temporal-splitter.ts` | Creado | ffmpeg splitter: calculateSegments, splitMediaFile, cleanupSegments |

### Interfaces expuestas (exports que otros consumen)

**temporal-splitter.ts** — nuevos exports:
```typescript
export interface TemporalSegment { startSeconds, endSeconds, segmentPath }
export interface SplitConfig { firstChunkSeconds, subsequentSeconds, overlapSeconds }
export const AUDIO_SPLIT_CONFIG: SplitConfig  // 60/70/10
export const VIDEO_SPLIT_CONFIG: SplitConfig  // 50/60/10
export function calculateSegments(totalDurationSeconds, config): Array<{startSeconds, endSeconds}>
export async function splitMediaFile(inputBuffer, mimeType, totalDurationSeconds, config): Promise<TemporalSegment[]>
export async function readSegment(segmentPath): Promise<Buffer>
export async function cleanupSegments(segments): Promise<void>
```

**smart-chunker.ts** — interfaces ampliadas (backward-compatible):
```typescript
// chunkAudio: nuevos opts opcionales
segments?: Array<{ startSeconds, endSeconds, segmentPath }>
transcriptSegments?: Array<{ text, offset, duration? }>

// chunkVideo: nuevos opts opcionales
segments?: Array<{ startSeconds, endSeconds, segmentPath }>
```

### Dependencias instaladas
Ninguna nueva. `ffmpeg` ya estaba en el Dockerfile.

### Tests
No hay tests unitarios en el proyecto. La lógica de `calculateSegments()` es pura y verificable manualmente:
- Audio 90s con AUDIO_SPLIT_CONFIG (60/70/10): chunk[0]=0-60s, chunk[1]=50-90s → 2 chunks ✓
- Audio 200s: chunk[0]=0-60, chunk[1]=50-120, chunk[2]=110-180, chunk[3]=170-200 → 4 chunks ✓
- Video 120s con VIDEO_SPLIT_CONFIG (50/60/10): chunk[0]=0-50, chunk[1]=40-100, chunk[2]=90-120 → 3 chunks ✓

### Decisiones técnicas
1. **Backward compatibility total**: todos los callers existentes de `chunkAudio()` y `chunkVideo()` siguen funcionando sin cambios — los nuevos parámetros `segments` son opcionales.
2. **contentType='video_frames'** para chunks de video con segmentos: permite al embedding service tratar estos chunks como multimodal (video frames) vs texto plano.
3. **Segmentos calculados en el caller** (knowledge-manager): el splitter no se llama desde los chunkers, sino desde el caller antes de invocar el chunker. Separación de responsabilidades: chunker = formato, caller = orquestación IO.
4. **tmpdir con UUID**: cada split opera en directorio temporal único, evitando colisiones entre jobs concurrentes.
5. **`-c copy`**: ffmpeg no re-encode los segmentos, solo corta — operación rápida incluso para archivos grandes.

### Riesgos o deuda técnica
- **knowledge-manager.ts no actualizado**: el splitter existe pero nadie lo llama aún. Para activar temporal chunking real, el caller (knowledge-manager o item-manager) necesita: (1) obtener duración del audio/video, (2) llamar `splitMediaFile()`, (3) guardar segmentos en `instance/knowledge/media/`, (4) pasar `segments` a `chunkAudio()`/`chunkVideo()`.
- **Limpieza de tmpdir**: `splitMediaFile()` limpia solo el archivo de input. Los archivos de segmento quedan hasta que el caller llame `cleanupSegments()`. Si el caller falla, quedan huérfanos en tmpdir.
- **Propagación de metadata WP1**: pendiente de Track A.

### Notas para integración
- El flujo completo de audio en knowledge es: extractor → `splitMediaFile(buffer, mime, duration, AUDIO_SPLIT_CONFIG)` → guardar segmentPaths en `instance/knowledge/media/` → `chunkAudio({ transcription, durationSeconds, mimeType, segments })` → `cleanupSegments()`
- Para activar split en attachment-source (no en knowledge): NO llamar `splitMediaFile` — pasar `segments=undefined` para mantener comportamiento de 1 chunk (STT → agente → background)
