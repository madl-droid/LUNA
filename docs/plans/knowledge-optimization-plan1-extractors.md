# Plan 1: Knowledge ↔ Extractores Globales — Integración Unificada

> **Prerequisito de**: Plan 2 (Embedding Enrichment) y Plan 3 (UI/UX)
> **Branch**: `feat/knowledge-extractors-integration`
> **Derivado de**: `claude/project-planning-session-nrsYJ`

## Objetivo

Refactorizar el módulo knowledge para que **todos los tipos de contenido** pasen por los extractores globales (`src/extractors/`) durante la carga (`loadContent`). Esto elimina la lógica de extracción duplicada en `item-manager.ts`, resuelve bugs conocidos (Google Docs body vacío, headings planos), y asegura que el LLM multimedia vea y describa todo el contenido visual (PDF, Slides, DOCX con imágenes).

## Contexto

### Estado actual (problemas)
1. `item-manager.ts` tiene sus propios loaders (`loadDocsContent`, `loadPdfContent`, etc.) que NO usan los extractores globales
2. Google Docs: `docs-service.ts` no lee `tabs[].documentTab.body.content` cuando `includeTabsContent: true` → body vacío
3. Google Docs: `extractPlainText()` ignora `paragraphStyle.namedStyleType` (HEADING_1, HEADING_2) → texto plano sin headings → `chunkDocs()` no puede dividir por secciones
4. PDF/Slides/DOCX con imágenes: se extraen como texto o PDF binario pero NUNCA pasan por un LLM vision para generar descripciones visuales
5. Solo los Drive files (imágenes, audio, video) llaman a los extractores globales con `enrichWithLLM()`

### Estado deseado
- Todos los loaders llaman a `extractContent()` + `enrichWithLLM()` de `src/extractors/`
- El LLM multimedia describe el contenido visual de PDFs, Slides, DOCX con imágenes
- Las descripciones LLM enriquecen los chunks (el Plan 2 se encarga de cómo exactamente)
- Los bugs de Google Docs quedan resueltos

## Tareas

### Tarea 1: Fix Google Docs Service — Body extraction + Headings

**Archivos**: `src/modules/google-apps/docs-service.ts`

**Bug 1 — Body vacío con tabs** (líneas ~15-29):
- Cuando se llama con `includeTabsContent: true`, Google API no llena `res.data.body`
- El contenido queda en `res.data.tabs[].documentTab.body.content`
- **Fix**: En `getDocument()`, después de obtener la respuesta:
  ```
  Si res.data.body?.content está vacío Y res.data.tabs existe:
    → Iterar tabs, concatenar el body.content de cada tab
    → Retornar como si fuera el body principal
    → Preservar info de tabs para el tab scanner de knowledge
  ```

**Bug 2 — Headings perdidos** (líneas ~150-179):
- `extractPlainText(content)` itera párrafos y solo extrae `textRun.content`
- Ignora `paragraph.paragraphStyle.namedStyleType` (HEADING_1, HEADING_2, etc.)
- **Fix**: Al procesar cada paragraph, verificar `paragraphStyle.namedStyleType`:
  ```
  HEADING_1 → prepend "# "
  HEADING_2 → prepend "## "
  HEADING_3 → prepend "### "
  TITLE → prepend "# "
  SUBTITLE → prepend "## "
  ```
- Esto permite que `chunkDocs()` divida correctamente por secciones

**Tests de validación**:
- Un Google Doc con headings debe producir texto con `# Heading 1\n## Heading 2\n`
- Un Google Doc multi-tab debe producir contenido de todos los tabs

---

### Tarea 2: Refactorizar loaders para usar extractores globales

**Archivo principal**: `src/modules/knowledge/item-manager.ts`

**Principio**: Cada loader debe:
1. Obtener el contenido raw (buffer, texto, etc.) desde la API correspondiente
2. Llamar al extractor global apropiado de `src/extractors/`
3. Llamar a `enrichWithLLM()` si el resultado es multimodal
4. Pasar el resultado enriquecido al smart-chunker
5. El resultado de `enrichWithLLM()` (descriptions, transcriptions) debe estar disponible para el chunker

**Loader por loader**:

#### 2a. `loadDocsContent()` (líneas 580-592)
**Antes**: Llama `docs.getDocument()` → usa body directo → `chunkDocs(body)`
**Después**:
1. Llamar `docs.getDocument()` (ya fixeado en Tarea 1)
2. El texto ya viene con headings Markdown (fix Tarea 1)
3. `chunkDocs(body)` ahora funciona correctamente
4. Sin cambio en chunker, solo depende del fix de Tarea 1
5. Pasar `item.description` como metadata al chunker (esto lo maneja Plan 2)

