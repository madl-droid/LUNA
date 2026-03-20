# Engine — Pipeline de procesamiento de mensajes

Pipeline de 5 fases que procesa mensajes entrantes (reactivo) y genera contactos salientes (proactivo).

## Archivos

```
engine.ts             — orquestador principal, entry point
config.ts             — carga config de env vars
index.ts              — re-exports públicos
types.ts              — todos los types del engine (ContextBundle v3 con memory fields)
phases/
  phase1-intake.ts    — normalización + context loading via memory:manager (<200ms)
  phase2-evaluate.ts  — evaluación con LLM (modelo evaluador, <2s)
  phase3-execute.ts   — ejecución del plan (router, memory lookup via memory:manager)
  phase4-compose.ts   — composición de respuesta (LLM compositor, prompts:service)
  phase5-validate.ts  — validación + envío + persistencia via memory:manager
subagent/
  subagent.ts         — mini-loop con barandas
  guardrails.ts       — límites configurables
proactive/
  proactive-runner.ts — orquestador de flujos proactivos (setInterval)
  jobs/               — cada job proactivo
prompts/
  evaluator.ts        — prompt builder para fase 2 (inyecta memory, commitments, summaries)
  compositor.ts       — prompt builder para fase 4 (prompts:service + memory context)
  subagent.ts         — prompt builder para subagent
utils/
  normalizer.ts, injection-detector.ts, rag-local.ts, quick-actions.ts,
  message-formatter.ts, llm-client.ts
mocks/
  user-resolver.ts, tool-registry.ts
```

## Flujo reactivo

1. `message:incoming` hook → `processMessage()`
2. Phase 1: normalize, user type, agentId, context via `memory:manager` (Promise.allSettled) → ContextBundle v3
3. Phase 2: LLM evaluator → intent, plan (prompt includes memory/commitments/summaries)
4. Phase 3: execute plan steps (memory_lookup via `memory:manager`)
5. Phase 4: LLM compositor → response (prompts:service + memory context)
6. Phase 5: validate, send, persist via `memory:manager`, pipeline log

## Integraciones

- **Memory module**: `registry.getOptional('memory:manager')` — phase1/3/5. Graceful degradation a SQL directo.
- **Prompts module**: `registry.getOptional('prompts:service')` — phase4 compositor. Fallback a archivos.
- **LLM module**: `registry.getOptional('llm:gateway')` — circuit breaker, routing.

## ContextBundle v3

Campos nuevos: `agentId`, `contactMemory`, `pendingCommitments`, `relevantSummaries`, `leadStatus`.

## Avisos de proceso (per-channel)

Config independiente por canal. Cada canal tiene trigger, hold y hasta 3 mensajes configurables desde oficina:
- **WhatsApp**: `AVISO_WA_TRIGGER_MS` (3000), `AVISO_WA_HOLD_MS` (2000), `AVISO_WA_MSG_1..3`
- **Email**: `AVISO_EMAIL_TRIGGER_MS` (0=off), `AVISO_EMAIL_HOLD_MS` (0), `AVISO_EMAIL_MSG_1..3`

Si la respuesta tarda más del trigger, se elige un aviso al azar del pool y se envía via `message:send` hook. Tras enviar, la respuesta real se retiene el hold configurado. Trigger=0 desactiva por canal. Mensajes editables desde oficina, nunca generados por LLM.

## Trampas

- memory:manager es opcional — fallback a SQL directo en todas las fases
- Pipeline log fire-and-forget via `memoryManager.savePipelineLog()`
- Persist messages usa dual-write (Redis buffer + PG async) via memory:manager
- `needsAcknowledgment` en EvaluatorOutput ya no se consume en phase3 — el aviso ahora es por timer en engine.ts, no por decisión del evaluador
