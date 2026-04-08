# OVERVIEW — Beta Hardening

## Contexto
Preparación para pruebas BETA con clientes reales. Se consolidaron 3 fuentes de bugs (LAB-audit-code.md, QA-code-2025-04-07.md, análisis profundo de código) resultando en ~61 fixes organizados en 9 planes paralelos.

## Fuentes de bugs
1. `docs/reports/LAB-audit-code.md` — 19 bugs + 9 pendientes de pruebas E2E con contactos reales
2. `docs/reports/QA-code-2025-04-07.md` — 5 bugs + 4 pendientes de revisión de código QA
3. Análisis profundo de código — ~50 bugs adicionales organizados en 3 bloques de prioridad

## Planes de ejecución

| # | Plan | Items | Archivos principales | Prioridad |
|---|------|-------|---------------------|-----------|
| **01** | WhatsApp Channel Hardening | 10 | `src/modules/whatsapp/adapter.ts`, `src/channels/message-batcher.ts`, `src/modules/whatsapp/manifest.ts` | CRITICAL |
| **02** | Engine Pipeline Core | 8 | `src/engine/engine.ts`, `src/engine/concurrency/contact-lock.ts`, `src/engine/agentic/agentic-loop.ts`, `src/engine/proactive/orphan-recovery.ts` | CRITICAL |
| **03** | Memory, Data Integrity & Redis | 9 | `src/modules/memory/*`, `src/kernel/redis.ts`, `src/modules/llm/usage-tracker.ts` | CRITICAL |
| **04** | LLM Gateway Hardening | 8 | `src/modules/llm/circuit-breaker.ts`, `src/modules/llm/providers.ts`, `src/modules/llm/llm-gateway.ts`, `src/modules/llm/pg-store.ts`, `src/engine/utils/llm-client.ts` | CRITICAL/HIGH |
| **05** | Criticizer, Post-Processor & Loop Detection | 5 | `src/engine/agentic/post-processor.ts`, `src/engine/agentic/tool-dedup-cache.ts`, `instance/prompts/system/criticizer*.md` | HIGH |
| **06** | Knowledge & Training | 4 | `src/modules/knowledge/*`, `src/extractors/youtube-adapter.ts` | HIGH |
| **07a** | Scheduled Tasks & Proactive | 5 | `src/modules/scheduled-tasks/*`, `src/engine/proactive/proactive-runner.ts` | HIGH |
| **07b** | Cross-Module Fixes (HITL, Users, Medilink, SQL) | 6 | `src/modules/hitl/*`, `src/modules/users/*`, `src/modules/medilink/*` | HIGH |
| **08** | Prompts, Guardrails & Skills | 6 | `instance/prompts/system/*` (solo texto, sin código) | MEDIUM |

## Estrategia de ejecución

```
┌─────────────────────────────────────────────────────────────────┐
│                    TODOS EN PARALELO                            │
│                                                                 │
│  Plan 01 (WhatsApp)     Plan 02 (Engine)     Plan 03 (Memory)  │
│  Plan 04 (LLM)          Plan 05 (Criticizer)  Plan 06 (Knowledge)│
│  Plan 07a (Scheduled)   Plan 07b (Cross-Mod)  Plan 08 (Prompts) │
│                                                                 │
│  Sin overlap de archivos entre planes.                          │
│  Cada ejecutor trabaja en su propio branch derivado.            │
└─────────────────────────────────────────────────────────────────┘
```

**Sin dependencias entre planes.** Se verificó que ningún plan toca archivos de otro. Los 9 pueden correr simultáneamente.

## Protocolo de verificación (obligatorio en cada plan)

Cada plan incluye un paso 0 de verificación:
1. El ejecutor DEBE leer cada archivo target y confirmar que el bug existe en la ubicación indicada
2. Si la ubicación difiere, buscar la real y documentar
3. Si el bug no existe (falso positivo), reportar y saltar ese item
4. NO hacer fixes ciegos basados solo en la descripción del plan

## Correcciones de paths conocidas

Los reportes originales tenían paths incorrectos. Ya están corregidos en los planes:
| Reportado como | Path real |
|----------------|-----------|
| `src/modules/whatsapp/message-batcher.ts` | `src/channels/message-batcher.ts` |
| `src/engine/agentic/orphan-recovery.ts` | `src/engine/proactive/orphan-recovery.ts` |
| `src/modules/llm/llm-client.ts` | `src/engine/utils/llm-client.ts` |
| `src/modules/whatsapp/proactive-runner.ts` | `src/engine/proactive/proactive-runner.ts` |
| F5 SQL interpolation en `memory/pg-store.ts` | `src/modules/llm/pg-store.ts:117` |

## Items diferidos (fuera de scope de beta-hardening)

### Enhancements (no son bugs)
- **QA BUG-3**: UI progress para embedding (mejora UX)
- **BUG-16**: trace_id NULL en llm_usage (observabilidad)
- **BUG-17**: Métricas vacías en messages (observabilidad)
- **PEND-01**: Flujo menores de edad Medilink (feature nueva)
- **PEND-04**: Columnas legacy en pipeline_logs (cleanup)

### Bloque 3 (baja prioridad)
G3-G19 del análisis profundo (~17 items). No causan incidentes con volumen moderado.

### Legacy cleanup (plan separado futuro)
- Comentarios "5-phase pipeline" en engine.ts y types.ts
- Phase 2/3/4 type definitions (solo usados por checkpoints legacy)
- Checkpoint system entero (código muerto en agentic mode)
- `ENGINE_MODE` toggle (riesgo de activar legacy accidentalmente)
- Columnas `phase2_ms`, `phase3_ms`, `phase4_ms` en pipeline_logs

## Métricas de éxito

Después de aplicar los 9 planes:
- **0 mensajes perdidos** por retry failures, fire-and-forget, o reconexión
- **0 respuestas duplicadas** por dedup, lock alignment, o orphan race
- **0 bot colgado** por timeouts reales en todos los providers
- **0 tool calls expuestos** al usuario
- **Criticizer funcional** con tasa de aprobación > 0%
- **Knowledge filtrado** por tipo de contacto
- **Loop detection** con escalamiento automático a HITL
- **Circuit breaker funcional** en half-open state
