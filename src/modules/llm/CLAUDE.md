# LLM — Gateway unificado de proveedores LLM

Gateway centralizado para Anthropic y Google (Gemini). Circuit breaker (por provider + escalating por target), routing por tarea con 3 niveles de fallback, tracking de uso/costos, seguridad contra prompt injection, prompt caching, batch async.

## Archivos
- `manifest.ts` — lifecycle, configSchema, console fields/routes
- `types.ts` — todos los tipos del módulo (providers, routes, requests, responses, usage, batch, TTS, scanner)
- `llm-gateway.ts` — orquestador principal: routing → rate limit → budget → circuit breaker → retry → call → tracking → sanitize → batch
- `circuit-breaker.ts` — CB legacy por provider + **EscalatingCBManager** por target (provider:model)
- `providers.ts` — adapters normalizados: Anthropic (prompt cache, JSON prefill, thinking, code exec, citations, batch) y Google (JSON mode, thinking, grounding, code exec, implicit cache)
- `task-router.ts` — enruta tareas a providers con 3 niveles: primary → downgrade → cross-api fallback
- `usage-tracker.ts` — tracking Redis (hot counters) + PG (persistencia). Rate limits, budget.
- `pg-store.ts` — tablas llm_usage, llm_daily_stats. Queries de resumen y limpieza.
- `security.ts` — detección de prompt injection, sanitización de prompts/respuestas, redacción de API keys.
- `model-scanner.ts` — escaneo periódico de modelos disponibles en ambos providers.

## Fallback chain de 3 niveles
```
Primary (2 retries con backoff)
  ↓ falla
Downgrade — mismo provider, modelo menor (2 retries)
  ↓ falla
Fallback — otro provider, capacidades equivalentes (2 retries)
```

Configurado por tarea en console (/console/llm > panel Modelos) con dropdowns Primary + Downgrade + Fallback.

## Escalating Circuit Breaker (por model-target)
- Clave: `provider:model` (ej: "anthropic:claude-sonnet-4-6")
- Trigger: 2 fallas en 30 min
- Escalamiento: 1h → 3h → 6h → loop cada 6h
- Reset: primer éxito → closed + reset escalation level
- Independiente del CB legacy por provider (ambos se verifican)

## Features nativos de las APIs
- **Prompt Caching**: Anthropic `cache_control: { type: 'ephemeral' }` (90% ahorro). Google implícito en 2.5+.
- **JSON Mode**: Anthropic prefill trick (`{`). Google `responseMimeType: 'application/json'`.
- **Extended Thinking**: Anthropic `thinking: { type: 'adaptive' }`. Google `thinkingConfig`.
- **Google Search Grounding**: `{ googleSearch: {} }` tool nativa en web_search.
- **Code Execution**: Anthropic `{ type: 'code_execution' }`. Google `{ codeExecution: {} }`.
- **Citations**: Anthropic document blocks (configurable, `LLM_CITATIONS_ENABLED`).
- **Batch**: Anthropic Message Batches API (50% off). Gateway expone `submitBatch/getBatchStatus/getBatchResults`.

## Trampas
- **API keys**: NUNCA se logean ni se incluyen en prompts.
- **Thinking + temperature**: incompatibles en Anthropic — adapter elimina temperature automáticamente.
- **JSON mode + tools**: incompatibles en Google 2.5 cuando hay tool calls en historial.
- **Budget = 0**: sin límite. Se chequea antes de cada llamada.
- **Escalating CB es por target**: un modelo puede estar down sin afectar a otros del mismo provider.
- **Phase 2 decide thinking/coding**: `ExecutionStep.useThinking` y `useCoding` son hints del evaluador.
