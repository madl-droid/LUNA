# Auditoría: Kernel & Foundation

Fecha: 2026-03-26
Auditor: Claude (sesión automatizada)
Branch: `claude/audit-luna-kernel-D91EL`

## Resumen ejecutivo

El kernel de LUNA es un sistema modular bien diseñado con ~3,400 LOC que implementa un patrón plugin con hooks tipados, config distribuido y lifecycle management. La arquitectura es sólida y coherente. Los principales riesgos están en la capa HTTP: **no hay rate limiting, ni body size limits, ni security headers, ni CSRF protection**. La capa de autenticación es funcional pero carece de protección contra brute force. La encriptación AES-256-GCM está correctamente implementada pero usa un salt estático para la derivación de clave. El sistema es maduro para un proyecto en desarrollo activo, pero necesita hardening antes de exposición a internet sin proxy.

## Inventario

| Archivo | LOC | Propósito | Estado |
|---------|-----|-----------|--------|
| `src/kernel/config.ts` | 108 | Único lector de process.env, schema Zod, proxy read-only | ✅ Sólido |
| `src/kernel/config-store.ts` | 136 | CRUD config_store con AES-256-GCM para secretos | ⚠️ Salt estático |
| `src/kernel/config-helpers.ts` | 34 | Helpers Zod para configSchema de módulos | ✅ Sólido |
| `src/kernel/db.ts` | 57 | Pool PostgreSQL + migraciones kernel | ⚠️ Sin error handler |
| `src/kernel/redis.ts` | 22 | Conexión Redis (ioredis) | ⚠️ Muy minimal |
| `src/kernel/registry.ts` | 253 | Bus central: hooks, servicios, config, módulos | ✅ Bien diseñado |
| `src/kernel/server.ts` | 244 | HTTP server nativo + routing + auth guard | ❌ Sin hardening |
| `src/kernel/loader.ts` | 205 | Escaneo, resolución deps, activación de módulos | ✅ Sólido |
| `src/kernel/http-helpers.ts` | 77 | readBody, parseBody, jsonResponse, parseQuery | ❌ Sin límites |
| `src/kernel/types.ts` | 468 | HookMap, ModuleManifest, payloads tipados | ✅ Completo |
| `src/kernel/setup/auth.ts` | 134 | Hashing scrypt, sessions Redis, credentials | ⚠️ Sin brute force |
| `src/kernel/setup/detect.ts` | 35 | Detección de setup completado | ✅ Sólido |
| `src/kernel/setup/handler.ts` | 523 | Wizard de instalación 4 pasos | ⚠️ Sin CSRF |
| `src/kernel/setup/i18n.ts` | 129 | Diccionario bilingüe ES/EN | ✅ Completo |
| `src/kernel/setup/login.ts` | 191 | Login/logout handler con templates | ⚠️ Sin CSRF |
| `src/kernel/setup/templates.ts` | 366 | Templates SSR del wizard | ✅ Bien escapado |
| `src/kernel/migrations/001_modules.sql` | 11 | DDL kernel_modules (duplicado en db.ts) | ⚠️ Duplicado |
| `src/index.ts` | 114 | Entry point, boot sequence, graceful shutdown | ⚠️ Sin uncaught handler |
| `src/channels/types.ts` | 129 | Tipos compartidos de canal | ✅ Completo |
| `src/channels/channel-adapter.ts` | 13 | Interfaz abstracta de canal | ✅ Limpio |
| `src/channels/message-batcher.ts` | 130 | Agrupador de mensajes con debounce | ⚠️ Sin memory bound |
| `src/channels/typing-delay.ts` | 20 | Cálculo de delay de tipeo | ✅ Simple y correcto |

**Total: 3,399 LOC en 22 archivos**

## Hallazgos por componente

### 1. Config System (`config.ts`, `config-store.ts`, `config-helpers.ts`)

#### Fortalezas
- `config.ts` es efectivamente el único archivo que lee `process.env` para config de infraestructura (línea 40). Los helpers `getEnv()` y `getAllEnv()` son las únicas vías de acceso para módulos.
- Schema Zod con validación estricta de tipos y defaults razonables.
- Proxy read-only evita mutación accidental del config en runtime.
- `reloadKernelConfig()` permite hot-reload sin reinicio.
- `config-helpers.ts` cubre los patrones comunes (int, float, bool) con defaults opcionales.
- `config-store.ts` usa AES-256-GCM correctamente: IV aleatorio por operación (12 bytes), auth tag de 16 bytes, formato `iv:authTag:ciphertext`.

