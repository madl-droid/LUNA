# Google Chat — Canal de mensajería via Google Chat API

Canal Google Chat para Google Workspace. Recibe mensajes via webhook, envía via Chat API con Service Account.
Sigue el patrón estándar de canales instant (igual que WhatsApp): channel-config service, hot-reload, mention en rooms.

## Archivos
- `manifest.ts` — lifecycle, hooks, API routes, configSchema, channel-config service, hot-reload, migraciones
- `adapter.ts` — GoogleChatAdapter: auth, webhook handling, rooms/mention, threads, retries, cards, validación
- `types.ts` — interfaces (ChatEvent, GoogleChatConfig, GoogleChatState, SendResult, ChatCardAction)

## Manifest
- type: `channel`, channelType: `instant`, removable: true, activateByDefault: false
- console.title: "Google Chat"
- depends: [] (independiente, lee AGENT_NAME de prompts:service si disponible)
- configSchema: conexión, rooms, threads, retries, cards, channel-runtime (aviso, rate, session, preclose)

## Nombre del agente (AGENT_NAME)
- Se lee de `prompts:service.getAgentName()` (centralizado en módulo prompts)
- Usado para @mention detection en rooms/spaces (mismo patrón que WhatsApp)
- Fallback a 'Luna' si prompts no está disponible
- **REGLA**: todos los canales instant DEBEN usar `prompts:service.getAgentName()`, NO hardcodear nombres

## Channel Config Service
- Provee `channel-config:google-chat` → `{ get(): ChannelRuntimeConfig }`
- Engine lee aviso, rate limits, session timeout y pre-close via este servicio
- `buildChannelConfig()` al final del manifest (mismo patrón que WhatsApp)

## Hot-reload
- Escucha hook `console:config_applied` → Object.assign(config, fresh) + rebuild whitelist

## Hooks
- **Escucha** `message:send` → envía mensaje por Chat API (con reply-in-thread si configurado)
- **Escucha** `console:config_applied` → hot-reload de config
- **Dispara** `message:incoming` → cuando llega MESSAGE o CARD_CLICKED (si habilitado)
- **Dispara** `message:sent` → después de enviar

## Rooms (mismo patrón que WhatsApp grupos)
- DM_ONLY: si true, ignora ROOM/SPACE
- REQUIRE_MENTION: en rooms, solo procesa si bot es @mencionado o llamado por nombre
- Detección: (1) argumentText ≠ text (Google removió @mention), (2) @agentName en texto, (3) nombre como prefijo
- SPACE_WHITELIST: comma-separated de space names permitidos

## Threads
- REPLY_IN_THREAD: respuestas van al mismo hilo (usa messageReplyOption)
- PROCESS_THREADS: si false, no procesa mensajes de hilos
- threadName se almacena en map por contacto (lastThreadByContact)

## Adjuntos (Attachments)
- Adapter extrae attachments del webhook payload (`event.message.attachment[]`)
- Soporta: `downloadUri` (uploaded content) y `driveDataRef` (Drive files)
- Lazy loader `getData()` descarga con auth token del service account
- Config: GOOGLE_CHAT_ATT_IMAGES (true), GOOGLE_CHAT_ATT_DOCUMENTS (true), MAX_SIZE_MB (25), MAX_PER_MSG (5)
- Platform capabilities: images, documents (definidas en engine/attachments/types.ts)
- Adjuntos pasan al engine via `IncomingMessage.attachments` → pipeline de extractores estándar

## Retries
- MAX_RETRIES + RETRY_DELAY_MS con backoff lineal
- Solo reintenta errores transitorios (5xx). 4xx no se reintenta.

## Cards (CARD_CLICKED)
- PROCESS_CARD_CLICKS: gate on/off
- CARD_CLICK_ACTION: 'respond' (procesar como mensaje), 'log' (solo log), 'ignore'

## API routes (montadas en /console/api/google-chat/)
- `POST /webhook`, `GET /status`, `POST /validate-key`, `POST /test-connection`, `GET /setup-guide`

## Tablas
- `google_chat_spaces` — tracking de spaces activos (PK: space_name)

## Trampas
- Webhook SIEMPRE responde HTTP 200 (evitar retries de Google)
- Service Account JSON puede tener newlines — aceptar inline JSON o path
- Google Chat trunca a 4096 chars — adapter trunca antes de enviar
- **Helpers**: usa `jsonResponse`, `parseBody` de `kernel/http-helpers.js` y `numEnv`, `numEnvMin`, `boolEnv` de `kernel/config-helpers.js`
