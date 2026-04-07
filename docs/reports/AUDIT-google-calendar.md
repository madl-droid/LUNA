# AUDITORÍA — Google Calendar (rama `claude/plan-google-calendar-W94gU`)

**Fecha:** 2026-04-07
**Auditor:** Claude (sesión audit-google-calendar)
**Commits auditados:** `894386e` → `ae8f637` (5 commits: docs + Plan 1-4)
**Archivos nuevos:** 12 | **Archivos modificados:** 8 | **~2,744 líneas añadidas**

---

## Resumen ejecutivo

La implementación cubre los 4 planes de forma completa y coherente. La arquitectura sigue los patrones existentes del proyecto (medilink follow-ups, subagent seeds, console SSR). Sin embargo, hay **1 vulnerabilidad de seguridad**, **3 bugs reales**, **3 deudas significativas** y **varias redundancias** que se detallan a continuación.

**Calificación general: 6.5/10** — Funcional pero necesita correcciones antes de merge.

---

## BUGS

### BUG-1: `esc()` no protege contexto JavaScript en onclick handlers (XSS)
- **Archivo:** `calendar-console.ts` líneas 201, 211, 215, 229
- **Severidad:** ALTA (seguridad)
- **Descripción:** La función `esc()` solo escapa HTML entities (`& < > "`), pero los valores de `roleName` y `cw.id` se inyectan dentro de atributos `onclick` con comillas simples:
  ```html
  onclick="gcalToggleRole('${esc(roleName)}')"
  onclick="gcalToggleCoworkerInstructions('${esc(cw.id)}')"
  ```
  Si `roleName` contiene una comilla simple (`'`), se rompe el contexto JavaScript. Ejemplo: un rol llamado `it's admin` genera `onclick="gcalToggleRole('it's admin')"` — eso es XSS.
- **`esc()` no escapa `'`** (solo escapa `"` → `&quot;`). Dentro de un atributo `onclick='...'` delimitado por `"`, la comilla simple rompe el string JS interno.
- **Fix:** Escapar `'` → `&#39;` en `esc()`, o mejor: usar `data-*` attributes + event delegation en vez de inline handlers.

### BUG-2: `getNextBusinessSlot()` retorna fecha inválida si no encuentra slot en 30 días
- **Archivo:** `calendar-helpers.ts` línea ~90-101
- **Severidad:** MEDIA
- **Descripción:** El loop itera máximo 30 días. Si no encuentra día hábil (ej: configuración con `days: []` vacío, o 30+ días off seguidos), retorna silenciosamente el `fromDate` original — que es exactamente la fecha que ya se determinó como inválida.
- **Impacto:** El agente sugiere al cliente una fecha en día no laboral como "sugerencia".
- **Fix:** Retornar `null` si no hay slot en 30 días, y que el caller maneje el caso.

### BUG-3: `buildDateTimeInTimezone()` silencia todos los errores
- **Archivo:** `calendar-helpers.ts` línea ~128
- **Severidad:** MEDIA
- **Descripción:** `try { ... } catch { return null }` sin logging. Si se pasa un timezone inválido (ej: typo en config), la función falla silenciosamente y los callers usan un fallback naive sin timezone.
- **Impacto:** Validación de business hours opera en UTC cuando el timezone es inválido, aceptando/rechazando horarios incorrectamente.
- **Fix:** Loguear el error con `pino` y/o validar timezone al inicio del flujo.

---

## VULNERABILIDADES DE SEGURIDAD

### SEC-1: XSS via inline onclick en calendar-console.ts
- **(Detallado en BUG-1 arriba)**
- **Contexto adicional:** Aunque `roleName` y `cw.id` vienen de la DB (no de input directo del usuario), el administrador de console puede crear roles con nombres arbitrarios. Un admin malicioso o un valor corrupto puede escalar.
- **Vectores de explotación:**
  1. Crear un rol con nombre conteniendo `'); alert(document.cookie);//`
  2. El HTML renderizado por SSR contiene JS ejecutable
  3. Cualquier admin que visite la página Calendar Settings ejecuta el payload

### SEC-2: Sin validación de schema en `CalendarConfigService.save()`
- **Archivo:** `calendar-config.ts` línea 78
- **Severidad:** BAJA
- **Descripción:** `save()` acepta cualquier objeto que se le pase. El endpoint de manifest.ts hace clamping de valores numéricos (líneas 330-339), pero no valida estructura, tipos de campos, ni array contents.
- **Impacto:** Un POST malformado al API endpoint puede guardar config con campos faltantes o tipos incorrectos, causando runtime errors downstream.
- **Fix:** Validar con Zod schema antes de guardar.

---

## DEUDAS TÉCNICAS

### DEUDA-1: `CalendarSchedulingConfig` definida en 2 archivos
- **Archivos:** `types.ts` Y `calendar-config.ts`
- **Descripción:** La interfaz `CalendarSchedulingConfig` está definida en:
  1. `src/modules/google-apps/types.ts` — importada por `tools.ts` y `calendar-followups.ts`
  2. `src/modules/google-apps/calendar-config.ts` — importada por `calendar-console.ts`
