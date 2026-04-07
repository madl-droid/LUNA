# PLAN — Drive Folders: Navegación, Knowledge Crawl, Sharing & Infrastructure

## Contexto

Drive folders necesitan funcionar en 2 contextos distintos:
1. **Como adjunto/tool**: el agente navega on-demand, lista contenido, lee archivos individuales
2. **Como knowledge**: crawl recursivo, indexación completa, detección de cambios

Adicionalmente hay 2 fixes de infraestructura que aplican a TODO el Drive service:
- Folder-first ordering (`folder,name`)
- Shared Drives support (`supportsAllDrives`)

---

## WP1: Infrastructure — Shared Drives + Folder-first Ordering

**Archivo:** `src/modules/google-apps/drive-service.ts`

### 1a. Shared Drives support

Agregar `supportsAllDrives: true` e `includeItemsFromAllDrives: true` a TODAS las llamadas que lo soporten:

```typescript
// En listFiles() — línea ~51
const res = await this.drive.files.list({
  q: query,
  pageSize: options.pageSize ?? 20,
  pageToken: options.pageToken,
  orderBy: options.orderBy ?? 'modifiedTime desc',
  fields: options.fields ?? DEFAULT_FIELDS,
  supportsAllDrives: true,              // NUEVO
  includeItemsFromAllDrives: true,       // NUEVO
})

// En getFile() — línea ~90
const res = await this.drive.files.get({
  fileId,
  fields: '...',
  supportsAllDrives: true,              // NUEVO
})

// En downloadFile() — línea ~226
const res = await this.drive.files.get({
  fileId,
  alt: 'media',
  supportsAllDrives: true,              // NUEVO
})

// En exportFile() — línea ~234
const res = await this.drive.files.export({
  fileId,
  mimeType: exportMimeType,
  supportsAllDrives: true,              // NUEVO (verificar que export lo soporte)
})
```

**Impacto:** Backward compatible — si no hay Shared Drives, no cambia nada.

### 1b. Folder-first ordering

Cuando se lista una carpeta, el default debería ser `folder,name` (carpetas primero, luego archivos, ambos alfabéticos). Para búsquedas generales, mantener `modifiedTime desc`.

```typescript
// En listFiles():
const defaultOrder = options.folderId ? 'folder,name' : 'modifiedTime desc'
const orderBy = options.orderBy ?? defaultOrder
```

**3 líneas de cambio.**

---

## WP2: Tool — Navegación de carpetas on-demand (adjuntos)

**Archivos:**
- `src/modules/google-apps/tools.ts` — actualizar `drive-list-files`
- `src/extractors/drive.ts` — actualizar `extractDrive()` para folders

### 2a. Actualizar tool `drive-list-files`

Agregar parámetros que faltan:

```typescript
// En la definición del tool drive-list-files:
parameters: {
  folderId: { type: 'string', description: 'ID de carpeta para listar contenido' },
  query: { type: 'string', description: 'Buscar por nombre' },
  mimeType: { type: 'string', description: 'Filtrar por MIME type' },
  pageSize: { type: 'number', description: 'Resultados por página (default 50, max 100)' },
  pageToken: { type: 'string', description: 'Token para siguiente página de resultados' },
  sharedWithMe: { type: 'boolean', description: 'Incluir archivos compartidos conmigo' },
}
```

**Cambios:**
- `pageSize` default de 20 → 50
- Exponer `pageToken` para que el agente pueda paginar
- Incluir en response: `nextPageToken` (ya viene de la API, solo exponerlo)
- Formatear response para que el agente vea claramente carpetas vs archivos:

```typescript
// En el handler:
const result = await driveService.listFiles({
  ...params,
  pageSize: Math.min(params.pageSize ?? 50, 100),
})

return {
  success: true,
  data: {
    files: result.files.map(f => ({
      id: f.id,
      name: f.name,
      mimeType: f.mimeType,
      isFolder: f.mimeType === 'application/vnd.google-apps.folder',
      size: f.size,
      modifiedTime: f.modifiedTime,
      webViewLink: f.webViewLink,
    })),
    nextPageToken: result.nextPageToken ?? null,
    totalShown: result.files.length,
  },
}
```

