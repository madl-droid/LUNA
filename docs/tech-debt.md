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
