# Engine — Pipeline de procesamiento de mensajes (v2)

Pipeline de 5 fases con concurrencia controlada. Procesa mensajes entrantes (reactivo) y contactos salientes (proactivo).

## Archivos

```
engine.ts             — orquestador principal, entry point, concurrency layers
config.ts             — carga config de env vars
index.ts              — re-exports públicos
types.ts              — todos los types (ContextBundle v4, proactive types, LLM types)
responder.ts          — responder legacy (bridge)

agentic/
  types.ts            — AgenticConfig, AgenticResult, EffortLevel, ToolCallLog, LoopDetectorResult
  effort-router.ts    — clasificador de complejidad determinístico (sin LLM, <5ms)
  tool-dedup-cache.ts — caché de dedup per-pipeline para tool calls idénticos
  tool-loop-detector.ts — anti-loop: generic repeat, no-progress, ping-pong detection
  agentic-loop.ts     — THE CORE: LLM + tool calling loop (reemplaza Phases 2+3+4)
  post-processor.ts   — criticizer (smart mode) + channel formatting + TTS → CompositorOutput
  index.ts            — exports públicos

concurrency/
  index.ts            — re-exports
  pipeline-semaphore.ts — semáforo global de pipelines (capa 1)
  contact-lock.ts     — serialización per-contacto (capa 2)
  step-semaphore.ts   — concurrencia de steps en Phase 3 (capa 3)

checkpoints/
  types.ts            — TaskCheckpoint, Phase1Snapshot, CheckpointStatus
  checkpoint-manager.ts — CRUD + resume + cleanup para task_checkpoints
  index.ts            — re-exports
  CLAUDE.md           — documentación del subsistema

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
  subagent.ts         — subagent v2: loop con verificación, spawn recursivo (1 nivel), soft/hard guardrails
  guardrails.ts       — guardrails soft (warn+continue) / hard (crash protection)
  verifier.ts         — verificador de calidad: accept/retry/fail (usa classifyModel)
  types.ts            — tipos internos: SubagentRunConfig, SubagentResultV2, SUBAGENT_HARD_LIMITS

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

  (mocks/ eliminado — Phase 2, Phase 3 y subagent usan tools:registry del módulo tools)
```

## Agentic Loop (v2 — reemplaza Phases 2+3+4)

Nuevo en v2.0.0. Cuando `ENGINE_MODE=agentic` (default), las Phases 2+3+4 son reemplazadas por un único loop agentico donde el LLM llama tools nativamente y compone la respuesta en la misma conversación.

### Cómo funciona el loop agentico

1. **Effort Router**: `classifyEffort(ctx)` clasifica el mensaje como low/medium/high (determinístico, <5ms)
2. **System Prompt**: ensamblado por prompt builder (identity + job + guardrails + tools + knowledge + historial)
3. **Loop**: `runAgenticLoop(ctx, systemPrompt, tools, config, registry)`:
   - Llama `callLLMWithFallback()` con system prompt + mensajes + tool definitions
   - Si LLM retorna solo texto → listo, retorna como respuesta final
   - Si LLM retorna tool_calls → ejecuta via `ToolRegistry.executeTool()`, retorna resultados
   - Protecciones: dedup cache (omite llamadas idénticas), loop detector (graduado: warn → block → circuit break)
   - Ejecución paralela de tools via `StepSemaphore`
   - Límite de turns → fuerza respuesta texto final
4. **Post-processor**: `postProcess(result, ctx, config, registry)`:
   - Criticizer (solo para effort=high o 3+ tool calls)
   - `formatForChannel()` → split WA/Chat, HTML para email
   - TTS si se requiere respuesta de audio
   - Retorna `CompositorOutput` (mismo tipo que Phase 4)

### Conexión al pipeline

- **Input**: ContextBundle de Phase 1 (sin cambios)
- **Output**: CompositorOutput → alimenta Phase 5 (validate + send)
- Phase 1 permanece igual. Phase 5 con adaptaciones menores.
- Phases 2, 3, 4 se mantienen detrás de `ENGINE_MODE=legacy`.

### Ruta de ejecución de tools

```
LLM produce tool_calls
  → loop detector pre-check (allow/block/circuit_break)
  → dedup cache check (hit → retorna cacheado)
  → registry.getOptional<ToolRegistry>('tools:registry')
  → toolRegistry.executeTool(name, input, context)
  → dedup cache store
  → loop detector post-check (registra llamada, detecta patrones)
  → resultados retornados al LLM como siguiente user message
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

## Adjuntos (procesamiento en Phase 1)

- **Phase 1**: `classifyAttachments()` + `processAttachmentsInPhase1()` en paralelo con context loading
  - Descarga, extrae texto (extractores globales), enriquece con LLM (vision/STT/multimodal)
  - Resultado dual: `extractedText` (code, para embeddings) + `llmText` (LLM, para conversación)
  - Inyecta cada adjunto como mensaje en `ctx.history` con etiqueta `[category]`:
    - Pequeño: `[documents] contenido extraído completo...`
    - Grande: `[documents] archivo.pdf — Descripción: resumen LLM...`
    - Imagen: `[images] descripción vision...`
    - Audio: `[audio] transcripción STT...`
    - Video: `[video] descripción multimodal...`
    - No soportado: `[Adjunto no soportado] ... este canal no permite procesar X`
  - Labels = nombre de categoría (documents, images, audio, video, etc.) — sin doble mapeo
  - Herencia: ENGINE_EXTRACTION_CAPABILITIES × CHANNEL_PLATFORM_CAPABILITIES × admin toggles
  - Imágenes: binario guardado en `instance/knowledge/media/` para re-consulta
  - Persiste ambos resultados en `attachment_extractions` (code + LLM)
- **Phase 2**: evaluador ve contenido de adjuntos ya en el historial (NO necesita planear `process_attachment`)
- **Phase 3**: `executeProcessAttachment()` se mantiene como fallback si Phase 1 no procesó
- **Phase 4**: compositor tiene contexto completo desde el historial

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
- tools:registry del módulo tools se usa en Phase 2 (catálogo), Phase 3 (ejecución) y subagent (ejecución). Si tools module no está activo, el catálogo estará vacío y la ejecución falla explícitamente.
- Contact lock in-memory auto-expira con session TTL
- Redis contact lock (proactive) es independiente del ContactLock in-memory (reactivo)
- ACK service es opcional — si falla, el pipeline continúa sin enviar ACK
