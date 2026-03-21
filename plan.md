# Plan de Implementación: Módulo Scheduled Tasks

## Resumen de decisiones
- **Colas BullMQ**: Independientes (`luna:scheduled-scanner`, `luna:scheduled-ops`)
- **tenant_id**: Se mantiene con valor fijo `'default'` por ahora
- **Handlers operacionales**: Stubs + hooks extensibles. Solo `custom` implementado completo (LLM)
- **Modo async**: Batch nocturno — jobs marcados async se acumulan y procesan a las 2 AM

## Módulo: `src/modules/scheduled-tasks/`

---

### Paso 1: Tipos y schemas (`types.ts`)

Definir interfaces TypeScript:
- `ScheduledTask` — fila de `scheduled_tasks` (todos los campos del spec)
- `ScheduledTaskLog` — fila de `scheduled_tasks_log`
- `TaskType`: `'contact_batch' | 'operational'`
- `FrequencyType`: `'hourly' | 'daily' | 'weekly' | 'monthly'`
- `ActionType`: `'generate_report' | 'sync_external' | 'refresh_cache' | 'cleanup' | 'custom'`
- `TaskFormData` — payload del formulario (para validación Zod)
- `PreviewResult` — `{ total_matches, sample[], warnings[] }`
- `ActionHandler` — `(task: ScheduledTask, log: ScheduledTaskLog) => Promise<ActionResult>`
- `ActionResult` — `{ success, output?, error? }`

Definir schemas Zod para validación del formulario (reutilizar en manifest configSchema y en POST /save):
- `taskFormSchema` — validación completa del formulario con refinements condicionales (contact_batch requiere max_per_run, operational requiere action_type, etc.)

---

### Paso 2: Base de datos (`db.ts`)

**Tablas a crear en `init()`:**

1. `scheduled_tasks` — según spec (con tenant_id DEFAULT 'default')
   - Índices: `idx_st_tenant_enabled`, `idx_st_tenant_title` (UNIQUE), `idx_st_cron`

2. `scheduled_tasks_log` — según spec
   - Índices: `idx_stl_task_id`, `idx_stl_running`

**Funciones de query:**
- `createTask(data)` → INSERT + RETURNING
- `updateTask(id, data)` → UPDATE
- `getTask(id)` → SELECT single
- `listTasks()` → SELECT all, ordered by created_at DESC
- `toggleTask(id, enabled)` → UPDATE enabled
- `deleteTask(id)` → DELETE (hard delete, o soft si prefieres)
- `getEnabledTasks()` → SELECT WHERE enabled = true (para scheduler)
- `insertLog(taskId, status)` → INSERT log entry
- `updateLog(logId, data)` → UPDATE log con resultados
- `getTaskLogs(taskId, limit)` → SELECT logs de una tarea
- `getRunningLogs()` → SELECT WHERE status = 'running' (para detectar colgados)
- `countTasksByType(type)` → COUNT para límites hard-coded
- `updateTaskStats(taskId, lastRunAt, totalRuns, totalContactsReached)` → UPDATE metadata

---

### Paso 3: Cron builder (`cron-builder.ts`)

Función pura `buildCronExpression(frequencyType, executionTime, executionDays?, intervalHours?)` → string cron de 5 campos.

Lógica:
- `hourly` + interval_hours=2 + execution_time=09:00 → `0 9/2 * * *` (cada 2h desde las 9)
- `daily` + execution_time=09:30 + days=[1,2,3,4,5] → `30 9 * * 1-5`
- `weekly` + execution_time=10:00 + days=[1] → `0 10 * * 1`
- `monthly` + execution_time=08:00 → `0 8 1 * *` (día 1 del mes)

Función inversa `describeCron(cron)` → descripción legible en español (para UI).

---

### Paso 4: Contact scanner (`contact-scanner.ts`)

Construye SQL parametrizado a partir de los filtros de una tarea `contact_batch`.

**`buildContactQuery(task: ScheduledTask)`** → `{ sql: string, params: any[] }`

Filtros:
- `filter_status` → `c.qualification_status = ANY($N)`
- `filter_days_inactive` → `c.last_interaction_at < now() - interval '$N days'` (gte/lte)
- `filter_max_prior_attempts` → subquery contra `scheduled_tasks_log` o `proactive_outreach_log` contando envíos previos de esta task_id
- `filter_source` → `ac.source_channel = ANY($N)`
- `filter_contact_type` → `c.contact_type = ANY($N)`

Ordenamiento: menos intentos previos primero, luego por `last_interaction_at` ASC (más antiguos primero).

**`executePreview(task)`** → ejecuta query con `COUNT(*)` + `LIMIT 10`, genera warnings.

**`executeScan(task)`** → ejecuta query con `LIMIT max_per_run`, retorna `contactId[]` con info de canal.

