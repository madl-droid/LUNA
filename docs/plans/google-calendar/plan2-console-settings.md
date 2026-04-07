# Plan 2: Console Settings — Página Calendar

**Branch:** `feat/gcal-plan2-console-settings` (derivado de `claude/plan-google-calendar-W94gU`)
**Paralelo con:** Plan 1
**Dependencias:** Ninguna

---

## Objetivo

Crear la página de configuración de Google Calendar en `/console/herramientas/google-apps/calendar`, agregar botón "Configurar" en la card de Calendar existente, implementar el servicio de config que otros planes consumen.

---

## Modelo de datos

**Config almacenada en `config_store` como JSON string bajo key `GCAL_SCHEDULING_CONFIG`:**

```typescript
interface CalendarSchedulingConfig {
  // --- General ---
  meetEnabled: boolean                    // default true
  defaultReminders: Array<{              // default [{popup,5},{popup,30},{email,2880}]
    method: 'email' | 'popup'
    minutes: number
  }>
  defaultDurationMinutes: number          // default 30, min 15, max 480
  eventNamePrefix: string                 // default "Reunión"
  descriptionInstructions: string         // texto libre, instrucciones para el agente

  // --- Días off ---
  daysOff: Array<
    | { type: 'single'; date: string }              // ej: "2026-05-01"
    | { type: 'range'; start: string; end: string } // ej: "2026-12-24" a "2026-12-31"
  >

  // --- Roles habilitados para agendamiento ---
  schedulingRoles: Record<string, {       // key = nombre del rol (viene de users syncConfig.roles)
    enabled: boolean
    instructions: string                  // ej: "agendar los clientes que están fuera del país"
  }>

  // --- Coworkers individuales ---
  schedulingCoworkers: Record<string, {   // key = userId (USR-XXXXX)
    enabled: boolean                      // default true al activar el rol
    instructions: string                  // ej: "clientes en brasil"
  }>

  // --- Follow-up post-reunión ---
  followUpPost: {
    enabled: boolean                      // default true
    delayMinutes: number                  // default 60, min 30, max 360
  }

  // --- Confirmación pre-reunión ---
  followUpPre: {
    enabled: boolean                      // default true
    hoursBefore: number                   // default 24, min 3, max 24
  }
}
```

---

## Archivos a crear

### `src/modules/google-apps/calendar-config.ts`

**Servicio de configuración CRUD + cache:**

```typescript
import type { Pool } from 'pg'
import * as configStore from '../../kernel/config-store.js'

const CONFIG_KEY = 'GCAL_SCHEDULING_CONFIG'

// Defaults (deben ser IDÉNTICOS a los de plan1 tools.ts DEFAULT_CALENDAR_CONFIG)
const DEFAULTS: CalendarSchedulingConfig = {
  meetEnabled: true,
  defaultReminders: [
    { method: 'popup', minutes: 5 },
    { method: 'popup', minutes: 30 },
    { method: 'email', minutes: 2880 },
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

export class CalendarConfigService {
  private cache: CalendarSchedulingConfig | null = null

  constructor(private db: Pool) {}

  async load(): Promise<void> {
    const raw = await configStore.get(this.db, CONFIG_KEY)
    if (!raw) { this.cache = { ...DEFAULTS }; return }
    try {
      this.cache = { ...DEFAULTS, ...JSON.parse(raw) }
    } catch { this.cache = { ...DEFAULTS } }
  }

  get(): CalendarSchedulingConfig {
    return this.cache ?? { ...DEFAULTS }
  }

  async save(config: CalendarSchedulingConfig): Promise<void> {
    await configStore.set(this.db, CONFIG_KEY, JSON.stringify(config))
    this.cache = config
  }

  async reload(): Promise<void> { await this.load() }
}
```

---

### `src/modules/google-apps/calendar-console.ts`

**Renderer HTML de la página de settings.**

Función principal exportada:

```typescript
export function renderCalendarSettingsPage(data: {
  config: CalendarSchedulingConfig
  roles: string[]
  coworkersByRole: Record<string, Array<{
    id: string
    displayName: string
    email: string
    role: string
  }>>
  calendarAccessStatus?: Record<string, { hasAccess: boolean; error?: string }>
  lang: 'es' | 'en'
}): string
```

