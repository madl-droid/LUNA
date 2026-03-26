# Auditoría: Seguridad & Cross-cutting

Eres un auditor de SEGURIDAD senior. Tu tarea es hacer una auditoría de seguridad EXHAUSTIVA y TRANSVERSAL de todo el sistema LUNA. NO hagas cambios en el código, solo analiza y genera un informe.

## REGLA DE LECTURA

IMPORTANTE: Esta auditoría es transversal — cubre TODO src/ (~60,000 líneas). Para evitar colapsar el contexto:
- NO leas todos los archivos completos — usa búsquedas dirigidas (grep/search)
- Para cada vector de ataque, busca patrones específicos en todo el codebase
- Cuando encuentres un hallazgo, lee el contexto alrededor (unas 30-50 líneas) para confirmar
- Trabaja vector por vector, no archivo por archivo
- Toma notas de cada vector antes de pasar al siguiente
- Si un grep devuelve muchos resultados, procesa en lotes

## Metodología por fases:

### Fase 1: SQL Injection
- Busca en todo src/: "query(", "pool.query", cadenas con "SELECT", "INSERT", "UPDATE", "DELETE"
- Para CADA query encontrada: ¿usa parámetros ($1, $2) o concatenación de strings?
- Busca template literals que construyan SQL dinámico
- Archivos clave a revisar: src/kernel/db.ts, src/modules/memory/, src/modules/knowledge/pg-store.ts, src/modules/users/, src/modules/lead-scoring/

### Fase 2: Prompt Injection
- Lee: src/engine/utils/injection-detector.ts (completo)
- Lee: src/engine/attachments/injection-validator.ts (completo)
- Lee: src/engine/prompts/ (todos los archivos)
- Busca cómo se incluye input del usuario en prompts del LLM
- ¿Hay separación clara entre system prompt y user input?
- ¿Qué pasa si un usuario manda instrucciones maliciosas por WhatsApp/email?

### Fase 3: XSS
- Lee: src/modules/console/templates*.ts (busca output sin escapar)
- Busca en console: innerHTML, raw HTML, template literals que incluyan datos de usuario
- ¿Los datos de leads/contactos se muestran sin sanitizar?

### Fase 4: Authentication & Authorization
- Lee: src/kernel/setup/auth.ts y login.ts (completos)
- Busca en src/kernel/server.ts cómo se aplica auth a rutas
- Busca rutas HTTP en todos los módulos (apiRoutes en manifests)
- ¿Hay rutas sin protección de auth?
- ¿Webhook endpoints validan signatures?

### Fase 5: Secrets Management
- Busca en todo src/: hardcoded strings que parezcan API keys, passwords, tokens
- Lee: src/kernel/config-store.ts (verificar encryption)
- Lee: deploy/.env.example (¿tiene secrets reales?)
- Busca en src/: console.log, logger.info, logger.debug que puedan filtrar secrets
- ¿Config store encryption: IV único por operación? ¿Key derivation correcta?

### Fase 6: Input Validation
- Busca: parseBody, readBody — ¿qué validación hay después?
- Busca: Zod schemas en configSchema de cada módulo — ¿son estrictos?
- ¿File uploads tienen restricciones (tipo, tamaño)?
- ¿URLs de usuario se validan contra SSRF? (busca en knowledge web-source-manager, attachments url-extractor)

### Fase 7: Error Handling & Info Disclosure
- Busca: catch blocks — ¿qué se hace con el error? ¿Se expone al usuario?
- Busca: res.end con error details, stack traces en responses
- ¿Logs tienen nivel adecuado? ¿PII en logs?

### Fase 8: Concurrency & Race Conditions
- Lee: src/engine/concurrency/ (completo)
- Busca: operaciones de DB que deberían ser atómicas (BEGIN/COMMIT/ROLLBACK)
- Busca: Redis operations que deberían ser atómicas (multi/exec, lua scripts)
- ¿Hay TOCTOU bugs?

### Fase 9: Denial of Service
- Busca: ¿hay rate limiting en algún endpoint?
- Busca: body size limits en parseBody/readBody
- Busca: timeouts en llamadas a APIs externas (fetch, axios, googleapis)
- ¿BullMQ puede ser saturado?
- ¿Un mensaje malicioso (muy largo, muchos attachments) puede crashear el pipeline?

### Fase 10: Dependencies
- Lee: package.json — dependencias y versiones
- ¿Hay dependencias con CVEs conocidas?
- ¿Versiones pinneadas o con ^?

### Fase 11: Crypto
- Lee: src/kernel/config-store.ts (AES-256-GCM)
- ¿IVs son únicos por operación?
- ¿Key derivation es correcta?
- ¿Hay otros usos de crypto en el proyecto?

### Fase 12: Data Privacy
- Busca: dónde se almacena PII (nombres, teléfonos, emails, datos médicos)
- ¿Hay data retention policies implementadas?
- ¿Datos médicos de Medilink están protegidos?
- ¿Logs contienen PII?

## Formato del informe

Genera el archivo: docs/reports/audit/07-seguridad.md

```markdown
# Auditoría de Seguridad: LUNA
Fecha: [fecha de ejecución]
Auditor: Claude (sesión automatizada)
Metodología: Análisis estático de código, búsqueda de patrones, revisión manual

## Resumen ejecutivo
(estado general de seguridad en 5 líneas)

## Clasificación de severidades
- CRÍTICO: explotable remotamente, impacto alto, sin autenticación
- ALTO: explotable con condiciones, impacto significativo
- MEDIO: requiere acceso previo o impacto limitado
- BAJO: mejora de hardening, sin explotación directa

## Hallazgos por vector

### 1. SQL Injection
| # | Severidad | Archivo:Línea | Query afectada | Tipo de vulnerabilidad | Recomendación |
|---|-----------|---------------|----------------|------------------------|---------------|
(o "No se encontraron vulnerabilidades" con evidencia de qué se revisó)

### 2. Prompt Injection
(mismo formato de tabla)

### 3. XSS (Cross-Site Scripting)
(mismo formato)

### 4. Authentication & Authorization
- Rutas protegidas: [lista]
- Rutas SIN protección: [lista]
(hallazgos en tabla)

### 5. Secrets Management
(mismo formato)

### 6. Input Validation
(mismo formato)

### 7. Error Handling & Information Disclosure
(mismo formato)

### 8. Concurrency & Race Conditions
(mismo formato)

### 9. Denial of Service
(mismo formato)

### 10. Dependency Security
(mismo formato)

### 11. Cryptography
(mismo formato)

### 12. Data Privacy
(mismo formato)

## Superficie de ataque
### Endpoints HTTP expuestos
| Ruta | Método | Auth requerida | Módulo |
### Webhooks expuestos
| Endpoint | Validación de signature | Módulo |
### WebSocket connections
### Servicios externos conectados
| Servicio | Protocolo | Auth | Datos enviados |

## Score de seguridad: X/10
(justificación detallada)

## Top 10 vulnerabilidades (ordenadas por severidad)
| # | Severidad | Vector | Descripción | Archivo | Recomendación |
|---|-----------|--------|-------------|---------|---------------|

## Recomendaciones de hardening (ordenadas por prioridad)
1. ...
2. ...
```

IMPORTANTE: Busca ACTIVAMENTE en todo src/ usando grep/search. No te limites a leer archivos obvios. Para cada vector, documenta qué buscaste y dónde, incluso si no encontraste vulnerabilidades (para demostrar cobertura). Sé paranoico — es una auditoría de seguridad.
