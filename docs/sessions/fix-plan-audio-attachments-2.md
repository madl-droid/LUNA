# Plan de correcciones — Parte 2 (Items de discusión + NITs)

Complemento del plan `fix-plan-audio-attachments.md`.
Aplicar sobre la rama `claude/audit-audio-attachments-b68WJ` (que ya tiene Plan 1 mergeado).

---

## GRUPO H — Bugs confirmados en discusión

### H1. exportFile corrompe binarios (PowerPoint → PDF)
**Archivos:** `src/modules/google-apps/drive-service.ts` (fix principal), callers en `item-manager.ts`

`DriveService.exportFile()` hace `return String(res.data)` — corrompe datos binarios.
Para PPTX el `exportMime` es `application/pdf`, que es binario. `String(pdf_bytes)` destruye los bytes.

**Fix:** Hacer que `exportFile` detecte mimes binarios y retorne `Buffer` en ese caso:

```typescript
// ANTES (drive-service.ts:232):
async exportFile(fileId: string, exportMimeType: string): Promise<string> {
  const res = await this.drive.files.export({ fileId, mimeType: exportMimeType })
  return String(res.data)
}

// DESPUÉS:
async exportFile(fileId: string, exportMimeType: string): Promise<string | Buffer> {
  const isBinary = exportMimeType === 'application/pdf'
    || exportMimeType.startsWith('application/vnd.')
  const res = await this.drive.files.export(
    { fileId, mimeType: exportMimeType },
    isBinary ? { responseType: 'arraybuffer' } : {},
  )
  return isBinary ? Buffer.from(res.data as ArrayBuffer) : String(res.data)
}
```

**Callers que consumen el resultado:** buscar con grep todos los que llaman `exportFile` y
verificar que manejen `string | Buffer`. Si el caller hace `Buffer.from(result, 'utf-8')`,
cambiar a:
```typescript
const exported = await drive.exportFile(fileId, exportMime)
const buffer = Buffer.isBuffer(exported) ? exported : Buffer.from(exported, 'utf-8')
```

Esto mantiene PDF como formato de export para PowerPoint (preserva layout y formato)
y corrige la corrupción de datos binarios en la raíz del problema.

### H2. sourceId único por sección temática
**Archivo:** `src/modules/memory/session-chunker.ts` — función que genera secciones temáticas

Problema: todas las secciones de una sesión comparten `sourceId: 'section-{sessionId}'`.
El linking prev/next conecta temas distintos en una sola cadena.

**Fix:** Usar un sourceId único por sección:

```typescript
// Buscar donde se genera sourceId para secciones y cambiar a:
sourceId: `section-${sessionId}-${sectionIndex}`,
// donde sectionIndex es el índice (0, 1, 2...) de la sección en el array de secciones
```

Esto asegura que `linkSessionChunks()` forme cadenas independientes por tema, mejorando
la navegación en búsquedas vectoriales.

### H3. validateInjection para contenido de Drive
**Archivo:** `src/extractors/drive.ts` — función `enrichDriveContent`

Problema: el contenido extraído de Drive (`doc.body`, `content` de sheets, slides) se asigna
directamente a `enriched.extractedContent` sin pasar por `validateInjection()`. Un Google Doc
compartido podría contener prompt injection.

**Fix:** Aplicar `validateInjection` al contenido antes de asignarlo. La API real de
`validateInjection` (en `src/engine/attachments/injection-validator.ts`) es:

```typescript
validateInjection(content: string, sourceType: string, sourceName: string)
  → { safe: boolean, injectionRisk: boolean, threats: string[], sanitizedText: string }
```

Aplicar en `enrichDriveContent` después de obtener el content:
```typescript
import { validateInjection } from '../engine/attachments/injection-validator.js'

const check = validateInjection(content, 'drive', result.fileName ?? result.fileId)
if (check.injectionRisk) {
  logger.warn({ fileId: result.fileId, threats: check.threats }, 'Drive content injection risk detected')
}
// Usar check.sanitizedText en vez de content crudo
```

Nota: `validateInjection` no bloquea — envuelve contenido sospechoso con trust boundaries
(UUID markers) para que el LLM sea consciente del riesgo. Usar `sanitizedText` siempre.

**Este fix se implementa dentro del grupo K (refactor enrichDriveContent) para no tocar
el archivo dos veces.**