**Secciones del UI (en orden):**

#### Sección 1: Ajustes generales (panel colapsable abierto)

| Campo | Tipo | Detalle |
|-------|------|---------|
| Google Meet | Toggle switch | `meetEnabled`, default ON |
| Duración predeterminada | Number input | min=15, max=480, step=5, default=30, suffix " min" |
| Nombre de la cita | Text input | placeholder "Reunión", `eventNamePrefix` |
| Preview nombre | Texto readonly | `"{eventNamePrefix} - Juan Pérez - Empresa S.A."` (actualiza en JS al cambiar input) |
| Instrucciones para descripción | Textarea | 4 rows, placeholder "Ej: Incluir motivo de la reunión, datos relevantes del cliente...", `descriptionInstructions` |

#### Sección 2: Recordatorios por defecto (panel colapsable)

- Lista editable de reminders
- Cada fila: `<select>` (popup/email) + `<input type="number">` (minutos) + botón X eliminar
- Botón "+ Agregar recordatorio" al final
- Default: 3 filas precargadas (popup 5min, popup 30min, email 2880min)
- JS: agregar/eliminar filas dinámicamente

#### Sección 3: Días no laborables (panel colapsable)

- **Nota informativa:** "El horario laboral y días de la semana se configuran en [Agente > Avanzado](/console/agente/advanced)." (link clickeable)
- Lista de entries:
  - Cada entry tiene radio: "Fecha única" / "Rango"
  - Si fecha única: `<input type="date">` para `date`
  - Si rango: `<input type="date">` para `start` + `<input type="date">` para `end`
  - Botón X eliminar
- Botón "+ Agregar día libre"
- JS: agregar/eliminar/toggle tipo dinámicamente

#### Sección 4: Asignación de equipo (panel colapsable, el más complejo)

**Nota:** "Selecciona qué roles de coworkers pueden recibir citas agendadas por Luna. Los roles se gestionan en [Contactos > Coworkers](/console/contacts/coworker)."

**Si no hay roles definidos:**
- Mensaje: "No hay roles/etiquetas definidas para coworkers. Créalas primero en Contactos > Coworkers > Etiquetas/Roles."
- Link a `/console/contacts/coworker`

**Para cada rol disponible** (leído de API):
- Card con:
  - Header: nombre del rol + toggle de activación
  - Body (visible solo si toggle ON):
    - Textarea: "Instrucciones de agendamiento para este rol"
      - Placeholder: "Ej: Agendar los clientes que están fuera del país"
    - **Lista de coworkers** de ese rol:
      - Si no hay coworkers con este rol: "No hay coworkers con el rol '{nombre}'. Asigna este rol a coworkers en Contactos."
      - Para cada coworker:
        - Checkbox (default ON): habilitar/deshabilitar para agendamiento
        - Nombre + email
        - Badge de acceso al calendario (verde/rojo/gris pendiente)
        - Textarea colapsable (aparece al hacer click en "Instrucciones"):
          - Placeholder: "Ej: Clientes en Brasil"
          - `schedulingCoworkers[userId].instructions`
    - Botón "Verificar acceso a calendarios" → llama API check-access → actualiza badges

#### Sección 5: Seguimiento automático (panel colapsable)

**Post-reunión:**
- Toggle: Activar/desactivar (`followUpPost.enabled`)
- Number input: Minutos después (min=30, max=360, default=60, step=15)
- Texto: "Luna enviará un mensaje al cliente y al coworker asignado después de la reunión preguntando cómo les fue."

**Pre-reunión (recordatorio):**
- Toggle: Activar/desactivar (`followUpPre.enabled`)
- Number input: Horas antes (min=3, max=24, default=24, step=1)
- Texto: "Luna enviará un recordatorio al cliente antes de la reunión."

---

**Botón "Guardar" (fijo al final o en save bar):**
- JS: recolecta TODOS los campos del form como JSON
- POST a `/console/api/google-apps/calendar-config`
- On success: toast "Guardado" + fetch `/console/apply` para hot-reload

