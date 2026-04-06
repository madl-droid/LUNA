# PLAN — Track F: Integration — Conectar Pipelines al Knowledge Manager

## Contexto

Los Tracks A-E crearon extractores con metadata rica, chunkers duales (TEXT/VISUAL), temporal splitting para audio/video, conversión DOCX/PPTX→PDF, y tipos unificados. Pero **nada de esto se ejecuta en producción** porque `knowledge-manager.ts` y `item-manager.ts` no fueron actualizados.

### Estado actual (roto)

1. **`knowledge-manager.ts:addDocument()`** (uploads): SIEMPRE usa `chunkDocs()` para TODO — PDFs, imágenes, audio, video. Ignora los extractores nuevos.
2. **`item-manager.ts:loadDriveFile()`**: Exporta DOCX/PPTX como text/plain via Drive API en vez de bajar el binario. PDF de Drive extrae texto pero no guarda binario ni usa `chunkPdf()`. Todo termina en `chunkDocs()`.
3. **`item-manager.ts:loadPdfContent()`**: YA usa `chunkPdf()` correctamente (único caso funcional).
4. **`item-manager.ts:loadSlidesContent()`**: Usa `chunkSlides()` (legacy per-slide) en vez de `chunkSlidesAsPdf()`.
5. **Binary lifecycle**: `markBinariesForCleanup()`, `runNightlyBinaryCleanup()` existen pero nadie los llama.
6. **Temporal splitting**: `splitMediaFile()` existe pero nadie lo invoca para audio/video.
7. **Audio embedding**: chunks de audio son `contentType: 'text'` (solo transcripción). Gemini Embedding soporta audio nativo.

---

## WP1: Router dual en `addDocument()` (knowledge-manager.ts)

**Archivo:** `src/modules/knowledge/knowledge-manager.ts`

### Cambios

Reemplazar el bloque actual (líneas ~98-122) que siempre hace `chunkDocs()` con un router inteligente:

```typescript
// Pseudo-code del router
import { extractContent, enrichWithLLM } from '../../extractors/index.js'
import { extractPDF } from '../../extractors/pdf.js'
import { extractDocxSmart } from '../../extractors/docx.js'
import { extractPptx } from '../../extractors/slides.js'
import {
  chunkDocs, chunkPdf, chunkImage, chunkAudio, chunkVideo,
  chunkSheets, chunkSlidesAsPdf, linkChunks
} from './extractors/smart-chunker.js'

// En addDocument(), después de extractContent():
const result = await extractContent(buffer, fileName, mimeType, this.registry)

let smartChunks: EmbeddableChunk[]

if (mimeType === 'application/pdf') {
  // Pipeline VISUAL: PDF
  const pdfResult = await extractPDF(buffer, fileName, this.registry)
  const pageTexts = pdfResult.sections.map(s => s.content)
  smartChunks = chunkPdf(pageTexts, safeFileName, pageTexts.length, { sourceFile: fileName })

} else if (mimeType.startsWith('application/vnd.openxmlformats-officedocument.wordprocessingml')
        || mimeType === 'application/msword') {
  // DOCX: router decide TEXT o VISUAL
  const docxResult = await extractDocxSmart(buffer, fileName)
  if ('pdfBuffer' in docxResult && docxResult.pdfBuffer) {
    // VISUAL: tiene imágenes, convertido a PDF
    const pdfParsed = await extractPDF(docxResult.pdfBuffer, fileName.replace(/\.docx?$/i, '.pdf'), this.registry)
    const pageTexts = pdfParsed.sections.map(s => s.content)
    // Guardar el PDF convertido también
    await writeFile(join(knowledgeDir, safeFileName.replace(/\.docx?$/i, '.pdf')), docxResult.pdfBuffer)
    smartChunks = chunkPdf(pageTexts, safeFileName.replace(/\.docx?$/i, '.pdf'), pageTexts.length, { sourceFile: fileName })
  } else {
    // TEXT: sin imágenes
    smartChunks = chunkDocs(fullText, { sourceFile: fileName, sourceType: 'docx' })
  }

} else if (mimeType.startsWith('application/vnd.openxmlformats-officedocument.presentationml')
        || mimeType === 'application/vnd.ms-powerpoint') {
  // PPTX: siempre VISUAL
  const pptxResult = await extractPptx(buffer, fileName)
  if (pptxResult.pdfBuffer) {
    const pdfParsed = await extractPDF(pptxResult.pdfBuffer, fileName.replace(/\.pptx?$/i, '.pdf'), this.registry)
    const pageTexts = pdfParsed.sections.map(s => s.content)
    const pdfName = safeFileName.replace(/\.pptx?$/i, '.pdf')
    await writeFile(join(knowledgeDir, pdfName), pptxResult.pdfBuffer)
    smartChunks = chunkSlidesAsPdf(pageTexts, pdfName, pageTexts.length, pptxResult.speakerNotes ?? [], { sourceFile: fileName })
  } else {
    // Fallback: texto del XML
    const text = pptxResult.slides.map(s => s.text).join('\n\n')
    smartChunks = chunkDocs(text, { sourceFile: fileName, sourceType: 'slides' })
  }

} else if (mimeType.startsWith('image/')) {
  // Imagen: chunk único con mediaRef
  smartChunks = chunkImage(/* ... */)

} else if (mimeType.startsWith('audio/')) {
  // Audio: temporal splitting + audio embedding
  smartChunks = await routeAudio(buffer, fileName, mimeType, safeFileName, this.registry)

} else if (mimeType.startsWith('video/')) {
  // Video: temporal splitting + video_frames embedding
  smartChunks = await routeVideo(buffer, fileName, mimeType, safeFileName, this.registry)

} else if (mimeType.includes('spreadsheet') || mimeType === 'text/csv') {
  // Sheets: ya funciona con extractXlsx + chunkSheets
  smartChunks = routeSheets(result, buffer)

} else {
  // TEXT pipeline default
  smartChunks = chunkDocs(fullText, { sourceFile: fileName })
}
```

