# Track A: Extractores — Metadata + LLM Dual + Sheets + Web + DOCX Router

## Archivos a modificar
- `src/extractors/text.ts`
- `src/extractors/pdf.ts`
- `src/extractors/image.ts`
- `src/extractors/audio.ts`
- `src/extractors/video.ts`
- `src/extractors/web.ts`
- `src/extractors/youtube.ts`
- `src/extractors/sheets.ts`
- `src/extractors/docx.ts`
- `src/extractors/slides.ts`
- `src/extractors/types.ts` (DocumentMetadata — agregar campos opcionales tipados)

## Prerrequisitos
- Ninguno. Este es el track fundacional.

## Orden de ejecución dentro del track
1. WP1: Metadata en todos los extractores
2. WP5: LLM dual description
3. WP6: Sheets metadata
4. WP7: Web metadata
5. WP9: DOCX router

---

## WP1: Metadata Completa

### Objetivo
Cada extractor debe popular TODOS los campos de metadata relevantes para que los chunkers y el embedding pipeline tengan contexto completo.

### Cambios en `src/extractors/types.ts`
Agregar campos tipados opcionales a `DocumentMetadata`:
```typescript
export interface DocumentMetadata {
  pages?: number
  author?: string
  sizeBytes?: number
  driveModifiedTime?: string
  originalName?: string
  extractorUsed?: string
  isScanned?: boolean
  imagePages?: number[]
  // === AGREGAR ===
  wordCount?: number
  lineCount?: number
  sectionCount?: number
  hasExplicitHeadings?: boolean
  hasImages?: boolean
  imageCount?: number
  format?: string           // 'png', 'mp3', 'mp4', etc.
  durationSeconds?: number
  hasAudio?: boolean
  wasConverted?: boolean
  domain?: string
  title?: string | null
  fetchedAt?: string
  videoId?: string
  duration?: number | null
  hasChapters?: boolean
  chapterCount?: number
  hasTranscript?: boolean
  hasThumbnail?: boolean
  sheetCount?: number
  totalRows?: number
  slideCount?: number
  hasScreenshots?: boolean
  md5?: string
  width?: number
  height?: number
  mimeType?: string
  [key: string]: unknown
}
```

### Cambios por extractor

#### `src/extractors/text.ts`

**extractMarkdown()** (línea 14-27):
```typescript
// ANTES:
metadata: {
  sizeBytes: input.length,
  originalName: fileName,
  extractorUsed: 'markdown',
}

// DESPUÉS:
const hasExplicitHeadings = byHeadings.length > 0  // capturar antes del return
metadata: {
  sizeBytes: input.length,
  originalName: fileName,
  extractorUsed: 'markdown',
  wordCount: text.split(/\s+/).filter(Boolean).length,
  lineCount: text.split('\n').length,
  sectionCount: sections.length,
  hasExplicitHeadings,
}
```

NOTA: splitMarkdown() actualmente no expone si encontró headings explícitos. Hay que modificar la función para que retorne esa info, o capturar el resultado de splitByExplicitHeadings antes de decidir el fallback.

Modificar `splitMarkdown()` (línea 34-45) para retornar también si usó headings explícitos:
```typescript
function splitMarkdown(text: string): { sections: ExtractedSection[]; hasExplicitHeadings: boolean } {
  const byHeadings = splitByExplicitHeadings(text)
  if (byHeadings.length > 0) return { sections: byHeadings, hasExplicitHeadings: true }
  const byImplicit = splitByImplicitTitles(text)
  if (byImplicit.length > 0) return { sections: byImplicit, hasExplicitHeadings: false }
  return { sections: splitByParagraphs(text), hasExplicitHeadings: false }
}
```

Luego en extractMarkdown():
```typescript
const { sections, hasExplicitHeadings } = splitMarkdown(text)
```

**extractPlainText()** (línea 73-86): Mismo patrón. `hasExplicitHeadings: false` siempre (plain text no tiene headings).

**extractJSON()** (línea 102-122): Agregar `wordCount`, `lineCount`, `sectionCount: 1`.

#### `src/extractors/pdf.ts`

