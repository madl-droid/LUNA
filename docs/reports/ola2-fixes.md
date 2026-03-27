# OLA 2 — Reporte de Estabilidad del Engine
## Fecha: 2026-03-27
## Branch: claude/apply-audit-adjustments-H0ud1

### Fixes aplicados
| # | ID | Descripción | Estado | Notas |
|---|---|---|---|---|
| 1 | E-1 | Pipeline global timeout (120s default) | ✅ | `Promise.race` en `processMessage()`. Configurable via `ENGINE_PIPELINE_TIMEOUT_MS`. Fallback de error existente se encarga del contacto |
| 2 | E-10 | Mock tool registry como executor por defecto | ✅ | Phase 3 ahora usa `tools:registry` real si disponible. Mock solo en non-production con warning. En producción, falla explícitamente |
| 3 | E-14 | Respuesta vacía del LLM aceptada como válida | ✅ | `callWithRetries()` ahora rechaza `text.trim() === ''` y continua al siguiente retry/provider |
| 4 | E-29 | Non-null assertion en contacto eliminado | ✅ | `contactResult.rows[0]!` → guard con throw. Error capturado por catch existente en `processProactive()` |
| 5 | E-30 | Slug 'luna' hardcodeado en proactive jobs | ✅ | Nuevo campo `agentSlug` en EngineConfig (env: `AGENT_SLUG`, default: 'luna'). Aplicado a follow-up, reactivation, nightly-batch y proactive-pipeline |
| 6 | KN-3 | Timeout en búsqueda híbrida de Knowledge | ✅ | `Promise.allSettled` con timeouts individuales: vector=5s, FTS=3s, FAQ=2s. Degradación graceful a resultados vacíos |
| 7 | KN-2 | FAQ import sin transacción | ✅ | `deleteAllFAQs()` + `bulkInsertFAQs()` wrapeados en BEGIN/COMMIT/ROLLBACK. Aplica a `importFromFile()` y `syncFromSheets()` |
| 8 | GA-3 | Google APIs sin timeout ni retry | ✅ | Creado `api-wrapper.ts` con retry exponencial en 429/5xx. Aplicado a Calendar (listEvents, createEvent), Sheets (get, read, append), Drive (download) |
| 9 | ML-1 | URLs de voice call con localhost | ✅ | Nuevo campo `MEDILINK_PUBLIC_URL` en configSchema. Voice calls usan URL pública. Error explícito si no configurado |
| 10 | ML-4 | Reschedule sin re-follow-up | ✅ | Después de cancelar follow-ups viejos, `scheduleSequence()` se llama con datos de la nueva cita |

### Archivos creados
- `src/modules/google-apps/api-wrapper.ts` — wrapper compartido de timeout/retry para Google APIs

### Archivos modificados
- `src/engine/types.ts` — agregado `pipelineTimeoutMs` y `agentSlug` a EngineConfig
- `src/engine/config.ts` — carga `ENGINE_PIPELINE_TIMEOUT_MS` (120000) y `AGENT_SLUG` ('luna')
- `src/engine/engine.ts` — `Promise.race` con timeout en `processMessage()`
- `src/engine/phases/phase3-execute.ts` — resuelve `tools:registry` real, mock solo en non-prod
- `src/engine/phases/phase4-compose.ts` — rechaza respuestas LLM vacías en `callWithRetries()`
- `src/engine/proactive/proactive-pipeline.ts` — guard en contactRow null, `agentSlug` en vez de hardcoded
- `src/engine/proactive/jobs/follow-up.ts` — `agentSlug` parametrizado en 3 queries SQL
- `src/engine/proactive/jobs/reactivation.ts` — `agentSlug` parametrizado en 2 queries SQL
- `src/engine/proactive/jobs/nightly-batch.ts` — `getAgentId()` lee de engineConfig
- `src/modules/knowledge/search-engine.ts` — `Promise.allSettled` con timeouts individuales
- `src/modules/knowledge/faq-manager.ts` — transacción en `importFromFile()` y `syncFromSheets()`
- `src/modules/knowledge/pg-store.ts` — `getPool()` accessor, optional client param en delete/bulkInsert FAQs
- `src/modules/google-apps/calendar-service.ts` — constructor acepta config, wrapper en listEvents/createEvent
- `src/modules/google-apps/sheets-service.ts` — constructor acepta config, wrapper en get/read/append
- `src/modules/google-apps/drive-service.ts` — wrapper en downloadFile
- `src/modules/google-apps/manifest.ts` — pasa config a SheetsService y CalendarService constructors
- `src/modules/medilink/types.ts` — agregado `MEDILINK_PUBLIC_URL` a MedilinkConfig
- `src/modules/medilink/manifest.ts` — agregado `MEDILINK_PUBLIC_URL` a configSchema
- `src/modules/medilink/follow-up-scheduler.ts` — usa `MEDILINK_PUBLIC_URL` en vez de localhost
- `src/modules/medilink/tools.ts` — reschedule llama `scheduleSequence()` para nuevos follow-ups

### Decisiones técnicas tomadas
- **Pipeline timeout**: implementado en la capa de concurrencia (layer 2: contact lock) usando `Promise.race`. El catch existente en `processMessageInner` maneja el error y envía fallback al usuario.
- **Mock tool registry**: mantenido como fallback para desarrollo, bloqueado en producción para evitar datos falsos silenciosos.
- **Agent slug**: centralizado en `EngineConfig.agentSlug` con env var `AGENT_SLUG` y fallback 'luna' para backward compatibility.
- **Search timeouts**: individual por tipo de búsqueda (vector más tiempo porque puede ir a pgvector) con `Promise.allSettled` para no perder resultados parciales.
- **Google API wrapper**: acepta `AbortSignal` para timeout limpio. Solo retries en errores transitorios (429, 5xx). Applied a métodos críticos en Calendar, Sheets y Drive.
- **Medilink voice URL**: requiere configuración explícita (`MEDILINK_PUBLIC_URL`). Falla loud si no está configurado en vez de intentar con localhost.

### Efectos secundarios observados
- Pre-existing TS errors que existían antes ya no aparecen (build limpio).
- `api-wrapper.ts` recibe `AbortSignal` pero googleapis no lo usa internamente — el timeout funciona a nivel de Promise.race, no cancelación real de la request HTTP.

### Build: ✅ (0 errores)
### Tests: ✅ 49/49 passed
