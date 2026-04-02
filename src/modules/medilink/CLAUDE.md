# Medilink — Integracion con HealthAtom API

Provider de gestion clinica: pacientes, citas, disponibilidad, seguimiento automatico, webhooks. Modulo critico — maneja datos de pacientes con 3 capas de seguridad.

## Archivos
- `manifest.ts` — lifecycle, configSchema (25+ params), console fields, 13 API routes, init/stop
- `types.ts` — interfaces API (Patient, Appointment, Professional, Evolution, Archive, TreatmentPlan), config, internas
- `api-client.ts` — HTTP client con rate limiting, retry, paginacion por cursor. Base: `/api/v1`
- `rate-limiter.ts` — token bucket con cola de 3 prioridades (high/medium/low), Redis sliding window
- `cache.ts` — Redis + in-memory para datos de referencia (30d TTL) y disponibilidad (20min TTL, warm via webhooks)
- `webhook-handler.ts` — receptor webhooks Medilink: HMAC verify, dispatch a listeners
- `security.ts` — **CRITICO**: verificacion identidad, control acceso, filtrado datos, audit
- `tools.ts` — 12 herramientas del agente (disponibilidad, pacientes, citas, pagos, evoluciones, archivos, execute-followup)
- `follow-up-scheduler.ts` — secuencia 9 toques, delega a scheduled-tasks (NO crea su propio BullMQ)
- `pg-store.ts` — migraciones (7 tablas) y queries SQL

## Endpoints de la API (HealthAtom/Dentalink)
Base: `MEDILINK_BASE_URL` + `/api/v1` (se agrega automaticamente si falta)

| Endpoint | Metodo | Notas |
|---|---|---|
| `/dentistas` | GET | v1 usa `/dentistas` (NO `/profesionales`), campos: `id_dentista`/`nombre_dentista` |
| `/sucursales` | GET | |
| `/tratamientos` | GET | Paginado. NO devuelve `duracion` ni `precio` |
| `/sillones` | GET | Solo `{id, nombre}` — NO tiene `id_sucursal` |
| `/citas/estados` | GET | 19 estados con campo `anulacion` (NO `/estados-de-cita`) |
| `/pacientes` | GET/POST | Filtro por `rut` (eq). Campo `nombre` (singular, NO `nombres`) |
| `/pacientes/{id}` | GET/PUT | |
| `/pacientes/{id}/citas` | GET | |
| `/pacientes/{id}/pagos` | GET | |
| `/pacientes/{id}/evoluciones` | GET | `datos` = notas clinicas, NUNCA exponer |
| `/pacientes/{id}/archivos` | GET | URLs S3 pre-firmadas (1h), no hay descarga directa |
| `/pacientes/{id}/atenciones` | GET | Planes de tratamiento con resumen financiero (total, deuda) |
| `/pacientes/{id}/adicionales` | GET | Campos adicionales — **solo funciona en v1** |
| `/agendas` | GET | Filtro: `id_sucursal`, `fecha`, `id_dentista`. Retorna array. Free = `id_paciente === null` |
| `/citas` | GET/POST | |
| `/citas/{id}` | GET/PUT | |

**NO existen**: `/consentimientos`, `/imagenes`, `/fichas`, `/documentosClinicos`, `/profesionales` (v1)
**Filtros soportados**: solo `eq`. NO soporta `like` ni `contains`.

## Trampas criticas
- v1 usa `id_dentista`/`nombre_dentista` en citas, agendas, evoluciones
- v5 usa `id_profesional`/`nombre_profesional` — **LUNA usa v1**
- `MedilinkPatient.nombre` (singular) — NO `nombres`
- `/sillones` no tiene `id_sucursal` — no se puede filtrar por sucursal
- `/tratamientos` no tiene `duracion` — usar `MEDILINK_DEFAULT_DURATION_MIN`
- Archivos: todo esta en `/archivos` (fotos, PDFs, consentimientos). Campo `urls.original` para descargar
- `/adicionales` solo funciona en v1, no en v5

## Seguridad (3 capas)
1. **Verificacion**: UNVERIFIED -> PHONE_MATCHED -> DOCUMENT_VERIFIED
2. **Aislamiento**: cada tool solo accede datos del paciente vinculado al contacto
3. **Audit trail**: cada acceso se logea ANTES de retornar datos

**NUNCA exponer**: `evo.datos` (notas clinicas). SI exponer: lista de evoluciones (nombre, fecha, estado).

## Follow-up (9 toques)
Touch 0 (inmediato) -> Touch 1 (llamada 7d antes) -> Fallback A (WhatsApp) -> Fallback B (2da llamada) -> Touch 3 (instrucciones 24h) -> Touch 4 (recordatorio 3h) -> No-show 1 -> No-show 2 -> Reactivacion

## Tablas SQL
medilink_audit_log, medilink_edit_requests, medilink_follow_ups, medilink_professional_treatments, medilink_user_type_rules, medilink_followup_templates, medilink_webhook_log
