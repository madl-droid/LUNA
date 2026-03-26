# Auditoria de Seguridad: LUNA

**Fecha:** 2026-03-26
**Auditor:** Claude (sesion automatizada)
**Metodologia:** Analisis estatico de codigo, busqueda de patrones, revision manual
**Alcance:** Todo `src/` (~60,000 lineas), `deploy/`, `package.json`

## Resumen ejecutivo

LUNA presenta una base de seguridad **solida** en autenticacion (scrypt, sessions Redis, HttpOnly cookies), cifrado de config (AES-256-GCM con IVs unicos), y parametrizacion SQL en la mayoria de queries. Sin embargo, se identificaron **vulnerabilidades criticas** en: (1) XSS reflejado via parametro flash en console, (2) rate limiters con condiciones de carrera TOCTOU que permiten exceder limites, (3) webhook de Medilink que acepta todo si no hay clave configurada, (4) ausencia total de rate limiting HTTP y body size limits en el servidor, y (5) multiples puntos de prompt injection por falta de escapado en contenido interpolado a prompts LLM. El score general es **5.5/10** — funcional pero requiere hardening antes de produccion con datos sensibles.

## Clasificacion de severidades

- **CRITICO**: explotable remotamente, impacto alto, sin autenticacion requerida
- **ALTO**: explotable con condiciones, impacto significativo
- **MEDIO**: requiere acceso previo o impacto limitado
- **BAJO**: mejora de hardening, sin explotacion directa

---

## Hallazgos por vector

### 1. SQL Injection

**Busqueda realizada:** `query(`, `pool.query`, template literals con SELECT/INSERT/UPDATE/DELETE en todo `src/`. Se revisaron ~40 archivos con queries SQL.

**Resultado general:** La mayoria de queries usan parametros `$1, $2` correctamente. Se encontraron 3 patrones problematicos:

| # | Severidad | Archivo:Linea | Descripcion | Recomendacion |
|---|-----------|---------------|-------------|---------------|
| 1.1 | **CRITICO** | `modules/console/server.ts:1970-2000` | WHERE clause dinamico para metricas de canal: `${whereTime}` interpolado directamente. Valores vienen de maps hardcodeados pero el `period` del query param no se valida estrictamente antes de usarse. | Validar `period` contra whitelist estricto ANTES de construir SQL. Usar CASE en SQL parametrizado. |
| 1.2 | MEDIO | `modules/medilink/pg-store.ts:424-426` | Interpolacion directa de `${executedAt}` en UPDATE. Valores son hardcoded (`'now()'` o `'executed_at'`) pero el patron es fragil. | Usar `CASE WHEN $1 IN ('sent','confirmed','failed') THEN now() ELSE executed_at END`. |
| 1.3 | BAJO | Multiples archivos (*) | Patron de dynamic SET con `${sets.join(', ')}`. Columnas son hardcoded en codigo, valores parametrizados. Seguro actualmente pero fragil si se agrega input externo. | Mantener whitelist explicito de columnas permitidas. Agregar comentario de seguridad. |

(*) Archivos con dynamic SET: `users/db.ts:389`, `memory/pg-store.ts:226`, `tools/pg-store.ts:162`, `console/server.ts:1903`, `lead-scoring/campaign-queries.ts:222,276`, `knowledge/pg-store.ts:402,664,794,858,935`, `scheduled-tasks/store.ts:116`

**Patron seguro confirmado en:** `kernel/db.ts`, `users/db.ts` (mayoria), `memory/pg-store.ts` (inserts), `knowledge/pg-store.ts` (inserts/selects), `lead-scoring/pg-queries.ts` (mayoria) — todos usan `$1, $2` correctamente.

---

### 2. Prompt Injection

**Busqueda realizada:** Se revisaron `engine/utils/injection-detector.ts`, `engine/attachments/injection-validator.ts`, todos los archivos en `engine/prompts/`, y el flujo de mensajes desde canales hasta LLM.

