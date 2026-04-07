# Plan 4: Follow-ups Automáticos (Post y Pre Reunión)

**Branch:** `feat/gcal-plan4-followups` (derivado de `claude/plan-google-calendar-W94gU`)
**Depende de:** Plan 1 (hook `calendar:event-created`) + Plan 2 (config de tiempos)
**Paralelo con:** Plan 3

---

## Objetivo

Implementar follow-ups automáticos que se disparan al crear un evento de calendario:
1. **Pre-reunión (recordatorio):** N horas antes, al invitado principal, por el mismo canal. Solo un "toque" — no espera respuesta.
2. **Post-reunión (seguimiento):** N minutos después, al invitado principal + coworker asignado (independiente). Pregunta cómo les fue.

Ambos configurables y desactivables desde la console (Plan 2 provee los settings).

---

## Patrón de referencia

Seguir exactamente el patrón de medilink follow-ups:
- `src/modules/medilink/follow-up-scheduler.ts` — lógica de scheduling (477 líneas)
- `src/modules/medilink/manifest.ts` lines 605-659 — hooks de webhook + message
- Usa `scheduled-tasks:api` para crear tasks + delayed jobs (NO crea BullMQ propio)

---

## Archivos a crear

### `src/migrations/047_gcal-followups.sql`

```sql
-- Calendar follow-up tracking
CREATE TABLE IF NOT EXISTS calendar_follow_ups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  calendar_event_id TEXT NOT NULL,
  event_summary TEXT,
  event_start TIMESTAMPTZ,
  event_end TIMESTAMPTZ,
  contact_id TEXT NOT NULL,
  target_type TEXT NOT NULL CHECK (target_type IN ('attendee_main', 'coworker')),
  target_contact_id TEXT,
  target_name TEXT,
  follow_up_type TEXT NOT NULL CHECK (follow_up_type IN ('pre_reminder', 'post_meeting')),
  channel TEXT NOT NULL,
  scheduled_at TIMESTAMPTZ NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'cancelled', 'failed')),
  bullmq_job_id TEXT,
  scheduled_task_id TEXT,
  error TEXT,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_cal_followups_event
  ON calendar_follow_ups(calendar_event_id);
CREATE INDEX IF NOT EXISTS idx_cal_followups_pending
  ON calendar_follow_ups(status) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_cal_followups_scheduled
  ON calendar_follow_ups(scheduled_at) WHERE status = 'pending';
```

---

### `src/modules/google-apps/calendar-followups.ts`

**Clase `CalendarFollowUpScheduler`:**

```typescript
import type { Pool } from 'pg'
import type { Registry } from '../../kernel/types.js'
import type { CalendarEvent, CalendarSchedulingConfig } from './types.js'

interface ScheduledTasksApi {
  createTask(input: {
    name: string
    prompt: string
    cron: string
    enabled?: boolean
    trigger_type?: string
    actions?: Array<{ type: string; toolName?: string; toolInput?: Record<string, unknown> }>
  }): Promise<{ id: string; name: string }>
  deleteTask(id: string): Promise<void>
  addDelayedJob(taskId: string, taskName: string, delayMs: number): Promise<string | null>
  removeJobById(jobId: string): Promise<void>
}
```

**Métodos públicos:**

#### `scheduleFollowUps(payload)`

Recibe el payload del hook `calendar:event-created`:
```typescript
async scheduleFollowUps(payload: {
  event: CalendarEvent
  contactId: string
  channel: string
  meetLink?: string | null
}): Promise<void>
```

Lógica:
1. Leer config: `registry.getOptional('google-apps:calendar-config')?.get()`
2. Si config no existe → no hacer nada (silencioso)
3. Obtener `scheduled-tasks:api` del registry → si no existe, log warning y salir
4. Parsear `event.start.dateTime` para obtener el timestamp del evento

