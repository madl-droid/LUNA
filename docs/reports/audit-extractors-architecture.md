# AUDITORLA — Extractors Architecture v2

**Branch auditada:** `claude/plan-extractors-architecture-eBWGv`
**Tracks:** A (metadata+LLM dual), B (smart chunker), C (LibreOffice+binary lifecycle), D (PPTX+DOCX router), E (tests)
**Fecha:** 2026-04-06
**Archivos cambiados:** 26 source + 4 test + 5 docs = ~2,742 líneas netas

---

## Resumen ejecutivo

El trabajo cumple con la mayoría de los objetivos de los 5 tracks. La arquitectura dual (code extraction + LLM enrichment), el temporal splitting, y el chunking mejorado están bien implementados. Sin embargo, hay **bugs reales**, **código muerto**, **duplicación**, y **brechas de integración** que deben resolverse antes de considerar esto production-ready.

**Severidad total:** 3 bugs, 5 deudas técnicas serias, 4 duplicaciones/redundancias, 3 brechas de integración.

---

## 1. BUGS

### BUG-1: `imageUrls` en web.ts extrae basura, no URLs reales (ALTO)

**Archivo:** `src/extractors/web.ts:123-126`

```typescript
const imageUrls = sections
  .flatMap(s => s.images ?? [])
  .map(img => img.data.toString('utf-8'))  // img.data es Buffer con URL guardada como string
  .filter(u => u.startsWith('http'))
```

**Problema:** `ExtractedImage.data` es un `Buffer`. En web.ts (linea ~231), las imágenes se guardan como `Buffer.from(src ?? '', 'utf-8')` donde `src` es el atributo `src` del `<img>`. Esto funciona *accidentalmente* para URLs absolutas (`http://...`), pero falla para:
- URLs relativas (`/images/photo.jpg`) — se filtran por el `.startsWith('http')`, así que se pierden silenciosamente
- Data URLs (`data:image/png;base64,...`) — se filtran silenciosamente
- URLs con protocolo relativo (`//cdn.example.com/img.jpg`) — se filtran silenciosamente

**Pero el bug real es conceptual:** Se está abusando del campo `data: Buffer` (diseñado para contenido binario de imagen) como contenedor de URLs. Esto viola la interfaz `ExtractedImage`. Cualquier consumer que intente usar `.data` como imagen binaria recibirá una URL en bytes.

**Fix:** Debería usarse un campo dedicado (ej: `src` o `url` en `ExtractedImage`) o extraer URLs directamente del DOM sin pasar por el pipeline de imágenes.

---

### BUG-2: PDF overlap usa texto de la página *anterior al chunk*, no la última del chunk previo (MEDIO)

**Archivo:** `src/modules/knowledge/extractors/smart-chunker.ts:259-265`

```typescript
if (pageStart > 0 && pageTexts[pageStart - 1]) {
  const prevText = pageTexts[pageStart - 1]!
  overlapPrefix = prevText.slice(-200).trim()
```

Con `MAX_PDF_PAGES_PER_REQUEST=3` y 1-page overlap (`pageStart = pageEnd - 1`):
- Chunk 1: páginas 1-3, `pageStart=0`
- Chunk 2: `pageStart=2`, overlap usa `pageTexts[1]` (página 2)

Esto **es correcto** en este caso porque page 2 es la última del chunk anterior overlapped. Pero si se cambiara el overlap a 0, `pageTexts[pageStart - 1]` usaría la última página del chunk anterior, lo cual sigue siendo correcto.

**Corrección: NO es bug.** Revisado — la lógica es correcta dado que `pageStart = pageEnd - 1` (1-page overlap). El overlap text viene de la página compartida. ~~Descartado~~.

---

### BUG-3: `chunkSlidesAsPdf` — speaker notes chunks tienen `chunkIndex: 0, chunkTotal: 0` (MEDIO)

**Archivo:** `src/modules/knowledge/extractors/smart-chunker.ts:223-237`

```typescript
pdfChunks.push({
  content: `[Notas del expositor - Slide ${note.slideIndex + 1}]\n${note.text}`,
  ...
  chunkIndex: 0, chunkTotal: 0, prevChunkId: null, nextChunkId: null,
```

Los chunks de speaker notes se agregan al array `pdfChunks` pero con `chunkIndex: 0, chunkTotal: 0`. Luego `linkChunks()` sobrescribe estos valores, pero **los notes chunks se mezclan con los PDF chunks en la misma cadena de linking**. Esto significa:

- Un PDF de 10 slides con 3 notas produce: 4 PDF chunks + 3 note chunks = 7 chunks en una sola cadena
- `linkChunks()` asigna `chunkIndex` secuenciales (0-6) y `chunkTotal=7`
- Los notes chunks quedan intercalados en la cadena `prevChunkId/nextChunkId` con los PDF chunks
- Esto rompe la semántica de la cadena: un chunk PDF de páginas 4-6 tiene como `nextChunkId` un chunk de "Notas del slide 1"

