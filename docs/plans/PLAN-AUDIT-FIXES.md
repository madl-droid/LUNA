# PLAN — Audit Fixes: Correcciones de la Auditoría de Extractores v2

## Contexto

Auditoría post-Tracks A-E identificó 3 bugs, 3 duplicaciones, y items menores. Este plan corrige todo lo que NO es responsabilidad del Track F (integración).

---

## FIX-1: BUG-1 (Alto) — `imageUrls` en web.ts abusa `ExtractedImage.data`

**Archivo:** `src/extractors/web.ts` líneas 228-232, 123-126

### Problema
Las imágenes web se guardan como `Buffer.from(src)` (URL como bytes) en `ExtractedImage.data` — viola la interfaz que espera datos binarios. Luego hace `img.data.toString('utf-8')` para recuperar la URL.

### Fix
Agregar campo `url?: string` a `ExtractedImage` y usarlo para URLs en vez de abusar `data`:

**`src/extractors/types.ts`:**
```typescript
export interface ExtractedImage {
  data: Buffer
  mimeType: string
  width?: number
  height?: number
  md5: string
  altText?: string
  url?: string         // NUEVO: URL de origen (web, no descargada)
}
```

**`src/extractors/web.ts` línea ~230:**
```typescript
// ANTES:
images.push({
  data: Buffer.from(src ?? '', 'utf-8'),
  mimeType: 'image/unknown',
  // ...
})

// DESPUÉS:
images.push({
  data: Buffer.alloc(0),         // no tenemos los datos binarios
  mimeType: 'image/unknown',
  url: src ?? undefined,          // guardamos la URL limpiamente
  md5: computeMD5(Buffer.from(src ?? '')),
  width: width || undefined,
  height: height || undefined,
  altText: alt || undefined,
})
```

**`src/extractors/web.ts` líneas ~123-126:**
```typescript
// ANTES:
const imageUrls = sections
  .flatMap(s => s.images ?? [])
  .map(img => img.data.toString('utf-8'))
  .filter(u => u.startsWith('http'))

// DESPUÉS:
const imageUrls = sections
  .flatMap(s => s.images ?? [])
  .map(img => img.url)
  .filter((u): u is string => !!u && u.startsWith('http'))
```

### Impacto
- `ExtractedImage.url` es nuevo y opcional → backward compatible
- Los consumers de web images que lean `.data` ahora obtienen Buffer vacío en vez de URL como Buffer
- Verificar si `chunkWeb()` en smart-chunker usa `img.data` directamente → si sí, actualizar para usar `img.url`

---

## FIX-2: BUG-3 (Medio) — Speaker notes contaminan linking en `chunkSlidesAsPdf()`

**Archivo:** `src/modules/knowledge/extractors/smart-chunker.ts` función `chunkSlidesAsPdf()`

### Problema
Los speaker notes se pushean al array `pdfChunks` antes de `linkChunks()`. Cuando `linkChunks()` corre, conecta note chunks con prev/next de los PDF chunks, rompiendo la cadena semántica:
```
PDF[0] → PDF[1] → PDF[2] → Note[slide1] → Note[slide2]   ← INCORRECTO
```

### Fix
Retornar notes como array separado, o agregar notes DESPUÉS de linking:

```typescript
export function chunkSlidesAsPdf(
  pdfPageTexts: string[],
  pdfFilePath: string,
  totalPages: number,
  speakerNotes: Array<{ slideIndex: number; text: string }>,
  opts?: { sourceFile?: string },
): EmbeddableChunk[] {
  // Chunks visuales del PDF
  const pdfChunks = chunkPdf(pdfPageTexts, pdfFilePath, totalPages, {
    sourceFile: opts?.sourceFile,
  })

  // Actualizar sourceType
  for (const chunk of pdfChunks) {
    chunk.metadata.sourceType = 'slides'
  }

  // Speaker notes como chunks separados — NO mezclar con pdfChunks antes de linking
  const noteChunks: EmbeddableChunk[] = []
  for (const note of speakerNotes) {
    if (!note.text.trim()) continue
    noteChunks.push({
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

  // Retornar PDF chunks primero, notes después
  // El caller debe hacer linkChunks() SOLO sobre pdfChunks, no sobre notes
  // Marcar notes para que linkChunks las ignore
  for (const note of noteChunks) {
    (note.metadata as any)._skipLinking = true
  }

  return [...pdfChunks, ...noteChunks]
}
```