### 2b. Actualizar `extractDrive()` para folders (adjuntos)

**Archivo:** `src/extractors/drive.ts` línea ~147

Cuando un usuario comparte un link de carpeta de Drive como adjunto:

```typescript
if (driveType === 'folder') {
  // Listar primer nivel con folder-first ordering
  const listing = await driveService.listFiles({
    folderId: fileId,
    pageSize: 50,
    orderBy: 'folder,name',  // carpetas primero
  })

  folderContents = listing.files.map(f => ({
    id: f.id,
    name: f.name,
    mimeType: f.mimeType,
    isFolder: f.mimeType === 'application/vnd.google-apps.folder',
    driveType: mapMimeToType(f.mimeType),
    suggestedTool: mapMimeToTool(f.mimeType),
    webViewLink: f.webViewLink,
  }))

  // Indicar si hay más páginas
  hasMoreFiles = !!listing.nextPageToken
}
```

**El agente navega subcarpetas on-demand** usando `drive-list-files` con el `folderId` de la subcarpeta. No hay recursión automática — el agente decide si explorar más profundo basándose en el contexto de la conversación.

### 2c. Protección de profundidad (5 niveles)

NO se necesita protección en el tool — el agente llama `drive-list-files` manualmente por cada nivel. La protección se documenta en el skill/prompt del agente:

```markdown
<!-- En instance/prompts/system/skills/drive-navigation.md -->
## Navegación de carpetas de Drive
- Cuando te comparten un link de carpeta, lista su contenido con drive-list-files
- Si necesitas explorar una subcarpeta, usa drive-list-files con el folderId de la subcarpeta
- Máximo 5 niveles de profundidad — si llegas al límite, informa al usuario
- Siempre muestra las carpetas primero, luego los archivos
- Si hay nextPageToken en la respuesta, pregunta al usuario si quiere ver más
```

---

## WP3: Knowledge — Crawl recursivo con índice

**Archivos:**
- `src/modules/knowledge/item-manager.ts` — reescribir `loadDriveContent()`
- `src/modules/knowledge/pg-store.ts` — métodos de índice de carpeta
- `src/modules/knowledge/types.ts` — tipos de índice
- Nueva migración SQL para índice de carpeta

### 3a. Nuevo tipo: DrivefolderIndex

```typescript
// En types.ts:
export interface DriveFolderIndex {
  itemId: string                    // knowledge_item.id
  rootFolderId: string              // ID de la carpeta raíz
  structure: DriveFolderNode[]      // árbol completo
  lastCrawlAt: Date
  fileCount: number
  folderCount: number
}

export interface DriveFolderNode {
  id: string
  name: string
  mimeType: string
  path: string                      // "Carpeta/Subcarpeta/archivo.pdf"
  parentId: string | null
  isFolder: boolean
  modifiedTime?: string
  webViewLink?: string
  contentHash?: string              // para detección de cambios
  documentId?: string               // knowledge_document.id si ya procesado
  status: 'pending' | 'processed' | 'error' | 'skipped'
}
```

### 3b. Migración: tabla `knowledge_folder_index`

```sql
-- src/migrations/042_drive-folder-index.sql
CREATE TABLE IF NOT EXISTS knowledge_folder_index (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  item_id UUID NOT NULL REFERENCES knowledge_items(id) ON DELETE CASCADE,
  file_id TEXT NOT NULL,             -- Google Drive file/folder ID
  name TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  path TEXT NOT NULL,                -- ruta relativa desde raíz: "Subcarpeta/archivo.pdf"
  parent_id TEXT,                    -- Drive parent folder ID
  is_folder BOOLEAN NOT NULL DEFAULT false,
  modified_time TIMESTAMPTZ,
  web_view_link TEXT,
  content_hash TEXT,                 -- SHA256 del contenido descargado
  document_id UUID REFERENCES knowledge_documents(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'pending',  -- pending, processed, error, skipped
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  
  UNIQUE(item_id, file_id)           -- un archivo aparece una sola vez por item
);

CREATE INDEX IF NOT EXISTS idx_folder_index_item ON knowledge_folder_index(item_id);
CREATE INDEX IF NOT EXISTS idx_folder_index_status ON knowledge_folder_index(item_id, status);
```

