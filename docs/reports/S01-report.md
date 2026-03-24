# INFORME DE CIERRE — Sesión S01: Engine Core Pipeline
## Branch: claude/engine-core-pipeline-nlZtj

### Objetivos definidos
Construir el engine completo de LUNA: pipeline de 5 fases reactivo, flujo proactivo, subagent con guardrails, y toda la infraestructura de soporte.

### Completado ✅
- **types.ts** — Tipos completos del engine (ContextBundle, EvaluatorOutput, ExecutionOutput, etc.)
- **Phase 1** — Intake + Context Loading: normalización, resolución de usuario con cache Redis, quick actions, RAG local, carga de historial y sesión
- **Phase 2** — Evaluación con LLM evaluador: construye prompt con catálogo de tools filtrado por permisos, parsea JSON, maneja quick actions sin LLM
- **Phase 3** — Ejecución del plan: router por tipo (api_call, workflow, subagent, memory_lookup, web_search, respond_only), ejecución paralela con Promise.allSettled, retry 1x para tools
- **Phase 4** — Composición de respuesta: LLM compositor con identity.md/guardrails.md, formato por canal, fallback templates estáticos
- **Phase 5** — Validación + envío: output injection check, sensitive data check, rate limiting WA (30/h, 200/d), formateo por canal (burbujas WA ≤300 chars, HTML email), typing delay, persistencia, sheets sync placeholder
- **Subagent** — Mini-loop con guardrails configurables (maxIterations, timeoutMs, maxTokenBudget), function calling nativo
- **Proactive** — Runner con setInterval, 5 triggers definidos (follow-up, reminder, commitment-check, cache-refresh, nightly-batch), jobs idempotentes con flags Redis
- **Utils** — normalizer, injection-detector, quick-actions, rag-local (fuse.js), message-formatter, llm-client (Anthropic + Google + OpenAI directo)
- **Prompts** — Builders para evaluator, compositor, subagent
- **Mocks** — user-resolver (S02) con admins/coworkers hardcoded, tool-registry (S03) con 10 tools mock
- **Config** — Loader de env vars para todos los parámetros del engine
- **DB Migration** — SQL para contacts, contact_channels, sessions, messages, campaigns

### No completado ❌
- Circuit breaker y fallback chain robusto (por decisión: se hará cuando exista módulo LLM provider)
- BullMQ integration (no existe módulo de colas, proactive usa setInterval)
- Campaign detection (placeholder, retorna null)
- Commitment tracking (tabla y lógica pendiente)
- Google Sheets sync (placeholder en phase 5)
- Proactive jobs reales (solo logging, no generan mensajes aún)
- Acknowledgment messages (logged pero no enviados, falta wiring con registry hooks)

### Archivos creados/modificados
**Creados (23 archivos):**
- `src/engine/types.ts`
- `src/engine/config.ts`
- `src/engine/engine.ts`
- `src/engine/index.ts`
- `src/engine/phases/phase1-intake.ts`
- `src/engine/phases/phase2-evaluate.ts`
- `src/engine/phases/phase3-execute.ts`
- `src/engine/phases/phase4-compose.ts`
- `src/engine/phases/phase5-validate.ts`
- `src/engine/subagent/subagent.ts`
- `src/engine/subagent/guardrails.ts`
- `src/engine/proactive/proactive-runner.ts`
- `src/engine/proactive/triggers.ts`
- `src/engine/proactive/jobs/follow-up.ts`
- `src/engine/proactive/jobs/reminder.ts`
- `src/engine/proactive/jobs/commitment-check.ts`
- `src/engine/proactive/jobs/cache-refresh.ts`
- `src/engine/proactive/jobs/nightly-batch.ts`
- `src/engine/prompts/evaluator.ts`
- `src/engine/prompts/compositor.ts`
- `src/engine/prompts/subagent.ts`
- `src/engine/utils/normalizer.ts`
- `src/engine/utils/injection-detector.ts`
- `src/engine/utils/quick-actions.ts`
- `src/engine/utils/rag-local.ts`
- `src/engine/utils/message-formatter.ts`
- `src/engine/utils/llm-client.ts`
- `src/engine/mocks/user-resolver.ts`
- `src/engine/mocks/tool-registry.ts`
- `docs/migrations/s01-engine-tables.sql`
- `docs/reports/S01-report.md`

**Modificados:**
- `src/engine/CLAUDE.md` — actualizado con nueva arquitectura

### Interfaces expuestas (exports que otros consumen)
- `initEngine(registry)` — inicializar engine y registrar hook
- `processMessage(message)` — procesar mensaje por pipeline completo
- `stopEngine()` — detener proactive runner
- `getEngineConfig()` — leer config actual
- Types: `ContextBundle`, `PipelineResult`, `EvaluatorOutput`, `ExecutionOutput`, `UserType`, `UserPermissions`, `ToolResult`, `ToolCatalogEntry`, `ToolDefinition`, `LLMCallOptions`, `LLMCallResult`

### Dependencias instaladas
Ninguna nueva. Usa las existentes: @anthropic-ai/sdk, @google/generative-ai, openai, fuse.js, pino, pg, ioredis.

### Tests
No se escribieron tests en esta sesión. El engine compila sin errores TypeScript (0 errores tsc).

### Decisiones técnicas
1. **LLM directo sin circuit breaker** — llamadas directas a SDKs con fallback simple (try primary, catch → try fallback). Circuit breaker se implementará en módulo LLM provider.
2. **setInterval en lugar de BullMQ** — no existe módulo de colas. Proactive runner usa setInterval. Migración a BullMQ cuando exista el módulo.
3. **User type cache en Redis** — TTL configurable (default 12h). Evita consulta DB en cada mensaje.
4. **Config via getEnv()** — engine lee env vars via kernel config helper. No tiene configSchema propio porque no es un módulo del kernel.
5. **Mocks para S02/S03** — interfaces definidas y mockeadas. Cuando S02 y S03 estén listos, solo hay que reemplazar imports en phase1, phase2, phase3.

### Riesgos o deuda técnica
1. **Tablas DB no creadas** — migration SQL está en `docs/migrations/` pero no se ejecuta automáticamente. Hay que correr el SQL manualmente o integrarlo al boot.
2. **Proactive jobs son noops** — solo logean, no generan mensajes reales. Necesitan wiring con el pipeline.
3. **Acknowledgment no enviado** — logged pero no llega al canal. Falta integración con registry hooks desde phase 3.
4. **RAG reload cada 5min** — si los archivos de knowledge cambian, hay delay. Considerar file watcher.
5. **Cron simple** — solo matchea minuto/hora, no soporta day-of-week ni timezone real.

### Notas para integración
- Para activar el engine, llamar `initEngine(registry)` después de `loadModules()` en `src/index.ts`
- El engine escucha `message:incoming` y envía via `message:send` — los channel adapters ya disparan/escuchan estos hooks
- Cuando S02 esté listo: reemplazar import en `phase1-intake.ts` de `../mocks/user-resolver.js` → `../../users/index.js`
- Cuando S03 esté listo: reemplazar imports en `phase2-evaluate.ts` y `phase3-execute.ts` de `../mocks/tool-registry.js` → `../../tools/index.js`
- Ejecutar `docs/migrations/s01-engine-tables.sql` antes de probar el engine
