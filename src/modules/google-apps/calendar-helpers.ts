// LUNA — Module: google-apps — Calendar Helpers
// Pure helpers: business hours validation, free slot calculation, formatted output for agent.

import type { CalendarEvent, CalendarAvailabilityResult } from './types.js'

// ═══════════════════════════════════════════
// Business Hours & Day Validation
// ═══════════════════════════════════════════

export interface BusinessHours { start: number; end: number; days: number[] }
export type DayOff =
  | { type: 'single'; date: string }
  | { type: 'range'; start: string; end: string }

/**
 * Verifica si una fecha (YYYY-MM-DD) es día laboral (no fin de semana según config, no day off).
 * businessDays: array de ISO weekdays donde 1=Lunes … 7=Domingo.
 */
export function isBusinessDay(
  dateStr: string,
  businessDays: number[],
  daysOff: DayOff[],
): { valid: boolean; reason?: string } {
  const d = new Date(`${dateStr}T00:00:00Z`)
  if (isNaN(d.getTime())) return { valid: false, reason: `Fecha inválida: ${dateStr}` }

  // getUTCDay() → 0=Dom, 1=Lun … 6=Sáb; convertir a ISO: 1=Lun … 7=Dom
  const rawDay = d.getUTCDay()
  const isoWeekday = rawDay === 0 ? 7 : rawDay

  if (!businessDays.includes(isoWeekday)) {
    const names = ['', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado', 'domingo']
    return { valid: false, reason: `${names[isoWeekday] ?? dateStr} no es día laboral` }
  }

  for (const off of daysOff) {
    if (off.type === 'single') {
      if (dateStr === off.date) return { valid: false, reason: `${dateStr} es día no laboral` }
    } else {
      if (dateStr >= off.start && dateStr <= off.end) {
        return { valid: false, reason: `${dateStr} cae en período no laboral (${off.start} – ${off.end})` }
      }
    }
  }

  return { valid: true }
}

/**
 * Verifica si un datetime ISO cae dentro del horario laboral.
 * bh.start / bh.end son horas enteras (ej: 9, 18).
 */
export function isWithinBusinessHours(
  dateTimeStr: string,
  bh: BusinessHours,
  timezone: string,
): { valid: boolean; reason?: string } {
  const d = new Date(dateTimeStr)
  if (isNaN(d.getTime())) return { valid: false, reason: `DateTime inválido: ${dateTimeStr}` }

  // Obtener hora local en la timezone indicada
  const hourStr = d.toLocaleString('en-US', { timeZone: timezone, hour: 'numeric', hour12: false })
  const minuteStr = d.toLocaleString('en-US', { timeZone: timezone, minute: 'numeric' })
  const hour = parseInt(hourStr, 10)
  const minute = parseInt(minuteStr, 10)
  const decimalHour = hour + minute / 60

  if (decimalHour < bh.start) {
    return { valid: false, reason: `Antes del horario laboral (inicio: ${bh.start}:00)` }
  }
  if (decimalHour >= bh.end) {
    return { valid: false, reason: `Después del horario laboral (fin: ${bh.end}:00)` }
  }
  return { valid: true }
}

/**
 * Encuentra el siguiente día+hora hábil a partir de fromDate (YYYY-MM-DD).
 * Retorna ISO datetime del inicio del siguiente slot hábil (bh.start del siguiente día válido).
 */
export function getNextBusinessSlot(
  fromDate: string,
  bh: BusinessHours,
  businessDays: number[],
  daysOff: DayOff[],
  timezone: string,
): string {
  const d = new Date(`${fromDate}T00:00:00Z`)
  // Iterar hasta encontrar un día válido (máx 30 días)
  for (let i = 0; i < 30; i++) {
    const year = d.getUTCFullYear()
    const month = String(d.getUTCMonth() + 1).padStart(2, '0')
    const day = String(d.getUTCDate()).padStart(2, '0')
    const dateStr = `${year}-${month}-${day}`

    const check = isBusinessDay(dateStr, businessDays, daysOff)
    if (check.valid) {
      // Construir hora inicio en esa timezone
      const startHour = String(bh.start).padStart(2, '0')
      // Usar Intl para construir la fecha con timezone correcta
      const candidate = buildDateTimeInTimezone(dateStr, bh.start, 0, timezone)
      if (candidate) return candidate
      return `${dateStr}T${startHour}:00:00`
    }

    d.setUTCDate(d.getUTCDate() + 1)
  }

  return `${fromDate}T${String(bh.start).padStart(2, '0')}:00:00`
}

/** Construye ISO datetime para una fecha+hora en una timezone específica */
function buildDateTimeInTimezone(dateStr: string, hour: number, minute: number, timezone: string): string | null {
  try {
    // Intentar construir el datetime con Intl para calcular el offset
    const naive = new Date(`${dateStr}T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00`)
    // Reformatear en la timezone para obtener offset
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    }).formatToParts(naive)

    const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '00'
    return `${get('year')}-${get('month')}-${get('day')}T${get('hour')}:${get('minute')}:${get('second')}`
  } catch {
    return null
  }
}

