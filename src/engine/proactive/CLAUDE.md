# Proactive — Flujos proactivos del agente

Sistema de mensajes salientes: follow-up, reminders, commitments, reactivation, orphan recovery.

## Archivos
- `proactive-runner.ts` — BullMQ orchestrator, job scheduling, smart cooldown integration
- `proactive-pipeline.ts` — pipeline simplificado (Phase 1 minimal + Phases 2-5); historial 10 msgs para commitments, 5 para el resto
- `proactive-config.ts` — loader de `instance/proactive.json` con defaults
- `guards.ts` — 8 guardas en orden (idempotency → business_hours → contact_lock → dedup → cooldown → rate_limit → conversation → goodbye_suppressor)
- `triggers.ts` — definiciones de todos los jobs (incluye orphan-recovery)
- `smart-cooldown.ts` — cooldown adaptativo per-contact+trigger en Redis
- `orphan-recovery.ts` — detección y re-dispatch de mensajes sin respuesta
- `conversation-guard.ts` — detección de goodbye patterns, Redis cache 6h

> **Nota:** El auto-detector de compromisos (Via B, `commitment-detector.ts`) fue eliminado. Los compromisos se crean exclusivamente via tool `create_commitment`.

## Nuevas features (v2 reset)

### Smart Cooldown (`smart-cooldown.ts`)
- Reemplaza intervalos fijos con backoff adaptativo por outcome
- Redis key: `cooldown:{contactId}:{triggerType}`, TTL 7 días
- Outcomes → next check: `sent`=30m, `no_action`=60m (120m si 2+ consecutivos), `error`=10m, `blocked`=4h
- Max backoff: 24h (configurable `smart_cooldown.max_backoff_hours`)
- API: `getCooldownState()`, `updateCooldownState()`, `isInCooldown()`

### Orphan Recovery (`orphan-recovery.ts`)
- Detecta mensajes de usuario sin respuesta del agente (grace period: 5 min)
- Query: `messages` + `sessions`, sender_type='user', sin agente en 5min
- Excluye mensajes cuyo pipeline fue recientemente procesado (`pipeline_logs.created_at > msg.created_at AND > now()-5min`)
- Re-despacha via `registry.runHook('message:incoming', ...)` con IncomingMessage sintético
- Logs de re-dispatch a `proactive_outreach_log` con `trigger_type='orphan_recovery'` (requiere migration 029)
- Job: `orphan-recovery`, cada 5 min (configurable), prioridad 2 (igual que commitment)
- Config: `orphan_recovery.{enabled, interval_minutes, lookback_minutes, max_per_run}`

### Conversation Guard (`conversation-guard.ts`)
- Detecta patrones de despedida en historial reciente (últimos 3 mensajes)
- Cache Redis: `suppress:{contactId}:{channel}`, TTL 6h (configurable)
- Patrones: gracias, bye, adios, hasta luego, perfecto gracias, listo gracias, etc.
- Solo suprime si usuario dijo adiós Y agente respondió (conversación cerrada naturalmente)
- Guard #8 en guards.ts: skippable para commitment follow-ups (`skip_for_commitments=true`)
- API: `shouldSuppressProactive()`, `clearSuppressCache()`

## Follow-up Intensity (`intensity.ts`)
- 4 niveles per-contact: `aggressive` (2h/5), `normal` (4h/3), `gentle` (12h/2), `minimal` (24h/1)
- Stored in `agent_contacts.follow_up_intensity` (migration 048, default `'normal'`)
- `resolveIntensity(intensity, globalH, globalMax)` — fallback a config global si valor desconocido
- `follow-up.ts` elimina filtros SQL globales y filtra en código per-row usando la intensidad del contacto
- Tool `set_follow_up_intensity` registrado en `engine.ts` — el agente puede ajustar durante conversación
- Intensidad no-default se inyecta en el contexto del LLM via `context-builder.ts` (sección 9b)
- Backward compat: con intensidad `normal`, el comportamiento es idéntico al global (4h, 3 intentos)

## Guards (orden de ejecución)
1. `guardIdempotency` — Redis NX key por día
2. `guardBusinessHours` — timezone-aware, email bypass
3. `guardContactLock` — Redis `contact:active:{id}`
4. `guardOutreachDedup` — no enviar mismo trigger 2× en 4h
5. `guardCooldown` — cooldown global del contacto
6. `guardRateLimit` — max N proactivos por día por contacto
7. `guardConversation` — farewell flag (set por engine en Phase 5)
8. `guardGoodbyeSuppressor` — goodbye patterns en historial (nuevo v2)

## Configuración (`instance/proactive.json`)
```json
{
  "smart_cooldown": { "enabled": true, "after_sent_minutes": 30, "after_no_action_minutes": 60, "after_error_minutes": 10, "max_backoff_hours": 24 },
  "orphan_recovery": { "enabled": true, "interval_minutes": 5, "lookback_minutes": 30, "max_per_run": 10 },
  "conversation_guard": { "enabled": true, "cache_ttl_hours": 6, "skip_for_commitments": true }
}
```

## Job idempotency (FIX-05)
- `proactive-runner.ts` adquiere lock Redis SETNX antes de ejecutar cada job: `proactive:lock:{jobName}`
- TTL 300s (5 min) — expira solo, no se borra manualmente (protege contra crash mid-execution)
- Si el lock ya existe → WARN + skip — previene doble ejecución por race entre BullMQ re-queue y orphan recovery

## Context summary en compromisos

Al crear un compromiso via `create_commitment`, el tool captura automáticamente un resumen de los últimos 6 mensajes de la sesión activa y lo guarda en `commitments.context_summary`. Cuando el commitment scanner dispara el compromiso, ese resumen se inyecta en el prompt del agentic loop proactivo para que el LLM tenga contexto completo sin re-cargar historial completo.

## HITL handoff → reasignación de compromisos

Cuando un ticket HITL se resuelve con `handoffMode = 'full_handoff'`, los compromisos pendientes del contacto se reasignan al humano (`assigned_to = assignedSenderId`). El commitment scanner luego notifica directamente al humano en vez del contacto original. Si el humano no responde tras max_attempts, se crea un ticket HITL de escalación.

## Trampas
- `guardConversation` (#7) usa `conversation:farewell:{id}` set por `markFarewell()` en Phase 5
- `guardGoodbyeSuppressor` (#8) usa `suppress:{id}:{channel}` detectado por pattern matching
- Orphan recovery usa `sender_type` (no `role`) — la tabla `messages` usa 'user'/'agent'
- Smart cooldown es per-contact y lo aplican los job handlers individualmente (follow-up, commitment, etc.) — el runner no lo aplica a nivel batch
- `isJobEnabled()` y `getJobInterval()` deben ser actualizados cuando se agrega un nuevo triggerType
- Orphan recovery: `proactive_outreach_log.trigger_type` requiere migration 029 para aceptar `'orphan_recovery'`
- Idempotency lock per-jobName (no per-jobId) — previene que el mismo tipo de job corra en paralelo
