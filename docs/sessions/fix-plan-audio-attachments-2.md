# Plan de correcciones — Parte 2 (Items de discusión + NITs)

Complemento del plan `fix-plan-audio-attachments.md`.
Aplicar sobre la rama `claude/fix-audio-attachments-3pqFJ`.

---

## GRUPO H — Bugs confirmados en discusión

### H1. PowerPoint exportado como PDF corrupto
**Archivo:** `src/modules/google-apps/tools.ts` — constante `OFFICE_EXPORT_MAP`

El `exportMime: 'application/pdf'` para PPTX/PPT pasa datos binarios por `String(res.data)` en
`DriveService.exportFile()`, corrompiendo el archivo. El objetivo es extracción de texto, no
fidelidad visual.

**Fix:** Cambiar el `exportMime` de los tipos PowerPoint a `text/plain`:

```typescript
// ANTES:
'application/vnd.openxmlformats-officedocument.presentationml.presentation': {
  exportMime: 'application/pdf', extractorMime: 'application/pdf', label: 'PowerPoint'
},
'application/vnd.ms-powerpoint': {
  exportMime: 'application/pdf', extractorMime: 'application/pdf', label: 'PowerPoint'
},

// DESPUÉS:
'application/vnd.openxmlformats-officedocument.presentationml.presentation': {
  exportMime: 'text/plain', extractorMime: 'text/plain', label: 'PowerPoint'
},
'application/vnd.ms-powerpoint': {
  exportMime: 'text/plain', extractorMime: 'text/plain', label: 'PowerPoint'
},
```

Nota: Google Drive permite exportar presentaciones a `text/plain` via la API. Verificar que
no retorne error 415. Si la API lo rechaza, alternativa: exportar como
`application/vnd.openxmlformats-officedocument.presentationml.presentation` y añadir
extractor PPTX (similar al .docx existente).

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

**Fix:** Aplicar `validateInjection` al contenido antes de asignarlo:

```typescript
// Después de obtener el content (doc.body, sheet data, slide text):
// Importar validateInjection desde el módulo correspondiente
import { validateInjection } from '../engine/attachments/injection-validator.js'

// Antes de: const enriched = { ...result, extractedContent: content }
const injectionCheck = validateInjection(content)
if (injectionCheck.blocked) {
  logger.warn({ fileId: result.fileId, reason: injectionCheck.reason }, 'Drive content blocked by injection validator')
  return result  // retornar sin enriquecer
}
const safeContent = injectionCheck.sanitized ?? content
const enriched: DriveResult = { ...result, extractedContent: safeContent }
```

Verificar la API exacta de `validateInjection` en el archivo `injection-validator.ts`
y ajustar el código según lo que retorne esa función.

---

## GRUPO I — Vocabulario unificado: eliminar 'done' para embeddings

**Archivos afectados:**
- `src/modules/knowledge/embedding-queue.ts` — `reconcileDocumentStatus`
- `src/modules/knowledge/pg-store.ts` — `updateDocumentEmbeddingStatus`
- `src/modules/knowledge/vectorize-worker.ts` — cualquier `'done'` de embedding
- `src/modules/knowledge/types.ts` — `EmbeddingStatus`
- Cualquier query con `WHERE embedding_status = 'done'`

**Fix:**

1. En `types.ts`, eliminar `'done'` de `EmbeddingStatus` (tras actualizar el fix D1):
```typescript
export type EmbeddingStatus = 'pending' | 'queued' | 'processing' | 'embedded' | 'failed' | 'pending_review'
```

2. En `reconcileDocumentStatus` de embedding-queue.ts, cambiar:
```typescript
// ANTES:
await this.db.query(`UPDATE knowledge_documents SET embedding_status = 'done' WHERE id = $1`, [documentId])

// DESPUÉS:
await this.db.query(`UPDATE knowledge_documents SET embedding_status = 'embedded' WHERE id = $1`, [documentId])
```

3. En `updateDocumentEmbeddingStatus` de pg-store.ts: si algún caller pasa `'done'`,
   actualizar a `'embedded'`.

4. Grep general antes de commitear:
```bash
grep -r "'done'" src/modules/knowledge/ src/modules/memory/
```
Eliminar toda referencia a `'done'` como valor de embedding_status.

---

## GRUPO J — Limpieza de exports duplicados

### J1. Eliminar re-export de SmartChunk/LinkedChunk de smart-chunker.ts
**Archivo:** `src/modules/knowledge/extractors/smart-chunker.ts` línea 17

```typescript
// ELIMINAR esta línea:
export type { EmbeddableChunk as SmartChunk, LinkedEmbeddableChunk as LinkedChunk }
```

El único punto de export de estos aliases debe ser `types.ts` (línea 107). Si hay callers
que importan desde `smart-chunker.ts`, redirigirlos a `types.ts` o `embedding-limits.ts`.

### J2. Eliminar updateChunkEmbedding de pg-store cuando se borre el vectorize-worker
**Archivo:** `src/modules/knowledge/pg-store.ts` — `updateChunkEmbedding`

Al eliminar `vectorize-worker.ts` (plan 1, grupo E4), hacer grep para confirmar que
`updateChunkEmbedding` no tiene otros callers:
```bash
grep -r "updateChunkEmbedding" src/
```
Si solo era llamada por el vectorize-worker, eliminar el método de pg-store.ts.

---

## GRUPO K — Refactor de enrichDriveContent