**Fix:** Las notas deberían ser una cadena separada, o devolver dos arrays distintos (pdfChunks + noteChunks) para que el caller haga `linkChunks()` por separado.

---

### BUG-4: `isLibreOfficeAvailable()` se cachea en import pero no su resultado (BAJO)

**Archivo:** `src/extractors/convert-to-pdf.ts:64-78`

Cada llamada a `extractDocxSmart()` invoca `isLibreOfficeAvailable()`, que ejecuta `libreoffice --version` cada vez. Para DOCX con imágenes en un batch de 50 archivos, son 50 invocaciones del proceso. No hay cache del resultado.

**Fix:** Cachear el resultado en una variable del módulo (boolean | undefined) ya que LibreOffice no se instala/desinstala en runtime.

---

## 2. DEUDA TECNICA

### DT-1: Código muerto — pg-store binary lifecycle methods nunca se usan (ALTO)

**Archivos:** `src/modules/knowledge/pg-store.ts:1498-1555`

Se añadieron 3 métodos:
- `markBinariesForCleanup()`
- `getDocumentsForBinaryCleanup()`
- `clearBinaryCleanupFlag()`

**Ninguno de estos es llamado desde ningún lugar.** La funcionalidad real de cleanup se implementó directamente en `embedding-queue.ts:runNightlyBinaryCleanup()` con SQL inline duplicado. Estos 3 métodos son código muerto puro.

---

### DT-2: `runNightlyBinaryCleanup()` nunca se invoca (ALTO)

**Archivo:** `src/modules/knowledge/embedding-queue.ts:314-375`

El método existe pero **no hay ningún caller**. Ningún cron job, scheduled task, ni manifest lo invoca. La migración `041_binary-lifecycle.sql` crea la columna y el flag se setea en `reconcileDocumentStatus()`, pero nadie ejecuta el cleanup.

**Resultado:** Los binarios de attachments nunca se limpian. La columna `binary_cleanup_ready` se marca TRUE pero nadie actúa sobre ella.

---

### DT-3: `temporal-splitter.ts` y `splitMediaFile()` nunca se invocan fuera de tests (ALTO)

**Archivo:** `src/modules/knowledge/extractors/temporal-splitter.ts`

`splitMediaFile()` existe y está testeado, pero **no hay caller en producción**. El `chunkAudio()` y `chunkVideo()` en smart-chunker.ts aceptan `segments` como parámetro opcional, pero nadie llama a `splitMediaFile()` para generar esos segmentos y pasarlos.

El knowledge-manager.ts no fue modificado para integrar el temporal splitting. Los segmentos son un parámetro que nadie alimenta.

---

### DT-4: `chunkSlidesAsPdf()` nunca se invoca fuera de tests (MEDIO)

**Archivo:** `src/modules/knowledge/extractors/smart-chunker.ts:201-242`

Mismo patrón: la función existe y se testea, pero no hay integración con knowledge-manager o item-manager para llamarla con el `pdfBuffer` y `speakerNotes` que produce `extractPptx()`.

---

### DT-5: `extractDocxSmart()` retorna `pdfBuffer` pero nadie lo consume (MEDIO)

**Archivo:** `src/extractors/docx.ts:310-353`

`extractDocxSmart()` hace la conversión a PDF y la retorna como `pdfBuffer`, pero el caller en `index.ts:MIGRATED_EXTRACTORS` la usa como `ExtractedContent` — y el tipo de retorno `ExtractedContent & { pdfBuffer?: Buffer }` se pierde porque el mapa de extractores está tipado como `Promise<ExtractedContent>`. El `pdfBuffer` no llega al knowledge pipeline para hacer chunking visual.

---

## 3. DUPLICACION Y REDUNDANCIA

### DUP-1: SQL de binary cleanup duplicado entre pg-store y embedding-queue (ALTO)

La query exacta de `getDocumentsForBinaryCleanup()` (CROSS JOIN LATERAL jsonb_array_elements...) está duplicada:
- `pg-store.ts:1515-1540` — método limpio con tipado
- `embedding-queue.ts:330-348` — SQL inline en `runNightlyBinaryCleanup()`

El embedding-queue debería usar el pg-store method en vez de duplicar el SQL.

---

### DUP-2: Parsing de `[DESCRIPCIÓN]/[RESUMEN]` duplicado 3 veces

El regex para parsear el formato dual está copy-pasted en:
1. `src/extractors/image.ts:200-208` — `describeImage()`
2. `src/extractors/video.ts:138-152` — `describeVideo()`
3. `src/extractors/slides.ts:138-140` — `describeSlideScreenshots()`

