# Auditoría: Engine & Pipeline
Fecha: 2026-03-26
Auditor: Claude (sesión automatizada)

## Resumen ejecutivo

El engine de LUNA es un pipeline de 5 fases maduro y bien estructurado (~9,400 LOC en ~45 archivos). La arquitectura es sólida: separación clara de fases, concurrencia por capas (semáforo global + lock por contacto + semáforo por paso), degradación graceful extensiva, y un sistema proactivo completo con 7 guardas. Los principales riesgos son: (1) ausencia de timeout global del pipeline, (2) el tool registry sigue usando mocks hardcodeados que coexisten con el registry real, (3) la detección de inyección basada en regex es eludible, (4) la URL extraction es vulnerable a DNS rebinding, y (5) el aviso de proceso usa setTimeout sin cancelación garantizada en edge cases. En general, el engine está en un estado funcional y robusto para producción con mejoras incrementales pendientes.

## Inventario

| Archivo | LOC | Propósito | Estado |
|---------|-----|-----------|--------|
| engine.ts | 540 | Orquestador principal, 5 fases + concurrencia | ✅ Maduro |
| config.ts | 142 | Carga de config desde env vars | ✅ Estable |
| types.ts | 567 | Tipos del pipeline completo | ✅ Completo |
| index.ts | 37 | Re-exports públicos | ✅ OK |
| phases/phase1-intake.ts | 560 | Intake: normalización, user resolve, context load | ✅ Maduro |
| phases/phase2-evaluate.ts | 186 | Evaluador LLM: intención + plan de ejecución | ✅ Estable |
| phases/phase3-execute.ts | 523 | Ejecutor de plan: tools, subagent, attachments | ✅ Maduro |
| phases/phase4-compose.ts | 169 | Compositor LLM: respuesta final + TTS | ✅ Estable |
| phases/phase5-validate.ts | 607 | Validación, rate limit, envío, persistencia | ✅ Maduro |
| concurrency/pipeline-semaphore.ts | 64 | Semáforo global de pipelines concurrentes | ✅ Sólido |
| concurrency/contact-lock.ts | 67 | Lock por contacto con timeout | ✅ Sólido |
| concurrency/step-semaphore.ts | 36 | Semáforo para pasos paralelos en Phase 3 | ✅ OK |
| concurrency/index.ts | 5 | Re-exports | ✅ OK |
| attachments/types.ts | 173 | Tipos del subsistema de adjuntos | ✅ Completo |
| attachments/processor.ts | 510 | Procesamiento paralelo de adjuntos | ✅ Maduro |
| attachments/classifier.ts | 47 | Clasificación lightweight en Phase 1 | ✅ OK |
| attachments/injection-validator.ts | 69 | Validación de inyección en contenido externo | ⚠️ Básico |
| attachments/url-extractor.ts | 190 | Extracción de URLs con SSRF protection | ⚠️ Mejorable |
| attachments/audio-transcriber.ts | 54 | Transcripción de audio via LLM | ✅ OK |
| attachments/migration.ts | 41 | Migración de tabla attachment_extractions | ✅ OK |
| attachments/tools/query-attachment.ts | 189 | Tool para consultar docs grandes cacheados | ✅ Bien diseñado |
| attachments/tools/web-explore.ts | 175 | Tool para explorar URLs que fallaron pre-fetch | ✅ OK |
| ack/ack-service.ts | 106 | Generación de ACKs con LLM + fallback | ✅ Estable |
| ack/ack-defaults.ts | 35 | Pool de mensajes ACK predefinidos | ✅ OK |
| ack/types.ts | 20 | Tipos del sistema ACK | ✅ OK |
| proactive/proactive-pipeline.ts | 457 | Pipeline proactivo simplificado | ✅ Maduro |
| proactive/proactive-runner.ts | 244 | Runner BullMQ con jobs repetibles | ✅ Estable |
| proactive/guards.ts | 284 | 7 guardas de protección proactiva | ✅ Sólido |
| proactive/proactive-config.ts | 117 | Carga de instance/proactive.json | ✅ OK |
| proactive/triggers.ts | 56 | Definición de triggers proactivos | ✅ OK |
| proactive/commitment-detector.ts | 135 | Auto-detección de compromisos via LLM | ✅ Bien diseñado |
| proactive/commitment-validator.ts | 139 | Validación y clasificación de compromisos | ✅ Sólido |
| proactive/tools/create-commitment.ts | 126 | Tool para crear compromisos desde evaluador | ✅ OK |
| proactive/jobs/follow-up.ts | 98 | Scanner de follow-ups para leads inactivos | ✅ OK |
| proactive/jobs/reminder.ts | 115 | Scanner de recordatorios pre-evento | ✅ OK |
| proactive/jobs/commitment-check.ts | 140 | Scanner de compromisos pendientes/overdue | ✅ OK |
| proactive/jobs/reactivation.ts | 83 | Scanner de reactivación de leads fríos | ✅ OK |
| proactive/jobs/nightly-batch.ts | 440 | Batch nocturno: scoring, compresión, reportes | ✅ Completo |
| proactive/jobs/cache-refresh.ts | 68 | Refresco de cache de Google Sheets | ✅ OK |
| subagent/subagent.ts | 171 | Mini-loop con function calling nativo | ✅ Estable |
| subagent/guardrails.ts | 73 | Límites del subagent (iteraciones, tokens, tiempo) | ✅ OK |
| prompts/evaluator.ts | 356 | Prompt builder del evaluador (Phase 2) | ✅ Maduro |
| prompts/compositor.ts | 238 | Prompt builder del compositor (Phase 4) | ✅ Maduro |
| prompts/subagent.ts | 62 | Prompt builder del subagent | ✅ OK |
| fallbacks/fallback-loader.ts | 112 | Carga de templates fallback con cascade | ✅ OK |
| fallbacks/error-defaults.ts | 42 | Mensajes de error naturales por tono | ✅ OK |
| utils/injection-detector.ts | 81 | Detección de inyección por regex | ⚠️ Básico |
| utils/llm-client.ts | 306 | Puente engine↔LLM module con fallback directo | ✅ Estable |
| utils/normalizer.ts | 69 | Normalización de texto y unicode | ✅ OK |
| utils/message-formatter.ts | 64 | Formateo por canal (burbujas WA, HTML email) | ✅ OK |
| utils/rag-local.ts | 122 | RAG local con fuse.js (legacy fallback) | ✅ Legacy OK |
| mocks/tool-registry.ts | 92 | Mock del tool framework | ⚠️ Deuda técnica |

