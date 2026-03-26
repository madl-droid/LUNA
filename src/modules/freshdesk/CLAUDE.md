# Freshdesk Module — Wrapper de tools Freshdesk KB

Módulo wrapper que conecta `src/tools/freshdesk/` al sistema modular del kernel.

## Archivos
- `manifest.ts` — lifecycle wrapper: registra tools y programa sync BullMQ

## Manifest
- type: `feature`, removable: true, activateByDefault: false
- depends: `['tools']`
- configSchema: dominio, API key, sync cron, cache TTL, filtro de categorías
- console: panel "Freshdesk" en grupo `agent`, con fields para credenciales y sync config

## Relación con src/tools/freshdesk/
Este módulo NO contiene lógica de búsqueda ni sync. Solo hace el bridge entre el kernel (lifecycle, config, console) y `src/tools/freshdesk/` que tiene la implementación. Ver `src/tools/freshdesk/CLAUDE.md`.

## Por qué existe
Las tools necesitan: 1) ser descubiertas por el kernel, 2) recibir config desde la consola, 3) programar el sync via BullMQ, 4) des-registrarse cuando el módulo se desactiva.

## Config flow
1. Credenciales vienen del `configSchema` del módulo (editables desde consola)
2. Si FRESHDESK_DOMAIN o FRESHDESK_API_KEY están vacíos, el módulo queda inactivo
3. Sync se programa como cron BullMQ (queue: `luna:freshdesk-sync`)

## Servicio expuesto
- `freshdesk:sync` — `{ run(): Promise<{ articleCount, categoryCount }> }` — trigger manual de sync
