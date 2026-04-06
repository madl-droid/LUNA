# Track B: Smart Chunker — PDF Fix + Audio/Video Temporal Chunking

## Archivos a modificar
- `src/modules/knowledge/extractors/smart-chunker.ts` (principal)
- `src/modules/knowledge/embedding-limits.ts` (constantes)
- Nuevo: `src/modules/knowledge/extractors/temporal-splitter.ts` (ffmpeg segment helper)

## Prerrequisitos
- ffmpeg disponible en el container (ya está en Dockerfile)
- Track A (WP1) completado para que los chunkers reciban metadata enriquecida

NOTA: Track B puede ejecutarse EN PARALELO con Track A si el ejecutor tiene cuidado de no tocar los mismos archivos. Track A modifica `src/extractors/*.ts`, Track B modifica `src/modules/knowledge/extractors/smart-chunker.ts` — archivos distintos.

## Orden de ejecución dentro del track
1. WP2: PDF 3-page chunking (fix bug de 6 páginas)
2. WP3: Audio temporal chunking (60/70/10)
3. WP4: Video temporal chunking (50/60/10)
4. Propagación de metadata de WP1 en todos los chunkers

---

## WP2: PDF Chunking — 3 páginas max con overlap

### El bug
Actualmente `MAX_PDF_PAGES_PER_REQUEST = 6` en `embedding-limits.ts`. Esto causa que PDFs de más de 6 páginas solo embeden las primeras 6 páginas, porque el embedding de Gemini acepta máximo 6 páginas por request y el chunker crea UN solo chunk de 6 páginas.

### Fix

#### `src/modules/knowledge/embedding-limits.ts`

Cambiar constante:
```typescript
// ANTES:
export const MAX_PDF_PAGES_PER_REQUEST = 6

// DESPUÉS:
export const MAX_PDF_PAGES_PER_REQUEST = 3
```

#### `src/modules/knowledge/extractors/smart-chunker.ts`

**chunkPdf()** (línea 198-237):

El algoritmo actual ya maneja overlap de 1 página y multi-chunk. Solo necesita la constante cambiada.

Verificar que el overlap funciona correctamente:
```typescript
// Ejemplo con 10 páginas y MAX=3, overlap=1:
// Chunk 1: páginas 1-3
// Chunk 2: páginas 3-5 (overlap página 3)
// Chunk 3: páginas 5-7 (overlap página 5)
// Chunk 4: páginas 7-9 (overlap página 7)
// Chunk 5: páginas 9-10
// Total: 5 chunks (todas las páginas cubiertas)
```

Agregar overlap de texto también (no solo de páginas):
```typescript
export function chunkPdf(
  pageTexts: string[],
  pdfFilePath: string,
  totalPages: number,
  opts?: { sourceFile?: string },
): EmbeddableChunk[] {
  const chunks: EmbeddableChunk[] = []
  let pageStart = 0

  while (pageStart < totalPages) {
    const pageEnd = Math.min(pageStart + MAX_PDF_PAGES_PER_REQUEST, totalPages)
    const textForFts = pageTexts.slice(pageStart, pageEnd).join('\n\n')

    // Overlap text: últimos 200 chars de la página anterior (si no es primer chunk)
    let overlapPrefix = ''
    if (pageStart > 0 && pageTexts[pageStart - 1]) {
      const prevText = pageTexts[pageStart - 1]!
      overlapPrefix = prevText.slice(-200).trim()
      if (overlapPrefix) overlapPrefix = `[...] ${overlapPrefix}\n\n`
    }

    chunks.push({
      content: (overlapPrefix + textForFts) || `[PDF páginas ${pageStart + 1}-${pageEnd}]`,
      contentType: 'pdf_pages',
      mediaRefs: [{
        mimeType: 'application/pdf',
        filePath: pdfFilePath,
      }],
      chunkIndex: 0, chunkTotal: 0, prevChunkId: null, nextChunkId: null,
      metadata: {
        sourceType: 'pdf',
        sourceFile: opts?.sourceFile,
        sourceMimeType: 'application/pdf',
        sectionTitle: `Páginas ${pageStart + 1}-${pageEnd}`,
        pageRange: `${pageStart + 1}-${pageEnd}`,
        page_start: pageStart + 1,
        page_end: pageEnd,
        page_total: totalPages,
      },
    })

    if (pageEnd >= totalPages) break
    pageStart = pageEnd - 1  // 1-page overlap
  }

  return chunks
}
```