## Hallazgos por componente

### Pipeline Core (engine.ts)

#### Fortalezas
- Arquitectura de 2 capas de concurrencia bien implementada: PipelineSemaphore (global) + ContactLock (per-contact) — previene race conditions en sesión/historial.
- Backpressure con mensaje configurable al usuario cuando el sistema está saturado.
- Error handling robusto: catch global envía fallback natural al usuario en vez de silencio.
- Replanning loop con máximo capped a 5 (`Math.min(envInt(..., 2), 5)` en config.ts:105).
- ACK timer con hold delay para no enviar respuesta demasiado rápido tras el aviso de proceso.
- Pipeline log fire-and-forget para métricas sin bloquear el flujo.
- Admin-only mode con doble fuente (config_store DB + env var fallback).

#### Problemas encontrados

| # | Severidad | Descripción | Archivo:Línea | Impacto | Recomendación |
|---|-----------|-------------|---------------|---------|---------------|
| 1 | **ALTO** | Sin timeout global del pipeline. Si Phase 3 o Phase 4 se cuelgan, el contact lock expira a 60s pero el pipeline sigue corriendo consumiendo recursos. No hay AbortController ni deadline global. | engine.ts:137-444 | Un pipeline zombie puede consumir un slot del semáforo indefinidamente. | Añadir un `Promise.race` con un timeout global (ej. 120s) en `processMessageInner`. |
| 2 | **MEDIO** | El aviso timer (`setTimeout` en línea 240) captura `pipelineState` por closure, pero si el pipeline completa entre el check `pipelineState.completed` y el `sendAviso`, puede enviar un ACK después de la respuesta real. | engine.ts:239-268 | Race condition menor — usuario recibe ACK después de la respuesta real. | Usar un flag atómico + clearTimeout más agresivo, o cancelar el ACK si la respuesta ya fue enviada. |
| 3 | **MEDIO** | `isAdminOnlyActive` hace un query a DB en CADA mensaje. Con 50 pipelines concurrentes, esto es 50 queries/s al `config_store`. | engine.ts:522-540 | Carga innecesaria en DB. | Cachear el resultado en Redis con TTL de 30s, o usar el mismo patrón de `getProactiveConfig` con cache en memoria. |
| 4 | **BAJO** | Los durations en el error catch (líneas 430-442) reportan todas las fases como 0ms, perdiendo datos parciales de fases completadas antes del error. | engine.ts:430-442 | Métricas imprecisas cuando el pipeline falla a mitad de camino. | Capturar duraciones parciales en variables externas al try/catch. |

#### Madurez: 4/5

---

### Phase 1 — Intake (phase1-intake.ts)

#### Fortalezas
- Paralelización extensiva con `Promise.allSettled` — nunca bloquea por fallo de un subsistema.
- Degradación graceful: si memory, knowledge, sheets, o freshdesk fallan, el pipeline continúa.
- WhatsApp LID migration automática (phone → LID) con creación de voice channel.
- Filtrado de knowledge categories por permisos del usuario.
- Campaign detection integrada con channel type y round number.
- Channel-specific session timeout desde `channel-config:{name}`.

#### Problemas encontrados