#### 2b. `loadPdfContent()` (líneas 1090-1126)
**Antes**: Descarga PDF → `PDFParse` para texto → `chunkPdf(pageTexts, filePath, totalPages)`
**Después**:
1. Descargar PDF buffer (sin cambio)
2. Llamar `extractPDF(buffer, fileName, mimeType, registry)` del extractor global
3. Llamar `enrichWithLLM(result, registry)` — esto activa OCR vision para PDFs escaneados y vision para páginas con gráficos
4. El `result.llmEnrichment` contiene descripciones visuales de páginas
5. Guardar buffer a disco (sin cambio)
6. Llamar `chunkPdf(pageTexts, filePath, totalPages, opts)` — pasar las descripciones visuales de `enrichWithLLM` como metadata en `opts.visualDescriptions`
7. **Importante**: `chunkPdf` ya produce chunks con `mediaRefs` al PDF. Las descripciones LLM se agregan como `content` enriquecido o metadata (Plan 2 define la estrategia exacta)

**Nota sobre enrichWithLLM para PDF**:
- Actualmente `enrichWithLLM()` NO hace nada para tipo `document` (PDF extraído como texto)
- **Se necesita agregar** lógica en `src/extractors/index.ts` → `enrichWithLLM()` para que:
  - Si el resultado es PDF (`metadata.extractorUsed === 'pdf'`)
  - Y tiene páginas con pocos caracteres o imágenes (`metadata.imagePages`)
  - → Enviar esas páginas a LLM vision (`extractor-pdf-vision` task)
  - → Agregar descripciones como `llmEnrichment`
- También considerar agregar enrichment para PDFs no-escaneados que puedan tener gráficos/diagramas:
  - Opción: enviar una muestra de páginas (cada 5ta página, max 6) a vision para detectar contenido visual
  - Si se detecta contenido visual, generar descripciones

#### 2c. `loadSlidesContent()` (líneas 594-643)
**Antes**: Export PDF → `extractPDF` para texto → `chunkSlidesAsPdf()`
**Después**:
1. Export PDF (sin cambio)
2. Llamar `extractPDF(pdfBuffer, fileName, 'application/pdf', registry)` (ya lo hace)
3. **Nuevo**: Llamar `enrichWithLLM(result, registry)` con context de que es slides
4. Las descripciones visuales de cada slide/grupo de slides enriquecen los chunks
5. `chunkSlidesAsPdf()` recibe las descripciones como metadata adicional

#### 2d. `loadWebContent()` (líneas 1267-1301)
**Antes**: Usa `extractWebBlocks()` propia (JSDOM + heading parsing)
**Después**:
1. Llamar `extractWeb(url)` del extractor global `src/extractors/web.ts`
2. El extractor global ya tiene: SSRF protection, heading parsing, image extraction, readability fallback
3. Mapear el `WebResult` a los `WebBlock[]` que espera `chunkWeb()`
4. `enrichWithLLM()` NO aplica para web (correcto — security concern)
5. **Eliminar** `extractWebBlocks()` de item-manager.ts (es código duplicado)

#### 2e. `loadSheetsContent()` (líneas 543-578)
**Este loader es especial** — usa la Google Sheets API directamente para leer con OAuth.
**Mantener como está** pero:
1. Verificar que el formato de datos sea compatible con `chunkSheets()`
2. No hay extractor global para Google Sheets vía API (el extractor global es para .xlsx files)
3. El pipeline es correcto: OAuth → read ranges → chunkSheets

#### 2f. `loadYoutubeContent()` / `loadYoutubeVideo()` (líneas 1400-1596)
**Este loader ya usa extractores globales** para video:
- `extractVideo()` + `describeVideo()` para video binario
- `parseYoutubeChapters()` para chapters
**Mantener como está** — ya está bien conectado.

#### 2g. `loadDriveContent()` / `loadDriveFile()` (líneas 645-1087)
**Este es el más complejo** — rutea por MIME type de cada archivo en la carpeta.
**Ya usa extractores globales** para: DOCX, PPTX, PDF, audio, video, imágenes.
**Necesita ajustes**:
1. Para DOCX: asegurar que `enrichWithLLM()` se llame después de `extractDocxSmart()`
2. Para PPTX: asegurar que `enrichWithLLM()` se llame después de `extractPptx()`
3. Para PDF en Drive: asegurar que pase por el mismo flujo enriquecido que `loadPdfContent()`
4. Para Google Docs en Drive: usar el fix de Tarea 1 (headings)
5. Para Google Slides en Drive: usar el mismo flujo que `loadSlidesContent()`

