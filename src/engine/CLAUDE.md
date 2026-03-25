# Engine — Pipeline de procesamiento de mensajes (v2)

Pipeline de 5 fases con concurrencia controlada. Procesa mensajes entrantes (reactivo) y contactos salientes (proactivo).

## Archivos

```
engine.ts             — orquestador principal, entry point, concurrency layers
config.ts             — carga config de env vars
index.ts              — re-exports públicos
types.ts              — todos los types (ContextBundle v4, AttachmentMetadata, proactive types)
concurrency/
  pipeline-semaphore.ts — semáforo global de pipelines (capa 1)
  contact-lock.ts     — serialización per-contacto (capa 2)
  step-semaphore.ts   — concurrencia de steps en Phase 3 (capa 3)
  index.ts            — re-exports
phases/
  phase1-intake.ts    — normalización + context loading via memory:manager + users:resolve (<200ms)
  phase2-evaluate.ts  — evaluación con LLM (reactivo + proactivo, NO_ACTION)
  phase3-execute.ts   — ejecución del plan (router, memory lookup, process_attachment, step semaphore)
  phase4-compose.ts   — composición de respuesta (LLM con retries) + formato canal + TTS
  phase5-validate.ts  — validación + envío + persistencia + commitment auto-detect
attachments/
  classifier.ts       — clasificación lightweight de adjuntos (solo metadata, Phase 1)
  processor.ts        — procesamiento pesado de adjuntos (Phase 3)
subagent/
  subagent.ts         — mini-loop con barandas
  guardrails.ts       — límites configurables
proactive/
  (sin cambios)
prompts/
  evaluator.ts        — prompt builder fase 2 (inyecta attachment metadata, process_attachment en plan)
  compositor.ts       — prompt builder fase 4
utils/
  normalizer.ts, injection-detector.ts, rag-local.ts,
  message-formatter.ts, llm-client.ts
mocks/
  tool-registry.ts    — TODO: reemplazar por tools:registry del módulo tools
```

## Concurrencia (4 capas)

1. **Pipeline Semaphore** (global): max N pipelines simultáneos, cola FIFO, backpressure si cola llena
2. **Contact Lock** (per-contacto): serializa mensajes del mismo contacto, evita race conditions
3. **Step Semaphore** (Phase 3): max N steps en paralelo dentro de un pipeline
4. **Resource pools** (DB pool, LLM circuit breaker): ya existentes en kernel y módulo LLM

## Modo de pruebas

`ENGINE_TEST_MODE=true` → solo admins reciben respuesta. Non-admins se ignoran silenciosamente.
Configurable desde consola y .env. Persiste al reinicio.

## Flujo reactivo

1. Semaphore acquire → Contact lock → `processMessageInner()`
2. Phase 1: normalize, user type via `users:resolve`, classify attachments (metadata only) → ContextBundle v4
3. Test mode gate: si testMode && !admin → return silencioso
4. Phase 2: LLM evaluator → intent, plan (puede incluir process_attachment steps)
5. Phase 3: execute plan steps con step semaphore (process_attachment = heavy processing)
6. Phase 4: LLM compositor (retries + fallback) → formato canal → TTS → CompositorOutput
7. Phase 5: validate, send (pre-formatted), persist, proactive signals

## Adjuntos (2 fases)

- **Phase 1**: `classifyAttachments()` → solo metadata (tipo, nombre, tamaño, mime) — <1ms
- **Phase 2**: evaluador ve metadata, puede planificar `process_attachment` steps
- **Phase 3**: `executeProcessAttachment()` → descarga, extrae texto, resume, transcribe audio
- **Phase 4**: LLM compositor recibe datos procesados de Phase 3

## Phase 4: Retries + Formato + TTS

- LLM con retry por provider (configurable ENGINE_COMPOSE_RETRIES_PER_PROVIDER)
- Primary (retry) → Fallback provider (retry) → Template de archivo
- `formatForChannel()` → split WA, HTML email, etc.
- TTS si `responseFormat === 'audio'`
- Output: CompositorOutput con `formattedParts`, `audioBuffer?`, `outputFormat`

## Trampas

- users:resolve es opcional — fallback: todos son "lead" si módulo users no está activo
- memory:manager es opcional — fallback a SQL directo
- Attachment processing ahora en Phase 3, no Phase 1 (Phase 1 solo metadata)
- Proactive config se cachea en Phase 5 (no relee archivo en cada mensaje)
- tool-registry.ts sigue siendo mock — pendiente conectar tools:registry
- Proactive NO_ACTION es el default seguro (no enviar nada si LLM falla)
- Contact lock auto-expira con session TTL
