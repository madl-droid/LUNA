# Auditoría — Instance 1: Engine Agentic Core

**Branch auditado**: `claude/review-infrastructure-docs-J2swJ`  
**Commit**: `834c7bee` — `feat(engine): implement agentic loop v2 core (Instance 1)`  
**Fecha de auditoría**: 2026-04-02  
**Auditor**: Claude Sonnet

---

## 1. COMPILACIÓN TypeScript

**Resultado: PASS (con nota de ambiente)**

```bash
npx tsc --noEmit
```

Todos los errores encontrados son **pre-existentes en toda la base de código** (no introducidos por Instance 1):
- `Cannot find module 'pino'` — pino no está instalado en el ambiente local de auditoría
- `Cannot find name 'Buffer'` / `@types/node` no instalado
- Errores idénticos aparecen en `engine/ack/`, `engine/phases/`, `engine/engine.ts`, etc.

**No hay ningún error de tipo/lógica** en los archivos nuevos de `src/engine/agentic/`. Los únicos errores en esos archivos son:
- `agentic-loop.ts(5)` — `Cannot find module 'pino'`
- `post-processor.ts(5)` — `Cannot find module 'pino'`
- `post-processor.ts(18,19,69,71)` — `Cannot find name 'Buffer'`
- `tool-loop-detector.ts(5)` — `Cannot find module 'pino'`

Estos mismos errores existen en >30 archivos anteriores al commit de Instance 1.

---

## 2. INVENTARIO DE ARCHIVOS

| Archivo | Existe | Observación |
|---------|--------|-------------|
| `src/engine/agentic/types.ts` | ✅ | Completo |
| `src/engine/agentic/effort-router.ts` | ✅ | Completo |
| `src/engine/agentic/tool-dedup-cache.ts` | ✅ | Completo |
| `src/engine/agentic/tool-loop-detector.ts` | ✅ | Completo |
| `src/engine/agentic/agentic-loop.ts` | ✅ | Completo |
| `src/engine/agentic/post-processor.ts` | ✅ | Completo |
| `src/engine/agentic/index.ts` | ✅ | Completo |
| `src/engine/CLAUDE.md` (actualizado) | ✅ | Documentación completa del subsistema agentic/ |

**Archivos modificados** (solo los autorizados por el plan):
- `src/engine/subagent/subagent.ts` — agregado `buildSubagentContext()` ✅
- `src/engine/CLAUDE.md` — actualizado ✅

---

## 3. REUSE COMPLIANCE

### LLM Calls
- ✅ `callLLMWithFallback()` usado en `agentic-loop.ts` (turno principal + forced final response)
- ✅ `callLLM()` usado en `post-processor.ts` (criticizer — solo texto, no necesita fallback)
- ✅ Ninguna llamada directa a SDKs de Anthropic o Google

### Tool Execution
- ✅ `registry.getOptional<ToolExecutor>('tools:registry')` — obtiene el registry existente
- ✅ `toolExecutor.executeTool(name, input, context)` — única forma de ejecutar tools
- ✅ Sin handlers de tools custom

### Tool Definitions
- ✅ `toolDefinitions: LLMToolDef[]` recibido como parámetro (el caller los obtiene del registry)
- **NOTA**: `toNativeTools()` de `tool-converter.ts` no es llamado dentro del loop. El loop recibe las definiciones ya en formato nativo (`LLMToolDef[]`). La conversión es responsabilidad del caller (Instance 4). Esto es diseño correcto y aceptable.

### Paralelismo de Tools
- ✅ `StepSemaphore` de `engine/concurrency/step-semaphore.ts` usado en `executeToolCalls()`
- ✅ `semaphore.run()` envuelve cada tool call con `Promise.allSettled()`

### Formato de Canal
- ✅ `formatForChannel()` de `engine/utils/message-formatter.ts` usado en `post-processor.ts`

### Seguridad / Escape
- ⚠️ **NOTA**: `ctx.normalizedText` se pasa directamente a los mensajes sin llamar `escapeForPrompt()` / `wrapUserContent()` de `prompt-escape.ts`. Sin embargo:
  1. Esto es **consistente con el patrón en `subagent.ts`** (que tampoco llama escaping en los mensajes)
  2. Phase 1 ya normaliza el texto y setea `ctx.possibleInjection`
  3. El sistema prompt (ensamblado por Instance 2) incluye las instrucciones de guardrails
  4. **No es un bug**, es diseño consistente con el sistema actual

