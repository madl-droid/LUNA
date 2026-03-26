# Auditoría: Integraciones & Providers
Fecha: 2026-03-26
Auditor: Claude (sesión automatizada)

## Resumen ejecutivo

El ecosistema de integraciones tiene buena arquitectura modular y sigue las convenciones del proyecto. **Google Apps** (OAuth2 + 5 servicios) tiene tokens almacenados en texto plano en PostgreSQL — el hallazgo más crítico. **Medilink** destaca con un modelo de seguridad de 3 capas y rate limiter sofisticado, pero tiene un bug crítico de URLs localhost en voice calls y webhooks abiertos por defecto. **Engine wrapper** es más que un bridge — acumula migraciones y lógica que podría distribuirse mejor. No hay violaciones de arquitectura en runtime (todos los imports cross-módulo son type-only).

## Inventario

| Módulo | Archivos | LOC | Type | Depends | APIs externas | Estado |
|--------|----------|-----|------|---------|---------------|--------|
| google-apps | 10 .ts | ~2,587 | provider | [] | Google OAuth2, Drive, Sheets, Docs, Slides, Calendar | Funcional, gaps de seguridad |
| medilink | 10 .ts | ~4,058 | feature | [tools, memory, scheduled-tasks] | HealthAtom/Medilink API | Funcional, bugs puntuales |
| engine | 1 .ts | ~516 | core-module | [memory, llm] | — | Funcional, sobrecargado |

## Google Apps

### Archivos

| Archivo | LOC | Propósito |
|---------|-----|-----------|
| types.ts | 209 | Interfaces para todos los servicios |
| manifest.ts | 392 | Lifecycle, config, API routes, migraciones |
| oauth-manager.ts | 309 | OAuth2 flow, token refresh, persistencia DB |
| drive-service.ts | 243 | Google Drive CRUD |
| sheets-service.ts | 127 | Google Sheets read/write/create |
| docs-service.ts | 150 | Google Docs read/create/edit |
| slides-service.ts | 156 | Google Slides read/create/edit |
| calendar-service.ts | 273 | Google Calendar events, free/busy |
| tools.ts | 728 | 27 tools registradas para los 5 servicios |

### OAuth2 Security Assessment

- **Token storage: TEXTO PLANO** — `access_token` y `refresh_token` se guardan sin encriptar en tabla `google_oauth_tokens` (oauth-manager.ts:270-276). Las credenciales del cliente (client_secret) SÍ se encriptan via config_store AES-256-GCM, pero los tokens de acceso no.
- **Token refresh: AUTOMÁTICO** — Se programa refresh antes de expiración con buffer configurable (default 5 min). En fallo, reintenta a los 60s (oauth-manager.ts:148). Restaura tokens de DB al reiniciar.
- **Scopes: SOBRE-PERMISIONADOS** — Todos los servicios piden scope completo read+write:
  - `auth/drive` (en vez de `drive.file` o `drive.readonly`)
  - `auth/spreadsheets` (en vez de `spreadsheets.readonly`)
  - `auth/documents` (en vez de `documents.readonly`)
  - `auth/presentations` (en vez de `presentations.readonly`)
  - `auth/calendar` (en vez de `calendar.events`)
- **Inconsistencia Gmail** — manifest.ts:145 siempre agrega `'gmail'` a enabled services, aunque línea 122 dice "Gmail scopes removed" y el módulo gmail maneja su propio OAuth.

### Por servicio

#### Drive
- CRUD completo: list, get, create folder/file, move, delete (trash), share, download, export.
- Delete usa trash (soft delete) — buena práctica.
- **Vulnerabilidad de query injection** (drive-service.ts:32-38): `folderId`, `mimeType` y `query` se interpolan directamente en el query string del Drive API con template literals. Un `folderId` malicioso con `'` podría alterar la semántica del query.
- Download carga archivo completo en memoria como Buffer — sin streaming para archivos grandes (drive-service.ts:220-226).

#### Sheets
- Implementación limpia: read, write, append, clear, create, add sheet.
- Usa `USER_ENTERED` como input option por defecto — apropiado.
- Sin soporte de batch read/write para múltiples rangos.

