# Engine — Pipeline de procesamiento de mensajes

Pipeline de 5 fases que procesa mensajes entrantes (reactivo) y genera contactos salientes (proactivo).

## Archivos

```
engine.ts             — orquestador principal, entry point
config.ts             — carga config de env vars
index.ts              — re-exports públicos
types.ts              — todos los types del engine
responder.ts          — stub temporal (legacy, reemplazado por engine.ts)
phases/
  phase1-intake.ts    — normalización + context loading (código puro, <200ms)
  phase2-evaluate.ts  — evaluación con LLM (modelo evaluador, <2s)
  phase3-execute.ts   — ejecución del plan (router, parallel/sequential)
  phase4-compose.ts   — composición de respuesta (modelo compositor)
  phase5-validate.ts  — validación + envío + persistencia
subagent/
  subagent.ts         — mini-loop con barandas
  guardrails.ts       — límites configurables
proactive/
  proactive-runner.ts — orquestador de flujos proactivos (setInterval)
  triggers.ts         — definición de triggers
  jobs/               — cada job proactivo (follow-up, reminder, etc.)
prompts/
  evaluator.ts        — prompt builder para fase 2
  compositor.ts       — prompt builder para fase 4
  subagent.ts         — prompt builder para subagent
utils/
  normalizer.ts       — sanitización de mensajes
  injection-detector.ts — detección de prompt injection (regex)
  rag-local.ts        — búsqueda fuzzy con fuse.js
  quick-actions.ts    — detección de patrones rápidos (stop, sí/no)
  message-formatter.ts — formateo por canal (WA burbujas, HTML email)
  llm-client.ts       — bridge: delega al módulo LLM (gateway) si activo, fallback a SDKs directos
mocks/
  user-resolver.ts    — mock de S02 (user lists)
  tool-registry.ts    — mock de S03 (tool framework)
```

## Flujo reactivo

1. `message:incoming` hook → `engine.ts` → `processMessage()`
2. Phase 1: normalize, resolve user type (cached Redis), load context → ContextBundle
3. Phase 2: LLM evaluator → intent, plan, tools needed
4. Phase 3: execute plan steps (parallel when independent)
5. Phase 4: LLM compositor → response text
6. Phase 5: validate, format, rate limit, send via `message:send` hook, persist, update lead qualification (auto-transition new→qualifying)

## Integraciones con módulos

- **LLM module**: `engine.ts` intenta `registry.getOptional('llm:gateway')` en init. Si existe, `llm-client.ts` delega todas las llamadas al gateway (circuit breaker, routing, tracking). Si no, usa SDKs directos (legacy mode).
- **Lead-scoring**: `phase5-validate.ts` llama `updateLeadQualification()` para auto-transicionar leads new→qualifying y recalcular score.
- **Users**: `resolveUserType(senderId, channel)` — módulo real o mock en `mocks/user-resolver.ts`
- **Tools**: `executeTool(name, params)` — módulo real o mock en `mocks/tool-registry.ts`

## Config

Engine config se lee de env vars via `kernel/config.ts:getEnv()`. Ver `config.ts` para todos los parámetros.

## DB Tables

Migration en `docs/migrations/s01-engine-tables.sql`:
- `contacts` — identidad unificada de contactos
- `contact_channels` — link contacto ↔ canal (phone, email, etc.)
- `sessions` — sesiones de conversación
- `messages` — mensajes entrantes y salientes
- `campaigns` — campañas de marketing

## Trampas

- LLM evaluador a veces devuelve JSON con backticks markdown — se stripean en `phase2-evaluate.ts`
- `messages` table puede no existir aún — queries tienen try/catch
- Subagent guardrails se leen de `instance/config.json` si existe
- RAG recarga index cada 5 min — no es instantáneo
- Rate limit es por número destino, no por sesión
- `responder.ts` es legacy — usar `engine.ts` en su lugar