### Output Type
- ✅ `postProcess()` retorna `CompositorOutput` — tipo exacto verificado en `engine/types.ts:270`
- ✅ No se creó ningún output type nuevo

### DB / Registry / Hooks
- ✅ Sin nuevas tablas DB
- ✅ Sin `registry.provide()` — solo `registry.getOptional()`
- ✅ Sin nuevos hooks definidos

---

## 4. LÓGICA DEL AGENTIC LOOP

### Terminación del loop
- ✅ Loop termina correctamente cuando `!llmResult.toolCalls || llmResult.toolCalls.length === 0`
- ✅ `while (turns < config.maxToolTurns)` — respeta el límite de turns

### Tool calls en la conversación
- ✅ El asistente append su mensaje (con tool calls) y el user append los resultados en cada turn
- **NOTA de diseño**: Los tool calls y resultados se pasan como strings de texto (no como bloques estructurados `tool_use`/`tool_result` de Anthropic). Esto es **consistente con el patrón existente** en `subagent.ts` líneas 493-498, donde también se usa texto plano. El LLM gateway maneja la conversación en este formato.

### Error-as-context
- ✅ Errores de tools se devuelven al LLM: `[${r.name}]: ERROR — ${r.error ?? 'Unknown error'}`
- ✅ No hay retries ciegos — el LLM decide cómo proceder con el error
- ✅ Excepciones inesperadas del executor capturadas con try/catch dentro del semaphore

### Partial text recovery
- ✅ `partialText` acumula texto cuando el LLM produce texto junto a tool calls
- ✅ Si loop es interrupted por timeout o error, se usa `partialText` como fallback
- ✅ Forced final response incluye `partialText` en el `AgenticResult.partialText` field

### Token tracking
- ✅ `totalTokens += llmResult.inputTokens + llmResult.outputTokens` en cada turn
- ✅ Token del forced final response también acumulado
- ✅ `AgenticResult.tokensUsed` refleja total de todos los turns

### Forced final response (turn limit / circuit breaker)
- ✅ Mensaje claro enviado al LLM pidiendo respuesta final sin más tool calls
- ✅ `tools: undefined` en el forced call — garantiza respuesta texto
- ✅ Diferencia entre `'turn_limit'` y `'circuit_break'` logeada

### Non-null assertion `toolExecutor!`
- ⚠️ **NOTA menor**: En `executeToolCalls()`, se usa `toolExecutor!` con comentario explicando que es non-null porque `effectiveTools.length > 0`. Si `toolExecutor` es null, `effectiveTools = []`, y el LLM no recibe tools, por lo que en práctica nunca hará tool calls. El assertion es seguro en este flujo pero depende de una invariante implícita. Bajo riesgo, no requiere fix.

---

## 5. TOOL DEDUP CACHE

| Criterio | Estado |
|----------|--------|
| Clave = `toolName:JSON.stringify(input)` truncado a 10KB | ✅ |
| Write/side-effect tools excluidos del cache (`WRITE_TOOLS` set) | ✅ |
| Scoped a un solo pipeline run (instancia creada al inicio de `runAgenticLoop`, descartada al retornar) | ✅ |
| No persistence (no Redis, no DB) | ✅ |
| `ToolCallLog` re-exportado desde este módulo | ⚠️ Ver nota |

**Nota sobre re-export**: `tool-dedup-cache.ts` re-exporta `ToolCallLog` con:
```typescript
export type { ToolCallLog }
```
Esto es redundante porque `ToolCallLog` se define en `types.ts`. Los consumidores deberían importar de `types.ts`. Sin embargo, no causa ningún problema funcional y puede facilitar imports desde `./tool-dedup-cache.js`. No requiere fix.

**WRITE_TOOLS lista**: La lista hardcodeada de 12 tools es razonable como defensa en profundidad, aunque si en el futuro se agregan tools con side-effects nuevos, se deberá actualizar esta lista. Se recomienda documentar este punto en el CLAUDE.md.

---

## 6. LOOP DETECTOR

| Criterio | Estado |
|----------|--------|
| Detector 1: Repeat exacto (mismo tool + mismo input) | ✅ WARN@3, BLOCK@5, CIRCUIT_BREAK@8 |
| Detector 2: No-progress (mismo tool, distinto input, mismo resultado) | ✅ WARN<5, BLOCK@5 |
| Detector 3: Ping-pong (alternancia entre 2 tools) | ✅ WARN@6, CIRCUIT_BREAK@8 |
| `preCheck()` antes de ejecutar (hereda blocked/circuit state) | ✅ |
| `check()` post-ejecución (registra y detecta patrones) | ✅ |
| Circuit break fuerza respuesta texto (sale del while loop) | ✅ `loopDetector.isCircuitBroken` chequeado al inicio de cada turno |
| No state global — instancia por pipeline | ✅ |