#### Docs
- Read, create, insert, replace, append text.
- `appendText` hace 2 API calls (get doc + batchUpdate) — race condition posible en escrituras concurrentes (docs-service.ts:98-117).
- Extracción de texto maneja párrafos y tablas recursivamente.

#### Slides
- Read, create, add slide, replace text, insert text in shape.
- `addSlide` usa `Date.now()` para objectId (slides-service.ts:72) — colisión posible en llamadas rápidas.
- Extracción de texto solo maneja shapes, ignora tablas y grupos.

#### Calendar
- Servicio más completo: list calendars, CRUD events, attendees, free/busy.
- `updateEvent` y `addAttendees` hacen read-modify-write (2 calls) sin locking — race condition en concurrencia.
- `sendUpdates` default `'all'` — envía emails a todos los attendees en cada cambio.

### Rate limit handling

**INEXISTENTE.** Los params `GOOGLE_API_TIMEOUT_MS` y `GOOGLE_API_RETRY_MAX` están definidos en configSchema (manifest.ts:275-276) pero **nunca se usan** en ningún servicio. No hay timeouts, retries, ni manejo de HTTP 429 en ninguna llamada a Google APIs.

### Error handling

- OAuth manager: try/catch con transiciones de estado y retry programado. Sólido.
- API routes: try/catch genérico con 500 + `String(err)` que podría filtrar detalles internos.
- **Servicios: SIN try/catch.** Errores propagan sin manejo hasta el framework de tools.

### Fortalezas

1. Arquitectura modular limpia — cada servicio es clase standalone, tools se registran condicionalmente por servicio habilitado
2. OAuth2 lifecycle correcto — auto-refresh con buffer, restore de DB, cleanup de timers en shutdown
3. Config schema validado con Zod, usa helpers del kernel correctamente
4. Soft delete para Drive files (trash en vez de delete permanente)
5. Redirect URI dinámico construido del request, no hardcodeado — funciona en múltiples deploys
6. Toggle granular por servicio — cada servicio Google se puede habilitar/deshabilitar independientemente
7. Wizard de console para setup de credenciales sin necesidad de env vars
8. `getState()` retorna copia, no referencia

### Problemas encontrados

| # | Severidad | Archivo:Línea | Descripción | Impacto | Recomendación |
|---|-----------|---------------|-------------|---------|---------------|
| G1 | **CRÍTICO** | oauth-manager.ts:270-276 | Tokens OAuth (access_token, refresh_token) almacenados en **texto plano** en tabla `google_oauth_tokens` | Compromiso de DB expone tokens con acceso completo a cuenta Google | Encriptar tokens usando mecanismo AES-256-GCM existente de config-store |
| G2 | **ALTO** | drive-service.ts:32-38 | Query string del Drive API construido con interpolación sin escapar | Valores controlados por atacante en folderId/mimeType/query pueden manipular el query de búsqueda | Escapar comillas simples en valores o validar formato (folderId: `[a-zA-Z0-9_-]+`) |
| G3 | **MEDIO** | manifest.ts:275-276, todos los servicios | `GOOGLE_API_TIMEOUT_MS` y `GOOGLE_API_RETRY_MAX` definidos pero **nunca usados** | Sin timeout (calls pueden colgar indefinidamente), sin retry en fallos transitorios, sin manejo de 429 | Implementar wrapper compartido con AbortController timeout + retry exponencial para 429/5xx |
| G4 | **MEDIO** | manifest.ts:145 | Ruta `auth-url` siempre agrega `'gmail'` a enabled services | Solicita scope de Gmail innecesariamente, contradice documentación | Remover línea 145 o documentar el acoplamiento intencional |
| G5 | **MEDIO** | Todos los servicios | Scopes piden acceso completo read+write (auth/drive en vez de drive.file) | Viola principio de mínimo privilegio. Token comprometido = acceso total | Usar scopes granulares: `drive.file`, `calendar.events`, variantes readonly |
| G6 | **BAJO** | manifest.ts:188,211 | Respuestas de error incluyen `String(err)` crudo | Podría filtrar stack traces o paths internos a la UI de console | Sanitizar errores, loguear detalle solo server-side |
| G7 | **BAJO** | calendar-service.ts:106-131, docs-service.ts:98-117 | Patrón read-modify-write (get + update) sin locking | Race condition en requests concurrentes al mismo evento/documento | Aceptable para single-instance pero documentar limitación |
| G8 | **BAJO** | slides-service.ts:72 | ObjectId de slide usa `Date.now()` | Colisión posible en llamadas rápidas sucesivas | Usar `crypto.randomUUID()` |
| G9 | **BAJO** | drive-service.ts:220-226 | `downloadFile` carga archivo entero en memoria como Buffer | Archivos grandes pueden causar OOM | Streaming a disco o implementar límite de tamaño |
| G10 | **BAJO** | tools.ts (todos los handlers) | Sin try/catch en ningún handler de tool | Errores propagan sin manejo al framework de tools | Aceptable si el framework los captura; sino, wrappear en try/catch |

