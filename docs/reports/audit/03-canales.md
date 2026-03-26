# Auditoría: Canales de Comunicación
Fecha: 2026-03-26
Auditor: Claude (sesión automatizada)

## Resumen ejecutivo

LUNA implementa 5 canales de comunicación (WhatsApp, Gmail, Google Chat, Twilio Voice, TTS) sobre una capa de abstracciones compartidas. Los canales instant (WhatsApp, Google Chat) son los más maduros, con batching, hot-reload y presencia. Gmail es robusto pero complejo (1,604 LOC solo en manifest). Twilio Voice es el más ambicioso y el que más riesgos de seguridad presenta — **webhook signature validation está implementada pero NO se invoca en el handler de llamadas entrantes**. TTS es un módulo feature ligero y correcto. La arquitectura general es sólida: todos usan `registry.getConfig()`, ninguno lee `process.env` directamente (excepto `INSTANCE_ID` en WhatsApp, que es infraestructura), y todos proveen `channel-config:{name}` para el engine.

## Inventario

| Canal | Archivos | LOC | channelType | Estado |
|-------|----------|-----|-------------|--------|
| Abstracciones base | 5 | 501 | — | Estable |
| WhatsApp (Baileys) | 4 | 1,491 | instant | Producción |
| Gmail | 6 | 2,984 | async | Producción |
| Google Chat | 3 | 1,374 | instant | Producción |
| Twilio Voice | 10 | 3,164 | voice | Beta |
| TTS | 3 | 231 | feature | Estable |
| **Total** | **31** | **9,745** | — | — |

---

## Abstracciones base

**Archivos**: `src/channels/types.ts` (129), `channel-adapter.ts` (13), `message-batcher.ts` (130), `typing-delay.ts` (20), `whatsapp/baileys-adapter.ts` (209 — DEAD CODE)

### Fortalezas
- `ChannelRuntimeConfig` es comprehensive: rate limits, aviso, anti-spam, anti-flooding, attachments, typing delay, session timeout — todo configurable por canal
- `MessageBatcher` es reutilizable con debounce, flood threshold, retry (1 vez tras 2s), y hot-reload de parámetros
- `calculateTypingDelay` es simple y correcto: `min(max, max(min, text.length * msPerChar))`
- `IncomingMessage` incluye `resolvedPhone` para cross-channel (WhatsApp LID → phone)
- `AttachmentMeta` usa lazy loading (`getData: () => Promise<Buffer>`) — eficiente
- `ChannelAdapter` interface es mínima y clara: `initialize`, `shutdown`, `sendMessage`, `onMessage`

### Problemas encontrados

| # | Severidad | Descripción | Archivo:Línea | Impacto |
|---|-----------|-------------|---------------|---------|
| 1 | **BAJO** | `baileys-adapter.ts` en `src/channels/whatsapp/` es código muerto — no lo importa nadie. Lee `config` desde un import directo (`../../config.js`) que viola la regla de no usar config fuera del kernel | `src/channels/whatsapp/baileys-adapter.ts:10` | Confusión, deuda técnica |
| 2 | **BAJO** | `MessageBatcher` retry es fijo (1 intento, 2s) sin backoff. Si el handler falla 2 veces, los mensajes se pierden silenciosamente | `src/channels/message-batcher.ts:100-103` | Pérdida de mensajes en caídas transitorias |
| 3 | **INFO** | `ChannelAdapter` interface no es usada directamente por los módulos — WhatsApp, Gmail, Google Chat definen sus propios tipos inline. La interface existe pero no se importa | `src/channels/channel-adapter.ts:7-13` | Interface huérfana |

### Madurez: 4/5

---

## WhatsApp (Baileys)

**Archivos**: `manifest.ts` (704), `adapter.ts` (554), `pg-auth-state.ts` (162), `presence-manager.ts` (71)