| # | Severidad | Descripción | Archivo:Línea | Impacto | Recomendación |
|---|-----------|-------------|---------------|---------|---------------|
| 5 | **MEDIO** | `normalizeText` se llama con `message.content.text` que puede ser `undefined` para mensajes de tipo audio/imagen/documento. Retorna `''` correctamente, pero luego `searchKnowledge` y `searchFreshdeskIndex` reciben string vacío. El guard en línea 85-87 previene la búsqueda Freshdesk, pero la RAG local en línea 97-99 solo lo previene si `!knowledgeManagerSvc`. | phase1-intake.ts:56,97-99 | Búsquedas RAG innecesarias con query vacío cuando el knowledge module no está activo. | Añadir guard `&& normalizedText` al fallback RAG (ya existe para Freshdesk). |
| 6 | **BAJO** | `loadSheetsCache` (línea 535) parsea JSON desde Redis sin validación de estructura. Si el cache contiene JSON malformado por un bug en cache-refresh, podría inyectar datos inesperados al contexto. | phase1-intake.ts:535-542 | Datos corruptos en contexto del LLM. | Validar estructura mínima del parsed JSON. |
| 7 | **BAJO** | Comentario numeración inconsistente: paso 4 falta, hay dos paso 5 (líneas 71, 74). | phase1-intake.ts:71-74 | Solo cosmético. | Renumerar comentarios. |

#### Madurez: 4/5

---

### Phase 2 — Evaluate (phase2-evaluate.ts)

#### Fortalezas
- Fallback seguro diferenciado: reactivo → `respond_only` (contesta al humano), proactivo → `no_action` (no envía nada).
- Override automático del plan si `injectionRisk` o `possibleInjection` del Phase 1.
- Override si `onScope = false` — redirige suavemente.
- Parsing resiliente del JSON del LLM con strip de code fences.
- Replan context injection clara con resumen de fallos anteriores.

#### Problemas encontrados

| # | Severidad | Descripción | Archivo:Línea | Impacto | Recomendación |
|---|-----------|-------------|---------------|---------|---------------|
| 8 | **MEDIO** | `parseExecutionPlan` (línea 173) acepta `step.type` sin validar contra el enum `ExecutionPlanType`. Si el LLM inventa un tipo (ej. `"hack_system"`), se propaga al Phase 3 donde cae en el `default` case retornando error. No es un bug pero es un path innecesario. | phase2-evaluate.ts:178-184 | Plan con tipos inválidos consume un ciclo de ejecución antes de fallar. | Filtrar/mapear tipos desconocidos a `respond_only` en el parser. |
| 9 | **BAJO** | El LLM puede retornar `tools_needed` con nombres de tools que no existen en el catálogo. No se valida contra el catálogo real. | phase2-evaluate.ts:147 | Sin impacto funcional directo (Phase 3 valida en ejecución), pero contamina logs/métricas. | Filtrar `toolsNeeded` contra el catálogo disponible. |

#### Madurez: 4/5

---

### Phase 3 — Execute (phase3-execute.ts)

#### Fortalezas
- Agrupación inteligente de pasos: independientes en paralelo (semáforo-controlados), dependientes en secuencia.
- Skip de dependency chains cuando un paso previo falla.
- StepSemaphore previene overload de backends (LLM/DB/tools).
- Attachment processing como paso planificado por el evaluador (no forzado).
- Retry de tools con 1 reintento automático en `executeApiCall`.
- Web search con fallback Anthropic si Google falla.

#### Problemas encontrados

| # | Severidad | Descripción | Archivo:Línea | Impacto | Recomendación |
|---|-----------|-------------|---------------|---------|---------------|
| 10 | **ALTO** | `mocks/tool-registry.ts` sigue siendo el tool executor por defecto. `executeTool` y `getDefinition` importan desde `../mocks/tool-registry.js` (línea 18). El catálogo devuelve datos mock hardcodeados. Si el módulo `tools` real no está activo, todas las `api_call` devuelven datos falsos. | phase3-execute.ts:18 + mocks/tool-registry.ts:35-78 | En producción sin el módulo `tools`, el LLM recibe datos falsos y genera respuestas incorrectas. | Verificar que el módulo `tools` está activo y su registry reemplaza estos mocks. Si no, lanzar error en vez de datos falsos. |
| 11 | **MEDIO** | `executeStep` no tiene timeout individual. Si un tool o subagent se cuelga, solo el contact lock timeout (60s) lo libera eventualmente. | phase3-execute.ts:144-200 | Un paso colgado bloquea todo el pipeline para ese contacto. | Envolver cada `executeStep` con `Promise.race` + timeout configurable por tipo de paso. |
| 12 | **MEDIO** | `ctx.attachmentContext` se muta directamente en Phase 3 (línea 124). Si dos pasos `process_attachment` corren en paralelo, hay race condition en la escritura de `ctx.attachmentContext`. | phase3-execute.ts:120-127 | Pérdida de datos de attachment si hay múltiples pasos de procesamiento paralelos. | Acumular resultados en un array local y asignar al final, o serializar pasos de attachment. |
| 13 | **BAJO** | Para pasos fallidos que resultan de `Promise.allSettled` rejection (línea 74-82), el `stepIndex` se reporta como `-1` porque no se captura el índice correcto. | phase3-execute.ts:74-82 | Logs con stepIndex inválido dificultan debugging. | Capturar el índice en el closure del `map`. |

#### Madurez: 3.5/5

---

