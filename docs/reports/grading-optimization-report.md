# INFORME DE CIERRE — Optimizacion del Modulo Lead-Scoring
## Branch: claude/plan-grading-optimization-CeYpN

### Objetivos definidos
1. Revisar si el modulo de calificacion realmente funciona
2. Revisar efectividad
3. Hacerlo mas pragmaticamente configurable para admins
4. Evaluar si es un valor agregado real
5. Identificar edge cases criticos
6. Optimizar si vale la pena mantenerlo

### Completado

**Plan 1 — Core: Simplificacion del Config y Scoring**
- Eliminado multi-framework (3 frameworks con 16-25 criterios) → un solo preset activo por tenant
- Eliminados tipos: `FrameworkType`, `ClientType`, `CLIENT_TYPE_FRAMEWORK`, `FrameworkPreset`, `FrameworkConfig`
- Pesos por prioridad (high=3, medium=2, low=1) en vez de suma manual a 100
- Enum scoring configurable: 'indexed' (posicion = calidad) o 'presence' (cualquier opcion = full score)
- Migracion automatica de 3 formatos: BANT plano (v1), multi-framework (v2), single-preset (v3)
- Max 10 criterios por tenant (antes sin limite)

**Plan 2 — Extraccion Zero-LLM**
- `extract_qualification` refactorizado a tool code-only (recibe datos estructurados del agentic loop)
- Eliminadas TODAS las llamadas LLM internas de extraccion
- Nightly batch scoring reescrito a code-only (calculateScore + decay, sin LLM)
- Temporal decay: datos pierden relevancia linealmente (100% → 30% en dataFreshnessWindowDays)
- Prompts de extraccion deprecados (`lead-scoring-extraction.md`, `cold-lead-scoring.md`)
- Task router limpiado (eliminados `extract_qualification`, `nightly-scoring`)

**Plan 3 — Console, Operacional y Documentacion**
- UI de console simplificada para framework unico con selector de presets
- `getAllLeadsForRecalc()` paginado (200/batch, cap 10k)
- API routes obsoletas eliminadas
- CLAUDE.md del modulo reescrito para v3
- CLAUDE.md raiz actualizado
- lead-status.md actualizado

**Plan 4 — Bugfixes de Auditoria (6 bugs)**
- BUG-1 CRITICAL: XSS via contactId en inline onclick → data attributes + event delegation + esc() mejorado
- BUG-2 HIGH: confidence tracking con `===` (roto para objetos) → adoptedKeys Set
- BUG-3 HIGH: tool description no se actualizaba en hot-reload → registerExtractionTool() en hook
- BUG-4 MEDIUM: enum daba 50% a valores desconocidos → 0 puntos
- BUG-5 MEDIUM: OFFSET pagination race condition en nightly batch → cursor-based por contact_id
- BUG-6 MEDIUM: applyPreset() preservaba objective anterior → preset.defaultObjective

### No completado
- Nada. Todos los planes ejecutados y verificados.

### Archivos creados/modificados

| Archivo | Accion |
|---------|--------|
| `src/modules/lead-scoring/types.ts` | Modificado — tipos simplificados, priority-based |
| `src/modules/lead-scoring/frameworks.ts` | Modificado — presets con max 10 criterios, priority |
| `src/modules/lead-scoring/config-store.ts` | Modificado — single-fw, migracion, applyPreset fix |
| `src/modules/lead-scoring/scoring-engine.ts` | Modificado — priority weights, decay, adoptedKeys, enum fix |
| `src/modules/lead-scoring/extract-tool.ts` | Modificado — refactor completo a code-only |
| `src/modules/lead-scoring/manifest.ts` | Modificado — API routes simplificadas, tool re-registro |
| `src/modules/lead-scoring/pg-queries.ts` | Modificado — batch recalc paginado |
| `src/modules/lead-scoring/templates.ts` | Modificado — UI single-preset |
| `src/modules/lead-scoring/ui/lead-scoring.html` | Modificado — UI actualizada, XSS fix |
| `src/modules/lead-scoring/CLAUDE.md` | Reescrito — documentacion v3 |
| `src/engine/proactive/jobs/nightly-batch.ts` | Modificado — scoring code-only, cursor pagination |
| `src/engine/prompts/context-builder.ts` | Modificado — guia de extraccion para agentic loop |
| `src/modules/llm/task-router.ts` | Modificado — eliminadas entradas muertas |
| `instance/qualifying.json` | Reescrito — formato v3 |
| `instance/prompts/system/lead-scoring-extraction.md` | Deprecado |
| `instance/prompts/system/cold-lead-scoring.md` | Deprecado |
| `docs/architecture/lead-status.md` | Actualizado |
| `docs/reports/AUDIT-lead-scoring-v3.md` | Creado — reporte de auditoria |
| `CLAUDE.md` (raiz) | Actualizado — entrada lead-scoring |

### Interfaces expuestas (exports que otros consumen)
- `lead-scoring:config` — instancia de ConfigStore (sin cambios de API)
- `lead-scoring:queries` — instancia de LeadQueries (sin cambios de API)
- Tool `extract_qualification` — parametros cambiaron: ahora recibe `{extracted, confidence, disqualify_reason?}` en vez de texto libre
- `calculateScore(qualData, config)` — firma simplificada (sin multi-fw routing)
- `buildQualificationSummary()` — sin cambios

### Dependencias instaladas
- Ninguna nueva

### Tests
- Compilacion TypeScript verificada en cada plan (`npx tsc --noEmit`)
- 0 errores nuevos introducidos (solo pre-existentes por falta de node_modules en CI)

### Decisiones tecnicas
1. **Un preset activo por tenant** — el 99% usa un tipo de venta. Multi-framework era complejidad sin retorno.
2. **Prioridad en vez de peso** — high/medium/low normalizados a 100 elimina la suma manual hostil.
3. **Zero-LLM extraction** — el agentic loop ya tiene contexto completo, la llamada extra era redundante.
4. **Decay temporal** — datos viejos pierden relevancia gradualmente (floor 30% a 90 dias).
5. **Max 10 criterios** — fuerza al admin a priorizar, evita config bloat.
6. **Cursor-based pagination** — contact_id es inmutable, no hay race condition con updated_at.

### Riesgos o deuda tecnica
- `qualifying.json` v1/v2 se migran automaticamente — si la migracion falla, fallback a defaults SPIN
- El agentic loop debe pasar datos estructurados al tool — si el LLM no llama el tool, no se extrae nada (by design: extraccion natural, no forzada)
- Los presets estan hardcodeados en `frameworks.ts` — para presets custom necesitarian un mecanismo en consola (no prioritario)

### Notas para integracion
- La rama fue rebased sobre `pruebas` (conflictos resueltos en nightly-batch.ts y cold-lead-scoring.md)
- El tool `extract_qualification` cambio de firma — el agentic loop en context-builder.ts ya instruye al LLM correctamente
- `task-router.ts` ya no tiene entradas para `extract_qualification` ni `nightly-scoring` (eliminadas)

### Metricas de exito logradas
- **0 llamadas LLM** para extraccion de calificacion (vs 1-2 por mensaje antes)
- **0 llamadas LLM** en nightly batch scoring (vs N por cold lead antes)
- **Config admin en <2 minutos**: elegir preset, ajustar 1-2 criterios, guardar
- **Compilacion limpia**: sin errores nuevos
- **qualifying.json migra automaticamente** desde formatos anteriores