/**
 * Combina todas las validaciones para un evento.
 * Si inválido, retorna sugerencia con getNextBusinessSlot.
 */
export function validateEventTiming(
  startDateTime: string,
  endDateTime: string | undefined,
  bh: BusinessHours,
  businessDays: number[],
  daysOff: DayOff[],
  timezone: string,
): { valid: boolean; errors: string[]; suggestion?: string } {
  const errors: string[] = []

  // Extraer la fecha del startDateTime
  const datePart = startDateTime.split('T')[0]
  if (!datePart) return { valid: false, errors: ['DateTime de inicio inválido'] }

  const dayCheck = isBusinessDay(datePart, businessDays, daysOff)
  if (!dayCheck.valid && dayCheck.reason) errors.push(dayCheck.reason)

  const hourCheck = isWithinBusinessHours(startDateTime, bh, timezone)
  if (!hourCheck.valid && hourCheck.reason) errors.push(hourCheck.reason)

  if (endDateTime) {
    const endHourCheck = isWithinBusinessHours(endDateTime, bh, timezone)
    if (!endHourCheck.valid && endHourCheck.reason) errors.push(`Hora fin: ${endHourCheck.reason}`)
  }

  if (errors.length > 0) {
    const suggestion = getNextBusinessSlot(datePart, bh, businessDays, daysOff, timezone)
    return { valid: false, errors, suggestion }
  }

  return { valid: true, errors: [] }
}

// ═══════════════════════════════════════════
// Free Slot Calculation
// ═══════════════════════════════════════════

export interface BusyBlock { start: string; end: string }
export interface FreeSlot { start: string; end: string; durationMinutes: number }

/** Merge intervalos busy solapados (sort by start, merge overlaps) */
export function mergeBusyIntervals(blocks: BusyBlock[]): BusyBlock[] {
  if (blocks.length === 0) return []
  const sorted = [...blocks].sort((a, b) => a.start.localeCompare(b.start))
  const merged: BusyBlock[] = []
  let current = sorted[0]!

  for (let i = 1; i < sorted.length; i++) {
    const next = sorted[i]!
    if (next.start <= current.end) {
      // Merge: extender el end si next.end es mayor
      current = { start: current.start, end: next.end > current.end ? next.end : current.end }
    } else {
      merged.push(current)
      current = next
    }
  }
  merged.push(current)
  return merged
}