### Fortalezas
- **Auth en PostgreSQL** — no filesystem. `pg-auth-state.ts` usa transacciones para `keys.set()` y `clearAuthState()`. Serialización via `BufferJSON.replacer/reviver` correcta
- **Reconexión robusta** — max attempts configurable, intervalo configurable, auto-reconnect deshabilitado en logout explícito. Limpieza de listeners en cada reconexión (evita duplicados)
- **LID resolution** — maneja correctamente WhatsApp LID JIDs (nueva identidad de WhatsApp). Mapea LID → phone via `signalRepository.lidMapping`
- **JID type map** — recuerda si un contacto usa `@lid` o `@s.whatsapp.net` para outbound routing correcto
- **Grupos** — detección de @mention por 3 métodos: protocol-level mentionedJid, `@agentName` en texto, y prefijo `agentName,`/`:`. Strip de mention para procesamiento limpio
- **Agent name dinámico** — lee de `prompts:service.getAgentName()`, no hardcodeado
- **Media completo** — extrae attachments de image, audio, document, video con lazy `getData()` via `downloadMediaMessage`
- **Presence manager** — composing/paused/available con auto-clear a 25s (WhatsApp auto-clear a 30s)
- **Privacy settings** — configurable (last seen, profile pic, read receipts)
- **Call rejection** — rechaza llamadas automáticamente con mensaje configurable
- **Hot-reload** — `console:config_applied` actualiza config + batcher wait time
- **Pre-close follow-up** — timer configurable para recordatorio antes de cerrar sesión
- **Channel config service** — `channel-config:whatsapp` completo con todos los campos de `ChannelRuntimeConfig`
- **Attachment config** — per-category toggles (images, documents, audio, spreadsheets, text) con max size y max per message

### Problemas encontrados

| # | Severidad | Descripción | Archivo:Línea | Impacto | Recomendación |
|---|-----------|-------------|---------------|---------|---------------|
| 1 | **MEDIO** | `process.env.INSTANCE_ID` leído directamente en manifest — viola la regla de config distribuido. Debería estar en kernel config o en configSchema | `manifest.ts:424` | Inconsistencia con la arquitectura | Mover a kernel config |
| 2 | **MEDIO** | Mensaje batch: cuando se concatenan múltiples mensajes, los attachments del 2do+ mensaje se pierden — solo se preserva `base.content` del primer mensaje | `manifest.ts:510-515` | Adjuntos perdidos en batches multi-mensaje | Merge attachments de todos los mensajes |
| 3 | **MEDIO** | `normalizeMessage` no maneja `stickerMessage`, `locationMessage`, `contactMessage` — los filtra silenciosamente (content.type queda como 'text' sin texto) | `adapter.ts:392-398` | Stickers/ubicaciones ignorados sin log | Agregar content types o log explícito |
| 4 | **BAJO** | Reconnect timer no usa backoff exponencial — intervalo fijo (`WHATSAPP_RECONNECT_INTERVAL_MS`). Podría saturar el servidor de WhatsApp | `adapter.ts:181` | Reconexión agresiva | Implementar backoff exponencial |
| 5 | **BAJO** | `onMessage` handler ejecuta handlers secuencialmente con `await` — un handler lento bloquea los demás | `adapter.ts:222-229` | Latencia si hay múltiples handlers | Ejecutar en paralelo con `Promise.allSettled` |
| 6 | **BAJO** | Pre-close timers usan `setTimeout` con horas — en Node.js, timers > ~24.8 días overflow a 32-bit int. Con max 24h está OK, pero no hay validación | `manifest.ts:687-701` | Bajo riesgo actual | Agregar validación de rango |
| 7 | **INFO** | `sendMessage` solo soporta text, image, audio — no video, document, sticker, location | `adapter.ts:296-336` | Limitación funcional conocida | Agregar tipos según necesidad |

### Madurez: 4/5

---

## Gmail

**Archivos**: `manifest.ts` (1,604), `gmail-adapter.ts` (655), `email-oauth.ts` (297), `rate-limiter.ts` (104), `signature-parser.ts` (173), `types.ts` (151)