### Madurez: 3.0/5

Buena arquitectura y organización. OAuth2 lifecycle sólido. Pero tokens en texto plano, ausencia total de rate limiting/retry (a pesar de tener config para ello), y scopes sobre-permisionados indican que se priorizó funcionalidad sobre seguridad y resiliencia.

## Medilink / HealthAtom

### Archivos

| Archivo | LOC | Propósito |
|---------|-----|-----------|
| types.ts | 412 | Interfaces: Patient, Appointment, Professional, Evolution, Config, Webhook, Audit, FollowUp, Security |
| api-client.ts | 330 | HTTP client con retry, paginación, rate limiting, AbortController timeout |
| cache.ts | 268 | Redis + in-memory cache para reference data y disponibilidad |
| rate-limiter.ts | 150 | Token bucket con priority queue, Redis sliding window |
| security.ts | 334 | Verificación de identidad, control de acceso, filtrado de datos, auditoría |
| webhook-handler.ts | 120 | Recepción webhook, verificación HMAC, dispatch |
| follow-up-scheduler.ts | 475 | Secuencia de 9 toques de follow-up, delega a scheduled-tasks |
| tools.ts | 834 | 11 tools del agente (disponibilidad, pacientes, citas, pagos, evoluciones, etc.) |
| pg-store.ts | 619 | 7 migraciones de tablas, todos los queries SQL |
| manifest.ts | 516 | Lifecycle, configSchema (25 params), 13 API routes, init/stop |

### Data Privacy Assessment

- **PII médica protegida: SÍ (parcialmente)**
  - Notas clínicas (`evo.datos`) NUNCA se exponen — `filterEvolution()` las elimina explícitamente (security.ts:265-273)
  - Datos de citas filtrados por nivel de verificación: `phone_matched` solo ve fecha/hora/estado; `document_verified` ve detalles completos
  - Montos de pago condicionados a verificación de documento cuando `MEDILINK_REQUIRE_DOCUMENT_FOR_DEBTS=true`
  - Aislamiento de pacientes: `ownsAppointment()` verifica match de `id_paciente` en cada acceso

- **Logging sanitizado: PARCIALMENTE**
  - ❌ Teléfono logueado en nivel `info` (security.ts:87): `logger.info({ phone: ctx.contactPhone, count: patients.length }, ...)`
  - ❌ Número de documento almacenado en campo `detail` JSONB de audit log (security.ts:113,129)
  - ❌ Teléfonos en audit detail (security.ts:78, tools.ts:249)
  - ✅ IDs de contacto/paciente en logs son aceptables (security.ts:325)

- **Datos encriptados:**
  - ✅ En tránsito: HTTPS hacia Medilink API, token como `Authorization: Token` header
  - ✅ API token y webhook keys almacenados via config_store (AES-256-GCM)
  - ❌ En reposo: datos de pacientes en PostgreSQL sin encriptación a nivel aplicación
  - ❌ Cache Redis: datos de pacientes cacheados sin encriptar (5 min TTL)

### Por funcionalidad

#### Pacientes
- Búsqueda por teléfono (auto-link) y por documento (RUT). Normalización de teléfono básica (`replace(/[^0-9+]/g, '')`)
- Creación valida que teléfono coincida con el del contacto. Rechaza si ya está vinculado a otro paciente
- Edit requests requieren nivel `document_verified`, pasan por workflow de aprobación admin
- Resolución de identidad en 3 niveles (unverified → phone_matched → document_verified) — bien diseñado