### 3c. Reescribir `loadDriveContent()` — crawl completo + procesamiento nivel por nivel

**Estrategia:** Escanear toda la estructura de golpe (solo metadata, no descarga archivos), luego procesar archivos nivel por nivel empezando por el raíz.

```typescript
private async loadDriveContent(item: KnowledgeItem): Promise<number> {
  const drive = this.registry.getOptional<DriveService>('google:drive')
  if (!drive) throw new Error('Servicio Google Drive no disponible')

  // ═══ Fase 1: Crawl completo (solo metadata — rápido) ═══
  const allNodes = await this.crawlDriveFolder(drive, item.sourceId, '', null, 0)
  await this.pgStore.upsertFolderIndex(item.id, allNodes)
  
  const files = allNodes.filter(n => !n.isFolder)
  const folders = allNodes.filter(n => n.isFolder)
  logger.info({
    itemId: item.id, fileCount: files.length, folderCount: folders.length,
  }, '[DRIVE] Folder structure scanned')

  // ═══ Fase 2: Procesar archivos nivel por nivel ═══
  // Agrupar archivos por profundidad (nivel 0 = raíz, nivel 1 = subcarpetas, etc.)
  const byDepth = new Map<number, DriveFolderNode[]>()
  for (const file of files) {
    const depth = file.path.split('/').length - 1  // "archivo.pdf" = 0, "sub/archivo.pdf" = 1
    const list = byDepth.get(depth) ?? []
    list.push(file)
    byDepth.set(depth, list)
  }

  let totalChunks = 0
  const sortedDepths = [...byDepth.keys()].sort((a, b) => a - b)

  for (const depth of sortedDepths) {
    const levelFiles = byDepth.get(depth)!
    logger.info({ depth, fileCount: levelFiles.length }, '[DRIVE] Processing level')

    for (const node of levelFiles) {
      try {
        const file = { id: node.id, name: node.name, mimeType: node.mimeType, webViewLink: node.webViewLink }
        const chunks = await this.loadDriveFile(file, item)
        
        await this.pgStore.updateFolderIndexEntry(item.id, node.id, {
          status: 'processed',
          documentId: /* retornado por persistSmartChunks */,
        })
        totalChunks += chunks
      } catch (err) {
        await this.pgStore.updateFolderIndexEntry(item.id, node.id, {
          status: 'error',
          errorMessage: (err as Error).message,
        })
        logger.warn({ err, fileId: node.id, name: node.name, path: node.path }, '[DRIVE] File failed')
      }
    }

    // Actualizar index en DB después de cada nivel completo
    // (si el proceso se interrumpe, los niveles anteriores ya están procesados)
    logger.info({ depth, totalChunks }, '[DRIVE] Level complete')
  }

  return totalChunks
}
```

**Ventaja del nivel por nivel:** Si el proceso se interrumpe (timeout, crash), los archivos del nivel raíz ya están procesados y embebidos. Un re-sync posterior solo procesará los pendientes.

### 3d. Crawl recursivo con paginación

```typescript
private async crawlDriveFolder(
  drive: DriveService,
  folderId: string,
  parentPath: string,
  parentId: string | null,
  depth: number,
): Promise<DriveFolderNode[]> {
  if (depth > 10) {
    logger.warn({ folderId, depth }, '[DRIVE] Max depth reached, stopping recursion')
    return []
  }

  const nodes: DriveFolderNode[] = []
  let pageToken: string | undefined

  // Paginación completa
  do {
    const result = await drive.listFiles({
      folderId,
      pageSize: 100,
      pageToken,
      orderBy: 'folder,name',
      fields: 'nextPageToken, files(id, name, mimeType, modifiedTime, webViewLink, md5Checksum)',
    })

    for (const file of result.files) {
      const isFolder = file.mimeType === 'application/vnd.google-apps.folder'
      const path = parentPath ? `${parentPath}/${file.name}` : file.name

      nodes.push({
        id: file.id,
        name: file.name,
        mimeType: file.mimeType,
        path,
        parentId,
        isFolder,
        modifiedTime: file.modifiedTime,
        webViewLink: file.webViewLink,
        contentHash: (file as any).md5Checksum ?? undefined,
        status: 'pending',
      })

      // Recursión en subcarpetas
      if (isFolder) {
        const children = await this.crawlDriveFolder(drive, file.id, path, file.id, depth + 1)
        nodes.push(...children)
      }
    }

    pageToken = result.nextPageToken
  } while (pageToken)

  return nodes
}
```

