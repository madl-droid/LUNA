# Medilink — Integracion con HealthAtom API

Provider de gestion clinica: pacientes, citas, disponibilidad, seguimiento automatico, webhooks. Modulo critico — maneja datos de pacientes con 3 capas de seguridad.

## Archivos
- `manifest.ts` — lifecycle, configSchema (25+ params), console fields, 13 API routes, init/stop
- `types.ts` — interfaces API (Patient, Appointment [incluye id_atencion], Professional, Evolution, Archive, TreatmentPlan), config, internas
- `api-client.ts` — HTTP client con rate limiting, retry, paginacion por cursor. Base: `/api/v1`
- `rate-limiter.ts` — token bucket con cola de 3 prioridades (high/medium/low), Redis sliding window
- `cache.ts` — Redis + in-memory para datos de referencia (30d TTL) y disponibilidad (20min TTL, warm via webhooks)
- `webhook-handler.ts` — receptor webhooks Medilink: HMAC verify, dispatch a listeners
- `security.ts` — **CRITICO**: verificacion identidad, control acceso, filtrado datos, audit
- `tools.ts` — 11 herramientas del agente (search, info, disponibilidad, profesionales, prestaciones, citas, pagos, tratamientos, crear paciente, agendar, reagendar)
- `working-memory.ts` — memoria de trabajo Redis por contacto (TTL 6h). Clase generica `WorkingMemory` reutilizable por otros modulos
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
- `POST /citas` usa v5 (`/api/v5/citas`), todo lo demás usa v1
- La respuesta de `POST /citas` retorna `id` (primer campo) e `id_atencion` — ambos se guardan
- v1 usa `id_dentista`/`nombre_dentista` en citas, agendas, evoluciones
- v5 usa `id_profesional`/`nombre_profesional` — **LUNA usa v1 excepto POST citas**
- `MedilinkPatient.nombre` (singular) — NO `nombres`
- `/sillones` no tiene `id_sucursal` — no se puede filtrar por sucursal
- `/tratamientos` no tiene `duracion` — usar `MEDILINK_DEFAULT_DURATION_MIN`
- Archivos: todo esta en `/archivos` (fotos, PDFs, consentimientos). Campo `urls.original` para descargar
- `/adicionales` solo funciona en v1, no en v5

## Seguridad (3 capas)
1. **Verificacion**: UNVERIFIED -> PHONE_MATCHED -> DOCUMENT_VERIFIED
2. **Aislamiento**: cada tool solo accede datos del paciente vinculado al contacto
3. **Audit trail**: cada acceso se logea ANTES de retornar datos

**NUNCA exponer**: `evo.datos` (notas clinicas), archivos clinicos, info de un paciente a otro.

## Tools del agente (11)
- `medilink-search-patient` — busca auto por telefono; guarda patient_id en working memory
- `medilink-get-patient-info` — datos basicos del paciente vinculado (nombre, tel, email)
- `medilink-check-availability` — slots libres con logica de filtrado por contexto (ver abajo)
- `medilink-get-professionals` — profesionales activos
- `medilink-get-prestaciones` — catalogo de prestaciones habilitadas
- `medilink-get-my-appointments` — citas del paciente; guarda snapshots en working memory
- `medilink-get-my-payments` — pagos/deudas
- `medilink-get-treatment-plans` — planes de tratamiento activos
- `medilink-create-patient` — registrar paciente nuevo; guarda patient_id en working memory
- `medilink-create-appointment` — agendar (professional y prestacion opcionales para leads — usa defaults del config). Param `context_summary`: resumen de contexto del paciente extraído de la conversación (NO preguntado). Retorna: id, id_atencion, fecha, hora, profesional, tratamiento, sucursal, comentarios. Post-acciones: guarda appointment_id en working memory (`pending_reschedule_id` + `last_appointment_id`), persiste branch preference en `contacts.custom_data`
- `medilink-reschedule-appointment` — reagendar; lee appointment_id de working memory si no se pasa. Param `reschedule_reason`: motivo del reagendamiento (se agrega a comentarios como audit trail). Retorna: id, id_atencion, fecha, hora, profesional, tratamiento, sucursal, comentarios. Post-acciones: actualiza `pending_reschedule_id`, persiste branch preference

Tools ELIMINADAS: verify-identity, request-patient-edit, execute-followup, get-my-evolutions, get-my-files

## Skills de medilink (5) — instance/prompts/system/skills/
Fuente única de verdad para el comportamiento del subagente medilink-scheduler:
- `medilink-lead-scheduling` — leads nuevos, primera cita. NUNCA mencionar nombre del profesional
- `medilink-patient-scheduling` — pacientes conocidos, nueva cita. Puede elegir profesional
- `medilink-rescheduling` — reagendamiento, pide motivo, prefiere mismo profesional
- `medilink-cancellation` — cancelación, ofrece reagendar antes de cancelar
- `medilink-info` — consultas de citas, pagos, tratamientos, profesionales

El subagente lee el skill apropiado via `skill_read` antes de actuar. El skill viejo `medilink-scheduling.md` fue eliminado y reemplazado por estos 5.

## Logica de check-availability (prioridad de filtrado)
1. `appointment_id` presente (o en working memory) → filtra por categorias del profesional original
2. `treatment_name` presente → filtra por categoria del tratamiento
3. `professional_name` presente → filtra por ese profesional
4. Ninguno → usa `MEDILINK_DEFAULT_PROFESSIONAL_ID` (flujo lead)

## Working Memory (working-memory.ts)
Clase generica `WorkingMemory(redis, namespace, ttlS=6h)` — reutilizable por cualquier modulo.
Clave Redis: `wmem:{namespace}:{contactId}:{field}`. TTL: 6 horas.

Campos que medilink escribe automaticamente:
- `patient_id` — al buscar/crear/vincular paciente
- `appointments` — al llamar get-my-appointments (snapshots con IDs internos, incluye branchId/branchName)
- `pending_reschedule_id` — al llamar check-availability con appointment_id, Y al crear/reagendar cita
- `last_appointment_id` — al crear cita (create-appointment)

**Para usar en otro modulo:**
```typescript
const wmem = new WorkingMemory(redis, 'mi-modulo')
await wmem.set(contactId, 'mi-campo', valor)
await wmem.get<Tipo>(contactId, 'mi-campo')
await wmem.del(contactId, 'mi-campo')
```
Cuando se use en 2+ modulos, mover `working-memory.ts` a `src/kernel/`.

## Persistencia en contacts.custom_data
- `medilink_preferred_branch_id` / `medilink_preferred_branch_name` — se guardan al crear/reagendar cita. Permite recordar la sucursal preferida del paciente entre sesiones.

## Config extra
- `MEDILINK_ALLOWED_CHAIRS` — CSV de IDs de sillon permitidos (default "1,2"). Excluye sobreagendamiento de disponibilidad.
- `MEDILINK_DEFAULT_PROFESSIONAL_ID` — profesional asignado automaticamente a leads (configurable en consola).
- `MEDILINK_DEFAULT_VALORACION_ID` — prestacion por defecto para leads (configurable en consola).

## Follow-up (9 toques)
Touch 0 (inmediato) -> Touch 1 (llamada 7d antes) -> Fallback A (WhatsApp) -> Fallback B (2da llamada) -> Touch 3 (instrucciones 24h) -> Touch 4 (recordatorio 3h) -> No-show 1 -> No-show 2 -> Reactivacion

## Tablas SQL
medilink_audit_log, medilink_edit_requests, medilink_follow_ups, medilink_professional_treatments, medilink_user_type_rules, medilink_followup_templates, medilink_webhook_log
