// LUNA — Module: google-apps — Calendar Follow-Up Scheduler
// Programa recordatorios pre-reunión y seguimientos post-reunión cuando se crea un evento.
// Delega a scheduled-tasks (NO crea su propio BullMQ). Patrón: medilink/follow-up-scheduler.ts

import pino from 'pino'
import type { Pool } from 'pg'
import type { Registry } from '../../kernel/registry.js'
import type { CalendarEvent, CalendarSchedulingConfig } from './types.js'
import type { ToolRegistry } from '../tools/tool-registry.js'

const logger = pino({ name: 'google-apps:calendar-followups' })

// ─── Scheduled-tasks service type ──────────────────

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

// ─── UsersDb interface (minimal, shared with manifest.ts) ─────────────────

export interface CalendarUsersDb {
  listByType(listType: string, activeOnly?: boolean): Promise<Array<{
    id: string
    displayName?: string
    contacts?: Array<{ channel: string; senderId: string }>
    metadata?: unknown
  }>>
  getListConfig?(listType: string): Promise<{
    syncConfig?: Record<string, unknown>
  } | null>
}

// ─── CalendarFollowUpScheduler ─────────────────────

export class CalendarFollowUpScheduler {
  constructor(
    private readonly db: Pool,
    private readonly registry: Registry,
  ) {}

  private getTasksApi(): ScheduledTasksApi | null {
    return this.registry.getOptional<ScheduledTasksApi>('scheduled-tasks:api')
  }

  private getConfig(): CalendarSchedulingConfig | null {
    const svc = this.registry.getOptional<{ get(): CalendarSchedulingConfig }>('google-apps:calendar-config')
    return svc?.get() ?? null
  }

  // ─── Schedule follow-ups when event is created ───

  async scheduleFollowUps(payload: {
    event: CalendarEvent | null | undefined
    contactId: string | null | undefined
    channel: string | null | undefined
    meetLink?: string | null
  }): Promise<void> {
    const { event, contactId, channel } = payload

    if (!event || !contactId || !channel) {
      logger.debug({ event: !!event, contactId, channel }, 'Missing required payload fields — skipping follow-ups')
      return
    }

    const config = this.getConfig()
    if (!config) {
      logger.debug('calendar-config not available — skipping follow-ups')
      return
    }

    const tasksApi = this.getTasksApi()
    if (!tasksApi) {
      logger.warn('scheduled-tasks:api not available — follow-ups will not be scheduled')
      return
    }

    const eventStartStr = event.start.dateTime ?? event.start.date
    const eventEndStr = event.end.dateTime ?? event.end.date

    if (!eventStartStr) {
      logger.warn({ eventId: event.id }, 'Event has no start dateTime — skipping follow-ups')
      return
    }

    const eventStart = new Date(eventStartStr)
    const defaultDuration = config.defaultDurationMinutes ?? 30
    const eventEnd = eventEndStr ? new Date(eventEndStr) : new Date(eventStart.getTime() + defaultDuration * 60_000)

    if (isNaN(eventStart.getTime())) {
      logger.warn({ eventId: event.id, eventStartStr }, 'Invalid event start date — skipping follow-ups')
      return
    }

    const now = Date.now()

    // ── Pre-reminder ─────────────────────────────────
    if (config.followUpPre.enabled) {
      const scheduledAt = new Date(eventStart.getTime() - config.followUpPre.hoursBefore * 3_600_000)

      if (scheduledAt.getTime() <= now) {
        logger.debug({ eventId: event.id }, 'Pre-reminder window already passed — skipping')
      } else {
        await this.createFollowUp({
          tasksApi,
          event,
          contactId,
          channel,
          eventStart,
          eventEnd,
          followUpType: 'pre_reminder',
          targetType: 'attendee_main',
          targetContactId: contactId,
          targetName: null,
          scheduledAt,
        })
      }
    }

    // ── Post-meeting ──────────────────────────────────
    if (config.followUpPost.enabled) {
      const scheduledAt = new Date(eventEnd.getTime() + config.followUpPost.delayMinutes * 60_000)

      // Post for the lead/attendee
      await this.createFollowUp({
        tasksApi,
        event,
        contactId,
        channel,
        eventStart,
        eventEnd,
        followUpType: 'post_meeting',
        targetType: 'attendee_main',
        targetContactId: contactId,
        targetName: null,
        scheduledAt,
      })

      // Post for coworker (independent job)
      await this.scheduleCoworkerFollowUp({
        tasksApi,
        event,
        contactId,
        channel,
        eventStart,
        eventEnd,
        scheduledAt,
      })
    }
  }

  // ─── Find coworker among event attendees ──────────