### Phase 4 — Compose (phase4-compose.ts)

#### Fortalezas
- Retry con backoff exponencial (1s, 2s, 3s) por provider antes de fallback.
- Triple fallback: primary provider → fallback provider → file-based templates.
- TTS integrado con fallback graceful a texto si falla.
- Channel formatting delegado a message-formatter.
- `registry` es opcional — el engine puede funcionar sin él para testing.

#### Problemas encontrados

| # | Severidad | Descripción | Archivo:Línea | Impacto | Recomendación |
|---|-----------|-------------|---------------|---------|---------------|
| 14 | **MEDIO** | No hay validación de respuesta vacía del LLM. Si `callLLM` retorna `{ text: '' }`, se acepta como respuesta válida y se envía un mensaje vacío al contacto. | phase4-compose.ts:149-160 | El contacto recibe un mensaje vacío. | Tratar `text.trim() === ''` como fallo y continuar al siguiente provider/fallback. |
| 15 | **BAJO** | El `fallbackDir` se construye con un replace frágil: `config.knowledgeDir.replace(/\/knowledge\/?$/, '/fallbacks')`. Si el path no termina en `/knowledge`, no se reemplaza. | phase4-compose.ts:68 | Fallback templates no se encuentran si el knowledgeDir tiene un path no-estándar. | Usar `path.resolve(path.dirname(knowledgeDir), 'fallbacks')` o config explícito. |

#### Madurez: 4/5

---

### Phase 5 — Validate + Send (phase5-validate.ts)

#### Fortalezas
- Validación de output con sanitización de API keys, Bearer tokens, y secretos genéricos.
- Rate limiting por hora y día con anti-spam burst protection (Redis pipeline atómico).
- Emergency in-memory rate limiter cuando Redis está caído.
- System hard cap de 20 mensajes/hora por contacto.
- Retry de envío con backoff exponencial (1s, 2s, 4s).
- Post-send paralelo: persistencia, lead qualification, session update.
- Typing delay entre burbujas para canales instant.
- Proactive guards: farewell detection + contact lock + commitment detection.
- Error fallback si el delivery falla después de retries.

#### Problemas encontrados

| # | Severidad | Descripción | Archivo:Línea | Impacto | Recomendación |
|---|-----------|-------------|---------------|---------|---------------|
| 16 | **MEDIO** | `emergencyRateLimiter` (Map en memoria, línea 214) nunca se limpia. En un proceso long-running, acumula entries indefinidamente. No hay cleanup periódico ni TTL. | phase5-validate.ts:214-233 | Memory leak lento — cada contacto único agrega un entry que solo se limpia cuando `now > resetAt` en el próximo check. | Añadir un `setInterval` que limpie entries expiradas cada hora, o usar un LRU cache con max size. |
| 17 | **MEDIO** | Rate limit check (línea 253-288) hace `INCR` antes de verificar, lo que incrementa el contador incluso si luego se rechaza el mensaje por otro límite. | phase5-validate.ts:254-265 | Anti-spam counter se infla incorrectamente. Los hourly/daily counters también se incrementan incluso si el anti-spam ya rechazó. | Reorganizar: check primero, incrementar solo si todos los límites pasan. Usar MULTI/EXEC o Lua script. |
| 18 | **BAJO** | `lastMessageId` se genera como `randomUUID()` (línea 432) en vez de obtener el ID real del canal. El `channelMessageId` en el `DeliveryResult` nunca refleja el ID real del mensaje enviado. | phase5-validate.ts:432 | No se puede correlacionar el delivery result con el mensaje real en el canal. | Obtener el messageId del resultado de `message:send` hook si el canal lo provee. |

#### Madurez: 4/5

---

### Concurrency System

#### Fortalezas
- **PipelineSemaphore**: FIFO queue con backpressure configurable. Stats para monitoring. Diseño simple y correcto.
- **ContactLock**: Promise chaining garantiza serialización FIFO sin TOCTOU gaps. Timeout de 60s como safety net. Cleanup automático del Map.
- **StepSemaphore**: Limita pasos paralelos en Phase 3 sin agregar complejidad innecesaria.
- Tres capas de concurrencia (global → per-contact → per-step) es un diseño sólido y bien pensado.

#### Problemas encontrados

| # | Severidad | Descripción | Archivo:Línea | Impacto | Recomendación |
|---|-----------|-------------|---------------|---------|---------------|
| 19 | **MEDIO** | `PipelineSemaphore.queue` crece indefinidamente si los pipelines se completan pero nunca se procesan los queued. No hay timeout para entries en cola. Un mensaje puede esperar indefinidamente en el queue si el sistema está saturado. | pipeline-semaphore.ts:37-40 | Starvation posible — mensajes queued nunca reciben atención si la capacidad se libera lentamente. | Añadir timeout a las entries queued (ej. 30s) — si no se procesan, resolver como `'rejected'`. |
| 20 | **BAJO** | `ContactLock.locks` Map nunca tiene un límite de tamaño. Con miles de contactos únicos, podría crecer, aunque el cleanup en `finally` lo mitiga. | contact-lock.ts:12,43-46 | Riesgo menor — el cleanup es efectivo en uso normal. | Solo monitoring: log si `activeCount()` supera un umbral. |
| 21 | **BAJO** | `StepSemaphore` no tiene timeout. Si un step se cuelga, la queue del semáforo se bloquea para los siguientes steps del mismo pipeline. | step-semaphore.ts:28-35 | Steps queued esperan indefinidamente si un step previo no termina. | Añadir timeout en `acquire()` o delegar al contact lock timeout. |