#### Problemas encontrados

**[MEDIO] config-store.ts:31 — Lee `process.env` directamente**
Viola la regla "ÚNICO archivo que lee process.env es config.ts". `config-store.ts:31` lee `process.env['CONFIG_ENCRYPTION_KEY']` directamente.
- Impacto: Rompe la convención, dificulta auditoría centralizada de env vars.
- Recomendación: Mover `CONFIG_ENCRYPTION_KEY` al `kernelSchema` en `config.ts` y leerlo desde ahí.

**[MEDIO] config-store.ts:33 — Salt estático en derivación de clave**
`crypto.scryptSync(envKey, 'luna-config-salt', KEY_LENGTH)` usa un salt hardcodeado. Esto debilita la derivación: si dos instancias usan la misma passphrase, generan la misma clave.
- Impacto: Reduce la seguridad de la KDF cuando se usa variable de entorno.
- Recomendación: Generar un salt aleatorio por instancia y almacenarlo junto con la clave derivada, o usar la clave directamente si ya tiene suficiente entropía (ej: 64 hex chars).

**[BAJO] config.ts:24 — Default de password DB es `luna_dev`**
`password: z.string().default('luna_dev')` — un default de contraseña en código. Solo aplica en desarrollo sin `.env`, pero podría filtrarse a producción por descuido.
- Recomendación: Considerar no tener default para password en producción (forzar configuración explícita).

**[BAJO] config-helpers.ts — `boolEnv` solo acepta 'true' como verdadero**
`v === 'true'` significa que `'TRUE'`, `'1'`, `'yes'` se evalúan como `false`. Es consistente pero potencialmente confuso.
- Impacto: Bajo — documentado implícitamente por la convención.

**[INFO] config-store.ts — No hay mecanismo de rotación de claves**
Si la clave de encriptación se compromete, no hay forma de re-encriptar todos los valores con una nueva clave.

#### Madurez: 4/5

---

### 2. Base de datos (`db.ts`)

#### Fortalezas
- Pool configuration razonable: max 20 conexiones, idle timeout 30s, connection timeout 5s.
- Todas las queries en el kernel usan parámetros (`$1`, `$2`) — no hay riesgo de SQL injection.
- Migraciones idempotentes con `CREATE TABLE IF NOT EXISTS`.
- `client.release()` siempre en bloque `finally`.

#### Problemas encontrados

**[ALTO] db.ts — Sin handler de errores del pool**
No hay `pool.on('error', ...)`. En PostgreSQL, si una conexión idle recibe un error (ej: servidor reiniciado, timeout de red), el error se emite en el pool. Sin handler, esto puede crashear el proceso con un `unhandledRejection`.
- Impacto: El proceso puede morir sin aviso si PostgreSQL se reinicia.
- Recomendación: Agregar `pool.on('error', (err) => logger.error({ err }, 'Unexpected pool error'))`.

**[MEDIO] db.ts — Sin reconnection strategy**
Si PostgreSQL cae y vuelve, el pool no tiene lógica de reconexión. `pg` Pool intenta reconectar por defecto al solicitar una nueva conexión, pero no hay backoff ni logging de esto.
- Recomendación: Agregar monitoreo de conexión y logging de reconexiones.

**[BAJO] db.ts + migrations/001_modules.sql — DDL duplicado**
`KERNEL_MIGRATIONS` en `db.ts:9-33` duplica y extiende `001_modules.sql`. El archivo SQL solo tiene `kernel_modules`, pero `db.ts` también crea `config_store` y `user_credentials`. El archivo `.sql` no se usa en runtime.
- Recomendación: Decidir una fuente de verdad para migraciones (inline vs archivos).

**[BAJO] db.ts — Sin `statement_timeout` ni `lock_timeout`**
Queries potencialmente lentos no tienen timeout. Una query bloqueada puede retener una conexión indefinidamente.
- Recomendación: Configurar `statement_timeout` a nivel de pool (ej: 30s).