/** Calcular slots libres entre busy blocks dentro del rango dayStart-dayEnd */
export function calculateFreeSlots(
  busyMerged: BusyBlock[],
  dayStart: string,
  dayEnd: string,
  minDurationMinutes: number,
): FreeSlot[] {
  const slots: FreeSlot[] = []
  let cursor = dayStart

  for (const busy of busyMerged) {
    // Si el bloque busy empieza después del cursor, hay un slot libre
    if (busy.start > cursor) {
      const slotEnd = busy.start < dayEnd ? busy.start : dayEnd
      const durationMs = new Date(slotEnd).getTime() - new Date(cursor).getTime()
      const durationMinutes = Math.floor(durationMs / 60000)
      if (durationMinutes >= minDurationMinutes) {
        slots.push({ start: cursor, end: slotEnd, durationMinutes })
      }
    }
    // Avanzar cursor al fin del bloque busy (si está dentro del rango)
    if (busy.end > cursor) cursor = busy.end
    if (cursor >= dayEnd) break
  }

  // Slot al final del día si hay tiempo libre
  if (cursor < dayEnd) {
    const durationMs = new Date(dayEnd).getTime() - new Date(cursor).getTime()
    const durationMinutes = Math.floor(durationMs / 60000)
    if (durationMinutes >= minDurationMinutes) {
      slots.push({ start: cursor, end: dayEnd, durationMinutes })
    }
  }

  return slots
}

/** Construir boundaries de un día laboral */
export function buildDayBoundaries(
  date: string,
  bh: BusinessHours,
  timezone: string,
): { dayStart: string; dayEnd: string } {
  const startCandidate = buildDateTimeInTimezone(date, bh.start, 0, timezone)
  const endCandidate = buildDateTimeInTimezone(date, bh.end, 0, timezone)

  const dayStart = startCandidate ?? `${date}T${String(bh.start).padStart(2, '0')}:00:00`
  const dayEnd = endCandidate ?? `${date}T${String(bh.end).padStart(2, '0')}:00:00`

  return { dayStart, dayEnd }
}

// ═══════════════════════════════════════════
// Formatting para output legible
// ═══════════════════════════════════════════

const WEEKDAY_NAMES = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb']
const MONTH_NAMES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic']

function formatDateLocal(dateTimeStr: string, timezone?: string): string {
  try {
    const d = new Date(dateTimeStr)
    const tz = timezone ?? 'UTC'
    const weekday = d.toLocaleDateString('es', { timeZone: tz, weekday: 'short' })
    const day = d.toLocaleDateString('es', { timeZone: tz, day: 'numeric' })
    const month = d.toLocaleDateString('es', { timeZone: tz, month: 'short' })
    return `${weekday} ${day} ${month}`
  } catch {
    return dateTimeStr.split('T')[0] ?? dateTimeStr
  }
}

function formatTimeLocal(dateTimeStr: string, timezone?: string): string {
  try {
    const d = new Date(dateTimeStr)
    const tz = timezone ?? 'UTC'
    return d.toLocaleTimeString('es', { timeZone: tz, hour: '2-digit', minute: '2-digit', hour12: false })
  } catch {
    return dateTimeStr.split('T')[1]?.substring(0, 5) ?? ''
  }
}

/**
 * Formatea un evento para listado: "[abc123] lun, 14 feb 10:00-11:00: Demo [Meet] (3 invitados)"
 */
export function formatEventForAgent(event: CalendarEvent, timezone?: string): string {
  const shortId = event.id.substring(0, 8)
  const hasMeet = !!(event.meetLink ?? event.hangoutLink)
  const attendeeCount = (event.attendees ?? []).filter((a) => !a.self).length

  let line = `[${shortId}]`

  const startStr = event.start.dateTime ?? event.start.date
  const endStr = event.end.dateTime ?? event.end.date

  if (startStr) {
    if (event.start.dateTime) {
      const dateLabel = formatDateLocal(startStr, timezone ?? event.start.timeZone)
      const startTime = formatTimeLocal(startStr, timezone ?? event.start.timeZone)
      const endTime = endStr ? formatTimeLocal(endStr, timezone ?? event.end.timeZone) : ''
      line += ` ${dateLabel} ${startTime}${endTime ? `-${endTime}` : ''}`
    } else {
      // All-day event
      line += ` ${startStr}`
    }
  }

  line += `: ${event.summary}`
  if (hasMeet) line += ' [Meet]'
  if (attendeeCount > 0) line += ` (${attendeeCount} invitado${attendeeCount !== 1 ? 's' : ''})`

  return line
}