  private async scheduleCoworkerFollowUp(params: {
    tasksApi: ScheduledTasksApi
    event: CalendarEvent
    contactId: string
    channel: string
    eventStart: Date
    eventEnd: Date
    scheduledAt: Date
  }): Promise<void> {
    const { tasksApi, event, contactId, channel, eventStart, eventEnd, scheduledAt } = params

    const attendees = event.attendees ?? []
    if (attendees.length === 0) return

    const usersDb = this.registry.getOptional<CalendarUsersDb>('users:db')
    if (!usersDb) {
      logger.debug('users:db not available — skipping coworker follow-up')
      return
    }

    try {
      const coworkers = await usersDb.listByType('coworker', true)

      // Build email → coworker map for O(1) lookup
      for (const attendee of attendees) {
        if (!attendee.email || attendee.self) continue

        const coworker = coworkers.find((cw) =>
          cw.contacts?.some((c) => c.channel === 'email' && c.senderId.toLowerCase() === attendee.email!.toLowerCase()),
        )

        if (!coworker) continue

        // Use the same channel as the main contact, or email if coworker channel is available
        // Find coworker's contact for the same channel, fallback to email
        const coworkerContact = coworker.contacts?.find((c) => c.channel === channel)
          ?? coworker.contacts?.find((c) => c.channel === 'email')

        if (!coworkerContact) {
          logger.debug({ coworkerId: coworker.id }, 'Coworker has no contact for channel — skipping')
          continue
        }

        await this.createFollowUp({
          tasksApi,
          event,
          contactId,
          channel: coworkerContact.channel,
          eventStart,
          eventEnd,
          followUpType: 'post_meeting',
          targetType: 'coworker',
          targetContactId: coworkerContact.senderId,
          targetName: coworker.displayName ?? null,
          scheduledAt,
        })

        // Only the first matching coworker receives post-meeting follow-up
        // (events typically have 1 assigned coworker)
        break
      }
    } catch (err) {
      logger.warn({ err }, 'Error finding coworker for follow-up — skipping')
    }
  }

  // ─── Insert + schedule one follow-up ─────────────

  private async createFollowUp(params: {
    tasksApi: ScheduledTasksApi
    event: CalendarEvent
    contactId: string
    channel: string
    eventStart: Date
    eventEnd: Date
    followUpType: 'pre_reminder' | 'post_meeting'
    targetType: 'attendee_main' | 'coworker'
    targetContactId: string
    targetName: string | null
    scheduledAt: Date
  }): Promise<void> {
    const {
      tasksApi, event, contactId, channel,
      eventStart, eventEnd,
      followUpType, targetType, targetContactId, targetName, scheduledAt,
    } = params

    try {
      // 1. Insert record
      const result = await this.db.query<{ id: string }>(
        `INSERT INTO calendar_follow_ups (
          calendar_event_id, event_summary, event_start, event_end,
          contact_id, target_type, target_contact_id, target_name,
          follow_up_type, channel, scheduled_at, metadata
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
        RETURNING id`,
        [
          event.id,
          event.summary ?? null,
          eventStart.toISOString(),
          eventEnd.toISOString(),
          contactId,
          targetType,
          targetContactId,
          targetName,
          followUpType,
          channel,
          scheduledAt.toISOString(),
          JSON.stringify({}),
        ],
      )

      const followUpId = result.rows[0]?.id
      if (!followUpId) throw new Error('INSERT returned no id')

      // 2. Create scheduled task (dummy cron — never fires by itself)
      const label = followUpType === 'pre_reminder' ? 'Pre-Recordatorio' : 'Post-Reunión'
      const taskName = `Cal ${label}: ${event.summary ?? event.id}`
      const task = await tasksApi.createTask({
        name: taskName,
        prompt: `Ejecuta seguimiento de calendario. Follow-up ID: ${followUpId}. No generes texto adicional.`,
        cron: '0 0 31 2 *', // dummy cron (31 de febrero — nunca ocurre)
        trigger_type: 'manual',
        enabled: true,
        actions: [{
          type: 'tool',
          toolName: 'calendar-execute-followup',
          toolInput: { followUpId },
        }],
      })

      // 3. Schedule delayed job
      const delayMs = Math.max(0, scheduledAt.getTime() - Date.now())
      const jobId = await tasksApi.addDelayedJob(task.id, taskName, delayMs)

      // 4. Update record with job/task IDs
      await this.db.query(
        `UPDATE calendar_follow_ups
         SET bullmq_job_id = $1, scheduled_task_id = $2, updated_at = now()
         WHERE id = $3`,
        [jobId ?? null, task.id, followUpId],
      )

      logger.info({
        followUpId,
        eventId: event.id,
        followUpType,
        targetType,
        scheduledAt,
        delayMs,
      }, 'Calendar follow-up scheduled')
    } catch (err) {
      logger.error({ err, eventId: event.id, followUpType, targetType }, 'Failed to create calendar follow-up')
    }
  }

