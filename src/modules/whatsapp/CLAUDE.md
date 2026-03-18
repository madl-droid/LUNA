# WhatsApp — Canal de mensajería via Baileys

Canal WhatsApp usando Baileys 7.x. Recibe y envía mensajes, expone estado a oficina.

## Archivos
- `manifest.ts` — lifecycle, hooks, API routes, configSchema
- `adapter.ts` — BaileysAdapter: conexión, QR, reconexión, normalización de mensajes
- `pg-auth-state.ts` — Auth state en PostgreSQL (reemplaza useMultiFileAuthState del filesystem)

## Manifest
- type: `channel`, removable: true, activateByDefault: true
- depends: [] (sin dependencias)
- configSchema: WHATSAPP_RECONNECT_INTERVAL_MS, WHATSAPP_MAX_RECONNECT_ATTEMPTS

## Auth State en PostgreSQL
- Credenciales se almacenan en tablas `wa_auth_creds` y `wa_auth_keys` en PostgreSQL
- Cada contenedor usa `os.hostname()` como `instance_id` → credenciales son específicas del contenedor
- Al hacer deploy a otro contenedor, NO se arrastran credenciales → arranca limpio con QR
- `disconnect()` limpia auth de la DB, `shutdown()` preserva auth en DB
- Serialización usa `BufferJSON.replacer/reviver` de Baileys para manejar Buffer/Uint8Array en JSONB
- `app-state-sync-key` requiere `proto.Message.AppStateSyncKeyData.fromObject()` al leer

## Estado de conexión persistido
- `WHATSAPP_CONNECTION_STATUS` y `WHATSAPP_CONNECTED_NUMBER` se guardan en `config_store` via callbacks
- `BaileysState` incluye `connectedNumber` (extraído de `socket.user.id`)
- El endpoint `GET /status` retorna `connectedNumber` junto con el estado

## Hooks
- **Escucha** `message:send` → envía mensaje por WhatsApp cuando el pipeline lo solicita
- **Dispara** `message:incoming` → cuando llega un mensaje del usuario

## Servicio registrado
- `whatsapp:adapter` — instancia de BaileysAdapter, consumida por oficina para estado/QR

## API routes (montadas en /oficina/api/whatsapp/)
- `GET /status` — estado de conexión + QR + connectedNumber
- `POST /connect` — inicializar WhatsApp (genera QR)
- `POST /disconnect` — logout + limpiar credenciales de DB

## Patrones
- `BaileysState`: status, qr, lastDisconnectReason, connectedNumber
- `disconnect()` hace logout Y limpia auth de DB → próximo connect genera QR nuevo
- `shutdown()` cierra socket SIN limpiar auth → reconecta sin QR al reiniciar
- Reconnect: si `_autoReconnect` y razón ≠ loggedOut, reintenta hasta maxReconnectAttempts
- `normalizeMessage()`: extrae texto de conversation, extendedTextMessage, imageMessage.caption
- JID format: números sin '@' reciben '@s.whatsapp.net'
- Solo procesa: upsert.type === 'notify' && !msg.key.fromMe
- Logger Baileys en 'silent' para evitar ruido

## Trampas
- NO implementar Meta Cloud API adapter — solo placeholder si se necesita
- Estructura de mensajes Baileys varía por tipo — siempre probar normalizeMessage con mensajes reales
- NO usar filesystem para auth — todo va en PostgreSQL
- La carpeta `instance/wa-auth/` ya NO se usa — puede eliminarse de staging/production
