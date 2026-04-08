# LUNA — Deuda Técnica

Registro centralizado de deuda técnica identificada. Cada entrada tiene contexto, impacto y propuesta.

---

## DT-001: Engine channel-aware hardcoded

**Identificado**: 2026-04-06 (sesión review-pinza)

**Problema**: El engine tiene lógica hardcoded por nombre de canal en varios puntos:

| Qué | Dónde |
|-----|-------|
| Email triage gate (`=== 'email'`) | `src/engine/engine.ts:286` |
| Email bypass business hours | `src/engine/proactive/guards.ts:94` |
| Output formatter (switch por canal) | `src/engine/utils/message-formatter.ts:17` |
| Attachment capabilities (tabla estática) | `src/engine/attachments/types.ts:33` |
| Channel format defaults hardcoded | `src/engine/prompts/channel-format.ts:9` |
| Channel categories hardcoded | `src/engine/prompts/channel-format.ts:15` |

**Impacto**: Agregar un canal nuevo requiere modificar código del engine en múltiples archivos. Rompe el principio de que el engine es agnóstico del canal.

**Propuesta**: Abstraer toda la lógica channel-specific al `channel-config:` service (que ya existe y ya maneja rate limits, session timeout, history turns, etc.). Cada canal declararía sus capacidades, formato de output, triage rules, y business hours policy en su propio manifest. El engine consultaría el servicio en vez de tener switches/ifs por nombre.

**Referencia**: La mayoría del config per-channel ya usa el patrón correcto (`channel-config:{name}` → 11 call sites). Solo faltan los 6 puntos hardcoded listados arriba.

---

## DT-002: trace_id NULL en llm_usage

**Identificado**: 2026-04-08 (beta-hardening audit)

**Problema**: La tabla `llm_usage` registra llamadas LLM pero el campo `trace_id` queda NULL en muchos registros. Esto dificulta correlacionar costos LLM con pipelines específicos y contactos.

**Impacto**: Observabilidad. No afecta operación ni clientes. Impide análisis de costos por conversación/contacto.

**Propuesta**: Pasar `traceId` desde el contexto del pipeline al usage tracker en cada llamada al LLM gateway.

---

## DT-003: Métricas vacías en messages

**Identificado**: 2026-04-08 (beta-hardening audit)

**Problema**: La tabla `messages` tiene columnas de métricas (tokens, latencia, modelo) que quedan vacías o NULL en muchos registros. Los datos se persisten en `pipeline_logs` pero no se propagan a `messages`.

**Impacto**: Observabilidad. No afecta operación ni clientes. Impide dashboards de rendimiento por mensaje.

**Propuesta**: Al finalizar el pipeline, copiar métricas relevantes de `pipeline_logs` al registro correspondiente en `messages`.

---

## DT-004: Constantes hardcodeadas que deberían ser configSchema

**Identificado**: 2026-04-08 (auditoría beta-hardening)

**Problema**: Múltiples constantes hardcodeadas donde la política del proyecto requiere configurabilidad:

| Constante | Archivo | Valor |
|-----------|---------|-------|
| `DEDUP_MEMORY_MAX` | engine.ts | 10,000 |
| `DEDUP_TTL` | engine.ts | 300,000ms |
| `DEFAULT_LOCK_TIMEOUT_MS` | contact-lock.ts | 150,000ms |
| `DRAIN_TIMEOUT_MS` | engine.ts | 30,000ms |
| `SYSTEM_MAX_MESSAGES_PER_HOUR` | delivery.ts | 20 |
| `INTER_CHUNK_DELAY_MS` | delivery.ts | 1,500ms |

**Impacto**: Bajo — los defaults son razonables. Violan el espíritu de la regla de configuración distribuida.

**Propuesta**: Mover a configSchema del módulo engine con helpers `numEnv()`/`numEnvMin()`.

---

## DT-005: llm-client.ts backoff fijo (no exponencial)

**Identificado**: 2026-04-08 (auditoría beta-hardening)

**Problema**: `src/engine/utils/llm-client.ts:147` usa `setTimeout(r, 1000)` fijo entre reintentos en lugar de exponencial como el gateway principal.

**Impacto**: Bajo — esta ruta solo se usa cuando el módulo LLM no está activo.

**Propuesta**: Usar `Math.min(1000 * Math.pow(2, attempt), 30_000)`.

---

## DT-006: precloseTimers Map sin cleanup periódico

**Identificado**: 2026-04-08 (auditoría beta-hardening)

**Problema**: `src/modules/whatsapp/manifest.ts` — el Map `precloseTimers` acumula entradas para contactos inactivos. Se limpia en `stop()` pero no tiene TTL ni sweep.

**Impacto**: Bajo — en contenedores de larga duración, puede acumular miles de entradas muertas (~100 bytes c/u).

**Propuesta**: Sweep periódico cada hora eliminando timers expirados.

---

## DT-007: AVISO field names confusos (_MS almacena minutos)

**Identificado**: 2026-04-08 (auditoría beta-hardening)

**Problema**: `WHATSAPP_AVISO_TRIGGER_MS` almacena minutos, no millisegundos. La conversión está en `buildChannelConfig` (×60000) pero el nombre es misleading.

**Impacto**: Confusión para desarrolladores.

**Propuesta**: Renombrar a `WHATSAPP_AVISO_TRIGGER_MIN` (requiere migración de config).

---

## DT-008: Migration 025 sin IF EXISTS guards

**Identificado**: 2026-04-08 (auditoría beta-hardening)

**Problema**: `src/migrations/025_trace-rename-phases.sql` renombra columnas sin `IF EXISTS` — falla si se ejecuta en DB sin las columnas originales.

**Impacto**: Bajo — solo afecta DBs que saltaron migraciones intermedias.

**Propuesta**: Agregar guards condicionales al SQL.

---

## DT-009: console/server.ts usa res.writeHead (29 instancias)

**Identificado**: 2026-04-08 (auditoría beta-hardening)

**Problema**: `src/modules/console/server.ts` usa `res.writeHead()` + `res.end()` en respuestas JSON en vez del helper `jsonResponse()` del kernel.

**Impacto**: Inconsistencia — las respuestas HTML/CSS/JS son correctas así, pero las JSON deberían usar el helper.

**Propuesta**: Migrar respuestas JSON a `jsonResponse()`.

---

## DT-010: Import directo entre módulos (engine → prompts)

**Identificado**: 2026-04-08 (auditoría beta-hardening)

**Problema**: `src/engine/prompts/agentic.ts:70` importa `loadSystemPrompt` y `renderTemplate` directamente de `../../modules/prompts/template-loader.js`.

**Impacto**: Viola la regla de comunicación via hooks/services.

**Propuesta**: Exponer como servicio del registry en el módulo prompts.

---

## DT-011: Orphan recovery pipeline_log matching por sesión, no por mensaje

**Identificado**: 2026-04-08 (auditoría beta-hardening)

**Problema**: `orphan-recovery.ts` excluye un mensaje si CUALQUIER pipeline_log reciente existe para esa sesión. Si un contacto envía msg1 y msg2, y msg2 se procesa pero msg1 no, msg1 nunca se reintenta.

**Impacto**: Medio — mensajes huérfanos en sesiones con múltiples mensajes rápidos podrían perderse.

**Propuesta**: Cambiar query a matchear por message_id específico en vez de session_id.
