# Plan: Engine Simplification & Security Fix (v2 — revisado con Codex)

## Context

Codex audited `src/engine/` y encontró 4 issues P1 confirmados:
1. **Bug de seguridad**: `phase5Validate` sanitiza `responseText` pero envía `formattedParts` (sin sanitizar) al usuario
2. **Config con doble fuente**: 22 campos se cargan tanto de env vars como del registry — hot-reload del console está roto para params core del engine
3. **Duplicación de pipeline**: 60+ líneas de código agentic idéntico entre rutas reactiva y proactiva
4. **Código muerto**: 7 flags huérfanas en config, 1 test huérfano, tipos/campos legacy del viejo modelo de 5 fases

Decisiones del usuario:
- Agentic es el modelo oficial. El experimento de 5 fases se retira.
- Runner compartido para reactive/proactive — bien estructurado, sin leaks.
- **Sanitización híbrida**: respuestas de texto → sanear+continuar con logging. Respuestas audio/TTS → bloquear+fallback a texto (sanitizar audio puede romper voice tags o parámetros de estilo).
- Log dedicado de leakage para análisis y optimización.

### Ajustes incorporados del review de Codex

1. **No mutar `composed.formattedParts` in-place** — Construir copia validada inmutable, enviar siempre esa copia.
2. **Extraer sanitización a `src/engine/output-sanitizer.ts`** — Módulo compartido que consumen tanto delivery como post-processor. No importar de phase5 a post-processor (dependencia inversa).
3. **Config incremental** — Migrar los 22 campos solapados a registry primero. Campos que solo viven en config.ts (modelos legacy LLM, session timeouts) quedan con `getEnv()` hasta segundo corte.
4. **Verificar consumidores antes de borrar tipos** — `tsc --noEmit` + grep en todo `src/` antes de eliminar `EvaluatorOutput`, `ExecutionOutput`, etc.
5. **Renombrar boundaries** — Retirar nomenclatura "phase1/phase5" por nombres que reflejen el engine agentic actual.

---

## Step 0: Rename — Retirar nomenclatura de fases (~10 min)

Las "fases" ya no existen. Los dos archivos que quedan son boundaries del pipeline agentic, no fases secuenciales.

### 0A. Renombrar directorio y archivos

```
src/engine/phases/                  → src/engine/boundaries/
src/engine/phases/phase1-intake.ts  → src/engine/boundaries/intake.ts
src/engine/phases/phase5-validate.ts → src/engine/boundaries/delivery.ts
```

### 0B. Renombrar exports

```typescript
// Antes
export async function phase1Intake(...)
export async function phase5Validate(...)

// Después
export async function intake(...)
export async function delivery(...)
```

### 0C. Actualizar imports en consumidores

Archivos que importan las funciones actuales:
- `src/engine/engine.ts` — importa `phase1Intake` y `phase5Validate`
- `src/engine/proactive/proactive-pipeline.ts` — importa `phase5Validate`
- `src/engine/index.ts` — re-exporta
- Cualquier test que importe de `phases/`

Buscar con grep: `phase1Intake`, `phase5Validate`, `phases/phase1`, `phases/phase5` en todo `src/` y `tests/`.

### 0D. Renombrar variables internas

Dentro de los archivos renombrados y sus consumidores, cambiar nombres de variables que referencien "phase1" o "phase5":
- `phase1DurationMs` → `intakeDurationMs`
- `phase5DurationMs` → `deliveryDurationMs`
- Campos en `PipelineResult` que usen estos nombres

### Verificación Step 0
```bash
npx tsc --noEmit   # debe compilar limpio
grep -r "phase1\|phase5\|phases/" src/engine/ --include="*.ts"  # solo debe quedar en comentarios/migrations
```

---

## Step 1: Security Fix — Sanitización Híbrida (~30 min)

### 1A. Crear `src/engine/output-sanitizer.ts` (módulo compartido)

Extraer de `delivery.ts` (ex phase5-validate.ts) toda la lógica de sanitización a un helper independiente:

```typescript
// src/engine/output-sanitizer.ts

export interface ValidationResult {
  passed: boolean
  issues: string[]
  sanitizedText: string
}

export function validateOutput(text: string): ValidationResult
export function detectToolCallLeakage(text: string): string[]
export function detectSensitiveData(text: string): string[]
export function detectOutputInjection(text: string): string[]
export function sanitizeToolCallLeakage(text: string): string

// Nuevo: sanitizar un array de partes formateadas (retorna copia, no muta)
export function sanitizeFormattedParts(parts: string[]): { sanitizedParts: string[]; validation: ValidationResult }
```

