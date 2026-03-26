# Auditoría: Engine & Pipeline

Eres un auditor de código senior. Tu tarea es hacer una auditoría EXHAUSTIVA del engine y pipeline de procesamiento de mensajes del sistema LUNA. NO hagas cambios en el código, solo analiza y genera un informe.

## REGLA DE LECTURA

IMPORTANTE: El engine tiene ~45 archivos y ~9,400 líneas. Para evitar colapsar el contexto:
- Lee cada archivo en bloques de máximo 200 líneas
- Si un archivo tiene más de 200 líneas, léelo en fases (líneas 1-200, luego 201-400, etc.)
- Toma notas de hallazgos de cada bloque antes de pasar al siguiente
- Agrupa la lectura en fases temáticas (primero core, luego phases, luego concurrency, etc.)
- No intentes leer todos los archivos a la vez

### Fase 1 de lectura: Core + Types (lee primero)
- src/engine/engine.ts
- src/engine/config.ts
- src/engine/types.ts
- src/engine/index.ts

### Fase 2 de lectura: Las 5 fases del pipeline
- src/engine/phases/phase1-intake.ts
- src/engine/phases/phase2-evaluate.ts
- src/engine/phases/phase3-execute.ts
- src/engine/phases/phase4-compose.ts
- src/engine/phases/phase5-validate.ts

### Fase 3 de lectura: Concurrency
- src/engine/concurrency/contact-lock.ts
- src/engine/concurrency/index.ts
- src/engine/concurrency/pipeline-semaphore.ts
- src/engine/concurrency/step-semaphore.ts

### Fase 4 de lectura: Attachments
- src/engine/attachments/audio-transcriber.ts
- src/engine/attachments/classifier.ts
- src/engine/attachments/injection-validator.ts
- src/engine/attachments/migration.ts
- src/engine/attachments/processor.ts
- src/engine/attachments/tools/query-attachment.ts
- src/engine/attachments/tools/web-explore.ts
- src/engine/attachments/types.ts
- src/engine/attachments/url-extractor.ts

### Fase 5 de lectura: ACK + Proactive
- src/engine/ack/ack-defaults.ts
- src/engine/ack/ack-service.ts
- src/engine/ack/types.ts
- src/engine/proactive/commitment-detector.ts
- src/engine/proactive/commitment-validator.ts
- src/engine/proactive/guards.ts
- src/engine/proactive/proactive-config.ts
- src/engine/proactive/proactive-pipeline.ts
- src/engine/proactive/proactive-runner.ts
- src/engine/proactive/triggers.ts
- src/engine/proactive/jobs/cache-refresh.ts
- src/engine/proactive/jobs/commitment-check.ts
- src/engine/proactive/jobs/follow-up.ts
- src/engine/proactive/jobs/nightly-batch.ts
- src/engine/proactive/jobs/reactivation.ts
- src/engine/proactive/jobs/reminder.ts
- src/engine/proactive/tools/create-commitment.ts

### Fase 6 de lectura: Subagent + Prompts + Utils + Fallbacks
- src/engine/subagent/guardrails.ts
- src/engine/subagent/subagent.ts
- src/engine/prompts/compositor.ts
- src/engine/prompts/evaluator.ts
- src/engine/prompts/subagent.ts
- src/engine/fallbacks/error-defaults.ts
- src/engine/fallbacks/fallback-loader.ts
- src/engine/utils/injection-detector.ts
- src/engine/utils/llm-client.ts
- src/engine/utils/message-formatter.ts
- src/engine/utils/normalizer.ts
- src/engine/utils/rag-local.ts
- src/engine/mocks/tool-registry.ts

### Fase 7 de lectura: Docs de referencia (secciones relevantes)
- docs/architecture/pipeline.md
- docs/architecture/concurrency.md
- docs/reports/engine-audit-report.md (si existe, comparar con estado actual)

## Qué auditar:

