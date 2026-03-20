# LLM — Gateway unificado de proveedores LLM

Gateway centralizado para Anthropic, Google (Gemini) y OpenAI. Circuit breaker, routing por tarea, tracking de uso/costos, seguridad contra prompt injection.

## Archivos
- `manifest.ts` — lifecycle, configSchema, oficina fields/routes
- `types.ts` — todos los tipos del módulo (providers, routes, requests, responses, usage)
- `llm-gateway.ts` — orquestador principal: routing → rate limit → budget → circuit breaker → retry → call → tracking → sanitize
- `circuit-breaker.ts` — patrón circuit breaker por provider (CLOSED → OPEN → HALF-OPEN)
- `providers.ts` — adapters normalizados para Anthropic, Google, OpenAI (multimodal, tools, vision)
- `task-router.ts` — enruta tareas a providers según config, disponibilidad y circuit breaker
- `usage-tracker.ts` — tracking Redis (hot counters) + PG (persistencia). Rate limits, budget.
- `pg-store.ts` — tablas llm_usage, llm_daily_stats. Queries de resumen y limpieza.
- `security.ts` — detección de prompt injection, sanitización de prompts/respuestas, redacción de API keys.

## Manifest
- type: `core-module`, removable: false, activateByDefault: true
- configSchema: API keys (3 providers + 3 capability overrides), circuit breaker (threshold, window, recovery), retry, timeouts per provider, rate limits, budget, routing, fallback chain
- Servicio: `llm:gateway` (LLMGateway instance)
- Hooks: escucha `llm:chat`, `llm:models_available`. Emite `llm:provider_down`, `llm:provider_up`.

## API routes (montadas en /oficina/api/llm/)
- `GET /status` — estado de providers, circuit breakers, costo del día
- `GET /models` — modelos disponibles (query: ?provider=anthropic)
- `POST /models/refresh` — re-escanear modelos desde APIs
- `GET /usage` — resumen de uso (?period=hour|day|week|month)
- `GET /routes` — configuración de routing por tarea
- `PUT /routes` — actualizar routing de una tarea
- `GET /circuit-breakers` — estado de circuit breakers
- `POST /circuit-breakers/reset` — resetear circuit breaker de un provider

## Flujo de una llamada LLM
1. Engine llama `gateway.chat(request)` o usa hook `llm:chat`
2. System prompt sanitizado (API keys redactadas) + security preamble inyectado
3. TaskRouter resuelve targets ordenados (primary + fallbacks) según disponibilidad
4. Para cada target: check rate limit → check budget → check circuit breaker
5. Retry con backoff exponencial (configurable, default 2 intentos)
6. Si todos los retries fallan → circuit breaker registra fallo → siguiente target
7. Si circuit breaker se abre → hook `llm:provider_down` fired
8. Response sanitizada (API keys redactadas en output)
9. Usage tracked en Redis (RPM, TPM, cost) + PG (persistencia)

## Circuit breaker
- CLOSED (sano): todas las llamadas pasan. Cuenta fallos en ventana.
- Si fallos >= threshold en windowMs → OPEN (down)
- OPEN: bloquea llamadas. Después de recoveryMs → HALF-OPEN
- HALF-OPEN: permite halfOpenMax llamadas de prueba. Si éxito → CLOSED. Si fallo → OPEN.
- Defaults: 5 fallos en 10 min → DOWN 5 min.

## Trampas
- **API keys**: NUNCA se logean ni se incluyen en prompts. La capa de security redacta cualquier leak.
- **Errores no-retryable** (400, validation) cuentan como fallo de circuit breaker inmediatamente.
- **Rate limit 429** sí es retryable (con backoff).
- **Budget = 0** significa sin límite. Se chequea antes de cada llamada.
- **Gateway es null-safe**: si el módulo no está activo, el engine usa fallback directo.
- **Modelo de costos**: tabla DEFAULT_COST_TABLE en types.ts. Actualizable via tracker.
- **Helpers HTTP y config**: usa `jsonResponse`, `parseBody`, `parseQuery` de `kernel/http-helpers.js` y `numEnvMin`, `floatEnvMin` de `kernel/config-helpers.js`. NO redefinir localmente.