#### Madurez: 3/5

---

### 3. Redis (`redis.ts`)

#### Fortalezas
- `lazyConnect: true` + `await redis.connect()` es el patrón correcto.
- `maxRetriesPerRequest` configurable desde env.

#### Problemas encontrados

**[ALTO] redis.ts — Sin handler de errores**
No hay `redis.on('error', ...)`. ioredis emite eventos `error` cuando pierde conexión. Sin handler, estos pueden propagarse como `unhandledRejection` y crashear el proceso.
- Impacto: Proceso muere si Redis se desconecta.
- Recomendación: Agregar handlers para `error`, `close`, `reconnecting`.

**[MEDIO] redis.ts — Extremadamente minimal (22 LOC)**
No hay logging de eventos de conexión/desconexión/reconexión. No hay health check. No hay cleanup de keys huérfanas.
- Recomendación: Agregar listeners para eventos `connect`, `close`, `reconnecting`, `error` con logging apropiado.

#### Madurez: 2/5

---

### 4. Registry & Hooks (`registry.ts`)

#### Fortalezas
- Sistema de hooks completamente tipado vía `HookMap` — type-safety end-to-end entre emisor y receptor.
- `runHook` (fire-and-forget) captura errores por callback individualmente — un hook roto no tumba a los demás.
- `callHook` (request-response) itera por prioridad, retorna primer resultado no-null — patrón chain of responsibility bien implementado.
- `stopAll()` detiene módulos en orden inverso de activación — correcto para dependencias.
- `deactivate()` verifica que ningún módulo activo dependa del que se desactiva — previene estados inconsistentes.
- `deactivate()` limpia hooks y servicios del módulo desactivado — buen cleanup.
- No hay race conditions reales porque Node.js es single-threaded y no hay `await` entre lectura y escritura del Map en operaciones críticas.

#### Problemas encontrados

**[MEDIO] registry.ts:199-200 — `provide()` sobrescribe sin advertencia**
`this.services.set(name, service)` silenciosamente sobrescribe un servicio existente. Si dos módulos registran el mismo nombre de servicio, el segundo gana sin log.
- Impacto: Bugs silenciosos difíciles de diagnosticar si dos módulos colisionan en nombres de servicio.
- Recomendación: Agregar `logger.warn()` si el servicio ya existe, o lanzar error.

**[BAJO] registry.ts:62-71 — Config parsing duplicado con loader**
`activate()` intenta parsear `configSchema` si no está en cache, pero el loader (línea 59-74) ya parsea todos los configs al arrancar. Este path solo se ejecuta si un módulo se activa manualmente después del boot (ej: desde la console).
- Impacto: Funcional pero redundante en el path normal. El fallback silencioso (`catch { catch { } }`) podría ocultar errores de config.
- Recomendación: Agregar logging al catch interno para visibilidad.

**[BAJO] registry.ts:209-211 — `getOptional` no distingue "no registrado" de "registrado como undefined"**
`(this.services.get(name) as T) ?? null` retorna null tanto si el servicio no existe como si fue registrado con valor `undefined`.
- Impacto: Muy bajo — en la práctica nadie registra `undefined` como servicio.

#### Madurez: 4/5

---

### 5. Module Loader (`loader.ts`)

#### Fortalezas
- Topological sort con detección de dependencias circulares (línea 183-184) — lanza error claro con la cadena de deps.
- Si un módulo falla en `init()`, se loguea el error y se continúa con los demás (línea 86-88) — resiliencia correcta.
- `syncWithDb` detecta módulos en DB pero no en filesystem — previene estados fantasma.
- `activateByDefault` permite que módulos core se auto-activen en primer descubrimiento.
- Config merging: `{ ...getAllEnv(), ...dbConfig }` da prioridad correcta a DB sobre .env.

#### Problemas encontrados

**[BAJO] loader.ts:100 — `readdirSync` bloquea event loop**
`fs.readdirSync(modulesDir)` es síncrono. Solo se ejecuta una vez al arrancar, pero con muchos módulos podría ser lento.
- Impacto: Negligible — solo en startup, no en runtime.