### H4. query_attachment sin scoping de sesión (ex deuda C1 del Plan 1)
**Archivo:** `src/engine/attachments/tools/query-attachment.ts`

El reporte del Plan 1 marcó esto como deuda por "ctx no tiene sessionId". Revisión muestra
que `ToolExecutionContext` ya define `sessionId?: string` (types.ts:84) y `agentic-loop.ts:332`
ya lo pasa como `sessionId: ctx.session.id`.

El problema real: el handler en query-attachment.ts:24 define un tipo inline estrecho
`ctx: { contactId?, correlationId }` que ignora el sessionId que sí recibe.

**Fix:**
```typescript
// ANTES (query-attachment.ts:24):
handler: (input: Record<string, unknown>, ctx: { contactId?: string; correlationId: string })

// DESPUÉS:
handler: (input: Record<string, unknown>, ctx: { contactId?: string; sessionId?: string; correlationId: string; db: Pool })
```

Y en la query SQL, agregar filtro:
```sql
WHERE contact_id = $1
  AND ($2::uuid IS NULL OR session_id = $2)  -- scope by session when available
```

### H5. drive-read-file no pasa session_id a persistDriveReadResult (ex deuda C3 del Plan 1)
**Archivos:** `src/modules/google-apps/tools.ts` — handler de `drive-read-file` y función `persistDriveReadResult`

Mismo diagnóstico que H4: el handler declara `async (input) =>` sin recibir `ctx`,
pero `ToolHandler` lo pasa como segundo argumento.

**Fix:**
```typescript
// ANTES (tools.ts:242):
handler: async (input) => {

// DESPUÉS:
handler: async (input, ctx) => {
```

Y pasar `ctx.sessionId` a `persistDriveReadResult`:
```typescript
// Añadir sessionId al signature de persistDriveReadResult
async function persistDriveReadResult(
  registry: Registry,
  fileId: string, fileName: string, mimeType: string,
  extractedText: string | null, llmText: string | null,
  sessionId?: string,  // ← nuevo
): Promise<void>
```

En el INSERT (tools.ts:915), reemplazar `NULL` por `$7` y agregar `sessionId ?? null`
al array de params.

---

## GRUPO I — Vocabulario unificado: eliminar 'done' para embeddings

**Archivos afectados:**
- `src/modules/knowledge/embedding-queue.ts` — `reconcileDocumentStatus`
- `src/modules/knowledge/pg-store.ts` — `updateDocumentEmbeddingStatus`
- `src/modules/knowledge/vectorize-worker.ts` — cualquier `'done'` de embedding
- `src/modules/knowledge/types.ts` — `EmbeddingStatus`
- `src/modules/knowledge/console-section.ts` — checks de `!== 'done'`
- Cualquier query con `WHERE embedding_status = 'done'`

**Nota:** El Plan 1 (D1) ya añadió `'queued'` y `'embedded'` a `EmbeddingStatus`.
Este grupo elimina `'done'` del vocabulario activo.

**Fix:**

1. En `types.ts`, eliminar `'done'` de `EmbeddingStatus`:
```typescript
export type EmbeddingStatus = 'pending' | 'queued' | 'processing' | 'embedded' | 'failed' | 'pending_review'
```

2. En `vectorize-worker.ts` (líneas 107, 118, 120, 170): cambiar `'done'` → `'embedded'`.

3. En `console-section.ts` (línea 82): cambiar `!== 'done'` → `!== 'embedded'`.

4. En `pg-store.ts` (línea 1286): cambiar `NOT IN ('done', 'processing')` →
   `NOT IN ('embedded', 'processing')`.

5. En `reconcileDocumentStatus` de embedding-queue.ts: si escribe `'done'` a documentos,
   cambiar a `'embedded'`.

6. Grep general antes de commitear:
```bash
grep -rn "'done'" src/modules/knowledge/ src/modules/memory/
```
Eliminar toda referencia a `'done'` como valor de embedding_status.

7. **Migración:** Agregar a la migración existente o crear una nueva:
```sql
UPDATE knowledge_chunks SET embedding_status = 'embedded' WHERE embedding_status = 'done';
UPDATE knowledge_documents SET embedding_status = 'embedded' WHERE embedding_status = 'done';
UPDATE session_memory_chunks SET embedding_status = 'embedded' WHERE embedding_status = 'done';
```