### Helper functions (privadas en knowledge-manager.ts)

- `routeAudio()`: extractAudio → transcribeAudioContent → si >AUDIO_THRESHOLD_SECONDS → splitMediaFile → chunkAudio con segments + audioMediaRefs. Si <threshold → chunkAudio simple.
- `routeVideo()`: extractVideo → describeVideo → si >VIDEO_THRESHOLD_SECONDS → splitMediaFile → chunkVideo con segments. Si <threshold → chunkVideo simple.
- `routeSheets()`: usar extractXlsx ya existente → chunkSheets.

### Umbrales de splitting

- Audio: split si > 60s (primer chunk = 60s)
- Video: split si > 50s (primer chunk = 50s)
- Debajo del umbral: 1 chunk sin split

---

## WP2: Router dual en `loadDriveFile()` (item-manager.ts)

**Archivo:** `src/modules/knowledge/item-manager.ts`

### Problema actual

`loadDriveFile()` exporta DOCX/PPTX como text/plain → pierde imágenes y layout. PDF de Drive solo extrae texto → pierde multimodal.

### Cambios

**DOCX en Drive** (líneas 722-724):
```typescript
// ANTES: text = await drive.exportFile(file.id, 'text/plain')
// DESPUÉS:
const docxBuffer = await drive.downloadFile(file.id)
const docxResult = await extractDocxSmart(docxBuffer, file.name)
if (docxResult.pdfBuffer) {
  // Pipeline VISUAL — igual que WP1
  return this.persistVisualPdf(item, file, docxResult.pdfBuffer, docxResult)
}
// Fallback TEXT
const chunks = chunkDocs(docxResult.text, { sourceFile: file.name, sourceType: 'docx' })
return this.persistSmartChunks(item, fileName, 'application/vnd.openxmlformats...', chunks, { fileUrl: file.webViewLink })
```

**PPTX en Drive** (líneas 730-732):
```typescript
// ANTES: text = await drive.exportFile(file.id, 'text/plain')
// DESPUÉS:
const pptxBuffer = await drive.downloadFile(file.id)
const pptxResult = await extractPptx(pptxBuffer, file.name)
if (pptxResult.pdfBuffer) {
  return this.persistVisualSlides(item, file, pptxResult)
}
// Fallback TEXT
const text = pptxResult.slides.map(s => s.text).join('\n\n')
return this.persistSmartChunks(item, file.name, 'text/plain', chunkDocs(text), { fileUrl: file.webViewLink })
```

**PDF en Drive** (líneas 735-741):
```typescript
// ANTES: text = extractTextFromPdf(buffer) → chunkDocs(text)
// DESPUÉS:
const buffer = await drive.downloadFile(file.id)
// Guardar binario
const hash = createHash('sha256').update(buffer).digest('hex').substring(0, 12)
const pdfName = `${hash}_${file.name.replace(/[^a-zA-Z0-9._-]/g, '_')}`
await writeFile(join(knowledgeDir, pdfName), buffer)
// Extraer texto por página
const pdfResult = await extractPDF(buffer, file.name, this.registry)
const pageTexts = pdfResult.sections.map(s => s.content)
const chunks = chunkPdf(pageTexts, pdfName, pageTexts.length, { sourceFile: file.name })
return this.persistSmartChunks(item, file.name, 'application/pdf', chunks, {
  buffer, fileUrl: file.webViewLink
})
```