---

### Tarea 3: Extender `enrichWithLLM()` para PDFs y Slides

**Archivo**: `src/extractors/index.ts`

Actualmente `enrichWithLLM()` maneja: image, audio, video, slides (screenshots), youtube, drive.
Para `document` (que incluye PDF extraído) **no hace nada**.

**Agregar**:
```typescript
case 'document':
  // Si es PDF con páginas que tienen imágenes/gráficos
  if (result.metadata?.extractorUsed === 'pdf') {
    // Enviar páginas con pocas palabras o marcadas como imagePages
    // a LLM vision (task: extractor-pdf-vision)
    // Agregar descripciones a llmEnrichment
  }
  break
```

**Estrategia para seleccionar páginas a enviar a vision**:
- Páginas marcadas como `imagePages` (ya detectadas por extractPDF)
- Páginas con < 100 palabras (posibles gráficos/diagramas con poco texto)
- Sampling: max 6 páginas para no exceder límites de API
- Si hay más de 6 páginas candidatas, tomar muestra distribuida

**Output**: `llmEnrichment.visualDescriptions: Array<{ pageRange: string; description: string }>`

---

### Tarea 4: Propagar descripciones LLM a los chunkers

**Archivos**: `src/modules/knowledge/extractors/smart-chunker.ts`, `src/modules/knowledge/item-manager.ts`

Los chunkers (`chunkPdf`, `chunkSlidesAsPdf`, `chunkDocs`, `chunkImage`, `chunkVideo`, `chunkAudio`) necesitan recibir las descripciones generadas por `enrichWithLLM()`.

**Cambios en interfaces de chunkers**:
- Agregar campo opcional `llmEnrichment?: LLMEnrichment` a las opciones de cada chunker
- Agregar campo opcional `visualDescriptions?: Array<{ pageRange: string; description: string }>` para PDFs

**Cómo los chunkers usan las descripciones**:
- **Esta tarea solo propaga la data** — el Plan 2 define exactamente cómo se integran al content/embedding
- Por ahora: almacenar en `chunk.metadata.llmDescription` y `chunk.metadata.visualDescription`
- Esto asegura que la data está disponible para Plan 2 sin cambiar la lógica de embedding aún

---

### Tarea 5: Cleanup — Eliminar código duplicado

**Archivos**: `src/modules/knowledge/item-manager.ts`

Después de refactorizar:
1. Eliminar `extractWebBlocks()` (reemplazada por `extractWeb()` global)
2. Eliminar imports directos de `pdf-parse` en item-manager (usar `extractPDF()` global)
3. Limpiar el shim en `src/modules/knowledge/extractors/index.ts` si ya no es necesario
4. Verificar que no queden imports duplicados

---

## Archivos afectados

| Archivo | Cambio |
|---------|--------|
| `src/modules/google-apps/docs-service.ts` | Fix body vacío + headings |
| `src/modules/knowledge/item-manager.ts` | Refactorizar loaders, eliminar código duplicado |
| `src/extractors/index.ts` | Extender enrichWithLLM() para PDF vision |
| `src/extractors/pdf.ts` | Posible: agregar detección de páginas visuales |
| `src/modules/knowledge/extractors/smart-chunker.ts` | Aceptar llmEnrichment en opts |

## Dependencias externas
- Ninguna nueva — todos los extractores y LLM ya existen

## Riesgos
1. **Performance**: `enrichWithLLM()` para PDFs agrega llamadas LLM. Mitigación: solo para páginas con contenido visual detectado, máx 6 páginas.
2. **Costos**: Más llamadas a Gemini vision. Mitigación: es one-time durante entrenamiento, no en búsqueda.
3. **Google Docs multi-tab**: El fix debe manejar correctamente tabs vs body legacy. Testear con docs sin tabs.

## Criterios de éxito
- [ ] Google Doc con headings produce chunks divididos por sección
- [ ] Google Doc multi-tab produce contenido de todos los tabs
- [ ] PDF con gráficos/diagramas tiene descripciones visuales en metadata de chunks
- [ ] Slides exportados a PDF tienen descripciones visuales
- [ ] DOCX con imágenes pasa por enrichWithLLM y tiene descripciones
- [ ] `extractWebBlocks()` eliminado de item-manager.ts
- [ ] Build sin errores: `docker run --rm -v /docker/luna-repo:/app -w /app node:22-alpine npx tsc --noEmit`