`sanitizeFormattedParts` construye una **copia inmutable**:
```typescript
export function sanitizeFormattedParts(parts: string[]): { sanitizedParts: string[]; validation: ValidationResult } {
  const allIssues: string[] = []
  const sanitizedParts = parts.map(part => {
    const v = validateOutput(part)
    if (!v.passed) allIssues.push(...v.issues)
    return v.passed ? part : v.sanitizedText
  })
  return {
    sanitizedParts,
    validation: {
      passed: allIssues.length === 0,
      issues: allIssues,
      sanitizedText: sanitizedParts.join('\n'),
    },
  }
}
```

### 1B. Sanitización pre-TTS en post-processor

**File: `src/engine/agentic/post-processor.ts`**

Antes de `formatForChannel` y TTS, sanitizar el texto:

```typescript
import { validateOutput } from '../output-sanitizer.js'

// Sanitize before formatting and TTS — defense in depth
const preValidation = validateOutput(responseText)
if (!preValidation.passed) {
  logger.warn({ traceId: ctx.traceId, issues: preValidation.issues }, 'Pre-TTS sanitization triggered')
  responseText = preValidation.sanitizedText
}
const formattedParts = formatForChannel(responseText, ctx.message.channelName, registry)
```

Esto es la capa de defensa en profundidad: incluso si delivery no atrapa algo, el TTS nunca recibe texto con leakage.

### 1C. Sanitización de texto + bloqueo de audio en delivery

**File: `src/engine/boundaries/delivery.ts`** (ex phase5-validate.ts)

Reemplazar la validación actual (líneas 68-73) con flujo híbrido:

```typescript
import { validateOutput, sanitizeFormattedParts } from '../output-sanitizer.js'

// 1. Validate base text
const validation = validateOutput(composed.responseText)
let responseText = composed.responseText

if (!validation.passed) {
  logger.warn({ traceId: ctx.traceId, issues: validation.issues }, 'Output validation issues')
  responseText = validation.sanitizedText

  // 1a. Build sanitized copy of formatted parts (never mutate original)
  const { sanitizedParts } = sanitizeFormattedParts(composed.formattedParts)

  // 1b. Log leakage event for analysis
  await logLeakageEvent(ctx, validation, composed.outputFormat === 'audio' ? 'audio-blocked' : 'sanitized-text', db).catch(() => {})

  // 1c. Audio: block and fallback to sanitized text
  if (composed.outputFormat === 'audio') {
    logger.warn({ traceId: ctx.traceId }, 'Leakage in audio response — blocking audio, falling back to sanitized text')
    deliveryResult = await sendMessages(ctx, sanitizedParts, registry)
    // Skip all audio paths below
  } else {
    // 1d. Text: send sanitized copy
    deliveryResult = await sendMessages(ctx, sanitizedParts, registry)
  }
} else {
  // No leakage — normal delivery paths (audio chunks, single audio, text)
  // ... existing audio/text delivery logic unchanged ...
}
```

**Clave**: nunca se muta `composed.formattedParts`. Se construye `sanitizedParts` como copia y se envía esa.

### 1D. Logger de eventos de leakage

**File: `src/engine/boundaries/delivery.ts`**

```typescript
async function logLeakageEvent(
  ctx: ContextBundle,
  validation: ValidationResult,
  action: 'sanitized-text' | 'audio-blocked',
  db: Pool,
): Promise<void> {
  try {
    await db.query(
      `INSERT INTO pipeline_logs (trace_id, contact_id, session_id, event_type, payload, created_at)
       VALUES ($1, $2, $3, 'output_leakage', $4, NOW())`,
      [ctx.traceId, ctx.contactId ?? null, ctx.session.id, JSON.stringify({
        action,
        issues: validation.issues,
        channel: ctx.message.channelName,
        outputFormat: ctx.responseFormat,
      })]
    )
  } catch (err) {
    logger.warn({ err, traceId: ctx.traceId }, 'Failed to log leakage event')
  }
}
```

Usa tabla existente `pipeline_logs` — no requiere migración. Event type `output_leakage` permite queries:
```sql
SELECT * FROM pipeline_logs WHERE event_type = 'output_leakage' ORDER BY created_at DESC;
```