### Nuevos helpers privados en item-manager.ts

- `persistVisualPdf(item, file, pdfBuffer, originalResult)`: guarda PDF en disco, extrae pageTexts, chunkPdf, persistSmartChunks.
- `persistVisualSlides(item, file, pptxResult)`: guarda PDF en disco, chunkSlidesAsPdf con speakerNotes, persistSmartChunks.

---

## WP3: Actualizar `loadSlidesContent()` (item-manager.ts)

**Archivo:** `src/modules/knowledge/item-manager.ts` líneas 578-631

### Problema actual
Usa `chunkSlides()` (legacy: 1 slide = 1 chunk con screenshot). No usa el pipeline visual PDF.

### Cambio
Google Slides NO necesita LibreOffice — se exportan a PDF via Drive API:

```typescript
// Exportar slides como PDF via Drive
const drive = this.registry.getOptional<DriveService>('google:drive')
const pdfBuffer = await drive.exportFileAsBuffer(item.sourceId, 'application/pdf')

// Extraer texto por página
const pdfResult = await extractPDF(pdfBuffer, `${item.title}.pdf`, this.registry)
const pageTexts = pdfResult.sections.map(s => s.content)

// Guardar PDF
const pdfName = `${hash}_${item.title}.pdf`
await writeFile(join(knowledgeDir, pdfName), pdfBuffer)

// Chunk visual
const chunks = chunkSlidesAsPdf(pageTexts, pdfName, pageTexts.length, speakerNotes)
```

**Nota:** Verificar si `drive.exportFileAsBuffer()` existe o si necesita crearse. El `exportFile()` actual retorna string. Puede que necesitemos un nuevo método o cambiar el tipo de retorno.

---

## WP4: Audio con embedding multimodal

**Archivo:** `src/modules/knowledge/extractors/smart-chunker.ts`

### Cambio
Actualmente `chunkAudio()` produce `contentType: 'text'`. Gemini Embedding 2 soporta audio nativo.

```typescript
// Cuando hay segments con archivos de audio:
if (segments && segments.length > 0) {
  for (const seg of segments) {
    chunks.push({
      content: transcriptForSegment,       // texto para FTS
      contentType: 'audio',                // NUEVO: no 'text'
      mediaRefs: [{
        mimeType: opts.mimeType ?? 'audio/mpeg',
        filePath: seg.segmentPath,          // referencia al segmento de audio
      }],
      // ...
    })
  }
}
```

**Archivo:** `src/modules/knowledge/embedding-limits.ts`
Agregar `'audio'` al tipo `ChunkContentType` (ya existe como comentario pero NO está en la unión):
```typescript
export type ChunkContentType =
  | 'text'
  | 'csv'
  | 'pdf_pages'
  | 'slide'
  | 'image'
  | 'audio'           // NUEVO
  | 'video_frames'
  | 'youtube'
  | 'web'
  | 'drive'
```

---

## WP5: Binary lifecycle activation

**Archivos:**
- `src/modules/knowledge/embedding-queue.ts`
- `src/modules/knowledge/manifest.ts` (para registrar cron)

### Cambios

1. **En `reconcileDocumentStatus()`**: después de marcar un documento como `completed`, llamar `markBinariesForCleanup()` para attachment-source binaries.

2. **Registrar nightly cleanup** en el manifest o via scheduled-tasks:
```typescript
// En manifest.ts init():
const { CronJob } = await import('cron')
const cleanupJob = new CronJob('0 3 * * *', async () => { // 3 AM
  const queue = registry.get<EmbeddingQueue>('knowledge:embeddingQueue')
  const result = await queue.runNightlyBinaryCleanup()
  logger.info(result, '[KNOWLEDGE] Nightly binary cleanup done')
})
cleanupJob.start()
```

O alternativamente, usar el módulo `scheduled-tasks` si ya tiene soporte para cron registration.

3. **En `knowledge-manager.ts:addDocument()`**: para source_type='attachment', después de embedding completado, marcar binarios para cleanup. Para source_type='upload' (knowledge), NO marcar — binarios viven mientras exista el doc en KB.

---

## WP6: Metadata propagación al chunker

