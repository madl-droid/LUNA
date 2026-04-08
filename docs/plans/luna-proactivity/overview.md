# OVERVIEW — Mejora de Proactividad LUNA

## Objetivo
Hacer que la proactividad de LUNA sea eficiente, predecible y funcional: compromisos que se cumplen, seguimientos inteligentes, scheduled-tasks simplificado, y bugs críticos resueltos.

## Decisiones de diseño tomadas
1. **No crear módulo nuevo** — la proactividad es parte del engine (`src/engine/proactive/`), no un módulo separado. scheduled-tasks sigue como módulo genérico.
2. **Eliminar commitment auto-detector (Via B)** — el agente crea compromisos explícitamente via tool. Ahorra 1 LLM call por respuesta.
3. **Context summary en compromisos** — al crear un compromiso se guarda un resumen de la conversación. Cuando se cumple, el LLM lee ese resumen sin re-cargar historial completo.
4. **Cron presets fijos** — no más cron libre en scheduled-tasks. Dropdown con opciones predefinidas.
5. **Intensidad de seguimiento per-contact** — 4 niveles (aggressive, normal, gentle, minimal) que el scanner respeta.
6. **HITL handoff reasigna compromisos** — cuando un humano dice "yo me encargo", el compromiso se reasigna y Luna hace seguimiento al humano.

## Planes

| Plan | Nombre | Depende de | Paralelizable |
|------|--------|------------|---------------|
| 1 | Bugfixes críticos + robustez | — | Prerequisito, va primero |
| 2 | Commitments overhaul + HITL handoff | Plan 1 | Sí (paralelo con 3 y 4) |
| 3 | Follow-up intensity per-contact | Plan 1 | Sí (paralelo con 2 y 4) |
| 4 | Scheduled-tasks presets + Knowledge console | Plan 1 | Sí (paralelo con 2 y 3) |

## Estrategia de ejecución

```
Plan 1 (secuencial, primero)
  ↓
Plan 2 + Plan 3 + Plan 4 (en paralelo)
```

**Plan 1** debe completarse y mergearse antes de iniciar los demás porque arregla bugs que bloquean el sistema proactivo entero.

**Planes 2, 3, 4** son independientes entre sí y se ejecutan en paralelo desde ramas separadas.

## Archivos clave del sistema (referencia rápida)

### Engine proactivo (`src/engine/proactive/`)
- `proactive-runner.ts` — BullMQ orchestrator
- `proactive-pipeline.ts` — pipeline proactivo (Phase 1 simplified + agentic)
- `proactive-config.ts` — loader de `instance/proactive.json`
- `guards.ts` — 8 guardas de protección
- `smart-cooldown.ts` — cooldown adaptativo
- `commitment-detector.ts` — auto-detect LLM (a eliminar en Plan 2)
- `commitment-validator.ts` — validación de compromisos
- `conversation-guard.ts` — detección de goodbye
- `orphan-recovery.ts` — re-dispatch de mensajes sin respuesta
- `triggers.ts` — definiciones de jobs
- `jobs/follow-up.ts` — scanner de leads inactivos
- `jobs/reminder.ts` — scanner de eventos próximos
- `jobs/commitment-check.ts` — scanner de compromisos vencidos
- `jobs/reactivation.ts` — scanner de leads fríos
- `jobs/nightly-batch.ts` — batch nocturno
- `tools/create-commitment.ts` — tool LLM
- `tools/update-commitment.ts` — tool LLM
- `tools/query-pending-items.ts` — tool LLM

### Engine boundaries y prompts
- `boundaries/delivery.ts` — delivery + commitment auto-detect call (línea 188)
- `prompts/agentic.ts` — prompt builder (proactive branch líneas 107-119, user message líneas 303-344)
- `prompts/context-builder.ts` — pending commitments injection (líneas 159-192)

### Scheduled-tasks (`src/modules/scheduled-tasks/`)
- `manifest.ts` — lifecycle, hooks de eventos, API service
- `scheduler.ts` — BullMQ queue/worker, `scheduleTask()`, `addDelayedJob()`
- `executor.ts` — ejecución LLM + actions
- `api-routes.ts` — CRUD REST
- `templates.ts` — HTML SSR
- `store.ts` — PostgreSQL CRUD
- `types.ts` — interfaces

### Consumidores de scheduled-tasks
- `src/modules/medilink/follow-up-scheduler.ts` — 9-touch follow-up sequence (usa cron dummy)
- `src/modules/google-apps/calendar-followups.ts` — pre/post-meeting follow-ups (usa cron dummy)

### Config
- `instance/proactive.json` — configuración completa del sistema proactivo
- `src/kernel/bootstrap.ts` — creación de directorios de instance/

### Prompts
- `instance/prompts/system/commitment-detector-system.md` — prompt del detector (a eliminar en Plan 2)
- `instance/prompts/system/proactive-agentic-system.md` — prompt proactivo
