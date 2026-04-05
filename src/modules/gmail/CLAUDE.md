# Gmail — Canal de correo electrónico via Gmail API

Canal que recibe emails via polling de Gmail API, los procesa por el engine, y envía respuestas. Soporta reply, reply-all, forward, adjuntos, labels (default + custom), star, rate limiting, batching, always-CC.

## Archivos
- `manifest.ts` — lifecycle, configSchema, console fields, API routes, migrations, polling, batching, jobs, labels
- `types.ts` — EmailMessage, EmailAttachment, EmailSendOptions, EmailReplyOptions, EmailForwardOptions, EmailConfig, LunaLabelIds, CustomLabel, ResolvedCustomLabel
- `gmail-adapter.ts` — lectura/envío/reply/forward via Gmail API, listMessages (búsqueda genérica), filtro no-reply/domain/subject/List-Unsubscribe, labels, star, parsing MIME, footer, retry 429/5xx
- `tools.ts` — registro de email tools para el pipeline (email-read-inbox, email-search, email-get-detail)
- `email-oauth.ts` — OAuth2 standalone para Gmail-only (se usa cuando google-apps no está activo)
- `rate-limiter.ts` — Redis-backed rate limiter con limites configurables (defaults: workspace 80/h 1500/d, free 20/h 400/d)

## Manifest
- type: `channel`, channelType: `async`, removable: true, activateByDefault: false
- console.title: "Gmail"
- depends: [] — google-apps es OPCIONAL (si está activo, comparte su OAuth; si no, email usa su propio OAuth)
- configSchema:
  - **Polling**: EMAIL_POLL_INTERVAL_MS (60000), EMAIL_MAX_HISTORY_FETCH (20)
  - **Filtering**: EMAIL_NOREPLY_ADDRESSES, EMAIL_NOREPLY_PATTERNS, EMAIL_PROCESS_LABELS ('INBOX'), EMAIL_SKIP_LABELS ('SPAM,TRASH'), EMAIL_AUTO_MARK_READ (true), EMAIL_ONLY_FIRST_IN_THREAD (true), EMAIL_IGNORE_SUBJECTS, EMAIL_ALLOWED_DOMAINS, EMAIL_BLOCKED_DOMAINS
  - **Reply**: EMAIL_REPLY_MODE ('reply-sender'), EMAIL_INCLUDE_SIGNATURE (true), EMAIL_ALWAYS_CC
  - **Footer**: EMAIL_FOOTER_ENABLED (false), EMAIL_FOOTER_TEXT
  - **Rate limit**: EMAIL_ACCOUNT_TYPE ('workspace'), EMAIL_RATE_LIMIT_PER_HOUR (0=auto), EMAIL_RATE_LIMIT_PER_DAY (0=auto)
  - **Labels**: EMAIL_CUSTOM_LABELS (JSON array)
  - **Batching**: EMAIL_BATCH_WAIT_MS (0)
  - **Sessions**: EMAIL_SESSION_INACTIVITY_HOURS (48), EMAIL_PRECLOSE_FOLLOWUP_HOURS (0), EMAIL_PRECLOSE_FOLLOWUP_TEXT
  - **OAuth standalone**: GMAIL_CLIENT_ID, GMAIL_CLIENT_SECRET, GMAIL_REFRESH_TOKEN, GMAIL_TOKEN_REFRESH_BUFFER_MS (300000)
  - **ACK**: ACK_EMAIL_TRIGGER_MS (0=off), ACK_EMAIL_HOLD_MS (2000), ACK_EMAIL_MESSAGE, ACK_EMAIL_STYLE ('formal')
  - **Formato**: EMAIL_FORMAT_ADVANCED (false), FORMAT_INSTRUCTIONS_EMAIL, EMAIL_FORMAT_TONE ('profesional'), EMAIL_FORMAT_MAX_SENTENCES (4), EMAIL_FORMAT_MAX_PARAGRAPHS (4), EMAIL_FORMAT_EMOJI_LEVEL ('nunca')
  - **Firma**: EMAIL_SIGNATURE_MODE ('gmail'), EMAIL_SIGNATURE_TEXT
  - **Triage**: EMAIL_TRIAGE_ENABLED (true) — toggle para reglas built-in (auto-replies, DSN, CC-only, empty body)
  - **Attachments**: EMAIL_ATT_IMAGES/DOCUMENTS/SPREADSHEETS/PRESENTATIONS/TEXT/AUDIO (all true), EMAIL_ATT_MAX_SIZE_MB (25), EMAIL_ATT_MAX_PER_MSG (10)

