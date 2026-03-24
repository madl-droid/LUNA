# WhatsApp — Canal de mensajería via Baileys

Canal WhatsApp usando Baileys 7.x. Recibe y envía mensajes (texto, imagen, audio/PTT), expone estado a console.

## Archivos
- `manifest.ts` — lifecycle, hooks, API routes, configSchema, channel-config service, hot-reload
- `adapter.ts` — BaileysAdapter: conexión, QR, reconexión, normalización, grupos, audio, quoting
- `pg-auth-state.ts` — Auth state en PostgreSQL (reemplaza useMultiFileAuthState del filesystem)
- `presence-manager.ts` — PresenceManager: composing/paused/available presence para typing natural

## Manifest
- type: `channel`, removable: true, activateByDefault: true
- depends: [] (sin dependencias)
- configSchema: WHATSAPP_RECONNECT_INTERVAL_MS, WHATSAPP_MAX_RECONNECT_ATTEMPTS, WHATSAPP_AVISO_TRIGGER_MS, WHATSAPP_AVISO_HOLD_MS, WHATSAPP_AVISO_MESSAGE, WHATSAPP_RATE_LIMIT_HOUR, WHATSAPP_RATE_LIMIT_DAY, WHATSAPP_MARK_ONLINE, WHATSAPP_REJECT_CALLS, WHATSAPP_REJECT_CALL_MESSAGE, WHATSAPP_PRIVACY_*, WHATSAPP_AGENT_NAME, WHATSAPP_BATCH_WAIT_SECONDS, WHATSAPP_SESSION_TIMEOUT_HOURS, WHATSAPP_PRECLOSE_FOLLOWUP_HOURS, WHATSAPP_PRECLOSE_MESSAGE

## Channel Config Service (patrón reutilizable)
- Provee servicio `channel-config:whatsapp` → `{ get(): ChannelRuntimeConfig }`
- El engine lee aviso, rate limits, session timeout y pre-close config via este servicio
- Definido en `buildChannelConfig()` al final del archivo
- Ver `docs/architecture/channel-guide.md` para replicar en otros canales
- Ver `src/channels/types.ts` para la interfaz `ChannelRuntimeConfig`

## Hot-reload
- Escucha hook `console:config_applied` → re-lee config, actualiza batcher y objeto config
- `buildChannelConfig()` lee siempre del config actual → engine obtiene valores frescos sin restart
- Params que requieren restart de adapter: PRIVACY_*, MARK_ONLINE, RECONNECT_*

## Hooks
- **Escucha** `message:send` → envía mensaje por WhatsApp (texto, imagen, audio/PTT, con quoting)
- **Escucha** `channel:composing` → muestra "escribiendo..." en WhatsApp
- **Escucha** `channel:send_complete` → limpia "escribiendo..."
- **Escucha** `message:sent` → reschedule pre-close follow-up timer
- **Escucha** `console:config_applied` → hot-reload de config + batcher
- **Dispara** `message:incoming` → cuando llega un mensaje del usuario

## Servicios
- `whatsapp:adapter` — BaileysAdapter instance
- `channel-config:whatsapp` — ChannelRuntimeConfig (leído por engine)

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