**Mitigaciones existentes:**
- `detectInputInjection()` en Phase 1 detecta patrones comunes y fuerza `respond_only`
- `detectOutputInjection()` en Phase 5 detecta leaks de system prompt en respuestas
- `detectSensitiveData()` en Phase 5 redacta API keys en output
- Trust boundary markers en contenido de attachments

| # | Severidad | Archivo:Linea | Descripcion | Recomendacion |
|---|-----------|---------------|-------------|---------------|
| 2.1 | **ALTO** | `engine/prompts/evaluator.ts:209`, `compositor.ts:224` | `ctx.normalizedText` (mensaje del usuario) se interpola directamente en prompt LLM con `"${ctx.normalizedText}"`. Comillas no son escapado suficiente. | Implementar escapado de prompt (triple quotes, escapar newlines/brackets). |
| 2.2 | **ALTO** | `engine/prompts/evaluator.ts:101-161` | Datos de DB (memory summary, key facts, commitments, assignment rules) se interpolan sin escapado. Un admin malicioso puede inyectar via assignment rules. | Escapar todo contenido de DB antes de interpolar en prompts. |
| 2.3 | **ALTO** | `engine/prompts/subagent.ts:34-37` | `step.description` y `step.params` generados por LLM en Phase 2 se interpolan directamente en prompt del subagent (Phase 3). Inyeccion de segundo orden. | Validar/escapar step descriptions. Whitelist de tipos de step. |
| 2.4 | MEDIO | `engine/attachments/injection-validator.ts:67-68` | Trust boundary markers (`[CONTENIDO EXTERNO]`) pueden ser falsificados dentro del contenido del documento. | Usar delimitadores menos predecibles (UUID, XML tags con atributos). |
| 2.5 | MEDIO | `engine/utils/injection-detector.ts:5-22` | Deteccion basada en regex — evadible con unicode, espacios multiples, sinonimos, variaciones de fraseo. | Complementar con deteccion ML o lista mas exhaustiva de sinonimos. |
| 2.6 | MEDIO | `engine/prompts/compositor.ts:164,219` | Tool results y historial de mensajes se interpolan sin escapado en el prompt del compositor. | Escapar resultados de tools y truncar mas agresivamente. |

---

### 3. XSS (Cross-Site Scripting)

**Busqueda realizada:** Templates en `modules/console/`, `modules/lead-scoring/templates.ts`, archivos JS del cliente, funciones `esc()`, uso de `innerHTML`, headers CSP.

**Mitigaciones existentes:**
- Funcion `esc()` definida en `console/templates-fields.ts:6-8` y usada en la mayoria de templates
- `lsEsc()` en lead-scoring templates para escapar nombres

| # | Severidad | Archivo:Linea | Descripcion | Recomendacion |
|---|-----------|---------------|-------------|---------------|
| 3.1 | **CRITICO** | `modules/console/templates.ts:711-721` | XSS reflejado: `renderFlash()` — si el param `flash` no esta en el diccionario de mensajes, se inserta crudo en HTML: `const msg = messages[flash] \|\| flash`. URL maliciosa: `?flash=<img src=x onerror=alert(1)>` | Siempre escapar: `const msg = messages[flash] \|\| esc(flash)`. |
| 3.2 | **ALTO** | `modules/lead-scoring/templates.ts:790` | `lead.contactId` se inyecta en atributo `onclick` SIN escapar: `onclick="lsDetail(\\'' + lead.contactId + '\\')"`. Permite breakout de atributo. | Escapar contactId con `lsEsc()` en atributos onclick. |
| 3.3 | **ALTO** | `modules/console/ui/js/console-minimal.js:396-399` | `innerHTML` con datos de API sin escapar: `r.configKey`, `r.oldModel`, `r.newModel` del model-scanner. | Escapar datos antes de innerHTML o usar textContent/createElement. |
| 3.4 | MEDIO | Todos los modulos | No hay headers Content-Security-Policy, X-Frame-Options, X-Content-Type-Options en ninguna respuesta HTTP. | Agregar headers de seguridad en kernel/server.ts para todas las respuestas. |

