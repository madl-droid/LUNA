# Cortex — Sistema nervioso de LUNA

Módulo con tres features: **Reflex** (alertas tiempo real, 0 LLM), **Pulse** (análisis inteligente, usa LLM), y **Alter-ego** (simulación y testing del pipeline).

## Archivos
- `manifest.ts` — lifecycle, configSchema, console, API routes, render section
- `types.ts` — Alert, Rule, CounterSet, HealthStatus, CortexConfig, PulseConfig, PulseReport
- `reflex/sensors.ts` — hook listeners que alimentan contadores + ring buffer
- `reflex/counters.ts` — contadores in-memory con flush periódico a Redis
- `reflex/ring-buffer.ts` — buffer circular de logs WARN/ERROR (~20KB)
- `reflex/rules.ts` — 13 reglas: 6 critical, 5 degraded, 2 info
- `reflex/evaluator.ts` — setInterval tri-frecuencia (60s/5m/15m), NO BullMQ
- `reflex/alert-manager.ts` — state machine: triggered/resolved/escalated + anti-flapping
- `reflex/dispatcher.ts` — despacho multi-canal + mapa dependencias + silencio programado
- `reflex/health.ts` — health check enriquecido (PG, Redis, WA, email, BullMQ, CBs)
- `reflex/metrics-store.ts` — lectura/escritura estructurada de métricas Redis
- `pulse/collector.ts` — recolecta y cura datos de Reflex para LLM (~4-8K tokens)
- `pulse/analyzer.ts` — llama LLM con datos curados, produce PulseReport estructurado
- `pulse/formatter.ts` — formatea reportes para canales admin (WhatsApp, Telegram, email)
- `pulse/store.ts` — tabla pulse_reports (PostgreSQL JSONB), CRUD
- `pulse/scheduler.ts` — scheduling batch/sync + triggers inmediatos
- `pulse/dispatch-bridge.ts` — bridge a canales de Reflex para envío de notificaciones
- `alter-ego/types.ts` — tipos del subsistema de simulación
- `alter-ego/store.ts` — 3 tablas: scenarios, runs, results (PostgreSQL CRUD)
- `alter-ego/context-builder.ts` — construye ContextBundle desde DB real (read-only) o sintético
- `alter-ego/tool-sandbox.ts` — clasificación read/write de tools + ejecución híbrida
- `alter-ego/simulator.ts` — ejecuta 1 simulación: Shadow Phase 2+3+4
- `alter-ego/analyst.ts` — LLM Analyst: analiza cada simulación individual
- `alter-ego/synthesizer.ts` — LLM Synthesizer: análisis agregado de N simulaciones
- `alter-ego/runner.ts` — orquestador con semáforo de concurrencia
- `alter-ego/render.ts` — sección HTML para console

## Manifest
- **type**: `feature`
- **depends**: `[]` (sin dependencias duras, monitorea lo que exista)
- **configSchema**: `CORTEX_REFLEX_*` + `CORTEX_PULSE_*` + `CORTEX_ALTER_EGO_*`

## Servicios expuestos
- `cortex:health` — `{ check(), getActiveAlerts(), getAlertHistory(limit?), getMetrics() }`
- `cortex:renderSection` — `(lang) => Promise<string>` dashboard HTML para console
- `cortex:pulse` — `{ getScheduler(), onAlertChange(rule, severity, state, flapCount) }`
- `cortex:alter-ego` — `{ isRunActive(), launchRun(req) }`

## API routes (bajo /console/api/cortex/)
- `GET health` — health check completo
- `GET alerts/active` — alertas activas
- `GET alerts/history` — historial de alertas (7 días)
- `GET metrics` — métricas actuales
- `GET pulse/reports` — lista reportes Pulse (?limit, ?offset)
- `GET pulse/reports/:id` — reporte individual
- `GET pulse/status` — estado del scheduler Pulse
- `GET alter-ego/scenarios` — listar escenarios
- `POST alter-ego/scenarios` — crear escenario
- `GET alter-ego/scenarios/:id` — detalle escenario
- `PUT alter-ego/scenarios/:id` — actualizar escenario
- `DELETE alter-ego/scenarios/:id` — eliminar escenario
- `POST alter-ego/run` — lanzar simulación
- `GET alter-ego/runs` — listar runs
- `GET alter-ego/runs/:id` — detalle run + progress + synthesis
- `POST alter-ego/runs/:id/cancel` — cancelar run
- `DELETE alter-ego/runs/:id` — eliminar run
- `GET alter-ego/runs/:id/results` — resultados individuales
- `GET alter-ego/runs/:id/results/:resultId` — resultado individual

## Pulse — Análisis inteligente
- **Dependencia**: lee datos que Reflex acumula. Si Reflex no corre, Pulse no tiene datos.
- **Modos**: batch (reporte diario, genera 2AM, entrega 7AM) o sync (cada N horas).
- **Triggers inmediatos**: 3+ críticas distintas en 1h, o flapping >60 min.
- **LLM**: Haiku por defecto, escala a Sonnet con 5+ incidentes. Fallback chain estándar.
- **Si período quiet** (0 errores, 0 alertas): NO llama al LLM, genera reporte estático.
- **Persistencia**: tabla `pulse_reports` con JSONB. Sin TTL — historial permanente.
- **Entrega**: mismos canales que Reflex (Telegram, WhatsApp, email).

## Alter-ego — Simulación y testing
- **Shadow Pipeline**: NO usa processMessage(). Importa buildEvaluatorPrompt + buildCompositorPrompt directamente.
- **Tool sandbox**: tools read se ejecutan real (datos fieles), tools write son dry-run (seguras).
- **Prompt overrides**: per-request via Proxy de registry (NUNCA toca prompt_slots global).
- **Analyst + Synthesizer**: LLM con thinking analiza cada simulación y genera reporte agregado.
- **3 tablas**: alter_ego_scenarios, alter_ego_runs, alter_ego_results (migration 010).
- **Concurrencia**: semáforo simple (configurable CORTEX_ALTER_EGO_MAX_CONCURRENT, default 3).

## Trampas
- Evaluador Reflex es setInterval, NO BullMQ. Si Redis muere, sigue vivo.
- Sensores NO bloquean pipeline (prioridad 1, fire-and-forget).
- Ring buffer en memoria (~20KB), NO disco.
- Pulse usa setInterval para checks periódicos, NO BullMQ.
- Pulse NO envía reportes vacíos al LLM — usa `isQuietPeriod()`.
- `dispatch-bridge.ts` NO aplica silence window — reportes Pulse siempre se entregan.
- API routes se populan en init() mutando manifest.console.apiRoutes.
- Alter-ego simulator NUNCA llama processMessage() — usa prompt builders directamente.
- Tool sandbox clasifica por regex de nombre: search_*/get_* = execute, send_*/create_* = dry-run.
- Prompt overrides son per-request (Proxy), NUNCA modifican prompt_slots en DB.
- Si Alter-ego está disabled, sus tablas NO se crean y las API routes retornan 400.