---

### Paso 5: Ops runner (`ops-runner.ts`)

Registry de action handlers con patrón hook.

```typescript
class OpsRunner {
  private handlers = new Map<string, ActionHandler>()

  registerHandler(actionType: string, handler: ActionHandler)

  async run(task: ScheduledTask, logId: string): Promise<ActionResult> {
    // 1. Buscar handler registrado
    // 2. Si no hay handler y type !== 'custom' → fire hook 'scheduled:action:{type}'
    // 3. Si type === 'custom' → pasar instrucciones al LLM evaluador
    // 4. Si hay resultado y deliver_to !== null → enviar por deliver_channel
  }
}
```

El handler `custom` usa el servicio `llm:gateway` para interpretar las instrucciones.

---

### Paso 6: Scheduler (`scheduler.ts`)

Core del módulo — gestiona BullMQ y reconciliación.

**Colas:**
- `luna:scheduled-scanner` — concurrencia 3, para contact_batch scanners
- `luna:scheduled-ops` — concurrencia 2, para tareas operacionales
- `luna:scheduled-ops-nightly` — concurrencia 1, para tareas async (batch nocturno 2 AM)

**Workers:**
- Scanner worker: lee tarea → `executeScan()` → encola cada contacto en cola proactiva (SI proactividad está activa) O procesa directamente via pipeline (si no)
- Ops worker: lee tarea → `opsRunner.run()` → log resultado
- Nightly worker: cron `0 2 * * *`, procesa todos los jobs async acumulados

**Reconciliación (cada 60s):**
1. `SELECT id, cron_expression, enabled, task_type FROM scheduled_tasks`
2. Comparar con jobs repeatables registrados en BullMQ
3. Agregar nuevos, remover desactivados, actualizar cron cambiados

**Idempotencia:** Redis lock `scheduled:running:{taskId}:{date}` con TTL 30min.

**Detección de colgados:** cada 5min, buscar logs con `status = 'running'` hace > 30min → marcar `failed`.

**Límites hard-coded:** aplicar al encolar (max 20 contact_batch, max 15 operational, etc.)

---

### Paso 7: Integración con pipeline proactivo

Cuando el scheduler procesa un contacto de `contact_batch`:

**Si el módulo proactivo está activo:**
- Encolar en `luna:proactive` con `trigger_type: 'scheduled_task'`, `task_id`, las `instructions` y `allowed_tools`
- Los guards existentes aplican (horario, dedup, cooldown, rate limit)
- Necesita: agregar `'scheduled_task'` al CHECK constraint de `proactive_outreach_log.trigger_type`

**Si el módulo proactivo NO está activo:**
- Procesar directamente: cargar contacto → compositor (si use_compositor=true) o template → enviar via hook `message:send`
- Sin guards (el módulo aplica sus propios límites básicos: max_per_run, max_prior_attempts)

Esto requiere detectar si el engine proactivo está disponible:
```typescript
const proactiveRunner = registry.getOptional<ProactiveRunner>('engine:proactiveRunner')
```

---

### Paso 8: Templates oficina (`templates.ts`)

Páginas SSR siguiendo el patrón de oficina:

1. **Lista** (`/oficina/tareas`) — tabla con: título, tipo, frecuencia, estado (enabled/disabled), última ejecución, próxima ejecución, botones (editar, toggle, eliminar, run now)

2. **Formulario nuevo** (`/oficina/tareas/nueva`) — dos pasos:
   - Paso 1: elegir tipo (contact_batch / operational)
   - Paso 2: formulario adaptado con los campos del spec
   - Campo `async_processing` (solo operational): toggle con mensaje explicativo "Los procesos async son más baratos pero pueden tardar hasta 24 horas. Recomendado solo para informes de uso y análisis de datos grandes."

3. **Detalle** (`/oficina/tareas/:id`) — config de la tarea + tabla de historial de ejecuciones + botón "Ejecutar ahora"

4. **Formulario edición** (`/oficina/tareas/:id/editar`) — formulario pre-poblado

5. **Preview modal** — al crear contact_batch: muestra total, sample de 10, warnings. Botón "Confirmar y activar"

---

### Paso 9: API routes (`api-routes.ts`)

Siguiendo el patrón de apiRoutes en manifest.oficina:

| Método | Ruta | Handler |
|--------|------|---------|
| GET | `/oficina/tareas` | `renderListPage()` |
| GET | `/oficina/tareas/nueva` | `renderNewForm()` |
| POST | `/oficina/tareas/save` | `handleSave()` — Zod validate, build cron, INSERT/UPDATE |
| GET | `/oficina/tareas/:id` | `renderDetailPage()` |
| GET | `/oficina/tareas/:id/editar` | `renderEditForm()` |
| POST | `/oficina/tareas/:id/toggle` | `handleToggle()` — toggle enabled, trigger reconcile |
| POST | `/oficina/tareas/:id/delete` | `handleDelete()` |
| POST | `/oficina/api/scheduled-tasks/preview` | `handlePreview()` — JSON response |
| POST | `/oficina/api/scheduled-tasks/run-now` | `handleRunNow()` — encolar ejecución inmediata |