---

### 4. Authentication & Authorization

**Busqueda realizada:** `kernel/setup/auth.ts`, `kernel/setup/login.ts`, `kernel/server.ts`, apiRoutes en todos los manifests, webhooks.

**Arquitectura de auth:**
- Passwords: scrypt con salt de 16 bytes, hash de 64 bytes
- Sessions: tokens de 32 bytes aleatorios, almacenados en Redis con TTL de 30 dias
- Cookies: HttpOnly, SameSite=Lax
- Comparacion: `crypto.timingSafeEqual()` en password y signatures

**Rutas protegidas:** Todas las `/console/api/*` excepto webhooks, OAuth callbacks, login/logout, static assets, `/health`.

**Rutas sin proteccion (por diseno):** webhooks externos, OAuth callbacks, health check, login.

| # | Severidad | Archivo:Linea | Descripcion | Recomendacion |
|---|-----------|---------------|-------------|---------------|
| 4.1 | **CRITICO** | `modules/medilink/webhook-handler.ts:107` | `if (!privateKey) return true` — si no hay clave configurada, el webhook acepta TODO sin verificacion. Permite crear citas falsas, modificar datos de pacientes. | Hacer la clave OBLIGATORIA. Rechazar con 401 si no hay clave. |
| 4.2 | **ALTO** | `modules/google-chat/manifest.ts:349` | Token de webhook vacio = acepta todo. Descrito como "solo desarrollo" pero puede quedar en produccion. | Requerir token obligatorio. Log warning si esta vacio. |
| 4.3 | MEDIO | `kernel/server.ts` | No hay rate limiting en endpoint de login. Sin proteccion contra brute force de passwords. | Implementar rate limiting (ej: 5 intentos/min por IP). |
| 4.4 | MEDIO | `kernel/server.ts` | Faltan headers: X-Frame-Options, Strict-Transport-Security, CORS no configurado explicitamente. | Agregar security headers globales. |

---

### 5. Secrets Management

**Busqueda realizada:** Hardcoded keys/tokens, `config-store.ts`, `.env.example`, logging de secrets.

**Implementacion de cifrado (SEGURO):**
- AES-256-GCM con IVs unicos de 12 bytes por operacion (`crypto.randomBytes`)
- Key derivation: `crypto.scryptSync()` con salt
- Key file: `instance/config.key` con permisos 0o600
- Auto-deteccion de secrets por patron de nombre (PASSWORD, SECRET, API_KEY)
- `deploy/.env.example` solo tiene placeholders, no secrets reales

| # | Severidad | Archivo:Linea | Descripcion | Recomendacion |
|---|-----------|---------------|-------------|---------------|
| 5.1 | **ALTO** | `modules/gmail/email-oauth.ts:263`, `modules/google-apps/oauth-manager.ts` | OAuth refresh tokens almacenados en DB sin cifrar. Permiten impersonar cuentas. | Cifrar tokens con config-store encryption antes de persistir. |
| 5.2 | MEDIO | `kernel/config-store.ts:33` | `scryptSync()` bloquea event loop durante derivacion de key al inicio. | Usar `crypto.scrypt()` async. |
| 5.3 | BAJO | `modules/twilio-voice/twilio-adapter.ts:149` | SHA1 para validacion Twilio — requerido por spec de Twilio, no es vulnerabilidad. | Agregar comentario referenciando spec de Twilio. |

**No se encontraron:** API keys hardcodeadas, secrets en logs (Phase 5 redacta `sk-ant-*` y `AIza*`), archivos `.env` con valores reales.

---

### 6. Input Validation

**Busqueda realizada:** `parseBody`, `readBody`, Zod schemas, file uploads, URLs de usuario, path traversal.

