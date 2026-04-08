# Google API — Provider de servicios Google

Autenticación OAuth2 y servicios Google: Drive, Sheets, Docs, Slides, Calendar. Expone OAuth client y servicios para otros módulos (email, users).

## Archivos
- `manifest.ts` — lifecycle, configSchema, console fields, API routes, migrations
- `types.ts` — interfaces de todos los servicios (Drive, Sheets, Docs, Slides, Calendar, OAuth)
- `oauth-manager.ts` — OAuth2 flow completo: init, refresh, callback, disconnect, persistencia en DB
- `drive-service.ts` — CRUD archivos/carpetas, compartir, permisos, descargar, exportar
- `sheets-service.ts` — leer/escribir/crear hojas de cálculo, agregar filas
- `docs-service.ts` — leer/crear/editar documentos, extraer texto plano
- `slides-service.ts` — leer/crear/editar presentaciones, extraer texto
- `calendar-service.ts` — CRUD eventos, Meet automático, conflict check, checkAvailability (FreeBusy+fallback), invitados, calendarios compartidos
- `calendar-helpers.ts` — validación business hours/days/days-off, merge busy intervals, cálculo free slots, formateo legible de eventos
- `calendar-config.ts` — CalendarConfigService: CRUD config de scheduling (persiste en config_store como JSON), validación Zod, defaults, hot-reload
- `calendar-console.ts` — renderer SSR de la página de settings Calendar (/console/herramientas/google-apps/calendar): 5 secciones (general, reminders, days off, equipo, follow-ups)
- `calendar-followups.ts` — CalendarFollowUpScheduler: follow-ups pre/post reunión via scheduled-tasks (delayed BullMQ jobs), cancel/reschedule automático
- `tools.ts` — registro de tools para el pipeline (Drive, Sheets, Docs, Slides, Calendar)

## Manifest
- type: `provider`, removable: true, activateByDefault: false
- depends: [] (sin dependencias, pero tools module es opcional)
- configSchema: GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REDIRECT_URI, GOOGLE_REFRESH_TOKEN, GOOGLE_ENABLED_SERVICES, GOOGLE_TOKEN_REFRESH_BUFFER_MS, GOOGLE_API_TIMEOUT_MS, GOOGLE_API_RETRY_MAX

## Servicios registrados
- `google:oauth-client` — OAuth2Client de google-auth-library
- `google:oauth-manager` — OAuthManager (estado, refresh, auth URL)
- `google:drive` — DriveService (si habilitado)
- `google:sheets` — SheetsService (si habilitado)
- `google:docs` — DocsService (si habilitado)
- `google:slides` — SlidesService (si habilitado)
- `google:calendar` — CalendarService (si habilitado)
- `google-apps:calendar-config` — CalendarConfigService: config de scheduling (si calendar habilitado)
- `google-apps:renderCalendarSection` — renderer de la página Calendar settings (si calendar habilitado)

## API Routes (bajo /console/api/google-apps/)
- `GET /status` — estado OAuth + servicios
- `GET /auth-url` — genera URL para autorización OAuth2
- `POST /auth-callback` — { code } — intercambia código por tokens
- `POST /disconnect` — revoca tokens y desconecta
- `POST /refresh-token` — fuerza refresh del access token
- `GET /calendar-config` — config de scheduling + roles + coworkers
- `POST /calendar-config` — guardar config (validación Zod)
- `POST /calendar-check-access` — verificar acceso FreeBusy a calendarios de coworkers

## Tools registrados (cuando tools module existe)
- Drive: drive-list-files, drive-get-file, drive-create-folder, drive-create-file, drive-share, drive-move-file
- Sheets: sheets-read, sheets-write, sheets-append, sheets-create, sheets-info
- Docs: docs-read, docs-create, docs-append, docs-replace
- Slides: slides-read, slides-info, slides-create, slides-replace-text
- Calendar: calendar-list-events, calendar-get-event, calendar-create-event, calendar-update-event, calendar-delete-event, calendar-add-attendees, calendar-list-calendars, calendar-check-availability, calendar-get-scheduling-context, calendar-execute-followup

## Autenticación OAuth2
- Usa `offline` access para obtener refresh token permanente
- Token se almacena en tabla `google_oauth_tokens` (access_token, refresh_token, scopes, email)
- Auto-refresh: programa refresh antes de que expire (buffer configurable, default 5 min)
- Si refresh falla, reintenta en 60s
- `prompt: 'consent'` fuerza nuevo refresh_token en cada autorización

## Tablas
- `google_oauth_tokens` — almacena tokens OAuth2 (primary key = 'primary')
- `calendar_follow_ups` — tracking de follow-ups pre/post reunión (migración 047)

## Migraciones
- `046_gcal-scheduler-subagent.sql` — seed del subagent google-calendar-scheduler en subagent_types
- `047_gcal-followups.sql` — tabla calendar_follow_ups con índices

## Subagent
- `google-calendar-scheduler` — subagent de agendamiento, se habilita/deshabilita automáticamente con el servicio Calendar
- Skills en `instance/prompts/system/skills/gcal-*.md`: new-appointment, reschedule, cancel, check-availability, info
- Tool `calendar-get-scheduling-context` entrega config completa al subagent (roles, coworkers, instrucciones, horario, days off)

## Hooks emitidos
- `calendar:event-created` — al crear evento (payload: event, contactId, channel, meetLink)
- `calendar:event-deleted` — al eliminar evento (payload: eventId)
- `calendar:event-updated` — al actualizar evento (payload: eventId, event, dateChanged)

## Follow-ups automáticos
- Pre-reunión: recordatorio N horas antes (configurable 3-24h, default 24h)
- Post-reunión: "¿cómo te fue?" N minutos después (configurable 30-360min, default 60min)
- Se envían por el mismo canal donde se agendó, mensajes predefinidos (sin LLM)
- Se cancelan automáticamente si el evento se elimina
- Se reagendan si el evento cambia de fecha

## Console: página Calendar Settings
- Ruta: `/console/herramientas/google-apps/calendar`
- Botón "Configurar" en la card de Calendar en `/console/herramientas/google-apps`
- Secciones: General (Meet, duración, nombre cita), Recordatorios, Días off, Equipo (roles+coworkers+instrucciones), Follow-ups
- Config persiste en config_store como JSON (key: GCAL_SCHEDULING_CONFIG), validada con Zod

## Patrones
- Cada servicio se habilita/deshabilita via `GOOGLE_ENABLED_SERVICES` (CSV)
- Los services solo se registran si están habilitados
- Los tools solo se registran si el servicio correspondiente está habilitado Y el módulo tools existe
- Al desactivar el módulo, todos los tools desaparecen automáticamente del catálogo

## Trampas
- NO leer process.env — usar registry.getConfig()
- El refresh_token de OAuth2 dura indefinidamente SI la app está en modo "producción" en GCP (en "testing" expira en 7 días)
- auth-url siempre incluye gmail scopes por conveniencia (si email está activo, comparte este OAuth; si no, no afecta)
- Email ya NO depende de google-apps — puede autenticarse solo con su propio EmailOAuthManager
- `google-auth-library` y `googleapis` ya están instalados en package.json
- **Helpers HTTP y config**: usa `jsonResponse`, `parseBody` de `kernel/http-helpers.js` y `numEnv` de `kernel/config-helpers.js`. NO redefinir localmente.
