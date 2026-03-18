# Google API — Provider de servicios Google

Autenticación OAuth2 y servicios Google: Drive, Sheets, Docs, Slides, Calendar. Expone OAuth client y servicios para otros módulos (email, users).

## Archivos
- `manifest.ts` — lifecycle, configSchema, oficina fields, API routes, migrations
- `types.ts` — interfaces de todos los servicios (Drive, Sheets, Docs, Slides, Calendar, OAuth)
- `oauth-manager.ts` — OAuth2 flow completo: init, refresh, callback, disconnect, persistencia en DB
- `drive-service.ts` — CRUD archivos/carpetas, compartir, permisos, descargar, exportar
- `sheets-service.ts` — leer/escribir/crear hojas de cálculo, agregar filas
- `docs-service.ts` — leer/crear/editar documentos, extraer texto plano
- `slides-service.ts` — leer/crear/editar presentaciones, extraer texto
- `calendar-service.ts` — listar/crear/editar eventos, invitados, calendarios compartidos, free/busy
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

## API Routes (bajo /oficina/api/google-api/)
- `GET /status` — estado OAuth + servicios
- `GET /auth-url` — genera URL para autorización OAuth2
- `POST /auth-callback` — { code } — intercambia código por tokens
- `POST /disconnect` — revoca tokens y desconecta
- `POST /refresh-token` — fuerza refresh del access token

## Tools registrados (cuando tools module existe)
- Drive: drive-list-files, drive-get-file, drive-create-folder, drive-create-file, drive-share, drive-move-file
- Sheets: sheets-read, sheets-write, sheets-append, sheets-create, sheets-info
- Docs: docs-read, docs-create, docs-append, docs-replace
- Slides: slides-read, slides-info, slides-create, slides-replace-text
- Calendar: calendar-list-events, calendar-create-event, calendar-update-event, calendar-add-attendees, calendar-list-calendars, calendar-check-availability

## Autenticación OAuth2
- Usa `offline` access para obtener refresh token permanente
- Token se almacena en tabla `google_oauth_tokens` (access_token, refresh_token, scopes, email)
- Auto-refresh: programa refresh antes de que expire (buffer configurable, default 5 min)
- Si refresh falla, reintenta en 60s
- `prompt: 'consent'` fuerza nuevo refresh_token en cada autorización

## Tablas
- `google_oauth_tokens` — almacena tokens OAuth2 (primary key = 'primary')

## Patrones
- Cada servicio se habilita/deshabilita via `GOOGLE_ENABLED_SERVICES` (CSV)
- Los services solo se registran si están habilitados
- Los tools solo se registran si el servicio correspondiente está habilitado Y el módulo tools existe
- Al desactivar el módulo, todos los tools desaparecen automáticamente del catálogo

## Trampas
- NO leer process.env — usar registry.getConfig()
- El refresh_token de OAuth2 dura indefinidamente SI la app está en modo "producción" en GCP (en "testing" expira en 7 días)
- Siempre incluir scope de gmail en auth URL aunque gmail sea módulo separado (email depende de google-api)
- `google-auth-library` y `googleapis` ya están instalados en package.json