**[BAJO] loader.ts:80-84 — Bypass de DB write en activación inicial**
Durante el boot, `manifest.init(registry)` se llama directamente y `mod.active = true` se setea manualmente, sin pasar por `registry.activate()`. Esto salta el hook `module:activated` y el write a DB.
- Impacto: El hook `module:activated` no se dispara durante el boot inicial. Si algún módulo depende de ese hook al arrancar, no lo recibirá.
- Recomendación: Documentar esta limitación o disparar el hook después del loop de activación.

**[INFO] loader.ts:57 — Error silencioso en `configStore.getAll()`**
`catch { /* config_store may not exist yet */ }` — aceptable para primer run, pero podría ocultar errores de conexión a DB.

#### Madurez: 4/5

---

### 6. HTTP Server (`server.ts`)

#### Fortalezas
- Separación clara de concerns: setup wizard → health → login/logout → auth guard → module routes → console fallback → 404.
- Auth guard protege `/console` con validación de session Redis.
- Excepciones de auth para webhooks y OAuth callbacks vía regex.
- WebSocket upgrade handler con cleanup (destruye socket si no hay handler).
- Setup wizard se desactiva automáticamente después de completar.

#### Problemas encontrados

**[CRÍTICO] server.ts — Sin rate limiting**
No hay ningún mecanismo de rate limiting en el servidor. Un atacante puede hacer miles de requests por segundo.
- Impacto: DoS, brute force de login, abuso de API.
- Recomendación: Implementar rate limiting básico (por IP) a nivel de kernel, al menos para `/console/login` (POST) y rutas API.

**[ALTO] server.ts — Sin security headers**
No se envían headers de seguridad: `X-Content-Type-Options`, `X-Frame-Options`, `Content-Security-Policy`, `Strict-Transport-Security`, `X-XSS-Protection`.
- Impacto: Vulnerable a clickjacking, MIME sniffing, XSS.
- Recomendación: Agregar middleware que inyecte headers de seguridad en todas las respuestas.

**[ALTO] server.ts — Sin request timeout**
No hay `server.requestTimeout` ni `server.headersTimeout` configurados. Node.js <19 tiene timeout 0 (infinito).
- Impacto: Conexiones lentas (slowloris) pueden agotar las conexiones disponibles.
- Recomendación: Configurar `httpServer.requestTimeout = 30000` y `httpServer.headersTimeout = 15000`.

**[ALTO] server.ts:229-238 — WebSocket upgrade sin autenticación**
Los upgrade handlers se ejecutan sin verificar la sesión del usuario. Cualquier conexión puede intentar un WebSocket upgrade.
- Impacto: Acceso no autenticado a funcionalidades WebSocket.
- Recomendación: Validar session cookie antes de pasar al upgrade handler.

**[MEDIO] server.ts:147-148 — Route matching por prefijo puede ser ambiguo**
`urlPath!.startsWith(r.fullPath + '/')` permite que `/console/api/mod/webhook-test` matchee con una ruta registrada como `/console/api/mod/webhook`.
- Impacto: Routing inesperado si un módulo tiene rutas con nombres que son prefijos de otras.
- Recomendación: Considerar un router más preciso con soporte de path params (`:id`).

**[MEDIO] server.ts:118-120 — Regex de rutas públicas podría ser demasiado permisiva**
`/^\/console\/api\/[^/]+\/webhook/.test(urlPath0)` matchea cualquier ruta que contenga `/webhook` después del nombre de módulo, incluyendo `/webhook-admin`, `/webhook-settings`.
- Impacto: Un módulo podría tener una ruta administrativa que empiece con "webhook" y quedaría sin auth.
- Recomendación: Usar match exacto o requerir que los módulos declaren explícitamente sus rutas públicas.

#### Madurez: 2/5

---

### 7. HTTP Helpers (`http-helpers.ts`)

#### Fortalezas
- API simple y clara — funciones puras sin estado.
- `jsonResponse` centraliza el patrón writeHead + end + stringify.
- `parseQuery` usa la API estándar `URLSearchParams`.
- `oauthCallbackPage` tiene auto-close con barra de progreso — buena UX.

#### Problemas encontrados