### Fortalezas
- **Dual OAuth** — soporta OAuth compartido (via google-apps) o standalone con detección automática
- **Token refresh robusto** — schedula refresh antes de expiración, retry a 60s si falla, persiste tokens en DB
- **Rate limiter Redis** — contadores por hora/día con TTL automático. Defaults por tipo de cuenta (workspace: 80/h 1500/d, free: 20/h 400/d)
- **Retry con backoff** — `sendEmail` retries 3 veces con backoff exponencial (1s, 2s, 4s) para 429/5xx
- **History API** — `history.list` con `startHistoryId` para polling incremental. Fallback a `fetchUnread` si history ID expirado
- **Threading completo** — reply mantiene `In-Reply-To`, `References`, `threadId`. Forward incluye adjuntos originales
- **Filtrado extensivo** — no-reply (built-in + custom + regex), domain allowlist/blocklist, subject ignore, label filtering
- **Labels automáticos** — LUNA/Agent, Escalated, Converted, Human-Loop, Ignored + custom labels desde config JSON
- **Escalation integration** — hook `contact:status_changed` aplica labels, star, unread, important según estado
- **Session management** — jobs para pre-close follow-up (15 min) y session close (30 min) via `job:register`
- **Signature extraction** — LLM-based, max 3 intentos por usuario, extrae phone/title/company/website/linkedin
- **Connection wizard** — guía paso a paso para Google Cloud project + credenciales

### Problemas encontrados

| # | Severidad | Descripción | Archivo:Línea | Impacto | Recomendación |
|---|-----------|-------------|---------------|---------|---------------|
| 1 | **MEDIO** | `pollForEmails` sin lock — si un ciclo tarda más que el intervalo, se ejecutan en paralelo. Podría procesar el mismo email dos veces | `manifest.ts:141-224` | Emails duplicados | Agregar flag `isPolling` |
| 2 | **MEDIO** | `reply()` incluye al propio agente en reply-all: no filtra la dirección propia | `gmail-adapter.ts:271` | Auto-loop: agente se envía emails a sí mismo | Filtrar dirección propia |
| 3 | **MEDIO** | Config `EMAIL_ONLY_FIRST_IN_THREAD` en realidad filtra el MÁS RECIENTE. Nombre confuso | `manifest.ts:156-165` | Confusión semántica | Renombrar |
| 4 | **BAJO** | `date` parsing con precedencia de operadores incorrecta en ternario | `gmail-adapter.ts:194` | Fecha incorrecta si header Date vacío | Agregar paréntesis |
| 5 | **BAJO** | `sendEmail` con `subject: ''` cuando no hay thread — emails sin asunto | `manifest.ts:1377` | Emails sin asunto | Generar subject |
| 6 | **BAJO** | `stripHtml` no decodifica `&quot;`, `&#39;`, ni entidades numéricas | `manifest.ts:351-363` | Texto con entidades crudas | Usar librería |
| 7 | **BAJO** | Regex user-supplied en `EMAIL_NOREPLY_PATTERNS` sin try-catch | `gmail-adapter.ts:47-48` | Crash en poll cycle si regex inválido | Wrap en try-catch |

### Madurez: 4/5

---

## Google Chat

**Archivos**: `manifest.ts` (809), `adapter.ts` (430), `types.ts` (135)

### Fortalezas
- **Service Account auth** — `GoogleAuth` con scope `chat.bot`, validación de key JSON comprehensiva
- **Key validation estática** — verifica formato sin inicializar adapter, útil para setup
- **Webhook handling** — procesa MESSAGE, ADDED_TO_SPACE, REMOVED_FROM_SPACE, CARD_CLICKED
- **Space tracking en DB** — tabla `google_chat_spaces` con tipo, email, active, last_message_at
- **Room/DM distinction** — DM-only mode, require mention en rooms (patrón WhatsApp), space whitelist
- **Thread support** — reply-in-thread configurable, filtro de thread replies vs root messages
- **Mention detection** — 3 métodos (argumentText diff, @agentName, prefix). Usa `getAgentName()` dinámico
- **Retry con backoff lineal** — para 5xx transitorios, no retry en 4xx
- **Graceful init** — si no hay key, módulo activo sin adapter. Hot-reload crea adapter al configurar
- **Hot-reload completo** — recrea/destruye batcher, rebuild whitelist, crea adapter dinámicamente