**Notas:**
- `depth > 10` como safety limit (el user pidió 5, pongo 10 para knowledge ya que es crawl automático)
- Paginación completa con `pageToken` loop
- `md5Checksum` para detección de cambios (Drive lo provee gratis para archivos no-nativos)
- Para Google Docs/Sheets/Slides nativos no hay `md5Checksum` → usar `modifiedTime`

---

## WP4: Detección de cambios (sync incremental)

**Archivo:** `src/modules/knowledge/item-manager.ts` + `sync-manager.ts`

### Estrategia

Al re-sincronizar una carpeta de knowledge:

1. **Re-crawl** el árbol completo (el crawl es barato — solo metadata, no descarga archivos)
2. **Comparar** con el índice existente en `knowledge_folder_index`:
   - Archivo nuevo (no está en índice) → `status: 'pending'` → procesar
   - Archivo sin cambios (`md5Checksum` o `modifiedTime` iguales) → skip
   - Archivo modificado (`md5Checksum` o `modifiedTime` cambiaron) → eliminar chunks viejos → re-procesar
   - Archivo eliminado (está en índice pero no en crawl) → eliminar chunks + entrada del índice
3. **Procesar** solo los archivos pending

```typescript
private async syncDriveFolder(item: KnowledgeItem): Promise<{ added: number; updated: number; deleted: number }> {
  const drive = this.registry.getOptional<DriveService>('google:drive')!
  
  // 1. Re-crawl
  const freshNodes = await this.crawlDriveFolder(drive, item.sourceId, '', null, 0)
  const freshMap = new Map(freshNodes.filter(n => !n.isFolder).map(n => [n.id, n]))
  
  // 2. Cargar índice existente
  const existingEntries = await this.pgStore.getFolderIndex(item.id)
  const existingMap = new Map(existingEntries.filter(e => !e.isFolder).map(e => [e.fileId, e]))
  
  let added = 0, updated = 0, deleted = 0
  
  // 3a. Detectar nuevos y modificados
  for (const [fileId, freshNode] of freshMap) {
    const existing = existingMap.get(fileId)
    
    if (!existing) {
      // Archivo nuevo
      freshNode.status = 'pending'
      added++
    } else if (hasChanged(existing, freshNode)) {
      // Archivo modificado — limpiar chunks viejos
      if (existing.documentId) {
        await this.pgStore.deleteDocumentChunks(existing.documentId)
        await this.pgStore.deleteDocument(existing.documentId)
      }
      freshNode.status = 'pending'
      updated++
    } else {
      // Sin cambios — mantener estado existente
      freshNode.status = existing.status
      freshNode.documentId = existing.documentId
    }
  }
  
  // 3b. Detectar eliminados
  for (const [fileId, existing] of existingMap) {
    if (!freshMap.has(fileId)) {
      if (existing.documentId) {
        await this.pgStore.deleteDocumentChunks(existing.documentId)
        await this.pgStore.deleteDocument(existing.documentId)
      }
      deleted++
    }
  }
  
  // 4. Actualizar índice completo
  await this.pgStore.replaceFolderIndex(item.id, freshNodes)
  
  // 5. Procesar pendientes
  // ... mismo loop que en loadDriveContent
  
  return { added, updated, deleted }
}

function hasChanged(existing: FolderIndexEntry, fresh: DriveFolderNode): boolean {
  // Para archivos con md5: comparar hash
  if (fresh.contentHash && existing.contentHash) {
    return fresh.contentHash !== existing.contentHash
  }
  // Para Google nativos: comparar modifiedTime
  if (fresh.modifiedTime && existing.modifiedTime) {
    return new Date(fresh.modifiedTime).getTime() > new Date(existing.modifiedTime).getTime()
  }
  return false // no podemos determinar → asumir sin cambios
}
```