### Verificación
- Un PDF de 20 páginas debe generar ~8 chunks (no 1 chunk de 6 páginas)
- Cada chunk tiene máximo 3 páginas en mediaRefs
- La página de overlap aparece en 2 chunks consecutivos

---

## WP3: Audio Temporal Chunking (60/70/10)

### Flujo definido
1. Audio entra → STT completo (1 sola llamada, ya funciona)
2. Transcripción se envía al agente (flow existente)
3. En background (knowledge/memory), se parte la transcripción:
   - Primer chunk: primeros 60 segundos
   - Chunks siguientes: 70 segundos con 10 segundos de overlap
4. Cada chunk tiene `timestampStart` y `timestampEnd`
5. El binario se parte con ffmpeg para que cada chunk tenga su segmento de audio

### Nuevo archivo: `src/modules/knowledge/extractors/temporal-splitter.ts`

```typescript
// LUNA — Temporal Splitter
// Parte audio/video en segmentos con ffmpeg.
// Usado por smart-chunker para crear chunks temporales.

import { execFile } from 'node:child_process'
import { writeFile, readFile, unlink, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import pino from 'pino'

const logger = pino({ name: 'temporal-splitter' })

export interface TemporalSegment {
  startSeconds: number
  endSeconds: number
  segmentPath: string  // path al archivo temporal del segmento
}

export interface SplitConfig {
  firstChunkSeconds: number   // 60 para audio, 50 para video
  subsequentSeconds: number   // 70 para audio, 60 para video
  overlapSeconds: number      // 10 para ambos
}

export const AUDIO_SPLIT_CONFIG: SplitConfig = {
  firstChunkSeconds: 60,
  subsequentSeconds: 70,
  overlapSeconds: 10,
}

export const VIDEO_SPLIT_CONFIG: SplitConfig = {
  firstChunkSeconds: 50,
  subsequentSeconds: 60,
  overlapSeconds: 10,
}

/**
 * Calcula los segmentos temporales sin cortar el archivo.
 * Útil para dividir la transcripción por timestamps.
 */
export function calculateSegments(
  totalDurationSeconds: number,
  config: SplitConfig,
): Array<{ startSeconds: number; endSeconds: number }> {
  const segments: Array<{ startSeconds: number; endSeconds: number }> = []

  if (totalDurationSeconds <= 0) return segments

  // Primer chunk
  const firstEnd = Math.min(config.firstChunkSeconds, totalDurationSeconds)
  segments.push({ startSeconds: 0, endSeconds: firstEnd })

  if (firstEnd >= totalDurationSeconds) return segments

  // Chunks subsiguientes con overlap
  let start = firstEnd - config.overlapSeconds
  while (start < totalDurationSeconds) {
    const end = Math.min(start + config.subsequentSeconds, totalDurationSeconds)
    segments.push({ startSeconds: start, endSeconds: end })
    if (end >= totalDurationSeconds) break
    start = end - config.overlapSeconds
  }

  return segments
}

/**
 * Parte un archivo de audio/video en segmentos con ffmpeg.
 * Retorna paths a los archivos temporales de cada segmento.
 * IMPORTANTE: el caller debe limpiar los archivos temporales cuando termine.
 */
export async function splitMediaFile(
  inputBuffer: Buffer,
  mimeType: string,
  totalDurationSeconds: number,
  config: SplitConfig,
): Promise<TemporalSegment[]> {
  const segments = calculateSegments(totalDurationSeconds, config)
  if (segments.length <= 1) return []  // No split needed for single segment

  const ext = mimeToExt(mimeType)
  const tmpDir = join(tmpdir(), `luna-split-${randomUUID()}`)
  await mkdir(tmpDir, { recursive: true })

  const inputPath = join(tmpDir, `input.${ext}`)
  await writeFile(inputPath, inputBuffer)

  const results: TemporalSegment[] = []

  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i]!
    const outputPath = join(tmpDir, `segment_${i}.${ext}`)
    const duration = seg.endSeconds - seg.startSeconds

    try {
      await execPromise('ffmpeg', [
        '-i', inputPath,
        '-ss', String(seg.startSeconds),
        '-t', String(duration),
        '-c', 'copy',  // No re-encode, fast
        '-y',
        outputPath,
      ])

      results.push({
        startSeconds: seg.startSeconds,
        endSeconds: seg.endSeconds,
        segmentPath: outputPath,
      })
    } catch (err) {
      logger.warn({ err, segment: i, start: seg.startSeconds }, 'Failed to split segment')
    }
  }

  // Cleanup input file (segments stay until caller cleans them)
  await unlink(inputPath).catch(() => {})

  return results
}

/**
 * Lee un segment file como Buffer. Caller should unlink after use.
 */
export async function readSegment(segmentPath: string): Promise<Buffer> {
  return readFile(segmentPath)
}

/**
 * Limpia todos los archivos temporales de un split.
 */
export async function cleanupSegments(segments: TemporalSegment[]): Promise<void> {
  await Promise.all(segments.map(s => unlink(s.segmentPath).catch(() => {})))
}

function mimeToExt(mimeType: string): string {
  const map: Record<string, string> = {
    'audio/mpeg': 'mp3', 'audio/wav': 'wav', 'audio/ogg': 'ogg',
    'audio/flac': 'flac', 'audio/aac': 'aac', 'audio/aiff': 'aiff',
    'video/mp4': 'mp4', 'video/quicktime': 'mov', 'video/webm': 'webm',
    'video/x-msvideo': 'avi', 'video/mpeg': 'mpeg',
  }
  return map[mimeType] ?? 'bin'
}

function execPromise(cmd: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { maxBuffer: 10 * 1024 * 1024, timeout: 300_000 }, (err, stdout) => {
      if (err) reject(err)
      else resolve(stdout)
    })
  })
}
```

