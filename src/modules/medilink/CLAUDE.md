# Medilink — Integracion con HealthAtom API

Provider de gestion clinica: pacientes, citas, disponibilidad, seguimiento automatico, webhooks. Modulo critico — maneja datos de pacientes con 3 capas de seguridad.

## Archivos
- `manifest.ts` — lifecycle, configSchema (25+ params), console fields, 13 API routes, init/stop
- `types.ts` — interfaces API (Patient, Appointment, Professional, Evolution), config, internas
- `api-client.ts` — HTTP client con rate limiting, retry, paginacion por cursor
- `rate-limiter.ts` — token bucket con cola de 3 prioridades (high/medium/low), Redis sliding window
- `cache.ts` — Redis + in-memory para datos de referencia (30d TTL) y disponibilidad (10min TTL)
- `webhook-handler.ts` — receptor webhooks Medilink: HMAC verify, dispatch a listeners
- `security.ts` — **CRITICO**: verificacion identidad, control acceso, filtrado datos, audit
- `tools.ts` — 10 herramientas del agente (disponibilidad, pacientes, citas, pagos, evoluciones)
- `follow-up-scheduler.ts` — BullMQ: secuencia 9 toques (confirmacion, llamadas, no-show, reactivacion)
- `pg-store.ts` — migraciones (7 tablas) y queries SQL

## Manifest
- **type**: `provider`
- **depends**: `['tools', 'memory']`
- **configSchema**: MEDILINK_API_TOKEN, MEDILINK_BASE_URL, webhook keys, rate limit, cache TTLs, follow-up timing, security toggles

## Servicios expuestos
- `medilink:api` — MedilinkApiClient
- `medilink:cache` — MedilinkCache (reference data, availability)
- `medilink:security` — SecurityService
- `medilink:followup` — FollowUpScheduler (si habilitado)

## Seguridad (3 capas)
1. **Verificacion**: UNVERIFIED -> PHONE_MATCHED -> DOCUMENT_VERIFIED
2. **Aislamiento**: cada tool solo accede datos del paciente vinculado al contacto
3. **Audit trail**: cada acceso se logea ANTES de retornar datos

**NUNCA exponer**: `evo.datos` (notas clinicas). SI exponer: lista de evoluciones (nombre, fecha, estado).

## Webhooks
Endpoint: `POST /console/api/medilink/webhook`. HMAC-SHA256 + public key. Responde 200 inmediato.
Entidades: cita, paciente, profesional, horario, horario_bloqueado, horario_especial.

## Follow-up (9 toques)
Touch 0 (inmediato) -> Touch 1 (llamada 7d antes) -> Fallback A (WhatsApp si fallo) -> Fallback B (2da llamada) -> Touch 3 (instrucciones 24h) -> Touch 4 (recordatorio 3h) -> No-show 1 -> No-show 2 -> Reactivacion

## Tablas SQL
medilink_audit_log, medilink_edit_requests, medilink_follow_ups, medilink_professional_treatments, medilink_user_type_rules, medilink_followup_templates, medilink_webhook_log

## Trampas
- API usa `profesional` (no `dentista`), `atencion` (no `tratamiento` en algunos contextos)
- Rate limit 20 req/min — cache agresivo + webhooks eliminan necesidad de polling
- Vinculacion paciente-contacto en `agent_contacts.agent_data` JSONB (no tabla nueva)
- `canAccess()` en security.ts es el guardian — verificar SIEMPRE antes de retornar datos
- Follow-up calls requieren modulo `twilio-voice` activo, sino fallback a WhatsApp
- Webhook puede perderse (1 retry) — boton manual de refresh en consola
