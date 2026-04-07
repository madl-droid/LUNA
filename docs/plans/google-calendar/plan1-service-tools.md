# Plan 1: Calendar Service & Tools Enhancement

**Branch:** `feat/gcal-plan1-service-tools` (derivado de `claude/plan-google-calendar-W94gU`)
**Paralelo con:** Plan 2
**Dependencias:** Ninguna

---

## Objetivo

Mejorar el servicio de calendario y todos los tools existentes. Agregar tools faltantes (get/delete). Agregar Meet automático, reminders, conflict check, business hours validation, FreeBusy inteligente, y formatted output en todos los tools.

---

## Archivos a crear

### `src/modules/google-apps/calendar-helpers.ts`

Helpers puros sin dependencias de servicio:

**Business Hours & Day Validation:**

```typescript
interface BusinessHours { start: number; end: number; days: number[] }
type DayOff = { type: 'single'; date: string } | { type: 'range'; start: string; end: string }

// Verifica si una fecha es día laboral (no fin de semana según config, no day off)
function isBusinessDay(dateStr: string, businessDays: number[], daysOff: DayOff[]): { valid: boolean; reason?: string }
// - Parsear fecha, obtener ISO weekday (1=Mon..7=Sun)
// - Verificar si está en businessDays[]
// - Verificar si cae en algún dayOff (single: comparar directamente, range: start <= date <= end)

// Verifica si un datetime cae dentro del horario laboral
function isWithinBusinessHours(dateTimeStr: string, bh: BusinessHours, timezone: string): { valid: boolean; reason?: string }
// - Parsear hora del dateTime en la timezone dada
// - Verificar que hora >= bh.start && hora < bh.end

// Encuentra el siguiente día+hora hábil
function getNextBusinessSlot(fromDate: string, bh: BusinessHours, businessDays: number[], daysOff: DayOff[], timezone: string): string
// - Iterar días desde fromDate
// - Saltar días que no son businessDay o son dayOff
// - Retornar ISO datetime del inicio del siguiente slot hábil (bh.start del siguiente día válido)

// Combina todas las validaciones para un evento
function validateEventTiming(
  startDateTime: string, endDateTime: string | undefined,
  bh: BusinessHours, businessDays: number[], daysOff: DayOff[], timezone: string
): { valid: boolean; errors: string[]; suggestion?: string }
// - Llamar isBusinessDay + isWithinBusinessHours para start
// - Si endDateTime, verificar que end también esté en horario
// - Si inválido, calcular sugerencia con getNextBusinessSlot
```

**Free Slot Calculation:**

```typescript
interface BusyBlock { start: string; end: string }
interface FreeSlot { start: string; end: string; durationMinutes: number }

// Merge intervalos busy solapados
function mergeBusyIntervals(blocks: BusyBlock[]): BusyBlock[]
// - Sort by start
// - Iterar: si current.start <= prev.end → merge (max end)

// Calcular slots libres entre busy blocks
function calculateFreeSlots(busyMerged: BusyBlock[], dayStart: string, dayEnd: string, minDurationMinutes: number): FreeSlot[]
// - Iterar gaps entre busy blocks dentro de dayStart-dayEnd
// - Calcular duración de cada gap
// - Filtrar gaps >= minDurationMinutes

// Construir boundaries de un día laboral
function buildDayBoundaries(date: string, bh: BusinessHours, timezone: string): { dayStart: string; dayEnd: string }
// - Combinar date + bh.start → ISO dayStart
// - Combinar date + bh.end → ISO dayEnd
```

**Formatting para output legible:**

```typescript
// Formatea un evento para el agente
function formatEventForAgent(event: CalendarEvent, timezone?: string): string
// Output: "[abc123] lun, 14 feb 10:00-11:00: Demo OneScreen [Meet] (3 invitados)"
// - ID corto (primeros 8 chars)
// - Fecha en formato local legible (día semana, día mes)
// - Hora inicio-fin
// - Título
// - [Meet] si hay meetLink/hangoutLink
// - (N invitados) si hay attendees

// Formatea lista de eventos
function formatEventsListForAgent(events: CalendarEvent[], timezone?: string): string
// - Un evento por línea con formatEventForAgent
// - Si vacío: "No hay eventos en este rango."

// Formatea resultado de disponibilidad
function formatAvailabilityForAgent(result: CalendarAvailabilityResult): string
// Output:
// "Disponibilidad para lun, 14 feb:
//   Slots libres:
//     09:00-10:00 (60 min)
//     14:00-16:30 (150 min)
//   Personas ocupadas: felipe@empresa.com (10:00-11:00)
//   Advertencias: No se pudo leer calendario de ana@empresa.com"

// Formatea un evento individual con detalle completo
function formatSingleEventForAgent(event: CalendarEvent, timezone?: string): string
// Output detallado: título, fecha/hora, ubicación, Meet link, attendees con status, description (truncada 500 chars), ID completo
```