**JavaScript inline necesario:**
```javascript
// Toggle de secciones colapsables
function gcalToggleSection(sectionId) { /* show/hide body */ }

// Toggle de rol → muestra/oculta coworkers + instrucciones
function gcalToggleRole(roleName) { /* show/hide role body, update state */ }

// Toggle de coworker instrucciones
function gcalToggleCoworkerInstructions(userId) { /* show/hide textarea */ }

// Agregar/eliminar recordatorio
function gcalAddReminder() { /* append row to reminders list */ }
function gcalRemoveReminder(idx) { /* remove row */ }

// Agregar/eliminar día off
function gcalAddDayOff() { /* append row */ }
function gcalRemoveDayOff(idx) { /* remove row */ }
function gcalToggleDayOffType(idx, type) { /* switch single/range */ }

// Preview del nombre de cita
function gcalUpdateNamePreview() { /* lee input, actualiza preview */ }

// Verificar acceso a calendarios
async function gcalCheckAccess() {
  // Recolectar emails de coworkers habilitados
  // POST /console/api/google-apps/calendar-check-access
  // Actualizar badges verde/rojo
}

// Guardar config
async function gcalSave() {
  // Recolectar todo el form como JSON
  // POST /console/api/google-apps/calendar-config
  // Toast success/error
  // fetch('/console/apply') para hot-reload
}
```

---

## Archivos a modificar

### `src/modules/google-apps/manifest.ts`

**En `init()`:**

```typescript
// Después de inicializar servicios de Calendar
const calConfigService = new CalendarConfigService(db)
await calConfigService.load()
registry.provide('google-apps:calendar-config', calConfigService)

// Provide renderer para la console
registry.provide('google-apps:renderCalendarSection', async (sectionData: any) => {
  const config = calConfigService.get()
  const usersDb = registry.getOptional<UsersDb>('users:db')

  // Leer roles disponibles de coworkers
  const coworkerListConfig = await usersDb?.getListConfig?.('coworker')
  const roles: string[] = ((coworkerListConfig?.syncConfig as any)?.roles as string[]) ?? []

  // Leer coworkers agrupados por role
  const allCoworkers = await usersDb?.listByType?.('coworker', true) ?? []
  const coworkersByRole: Record<string, Array<any>> = {}
  for (const role of roles) {
    coworkersByRole[role] = allCoworkers.filter(
      (u: any) => (u.metadata as any)?.role === role
    ).map((u: any) => ({
      id: u.id,
      displayName: u.displayName ?? u.id,
      email: u.contacts?.find((c: any) => c.channel === 'email')?.senderId ?? '',
      role,
    }))
  }

  return renderCalendarSettingsPage({
    config,
    roles,
    coworkersByRole,
    lang: sectionData.lang ?? 'es',
  })
})
```

**Agregar API routes (al array `apiRoutes`):**

```typescript
// GET /calendar-config
{
  method: 'GET',
  path: '/calendar-config',
  handler: async (_req, res) => {
    const config = calConfigService.get()
    // También retornar roles y coworkers para el form
    const usersDb = registry.getOptional('users:db')
    const coworkerListConfig = await usersDb?.getListConfig?.('coworker')
    const roles = (coworkerListConfig?.syncConfig as any)?.roles ?? []
    const allCoworkers = await usersDb?.listByType?.('coworker', true) ?? []
    // agrupar por role...
    jsonResponse(res, 200, { config, roles, coworkersByRole })
  },
}

// POST /calendar-config
{
  method: 'POST',
  path: '/calendar-config',
  handler: async (req, res) => {
    const body = await parseBody<CalendarSchedulingConfig>(req)
    // Validación básica
    if (body.defaultDurationMinutes < 15) body.defaultDurationMinutes = 15
    if (body.defaultDurationMinutes > 480) body.defaultDurationMinutes = 480
    if (body.followUpPost?.delayMinutes < 30) body.followUpPost.delayMinutes = 30
    if (body.followUpPost?.delayMinutes > 360) body.followUpPost.delayMinutes = 360
    if (body.followUpPre?.hoursBefore < 3) body.followUpPre.hoursBefore = 3
    if (body.followUpPre?.hoursBefore > 24) body.followUpPre.hoursBefore = 24

    await calConfigService.save(body)
    jsonResponse(res, 200, { ok: true })
  },
}

// POST /calendar-check-access
{
  method: 'POST',
  path: '/calendar-check-access',
  handler: async (req, res) => {
    const { emails } = await parseBody<{ emails: string[] }>(req)
    const cal = services.calendar  // CalendarService
    if (!cal) { jsonResponse(res, 400, { error: 'Calendar not enabled' }); return }

    const results: Record<string, { hasAccess: boolean; error?: string }> = {}
    const now = new Date()
    const oneHour = new Date(now.getTime() + 3600_000)

    for (const email of emails) {
      try {
        await cal.findFreeSlots(now.toISOString(), oneHour.toISOString(), [email])
        results[email] = { hasAccess: true }
      } catch (err: any) {
        results[email] = { hasAccess: false, error: err?.message ?? 'Unknown error' }
      }
    }
    jsonResponse(res, 200, results)
  },
}
```