### Problemas encontrados

| # | Severidad | Descripción | Archivo:Línea | Impacto | Recomendación |
|---|-----------|-------------|---------------|---------|---------------|
| 1 | **ALTO** | Webhook token verification débil — comparación simple de string, no HMAC. Si token vacío, acepta TODO. No verifica JWT de Google | `adapter.ts:295-308` | Sin token, cualquiera puede enviar eventos falsos | Implementar verificación JWT |
| 2 | **MEDIO** | `lastThreadByContact` es `Map` sin TTL ni límite. Crece indefinidamente | `manifest.ts:23` | Memory leak lento | Agregar TTL o LRU cache |
| 3 | **MEDIO** | Retry NO retria en 429 (rate limit) — lo trata como 4xx | `adapter.ts:275-277` | Mensajes perdidos por rate limit | Agregar 429 a retryable |
| 4 | **MEDIO** | `activeSpaces` counter en memoria se desincroniza tras crashes | `adapter.ts:322, 329` | Counter inexacto en UI | Re-count periódico del DB |
| 5 | **BAJO** | `typingDelayMsPerChar: 50` pero `supportsTypingIndicator: false` — delay sin feedback visual | `manifest.ts:783-784` | Delay innecesario | Poner typingDelay a 0 |
| 6 | **INFO** | No extrae attachments de mensajes Google Chat — solo texto | `adapter.ts:198-207` | Attachments ignorados | Implementar extracción |

### Madurez: 3.5/5

---

## Twilio Voice

**Archivos**: `manifest.ts` (739), `twilio-adapter.ts` (183), `media-stream.ts` (162), `gemini-live.ts` (284), `call-manager.ts` (514), `voice-engine.ts` (390), `silence-detector.ts` (134), `audio-converter.ts` (127), `pg-store.ts` (239), `types.ts` (392)

### Fortalezas
- **Arquitectura modular** — 10 archivos con responsabilidades claras: adapter (REST), media-stream (WebSocket server), gemini-live (WebSocket client), call-manager (state machine), voice-engine (context), silence-detector (VAD), audio-converter, pg-store
- **Twilio signature validation** — usa `timingSafeEqual` para HMAC — excelente práctica de seguridad
- **XML escaping** — previene injection en TwiML
- **Pre-carga de contexto** — durante el ring delay, carga contacto/memoria/tools en paralelo con `Promise.allSettled`
- **Tool calling** — Gemini Live ejecuta tools del registry de LUNA en tiempo real durante la llamada
- **end_call tool** — tool interna para hangup natural (no cortar abruptamente)
- **Silence detection** — VAD local (RMS-based) con state machine listening → prompting → final-warning
- **Audio conversion** — mulaw 8kHz ↔ PCM 16-bit 16kHz sin dependencias externas, lookup table para performance
- **Transcripción en DB** — cada turno se guarda en `voice_call_transcripts` con speaker, texto, timestamp
- **Resumen post-llamada** — genera summary via LLM y lo guarda en DB + memoria
- **Parametrización completa** — 29+ params configurables desde console (modelo, voz, VAD, greetings, timeouts)
- **SQL parametrizado** — queries seguras con $1, $2 en todo el store

### Problemas encontrados