### Cambios en `smart-chunker.ts` — chunkAudio()

**chunkAudio()** (línea 496-536):

Reescribir para soportar chunking temporal:
```typescript
export function chunkAudio(opts: {
  transcription: string | null
  durationSeconds: number
  mimeType: string
  sourceFile?: string
  sourceUrl?: string
  filePath?: string
  // NUEVO: segmentos pre-calculados con sus paths
  segments?: Array<{ startSeconds: number; endSeconds: number; segmentPath: string }>
  // NUEVO: transcript con timestamps para cortar
  transcriptSegments?: Array<{ text: string; offset: number; duration?: number }>
}): EmbeddableChunk[] {
  if (!opts.transcription) {
    // Sin transcripción: 1 chunk placeholder
    return [{
      content: `[Audio: ${opts.sourceFile ?? 'sin nombre'}, ${Math.round(opts.durationSeconds)}s, sin transcripción]`,
      contentType: 'text',
      mediaRefs: opts.filePath ? [{ mimeType: opts.mimeType, filePath: opts.filePath }] : null,
      chunkIndex: 0, chunkTotal: 1, prevChunkId: null, nextChunkId: null,
      metadata: {
        sourceType: 'audio',
        sourceFile: opts.sourceFile,
        sourceMimeType: opts.mimeType,
        durationSeconds: opts.durationSeconds,
      },
    }]
  }

  // Si no hay segmentos, un solo chunk (backward compatible)
  if (!opts.segments || opts.segments.length === 0) {
    return [{
      content: opts.transcription,
      contentType: 'text',
      mediaRefs: opts.filePath ? [{ mimeType: opts.mimeType, filePath: opts.filePath }] : null,
      chunkIndex: 0, chunkTotal: 1, prevChunkId: null, nextChunkId: null,
      metadata: {
        sourceType: 'audio',
        sourceFile: opts.sourceFile,
        sourceMimeType: opts.mimeType,
        durationSeconds: opts.durationSeconds,
        timestampStart: 0,
        timestampEnd: opts.durationSeconds,
      },
    }]
  }

  // Temporal chunking: 1 chunk por segmento
  const chunks: EmbeddableChunk[] = []

  for (const seg of opts.segments) {
    // Extraer la porción del transcript que corresponde a este segmento
    let segmentText = ''
    if (opts.transcriptSegments) {
      segmentText = opts.transcriptSegments
        .filter(t => t.offset >= seg.startSeconds && t.offset < seg.endSeconds)
        .map(t => t.text)
        .join(' ')
        .trim()
    }

    // Fallback: cortar el transcript completo proporcionalmente
    if (!segmentText && opts.transcription) {
      const ratio = opts.durationSeconds > 0 ? opts.transcription.length / opts.durationSeconds : 0
      const charStart = Math.floor(seg.startSeconds * ratio)
      const charEnd = Math.floor(seg.endSeconds * ratio)
      segmentText = opts.transcription.slice(charStart, charEnd).trim()
    }

    if (!segmentText) segmentText = `[Audio segmento ${seg.startSeconds}s-${seg.endSeconds}s]`

    chunks.push({
      content: segmentText,
      contentType: 'text',
      mediaRefs: seg.segmentPath
        ? [{ mimeType: opts.mimeType, filePath: seg.segmentPath }]
        : null,
      chunkIndex: 0, chunkTotal: 0, prevChunkId: null, nextChunkId: null,
      metadata: {
        sourceType: 'audio',
        sourceFile: opts.sourceFile,
        sourceMimeType: opts.mimeType,
        durationSeconds: seg.endSeconds - seg.startSeconds,
        timestampStart: seg.startSeconds,
        timestampEnd: seg.endSeconds,
        totalDuration: opts.durationSeconds,
      },
    })
  }

  return chunks
}
```