**Fortalezas:** Zod schemas estrictos en configSchema de cada modulo, file size limits configurables para uploads (knowledge, attachments), path traversal protegido en static files (`path.resolve` + `startsWith`).

| # | Severidad | Archivo:Linea | Descripcion | Recomendacion |
|---|-----------|---------------|-------------|---------------|
| 6.1 | **ALTO** | `modules/knowledge/web-source-manager.ts:97-100` | SSRF: `fetch(webSource.url)` sin validacion de IP privada. Un admin puede agregar URLs internas (localhost, 10.x, metadata). | Agregar validacion SSRF (reusar `isBlockedUrl` de url-extractor). |
| 6.2 | **ALTO** | `modules/knowledge/api-connector.ts:73-80` | SSRF: `fetch(connector.baseUrl)` sin validacion. baseUrl configurable via API. | Validar baseUrl contra IPs privadas al crear y al fetch. |
| 6.3 | MEDIO | `modules/medilink/cache.ts:33,51,62`, `gmail/email-oauth.ts:293`, `google-chat/adapter.ts:372-428` | `JSON.parse()` sin try-catch en datos de Redis/DB. Corrupcion puede crashear. | Envolver en try-catch con fallback seguro. |
| 6.4 | BAJO | `engine/proactive/guards.ts:150,181,218`, `engine/phases/phase5-validate.ts:277,281` | `parseInt()` sin parametro radix. Datos internos de Redis, bajo riesgo. | Agregar radix 10 por buena practica. |

**SSRF protegido correctamente en:** `engine/attachments/url-extractor.ts` (blocklist completa de IPs privadas, metadata, IPv6), `engine/attachments/tools/web-explore.ts` (misma blocklist + size limit + timeout).

**Path traversal protegido en:** `console/server.ts:270-299` (null byte check + `path.resolve` + `startsWith` + whitelist de directorios base).

---

### 7. Error Handling & Information Disclosure

**Busqueda realizada:** Catch blocks, `res.end` con error details, stack traces, PII en logs.

**Fortalezas:** Error handler principal en `kernel/server.ts:156` retorna `{ error: 'Internal server error' }` generico. Config encriptado. Sessions seguras.

| # | Severidad | Archivo:Linea | Descripcion | Recomendacion |
|---|-----------|---------------|-------------|---------------|
| 7.1 | **ALTO** | `modules/console/server.ts:637-638` | Error message completo en query param del redirect: `?error=${encodeURIComponent(err.message)}`. Expone errores de DB, filesystem, validacion. | Retornar mensaje generico. Loguear detalle server-side. |
| 7.2 | MEDIO | `modules/gmail/manifest.ts:188`, `modules/google-apps/manifest.ts:188` | OAuth callback muestra `String(err)` en HTML al usuario. Puede exponer detalles de provider/config. | Mostrar "Autenticacion fallida" generico. |
| 7.3 | MEDIO | Multiples archivos (*) | `String(err)` retornado en respuestas JSON de API. Puede exponer detalles internos. | Retornar error generico + error ID para soporte. |
| 7.4 | MEDIO | `kernel/setup/login.ts:148,156` | Email addresses en logs de auth: `logger.warn({ email }, 'Login failed')`. | Loguear hash del email o user ID, no PII. |
| 7.5 | MEDIO | `kernel/server.ts` | No hay `process.on('uncaughtException')` ni `process.on('unhandledRejection')`. | Agregar handlers globales para errores no capturados. |
| 7.6 | BAJO | `tools/freight/freight-tool.ts:137` | Errores de validacion Zod expuestos directamente. Revelan schema interno. | Mapear a mensajes genericos. |

(*) Archivos con `String(err)` en respuestas: `tools/freshdesk/freshdesk-search.ts:85`, `tools/freshdesk/freshdesk-get-article.ts:118`, `modules/lead-scoring/manifest.ts` (multiples), `modules/scheduled-tasks/api-routes.ts` (multiples), `modules/twilio-voice/manifest.ts:106`

---

### 8. Concurrency & Race Conditions