| # | Severidad | Descripción | Archivo:Línea | Impacto | Recomendación |
|---|-----------|-------------|---------------|---------|---------------|
| 1 | **CRÍTICO** | **Webhook signature validation implementada pero NO invocada** — el handler de incoming calls en manifest.ts (líneas 216-239) parsea params de Twilio pero nunca llama `twilioAdapter.validateSignature()`. Cualquier atacante puede simular llamadas | `manifest.ts:216-239` | Spoofing de llamadas entrantes | Agregar validación de firma antes de procesar |
| 2 | **ALTO** | Context storage via object hack: `(this as unknown as Record<string, unknown>)[\`_ctx_${callSid}\`]` — type-unsafe, puede leakear memoria si promises nunca resuelven | `call-manager.ts:83, 120, 138-140` | Memory leak, crashes en runtime | Usar Map tipado para contexto |
| 3 | **ALTO** | Si Gemini connection falla post-TwiML, el caller ya contestó — queda en llamada sin audio, silencio muerto | `call-manager.ts:254-272` | UX terrible para el usuario | Reproducir mensaje de error y colgar |
| 4 | **ALTO** | `ws.send()` sin try-catch en media-stream y gemini-live — si WebSocket cierra durante envío, error no manejado | `media-stream.ts:41,55,69,83` y `gemini-live.ts:98-99,117,137` | Crashes silenciosos | Agregar try-catch a todos los send() |
| 5 | **ALTO** | WebSocket upgrade handler sin error handling — si `mediaServer.handleUpgrade` falla, la conexión se pierde | `manifest.ts:654-671` | Llamada colgada sin audio | Agregar try-catch |
| 6 | **MEDIO** | Gemini connection timeout tiene race condition — promise puede resolver después de que el timeout fire | `gemini-live.ts:70-73` | Setup intermitente | Usar Promise.race() |
| 7 | **MEDIO** | No hay heartbeat/ping en ningún WebSocket (Twilio ni Gemini) — conexiones pueden quedar stale sin detectar | `media-stream.ts`, `gemini-live.ts` | Llamadas muertas sin detectar | Implementar ping/pong |
| 8 | **MEDIO** | `SilenceDetector` no se actualiza en hot-reload — mantiene threshold/timeout originales | `call-manager.ts:43-46` | Config changes no aplican a llamadas activas | Re-crear en hot-reload |
| 9 | **MEDIO** | Double-end prevention tarde — si `endCall` se llama concurrentemente, ambos entran antes del status check | `call-manager.ts:307-308` | Cleanup duplicado, DB errors | Agregar mutex o flag atómico |
| 10 | **MEDIO** | No hay timeout en ejecución de tools — si el tool registry cuelga, la llamada se congela | `call-manager.ts:451-453` | Llamada congelada | Agregar timeout de 30s |
| 11 | **MEDIO** | API routes sin autenticación ni rate limiting — POST /calls, GET /call-details, POST /voice-preview abiertos | `manifest.ts:36-212` | Acceso no autorizado a transcripciones y llamadas | Agregar auth middleware |
| 12 | **BAJO** | `rmsThreshold || DEFAULT` — si threshold es 0 (ultra-sensible), usa default | `silence-detector.ts:34` | 0 no funciona como valor | Usar `??` en vez de `\|\|` |
| 13 | **BAJO** | Strings hardcodeados en español en system instruction | `voice-engine.ts:213-239`, `call-manager.ts:264` | No internacionalizable | Mover a config |
| 14 | **INFO** | Estados `ringing`, `connecting`, `no-answer`, `busy` definidos en types pero nunca asignados en call-manager | `types.ts:56-64` | Estados no usados | Implementar o remover |

### Madurez: 2.5/5

---

## TTS

**Archivos**: `manifest.ts` (130), `tts-service.ts` (94), `types.ts` (7)

**Nota**: TTS es un módulo `feature`, no un `channel`. Se audita porque es componente de la cadena de voz.

