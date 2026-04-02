# Engine Module — Wrapper del pipeline para el kernel

Módulo wrapper que conecta el engine pipeline (`src/engine/`) al sistema modular del kernel.

## Archivos
- `manifest.ts` — lifecycle wrapper: llama `initEngine()`/`shutdownEngine()` del engine real

## Manifest
- type: `core-module`, removable: false, activateByDefault: true
- depends: `['memory', 'llm']`

## Relación con src/engine/
Este módulo NO contiene lógica de pipeline. Solo hace el bridge entre el kernel (lifecycle, hooks, registry) y `src/engine/engine.ts` que tiene la implementación real. Ver `src/engine/CLAUDE.md` para documentación del pipeline.

## Modo de operación (v2.0)
El engine soporta dos modos controlados por `ENGINE_MODE`:
- `agentic` (default): Phase 1 → agentic loop → post-process → Phase 5
- `legacy`: Phase 1 → Phase 2 → Phase 3 → Phase 4 → Phase 5

## Por qué existe
El engine necesita participar del lifecycle de módulos (init/stop) y recibir el registry para acceder a servicios. Sin este wrapper, el engine se inicializaría fuera del sistema modular, rompiendo el principio de que todo pasa por manifests.
