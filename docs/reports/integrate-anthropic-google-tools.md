# INFORME DE CIERRE — Integración de features avanzados Anthropic + Google
## Branch: claude/integrate-anthropic-tools-gJeju

### Objetivos definidos
Integrar capacidades nativas de las APIs de Anthropic y Google (prompt caching, JSON mode, extended thinking, Google Search grounding, code execution, batch processing) en el engine de LUNA, con fallback chain de 3 niveles y circuit breaker escalable por modelo.

### Completado
- Escalating Circuit Breaker per model-target (2 fallas en 30min -> 1h/3h/6h cooldown)
- Fallback chain de 3 niveles: primary -> downgrade (mismo provider) -> cross-API
- Default routes actualizados con asignación de modelos por tarea
- Prompt caching: Anthropic `cache_control: { type: 'ephemeral' }` en system prompts
- JSON mode: Anthropic prefill trick + Google `responseMimeType`
- Extended thinking: Anthropic `thinking: { type: 'adaptive' }` + Google `thinkingConfig`
- Google Search grounding: tool `{ googleSearch: {} }` en web_search step
- Code execution: tools built-in de ambos providers (`code_execution` / `codeExecution`)
- Phase 2 decide thinking/coding per-step via `useThinking`/`useCoding` hints
- Nuevo step type `code_execution` en pipeline Phase 3
- Batch async processing: Anthropic Message Batches API (50% discount)
- Console UI: dropdowns de Downgrade en panel Modelos de /console/llm
- Config keys: downgrade provider/model por tarea, prompt cache toggle, citations toggle
- Cost table actualizado: Claude 4.6, Gemini 3/3.1, TTS preview models
- CLAUDE.md del módulo LLM completamente actualizado

### No completado
- **Gemini TTS**: Preview, PCM raw requiere conversión. Infraestructura lista (cost table + gateway.tts()) pero implementación diferida. El audit branch ya mejora el Cloud TTS existente.
- **Google Batch API**: Solo implementado para Anthropic. Google batch puede agregarse después.
- **Citations completo**: Flag `LLM_CITATIONS_ENABLED` creado, pero implementación de document blocks en AnthropicAdapter pendiente (requiere restructurar system prompt a blocks).
- **Batch en nightly-batch.ts**: Gateway.submitBatch() listo pero no conectado aún al BullMQ job existente.
- **Console UI avanzada**: Dropdowns de downgrade agregados, pero falta validar que el model-scanner popule correctamente los valores vacíos en la UI.

### Archivos creados/modificados
- `src/modules/llm/types.ts` — RouteTarget.downgrade, EscalatingCB types, LLMRequest/Response nuevos campos, batch types, cost table
- `src/modules/llm/circuit-breaker.ts` — EscalatingCircuitBreaker + EscalatingCBManager
- `src/modules/llm/task-router.ts` — Resolve 3 niveles, loadFromConfig con downgrades
- `src/modules/llm/providers.ts` — AnthropicAdapter (cache, JSON, thinking, code exec, batch), GoogleAdapter (JSON, thinking, grounding, code exec)
- `src/modules/llm/llm-gateway.ts` — Target CB, fallbackLevel annotation, batch methods
- `src/modules/llm/manifest.ts` — Downgrade keys, cache/citations toggles
- `src/modules/llm/CLAUDE.md` — Documentación completa actualizada
- `src/engine/types.ts` — LLMCallOptions/Result nuevos campos, code_execution step, useThinking/useCoding
- `src/engine/utils/llm-client.ts` — Gateway interface + passthrough de nuevos campos
- `src/engine/phases/phase2-evaluate.ts` — jsonMode: true
- `src/engine/phases/phase3-execute.ts` — googleSearchGrounding, executeCodeExecution
- `src/engine/subagent/subagent.ts` — Thinking/coding from step hints
- `src/engine/prompts/evaluator.ts` — code_execution, use_thinking, use_coding docs
- `src/modules/console/templates-sections.ts` — Downgrade dropdowns en models panel
- `instance/prompts/system/evaluator-system.md` — Nuevos step types documentados

### Interfaces expuestas
- `LLMGateway.submitBatch()` / `getBatchStatus()` / `getBatchResults()`
- `LLMGateway.getTargetCBStatus()` / `resetTargetCB()`
- `EscalatingCBManager` / `EscalatingCircuitBreaker` (exported from circuit-breaker.ts)
- `FallbackLevel` type (exported from task-router.ts)

### Dependencias instaladas
Ninguna nueva.

### Tests
No hay tests unitarios. Verificación: `npx tsc --noEmit` pasa sin errores nuevos.

### Decisiones técnicas
1. **Phase 2 decide thinking/coding**, no env vars globales. El evaluador agrega hints por step.
2. **Citations off por default** (`LLM_CITATIONS_ENABLED: false`) — no afecta embeddings.
3. **Escalating CB es complementario al legacy CB** — ambos se verifican. No rompe backward compat.
4. **Prompt caching siempre activo** (`LLM_PROMPT_CACHE_ENABLED: true`) — sin riesgo, solo ahorro.
5. **JSON mode siempre en Phase 2** — backup de regex parsing se mantiene como safety net.
6. **Downgrade keys son provider+model separados** (no JSON) para reusar `modelDropdown()` de la consola.

### Riesgos o deuda técnica
- Batch results: Anthropic devuelve JSONL, parsing puede fallar con formatos inesperados
- Google Batch API no implementado (solo Anthropic batch)
- Extended thinking aumenta latencia — Phase 2 debe usarlo selectivamente
- JSON prefill trick de Anthropic puede fallar si el modelo no continúa con JSON válido (regex backup existe)

### Notas para integración
- Compatible con rama `claude/audit-console-settings-ZSt0S` (verificado, no hay conflictos)
- Los downgrade defaults están vacíos — los defaults hardcoded en task-router aplican
- Para activar batch en nightly, conectar `gateway.submitBatch()` en `nightly-batch.ts`
