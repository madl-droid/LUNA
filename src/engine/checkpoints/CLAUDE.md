# Checkpoints — Resumable Phase 3 Execution Plans

Cuando Phase 2 genera un plan de ejecución multi-step, los checkpoints persisten qué steps se completaron. Si el sistema cae, al reiniciar Phase 3 salta los steps ya hechos.

## Archivos
- `types.ts` — TaskCheckpoint, CheckpointStatus
- `checkpoint-manager.ts` — create, appendStep, complete, fail, findIncomplete, cleanup
- `index.ts` — re-exports

## Tabla: task_checkpoints
- Migración: `src/migrations/012_task-checkpoints.sql`
- Schema liviana: 10 columnas. Sin JSONB de contexto. Solo plan + step results.
- `execution_plan` — el plan de Phase 2 (ExecutionStep[])
- `step_results` — steps completados (StepResult[]), append atómico via `||`

## Flujo normal
1. Phase 2 termina → `create()` fire-and-forget (INSERT ~1-2ms)
2. Phase 3 ejecuta cada step → `appendStep()` fire-and-forget por step
3. Pipeline completo → `complete()` fire-and-forget
4. Pipeline error → `fail()` fire-and-forget

## Resume al reiniciar
1. `expireStale()` — marca como failed los viejos que ya no vale la pena resumir
2. `findIncomplete()` — busca checkpoints en 'running' dentro de la ventana
3. Para cada uno con steps completados: re-procesar el mensaje completo
4. `processMessageInner()` recibe `resumeSteps` — Phase 3 los salta

## Principios de diseño
- **Zero-await en hot path**: create() y appendStep() nunca bloquean el pipeline
- **No serializar contexto**: Phase 1+2 se re-ejecutan (~300ms), no vale guardar snapshots
- **Resume simple**: re-procesar mensaje completo, Phase 3 es inteligente y salta steps ya hechos
- **Tabla liviana**: sin columns de Phase 1/2/3/4 result. Solo plan + steps + status.

## Config (env vars)
- `ENGINE_CHECKPOINT_ENABLED` (default: true)
- `ENGINE_CHECKPOINT_RESUME_WINDOW_MS` (default: 300000 / 5min)
- `ENGINE_CHECKPOINT_CLEANUP_DAYS` (default: 7)