**Archivo:** `src/modules/knowledge/knowledge-manager.ts` y `item-manager.ts`

### Cambio

Pasar metadata del extractor a los opts del chunker para que se propague a `ChunkMetadata`:

```typescript
// En addDocument():
const result = await extractContent(buffer, fileName, mimeType, this.registry)
const extractorMeta = result.metadata

// Al chunker:
smartChunks = chunkDocs(fullText, {
  sourceFile: fileName,
  sourceType: 'docx',
  sourceMimeType: mimeType,
  // Metadata del extractor disponible para el chunker:
  extractorMetadata: extractorMeta,
})
```

Y en cada chunker, propagar campos relevantes:
- `sourceMimeType` → siempre
- `wordCount` → en chunks de texto
- `durationSeconds` → en chunks de audio/video
- `domain`, `sourceUrl` → en chunks de web
- `videoId` → en chunks de YouTube

**Nota:** Los chunkers ya aceptan `opts` con `sourceFile`. Extender los opts existentes con campos opcionales. No crear un nuevo tipo.

---

## WP7: Actualizar `persistSmartChunks()` para tipos nuevos

**Archivo:** `src/modules/knowledge/item-manager.ts`

### Problema actual
`persistSmartChunks()` recibe `SmartChunk[]` pero los chunkers ahora producen `EmbeddableChunk[]`.

### Verificar
¿Son compatibles `SmartChunk` y `EmbeddableChunk`? Si no, actualizar `persistSmartChunks()` para aceptar `EmbeddableChunk[]` y mapear correctamente a la tabla de chunks (incluyendo `contentType`, `mediaRefs` como JSON, y `ChunkMetadata`).

Si la tabla `knowledge_chunks` no tiene columnas para `content_type`, `media_refs`, y metadata JSON, crear una migración.

---

## WP8: Actualizar `vectorize-worker.ts` para chunks multimodal

**Archivo:** `src/modules/knowledge/vectorize-worker.ts`

### Problema
El worker actual probablemente solo envía texto a Gemini Embedding. Con los nuevos chunks multimodal (`pdf_pages`, `image`, `audio`, `video_frames`), necesita enviar también `mediaRefs`.

### Cambio
Al procesar un chunk:
1. Leer `contentType` del chunk
2. Si es `'text'` o `'csv'`: enviar solo texto a Gemini Embedding (como ahora)
3. Si es `'pdf_pages'`: enviar texto + archivo PDF (páginas del rango) a Gemini Embedding
4. Si es `'image'`: enviar texto + imagen a Gemini Embedding
5. Si es `'audio'`: enviar texto + audio segment a Gemini Embedding
6. Si es `'video_frames'`: enviar texto + video segment a Gemini Embedding

### Referencia
`embedding-service.ts` probablemente necesita un método nuevo o extendido que acepte contenido multimodal. Verificar la API de `@google/generative-ai` para embedContent con multimodal.

---

## Orden de ejecución

```
WP7 (compatibilidad tipos)  ──┐
WP6 (metadata propagación)  ──┤
WP4 (audio contentType)     ──┼── pueden ser paralelos (no se pisan)
                               │
WP1 (router addDocument)    ──┤── depende de WP7 (tipos compatibles)
WP2 (router loadDriveFile)  ──┤
WP3 (slides → PDF export)   ──┘
                               │
WP8 (vectorize multimodal)  ──── depende de WP1-WP4 (chunks nuevos)
WP5 (binary lifecycle)      ──── depende de WP1 (saber cuándo activar)
```

### Recomendación de sub-tracks

- **F1 (fundación):** WP4 + WP6 + WP7 — preparar tipos y chunkers
- **F2 (routers):** WP1 + WP2 + WP3 — conectar extractores al knowledge manager
- **F3 (embedding):** WP8 — vectorize worker multimodal
- **F4 (lifecycle):** WP5 — binary cleanup activation

---

## Riesgos

1. **`SmartChunk` vs `EmbeddableChunk` incompatibilidad**: si las tablas DB no soportan los nuevos campos, necesitamos migración. Investigar primero.
2. **Drive API `exportFile` retorna string**: para exportar Slides como PDF necesitamos buffer. Verificar si existe `exportFileAsBuffer()` o agregar.
3. **Gemini Embedding multimodal**: verificar que `@google/generative-ai` soporta enviar PDF/audio/video para embedding, no solo texto.
4. **Backward compatibility**: uploads existentes en knowledge deben seguir funcionando. Los chunks viejos (sin contentType) deben tratarse como 'text'.
