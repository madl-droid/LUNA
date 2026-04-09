# OVERVIEW — Optimización del Módulo Lead-Scoring

## Diagnóstico

El módulo de calificación tiene valor real pero sufre de sobre-ingeniería que lo hace costoso, complejo de mantener y difícil de configurar para el admin.

### Problemas identificados (por impacto)

1. **Extracción con LLM redundante**: Cada `extract_qualification` hace una llamada LLM extra (ruteada a `main` = modelo caro) cuando el agentic loop YA tiene toda la info. En multi-framework, puede ser DOBLE llamada LLM (detección de client_type + extracción).
2. **Multi-framework innecesario**: 3 frameworks (CHAMP/SPIN/CHAMP+Gov) con 16-25 criterios cada uno. El 99% de tenants usa UN solo tipo de venta. La detección de client_type es complejidad sin retorno.
3. **Pesos manuales hostiles**: El admin debe distribuir pesos que sumen exactamente 100. Quitar un criterio rompe la suma y bloquea el guardado.
4. **Nightly scoring con LLM**: El batch nocturno gasta una llamada LLM POR CADA cold lead para "opinar" si vale la pena reactivar. El scoring engine por código ya puede decidir esto.
5. **Batch recalc sin cursor**: `getAllLeadsForRecalc()` carga TODOS los leads a memoria sin LIMIT.
6. **Enum scoring sesgado por posición**: Asume que la última opción de un enum siempre es "la mejor", lo cual no aplica a todos los criterios.
7. **Sin decay temporal**: Datos de hace 6 meses pesan igual que datos de ayer.
8. **qualifying.json desincronizado**: El archivo en disco tiene formato viejo (BANT plano), se migra en runtime.
9. **Config de consola sobredimensionada**: UI con 3 framework cards, toggles, multi-objetivo — para algo que el admin hace una vez.

### Valor del módulo

El módulo ES necesario. Sin calificación, LUNA trata a todos los leads igual. El concepto es correcto: extracción natural → scoring por código → state machine → decisiones automáticas. La implementación necesita poda agresiva.

## Estrategia de ejecución

```
Plan 1 (Secuencial - debe ir primero)
  │
  ├──→ Plan 2 (Paralelo)
  │
  └──→ Plan 3 (Paralelo)
```

### Plan 1: Core — Simplificación del Config y Scoring
**SECUENCIAL — Base para los demás planes.**
- Matar multi-framework → un framework activo por tenant
- Simplificar tipos, config-store, presets
- Pesos por prioridad (high/medium/low) en vez de suma manual a 100
- Scoring de enums con modo configurable
- Migración de qualifying.json
- Actualizar scoring-engine

### Plan 2: Extracción Zero-LLM
**PARALELO con Plan 3 — Después de Plan 1.**
- Refactorizar `extract_qualification` a tool code-only (sin llamada LLM interna)
- El agentic loop pasa datos estructurados como parámetros del tool
- Matar nightly cold-lead scoring con LLM → recalc por código
- Agregar decay temporal al scoring
- Eliminar prompts de extracción obsoletos

### Plan 3: Console, Operacional y Documentación
**PARALELO con Plan 2 — Después de Plan 1.**
- Simplificar UI de console para framework único
- Batch recalc con cursor/paginación
- Limpiar API routes obsoletos
- Actualizar CLAUDE.md del módulo, raíz, y docs

## Archivos afectados por plan

### Plan 1 (Core)
| Archivo | Cambio |
|---------|--------|
| `src/modules/lead-scoring/types.ts` | Eliminar multi-fw types, agregar priority, enumScoring |
| `src/modules/lead-scoring/frameworks.ts` | Simplificar presets, agregar priority a criterios |
| `src/modules/lead-scoring/config-store.ts` | Single framework, migración old→new |
| `src/modules/lead-scoring/scoring-engine.ts` | Quitar multi-fw routing, priority weights, enum fix |
| `src/modules/lead-scoring/manifest.ts` | Simplificar API routes |
| `instance/qualifying.json` | Nuevo formato single-framework |
| `docs/architecture/lead-status.md` | Actualizar |

### Plan 2 (Extracción)
| Archivo | Cambio |
|---------|--------|
| `src/modules/lead-scoring/extract-tool.ts` | Refactor completo: code-only, sin LLM |
| `src/engine/prompts/context-builder.ts` | Guía de extracción para agentic loop |
| `src/engine/proactive/jobs/nightly-batch.ts` | Eliminar scoreColdLeads LLM |
| `src/modules/lead-scoring/scoring-engine.ts` | Agregar decay temporal |
| `instance/prompts/system/lead-scoring-extraction.md` | Eliminar |
| `instance/prompts/system/cold-lead-scoring.md` | Eliminar |

### Plan 3 (Console + Docs)
| Archivo | Cambio |
|---------|--------|
| `src/modules/lead-scoring/templates.ts` | Simplificar para single framework |
| `src/modules/lead-scoring/ui/lead-scoring.html` | Actualizar UI |
| `src/modules/lead-scoring/pg-queries.ts` | Cursor-based batch recalc |
| `src/modules/lead-scoring/CLAUDE.md` | Reescribir para v3 |
| `CLAUDE.md` (raíz) | Actualizar entrada lead-scoring |
| `docs/architecture/lead-status.md` | Actualizar si queda pendiente |

## Métricas de éxito

- **0 llamadas LLM** para extracción de calificación (vs 1-2 actuales por mensaje)
- **0 llamadas LLM** en nightly batch scoring (vs N actuales por cold lead)
- **Config admin en <2 minutos**: elegir preset, ajustar 1-2 criterios, guardar
- **Compilación limpia**: `npx tsc --noEmit` sin errores
- **qualifying.json migra automáticamente** desde formatos anteriores
