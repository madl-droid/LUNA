# WhatsApp — Canal de mensajería via Baileys

Canal WhatsApp usando Baileys 7.x. Recibe y envía mensajes, expone estado a oficina.

## Archivos
- `manifest.ts` — lifecycle, hooks, API routes, configSchema
- `adapter.ts` — BaileysAdapter: conexión, QR, reconexión, normalización de mensajes

## Manifest
- type: `channel`, removable: true, activateByDefault: true
- depends: [] (sin dependencias)
- configSchema: WHATSAPP_AUTH_DIR, WHATSAPP_RECONNECT_INTERVAL_MS, WHATSAPP_MAX_RECONNECT_ATTEMPTS

## Hooks
- **Escucha** `message:send` → envía mensaje por WhatsApp cuando el pipeline lo solicita
- **Dispara** `message:incoming` → cuando llega un mensaje del usuario

## Servicio registrado
- `whatsapp:adapter` — instancia de BaileysAdapter, consumida por oficina para estado/QR

## API routes (montadas en /oficina/api/whatsapp/)
- `GET /status` — estado de conexión + QR como data URL PNG
- `POST /connect` — inicializar WhatsApp (genera QR)
- `POST /disconnect` — logout + limpiar credenciales

## Patrones
- `BaileysState`: status (`disconnected`|`connecting`|`connected`|`qr_ready`), qr, lastDisconnectReason
- `disconnect()` hace logout Y limpia auth dir → próximo connect genera QR nuevo
- `shutdown()` cierra socket SIN limpiar auth → reconecta sin QR
- Reconnect: si `_autoReconnect` y razón ≠ loggedOut, reintenta hasta maxReconnectAttempts
- `normalizeMessage()`: extrae texto de conversation, extendedTextMessage, imageMessage.caption
- JID format: números sin '@' reciben '@s.whatsapp.net'
- Solo procesa: upsert.type === 'notify' && !msg.key.fromMe
- Logger Baileys en 'silent' para evitar ruido

## Trampas
- NO implementar Meta Cloud API adapter — solo placeholder si se necesita
- Estructura de mensajes Baileys varía por tipo — siempre probar normalizeMessage con mensajes reales
- `disconnect()` borra el directorio wa-auth completo (rmSync recursive)
