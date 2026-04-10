# INFORME DE CIERRE — Sesion S08: Audit Fixes (Planificacion + Ejecucion)
## Branch: claude/project-planning-session-zUcNe

### Objetivos definidos
Leer `MEJORAS-LUNA-AUDIT.md`, planificar y ejecutar fixes para todos los issues de CODEBASE del audit (B1-B6, Q1, Q4, L1-L2). Excluidos: issues de servidor (S1-S6), Q2 (operacional), Q3 (data format).

### Completado
- **Plan 1 — Quick Fixes (B1, B2, B3, Q1, L1, L2)**: SQL fix en handoff.ts (contact_channels), runtime clamping en buffer-compressor, prompt de image-description, guardrails visual, dead code ExecutionQueue eliminado, migration cleanup config_store
- **Plan 2 — HITL Quote-Based Redesign (B4, B5)**: Interceptor reescrito de sender-based a quote-based, follow-up job migrado a setInterval directo, ticket-store con findByShortId/listActiveByResponder, notifier con instruccion de cita
- **Plan 3 — Gmail OAuth Unification (B6)**: Eliminado path standalone OAuth, depends google-apps, email-oauth.ts eliminado (~315 lineas), manifest simplificado (~347 lineas removidas)
- **Plan 4 — Pipeline Retry (Q4)**: Retry loop con backoff exponencial (1.5s, 3s) alrededor de runAgenticDelivery, isRetriableError() con clasificacion de errores
- **Plan 5 — Audit Fixes post-ejecucion (P1-P5)**: Migracion duplicada 052 resuelta, ticket list command restringido a responders activos, dead code notificationMessageId eliminado, guard double-delivery en delivery.ts, MEJORAS-LUNA-AUDIT.md movido a docs/reports/
- **Auditoria de codigo**: Reporte externo revisado, 5 problemas identificados y resueltos via Plan 5

### No completado
Nada. Todos los items del scope fueron completados.

### Archivos creados/modificados

**Creados:**
- `docs/plans/audit-fixes/overview.md` — estructura de planes
- `docs/plans/audit-fixes/plan-1.md` a `plan-5.md` — 5 planes de ejecucion
- `docs/reports/AUDIT-project-planning-session.md` — reporte de auditoria
- `docs/reports/S08-report.md` — este informe
- `instance/prompts/system/image-description.md` — prompt optimizado para vision
- `src/migrations/052_cleanup-dead-config.sql` — limpieza config_store

**Modificados:**
- `src/engine/engine.ts` — retry loop + isRetriableError()
- `src/engine/buffer-compressor.ts` — runtime clamping de threshold
- `src/engine/boundaries/delivery.ts` — try-catch post-send (guard double-delivery)
- `src/engine/concurrency/index.ts` — removed ExecutionQueue exports
- `src/engine/CLAUDE.md` — seccion Pipeline Retry + guard double-delivery
- `src/modules/hitl/message-interceptor.ts` — reescritura quote-based
- `src/modules/hitl/ticket-store.ts` — findByShortId, listActiveByResponder
- `src/modules/hitl/types.ts` — removed HumanReplyIntent, notificationMessageId
- `src/modules/hitl/notifier.ts` — instruccion de cita + shortId en follow-ups
- `src/modules/hitl/follow-up-job.ts` — setInterval directo
- `src/modules/hitl/manifest.ts` — stopFollowUpJob en stop()
- `src/modules/hitl/handoff.ts` — B1 SQL fix (contact_channels)
- `src/modules/hitl/CLAUDE.md` — reescritura completa
- `src/modules/gmail/manifest.ts` — eliminado standalone OAuth
- `src/modules/gmail/CLAUDE.md` — actualizado con unificacion
- `src/modules/google-apps/CLAUDE.md` — nota sobre scopes Gmail
- `src/modules/memory/manifest.ts` — default threshold 30→20
- `src/modules/memory/memory-manager.ts` — getBufferMessageCount()
- `src/modules/memory/CLAUDE.md` — nota sobre clamping
- `instance/prompts/defaults/guardrails.md` — seccion contenido visual

**Eliminados:**
- `src/modules/gmail/email-oauth.ts` (315 lineas) — standalone OAuth manager
- `src/engine/concurrency/execution-queue.ts` (242 lineas) — dead code
- `src/migrations/052_hitl-quote-based.sql` — dead code (notificationMessageId)
- `MEJORAS-LUNA-AUDIT.md` — movido a docs/reports/

### Interfaces expuestas (exports que otros consumen)
- `memory-manager.ts`: `getBufferMessageCount(): number` — nuevo metodo publico
- `follow-up-job.ts`: `registerFollowUpJob()` / `stopFollowUpJob()` — reemplaza job:register hook
- `ticket-store.ts`: `findByShortId()`, `listActiveByResponder()` — nuevos metodos

### Dependencias instaladas
Ninguna.

### Tests
No hay test suite configurada. Verificacion via `tsc --noEmit` (pasa sin errores).

### Decisiones tecnicas
1. **B4 — setInterval vs scheduled-tasks dependency**: El ejecutor eligio setInterval directo en vez de agregar dependencia a scheduled-tasks. Mejor solucion: elimina el problema de orden de carga de modulos completamente.
2. **P3 — Eliminar vs implementar notificationMessageId**: Se eligio eliminar. El quote-based funciona via texto (`Ticket: #shortId`), el messageId de la notificacion no agrega valor.
3. **P4 — Guard en delivery.ts vs engine.ts**: El try-catch se puso en delivery.ts (donde esta el riesgo) en vez del retry loop. Es correcto independientemente del retry.
4. **Ejecucion paralela**: 4 planes ejecutados por 4 agentes independientes en paralelo. Un solo conflicto menor en CLAUDE.md resuelto al mergear.

### Riesgos o deuda tecnica
- `isRetriableError()` usa string matching fragil (O2 del audit). Aceptable como v1 pero podria clasificar mal errores edge-case.
- Gmail auth-status routes tienen fallbacks dead code para cuando google-apps no existe (O3 del audit). Cosmetico.
- La columna `notification_message_id` queda inerte en DBs donde la migracion 052 ya se aplico. No hace falta DROP.

### Notas para integracion
- Merge limpio contra `pruebas` (fast-forward posible, sin conflictos).
- Net: +1,724 / -1,041 lineas en 32 archivos.
- La migracion `052_cleanup-dead-config.sql` se aplica automaticamente al arrancar (DELETE de config_store keys de ExecutionQueue).
