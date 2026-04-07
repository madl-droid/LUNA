# INFORME DE CIERRE — Sesión Google Calendar: Planeación + Ejecución

## Branch: `claude/plan-google-calendar-W94gU`

### Objetivos definidos
Implementar capacidades completas de agendamiento con Google Calendar en LUNA: servicio mejorado, página de configuración en console, subagent con skills por escenario, follow-ups automáticos pre/post reunión.

### Completado
- **Plan 1: Service & Tools Enhancement** — Meet automático, reminders configurables, conflict check FreeBusy, validación business hours/days/days-off, checkAvailability inteligente (FreeBusy + fallback), tools nuevos (get-event, delete-event), formatted output en todos los tools, hooks tipados en kernel
- **Plan 2: Console Settings** — Página `/console/herramientas/google-apps/calendar` con 5 secciones (general, recordatorios, días off, equipo por roles/coworkers con instrucciones, follow-ups), botón "Configurar" en card Calendar, CalendarConfigService con persistencia en config_store y validación Zod, API routes, hot-reload
- **Plan 3: Subagent + Skills** — Subagent `google-calendar-scheduler` (migración 046), 5 skills (gcal-new-appointment, gcal-reschedule, gcal-cancel, gcal-check-availability, gcal-info), tool `calendar-get-scheduling-context`, enable/disable automático con el servicio Calendar
- **Plan 4: Follow-ups** — CalendarFollowUpScheduler (migración 047), pre-reminder configurable (3-24h), post-meeting configurable (30-360min), envío por mismo canal, cancel/reschedule automático, patrón medilink con scheduled-tasks
- **Plan 5: Audit Fixes** — XSS fix en `esc()`, consolidación tipo+defaults duplicados, Zod validation en save(), getNextBusinessSlot() → null, logging timezone, hook payload types corregidos, dead code eliminado, UsersDb unificado, documentación de break + race condition
- **CLAUDE.md actualizado** — documentación completa del módulo google-apps con todas las capacidades nuevas

### No completado
Nada pendiente.

### Archivos creados
- `src/modules/google-apps/calendar-helpers.ts` — validación BH, free slots, formateo
- `src/modules/google-apps/calendar-config.ts` — servicio de config con Zod
- `src/modules/google-apps/calendar-console.ts` — renderer SSR settings page
- `src/modules/google-apps/calendar-followups.ts` — follow-up scheduler
- `src/migrations/046_gcal-scheduler-subagent.sql` — seed subagent
- `src/migrations/047_gcal-followups.sql` — tabla calendar_follow_ups
- `instance/prompts/system/skills/gcal-new-appointment.md`
- `instance/prompts/system/skills/gcal-reschedule.md`
- `instance/prompts/system/skills/gcal-cancel.md`
- `instance/prompts/system/skills/gcal-check-availability.md`
- `instance/prompts/system/skills/gcal-info.md`
- `docs/reports/AUDIT-google-calendar.md`

### Archivos modificados
- `src/modules/google-apps/calendar-service.ts` — Meet, conflict check, checkAvailability
- `src/modules/google-apps/tools.ts` — 8 tools mejorados + 4 nuevos (get, delete, scheduling-context, execute-followup)
- `src/modules/google-apps/types.ts` — interfaces nuevas (CalendarCreateResult, CalendarAvailabilityResult, CalendarSchedulingConfig, etc.)
- `src/modules/google-apps/manifest.ts` — API routes, servicios, hooks, subagent lifecycle
- `src/modules/google-apps/CLAUDE.md` — documentación actualizada
- `src/kernel/types.ts` — hooks calendar:event-created/deleted/updated con payloads tipados
- `src/modules/console/server.ts` — handler subpage google-apps/calendar
- `src/modules/console/templates-section-channels.ts` — botón "Configurar" en card Calendar
- `src/modules/console/templates-i18n.ts` — 31 keys gcal_* bilingües

### Interfaces expuestas (exports que otros consumen)
- `google-apps:calendar-config` — CalendarConfigService via registry
- `google-apps:renderCalendarSection` — renderer para console
- Hooks: `calendar:event-created`, `calendar:event-deleted`, `calendar:event-updated`
- Subagent: `google-calendar-scheduler` (auto-enabled cuando calendar activo)

### Dependencias instaladas
Ninguna nueva. Todo usa googleapis, zod, pino ya existentes.

### Tests
No se crearon tests unitarios. Validación via compilación TypeScript (sin errores nuevos) y auditoría manual completa con 10 hallazgos corregidos.

### Decisiones técnicas
1. **No crear módulo nuevo** — todo vive dentro de `src/modules/google-apps/` para mantener cohesión
2. **Config en config_store como JSON** — no en configSchema (Zod env vars), porque la estructura es compleja (arrays, nested objects, per-entity config)
3. **Subagent con skill_read** — config dinámica via tool call en vez de inyectar en system prompt, para mantener el prompt delgado
4. **Follow-ups sin LLM** — mensajes predefinidos/templated por diseño (predictibilidad, costo)
5. **Business hours de engine** — se leen del servicio `engine:business-hours` existente, no se duplica config
6. **Coworkers de users module** — se leen via `users:db`, no se duplica data
7. **Un solo coworker por follow-up post** — break intencional (1 coworker asignado por cita normalmente)
8. **Rebase sobre pruebas** — branch listo para fast-forward, 0 conflictos con knowledge (#140)

### Riesgos o deuda técnica
- Race condition leve en `rescheduleFollowUps()` concurrente (documentada, mitigada por idempotencia)
- `calendar-get-scheduling-context` consume 1 tool call extra por invocación del subagent (trade-off: config dinámica vs performance)
- Sin tests unitarios — depende de testing manual e integración

### Notas para integración
- Branch rebased sobre `origin/pruebas` (incluye knowledge #140) — merge limpio fast-forward
- 2 migraciones SQL nuevas (046, 047) — se aplican automáticamente al arrancar
- 5 skill files nuevos — se descubren automáticamente por el skill loader
- Subagent se habilita automáticamente cuando calendar está enabled en google-apps