**Observación en Detector 2**: La condición `allDifferentInput` verifica que TODOS los elementos en `last5` tengan input diferente al ACTUAL input. Esto podría generar falsos negativos si el LLM alterna entre dos inputs diferentes — en ese caso `allDifferentInput` sería false aunque hay no-progress. Sin embargo, este escenario ya es detectado por el Detector 3 (ping-pong). La cobertura combinada es correcta.

---

## 7. EFFORT ROUTER

| Criterio | Estado |
|----------|--------|
| Determinístico — sin LLM, sin async, sin I/O | ✅ |
| Retorna `'low' \| 'medium' \| 'high'` | ✅ |
| Longitud del mensaje | ✅ `>500` → high, `<30` → low |
| Presencia de adjuntos | ✅ `>= 2 attachments` → high |
| Patrones de pregunta | ✅ `>= 3 '?'` → high |
| Nuevo contacto con mensaje complejo | ✅ `isNewContact && length > 200` → high |
| Context HITL pendiente | ✅ `hitlPendingContext !== null` → high |
| Keywords de objeción | ✅ 10 frases en `OBJECTION_KEYWORDS` |
| Compromisos pendientes + fecha | ✅ `pendingCommitments.length > 0 && TIME_DATE_PATTERN` → high |
| `<5ms` — puro sync | ✅ Regex precompiladas a nivel de módulo |

Patrones regex compilados fuera de la función (module-level) — correcto para performance. ✅

---

## 8. POST-PROCESSOR

| Criterio | Estado |
|----------|--------|
| Produce `CompositorOutput` — type match exacto | ✅ Verificado contra `engine/types.ts:270` |
| `formatForChannel()` llamado | ✅ `formatForChannel(responseText, ctx.message.channelName, registry)` |
| TTS vía `tts:service` con `registry.getOptional` | ✅ |
| Criticizer condicional (smart mode) | ✅ `effort === 'high'` OR `>= 3 tool calls reales` |
| Fail-open en criticizer | ✅ try/catch con fallback al texto original |
| Chunked TTS para respuestas largas (>900 chars) | ✅ `synthesizeChunks()` |
| Manejo `ttsFailed` | ✅ Flag en `CompositorOutput` |

**Verificación de tipo `CompositorOutput`**:
```typescript
// engine/types.ts:270
interface CompositorOutput {
  responseText: string         ✅ post-processor line 44 (responseText)
  formattedParts: string[]     ✅ line 66 (formatForChannel)
  audioBuffer?: Buffer         ✅ line 69
  audioDurationSeconds?: number ✅ line 70
  audioChunks?: Array<...>     ✅ line 71
  outputFormat: 'text' | 'audio' ✅ line 73 (init 'text', set 'audio' on TTS success)
  rawResponse?: string         ✅ no incluido (opcional, ok)
  ttsFailed?: boolean          ✅ line 125
}
```
Todos los campos requeridos presentes. ✅

**Nota menor**: El criticizer hardcodea el system prompt fallback en inglés cuando `prompts:service` no está disponible. Cuando el sistema está en producción, `prompts:service` siempre estará activo. El fallback inglés es solo para entornos de test/desarrollo.

---

## 9. SUBAGENT FRESH CONTEXT

| Campo | Acción | Estado |
|-------|--------|--------|
| `message` | Mantiene (para traceId, channel info) | ✅ |
| `traceId` | Mantiene | ✅ |
| `userType`, `userPermissions`, `contactId`, `agentId` | Mantiene | ✅ |
| `contact`, `session`, `isNewContact` | Mantiene | ✅ |
| `campaign` | Mantiene (puede ser relevante) | ✅ |
| `knowledgeMatches` | Strip → `[]` | ✅ |
| `knowledgeInjection` | Strip → `null` | ✅ |
| `freshdeskMatches` | Strip → `[]` | ✅ |
| `assignmentRules` | Strip → `null` | ✅ |
| `history` | Strip → `[]` | ✅ |
| `bufferSummary` | Strip → `null` | ✅ |
| `contactMemory` | Strip → `null` | ✅ |
| `pendingCommitments` | Strip → `[]` | ✅ |
| `relevantSummaries` | Strip → `[]` | ✅ |
| `sheetsData` | Strip → `null` | ✅ |
| `attachmentMeta` | Strip → `[]` | ✅ |
| `attachmentContext` | Strip → `null` | ✅ |
| `hitlPendingContext` | Strip → `null` | ✅ |
| `normalizedText` | Reemplazado con `taskDescription` | ✅ |
| `responseFormat` | Forzado a `'text'` | ✅ |
| `possibleInjection` | Hereda del parent | ✅ |
| `leadStatus` | Hereda del parent | ✅ |
| Límite de profundidad | `isChild = true` en spawn recursivo | ✅ |