### Integración: quién llama splitMediaFile?

El caller es `knowledge-manager.ts` (o `item-manager.ts`) cuando procesa un audio para knowledge. El flujo:

1. Extractor produce `AudioResult` con `buffer` + `llmEnrichment.transcription`
2. Knowledge manager recibe el resultado
3. Si es knowledge source: llama `splitMediaFile(buffer, mimeType, duration, AUDIO_SPLIT_CONFIG)`
4. Guarda cada segmento en `instance/knowledge/media/`
5. Pasa los segments a `chunkAudio()`
6. Si es attachment source: NO split, un solo chunk (STT → agente → background update)

---

## WP4: Video Temporal Chunking (50/60/10)

### Mismo patrón que audio

**chunkVideo()** (línea 542-576):

Reescribir igual que chunkAudio pero con VIDEO_SPLIT_CONFIG (50/60/10):

```typescript
export function chunkVideo(opts: {
  description: string | null
  transcription: string | null
  durationSeconds: number
  mimeType: string
  sourceFile?: string
  sourceUrl?: string
  filePath?: string
  segments?: Array<{ startSeconds: number; endSeconds: number; segmentPath: string }>
}): EmbeddableChunk[] {
  // Si no hay segmentos, un solo chunk (backward compatible)
  if (!opts.segments || opts.segments.length === 0) {
    const parts: string[] = []
    if (opts.description) parts.push(opts.description)
    if (opts.transcription) parts.push(`[Transcripción]: ${opts.transcription}`)
    const content = parts.length > 0
      ? parts.join('\n\n')
      : `[Video: ${opts.sourceFile ?? 'sin nombre'}, ${Math.round(opts.durationSeconds)}s]`

    return [{
      content,
      contentType: 'text',
      mediaRefs: opts.filePath ? [{ mimeType: opts.mimeType, filePath: opts.filePath }] : null,
      chunkIndex: 0, chunkTotal: 1, prevChunkId: null, nextChunkId: null,
      metadata: {
        sourceType: 'video',
        sourceFile: opts.sourceFile,
        sourceMimeType: opts.mimeType,
        durationSeconds: opts.durationSeconds,
        hasDescription: !!opts.description,
        hasTranscription: !!opts.transcription,
        timestampStart: 0,
        timestampEnd: opts.durationSeconds,
      },
    }]
  }

  // Temporal chunking
  const chunks: EmbeddableChunk[] = []
  const totalSegments = opts.segments.length

  for (let i = 0; i < totalSegments; i++) {
    const seg = opts.segments[i]!

    // Cada chunk de video incluye descripción (si es primer chunk) + transcripción del segmento
    const parts: string[] = []
    if (i === 0 && opts.description) parts.push(opts.description)

    // Cortar transcripción proporcionalmente
    if (opts.transcription) {
      const ratio = opts.durationSeconds > 0 ? opts.transcription.length / opts.durationSeconds : 0
      const charStart = Math.floor(seg.startSeconds * ratio)
      const charEnd = Math.floor(seg.endSeconds * ratio)
      const segTranscript = opts.transcription.slice(charStart, charEnd).trim()
      if (segTranscript) parts.push(`[Transcripción]: ${segTranscript}`)
    }

    const content = parts.length > 0
      ? parts.join('\n\n')
      : `[Video segmento ${seg.startSeconds}s-${seg.endSeconds}s]`

    chunks.push({
      content,
      contentType: 'video_frames',  // Para multimodal embedding
      mediaRefs: seg.segmentPath
        ? [{ mimeType: opts.mimeType, filePath: seg.segmentPath }]
        : null,
      chunkIndex: 0, chunkTotal: 0, prevChunkId: null, nextChunkId: null,
      metadata: {
        sourceType: 'video',
        sourceFile: opts.sourceFile,
        sourceMimeType: opts.mimeType,
        durationSeconds: seg.endSeconds - seg.startSeconds,
        timestampStart: seg.startSeconds,
        timestampEnd: seg.endSeconds,
        totalDuration: opts.durationSeconds,
        hasDescription: i === 0 && !!opts.description,
        hasTranscription: !!opts.transcription,
      },
    })
  }

  return chunks
}
```