  // ─── Cancel all follow-ups for an event ──────────

  async cancelFollowUps(calendarEventId: string): Promise<void> {
    const tasksApi = this.getTasksApi()

    // Get pending follow-ups
    const result = await this.db.query<{
      id: string
      bullmq_job_id: string | null
      scheduled_task_id: string | null
    }>(
      `SELECT id, bullmq_job_id, scheduled_task_id
       FROM calendar_follow_ups
       WHERE calendar_event_id = $1 AND status = 'pending'`,
      [calendarEventId],
    )

    for (const row of result.rows) {
      if (tasksApi) {
        if (row.bullmq_job_id) {
          try { await tasksApi.removeJobById(row.bullmq_job_id) } catch { /* ignore */ }
        }
        if (row.scheduled_task_id) {
          try { await tasksApi.deleteTask(row.scheduled_task_id) } catch { /* ignore */ }
        }
      }
    }

    await this.db.query(
      `UPDATE calendar_follow_ups
       SET status = 'cancelled', updated_at = now()
       WHERE calendar_event_id = $1 AND status = 'pending'`,
      [calendarEventId],
    )

    logger.info({ calendarEventId, cancelled: result.rows.length }, 'Calendar follow-ups cancelled')
  }

  // ─── Reschedule follow-ups when event date changes ─

  /**
   * Reschedule follow-ups when event dates change.
   * Note: If called concurrently for the same event (rapid edits),
   * duplicate tasks may be created. This is mitigated by:
   * 1. calendar-execute-followup is idempotent (checks status before sending)
   * 2. Low probability in practice (pipeline serializes per-contact)
   * A proper fix would use optimistic locking (UPDATE ... WHERE status='pending' RETURNING id).
   */
  async rescheduleFollowUps(calendarEventId: string, newEvent: CalendarEvent): Promise<void> {
    const tasksApi = this.getTasksApi()

    const config = this.getConfig()
    if (!config) return

    const result = await this.db.query<{
      id: string
      follow_up_type: 'pre_reminder' | 'post_meeting'
      bullmq_job_id: string | null
      scheduled_task_id: string | null
      contact_id: string
      channel: string
    }>(
      `SELECT id, follow_up_type, bullmq_job_id, scheduled_task_id, contact_id, channel
       FROM calendar_follow_ups
       WHERE calendar_event_id = $1 AND status = 'pending'`,
      [calendarEventId],
    )

    if (result.rows.length === 0) return

    const eventStartStr = newEvent.start.dateTime ?? newEvent.start.date
    const eventEndStr = newEvent.end.dateTime ?? newEvent.end.date
    if (!eventStartStr) return

    const eventStart = new Date(eventStartStr)
    const eventEnd = eventEndStr ? new Date(eventEndStr) : new Date(eventStart.getTime() + (config.defaultDurationMinutes ?? 30) * 60_000)
    const now = Date.now()

    for (const row of result.rows) {
      // Cancel old job + task
      if (tasksApi) {
        if (row.bullmq_job_id) {
          try { await tasksApi.removeJobById(row.bullmq_job_id) } catch { /* ignore */ }
        }
        if (row.scheduled_task_id) {
          try { await tasksApi.deleteTask(row.scheduled_task_id) } catch { /* ignore */ }
        }
      }

      // Recalculate scheduledAt
      const newScheduledAt = row.follow_up_type === 'pre_reminder'
        ? new Date(eventStart.getTime() - config.followUpPre.hoursBefore * 3_600_000)
        : new Date(eventEnd.getTime() + config.followUpPost.delayMinutes * 60_000)

      if (newScheduledAt.getTime() <= now) {
        // Time has passed — cancel
        await this.db.query(
          `UPDATE calendar_follow_ups SET status = 'cancelled', updated_at = now() WHERE id = $1`,
          [row.id],
        )
        logger.debug({ followUpId: row.id }, 'Follow-up cancelled after reschedule — time passed')
        continue
      }

      if (!tasksApi) {
        // Can't reschedule without tasks API
        await this.db.query(
          `UPDATE calendar_follow_ups SET status = 'cancelled', updated_at = now() WHERE id = $1`,
          [row.id],
        )
        continue
      }

      // Create new task + delayed job
      try {
        const label = row.follow_up_type === 'pre_reminder' ? 'Pre-Recordatorio' : 'Post-Reunión'
        const taskName = `Cal ${label}: ${newEvent.summary ?? calendarEventId}`
        const task = await tasksApi.createTask({
          name: taskName,
          prompt: `Ejecuta seguimiento de calendario. Follow-up ID: ${row.id}. No generes texto adicional.`,
          cron: '0 0 31 2 *',
          trigger_type: 'manual',
          enabled: true,
          actions: [{
            type: 'tool',
            toolName: 'calendar-execute-followup',
            toolInput: { followUpId: row.id },
          }],
        })

        const delayMs = Math.max(0, newScheduledAt.getTime() - Date.now())
        const jobId = await tasksApi.addDelayedJob(task.id, taskName, delayMs)

        await this.db.query(
          `UPDATE calendar_follow_ups
           SET bullmq_job_id = $1, scheduled_task_id = $2, scheduled_at = $3,
               event_summary = $4, event_start = $5, event_end = $6, updated_at = now()
           WHERE id = $7`,
          [jobId ?? null, task.id, newScheduledAt.toISOString(), newEvent.summary ?? null, eventStart.toISOString(), eventEnd.toISOString(), row.id],
        )

        logger.info({ followUpId: row.id, newScheduledAt, delayMs }, 'Calendar follow-up rescheduled')
      } catch (err) {
        logger.error({ err, followUpId: row.id }, 'Failed to reschedule calendar follow-up')
      }
    }
  }
}

