# Plan 3: Knowledge UI/UX + Cleanup

> **Depende de**: Plan 1 (Extractores Globales)
> **Paralelo con**: Plan 2 (Embedding Enrichment)
> **Branch**: `feat/knowledge-ui-ux`
> **Derivado de**: `claude/project-planning-session-nrsYJ` (después de merge Plan 1)

## Objetivo

Corregir bugs de la UI del knowledge, mejorar la UX del wizard, alinear la UI con los extractores nuevos, y hacer cleanup general. No incluye cambios de backend en embedding/search (eso es Plan 2).

## Contexto

### Estado actual (problemas)
1. Bug del wizard: `wizState.itemId` puede quedar `undefined` si la respuesta del POST no coincide con el patrón esperado → scan-tabs falla con 400
2. Detección de sourceType por substring del URL (`.pdf`, `presentation/d/`) en vez de usar el `sourceType` que el servidor ya resuelve
3. No hay indicación visual del tipo de procesamiento que recibirá el contenido (TEXT vs VISUAL vs multimedia)
4. El wizard salta el scanner para PDF/Slides/Web pero no muestra feedback de qué pasará con el contenido
5. No hay forma de ver el estado de los chunks o qué tipo de contenido se extrajo
6. `fullVideoEmbed` tiene referencias en UI que son dead code (si las hay)

### Estado deseado
- Wizard robusto que siempre asigna correctamente el itemId
- Detección de tipo por respuesta del servidor
- Indicadores visuales de tipo de procesamiento
- UI limpia sin dead code

## Tareas

### Tarea 1: Fix wizard `wizState.itemId` assignment

**Archivo**: `src/modules/knowledge/console-section.ts` (líneas 773-790)

**Bug**: La cadena de extracción `r.item?.id || r.item?.item?.id || r.id` es frágil. Si la estructura de respuesta cambia, `wizState.itemId` queda `undefined`.

**Fix**: Primero verificar qué devuelve exactamente el endpoint POST `/items`:

En `manifest.ts`, buscar el handler del POST que crea items. Verificar la estructura exacta de respuesta.

**Implementación robusta**:
```javascript
// Después del POST create (línea 783)
function extractItemId(r) {
  if (r.item && typeof r.item === 'object') {
    if (r.item.id) return r.item.id;
    if (r.item.item && r.item.item.id) return r.item.item.id;
  }
  if (r.id) return r.id;
  return null;
}
wizState.itemId = extractItemId(r);
```

**Además**: Agregar log del response completo para debugging futuro:
```javascript
console.log('CREATE response structure:', Object.keys(r), r.item ? Object.keys(r.item) : 'no item key');
```

**Verificar**: El endpoint POST en manifest.ts — confirmar que siempre devuelve `{ item: { id: '...' } }` y sincronizar la extracción.

---

### Tarea 2: Detección de sourceType por respuesta del servidor

**Archivo**: `src/modules/knowledge/console-section.ts` (líneas 721-727)

**Antes**: Detección por substring del URL:
```javascript
var skipScanner = lUrl.indexOf('.pdf') !== -1 || url.indexOf('presentation/d/') !== -1;
```

**Después**: Usar el `sourceType` que devuelve el endpoint `/verify-url` o el POST de creación.

**Cambios**:

1. En el flujo de creación (líneas 764-814), el endpoint `/verify-url` ya se llama antes del create. Su respuesta incluye info del tipo de recurso.

**Modificar el flujo**:
```javascript
// verify-url response:
api('/verify-url', 'POST', { sourceUrl: url })
  .then(function(v) {
    if (v.accessible === false) { ... }
    // NUEVO: guardar sourceType del servidor
    wizState.sourceType = v.sourceType || null;  // 'sheets', 'docs', 'slides', 'drive', 'pdf', 'youtube', 'web'
    
    // Decidir skip basado en sourceType del servidor
    var typesThatSkipScanner = ['pdf', 'web', 'slides'];
    wizState.skipScanner = wizState.sourceType 
      ? typesThatSkipScanner.includes(wizState.sourceType)
      : skipScanner;  // fallback a detección por URL si servidor no retorna tipo
    
    return api('', 'POST', { ... });
  })
```

2. **Verificar** que `/verify-url` retorne `sourceType`. Si no lo hace, agregar ese campo al handler en manifest.ts:
   - El handler ya llama a `extractGoogleId(url)` que retorna `{ id, type }` — solo necesita incluir `type` en la respuesta.

---

### Tarea 3: Indicador de tipo de procesamiento

**Archivo**: `src/modules/knowledge/console-section.ts`