#### Citas / Disponibilidad
- Disponibilidad cacheada en Redis con TTL configurable (default 10 min), invalidada por webhooks
- Filtra sillas de sobrecupo ("sobrecupo")
- Valida compatibilidad profesional-tratamiento via scheduling rules
- **Sin validación de double-booking a nivel aplicación** — depende enteramente de HealthAtom API para rechazar conflictos
- `processAgendaResponse` setea `professionalId: 0` y `professionalName: ''` en todos los slots (cache.ts:169-170) — dato incompleto

#### Follow-up (sistema de 9 toques)
- Secuencia completa: confirmación inmediata → recordatorios → fallbacks → reactivación post no-show
- Sistema de prerrequisitos previene spam: fallback_a solo si touch_1 falló, touch_3 solo si paciente confirmó
- Detección de confirmación cancela toques fallback pendientes
- Templates con sustitución de placeholders + personalización LLM opcional
- Fallback de voice a WhatsApp si twilio-voice no disponible
- **Bug: reschedule cancela follow-ups pero NO crea nuevos** (tools.ts:672, manifest.ts:450)

#### Webhooks
- Verificación en dos capas: check de public key + HMAC-SHA256 con `crypto.timingSafeEqual` (correcto)
- Fire-and-forget después de responder 200 (patrón correcto)
- Invalidación de cache automática por tipo de entidad
- Todos los webhooks logueados a `medilink_webhook_log`
- **Sin replay protection**: no hay validación de timestamp ni check de idempotencia

### API resilience (timeout, retry, circuit breaker)

| Mecanismo | Implementación | Evaluación |
|-----------|---------------|------------|
| Timeout | `AbortController` + `MEDILINK_API_TIMEOUT_MS` (default 15s) | ✅ Bueno |
| Retry | 3 reintentos con backoff exponencial (base 2s: 2s, 4s, 8s) | ✅ Bueno |
| 429 handling | Respeta header `Retry-After`, fallback 5s | ✅ Bueno |
| Rate limiting | Token bucket + Redis sliding window + priority queue (high/medium/low) | ✅ Excelente |
| Rate limit fallback | Contador local si Redis falla | ✅ Bueno |
| Paginación | Auto-paginación con MAX_PAGES=10 | ✅ Bueno |
| Circuit breaker | **No existe** a nivel módulo | ⚠️ Gap |
| Health check | Periódico (default 6h), loguea warning en fallo | ⚠️ Básico |

### Fortalezas

1. **Modelo de seguridad de 3 capas** — verificación de identidad, aislamiento de datos, audit trail obligatorio en cada acceso
2. **Notas clínicas nunca expuestas** — `filterEvolution()` elimina `datos` explícitamente
3. **Rate limiter production-grade** — priority queue, Redis sliding window, fallback local, drain interval configurable
4. **HMAC webhook** usa `timingSafeEqual` — resistente a timing attacks
5. **Sistema de prerrequisitos** en follow-up previene spam de mensajes
6. **Hot-reload** via hook `console:config_applied` sin necesidad de restart
7. **Audit trail comprehensivo** con tabla dedicada e indexada
8. **API client con paginación** cursor-based y límite de seguridad MAX_PAGES
9. **SQL parametrizado** ($1, $2) en todo el módulo — sin riesgo de SQL injection
10. **Edit requests** pasan por workflow de aprobación admin con audit before/after

### Problemas encontrados

