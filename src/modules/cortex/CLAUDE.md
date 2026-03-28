# Cortex — Sistema nervioso de LUNA

Módulo de monitoreo y alertas en tiempo real. Feature principal: **Reflex** — detecta problemas y alerta al admin antes de perder leads. 100% código, cero LLM.

## Archivos
- `manifest.ts` — lifecycle, configSchema, console, API routes
- `types.ts` — Alert, Rule, CounterSet, HealthStatus, CortexConfig
- `reflex/sensors.ts` — hook listeners que alimentan contadores + ring buffer
- `reflex/counters.ts` — contadores in-memory con flush periódico a Redis
- `reflex/ring-buffer.ts` — buffer circular de logs WARN/ERROR (~20KB)
- `reflex/rules.ts` — definiciones de reglas (critical, degraded, info)
- `reflex/evaluator.ts` — setInterval tri-frecuencia (60s/5m/15m), NO BullMQ
- `reflex/alert-manager.ts` — state machine de alertas (triggered/resolved/escalated)
- `reflex/dispatcher.ts` — despacho multi-canal con mapa de dependencias
- `reflex/health.ts` — health check enriquecido (PG, Redis, WA, email, BullMQ, circuit breakers)

## Manifest
- **type**: `feature`
- **depends**: `[]` (sin dependencias duras, monitorea lo que exista)
- **configSchema**: `CORTEX_REFLEX_*` (intervalos, umbrales, canales, Telegram)

## Servicios expuestos
- `cortex:health` — `{ check(), getActiveAlerts(), getAlertHistory(limit?) }`

## API routes (bajo /console/api/cortex/)
- `GET health` — health check completo (status, components, pipeline, circuit breakers)
- `GET alerts/active` — alertas activas
- `GET alerts/history` — historial de alertas (7 días)

## Arquitectura de 4 capas
- **Capa A (Sensores)**: hook listeners dentro del proceso (prioridad 1)
- **Capa B (Evaluador)**: setInterval nativo, checks directos + métricas
- **Capa C (Watchdog)**: cron del host, fuera del container (`deploy/watchdog/`)
- **Capa D (Heartbeat)**: Healthchecks.io + UptimeRobot (externo)

## Reglas
- 6 críticas: PG down, Redis down, WA disconnected, memoria >80%, disco >90%, event loop lag >500ms
- Degraded + Info se agregan en Ola 2

## Trampas
- Evaluador es setInterval, NO BullMQ. Si Redis muere, el evaluador sigue vivo.
- Sensores NO bloquean el pipeline (prioridad 1, fire-and-forget).
- Contadores se acumulan en memoria, flush a Redis cada 60s (1 round-trip).
- Ring buffer en memoria (~20KB), NO disco.
- Mapa de dependencias: no alertar por WA cuando WA es lo que cayó.
- `reflexBus` es EventEmitter interno del módulo para comunicación sensor→evaluador.
- API routes se populan en init() mutando manifest.console.apiRoutes (patrón estándar).
