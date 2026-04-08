# Templates — Plantillas de documentos

Módulo para registrar plantillas de Google Drive y gestionar documentos generados desde ellas. El agente usa las plantillas para crear cotizaciones, comparativos, presentaciones, etc.

## Archivos
- `manifest.ts` — lifecycle, configSchema, console fields + API routes, service + tools init
- `types.ts` — DocTemplate, DocGenerated, TemplateKey, DocType, CreateTemplateInput, etc.
- `repository.ts` — CRUD raw SQL: doc_templates + doc_generated
- `service.ts` — TemplatesService: CRUD plantillas, scanKeysFromDrive, createDocument, reeditDocument, findExistingDocument, getCatalogForPrompt
- `folder-manager.ts` — FolderManager: resuelve folder patterns a Drive IDs, crea carpetas sin duplicados, cache en memoria
- `tools.ts` — registerTemplateTools: registra 3 tools en tools:registry
- `render-section.ts` — UI HTML server-side para gestión de plantillas en consola

## Manifest
- **type**: `feature`, removable: true, activateByDefault: false
- **depends**: `['google-apps', 'tools']`
- **configSchema**: TEMPLATES_STRICT_MODE, TEMPLATES_NO_TEMPLATE_ACTION, TEMPLATES_ROOT_FOLDER_ID

## Servicios registrados
- `templates:service` — TemplatesService
- `templates:renderSection` — `(lang: string) => string` (HTML para consola)
- `templates:catalog` — `{ getCatalogText(): Promise<string> }` (inyectado en prompt del agente)

## Tools registrados (en tools:registry)
- `create-from-template` — Crea un documento desde plantilla (copy → fill → organize → share)
- `search-generated-documents` — Busca documentos generados existentes (evitar duplicados)
- `reedit-document` — Re-edita documento existente in-place (mismo webViewLink)

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
- `doc_templates` — plantillas registradas (id, name, doc_type, drive_file_id, mime_type, keys JSONB, folder_pattern, sharing_mode, enabled)
- `doc_generated` — docs creados (id, template_id FK, contact_id, drive_file_id, web_view_link, key_values JSONB, doc_type, status, tags JSONB, version)

## Drive extensions (google-apps, ambas en Plan 1 + Plan 2)
- `copyFile(fileId, name, parentId?)` — copia archivo en Drive
- `shareFileAnyone(fileId, role?)` — comparte con "anyone with the link"
- `updateFileContent(fileId, content, mimeType)` — sube nuevo contenido al mismo file ID (fallback re-edición con conflicto)

## Flows

### createDocument
1. Obtener template → validar enabled → validar keys
2. FolderManager.resolveFolder(template.folderPattern, keyValues) → folderId
3. drive.copyFile(template.driveFileId, docName, folderId)
4. _fillKeys() → batchEdit (Docs/Slides/Sheets según mimeType)
5. drive.shareFileAnyone(newFileId, 'reader')
6. drive.getFile(newFileId) → webViewLink
7. repo.createGenerated() → retornar DocGenerated

### reeditDocument
1. Calcular diff de keys que cambiaron
2. Conflict check: ¿dos keys comparten mismo valor anterior?
3. Sin conflicto: replaceKeys (batch) sobre mismos keys
4. Con conflicto (raro): exportar template → updateFileContent → fillKeys de nuevo
5. Merge key_values → updateGenerated(version + 1)

### create-from-template (tool handler)
- Sin template_id: buscar por doc_type → si 0 templates → strict mode behavior (warn/block/hitl)
- Validar keys faltantes → error descriptivo con lista
- service.createDocument() → retornar webViewLink

## Patrones
- `keys` en DB: JSONB array `[{key: "COMPANY_NAME", description: "..."}]`
- `key_values` en DB: JSONB object `{"COMPANY_NAME": "ACME Corp", ...}`
- `tags` en DB: JSONB object para búsqueda con GIN index
- FolderManager: cache en memoria (path completo → folder ID), invalidar en console:config_applied si root cambia
- KEY_REGEX: `/\{([A-Z][A-Z0-9_]*)\}/g` — solo mayúsculas

## Strict mode
- `TEMPLATES_STRICT_MODE=true`: agente solo crea docs desde plantillas
- `TEMPLATES_NO_TEMPLATE_ACTION`: 'warn' | 'block' | 'hitl'
- Regla inyectada en prompt via `templates:catalog` service

## Trampas
- `KEY_REGEX.lastIndex` se resetea a 0 antes de cada búsqueda (es stateful por ser global)
- `createGenerated` lanza si la plantilla no existe (subquery retorna 0 filas)
- FolderManager.listFiles usa `name contains` (parcial) — filtrar exacto client-side con `file.name === segment`
- Conflict detection en reeditDocument: compara valores ACTUALES de keys que cambian, no los nuevos
- tools:registry es getOptional en init() — si tools no está activo, tools no se registran (warning en log)
- `templates:catalog` service usa `service!` (non-null) — seguro porque manifest.ts lo setea antes de proveerlo