**[CRÍTICO] http-helpers.ts:9-14 — `readBody` sin límite de tamaño**
`readBody` acumula chunks sin límite. Un atacante puede enviar un body de varios GB y agotar la memoria del proceso.
- Impacto: Denial of Service por memory exhaustion. Afecta a TODAS las rutas que usan `parseBody` o `readBody`.
- Recomendación: Agregar parámetro `maxBytes` (default 1MB) y destruir el request si se excede:
  ```typescript
  let total = 0
  req.on('data', (chunk) => {
    total += chunk.length
    if (total > maxBytes) { req.destroy(); reject(new Error('Body too large')) }
    chunks.push(chunk)
  })
  ```

**[MEDIO] http-helpers.ts:18-21 — `parseBody` no valida Content-Type**
No verifica que el request tenga `Content-Type: application/json`. Acepta cualquier body y lo parsea como JSON.
- Impacto: Bajo en la práctica, pero viola el principio de fail-fast.

**[MEDIO] http-helpers.ts:44 — `buildBaseUrl` confía en headers de proxy**
`X-Forwarded-Proto` y `X-Forwarded-Host` se toman tal cual. Sin un proxy configurado correctamente, un atacante puede inyectar estos headers.
- Impacto: URLs malformadas en redirects OAuth, potencial SSRF.
- Recomendación: Solo confiar en estos headers si hay un flag `TRUST_PROXY` configurado.

#### Madurez: 2/5

---

### 8. Auth & Setup (`setup/`)

#### Fortalezas
- Password hashing con `scrypt` (64-byte key, 16-byte random salt) — algoritmo recomendado por OWASP.
- `timingSafeEqual` para comparación de hashes (auth.ts:47) — previene timing attacks.
- Session tokens de 32 bytes aleatorios (256 bits de entropía) — suficiente.
- Cookies con `HttpOnly` y `SameSite=Lax` — previene XSS cookie theft y CSRF básico.
- Login retorna el mismo mensaje de error para "usuario no encontrado" y "contraseña incorrecta" (login.ts:148-158) — previene enumeración de usuarios.
- Setup wizard usa transacción atómica para crear admin (handler.ts:372-435).
- Factory reset requiere contraseña de admin y limpia estado previo.
- Templates usan función `esc()` para escapar HTML — previene XSS en contenido dinámico.
- Prefill de factory reset nunca incluye la contraseña (handler.ts:234).

#### Problemas encontrados

**[ALTO] Login — Sin protección contra brute force**
No hay rate limiting, ni lockout de cuenta, ni delay incremental después de intentos fallidos. Un atacante puede hacer miles de intentos de login por segundo.
- Archivo: `login.ts:141-160`
- Impacto: Contraseñas débiles pueden ser descubiertas por fuerza bruta.
- Recomendación: Implementar al menos un delay exponencial por IP o por cuenta (ej: después de 5 intentos, delay de 1s, luego 2s, 4s...).

**[ALTO] Setup/Login — Sin CSRF protection**
Los formularios POST no incluyen token CSRF. `SameSite=Lax` mitiga parcialmente (bloquea POST cross-site), pero no protege contra todos los vectores.
- Archivos: `login.ts:79`, `handler.ts` (todos los forms)
- Impacto: Un sitio malicioso podría intentar ataques CSRF en browsers que no respetan SameSite.
- Recomendación: Agregar token CSRF en formularios y validarlo en POST handlers.

**[MEDIO] auth.ts:84 — Cookie de sesión sin flag `Secure`**
`sessionCookie()` no incluye `Secure` flag. En producción detrás de HTTPS, la cookie se enviaría también por HTTP.
- Impacto: Cookie de sesión interceptable en conexiones HTTP (man-in-the-middle).
- Recomendación: Agregar `Secure` flag condicionalmente cuando `NODE_ENV === 'production'`.

**[MEDIO] auth.ts:14 — Session TTL de 30 días sin rotación**
`SESSION_TTL_SECONDS = 30 * 24 * 60 * 60`. No hay renovación ni rotación del token. Un token robado es válido por 30 días completos.
- Recomendación: Implementar session renewal (extender TTL en cada uso) o sliding window, y considerar reducir a 7 días.