**Busqueda realizada:** `engine/concurrency/`, BEGIN/COMMIT/ROLLBACK, Redis multi/exec/Lua, read-modify-write patterns, semaforos.

**Fortalezas:** ContactLock provee serializacion por contacto. Pipeline semaphore con queue y backpressure. Configuracion de concurrencia: `maxConcurrentPipelines=50`, `maxQueueSize=200`, `maxConcurrentSteps=5`.

| # | Severidad | Archivo:Linea | Descripcion | Recomendacion |
|---|-----------|---------------|-------------|---------------|
| 8.1 | **CRITICO** | `modules/gmail/rate-limiter.ts:40-58` | TOCTOU: `canSend()` lee contadores, `recordSend()` incrementa por separado. Dos threads pueden pasar el check simultaneamente y exceder el limite. | Lua script atomico: INCR + check en una operacion. |
| 8.2 | **CRITICO** | `engine/phases/phase5-validate.ts:272-288` | TOCTOU: GET contador → comparar → INCR por separado. Misma race condition que Gmail rate limiter. | Lua script atomico o usar resultado de INCR para decidir. |
| 8.3 | **CRITICO** | `modules/medilink/rate-limiter.ts:107-127` | TOCTOU: INCR → check → DECR no es atomico. Counter puede quedar inconsistente bajo carga concurrente. | Lua script que INCR y retorna resultado atomicamente. |
| 8.4 | **CRITICO** | `modules/lead-scoring/pg-queries.ts:348-375`, `extract-tool.ts:199-281` | Read-modify-write sin transaccion: lee `qualification_data`, modifica en JS, escribe de vuelta. Escrituras concurrentes se sobreescriben. | Usar `jsonb_set()` atomico o wrappear en transaccion con SELECT FOR UPDATE. |
| 8.5 | **ALTO** | `engine/concurrency/pipeline-semaphore.ts:27-40` | `this.running++` no es atomico entre boundaries async. Multiples acquires pueden ver mismo valor y exceder limite. | Usar mutex async o semaforo Redis-backed. |
| 8.6 | MEDIO | `engine/proactive/guards.ts:140-157` | Cooldown: GET → process → SET no es atomico. Dos proactive messages pueden pasar guard simultaneamente. | Check-and-set atomico con Lua o SET NX. |

---

### 9. Denial of Service

**Busqueda realizada:** Rate limiting, body size limits, timeouts en APIs externas, BullMQ config, regex ReDoS, limites de conexion.

**Fortalezas:** Attachment limits (50MB max, 15 per message, concurrency=3). Pipeline semaphore con queue. DB connection pool (default 20). BullMQ con `removeOnComplete:200`, `removeOnFail:100`.

| # | Severidad | Archivo:Linea | Descripcion | Recomendacion |
|---|-----------|---------------|-------------|---------------|
| 9.1 | **ALTO** | `kernel/http-helpers.ts:8-14` | `readBody()` acumula chunks sin limite de tamano. Request de GB causa OOM. | Agregar limite (ej: 10MB) y rechazar con 413. |
| 9.2 | **ALTO** | `kernel/setup/handler.ts:49-62`, `kernel/setup/login.ts:99-111` | `parseFormBody()` concatena strings sin limite. Misma vulnerabilidad en setup/login. | Agregar limite de tamano al form parser. |
| 9.3 | MEDIO | `kernel/server.ts:70,183` | HTTP server sin `keepAliveTimeout`, `requestTimeout`, `headersTimeout`. Vulnerable a Slowloris. | Configurar timeouts del server. Usar reverse proxy con limites. |
| 9.4 | MEDIO | Sin archivo | No hay rate limiting en ningun endpoint HTTP. | Implementar rate limiting al menos en login y webhooks. |
| 9.5 | BAJO | `modules/twilio-voice/twilio-adapter.ts:91,115` | Fetch a Twilio API sin timeout explicito (usa default de 300s de Node.js). | Agregar timeout de 10-30s. |