| # | Severidad | Archivo:Línea | Descripción | Impacto | Recomendación |
|---|-----------|---------------|-------------|---------|---------------|
| M1 | **CRÍTICO** | follow-up-scheduler.ts:406-411 | URLs de voice call usan `https://localhost:{port}` | Voice calls fallarán en cualquier deploy no-local | Usar `BASE_URL` de kernel config para construir URLs externas |
| M2 | **ALTO** | webhook-handler.ts:52,63 | Verificación de webhook se salta silenciosamente cuando keys están vacías (el default) | Módulo sin configurar acepta CUALQUIER webhook — atacante puede invalidar caches, cancelar follow-ups | Rechazar webhooks cuando keys no están configuradas, o loguear warning prominente |
| M3 | **ALTO** | follow-up-scheduler.ts:423-431 | Lista de keywords de confirmación demasiado amplia ("si", "ok", "dale", "perfecto") | Mensaje como "si, pero no puedo ir" confirma falsamente y cancela toda la secuencia de follow-up | Requerir match más estricto, considerar detección de intención con LLM |
| M4 | **MEDIO** | tools.ts:672, manifest.ts:450 | Reschedule cancela follow-ups pero NO crea nuevos | Citas reprogramadas quedan sin secuencia de follow-up | Llamar `scheduleSequence()` después del reschedule |
| M5 | **MEDIO** | cache.ts:169-170 | `processAgendaResponse` setea `professionalId: 0` y `professionalName: ''` en todos los slots | Datos de disponibilidad incompletos para el agente | Resolver profesional del contexto de la agenda |
| M6 | **MEDIO** | security.ts:87 | Teléfono logueado a stdout en nivel `info` | PII filtrada a log aggregators | Loguear solo últimos 4 dígitos o hash |
| M7 | **MEDIO** | webhook-handler.ts (ausente) | Sin replay protection — no hay validación de timestamp ni idempotencia | Webhooks capturados pueden re-ejecutarse indefinidamente | Validar timestamp + check contra `medilink_webhook_log` para duplicados |
| M8 | **MEDIO** | cache.ts:186-198 | Usa comando `KEYS` de Redis para invalidación de cache | `KEYS` bloquea Redis en keyspaces grandes | Usar iterador `SCAN` |
| M9 | **MEDIO** | pg-store.ts:541,568 | `setProfessionalTreatments` y `setUserTypeRules` hacen DELETE + INSERTs individuales sin transacción | Race condition: reads concurrentes podrían ver tablas vacías | Wrappear en transacción (BEGIN/COMMIT) |
| M10 | **BAJO** | tools.ts:245 | Phone match es substring (`includes()`) | Phone `+5691234` matchearía `91234`. Falsos positivos con números cortos | Usar match exacto después de normalizar ambos a E.164 |
| M11 | **BAJO** | tools.ts:259 | Sin check de duplicados antes de crear paciente | Posibles pacientes duplicados si HealthAtom no lo rechaza | Llamar `findPatientByDocument` primero |
| M12 | **BAJO** | tools.ts (ausente) | No existe tool de cancelación de cita | Pacientes solo pueden reprogramar, no cancelar | Agregar tool `medilink-cancel-appointment` |
| M13 | **BAJO** | pg-store.ts:594 | Payload completo de webhook almacenado como JSONB | Si HealthAtom envía PII en payloads, se persiste sin redactar | Sanitizar payload antes de almacenar |
| M14 | **BAJO** | follow-up-scheduler.ts:163 | Cron dummy `'0 0 31 2 *'` (31 de febrero) para scheduled tasks | Hack frágil — si scheduled-tasks valida cron estrictamente, se rompe | Usar `trigger_type: 'delayed_only'` |
| M15 | **BAJO** | tools.ts:51 | `agentId = 'default'` hardcodeado en todas las tools | Deploys multi-agente compartirían vínculos de pacientes | Pasar `agentId` del contexto de tool |
| M16 | **MEDIO** | manifest.ts:398 | `medilink:api` expuesto como service sin wrapper de seguridad | Cualquier módulo puede llamar `createPatient()`, `updatePatient()` bypassing la capa de seguridad | No exponer `medilink:api` directamente, o wrappear con security checks |
| M17 | **MEDIO** | tools.ts:260-267 | Sin validación de formato en campos de creación de paciente (nombre, email, documento) | Datos malformados llegan directo a HealthAtom API | Validar formato de email, largo de nombres, formato de RUT |
| M18 | **BAJO** | follow-up-scheduler.ts | Sin mecanismo de opt-out para pacientes | Paciente no puede decir "stop" para detener follow-ups | Agregar detección de opt-out y flag por contacto |

### Madurez: 3.5/5

Módulo bien diseñado con modelo de seguridad sofisticado, rate limiter production-grade, y follow-up inteligente. Las deducciones son por: bug crítico de localhost (M1), webhooks abiertos por defecto (M2), confirmación falsa-positiva (M3), y reschedule sin re-follow-up (M4). Con estos fixes aplicados, sería 4.0+.

## Engine Wrapper

