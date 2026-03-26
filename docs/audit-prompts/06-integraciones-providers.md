# Auditoría: Integraciones & Providers

Eres un auditor de código senior. Tu tarea es hacer una auditoría EXHAUSTIVA de los módulos de integración y providers del sistema LUNA. NO hagas cambios en el código, solo analiza y genera un informe.

## REGLA DE LECTURA

IMPORTANTE: Son ~7,300 líneas. Para evitar colapsar el contexto:
- Lee cada archivo en bloques de máximo 200 líneas
- Si un archivo tiene más de 200 líneas, léelo en fases (líneas 1-200, luego 201-400, etc.)
- Toma notas de hallazgos de cada módulo antes de pasar al siguiente
- Audita módulo por módulo

### Fase 1: Google Apps (lee primero — es el provider base de OAuth2)
- Lee todos los archivos .ts en src/modules/google-apps/ (9 archivos)
- Presta atención especial a: OAuth2 flow, token storage, refresh logic

### Fase 2: Medilink / HealthAtom
- Lee todos los archivos .ts en src/modules/medilink/ (10 archivos)
- Presta atención especial a: datos médicos, webhooks, API auth

### Fase 3: Engine wrapper
- src/modules/engine/manifest.ts

### Fase 4: Cross-cutting analysis
- Busca en src/modules/ imports directos entre módulos (grep por imports de '../otro-modulo/')
- Verifica cómo estos módulos exponen services al registry
- Verifica hooks emitidos y consumidos

### Fase 5: Docs de referencia
- docs/architecture/module-system.md (sección de services y hooks, solo lo relevante)

## Qué auditar:

### Google Apps
- ¿OAuth2 flow: ¿es seguro? ¿Token storage encriptado?
- ¿Token refresh: ¿automático? ¿Qué pasa si refresh falla?
- ¿Scopes: ¿mínimos necesarios o over-permissioned?
- ¿Drive integration: ¿file access control? ¿Shared drives?
- ¿Sheets: ¿write es async como dice CLAUDE.md? ¿Postgres es fuente de verdad?
- ¿Calendar: ¿conflict detection? ¿Timezone handling?
- ¿Docs/Slides: ¿read-only o read-write? ¿Qué operaciones?
- ¿Rate limits de Google APIs manejados?
- ¿Error handling por API (cada una tiene límites distintos)?
- ¿Batch requests?

### Medilink / HealthAtom
- ¿Es HIPAA-aware? ¿Datos médicos encriptados en tránsito y reposo?
- ¿Pacientes: ¿búsqueda, CRUD, validación de datos?
- ¿Citas: ¿disponibilidad, conflictos, cancelación?
- ¿Follow-up: ¿lógica de recordatorios? ¿No spam?
- ¿Webhooks: ¿validación de signature? ¿Replay protection?
- ¿API authentication con HealthAtom?
- ¿Timeout y retry en llamadas a API externa?
- ¿Qué pasa si Medilink/HealthAtom está caído?
- ¿Logging de datos médicos (no debería loguearse PII médica)?

### Engine wrapper
- ¿Simplemente expone el engine al kernel?
- ¿Hay lógica adicional?
- ¿Es necesario o podría ser más simple?

### Cross-cutting: Inter-module communication
- ¿Los hooks que emiten son documentados y consistentes?
- ¿Otros módulos consumen estos services correctamente?
- ¿Hay acoplamiento oculto (imports directos entre módulos)?
- ¿Las dependencias declaradas en manifest.depends son correctas y completas?

## Formato del informe

Genera el archivo: docs/reports/audit/06-integraciones-providers.md

```markdown
# Auditoría: Integraciones & Providers
Fecha: [fecha de ejecución]
Auditor: Claude (sesión automatizada)

## Resumen ejecutivo
(3-5 líneas del estado general)

## Inventario
| Módulo | Archivos | LOC | Type | Depends | APIs externas | Estado |
|--------|----------|-----|------|---------|---------------|--------|

## Google Apps
### OAuth2 Security Assessment
- Token storage: [encriptado/plano]
- Token refresh: [automático/manual]
- Scopes solicitados vs necesarios
### Por servicio
#### Drive
#### Sheets
#### Calendar
#### Docs
#### Slides
### Fortalezas
### Problemas encontrados
(cada uno con: severidad [CRÍTICO/ALTO/MEDIO/BAJO], descripción, archivo:línea, impacto, recomendación)
### Rate limit handling
### Madurez: X/5

## Medilink / HealthAtom
### Data Privacy Assessment
- ¿PII médica protegida?
- ¿Logging sanitizado?
- ¿Datos encriptados?
### Por funcionalidad
#### Pacientes
#### Citas / Disponibilidad
#### Follow-up
#### Webhooks
### Fortalezas
### Problemas encontrados
### API resilience (timeout, retry, circuit breaker)
### Madurez: X/5

## Engine Wrapper
### Assessment
### ¿Es necesario?
### Madurez: X/5

## Inter-module Communication Analysis
### Services expuestos
| Módulo | Service name | Métodos | Consumidores |
### Hooks
| Módulo | Hook emitido | Consumidores | Documentado |
### Imports directos encontrados (violaciones)
| Archivo origen | Importa de | Debería usar |

## Bugs encontrados
| # | Severidad | Módulo | Archivo:Línea | Descripción | Impacto |
|---|-----------|--------|---------------|-------------|---------|

## Riesgos de seguridad
| # | Severidad | Módulo | Descripción | Vector de ataque | Mitigación |
|---|-----------|--------|-------------|-------------------|------------|

## Deuda técnica
| # | Prioridad | Módulo | Descripción | Esfuerzo |
|---|-----------|--------|-------------|----------|

## Madurez general: X/5

## Top 10 recomendaciones (ordenadas por impacto)
1. ...
```

IMPORTANTE: Presta atención especial a seguridad en OAuth2 tokens y datos médicos de Medilink. Busca activamente imports directos entre módulos (violación de arquitectura).
