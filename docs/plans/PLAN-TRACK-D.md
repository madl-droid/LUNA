# Track D: Unificación — Slides→PDF + DOCX→PDF

## Archivos a modificar
- `src/extractors/slides.ts` (agregar PPTX extraction + PDF conversion)
- `src/extractors/docx.ts` (router: con imágenes → PDF)
- `src/extractors/index.ts` (routing de PPTX, actualizar MIGRATED_EXTRACTORS)
- `src/modules/knowledge/extractors/smart-chunker.ts` (ajustar chunkSlides para nuevo flujo)

## Prerrequisitos
- **Track A** completado (metadata en extractores)
- **Track B** completado (chunkPdf con 3 páginas)
- **Track C** completado (LibreOffice en Dockerfile + convert-to-pdf.ts)

## IMPORTANTE: Este track NO puede ejecutarse en paralelo con A, B, o C.

---

## WP8: Slides/PPTX → PDF Unificación

### Diseño

Hay 3 fuentes de presentaciones:
1. **Google Slides** (via API) → ya tiene screenshots + texto
2. **PPTX desde Drive** → `drive-read-file` ya lo exporta como PDF
3. **PPTX local** (adjunto directo) → necesita LibreOffice

El objetivo es que TODAS las presentaciones pasen por el pipeline de PDF para embedding multimodal.

### Flujo unificado

```
Google Slides → API screenshots + texto → SlidesResult
  ├→ Para agente: texto + descriptions (ya funciona)
  └→ Para embedding: export PDF via API → chunkPdf()

PPTX de Drive → drive-read-file → PDF buffer → extractPDF → chunkPdf()

PPTX local → LibreOffice → PDF buffer → extractPDF → chunkPdf()
  + extraer speaker notes del XML del PPTX
```

### Cambios en `src/extractors/slides.ts`

Agregar función para extraer PPTX:

```typescript
/**
 * Extrae una presentación PPTX local.
 * 1. Convierte a PDF con LibreOffice (para embedding multimodal)
 * 2. Extrae texto de los slides del XML
 * 3. Extrae speaker notes del XML
 * 4. Retorna SlidesResult con pdfBuffer para el chunker
 */
export async function extractPptx(
  input: Buffer,
  fileName: string,
): Promise<SlidesResult & { pdfBuffer?: Buffer; speakerNotes?: Array<{ slideIndex: number; text: string }> }> {
  const { default: JSZip } = await import('jszip')

  // 1. Extraer texto y notas del XML del PPTX
  const zip = await JSZip.loadAsync(input)
  const slides: ExtractedSlide[] = []
  const speakerNotes: Array<{ slideIndex: number; text: string }> = []

  // Encontrar slides
  let slideIndex = 0
  while (true) {
    const slideXml = await zip.file(`ppt/slides/slide${slideIndex + 1}.xml`)?.async('string')
    if (!slideXml) break

    const text = extractTextFromSlideXml(slideXml)
    const title = extractTitleFromSlideXml(slideXml)

    slides.push({
      index: slideIndex,
      title,
      text,
      screenshotPng: null,  // No tenemos screenshots en PPTX local
    })

    // Speaker notes
    const notesXml = await zip.file(`ppt/notesSlides/notesSlide${slideIndex + 1}.xml`)?.async('string')
    if (notesXml) {
      const noteText = extractTextFromSlideXml(notesXml)
      if (noteText.trim()) {
        speakerNotes.push({ slideIndex, text: noteText.trim() })
      }
    }

    slideIndex++
  }

  // 2. Convertir a PDF con LibreOffice
  let pdfBuffer: Buffer | undefined
  try {
    const { convertToPdf } = await import('./convert-to-pdf.js')
    pdfBuffer = await convertToPdf(input, fileName) ?? undefined
  } catch (err) {
    logger.warn({ err, fileName }, 'PDF conversion failed for PPTX')
  }

  return {
    kind: 'slides',
    fileName,
    slides,
    pdfBuffer,
    speakerNotes,
    metadata: {
      originalName: fileName,
      extractorUsed: 'pptx-xml' + (pdfBuffer ? '+libreoffice-pdf' : ''),
      slideCount: slides.length,
      hasScreenshots: false,
      sizeBytes: input.length,
    },
  }
}

/**
 * Extrae texto plano de un XML de slide PPTX.
 * Busca todos los elementos <a:t> (text runs).
 */
function extractTextFromSlideXml(xml: string): string {
  const textParts: string[] = []
  const regex = /<a:t>([^<]*)<\/a:t>/g
  let match: RegExpExecArray | null
  while ((match = regex.exec(xml)) !== null) {
    if (match[1]) textParts.push(match[1])
  }
  return textParts.join(' ').trim()
}

/**
 * Extrae el título del slide (primer placeholder de tipo title/ctrTitle).
 */
function extractTitleFromSlideXml(xml: string): string | null {
  // Buscar el primer shape que sea título
  const titleMatch = xml.match(/<p:sp>[\s\S]*?<p:nvSpPr>[\s\S]*?(?:type="title"|type="ctrTitle")[\s\S]*?<\/p:nvSpPr>[\s\S]*?<a:t>([^<]*)<\/a:t>/i)
  return titleMatch?.[1]?.trim() ?? null
}
```