**[MEDIO] handler.ts:109-111 — `generateUserId` usa `Math.random()`**
`Math.random()` no es criptográficamente seguro. Para IDs de usuario no es crítico, pero es una práctica débil.
- Recomendación: Usar `crypto.randomInt()` en su lugar.

**[BAJO] handler.ts:49-63 + login.ts:99-111 — `parseFormBody` duplicado**
La función `parseFormBody` está implementada idénticamente en ambos archivos. Viola DRY.
- Recomendación: Extraer a `http-helpers.ts` como `parseFormBody`.

**[BAJO] handler.ts:69-106 — DDL copiado del módulo users**
`USERS_DDL` duplica el schema del módulo `users`. Si el módulo users cambia su DDL, este código puede quedar desincronizado.
- Recomendación: Documentar la dependencia o extraer el DDL a un lugar compartido.

**[BAJO] handler.ts:156 — State del wizard almacena password en memoria**
`SetupState.adminPassword` contiene la contraseña en texto plano en memoria durante el flujo del wizard. Se limpia al finalizar (línea 471), pero persiste durante toda la sesión del wizard.
- Impacto: Bajo — es efímero y solo durante el setup inicial.

#### Madurez: 3/5

---

### 9. Channel Abstractions (`src/channels/`)

#### Fortalezas
- `ChannelAdapter` es una interfaz mínima y limpia (4 métodos) — fácil de implementar.
- `ChannelRuntimeConfig` es exhaustivo: rate limiting, anti-spam, anti-flooding, typing delay, attachments.
- `MessageBatcher` implementa debounce con flood threshold y retry con backoff.
- `calculateTypingDelay` es simple, puro, y correcto — clamp entre min y max.
- `MessageBatcher.clearAll()` para shutdown limpio.
- Hot-reload de parámetros (`updateWaitSeconds`, `updateFloodThreshold`).

#### Problemas encontrados

**[MEDIO] message-batcher.ts — Sin memory bounds en pending map**
`this.pending` es un `Map<string, PendingBatch>` sin límite. Si miles de senders envían un mensaje cada uno, el Map crece indefinidamente. Los timers mantienen las entradas vivas.
- Impacto: En un escenario de muchos senders únicos (ej: broadcast reply storm), podría consumir memoria significativa.
- Recomendación: Agregar un límite máximo de pending batches (ej: 10,000) y flush inmediato al exceder.

**[MEDIO] message-batcher.ts:94-103 — Mensajes perdidos sin recuperación**
Si el handler falla 2 veces (original + retry), los mensajes se descartan con un log de error. No hay dead letter queue ni persistencia.
- Impacto: Mensajes de usuario perdidos permanentemente en caso de error sostenido del handler.
- Recomendación: Considerar persistir mensajes fallidos en Redis o DB para retry posterior.

**[BAJO] message-batcher.ts:51 — `void this.flush(key)` fire-and-forget**
El flush por flood threshold no espera el resultado. Si falla, el error se captura internamente pero el caller (`.add()`) no lo sabe.
- Impacto: Bajo — los errores se loguean.

#### Madurez: 3/5

---

### 10. Entry Point (`src/index.ts`)

#### Fortalezas
- Graceful shutdown para SIGTERM y SIGINT — esencial para Docker.
- Orden de shutdown correcto: server → módulos → redis → db.
- Setup wizard como servidor temporal que se cierra después de completar — buen patrón.
- Auto-mount de rutas API para módulos activos + hooks para mount/unmount dinámico.
- `main().catch()` atrapa errores fatales del bootstrap.

#### Problemas encontrados

**[ALTO] index.ts — Sin handler de `uncaughtException` ni `unhandledRejection`**
No hay `process.on('uncaughtException', ...)` ni `process.on('unhandledRejection', ...)`. Un error no capturado en cualquier parte del sistema (ej: un callback de hook, un timer) crashea el proceso sin logging.
- Impacto: El proceso muere silenciosamente. En Docker con restart policy se reinicia, pero se pierde contexto del error.
- Recomendación:
  ```typescript
  process.on('uncaughtException', (err) => {
    logger.fatal({ err }, 'Uncaught exception — shutting down')
    process.exit(1)
  })
  process.on('unhandledRejection', (reason) => {
    logger.fatal({ reason }, 'Unhandled rejection — shutting down')
    process.exit(1)
  })
  ```

