# Oficina — Panel de control web

Panel de configuración, monitoreo y gestión de módulos. Se monta en `/oficina` del servidor HTTP.

## Archivos
- `manifest.ts` — lifecycle, registra servicio `oficina:requestHandler`
- `manifest-ref.ts` — singleton para acceder al Registry desde handlers de ruta
- `server.ts` — REST API: módulos, config, versión, reset-db. Lee config de DB (config-store) con fallback a .env.
- `ui/config-ui.html` — SPA dark theme (Tailwind-inspired, i18n ES/EN). Paneles dinámicos vía `renderModulePanels()`.

## Manifest
- type: `core-module`, removable: false, activateByDefault: true

## Servicio registrado
- `oficina:requestHandler` — handler que retorna true si manejó la ruta /oficina

## API routes (montadas en /oficina/api/oficina/)
- `GET /version` — build version (BUILD_VERSION env)
- `GET /config` — valores actuales (DB config-store > .env > defaults)
- `PUT /config` — escribe a DB (encriptado si secret) y .env (backward compat)
- `GET /modules` — lista de módulos con estado (active/inactive)
- `POST /activate` — activar módulo por nombre
- `POST /deactivate` — desactivar módulo por nombre
- `POST /reset-db` — truncar tablas + flush Redis (solo testing)

## Patrón clave: desacoplamiento
Oficina **NO sabe de WhatsApp, modelos, ni ningún otro módulo**. Cada módulo registra sus propias rutas y campos UI via `manifest.oficina.apiRoutes` y `manifest.oficina.fields`. Oficina solo monta y renderiza.

## Paneles dinámicos
La UI **no tiene paneles hardcodeados** por módulo. `renderModulePanels()` itera sobre los módulos del registry y renderiza campos desde `manifest.oficina.fields`. Cada módulo nuevo aparece automáticamente.

## Patrones
- HTTP nativo de Node.js. NO agregar Express/Fastify.
- Config read: DB (config-store, AES-256-GCM encrypted) > .env > defaults.
- Config write: DB primary + .env backup (regex preserva comentarios).
- HTML search: busca primero en dist/, luego src/.
- `manifest-ref.ts` exporta `setRegistryRef()`/`getRegistryRef()` — singleton necesario porque handlers de ruta no reciben registry como parámetro.

## Trampas
- .env se monta como volumen Docker para que edits persistan entre deploys.
- `reset-db` trunca tablas y hace flushdb en Redis — solo usar en testing/staging.
- Si agregas assets estáticos, copiarlos en Dockerfile a dist/modules/oficina/.
- **Helpers HTTP**: `server.ts` usa `jsonResponse`, `readBody` de `kernel/http-helpers.js`. NO redefinir localmente.
