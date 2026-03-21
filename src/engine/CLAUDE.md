# Engine — Pipeline de procesamiento de mensajes

Pipeline de 5 fases que procesa mensajes entrantes (reactivo) y contactos salientes (proactivo).

## Archivos

```
engine.ts             — orquestador principal, entry point
config.ts             — carga config de env vars
index.ts              — re-exports públicos
types.ts              — todos los types (ContextBundle v3, proactive types)
phases/
  phase1-intake.ts    — normalización + context loading via memory:manager (<200ms)
  phase2-evaluate.ts  — evaluación con LLM (reactivo + proactivo, NO_ACTION)
  phase3-execute.ts   — ejecución del plan (router, memory lookup)
  phase4-compose.ts   — composición de respuesta (LLM compositor)
  phase5-validate.ts  — validación + envío + persistencia + commitment auto-detect
subagent/
  subagent.ts         — mini-loop con barandas
  guardrails.ts       — límites configurables
proactive/
  proactive-runner.ts — orquestador BullMQ (queues, workers, repeatables)
  proactive-pipeline.ts — pipeline proactivo (phase1 simplificada + phases 2-5)
  proactive-config.ts — loader de instance/proactive.json
  guards.ts           — 7 guardas de protección (idempotencia → conversation guard)
  commitment-validator.ts — valida y clasifica commitments (known/generic/rejected)
  commitment-detector.ts  — auto-detección Via B (fast LLM en phase5)
  triggers.ts         — definición de jobs (follow-up, reminder, commitment, reactivation)
  jobs/
    follow-up.ts      — scanner de leads inactivos
    reminder.ts       — scanner de eventos próximos
    commitment-check.ts — scanner de commitments due/overdue + auto-cancel
    reactivation.ts   — scanner de leads fríos
    cache-refresh.ts  — cache refresh nocturno
    nightly-batch.ts  — batch nocturno
  tools/
    create-commitment.ts — tool registrada en tools:registry
prompts/
  evaluator.ts        — prompt builder fase 2 (reactivo + proactivo)
  compositor.ts       — prompt builder fase 4
utils/
  normalizer.ts, injection-detector.ts, rag-local.ts, quick-actions.ts,
  message-formatter.ts, llm-client.ts
mocks/
  user-resolver.ts, tool-registry.ts
```

## Flujo reactivo

1. `message:incoming` hook → `processMessage()`
2. Phase 1: normalize, user type, context via `memory:manager` → ContextBundle v3
3. Phase 2: LLM evaluator → intent, plan
4. Phase 3: execute plan steps
5. Phase 4: LLM compositor → response
6. Phase 5: validate, send, persist, farewell detection, contact lock, commitment auto-detect

## Flujo proactivo

1. BullMQ scanner job detecta candidato (follow-up/reminder/commitment/reactivation)
2. `processProactive(candidate)` ejecuta guardas (7 en orden)
3. Phase 1 simplificada: contacto, historial, trigger, canal → ProactiveContextBundle
4. Phase 2: evaluador proactivo (puede retornar NO_ACTION)
5. Phase 3-5: idénticas al reactivo
6. Post-send: cooldown, rate limit increment, outreach log, commitment update

## Guardas proactivas (orden de ejecución)

1. Idempotencia (Redis SET NX, TTL 24h)
2. Horario laboral (timezone config, email bypasses)
3. Contact lock (mutex — contacto en conversación activa)
4. Outreach dedup (PG query, overdue bypasses)
5. Cooldown (Redis, configurable minutes)
6. Rate limit (max mensajes proactivos/día/contacto)
7. Conversation guard (farewell intent, overdue bypasses)

## Avisos de proceso (per-channel)

Config independiente por canal. Cada canal tiene trigger, hold y hasta 3 mensajes configurables desde oficina:
- **WhatsApp**: `AVISO_WA_TRIGGER_MS` (3000), `AVISO_WA_HOLD_MS` (2000), `AVISO_WA_MSG_1..3`
- **Email**: `AVISO_EMAIL_TRIGGER_MS` (0=off), `AVISO_EMAIL_HOLD_MS` (0), `AVISO_EMAIL_MSG_1..3`

Si la respuesta tarda más del trigger, se elige un aviso al azar del pool y se envía via `message:send` hook. Tras enviar, la respuesta real se retiene el hold configurado. Trigger=0 desactiva por canal. Mensajes editables desde oficina, nunca generados por LLM.

## Commitments

Dos vías de creación:
- **Vía A** (tool): Evaluador incluye `create_commitment` en plan → phase3 ejecuta → validador
- **Vía B** (auto-detect): Phase5 fire-and-forget → LLM rápido detecta promesas → validador

Validador clasifica: known (tipo en proactive.json), generic (auto_cancel corto), rejected.

## Config

- `instance/proactive.json` — config de proactividad por tenant
- `instance/fallbacks/proactive-*.txt` — templates fallback
- Env vars: LLM_PROACTIVE_MODEL, LLM_PROACTIVE_PROVIDER

## Trampas

- memory:manager es opcional — fallback a SQL directo en todas las fases
- Pipeline log fire-and-forget via `memoryManager.savePipelineLog()`
- Persist messages usa dual-write (Redis buffer + PG async) via memory:manager
- `needsAcknowledgment` en EvaluatorOutput ya no se consume en phase3 — el aviso ahora es por timer en engine.ts, no por decisión del evaluador
- Proactive NO_ACTION es el default seguro (no enviar nada si LLM falla)
- Contact lock auto-expira con session TTL
- BullMQ requiere Redis — graceful degradation si connection fails
- Commitment auto-detect es fire-and-forget (no bloquea phase5)