**Alternativa más limpia:** Modificar `linkChunks()` para respetar `isNote: true` y no incluir esos chunks en la cadena prev/next. O retornar `{ pdfChunks, noteChunks }` y dejar que el caller linkee solo los PDF.

**Decisión recomendada:** Cambiar la firma a retornar `{ visualChunks: EmbeddableChunk[], noteChunks: EmbeddableChunk[] }` y que el caller haga linking solo sobre `visualChunks`, luego concatene ambos para persistir. Esto es más explícito.

---

## FIX-3: Eliminar `extractImageWithVision()` legacy (item 5.1)

**Archivo:** `src/extractors/image.ts`

### Problema
`extractImageWithVision()` es una función legacy que hace extracción de imagen con LLM pero sin formato dual `[DESCRIPCIÓN]/[RESUMEN]`. La función `describeImage()` ya la reemplaza completamente.

### Verificar primero
Buscar todos los callers de `extractImageWithVision`:
```bash
grep -r "extractImageWithVision" src/ --include="*.ts"
```

### Fix
1. Si no hay callers fuera de los exports: eliminar la función de `image.ts`
2. Remover el export de `index.ts`
3. Si hay callers: reemplazar por `describeImage()` + adaptación de parámetros

---

## FIX-4: Agregar ODP a `MIGRATED_EXTRACTORS` (item 5.2)

**Archivo:** `src/extractors/index.ts`

### Cambio
```typescript
// En MIGRATED_EXTRACTORS, agregar:
'application/vnd.oasis.opendocument.presentation': extractPptxAsContent,
```

ODP es el formato de presentaciones de LibreOffice (`.odp`). LibreOffice ya está instalado y `extractPptx()` usa JSZip + LibreOffice → funciona con ODP porque LibreOffice convierte cualquier formato de presentación a PDF.

**Nota:** Verificar que JSZip pueda abrir un `.odp` (también es ZIP). Si la estructura XML es diferente (ODP usa `content.xml` no `ppt/slides/`), puede que `extractPptx()` no extraiga texto correctamente del XML, pero la conversión a PDF via LibreOffice sí funcionará. El texto del PDF se extrae con pdf-parse.

Si el XML parsing falla para ODP, el fallback es que `slides` queda vacío pero `pdfBuffer` se genera correctamente → el chunker visual funciona.

---

## FIX-5: Test `hasExplicitHeadings=false` (item 5.3)

**Archivo:** `tests/extractors/metadata.test.ts`

### Test a agregar

```typescript
it('extractMarkdown — sin headings explícitos retorna hasExplicitHeadings=false', () => {
  const md = 'Este es un párrafo de texto.\nOtro párrafo más largo aquí.\nTercer párrafo con más contenido.'
  const result = extractMarkdown(Buffer.from(md), 'plain.md')
  expect(result.metadata.hasExplicitHeadings).toBe(false)
})

it('extractPlainText — siempre hasExplicitHeadings=false', () => {
  const txt = '## Esto parece heading pero es plain text\nContenido normal aquí.'
  const result = extractPlainText(Buffer.from(txt), 'file.txt')
  expect(result.metadata.hasExplicitHeadings).toBe(false)
})
```

---

## FIX-6: DUP-1 — Unificar parsing `[DESCRIPCIÓN]/[RESUMEN]`

**Archivos afectados:** `src/extractors/image.ts`, `src/extractors/video.ts`, `src/extractors/slides.ts`

### Problema
El parsing de formato dual está copy-pasted 3 veces con variaciones sutiles:
- `image.ts`: `\[DESCRIPCIÓN\]\s*\n([\s\S]*?)(?:\n\[RESUMEN\]\s*\n|$)` — requiere `\n` antes de `[RESUMEN]`
- `video.ts`: `\[DESCRIPCIÓN\]\s*\n([\s\S]*?)(?:\n\[RESUMEN\]|\n\[TRANSCRIPCIÓN\]|$)` — 3 secciones
- `slides.ts`: parsing inline (sin regex visible en el código actual, probablemente usa raw text)