### Fortalezas
- **Separación limpia** — manifest gestiona lifecycle, service gestiona API. Solo 231 LOC total
- **Formato correcto** — OGG_OPUS a 48kHz para compatibilidad con WhatsApp voice notes
- **Degradación graceful** — retorna `null` si API falla, engine envía texto en vez de audio
- **Channel-aware** — `isEnabledForChannel()` y `shouldAutoTTS()` verifican canal e input type
- **Config completa** — voice name, language, speaking rate, pitch, max chars, habilitado/deshabilitado per-channel

### Problemas encontrados

| # | Severidad | Descripción | Archivo:Línea | Impacto | Recomendación |
|---|-----------|-------------|---------------|---------|---------------|
| 1 | **MEDIO** | Estimación de duración con `Math.round(audioBuffer.length / 3000)` — inaccurate para OGG_OPUS variable bitrate | `tts-service.ts:84` | UI muestra duración incorrecta | Usar metadata del codec o constante mejor calibrada |
| 2 | **MEDIO** | Sin caching — cada síntesis idéntica hace llamada API redundante | Todo el servicio | Costo innecesario de API | Agregar LRU cache con TTL |
| 3 | **MEDIO** | No escucha `console:config_applied` — cambios de config no aplican hasta restart | `manifest.ts` | Hot-reload no funciona | Agregar hook listener |
| 4 | **BAJO** | `parseFloat()` con `||` fallback no valida rangos — rate=-50 o pitch=100 serían aceptados | `tts-service.ts:67-68` | Errores de Google API | Validar rangos (rate: 0.25-4.0, pitch: -20 a 20) |
| 5 | **BAJO** | API key en query string en vez de header Authorization | `tts-service.ts:56` | Aparece en logs de servidor | Mover a header |
| 6 | **BAJO** | Truncamiento silencioso de texto largo sin log | `tts-service.ts:53` | Usuario no sabe que se cortó | Log a info level |

### Madurez: 3.5/5

---

## Análisis cross-channel

### Contact unification
- WhatsApp identifica por phone number (o LID con `resolvedPhone` para cross-channel)
- Gmail identifica por email address
- Google Chat identifica por email address (del workspace)
- Twilio Voice identifica por phone number
- **Cross-channel funciona** via módulo `users` — `resolveByContact(senderId, channel)` unifica contactos
- **Punto fuerte**: WhatsApp LID resolution provee `resolvedPhone` para vincular contacto de voz
- **Gap**: No hay deduplicación automática cross-channel — depende de merge manual o del módulo users

### Concurrencia entre canales
- Cada canal procesa mensajes independientemente vía hooks (`message:incoming`)
- El engine procesa mensajes secuencialmente por contacto (via memoria/sesión)
- **Race condition potencial**: Contacto envía por WhatsApp y email simultáneamente — writes concurrentes a memoria
- **Mitigación parcial**: Batcher agrupa mensajes, pero no hay coordinación cross-channel
- **Risk level**: BAJO — en la práctica es raro

### Consistencia de normalización
| Campo | WhatsApp | Gmail | Google Chat | Twilio Voice |
|-------|----------|-------|-------------|--------------|
| `channelName` | 'whatsapp' | 'email' | 'google-chat' | 'voice' |
| `from` | phone/LID | email | email | phone |
| `content.type` | text/image/audio/doc | text (siempre) | text (siempre) | N/A (streaming) |
| `attachments` | Sí (img, audio, doc, video) | Sí (todos) | No | N/A |
| `raw` | Baileys msg | EmailMessage | ChatEvent | N/A |
| Batching | MessageBatcher | Custom debounce | MessageBatcher | No (streaming) |
| Typing indicator | Sí (composing/paused) | No | No (API no soporta) | N/A |

---

## Bugs encontrados

