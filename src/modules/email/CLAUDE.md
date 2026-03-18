# Email — Canal de correo electrónico via Gmail API

Canal que recibe emails via polling de Gmail API, los procesa por el engine, y envía respuestas. Soporta reply, reply-all, forward, adjuntos. La firma se toma de la cuenta de Google (no se genera).

## Archivos
- `manifest.ts` — lifecycle, configSchema, oficina fields, API routes, migrations, polling
- `types.ts` — EmailMessage, EmailAttachment, EmailSendOptions, EmailReplyOptions, EmailForwardOptions
- `gmail-adapter.ts` — lectura/envío/reply/forward via Gmail API, filtro no-reply, parsing MIME

## Manifest
- type: `channel`, removable: true, activateByDefault: false
- depends: ['google-api'] — requiere OAuth2 conectado
- configSchema: EMAIL_POLL_INTERVAL_MS, EMAIL_MAX_ATTACHMENT_SIZE_MB, EMAIL_NOREPLY_ADDRESSES, EMAIL_NOREPLY_PATTERNS, EMAIL_PROCESS_LABELS, EMAIL_SKIP_LABELS, EMAIL_AUTO_MARK_READ, EMAIL_INCLUDE_SIGNATURE, EMAIL_MAX_HISTORY_FETCH

## Hooks
- **Escucha** `message:send` → envía email cuando channel === 'email'
- **Dispara** `message:incoming` → cuando llega un email nuevo (procesado por engine)

## Servicio registrado
- `email:adapter` — GmailAdapter instance

## API Routes (bajo /oficina/api/email/)
- `GET /status` — estado del poller + conexión OAuth
- `POST /poll-now` — forzar poll inmediato
- `POST /send` — enviar email { to, subject, bodyHtml, cc?, bodyText? }
- `POST /reply` — responder { originalMessageId, bodyHtml, replyAll?, bodyText? }
- `POST /check-noreply` — verificar si un email es no-reply { email }

## Polling
- Usa Gmail History API para polling incremental (eficiente, no descarga todo)
- Fallback a fetch unread si el historyId expira
- Estado persistido en tabla `email_state` (last_history_id, messages_processed)

## Filtro no-reply
- Direcciones explícitas: EMAIL_NOREPLY_ADDRESSES (CSV)
- Patrones regex: EMAIL_NOREPLY_PATTERNS (CSV)
- Built-in: noreply@, no-reply@, donotreply@, mailer-daemon@, notifications@*.google.com, *@noreply.github.com
- Emails de no-reply se ignoran completamente (no pasan al engine)

## Firma
- La firma se incluye automáticamente por Gmail API al enviar (se usa la configurada en la cuenta de Google)
- NO se genera firma por el sistema — se respeta la firma con imágenes y enlaces de la cuenta

## Tablas
- `email_state` — estado del poller (last_history_id, messages_processed)
- `email_threads` — tracking de threads (thread_id, contact_id, subject, message_count)

## Patrones
- Emails entrantes → se parsean y envían como `message:incoming` con channel='email'
- El content incluye: remitente, asunto, cuerpo texto, lista de adjuntos
- Emails salientes → el engine dispara `message:send` con channel='email'
- Threading: se usan In-Reply-To y References headers para mantener hilos

## Trampas
- History ID puede expirar → fallback automático a fetch unread
- SENT label se skipea para no procesar emails propios
- Gmail API usa base64url encoding (no base64 estándar)
- Adjuntos grandes: attachmentId se obtiene del metadata, content se descarga por separado
- Subject encoding: se usa =?UTF-8?B?...?= para caracteres especiales
