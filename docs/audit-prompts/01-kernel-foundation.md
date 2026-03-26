# Auditoría: Kernel & Foundation

Eres un auditor de código senior. Tu tarea es hacer una auditoría EXHAUSTIVA del kernel y foundation layer del sistema LUNA. NO hagas cambios en el código, solo analiza y genera un informe.

## REGLA DE LECTURA

IMPORTANTE: Muchos archivos son grandes. Para evitar colapsar el contexto:
- Lee cada archivo en bloques de máximo 200 líneas
- Si un archivo tiene más de 200 líneas, léelo en fases (líneas 1-200, luego 201-400, etc.)
- Toma notas de hallazgos de cada bloque antes de pasar al siguiente
- No intentes leer todos los archivos a la vez — ve uno por uno o en grupos pequeños de archivos cortos
- Prioriza: lee primero los archivos más críticos (db.ts, registry.ts, server.ts, auth.ts, config-store.ts)

## Scope exacto — Archivos a leer:

### Kernel core (lee estos primero)
- src/kernel/config.ts
- src/kernel/config-store.ts
- src/kernel/config-helpers.ts
- src/kernel/db.ts
- src/kernel/redis.ts
- src/kernel/registry.ts
- src/kernel/server.ts
- src/kernel/loader.ts
- src/kernel/http-helpers.ts
- src/kernel/types.ts

### Setup (lee después)
- src/kernel/setup/auth.ts
- src/kernel/setup/detect.ts
- src/kernel/setup/handler.ts
- src/kernel/setup/i18n.ts
- src/kernel/setup/login.ts
- src/kernel/setup/templates.ts

### Otros (lee al final)
- src/kernel/migrations/ (todos los .sql si existen)
- src/index.ts
- src/channels/types.ts
- src/channels/channel-adapter.ts
- src/channels/message-batcher.ts
- src/channels/typing-delay.ts
- docs/architecture/module-system.md (solo secciones relevantes al kernel)

## Qué auditar (sé exhaustivo en cada punto):

### 1. Config System
- ¿config.ts es realmente el ÚNICO archivo que lee process.env?
- ¿config-store.ts usa AES-256-GCM correctamente? ¿Key management es seguro?
- ¿config-helpers.ts cubre todos los casos edge (NaN, empty string, null)?
- ¿Hay defaults inseguros?

### 2. Base de datos (db.ts)
- Pool configuration: ¿max connections, idle timeout, connection timeout son adecuados?
- ¿Hay manejo de reconnection?
- ¿Queries usan parámetros ($1, $2) o hay riesgo de SQL injection?
- ¿Hay connection leak potential?

### 3. Redis (redis.ts)
- ¿Configuración de reconnection?
- ¿Manejo de errores de conexión?
- ¿Hay cleanup de keys/TTL?

### 4. Registry (registry.ts)
- ¿El sistema de hooks es type-safe?
- ¿Hay race conditions en registro/deregistro de módulos?
- ¿El service registry puede tener colisiones de nombres?
- ¿Qué pasa si un hook falla? ¿Propaga o traga el error?

### 5. Module Loader (loader.ts)
- ¿Resuelve dependencias correctamente?
- ¿Detecta dependencias circulares?
- ¿Qué pasa si un módulo falla en init()?
- ¿El orden de carga es determinista?

### 6. HTTP Server (server.ts)
- ¿Hay rate limiting?
- ¿CORS configurado?
- ¿Manejo de request timeout?
- ¿Headers de seguridad?
- ¿Body size limits?

### 7. HTTP Helpers (http-helpers.ts)
- ¿parseBody valida Content-Type?
- ¿Hay protección contra JSON bombs?
- ¿jsonResponse escapa correctamente?

### 8. Auth & Setup (setup/)
- ¿El flujo de autenticación es seguro?
- ¿Sessions/tokens: cómo se generan, almacenan, validan, expiran?
- ¿Hay protección contra brute force?
- ¿Factory reset es seguro?

### 9. Channel abstractions (src/channels/)
- ¿La interfaz base es completa?
- ¿Message batcher tiene memory bounds?
- ¿Typing delay tiene edge cases?

### 10. Entry point (src/index.ts)
- ¿Graceful shutdown es correcto?
- ¿Maneja señales SIGTERM/SIGINT?
- ¿Uncaught exceptions están manejadas?

### 11. Types (types.ts)
- ¿HookMap cubre todos los eventos necesarios?
- ¿ModuleManifest es suficientemente estricto?
- ¿Hay tipos any o unknown innecesarios?

## Formato del informe

Genera el archivo: docs/reports/audit/01-kernel-foundation.md

```markdown
# Auditoría: Kernel & Foundation
Fecha: [fecha de ejecución]
Auditor: Claude (sesión automatizada)

## Resumen ejecutivo
(3-5 líneas del estado general)

## Inventario
| Archivo | LOC | Propósito | Estado |
|---------|-----|-----------|--------|

## Hallazgos por componente

### Config System
#### Fortalezas
#### Problemas encontrados
(cada uno con: severidad [CRÍTICO/ALTO/MEDIO/BAJO], descripción, archivo:línea, impacto, recomendación)
#### Madurez: X/5

### Base de datos
(mismo formato)

### Redis
(mismo formato)

### Registry & Hooks
(mismo formato)

### Module Loader
(mismo formato)

### HTTP Server
(mismo formato)

### Auth & Setup
(mismo formato)

### Channel Abstractions
(mismo formato)

### Entry Point
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

IMPORTANTE: Lee CADA archivo completo (en bloques si es necesario). No asumas nada. Basa cada hallazgo en código real con líneas específicas. Sé brutalmente honesto.
