// LUNA — Module: google-apps — Calendar Service
// Gestión completa de Google Calendar: listar, crear, editar eventos, invitar asistentes.

import { google } from 'googleapis'
import type { OAuth2Client } from 'google-auth-library'
import pino from 'pino'
import type {
  CalendarEvent,
  CalendarAttendee,
  CalendarListEntry,
  CalendarEventListOptions,
  CalendarEventCreateOptions,
  CalendarEventUpdateOptions,
  CalendarCreateResult,
  CalendarAvailabilityOptions,
  CalendarAvailabilityResult,
  GoogleApiConfig,
} from './types.js'
import { googleApiCall } from './api-wrapper.js'
import { mergeBusyIntervals, calculateFreeSlots } from './calendar-helpers.js'

const logger = pino({ name: 'google-apps:calendar' })

export class CalendarService {
  private calendar
  // FIX: GA-3 — API timeout/retry config
  private apiConfig: { timeoutMs: number; maxRetries: number }

  constructor(auth: OAuth2Client, config?: GoogleApiConfig) {
    this.calendar = google.calendar({ version: 'v3', auth })
    this.apiConfig = {
      timeoutMs: config?.GOOGLE_API_TIMEOUT_MS ?? 30000,
      maxRetries: config?.GOOGLE_API_RETRY_MAX ?? 2,
    }
  }

  // ─── Calendarios ───────────────────────────

  async listCalendars(): Promise<CalendarListEntry[]> {
    const res = await this.calendar.calendarList.list({
      showHidden: false,
    })

    return (res.data.items ?? []).map((c) => ({
      id: c.id ?? '',
      summary: c.summary ?? '',
      description: c.description ?? undefined,
      primary: c.primary ?? undefined,
      accessRole: (c.accessRole ?? 'reader') as CalendarListEntry['accessRole'],
      timeZone: c.timeZone ?? undefined,
      backgroundColor: c.backgroundColor ?? undefined,
    }))
  }

  // ─── Eventos ───────────────────────────────

  async listEvents(options: CalendarEventListOptions = {}): Promise<{
    events: CalendarEvent[]
    nextPageToken?: string
  }> {
    const calendarId = options.calendarId ?? 'primary'

    const res = await googleApiCall(() => this.calendar.events.list({
      calendarId,
      timeMin: options.timeMin,
      timeMax: options.timeMax,
      q: options.query,
      maxResults: options.maxResults ?? 20,
      singleEvents: options.singleEvents ?? true,
      orderBy: options.orderBy ?? 'startTime',
      pageToken: options.pageToken,
    }), this.apiConfig, 'calendar.events.list')

    const events: CalendarEvent[] = (res.data.items ?? []).map((e) => this.mapEvent(e))

    return {
      events,
      nextPageToken: res.data.nextPageToken ?? undefined,
    }
  }

  async getEvent(eventId: string, calendarId = 'primary'): Promise<CalendarEvent> {
    const res = await this.calendar.events.get({
      calendarId,
      eventId,
    })
    return this.mapEvent(res.data)
  }

  async createEvent(options: CalendarEventCreateOptions): Promise<CalendarCreateResult> {
    const calendarId = options.calendarId ?? 'primary'

    // Conflict check: si hay attendees y no se fuerza, verificar solapamientos
    if (options.force !== true && options.attendees && options.attendees.length > 0 && options.start.dateTime && options.end.dateTime) {
      const busyData = await this.findFreeSlots(
        options.start.dateTime,
        options.end.dateTime,
        options.attendees.map((a) => a.email),
      )
      const conflicting = busyData
        .filter((c) => c.busy.length > 0)
        .map((c) => c.calendarId)
      if (conflicting.length > 0) {
        return {
          created: false,
          conflicts: conflicting,
          warning: `Hay conflictos con: ${conflicting.join(', ')}. Usa force=true para crear de todas formas.`,
        }
      }
    }

    const addMeet = options.addMeet !== false

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const insertParams: Record<string, any> = {
      calendarId,
      sendUpdates: options.sendUpdates ?? 'all',
      requestBody: {
        summary: options.summary,
        description: options.description,
        location: options.location,
        start: options.start,
        end: options.end,
        attendees: options.attendees?.map((a) => ({
          email: a.email,
          displayName: a.displayName,
          optional: a.optional,
        })),
        reminders: options.reminders,
      },
    }

    if (addMeet) {
      insertParams.conferenceDataVersion = 1
      insertParams.requestBody.conferenceData = {
        createRequest: {
          requestId: `luna-${Date.now()}`,
          conferenceSolutionKey: { type: 'hangoutsMeet' },
        },
      }
    }

    const res = await googleApiCall(() => this.calendar.events.insert(insertParams), this.apiConfig, 'calendar.events.insert')

    logger.info({ eventId: res.data.id, summary: options.summary }, 'Calendar event created')
    const event = this.mapEvent(res.data)
    return {
      created: true,
      event,
      meetLink: event.meetLink ?? null,
    }
  }