---

## Archivos a modificar

### `src/modules/google-apps/types.ts`

**Agregar (NO modificar existentes):**

```typescript
// Resultado extendido de createEvent
export interface CalendarCreateResult {
  created: boolean
  event?: CalendarEvent
  meetLink?: string | null
  conflicts?: string[]          // emails con conflicto
  warning?: string
}

// Opciones para checkAvailability
export interface CalendarAvailabilityOptions {
  emails: string[]
  date: string                  // YYYY-MM-DD
  durationMinutes: number
  includeOwnCalendar?: boolean  // default true
}

// Slot libre
export interface CalendarFreeSlot {
  start: string
  end: string
  durationMinutes: number
}

// Resultado de checkAvailability
export interface CalendarAvailabilityResult {
  date: string
  busyPeople: string[]
  freeSlots: CalendarFreeSlot[]
  failedCalendars: string[]
  warnings: string[]
}

// Config de scheduling (interface compartida con Plan 2)
export interface CalendarSchedulingConfig {
  meetEnabled: boolean
  defaultReminders: Array<{ method: 'email' | 'popup'; minutes: number }>
  defaultDurationMinutes: number
  eventNamePrefix: string
  descriptionInstructions: string
  daysOff: Array<{ type: 'single'; date: string } | { type: 'range'; start: string; end: string }>
  followUpPost: { enabled: boolean; delayMinutes: number }
  followUpPre: { enabled: boolean; hoursBefore: number }
  schedulingRoles: Record<string, { enabled: boolean; instructions: string }>
  schedulingCoworkers: Record<string, { enabled: boolean; instructions: string }>
}
```

**Extender interfaces existentes:**

- `CalendarEventCreateOptions`: agregar `addMeet?: boolean`, `force?: boolean`
- `CalendarEvent`: agregar `meetLink?: string`

---

### `src/modules/google-apps/calendar-service.ts`

**Modificar `createEvent()`:**

1. Si `options.addMeet !== false`, agregar al requestBody:
```typescript
conferenceData: {
  createRequest: {
    requestId: `luna-${Date.now()}`,
    conferenceSolutionKey: { type: 'hangoutsMeet' },
  },
},
```
2. Agregar `conferenceDataVersion: 1` al objeto de `events.insert()` (al mismo nivel que `calendarId`, `requestBody`, `sendUpdates`)
3. Si `options.force !== true` y hay attendees: antes de insertar, llamar `this.findFreeSlots()` con el rango del evento y los emails de attendees. Si hay solapamiento, retornar `{ created: false, conflicts: emailsOcupados, warning: 'Hay conflictos...' }`
4. Extraer meetLink del response: `result.data.conferenceData?.entryPoints?.find((ep: any) => ep.entryPointType === 'video')?.uri`
5. Cambiar retorno de `CalendarEvent` a `CalendarCreateResult`

**Modificar `mapEvent()`:**

- Agregar extracción de `meetLink`:
```typescript
meetLink: e.conferenceData?.entryPoints?.find((ep: any) => ep.entryPointType === 'video')?.uri
  ?? e.hangoutLink ?? null,
```

**Agregar método `checkAvailability()`:**

```typescript
async checkAvailability(options: CalendarAvailabilityOptions): Promise<CalendarAvailabilityResult>
```

Implementación:
1. Recibir `{ emails, date, durationMinutes, includeOwnCalendar = true }`
2. Construir timeMin/timeMax para el día completo (00:00-23:59 del date)
3. Si `includeOwnCalendar`, agregar `'primary'` a la lista de calendar IDs
4. Llamar `calendar.freebusy.query()` con items = emails mapeados a `{ id: email }`
5. Parsear response: para cada calendario, extraer busy blocks
6. Si un calendario tiene `errors` en la response de FreeBusy:
   - Intentar fallback con `calendar.events.list()` para ese calendario
   - Si falla también: agregar a `failedCalendars`
7. Merge todos los busy blocks (de todos los calendarios) usando `mergeBusyIntervals()`
8. Extraer `busyPeople`: emails que tienen algún busy block
9. Calcular freeSlots con `calculateFreeSlots()` usando los busy blocks mergeados
10. Retornar `CalendarAvailabilityResult`

---

### `src/modules/google-apps/tools.ts`

**Agregar helper al inicio (después de imports):**

