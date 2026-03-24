# INFORME DE CIERRE — Sesión S02: Sistema de Proactividad del Engine
## Branch: claude/luna-engine-proactivity-DiEkp

### Objetivos definidos
Implementar el sistema de proactividad completo de LUNA: follow-ups automáticos, reminders de citas, sistema de commitments (Vía A tool + Vía B auto-detect), reactivación de leads fríos, guardas de protección, y migración a BullMQ.

### Completado ✅
- Migración SQL: ALTER TABLE commitments (requires_tool, auto_cancel_at, created_via) + CREATE TABLE proactive_outreach_log
- Config: instance/proactive.json con business_hours, follow_up, reminders, commitments (5 tipos), reactivation, guards
- Types: ProactiveConfig, ProactiveContextBundle, ProactiveTrigger, ProactiveCandidate, OutreachLogEntry, CommitmentTypeConfig
- Proactive config loader (proactive-config.ts): carga/valida JSON, fallback a defaults, cache, reload
- 7 guardas de protección en orden: idempotencia, horario laboral, contact lock, outreach dedup, cooldown, rate limit, conversation guard
- Pipeline proactivo (proactive-pipeline.ts): phase1 simplificada + phases 2-5, post-send bookkeeping
- Phase 2 modificada: detecta isProactive, prompt proactivo separado, NO_ACTION como default seguro
- Phase 5 modificada: farewell detection (markFarewell), contact lock (setContactLock), commitment auto-detection fire-and-forget
- 4 scanners reescritos: follow-up (con transición a cold), reminder (con notificación a salesperson), commitment-check (con auto-cancel y mark overdue), reactivation (con tracking en agent_data)
- Tool create_commitment registrada en tools:registry con validación contra proactive.json
- Commitment auto-detection (Vía B): LLM rápido en phase5, fire-and-forget, skip si tool ya creó commitment
- Commitment validator: known type (tool + deadline de config), generic (auto_cancel corto), rejected
- Migración a BullMQ: queue luna:proactive, worker con concurrency 5, repeatables por tipo, prioridades (commitment > reminder > follow_up > reactivation > background)
- Fallback templates: instance/fallbacks/proactive-*.txt (4 templates)
- CLAUDE.md del engine actualizado con documentación completa del sistema proactivo
- Prompt proactivo del evaluador (evaluator.ts): buildProactiveEvaluatorPrompt

### No completado ❌
- Scheduled tasks (sección 2.5 de spec): excluido por acuerdo, spec separada
- Tests unitarios: no solicitados en este scope
- Console UI para proactive.json: futuro scope

### Archivos creados/modificados
**Creados (14):**
- docs/migrations/s-proactive-v1.sql
- instance/proactive.json
- instance/fallbacks/proactive-follow-up.txt
- instance/fallbacks/proactive-reminder.txt
- instance/fallbacks/proactive-commitment.txt
- instance/fallbacks/proactive-reactivation.txt
- src/engine/proactive/proactive-pipeline.ts
- src/engine/proactive/proactive-config.ts
- src/engine/proactive/guards.ts
- src/engine/proactive/commitment-validator.ts
- src/engine/proactive/commitment-detector.ts
- src/engine/proactive/jobs/reactivation.ts
- src/engine/proactive/tools/create-commitment.ts
- docs/reports/S02-report.md

**Modificados (10):**
- src/engine/types.ts — ProactiveConfig, ProactiveContextBundle, etc.
- src/engine/index.ts — nuevos exports
- src/engine/engine.ts — proactive config, create_commitment tool, async stop
- src/engine/phases/phase2-evaluate.ts — proactive mode + NO_ACTION
- src/engine/phases/phase5-validate.ts — farewell, contact lock, commitment detect
- src/engine/prompts/evaluator.ts — buildProactiveEvaluatorPrompt
- src/engine/proactive/proactive-runner.ts — reescrito con BullMQ
- src/engine/proactive/triggers.ts — reactivation + nuevos nombres
- src/engine/proactive/jobs/follow-up.ts — reescrito completo
- src/engine/proactive/jobs/reminder.ts — reescrito completo
- src/engine/proactive/jobs/commitment-check.ts — reescrito completo
- src/modules/memory/types.ts — requiresTool, autoCancelAt, createdVia, failed status
- src/modules/memory/pg-store.ts — saveCommitment + mapCommitmentRow actualizados
- src/modules/engine/manifest.ts — async stop
- src/engine/CLAUDE.md — documentación proactiva completa

### Interfaces expuestas (exports que otros consumen)
- `processProactive()` — entrada pública al pipeline proactivo
- `ProactiveConfig`, `ProactiveContextBundle`, `ProactiveCandidate`, `CommitmentTypeConfig`, `OutreachLogEntry` — types
- `loadProactiveConfig()`, `reloadProactiveConfig()` — config loader
- `runGuards()`, `setCooldown()`, `incrementProactiveCount()`, `markFarewell()`, `setContactLock()`, `clearContactLock()` — guardas
- `validateCommitment()` — validador de commitments
- `detectCommitments()` — auto-detección
- Tool `create_commitment` registrada en tools:registry

### Dependencias instaladas
Ninguna nueva. BullMQ ya estaba en package.json (bullmq@^5.71.0).

### Tests
No se escribieron tests en este scope. El sistema está diseñado para testing por módulo.

### Decisiones técnicas
1. **BullMQ sobre setInterval**: Prioridades, concurrency, retry automático, observabilidad
2. **NO_ACTION como default proactivo**: Si el LLM falla, no se envía nada (seguro)
3. **Commitment auto-detect fire-and-forget**: No añade latencia a phase5
4. **Contact lock con TTL**: Auto-expira, no necesita cleanup manual
5. **Guardas en orden de costo**: Idempotencia (Redis SET NX) primero, DB queries después
6. **Overdue bypasses**: Commitments overdue saltan conversation guard y outreach dedup

### Riesgos o deuda técnica
- La migración SQL debe ejecutarse antes del deploy (`docs/migrations/s-proactive-v1.sql`)
- Commitment auto-detect agrega ~1 LLM call extra por respuesta (fast model, fire-and-forget)
- Reactivation usa agent_data JSONB para tracking — podría merecer columna dedicada si crece
- BullMQ worker concurrency=5 puede necesitar tuning según carga
- Fallback templates son estáticos — el compositor debería generar mensajes personalizados

### Notas para integración
- Ejecutar migración: `psql < docs/migrations/s-proactive-v1.sql`
- Copiar instance/proactive.json al servidor de producción y ajustar business_hours/timezone
- Crear instance/fallbacks/ en producción con los 4 templates
- Variables de entorno nuevas: LLM_PROACTIVE_MODEL, LLM_PROACTIVE_PROVIDER (ya tienen defaults)
- El sistema arranca deshabilitado si proactive.json no existe (safe default)