  async updateEvent(options: CalendarEventUpdateOptions): Promise<CalendarEvent> {
    const calendarId = options.calendarId ?? 'primary'

    // Primero obtener el evento actual para merge
    const current = await this.calendar.events.get({
      calendarId,
      eventId: options.eventId,
    })

    const requestBody: Record<string, unknown> = { ...current.data }
    if (options.summary !== undefined) requestBody.summary = options.summary
    if (options.description !== undefined) requestBody.description = options.description
    if (options.location !== undefined) requestBody.location = options.location
    if (options.start !== undefined) requestBody.start = options.start
    if (options.end !== undefined) requestBody.end = options.end
    if (options.attendees !== undefined) {
      requestBody.attendees = options.attendees.map((a) => ({
        email: a.email,
        displayName: a.displayName,
        optional: a.optional,
      }))
    }

    const res = await this.calendar.events.update({
      calendarId,
      eventId: options.eventId,
      sendUpdates: options.sendUpdates ?? 'all',
      requestBody,
    })

    logger.info({ eventId: options.eventId }, 'Calendar event updated')
    return this.mapEvent(res.data)
  }

  async deleteEvent(eventId: string, calendarId = 'primary', sendUpdates: 'all' | 'externalOnly' | 'none' = 'all'): Promise<void> {
    await this.calendar.events.delete({
      calendarId,
      eventId,
      sendUpdates,
    })
    logger.info({ eventId }, 'Calendar event deleted')
  }

  async addAttendees(
    eventId: string,
    attendees: Array<{ email: string; displayName?: string; optional?: boolean }>,
    calendarId = 'primary',
  ): Promise<CalendarEvent> {
    const current = await this.calendar.events.get({ calendarId, eventId })
    const existingAttendees = (current.data.attendees ?? []) as Array<Record<string, unknown>>

    const newAttendees = [
      ...existingAttendees,
      ...attendees.map((a) => ({
        email: a.email,
        displayName: a.displayName,
        optional: a.optional,
      })),
    ]

    const res = await this.calendar.events.patch({
      calendarId,
      eventId,
      sendUpdates: 'all',
      requestBody: { attendees: newAttendees },
    })

    logger.info({ eventId, added: attendees.length }, 'Attendees added to event')
    return this.mapEvent(res.data)
  }

  async removeAttendee(
    eventId: string,
    email: string,
    calendarId = 'primary',
  ): Promise<CalendarEvent> {
    const current = await this.calendar.events.get({ calendarId, eventId })
    const attendees = (current.data.attendees ?? []).filter(
      (a) => (a as Record<string, unknown>).email !== email,
    )

    const res = await this.calendar.events.patch({
      calendarId,
      eventId,
      sendUpdates: 'all',
      requestBody: { attendees },
    })

    logger.info({ eventId, removed: email }, 'Attendee removed from event')
    return this.mapEvent(res.data)
  }

  async findFreeSlots(
    timeMin: string,
    timeMax: string,
    calendarIds?: string[],
  ): Promise<Array<{ calendarId: string; busy: Array<{ start: string; end: string }> }>> {
    const calendars = calendarIds ?? ['primary']

    const res = await this.calendar.freebusy.query({
      requestBody: {
        timeMin,
        timeMax,
        items: calendars.map((id) => ({ id })),
      },
    })

    const result: Array<{ calendarId: string; busy: Array<{ start: string; end: string }> }> = []
    const calendarData = res.data.calendars ?? {}

    for (const [calId, data] of Object.entries(calendarData)) {
      const busyData = data as Record<string, unknown>
      const busyPeriods = (busyData.busy ?? []) as Array<{ start: string; end: string }>
      result.push({
        calendarId: calId,
        busy: busyPeriods.map((b) => ({
          start: b.start ?? '',
          end: b.end ?? '',
        })),
      })
    }

    return result
  }