---

## GRUPO J — Limpieza de exports duplicados + documentación

### J1. Eliminar re-export de SmartChunk/LinkedChunk de smart-chunker.ts
**Archivo:** `src/modules/knowledge/extractors/smart-chunker.ts` línea 17

```typescript
// ELIMINAR esta línea:
export type { EmbeddableChunk as SmartChunk, LinkedEmbeddableChunk as LinkedChunk }
```

El único punto de export de estos aliases debe ser `types.ts`. Si hay callers
que importan desde `smart-chunker.ts`, redirigirlos a `types.ts` o `embedding-limits.ts`.

### J2. Documentar updateChunkEmbedding como path directo para batch jobs
**Archivos:** `src/modules/knowledge/pg-store.ts`, `src/modules/memory/pg-store.ts`

~~El plan original proponía eliminar `updateChunkEmbedding`.~~
Revisión reveló callers activos fuera del vectorize-worker:
- `nightly-batch.ts:348,655` — embedding de stragglers en batch nocturno
- `vectorize-worker.ts:216,251` — embedding directo de knowledge chunks

Son **dos paths complementarios, no duplicados:**
- `persistEmbedding` (embedding-queue): path de cola BullMQ con retry y backoff
- `updateChunkEmbedding` (pg-store): path directo para batch jobs con su propio retry

**Fix:** No eliminar. Agregar comentario JSDoc en ambas implementaciones:

```typescript
/**
 * Direct embedding persistence — bypasses BullMQ queue.
 * Used by batch jobs (nightly-batch, vectorize-worker) that manage their own retry logic.
 * For normal flow, use EmbeddingQueue.enqueue() instead.
 */
async updateChunkEmbedding(chunkId: string, embedding: number[]): Promise<void>
```

---

## GRUPO K — Refactor de enrichDriveContent

**Archivo:** `src/extractors/drive.ts`

Split de `enrichDriveContent` en tres funciones internas para mejor diagnóstico de errores.
La firma pública no cambia. Los callers existentes no se modifican.

```typescript
/**
 * Lee el contenido del archivo desde las APIs de Google.
 * Falla rápido si el servicio no está disponible.
 */
async function fetchDriveContent(
  result: DriveResult,
  registry: Registry,
): Promise<string | null> {
  switch (result.driveType) {
    case 'document': {
      const docs = registry.getOptional<DocsService>('google:docs')
      if (!docs) return null
      const doc = await docs.getDocument(result.fileId)
      return doc.body
    }
    case 'spreadsheet': {
      const sheets = registry.getOptional<SheetsService>('google:sheets')
      if (!sheets) return null
      const info = await sheets.getSpreadsheet(result.fileId)
      const firstSheet = info.sheets[0]
      if (!firstSheet) return null
      const data = await sheets.readRange(result.fileId, `'${firstSheet.title}'`)
      return data.values.map(row => row.join('\t')).join('\n')
    }
    case 'presentation': {
      const slides = registry.getOptional<SlidesService>('google:slides')
      if (!slides) return null
      return slides.getSlideText(result.fileId)
    }
    default:
      return null
  }
}

/**
 * Sanitiza contenido contra prompt injection (fix H3).
 */
function sanitizeDriveContent(
  content: string,
  result: DriveResult,
): string {
  const check = validateInjection(content, 'drive', result.fileName ?? result.fileId)
  if (check.injectionRisk) {
    logger.warn({ fileId: result.fileId, threats: check.threats }, '[Drive] Injection risk detected')
  }
  return check.sanitizedText
}

/**
 * Para contenido grande, genera resumen LLM.
 * Si el LLM falla, retorna el resultado sin summary (no propaga el error).
 */
async function generateDriveSummary(
  content: string,
  result: DriveResult,
  registry: Registry,
): Promise<DriveResult> {
  const enriched: DriveResult = { ...result, extractedContent: content }
  const tokenEstimate = Math.ceil(content.length / 4)
  if (tokenEstimate <= 8000) return enriched

  try {
    const llmResult = await registry.callHook('llm:chat', {
      // ... mismo contenido que el actual
    })
    // ... mismo manejo de resultado
    return enriched
  } catch (err) {
    logger.warn({ err, fileId: result.fileId }, '[Drive] LLM summary failed')
    return enriched
  }
}

/**
 * Orquestador público. Misma firma y comportamiento que antes.
 * Internamente separa fetch, sanitización y LLM para diagnóstico claro.
 */
export async function enrichDriveContent(
  result: DriveResult,
  registry: Registry,
): Promise<DriveResult> {
  if (!result.hasAccess || result.driveType === 'folder') return result

  try {
    const content = await fetchDriveContent(result, registry)
    if (!content) return result
    const safeContent = sanitizeDriveContent(content, result)  // H3
    return await generateDriveSummary(safeContent, result, registry)
  } catch (err) {
    logger.warn({ err, fileId: result.fileId }, '[Drive] Content enrichment failed')
    return result
  }
}
```

