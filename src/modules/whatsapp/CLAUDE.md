# WhatsApp — Canal de mensajería via Baileys

Canal WhatsApp usando Baileys 7.x. Recibe y envía mensajes (texto, imagen, audio/PTT), expone estado a console.

## Archivos
- `manifest.ts` — lifecycle, hooks, API routes, configSchema
- `adapter.ts` — BaileysAdapter: conexión, QR, reconexión, normalización, grupos, audio, quoting
- `pg-auth-state.ts` — Auth state en PostgreSQL (reemplaza useMultiFileAuthState del filesystem)
- `presence-manager.ts` — PresenceManager: composing/paused/available presence para typing natural

## Manifest
- type: `channel`, removable: true, activateByDefault: true
- depends: [] (sin dependencias)
- configSchema: WHATSAPP_RECONNECT_INTERVAL_MS, WHATSAPP_MAX_RECONNECT_ATTEMPTS, WHATSAPP_MARK_ONLINE, WHATSAPP_REJECT_CALLS, WHATSAPP_REJECT_CALL_MESSAGE, WHATSAPP_PRIVACY_*, WHATSAPP_AGENT_NAME

## Hooks
- **Escucha** `message:send` → envía mensaje por WhatsApp (texto, imagen, audio/PTT, con quoting)
- **Escucha** `channel:composing` → muestra "escribiendo..." en WhatsApp
- **Escucha** `channel:send_complete` → limpia "escribiendo..."
- **Dispara** `message:incoming` → cuando llega un mensaje del usuario

## Grupos
- `normalizeMessage()` detecta grupos via `@g.us` suffix en remoteJid
- Solo procesa mensajes de grupo si el bot es mencionado (@mention, @nombre, o "Nombre," prefix)
- `stripMentionTag()` limpia la mención del texto antes de procesarlo
- Replies en grupos van al JID del grupo, no al sender individual
- Primer burbuja de respuesta en grupo cita el mensaje original (quotedRaw)

## Call Rejection
- Si WHATSAPP_REJECT_CALLS=true, escucha evento 'call' de Baileys
- Auto-rechaza llamadas entrantes con status 'offer' via `rejectCall()`
- Envía WHATSAPP_REJECT_CALL_MESSAGE como texto al caller

## Privacy
- Al conectar, aplica settings de privacidad si configurados (lastSeen, profilePicture, readreceipts)
- Valores vacíos = no cambiar. Solo aplica settings explícitamente configurados.

## Presence (PresenceManager)
- `sendComposing(to)`: suscribe + envía 'composing'. Auto-clear a 25s.
- `sendPaused(to)`: envía 'paused', limpia timer.
- Socket se setea en connection open, se limpia en shutdown/disconnect.

## Trampas
- NO implementar Meta Cloud API adapter — solo placeholder si se necesita
- Estructura de mensajes Baileys varía por tipo — siempre probar normalizeMessage con mensajes reales
- NO usar filesystem para auth — todo va en PostgreSQL
- `updatePrivacySettings` puede no existir en todas las versiones de Baileys — falla silenciosamente
- Audio send requiere `mimetype: 'audio/ogg; codecs=opus'` y `ptt: true` para voice notes
- **Helpers HTTP y config**: usa `jsonResponse` de `kernel/http-helpers.js` y `numEnv`, `boolEnv` de `kernel/config-helpers.js`. NO redefinir localmente.