### Cambios en `src/extractors/index.ts`

Agregar PPTX a MIGRATED_EXTRACTORS:

```typescript
// En MIGRATED_EXTRACTORS, agregar:
'application/vnd.openxmlformats-officedocument.presentationml.presentation': extractPptxAsContent,
'application/vnd.ms-powerpoint': extractPptxAsContent,

// Nueva función wrapper:
async function extractPptxAsContent(input: Buffer, fileName: string): Promise<ExtractedContent> {
  const { extractPptx } = await import('./slides.js')
  const result = await extractPptx(input, fileName)
  return toExtractedContent(result)
}
```

### Cambios en `smart-chunker.ts`

Agregar función `chunkSlidesAsPdf()`:

```typescript
/**
 * Chunk una presentación que fue convertida a PDF.
 * Usa el pipeline de PDF pero agrega speaker notes como chunks extras.
 */
export function chunkSlidesAsPdf(
  pdfPageTexts: string[],
  pdfFilePath: string,
  totalPages: number,
  speakerNotes: Array<{ slideIndex: number; text: string }>,
  opts?: { sourceFile?: string },
): EmbeddableChunk[] {
  // Chunks del PDF (3 páginas cada uno)
  const pdfChunks = chunkPdf(pdfPageTexts, pdfFilePath, totalPages, {
    sourceFile: opts?.sourceFile,
  })

  // Actualizar sourceType a 'slides' (no 'pdf')
  for (const chunk of pdfChunks) {
    chunk.metadata.sourceType = 'slides'
  }

  // Agregar speaker notes como chunks extras de texto
  for (const note of speakerNotes) {
    if (!note.text.trim()) continue

    pdfChunks.push({
      content: `[Notas del expositor - Slide ${note.slideIndex + 1}]\n${note.text}`,
      contentType: 'text',
      mediaRefs: null,
      chunkIndex: 0, chunkTotal: 0, prevChunkId: null, nextChunkId: null,
      metadata: {
        sourceType: 'slides',
        sourceFile: opts?.sourceFile,
        sectionTitle: `Notas - Slide ${note.slideIndex + 1}`,
        pageRange: String(note.slideIndex + 1),
        isNote: true,
      },
    })
  }

  return pdfChunks
}
```

---

## WP9: DOCX Router — Con Imágenes → PDF

### Diseño

```
DOCX recibido
  ↓
extractDocx() [mammoth - texto + detección de imágenes]
  ├─ Sin imágenes → chunkDocs() [texto puro, ya funciona]
  └─ Con imágenes → convertToPdf() → extractPDF() → chunkPdf()
                     └→ mammoth text se conserva como content de cada chunk
```

### Cambios en `src/extractors/docx.ts`

Agregar función que detecta y convierte:

