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