### Assessment

El manifest.ts (~516 LOC) va **mucho más allá** de un simple bridge kernel↔engine:

1. **Migraciones DB** (líneas 342-404): Crea tablas `ack_messages` y `daily_reports`, renombra columnas, siembra datos por defecto, ejecuta `runAttachmentMigration()`
2. **Registro de tools** (líneas 409-410): Registra `query-attachment` y `web-explore` via imports directos de `src/engine/attachments/tools/`
3. **2 config services** (líneas 415-445): Provee `engine:attachment-config` y `engine:nightly-config` con getters hot-reloadable
4. **Hot-reload handler** (líneas 448-461): Escucha `console:config_applied` e implementa switching dinámico de log-level consultando `config_store` para `DEBUG_EXTREME_LOG`
5. **Console UI** (líneas 92-335): Panel extenso de ~240 líneas con campos para concurrencia, attachments, y parámetros de batch nocturno
6. **API route** (líneas 326-335): `GET /console/api/engine/stats`

### ¿Es necesario?

**Sí**, el kernel necesita un manifest para gestionar el lifecycle del engine. Sin embargo, acumula responsabilidades que podrían distribuirse:
- El log-level switching (451-461) es cross-cutting y podría vivir en el kernel o un módulo de debug
- Las tablas `ack_messages` y `daily_reports` podrían vivir en sus respectivos subsistemas

Es una decisión pragmática consolidar toda la inicialización del engine en un manifest, pero genera un archivo grande y con responsabilidades mixtas.

### Madurez: 3.5/5

Funcional y sigue convenciones del proyecto. La sobrecarga de responsabilidades es un code smell pero no un bug.

## Inter-module Communication Analysis

### Services expuestos

| Módulo | Service name | Métodos/propósito | Consumidores |
|--------|-------------|-------------------|--------------|
| google-apps | `google:oauth-client` | OAuth2Client raw | gmail, cualquier módulo |
| google-apps | `google:oauth-manager` | OAuthManager (refresh, state, etc.) | gmail |
| google-apps | `google:drive` | DriveService (CRUD) | tools |
| google-apps | `google:sheets` | SheetsService | tools |
| google-apps | `google:docs` | DocsService | tools |
| google-apps | `google:slides` | SlidesService | tools |
| google-apps | `google:calendar` | CalendarService | tools |
| medilink | `medilink:api` | MedilinkApiClient | tools, webhooks |
| medilink | `medilink:cache` | MedilinkCache | tools, follow-up |
| medilink | `medilink:security` | MedilinkSecurity | tools |
| medilink | `medilink:followup` | FollowUpScheduler | tools, webhooks |
| engine | `engine:attachment-config` | Config getter (hot-reloadable) | engine pipeline |
| engine | `engine:nightly-config` | Config getter (hot-reloadable) | engine pipeline |

### Hooks

| Módulo | Hook emitido/consumido | Tipo | Consumidores/emisores | Documentado |
|--------|----------------------|------|----------------------|-------------|
| engine | `console:config_applied` | consumido | console → engine | Sí |
| medilink | `message:incoming` | consumido | channels → medilink | Sí |
| medilink | `message:send` | emitido | medilink → channels | Sí |
| medilink | `llm:chat` | emitido (callHook) | medilink → llm | Sí |
| medilink | `console:config_applied` | consumido | console → medilink | Sí |
| google-apps | — | ninguno | — | N/A |

**Nota:** google-apps no emite ni consume hooks — es puramente un service provider. Esto es inusual para un módulo tan grande pero aceptable dado que es un provider de infraestructura.

### Imports directos encontrados (violaciones)

| Archivo origen | Importa de | Tipo | Severidad |
|---------------|-----------|------|-----------|
| google-apps/tools.ts | ../tools/tool-registry.js | `import type` only | ✅ Aceptable |
| gmail/manifest.ts | ../google-apps/oauth-manager.js | `import type` only | ✅ Aceptable |
| google-chat/manifest.ts | ../prompts/types.js | `import type` only | ✅ Aceptable |
| lead-scoring/extract-tool.ts | ../tools/types.js, ../tools/tool-registry.js | `import type` only | ✅ Aceptable |
| knowledge/manifest.ts | ../tools/tool-registry.js | `import type` only | ✅ Aceptable |