### 1E. Limpiar delivery.ts

Eliminar de `delivery.ts` las funciones de sanitización que ahora viven en `output-sanitizer.ts`:
- `validateOutput()` → movida
- `detectToolCallLeakage()` → movida
- `detectSensitiveData()` → movida
- `detectOutputInjection()` → movida
- `sanitizeToolCallLeakage()` → movida
- Las constantes de regex patterns → movidas

Delivery importa todo de `../output-sanitizer.js`.

### Verificación Step 1
```bash
npx tsc --noEmit
npm test
# Grep para confirmar que output-sanitizer.ts es el único lugar con lógica de sanitización
grep -r "detectToolCallLeakage\|detectSensitiveData\|detectOutputInjection" src/engine/ --include="*.ts"
```

---

## Step 2: Runner Agentic Compartido (~1-2h)

### 2A. Crear `src/engine/agentic/run-agentic-delivery.ts`

Archivo nuevo. Extrae la secuencia compartida de `engine.ts:runAgenticPipeline()` y `proactive-pipeline.ts:runProactiveAgentic()`.

```typescript
import type { Pool } from 'pg'
import type { Redis } from 'ioredis'
import type { Registry } from '../../kernel/registry.js'
import type { ContextBundle, EngineConfig, PipelineResult, CompositorOutput, DeliveryResult } from '../types.js'
import type { AgenticResult, AgenticConfig, EffortLevel, LLMToolDef } from './types.js'

export interface AgenticDeliveryInput {
  ctx: ContextBundle
  mode: 'reactive' | 'proactive'
  registry: Registry
  db: Pool
  redis: Redis
  engineConfig: EngineConfig

  // Mode-specific overrides
  effortOverride?: EffortLevel        // proactive forces downgrade
  maxTurnsCap?: number                // proactive caps at 5
  promptOptions?: {                   // proactive passes isProactive + trigger
    isProactive?: boolean
    proactiveTrigger?: unknown
  }
}

export interface AgenticDeliveryResult {
  agenticResult: AgenticResult | null
  composed: CompositorOutput | null
  deliveryResult: DeliveryResult | null
  agenticDurationMs: number
  deliveryDurationMs: number
}

export async function runAgenticDelivery(input: AgenticDeliveryInput): Promise<AgenticDeliveryResult>
```

**Secuencia interna** (los 10 pasos que hoy están duplicados):

```
1. classifyEffort(ctx)           → apply effortOverride if provided
2. getModelForEffort(effort)     → resolve (model, provider, fallback)
3. Tool catalog                  → getAgenticSubagentCatalog + filterAgenticTools + toLLMToolDefs
4. Skill catalog                 → loadSkillCatalog + filterSkillsByTools + buildSkillReadToolDef
5. buildAgenticPrompt(ctx, reg, promptOptions)
6. Assemble AgenticConfig        → model, provider, maxToolTurns (capped by maxTurnsCap)
7. runAgenticLoop()              → core LLM loop
8. postProcess()                 → criticizer + formatting + TTS
9. delivery()                    → sanitization + send + persistence (ex phase5Validate)
10. savePipelineLog()            → fire-and-forget via memory:manager
```

### 2B. Mover helpers a ubicación compartida

Funciones que hoy son inline en `engine.ts` y se duplican:

```typescript
// Mover a run-agentic-delivery.ts o a src/engine/agentic/helpers.ts

export function getModelForEffort(effort: EffortLevel, config: EngineConfig): {
  model: string; provider: LLMProvider; fallbackModel: string; fallbackProvider: LLMProvider
}

export function toLLMToolDefs(toolDefs: ToolDefinition[]): LLMToolDef[]

export function buildToolCatalog(
  ctx: ContextBundle, registry: Registry
): { toolCatalog: ToolDefinition[]; llmToolDefs: LLMToolDef[] }

export function buildSkillCatalogForPipeline(
  registry: Registry, userType: string, llmToolDefs: LLMToolDef[], toolCatalog: ToolDefinition[]
): Promise<{ filteredSkills: Skill[]; llmToolDefs: LLMToolDef[] }>
```

### 2C. Refactorizar ruta reactiva en `engine.ts`

Reemplazar `runAgenticPipeline()` (líneas 389-526, ~138 líneas) con:

