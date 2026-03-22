# Oficina — Panel de control web (SSR multi-page)

Panel de configuración, monitoreo y gestión de módulos. Se monta en `/oficina` del servidor HTTP.
Cada sección es una URL real (`/oficina/whatsapp`, `/oficina/llm`, `/oficina/pipeline`, etc.).
El servidor genera HTML completo con datos embebidos (SSR). Formularios envían POST, el servidor redirige.

## Archivos
- `manifest.ts` — lifecycle, registra servicio `oficina:requestHandler`
- `manifest-ref.ts` — singleton para acceder al Registry desde handlers de ruta
- `server.ts` — SSR router (GET pages, POST handlers), APIs REST, static files, redirects
- `templates.ts` — layout HTML: header con hamburger, sidebar dinámico por categorías, save bar, flash
- `templates-i18n.ts` — diccionario i18n ES/EN server-side (~400 keys), `t()`, `detectLang()`
- `templates-fields.ts` — field builders: text, secret, num, bool, select, textarea, modelDropdown, divider, readonly, tags, duration
- `templates-sections.ts` — section renderers: unified LLM (4 panels), unified Pipeline (3 panels), whatsapp, email, google-apps, engine-metrics, lead-scoring, scheduled-tasks, modules, db, redis
- `templates-modules.ts` — dynamic module panels from manifest.oficina.fields
- `ui/js/oficina-minimal.js` — minimal client JS: hamburger drawer, WA polling, dirty tracking, model switch, toasts, Google OAuth
- `ui/styles/*.css` — 5 CSS files (base, layout, components, whatsapp, sidebar)

## Sidebar dinámico
- 6 categorías hardcodeadas: Canales, Agente, Leads, Datos, Módulos, Sistema
- Items fijos (secciones con renderers custom) + items dinámicos (módulos activos con `oficina.group`)
- Los módulos declaran `group` e `icon` en su `manifest.oficina` para aparecer automáticamente
- Mobile: hamburger menu con drawer lateral (no horizontal scroll)

## Páginas unificadas
- `/oficina/llm` — 4 paneles colapsables: API Keys, Modelos, Límites, Circuit Breaker
- `/oficina/pipeline` — 3 paneles colapsables: Pipeline, Follow-up, Naturalidad
- URLs viejas (apikeys, models, llm-limits, llm-cb, followup, naturalidad) redirigen 302

## Páginas dinámicas de módulos
- Módulos con `oficina.fields` y `oficina.group` obtienen su propia página automática
- Ej: `/oficina/memory`, `/oficina/tools`, `/oficina/users`, `/oficina/knowledge`
- El server intenta `renderSection()` primero, luego fallback a `renderModulePanels()`

## Tipos de campo (OficinaField)
- Básicos: `text`, `textarea`, `secret`, `number`, `boolean`, `select`
- Nuevos: `divider`, `tags`, `readonly`, `duration`, `model-select`
- Props: `min`, `max`, `step`, `unit`, `placeholder`, `separator`, `rows`

## API routes (montadas en /oficina/api/oficina/)
- `GET /version` — build version
- `GET /config` — valores actuales (DB > .env > defaults)
- `PUT /config` — escribe a DB + .env
- `POST /apply` — hot-reload config
- `GET /modules` — lista módulos con estado
- `POST /activate` / `POST /deactivate` — toggle módulos
- `POST /reset-db` — truncar + flush (testing)
- `GET /engine-metrics` — métricas del engine con periodo

## Patrones
- HTTP nativo de Node.js. NO agregar Express/Fastify.
- Config read: DB (config-store, AES-256-GCM encrypted) > .env > defaults.
- Config write: DB primary + .env backup (regex preserva comentarios).
- `manifest-ref.ts` singleton para acceso al registry desde API routes.
- Helpers HTTP: usa `jsonResponse`, `readBody` de `kernel/http-helpers.js`. NO redefinir.
- Sidebar: categorías hardcodeadas en `templates.ts`, items dinámicos desde `dynamicModules`.

## Trampas
- .env se monta como volumen Docker para que edits persistan entre deploys.
- `reset-db` trunca tablas y hace flushdb en Redis — solo testing/staging.
- CSS cached 24h en browser — usar hard refresh en dev.
- Google auth status no se obtiene server-side (solo via API) — initial render muestra "not connected".
- QR data URL tampoco se obtiene server-side — client JS polling lo actualiza.
- URLs viejas (apikeys, models, etc.) redirigen a las unificadas — no rompen bookmarks.