**Nota:** Las páginas SSR se sirven desde el handler de oficina (el módulo se registra como sección de oficina con su propio routing), no como apiRoutes normales. Las rutas API (preview, run-now) sí van como apiRoutes.

---

### Paso 10: Manifest (`manifest.ts`)

```typescript
{
  name: 'scheduled-tasks',
  version: '1.0.0',
  description: { es: 'Tareas programadas', en: 'Scheduled tasks' },
  type: 'feature',
  removable: true,
  activateByDefault: true,
  depends: ['llm'],  // para custom handler. NO depende de engine/proactivity
  configSchema: z.object({
    SCHEDULED_TASKS_RECONCILE_INTERVAL_MS: numEnv(60000),
    SCHEDULED_TASKS_SCANNER_TIMEOUT_MS: numEnv(300000),
    SCHEDULED_TASKS_OPS_TIMEOUT_MS: numEnv(600000),
    SCHEDULED_TASKS_NIGHTLY_CRON: z.string().default('0 2 * * *'),
  }),
  oficina: {
    title: { es: 'Tareas Programadas', en: 'Scheduled Tasks' },
    order: 20,
    apiRoutes: [
      { method: 'POST', path: 'preview', handler: handlePreview },
      { method: 'POST', path: 'run-now', handler: handleRunNow },
    ],
  },
  async init(registry) {
    // 1. Crear tablas
    // 2. Instanciar OpsRunner, registrar handlers stub + custom
    // 3. Instanciar Scheduler, iniciar reconciliación
    // 4. Registrar páginas oficina via hook o servicio
    // 5. Provide services: 'scheduled-tasks:scheduler', 'scheduled-tasks:ops-runner'
  },
  async stop() {
    // Detener scheduler, cerrar workers BullMQ
  }
}
```

---

### Paso 11: Campo async_processing

**Columna DB:** `async_processing BOOLEAN DEFAULT false` en `scheduled_tasks` (solo operational)

**UI:** Toggle en formulario operational con texto:
> "Procesamiento asíncrono — Los procesos async son más baratos pero pueden tardar hasta 24 horas. Recomendado solo para informes de uso y análisis de datos grandes."

**Lógica:** Si `async_processing = true`, el job NO se ejecuta en el momento del cron. En vez:
1. Al trigger del cron, se registra el job en una tabla/cola de "pendientes nocturnos"
2. El worker `luna:scheduled-ops-nightly` (cron 2 AM configurable) los procesa todos juntos
3. Si el action handler usa LLM, se puede usar el endpoint batch de la API (si disponible) para reducir costos

---

### Paso 12: CLAUDE.md del módulo

Crear `src/modules/scheduled-tasks/CLAUDE.md` documentando: propósito, archivos, manifest, hooks, servicios, API routes, patrones, trampas.

---

### Paso 13: Migración SQL

Crear `docs/migrations/s-scheduled-tasks-v1.sql` con:
- CREATE TABLE scheduled_tasks
- CREATE TABLE scheduled_tasks_log
- Índices
- ALTER TABLE proactive_outreach_log (agregar 'scheduled_task' al CHECK si existe)

---

## Orden de implementación

1. `types.ts` — tipos y schemas Zod
2. `db.ts` — tablas + queries
3. `cron-builder.ts` — conversión frecuencia → cron
4. `contact-scanner.ts` — SQL builder para filtros
5. `ops-runner.ts` — registry de action handlers
6. `scheduler.ts` — BullMQ colas + reconciliación + workers
7. `templates.ts` — páginas SSR oficina
8. `api-routes.ts` — endpoints de oficina
9. `manifest.ts` — integración con kernel
10. Migración SQL
11. CLAUDE.md
12. Actualizar CLAUDE.md raíz (agregar módulo a lista)

## Archivos a crear
```
src/modules/scheduled-tasks/
  manifest.ts
  types.ts
  db.ts
  cron-builder.ts
  contact-scanner.ts
  ops-runner.ts
  scheduler.ts
  templates.ts
  api-routes.ts
  CLAUDE.md
docs/migrations/
  s-scheduled-tasks-v1.sql
```

## Archivos a modificar
- `CLAUDE.md` (raíz) — agregar scheduled-tasks a lista de módulos documentados
- Posiblemente `src/engine/proactive/proactive-runner.ts` — si se integra con cola proactiva
- Posiblemente `docs/migrations/s-proactive-v1.sql` — agregar trigger_type si se usa outreach_log
