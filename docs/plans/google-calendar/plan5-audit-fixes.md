# Plan 5: Fixes de Auditoría — Google Calendar

**Branch:** `feat/gcal-plan5-audit-fixes` (derivado de `claude/plan-google-calendar-W94gU`)
**Dependencias:** Planes 1-4 mergeados
**Ejecutable en:** Un solo plan, un solo ejecutor

---

## Objetivo

Aplicar todos los fixes identificados en la auditoría (`docs/reports/AUDIT-google-calendar.md`) — bloqueantes + deberías + nice-to-have. Un solo PR que limpie todo.

---

## Fixes (en orden de ejecución recomendado)

### FIX 1: Consolidar tipo + defaults duplicados [DEUDA-1 + DEUDA-2]

**Problema:** `CalendarSchedulingConfig` definida en `types.ts` Y `calendar-config.ts`. `DEFAULT_CALENDAR_CONFIG` duplicada en `tools.ts` Y `calendar-config.ts`.

**Acción:**

1. **`src/modules/google-apps/types.ts`** — MANTENER la definición de `CalendarSchedulingConfig` aquí (es el canonical). Verificar que incluye todos los campos que usa `calendar-config.ts`.

2. **`src/modules/google-apps/calendar-config.ts`** — ELIMINAR la definición local de `CalendarSchedulingConfig`. Importarla de `./types.js`:
   ```typescript
   import type { CalendarSchedulingConfig } from './types.js'
   ```
   RENOMBRAR `CALENDAR_CONFIG_DEFAULTS` a `CALENDAR_CONFIG_DEFAULTS` y **exportarla**:
   ```typescript
   export const CALENDAR_CONFIG_DEFAULTS: CalendarSchedulingConfig = { ... }
   ```

3. **`src/modules/google-apps/tools.ts`** — ELIMINAR `DEFAULT_CALENDAR_CONFIG`. Importar:
   ```typescript
   import { CALENDAR_CONFIG_DEFAULTS } from './calendar-config.js'
   ```
   Actualizar `getCalendarConfig()` para usar `CALENDAR_CONFIG_DEFAULTS` como fallback.

---

### FIX 2: XSS en `esc()` [BUG-1 / SEC-1]

**Problema:** `esc()` en `calendar-console.ts` no escapa comillas simples. Los valores se usan en `onclick="fn('${esc(val)}')"`.

**Acción en `src/modules/google-apps/calendar-console.ts`:**

Buscar la función `esc()` y agregar el escape de `'`:
```typescript
// ANTES (probablemente):
function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

// DESPUÉS:
function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')
}
```

Verificar que TODOS los usos de `esc()` en atributos `onclick` con comillas simples estén cubiertos. Buscar todos los `onclick=` en el archivo.

---

### FIX 3: `getNextBusinessSlot()` retorne null [BUG-2]

**Problema:** Si no encuentra slot hábil en 30 días, retorna la fecha original (inválida).

**Acción en `src/modules/google-apps/calendar-helpers.ts`:**

1. Cambiar signature: `function getNextBusinessSlot(...): string | null`
2. Al final del loop (después de iterar 30 días sin éxito): `return null` en vez de retornar `fromDate`
3. Actualizar callers (`validateEventTiming()`) para manejar `null`:
   ```typescript
   const suggestion = getNextBusinessSlot(...)
   if (suggestion) {
     return { valid: false, errors, suggestion }
   } else {
     return { valid: false, errors, suggestion: undefined }
     // O agregar a errors: "No se encontró un horario disponible en los próximos 30 días"
   }
   ```
4. Actualizar type de `validateEventTiming()` return si `suggestion` era `string` → ahora `string | undefined`

---

### FIX 4: Logging en `buildDateTimeInTimezone()` [BUG-3]

**Problema:** Silencia todos los errores de timezone sin logging.

**Acción en `src/modules/google-apps/calendar-helpers.ts`:**

1. Importar logger (verificar cómo otros archivos en google-apps importan pino — probablemente usan `registry` o importan directo):
   - Opción A: Si hay un logger importable, usarlo
   - Opción B: Usar `console.warn` como fallback mínimo (menos ideal pero funcional)