```typescript
import type { CalendarSchedulingConfig } from './types.js'

const DEFAULT_CALENDAR_CONFIG: CalendarSchedulingConfig = {
  meetEnabled: true,
  defaultReminders: [
    { method: 'popup' as const, minutes: 5 },
    { method: 'popup' as const, minutes: 30 },
    { method: 'email' as const, minutes: 2880 },
  ],
  defaultDurationMinutes: 30,
  eventNamePrefix: 'Reunión',
  descriptionInstructions: '',
  daysOff: [],
  followUpPost: { enabled: true, delayMinutes: 60 },
  followUpPre: { enabled: true, hoursBefore: 24 },
  schedulingRoles: {},
  schedulingCoworkers: {},
}

function getCalendarConfig(registry: Registry): CalendarSchedulingConfig {
  const svc = registry.getOptional<{ get(): CalendarSchedulingConfig }>('google-apps:calendar-config')
  return svc?.get() ?? DEFAULT_CALENDAR_CONFIG
}

function getBusinessHours(registry: Registry): { start: number; end: number; days: number[] } | null {
  const svc = registry.getOptional<{ get(): { start: number; end: number; days: number[] } }>('engine:business-hours')
  return svc?.get() ?? null
}
```

**NUEVO tool `calendar-get-event`:**

```typescript
{
  name: 'calendar-get-event',
  displayName: 'Obtener detalle de evento',
  description: 'Obtiene los detalles completos de un evento de Google Calendar por su ID.',
  category: 'calendar',
  sourceModule: 'google-apps',
  parameters: {
    type: 'object',
    properties: {
      eventId: { type: 'string', description: 'ID del evento [REQUIRED]' },
      calendarId: { type: 'string', description: 'ID del calendario (default: primary)' },
    },
    required: ['eventId'],
  },
  handler: async (input) => {
    const event = await cal.getEvent(input.eventId as string, input.calendarId as string | undefined)
    return { success: true, data: formatSingleEventForAgent(event) }
  },
}
```

**NUEVO tool `calendar-delete-event`:**

```typescript
{
  name: 'calendar-delete-event',
  displayName: 'Cancelar/eliminar evento',
  description: 'Cancela y elimina un evento de Google Calendar. Notifica a todos los asistentes.',
  category: 'calendar',
  sourceModule: 'google-apps',
  parameters: {
    type: 'object',
    properties: {
      eventId: { type: 'string', description: 'ID del evento a cancelar [REQUIRED]' },
      calendarId: { type: 'string', description: 'ID del calendario (default: primary)' },
      notifyAttendees: { type: 'boolean', description: 'Notificar a asistentes (default: true)' },
    },
    required: ['eventId'],
  },
  handler: async (input) => {
    const sendUpdates = (input.notifyAttendees !== false) ? 'all' : 'none'
    await cal.deleteEvent(input.eventId as string, input.calendarId as string | undefined, sendUpdates)
    // Emitir hook para que Plan 4 cancele follow-ups
    await registry.runHook('calendar:event-deleted', { eventId: input.eventId })
    return { success: true, data: 'Evento cancelado exitosamente. Los asistentes fueron notificados.' }
  },
}
```

**MODIFICAR tool `calendar-create-event`:**

Rewrite del handler:

1. Leer config: `const calConfig = getCalendarConfig(registry)`
2. Leer business hours: `const bh = getBusinessHours(registry)`
3. Si hay `startDateTime` y `bh`:
   - Llamar `validateEventTiming(startDateTime, endDateTime, bh, calConfig.daysOff, timezone)`
   - Si `!valid` y `!input.force`: retornar `{ success: false, error: errors.join('. '), suggestion }`
4. Construir reminders: si el agente no pasa custom, usar `calConfig.defaultReminders`
   ```typescript
   const reminders = {
     useDefault: false,
     overrides: calConfig.defaultReminders,
   }
   ```
5. Construir conferenceData si `calConfig.meetEnabled` (o si input.addMeet override):
   ```typescript
   // Se pasa en las options al service, el service lo agrega al requestBody
   ```
6. Si no se pasa `endDateTime` ni `endDate`: calcular end = start + `calConfig.defaultDurationMinutes`
7. Llamar `cal.createEvent(options)` — ahora retorna `CalendarCreateResult`
8. Si `result.created === false`: retornar conflictos formateados
9. Si ok: emitir hook `calendar:event-created`:
   ```typescript
   await registry.runHook('calendar:event-created', {
     event: result.event,
     contactId: context?.contactId,
     meetLink: result.meetLink,
     channel: context?.channel,
   })
   ```
10. Retornar: `formatSingleEventForAgent(result.event)` + meetLink prominente

