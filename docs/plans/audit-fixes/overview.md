# OVERVIEW — Audit Fixes (Codebase)
**Fuente**: `MEJORAS-LUNA-AUDIT.md`
**Scope**: Solo codebase. Excluye items de servidor (S1-S6).

---

## Items en scope

| ID | Descripción | Plan | Prioridad |
|----|-------------|------|-----------|
| B1 | HITL SQL type mismatch en `handoff.ts` | Plan 1 | Critica |
| B2 | Buffer compression threshold imposible | Plan 1 | Critica |
| B3 | Image prompt key mismatch (archivo faltante) | Plan 1 | Media |
| Q1 | Luna ignora descripciones de imágenes en respuestas | Plan 1 | Media |
| L1 | ExecutionQueue código muerto | Plan 1 | Baja |
| L2 | Config store keys huérfanas | Plan 1 | Baja |
| B4 | HITL tickets no auto-expiran (job probablemente no registrado) | Plan 2 | Critica |
| B5 | HITL interceptor matchea por sender_id (bloquea conversaciones) | Plan 2 | Critica |
| B6 | Gmail módulo usa tabla OAuth separada, nunca arranca | Plan 3 | Alta |
| Q4 | Sin retry para pipelines reactivos (Phases 1→agentic) | Plan 4 | Media |

## Items excluidos

| ID | Razón |
|----|-------|
| S1-S6 | Server/infra — fuera de scope |
| Q2 | Guardrails ya correcto en el repo (34 líneas). El lab deployment tiene una copia vieja — es un tema operacional |
| Q3 | Knowledge chunking de precios es un problema de formato del documento, no de código. El chunker funciona correctamente. Fix: re-subir el documento como spreadsheet (1 fila = 1 chunk con tratamiento+precio+descripción) |

---

## Estructura de planes

### Plan 1: Quick Fixes & Cleanup
**Items**: B1, B2, B3, Q1, L1, L2
**Esfuerzo**: ~1.5h
**Riesgo**: Bajo (cambios puntuales, sin rediseño)

### Plan 2: HITL Quote-Based Redesign
**Items**: B4, B5
**Esfuerzo**: ~3h
**Riesgo**: Medio (reescritura del interceptor, nuevo flujo)

### Plan 3: Gmail OAuth Unification
**Items**: B6
**Esfuerzo**: ~1.5h
**Riesgo**: Medio (elimina path standalone, cambia dependencias)

### Plan 4: Pipeline Retry
**Items**: Q4
**Esfuerzo**: ~2h
**Riesgo**: Medio (nuevo mecanismo, guards contra doble-delivery)

---

## Estrategia de ejecución

```
┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐
│  Plan 1  │  │  Plan 2  │  │  Plan 3  │  │  Plan 4  │
│  Quick   │  │  HITL    │  │  Gmail   │  │ Pipeline │
│  Fixes   │  │ Redesign │  │  OAuth   │  │  Retry   │
└──────────┘  └──────────┘  └──────────┘  └──────────┘
     ↓              ↓              ↓              ↓
   PARALELO — Los 4 planes son 100% independientes
```

**Cero dependencias entre planes.** Cada uno toca archivos distintos:
- Plan 1: handoff.ts, buffer-compressor.ts, memory/manifest.ts, prompts, execution-queue.ts
- Plan 2: message-interceptor.ts, notifier.ts, types.ts, ticket-store.ts, follow-up-job.ts, manifest.ts (hitl)
- Plan 3: gmail/manifest.ts, gmail/email-oauth.ts, gmail/CLAUDE.md
- Plan 4: engine/engine.ts

### Coordinación de migraciones SQL
Plans 2 y 3 necesitan migraciones SQL. El squash migration está en progreso.
**Regla**: cada ejecutor verifica el número más alto en `src/migrations/` al momento de ejecución y usa el siguiente disponible. Si dos ejecutores corren en paralelo, el segundo ajusta su número al hacer merge.

---

## Verificación post-ejecución

Después de que todos los planes estén completos:
1. `docker run --rm -v /docker/luna-repo:/app -w /app node:22-alpine npx tsc --noEmit` — compilación limpia
2. Revisar que todos los CLAUDE.md afectados estén actualizados
3. Verificar que no hay imports cruzados entre módulos