**[BAJO] index.ts:92-104 — Shutdown sin timeout**
`shutdown()` espera que todos los módulos terminen su `stop()` sin límite de tiempo. Un módulo colgado puede bloquear el shutdown indefinidamente.
- Impacto: Docker envía SIGKILL después de su timeout (default 10s), pero el shutdown no es limpio.
- Recomendación: Agregar un setTimeout de respaldo (ej: `setTimeout(() => process.exit(1), 15000)`).

#### Madurez: 3/5

---

### 11. Types (`types.ts`)

#### Fortalezas
- `HookMap` como single source of truth para todos los hooks del sistema — excelente para type-safety.
- Tupla `[payload, returnType]` distingue claramente acciones (void) de filtros (T).
- Payload interfaces son específicos y bien nombrados.
- `ModuleManifest` es suficientemente estricto: requiere name, version, description (bilingüe), type, removable, init.
- `ConsoleField` tiene buena cobertura de tipos de UI.
- `ConnectionWizardDef` con documentación inline detallada.

#### Problemas encontrados

**[BAJO] types.ts:292 — `configSchema` usa `ZodObject<any>`**
El `any` rompe la cadena de type-safety para config schemas. Es pragmático (cada módulo tiene su propio schema shape), pero impide validación de tipo en compile-time.
- Impacto: Bajo — la validación ocurre en runtime vía Zod. El eslint-disable está documentado.

**[INFO] types.ts — `HookMap` podría beneficiarse de categorización**
Los 25+ hooks están en una lista plana. Agruparlos en sub-interfaces (`MessageHooks`, `LLMHooks`, etc.) mejoraría la navegabilidad.

#### Madurez: 5/5

---

## Bugs encontrados

| # | Severidad | Archivo:Línea | Descripción | Impacto |
|---|-----------|---------------|-------------|---------|
| 1 | ALTO | `db.ts` (global) | Sin `pool.on('error')` — error en conexión idle crashea proceso | Downtime no controlado |
| 2 | ALTO | `redis.ts` (global) | Sin `redis.on('error')` — desconexión de Redis crashea proceso | Downtime no controlado |
| 3 | ALTO | `index.ts` (global) | Sin handler de `uncaughtException`/`unhandledRejection` | Proceso muere sin logging |
| 4 | MEDIO | `loader.ts:80-84` | Boot no dispara hook `module:activated` para módulos iniciales | Módulos que dependen de ese hook no reciben notificación al arrancar |
| 5 | MEDIO | `registry.ts:199` | `provide()` sobrescribe servicios sin advertencia | Colisiones de nombres pasan desapercibidas |
| 6 | BAJO | `handler.ts:49` + `login.ts:99` | `parseFormBody` duplicado en dos archivos | Drift potencial si se modifica solo uno |
| 7 | BAJO | `db.ts:9` + `migrations/001_modules.sql` | DDL de `kernel_modules` duplicado | Drift potencial |

## Riesgos de seguridad

| # | Severidad | Descripción | Vector de ataque | Mitigación recomendada |
|---|-----------|-------------|-------------------|------------------------|
| 1 | CRÍTICO | `readBody` sin límite de tamaño | Enviar body de varios GB → OOM → DoS | Agregar `maxBytes` param (default 1MB) |
| 2 | CRÍTICO | Sin rate limiting en todo el servidor | Flood de requests → DoS / brute force | Rate limiter por IP, mínimo en login |
| 3 | ALTO | Sin security headers (CSP, X-Frame, HSTS) | Clickjacking, MIME sniffing, XSS | Middleware de headers en server.ts |
| 4 | ALTO | Login sin protección brute force | Diccionario de passwords por fuerza bruta | Delay exponencial o lockout temporal |
| 5 | ALTO | WebSocket upgrade sin autenticación | Conexión WS sin session válida | Validar cookie antes de upgrade |
| 6 | ALTO | Sin request timeout en HTTP server | Slowloris → agotamiento de conexiones | `requestTimeout = 30000` |
| 7 | ALTO | Sin CSRF tokens en formularios | POST cross-site (mitigado parcialmente por SameSite=Lax) | Agregar token CSRF |
| 8 | MEDIO | Cookie de sesión sin flag `Secure` | Intercepción en HTTP (MITM) | `Secure` en producción |
| 9 | MEDIO | Session de 30 días sin rotación | Token robado válido 30 días | Sliding window + TTL menor |
| 10 | MEDIO | `buildBaseUrl` confía en X-Forwarded-* | Header spoofing → redirect malicioso | Flag `TRUST_PROXY` |
| 11 | MEDIO | Salt estático en derivación de clave (config-store) | Misma passphrase → misma clave entre instancias | Salt aleatorio por instancia |
| 12 | MEDIO | Regex de rutas públicas demasiado permisiva | Ruta admin con "webhook" en el nombre queda sin auth | Match exacto o lista explícita |