---

## GRUPO L — Simplificación de trimKeepingTurns

**Archivo:** `src/modules/memory/redis-buffer.ts` — función `trimKeepingTurns`

Eliminar el inner loop anidado usando `prevAssistantIdx`:

```typescript
async trimKeepingTurns(sessionId: string, keepTurns: number): Promise<void> {
  const key = `session:${sessionId}:messages`
  const raw = await this.redis.lrange(key, 0, -1)
  if (raw.length === 0) return

  let turns = 0
  let cutIndex = 0 // default: keep everything (ltrim 0 -1 = no-op)

  for (let i = raw.length - 1; i >= 0; i--) {
    const msg = JSON.parse(raw[i]!) as StoredMessage
    if (msg.role !== 'assistant') continue

    turns++
    if (turns < keepTurns) continue

    // Turno más antiguo a conservar encontrado en posición i.
    // Su inicio = primera posición después del assistant anterior.
    let prevAssistantIdx = -1
    for (let j = i - 1; j >= 0; j--) {
      if ((JSON.parse(raw[j]!) as StoredMessage).role === 'assistant') {
        prevAssistantIdx = j
        break
      }
    }
    cutIndex = prevAssistantIdx + 1  // -1+1=0 si no hay assistant previo
    break
  }

  if (cutIndex <= 0) return
  await this.redis.ltrim(key, cutIndex, -1)
}
```

Nota sobre riesgo de atomicidad (`lrange` + `ltrim` no son atómicos):
> La ventana de race condition es de microsegundos. El peor caso es que se pierda del
> buffer un mensaje recién llegado, que ya está guardado en PG. Riesgo aceptado — no
> se justifica el overhead de un Lua script para este caso.

---

## GRUPO M — Eliminación de métodos obsoletos message-based

**Archivos:** `src/modules/memory/memory-manager.ts` y `src/modules/memory/redis-buffer.ts`

**Nota:** El Plan 1 (G1) ya eliminó `getOldestMessages` y `trimOldestMessages`.
Verificar que se completó correctamente y que no quedaron referencias huérfanas:

```bash
grep -rn "getOldestMessages\|trimOldestMessages\|getMessageCount" src/
```

Si `getMessageCount` aún existe y no tiene callers, eliminarlo también.

---

## GRUPO N — NITs

### N1. toLocaleDateString sin locale fijo
**Archivo:** `src/engine/boundaries/intake.ts`

```typescript
// ANTES:
new Date(meta.modifiedTime).toLocaleDateString('es')

// DESPUÉS:
new Date(meta.modifiedTime).toISOString().slice(0, 10)  // "2025-04-06"
```

### N2. Empty catch → logger.debug
**Archivo:** `src/engine/agentic/agentic-loop.ts`

```typescript
// ANTES:
captureDriveToolResult(...).catch(() => {})

// DESPUÉS:
captureDriveToolResult(...).catch(err => logger.debug({ err }, '[agentic] Drive capture failed'))
```

### N3. toLocaleString para token counts produce número ambiguo en locale español
**Archivos:** `src/engine/boundaries/intake.ts` y `src/engine/attachments/processor.ts`

En locale `es_ES`, `(8192).toLocaleString()` produce `"8.192"` (con punto), que en español
parece el decimal 8.192, no ocho mil ciento noventa y dos.

```typescript
// ANTES:
tokenEstimate.toLocaleString()

// DESPUÉS:
String(tokenEstimate)
```

### N4. Magic number 8000 → constante nombrada
**Archivos:** `src/engine/agentic/agentic-loop.ts` y `src/engine/attachments/tools/query-attachment.ts`

