# Webhook Leads — Registro externo de leads

Webhook HTTP para que sistemas externos (CRM, ads, formularios) registren leads en la base de contactos. Marca `contact_origin = 'outbound'`, valida campañas via lead-scoring, y dispara primer contacto por el canal preferido.

## Archivos
- `manifest.ts` — lifecycle, configSchema, console fields + apiRoutes
- `webhook-handler.ts` — lógica: auth, upsert contacto, atribución campaña, outbound, log
- `types.ts` — WebhookLeadsConfig, WebhookRegisterBody, WebhookRegisterResult, WebhookLogEntry

## Manifest
- type: `feature`, removable: true, activateByDefault: true
- depends: `[]` (lead-scoring es opcional — se usa vía `registry.getOptional`)
- configSchema: WEBHOOK_LEADS_ENABLED, WEBHOOK_LEADS_TOKEN, WEBHOOK_LEADS_PREFERRED_CHANNEL

## API routes (montadas en /console/api/webhook-leads/)
- `POST /register` — registrar lead (auth: Bearer token, body: {email?, phone?, name?, campaign})
- `GET /stats` — estadísticas del webhook (éxitos, errores, sin campaña)
- `GET /log?limit=50&offset=0` — log de intentos paginado
- `POST /regenerate-token` — regenerar token de autorización

## Console fields
- `WEBHOOK_LEADS_ENABLED` (boolean) — toggle on/off del webhook
- `WEBHOOK_LEADS_TOKEN` (secret) — token Bearer auto-generado
- `WEBHOOK_LEADS_PREFERRED_CHANNEL` (select) — auto/whatsapp/email/google-chat

## Flujo del webhook
1. Valida Bearer token contra config_store
2. Valida body: campaign obligatorio, al menos email o phone
3. Busca campaña por keyword (exact, case-insensitive), visible_id o UUID
4. Si campaña no encontrada → registra lead sin campaña + warning en response
5. Crea o encuentra contacto existente (unificación cross-channel por email/phone)
6. Seta `contact_origin = 'outbound'` en tabla contacts
7. Vincula contact_channels: email, whatsapp, voice según datos disponibles
8. Atribuye campaña via servicio `lead-scoring:campaign-queries` (si activo)
9. Dispara `message:send` en canal preferido con saludo inicial
10. Log en tabla `webhook_lead_log`

## Integración con otros módulos
- **lead-scoring**: usa servicio `lead-scoring:campaign-queries` para `recordMatch()` (opcional)
- **canales**: usa hook `message:send` para disparar primer contacto
- **contacts**: escribe en tabla `contacts` (contact_origin) y `contact_channels`
- **users**: compatible con `ContactSource` type ('outbound')

## Tabla DB
- `webhook_lead_log` — log de registros (email, phone, campaign_keyword, contact_id, success, error)

## Trampas
- Token se auto-genera al init si no existe en config_store. Se almacena encriptado (AES-256-GCM).
- Campaña se busca por keyword exacto primero, luego visible_id, luego UUID. No usa fuzzy match.
- Cross-channel: si el contacto ya existe por email y llega por phone, se vinculan ambos canales.
- El canal preferido debe estar activo. Si no → auto fallback al primer canal activo.
- Si lead-scoring no está activo, la campaña no se atribuye pero el lead se registra igual.
- Helpers HTTP: usa `jsonResponse`, `parseBody`, `parseQuery` de `kernel/http-helpers.js`.