- **Riesgo:** Si se modifica una y no la otra, se rompe silenciosamente (TS no detecta incompatibilidades entre dos interfaces idénticas). Los archivos ya difieren: `types.ts` tiene la propiedad `DayOff` como union simplificada vs `calendar-config.ts` que la tiene inline.
- **Fix:** Definir UNA sola vez en `types.ts` y que `calendar-config.ts` la importe.

### DEUDA-2: `DEFAULT_CALENDAR_CONFIG` duplicada en 2 archivos
- **Archivos:** `tools.ts` (línea 27) Y `calendar-config.ts` (línea 42, como `CALENDAR_CONFIG_DEFAULTS`)
- **Descripción:** Los defaults son idénticos pero definidos por separado. El plan lo marcaba explícitamente ("DEBEN ser IDÉNTICOS"), pero la solución correcta es no duplicar.
- **Riesgo:** Drift entre las dos copias. Agregar un campo nuevo requiere modificar ambos.
- **Fix:** Exportar `CALENDAR_CONFIG_DEFAULTS` desde `calendar-config.ts` e importar en `tools.ts`.

### DEUDA-3: Hook payload types son `unknown` en kernel/types.ts
- **Archivo:** `src/kernel/types.ts`
- **Descripción:** Los payloads de hooks de Calendar usan `unknown` para event fields:
  ```typescript
  export interface CalendarEventCreatedPayload {
    event?: unknown       // debería ser CalendarEvent
    contactId?: string    // debería ser required
    channel?: string      // debería ser required
  }
  export interface CalendarEventDeletedPayload {
    eventId: unknown      // debería ser string
  }
  ```
- **Impacto:** Los consumers hacen `as CalendarEvent` cast en lugar de tener type safety. Pero esto es por diseño — el kernel no importa tipos de módulos para evitar dependencias circulares.
- **Fix parcial:** Hacer los campos `contactId` y `channel` required (no `?`) ya que el caller siempre los envía, y usar `string` para `eventId`.

---

## REDUNDANCIAS / DUPLICACIONES

| # | Qué | Dónde | Impacto |
|---|-----|-------|---------|
| R-1 | `CalendarSchedulingConfig` type | `types.ts` + `calendar-config.ts` | 2 definiciones, drift posible |
| R-2 | `DEFAULT_CALENDAR_CONFIG` | `tools.ts` + `calendar-config.ts` | 2 defaults, sync manual |
| R-3 | `getCalendarConfig()` helper | `tools.ts` línea 44 | Funciona, pero repite lógica de fallback que `CalendarConfigService.get()` ya tiene |
| R-4 | `getBusinessHours()` helper | `tools.ts` línea 49 | Se llama 4 veces, ok, pero la firma del registry service está hardcodeada en un inline type |
| R-5 | `UsersDb` interface | `calendar-followups.ts` + `manifest.ts` (inline) | Cada archivo define su propia versión parcial de la interfaz de users:db |

---

## COMPLEJIDAD INNECESARIA

### C-1: `validateEventTiming()` parsea manualmente lo que `new Date()` ya hace
- **Archivo:** `calendar-helpers.ts` líneas 150+
- **Descripción:** Split por `'T'`, `toLocaleString()` para extraer horas, parsing manual de timezone. Mucho de esto se puede simplificar con `Intl.DateTimeFormat` o simplemente `new Date()` + arithmetic.
- **No es bloqueante** pero aumenta la superficie de bugs (ver BUG-2, BUG-3).

### C-2: Dead code check en `validateEventTiming()`
- **Archivo:** `calendar-helpers.ts` línea ~151
- **Descripción:** `const datePart = startDateTime.split('T')[0]; if (!datePart)` — `split()[0]` SIEMPRE retorna un string (nunca undefined/empty si el input no es empty string). Este check es dead code.

### C-3: El subagent tiene `calendar-get-scheduling-context` como "primera acción obligatoria"
- **Descripción:** Cada invocación del subagent consume 1 tool call extra (~800 tokens de output) para leer la config. La config podría inyectarse directamente en el system prompt del subagent en runtime, eliminando el round-trip.
- **No es bug** — es un trade-off de diseño (config dinámica vs performance).

---

## VERIFICACIÓN DE POLÍTICAS (CLAUDE.md)