**Resultado: CERO violaciones runtime.** Todos los imports cross-módulo son `import type` (borrados en compilación). No hay acoplamiento en runtime.

**Nota menor:** `model-scanner/scanner.ts:220,225` usa `getEnv()` del kernel para leer env vars en runtime en vez de usar `configSchema` — viola el espíritu de "módulos usan registry.getConfig()" aunque técnicamente es un import del kernel (permitido).

### Documentación vs realidad

La tabla de services en `docs/architecture/module-system.md` (sección 5.2) lista **solo 6 services**. El codebase actual tiene **40+ services**. La documentación está severamente desactualizada. También la tabla de hooks usa naming `oficina:` (renombrado a `console:` hace tiempo).

## Bugs encontrados

| # | Severidad | Módulo | Archivo:Línea | Descripción | Impacto |
|---|-----------|--------|---------------|-------------|---------|
| 1 | CRÍTICO | google-apps | oauth-manager.ts:270-276 | Tokens OAuth en texto plano en PostgreSQL | DB breach = acceso completo a Google |
| 2 | CRÍTICO | medilink | follow-up-scheduler.ts:406-411 | URLs de voice usan `localhost` | Voice follow-ups no funcionan en producción |
| 3 | ALTO | google-apps | drive-service.ts:32-38 | Query injection en Drive API query string | Manipulación de búsquedas Drive |
| 4 | ALTO | medilink | webhook-handler.ts:52,63 | Webhooks aceptados sin verificación cuando keys vacías | Cualquiera puede enviar webhooks falsos |
| 5 | ALTO | medilink | follow-up-scheduler.ts:423-431 | Confirmación keyword-based demasiado amplia | Falsos positivos cancelan follow-ups |
| 6 | MEDIO | google-apps | manifest.ts:275-276 + servicios | Timeout y retry configurados pero nunca implementados | API calls sin timeout, sin retry, sin 429 handling |
| 7 | MEDIO | medilink | tools.ts:672 | Reschedule cancela follow-ups sin crear nuevos | Citas reprogramadas sin recordatorios |
| 8 | MEDIO | medilink | webhook-handler.ts | Sin replay protection | Webhooks replayables indefinidamente |
| 9 | MEDIO | medilink | pg-store.ts:541,568 | DELETE+INSERT sin transacción | Race condition en config updates |

## Riesgos de seguridad

| # | Severidad | Módulo | Descripción | Vector de ataque | Mitigación |
|---|-----------|--------|-------------|-------------------|------------|
| 1 | CRÍTICO | google-apps | Tokens OAuth en texto plano en DB | SQL injection en cualquier parte del sistema → tokens Google expuestos → acceso total a cuenta | Encriptar con AES-256-GCM existente |
| 2 | ALTO | google-apps | OAuth2Client raw expuesto como service | Cualquier módulo puede usar `google:oauth-client` directamente sin control | Exponer solo servicios tipados, no el client raw |
| 3 | ALTO | google-apps | Scopes sobre-permisionados | Token comprometido = blast radius máximo (todos los archivos, calendarios, etc.) | Usar scopes granulares mínimos |
| 4 | ALTO | medilink | Webhooks sin verificación por defecto | POST a `/console/api/medilink/webhook` → invalidar caches, cancelar follow-ups, agotar rate limits | Rechazar webhooks si keys no configuradas |
| 5 | MEDIO | medilink | PII en logs stdout | Log aggregator comprometido expone teléfonos de pacientes | Maskear PII en logs (últimos 4 dígitos) |
| 6 | MEDIO | medilink | Sin replay protection en webhooks | Captura de tráfico → replay de webhooks | Timestamp validation + idempotency check |
| 7 | BAJO | google-apps | Drive query injection | Input malicioso via LLM → manipulación de queries Drive | Validar/escapar inputs |
| 8 | BAJO | medilink | Datos de paciente sin encriptar en Redis | Redis breach → datos médicos expuestos (mitigado por TTL de 5 min) | Aceptar riesgo o encriptar a nivel aplicación |

## Deuda técnica

