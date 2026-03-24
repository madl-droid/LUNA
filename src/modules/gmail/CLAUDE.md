# Gmail — Canal de correo electrónico via Gmail API

Canal que recibe emails via polling de Gmail API, los procesa por el engine, y envía respuestas. Soporta reply, reply-all, forward, adjuntos, labels, star, rate limiting, batching.

## Archivos
- `manifest.ts` — lifecycle, configSchema, console fields, API routes, migrations, polling, batching, jobs
- `types.ts` — EmailMessage, EmailAttachment, EmailSendOptions, EmailReplyOptions, EmailForwardOptions, EmailConfig, LunaLabelIds
- `gmail-adapter.ts` — lectura/envío/reply/forward via Gmail API, filtro no-reply/domain/subject, labels, star, parsing MIME, footer
- `email-oauth.ts` — OAuth2 standalone para Gmail-only (se usa cuando google-apps no está activo)
- `rate-limiter.ts` — Redis-backed rate limiter (workspace: 80/h 2000/d, free: 20/h 500/d)

## Manifest
- type: `channel`, removable: true, activateByDefault: false
- depends: [] — google-apps es OPCIONAL (si está activo, comparte su OAuth; si no, email usa su propio OAuth)
- configSchema: polling, filtering (noreply/domains/subjects), reply mode, footer, rate limit, batching, sessions, naturalidad, OAuth

## Labels Gmail
- Se crean al init: LUNA/Agent, LUNA/Escalated, LUNA/Converted, LUNA/Human-Loop, LUNA/Ignored
- Se aplican via contact:status_changed hook y al procesar emails entrantes
- Escalación: star + markImportant + markUnread + labels Escalated+Human-Loop
- Conversión: label Converted, remove Agent

## Hooks
- **Escucha** `message:send` → responde a thread existente o envía nuevo email (con rate limit check)
- **Escucha** `contact:status_changed` → aplica/remueve labels según estado del lead
- **Dispara** `message:incoming` → cuando llega un email nuevo
- **Registra** `job:register` → email-session-close (30min), email-preclose-followup (15min)

## Servicio registrado
- `email:adapter` — GmailAdapter instance

## API Routes (bajo /console/api/gmail/)
- `GET /rate-limits` — uso actual vs limites de envio
- `GET /status` — estado del poller + conexión OAuth
- `POST /poll-now` — forzar poll inmediato
- `POST /send`, `POST /reply`, `POST /check-noreply`
- Auth: `GET /auth-status`, `GET /auth-url`, `POST /auth-callback`, `POST /auth-disconnect`, `POST /auth-refresh`

## Filtrado (en orden)
1. No-reply (direcciones + patrones + built-in)
2. Dominios bloqueados / no permitidos (EMAIL_ALLOWED_DOMAINS, EMAIL_BLOCKED_DOMAINS)
3. Asuntos ignorados (EMAIL_IGNORE_SUBJECTS: Out of Office, etc.)
4. Min body length (2 chars, hardcoded)
5. Solo último por hilo (EMAIL_ONLY_FIRST_IN_THREAD)

## Batching
- EMAIL_BATCH_WAIT_MS > 0: debounce in-memory por threadId, procesa solo el más reciente

## Sesiones
- EMAIL_SESSION_INACTIVITY_HOURS: cierra threads inactivos (job cada 30min)
- EMAIL_PRECLOSE_FOLLOWUP_HOURS: envía follow-up N horas antes del cierre

## Tablas
- `email_state` — estado del poller
- `email_threads` — tracking de threads (thread_id, contact_id, subject, message_count, last_message_gmail_id, closed_at, followup_sent_at)
- `email_oauth_tokens` — tokens OAuth2 standalone

## Trampas
- History ID puede expirar → fallback automático a fetch unread
- Labels se cachean en memoria (labelCache Map) y se recrean si faltan
- Rate limiter usa Redis con TTL natural (no necesita cleanup)
- Batching es in-memory: si el proceso se reinicia, emails sin procesar se re-fetchan como unread
- Footer se inyecta en buildRawEmail() antes del encoding base64
- **Helpers**: usa `jsonResponse`, `parseBody` de kernel. NO redefinir localmente.