```typescript
/**
 * Extrae DOCX con router inteligente.
 * Sin imágenes: extracción de texto pura (mammoth).
 * Con imágenes: convierte a PDF para embedding multimodal.
 */
export async function extractDocxSmart(
  input: Buffer,
  fileName: string,
  registry?: Registry,
): Promise<ExtractedContent & { pdfBuffer?: Buffer }> {
  // Paso 1: Siempre extraer texto con mammoth (es el más preciso)
  const textResult = await extractDocx(input, fileName)

  // Paso 2: Si no hay imágenes, retornar texto puro
  if (!textResult.metadata.hasImages) {
    return textResult
  }

  // Paso 3: Tiene imágenes → intentar convertir a PDF
  try {
    const { convertToPdf, isLibreOfficeAvailable } = await import('./convert-to-pdf.js')

    if (!await isLibreOfficeAvailable()) {
      logger.warn({ fileName }, 'DOCX has images but LibreOffice not available — using text-only')
      return textResult
    }

    const pdfBuffer = await convertToPdf(input, fileName)
    if (!pdfBuffer) {
      logger.warn({ fileName }, 'DOCX PDF conversion failed — using text-only')
      return textResult
    }

    logger.info({ fileName, pdfSize: pdfBuffer.length, imageCount: textResult.metadata.imageCount }, 'DOCX with images converted to PDF')

    return {
      ...textResult,
      pdfBuffer,
      metadata: {
        ...textResult.metadata,
        extractorUsed: 'docx-mammoth+libreoffice-pdf',
        pdfSize: pdfBuffer.length,
      },
    }
  } catch (err) {
    logger.warn({ err, fileName }, 'DOCX PDF conversion error — falling back to text-only')
    return textResult
  }
}
```

### Cambios en `src/extractors/index.ts`

Actualizar el extractor de DOCX en MIGRATED_EXTRACTORS:

```typescript
// ANTES:
'application/vnd.openxmlformats-officedocument.wordprocessingml.document': extractDocx,
'application/msword': extractDocx,

// DESPUÉS:
'application/vnd.openxmlformats-officedocument.wordprocessingml.document': extractDocxSmart,
'application/msword': extractDocxSmart,
```

### Integración en Knowledge Manager

Cuando el knowledge manager procesa un DOCX con `pdfBuffer`:
1. Guarda el PDF en `instance/knowledge/media/`
2. Extrae texto por página con `extractPDF(pdfBuffer)`
3. Usa `chunkPdf()` para crear chunks de 3 páginas
4. El `content` de cada chunk es el texto de mammoth (más preciso que OCR)
5. El `mediaRefs` apunta al PDF (para multimodal embedding)

```typescript
// En knowledge-manager.ts o item-manager.ts:
if (docResult.pdfBuffer) {
  // Guardar PDF
  const pdfPath = join(mediaDir, `${docId}_converted.pdf`)
  await writeFile(pdfPath, docResult.pdfBuffer)

  // Extraer página a página para el chunker
  const pdfResult = await extractPDF(docResult.pdfBuffer, fileName)
  const pageTexts = pdfResult.sections.map(s => s.content)

  // Chunk como PDF pero con texto de mammoth
  const chunks = chunkPdf(pageTexts, pdfPath, pdfResult.metadata.pages ?? 1, {
    sourceFile: fileName,
  })

  // Override sourceType
  for (const chunk of chunks) {
    chunk.metadata.sourceType = 'docx'
    chunk.metadata.hasImages = true
  }
} else {
  // Sin imágenes: chunking de texto normal
  const chunks = chunkDocs(docResult.text, { sourceFile: fileName, sourceType: 'docx' })
}
```

---

## Compilación y verificación

```bash
docker run --rm -v /docker/luna-repo:/app -w /app node:22-alpine npx tsc --noEmit
```

## Commit messages sugeridos

```
feat(extractors): PPTX extraction with text, speaker notes, and PDF conversion

feat(extractors): DOCX smart router — images trigger PDF conversion

feat(chunker): slides-as-pdf chunking with speaker notes as extra chunks
```
