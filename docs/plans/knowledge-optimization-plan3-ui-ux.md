# Plan 3: Knowledge UI/UX + Cleanup

> **Depende de**: Plan 1 (Extractores Globales)
> **Paralelo con**: Plan 2 (Deep Knowledge)
> **Branch**: `feat/knowledge-ui-ux` (derivar de `claude/project-planning-session-nrsYJ`, después de merge Plan 1)
> **Estimación**: 6 tareas

## Objetivo

Corregir bugs de la UI del knowledge, mejorar UX del wizard, alinear la UI con los extractores nuevos, y hacer cleanup. No incluye cambios de backend en embedding/search (eso es Plan 2).

## Contexto

### Estado actual (problemas)
1. Bug del wizard: `wizState.itemId` puede quedar `undefined` → scan-tabs falla con 400
2. Detección de sourceType por substring URL en vez del `sourceType` del servidor
3. No hay indicación visual del tipo de procesamiento (TEXT vs VISUAL vs multimedia)
4. Wizard salta scanner para PDF/Slides/Web sin feedback de qué pasará
5. No se muestra conteo de chunks en items entrenados
6. Posible dead code de `fullVideoEmbed` en UI (Plan 2 limpia backend, aquí limpiamos UI)

## Tareas

### Tarea 1: Fix wizard `wizState.itemId` assignment

**Archivo**: `src/modules/knowledge/console-section.ts` (líneas 773-790)

**Bug**: Cadena `r.item?.id || r.item?.item?.id || r.id` es frágil.

**Fix**:
1. **Verificar** qué devuelve exactamente el handler POST `/items` en manifest.ts
2. Sincronizar la extracción con la estructura real de respuesta
3. Implementar función robusta:
```javascript
function extractItemId(r) {
  if (r.item && typeof r.item === 'object') {
    if (r.item.id) return r.item.id;
    if (r.item.item && r.item.item.id) return r.item.item.id;
  }
  if (r.id) return r.id;
  return null;
}
```
4. Agregar log de estructura para debugging futuro

---

### Tarea 2: Detección de sourceType por respuesta del servidor

**Archivo**: `src/modules/knowledge/console-section.ts` (líneas 721-727), `src/modules/knowledge/manifest.ts`

**Antes**: Detección por substring: `lUrl.indexOf('.pdf') !== -1`

**Después**: Usar `sourceType` del endpoint `/verify-url`.

**Cambios**:
1. Verificar que `/verify-url` retorne `sourceType`. El handler ya llama a `extractGoogleId(url)` que retorna `{ id, type }` — agregar `type` a la respuesta si no está.
2. En el flujo del wizard:
```javascript
api('/verify-url', 'POST', { sourceUrl: url }).then(function(v) {
  wizState.sourceType = v.sourceType || null;
  var typesThatSkipScanner = ['pdf', 'web', 'slides'];
  wizState.skipScanner = wizState.sourceType
    ? typesThatSkipScanner.includes(wizState.sourceType)
    : skipScanner;  // fallback a URL si servidor no retorna tipo
  // ... continuar con create
})
```

---

### Tarea 3: Indicador de tipo de procesamiento (pipeline badge)

**Archivos**: `src/modules/knowledge/console-section.ts`, `src/modules/console/ui/styles/components.css`

En cada row de la lista, agregar badge de pipeline:

| sourceType | Badge | Color sugerido |
|------------|-------|----------------|
| sheets | `CSV` | verde |
| docs | `Texto` | azul |
| slides | `Visual` | morado |
| drive | `Drive` | gris |
| pdf | `Visual` | morado |
| youtube | `Video` | rojo |
| web | `Web` | gris |

Implementación: span con clase `ki-pipeline-badge` después del badge de tipo existente.

CSS minimal:
```css
.ki-pipeline-badge { font-size: 10px; padding: 1px 5px; border-radius: 3px; opacity: 0.7; margin-left: 4px; }
```

---

### Tarea 4: Feedback post-creación para tipos sin scanner

**Archivo**: `src/modules/knowledge/console-section.ts`

Cuando wizard skipea el scanner (PDF, Web, Slides), mostrar toast informativo antes de cerrar:

```javascript
var pipelineMsg = {
  pdf: 'PDF creado. Al entrenar, se procesará con análisis visual de páginas.',
  web: 'Web creada. Al entrenar, se extraerá el contenido de la página.',
  slides: 'Presentación creada. Al entrenar, se exportará como PDF visual.',
  youtube: 'YouTube creado. Al entrenar, se procesará video + transcripción.',
};
toast(pipelineMsg[wizState.sourceType] || 'Conocimiento creado');
```

Incluir versión en inglés usando el pattern de `isEs` existente.

---

### Tarea 5: Mostrar conteo de chunks en items entrenados

**Archivo**: `src/modules/knowledge/console-section.ts`

En cada row, si `embeddingStatus === 'embedded'`, mostrar:
```html
<span class="ki-chunk-info">{chunkCount} fragmentos</span>
```

Datos disponibles: `item.chunkCount` ya existe en la respuesta del GET `/items`.

Ubicación: debajo del status badge, font-size 11px, color gris.

---

### Tarea 6: Cleanup de dead code en UI

1. Buscar `fullVideoEmbed` y `full_video_embed` en `console-section.ts` y eliminar
2. Confirmar que `liveQueryEnabled` NO tiene toggle en UI (correcto — es sistema, no admin)
3. Verificar handler POST `/items/verify-url` es robusto: si URL no reconocida → `{ accessible: true, sourceType: 'web' }` como fallback

## Archivos afectados

| Archivo | Cambio |
|---------|--------|
| `src/modules/knowledge/console-section.ts` | Wizard fix, sourceType detection, badges, toasts, chunk count, cleanup |
| `src/modules/knowledge/manifest.ts` | Posible: agregar sourceType a verify-url response |
| `src/modules/console/ui/styles/components.css` | Pipeline badge styles |

## Riesgos y mitigaciones
1. **SSR template monolítico** (1265 líneas): cambios quirúrgicos, no refactorizar
2. **Client-side JS sin types**: testear manualmente en browser

## Criterios de éxito
- [ ] Wizard: crear Sheet → scan-tabs funciona sin error 400
- [ ] Wizard: crear PDF → toast "se procesará con análisis visual"
- [ ] Lista: items muestran badge de pipeline (Visual, Texto, Video)
- [ ] Lista: items entrenados muestran conteo de fragmentos
- [ ] `fullVideoEmbed` no aparece en console-section.ts
- [ ] `liveQueryEnabled` no tiene toggle en UI
- [ ] Build limpio