**Si `config.followUpPre.enabled`:**
5. Calcular `scheduledAt = eventStart - config.followUpPre.hoursBefore * 3600_000`
6. Si `scheduledAt` ya pasó (evento es en menos de N horas) → skip pre-reminder
7. Si `scheduledAt` es razonable:
   - INSERT en `calendar_follow_ups`:
     ```sql
     INSERT INTO calendar_follow_ups (
       calendar_event_id, event_summary, event_start, event_end,
       contact_id, target_type, target_contact_id, target_name,
       follow_up_type, channel, scheduled_at, metadata
     ) VALUES ($1, $2, $3, $4, $5, 'attendee_main', $6, $7, 'pre_reminder', $8, $9, $10)
     RETURNING id
     ```
   - Crear scheduled task:
     ```typescript
     const task = await tasksApi.createTask({
       name: `Cal Pre-Reminder: ${event.summary}`,
       prompt: `Ejecuta recordatorio pre-reunión. Follow-up ID: ${followUpId}`,
       cron: '0 0 31 2 *',  // dummy cron, never fires
       trigger_type: 'manual',
       enabled: true,
       actions: [{
         type: 'tool',
         toolName: 'calendar-execute-followup',
         toolInput: { followUpId },
       }],
     })
     ```
   - Crear delayed job:
     ```typescript
     const delayMs = scheduledAt.getTime() - Date.now()
     const jobId = await tasksApi.addDelayedJob(task.id, task.name, delayMs)
     ```
   - Update record con jobId y taskId:
     ```sql
     UPDATE calendar_follow_ups
     SET bullmq_job_id = $1, scheduled_task_id = $2, updated_at = now()
     WHERE id = $3
     ```

**Si `config.followUpPost.enabled`:**
8. Calcular `scheduledAt = eventEnd + config.followUpPost.delayMinutes * 60_000`
   - Si el evento no tiene `end.dateTime`, usar `start.dateTime + defaultDurationMinutes`

9. **Para el invitado principal (el contacto/lead):**
   - INSERT en `calendar_follow_ups` con `target_type = 'attendee_main'`, `target_contact_id = contactId`
   - Crear scheduled task + delayed job (mismo patrón que pre-reminder)

10. **Para el coworker asignado (si hay attendees):**
    - Buscar el coworker entre los attendees del evento: iterar `event.attendees`, buscar en users module cuál es coworker
    - Si encuentra coworker:
      - Buscar su contactId en users module (`users:db`)
      - INSERT en `calendar_follow_ups` con `target_type = 'coworker'`
      - Crear scheduled task + delayed job independiente
    - Si no encuentra coworker → skip (solo follow-up al lead)

---

#### `cancelFollowUps(calendarEventId)`

```typescript
async cancelFollowUps(calendarEventId: string): Promise<void>
```

Lógica:
1. Query: `SELECT id, bullmq_job_id, scheduled_task_id FROM calendar_follow_ups WHERE calendar_event_id = $1 AND status = 'pending'`
2. Para cada record:
   - Si `bullmq_job_id`: `await tasksApi.removeJobById(bullmq_job_id)`
   - Si `scheduled_task_id`: `await tasksApi.deleteTask(scheduled_task_id)`
3. Update: `UPDATE calendar_follow_ups SET status = 'cancelled', updated_at = now() WHERE calendar_event_id = $1 AND status = 'pending'`

---

#### `rescheduleFollowUps(calendarEventId, newEvent)`

```typescript
async rescheduleFollowUps(calendarEventId: string, newEvent: CalendarEvent): Promise<void>
```

Lógica:
1. Obtener follow-ups pendientes del evento
2. Para cada uno:
   - Cancelar el job actual (removeJobById + deleteTask)
   - Recalcular `scheduledAt` basado en las nuevas fechas del evento
   - Si el nuevo `scheduledAt` ya pasó → marcar como `cancelled`
   - Si es válido → crear nuevo task + delayed job, update record

---

### Tool: `calendar-execute-followup`

**Registrar en tools.ts (o en calendar-followups.ts con registro via registry):**