| # | Severidad | Canal | Archivo:Línea | Descripción | Impacto |
|---|-----------|-------|---------------|-------------|---------|
| 1 | **CRÍTICO** | Twilio Voice | `manifest.ts:216-239` | Webhook signature validation NO invocada en incoming calls | Spoofing de llamadas |
| 2 | **ALTO** | Twilio Voice | `call-manager.ts:83,120,138` | Context storage via object hack — memory leak | Crashes, memory leak |
| 3 | **ALTO** | Twilio Voice | `call-manager.ts:254-272` | Gemini falla post-TwiML → silencio muerto | UX terrible |
| 4 | **ALTO** | Twilio Voice | `media-stream.ts:41,55,69,83` | `ws.send()` sin try-catch | Llamadas crashean |
| 5 | **ALTO** | Google Chat | `adapter.ts:295-308` | Webhook acepta todo si token vacío | Eventos falsos |
| 6 | **MEDIO** | Gmail | `manifest.ts:141-224` | Polling sin lock — duplicación | Respuestas dobles |
| 7 | **MEDIO** | Gmail | `gmail-adapter.ts:271` | Reply-all incluye dirección propia | Auto-loop |
| 8 | **MEDIO** | Gmail | `gmail-adapter.ts:194` | Precedencia incorrecta en date parsing | Fechas incorrectas |
| 9 | **MEDIO** | Google Chat | `adapter.ts:275-277` | 429 no se retria | Mensajes perdidos |
| 10 | **MEDIO** | WhatsApp | `manifest.ts:510-515` | Batch pierde attachments del 2do+ msg | Adjuntos perdidos |
| 11 | **MEDIO** | Twilio Voice | `gemini-live.ts:70-73` | Race condition en connection timeout | Setup intermitente |
| 12 | **MEDIO** | TTS | manifest.ts | Sin hot-reload — no escucha config_applied | Config no aplica |

---

## Riesgos de seguridad

