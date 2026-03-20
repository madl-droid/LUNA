# Oficina UI — Guía de desarrollo

## Qué es
SPA del panel de control de LUNA. Servida desde `/oficina`. Usa CSS y JS externos cargados como archivos estáticos via `/oficina/static/`.

## Estructura de archivos
```
ui/
  CLAUDE.md          — esta guía
  DESIGN.md          — paleta de colores, tipografía, componentes (referencia visual)
  config-ui.html     — HTML shell + JS inline (estado, render, handlers, i18n)
  styles/
    base.css         — reset, CSS variables (:root), tipografía
    layout.css       — header, main, save bar, responsive breakpoints
    components.css   — panels, fields, toggles, badges, buttons, toasts, model selector
    whatsapp.css     — estilos específicos del panel WhatsApp
  js/
    i18n.js          — traducciones ES/EN + t() + toggleLang()
    state.js         — variables de estado global
    utils.js         — esc(), setStatus(), showToast()
    fields.js        — builders de campos (text, secret, num, bool, model, select, info)
    panels.js        — builders de paneles + togglePanel()
    whatsapp.js      — polling, connect, disconnect, renderWa()
    modules.js       — renderModulePanels(), toggleModule(), refreshModuleStates()
    render.js        — render() principal
    handlers.js      — onChange, save, apply, resetDb, triggerScan
    app.js           — init() (carga última)
  assets/            — imágenes estáticas (mascota, logos)
```

## Cómo se sirven los archivos
- `server.ts` sirve `/oficina/static/*` mapeando a `ui/` (dev) o `dist/oficina/` (prod)
- Seguridad: path traversal bloqueado con `path.resolve` + verificación de directorio base
- MIME types soportados: .css, .js, .png, .jpg, .gif, .svg, .ico, .webp

## Cómo agregar estilos nuevos
1. Si es un componente genérico → `components.css`
2. Si es específico de un módulo (ej: gmail) → crear `styles/{modulo}.css`
3. Si es layout/estructura → `layout.css`
4. Agregar `<link>` en `config-ui.html` head
5. Variables de color siempre en `base.css` `:root`

## Cómo agregar una sección nueva
1. En el JS de `config-ui.html`, agregar al `render()` usando `panel()` o `panelRaw()`
2. Agregar traducciones en `i18n.es` e `i18n.en` (prefijo `sec_` para secciones, `f_` para fields, `i_` para tooltips)
3. Los módulos con `manifest.oficina.fields` aparecen automáticamente via `renderModulePanels()`

## Convenciones
- CSS: kebab-case para clases (`.panel-header`, `.wa-badge`)
- Variables CSS: `--categoria-nombre` (`--bg-primary`, `--text-secondary`)
- IDs HTML: kebab-case (`wa-inner`, `btn-save`)
- i18n keys: snake_case con prefijo (`sec_whatsapp`, `f_LLM_CLASSIFY`, `i_ANTHROPIC_API_KEY`)
- Nunca usar `#000000` ni `#ffffff` puros — usar tokens de DESIGN.md

## Plan de modularización (en progreso)
- **Ronda 1** ✅: Extraer CSS a archivos separados
- **Ronda 2** ✅: Extraer JS a 10 archivos separados (i18n, state, utils, fields, panels, whatsapp, modules, render, handlers, app)
- **Ronda 3**: Implementar sidebar layout estilo HubSpot + navigation.js
- **Ronda 4**: Polish (responsive sidebar, iconos, transiciones)

## Trampas
- Los CSS se cargan con `Cache-Control: max-age=86400` — en dev puede cachear. Usa hard refresh.
- El HTML busca primero en `dist/oficina/` — si hay build viejo, sirve el viejo.
- `renderModulePanels()` usa inline styles en el JS — esos NO están en los CSS externos.
- En deploy Docker, copiar `ui/styles/` y `ui/js/` al dist (ver Dockerfile).