**extractPDF()** (línea 80-93):
```typescript
metadata: {
  pages: totalPages,
  author: (infoResult?.info as Record<string, unknown> | undefined)?.Author as string | undefined,
  sizeBytes: input.length,
  originalName: fileName,
  extractorUsed: isScanned ? 'pdf-ocr-vision' : (imagePages.length > 0 ? 'pdf-parse+vision' : 'pdf-parse'),
  isScanned,
  imagePages: imagePages.length > 0 ? imagePages : undefined,
  // AGREGAR:
  wordCount: fullText.split(/\s+/).filter(Boolean).length,
  hasImages: imagePages.length > 0,
  sectionCount: sections.length,
}
```

#### `src/extractors/image.ts`

**extractImage()** (línea 64-80):
```typescript
metadata: {
  sizeBytes: input.length,
  originalName: fileName,
  extractorUsed: 'image-metadata',
  // AGREGAR:
  width: dims?.width ?? 0,
  height: dims?.height ?? 0,
  md5,
  format: resolvedMime.split('/')[1],
  mimeType: resolvedMime,
}
```

#### `src/extractors/audio.ts`

**extractAudio()** (línea 79-97):
```typescript
metadata: {
  sizeBytes: buffer.length,
  originalName: fileName,
  extractorUsed: 'audio-ffprobe',
  // AGREGAR:
  durationSeconds: duration,
  format,
  mimeType: resolvedMime,
  wasConverted: resolvedMime !== mimeType,
}
```

#### `src/extractors/video.ts`

**extractVideo()** (línea 67-86):
```typescript
metadata: {
  sizeBytes: buffer.length,
  originalName: fileName,
  extractorUsed: 'video-ffprobe',
  // AGREGAR:
  durationSeconds: probe.duration,
  format,
  mimeType: resolvedMime,
  hasAudio: probe.hasAudio,
  wasConverted: resolvedMime !== mimeType,
}
```

#### `src/extractors/web.ts`

**extractWeb()** (línea 123-134):
```typescript
metadata: {
  originalName: url,
  extractorUsed: 'web-jsdom',
  sizeBytes: html.length,
  // AGREGAR:
  domain: parsedUrl.hostname,
  title: pageTitle,
  fetchedAt: new Date().toISOString(),
  sectionCount: sections.length,
  imageCount: sections.reduce((sum, s) => sum + (s.images?.length ?? 0), 0),
}
```

#### `src/extractors/youtube.ts`

**extractYouTube()** (línea 155-164):
```typescript
metadata: {
  originalName: input.title,
  extractorUsed: 'youtube',
  // AGREGAR:
  videoId: input.videoId,
  duration: input.duration ?? null,
  hasChapters: !!(chapters && chapters.length >= 2),
  chapterCount: chapters?.length ?? 0,
  sectionCount: sections.length,
  hasTranscript: input.transcript.length > 0,
  hasThumbnail: !!input.thumbnail,
}
```

#### `src/extractors/sheets.ts`

**extractSheets()** (línea 206-225):
```typescript
metadata: {
  sizeBytes: input.length,
  originalName: fileName,
  extractorUsed: isZipSpreadsheet(input) ? 'jszip' : 'csv',
  // AGREGAR:
  sheetCount: sheets.length,
  totalRows: sheets.reduce((sum, s) => sum + s.rows.length, 0),
}
```

#### `src/extractors/docx.ts`

**extractDocx()** (línea 36-46):
```typescript
metadata: {
  sizeBytes: input.length,
  originalName: fileName,
  extractorUsed: 'docx-mammoth',
  // AGREGAR:
  wordCount: text.split(/\s+/).filter(Boolean).length,
  hasImages: images.length > 0,
  imageCount: images.length,
  sectionCount: sections.length,
  hasExplicitHeadings: sections.some(s => s.title !== null),
}
```

#### `src/extractors/slides.ts`

**extractGoogleSlides()** (línea 76-88):
```typescript
metadata: {
  originalName: info.title ?? presentationId,
  extractorUsed: 'google-slides-api',
  // AGREGAR:
  slideCount: slides.length,
  hasScreenshots: slides.some(s => s.screenshotPng !== null),
}
```

---

## WP5: LLM Dual Description

### Objetivo
Cuando se llama al LLM para describir imagen/video/slide, pedir en UNA sola llamada:
1. Descripción detallada → va como `content` del chunk
2. Resumen en 1 línea → va como `metadata.shortDescription`