Cada uno tiene variaciones sutiles:
- image.ts: `\[DESCRIPCIÓN\]\s*\n([\s\S]*?)(?:\n\[RESUMEN\]\s*\n|$)` — captura hasta RESUMEN o EOF
- video.ts: `\[DESCRIPCIÓN\]\s*\n([\s\S]*?)(?:\n\[RESUMEN\]|\n\[TRANSCRIPCIÓN\]|$)` — también TRANSCRIPCIÓN
- slides.ts: `\[DESCRIPCIÓN\]\s*\n([\s\S]*?)(?:\n\[RESUMEN\]\s*\n|$)` — igual a image pero no captura shortDescription

**Riesgo:** Si se cambia el formato del prompt, hay que actualizar 3 archivos. Debería ser un helper único en `utils.ts` o `index.ts`.

---

### DUP-3: Lógica `wasConverted` es trivial pero se repite

`wasConverted: resolvedMime !== mimeType` se repite en audio.ts y video.ts. Trivial pero innecesario como metadata — el consumer puede comparar `mimeType` vs `format` para determinarlo.

---

### DUP-4: `wordCount` computation copy-pasted

`text.split(/\s+/).filter(Boolean).length` aparece en:
- `text.ts:25` (markdown), `text.ts:88` (plain), `text.ts:128` (json)
- `docx.ts:48`
- `pdf.ts:91`

Debería ser `countWords(text)` en `utils.ts`.

---

## 4. BRECHAS DE INTEGRACION

### GAP-1: No hay integración end-to-end del pipeline dual (CRITICO)

El plan describía un pipeline dual:
- **Pipeline Texto** (chunkDocs) para documentos sin imágenes
- **Pipeline Visual** (chunkPdf 3-page chunks) para documentos con imágenes/scanned

La infraestructura está construida (metadata `hasImages`/`isScanned`, `pdfBuffer`, `chunkPdf()`), pero **no hay router en knowledge-manager.ts que lea esos flags y elija el pipeline correcto**. El knowledge-manager no fue modificado.

Esto significa:
- Un DOCX con imágenes produce un `pdfBuffer`, pero el knowledge-manager sigue usando el pipeline de texto
- Un PDF scanned sigue pasando por el mismo camino que un PDF textual
- `extractPptx()` produce `pdfBuffer` + `speakerNotes`, pero nadie los consume

Todo el trabajo de routing (Tracks A, C, D) **produce datos que nadie consume**.

---

### GAP-2: `csvBuffer` de sheets no se persiste (MEDIO)

**Archivo:** `src/extractors/sheets.ts:214-224`

Track A dice: "generar CSV buffer para storage". El `csvBuffer` se genera correctamente en `extractSheets()`, pero:
- Nadie lo escribe a disco
- Nadie lo pasa al embedding pipeline como binario
- El `SheetsResult.csvBuffer` es opcional, así que callers legacy lo ignoran

---

### GAP-3: Video temporal chunking no puede funcionar sin transcriptSegments (MEDIO)

**Archivo:** `src/modules/knowledge/extractors/smart-chunker.ts:690-705`

`chunkVideo()` hace proportional splitting del transcript (`charStart/charEnd` basado en ratio duración/chars). Pero para video, el extractor `describeVideo()` produce una `description` visual (no una transcripción temporal). El corte proporcional de una descripción visual por timestamps no tiene sentido semántico — cortaría frases a la mitad.

Para audio, el STT produce una transcripción temporal que sí se puede cortar (aunque imperfectamente). Para video, la `[TRANSCRIPCIÓN]` es del audio del video, lo cual sí tiene sentido — pero `[DESCRIPCIÓN]` no.

La lógica de video agrega la descripción solo al primer chunk (`if (i === 0 && opts.description)`), lo cual es correcto. Pero la transcripción se corta proporcionalmente sin timestamps, perdiendo coherencia.

---

## 5. COMPLEJIDAD INNECESARIA

### CX-1: `extractPptxAsContent()` wrapper en index.ts es innecesario

**Archivo:** `src/extractors/index.ts:67-73`

```typescript
async function extractPptxAsContent(input: Buffer, fileName: string): Promise<ExtractedContent> {
  const result = await extractPptx(input, fileName)
  return toExtractedContent(result)
}
```

Este wrapper existe porque `MIGRATED_EXTRACTORS` requiere `Promise<ExtractedContent>`, pero el comment dice "el pdfBuffer se pierde aquí". Si el pdfBuffer se pierde, ¿para qué existe `extractPptx()` con pdfBuffer? Decisión: o se integra el pdfBuffer en el pipeline, o se simplifica `extractPptx()` para no generarlo innecesariamente (ahorra invocación de LibreOffice).

