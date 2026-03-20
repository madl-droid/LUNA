# Oficina — Panel de control web (SSR multi-page)

Panel de configuración, monitoreo y gestión de módulos. Se monta en `/oficina` del servidor HTTP.
Cada sección es una URL real (`/oficina/whatsapp`, `/oficina/apikeys`, etc.).
El servidor genera HTML completo con datos embebidos (SSR). Formularios envían POST, el servidor redirige.

## Archivos
- `manifest.ts` — lifecycle, registra servicio `oficina:requestHandler`
- `manifest-ref.ts` — singleton para acceder al Registry desde handlers de ruta
- `server.ts` — SSR router (GET pages, POST handlers), APIs REST, static files
- `templates.ts` — layout HTML: header, sidebar, save bar, flash messages
- `templates-i18n.ts` — diccionario i18n ES/EN server-side, `t()`, `detectLang()`
- `templates-fields.ts` — field builders: text, secret, num, bool, select, textarea, modelDropdown
- `templates-sections.ts` — 14 section renderers (whatsapp, apikeys, models, etc.)
- `templates-modules.ts` — dynamic module panels from manifest.oficina.fields
- `ui/js/oficina-minimal.js` — minimal client JS (~200 lines): WA polling, dirty tracking, model switch, toasts
- `ui/styles/*.css` — 5 CSS files (Workstream B: design only)

## Arquitectura SSR
- GET `/oficina/{section}` → server fetches data, renders HTML, returns full page
- POST `/oficina/save` → saves config to DB + .env, redirects with `?flash=saved`
- POST `/oficina/apply` → saves + hot-reloads config, redirects with `?flash=applied`
- POST `/oficina/reset-db` → truncates DB + flushes Redis, redirects
- POST `/oficina/modules/toggle` → activates/deactivates module, redirects
- Sidebar items are `<a>` links (real navigation, no JS)
- Language toggle is `<a href="?lang=en">` (no JS, sets cookie)
- Save/Apply are form submits; Discard is a link back to current section

## Interactividad mínima (oficina-minimal.js)
- WhatsApp polling (3s interval on /oficina/whatsapp only)
- WA connect/disconnect via fetch
- Dirty tracking: compares inputs against `data-original`, enables Save/Apply
- Model dropdown: reads `#models-data` JSON, updates model select on provider change
- Model scanner: POST trigger + inline result display
- Google OAuth: popup + polling for completion
- Reset DB: confirm + form POST
- Toast auto-dismiss

## Contrato CSS (interfaz entre funcionalidad y diseño)
Templates generan HTML con estas clases. CSS las estiliza. Ninguno cambia las del otro.
Layout: .app-layout, .sidebar, .content-area, .save-bar
Header: header, h1, .header-right, .build-ver, .lang-toggle, .status-text
Sidebar: .sidebar-group, .sidebar-group-title, .sidebar-item, .sidebar-item.active, .nav-badge
Panels: .panel, .panel.collapsed, .panel-header, .panel-title, .panel-chevron, .panel-body, .panel-info
Fields: .field, .field-label, .field-left, .toggle-field, .toggle, .toggle-slider, .model-row, .modified
Buttons: .btn-save, .btn-apply, .btn-reset, .btn-resetdb
WhatsApp: .wa-status-row, .wa-badge, .wa-btn, .wa-qr-box, .wa-phones
Toast: .toast, .toast.success, .toast.error
Badges: .panel-badge, .badge-active, .badge-soon, .badge-off, .nav-badge

## API routes (montadas en /oficina/api/oficina/)
- `GET /version` — build version
- `GET /config` — valores actuales (DB > .env > defaults)
- `PUT /config` — escribe a DB + .env
- `POST /apply` — hot-reload config
- `GET /modules` — lista módulos con estado
- `POST /activate` / `POST /deactivate` — toggle módulos
- `POST /reset-db` — truncar + flush (testing)

## Patrones
- HTTP nativo de Node.js. NO agregar Express/Fastify.
- Config read: DB (config-store, AES-256-GCM encrypted) > .env > defaults.
- Config write: DB primary + .env backup (regex preserva comentarios).
- `manifest-ref.ts` singleton para acceso al registry desde API routes.
- Helpers HTTP: usa `jsonResponse`, `readBody` de `kernel/http-helpers.js`. NO redefinir.

## Trampas
- .env se monta como volumen Docker para que edits persistan entre deploys.
- `reset-db` trunca tablas y hace flushdb en Redis — solo testing/staging.
- CSS cached 24h en browser — usar hard refresh en dev.
- Google auth status no se obtiene server-side (solo via API) — initial render muestra "not connected".
- QR data URL tampoco se obtiene server-side — client JS polling lo actualiza.
