# OLA 3 — Reporte de Prompt Injection & Escapado
## Fecha: 2026-03-26
## Branch: claude/apply-audit-adjustments-H0ud1

### Fixes aplicados
| # | ID | Descripcion | Estado | Notas |
|---|---|---|---|---|
| 1 | SEC-2.x | Funcion centralizada `escapeForPrompt()` | ✅ | Trunca, escapa code fences, tokens de instruccion ([INST], <<SYS>>), tokens especiales (<\|), colapsa newlines |
| 2 | SEC-2.1 | Escapar normalizedText en evaluator | ✅ | `wrapUserContent()` con boundary markers en evaluator reactivo |
| 3 | SEC-2.2 | Escapar datos de DB en evaluator | ✅ | `escapeDataForPrompt()` en memory summary, key facts, commitments, assignment rules, history, summaries. Aplicado tanto en evaluator reactivo como proactivo |
| 4 | SEC-2.3 | Escapar step descriptions en subagent | ✅ | `escapeDataForPrompt()` en step.description y step.params (second-order injection). Tambien escapado del mensaje original |
| 5 | SEC-2.6 | Escapar tool results y historial en compositor | ✅ | `escapeDataForPrompt()` en execution results, memory, commitments, summaries, knowledge. `escapeHistory()` en historial. `wrapUserContent()` en mensaje |
| 6 | SEC-2.4 | Trust boundary markers menos predecibles | ✅ | UUID-based boundaries en `injection-validator.ts`. `createTrustBoundary()` genera markers imposibles de adivinar |

### Archivos creados
- `src/engine/utils/prompt-escape.ts` — utilidad centralizada de escapado para prompts LLM
- `tests/engine/prompt-escape.test.ts` — 15 tests para escapeForPrompt, wrapUserContent, escapeDataForPrompt, escapeHistory

### Archivos modificados
- `src/engine/prompts/evaluator.ts` — import + escapado en 8 puntos de interpolacion (reactivo + proactivo)
- `src/engine/prompts/compositor.ts` — import + escapado en 7 puntos de interpolacion
- `src/engine/prompts/subagent.ts` — import + escapado en 3 puntos de interpolacion
- `src/engine/attachments/injection-validator.ts` — import crypto, `createTrustBoundary()` con UUID, markers dinamicos

### Puntos de interpolacion encontrados y escapados
| Archivo | Linea aprox | Que se interpola | Escapado aplicado |
|---|---|---|---|
| evaluator.ts | 94 | ctx.session.compressedSummary | escapeDataForPrompt |
| evaluator.ts | 101 | cm.summary | escapeDataForPrompt |
| evaluator.ts | 106 | f.fact (key_facts) | escapeDataForPrompt |
| evaluator.ts | 116 | c.description (commitments) | escapeDataForPrompt |
| evaluator.ts | 124 | s.summaryText (relevant summaries) | escapeDataForPrompt |
| evaluator.ts | 161 | rule.listName, rule.prompt | escapeDataForPrompt |
| evaluator.ts | 169 | match.content (knowledge) | escapeDataForPrompt |
| evaluator.ts | 189 | msg.content (history) | escapeForPrompt |
| evaluator.ts | 209 | ctx.normalizedText | wrapUserContent |
| evaluator.ts | 313 | contactMemory.summary (proactive) | escapeDataForPrompt |
| evaluator.ts | 317 | f.fact (proactive key_facts) | escapeDataForPrompt |
| evaluator.ts | 326 | c.description (proactive commitment) | escapeDataForPrompt |
| evaluator.ts | 340 | c.description (proactive pending) | escapeDataForPrompt |
| evaluator.ts | 348 | msg.content (proactive history) | escapeForPrompt |
| subagent.ts | 34 | step.description | escapeDataForPrompt |
| subagent.ts | 37 | step.params (JSON) | escapeDataForPrompt |
| subagent.ts | 48 | ctx.normalizedText | wrapUserContent |
| compositor.ts | 164 | result.data (tool results) | escapeDataForPrompt |
| compositor.ts | 166 | result.error | escapeDataForPrompt |
| compositor.ts | 175 | cm.summary | escapeDataForPrompt |
| compositor.ts | 180 | f.fact | escapeDataForPrompt |
| compositor.ts | 184 | cm.relationship_notes | escapeDataForPrompt |
| compositor.ts | 192 | c.description (commitments) | escapeDataForPrompt |
| compositor.ts | 201 | s.summaryText | escapeDataForPrompt |
| compositor.ts | 209 | match.content (knowledge) | escapeDataForPrompt |
| compositor.ts | 217 | history messages | escapeHistory |
| compositor.ts | 224 | ctx.normalizedText | wrapUserContent |
| injection-validator.ts | 68 | trust boundary markers | createTrustBoundary (UUID) |

### Decisiones tecnicas
- **escapeForPrompt no es destructivo**: preserva texto normal (letras, numeros, puntuacion comun) intacto. Solo transforma secuencias peligrosas.
- **Truncado primero**: se trunca antes de escapar para no procesar texto que sera descartado.
- **Limites diferenciados**: user messages=5000 chars, DB data=3000, history per-message=500, step params=1000.
- **Proactive evaluator incluido**: el escapado se aplico tanto al evaluator reactivo como al proactivo.
- **Trust boundaries con UUID**: imposibles de predecir/falsificar dentro del contenido del documento.

### Build: ✅ (0 errores)
### Tests: ✅ 64/64 passed (15 nuevos + 49 existentes)