  // ─── Private helpers ───────────────────────

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private mapEvent(e: any): CalendarEvent {
    const attendeesRaw = (e.attendees ?? []) as Array<Record<string, unknown>>
    const organizerRaw = e.organizer as Record<string, unknown> | undefined
    const startRaw = e.start as Record<string, unknown> | undefined
    const endRaw = e.end as Record<string, unknown> | undefined

    // Extraer Meet link desde conferenceData o hangoutLink
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const entryPoints = (e.conferenceData?.entryPoints ?? []) as Array<any>
    const meetLink: string | undefined =
      entryPoints.find((ep) => ep.entryPointType === 'video')?.uri
      ?? (e.hangoutLink ? String(e.hangoutLink) : undefined)

    return {
      id: String(e.id ?? ''),
      summary: String(e.summary ?? ''),
      description: e.description ? String(e.description) : undefined,
      location: e.location ? String(e.location) : undefined,
      start: {
        dateTime: startRaw?.dateTime ? String(startRaw.dateTime) : undefined,
        date: startRaw?.date ? String(startRaw.date) : undefined,
        timeZone: startRaw?.timeZone ? String(startRaw.timeZone) : undefined,
      },
      end: {
        dateTime: endRaw?.dateTime ? String(endRaw.dateTime) : undefined,
        date: endRaw?.date ? String(endRaw.date) : undefined,
        timeZone: endRaw?.timeZone ? String(endRaw.timeZone) : undefined,
      },
      attendees: attendeesRaw.map((a) => ({
        email: String(a.email ?? ''),
        displayName: a.displayName ? String(a.displayName) : undefined,
        responseStatus: a.responseStatus as CalendarAttendee['responseStatus'],
        optional: a.optional as boolean | undefined,
        organizer: a.organizer as boolean | undefined,
        self: a.self as boolean | undefined,
      })),
      organizer: organizerRaw ? {
        email: String(organizerRaw.email ?? ''),
        displayName: organizerRaw.displayName ? String(organizerRaw.displayName) : undefined,
        self: organizerRaw.self as boolean | undefined,
      } : undefined,
      status: e.status as CalendarEvent['status'],
      htmlLink: e.htmlLink ? String(e.htmlLink) : undefined,
      hangoutLink: e.hangoutLink ? String(e.hangoutLink) : undefined,
      meetLink,
      recurringEventId: e.recurringEventId ? String(e.recurringEventId) : undefined,
      created: e.created ? String(e.created) : undefined,
      updated: e.updated ? String(e.updated) : undefined,
    }
  }

  // ─── checkAvailability ─────────────────────

  async checkAvailability(options: CalendarAvailabilityOptions): Promise<CalendarAvailabilityResult> {
    const { emails, date, durationMinutes, includeOwnCalendar = true } = options

    const d = new Date(`${date}T00:00:00Z`)
    const nextD = new Date(d)
    nextD.setUTCDate(nextD.getUTCDate() + 1)
    const timeMin = d.toISOString()
    const timeMax = nextD.toISOString()

    const calendarIds: string[] = includeOwnCalendar ? ['primary', ...emails] : [...emails]

    const failedCalendars: string[] = []
    const warnings: string[] = []
    const allBusy: Array<{ calId: string; start: string; end: string }> = []

    try {
      const res = await this.calendar.freebusy.query({
        requestBody: {
          timeMin,
          timeMax,
          items: calendarIds.map((id) => ({ id })),
        },
      })

      const calendarData = res.data.calendars ?? {}

      for (const [calId, data] of Object.entries(calendarData)) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const calData = data as any
        if (calData.errors && calData.errors.length > 0) {
          // Fallback: intentar con events.list
          try {
            const evRes = await this.calendar.events.list({
              calendarId: calId,
              timeMin,
              timeMax,
              singleEvents: true,
              orderBy: 'startTime',
            })
            const items = evRes.data.items ?? []
            for (const ev of items) {
              const evStart = (ev.start as Record<string, string> | undefined)?.dateTime ?? timeMin
              const evEnd = (ev.end as Record<string, string> | undefined)?.dateTime ?? timeMax
              allBusy.push({ calId, start: evStart, end: evEnd })
            }
          } catch {
            failedCalendars.push(calId)
            warnings.push(`No se pudo leer calendario de ${calId}`)
          }
        } else {
          const busyPeriods = (calData.busy ?? []) as Array<{ start: string; end: string }>
          for (const b of busyPeriods) {
            allBusy.push({ calId, start: b.start ?? '', end: b.end ?? '' })
          }
        }
      }
    } catch (err) {
      logger.error({ err, date }, 'checkAvailability freebusy.query failed')
      warnings.push('Error consultando disponibilidad')
    }

    // busyPeople: emails que tienen al menos un bloque busy
    const busyPeople = [...new Set(
      allBusy
        .filter((b) => b.calId !== 'primary' && emails.includes(b.calId))
        .map((b) => b.calId),
    )]

    // Merge todos los busy blocks para calcular free slots
    const mergedBusy = mergeBusyIntervals(allBusy.map((b) => ({ start: b.start, end: b.end })))

    // Usar boundaries del día completo para el cálculo de slots
    const dayStart = timeMin
    const dayEnd = timeMax
    const freeSlots = calculateFreeSlots(mergedBusy, dayStart, dayEnd, durationMinutes)

    return {
      date,
      busyPeople,
      freeSlots: freeSlots.map((s) => ({ start: s.start, end: s.end, durationMinutes: s.durationMinutes })),
      failedCalendars,
      warnings,
    }
  }
}
