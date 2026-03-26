# Freight Module — Wrapper de la tool estimate-freight

Módulo wrapper que conecta `src/tools/freight/` al sistema modular del kernel.

## Archivos
- `manifest.ts` — lifecycle wrapper: llama `registerFreightTool()` de la tool real

## Manifest
- type: `feature`, removable: true, activateByDefault: true
- depends: `['tools']`
- configSchema: credenciales SeaRates + DHL Express, buffer, enabled flag
- console: panel "Flete" en grupo `agent`, con fields para credenciales y config

## Relación con src/tools/freight/
Este módulo NO contiene lógica de estimación. Solo hace el bridge entre el kernel (lifecycle, config, console) y `src/tools/freight/freight-tool.ts` que tiene la implementación. Ver `src/tools/freight/CLAUDE.md`.

## Por qué existe
La tool necesita: 1) ser descubierta por el kernel, 2) recibir config desde la consola (credenciales, buffer), 3) des-registrarse cuando el módulo se desactiva. Sin este wrapper, la tool se registraría fuera del sistema modular.

## Config flow
1. Credenciales y buffer vienen del `configSchema` del módulo (editables desde consola)
2. Config de tenant (carriers, known_origins, disclaimers) viene de `instance/tools/freight.json`
3. El manifest pasa el config del módulo a `registerFreightTool()` que lo convierte a secrets