```typescript
async function runAgenticPipeline(
  ctx: ContextBundle, config: EngineConfig, reg: Registry,
  db: Pool, redis: Redis, totalStart: number, intakeDurationMs: number,
): Promise<PipelineResult> {
  const result = await runAgenticDelivery({
    ctx, mode: 'reactive', registry: reg, db, redis, engineConfig: config,
  })

  return {
    traceId: ctx.traceId,
    success: !!result.deliveryResult?.sent,
    intakeDurationMs,
    deliveryDurationMs: result.deliveryDurationMs,
    totalDurationMs: Date.now() - totalStart,
    agenticResult: result.agenticResult ?? undefined,
    effortLevel: result.agenticResult?.effortUsed,
    responseText: result.agenticResult?.responseText,
    deliveryResult: result.deliveryResult ?? undefined,
  }
}
```

### 2D. Refactorizar ruta proactiva en `proactive-pipeline.ts`

Reemplazar líneas 174-310 con llamada al runner compartido. **Mantener** código proactive-only:
- Pre-guards y conversation guard (líneas 142-171)
- NO_ACTION sentinel check — mover a post-delivery:
  ```typescript
  const result = await runAgenticDelivery({
    ctx, mode: 'proactive', registry, db, redis, engineConfig,
    effortOverride: downgradeEffort(effort),
    maxTurnsCap: 5,
    promptOptions: { isProactive: true, proactiveTrigger: candidate.trigger },
  })

  // Proactive-only: check NO_ACTION sentinel
  if (result.agenticResult?.responseText.includes('[NO_ACTION]')) {
    // ... existing NO_ACTION logic (cooldown, log, return early)
  }
  ```
- Post-send bookkeeping: cooldown, increment count, update state, log outreach (líneas 267-293)

### Verificación Step 2
```bash
npx tsc --noEmit
npm test
# Verificar que no queda lógica duplicada
grep -rn "filterAgenticTools\|buildSkillReadToolDef\|getModelForEffort" src/engine/engine.ts src/engine/proactive/
# Solo debe aparecer el import, no la implementación
```

---

## Step 3: Unificar Config del Engine (incremental) (~1h)

### 3A. Migrar los 22 campos solapados a registry

**File: `src/engine/config.ts`**

Para los 22 campos que existen en AMBOS sitios, cambiar `loadEngineConfig()` para leerlos de `registry.getConfig('engine')`:

```typescript
export function loadEngineConfig(registry: Registry): EngineConfig {
  const mod = registry.getConfig<EngineModuleConfig>('engine')

  // ── Campos migrados (fuente: registry) ──
  const maxConcurrentPipelines = mod.ENGINE_MAX_CONCURRENT_PIPELINES
  const maxQueueSize = mod.ENGINE_MAX_QUEUE_SIZE
  const maxConcurrentSteps = mod.ENGINE_MAX_CONCURRENT_STEPS
  const backpressureMessage = mod.ENGINE_BACKPRESSURE_MESSAGE
  const testMode = mod.ENGINE_TEST_MODE
  const composeRetriesPerProvider = mod.ENGINE_COMPOSE_RETRIES_PER_PROVIDER
  // ... attachment fields, agentic fields, model fields ...

  // ── Campos NO migrados (fuente: env vars, segundo corte) ──
  const classifyModel = env('LLM_CLASSIFY_MODEL', 'claude-haiku-4-5-20251001')
  const respondModel = env('LLM_RESPOND_MODEL', 'claude-sonnet-4-6')
  // ... legacy LLM models, session timeouts, proactive config ...

  return { /* merged */ }
}
```

**Campos que se migran ahora (22):**
- `ENGINE_TEST_MODE`, `ENGINE_MAX_CONCURRENT_PIPELINES`, `ENGINE_MAX_QUEUE_SIZE`, `ENGINE_MAX_CONCURRENT_STEPS`, `ENGINE_BACKPRESSURE_MESSAGE`, `ENGINE_COMPOSE_RETRIES_PER_PROVIDER`
- `ATTACHMENT_ENABLED`, `ATTACHMENT_SMALL_DOC_TOKENS`, `ATTACHMENT_MEDIUM_DOC_TOKENS`, `ATTACHMENT_SUMMARY_MAX_TOKENS`, `ATTACHMENT_CACHE_TTL_MS`, `ATTACHMENT_URL_ENABLED`, `ATTACHMENT_URL_FETCH_TIMEOUT_MS`, `ATTACHMENT_URL_MAX_SIZE_MB`
- `ENGINE_AGENTIC_MAX_TURNS`, `ENGINE_EFFORT_ROUTING`, `ENGINE_LOOP_DETECTION`
- `AGENTIC_LOOP_WARN_THRESHOLD`, `AGENTIC_LOOP_BLOCK_THRESHOLD`, `AGENTIC_LOOP_CIRCUIT_THRESHOLD`
- `LLM_LOW_EFFORT_MODEL`, `LLM_MEDIUM_EFFORT_MODEL`, `LLM_HIGH_EFFORT_MODEL` (+ providers)