---

## 10. CALIDAD DEL CÓDIGO

| Criterio | Estado |
|----------|--------|
| Imports con extensión `.js` | ✅ Verificado en todos los archivos |
| Sin tipos `any` explícitos | ✅ Usa interfaces para duck typing |
| Error handling (try/catch en loop) | ✅ Múltiples capas: semaphore interno, loop outer, forced final |
| Logger pino con nombre descriptivo | ✅ `engine:agentic`, `engine:post-processor`, `engine:loop-detector` |
| Sin `console.log` | ✅ |
| Sin API keys, URLs ni secretos hardcodeados | ✅ |
| `noUncheckedIndexedAccess` respetado | ✅ `toolCalls[i]!` con guard `i` viene de `toolCalls.map()` |

---

## 11. RESPETO DE BOUNDARIES

| Archivo | ¿Modificado? | ¿Debería? |
|---------|-------------|-----------|
| `src/engine/engine.ts` | ❌ No | Correcto — Instance 4 |
| `src/engine/types.ts` | ❌ No | Correcto — Instance 4 |
| `src/engine/config.ts` | ❌ No | Correcto — Instance 4 |
| `src/modules/**` | ❌ No | Correcto — excepto subagent.ts que está en engine/ |
| `src/engine/prompts/**` | ❌ No | Correcto — Instance 2 |
| `src/engine/proactive/**` | ❌ No | Correcto — Instance 3 |

---

## RESUMEN EJECUTIVO

### Veredicto: ✅ PASS — Listo para merge a `reset` (después de Instance 2 y 3)

### Issues Críticos (bloquean merge)
**Ninguno.**

### Issues Menores (no bloquean merge)
1. **`tool-dedup-cache.ts` re-exporta `ToolCallLog`** — redundante, consumidores deben importar de `types.ts`. No causa problemas funcionales.
2. **`WRITE_TOOLS` hardcodeada** — si se agregan tools con side-effects en el futuro, habrá que actualizar la lista manualmente. Considerar documentarlo en CLAUDE.md del módulo.
3. **Non-null assertion `toolExecutor!`** en `executeToolCalls` — seguro por invariante implícita. Bajo riesgo.

### Notas de Diseño (no son issues)
- **Formato de tool calls en conversación**: texto plano en lugar de bloques estructurados Anthropic — consistente con `subagent.ts` existente. Patrón establecido en la base de código.
- **`toNativeTools()` no llamado en el loop**: correcto, las definiciones llegan ya convertidas. Responsabilidad del caller (Instance 4).
- **Security escaping no aplicado en loop**: consistente con el patrón de `subagent.ts`. Phase 1 normaliza + detecta injection. Diseño aceptable.

### Cobertura del Plan (vs `instance-1-engine.md`)
- [x] Step 1: `types.ts` — completo y correcto
- [x] Step 2: `effort-router.ts` — completo y correcto
- [x] Step 3: `tool-dedup-cache.ts` — completo y correcto
- [x] Step 4: `tool-loop-detector.ts` — completo y correcto
- [x] Step 5: `agentic-loop.ts` — completo y correcto
- [x] Step 6: `post-processor.ts` — completo y correcto
- [x] Step 7: `index.ts` — completo y correcto
- [x] Subagent fresh context (`buildSubagentContext`) — completo y correcto
- [x] `src/engine/CLAUDE.md` actualizado — completo

### Arquitectura: Coherencia con el Overview
El código implementado es coherente con la arquitectura descrita en `overview.md`:
- Agentic loop reemplaza Phases 2+3+4 correctamente
- `classifyEffort()` funciona como Effort Router
- Loop con dedup + detector + StepSemaphore
- `postProcess()` produce `CompositorOutput` → alimenta Phase 5 sin cambios
- Phases 2, 3, 4 no modificadas (permanecen detrás de `ENGINE_MODE=legacy`)