---

## Propagación de Metadata WP1 en Chunkers

Una vez que Track A complete WP1, los chunkers necesitan recibir y propagar la metadata enriquecida.

Modificar las interfaces `opts` de cada chunker para aceptar los nuevos campos del extractor:

```typescript
// chunkDocs: agregar wordCount a opts
// chunkSheets: agregar sheetCount, totalRows a opts
// chunkPdf: agregar wordCount, hasImages a opts
// chunkImage: agregar md5, format a opts (ya tiene width/height)
// chunkWeb: agregar domain, title, fetchedAt, imageUrls a opts
// chunkYoutube: agregar videoId, hasChapters, etc. a opts
```

Cada chunker copia estos campos a `ChunkMetadata` para que lleguen al embedding.

---

## Compilación y verificación

```bash
docker run --rm -v /docker/luna-repo:/app -w /app node:22-alpine npx tsc --noEmit
```

## Commit message sugerido
```
feat(chunker): PDF 3-page chunks + audio/video temporal splitting

- Fix: PDF chunks now 3 pages max (was 6, causing missing pages in embedding)
- Add temporal-splitter.ts: ffmpeg-based audio/video segment splitting
- Audio chunking: 60s first, 70s subsequent, 10s overlap
- Video chunking: 50s first, 60s subsequent, 10s overlap
- Add text overlap prefix for PDF chunks (200 chars from previous page)
- Propagate enriched metadata from extractors to chunk metadata
```
