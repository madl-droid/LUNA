# Console — Panel de control web (SSR multi-page)

Panel de configuración, monitoreo y gestión de módulos. Se monta en `/console` del servidor HTTP.
Cada sección es una URL real (`/console/whatsapp`, `/console/llm`, `/console/pipeline`, etc.).
El servidor genera HTML completo con datos embebidos (SSR). Formularios envían POST, el servidor redirige.

## Archivos
- `manifest.ts` — lifecycle, registra servicio `console:requestHandler`
- `manifest-ref.ts` — singleton para acceder al Registry desde handlers de ruta
- `server.ts` — SSR router (GET pages, POST handlers), APIs REST, static files, redirects
- `templates.ts` — layout HTML: header con hamburger, sidebar dinámico por categorías, save bar, flash
- `templates-i18n.ts` — diccionario i18n ES/EN server-side (210 keys/lang), `t()`, `detectLang()`
- `templates-fields.ts` — field builders: text, secret, num, bool, select, textarea, modelDropdown, divider, readonly, tags, duration
- `templates-sections.ts` — section renderers: unified LLM (4 panels), unified Pipeline (3 panels), whatsapp, email, google-apps, engine-metrics, lead-scoring, scheduled-tasks, modules, db, redis
- `templates-modules.ts` — dynamic module panels from manifest.console.fields
- `ui/js/console-minimal.js` — minimal client JS: hamburger drawer, WA polling, dirty tracking, model switch, toasts, Google OAuth
- `ui/styles/*.css` — 5 CSS files (base, layout, components, whatsapp, sidebar)

## Sidebar dinámico
- 6 categorías con i18n keys (`cat_channels`, `cat_agent`, etc.) vía `t()`
- Items fijos (secciones con renderers custom) + items dinámicos (módulos activos con `console.group`)
- Los módulos declaran `group` e `icon` en su `manifest.console` para aparecer automáticamente
- **Canales NO aparecen individualmente en el sidebar** — se gestionan desde la pestaña unificada `/console/channels`
- Módulos con `group: 'channels'` se excluyen del sidebar dinámico automáticamente
- Mobile: hamburger menu con drawer lateral (no horizontal scroll)

## Pestaña Canales (`/console/channels`)
- Vista unificada de todos los canales como cards en grid responsive (2 por fila desktop, 1 mobile)
- Cada card: icono con borde de color por estado, nombre, tipo, toggle, descripción, métricas, botones
- Los canales se detectan automáticamente: cualquier módulo con `type: 'channel'` aparece aquí
- Activar/desactivar canales directamente desde esta pestaña (POST a `/console/modules/toggle` con `_redirect`)
- Los módulos channel DEBEN declarar `channelType`: `'instant'` | `'async'` | `'voice'`
- Barra de filtros (`.filter-bar`): periodo de métricas, estado, tipo de canal

### Sistema de estado visual por color del icono
El estado del canal se indica con el borde del icono (`.ch-card-icon`):
- **Gris** (`--on-surface-dim`): Inactivo (módulo desactivado)
- **Azul** (`#007aff`): Desconectado (activo pero sin conexión)
- **Verde** (`--success`): Conectado
- **Rojo** (`--error`): Error

Se controla con `data-status` en el `.ch-card`: `connected` | `disconnected` | `inactive` | `error`.

### Métricas estandarizadas por tipo de canal
Todos los tipos de canal muestran las mismas 4 métricas: **active**, **inbound**, **outbound**, **avg_duration_s**.
Las descripciones varían por tipo (i18n keys con sufijo `_instant`, `_async`, `_voice`).

### Connection wizard (instrucciones desde el módulo)
Las instrucciones del wizard de conexión vienen del `manifest.console.connectionWizard` del módulo, NO hardcodeadas en la UI.
- El server embebe los datos del wizard en `<script id="channel-wizards-data">` como JSON
- El cliente JS lee este JSON y renderiza los pasos dinámicamente
- Los links externos DEBEN incluir `target="_blank"` y el SVG de redirect icon
- Los campos (fields) se guardan via `/console/save` → `configStore.setMultiple()` (AES-256-GCM)
- **REQUISITO**: Todo módulo `type='channel'` DEBE declarar `connectionWizard` en su manifest

### Sistema de mensajes de error (`.ch-card-error`)
Barra de error roja con border-left que aparece debajo de la descripción cuando tiene contenido.
- Se muestra automáticamente si `data-status="error"` en el card padre, o si el div tiene texto
- Para mostrar un error desde JS: `card.querySelector('.ch-card-error').textContent = 'mensaje'`
- Para limpiar: `card.querySelector('.ch-card-error').textContent = ''`
- Extensible: agregar `.ch-card-warning` con amber para advertencias

## Páginas unificadas
- `/console/llm` — 4 paneles colapsables: API Keys, Modelos, Límites, Circuit Breaker
- `/console/pipeline` — 3 paneles colapsables: Pipeline, Follow-up, Naturalidad
- URLs viejas (apikeys, models, llm-limits, llm-cb, followup, naturalidad) redirigen 302

## Páginas dinámicas de módulos
- Módulos con `console.fields` y `console.group` obtienen su propia página automática
- Ej: `/console/memory`, `/console/tools`, `/console/users`, `/console/knowledge`
- El server intenta `renderSection()` primero, luego fallback a `renderModulePanels()`

## Tipos de campo (ConsoleField)
- Básicos: `text`, `textarea`, `secret`, `number`, `boolean`, `select`
- Nuevos: `divider`, `tags`, `readonly`, `duration`, `model-select`
- Props: `min`, `max`, `step`, `unit`, `placeholder`, `separator`, `rows`

## API routes (montadas en /console/api/console/)
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
- Sidebar: categorías i18n en `templates.ts`, items dinámicos desde `dynamicModules`.

## Trampas
- .env se monta como volumen Docker para que edits persistan entre deploys.
- `reset-db` trunca tablas y hace flushdb en Redis — solo testing/staging.
- CSS cached 24h en browser — usar hard refresh en dev.
- Google auth status no se obtiene server-side (solo via API) — initial render muestra "not connected".
- QR data URL tampoco se obtiene server-side — client JS polling lo actualiza.
- URLs viejas (apikeys, models, etc.) redirigen a las unificadas — no rompen bookmarks.