### Cambios en `src/extractors/types.ts`

Agregar a `LLMEnrichment`:
```typescript
export interface LLMEnrichment {
  description: string
  transcription?: string
  provider: string
  generatedAt: Date
  // AGREGAR:
  shortDescription?: string  // 1 línea, para metadata de chunks
}
```

### Cambios en `src/extractors/image.ts`

**describeImage()** (línea 161-212):

Modificar el prompt del system:
```typescript
// ANTES:
let systemPrompt = 'Eres un asistente que describe imágenes de forma detallada y completa...'

// DESPUÉS:
let systemPrompt = 'Eres un asistente que describe imágenes de forma detallada y completa. Describe TODO el contenido visible: texto, diagramas, tablas, gráficos, logos, personas, objetos, colores, layout. Si hay texto visible, transcríbelo exactamente. Sé exhaustivo y preciso. Responde en español.\n\nFormato de respuesta obligatorio:\n[DESCRIPCIÓN]\n(tu descripción detallada aquí)\n\n[RESUMEN]\n(resumen en máximo 1 línea)'
```

Modificar el parsing de la respuesta (después de obtener `description`):
```typescript
if (description) {
  let longDesc = description
  let shortDesc: string | undefined

  // Parsear formato dual
  const descMatch = description.match(/\[DESCRIPCIÓN\]\s*\n([\s\S]*?)(?:\n\[RESUMEN\]\s*\n|$)/)
  const summaryMatch = description.match(/\[RESUMEN\]\s*\n(.+)/)
  if (descMatch?.[1]) {
    longDesc = descMatch[1].trim()
    shortDesc = summaryMatch?.[1]?.trim()
  }

  const enrichment: LLMEnrichment = {
    description: longDesc,
    shortDescription: shortDesc,
    provider: (result as { provider?: string }).provider ?? 'google',
    generatedAt: new Date(),
  }
  return { ...imageResult, llmEnrichment: enrichment }
}
```

### Cambios en `src/extractors/video.ts`

**describeVideo()** (línea 98-153):

Mismo patrón: agregar al system prompt la instrucción de formato dual. Parsear `[DESCRIPCIÓN]`, `[RESUMEN]`, `[Transcripción]` por separado.

```typescript
const hasAudioInstr = videoResult.hasAudio
  ? '\nEl video tiene audio. Incluye también la transcripción del audio al final, precedida por "[TRANSCRIPCIÓN]:".'
  : ''

system: `Eres un asistente que analiza videos. Describe el contenido visual de forma detallada: escenas, textos visibles, personas, objetos, acciones, transiciones. Sé exhaustivo y preciso. Responde en español.${hasAudioInstr}\n\nFormato de respuesta obligatorio:\n[DESCRIPCIÓN]\n(descripción detallada)\n\n[RESUMEN]\n(resumen en 1 línea)${videoResult.hasAudio ? '\n\n[TRANSCRIPCIÓN]\n(transcripción del audio)' : ''}`
```

### Cambios en `src/extractors/slides.ts`

**describeSlideScreenshots()** (línea 108-159):

Agregar formato dual al prompt por slide:
```typescript
system: 'Eres un asistente que describe diapositivas. Describe el contenido visual: textos, gráficos, diagramas, imágenes, layout y diseño. Sé preciso. Responde en español.\n\nFormato:\n[DESCRIPCIÓN]\n(descripción)\n\n[RESUMEN]\n(1 línea)'
```

Parsear ambos y guardar `shortDescription` en el slide metadata.

### FIX: Quitar temperatura hardcodeada de extractores

En TODOS los extractores que llaman `registry.callHook('llm:chat', ...)`:
- **QUITAR** `temperature: 0.1` de la llamada
- La temperatura la controla el task router (`TASK_TEMPERATURES.media = 0.2` en `task-router.ts:27`)
- Si el extractor pone `temperature`, sobreescribe el router — eso es un bug

Archivos afectados:
- `src/extractors/image.ts` líneas 129, 191 → quitar `temperature: 0.1`
- `src/extractors/audio.ts` línea 127 → quitar `temperature: 0.1`
- `src/extractors/video.ts` línea 120 → quitar `temperature: 0.1`
- `src/extractors/pdf.ts` líneas 214, 314 → quitar `temperature: 0.1`
- `src/extractors/slides.ts` línea 133 → quitar `temperature: 0.1`
- `src/extractors/youtube.ts` línea 197 → quitar `temperature: 0.1`
- `src/extractors/drive.ts` línea 264 → quitar `temperature: 0.1`

