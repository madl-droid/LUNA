# Scheduled Tasks — Tareas programadas del agente

Modulo para crear y gestionar tareas que el agente ejecuta automaticamente segun un horario cron definido por el usuario. Usa BullMQ para scheduling y el hook `llm:chat` para ejecucion.

## Archivos
- `manifest.ts` — lifecycle, config schema, oficina def, API routes
- `types.ts` — ScheduledTask, TaskExecution, CreateTaskInput, UpdateTaskInput, config
- `store.ts` — CRUD PostgreSQL (scheduled_tasks + scheduled_task_executions)
- `scheduler.ts` — BullMQ queue/worker para cron scheduling
- `executor.ts` — ejecuta tarea via `llm:chat` hook con tools opcionales
- `api-routes.ts` — REST endpoints: list, create, update, delete, trigger, executions
- `templates.ts` — HTML SSR para seccion de oficina (lista, formulario, modal resultado)

## Manifest
- **type**: `feature`
- **depends**: `['llm']`
- **configSchema**: `SCHEDULED_TASKS_ENABLED`, `SCHEDULED_TASKS_MAX_CONCURRENT`, `SCHEDULED_TASKS_EXECUTION_TIMEOUT_MS`

## Servicios expuestos
- `scheduled-tasks:renderSection` — funcion `(lang) => Promise<string>` que renderiza la seccion para oficina

## API routes (bajo /oficina/api/scheduled-tasks/)
- `GET list` — lista todas las tareas
- `POST create` — crea tarea (name, prompt, cron, enabled)
- `PUT update` — actualiza tarea (id + campos opcionales)
- `DELETE delete` — elimina tarea (id)
- `POST trigger` — ejecuta tarea manualmente (id)
- `GET executions?taskId=X` — historial de ejecuciones

## Tablas SQL
- `scheduled_tasks` — id, name, prompt, cron, enabled, timestamps, last_run_at/status/result
- `scheduled_task_executions` — id, task_id (FK), started_at, finished_at, status, result, error

## Patron de ejecucion
1. BullMQ repeatable job dispara segun cron
2. Worker lee tarea de PG, verifica enabled
3. Executor llama `llm:chat` con prompt de la tarea + tools del registry
4. Si hay tool_calls, los ejecuta via `tools:executor`
5. Guarda resultado en execution + last_run de la tarea

## Trampas
- API routes se populan en init() (mutando manifest.oficina.apiRoutes)
- El render HTML se provee via registry service, no import directo — oficina lo consume via `getOptional`
- BullMQ connection usa host/port/password extraidos de redis.options (mismo patron que proactive-runner)
- Tasks no reintentan por defecto (attempts: 1) — son tareas de usuario, no jobs internos