## Labels Gmail
- **Default** (siempre existen): LUNA/Agent, LUNA/Escalated, LUNA/Converted, LUNA/Human-Loop, LUNA/Ignored
- **Custom**: definidas en EMAIL_CUSTOM_LABELS (JSON), cada una con name + instruction para el agente
- Se crean automáticamente: al init si ya conectado, al conectar OAuth, y al aplicar config desde consola
- `ensureAllLabels()` — función centralizada que crea/verifica todas las etiquetas
- Escalación: star + markImportant + markUnread + labels Escalated+Human-Loop
- Conversión: label Converted, remove Agent

## Triage (pre-procesamiento de emails)
Clasificador determinístico (<5ms, sin LLM) que corre ANTES del agentic loop. Decide RESPOND/OBSERVE/IGNORE.
- **Built-in**: auto-reply headers (Auto-Submitted, X-Auto-Response-Suppress, Precedence:bulk), auto-reply subjects (out of office, etc.), DSN (multipart/report), CC-only (agente en CC pero no en To → OBSERVE), body vacío
- **OBSERVE**: persiste mensaje en DB + sesión, no genera respuesta LLM. Útil para contexto futuro.
- **IGNORE**: descarta completamente, solo marca como leído.
- Clasificador en `src/engine/agentic/email-triage.ts`, gate en `src/engine/engine.ts`
- Service: `gmail:triage-config` expone enabled + ownAddress (auto-detectado de OAuth)
- `rawHeaders` en EmailMessage: mapa lowercased de headers del email (para detectar Auto-Submitted, Precedence, etc.)

## Hot reload
- `reloadConfig()` en cada poll cycle y antes de enviar → filtros, footer, always-CC se actualizan sin restart
- `console:config_applied` → re-ensure labels
- Rate limiter sync: account type + custom limits se actualizan en cada send
- Session jobs leen config fresco dentro del handler (no en closure)
- SQL parametrizado con `make_interval(hours => $1)` — no interpolación

## Hooks
- **Escucha** `message:send` → responde a thread existente o envía nuevo email (con rate limit + retry)
- **Escucha** `contact:status_changed` → aplica/remueve labels según estado del lead
- **Escucha** `console:config_applied` → re-ensure labels
- **Dispara** `message:incoming` → cuando llega un email nuevo
- **Registra** `job:register` → email-session-close (30min), email-preclose-followup (15min)

## Servicios registrados
- `email:adapter` — GmailAdapter instance
- `gmail:label-instructions` — `() => ResolvedCustomLabel[]` — para que engine/tools lean instrucciones de labels
- `gmail:triage-config` — `{ getTriageConfig() }` — config de triage para el engine (enabled, rules, ownAddress)

## Tools registrados (cuando tools module existe y OAuth conectado)
- `email-read-inbox` — Lee emails recientes del buzón (filter: unread/recent/important/all, max_results)
- `email-search` — Busca emails con sintaxis Gmail nativa (from:, to:, subject:, has:attachment, newer_than:, etc.)
- `email-get-detail` — Lee contenido completo de un email por ID (body truncado a 3000 chars)

## API Routes (bajo /console/api/gmail/)
- `GET /rate-limits` — uso actual vs limites (con remaining)
- `GET /status` — estado del poller + conexión OAuth
- `POST /poll-now` — forzar poll inmediato
- `POST /send`, `POST /reply`, `POST /check-noreply`
- `GET /labels` — lista default + custom labels con IDs
- `GET /label-instructions` — instrucciones de labels custom (para el agente)
- `POST /apply-label` — aplicar label a mensaje (messageId + labelId)
- Auth: `GET /auth-status`, `GET /auth-url`, `POST /auth-callback`, `POST /auth-disconnect`, `POST /auth-refresh`

## Trampas
- Emails con header `List-Unsubscribe` se filtran automáticamente (newsletters/marketing)
- History ID puede expirar → fallback automático a fetch unread
- Labels se cachean en memoria (labelCache Map) y se recrean si faltan
- Rate limiter usa Redis con TTL natural (no necesita cleanup)
- Batching es in-memory: si el proceso se reinicia, emails sin procesar se re-fetchan como unread
- Footer se inyecta en buildRawEmail() antes del encoding base64
- Always-CC se inyecta en buildRawEmail(), se mergea con CC explícito (dedup con Set)
- sendEmail() tiene retry con exponential backoff (3 retries) para 429/500/503
- 403 dailyLimitExceeded se logea pero no se reintenta
- **Helpers**: usa `jsonResponse`, `parseBody` de kernel. NO redefinir localmente.