| Política | Status | Nota |
|----------|--------|------|
| ESM imports con `.js` | ✅ PASS | Todos los archivos usan extensión .js |
| No `process.env` directo | ✅ PASS | Solo `registry.getConfig()` y `configStore` |
| No duplicar HTTP helpers | ✅ PASS | Usa `jsonResponse`, `parseBody`, `parseQuery` del kernel |
| No duplicar config helpers | ✅ PASS | Usa `numEnv` del kernel donde aplica |
| `noUncheckedIndexedAccess` | ⚠️ PARCIAL | Casi todo bien, pero `names[isoWeekday]` en helpers y `a.email` en tools.ts carecen de guard |
| No ORM | ✅ PASS | Raw SQL con queries parametrizadas |
| No SPA en console | ✅ PASS | SSR puro con templates server-side |
| No import entre módulos | ✅ PASS | Usa hooks y registry services |
| Migraciones idempotentes | ✅ PASS | `IF NOT EXISTS` en 047, `ON CONFLICT` en 046 |
| Compilar antes de push | ❓ SIN VERIFICAR | No hay evidencia de que se compiló (no hay CI check en el commit) |
| Fallback messages no-LLM | ✅ PASS | Follow-up messages son templates predefinidos |

---

## ARCHIVOS AUDITADOS

### Plan 1 — Service & Tools Enhancement
| Archivo | Líneas | Veredicto |
|---------|--------|-----------|
| `calendar-helpers.ts` (NEW) | 408 | BUG-2, BUG-3, C-1, C-2. Funcional pero frágil en edge cases |
| `calendar-service.ts` (MOD) | +146 | Correcto. Meet auto, checkAvailability, conflict check ok |
| `tools.ts` (MOD) | +259 | R-2, R-3. Funcional. Tools bien estructuradas |
| `types.ts` (MOD) | +49 | DEUDA-1 (tipo duplicado con calendar-config.ts) |
| `kernel/types.ts` (MOD) | +23 | DEUDA-3 (payloads usan unknown) |

### Plan 2 — Console Settings
| Archivo | Líneas | Veredicto |
|---------|--------|-----------|
| `calendar-config.ts` (NEW) | 89 | SEC-2, DEUDA-1, DEUDA-2. Simple, funcional, falta validación |
| `calendar-console.ts` (NEW) | 608 | **BUG-1/SEC-1 (XSS)**. UI completa y funcional |
| `manifest.ts` (MOD) | +129 | Correcto. API routes, renderer, hot-reload ok |
| `console/server.ts` (MOD) | +10 | Correcto |
| `templates-section-channels.ts` (MOD) | +17 | Correcto. Botón "Configurar" bien ubicado |
| `templates-i18n.ts` (MOD) | +60 | Correcto. Keys bilingües |

### Plan 3 — Subagent + Skills
| Archivo | Líneas | Veredicto |
|---------|--------|-----------|
| `046_gcal-scheduler-subagent.sql` (NEW) | 28 | Correcto. ON CONFLICT, idempotente |
| 5 skill files `.md` (NEW) | ~190 | Correctos. Frontmatter ok, tool names coinciden |
| `tools.ts` (MOD, scheduling-context) | +103 | Correcto. Output formateado legible |
| `manifest.ts` (MOD, subagent enable) | +28 | Correcto. Enable/disable con reload de catalog |

### Plan 4 — Follow-ups
| Archivo | Líneas | Veredicto |
|---------|--------|-----------|
| `047_gcal-followups.sql` (NEW) | 29 | Correcto. IF NOT EXISTS, 3 índices parciales |
| `calendar-followups.ts` (NEW) | 561 | R-5. Bien implementado, sigue patrón medilink |
| `manifest.ts` (MOD, hooks) | +47 | Correcto. 3 hooks, tool registration, cleanup |

---

## PRIORIDADES DE FIX

### Debe arreglarse antes de merge
1. **BUG-1/SEC-1:** XSS en `esc()` — agregar escape de `'` → `&#39;` como mínimo
2. **DEUDA-1 + DEUDA-2:** Consolidar `CalendarSchedulingConfig` y `DEFAULT_CALENDAR_CONFIG` en un solo lugar

### Debería arreglarse pronto
3. **BUG-2:** `getNextBusinessSlot()` retorne null si no encuentra slot
4. **BUG-3:** Loguear error en `buildDateTimeInTimezone()`
5. **SEC-2:** Validación Zod en `CalendarConfigService.save()`
6. **DEUDA-3:** `CalendarEventDeletedPayload.eventId` → `string`

### Nice to have
7. **C-2:** Eliminar dead code check `if (!datePart)`
8. **R-5:** Unificar `UsersDb` partial interface
9. **C-3:** Evaluar inyectar config en system prompt vs tool call

---

## COSAS QUE ESTÁN BIEN

- Patrón de follow-ups es robusto: sigue exactamente medilink, usa scheduled-tasks, cleanup correcto en cancel/reschedule
- SQL idempotente en ambas migraciones
- Skills bien escritas con protocolos claros paso a paso
- Console SSR pura sin frameworks ni SPA
- Todos los tools con output formateado legible (no JSON crudo)
- Fire-and-forget correcto en hooks con `.catch()` para error handling
- Guards de null/undefined consistentes con `??` y `?.`
- No hay imports directos entre módulos — todo via registry
- Hot-reload de config funciona via hook `console:config_applied`
