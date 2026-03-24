# Gmail — Canal de correo electrónico via Gmail API

Canal que recibe emails via polling de Gmail API, los procesa por el engine, y envía respuestas. Soporta reply, reply-all, forward, adjuntos, labels (default + custom), star, rate limiting, batching, always-CC.

## Archivos
- `manifest.ts` — lifecycle, configSchema, console fields, API routes, migrations, polling, batching, jobs, labels
- `types.ts` — EmailMessage, EmailAttachment, EmailSendOptions, EmailReplyOptions, EmailForwardOptions, EmailConfig, LunaLabelIds, CustomLabel, ResolvedCustomLabel
- `gmail-adapter.ts` — lectura/envío/reply/forward via Gmail API, filtro no-reply/domain/subject, labels, star, parsing MIME, footer, retry 429/5xx
- `email-oauth.ts` — OAuth2 standalone para Gmail-only (se usa cuando google-apps no está activo)
- `rate-limiter.ts` — Redis-backed rate limiter con limites configurables (defaults: workspace 80/h 1500/d, free 20/h 400/d)

## Manifest
- type: `channel`, removable: true, activateByDefault: false
- depends: [] — google-apps es OPCIONAL (si está activo, comparte su OAuth; si no, email usa su propio OAuth)
- configSchema: polling, filtering, reply mode, footer, rate limit (configurable), always-CC, custom labels, batching, sessions, naturalidad, OAuth

## Labels Gmail
- **Default** (siempre existen): LUNA/Agent, LUNA/Escalated, LUNA/Converted, LUNA/Human-Loop, LUNA/Ignored
- **Custom**: definidas en EMAIL_CUSTOM_LABELS (JSON), cada una con name + instruction para el agente
- Se crean automáticamente: al init si ya conectado, al conectar OAuth, y al aplicar config desde consola
- `ensureAllLabels()` — función centralizada que crea/verifica todas las etiquetas
- Escalación: star + markImportant + markUnread + labels Escalated+Human-Loop
- Conversión: label Converted, remove Agent

## Hot reload
- `reloadConfig()` en cada poll cycle y antes de enviar → filtros, footer, always-CC se actualizan sin restart
- `console:config_applied` → re-ensure labels (crea nuevas custom labels si se agregaron)
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
- History ID puede expirar → fallback automático a fetch unread
- Labels se cachean en memoria (labelCache Map) y se recrean si faltan
- Rate limiter usa Redis con TTL natural (no necesita cleanup)
- Batching es in-memory: si el proceso se reinicia, emails sin procesar se re-fetchan como unread
- Footer se inyecta en buildRawEmail() antes del encoding base64
- Always-CC se inyecta en buildRawEmail(), se mergea con CC explícito (dedup con Set)
- sendEmail() tiene retry con exponential backoff (3 retries) para 429/500/503
- 403 dailyLimitExceeded se logea pero no se reintenta
- **Helpers**: usa `jsonResponse`, `parseBody` de kernel. NO redefinir localmente.
