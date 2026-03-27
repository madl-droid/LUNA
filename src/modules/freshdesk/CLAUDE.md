# Freshdesk Module — Wrapper de tools Freshdesk KB

Módulo wrapper que conecta `src/tools/freshdesk/` al sistema modular del kernel.

## Archivos
- `manifest.ts` — lifecycle wrapper: registra tools, programa sync BullMQ, API routes, console render
- `console-section.ts` — renderizado SSR de las tabs de artículos (sincronizados + cacheados)

## Manifest
- type: `feature`, removable: true, activateByDefault: false
- depends: `['tools']`
- configSchema: dominio, API key, cache TTL (dropdown), filtro de categorías
- console: panel "Freshdesk Knowledge Base" en grupo `agent`, campos en 2 columnas
- Sync automático siempre habilitado (hardcoded), cron no configurable desde UI

## Relación con src/tools/freshdesk/
Este módulo NO contiene lógica de búsqueda ni sync. Solo hace el bridge entre el kernel (lifecycle, config, console) y `src/tools/freshdesk/` que tiene la implementación. Ver `src/tools/freshdesk/CLAUDE.md`.

## Por qué existe
Las tools necesitan: 1) ser descubiertas por el kernel, 2) recibir config desde la consola, 3) programar el sync via BullMQ, 4) des-registrarse cuando el módulo se desactiva.

## Config flow
1. Credenciales vienen del `configSchema` del módulo (editables desde consola)
2. Si FRESHDESK_DOMAIN o FRESHDESK_API_KEY están vacíos, el módulo queda inactivo
3. Sync siempre se programa como cron BullMQ (queue: `luna:freshdesk-sync`, domingos 1AM)

## Servicios expuestos
- `freshdesk:sync` — `{ run(): Promise<{ articleCount, categoryCount }> }` — trigger manual de sync
- `freshdesk:renderSection` — `(lang: string) => string` — HTML de tabs para consola

## API routes (bajo /console/api/freshdesk/)
- `GET /articles` — lista títulos de artículos sincronizados + lastSyncAt
- `GET /cached-articles` — lista artículos en cache Redis con TTL restante
