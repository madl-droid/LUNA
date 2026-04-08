# Plan 10 — Legacy Cleanup

**Prioridad:** LOW (cleanup, sin cambio de comportamiento)
**Objetivo:** Eliminar codigo muerto, comentarios engañosos y configuracion fantasma del pipeline legacy (5-phase) que ya no existe. Todo el engine funciona en modo agentic.

## Archivos target

| Archivo | Scope |
|---------|-------|
| `src/engine/checkpoints/checkpoint-manager.ts` | Clase entera muerta |
| `src/engine/checkpoints/types.ts` | Types muertos |
| `src/engine/checkpoints/index.ts` | Re-exports muertos |
| `src/engine/checkpoints/CLAUDE.md` | Docs de checkpoints |
| `src/engine/engine.ts` | ~70 lineas de checkpoint init/resume/cleanup |
| `src/engine/config.ts` | 3 config fields muertos |
| `src/engine/types.ts` | `composeRetriesPerProvider` + comentarios Phase |
| `src/engine/concurrency/step-semaphore.ts` | Comentario "Phase 3" |
| `src/engine/boundaries/delivery.ts` | Comentario "Phase 4" |
| `src/engine/buffer-compressor.ts` | Comentario "Phase 3" |
| `src/engine/prompts/context-builder.ts` | Comentario "Phase 2" |
| `src/engine/subagent/subagent.ts` | Comentario "Phase 3" |
| `src/engine/subagent/verifier.ts` | Comentario "Phase 2" |
| `src/engine/utils/response-format-detector.ts` | Comentario "Phase 4" |
| `src/engine/proactive/proactive-pipeline.ts` | Comentario "Phase 1-5" |
| `src/engine/attachments/classifier.ts` | Comentario "Phase 3" |
| `src/engine/agentic/agentic-loop.ts` | Import StepSemaphore (verificar si se usa) |
| `src/modules/cortex/trace/store.ts` | Columnas `phase2_ms`, `phase3_ms`, `phase4_ms`, `raw_phase2`, `raw_phase4` |
| `src/channels/typing-delay.ts` | Param `_msPerChar` deprecated |
| `deploy/CLAUDE.md` | Referencia a `ENGINE_MODE` |
| `src/modules/console/templates-section-channels.ts` | Config fields que referencian checkpoints (si hay) |
| `src/modules/engine/manifest.ts` | configSchema con checkpoint env vars |

## Paso 0 — Verificacion obligatoria

Antes de borrar NADA:
1. Leer TODOS los archivos target completos
2. Buscar `grep -r "checkpoint" src/` para confirmar que NO hay codigo vivo que use checkpoints
3. Buscar `grep -r "composeRetries" src/` para confirmar que es dead code
4. Buscar `grep -r "ENGINE_MODE" src/` para confirmar que ningun .ts lo lee
5. Buscar `grep -r "_msPerChar\|msPerChar" src/` para identificar todos los callers
6. Buscar `grep -r "phase2_ms\|phase3_ms\|phase4_ms\|raw_phase2\|raw_phase4" src/` para el scope en Cortex Trace

## FIX-01: Eliminar checkpoint system completo [MAIN]
**Archivos:** `src/engine/checkpoints/` (directorio entero), `src/engine/engine.ts`, `src/engine/config.ts`, `src/engine/types.ts`
**Que borrar:**

### engine.ts
1. Leer el archivo completo
2. Eliminar `import { CheckpointManager }` (linea ~21)
3. Eliminar `let checkpointMgr: CheckpointManager | null = null` (linea ~32)
4. Eliminar bloque de inicializacion de checkpoints en `initEngine()` (~lineas 116-131): el `if (engineConfig.checkpointEnabled)`, la creacion del CheckpointManager, el cron de cleanup
5. Eliminar funcion completa `resumeCheckpoints()` (~lineas 726-794): toda la logica de resume/expire/cleanup
6. Eliminar la llamada a `resumeCheckpoints()` en `initEngine()` (buscar donde se invoca)
7. Verificar que no queden variables huerfanas