### Fix
Crear helper en `src/extractors/utils.ts`:

```typescript
export interface DualDescriptionResult {
  description: string
  shortDescription?: string
  transcription?: string
}

/**
 * Parsea el formato dual/triple [DESCRIPCIÓN]/[RESUMEN]/[TRANSCRIPCIÓN].
 * Fallback: si no hay formato, el texto completo va a description.
 */
export function parseDualDescription(rawText: string): DualDescriptionResult {
  const descMatch = rawText.match(/\[DESCRIPCIÓN\]\s*\n([\s\S]*?)(?:\n\s*\[RESUMEN\]|\n\s*\[TRANSCRIPCIÓN\]|$)/)
  const summaryMatch = rawText.match(/\[RESUMEN\]\s*\n([\s\S]*?)(?:\n\s*\[TRANSCRIPCIÓN\]|$)/)
  const transcriptionMatch = rawText.match(/\[TRANSCRIPCIÓN\]\s*\n([\s\S]*)$/)

  if (!descMatch?.[1]) {
    // LLM no siguió el formato — fallback
    return { description: rawText.trim() }
  }

  return {
    description: descMatch[1].trim(),
    shortDescription: summaryMatch?.[1]?.trim() || undefined,
    transcription: transcriptionMatch?.[1]?.trim() || undefined,
  }
}
```

Luego reemplazar las 3 implementaciones locales con:
```typescript
import { parseDualDescription } from './utils.js'

const parsed = parseDualDescription(rawText)
// usar parsed.description, parsed.shortDescription, parsed.transcription
```

---

## FIX-7: DUP-2 — Unificar `wordCount` computation

**Archivos afectados:** `src/extractors/text.ts` (×3), `src/extractors/pdf.ts` (×1), `src/extractors/docx.ts` (×1)

### Problema
`text.split(/\s+/).filter(Boolean).length` repetido 5 veces.

### Fix
Agregar a `src/extractors/utils.ts`:

```typescript
/** Cuenta palabras en texto (split por whitespace, filtra vacíos) */
export function countWords(text: string): number {
  return text.split(/\s+/).filter(Boolean).length
}
```

Reemplazar las 5 ocurrencias:
```typescript
import { countWords } from './utils.js'

// ANTES: wordCount: text.split(/\s+/).filter(Boolean).length,
// DESPUÉS: wordCount: countWords(text),
```

---

## FIX-8: DUP-3 — SQL binary cleanup duplicado

**Archivos:** `src/modules/knowledge/pg-store.ts`, `src/modules/knowledge/embedding-queue.ts`

### Verificar
Determinar si hay queries SQL de binary cleanup duplicadas entre los dos archivos. Si sí:
- Centralizar en `pg-store.ts` (source of truth para DB queries)
- `embedding-queue.ts` llama a `pgStore.methodName()` en vez de tener su propio SQL

---

## Orden de ejecución

No hay dependencias fuertes. Pueden ejecutarse en paralelo:

```
FIX-1 (web imageUrls)         — independiente
FIX-2 (slides linking)        — independiente
FIX-3 (remove legacy)         — independiente (verificar callers primero)
FIX-4 (ODP support)           — independiente
FIX-5 (test)                  — independiente
FIX-6 (dual description DRY)  — independiente
FIX-7 (wordCount DRY)         — independiente
FIX-8 (SQL DRY)               — independiente
```

### Recomendación
Un solo executor puede hacer todos los fixes en un branch. Son cambios quirúrgicos y localizados.

---

## Riesgos

1. **FIX-1 (web images):** `chunkWeb()` en smart-chunker puede usar `img.data` directamente para base64 → necesita actualizarse para web images que ahora tienen `data: Buffer.alloc(0)` y `url` en su lugar.
2. **FIX-2 (slides linking):** Cambio de firma de `chunkSlidesAsPdf` → actualizar callers (actualmente solo item-manager, que aún no lo usa — pero Track F lo usará).
3. **FIX-3 (remove legacy):** Si algún consumer externo usa `extractImageWithVision`, rompe. Grep exhaustivo obligatorio.
4. **FIX-4 (ODP):** Si el XML de ODP no es compatible con el parser de PPTX, el texto queda vacío pero el PDF funciona. Aceptable.
