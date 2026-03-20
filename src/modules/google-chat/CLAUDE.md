# Google Chat — Canal de mensajería via Google Chat API

Canal Google Chat para Google Workspace. Recibe mensajes via webhook, envía via Chat API con Service Account.

## Archivos
- `manifest.ts` — lifecycle, hooks, API routes, configSchema, migraciones
- `adapter.ts` — GoogleChatAdapter: auth, webhook handling, envío de mensajes, tracking de spaces, validación de key
- `types.ts` — interfaces (ChatEvent, GoogleChatConfig, GoogleChatState, SendResult, ServiceAccountKeyInfo, SetupGuideStep)

## Manifest
- type: `channel`, removable: true, activateByDefault: false
- depends: [] (independiente de google-apps)
- configSchema: GOOGLE_CHAT_SERVICE_ACCOUNT_KEY, GOOGLE_CHAT_WEBHOOK_TOKEN, GOOGLE_CHAT_MAX_MESSAGE_LENGTH

## Autenticación
- Usa **Service Account** (no User OAuth) — estándar de Google para bots de Chat
- El JSON del service account se pasa via GOOGLE_CHAT_SERVICE_ACCOUNT_KEY (inline JSON o path a archivo)
- Scope: `https://www.googleapis.com/auth/chat.bot`
- No depende del módulo google-apps

## Setup simplificado
- `POST /validate-key` — valida JSON del service account sin guardarlo, extrae project_id, client_email, client_id
- `GET /setup-guide` — retorna guía paso a paso con estado de cada paso (done/pending)
- Al guardar el key, el sistema valida automáticamente antes de inicializar
- Errores de validación son bilingües (es/en) y específicos

## Hooks
- **Escucha** `message:send` → envía mensaje via Chat API cuando `payload.channel === 'google-chat'`
- **Dispara** `message:incoming` → cuando llega un MESSAGE via webhook
- **Dispara** `message:sent` → después de enviar un mensaje

## Servicio registrado
- `google-chat:adapter` — instancia de GoogleChatAdapter

## API routes (montadas en /oficina/api/google-chat/)
- `POST /webhook` — endpoint para Google Chat (configurar como HTTP endpoint en GCP)
- `GET /status` — estado de conexión, botEmail, activeSpaces, configured
- `POST /validate-key` — valida JSON del service account, retorna info extraída
- `POST /test-connection` — verifica que el service account funciona
- `GET /setup-guide` — guía paso a paso con webhookPath y estado de cada paso

## Tablas
- `google_chat_spaces` — tracking de spaces donde el bot está activo

## Flujo de mensajes
- **Incoming**: Google Chat POST → /webhook → verifyToken → handleWebhookEvent → normalize → `message:incoming` hook
- **Outgoing**: Engine → `message:send` hook → resolve space → adapter.sendMessage → Chat API → `message:sent` hook

## Patrones
- Webhook siempre responde HTTP 200 (incluso en error) para evitar retries de Google
- ADDED_TO_SPACE/REMOVED_FROM_SPACE se trackean en DB, no llegan al pipeline
- `argumentText` se usa sobre `text` cuando disponible (text sin @mention del bot)
- Messages de tipo BOT se ignoran (solo procesa HUMAN)
- Validación del key al init — si el JSON es inválido, el módulo queda activo pero desconectado

## Trampas
- NO usar User OAuth para bots de Chat — viola políticas de Google
- Service Account JSON puede contener newlines — aceptar inline JSON o path a archivo
- Google Chat trunca mensajes a 4096 chars — adapter trunca antes de enviar
- El módulo arranca sin error si no hay service account configurado — solo logea warning
- **Helpers HTTP y config**: usa `jsonResponse`, `parseBody`, `readBody` de `kernel/http-helpers.js` y `numEnv` de `kernel/config-helpers.js`. NO redefinir localmente.
