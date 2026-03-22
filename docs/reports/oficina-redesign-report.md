# INFORME DE CIERRE — Sesion: Oficina Redesign (Audit + Fases 0-3)
## Branch: claude/audit-office-software-dJWsd

### Objetivos definidos
Auditar y rediseñar el módulo oficina: sidebar dinámico, tipos de campo nuevos, unificación de secciones, mobile hamburger, limpieza de código.

### Completado
- **Fase 0+1**: Foundation + Dynamic sidebar
  - Kernel types extendidos (OficinaField con 11 tipos, ModuleOficinaDef con group/icon)
  - 14 manifests de módulos con group e icon
  - Sidebar dinámico: 6 categorías hardcodeadas + items dinámicos desde registry
  - Módulos activos obtienen página propia automática
  - 5 field renderers nuevos (divider, readonly, tags, duration, model-select)
  - i18n: ~50 claves corregidas/agregadas
  - Hamburger menu con drawer lateral para mobile
  - Inline styles migrados a CSS classes
  - Script de validación i18n (scripts/validate-i18n.ts)
  - Coming Soon sections eliminados

- **Fase 2**: Unificación de secciones
  - LLM unificado: apikeys + models + limits + cb en 4 paneles colapsables
  - Pipeline unificado: pipeline + followup + naturalidad en 3 paneles colapsables
  - Sidebar de 16 a 10 entradas fijas
  - Redirects 302 para URLs viejas

- **Fase 3**: Limpieza y consolidación
  - 7 renderers standalone eliminados (código muerto)
  - Engine-metrics inline styles migrados a CSS
  - Lead-scoring inline styles migrados a CSS
  - CLAUDE.md de oficina actualizado

### No completado
- Unificar engine-metrics dentro del pipeline (es un dashboard, se mantuvo separado)
- Tags field client-side JS (add/remove tags interactivamente)
- Dark mode

### Archivos creados/modificados
**Creados:**
- `scripts/validate-i18n.ts` — validación de claves i18n
- `docs/reports/oficina-redesign-report.md` — este informe

**Modificados (kernel):**
- `src/kernel/types.ts` — OficinaFieldType, OficinaField (props), OficinaGroup, ModuleOficinaDef (group, icon)

**Modificados (oficina):**
- `src/modules/oficina/templates.ts` — sidebar dinámico por categorías, hamburger
- `src/modules/oficina/templates-sections.ts` — unified LLM/Pipeline, dead code removal, CSS migration
- `src/modules/oficina/templates-fields.ts` — 5 nuevos field renderers
- `src/modules/oficina/templates-modules.ts` — inline styles → CSS classes
- `src/modules/oficina/templates-i18n.ts` — ~50 keys nuevas/corregidas
- `src/modules/oficina/server.ts` — dynamicModules, module pages, redirects
- `src/modules/oficina/CLAUDE.md` — actualizado
- `src/modules/oficina/ui/js/oficina-minimal.js` — hamburger drawer
- `src/modules/oficina/ui/styles/components.css` — metrics, status-row, module-panel, divider, tags, duration, btn-secondary, btn-danger
- `src/modules/oficina/ui/styles/layout.css` — header-left, hamburger
- `src/modules/oficina/ui/styles/sidebar.css` — drawer mobile

**Modificados (manifests — 14 módulos):**
- whatsapp, gmail, google-chat, twilio-voice (group: channels)
- prompts, tools, scheduled-tasks (group: agent)
- lead-scoring (group: leads)
- memory, knowledge (group: data)
- google-apps (group: modules)
- llm, model-scanner, users (group: system)

### Interfaces expuestas
- `OficinaFieldType` — tipo union con 11 variantes
- `OficinaGroup` — tipo union para categorías del sidebar
- `OficinaField.min/max/step/unit/placeholder/separator/rows` — props nuevas
- `ModuleOficinaDef.group/icon` — categoría e icono del sidebar
- `DynamicSidebarModule` — interfaz para módulos dinámicos en el sidebar
- `SECTION_REDIRECTS` — mapa de redirects de URLs viejas
- `dividerField()`, `readonlyField()`, `tagsField()`, `durationField()` — renderers nuevos

### Dependencias instaladas
Ninguna nueva.

### Tests
No hay tests unitarios para oficina (SSR). Build TypeScript pasa con 0 errores.
Script validate-i18n.ts funciona (detecta asimetría ES/EN).

### Decisiones técnicas
1. Sidebar: categorías hardcodeadas + items dinámicos. No 100% dinámico para mantener control sobre el orden y estructura core.
2. Unified pages: paneles colapsables en vez de tabs. Mantiene la consistencia visual.
3. Redirects 302 en vez de 301: permite revertir si se necesita.
4. Engine-metrics se mantuvo separado del pipeline: es un dashboard, no config.
5. Tags field JS interactivo no implementado aún (solo hidden input + server-side).

### Riesgos o deuda técnica
- Tags field necesita JS para add/remove interactivo (actualmente solo muestra)
- Model-select field type usa textField como fallback (necesita renderer propio con provider dropdown)
- validate-i18n.ts tiene falsos positivos en la extracción de claves (regex `\b(\w+)\s*:` captura palabras dentro de strings)
- ~160 claves i18n "no usadas" en templates pero usadas en client JS — script no las valida

### Notas para integración
- Módulos nuevos solo necesitan `group` e `icon` en su manifest.oficina para aparecer en el sidebar
- URLs viejas (/oficina/apikeys, etc.) redirigen automáticamente — no rompen bookmarks
- El sidebar ahora depende de `dynamicModules` pasado desde server — si no se pasa, solo muestra items fijos
