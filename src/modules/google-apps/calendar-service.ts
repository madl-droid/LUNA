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
} from './types.js'

const logger = pino({ name: 'google-apps:calendar' })

export class CalendarService {
  private calendar

  constructor(private auth: OAuth2Client) {
    this.calendar = google.calendar({ version: 'v3', auth })
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

    const res = await this.calendar.events.list({
      calendarId,
      timeMin: options.timeMin,
      timeMax: options.timeMax,
      q: options.query,
      maxResults: options.maxResults ?? 20,
      singleEvents: options.singleEvents ?? true,
      orderBy: options.orderBy ?? 'startTime',
      pageToken: options.pageToken,
    })

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

  async createEvent(options: CalendarEventCreateOptions): Promise<CalendarEvent> {
    const calendarId = options.calendarId ?? 'primary'

    const res = await this.calendar.events.insert({
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
    })

    logger.info({ eventId: res.data.id, summary: options.summary }, 'Calendar event created')
    return this.mapEvent(res.data)
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
      recurringEventId: e.recurringEventId ? String(e.recurringEventId) : undefined,
      created: e.created ? String(e.created) : undefined,
      updated: e.updated ? String(e.updated) : undefined,
    }
  }
}