```typescript
{
  name: 'calendar-execute-followup',
  displayName: 'Ejecutar seguimiento de calendario',
  description: 'Ejecuta un seguimiento programado (recordatorio o post-reunión) de un evento de calendario.',
  category: 'calendar',
  sourceModule: 'google-apps',
  parameters: {
    type: 'object',
    properties: {
      followUpId: { type: 'string', description: 'ID del follow-up a ejecutar [REQUIRED]' },
    },
    required: ['followUpId'],
  },
  handler: async (input) => {
    const followUpId = input.followUpId as string

    // Cargar follow-up de DB
    const result = await db.query(
      `SELECT * FROM calendar_follow_ups WHERE id = $1`,
      [followUpId],
    )
    const followUp = result.rows[0]
    if (!followUp || followUp.status !== 'pending') {
      return { success: true, data: 'Follow-up ya procesado o no encontrado. Skipped.' }
    }

    // Construir mensaje según tipo
    let message: string
    const targetName = followUp.target_name ?? 'ahí'

    if (followUp.follow_up_type === 'pre_reminder') {
      // Recordatorio pre-reunión — solo un toque, orgánico
      const eventDate = new Date(followUp.event_start)
      const timeStr = eventDate.toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' })
      const dateStr = eventDate.toLocaleDateString('es', { weekday: 'long', day: 'numeric', month: 'long' })
      message = `Hola${targetName !== 'ahí' ? ' ' + targetName : ''}! Te recuerdo que tienes ${followUp.event_summary ?? 'una reunión'} el ${dateStr} a las ${timeStr}. ¡Te esperamos!`
    } else {
      // Post-reunión — pregunta cómo le fue, casual
      message = `Hola${targetName !== 'ahí' ? ' ' + targetName : ''}! ¿Cómo te fue en ${followUp.event_summary ?? 'la reunión'}?`
    }

    // Enviar por el mismo canal
    try {
      await registry.runHook('message:send', {
        channel: followUp.channel,
        to: followUp.target_contact_id,
        content: { type: 'text', text: message },
      })

      // Marcar como enviado
      await db.query(
        `UPDATE calendar_follow_ups SET status = 'sent', updated_at = now() WHERE id = $1`,
        [followUpId],
      )
      return { success: true, data: `Follow-up enviado a ${followUp.target_contact_id}` }
    } catch (err: any) {
      // Marcar como failed
      await db.query(
        `UPDATE calendar_follow_ups SET status = 'failed', error = $1, updated_at = now() WHERE id = $2`,
        [err?.message ?? 'unknown error', followUpId],
      )
      return { success: false, error: `Error enviando follow-up: ${err?.message}` }
    }
  },
}
```

---

## Archivos a modificar

### `src/modules/google-apps/manifest.ts`

**En `init()`:**

```typescript
// Inicializar follow-up scheduler (después de calendar config service)
import { CalendarFollowUpScheduler } from './calendar-followups.js'

let calendarFollowUpScheduler: CalendarFollowUpScheduler | null = null

// Dentro de init():
if (enabledServices.has('calendar')) {
  calendarFollowUpScheduler = new CalendarFollowUpScheduler(db, registry)

  // Hook: cuando se crea un evento → programar follow-ups
  registry.addHook('google-apps', 'calendar:event-created', async (payload) => {
    try {
      await calendarFollowUpScheduler?.scheduleFollowUps(payload)
    } catch (err) {
      log.warn({ err }, 'Failed to schedule calendar follow-ups')
    }
  }, 100)

  // Hook: cuando se elimina un evento → cancelar follow-ups
  registry.addHook('google-apps', 'calendar:event-deleted', async (payload) => {
    try {
      await calendarFollowUpScheduler?.cancelFollowUps(payload.eventId)
    } catch (err) {
      log.warn({ err }, 'Failed to cancel calendar follow-ups')
    }
  }, 100)

  // Hook: cuando se actualiza un evento → reagendar follow-ups si cambió fecha
  registry.addHook('google-apps', 'calendar:event-updated', async (payload) => {
    try {
      if (payload.dateChanged) {
        await calendarFollowUpScheduler?.rescheduleFollowUps(payload.eventId, payload.event)
      }
    } catch (err) {
      log.warn({ err }, 'Failed to reschedule calendar follow-ups')
    }
  }, 100)

  // Registrar tool de ejecución de follow-ups
  registerCalendarFollowUpTool(registry, db)
}
```

**En `stop()`:**

```typescript
calendarFollowUpScheduler = null
```

---

### `src/modules/google-apps/tools.ts`

**En tool `calendar-delete-event` (ya modificado en Plan 1):**
- Asegurar que emite hook `calendar:event-deleted` con `{ eventId }`
- (Plan 1 ya debe haber agregado esto, verificar)

**En tool `calendar-update-event` (ya modificado en Plan 1):**
- Asegurar que emite hook `calendar:event-updated` con `{ eventId, event, dateChanged }` cuando cambia start/end
- (Plan 1 ya debe haber agregado esto, verificar)

**Agregar registro del tool `calendar-execute-followup`:**
- Puede estar en una función `registerCalendarFollowUpTool(registry, db)` exportada desde `calendar-followups.ts`
- O registrarse directamente en `tools.ts` dentro del bloque de calendar tools

---

## Flujo completo

