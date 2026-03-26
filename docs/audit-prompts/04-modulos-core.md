# Auditoría: Módulos Core

Eres un auditor de código senior. Tu tarea es hacer una auditoría EXHAUSTIVA de los módulos core del sistema LUNA. NO hagas cambios en el código, solo analiza y genera un informe.

## REGLA DE LECTURA

IMPORTANTE: Son 6 módulos con ~14,900 líneas totales. Para evitar colapsar el contexto:
- Lee cada archivo en bloques de máximo 200 líneas
- Si un archivo tiene más de 200 líneas, léelo en fases (líneas 1-200, luego 201-400, etc.)
- Toma notas de hallazgos de cada módulo antes de pasar al siguiente
- Audita módulo por módulo, no todos a la vez
- Console es el más grande (~6,500 LOC) — dale fases extra

### Fase 1: LLM Gateway (lee primero — es el provider central)
- Lee todos los archivos .ts en src/modules/llm/ (9 archivos)

### Fase 2: Memory
- Lee todos los archivos .ts en src/modules/memory/ (5 archivos)

### Fase 3: Users
- Lee todos los archivos .ts en src/modules/users/ (11 archivos)

### Fase 4: Console (el más grande — usa sub-fases)
- src/modules/console/manifest.ts y manifest-ref.ts (primero)
- src/modules/console/server.ts (puede ser largo — lee en bloques)
- src/modules/console/templates.ts (puede ser largo — lee en bloques)
- src/modules/console/templates-fields.ts
- src/modules/console/templates-sections.ts
- src/modules/console/templates-i18n.ts
- src/modules/console/templates-channel-settings.ts
- src/modules/console/templates-modules.ts
- src/modules/console/ui/ (si tiene archivos)

### Fase 5: Prompts
- Lee todos los archivos .ts en src/modules/prompts/ (4 archivos)

### Fase 6: Model Scanner
- Lee todos los archivos .ts en src/modules/model-scanner/ (2 archivos)

## Qué auditar por módulo:

### LLM Gateway
- ¿Circuit breaker: configuración, thresholds, recovery? ¿Funciona correctamente?
- ¿Fallback chain Anthropic → Google: ¿qué pasa si ambos caen?
- ¿Token tracking: ¿es preciso? ¿Hay budget limits?
- ¿Request queuing o throttling?
- ¿Streaming support?
- ¿API key rotation/management?
- ¿Error handling: retries, timeouts, partial responses?
- ¿Logging de costos?

### Memory
- ¿Conversaciones se almacenan correctamente en PG y Redis?
- ¿Redis como cache, PG como persistent — ¿sync es correcto?
- ¿pgvector: embeddings quality, index type, search accuracy?
- ¿Memory pruning/TTL?
- ¿Hay memory leaks en Redis?
- ¿SQL queries son parametrizadas?
- ¿Contact history cross-channel?

### Users
- ¿Modelo de permisos: roles, capabilities?
- ¿Validación de input en CRUD de usuarios?
- ¿Búsqueda de usuarios es eficiente?
- ¿Hay escalation de privilegios posible?
- ¿Datos sensibles (PII) manejados correctamente?

### Console
- ¿SSR templates tienen XSS vulnerabilities?
- ¿Auth en todas las rutas?
- ¿CSRF protection?
- ¿Input validation en formularios?
- ¿Los templates son mantenibles o son un monolito?
- ¿Responsive/accesible?
- ¿Hay lógica de negocio mezclada con presentación?

### Prompts
- ¿Prompt injection protection?
- ¿Slot system es flexible y seguro?
- ¿Campaigns no pueden overridear guardrails?
- ¿Agent name configurable funciona?

### Model Scanner
- ¿Qué modelos detecta?
- ¿Cómo maneja modelos no soportados?
- ¿Scan frequency?

## Formato del informe

Genera el archivo: docs/reports/audit/04-modulos-core.md

```markdown
# Auditoría: Módulos Core
Fecha: [fecha de ejecución]
Auditor: Claude (sesión automatizada)

## Resumen ejecutivo
(3-5 líneas del estado general)

## Inventario
| Módulo | Archivos | LOC | Type | Depends | Estado |
|--------|----------|-----|------|---------|--------|

## LLM Gateway
### Fortalezas
### Problemas encontrados
(cada uno con: severidad [CRÍTICO/ALTO/MEDIO/BAJO], descripción, archivo:línea, impacto, recomendación)
### Services expuestos
### Hooks emitidos/consumidos
### Madurez: X/5

## Memory
### Fortalezas
### Problemas encontrados
### Services expuestos
### Hooks emitidos/consumidos
### Madurez: X/5

## Users
### Fortalezas
### Problemas encontrados
### Services expuestos
### Hooks emitidos/consumidos
### Madurez: X/5

## Console
### Fortalezas
### Problemas encontrados
### Rutas HTTP
### Madurez: X/5

## Prompts
### Fortalezas
### Problemas encontrados
### Services expuestos
### Madurez: X/5

## Model Scanner
### Fortalezas
### Problemas encontrados
### Madurez: X/5

## Inter-module analysis
### ¿Cómo se comunican entre sí via hooks/services?
### ¿Hay acoplamiento oculto (imports directos)?
### ¿Dependencias circulares?

## Bugs encontrados
| # | Severidad | Módulo | Archivo:Línea | Descripción | Impacto |
|---|-----------|--------|---------------|-------------|---------|

## Riesgos de seguridad
| # | Severidad | Módulo | Descripción | Vector de ataque | Mitigación |
|---|-----------|--------|-------------|-------------------|------------|

## Deuda técnica
| # | Prioridad | Módulo | Descripción | Esfuerzo estimado |
|---|-----------|--------|-------------|-------------------|

## Madurez general módulos core: X/5

## Top 10 recomendaciones (ordenadas por impacto)
1. ...
```

IMPORTANTE: Lee CADA archivo completo (en bloques). Los módulos core son la columna vertebral — analiza interacciones entre ellos vía hooks y services. Busca imports directos entre módulos (violación de arquitectura).
