# Plan de Consolidación: Memory + Context-Inject + Prompts

## Contexto

Tres branches sobre `pruebas` que implementan sistemas complementarios pero con solapamiento significativo en archivos del engine. **No se pueden hacer git merges directos** — los tres modifican los mismos archivos (engine types, phases 1-5, compositor, evaluator) con enfoques diferentes. La estrategia es integración manual: tomar lo mejor de cada branch y adaptarlo.

## Decisiones arquitectónicas clave

1. **Memory module** = dueño único de los 5 niveles de memoria (Caliente, Tibio, Frío, Archivo, Prospectivo)
2. **Engine** consume memory vía `registry.getOptional('memory:manager')` — nunca SQL directo en fases
3. **Prompts module** = fuente definitiva de prompts (DB + oficina). Archivos en `instance/knowledge/` son solo seed
4. **Token budgets** configurables desde oficina
5. **Fact maintenance**: engine detecta necesidad → invoca memory:manager vía service
6. **Nightly batch (DMN)**: se ejecuta como job registrado por memory module
7. **pgvector**: autorizado, se mantiene para embeddings en session_summaries
8. **Prospectivo (commitments)**: 5to nivel de memoria, siempre inyectado al contexto, nunca purgado

## Orden de ejecución

### Fase 1: Base + Migración unificada

**Objetivo**: Crear rama limpia desde pruebas con schema unificado.

1. Crear branch `claude/review-branch-consolidation-h0IGw` desde `pruebas`
2. Crear migración unificada `docs/migrations/s-consolidation.sql` que combina:
   - Memory phase0: pgvector extension, agents, companies, system_state, pipeline_logs
   - Memory phase1: contacts ALTER, sessions ALTER, messages ALTER, agent_contacts, session_summaries (con vector + FTS), commitments, conversation_archives
   - Prompts: prompt_slots table
   - Campaigns: ALTER con match_phrases, match_threshold, prompt_context
3. **NO incluir** phase3 (DROP columns) — eso es post-deploy, no ahora

**Archivos**:
- `docs/migrations/s-consolidation.sql` (nuevo, ~350 lines)

---

### Fase 2: Memory module

**Objetivo**: Módulo memory v3 completo, dueño de los 5 niveles.

**Copiar desde branch `enhance-memory-system`**:
- `src/modules/memory/manifest.ts` — tal cual
- `src/modules/memory/types.ts` — tal cual (ya define los 5 niveles)
- `src/modules/memory/memory-manager.ts` — tal cual (ya expone todo vía MemoryManager)
- `src/modules/memory/pg-store.ts` — tal cual, pero verificar/corregir:
  - Bug: `searchSummariesVector` no está incluida en `hybridSearch()` — agregar cuando embedding disponible
  - Verificar que `ensureTable()` no entre en conflicto con la migración
- `src/modules/memory/redis-buffer.ts` — tal cual
- `src/modules/memory/CLAUDE.md` — actualizar con 5 niveles

**Adaptar desde branch `enhance-memory-system`**:
- `src/modules/lead-scoring/manifest.ts` — cambios para usar agent_contacts
- `src/modules/lead-scoring/pg-queries.ts` — queries adaptadas
- `src/modules/lead-scoring/extract-tool.ts` — adaptado
- `src/modules/lead-scoring/types.ts` — nuevos tipos

**Servicio expuesto**: `memory:manager` (MemoryManager)

**Verificar**:
- MemoryManager expone todos los CRUD necesarios para los 5 niveles
- commitments (Prospectivo) tiene getOverdueCommitments, getPendingCommitments, getRecentCompleted
- hybridSearch funciona con FTS + recency (vector cuando hay embeddings)

---

### Fase 3: Engine — Context injection

**Objetivo**: Pipeline que carga contexto dinámicamente usando memory:manager, con token budgets.

**Desde branch `dynamic-context-injection`**:

#### 3a. Engine types (`src/engine/types.ts`)
- Tomar la versión de context-inject (más completa)
- Importar tipos de memory module: `import type { ContactMemory, Commitment, ... } from '../modules/memory/types.js'`
- Agregar `CampaignInfo.promptContext` (de prompts branch)
- Agregar `ContextBundle.tokenBudget` (de context-inject)

#### 3b. Token budget system (`src/engine/context/`)
- `token-budget.ts` — copiar de context-inject, hacer budgets configurables vía config en vez de constantes
- `fact-maintenance.ts` — copiar de context-inject, pero el apply final va vía `memory:manager.applyFactCorrection()`
- `index.ts` — copiar de context-inject

#### 3c. Phase 1 — Intake (`src/engine/phases/phase1-intake.ts`)
- Base: versión de context-inject (más completa: Promise.allSettled, agent resolution, parallel loading)
- **Cambio clave**: en vez de SQL directo para agent_contacts/commitments, usar `memory:manager`:
  ```typescript
  const memoryManager = registry.getOptional<MemoryManager>('memory:manager')
  // ... usar memoryManager.getAgentContact(), memoryManager.getPendingCommitments(), etc.
  ```
- Mantener cross-agent commitments loading
- Mantener graceful degradation (Promise.allSettled)

#### 3d. Phase 2 — Evaluate (`src/engine/phases/phase2-evaluate.ts`)
- Base: versión de context-inject con token budget integration
- Evaluator prompt builder: tomar de context-inject (tiene token budget sections)
- **Pendiente**: integrar con prompts module en Fase 4

#### 3e. Phase 3 — Execute (`src/engine/phases/phase3-execute.ts`)
- Base: versión de context-inject
- Fact maintenance: cuando `factUpdateDetected === true`, auto-append al execution plan
- El executeFactMaintenance llama LLM, pero el apply va vía `memory:manager.applyFactCorrection()`

#### 3f. Phase 4 — Compose (placeholder)
- Por ahora, tomar versión de context-inject
- Se refinará en Fase 4 cuando se integre prompts module

#### 3g. Phase 5 — Validate (`src/engine/phases/phase5-validate.ts`)
- Base: versión de context-inject
- Apply fact updates → `memory:manager.applyFactCorrection()`
- Persist messages → `memory:manager.saveMessage()`
- Pipeline log → `memory:manager.savePipelineLog()`

#### 3h. Nightly batch (`src/engine/proactive/jobs/nightly-batch.ts`)
- Copiar de context-inject como base
- Refactorizar para usar `memory:manager` para:
  - getSessionsForCompression → memoryManager.getSessionsForCompression()
  - compressSession → memoryManager.compressSession()
  - mergeToContactMemory → memoryManager.mergeToContactMemory()
  - getSummariesWithoutEmbeddings → memoryManager.getSummariesWithoutEmbeddings()
- Registrar como job vía hook `job:register`

#### 3i. Engine init (`src/engine/engine.ts`)
- Obtener memoryManager del registry en initEngine
- Pasar registry a las phases (para que accedan a memory:manager y prompts:service)

**Archivos modificados/creados**: ~12 archivos en src/engine/

---

### Fase 4: Prompts module

**Objetivo**: Prompts dinámicos desde oficina, integrados al compositor.

**Desde branch `dynamic-prompts-campaigns`**:

#### 4a. Prompts module files
- `src/modules/prompts/manifest.ts` — copiar, **corregir**:
  - Eliminar acceso privado a `db` vía `unknown` cast → agregar métodos CRUD de campaigns a PromptsService
  - Agregar `reloadCampaigns()` a la interfaz PromptsService
- `src/modules/prompts/prompts-service.ts` — copiar, **corregir**:
  - Eliminar double upsert en `generateEvaluator()`
  - Exponer métodos CRUD de campaigns directamente en el service
- `src/modules/prompts/types.ts` — copiar, **mover** `ChannelResponseFormat` a `src/kernel/types.ts`
- `src/modules/prompts/pg-queries.ts` — copiar tal cual
- `src/modules/prompts/campaign-matcher.ts` — copiar tal cual
- `src/modules/prompts/CLAUDE.md` — copiar y actualizar