| # | Prioridad | Módulo | Descripción | Esfuerzo |
|---|-----------|--------|-------------|----------|
| 1 | Alta | google-apps | Implementar timeout + retry + 429 handling (config ya existe, falta implementación) | 1-2 días |
| 2 | Alta | medilink | Fix bug reschedule sin re-follow-up | 2 horas |
| 3 | Alta | medilink | Fix URLs localhost en voice calls | 1 hora |
| 4 | Media | google-apps | Encriptar tokens OAuth en DB | 4 horas |
| 5 | Media | google-apps | Reducir scopes a mínimo necesario | 2 horas (requiere re-auth) |
| 6 | Media | medilink | Agregar replay protection a webhooks | 4 horas |
| 7 | Media | medilink | Reemplazar comando KEYS por SCAN en cache | 1 hora |
| 8 | Media | medilink | Wrappear DELETE+INSERT en transacciones | 1 hora |
| 9 | Media | engine | Actualizar docs/architecture/module-system.md (40+ services vs 6 documentados) | 2 horas |
| 10 | Baja | google-apps | Streaming para downloads grandes en Drive | 4 horas |
| 11 | Baja | medilink | Mejorar detección de confirmación (LLM intent) | 1 día |
| 12 | Baja | medilink | Agregar tool de cancelación de cita | 2 horas |

## Madurez general: 3.3/5

| Módulo | Madurez | Peso |
|--------|---------|------|
| Google Apps | 3.0/5 | Funcional pero con gaps de seguridad significativos |
| Medilink | 3.5/5 | Buen diseño de seguridad, bugs puntuales |
| Engine wrapper | 3.5/5 | Funcional pero sobrecargado |

La arquitectura modular está bien implementada — cero violaciones de imports directos en runtime, servicios y hooks correctamente expuestos. Los problemas principales son de **seguridad** (tokens planos, webhooks abiertos) y **resiliencia** (Google APIs sin timeout/retry). Medilink tiene el mejor diseño de seguridad del sistema con su modelo de 3 capas, pero tiene bugs operacionales importantes.

## Top 10 recomendaciones (ordenadas por impacto)

1. **[CRÍTICO] Encriptar tokens OAuth de Google Apps** — Usar mecanismo AES-256-GCM existente en config_store. Un breach de DB hoy expone tokens con acceso completo a Google. Esfuerzo: 4h.

2. **[CRÍTICO] Fix URLs localhost en Medilink voice calls** — Usar BASE_URL de kernel config. Los follow-ups por voz no funcionan en producción. Esfuerzo: 1h.

3. **[ALTO] Implementar timeout + retry + 429 en Google APIs** — La config ya existe pero nunca se usa. Un API call puede colgar indefinidamente. Crear wrapper compartido con AbortController + exponential backoff. Esfuerzo: 1-2 días.

4. **[ALTO] Configurar webhooks Medilink para rechazar sin keys** — Cambiar default de "skip verification" a "reject". Un endpoint sin protección acepta cualquier webhook forjado. Esfuerzo: 1h.

5. **[ALTO] Reducir scopes de Google OAuth a mínimo necesario** — `drive.file` en vez de `drive`, `calendar.events` en vez de `calendar`. Reduce blast radius de token comprometido. Esfuerzo: 2h (requiere re-auth).

6. **[ALTO] Mejorar detección de confirmación en Medilink** — Keywords como "si" y "ok" causan falsos positivos. Considerar match exacto, ventana temporal post-follow-up, o detección de intención con LLM. Esfuerzo: 4h-1 día.

7. **[MEDIO] Fix bug reschedule sin re-follow-up** — Citas reprogramadas quedan sin secuencia de recordatorios. Agregar `scheduleSequence()` post-reschedule. Esfuerzo: 2h.

8. **[MEDIO] Agregar replay protection a webhooks Medilink** — Timestamp validation + idempotency check contra `medilink_webhook_log`. Esfuerzo: 4h.

9. **[MEDIO] Sanitizar PII en logs de Medilink** — Reemplazar teléfonos completos en stdout por últimos 4 dígitos. Esfuerzo: 1h.

10. **[MEDIO] Actualizar documentación de module-system.md** — 40+ services reales vs 6 documentados, naming `oficina:` obsoleto. La documentación desactualizada causa confusión en desarrollo. Esfuerzo: 2h.