#### Madurez: 4/5

---

### Attachments System

#### Fortalezas
- Procesamiento paralelo con concurrency limit (MAX_CONCURRENT=3) usando un pool de workers.
- System hard limits no overridables por channel config (50MB, 15 archivos).
- Intersection de categorías habilitadas con platform capabilities por canal.
- Injection validation con trust boundaries en todo contenido externo.
- Tiered injection: small (inline), medium (cached), large (summary + cached para query_attachment).
- Persistencia individual (fire-and-forget) — cada archivo se graba en DB independientemente.
- SSRF protection con blocked patterns para direcciones privadas/metadata.
- `query_attachment` tool con TF-IDF language-agnostic (sin stop word lists hardcodeadas).

#### Problemas encontrados

| # | Severidad | Descripción | Archivo:Línea | Impacto | Recomendación |
|---|-----------|-------------|---------------|---------|---------------|
| 22 | **ALTO** | URL extractor no protege contra DNS rebinding. Un atacante puede registrar un dominio que inicialmente resuelve a IP pública pero luego cambia a 127.0.0.1/10.x.x.x después del check de `isBlockedUrl`. El check es solo string-based contra la URL, no contra la IP resuelta. | url-extractor.ts:17-29,44-46 | SSRF via DNS rebinding — el bot podría acceder a servicios internos. | Resolver DNS primero, verificar la IP resuelta, luego hacer fetch. O usar un proxy con allowlist de IPs. |
| 23 | **MEDIO** | `extractSingleUrl` (línea 123) hace `response.text()` sin límite de lectura. Si el server devuelve un Content-Length mentiroso (bajo) pero envía mucho más datos, se lee todo en memoria. El size check en línea 126 es post-facto. | url-extractor.ts:123-126 | Posible OOM si un servidor malicioso envía gigabytes de datos. | Usar streaming con límite o `response.body` con ReadableStream + byte counter. |
| 24 | **MEDIO** | `query_attachment` usa `redis.keys()` (línea 102) que es O(N) y bloqueante en Redis. En producción con muchos attachments cacheados, esto puede bloquear Redis. | attachments/tools/query-attachment.ts:102 | Redis bloqueado durante el scan. | Pasar el `sessionId` como parámetro para construir el cache key directamente sin KEYS. |
| 25 | **BAJO** | `resolveCategory` (processor.ts:389-393) retorna `'documents'` como default para MIME types desconocidos. Un archivo `.exe` o `.zip` sería categorizado como documento. | attachments/processor.ts:389-393 | Archivos potencialmente peligrosos tratados como documentos. | Default a `'unknown'` y añadir esa categoría, o rechazar tipos desconocidos con fallback message. |

#### Madurez: 3.5/5

---

### ACK System

#### Fortalezas
- Triple fallback: LLM (3s timeout) → DB pool (con tono) → in-memory defaults → hardcoded.
- Tono configurable por canal (casual, formal, express) desde channel config.
- Action descriptions genéricas que nunca revelan internals.
- ACK timer con hold delay configurable para no enviar respuesta inmediatamente después del aviso.

#### Problemas encontrados

| # | Severidad | Descripción | Archivo:Línea | Impacto | Recomendación |
|---|-----------|-------------|---------------|---------|---------------|
| 26 | **BAJO** | `getDefaultAck` hace query a DB `ack_messages` cada vez que el LLM falla. Sin cache. En alta carga con LLM caído, esto son muchos queries. | ack-service.ts:86-95 | Carga innecesaria en DB si LLM ACK falla frecuentemente. | Cachear los ACK messages de DB en memoria con TTL de 5 minutos. |
| 27 | **BAJO** | No hay deduplicación de ACKs. Si dos mensajes del mismo contacto llegan casi simultáneamente, pueden enviarse dos ACKs antes de que el lock serialice los pipelines. | ack-service.ts (general) | Doble ACK al contacto — menor pero confuso. | Mitigado por el contact lock — el segundo mensaje espera. Riesgo real muy bajo. |

#### Madurez: 4/5

---

### Proactive System

#### Fortalezas
- **7 guardas ejecutadas en orden**: idempotencia → horario laboral → contact lock → outreach dedup → cooldown → rate limit → conversation guard. Diseño defensivo excelente.
- Email bypasses business hours — correcto para canal asíncrono.
- Overdue commitments bypass dedup y conversation guard — prioriza cumplir promesas.
- BullMQ con prioridades por tipo: commitments (2) > reminders (3) > follow-up (5) > reactivation (8) > background (10).
- Worker con rate limiter (10 jobs/minuto) y concurrency (5).
- Retry con backoff exponencial (3 intentos, 5s base).
- Nightly batch idempotente con flag Redis.
- Commitment auto-detection como safety net (Via B) independiente del evaluador.
- Commitment validator con clasificación known/generic/rejected.