**ReDoS:** No se encontraron regex problematicos. Patrones revisados (`EMAIL_RE`, `PHONE_RE` en setup) son seguros.

---

### 10. Dependency Security

**Busqueda realizada:** `package.json`, `npm audit`, versiones y CVEs.

- **23 dependencias de produccion**, 13 de desarrollo
- **Todas usan `^` (caret)** — ninguna version pinneada
- `npm audit`: 3 vulnerabilidades moderadas en dev deps (brace-expansion, esbuild, flatted) — bajo riesgo en produccion

| # | Severidad | Paquete | Descripcion | Recomendacion |
|---|-----------|---------|-------------|---------------|
| 10.1 | **ALTO** | `@whiskeysockets/baileys@^7.0.0-rc.9` | Release candidate, no produccion. Puede tener bugs/breaking changes inesperados. | Usar version estable cuando exista, o fork testeado. |
| 10.2 | MEDIO | Todas las deps | Caret versioning permite auto-updates de minor/patch. Supply chain risk. | Pinear versiones criticas (baileys, pg, ioredis). Usar `npm ci` con lockfile. |
| 10.3 | BAJO | Dev deps | brace-expansion, esbuild, flatted con CVEs moderados. Solo afectan desarrollo. | `npm audit fix` en entorno dev. |

---

### 11. Cryptography

**Busqueda realizada:** `config-store.ts`, usos de crypto en todo src/.

**Implementacion (SEGURA):**
- **AES-256-GCM**: IVs de 12 bytes unicos por operacion, auth tag verificado
- **Scrypt**: Para key derivation y password hashing
- **timingSafeEqual**: En todas las comparaciones de secrets (auth, webhooks, Twilio)
- **No se encontro**: MD5/SHA1 para seguridad, ECB mode, IVs estaticos, `createCipher` deprecated

| # | Severidad | Archivo:Linea | Descripcion | Recomendacion |
|---|-----------|---------------|-------------|---------------|
| 11.1 | BAJO | No aplica | No hay mecanismo de rotacion de key de cifrado documentado. | Documentar procedimiento de rotacion manual. |

---

### 12. Data Privacy

**Busqueda realizada:** Almacenamiento de PII, data retention, datos medicos Medilink, PII en logs, GDPR.

**Datos sensibles almacenados:**
- **Medilink**: nombres, apellidos, fecha nacimiento, genero, telefono, celular, email, RUT (cedula), direccion, prevision de salud, notas clinicas
- **Contactos**: contact_id (basado en telefono), agent_data con medilink_patient_id
- **OAuth**: tokens de Gmail y Google Apps en DB

**Proteccion de datos medicos (BUENA):**
- 3 niveles de verificacion: UNVERIFIED → PHONE_MATCHED → DOCUMENT_VERIFIED
- `canAccess()` verifica nivel antes de mostrar datos
- `filterEvolution()` NUNCA incluye `evo.datos` (notas clinicas)
- Audit log en tabla `medilink_audit_log` con action, verification_level, result

**Retencion de datos (IMPLEMENTADA):**
- `MEMORY_SUMMARY_RETENTION_DAYS`: 90 dias (configurable)
- `MEMORY_ARCHIVE_RETENTION_YEARS`: 5 anos (legal)
- `MEMORY_PIPELINE_LOGS_RETENTION_DAYS`: 90 dias
- Purge automatico via cron (semanal y mensual)

| # | Severidad | Descripcion | Recomendacion |
|---|-----------|-------------|---------------|
| 12.1 | **ALTO** | PII en logs: emails en login logs, telefonos en Medilink logs, emails en OAuth logs. | Implementar redaccion de PII en pino (redact option) o hashear antes de loguear. |
| 12.2 | **ALTO** | No hay endpoint de "derecho al olvido" (eliminacion por contacto/paciente). | Crear endpoint que cascade delete: mensajes, sessions, contacts, audit log. |
| 12.3 | MEDIO | No hay gestion de consentimiento ni tracking de aceptacion de politica. | Agregar tabla de consentimiento con timestamps. |
| 12.4 | MEDIO | No hay anonimizacion de datos archivados. | Implementar job de anonimizacion pre-purge (hashear nombres, enmascarar tel/email). |

