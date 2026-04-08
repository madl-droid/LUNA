# OVERVIEW — Beta Hardening

## Contexto
Preparación para pruebas BETA con clientes reales. Se consolidaron 3 fuentes de bugs (LAB-audit-code.md, QA-code-2025-04-07.md, análisis profundo de código) resultando en ~61 fixes organizados en 9 planes paralelos. Post-ejecución, se identificaron items adicionales organizados en 3 planes nuevos (10-12).

## Fuentes de bugs
1. `docs/reports/LAB-audit-code.md` — 19 bugs + 9 pendientes de pruebas E2E con contactos reales
2. `docs/reports/QA-code-2025-04-07.md` — 5 bugs + 4 pendientes de revisión de código QA
3. Análisis profundo de código — ~50 bugs adicionales organizados en 3 bloques de prioridad
4. Auditoría post-ejecución — legacy code, gaps de seguridad, bugs de UI

## Planes de ejecución

### Ronda 1 — Completada (61 fixes, 9 planes)

| # | Plan | Items | Estado |
|---|------|-------|--------|
| **01** | WhatsApp Channel Hardening | 10 | COMPLETADO |
| **02** | Engine Pipeline Core | 8 | COMPLETADO |
| **03** | Memory, Data Integrity & Redis | 9 | COMPLETADO |
| **04** | LLM Gateway Hardening | 8 | COMPLETADO |
| **05** | Criticizer, Post-Processor & Loop Detection | 5 | COMPLETADO |
| **06** | Knowledge & Training | 4 | COMPLETADO |
| **07a** | Scheduled Tasks & Proactive | 5 | COMPLETADO |
| **07b** | Cross-Module Fixes (HITL, Users, Medilink, SQL) | 6 | COMPLETADO |
| **08** | Prompts, Guardrails & Skills | 6 | COMPLETADO |

### Ronda 2 — Pendiente (3 planes)

| # | Plan | Items | Archivos principales | Prioridad |
|---|------|-------|---------------------|-----------|
| **10** | Legacy Cleanup | 6 | `src/engine/checkpoints/`, `src/engine/engine.ts`, `src/engine/types.ts`, ~14 archivos con comentarios Phase | LOW |
| **11** | Operational Fixes | 4 | `src/modules/knowledge/manifest.ts`, `src/modules/whatsapp/adapter.ts`, `src/modules/medilink/security.ts` | HIGH |
| **12** | UI / Console Fixes | 1 | `src/modules/console/templates-section-channels.ts` | MEDIUM |
| **13a** | Quick Fixes (Drive, TTS, Embedding UI, Voice) | 4 | `src/modules/knowledge/item-manager.ts`, `src/modules/tts/tts-service.ts`, `src/modules/knowledge/console-section.ts`, `src/modules/twilio-voice/call-manager.ts` | MEDIUM |
| **13b** | Medilink: Agendamiento para Terceros | 6 | `src/modules/medilink/types.ts`, `security.ts`, `tools.ts`, `working-memory.ts`, `manifest.ts`, skill prompt | HIGH |

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

### Legacy cleanup → Plan 10
Movido a plan-10.md: checkpoint system, Phase 2/3/4 comments, composeRetriesPerProvider, trace_results columns, _msPerChar, ENGINE_MODE docs.

### Items resueltos (ya no necesitan fix)
- ~~PEND-01 Google provider timeout~~ → FIXED en Plan 04 (Promise.race)
- ~~VER-03 Session drain on shutdown~~ → FIXED en Plan 02 (30s graceful drain)
- ~~BUG-14/15 Google Chat~~ → Código robusto, sin bugs confirmados
- ~~Criticizer prompt~~ → FIXED en Plan 05 (4 criterios objetivos, JSON parsing, threshold 6)
- ~~HITL message structure~~ → FIXED en Plan 07b (contacto, ticket ID, contexto, handoff)

## Métricas de éxito — Ronda 1

Después de aplicar los 9 planes:
- **0 mensajes perdidos** por retry failures, fire-and-forget, o reconexión
- **0 respuestas duplicadas** por dedup, lock alignment, o orphan race
- **0 bot colgado** por timeouts reales en todos los providers
- **0 tool calls expuestos** al usuario
- **Criticizer funcional** con tasa de aprobación > 0%
- **Knowledge filtrado** por tipo de contacto (search_knowledge)
- **Loop detection** con escalamiento automático a HITL
- **Circuit breaker funcional** en half-open state

## Métricas de éxito — Ronda 2

Después de planes 10-12:
- **0 código muerto** del pipeline legacy de 5 fases
- **expand_knowledge** respeta filtro de categorías por tipo de contacto (gap de seguridad cerrado)
- **WhatsApp flush** con rate limiting (200ms entre mensajes)
- **Medilink lead→patient** limpia flag y dispara hook
- **Calendar settings** accesible desde Google Apps card en cualquier estado

## Métricas de éxito — Ronda 3

Después de planes 13a-13b:
- **Drive scan** pagina carpetas con >100 archivos
- **TTS** con circuit breaker (5 fallas → 5 min cooldown), timeout 30s, validación de modelo
- **Embedding progress** visible en tiempo real en consola (polling cada 3s)
- **Voice inbound** rate limit por número (default 10/hora)
- **Medilink terceros** — contacto puede agendar para hijos, padres, pareja; datos persistidos en agent_data; reagendamiento con memoria de relación