#### Problemas encontrados

| # | Severidad | Descripción | Archivo:Línea | Impacto | Recomendación |
|---|-----------|-------------|---------------|---------|---------------|
| 28 | **MEDIO** | `proactiveConfig` se carga una vez en `startProactiveRunner` y se pasa como closure al worker. Cambios en `instance/proactive.json` requieren restart. El `reloadProactiveConfig()` existe pero no se invoca periódicamente. | proactive-runner.ts:42,77-85 | Config changes no surten efecto hasta restart. | Recargar config periódicamente (ej. cada 5 minutos) o al recibir un signal/hook. |
| 29 | **MEDIO** | `buildProactiveContext` (proactive-pipeline.ts:234) usa `contactResult.rows[0]!` con non-null assertion. Si el contacto fue eliminado entre el scanner y el pipeline, esto lanza un runtime error. | proactive-pipeline.ts:234 | Pipeline crash para contactos eliminados. | Verificar `contactResult.rows.length > 0` y retornar early con error descriptivo. |
| 30 | **MEDIO** | Follow-up, reactivation y nightly-batch hardcodean `slug = 'luna'` en queries SQL. En multi-instance deploy, esto no funciona. | proactive/jobs/follow-up.ts:33, reactivation.ts:33, nightly-batch.ts:37 | Solo funciona para el agente 'luna'. | Obtener el agent ID del contexto o config, no hardcodear. |
| 31 | **BAJO** | `guardBusinessHours` usa `toLocaleString` para timezone conversion, que es impreciso y depende del locale del sistema. | proactive/guards.ts:253-259 | Cálculos de horario laboral pueden estar off por minutos. | Usar `Intl.DateTimeFormat` con `timeZone` option o librería como `luxon`. |
| 32 | **BAJO** | Nightly batch `compressOldSessions` trunca conversación a 15K chars (nightly-batch.ts:249) pero no verifica si el truncamiento corta mid-message. | proactive/jobs/nightly-batch.ts:249 | Resúmenes de compresión pueden perder contexto del último mensaje. | Truncar en un boundary de mensaje, no mid-string. |

#### Madurez: 4/5

---

### Subagent System

#### Fortalezas
- Guardrails triple: max iteraciones (ceiling 10), token budget, y timeout.
- Hard ceiling de 10 iteraciones no overridable por config.
- Guardrail check antes de cada iteración.
- Tool allowlist enforcement — tools no permitidas son rechazadas.
- Function calling nativo (no text parsing).
- Config desde `instance/config.json` con defaults sensatos.

#### Problemas encontrados

| # | Severidad | Descripción | Archivo:Línea | Impacto | Recomendación |
|---|-----------|-------------|---------------|---------|---------------|
| 33 | **MEDIO** | El loop `while(true)` (subagent.ts:59) solo sale por guardrail hit, error, o no-tool-call. Si el LLM retorna tool calls indefinidamente sin progresar, el guardrail de iteraciones lo detiene, pero el guardrail check está al inicio del loop — un LLM call lento puede ejecutarse completa incluso después de que el timeout expire (el timeout se evalúa al inicio de la *siguiente* iteración). | subagent/subagent.ts:59-170 | Un subagent puede exceder su timeout por la duración de un LLM call. | Usar `AbortController` con `setTimeout` que aborte el LLM call activo. |
| 34 | **BAJO** | `loadGuardrails` lee `instance/config.json` del filesystem en cada invocación del subagent. No hay cache. | subagent/guardrails.ts:28-29 | I/O innecesario en cada subagent call. | Cachear con TTL de 5 minutos. |

#### Madurez: 3.5/5

---

### Prompts

#### Fortalezas
- Evaluator prompt bien estructurado: tool catalog filtrado por permisos, context injection incremental, replanning context.
- Compositor prompt con 4 capas: identity → job → guardrails → relationship, cada una overridable desde `prompts:service`.
- Channel format instructions overridables desde `config_store` (DB).
- Proactive evaluator con reglas claras para `no_action` — safe default.
- Subagent prompt minimal: solo tarea + contexto mínimo, sin identity/guardrails.

#### Problemas encontrados

| # | Severidad | Descripción | Archivo:Línea | Impacto | Recomendación |
|---|-----------|-------------|---------------|---------|---------------|
| 35 | **MEDIO** | Compositor prompt (compositor.ts:47) usa `fileCache` sin TTL ni invalidación. Si se editan los archivos identity.md o guardrails.md en disco, los cambios no surten efecto hasta restart. | prompts/compositor.ts:47-63 | Cambios en prompts requieren restart. | Añadir TTL al cache (ej. 5 minutos) o usar file watcher. |
| 36 | **BAJO** | El evaluator prompt inyecta el historial completo (hasta 5 mensajes × 200 chars) + todas las fuentes de context. Para contactos con mucho historial + commitments + summaries + knowledge + freshdesk + attachments, el prompt puede ser muy largo. No hay budget de tokens para el prompt del evaluador. | prompts/evaluator.ts:74-209 | Riesgo de exceder el context window del modelo classify (que suele ser económico/pequeño). | Añadir un token budget estimado y truncar secciones de menor prioridad si se excede. |
| 37 | **BAJO** | `getChannelLimit` (compositor.ts:34-44) hace un `import()` dinámico de `config-store.js` en cada llamada. | prompts/compositor.ts:37 | Overhead menor per-request. | Importar estáticamente al top del archivo. |