| # | Severidad | Canal | Descripción | Vector de ataque | Mitigación |
|---|-----------|-------|-------------|-------------------|------------|
| 1 | **CRÍTICO** | Twilio Voice | Webhook no valida firma Twilio | POST con params falsos | Invocar `validateSignature()` |
| 2 | **ALTO** | Google Chat | Webhook sin verificación criptográfica | Eventos falsos al endpoint | Implementar JWT verification |
| 3 | **ALTO** | Twilio Voice | API routes sin autenticación | Acceso a transcripciones | Agregar auth middleware |
| 4 | **MEDIO** | Gmail | Regex user-supplied sin sanitización | ReDoS via config | Validar/sanitizar regex |
| 5 | **BAJO** | TTS | API key en query string | Exposición en logs | Mover a header |
| 6 | **BAJO** | Twilio Voice | API key Gemini en URL WebSocket | Solo memoria (wss://) | Aceptable, no logear |

---

## Deuda técnica

| # | Prioridad | Canal | Descripción | Esfuerzo estimado |
|---|-----------|-------|-------------|-------------------|
| 1 | **ALTA** | Base | `baileys-adapter.ts` código muerto (209 LOC) | 15 min |
| 2 | **ALTA** | Base | `ChannelAdapter` interface no usada por ningún módulo | 1h |
| 3 | **ALTA** | Gmail | Manifest de 1,604 líneas — debería dividirse | 4h |
| 4 | **MEDIA** | WhatsApp | Batch pierde attachments de mensajes 2+ | 30 min |
| 5 | **MEDIA** | Google Chat | `lastThreadByContact` sin TTL — memory leak | 1h |
| 6 | **MEDIA** | Twilio Voice | Context storage con object hack | 1h |
| 7 | **MEDIA** | TTS | Sin caching de audio | 2h |
| 8 | **MEDIA** | Google Chat | `activeSpaces` counter se desincroniza | 30 min |
| 9 | **BAJA** | Gmail | Batching propio en vez de usar MessageBatcher compartido | 2h |
| 10 | **BAJA** | Twilio Voice | Estados de llamada definidos pero no todos usados | 1h |

---

## Comparación channel-guide.md vs implementación real

| Requisito del guide | WhatsApp | Gmail | Google Chat | Twilio | TTS |
|---------------------|----------|-------|-------------|--------|-----|
| `type: 'channel'` en manifest | ✅ | ✅ | ✅ | ✅ | N/A |
| `channelType` declarado | ✅ | ✅ | ✅ | ✅ | N/A |
| `configSchema` Zod | ✅ | ✅ | ✅ | ✅ | ✅ |
| `channel-config:{name}` service | ✅ | ✅ | ✅ | ✅ | N/A |
| Hook `message:send` | ✅ | ✅ | ✅ | N/A | N/A |
| Hook `message:incoming` | ✅ | ✅ | ✅ | N/A | N/A |
| Hook `console:config_applied` | ✅ | ✅ | ✅ | ✅ | ❌ |
| Agent name de prompts:service | ✅ | N/A | ✅ | ✅ | N/A |
| No `process.env` directo | ⚠️ | ✅ | ✅ | ✅ | ✅ |
| `registry.getConfig()` | ✅ | ✅ | ✅ | ✅ | ✅ |
| Kernel HTTP helpers | ✅ | ✅ | ✅ | ✅ | N/A |
| Kernel config helpers | ✅ | ✅ | ✅ | ✅ | ✅ |
| Console fields | ✅ | ✅ | ✅ | ✅ | ✅ |
| Connection wizard | ✅ | ✅ | ✅ | ✅ | N/A |
| Hot-reload funcional | ✅ | ✅ | ✅ | ✅ | ❌ |
| Attachment config | ✅ | ✅ | ✅ | N/A | N/A |
| Reconnection/retry | ✅ | ✅ | ✅ | ❌ | N/A |
| Rate limiting outbound | ✅ | ✅ | ✅ | ✅ | N/A |

---

## Madurez general canales: 3.5/5

| Canal | Madurez | Justificación |
|-------|---------|---------------|
| WhatsApp | 4/5 | Estable, completo, producción. Gaps menores en batching |
| Gmail | 4/5 | Robusto, feature-rich. Necesita refactor y polling lock |
| Google Chat | 3.5/5 | Funcional pero webhook security débil. Falta attachments |
| Twilio Voice | 2.5/5 | Bien diseñado pero bug crítico de seguridad y gaps de resiliencia |
| TTS | 3.5/5 | Limpio y correcto pero sin caching ni hot-reload |

---

## Top 10 recomendaciones (ordenadas por impacto)

1. **[CRÍTICO] Twilio Voice: Invocar `validateSignature()` en webhook handler** — La implementación existe, solo falta llamarla. 15 min de fix.

2. **[ALTO] Google Chat: Implementar verificación JWT de Google** — El token simple es insuficiente. Google Chat envía JWT verificable.

3. **[ALTO] Twilio Voice: Agregar try-catch a todos los `ws.send()`** — En media-stream.ts y gemini-live.ts. Sin esto, llamadas crashean silenciosamente.

4. **[ALTO] Twilio Voice: Mensaje de error si Gemini falla** — Cuando Gemini falla post-answer, reproducir mensaje de disculpa y colgar en vez de silencio muerto.

5. **[MEDIO] Gmail: Agregar lock de polling** — Flag `isPolling` que previene ciclos concurrentes y procesamiento duplicado.

6. **[MEDIO] Gmail: Filtrar dirección propia en reply-all** — Evitar auto-loop donde el agente se envía emails a sí mismo.

7. **[MEDIO] WhatsApp: Merge de attachments en batch** — Preservar attachments de todos los mensajes concatenados, no solo del primero.

8. **[MEDIO] Twilio Voice: Reemplazar context storage hack** — Cambiar object hack por `Map<string, Promise<PreloadedContext>>` tipado.

9. **[MEDIO] TTS: Agregar caching LRU** — Síntesis idéntica no debería llamar API cada vez. LRU con TTL reduciría costos significativamente.

10. **[BAJO] Eliminar `src/channels/whatsapp/baileys-adapter.ts`** — 209 líneas de código muerto que viola la regla de config distribuido.