## Deuda técnica

| # | Prioridad | Descripción | Esfuerzo estimado |
|---|-----------|-------------|-------------------|
| 1 | Alta | Agregar body size limits a `readBody`/`parseBody` | 1h |
| 2 | Alta | Agregar error handlers a pool PG y Redis | 30min |
| 3 | Alta | Agregar `uncaughtException`/`unhandledRejection` handlers | 15min |
| 4 | Alta | Rate limiting básico (al menos para login) | 2-4h |
| 5 | Alta | Security headers middleware | 1h |
| 6 | Media | CSRF tokens para formularios del kernel | 2-3h |
| 7 | Media | Request timeout y shutdown timeout | 30min |
| 8 | Media | Secure cookie flag condicional | 15min |
| 9 | Media | Session rotation/renewal | 1-2h |
| 10 | Media | Logging de reconexión Redis | 30min |
| 11 | Baja | Unificar `parseFormBody` en http-helpers | 30min |
| 12 | Baja | Resolver duplicación de DDL (migrations vs inline) | 1h |
| 13 | Baja | Agregar `statement_timeout` al pool PG | 15min |
| 14 | Baja | Memory bounds en MessageBatcher | 1h |
| 15 | Baja | Salt dinámico para config-store KDF | 1h |

## Madurez general: 3.2/5

**Justificación:** La arquitectura del kernel es sólida y bien pensada (registry, hooks tipados, loader con topological sort, config distribuido). El código es limpio, consistente, y sigue las convenciones del proyecto. Sin embargo, la capa HTTP carece de hardening básico (rate limiting, body limits, security headers, timeouts), lo cual es el área más crítica para remediar. La autenticación es funcional pero le falta protección anti-brute-force. Las capas de datos (PG/Redis) necesitan error handlers para evitar crashes silenciosos. El sistema de tipos y el module system son los puntos más maduros del kernel.

## Top 10 recomendaciones (ordenadas por impacto)

1. **Agregar body size limit a `readBody`** — Previene DoS por memory exhaustion. 1 hora de trabajo, protege todas las rutas. (`http-helpers.ts`)

2. **Agregar error handlers a Pool PG y Redis** — Previene crashes silenciosos. 30 min. (`db.ts`, `redis.ts`)

3. **Agregar `uncaughtException`/`unhandledRejection` handlers** — Garantiza logging de errores fatales. 15 min. (`index.ts`)

4. **Implementar rate limiting en login** — Previene brute force. Mínimo: contador en Redis por IP, delay exponencial después de 5 intentos. 2-4h. (`login.ts`, `server.ts`)

5. **Agregar security headers** — Middleware simple que inyecte `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: strict-origin-when-cross-origin`. 1h. (`server.ts`)

6. **Configurar request timeout** — `httpServer.requestTimeout = 30000` y `httpServer.headersTimeout = 15000`. 15 min. (`server.ts`)

7. **Autenticación en WebSocket upgrade** — Validar session cookie antes de pasar al handler de upgrade. 1h. (`server.ts:229`)

8. **Agregar flag `Secure` a session cookie en producción** — Condicionar en `sessionCookie()` basado en `NODE_ENV`. 15 min. (`auth.ts`)

9. **Agregar shutdown timeout** — `setTimeout(() => process.exit(1), 15000)` como respaldo en shutdown. 15 min. (`index.ts`)

10. **CSRF tokens para formularios** — Generar token en GET, validar en POST. Protege login y setup wizard. 2-3h. (`login.ts`, `handler.ts`)