**Agregar parámetros nuevos al tool:**
- `force`: `{ type: 'boolean', description: 'Forzar creación aunque haya conflictos (default: false)' }`
- `addMeet`: `{ type: 'boolean', description: 'Incluir link de Google Meet (default: según config)' }`
- `durationMinutes`: `{ type: 'number', description: 'Duración en minutos (default: según config)' }`

**MODIFICAR tool `calendar-update-event`:**

1. Si cambia start/end: validar business hours/days/días off (mismo pattern que create)
2. Al final: emitir hook `calendar:event-updated` con `{ eventId, event, dateChanged: boolean }`
3. Output: `formatSingleEventForAgent(updatedEvent)`

**MODIFICAR tool `calendar-check-availability`:**

Rewrite del handler para usar el nuevo `checkAvailability()`:

1. Leer business hours + daysOff
2. Validar que la fecha no sea día off/no laboral
3. Parámetros del tool cambian a:
   - `date`: `{ type: 'string', description: 'Fecha a consultar YYYY-MM-DD [REQUIRED]' }`
   - `durationMinutes`: `{ type: 'number', description: 'Duración mínima del slot en minutos (default: según config)' }`
   - `emails`: `{ type: 'array', items: { type: 'string' }, description: 'Emails de personas a verificar' }`
   - Mantener `timeMin`/`timeMax` como fallback legacy
4. Llamar `cal.checkAvailability({ emails, date, durationMinutes })`
5. Output: `formatAvailabilityForAgent(result)`

**MODIFICAR tool `calendar-list-events`:**

1. Output: `formatEventsListForAgent(result.events)`

**MODIFICAR tool `calendar-add-attendees`:**

1. Output formateado con lista de attendees actual

---

### `src/modules/google-apps/manifest.ts`

Cambio mínimo:
- Importar tipos nuevos
- NO agregar API routes ni console fields (eso es Plan 2)
- Asegurar que `registry.runHook()` funcione para los hooks `calendar:event-created`, `calendar:event-deleted`, `calendar:event-updated` (estos hooks no necesitan declaración previa en el kernel, se emiten ad-hoc)

---

## Orden de implementación

1. `types.ts` — agregar interfaces nuevas y extender existentes
2. `calendar-helpers.ts` — crear completo con todas las funciones
3. `calendar-service.ts` — Meet + conflict check + checkAvailability
4. `tools.ts` — todos los cambios (nuevos tools + modificaciones)
5. Compilar: `docker run --rm -v /docker/luna-repo:/app -w /app node:22-alpine npx tsc --noEmit`

---

## Criterios de aceptación

- [ ] `calendar-create-event` genera Meet link automáticamente cuando config lo permite
- [ ] `calendar-create-event` pasa reminders por defecto de la config
- [ ] `calendar-create-event` valida business hours + business days + días off antes de crear
- [ ] `calendar-create-event` hace conflict check pre-creación (FreeBusy) a menos que `force: true`
- [ ] `calendar-create-event` emite hook `calendar:event-created`
- [ ] `calendar-create-event` calcula endDateTime si no se provee (usando defaultDurationMinutes)
- [ ] `calendar-get-event` tool funcional con output formateado
- [ ] `calendar-delete-event` tool funcional, emite hook `calendar:event-deleted`
- [ ] `calendar-update-event` valida business hours si cambia fecha, emite hook `calendar:event-updated`
- [ ] `calendar-check-availability` retorna slots libres con duración mínima, formateados
- [ ] `calendar-check-availability` usa nuevo método checkAvailability con FreeBusy + fallback
- [ ] Todos los tools retornan output formateado legible (no JSON crudo)
- [ ] Todos los tools que leen config funcionan con defaults si no hay config (backwards compatible)
- [ ] TypeScript compila sin errores
- [ ] Imports con extensión `.js`

---

## Notas para el ejecutor

- **Leer archivos antes de modificar** — usar Read tool en cada archivo antes de editar
- **El servicio `engine:business-hours` es OPCIONAL** — si no existe, skip validación de business hours
- **El servicio `google-apps:calendar-config` es OPCIONAL** — si no existe, usar DEFAULT_CALENDAR_CONFIG
- **context?.contactId** — el tool handler recibe contexto del pipeline, verificar cómo acceder al contactId desde el handler de tools en `tools.ts` (revisar cómo otros tools acceden al contexto, ej: medilink tools)
- **NO crear archivos fuera de `src/modules/google-apps/`** — todo este plan vive en el módulo existente
- **Timezone** — los helpers deben aceptar timezone como parámetro, leer de config del agente si disponible, fallback a UTC
