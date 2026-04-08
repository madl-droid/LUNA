# Scheduled Tasks — Tareas programadas del agente

Modulo para crear y gestionar tareas que el agente ejecuta automaticamente. Soporta cron, eventos del sistema y ejecucion manual. Incluye destinatarios (grupos/usuarios), acciones post-ejecucion (tools, mensajes, hooks) y UI nativa en console.

## Archivos
- `manifest.ts` — lifecycle, config schema, console def, API routes, event hooks
- `types.ts` — ScheduledTask, TaskRecipient, TaskAction, TriggerType, UserGroupInfo
- `store.ts` — CRUD PostgreSQL (scheduled_tasks + scheduled_task_executions, JSONB)
- `scheduler.ts` — BullMQ queue/worker para cron scheduling
- `executor.ts` — ejecuta tarea via `llm:chat` + actions (tools, mensajes, hooks)
- `api-routes.ts` — REST endpoints: list, create, update, delete, trigger, executions, groups, tools
- `templates.ts` — HTML SSR completo con formulario de destinatarios, acciones y triggers

## Manifest
- **type**: `feature`
- **depends**: `['llm']`
- **configSchema**: `SCHEDULED_TASKS_ENABLED`, `SCHEDULED_TASKS_MAX_CONCURRENT`, `SCHEDULED_TASKS_EXECUTION_TIMEOUT_MS`, `SCHEDULED_TASKS_MAX_MSG_PER_CONTACT_PER_HOUR` (0=ilimitado, default 10)

## Servicios expuestos
- `scheduled-tasks:renderSection` — `(lang) => Promise<string>` renderiza la seccion para console

## API routes (bajo /console/api/scheduled-tasks/)
- `GET list` — lista todas las tareas
- `GET groups` — grupos de usuarios con sus miembros (para dropdown)
- `GET tools` — herramientas disponibles (para selector de acciones)
- `POST create` — crea tarea con recipient, actions, trigger
- `PUT update` — actualiza tarea
- `DELETE delete` — elimina tarea
- `POST trigger` — ejecuta tarea manualmente
- `GET executions?taskId=X` — historial de ejecuciones

## Tablas SQL
- `scheduled_tasks` — id, name, prompt, cron, trigger_type, trigger_event, recipient (JSONB), actions (JSONB), timestamps
- `scheduled_task_executions` — id, task_id (FK), started_at, finished_at, status, result, error

## Triggers soportados
- **cron** — BullMQ repeatable job segun expresion cron
- **event** — hooks del kernel: contact:new, contact:status_changed, message:incoming, module:activated/deactivated
- **manual** — solo ejecutable via boton o API /trigger

## Destinatarios (TaskRecipient)
- `none` — sin destinatario (solo ejecuta el prompt)
- `group` — todos los usuarios de un grupo (admin, coworker, lead, custom)
- `user` — usuario especifico dentro de un grupo
- Se usa `registry.getOptional('users:db')` para listar grupos y usuarios

## Acciones (TaskAction)
- `tool` — ejecuta una herramienta registrada via tools:executor
- `message` — envia mensaje a los destinatarios via message:send hook
- `hook` — dispara un hook arbitrario del kernel
- Placeholder `{{result}}` en textos se reemplaza por el output del LLM

## Rate limiting (FIX-01)
- Mensajes de action `message` respetan límite `SCHEDULED_TASKS_MAX_MSG_PER_CONTACT_PER_HOUR` (default 10)
- Rate limit atómico en Redis: clave `ratelimit:scheduled-task:{senderId}:hourly`, TTL 3600s
- 0 = ilimitado. Si rate-limited, se loguea WARN y se salta el destinatario

## Persistencia de mensajes (FIX-02)
- Tras enviar un mensaje de action `message`, se persiste en memoria via `memory:manager`
- Busca sesión activa del destinatario (JOIN contact_channels + sessions)
- Fire-and-forget: si no hay sesión activa, se omite sin error
- Metadata incluye `source: 'scheduled-task'` y `taskId` para auditoría

## JobId uniqueness (FIX-03)
- `addDelayedJob` usa `delayed-{taskId}-{Date.now()}` como jobId (único por llamada)
- Evita deduplicación silenciosa de BullMQ al reprogramar. Colons reemplazados por hyphens (BullMQ los rechaza)

## Cron validation (FIX-04)
- `scheduleTask` envuelve `queue.add` en try/catch
- Expresión cron inválida → log ERROR claro, tarea skipeada, módulo sigue funcionando
- Solo tareas `trigger_type='cron'` se registran como repeatable en BullMQ

## JobId uniqueness (FIX-03 + FIX-04)
- `addDelayedJob` usa `delayed-{taskId}-{Date.now()}` como jobId (único por llamada)
- Repeatable jobs usan `scheduled-{taskId}` (con guion, no dos puntos — BullMQ rechaza `:`)
- `unscheduleTask` acepta ambos formatos (`scheduled-` y `scheduled:`) para migración

## Trampas
- API routes se populan en init() mutando manifest.console.apiRoutes
- El render HTML se provee via registry service (no import directo)
- BullMQ connection usa host/port/password de redis.options
- Migraciones ALTER TABLE IF NOT EXISTS corren en ensureTables
- Event hooks se registran con prioridad 100 (baja) para no bloquear otros handlers
- Tareas de evento/manual usan cron placeholder `0 0 1 1 *` para satisfacer schema. No se registran como repeatable en BullMQ.
- Solo tareas `trigger_type='cron'` se registran como repeatable; manual/event se disparan via API/hooks/delayed jobs