### config.ts
1. Eliminar los 3 campos de checkpoint del objeto de config:
   - `checkpointEnabled`
   - `checkpointResumeWindowMs`
   - `checkpointCleanupDays`
2. Eliminar las env vars correspondientes del configSchema del modulo engine (buscar en `src/modules/engine/manifest.ts`):
   - `ENGINE_CHECKPOINT_ENABLED`
   - `ENGINE_CHECKPOINT_RESUME_WINDOW_MS`
   - `ENGINE_CHECKPOINT_CLEANUP_DAYS`

### types.ts
1. Eliminar los 3 campos de la interfaz `EngineConfig`:
   - `checkpointEnabled: boolean`
   - `checkpointResumeWindowMs: number`
   - `checkpointCleanupDays: number`

### Directorio checkpoints/
1. Eliminar `src/engine/checkpoints/` completo (checkpoint-manager.ts, types.ts, index.ts, CLAUDE.md)
2. Eliminar cualquier re-export de checkpoints en `src/engine/index.ts`

### Migracion SQL (OPCIONAL — discutir con usuario)
- La tabla `task_checkpoints` (migracion 012) queda en la DB pero no se usa
- Se puede crear `src/migrations/024_drop-checkpoints.sql` con `DROP TABLE IF EXISTS task_checkpoints`
- O dejarla y limpiar en un futuro DB cleanup

## FIX-02: Eliminar `composeRetriesPerProvider` dead config [SMALL]
**Archivos:** `src/engine/types.ts:598`, `src/engine/config.ts:114`, `src/modules/engine/manifest.ts`
1. En types.ts: eliminar `composeRetriesPerProvider: number` y su comentario "Phase 4 retries"
2. En config.ts: eliminar `composeRetriesPerProvider: moduleConfig.ENGINE_COMPOSE_RETRIES_PER_PROVIDER` y su comentario
3. En el manifest del modulo engine: eliminar `ENGINE_COMPOSE_RETRIES_PER_PROVIDER` del configSchema

## FIX-03: Actualizar comentarios Phase 2/3/4 → agentic [MEDIUM]
**Archivos:** ~14 archivos listados arriba
**Regla:** NO borrar los comentarios, RENOMBRARLOS para reflejar la arquitectura actual.

Mapeo de renombrado:
| Viejo | Nuevo |
|-------|-------|
| "Phase 2" (evaluator) | "Agentic loop — effort routing / classification" |
| "Phase 3" (executor/steps) | "Agentic loop — tool execution" |
| "Phase 4" (compositor) | "Post-processor — formatting / TTS" |
| "Phase 1" | "Intake" (ya es correcto, solo verificar) |
| "Phase 5" | "Delivery" (ya es correcto, solo verificar) |

Archivos especificos:
1. `step-semaphore.ts:2` — "within Phase 3" → "within agentic loop"
2. `delivery.ts:2` — "from Phase 4" → "from post-processor"
3. `buffer-compressor.ts:1` — "Phase 3" → "agentic loop"
4. `context-builder.ts:2` — "Phase 2" → "agentic loop"
5. `subagent.ts:660` — "Phase 3" → "agentic loop"
6. `verifier.ts:23` — "Phase 2" → "classify model"
7. `response-format-detector.ts:75` — "Phase 4" → "post-processor"
8. `proactive-pipeline.ts:31` — "Phase 1 → Phase 2 → Phase 3-5" → "Intake → effort router → agentic loop → delivery"
9. `classifier.ts:3` — "Phase 3" → "agentic loop"
10. `types.ts` — multiples comentarios Phase 2/3/4:
    - linea 170: "Phase 3" → "agentic loop"
    - linea 191: "Phase 3, not Phase 1" → "agentic loop, not intake"
    - linea 215: "Phase 2 — Evaluator output" → "Effort Router — Classification output" (o eliminar si el type ya no se usa activamente)
    - linea 234/236: "Phase 2 hint" → "Effort router hint"
    - linea 254: "Phase 4 — Compositor output" → "Post-processor output" (o eliminar si no se usa)
    - linea 597: ya eliminado por FIX-02