#### Madurez: 4/5

---

### Utils

#### Fortalezas
- **injection-detector**: Patrones cubriendo los vectores más comunes (jailbreak, DAN, system prompt leak, delimiter injection).
- **normalizer**: Manejo correcto de surrogate pairs al truncar, colapso de whitespace, strip de chars invisibles.
- **message-formatter**: HTML escaping correcto para email (previene XSS). Bubble splitting por párrafos para instant.
- **llm-client**: Dual-mode (gateway vs direct SDK) con fallback transparente. Multimodal content helpers para Anthropic y Google.
- **rag-local**: Reload periódico cada 5 minutos, chunking inteligente por secciones.

#### Problemas encontrados

| # | Severidad | Descripción | Archivo:Línea | Impacto | Recomendación |
|---|-----------|-------------|---------------|---------|---------------|
| 38 | **ALTO** | La detección de injection es puramente regex-based. Es eludible con ofuscación simple: "1gnore prev1ous instruct1ons", unicode lookalikes, o spacing tricks ("i g n o r e previous"). | utils/injection-detector.ts:5-22 | Atacante motivado puede bypassear toda la protección de injection. | Complementar con un check LLM rápido (como hace commitment-detector) para mensajes que pasan regex pero son sospechosos. O usar modelos embeddings para detección semántica. |
| 39 | **MEDIO** | `callLLMWithFallback` cuando tiene gateway (línea 110-112) NO usa el fallback provider/model — simplemente delega al gateway y confía en que maneje el fallback internamente. Si el gateway no implementa fallback para esa task, se pierde la redundancia. | utils/llm-client.ts:109-112 | Si el LLM module gateway no tiene fallback configurado para una task, no hay segundo intento. | Documentar claramente que el gateway debe manejar fallback, o implementar fallback manual también con gateway. |
| 40 | **BAJO** | `rag-local` usa una variable global `knowledgeIndex` — si dos llamadas concurrentes triggean reload, pueden recargar el índice dos veces. | utils/rag-local.ts:100-103 | Doble carga innecesaria (minor, legacy). | Usar un lock o promise dedup. Aunque esto es legacy y será reemplazado por knowledge module. |

#### Madurez: 3.5/5

---

### Fallbacks

#### Fortalezas
- Cascade de 5 niveles: channel/intent → channel/generic → intent → generic → hardcoded.
- Cache con TTL de 5 minutos.
- Placeholder replacement para personalización ({{name}}, {{channel}}).
- Error fallbacks con tono configurable, naturales y no-robóticos.

#### Problemas encontrados

| # | Severidad | Descripción | Archivo:Línea | Impacto | Recomendación |
|---|-----------|-------------|---------------|---------|---------------|
| 41 | **BAJO** | `fallback-loader.ts` cache nunca se limpia excepto por `clearFallbackCache()` que solo se invoca manualmente. Con muchos paths intentados, el cache crece con entries `null` (archivo no encontrado). | fallbacks/fallback-loader.ts:21,65-83 | Memory leak menor en el cache de templates. | Añadir max size al cache o limpiar entries null periódicamente. |

#### Madurez: 4/5

---

## Bugs encontrados

| # | Severidad | Archivo:Línea | Descripción | Impacto |
|---|-----------|---------------|-------------|---------|
| B1 | **ALTO** | phase3-execute.ts:18 | Mock tool registry usado como executor por defecto — datos falsos si módulo tools no activo | Respuestas incorrectas al usuario |
| B2 | **MEDIO** | phase3-execute.ts:74-82 | `stepIndex: -1` para pasos fallidos en `Promise.allSettled` — índice no capturado en closure | Logs ilegibles para debugging |
| B3 | **MEDIO** | phase4-compose.ts:149-160 | Respuesta vacía del LLM aceptada como válida — puede enviar mensaje vacío | UX degradada |
| B4 | **MEDIO** | proactive-pipeline.ts:234 | Non-null assertion `rows[0]!` sin verificar length — crash si contacto eliminado | Pipeline crash silencioso |
| B5 | **MEDIO** | phase5-validate.ts:254-265 | Anti-spam INCR antes de verificar límites — contadores inflados | Rate limiting impreciso |
| B6 | **BAJO** | phase1-intake.ts:71-74 | Comentarios de pasos numerados inconsistentes (falta paso 4, dos paso 5) | Confusión al leer código |

## Riesgos de seguridad