**Archivo:** `src/extractors/drive.ts`

Split de `enrichDriveContent` en tres funciones para mejor diagnóstico de errores:

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
    return enriched  // retornar sin summary, no tirar el error
  }
}

/**
 * Orquestador público. Misma firma y comportamiento que antes.
 */
export async function enrichDriveContent(
  result: DriveResult,
  registry: Registry,
): Promise<DriveResult> {
  if (!result.hasAccess || result.driveType === 'folder') return result

  try {
    const content = await fetchDriveContent(result, registry)
    if (!content) return result
    const withInjectionCheck = validateAndSanitize(content)  // fix H3
    return await generateDriveSummary(withInjectionCheck, result, registry)
  } catch (err) {
    logger.warn({ err, fileId: result.fileId }, '[Drive] Content enrichment failed')
    return result
  }
}
```

La firma de `enrichDriveContent` no cambia. Los callers existentes no se modifican.

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

Antes de eliminar, verificar que no tengan callers externos:

```bash
grep -rn "getOldestMessages\|trimOldestMessages\|getMessageCount" src/
```

Si los únicos callers son los propios archivos o código comentado:
1. Eliminar `getOldestMessages` de `memory-manager.ts` y `redis-buffer.ts`
2. Eliminar `trimOldestMessages` de `memory-manager.ts` y `redis-buffer.ts`
3. Verificar que `getMessageCount` también sea dead code antes de eliminarlo

---

## GRUPO N — NITs

### N1. toLocaleDateString sin locale fijo
**Archivo:** `src/engine/boundaries/intake.ts`

```typescript
// ANTES:
new Date(meta.modifiedTime).toLocaleDateString('es')

// DESPUÉS — usar formato explícito e independiente del locale del servidor:
new Date(meta.modifiedTime).toLocaleDateString('es-ES', {
  year: 'numeric', month: 'long', day: 'numeric'
})
// O más simple:
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

// DESPUÉS (sin ambigüedad):
tokenEstimate.toLocaleString('es-ES')  // siempre consistente: "8.192"
// O aún más explícito:
new Intl.NumberFormat('es-ES').format(tokenEstimate)
```

Nota: si el estilo del proyecto prefiere solo dígitos sin formato, usar simplemente
`String(tokenEstimate)`.

### N4. Magic number 8000 → constante nombrada
**Archivos:** `src/engine/agentic/agentic-loop.ts` y `src/engine/attachments/tools/query-attachment.ts`

```typescript
// Al inicio del archivo o en un lugar compartido:
const MAX_TOOL_RESULT_CHARS = 8_000

// Reemplazar todos los `8000` relacionados con truncación de tool results
```

### N5. Parámetro _parentId sin uso en loadChunk
**Archivo:** `src/modules/knowledge/embedding-queue.ts`

```typescript
// Eliminar el parámetro _parentId de la firma de loadChunk.
// El parentId se lee de PG internamente, el parámetro es dead code.
```

### N6. chunkDocs hardcodea 'docx' en overflow path
**Archivo:** `src/modules/knowledge/extractors/smart-chunker.ts`

```typescript
// ANTES (en el path de sub-chunks dentro de chunkDocs):
sourceType: 'docx',

// DESPUÉS:
sourceType: opts?.sourceType ?? 'docx',
```

### N7. Loggers standalone en lugar del kernel logger
**Archivos:** `src/extractors/drive.ts` línea 10, `src/modules/knowledge/embedding-queue.ts` línea 14

Estos archivos usan `pino()` directo en vez del logger del kernel. El logger del kernel
respeta el `LOG_LEVEL` configurado; los loggers standalone no.

```typescript
// ANTES:
import pino from 'pino'
const logger = pino({ name: 'drive-extractor' })

// DESPUÉS — buscar cómo obtener el logger del kernel en estos archivos:
// Opción A: pasarlo como parámetro a las funciones que lo necesitan
// Opción B: importar desde el kernel si hay un singleton exportado
// Opción C: usar el registry para acceder al servicio de logging

// Verificar el patrón usado por otros extractors/módulos similares y replicarlo.
```

### N8. Deuda técnica — chunkSheets: 1 chunk por fila
**Archivo:** `src/modules/knowledge/extractors/smart-chunker.ts` — función `chunkSheets`

Agregar comentario de deuda técnica:

```typescript
// Tech debt: actualmente se crea 1 chunk por fila. Para spreadsheets grandes
// (>1000 filas), esto genera demasiados chunks con baja densidad semántica.
// Mejora futura: si se elige un valor N para agrupar filas (ej: N=5-10 filas por chunk),
// la vectorización y búsqueda semántica serán más efectivas al tener más contexto por chunk.
// Ver: https://github.com/madl-droid/LUNA/issues/XXX
```

---

## NOTA — Riesgo documentado (no corregir)

### Race condition en trimKeepingTurns (riesgo aceptado)
**Archivo:** `src/modules/memory/redis-buffer.ts` — CLAUDE.md del módulo memory

Agregar nota en `src/modules/memory/CLAUDE.md`:

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

- H (bugs) y N (nits) son independientes entre sí → pueden hacerse en paralelo
- I (vocabulario) depende de que el fix D1 de EmbeddingStatus esté aplicado (plan 1)
- J2 (eliminar updateChunkEmbedding) depende de E4 (eliminar vectorize-worker) del plan 1
- K (enrichDriveContent) incluye el H3 (validateInjection) para no tocar el archivo dos veces