11. `engine.ts:723` — "Phase 3 skips them" → actualizar descripcion
12. `checkpoints/types.ts` y `checkpoints/checkpoint-manager.ts` — ya eliminados por FIX-01
13. `config.ts:113` — ya eliminado por FIX-02

**IMPORTANTE:** Para types.ts lineas 215 y 254, verificar si `EvaluatorOutput` y `CompositorOutput` se siguen usando en codigo activo. Si NO se usan, eliminarlos. Si se usan, renombrar los types tambien.

## FIX-04: Renombrar columnas legacy en Cortex Trace [SMALL]
**Archivo:** `src/modules/cortex/trace/store.ts:55-57`
**Columnas:** `phase2_ms`, `phase3_ms`, `phase4_ms`, `raw_phase2`, `raw_phase4`

1. Primero, buscar si estas columnas se leen/escriben en algun lado: `grep -r "phase2_ms\|phase3_ms\|phase4_ms\|raw_phase2\|raw_phase4" src/`
2. Si se escriben en trace code:
   - Crear migracion `src/migrations/025_trace-rename-phases.sql`:
     ```sql
     ALTER TABLE trace_results RENAME COLUMN phase2_ms TO classify_ms;
     ALTER TABLE trace_results RENAME COLUMN phase3_ms TO agentic_ms;
     ALTER TABLE trace_results RENAME COLUMN phase4_ms TO postprocess_ms;
     ALTER TABLE trace_results RENAME COLUMN raw_phase2 TO raw_classify;
     ALTER TABLE trace_results RENAME COLUMN raw_phase4 TO raw_postprocess;
     ```
   - Actualizar TODOS los queries en store.ts y cualquier otro archivo que referencie estas columnas
   - Actualizar types si existen
3. Si NO se escriben (columnas muertas): crear migracion para dropearlas
   ```sql
   ALTER TABLE trace_results DROP COLUMN IF EXISTS phase2_ms;
   -- etc
   ```

## FIX-05: Eliminar `_msPerChar` deprecated [SMALL]
**Archivos:** `src/channels/typing-delay.ts`, `src/engine/boundaries/delivery.ts`

1. En `typing-delay.ts`: eliminar parametro `_msPerChar` de la firma de `calculateTypingDelay()`. La firma queda:
   ```typescript
   export function calculateTypingDelay(
     text: string,
     minMs = 800,
     maxMs = 4000,
     msPerWord = 500,
   ): number
   ```
2. En `delivery.ts:561`: actualizar la llamada para quitar `cc!.typingDelayMsPerChar`:
   - Antes: `calculateTypingDelay(part, cc!.typingDelayMsPerChar, cc!.typingDelayMinMs, cc!.typingDelayMaxMs)`
   - Despues: `calculateTypingDelay(part, cc!.typingDelayMinMs, cc!.typingDelayMaxMs)`
3. Buscar si `typingDelayMsPerChar` se declara en channel-config types o en algun configSchema y eliminarlo tambien
4. Buscar cualquier otro caller de `calculateTypingDelay` que pase el parametro viejo

## FIX-06: Limpiar referencia ENGINE_MODE en docs [SMALL]
**Archivos:** `deploy/CLAUDE.md`
1. Eliminar la linea `- \`ENGINE_MODE\` — \`agentic\` (default v2.0) | \`legacy\` (pipeline 5 fases, fallback)`
2. Buscar cualquier otra referencia a ENGINE_MODE en docs/ y eliminarla
3. El CLAUDE.md de checkpoints se elimina en FIX-01

## Verificacion post-fix

1. `grep -r "checkpoint" src/engine/ src/modules/engine/` — debe retornar 0 resultados (excepto migracion si se creo)
2. `grep -r "composeRetries" src/` — 0 resultados
3. `grep -r "Phase [2-4]" src/engine/` — 0 resultados con el viejo naming
4. `grep -r "_msPerChar" src/` — 0 resultados
5. `grep -r "ENGINE_MODE" src/ deploy/` — 0 resultados (excepto overview.md historico)
6. Compilar: `npx tsc --noEmit` — 0 errores nuevos