| # | Severidad | Descripción | Vector de ataque | Mitigación recomendada |
|---|-----------|-------------|-------------------|------------------------|
| S1 | **ALTO** | Injection detection puramente regex — eludible con ofuscación | Atacante usa variantes Unicode, spacing, o transliteración para bypassear regex | Añadir detección semántica (embedding similarity) o LLM-based check rápido |
| S2 | **ALTO** | URL extractor vulnerable a DNS rebinding (SSRF) | Atacante registra dominio que resuelve inicialmente a IP pública, luego cambia a 127.0.0.1 | Resolver DNS, verificar IP resultante contra blocklist, luego fetch |
| S3 | **MEDIO** | `response.text()` sin límite de lectura en URL extractor | Servidor malicioso envía Content-Length bajo pero gigabytes de datos | Usar streaming con byte counter y abortar al exceder límite |
| S4 | **MEDIO** | `redis.keys()` en query_attachment — DoS potencial | Muchos attachments cacheados causan KEYS scan bloqueante | Construir cache key directamente con sessionId como parámetro |
| S5 | **BAJO** | MIME types desconocidos categorizados como 'documents' | Archivo .exe/.zip procesado como documento | Default a categoría 'unknown' y rechazar |
| S6 | **BAJO** | Sin validación de estructura en sheets cache JSON | JSON malformado en Redis inyecta datos inesperados al contexto LLM | Validar schema mínimo del parsed JSON |

## Deuda técnica

| # | Prioridad | Descripción | Esfuerzo estimado |
|---|-----------|-------------|-------------------|
| D1 | **Alta** | Mock tool registry (`mocks/tool-registry.ts`) debe ser eliminado o convertido en fallback explícito con warning visible | 2-4h |
| D2 | **Alta** | Añadir timeout global al pipeline (120s deadline con AbortController) | 4-6h |
| D3 | **Media** | Migrar detección de injection a modelo híbrido (regex + semántico) | 1-2d |
| D4 | **Media** | Refactorizar rate limiting con Lua script atómico en Redis | 4-6h |
| D5 | **Media** | Añadir timeout por paso en Phase 3 | 2-4h |
| D6 | **Media** | Resolver DNS rebinding en URL extractor | 4-6h |
| D7 | **Media** | Desacoplar agent ID hardcodeado ('luna') en proactive jobs | 2-3h |
| D8 | **Baja** | Añadir TTL/invalidación a caches en memoria (fileCache, knowledgeIndex, guardrails) | 2-3h |
| D9 | **Baja** | Cleanup periódico del emergencyRateLimiter Map | 1h |
| D10 | **Baja** | Cachear isAdminOnlyActive con TTL corto | 1h |

## Madurez general: 3.8/5

**Justificación**: El engine tiene una arquitectura sólida con separación clara de responsabilidades, concurrencia bien pensada en 3 capas, y degradación graceful extensiva. El sistema proactivo con 7 guardas es de nivel producción. Las debilidades principales son: (1) la dependencia residual del mock tool registry, (2) la ausencia de timeout global del pipeline, (3) la detección de injection regex-only eludible, y (4) vectores de SSRF en el URL extractor. Estas no son fallas de diseño sino gaps de hardening que se resuelven incrementalmente.

## Top 10 recomendaciones (ordenadas por impacto)

1. **Eliminar/reemplazar mock tool registry** — Es el riesgo funcional #1. Si el módulo `tools` no está activo, el sistema devuelve datos falsos silenciosamente. Debe fallar explícitamente o degradar con warning visible.

2. **Añadir timeout global al pipeline** — Sin esto, un pipeline zombie puede consumir un slot del semáforo indefinidamente. Implementar con `Promise.race` + `AbortController` a 120s.

3. **Resolver vulnerabilidad de DNS rebinding en URL extractor** — Resolver DNS primero, verificar IP contra blocklist, luego fetch. Es un vector de SSRF real.

4. **Mejorar detección de injection con capa semántica** — El regex es un buen primer filtro pero es eludible. Añadir un check con embeddings o LLM rápido para mensajes que pasan regex pero tienen señales sospechosas.

5. **Refactorizar rate limiting a operación atómica** — Usar Lua script en Redis para check+increment atómico. El patrón actual de INCR-then-check infla contadores.

6. **Añadir timeout por paso en Phase 3** — Un tool o subagent colgado bloquea todo el pipeline del contacto. Envolver cada `executeStep` con timeout configurable.

7. **Cachear `isAdminOnlyActive` y proactive config** — Queries a DB en cada mensaje y config de filesystem en cada subagent son innecesarios. Cachear con TTL cortos.

8. **Validar respuesta vacía del LLM en Phase 4** — Tratar `text.trim() === ''` como fallo para evitar enviar mensajes vacíos al contacto.

9. **Desacoplar agent ID hardcodeado ('luna')** — Los proactive jobs hardcodean el slug en queries SQL. Debe venir del contexto o config para soportar multi-instance.

10. **Añadir streaming con byte limit al URL extractor** — `response.text()` sin límite permite OOM con servidores maliciosos. Usar `ReadableStream` con counter.