---

### CX-2: `shortDescription` solo se captura para image y video, no para slides ni audio

El campo `LLMEnrichment.shortDescription` se parsea en:
- `image.ts` (describeImage) -> ✅
- `video.ts` (describeVideo) -> ✅
- `slides.ts` (describeSlideScreenshots) -> ❌ el regex captura pero no guarda shortDescription
- Audio no usa formato dual (no tiene prompts de descripción)

Si el plan es usar `shortDescription` en chunks, la captura debería ser consistente.

---

## 6. OBSERVACIONES SOBRE TESTS (Track E)

### Cobertura buena pero artificialmente aislada

Los 104 tests (26+34+18+26) cubren las funciones individualmente pero:
- **0 tests de integración** entre extractores y chunkers
- **0 tests** de `extractDocxSmart()` con images=true (path de LibreOffice)
- **0 tests** de `extractPptx()` speaker notes
- **0 tests** del parsing dual `[DESCRIPCIÓN]/[RESUMEN]` en slides.ts
- **0 tests** de `chunkSlidesAsPdf()` con notas mezcladas con PDF chunks (donde está BUG-3)
- **0 tests** verifican que `imageUrls` en web.ts produce URLs válidas (donde está BUG-1)

### Tests que validan pero no descubren

Los tests de metadata validan que los campos *existen* y son del tipo correcto, pero no validan valores semánticos. Ejemplo: `metadata.wordCount` se verifica como `> 0`, pero nunca se verifica que coincida con el texto real.

---

## 7. IMPACTO EN DOCKER

La adición de `libreoffice-writer libreoffice-impress libreoffice-calc` al Dockerfile incrementa significativamente el tamaño de la imagen (LibreOffice en Alpine agrega ~200-400MB). Esto fue previsto en el plan pero vale notar:
- Solo se usa para DOCX con imágenes y PPTX local
- No hay cache del resultado de `isLibreOfficeAvailable()`
- Si LibreOffice no está instalado (dev local), las features fallan silenciosamente (correcto por diseño)

---

## Resumen por severidad

| # | Tipo | Severidad | Resumen |
|---|------|-----------|---------|
| BUG-1 | Bug | Alto | imageUrls en web.ts abusa de ExtractedImage.data como URL |
| BUG-3 | Bug | Medio | Speaker notes se mezclan con PDF chunks en la cadena de linking |
| BUG-4 | Bug | Bajo | isLibreOfficeAvailable() no cachea resultado |
| DT-1 | Deuda | Alto | 3 métodos de pg-store son código muerto |
| DT-2 | Deuda | Alto | runNightlyBinaryCleanup() nunca se invoca |
| DT-3 | Deuda | Alto | temporal-splitter nunca se invoca en producción |
| DT-4 | Deuda | Medio | chunkSlidesAsPdf() nunca se invoca en producción |
| DT-5 | Deuda | Medio | pdfBuffer de extractDocxSmart() nunca se consume |
| DUP-1 | Duplicación | Alto | SQL de binary cleanup duplicado |
| DUP-2 | Duplicación | Medio | Parsing [DESCRIPCIÓN]/[RESUMEN] duplicado 3 veces |
| DUP-4 | Duplicación | Bajo | wordCount computation copy-pasted |
| GAP-1 | Brecha | Critico | No hay router dual en knowledge-manager |
| GAP-2 | Brecha | Medio | csvBuffer de sheets no se persiste |
| GAP-3 | Brecha | Medio | Video transcript splitting proporcional es semánticamente frágil |
| CX-1 | Complejidad | Bajo | extractPptxAsContent wrapper pierde pdfBuffer |
| CX-2 | Incoherencia | Bajo | shortDescription inconsistente entre extractores |

---

## Veredicto

**El trabajo construye infraestructura sólida pero incompleta.** Las piezas individuales (extractores, chunkers, temporal splitter, binary lifecycle) están bien construidas y testeadas en aislamiento. Pero faltan las conexiones entre ellas:

1. **knowledge-manager.ts no fue modificado** — por lo que el pipeline dual, el temporal splitting, el PPTX PDF pipeline, y el binary cleanup son todos código que existe pero no se ejecuta en producción
2. **El SQL y la lógica de cleanup están duplicados** entre pg-store y embedding-queue
3. **Los tests validan componentes aislados** pero no el flujo completo

La analogía: se construyeron tuberías nuevas de alta calidad y se testearon con presión de agua, pero nunca se conectaron a la casa. El agua sigue fluyendo por las tuberías viejas.

**Recomendación:** Un Track F de integración que conecte knowledge-manager.ts con las nuevas capacidades: router dual por metadata flags, invocación de temporal splitting, consumo de pdfBuffer/speakerNotes, y scheduling del nightly cleanup.