**Campos que quedan con `getEnv()` (segundo corte):**
- `LLM_CLASSIFY_MODEL`, `LLM_RESPOND_MODEL`, `LLM_COMPLEX_MODEL`, `LLM_TOOLS_MODEL`, `LLM_PROACTIVE_MODEL` + providers + fallbacks
- `LLM_MAX_INPUT_TOKENS`, `LLM_MAX_OUTPUT_TOKENS`, `LLM_TEMPERATURE_*`, `LLM_REQUEST_TIMEOUT_MS`
- `MEMORY_SESSION_REOPEN_WINDOW_HOURS`, `SESSION_REOPEN_WINDOW_MS`
- `FOLLOWUP_*`, `BATCH_*`
- `ENGINE_PIPELINE_TIMEOUT_MS`, `ENGINE_CHECKPOINT_*`
- `LLM_CRITICIZER_MODE`

### 3B. Actualizar firma de `loadEngineConfig`

```typescript
// Antes
export function loadEngineConfig(): EngineConfig

// Después
export function loadEngineConfig(registry: Registry): EngineConfig
```

### 3C. Actualizar call sites

- `engine.ts:initEngine()` — ya recibe `registry`, pasar a `loadEngineConfig(registry)`
- `engine.ts:reloadEngineConfig()` — tiene acceso a `registry` en closure, pasar a `loadEngineConfig(registry)`
- `manifest.ts:init()` — tiene `registry`, actualizar la llamada indirecta

### 3D. Fix hot-reload

Con el cambio de 3A, `reloadEngineConfig()` ahora lee los 22 campos del registry (que se actualizó con los valores de console). El hot-reload funciona correctamente para esos campos.

### 3E. Eliminar defaults duplicados de config.ts

Para los 22 campos migrados, eliminar los defaults hardcodeados en `loadEngineConfig()`. La fuente única de defaults es el `configSchema` en `manifest.ts`.

### Verificación Step 3
```bash
npx tsc --noEmit
npm test
# Verificar que los 22 campos ya no se leen de env en config.ts
grep -n "envInt\|envBool\|envFloat\|env(" src/engine/config.ts
# Solo deben quedar los campos del "segundo corte"
```

---

## Step 4: Limpieza de Código Muerto (~15 min)

### Pre-requisito: verificar consumidores

Antes de borrar cualquier tipo, correr:
```bash
npx tsc --noEmit  # baseline
grep -rn "EvaluatorOutput" src/ tests/ --include="*.ts"
grep -rn "ExecutionOutput" src/ tests/ --include="*.ts"
grep -rn "ReplanContext" src/ tests/ --include="*.ts"
grep -rn "ExecutionStep" src/ tests/ --include="*.ts"
grep -rn "toolDedupEnabled\|loopDetectionEnabled\|errorAsContextEnabled\|partialRecoveryEnabled" src/ --include="*.ts"
grep -rn "executionQueueReactiveConcurrency\|executionQueueProactiveConcurrency\|executionQueueBackgroundConcurrency" src/ --include="*.ts"
```

Solo borrar si el grep confirma que no hay consumidores reales (definición + type declaration no cuentan).

### 4A. Remover 7 flags huérfanas

**Archivos a modificar:**
- `src/engine/config.ts` — eliminar del body de `loadEngineConfig()`
- `src/engine/types.ts` — eliminar del interface `EngineConfig`
- `src/modules/engine/manifest.ts` — eliminar del `configSchema` y de `console.fields`

### 4B. Remover campos legacy de PipelineResult

**File: `src/engine/types.ts`**