---

## WP5: Sharing — compartir link del archivo, no de la carpeta

**Archivos:**
- `src/modules/knowledge/search-engine.ts` o donde se construye la respuesta con links
- `src/modules/knowledge/pg-store.ts` — query de fileUrl

### Regla
Cuando el agente usa conocimiento de un archivo que vive dentro de una carpeta de Drive, debe compartir el `webViewLink` del **archivo específico**, no de la carpeta raíz.

### Implementación

El `webViewLink` ya se almacena en `knowledge_documents.metadata.fileUrl` por `persistSmartChunks()`. Lo que falta es que **todos los archivos de carpetas de Drive** guarden su `webViewLink` individual.

Verificar en `loadDriveFile()` que se pasa `fileUrl: file.webViewLink`:

```typescript
// En loadDriveFile() — ya existente en Track F:
return this.persistSmartChunks(item, fileName, mime, chunks, {
  description: fileName,
  fileUrl: file.webViewLink,  // ← link del ARCHIVO específico, no de la carpeta
})
```

**También** guardar en `knowledge_folder_index.web_view_link` para que el índice tenga el link directo.

### En el search/injection response

Cuando `getInjection()` o `search()` retorna resultados, incluir el `fileUrl` del documento:

```typescript
// En search results:
{
  text: chunk.content,
  source: doc.title,
  shareableLink: doc.metadata?.fileUrl ?? null,  // link directo al archivo
  path: folderIndexEntry?.path ?? null,           // "Carpeta/Subcarpeta/archivo.pdf"
}
```

El agente ve el `shareableLink` y puede compartirlo si el item de knowledge tiene sharing habilitado.

---

## WP6: pg-store — métodos de folder index

**Archivo:** `src/modules/knowledge/pg-store.ts`

Nuevos métodos:

```typescript
// Insertar/actualizar índice completo de una carpeta
async upsertFolderIndex(itemId: string, nodes: DriveFolderNode[]): Promise<void>

// Obtener índice existente
async getFolderIndex(itemId: string): Promise<FolderIndexEntry[]>

// Reemplazar índice completo (para sync)
async replaceFolderIndex(itemId: string, nodes: DriveFolderNode[]): Promise<void>

// Actualizar entrada individual
async updateFolderIndexEntry(itemId: string, fileId: string, update: {
  status?: string
  documentId?: string
  errorMessage?: string
  contentHash?: string
}): Promise<void>

// Obtener ruta de un archivo (para sharing)
async getFilePath(itemId: string, documentId: string): Promise<string | null>

// Obtener fileUrl de un documento (para sharing)
async getDocumentShareLink(documentId: string): Promise<string | null>
```

---

## WP7: Actualizar `sync-manager.ts` para carpetas

**Archivo:** `src/modules/knowledge/sync-manager.ts`

El sync manager ya tiene `syncDrive()` con paginación, pero:
1. Solo lista 1 nivel (sin recursión)
2. No usa el folder index
3. Re-procesa todo siempre

### Cambio

Cuando el sync source es una carpeta de Drive, delegar a `syncDriveFolder()` del item-manager:

```typescript
// En syncDrive():
if (source.type === 'drive') {
  const item = await this.pgStore.findItemBySourceId(source.ref)
  if (item) {
    const result = await this.itemManager.syncDriveFolder(item)
    return { synced: result.added + result.updated, errors: 0 }
  }
}
```

---

## Binarios en knowledge de Drive

**REGLA:** Si el formato es compatible con embedding multimodal, se fragmenta en chunks y se almacena el binario chunkeado mientras exista el knowledge item. La extracción ya genera los binarios — conservarlos.