```typescript
const MAX_TOOL_RESULT_CHARS = 8_000
```

### N5. Parámetro _parentId sin uso en loadChunk
**Archivo:** `src/modules/knowledge/embedding-queue.ts`

Eliminar el parámetro `_parentId` de la firma de `loadChunk`.
El parentId se lee de PG internamente, el parámetro es dead code.

### N6. chunkDocs hardcodea 'docx' en overflow path
**Archivo:** `src/modules/knowledge/extractors/smart-chunker.ts`

```typescript
// ANTES:
sourceType: 'docx',

// DESPUÉS:
sourceType: opts?.sourceType ?? 'docx',
```

### N7. Loggers standalone en lugar del kernel logger
**Archivos:** `src/extractors/drive.ts`, `src/modules/knowledge/embedding-queue.ts`,
`src/engine/attachments/tools/query-attachment.ts`

Estos archivos usan `pino()` directo en vez del logger del kernel.
Verificar el patrón usado por otros módulos y replicarlo (pasar logger como parámetro
o importar singleton del kernel).

### N8. Deuda técnica — chunkSheets: 1 chunk por fila
**Archivo:** `src/modules/knowledge/extractors/smart-chunker.ts` — función `chunkSheets`

Agregar comentario de deuda técnica:

```typescript
// Tech debt: actualmente se crea 1 chunk por fila. Para spreadsheets grandes
// (>1000 filas), esto genera demasiados chunks con baja densidad semántica.
// Mejora futura: si se elige un valor N para agrupar filas (ej: N=5-10 filas por chunk),
// la vectorización y búsqueda semántica serán más efectivas al tener más contexto por chunk.
```

---

## NOTA — Riesgo documentado (no corregir)

### Race condition en trimKeepingTurns (riesgo aceptado)
**Archivo:** `src/modules/memory/CLAUDE.md`

Agregar nota:

```
### Race condition en trimKeepingTurns (aceptado)
`lrange` y `ltrim` no son atómicos. En la ventana entre ambas operaciones (microsegundos),
un mensaje nuevo podría ser eliminado del buffer. Riesgo aceptado porque:
1. La ventana es extremadamente pequeña
2. El buffer es solo caché — PG es la fuente de verdad y el mensaje queda ahí
3. El costo de un Lua script no justifica la mejora en este caso
```

---

## ORDEN DE IMPLEMENTACIÓN

```
H → I → J → K → L → M → N
```

- H1 (exportFile) es independiente del resto
- H2 (sourceId) es independiente
- H3 (validateInjection) se implementa dentro de K (enrichDriveContent refactor)
- H4 y H5 (session scoping) son independientes entre sí
- I (vocabulario) depende de que D1 de EmbeddingStatus esté aplicado (Plan 1 ✅)
- J1 (exports duplicados) es independiente
- J2 (documentar updateChunkEmbedding) es independiente
- K incluye H3 para no tocar el archivo dos veces
- L y M pueden hacerse en paralelo con todo lo demás
- N (nits) son todos independientes

**Paralelización sugerida:**
- Batch 1: H1, H2, H4, H5 (bugs, independientes)
- Batch 2: I, J1, J2 (vocabulario y limpieza)
- Batch 3: K (refactor enrichDriveContent + H3)
- Batch 4: L, M, N (simplificación + nits)

---

## CAMBIOS RESPECTO AL PLAN ORIGINAL

| Item | Antes | Ahora | Razón |
|------|-------|-------|-------|
| H1 | Cambiar exportMime a `text/plain` | Fix `exportFile` para soportar `Buffer` en mimes binarios | Owner quiere mantener PDF, arreglar el manejo binario |
| H4 | Deuda técnica C1 (fuera de scope) | Fix trivial: ampliar tipo de ctx en handler | `ToolExecutionContext` ya tiene `sessionId`, solo falta leerlo |
| H5 | Deuda técnica C3 (fuera de scope) | Fix trivial: recibir `ctx` en handler | Mismo caso que H4 |
| J2 | Eliminar `updateChunkEmbedding` | Documentar como path directo para batch | `nightly-batch.ts` lo usa activamente, no es dead code |
| M | Eliminar getOldest/trimOldest | Verificar que Plan 1 G1 lo completó | Ya fue ejecutado en Plan 1, solo verificar |
