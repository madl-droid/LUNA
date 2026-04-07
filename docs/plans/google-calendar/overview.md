# Google Calendar — Plan de Ejecución

**Fecha:** 2026-04-07
**Branch base:** `claude/plan-google-calendar-W94gU`
**Objetivo:** Implementar capacidades completas de agendamiento con Google Calendar en LUNA.

---

## Contexto

LUNA tiene un módulo `google-apps` que ya provee un servicio de Calendar con CRUD básico y 6 tools. Sin embargo, le falta: Google Meet automático, reminders, conflict check, business hours validation, FreeBusy inteligente, tools de get/delete, formatted output, página de configuración dedicada, subagent de agendamiento, y follow-ups automáticos.

Este plan cierra todos los gaps comparado con el prototipo anterior (Valeria) y agrega funcionalidad nueva (subagent con skills, follow-ups pre/post reunión, configuración de equipo por roles).

---

## Estructura de Planes

```
                    ┌─────────────────────┐    ┌─────────────────────┐
                    │  PLAN 1             │    │  PLAN 2             │
                    │  Service & Tools    │    │  Console Settings   │
                    │  Enhancement        │    │  Página Calendar    │
                    └────────┬────────────┘    └────────┬────────────┘
                             │                          │
                             ▼                          ▼
                    ┌────────┴──────────────────────────┴────────────┐
                    │              Ambos completados                  │
                    └────────┬──────────────────────────┬────────────┘
                             │                          │
                    ┌────────▼────────────┐    ┌────────▼────────────┐
                    │  PLAN 3             │    │  PLAN 4             │
                    │  Subagent + Skills  │    │  Follow-ups Auto    │
                    │  (EN PARALELO)      │    │  (EN PARALELO)      │
                    └─────────────────────┘    └─────────────────────┘
```

**Oleada 1 (paralelo):** Plan 1 + Plan 2
**Oleada 2 (paralelo):** Plan 3 + Plan 4

---

## Planes

| Plan | Archivo | Branch derivado | Depende de | Scope |
|------|---------|-----------------|------------|-------|
| 1 | [plan1-service-tools.md](./plan1-service-tools.md) | `feat/gcal-plan1-service-tools` | — | Mejorar calendar-service, tools existentes, agregar tools faltantes, helpers |
| 2 | [plan2-console-settings.md](./plan2-console-settings.md) | `feat/gcal-plan2-console-settings` | — | Página de configuración Calendar en console, servicio de config |
| 3 | [plan3-subagent-skills.md](./plan3-subagent-skills.md) | `feat/gcal-plan3-subagent` | Plan 1 + 2 | Subagent de agendamiento, skills por escenario, migration |
| 4 | [plan4-followups.md](./plan4-followups.md) | `feat/gcal-plan4-followups` | Plan 1 + 2 | Follow-ups post/pre reunión, scheduled tasks, migration |

---

## Archivos principales afectados

### Modificados
- `src/modules/google-apps/calendar-service.ts` — Meet, conflict check, checkAvailability (Plan 1)
- `src/modules/google-apps/tools.ts` — Todos los tools de calendar (Plan 1, 3, 4)
- `src/modules/google-apps/types.ts` — Nuevas interfaces (Plan 1, 2)
- `src/modules/google-apps/manifest.ts` — API routes, servicios, hooks (Plan 1, 2, 3, 4)
- `src/modules/console/server.ts` — Handler para subpage calendar (Plan 2)
- `src/modules/console/templates-section-channels.ts` — Botón "Configurar" en card Calendar (Plan 2)
- `src/modules/console/templates-i18n.ts` — Keys de i18n (Plan 2)

### Nuevos
- `src/modules/google-apps/calendar-helpers.ts` — Validación business hours, formateo, slots (Plan 1)
- `src/modules/google-apps/calendar-config.ts` — Servicio CRUD de config (Plan 2)
- `src/modules/google-apps/calendar-console.ts` — Renderer HTML de settings (Plan 2)
- `src/modules/google-apps/calendar-followups.ts` — Scheduler de follow-ups (Plan 4)
- `src/migrations/046_gcal-scheduler-subagent.sql` — Seed del subagent (Plan 3)
- `src/migrations/047_gcal-followups.sql` — Tabla calendar_follow_ups (Plan 4)
- `instance/prompts/system/skills/gcal-new-appointment.md` (Plan 3)
- `instance/prompts/system/skills/gcal-reschedule.md` (Plan 3)
- `instance/prompts/system/skills/gcal-cancel.md` (Plan 3)
- `instance/prompts/system/skills/gcal-check-availability.md` (Plan 3)
- `instance/prompts/system/skills/gcal-info.md` (Plan 3)

---

## Modelo de datos: Calendar Config

Almacenado en `config_store` como JSON bajo key `GCAL_SCHEDULING_CONFIG`:

```json
{
  "meetEnabled": true,
  "defaultReminders": [
    { "method": "popup", "minutes": 5 },
    { "method": "popup", "minutes": 30 },
    { "method": "email", "minutes": 2880 }
  ],
  "defaultDurationMinutes": 30,
  "eventNamePrefix": "Reunión",
  "descriptionInstructions": "",
  "daysOff": [
    { "type": "single", "date": "2026-05-01" },
    { "type": "range", "start": "2026-12-24", "end": "2026-12-31" }
  ],
  "schedulingRoles": {
    "vendedor": { "enabled": true, "instructions": "Agendar clientes fuera del país" }
  },
  "schedulingCoworkers": {
    "USR-ABC12": { "enabled": true, "instructions": "Clientes en Brasil" }
  },
  "followUpPost": { "enabled": true, "delayMinutes": 60 },
  "followUpPre": { "enabled": true, "hoursBefore": 24 }
}
```

---

## Notas para todos los ejecutores

- **NO crear módulo nuevo** — todo vive dentro de `src/modules/google-apps/`
- **NO duplicar helpers HTTP** — usar `jsonResponse`, `parseBody`, `parseQuery` del kernel
- **NO leer process.env** — usar `registry.getConfig()` o `registry.getOptional()`
- **Imports con extensión .js** — ESM lo requiere
- **noUncheckedIndexedAccess activo** — usar `?.` o `!` con guards previos
- **Business hours** — leer de servicio existente `engine:business-hours`, NO crear config propia
- **Roles/coworkers** — leer de `users:db` (users module), NO duplicar data
- **Compilar antes de push** — `docker run --rm -v /docker/luna-repo:/app -w /app node:22-alpine npx tsc --noEmit`