// ─── Tool: calendar-execute-followup ───────────────

export function registerCalendarFollowUpTool(registry: Registry, db: Pool): void {
  const toolRegistry = registry.getOptional<ToolRegistry>('tools:registry')
  if (!toolRegistry) {
    logger.warn('tools:registry not available — calendar-execute-followup tool not registered')
    return
  }

  toolRegistry.registerTool({
    definition: {
      name: 'calendar-execute-followup',
      displayName: 'Ejecutar seguimiento de calendario',
      description: 'Ejecuta un seguimiento programado (recordatorio pre-reunión o post-reunión) de un evento de calendario. Uso interno — llamado por scheduled-tasks.',
      category: 'calendar',
      sourceModule: 'google-apps',
      parameters: {
        type: 'object',
        properties: {
          followUpId: { type: 'string', description: 'ID del follow-up a ejecutar [REQUIRED]' },
        },
        required: ['followUpId'],
      },
    },
    handler: async (input) => {
      const followUpId = input.followUpId as string

      const result = await db.query<{
        id: string
        follow_up_type: 'pre_reminder' | 'post_meeting'
        target_contact_id: string | null
        target_name: string | null
        event_summary: string | null
        event_start: Date | null
        channel: string
        status: string
      }>(
        `SELECT id, follow_up_type, target_contact_id, target_name,
                event_summary, event_start, channel, status
         FROM calendar_follow_ups WHERE id = $1`,
        [followUpId],
      )

      const followUp = result.rows[0]
      if (!followUp) {
        return { success: true, data: 'Follow-up no encontrado. Skipped.' }
      }
      if (followUp.status !== 'pending') {
        return { success: true, data: `Follow-up ya procesado (status: ${followUp.status}). Skipped.` }
      }

      if (!followUp.target_contact_id) {
        await db.query(
          `UPDATE calendar_follow_ups SET status = 'failed', error = $1, updated_at = now() WHERE id = $2`,
          ['No target_contact_id', followUpId],
        )
        return { success: false, error: 'Follow-up sin contacto destino' }
      }

      // Build message
      const targetName = followUp.target_name ?? ''
      const greeting = targetName ? `Hola ${targetName}!` : 'Hola!'
      const eventTitle = followUp.event_summary ?? 'la reunión'

      let message: string
      if (followUp.follow_up_type === 'pre_reminder') {
        const eventDate = followUp.event_start ? new Date(followUp.event_start) : null
        const timeStr = eventDate
          ? eventDate.toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' })
          : ''
        const dateStr = eventDate
          ? eventDate.toLocaleDateString('es', { weekday: 'long', day: 'numeric', month: 'long' })
          : ''
        const when = dateStr && timeStr ? ` el ${dateStr} a las ${timeStr}` : ''
        message = `${greeting} Te recuerdo que tienes ${eventTitle}${when}. ¡Te esperamos!`
      } else {
        message = `${greeting} ¿Cómo te fue en ${eventTitle}?`
      }

      // Send via channel
      try {
        await registry.runHook('message:send', {
          channel: followUp.channel,
          to: followUp.target_contact_id,
          content: { type: 'text', text: message },
        })

        await db.query(
          `UPDATE calendar_follow_ups SET status = 'sent', updated_at = now() WHERE id = $1`,
          [followUpId],
        )

        return { success: true, data: `Follow-up enviado a ${followUp.target_contact_id} via ${followUp.channel}` }
      } catch (err: unknown) {
        const errMsg = err instanceof Error ? err.message : 'unknown error'
        await db.query(
          `UPDATE calendar_follow_ups SET status = 'failed', error = $1, updated_at = now() WHERE id = $2`,
          [errMsg, followUpId],
        )
        return { success: false, error: `Error enviando follow-up: ${errMsg}` }
      }
    },
  }).catch((err) => {
    logger.error({ err }, 'Failed to register calendar-execute-followup tool')
  })
}