---

## Superficie de ataque

### Endpoints HTTP expuestos

| Ruta | Metodo | Auth | Modulo |
|------|--------|------|--------|
| `/health` | GET | No | kernel |
| `/console/login` | GET/POST | No | kernel/setup |
| `/console/logout` | GET | No | kernel/setup |
| `/console/api/medilink/webhook` | POST | Signature (opcional!) | medilink |
| `/console/api/google-chat/webhook` | POST | Token (opcional!) | google-chat |
| `/console/api/twilio-voice/*` | POST | Twilio signature | twilio-voice |
| `/console/api/gmail/oauth2callback` | GET | OAuth2 flow | gmail |
| `/console/api/google-apps/oauth2callback` | GET | OAuth2 flow | google-apps |
| `/console/api/*` (resto) | Varios | Session cookie | 20+ modulos |
| `/console/static/*` | GET | No | console |

### Webhooks expuestos

| Endpoint | Validacion de signature | Modulo |
|----------|------------------------|--------|
| `/console/api/medilink/webhook` | HMAC-SHA256 (**OPCIONAL** — acepta todo sin key) | medilink |
| `/console/api/google-chat/webhook` | Authorization token (**OPCIONAL** — acepta todo sin token) | google-chat |
| `/console/api/twilio-voice/incoming` | Twilio request signing (obligatorio) | twilio-voice |
| `/console/api/twilio-voice/status` | Twilio request signing (obligatorio) | twilio-voice |
| `/console/api/twilio-voice/stream` | WebSocket upgrade | twilio-voice |

### WebSocket connections

| Endpoint | Auth | Modulo |
|----------|------|--------|
| `/console/api/twilio-voice/stream` | Via HTTP upgrade (Twilio internal) | twilio-voice |

### Servicios externos conectados

| Servicio | Protocolo | Auth | Datos enviados |
|----------|-----------|------|----------------|
| Anthropic API | HTTPS | API Key | Prompts con datos de leads, historial |
| Google AI (Gemini) | HTTPS | API Key | Prompts, audio streaming (voice) |
| WhatsApp (Baileys) | WebSocket | QR/pairing | Mensajes, media |
| Gmail API | HTTPS | OAuth2 | Emails, attachments |
| Google Calendar | HTTPS | OAuth2 | Eventos, asistentes |
| Google Drive | HTTPS | OAuth2 | Documentos knowledge base |
| Google Chat | HTTPS | Service Account | Mensajes |
| Twilio | HTTPS | Account SID + Auth Token | Audio, call control |
| Medilink/HealthAtom | HTTPS | API credentials | Datos de pacientes, citas |
| Freshdesk | HTTPS | API Key | Articulos KB |
| SeaRates/DHL | HTTPS | API Keys | Estimaciones de flete |
| PostgreSQL | TCP | Password | Todo el state de la aplicacion |
| Redis | TCP | Password | Sessions, cache, queues, locks |

---

## Score de seguridad: 5.5/10

**Justificacion:**

| Area | Score | Peso | Notas |
|------|-------|------|-------|
| SQL Injection | 7/10 | Alto | Mayoria parametrizado, 1 critico en console |
| Prompt Injection | 4/10 | Alto | Detector basico, sin escapado en interpolaciones |
| XSS | 4/10 | Alto | 1 critico reflejado, multiples stored, sin CSP |
| Auth & AuthZ | 6/10 | Alto | Buena base, webhooks opcionales criticos |
| Secrets/Crypto | 8/10 | Medio | AES-256-GCM correcto, OAuth tokens sin cifrar |
| Input Validation | 6/10 | Medio | SSRF en 2 modulos, body sin limite |
| Error Handling | 5/10 | Medio | Errores expuestos, PII en logs |
| Concurrency | 3/10 | Alto | 4 TOCTOU criticos en rate limiters |
| DoS | 4/10 | Medio | Sin rate limiting, sin body size limit |
| Dependencies | 6/10 | Bajo | RC de Baileys, caret versioning |
| Crypto | 9/10 | Medio | Implementacion solida |
| Data Privacy | 5/10 | Alto | Buena proteccion medica, falta GDPR |