Eliminar de `PipelineResult`:
- `phase2DurationMs`, `phase3DurationMs`, `phase4DurationMs` → ya renombrados en Step 0
- `evaluatorOutput` (siempre undefined en agentic) — **solo si grep confirma 0 consumidores reales**
- `executionOutput` (siempre undefined en agentic) — **solo si grep confirma**
- `replanAttempts` (siempre 0) — **solo si grep confirma**
- `subagentIterationsUsed` (siempre 0) — **solo si grep confirma**

Luego eliminar las asignaciones `= 0` / `= undefined` en engine.ts y proactive-pipeline.ts.

### 4C. Remover tipos muertos

**File: `src/engine/types.ts`**

- `ReplanContext` — **solo si grep confirma 0 consumidores**
- `EvaluatorOutput` — **solo si se removió de PipelineResult en 4B Y grep confirma**
- `ExecutionOutput` — **solo si se removió de PipelineResult en 4B Y grep confirma**
- **MANTENER** `ExecutionStep` — tiene consumidores activos en checkpoints + subagent

### 4D. Eliminar test huérfano

```bash
rm tests/engine/checkpoint-phase3.test.ts
```

Importa `phase3-execute.ts` que no existe → siempre falla.

### 4E. Limpiar exports en index.ts

**File: `src/engine/index.ts`**

Eliminar re-exports de tipos/funciones borrados. Actualizar imports que apuntaban a `phases/` para que apunten a `boundaries/`.

### Verificación Step 4
```bash
npx tsc --noEmit   # DEBE compilar limpio
npm test           # 157 tests deben pasar, 0 fallos (el test huérfano ya no existe)
```

---

## Step 5: Documentación (~10 min)

### 5A. Actualizar `src/engine/CLAUDE.md`

Reflejar el estado real:
- El engine es agentic, no un pipeline de fases
- Runner compartido: `runAgenticDelivery()` en `src/engine/agentic/run-agentic-delivery.ts`
- Boundaries: `intake.ts` (contexto) y `delivery.ts` (entrega + persistencia) en `src/engine/boundaries/`
- Sanitización: `src/engine/output-sanitizer.ts` (módulo compartido)
- Config: fuente única via `registry.getConfig('engine')` para campos del módulo

### 5B. Actualizar `docs/architecture/pipeline.md`

Reemplazar la descripción de 5 fases con el flujo agentic actual:
```
intake → effort router → agentic loop → post-process → delivery
```

### 5C. Actualizar doc de auditoría

Marcar sección engine como `validado` en `docs/reports/S01-auditoria-simplicidad.md`.

---

## Orden de Ejecución

```
Step 0  Rename boundaries
  ├─ 0A  Renombrar directorio + archivos
  ├─ 0B  Renombrar exports
  ├─ 0C  Actualizar imports
  └─ 0D  Renombrar variables internas
        → VERIFY: tsc + grep "phase1|phase5"

Step 1  Security fix
  ├─ 1A  Crear output-sanitizer.ts (extraer de delivery.ts)
  ├─ 1B  Pre-TTS sanitization en post-processor
  ├─ 1C  Sanitización de texto + bloqueo audio en delivery
  ├─ 1D  Logger de leakage
  └─ 1E  Limpiar delivery.ts (remover funciones migradas)
        → VERIFY: tsc + tests

Step 2  Runner compartido
  ├─ 2A  Crear run-agentic-delivery.ts
  ├─ 2B  Mover helpers
  ├─ 2C  Refactorizar ruta reactiva
  └─ 2D  Refactorizar ruta proactiva
        → VERIFY: tsc + tests + grep duplicación

Step 3  Config unificada (incremental)
  ├─ 3A  Migrar 22 campos solapados a registry
  ├─ 3B  Actualizar firma loadEngineConfig
  ├─ 3C  Actualizar call sites
  ├─ 3D  Fix hot-reload
  └─ 3E  Eliminar defaults duplicados
        → VERIFY: tsc + tests

Step 4  Limpieza de código muerto
  ├─ Pre: grep consumidores de cada tipo/flag
  ├─ 4A  Remover flags huérfanas
  ├─ 4B  Remover campos legacy de PipelineResult
  ├─ 4C  Remover tipos muertos
  ├─ 4D  Eliminar test huérfano
  └─ 4E  Limpiar exports
        → VERIFY: tsc + tests (157 pass, 0 fail)

Step 5  Documentación
  ├─ 5A  Engine CLAUDE.md
  ├─ 5B  Pipeline docs
  └─ 5C  Audit doc
```