**Agregar hook listener para hot-reload:**

```typescript
registry.addHook('google-apps', 'console:config_applied', async () => {
  await calConfigService?.reload()
}, 100)
```

---

### `src/modules/console/templates-section-channels.ts`

**En `renderGoogleAppsSection()` — card de Calendar:**

Buscar donde se renderiza la card de Calendar (dentro del loop de services). Agregar un botón "Configurar" similar al patrón de Contacts (ver screenshots).

```html
<!-- Dentro de la card de Calendar, después del toggle -->
<a href="/console/herramientas/google-apps/calendar"
   class="btn btn-sm btn-outline"
   style="margin-left: 8px;">
  Configurar
</a>
```

El botón solo aparece si Calendar está en `GOOGLE_ENABLED_SERVICES`.

---

### `src/modules/console/server.ts`

**Agregar handler para la subpage** (cerca de línea 1033, donde están los handlers de herramientas):

```typescript
else if (herramientasSubpage === 'google-apps/calendar') {
  const renderFn = registry.getOptional<
    (data: SectionData) => Promise<string>
  >('google-apps:renderCalendarSection')
  if (renderFn) {
    sectionData.herramientasContent = await renderFn(sectionData)
  } else {
    sectionData.herramientasContent = notAvailable('Google Calendar')
  }
}
```

**IMPORTANTE:** Este case debe ir ANTES del case `google-apps` genérico para que el match más específico gane.

---

### `src/modules/console/templates-i18n.ts`

Agregar keys (en sección de herramientas/tools):

```typescript
// Google Calendar settings
gcal_settings_title: { es: 'Configuración de Google Calendar', en: 'Google Calendar Settings' },
gcal_general: { es: 'Ajustes generales', en: 'General settings' },
gcal_meet_enabled: { es: 'Incluir Google Meet por defecto', en: 'Include Google Meet by default' },
gcal_duration: { es: 'Duración predeterminada', en: 'Default duration' },
gcal_event_name: { es: 'Nombre de la cita', en: 'Event name' },
gcal_event_name_preview: { es: 'Vista previa', en: 'Preview' },
gcal_description_instructions: { es: 'Instrucciones para la descripción', en: 'Description instructions' },
gcal_reminders: { es: 'Recordatorios por defecto', en: 'Default reminders' },
gcal_add_reminder: { es: 'Agregar recordatorio', en: 'Add reminder' },
gcal_days_off: { es: 'Días no laborables', en: 'Days off' },
gcal_days_off_note: { es: 'El horario laboral y días de la semana se configuran en', en: 'Business hours and weekdays are configured in' },
gcal_add_day_off: { es: 'Agregar día libre', en: 'Add day off' },
gcal_single_date: { es: 'Fecha única', en: 'Single date' },
gcal_date_range: { es: 'Rango', en: 'Range' },
gcal_team: { es: 'Asignación de equipo', en: 'Team assignment' },
gcal_team_note: { es: 'Selecciona qué roles pueden recibir citas agendadas por Luna', en: 'Select which roles can receive appointments scheduled by Luna' },
gcal_no_roles: { es: 'No hay roles definidos para coworkers.', en: 'No roles defined for coworkers.' },
gcal_role_instructions: { es: 'Instrucciones de agendamiento para este rol', en: 'Scheduling instructions for this role' },
gcal_coworker_instructions: { es: 'Instrucciones específicas', en: 'Specific instructions' },
gcal_check_access: { es: 'Verificar acceso a calendarios', en: 'Check calendar access' },
gcal_access_ok: { es: 'Acceso OK', en: 'Access OK' },
gcal_no_access: { es: 'Sin acceso', en: 'No access' },
gcal_followups: { es: 'Seguimiento automático', en: 'Automatic follow-up' },
gcal_followup_post: { es: 'Seguimiento post-reunión', en: 'Post-meeting follow-up' },
gcal_followup_post_desc: { es: 'Luna enviará un mensaje al cliente y al coworker preguntando cómo les fue.', en: 'Luna will send a message to the client and coworker asking how it went.' },
gcal_followup_pre: { es: 'Recordatorio pre-reunión', en: 'Pre-meeting reminder' },
gcal_followup_pre_desc: { es: 'Luna enviará un recordatorio al cliente antes de la reunión.', en: 'Luna will send a reminder to the client before the meeting.' },
gcal_save: { es: 'Guardar', en: 'Save' },
gcal_configure: { es: 'Configurar', en: 'Configure' },
```

