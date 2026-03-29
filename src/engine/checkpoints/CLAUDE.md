# Checkpoints — Resumable Pipeline Execution

Persiste el estado de ejecución del pipeline a DB para que pipelines interrumpidos por crash/timeout puedan reanudar desde el último paso completado.

## Archivos
- `types.ts` — TaskCheckpoint, Phase1Snapshot, CheckpointStatus
- `checkpoint-manager.ts` — CRUD para tabla `task_checkpoints`, resume, cleanup
- `index.ts` — re-exports

## Tabla: task_checkpoints
- Migración: `src/migrations/012_task-checkpoints.sql`
- Un row por ejecución de pipeline
- Guarda: message payload, resultados de cada fase (JSONB), step results de Phase 3
- Status: running → completed/failed/resuming

## Flujo
1. **Pipeline start** (Phase 1 done): `create()` + `savePhase1()`
2. **Phase 2 done**: `savePhase2()` con EvaluatorOutput
3. **Cada step de Phase 3**: `saveStepResult()` — append al array
4. **Phase 3 done**: `savePhase3()` con ExecutionOutput
5. **Phase 4 done**: `savePhase4()` con CompositorOutput
6. **Phase 5 done**: `complete()`
7. **Error**: `fail()` con mensaje de error

## Resume (al reiniciar)
1. `expireStale()` — marca como failed los checkpoints más viejos que `checkpointResumeWindowMs`
2. `findIncomplete()` — busca checkpoints en status 'running' dentro de la ventana
3. `markResuming()` — claim atómico (previene duplicados)
4. `resumeFromCheckpoint()` en engine.ts — re-entra al pipeline desde la fase apropiada

## Config (env vars)
- `ENGINE_CHECKPOINT_ENABLED` (default: true) — habilita/deshabilita
- `ENGINE_CHECKPOINT_RESUME_WINDOW_MS` (default: 300000 / 5min) — ventana de resume
- `ENGINE_CHECKPOINT_CLEANUP_DAYS` (default: 7) — purga checkpoints viejos

## Trampas
- Los saves de checkpoint son fire-and-forget (catch silencioso) — no bloquean el pipeline
- Si checkpoint falla al crear, el pipeline continúa sin checkpoints
- Resume re-ejecuta Phase 1 completo (es rápido, <200ms) para reconstruir ContextBundle fresco
- Step results de Phase 3 se acumulan incrementalmente via `|| jsonb_concat`
