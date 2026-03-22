# Oficina UI — Guía de desarrollo

## Qué es
Archivos estáticos (CSS, JS) servidos desde `/oficina/static/`. El HTML es generado server-side por templates TypeScript.

## Estructura de archivos
```
ui/
  CLAUDE.md          — esta guía
  DESIGN.md          — paleta de colores, tipografía, componentes (referencia visual)
  js/
    oficina-minimal.js — JS minimal (~415 líneas): hamburger, WA polling, dirty tracking, toasts, model switch, Google OAuth, panel collapse
  styles/
    base.css         — reset, CSS variables (:root), tipografía
    layout.css       — header, main, save bar, responsive breakpoints
    components.css   — panels, fields, toggles, badges, buttons, toasts, model selector
    whatsapp.css     — estilos específicos del panel WhatsApp
    sidebar.css      — sidebar navigation layout
  assets/            — imágenes estáticas (mascota, logos)
```

## Arquitectura (SSR)
- El servidor genera el HTML completo con datos embebidos (templates-*.ts en el directorio padre)
- `oficina-minimal.js` maneja solo la interactividad que requiere JS:
  - WhatsApp polling y connect/disconnect
  - Dirty tracking (habilita/deshabilita botones Save/Apply)
  - Model provider switch (actualiza opciones de modelo)
  - Model scanner trigger
  - Google OAuth (popup + polling)
  - Toast auto-dismiss
  - Panel collapse

## Cómo se sirven los archivos
- `server.ts` sirve `/oficina/static/*` mapeando a `ui/` (dev) o `dist/oficina/` (prod)
- Seguridad: path traversal bloqueado con `path.resolve` + verificación de directorio base
- MIME types soportados: .css, .js, .png, .jpg, .gif, .svg, .ico, .webp

## Convenciones
- CSS: kebab-case para clases (`.panel-header`, `.wa-badge`)
- Variables CSS: `--categoria-nombre` (`--bg-primary`, `--text-secondary`)
- IDs HTML: kebab-case (`wa-inner`, `btn-save`)
- Nunca usar `#000000` ni `#ffffff` puros — usar tokens de DESIGN.md

## Trampas
- Los CSS se cargan con `Cache-Control: max-age=86400` — en dev puede cachear. Usa hard refresh.
- En deploy Docker, copiar `ui/styles/` y `ui/js/` al dist (ver Dockerfile).
- `oficina-minimal.js` usa `data-original` attributes para dirty tracking — los templates DEBEN incluirlos.
