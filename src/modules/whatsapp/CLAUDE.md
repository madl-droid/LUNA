# WhatsApp — Canal de mensajería via Baileys

Canal WhatsApp usando Baileys 7.x. Recibe y envía mensajes (texto, imagen, audio/PTT), expone estado a console.

## Archivos
- `manifest.ts` — lifecycle, hooks, API routes, configSchema, channel-config service, hot-reload
- `adapter.ts` — BaileysAdapter: conexión, QR, reconexión, normalización, grupos, audio, quoting
- `pg-auth-state.ts` — Auth state en PostgreSQL (reemplaza useMultiFileAuthState del filesystem)
- `presence-manager.ts` — PresenceManager: composing/paused/available presence para typing natural

## Manifest
- type: `channel`, channelType: `instant`, removable: true, activateByDefault: true
- console.title: "WhatsApp"
- depends: [] (sin dependencias)
- configSchema:
  - **ACK**: WHATSAPP_AVISO_TRIGGER_MS (3000), WHATSAPP_AVISO_HOLD_MS (2000), WHATSAPP_AVISO_MESSAGE
  - **Socket**: WHATSAPP_MARK_ONLINE (true), WHATSAPP_REJECT_CALLS (true)
  - **Privacy**: WHATSAPP_PRIVACY_LAST_SEEN (false), WHATSAPP_PRIVACY_PROFILE_PIC ('all'), WHATSAPP_PRIVACY_STATUS ('all'), WHATSAPP_PRIVACY_READ_RECEIPTS (true)
  - **Batching**: WHATSAPP_BATCH_ENABLED (true), WHATSAPP_BATCH_WAIT_SECONDS (30), WHATSAPP_FLOOD_THRESHOLD (20)
  - **Sessions**: WHATSAPP_SESSION_TIMEOUT_HOURS (24), WHATSAPP_PRECLOSE_ENABLED (true), WHATSAPP_PRECLOSE_FOLLOWUP_HOURS (1), WHATSAPP_PRECLOSE_MESSAGE
  - **Missed msgs**: WHATSAPP_MISSED_MSG_ENABLED (true), WHATSAPP_MISSED_MSG_WINDOW_MIN (15)
  - **Attachments**: WHATSAPP_ATT_IMAGES (true), WHATSAPP_ATT_DOCUMENTS (true), WHATSAPP_ATT_AUDIO (true), WHATSAPP_ATT_VIDEO (false), WHATSAPP_ATT_SPREADSHEETS (true), WHATSAPP_ATT_TEXT (true)
  - **Formato**: WHATSAPP_FORMAT_ADVANCED (false), FORMAT_INSTRUCTIONS_WHATSAPP, WHATSAPP_FORMAT_TONE ('ninguno'), WHATSAPP_FORMAT_MAX_SENTENCES (2), WHATSAPP_FORMAT_MAX_PARAGRAPHS (2), WHATSAPP_FORMAT_EMOJI_LEVEL ('bajo'), WHATSAPP_FORMAT_TYPOS_* (disabled), WHATSAPP_FORMAT_OPENING_SIGNS ('nunca'), WHATSAPP_FORMAT_AUDIO_ENABLED (false), WHATSAPP_FORMAT_VOICE_STYLES (false), WHATSAPP_FORMAT_EXAMPLE_1/2/3

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

## Resiliencia (hardening beta)
- **initialize() mutex**: `_initializing` flag previene llamadas concurrentes (hot-reload + reconexión). Early return si ya está inicializando.
- **sendMessage retries**: 3 reintentos con backoff exponencial (1s/2s/4s) en errores transitorios. Errores de validación fallan inmediatamente.
- **Outgoing queue**: si el socket no está conectado, los mensajes se encolan (max 100, TTL 5min). Al reconectar se hace flush ordenado.
- **disconnect() try/finally**: `socket.logout()` puede fallar; el cleanup de socket ocurre en `finally` para garantizarse.
- **jidTypeMap eviction**: max 10,000 entries. Al superarse, se eliminan el 20% más antiguo (LRU simple por insertion order).
- **Media download limits**: timeout 30s (AbortController + Promise.race) y límite 50MB (pre-check por fileLength + post-check en buffer).
- **Filtro de mensajes no-procesables**: reactions, stickers y viewOnce se descartan silenciosamente en `normalizeMessage()` (log DEBUG).
- **Batch attachments merge**: `dispatchBatch` combina attachments de todos los mensajes del batch (no solo el primero). `onMessage` pasa `attachments` al IncomingMessage.
- **floodThreshold configurable**: `WHATSAPP_FLOOD_THRESHOLD` en configSchema (default 20) se pasa al batcher y a `buildChannelConfig()`.
- **message-batcher retry**: 3 retries con backoff (1s/2s/4s). Si agotan, dead-letter log CRITICAL con IDs de mensajes.

## Trampas
- NO implementar Meta Cloud API adapter — solo placeholder si se necesita
- Estructura de mensajes Baileys varía por tipo — siempre probar normalizeMessage con mensajes reales
- NO usar filesystem para auth — todo va en PostgreSQL
- `updatePrivacySettings` puede no existir en todas las versiones de Baileys — falla silenciosamente
- Audio send requiere `mimetype: 'audio/ogg; codecs=opus'` y `ptt: true` para voice notes
- **Helpers HTTP y config**: usa `jsonResponse` de `kernel/http-helpers.js` y `numEnv`, `boolEnv` de `kernel/config-helpers.js`. NO redefinir localmente.