**En la lista de items** (cada row), agregar un tooltip o badge que indique el pipeline:

| sourceType | Pipeline | Badge |
|------------|----------|-------|
| sheets | TEXT (CSV) | `📊 CSV` |
| docs | TEXT (Markdown) | `📝 Texto` |
| slides | VISUAL (PDF) | `🖼 Visual` |
| drive | MIXTO (por archivo) | `📁 Drive` |
| pdf | VISUAL (PDF) | `🖼 Visual` |
| youtube | MULTIMEDIA | `🎥 Video` |
| web | TEXT (HTML) | `🌐 Web` |

**Implementación**: En `renderItemCard()`, agregar un span con clase después del badge de tipo:
```html
<span class="ki-pipeline-badge ki-pipeline-${pipelineType}">${pipelineLabel}</span>
```

**CSS**: Agregar estilos mínimos en `components.css`:
```css
.ki-pipeline-badge {
  font-size: 10px;
  padding: 1px 5px;
  border-radius: 3px;
  opacity: 0.7;
  margin-left: 4px;
}
```

---

### Tarea 4: Mejoras del wizard — feedback post-creación

**Archivo**: `src/modules/knowledge/console-section.ts`

Cuando el wizard skipea el scanner (PDF, Web, Slides), actualmente cierra el wizard y recarga la página. El usuario no tiene feedback de qué pasará.

**Mejora**: Antes de cerrar, mostrar un toast informativo:
```javascript
if (skipScanner) {
  var pipelineMsg = {
    pdf: '${isEs ? "PDF creado. Al entrenar, se procesará con análisis visual de páginas." : "PDF created. Training will use visual page analysis."}',
    web: '${isEs ? "Web creada. Al entrenar, se extraerá el contenido de la página." : "Web created. Training will extract page content."}',
    slides: '${isEs ? "Presentación creada. Al entrenar, se exportará como PDF visual." : "Presentation created. Training will export as visual PDF."}',
    youtube: '${isEs ? "YouTube creado. Al entrenar, se procesará video + transcripción." : "YouTube created. Training will process video + transcription."}',
  };
  toast(pipelineMsg[wizState.sourceType] || '${isEs ? "Conocimiento creado" : "Knowledge created"}');
  kiCloseWizard();
  location.reload();
  return;
}
```

---

### Tarea 5: Mostrar info de chunks en la UI

**Archivo**: `src/modules/knowledge/console-section.ts`

En cada row de item, si el item está entrenado (`embeddingStatus === 'embedded'`), mostrar info básica:

```html
<span class="ki-chunk-info">${chunkCount} fragmentos</span>
```

**Datos disponibles**: `item.chunkCount` ya existe en la respuesta del GET `/items`.

**Ubicación**: Debajo del status badge, en font-size pequeño y color gris.

---

### Tarea 6: Cleanup de dead code

**Archivos**: Varios

1. **`fullVideoEmbed` en UI**: Buscar en `console-section.ts` y eliminar cualquier referencia
2. **Verificar** que `liveQueryEnabled` NO tenga toggle en UI (confirmar que no está en console.fields ni en console-section.ts)
3. **Verificar** que el handler del POST `/items/verify-url` sea robusto:
   - Si la URL no es reconocida, retornar `{ accessible: true, sourceType: 'web' }` como fallback
   - No fallar silenciosamente

---

## Archivos afectados

| Archivo | Cambio |
|---------|--------|
| `src/modules/knowledge/console-section.ts` | Wizard fix, sourceType detection, pipeline badges, chunk info, toasts, cleanup |
| `src/modules/knowledge/manifest.ts` | Posible: agregar sourceType a verify-url response |
| `src/modules/console/ui/styles/components.css` | Pipeline badge styles |

## Dependencias
- Plan 1 para que los sourceTypes y pipelines sean consistentes
- No depende de Plan 2

## Riesgos
1. **SSR template es monolítico** (1265 líneas). Cambios deben ser quirúrgicos para no romper funcionalidad existente.
2. **Client-side JS embebido**: Sin framework, sin type-checking. Testear manualmente en browser.

## Criterios de éxito
- [ ] Wizard: crear un Sheet nuevo → scan-tabs funciona sin error 400
- [ ] Wizard: crear un PDF → toast informa "se procesará con análisis visual"
- [ ] Lista: cada item muestra badge de pipeline (Visual, Texto, Video, etc.)
- [ ] Lista: items entrenados muestran conteo de fragmentos
- [ ] `fullVideoEmbed` no aparece en console-section.ts
- [ ] `liveQueryEnabled` no tiene toggle en UI
- [ ] Build sin errores