2. En el catch:
   ```typescript
   // ANTES:
   catch { return null }

   // DESPUÉS:
   catch (err) {
     // Log a warning so invalid timezone config is visible
     const msg = err instanceof Error ? err.message : String(err)
     console.warn(`[calendar-helpers] buildDateTimeInTimezone failed for tz="${timezone}": ${msg}`)
     return null
   }
   ```

---

### FIX 5: Validación Zod en `save()` [SEC-2]

**Problema:** `CalendarConfigService.save()` acepta cualquier objeto sin validación.

**Acción en `src/modules/google-apps/calendar-config.ts`:**

1. Importar `z` de `zod`
2. Crear schema de validación:
   ```typescript
   import { z } from 'zod'

   const dayOffSchema = z.discriminatedUnion('type', [
     z.object({ type: z.literal('single'), date: z.string() }),
     z.object({ type: z.literal('range'), start: z.string(), end: z.string() }),
   ])

   const reminderSchema = z.object({
     method: z.enum(['email', 'popup']),
     minutes: z.number().int().min(0).max(40320),
   })

   const calendarConfigSchema = z.object({
     meetEnabled: z.boolean().default(true),
     defaultReminders: z.array(reminderSchema).default([]),
     defaultDurationMinutes: z.number().int().min(15).max(480).default(30),
     eventNamePrefix: z.string().default('Reunión'),
     descriptionInstructions: z.string().default(''),
     daysOff: z.array(dayOffSchema).default([]),
     schedulingRoles: z.record(z.object({
       enabled: z.boolean(),
       instructions: z.string().default(''),
     })).default({}),
     schedulingCoworkers: z.record(z.object({
       enabled: z.boolean(),
       instructions: z.string().default(''),
     })).default({}),
     followUpPost: z.object({
       enabled: z.boolean().default(true),
       delayMinutes: z.number().int().min(30).max(360).default(60),
     }).default({}),
     followUpPre: z.object({
       enabled: z.boolean().default(true),
       hoursBefore: z.number().int().min(3).max(24).default(24),
     }).default({}),
   })
   ```

3. En `save()`:
   ```typescript
   async save(input: unknown): Promise<void> {
     const config = calendarConfigSchema.parse(input)
     await configStore.set(this.db, CONFIG_KEY, JSON.stringify(config))
     this.cache = config
   }
   ```

4. En `load()` también parsear con `.safeParse()` para proteger contra datos corruptos en DB:
   ```typescript
   const parsed = calendarConfigSchema.safeParse(JSON.parse(raw))
   this.cache = parsed.success ? parsed.data : { ...CALENDAR_CONFIG_DEFAULTS }
   ```

---

### FIX 6: Hook payload types [DEUDA-3]

**Acción en `src/kernel/types.ts`:**

Buscar las interfaces de payload y corregir:
```typescript
// ANTES:
export interface CalendarEventCreatedPayload {
  event?: unknown
  contactId?: string
  channel?: string
}
export interface CalendarEventDeletedPayload {
  eventId: unknown
}

// DESPUÉS:
export interface CalendarEventCreatedPayload {
  event?: Record<string, unknown>   // CalendarEvent shape, no importar del módulo
  contactId: string                 // required — siempre viene del pipeline
  channel: string                   // required — siempre viene del canal
  meetLink?: string
}
export interface CalendarEventDeletedPayload {
  eventId: string                   // siempre es string
}
export interface CalendarEventUpdatedPayload {
  eventId: string
  event?: Record<string, unknown>
  dateChanged: boolean
}
```

Luego verificar que los callers en `tools.ts` y `calendar-followups.ts` sigan compilando (ya envían estos campos).

---

### FIX 7: Eliminar dead code [C-2]

**Acción en `src/modules/google-apps/calendar-helpers.ts`:**

Buscar el check `if (!datePart)` dentro de `validateEventTiming()` y eliminarlo. `split('T')[0]` siempre retorna string.

---

### FIX 8: Unificar `UsersDb` partial interface [R-5]

**Problema:** `calendar-followups.ts` y `manifest.ts` definen cada uno su propia versión parcial de la interfaz de `users:db`.

**Acción:**

1. Buscar las dos definiciones inline de `UsersDb` (o como se llame) en:
   - `calendar-followups.ts`
   - `manifest.ts` (las adiciones de Plan 2 y Plan 3)
