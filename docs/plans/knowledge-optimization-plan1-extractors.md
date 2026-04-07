# Plan 1: Knowledge ↔ Extractores Globales — Integración Unificada

> **Prerequisito de**: Plan 2 y Plan 3
> **Branch**: `feat/knowledge-extractors-integration` (derivar de `claude/project-planning-session-nrsYJ`)
> **Estimación**: 5 tareas

## Objetivo

Refactorizar el módulo knowledge para que **todos los tipos de contenido** pasen por los extractores globales (`src/extractors/`) durante la carga (`loadContent`). Esto elimina lógica de extracción duplicada, resuelve bugs conocidos (Google Docs body vacío + headings planos), y asegura que el LLM multimedia vea y describa contenido visual (PDF, Slides, DOCX con imágenes).

## Contexto

### Estado actual (problemas)
1. `item-manager.ts` tiene sus propios loaders que NO usan los extractores globales
2. Google Docs: `docs-service.ts` no lee `tabs[].documentTab.body.content` cuando `includeTabsContent: true` → body vacío
3. Google Docs: `extractPlainText()` ignora `paragraphStyle.namedStyleType` (HEADING_1, HEADING_2) → texto plano sin headings → `chunkDocs()` no divide por secciones
4. PDF/Slides/DOCX con imágenes: NUNCA pasan por LLM vision para descripciones visuales
5. Solo Drive files multimedia (imágenes, audio, video) llaman a `enrichWithLLM()`

### Estado deseado
- Todos los loaders usan `extractContent()` + `enrichWithLLM()` de `src/extractors/`
- LLM multimedia describe contenido visual de PDFs, Slides, DOCX con imágenes
- Descripciones LLM quedan disponibles en metadata de chunks (Plan 2 define cómo se integran al embedding)
- Bugs de Google Docs resueltos

## Tareas

### Tarea 1: Fix Google Docs Service — Body extraction + Headings

**Archivos**: `src/modules/google-apps/docs-service.ts`

**Bug 1 — Body vacío con tabs** (líneas ~15-29):
- Cuando `includeTabsContent: true`, Google API no llena `res.data.body`
- Contenido queda en `res.data.tabs[].documentTab.body.content`
- **Fix**: En `getDocument()`, si `res.data.body?.content` está vacío Y `res.data.tabs` existe → iterar tabs y concatenar body.content de cada tab. Preservar info de tabs para el scanner de knowledge.

**Bug 2 — Headings perdidos** (líneas ~150-179):
- `extractPlainText(content)` itera párrafos y solo extrae `textRun.content`
- Ignora `paragraph.paragraphStyle.namedStyleType`
- **Fix**: Verificar `paragraphStyle.namedStyleType` por cada paragraph:
  ```
  TITLE → "# ", HEADING_1 → "# ", HEADING_2 → "## ", HEADING_3 → "### ", SUBTITLE → "## "
  ```
- Esto permite que `chunkDocs()` divida correctamente por secciones

**Validación**: Google Doc con headings → texto con `# H1\n## H2\n`. Google Doc multi-tab → contenido de todos los tabs.

---

### Tarea 2: Refactorizar loaders para usar extractores globales

**Archivo**: `src/modules/knowledge/item-manager.ts`

**Principio**: Cada loader debe:
1. Obtener contenido raw desde la API correspondiente
2. Llamar al extractor global de `src/extractors/`
3. Llamar `enrichWithLLM()` si el resultado es multimodal
4. Pasar resultado enriquecido al smart-chunker

**Por loader**:

| Loader | Estado actual | Cambio necesario |
|--------|--------------|-----------------|
| `loadDocsContent()` | Usa body directo | Depende de fix Tarea 1, sin cambio de chunker |
| `loadPdfContent()` | `PDFParse` directo | Usar `extractPDF()` global + `enrichWithLLM()` |
| `loadSlidesContent()` | Ya usa `extractPDF` | Agregar `enrichWithLLM()` post-extracción |
| `loadWebContent()` | `extractWebBlocks()` propia | Usar `extractWeb()` global, eliminar duplicado |
| `loadSheetsContent()` | Google Sheets API directo | **Mantener** — no hay extractor global para Sheets vía API |
| `loadYoutubeVideo()` | Ya usa `extractVideo()` + `describeVideo()` | **Mantener** — ya conectado |
| `loadDriveFile()` | Parcialmente conectado | Asegurar `enrichWithLLM()` para DOCX, PPTX, PDF en Drive |

---

### Tarea 3: Extender `enrichWithLLM()` para PDFs

**Archivo**: `src/extractors/index.ts`

Actualmente `enrichWithLLM()` no hace nada para tipo `document` (incluye PDF extraído).

**Agregar**: Si el resultado es PDF (`metadata.extractorUsed === 'pdf'`):
- Seleccionar páginas candidatas: `imagePages` marcadas por extractPDF + páginas con < 100 palabras
- Sampling: max 6 páginas distribuidas
- Enviar a LLM vision (task `extractor-pdf-vision`)
- Output: `llmEnrichment.visualDescriptions: Array<{ pageRange: string; description: string }>`

---

### Tarea 4: Propagar descripciones LLM a los chunkers

**Archivos**: `src/modules/knowledge/extractors/smart-chunker.ts`, `src/modules/knowledge/item-manager.ts`

- Agregar campo opcional `llmEnrichment` y `visualDescriptions` a opts de cada chunker
- Almacenar en `chunk.metadata.llmDescription` y `chunk.metadata.visualDescription`
- **Solo propaga la data** — Plan 2 define cómo se integran al content/embedding

---

### Tarea 5: Cleanup — Eliminar código duplicado

- Eliminar `extractWebBlocks()` de item-manager.ts
- Eliminar imports directos de `pdf-parse` (usar `extractPDF()` global)
- Limpiar shim en `src/modules/knowledge/extractors/index.ts` si ya no es necesario

## Archivos afectados

| Archivo | Cambio |
|---------|--------|
| `src/modules/google-apps/docs-service.ts` | Fix body vacío + headings |
| `src/modules/knowledge/item-manager.ts` | Refactorizar loaders, cleanup |
| `src/extractors/index.ts` | Extender enrichWithLLM() para PDF |
| `src/extractors/pdf.ts` | Posible: detección de páginas visuales |
| `src/modules/knowledge/extractors/smart-chunker.ts` | Aceptar llmEnrichment en opts |

## Riesgos y mitigaciones
1. **Performance**: enrichWithLLM para PDFs agrega llamadas LLM → solo para páginas con contenido visual, máx 6
2. **Costos**: Más llamadas Gemini vision → one-time en entrenamiento, no en búsqueda
3. **Google Docs multi-tab**: Testear con docs sin tabs para no romper legacy

## Criterios de éxito
- [ ] Google Doc con headings → chunks divididos por sección
- [ ] Google Doc multi-tab → contenido de todos los tabs
- [ ] PDF con gráficos → descripciones visuales en chunk metadata
- [ ] Slides → descripciones visuales
- [ ] DOCX con imágenes → pasa por enrichWithLLM
- [ ] `extractWebBlocks()` eliminado de item-manager.ts
- [ ] Build limpio: `docker run --rm -v /docker/luna-repo:/app -w /app node:22-alpine npx tsc --noEmit`