### Creación de evento:
```
1. Subagent o usuario crea evento via calendar-create-event
2. Tool emite hook: calendar:event-created { event, contactId, channel }
3. CalendarFollowUpScheduler.scheduleFollowUps() recibe el hook
4. Lee config → followUpPre.enabled=true, hoursBefore=24
5. Calcula: evento es mañana 10:00 → pre-reminder hoy 10:00
6. INSERT calendar_follow_ups (pre_reminder, pending)
7. Crea scheduled task + delayed job (delay = 24h)
8. Lee config → followUpPost.enabled=true, delayMinutes=60
9. Calcula: evento termina mañana 10:30 → post a las 11:30
10. INSERT calendar_follow_ups (post_meeting, attendee_main, pending)
11. INSERT calendar_follow_ups (post_meeting, coworker, pending)
12. Crea 2 scheduled tasks + 2 delayed jobs
```

### Ejecución del pre-reminder (24h antes):
```
1. BullMQ delayed job fires
2. Scheduled task ejecuta action: tool calendar-execute-followup { followUpId }
3. Tool carga record de DB
4. Construye mensaje: "Hola Juan! Te recuerdo que tienes Reunión - Juan Pérez el miércoles 14 a las 10:00. ¡Te esperamos!"
5. Envía via message:send hook al canal original (ej: whatsapp)
6. Marca status = 'sent'
```

### Ejecución del post-meeting (1h después):
```
1. BullMQ delayed job fires (invitado principal)
2. Tool envía: "Hola Juan! ¿Cómo te fue en Reunión - Juan Pérez?"
3. BullMQ delayed job fires (coworker - job independiente)
4. Tool envía: "Hola Felipe! ¿Cómo te fue en Reunión - Juan Pérez?"
```

### Cancelación de evento:
```
1. Subagent o usuario cancela via calendar-delete-event
2. Tool emite hook: calendar:event-deleted { eventId }
3. CalendarFollowUpScheduler.cancelFollowUps(eventId)
4. Query follow-ups pendientes del evento
5. Cancela jobs de BullMQ + deleta scheduled tasks
6. Marca status = 'cancelled'
```

---

## Criterios de aceptación

- [ ] Migración 047 crea tabla `calendar_follow_ups` sin errores
- [ ] Al crear evento con followUpPre.enabled → se crea record + delayed job pre-reminder
- [ ] Al crear evento con followUpPost.enabled → se crean records + delayed jobs post-meeting (1 por attendee_main + 1 por coworker)
- [ ] Pre-reminder se ejecuta N horas antes del evento
- [ ] Post-meeting se ejecuta N minutos después del evento
- [ ] Mensajes son orgánicos y contextuales (nombre, fecha, título del evento)
- [ ] Se envían por el mismo canal donde se agendó la cita
- [ ] Al eliminar evento → se cancelan todos los follow-ups pendientes
- [ ] Al reagendar evento (cambio de fecha) → se recalculan los follow-ups
- [ ] Si el pre-reminder ya pasó (evento inminente) → se skipea silenciosamente
- [ ] Config de tiempos y toggles se leen de `google-apps:calendar-config`
- [ ] Si `scheduled-tasks:api` no está disponible → log warning, no crash
- [ ] Si `google-apps:calendar-config` no está disponible → no schedule nada
- [ ] Tool `calendar-execute-followup` maneja errores gracefully (marca como failed, no crashea)
- [ ] TypeScript compila sin errores

---

## Notas para el ejecutor

- **Leer `src/modules/medilink/follow-up-scheduler.ts`** como referencia principal — es el patrón exacto a seguir
- **`scheduled-tasks:api` interface** — verificar el tipo exacto leyendo `src/modules/scheduled-tasks/manifest.ts` (dónde provee el servicio)
- **Dummy cron `'0 0 31 2 *'`** — es el patrón de medilink: un cron que nunca se ejecuta (31 de febrero). El delayed job es el que realmente dispara la ejecución
- **`message:send` hook** — verificar la interfaz exacta del payload leyendo cómo otros módulos envían mensajes (ej: medilink follow-up-scheduler.ts sendWhatsApp)
- **Encontrar coworker contactId** — el follow-up post al coworker necesita su contactId (no su userId). Buscar en `users:db` el coworker por email (del attendee del evento) y obtener su contactId del canal apropiado
- **NO enviar por LLM** — los mensajes de follow-up son predefinidos/templated, no generados por LLM. Esto es por diseño (predictibilidad, costo)
- **Fire-and-forget** — los hooks de follow-up scheduling deben ser fire-and-forget. Errores logueados pero nunca propagados al caller del tool