2. Crear UNA interfaz parcial en `calendar-followups.ts` (o en un helper) y exportarla:
   ```typescript
   export interface CalendarUsersDb {
     listByType(type: string, includeContacts?: boolean): Promise<Array<{
       id: string
       displayName: string | null
       metadata: Record<string, unknown>
       contacts?: Array<{ channel: string; senderId: string }>
     }>>
     getListConfig?(type: string): Promise<{
       syncConfig?: { roles?: string[] }
     } | null>
   }
   ```
3. Importar esta interfaz en `manifest.ts` desde `./calendar-followups.js`

---

### FIX 9: Decidir sobre BUG-4 (break en coworker follow-up) [BUG-4]

**Problema:** Solo el primer coworker attendee recibe follow-up post-reunión por un `break` en el loop.

**Acción en `src/modules/google-apps/calendar-followups.ts`:**

- **Si es intencional** (un evento normalmente tiene 1 coworker asignado): agregar comentario explicativo:
  ```typescript
  // Only the first matching coworker receives post-meeting follow-up
  // (events typically have 1 assigned coworker)
  break
  ```
- **Si todos deben recibir**: eliminar el `break`

**Decisión recomendada:** Mantener el `break` con comentario. El flujo normal de scheduling asigna 1 coworker por cita.

---

### FIX 10: Documentar race condition en `rescheduleFollowUps()` [BUG-5]

**Acción en `src/modules/google-apps/calendar-followups.ts`:**

Agregar comentario en el método `rescheduleFollowUps()`:

```typescript
/**
 * Reschedule follow-ups when event dates change.
 * Note: If called concurrently for the same event (rapid edits),
 * duplicate tasks may be created. This is mitigated by:
 * 1. calendar-execute-followup is idempotent (checks status before sending)
 * 2. Low probability in practice (pipeline serializes per-contact)
 * A proper fix would use optimistic locking (UPDATE ... WHERE status='pending' RETURNING id).
 */
```

---

## Orden de ejecución

1. **FIX 1** — Consolidar tipo + defaults (otros fixes importan de aquí)
2. **FIX 2** — XSS (bloqueante)
3. **FIX 5** — Zod validation (usa el tipo consolidado del FIX 1)
4. **FIX 3** — getNextBusinessSlot null
5. **FIX 4** — Logging timezone
6. **FIX 6** — Hook payload types
7. **FIX 7** — Dead code
8. **FIX 8** — UsersDb unificado
9. **FIX 9** — Comentario break
10. **FIX 10** — Comentario race condition

---

## Criterios de aceptación

- [ ] `CalendarSchedulingConfig` definida en UN solo archivo (`types.ts`)
- [ ] `CALENDAR_CONFIG_DEFAULTS` exportada de UN solo archivo (`calendar-config.ts`)
- [ ] `esc()` escapa `'` → `&#39;`
- [ ] `getNextBusinessSlot()` retorna `null` si no encuentra slot
- [ ] `buildDateTimeInTimezone()` loguea el error antes de retornar null
- [ ] `save()` valida input con Zod schema
- [ ] `load()` usa safeParse para proteger contra data corrupta
- [ ] Hook payloads con tipos correctos (string, required donde corresponde)
- [ ] Dead code eliminado
- [ ] UsersDb partial interface definida en un solo lugar
- [ ] Comentario en break de coworker follow-up
- [ ] Comentario en rescheduleFollowUps sobre race condition
- [ ] TypeScript compila sin errores nuevos
- [ ] Imports con extensión `.js`

---

## Notas para el ejecutor

- **Leer cada archivo ANTES de modificar** — los planes anteriores ya modificaron estos archivos, el estado actual puede diferir del plan original
- **FIX 1 es fundacional** — hacerlo primero porque FIX 5 depende del tipo consolidado
- **Zod ya está en el proyecto** — importar `z` de `'zod'` directamente, no instalar nada nuevo
- **NO crear archivos nuevos** — todo es modificación de archivos existentes
- **Verificar que `calendar-console.ts` realmente tiene una función `esc()`** — leer el archivo para confirmar la implementación exacta antes de modificar
- **Compilar al final** — `docker run --rm -v /docker/luna-repo:/app -w /app node:22-alpine npx tsc --noEmit`
