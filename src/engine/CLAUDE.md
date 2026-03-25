# Engine — Pipeline de procesamiento de mensajes (v2)

Pipeline de 5 fases con concurrencia controlada. Procesa mensajes entrantes (reactivo) y contactos salientes (proactivo).

## Archivos

```
engine.ts             — orquestador principal, entry point, concurrency layers
config.ts             — carga config de env vars
index.ts              — re-exports públicos
types.ts              — todos los types (ContextBundle v4, proactive types, LLM types)
responder.ts          — responder legacy (bridge)

concurrency/
  index.ts            — re-exports
  pipeline-semaphore.ts — semáforo global de pipelines (capa 1)
  contact-lock.ts     — serialización per-contacto (capa 2)
  step-semaphore.ts   — concurrencia de steps en Phase 3 (capa 3)

phases/
  phase1-intake.ts    — normalización + context loading via memory:manager + users:resolve (<200ms)
  phase2-evaluate.ts  — evaluación con LLM (reactivo + proactivo, NO_ACTION)
  phase3-execute.ts   — ejecución del plan (router, memory lookup, process_attachment, step semaphore)
  phase4-compose.ts   — composición de respuesta (LLM con retries) + formato canal + TTS
  phase5-validate.ts  — validación + envío + persistencia + commitment auto-detect

attachments/
  types.ts            — types, constantes, MIME map, hard limits, fallback messages
  classifier.ts       — clasificación lightweight de adjuntos (solo metadata, Phase 1)
  processor.ts        — orquestador de procesamiento de adjuntos (Phase 3, max 3 concurrent)
  audio-transcriber.ts — transcripción de audio via knowledge extractors
  injection-validator.ts — validación de inyección en contenido extraído
  url-extractor.ts    — detección y extracción de contenido de URLs
  migration.ts        — migración DB para tabla attachment_extractions
  tools/
    query-attachment.ts  — tool query_attachment: consulta contenido cacheado de adjuntos
    web-explore.ts       — tool web_explore: navega y extrae contenido web

ack/
  types.ts            — types del sistema de ACK
  ack-defaults.ts     — mensajes ACK predefinidos por defecto
  ack-service.ts      — servicio ACK: selecciona y envía mensajes de reconocimiento

fallbacks/
  fallback-loader.ts  — carga templates de fallback per-channel con cascade (canal → genérico)

prompts/
  evaluator.ts        — prompt builder fase 2 (reactivo + proactivo)
  compositor.ts       — prompt builder fase 4
  subagent.ts         — prompt builder para subagent mini-loop

subagent/
  subagent.ts         — mini-loop con guardrails y tool calling nativo
  guardrails.ts       — límites configurables del subagent

proactive/
  proactive-pipeline.ts — pipeline proactivo: Phase 1 simplificado + reusa Phases 2-5
  proactive-runner.ts   — orquestador BullMQ con priority lanes
  proactive-config.ts   — carga y valida instance/proactive.json
  guards.ts             — 7 guardas de protección (business hours, cooldown, Redis contact lock, etc.)
  triggers.ts           — definiciones de triggers proactivos
  commitment-detector.ts — auto-detecta compromisos implícitos en respuestas del agente
  commitment-validator.ts — valida y clasifica requests de creación de compromisos
  jobs/
    follow-up.ts       — scanner de leads inactivos
    reminder.ts        — scanner de eventos próximos
    commitment-check.ts — scanner de compromisos vencidos
    reactivation.ts    — scanner de leads fríos
    nightly-batch.ts   — batch nocturno (scoring, compresión de memoria)
    cache-refresh.ts   — refresco de caches (Sheets, datos operacionales)
  tools/
    create-commitment.ts — tool create_commitment para el evaluador

utils/
  normalizer.ts         — sanitiza unicode, trunca, detecta tipo de contenido
  injection-detector.ts — detector de prompt injection basado en regex
  llm-client.ts         — bridge entre engine y módulo LLM con fallback a SDK directo
  message-formatter.ts  — formato per-canal (WA bubbles ≤300 chars, HTML email, etc.)
  rag-local.ts          — RAG local con fuse.js sobre archivos en instance/knowledge/

mocks/
  tool-registry.ts    — TODO: reemplazar por tools:registry del módulo tools
```

## Concurrencia (4 capas)

Doc completo: `docs/architecture/concurrency.md`

1. **Pipeline Semaphore** (global): max N pipelines simultáneos, cola FIFO, backpressure si cola llena
2. **Contact Lock** (per-contacto): serializa mensajes del mismo contacto, evita race conditions
3. **Step Semaphore** (Phase 3): max N steps en paralelo dentro de un pipeline
4. **Resource pools** (DB pool, LLM circuit breaker): ya existentes en kernel y módulo LLM

Nota: el Redis contact lock (`contact:active:{id}`) en proactive/guards.ts es **separado** del ContactLock in-memory. Uno protege reactivo, otro protege proactivo vs reactivo.

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
- **Phase 3**: `executeProcessAttachment()` → descarga, extrae texto, resume, transcribe audio (max 3 concurrentes)
- **Phase 4**: LLM compositor recibe datos procesados de Phase 3

## Phase 4: Retries + Formato + TTS

- LLM con retry por provider (configurable ENGINE_COMPOSE_RETRIES_PER_PROVIDER)
- Primary (retry) → Fallback provider (retry) → Template de archivo
- `formatForChannel()` → split WA, HTML email, etc.
- TTS si `responseFormat === 'audio'`
- Output: CompositorOutput con `formattedParts`, `audioBuffer?`, `outputFormat`

## Proactivo

- BullMQ runner con 6 tipos de job: follow-up, reminder, commitment-check, reactivation, nightly-batch, cache-refresh
- 7 guardas de protección antes de cada job (business hours, cooldown, max per day, conversation guard, Redis contact lock, etc.)
- Pipeline simplificado: Phase 1 minimal → reusa Phases 2-5 con `ProactiveContextBundle`
- `NO_ACTION` es el default seguro — si LLM falla, no se envía nada
- Commitment auto-detector escanea respuestas del agente en Phase 5

## Trampas

- users:resolve es opcional — fallback: todos son "lead" si módulo users no está activo
- memory:manager es opcional — fallback a SQL directo
- Attachment processing en Phase 3, no Phase 1 (Phase 1 solo metadata)
- Proactive config se cachea en Phase 5 (no relee archivo en cada mensaje)
- tool-registry.ts sigue siendo mock — pendiente conectar tools:registry
- Contact lock in-memory auto-expira con session TTL
- Redis contact lock (proactive) es independiente del ContactLock in-memory (reactivo)
- ACK service es opcional — si falla, el pipeline continúa sin enviar ACK