### 1. Pipeline (5 fases)
- ¿El flujo de datos entre fases es consistente y type-safe?
- ¿Cada fase maneja errores correctamente o puede dejar el pipeline en estado inconsistente?
- ¿Hay timeout por fase y timeout global?
- ¿Qué pasa si una fase es muy lenta o se cuelga?
- ¿Phase1 normaliza correctamente todos los tipos de mensajes (texto, audio, imagen, documento)?
- ¿Phase2 (evaluate) puede tomar decisiones incorrectas? ¿Edge cases?
- ¿Phase3 (execute) maneja tool failures gracefully?
- ¿Phase4 (compose) puede generar respuestas vacías o malformadas?
- ¿Phase5 (validate) realmente valida todo lo necesario? ¿Puede dejar pasar contenido peligroso?

### 2. Concurrency
- ¿Contact lock previene race conditions efectivamente?
- ¿Pipeline semaphore tiene deadlock potential?
- ¿Step semaphore es necesario además del pipeline semaphore?
- ¿Qué pasa si un lock nunca se libera (crash mid-pipeline)?
- ¿Hay starvation posible?
- ¿Los timeouts de locks son adecuados?

### 3. Attachments
- ¿Audio transcription maneja archivos grandes?
- ¿Classifier puede ser engañado?
- ¿Injection validator cubre todos los vectores?
- ¿URL extractor es seguro contra SSRF?
- ¿Hay file size limits?
- ¿Se validan MIME types?

### 4. ACK system
- ¿Los acknowledgments tienen timeout?
- ¿Qué pasa con ACKs duplicados?
- ¿ACK system tiene memory leaks?

### 5. Proactive system
- ¿Commitment detector tiene false positives/negatives?
- ¿Los jobs de BullMQ tienen retry logic correcta?
- ¿Nightly batch puede overlap con jobs individuales?
- ¿Follow-up y reactivation tienen rate limiting (no spamear al lead)?
- ¿Los guards son suficientes?

### 6. Subagent
- ¿Guardrails son efectivos?
- ¿Hay límite de recursión?
- ¿Budget/token limits?

### 7. Prompts
- ¿Los prompts tienen injection protection?
- ¿Son mantenibles?
- ¿Hay prompts hardcodeados fuera de este directorio?

### 8. Utils
- ¿Injection detector es completo?
- ¿LLM client maneja rate limits y errors?
- ¿RAG local tiene quality issues?

## Formato del informe

Genera el archivo: docs/reports/audit/02-engine-pipeline.md

```markdown
# Auditoría: Engine & Pipeline
Fecha: [fecha de ejecución]
Auditor: Claude (sesión automatizada)

## Resumen ejecutivo
(3-5 líneas del estado general)

## Inventario
| Archivo | LOC | Propósito | Estado |
|---------|-----|-----------|--------|

## Hallazgos por componente

### Pipeline Core (engine.ts)
#### Fortalezas
#### Problemas encontrados
(cada uno con: severidad [CRÍTICO/ALTO/MEDIO/BAJO], descripción, archivo:línea, impacto, recomendación)
#### Madurez: X/5

### Phase 1 - Intake
(mismo formato)

### Phase 2 - Evaluate
(mismo formato)

### Phase 3 - Execute
(mismo formato)

### Phase 4 - Compose
(mismo formato)

### Phase 5 - Validate
(mismo formato)

### Concurrency System
(mismo formato)

### Attachments System
(mismo formato)

### ACK System
(mismo formato)

### Proactive System
(mismo formato)

### Subagent System
(mismo formato)

### Prompts
(mismo formato)

### Utils
(mismo formato)

## Bugs encontrados
| # | Severidad | Archivo:Línea | Descripción | Impacto |
|---|-----------|---------------|-------------|---------|

## Riesgos de seguridad
| # | Severidad | Descripción | Vector de ataque | Mitigación recomendada |
|---|-----------|-------------|-------------------|------------------------|

## Deuda técnica
| # | Prioridad | Descripción | Esfuerzo estimado |
|---|-----------|-------------|-------------------|

## Madurez general: X/5
(justificación)

## Top 10 recomendaciones (ordenadas por impacto)
1. ...
```

IMPORTANTE: Lee CADA archivo completo (en bloques). Basa cada hallazgo en código real con líneas específicas. El engine es el corazón del sistema — sé especialmente riguroso con concurrencia y seguridad.