/** Formatea lista de eventos (uno por línea) */
export function formatEventsListForAgent(events: CalendarEvent[], timezone?: string): string {
  if (events.length === 0) return 'No hay eventos en este rango.'
  return events.map((e) => formatEventForAgent(e, timezone)).join('\n')
}

/** Formatea resultado de disponibilidad */
export function formatAvailabilityForAgent(result: CalendarAvailabilityResult): string {
  const lines: string[] = []

  // Construir header con fecha legible
  const dateParts = result.date.split('-')
  const dateLabel = dateParts.length === 3
    ? (() => {
        const d = new Date(`${result.date}T00:00:00Z`)
        const wd = WEEKDAY_NAMES[d.getUTCDay()] ?? ''
        const mo = MONTH_NAMES[d.getUTCMonth()] ?? ''
        return `${wd} ${d.getUTCDate()} ${mo}`
      })()
    : result.date

  lines.push(`Disponibilidad para ${dateLabel}:`)

  if (result.freeSlots.length === 0) {
    lines.push('  Sin slots libres en este día.')
  } else {
    lines.push('  Slots libres:')
    for (const slot of result.freeSlots) {
      const startTime = slot.start.includes('T') ? slot.start.split('T')[1]?.substring(0, 5) : slot.start
      const endTime = slot.end.includes('T') ? slot.end.split('T')[1]?.substring(0, 5) : slot.end
      lines.push(`    ${startTime}-${endTime} (${slot.durationMinutes} min)`)
    }
  }

  if (result.busyPeople.length > 0) {
    lines.push(`  Personas ocupadas: ${result.busyPeople.join(', ')}`)
  }

  if (result.warnings.length > 0) {
    lines.push(`  Advertencias: ${result.warnings.join('; ')}`)
  }

  return lines.join('\n')
}

/** Formatea un evento individual con detalle completo */
export function formatSingleEventForAgent(event: CalendarEvent, timezone?: string): string {
  const lines: string[] = []
  const tz = timezone ?? event.start.timeZone

  // Título + fecha
  const startStr = event.start.dateTime ?? event.start.date
  const endStr = event.end.dateTime ?? event.end.date

  let dateSection = ''
  if (startStr) {
    if (event.start.dateTime) {
      const dateLabel = formatDateLocal(startStr, tz)
      const startTime = formatTimeLocal(startStr, tz)
      const endTime = endStr ? formatTimeLocal(endStr, tz) : ''
      dateSection = `${dateLabel}, ${startTime}${endTime ? `–${endTime}` : ''}`
      if (tz) dateSection += ` (${tz})`
    } else {
      dateSection = `${startStr} (todo el día)`
    }
  }

  lines.push(`📅 **${event.summary}**`)
  if (dateSection) lines.push(`   ${dateSection}`)
  if (event.location) lines.push(`   📍 ${event.location}`)

  const meetLink = event.meetLink ?? event.hangoutLink
  if (meetLink) lines.push(`   🎥 Google Meet: ${meetLink}`)

  if (event.attendees && event.attendees.length > 0) {
    const attendeeLines = event.attendees.map((a) => {
      const statusEmoji = { accepted: '✅', declined: '❌', tentative: '❓', needsAction: '⏳' }[a.responseStatus ?? 'needsAction'] ?? '⏳'
      return `     ${statusEmoji} ${a.displayName ?? a.email}${a.organizer ? ' (organizador)' : ''}`
    })
    lines.push(`   👥 Invitados:`)
    lines.push(...attendeeLines)
  }

  if (event.description) {
    const truncated = event.description.length > 500
      ? `${event.description.substring(0, 497)}...`
      : event.description
    lines.push(`   📝 ${truncated}`)
  }

  lines.push(`   ID: ${event.id}`)

  return lines.join('\n')
}