#### 4b. Kernel types update
- Agregar `'textarea'` a OficinaField type en `src/kernel/types.ts`
- Agregar `ChannelResponseFormat` interface a `src/kernel/types.ts`

#### 4c. Oficina UI
- `src/modules/oficina/ui/config-ui.html` — agregar soporte para textarea field

#### 4d. Engine compositor refactor (`src/engine/prompts/compositor.ts`)
- Usar `PromptsService.getCompositorPrompts(userType)` como fuente principal
- Fallback a archivos si PromptsService no disponible
- Integrar token budget de context-inject con prompts dinámicos
- Inyectar campaign.promptContext cuando hay match
- **Resolver circular imports**: pasar promptsService como parámetro, no importar de engine.ts

#### 4e. Engine evaluator refactor (`src/engine/prompts/evaluator.ts`)
- Usar `PromptsService.getEvaluatorGenerated()` para contexto adicional
- Mantener token budget de context-inject
- **Resolver circular imports**: pasar como parámetro

#### 4f. Channel response format registration
- `src/modules/whatsapp/manifest.ts` — agregar `registry.provide('whatsapp:responseFormat', {...})`
- `src/modules/gmail/manifest.ts` — agregar `registry.provide('email:responseFormat', {...})`

#### 4g. Token budgets desde oficina
- Agregar campos en oficina para `EVALUATOR_TOKEN_BUDGET` y `COMPOSITOR_TOKEN_BUDGET`
- Pueden ir como config del módulo engine o prompts

**Archivos modificados/creados**: ~15 archivos

---

### Fase 5: Integración y limpieza

1. **CLAUDE.md raíz**: actualizar con los 5 niveles de memoria, remover "NO pgvector"
2. **Module CLAUDE.md**: verificar que memory, prompts, engine estén actualizados
3. **Verificar imports**: ningún import circular, ningún import cruzado entre módulos
4. **TypeScript build**: verificar que compila sin errores
5. **Eliminar duplicación**: verificar que no hay funciones duplicadas entre memory manager y engine

---

## Archivos de conflicto (los tres branches tocan)

| Archivo | Resolución |
|---------|-----------|
| `src/engine/types.ts` | Base context-inject + memory types import + prompts CampaignInfo.promptContext |
| `src/engine/phases/phase1-intake.ts` | Base context-inject, refactored to use memory:manager |
| `src/engine/phases/phase2-evaluate.ts` | Context-inject + prompts evaluatorGenerated |
| `src/engine/phases/phase3-execute.ts` | Context-inject + fact maintenance via memory:manager |
| `src/engine/phases/phase5-validate.ts` | Context-inject + persistence via memory:manager |
| `src/engine/prompts/compositor.ts` | Merge: token budgets (ctx-inject) + PromptsService (prompts) |
| `src/engine/prompts/evaluator.ts` | Merge: token budgets (ctx-inject) + evaluatorGenerated (prompts) |
| `src/engine/engine.ts` | Init with both memory:manager and prompts:service from registry |
| `src/kernel/types.ts` | Merge: textarea + ChannelResponseFormat + contact:status_changed agentId |

## Estimación de complejidad

- Fase 1 (base + migración): Baja — combinar SQLs
- Fase 2 (memory module): Baja — copiar archivos, fix menor
- Fase 3 (context inject): **Alta** — refactorizar engine phases para usar services
- Fase 4 (prompts): Media — copiar módulo + integrar con compositor
- Fase 5 (limpieza): Baja — verificación

## Riesgos

1. **El engine tiene mucho código inline** de context-inject (SQL directo en phases) que hay que refactorizar a usar memory:manager — es el paso más delicado
2. **Nightly batch** de context-inject es extenso (553 lines) y usa SQL directo — hay que adaptarlo
3. **Token budget** + PromptsService en compositor requiere reconciliar dos enfoques de build de prompts