### Por formato:

| Formato | ¿Guardar binario? | Qué se guarda | Para qué |
|---------|-------------------|---------------|----------|
| PDF | SÍ | PDF completo en media/ | `chunkPdf` → mediaRefs al PDF → Gemini Embedding multimodal |
| DOCX con imágenes | SÍ | PDF convertido en media/ | Pipeline visual → Gemini Embedding multimodal |
| PPTX | SÍ | PDF convertido en media/ | Pipeline visual → Gemini Embedding multimodal |
| Imagen (.png, .jpg) | SÍ | Imagen en media/ | `chunkImage` → mediaRef → Gemini Embedding multimodal |
| Audio (.mp3, .wav) | SÍ | Segmentos chunkeados en media/ | `chunkAudio` → mediaRef → Gemini Embedding multimodal (60/60/10s) |
| **Video (.mp4, .mov)** | **SÍ** | **Segmentos chunkeados en media/** | **`chunkVideo` → mediaRef → Gemini Embedding multimodal (50/60/10s)** |
| Google Docs (texto) | NO | Solo chunks de texto | FTS + text embedding |
| Google Sheets | NO | Solo chunks CSV | FTS + text embedding |
| Google Slides | SÍ | PDF exportado en media/ | Pipeline visual via Drive PDF export |
| DOCX sin imágenes | NO | Solo chunks de texto | FTS + text embedding |
| TXT/MD/JSON | NO | Solo chunks de texto | FTS + text embedding |

### Video desde Drive (NUEVO)

Video en carpetas de Drive se trata igual que audio:
1. `drive.downloadFile(fileId)` → buffer del video
2. `extractVideo()` → ffprobe (duration, format, hasAudio)
3. `describeVideo()` → LLM multimodal (descripción + resumen + transcripción)
4. `splitMediaFile(buffer, mimeType, duration, VIDEO_SPLIT_CONFIG)` → segmentos en tmpdir
5. Mover segmentos a `instance/knowledge/media/`
6. `chunkVideo({ segments, ... })` → `contentType: 'video_frames'`, mediaRefs a cada segmento
7. Segmentos viven en media/ mientras exista el knowledge item

Esto requiere agregar routing de video y audio en `loadDriveFile()`:

```typescript
// En loadDriveFile() — agregar después del bloque PDF:
} else if (mime.startsWith('video/')) {
  const videoBuffer = await drive.downloadFile(file.id)
  return this.routeVideo(item, file, videoBuffer, mime)

} else if (mime.startsWith('audio/')) {
  const audioBuffer = await drive.downloadFile(file.id)
  return this.routeAudio(item, file, audioBuffer, mime)

} else if (mime.startsWith('image/')) {
  const imageBuffer = await drive.downloadFile(file.id)
  return this.routeImage(item, file, imageBuffer, mime)
```

**Nota:** `routeVideo`, `routeAudio`, `routeImage` ya existen en `knowledge-manager.ts` (Track F). Necesitamos equivalentes en `item-manager.ts` o refactorizar para compartir la lógica.

### Lifecycle

- Binarios se eliminan cuando se elimina el knowledge item (CASCADE en folder_index → DELETE de documents → cleanup de media/)
- El nightly binary cleanup de attachments NO aplica aquí — knowledge binaries viven indefinidamente con su item

---

## WP8: Folder tree view — índice visible para agente y consola

**Archivos:**
- `src/modules/knowledge/item-manager.ts` — método para generar tree view
- `src/extractors/drive.ts` — tree view para adjuntos
- `src/modules/knowledge/console-section.ts` — renderizado en consola (opcional)

### Para knowledge (injection al agente)

Cuando el agente busca en knowledge y un resultado viene de una carpeta de Drive, incluir contexto de la estructura:

```typescript
// Generar tree view desde folder_index
function buildFolderTreeText(itemId: string, pgStore: PgStore): Promise<string> {
  const entries = await pgStore.getFolderIndex(itemId)
  
  // Ordenar: carpetas primero, luego archivos, ambos por nombre
  const sorted = entries.sort((a, b) => {
    if (a.isFolder !== b.isFolder) return a.isFolder ? -1 : 1
    return a.name.localeCompare(b.name)
  })

  // Agrupar por profundidad y construir árbol indentado
  const lines: string[] = []
  for (const entry of sorted) {
    const depth = entry.path.split('/').length - 1
    const indent = '  '.repeat(depth)
    const icon = entry.isFolder ? '📁' : fileIcon(entry.mimeType)
    const status = entry.isFolder ? '' : entry.status === 'processed' ? ' ✅' : entry.status === 'error' ? ' ❌' : ' ⏳'
    lines.push(`${indent}${icon} ${entry.name}${status}`)
  }
  
  return lines.join('\n')
}
```

### Para adjuntos (respuesta del extractor)

Cuando el agente recibe un link de carpeta de Drive como adjunto, el extractor retorna el listado ordenado:

```typescript
// En extractDrive() — cuando driveType === 'folder':
// Ordenar: carpetas primero, luego archivos por nombre
const sortedContents = folderContents.sort((a, b) => {
  if (a.isFolder !== b.isFolder) return a.isFolder ? -1 : 1
  return a.name.localeCompare(b.name)
})

// Formatear como texto legible para el agente
const treeText = sortedContents.map(f => {
  const icon = f.isFolder ? '📁' : fileIcon(f.mimeType)
  return `${icon} ${f.name} (${f.isFolder ? 'carpeta' : f.mimeType}) → ${f.suggestedTool}(${f.id})`
}).join('\n')
```

El agente ve algo como:
```
📁 Contratos → drive-list-files(abc123)
📁 Facturas → drive-list-files(def456)
📄 propuesta.docx → drive-read-file(ghi789)
📊 presupuesto.xlsx → sheets-read(jkl012)
🖼️ logo.png → drive-read-file(mno345)
```

---

## Orden de ejecución

```
WP1 (infrastructure)     ─── independiente, hacer PRIMERO (2 fixes simples)
WP2 (tool navegación)    ─── depende de WP1
WP8 (folder tree view)   ─── depende de WP2 (usa los datos del listing)
WP3 (knowledge crawl)    ─── depende de WP1
WP4 (sync incremental)   ─── depende de WP3 (necesita folder index)
WP5 (sharing)            ─── depende de WP3 (necesita webViewLink guardado)
WP6 (pg-store methods)   ─── se hace junto con WP3
WP7 (sync-manager)       ─── depende de WP3+WP4
```

### Recomendación de sub-tracks

- **G1 (infrastructure + tool + tree):** WP1 + WP2 + WP8 — Shared Drives, ordering, tool mejorado, tree view
- **G2 (knowledge crawl):** WP3 + WP6 + migración + binarios multimedia en Drive — el grueso del trabajo
- **G3 (sync + sharing):** WP4 + WP5 + WP7 — detección de cambios y sharing

---

## Riesgos

1. **Rate limiting Google Drive API**: el crawl recursivo puede generar muchas llamadas a `listFiles`. Para carpetas con 1000+ archivos distribuidos en muchas subcarpetas, podríamos topar el rate limit. Considerar throttle (delay entre llamadas) o usar Changes API.
2. **Google native files sin md5Checksum**: Docs/Sheets/Slides no retornan `md5Checksum` — solo `modifiedTime`. Si alguien modifica y revierte, el `modifiedTime` cambia pero el contenido no → re-procesamiento innecesario. Aceptable.
3. **Carpetas enormes**: Una carpeta con 5000+ archivos distribuidos en subcarpetas podría tardar mucho en el crawl inicial. Considerar límite de archivos totales (ej: max 500 archivos por knowledge item de Drive).
4. **Drive API fields**: `md5Checksum` solo está disponible para archivos binarios (no Google-native). Verificar que el field sea retornado cuando se pide.
5. **Concurrencia**: Si el sync corre mientras el agente está navegando la misma carpeta via tool, no debería haber conflictos (operaciones de lectura en Drive, escritura en tablas distintas).
