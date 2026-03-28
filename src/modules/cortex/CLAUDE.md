# Cortex — Sistema nervioso de LUNA

Módulo de monitoreo y alertas en tiempo real. Feature principal: **Reflex** — detecta problemas y alerta al admin antes de perder leads. 100% código, cero LLM.

## Archivos
- `manifest.ts` — lifecycle, configSchema, console, API routes, render section
- `types.ts` — Alert, Rule, CounterSet, HealthStatus, CortexConfig
- `reflex/sensors.ts` — hook listeners que alimentan contadores + ring buffer
- `reflex/counters.ts` — contadores in-memory con flush periódico a Redis
- `reflex/ring-buffer.ts` — buffer circular de logs WARN/ERROR (~20KB)
- `reflex/rules.ts` — 13 reglas: 6 critical, 5 degraded, 2 info
- `reflex/evaluator.ts` — setInterval tri-frecuencia (60s/5m/15m), NO BullMQ
- `reflex/alert-manager.ts` — state machine: triggered/resolved/escalated + anti-flapping
- `reflex/dispatcher.ts` — despacho multi-canal + mapa dependencias + silencio programado
- `reflex/health.ts` — health check enriquecido (PG, Redis, WA, email, BullMQ, CBs)
- `reflex/metrics-store.ts` — lectura/escritura estructurada de métricas Redis

## Manifest
- **type**: `feature`
- **depends**: `[]` (sin dependencias duras, monitorea lo que exista)
- **configSchema**: `CORTEX_REFLEX_*` (intervalos, umbrales, canales, Telegram, silencio)

## Servicios expuestos
- `cortex:health` — `{ check(), getActiveAlerts(), getAlertHistory(limit?), getMetrics() }`
- `cortex:renderSection` — `(lang) => Promise<string>` dashboard HTML para console

## API routes (bajo /console/api/cortex/)
- `GET health` — health check completo (status, components, pipeline, circuit breakers)
- `GET alerts/active` — alertas activas
- `GET alerts/history` — historial de alertas (7 días)
- `GET metrics` — métricas actuales (pipeline, LLM, tools, hourly)

## Reglas (13 total)
- **6 críticas** (checks directos): PG, Redis, WA, memoria, disco, event loop
- **5 degraded** (métricas): circuit breaker, BullMQ queue, latencia, tools, email OAuth
- **2 info** (acumuladas): leads sin respuesta, tasa fallback alta

## Alert lifecycle
- `triggered` → `resolved` (condición desaparece)
- `triggered` → `escalated` (DEGRADADO sin resolver >15 min → re-enviar como CRÍTICO)
- Anti-flapping: resolve+re-trigger <5 min → agrupa como "inestable"
- Dedup: misma regla máx 1 alerta cada 5 min
- Silencio: INFO silenciadas 23:00-07:00 (configurable). CRÍTICO siempre pasa.

## Trampas
- Evaluador es setInterval, NO BullMQ. Si Redis muere, el evaluador sigue vivo.
- Sensores NO bloquean el pipeline (prioridad 1, fire-and-forget).
- Contadores se acumulan en memoria, flush a Redis cada 60s (1 round-trip).
- Ring buffer en memoria (~20KB), NO disco.
- Mapa de dependencias: no alertar por WA cuando WA es lo que cayó.
- `reflexBus` es EventEmitter interno del módulo para comunicación sensor→evaluador.
- API routes se populan en init() mutando manifest.console.apiRoutes (patrón estándar).
- Health snapshot se escribe a Redis cada 60s para consumo por dashboard/Pulse.