VERIFICAR: que el gateway `llm-gateway.ts` use `TASK_TEMPERATURES[task]` cuando el caller no especifica temperature. Si ya lo hace, simplemente quitar el campo.

---

## WP6: Sheets Metadata + Binario CSV

### Objetivo
- Headers siempre presentes en cada chunk (ya funciona en smart-chunker)
- Metadata de hoja incluida en cada chunk
- Guardar el binario como CSV

### Cambios en `src/extractors/sheets.ts`

Ya tiene `sheetCount` y `totalRows` de WP1. Adicionalmente:

En `extractSheets()`, agregar un campo `csvContent` al `SheetsResult`:
```typescript
export interface SheetsResult {
  kind: 'sheets'
  parentId: string
  fileName: string
  sheets: ExtractedSheet[]
  metadata: DocumentMetadata
  // AGREGAR:
  csvBuffer?: Buffer  // CSV serializado para guardar como binario
}
```

Generar el CSV buffer:
```typescript
// Después de parsear sheets, generar CSV
const csvLines: string[] = []
for (const sheet of sheets) {
  csvLines.push(`# Sheet: ${sheet.name}`)
  csvLines.push(sheet.headers.join(','))
  for (const row of sheet.rows) {
    csvLines.push(row.map(cell => cell.includes(',') ? `"${cell}"` : cell).join(','))
  }
  csvLines.push('')
}
const csvBuffer = Buffer.from(csvLines.join('\n'), 'utf-8')

return {
  kind: 'sheets',
  parentId,
  fileName,
  sheets,
  csvBuffer,
  metadata: { ... }
}
```

---

## WP7: Web Metadata + URLs de Imágenes

### Objetivo
- Metadata completa (ya cubierta en WP1: `domain`, `title`, `fetchedAt`, `sectionCount`, `imageCount`)
- URLs de imágenes guardadas en metadata (no descargar binario)

### Cambios en `src/extractors/web.ts`

El extractor web ya guarda imágenes en `ExtractedSection.images[]`. Pero guarda `data: Buffer.from(src)` que es la URL como buffer — diseño raro.

Agregar campo `imageUrls` al `WebResult.metadata`:
```typescript
metadata: {
  ...existingFields,
  // AGREGAR:
  imageUrls: sections
    .flatMap(s => s.images ?? [])
    .map(img => img.data.toString('utf-8'))  // las URLs están como buffer
    .filter(url => url.startsWith('http')),
}
```

---

## WP9: DOCX Router

### Objetivo
- DOCX sin imágenes → mantener como texto (ya funciona)
- DOCX con imágenes → convertir a PDF → pipeline PDF

### Cambios en `src/extractors/docx.ts`

Agregar un flag al resultado para que el consumer sepa si debe convertir:
```typescript
export async function extractDocx(input: Buffer, fileName: string): Promise<ExtractedContent> {
  // ... extracto existente ...
  const images = await extractImages(input)

  // Si tiene imágenes significativas (>0), marcar para conversión PDF
  if (images.length > 0) {
    return {
      text,
      sections,
      metadata: {
        ...metadata,
        needsPdfConversion: true,  // Flag para Track D
      },
    }
  }
  // ... retorno normal ...
}
```

La conversión real a PDF la implementa Track D (WP8/WP-INFRA con LibreOffice). Este track solo marca el flag.

---

## Compilación y verificación

Después de todos los cambios:
```bash
docker run --rm -v /docker/luna-repo:/app -w /app node:22-alpine npx tsc --noEmit
```

## Commit message sugerido
```
feat(extractors): complete metadata + LLM dual description + temperature fix

- Add rich metadata to all extractors (wordCount, format, dimensions, etc.)
- Implement dual LLM description (detailed + 1-line summary) in single call
- Remove hardcoded temperature from extractor calls (use task router)
- Add CSV buffer generation to sheets extractor
- Add image URLs to web extractor metadata
- Add needsPdfConversion flag for DOCX with images
```