---

## Top 10 vulnerabilidades (ordenadas por severidad)

| # | Severidad | Vector | Descripcion | Archivo | Recomendacion |
|---|-----------|--------|-------------|---------|---------------|
| 1 | **CRITICO** | XSS | Flash param reflejado sin escapar en console | `console/templates.ts:719` | `esc(flash)` como fallback |
| 2 | **CRITICO** | Auth | Medilink webhook acepta todo sin key configurada | `medilink/webhook-handler.ts:107` | Hacer key obligatoria |
| 3 | **CRITICO** | Concurrency | Rate limiters TOCTOU (Gmail, Phase5, Medilink) | `gmail/rate-limiter.ts`, `phase5-validate.ts`, `medilink/rate-limiter.ts` | Lua scripts atomicos |
| 4 | **CRITICO** | Concurrency | Lead qualification read-modify-write sin transaccion | `lead-scoring/pg-queries.ts:348`, `extract-tool.ts:199` | `jsonb_set()` atomico o SELECT FOR UPDATE |
| 5 | **CRITICO** | SQL | WHERE clause dinamico en metricas de canal | `console/server.ts:1970` | Parametrizar con CASE |
| 6 | **ALTO** | Prompt Inj | User input interpolado sin escapado en prompts LLM | `engine/prompts/evaluator.ts:209` | Escapar contenido externo |
| 7 | **ALTO** | DoS | readBody() sin limite de tamano | `kernel/http-helpers.ts:8` | Agregar limite 10MB |
| 8 | **ALTO** | Auth | Google Chat webhook token opcional | `google-chat/manifest.ts:349` | Hacer token obligatorio |
| 9 | **ALTO** | SSRF | web-source-manager fetch sin validacion SSRF | `knowledge/web-source-manager.ts:97` | Reusar isBlockedUrl |
| 10 | **ALTO** | Privacy | PII (emails, telefonos) en logs de produccion | `kernel/setup/login.ts:148`, `medilink/security.ts:87` | Redaccion PII en pino |

---

## Recomendaciones de hardening (ordenadas por prioridad)

1. **Escapar flash param en console** — fix de 1 linea, elimina XSS critico
2. **Hacer webhook keys obligatorias** — Medilink y Google Chat, 2 lineas cada uno
3. **Agregar body size limit a readBody()** — ~10 lineas, elimina DoS vector principal
4. **Implementar Lua scripts para rate limiters** — reemplazar check-then-act por operaciones atomicas
5. **Agregar security headers globales** — CSP, X-Frame-Options, X-Content-Type-Options, HSTS
6. **Agregar validacion SSRF a web-source-manager y api-connector** — reusar blocklist existente
7. **Cifrar OAuth tokens en DB** — usar funciones de config-store
8. **Implementar escapado de prompt injection** — funcion centralizada para todo contenido externo en prompts
9. **Agregar rate limiting a login y endpoints criticos** — ej: 5 intentos/min por IP
10. **Implementar redaccion de PII en logs** — configurar pino redact para email, phone, patientId
11. **Wrappear lead qualification en transacciones DB** — BEGIN/SELECT FOR UPDATE/COMMIT
12. **Agregar process.on('uncaughtException/unhandledRejection')** handlers globales
13. **Crear endpoint de derecho al olvido** — cascade delete por contactId
14. **Pinear versiones criticas de dependencias** — al menos baileys, pg, ioredis
15. **Documentar procedimiento de rotacion de key de cifrado**
