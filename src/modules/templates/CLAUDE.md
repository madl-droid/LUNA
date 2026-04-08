# Templates — Plantillas de documentos

Módulo para registrar plantillas de Google Drive y gestionar documentos generados desde ellas. El agente usa las plantillas para crear cotizaciones, comparativos, presentaciones, etc.

## Archivos
- `manifest.ts` — lifecycle, configSchema, console fields + API routes, service init
- `types.ts` — DocTemplate, DocGenerated, TemplateKey, DocType, CreateTemplateInput, etc.
- `repository.ts` — CRUD raw SQL: doc_templates + doc_generated
- `service.ts` — TemplatesService: CRUD de plantillas + scanKeysFromDrive + queries de docs generados
- `render-section.ts` — UI HTML server-side para gestión de plantillas en consola

## Manifest
- **type**: `feature`, removable: true, activateByDefault: false
- **depends**: `['google-apps', 'tools']`
- **configSchema**: TEMPLATES_STRICT_MODE, TEMPLATES_NO_TEMPLATE_ACTION, TEMPLATES_ROOT_FOLDER_ID

## Servicios registrados
- `templates:service` — TemplatesService (CRUD plantillas, scan keys, queries docs generados)
- `templates:renderSection` — `(lang: string) => string` (HTML para consola)

## API routes (bajo /console/api/templates/)
- `GET /list` — lista plantillas (filtros: docType, enabled)
- `GET /get?id=UUID` — obtiene plantilla por ID
- `POST /create` — crea plantilla { name, docType, driveFileId, mimeType, keys, folderPattern, sharingMode }
- `PUT /update` — actualiza plantilla { id, name?, description?, docType?, keys?, folderPattern?, sharingMode?, enabled? }
- `DELETE /delete?id=UUID` — elimina plantilla
- `POST /scan-keys` — escanea { driveFileId } → { keys: TemplateKey[], mimeType }
- `GET /generated` — lista docs generados (filtros: templateId, contactId, docType, status)
- `GET /generated-detail?id=UUID` — detalle de doc generado

## DB tables (migración 048)
- `doc_templates` — plantillas registradas por el admin (id, name, doc_type, drive_file_id, mime_type, keys JSONB, folder_pattern, sharing_mode, enabled)
- `doc_generated` — documentos creados desde plantillas (id, template_id FK, contact_id, drive_file_id, web_view_link, key_values JSONB, doc_type, status, tags JSONB, version)

## Drive extensions (google-apps)
Plan 1 agrega a `drive-service.ts`:
- `copyFile(fileId, name, parentId?)` → copia un archivo en Drive
- `shareFileAnyone(fileId, role?)` → comparte con "anyone with the link"

## Flujo de creación en consola
1. Admin pega URL Drive → frontend extrae file ID
2. `POST /scan-keys { driveFileId }` → servicio llama Drive, Docs/Slides/Sheets, extrae `{KEY}` con regex
3. Admin ve keys, agrega descripciones, llena nombre/tipo/folder/sharing
4. `POST /create { ... }` → guarda en DB

## Patrones
- `keys` en DB: JSONB array `[{key: "COMPANY_NAME", description: "..."}]`
- `key_values` en DB: JSONB object `{"COMPANY_NAME": "ACME Corp", ...}`
- `tags` en DB: JSONB object para búsqueda con GIN index
- `createGenerated` usa subquery para derivar `doc_type` de la plantilla
- KEY_REGEX: `/\{([A-Z][A-Z0-9_]*)\}/g` — solo mayúsculas

## Trampas
- El módulo depende de google-apps; si no hay auth o el servicio no está activo, `scanKeysFromDrive` lanza error
- `KEY_REGEX.lastIndex` se resetea a 0 antes de cada búsqueda (es stateful por ser global)
- `createGenerated` lanza si la plantilla no existe (subquery retorna 0 filas)
- Los handlers API acceden al servicio vía variable de módulo `service` (seteada en init, limpiada en stop)