---

## Orden de implementación

1. `calendar-config.ts` — crear servicio de config
2. `calendar-console.ts` — crear renderer HTML completo
3. `manifest.ts` — agregar API routes, proveer servicio y renderer, hook de reload
4. `templates-section-channels.ts` — agregar botón "Configurar" en card Calendar
5. `server.ts` — agregar handler para subpage
6. `templates-i18n.ts` — agregar keys
7. Compilar: `docker run --rm -v /docker/luna-repo:/app -w /app node:22-alpine npx tsc --noEmit`

---

## Criterios de aceptación

- [ ] Botón "Configurar" visible en card de Calendar en `/console/herramientas/google-apps`
- [ ] Botón lleva a `/console/herramientas/google-apps/calendar`
- [ ] Toggle existente de Calendar sigue funcionando (activar/desactivar servicio)
- [ ] Página de settings renderiza correctamente con todas las secciones
- [ ] Sección General: todos los campos funcionan y persisten
- [ ] Sección Recordatorios: agregar/eliminar dinámicamente, persisten
- [ ] Sección Días off: agregar/eliminar, tipo single/range, persisten
- [ ] Sección Equipo: roles se cargan de users module, coworkers se muestran por rol
- [ ] Sección Equipo: toggle de rol muestra/oculta coworkers
- [ ] Sección Equipo: instrucciones por rol y por coworker persisten
- [ ] Sección Equipo: "Verificar acceso" hace probe FreeBusy y muestra badges
- [ ] Sección Equipo: si no hay roles, muestra mensaje con link a Contacts
- [ ] Sección Follow-ups: toggles y valores numéricos persisten
- [ ] Config se guarda en config_store como JSON
- [ ] Servicio `google-apps:calendar-config` está disponible via registry
- [ ] Hot-reload funciona (hook `console:config_applied` recarga cache)
- [ ] TypeScript compila sin errores
- [ ] Imports con extensión `.js`

---

## Notas para el ejecutor

- **Leer archivos antes de modificar** — cada archivo que se modifique debe leerse primero
- **Patrón de renderizado** — seguir el mismo patrón que `renderGoogleAppsSection()` en `templates-section-channels.ts`: funciones que retornan strings HTML
- **CSS** — usar las clases existentes del design system de console (panel, toggle, btn, field-label, etc.). Ver `src/modules/console/ui/styles/components.css`
- **JavaScript** — inline en el HTML retornado (mismo patrón que google-apps section actual)
- **NO usar frameworks** — SSR puro, strings HTML concatenados
- **jsonResponse, parseBody** — importar de `../../kernel/http-helpers.js`
- **config_store** — importar de `../../kernel/config-store.js`
- **UsersDb type** — verificar el tipo exacto del servicio `users:db` leyendo `src/modules/users/manifest.ts`
- **Breadcrumb** — la página debería mostrar: Herramientas > Google Workspace > Calendar (verificar cómo otras subpages manejan breadcrumbs)