---

## Verificación Final

Después de todos los steps:

```bash
# 1. Compilación limpia
npx tsc --noEmit

# 2. Tests pasan
npm test  # Expected: 157+ pass, 0 fail

# 3. No quedan referencias a fases legacy
grep -rn "phase1\|phase2\|phase3\|phase4\|phase5" src/engine/ --include="*.ts" | grep -v "//\|CLAUDE\|migration"

# 4. Sanitización centralizada
grep -rn "detectToolCallLeakage\|detectSensitiveData\|detectOutputInjection" src/engine/ --include="*.ts"
# Solo debe aparecer en output-sanitizer.ts

# 5. Config dual eliminada para campos migrados
grep -rn "getEnv\|envInt\|envBool" src/engine/config.ts
# Solo deben quedar campos del "segundo corte" (legacy LLM, session, proactive)

# 6. Log de leakage funcional
# SQL: SELECT * FROM pipeline_logs WHERE event_type = 'output_leakage' ORDER BY created_at DESC;
```

---

## Archivos Modificados (resumen)

| Archivo | Cambios |
|---------|---------|
| `src/engine/boundaries/intake.ts` | **RENAME** de `phases/phase1-intake.ts` — rename export |
| `src/engine/boundaries/delivery.ts` | **RENAME** de `phases/phase5-validate.ts` — rename export, importar de output-sanitizer, flujo híbrido, leakage logger |
| `src/engine/output-sanitizer.ts` | **NEW** — lógica de sanitización centralizada + `sanitizeFormattedParts()` |
| `src/engine/agentic/post-processor.ts` | Importar de output-sanitizer, pre-TTS sanitization |
| `src/engine/agentic/run-agentic-delivery.ts` | **NEW** — runner agentic compartido |
| `src/engine/agentic/helpers.ts` | **NEW** (opcional) — `getModelForEffort`, `toLLMToolDefs`, `buildToolCatalog` |
| `src/engine/engine.ts` | Usar runner compartido, actualizar imports a boundaries/, fix config loading |
| `src/engine/proactive/proactive-pipeline.ts` | Usar runner compartido, actualizar imports a boundaries/ |
| `src/engine/config.ts` | 22 campos leen de registry, firma recibe Registry, eliminar defaults duplicados |
| `src/engine/types.ts` | Renombrar campos phase→boundary, remover tipos/campos muertos |
| `src/engine/index.ts` | Actualizar re-exports |
| `src/modules/engine/manifest.ts` | Remover flags huérfanas de configSchema y console.fields |
| `tests/engine/checkpoint-phase3.test.ts` | **DELETE** |
| `src/engine/CLAUDE.md` | Actualizar a modelo agentic |
| `docs/architecture/pipeline.md` | Reemplazar 5 fases con flujo agentic |
| `docs/reports/S01-auditoria-simplicidad.md` | Marcar engine como validado |

## Evaluación de Riesgo

| Step | Riesgo | Razón |
|------|--------|-------|
| **Step 0** (rename) | Bajo | Rename mecánico, tsc atrapa imports rotos |
| **Step 1** (security) | Bajo | Aditivo, no altera paths de envío existentes, nueva capa de protección |
| **Step 2** (runner) | Medio | Reestructura pipeline core, pero la lógica queda idéntica. Testear reactive + proactive |
| **Step 3** (config) | Medio | Cambia cómo se carga config. Verificar que todos los params llegan correctamente. Incremental reduce riesgo |
| **Step 4** (cleanup) | Bajo | Remueve código no usado. grep previo + tsc atrapa referencias perdidas |
| **Step 5** (docs) | Zero | Solo documentación |

## Notas para Codex (ejecutor)

- **Orden estricto**: Step 0 → 1 → 2 → 3 → 4 → 5. Cada step depende del anterior.
- **Verificar después de cada step**: `tsc --noEmit` y `npm test`. No avanzar al siguiente step si hay errores.
- **Step 4 pre-requisito**: correr los greps de consumidores ANTES de borrar. Si un tipo tiene consumidor inesperado, no borrar y dejar nota.
- **No inventar**: si algo no encaja con lo descrito aquí, parar y dejar nota en vez de improvisar.
- **Commits**: un commit por step completado, mensaje descriptivo.
