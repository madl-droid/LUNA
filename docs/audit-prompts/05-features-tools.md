# Auditoría: Módulos Feature & Tools

Eres un auditor de código senior. Tu tarea es hacer una auditoría EXHAUSTIVA de los módulos feature y tools del sistema LUNA. NO hagas cambios en el código, solo analiza y genera un informe.

## REGLA DE LECTURA

IMPORTANTE: Son ~14,600 líneas en múltiples módulos. Para evitar colapsar el contexto:
- Lee cada archivo en bloques de máximo 200 líneas
- Si un archivo tiene más de 200 líneas, léelo en fases (líneas 1-200, luego 201-400, etc.)
- Toma notas de hallazgos de cada módulo antes de pasar al siguiente
- Knowledge es el módulo más grande (20 archivos) — divide en sub-fases
- No intentes leer todo a la vez

### Fase 1: Knowledge - core (lee primero)
- src/modules/knowledge/manifest.ts
- src/modules/knowledge/types.ts
- src/modules/knowledge/knowledge-manager.ts
- src/modules/knowledge/search-engine.ts
- src/modules/knowledge/embedding-service.ts

### Fase 2: Knowledge - storage y sync
- src/modules/knowledge/pg-store.ts
- src/modules/knowledge/cache.ts
- src/modules/knowledge/sync-manager.ts
- src/modules/knowledge/web-source-manager.ts
- src/modules/knowledge/faq-manager.ts
- src/modules/knowledge/vectorize-worker.ts
- src/modules/knowledge/api-connector.ts

### Fase 3: Knowledge - extractors
- src/modules/knowledge/extractors/index.ts
- src/modules/knowledge/extractors/chunker.ts
- src/modules/knowledge/extractors/markdown.ts
- src/modules/knowledge/extractors/pdf.ts
- src/modules/knowledge/extractors/docx.ts
- src/modules/knowledge/extractors/xlsx.ts
- src/modules/knowledge/extractors/slides.ts
- src/modules/knowledge/extractors/image.ts

### Fase 4: Lead Scoring
- Lee todos los archivos .ts en src/modules/lead-scoring/ (11 archivos)

### Fase 5: Tools + Scheduled Tasks
- Lee todos los archivos .ts en src/modules/tools/ (6 archivos)
- Lee todos los archivos .ts en src/modules/scheduled-tasks/ (7 archivos)

### Fase 6: Freight & Freshdesk (module wrappers + tool implementations)
- src/modules/freight/manifest.ts
- src/modules/freshdesk/manifest.ts
- Lee todos los archivos .ts en src/tools/freight/ (6 archivos)
- Lee todos los archivos .ts en src/tools/freshdesk/ (6 archivos)

### Fase 7: Tests existentes
- tests/freight/dhl-express-adapter.test.ts
- tests/freight/freight-router.test.ts
- tests/freight/freight-tool.test.ts
- tests/freight/searates-adapter.test.ts

## Qué auditar:

### Knowledge
- ¿Búsqueda híbrida (keyword + vector) funciona correctamente?
- ¿Embedding service: modelo, dimensiones, batching?
- ¿Chunking strategy: tamaño, overlap, calidad?
- ¿Extractors: ¿cada formato se extrae correctamente?
- ¿PDF, DOCX, XLSX: edge cases (archivos corruptos, muy grandes, encriptados)?
- ¿Sync manager: ¿drive sync es robusto? ¿Conflictos?
- ¿Web sources: ¿SSRF protection? ¿Rate limiting?
- ¿FAQ manager: ¿CRUD completo? ¿Search quality?
- ¿pgvector indexes: ¿tipo correcto (ivfflat vs hnsw)?
- ¿Cache invalidation?
- ¿Vectorize worker: ¿maneja backpressure? ¿Retry en failures?

### Lead Scoring
- ¿BANT scoring: ¿criterios son configurables?
- ¿Custom scoring rules?
- ¿Score calculation: ¿es determinista o depende del LLM?
- ¿Race condition si dos mensajes del mismo lead llegan juntos?
- ¿Histórico de scores?
- ¿Console UI: ¿muestra datos correctos?

### Tools
- ¿Registry de tools: ¿tipado, validación de inputs/outputs?
- ¿Tool execution: ¿timeouts, error handling?
- ¿Tool calling nativo: ¿funciona con Anthropic y Google?
- ¿Hay tools que podrían ser peligrosas (file access, shell exec)?

### Scheduled Tasks
- ¿Cron expressions validadas?
- ¿BullMQ job: retry, backoff, dead letter queue?
- ¿Qué pasa si el server se reinicia con jobs pendientes?
- ¿Overlap prevention (mismo job corriendo 2 veces)?
- ¿LLM execution en jobs: ¿budget control?

### Freight & Freshdesk (tools)
- ¿API integrations: ¿error handling, timeouts, retries?
- ¿Input validation?
- ¿API keys management?
- ¿Rate limiting?
- ¿Tests existentes: ¿calidad? ¿cobertura? ¿mocking adecuado?

## Formato del informe

Genera el archivo: docs/reports/audit/05-features-tools.md

```markdown
# Auditoría: Módulos Feature & Tools
Fecha: [fecha de ejecución]
Auditor: Claude (sesión automatizada)

## Resumen ejecutivo
(3-5 líneas del estado general)

## Inventario
| Módulo/Tool | Archivos | LOC | Type | Estado |
|-------------|----------|-----|------|--------|

## Knowledge Base
### Fortalezas
### Problemas encontrados
(cada uno con: severidad [CRÍTICO/ALTO/MEDIO/BAJO], descripción, archivo:línea, impacto, recomendación)
### Extractors analysis
| Formato | Archivo | Funcional | Edge cases cubiertos | Issues |
|---------|---------|-----------|---------------------|--------|
### Search quality assessment
### Madurez: X/5

## Lead Scoring
### Fortalezas
### Problemas encontrados
### Madurez: X/5

## Tools Registry
### Fortalezas
### Problemas encontrados
### Tools registradas
### Madurez: X/5

## Scheduled Tasks
### Fortalezas
### Problemas encontrados
### Jobs definidos
### Madurez: X/5

## Freight Tool
### Fortalezas
### Problemas encontrados
### Test coverage
### Madurez: X/5

## Freshdesk Tool
### Fortalezas
### Problemas encontrados
### Madurez: X/5

## Tests Analysis
| Test file | Tests | Pass/Fail | Coverage | Quality |
|-----------|-------|-----------|----------|---------|
### ¿Qué falta por testear?

## Bugs encontrados
| # | Severidad | Módulo | Archivo:Línea | Descripción | Impacto |
|---|-----------|--------|---------------|-------------|---------|

## Riesgos de seguridad
| # | Severidad | Módulo | Descripción | Mitigación |
|---|-----------|--------|-------------|------------|

## Deuda técnica
| # | Prioridad | Módulo | Descripción | Esfuerzo |
|---|-----------|--------|-------------|----------|

## Madurez general features: X/5

## Top 10 recomendaciones (ordenadas por impacto)
1. ...
```

IMPORTANTE: Knowledge es el módulo más grande — dale atención extra. Evalúa la calidad de los 4 tests existentes (son los ÚNICOS tests del proyecto).
