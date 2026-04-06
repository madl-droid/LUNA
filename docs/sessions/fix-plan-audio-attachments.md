# Plan de correcciones — Auditoría rama `claude/fix-audio-attachments-3pqFJ`

Generado por sesión de auditoría. Sonnet debe aplicar estos cambios sobre la rama
`claude/fix-audio-attachments-3pqFJ`. Trabajar en orden; cada grupo puede hacerse en
un solo commit.

---

## GRUPO A — Bugs críticos (bloquean funcionamiento real)

### A1. Loop infinito en embedding queue — circuit breaker
**Archivo:** `src/modules/knowledge/embedding-queue.ts` ~líneas 318-325

Problema: cuando el circuit breaker está abierto, `processJob` llama `this.enqueue(job.data)`
sin ningún delay. El job se procesa inmediatamente, choca con el CB, se re-encola → loop
infinito que inunda BullMQ y PG.

**Fix:** Reemplazar el bloque por un `throw` para que BullMQ maneje el retry con backoff:

```typescript
// ANTES:
if (Date.now() < this.cbPausedUntil) {
  const remainMs = this.cbPausedUntil - Date.now()
  logger.warn({ chunkId, remainMs }, '[EMBED-Q] Circuit breaker open, re-queuing')
  await this.enqueue(job.data)
  return
}

// DESPUÉS:
if (Date.now() < this.cbPausedUntil) {
  const remainMs = this.cbPausedUntil - Date.now()
  logger.warn({ chunkId, remainMs }, '[EMBED-Q] Circuit breaker open, will retry via BullMQ backoff')
  throw new Error(`Circuit breaker open for ${Math.ceil(remainMs / 1000)}s`)
}
```

El worker debe tener `attempts` y `backoff` configurados en el `defaultJobOptions` del Queue:
```typescript
defaultJobOptions: {
  attempts: 5,
  backoff: { type: 'exponential', delay: 5000 },
  removeOnComplete: { count: 100 },
  removeOnFail: { count: 50 },
}
```
Si ya están configurados, solo cambiar el bloque del CB.

### A2. Loop infinito — embedding service unavailable
**Archivo:** `src/modules/knowledge/embedding-queue.ts` ~líneas 327-335

Problema: `setTimeout(resolve, 5000)` bloquea el worker slot, luego re-encola sin delay.

**Fix:** Mismo patrón — throw para que BullMQ haga retry:

```typescript
// ANTES:
await new Promise(resolve => setTimeout(resolve, 5000))
await this.enqueue(job.data)
return

// DESPUÉS:
throw new Error('Embedding service unavailable, will retry')
```

### A3. Chunks embebidos invisibles al vector search — `embedding_status` nunca seteado
**Archivos:** `src/modules/memory/session-embedder.ts` y `src/modules/memory/compression-worker.ts`

Problema: los INSERTs en `session_memory_chunks` escriben `has_embedding` pero nunca
`embedding_status`. El vector search en `memory-search.ts` filtra por
`embedding_status = 'embedded'`. Chunks con embedding real nunca aparecen.

**Fix en `session-embedder.ts` — función `persistChunks`:**

En el INSERT, añadir la columna `embedding_status` a la lista de columnas y su valor
correspondiente en el VALUES. El valor debe ser:
- `'embedded'` si el chunk tiene embedding (`chunk.hasEmbedding === true`)
- `'pending'` si no

```sql
-- Añadir a la lista de columnas:
embedding_status

-- Añadir al VALUES:
CASE WHEN $N THEN 'embedded' ELSE 'pending' END
-- donde $N es el mismo parámetro que ya pasa has_embedding
```

También añadir `embedding_status` al ON CONFLICT DO UPDATE si existe.

**Fix en `compression-worker.ts` — función `persistChunksWithoutEmbeddings`:**

Esta función siempre persiste sin embeddings, así que hardcodear `'pending'`:
```sql
-- Añadir columna y valor:
embedding_status = 'pending'
```

### A4. Columna `sections` faltante en `session_summaries_v2`
**Archivo:** `src/migrations/036_session-summary-sections.sql`

Problema: `session-archiver.ts` escribe a columna `sections JSONB` en `session_summaries_v2`,
pero la migración 036 solo la agrega a `session_summaries` (si acaso), no a `session_summaries_v2`.

**Fix:** Revisar el contenido actual de `036_session-summary-sections.sql`. Si solo agrega
`sections` a `session_summaries`, agregar el ALTER para `session_summaries_v2` también:

```sql
ALTER TABLE session_summaries_v2
  ADD COLUMN IF NOT EXISTS sections JSONB;
```

Si no existe la migración o está incompleta, añadir este ALTER al final del archivo.

---

## GRUPO B — Bugs medianos funcionales

### B1. `'drive'` y `'drive_reference'` no son tipos válidos
**Archivo:** `src/engine/attachments/types.ts`

Problema: `processor.ts` escribe `category = 'drive'` y `sourceType = 'drive_reference'` pero
ninguno existe en `AttachmentCategory` ni `AttachmentSourceType`. `CATEGORY_LABEL_MAP` devuelve
`undefined` para `'drive'`.

**Fix en `types.ts`:**
1. Agregar `'drive'` al union type `AttachmentCategory`
2. Agregar `'drive_reference'` al union type `AttachmentSourceType`
3. Agregar entrada en `CATEGORY_LABEL_MAP`: `drive: 'Google Drive'` (o la etiqueta que corresponda)

### B2. Secciones superpuestas en `distributedSample`
**Archivo:** `src/engine/attachments/processor.ts` — función `distributedSample`

Problema: para documentos apenas por encima del límite, `midStart` puede ser anterior a
`startEnd`, causando solapamiento y desperdicio de tokens.

**Fix:** Clampear el inicio de cada sección para que no retroceda sobre la anterior:

```typescript
// Después de calcular startEnd:
const clampedMidStart = Math.max(startEnd, midStart)
const clampedMidEnd   = Math.max(clampedMidStart, midEnd)
const clampedEndStart = Math.max(clampedMidEnd, endStart)

// Usar los valores clampeados para el slice de cada sección
```

### B3. 429 tratado como error no-retryable en Google Chat
**Archivo:** `src/modules/google-chat/adapter.ts` ~líneas 341-344

Problema: HTTP 429 (rate limit) incluido en `is4xx`, que impide reintentos.

**Fix:** Quitar `429` de la expresión `is4xx`. Si ya existe manejo de retry, dejar que 429 lo
active. Si no hay manejo de retry actualmente, al menos no bloquearlo:

```typescript
// ANTES:
const is4xx = errMsg.includes('400') || errMsg.includes('401')
  || errMsg.includes('403') || errMsg.includes('404')
  || errMsg.includes('409') || errMsg.includes('429')

// DESPUÉS:
const is4xx = errMsg.includes('400') || errMsg.includes('401')
  || errMsg.includes('403') || errMsg.includes('404')
  || errMsg.includes('409')
// 429 = rate limit → retryable, NO incluir aquí
```

### B4. `audio_segment` en MULTIMODAL_TYPES pero nunca asignado como contentType
**Archivo:** `src/modules/knowledge/embedding-queue.ts` ~línea 387

Problema: `MULTIMODAL_TYPES` incluye `'audio_segment'` pero `chunkAudio` en `smart-chunker.ts`
asigna `contentType: 'text'`. El valor `'audio_segment'` nunca existe en un chunk real,
el Set es dead code en ese punto.

**Fix opción A (preferida):** Quitar `'audio_segment'` de `MULTIMODAL_TYPES` ya que audio
chunks son texto puro (transcripciones). Los transcripts se embedden correctamente como text.

```typescript
const MULTIMODAL_TYPES = new Set(['pdf_pages', 'image', 'slide', 'video_frames'])
```

**Fix opción B (si se quiere file-embedding para audio):** Cambiar `chunkAudio` en
`smart-chunker.ts` para que use `contentType: 'audio_segment'` y agregar `'audio_segment'`
al tipo `ChunkContentType` en `embedding-limits.ts`.

→ Usar opción A salvo que haya requerimiento explícito de file-embedding para audio.

### B5. `parseInt` trunca rangos de página `"7-12"` → solo guarda `7`
**Archivo:** `src/modules/knowledge/pg-store.ts` ~línea 665

Problema: `parseInt("7-12")` retorna `7`. Se pierde el número de página final.

**Fix:** Parsear solo la primera parte del rango para el INT, ya que la columna `page` es INT:

```typescript
// ANTES:
chunk.metadata.pageRange ? parseInt(chunk.metadata.pageRange) || null : null

// DESPUÉS:
chunk.metadata.pageRange
  ? (parseInt(chunk.metadata.pageRange.split('-')[0]!, 10) || null)
  : null
```

Nota: si hay interés en preservar el rango completo, se puede agregar una columna
`page_range TEXT` en una migración futura. Por ahora esto es un fix pragmático.

### B6. jobId de dedup colisiona en re-enqueue de retries
**Archivo:** `src/modules/knowledge/embedding-queue.ts` — función `enqueue`

Problema: `enqueue` usa `jobId: embed-${source}-${chunkId}`. Si BullMQ aún tiene ese job
en su ventana `removeOnComplete: 200`, el nuevo job se ignora silenciosamente.

**Fix:** Cambiar `removeOnComplete` y `removeOnFail` a valores más agresivos para reducir la
ventana de colisión:

```typescript
defaultJobOptions: {
  removeOnComplete: true,  // eliminar inmediatamente al completar
  removeOnFail: { count: 20 },  // guardar solo los últimos 20 fallidos
}
```

Alternativamente, en `handleFailure` y en los casos de re-enqueue por CB/unavailability,
añadir un timestamp al jobId para evitar colisiones:

```typescript
jobId: `embed-retry-${source}-${chunkId}-${Date.now()}`
```

---

## GRUPO C — Seguridad

### C1. `query_attachment` sin scoping de sesión
**Archivo:** `src/engine/attachments/tools/query-attachment.ts` ~líneas 97-99

**Fix:** Agregar `AND session_id = $2` a la query y pasar el `sessionId` del contexto:

```typescript
const res = await db.query(
  'SELECT extracted_text, filename, category FROM attachment_extractions WHERE id = $1 AND session_id = $2',
  [attachmentId, ctx.session.id],  // ctx ya está disponible en el tool handler
)
```

Verificar que `ctx.session.id` esté disponible en el scope del handler (debería estarlo ya
que los tools reciben el contexto completo).

### C2. Path traversal en lectura de archivos multimodal
**Archivo:** `src/modules/knowledge/embedding-queue.ts` ~líneas 410-414

**Fix:** Validar que el path resuelto esté dentro de `knowledgeDir`:

```typescript
const knowledgeDir = resolve(process.cwd(), 'instance/knowledge/media')
const resolvedPath = resolve(knowledgeDir, firstMedia.filePath)

if (!resolvedPath.startsWith(knowledgeDir + '/')) {
  logger.error({ filePath: firstMedia.filePath }, '[EMBED-Q] Path traversal attempt blocked')
  throw new Error('Invalid media file path')
}

buffer = await readFile(resolvedPath)
```

### C3. `drive-read-file` sin scoping de sesión al persistir
**Archivo:** `src/modules/google-apps/tools.ts` — función `persistDriveReadResult`

Problema: el INSERT escribe `session_id = NULL`, dejando el contenido huérfano y potencialmente
accesible a otros contextos.

**Fix:** Pasar `sessionId` a `persistDriveReadResult` y usarlo en el INSERT:

```typescript
// En la firma:
async function persistDriveReadResult(
  db: Pool, fileId: string, filename: string,
  extractedText: string, llmText: string | null,
  sessionId: string,  // ← agregar
): Promise<void>

// En el INSERT, cambiar session_id = NULL por:
session_id = $N  // donde $N es el parámetro sessionId
```

Buscar dónde se llama `persistDriveReadResult` y pasarle el `session_id` del contexto del tool.

### C4. Límite de tamaño en descarga de adjuntos Google Chat
**Archivo:** `src/modules/google-chat/adapter.ts` — función `downloadAttachment`

Problema: descarga archivos completos en memoria sin verificar tamaño. `size: 0` del webhook
impide los checks downstream.

**Fix:** Leer el config del módulo para obtener el límite máximo y verificar el header
`Content-Length` antes de descargar:

```typescript
// En downloadAttachment, después de obtener el response del fetch:
const contentLength = response.headers.get('content-length')
const maxBytes = (cfg.GOOGLE_CHAT_MAX_ATTACHMENT_MB ?? 25) * 1024 * 1024

if (contentLength && parseInt(contentLength, 10) > maxBytes) {
  throw new Error(`Attachment too large: ${contentLength} bytes (max ${maxBytes})`)
}
```

Si `GOOGLE_CHAT_MAX_ATTACHMENT_MB` no existe en el configSchema del módulo, agregarlo:
```typescript
GOOGLE_CHAT_MAX_ATTACHMENT_MB: numEnv(25),
```

---

## GRUPO D — Inconsistencias de tipos y vocabulario

### D1. `EmbeddingStatus` no incluye `'queued'` ni `'embedded'`
**Archivo:** `src/modules/knowledge/types.ts`

**Fix:** Agregar los valores faltantes al union type:

```typescript
// ANTES:
export type EmbeddingStatus = 'pending' | 'processing' | 'done' | 'failed' | 'pending_review'

// DESPUÉS:
export type EmbeddingStatus = 'pending' | 'queued' | 'processing' | 'embedded' | 'done' | 'failed' | 'pending_review'
```

Nota: `'done'` se mantiene para backward compat con documentos; `'embedded'` es el nuevo
valor para chunks. Verificar que no haya código que compare `status === 'done'` esperando
encontrar chunks (solo documentos deberían tener `'done'`).

### D2. `KnowledgeChunk.extraMetadata` declara tipo incorrecto
**Archivo:** `src/modules/knowledge/types.ts`

Problema: la interfaz declara `extraMetadata: Record<string, unknown> | null` pero ahora
almacena un objeto `ChunkMetadata`.

**Fix:**
```typescript
import type { ChunkMetadata } from './embedding-limits.js'

// En KnowledgeChunk:
extraMetadata: ChunkMetadata | null
```

### D3. Semántica de `MEMORY_COMPRESSION_THRESHOLD` cambió sin documentar
**Archivo:** `src/modules/memory/manifest.ts` — configSchema

El parámetro pasó de "número de mensajes" a "número de turns". Actualizar la descripción
en el schema para que sea claro:

```typescript
MEMORY_COMPRESSION_THRESHOLD: numEnvMin(1, 20).describe(
  'Número de TURNS (ida+vuelta) antes de comprimir. Un turn = mensaje usuario + respuesta asistente.'
),
```

Agregar también una nota en el CLAUDE.md del módulo memory sobre el cambio.

---

## GRUPO E — Redundancias a eliminar

### E1. `persistChunksWithoutEmbeddings` duplica `persistChunks`
**Archivo:** `src/modules/memory/compression-worker.ts`

**Fix:** Eliminar `persistChunksWithoutEmbeddings` de `compression-worker.ts` y usar
`persistChunks` de `session-embedder.ts` (ya importada). Pasar chunks con
`hasEmbedding: false` y `embedding: null`.

Verificar que la función exportada `persistChunks` de `session-embedder.ts` sea importable
desde `compression-worker.ts` sin circular dependency.

### E2. `GOOGLE_NATIVE_MIMES` y `toolMap` creados dentro del handler
**Archivo:** `src/modules/google-apps/tools.ts` ~líneas 243-253

**Fix:** Mover ambas declaraciones a nivel de módulo (fuera de cualquier función):

```typescript
// Al inicio del archivo, después de los imports:
const GOOGLE_NATIVE_MIMES = new Set([
  'application/vnd.google-apps.document',
  'application/vnd.google-apps.spreadsheet',
  // ... todos los tipos
])

const OFFICE_EXPORT_MAP: Record<string, { exportMime: string; ext: string }> = {
  // ... el toolMap actual
}
```

### E3. Configuración BullMQ duplicada en dos archivos
**Archivos:** `src/modules/knowledge/embedding-queue.ts` y `src/modules/knowledge/vectorize-worker.ts`

**Fix:** Extraer `bullRedisOpts` a una función helper en el mismo directorio:

```typescript
// src/modules/knowledge/bull-redis-opts.ts
import type { ConnectionOptions } from 'bullmq'

export function getBullRedisOpts(redisUrl: string): ConnectionOptions {
  const url = new URL(redisUrl)
  return {
    host: url.hostname,
    port: parseInt(url.port, 10) || 6379,
    password: url.password || undefined,
  }
}
```

Importar desde ambos archivos.

### E4. Eliminar el worker legacy de vectorize (`knowledge-vectorize` queue)
**Archivo:** `src/modules/knowledge/vectorize-worker.ts`

La queue `knowledge-vectorize` delega todo a `embedding-unified`. Es una cadena innecesaria.

**Fix:**
1. Revisar si `vectorize-worker.ts` hace algo más allá de delegar a embedding-queue.
2. Si es pura delegación, eliminar el worker y la queue `knowledge-vectorize`.
3. Asegurarse de que `knowledge/manifest.ts` registre directamente el worker de
   `embedding-queue.ts` en lugar de `vectorize-worker.ts`.
4. Si hay jobs en la queue vieja en producción, agregar código de drenaje one-time.

**IMPORTANTE:** Verificar que ningún otro módulo encole en `knowledge-vectorize` antes de borrarlo.

### E5. Eliminar `cacheKey` de los tipos (siempre null)
**Archivo:** `src/engine/attachments/types.ts`

**Fix:** Eliminar `cacheKey` de las interfaces `ProcessedAttachment` y `UrlExtraction`.
Buscar todos los lugares donde se asigna `cacheKey: null` y eliminarlos.

---

## GRUPO F — Índice y migración faltante

### F1. Nueva migración `039_audit-cleanup.sql`

Crear `src/migrations/039_audit-cleanup.sql` con el siguiente contenido:

```sql
-- 039_audit-cleanup.sql
-- Limpieza post-auditoría: columnas obsoletas, índices duplicados, constraints faltantes

-- 1. Índice sobre metadata->>'fileId' en attachment_extractions
--    para queries de drive-capture.ts (línea ~74: AND metadata->>'fileId' = $2)
CREATE INDEX IF NOT EXISTS idx_ae_drive_file_id
  ON attachment_extractions ((metadata->>'fileId'))
  WHERE metadata->>'fileId' IS NOT NULL;

-- 2. Eliminar índices duplicados de knowledge_chunks
--    (migración 016 creó los full-scan; migración 037 creó los partial mejores)
DROP INDEX IF EXISTS idx_knowledge_chunks_source;
DROP INDEX IF EXISTS idx_knowledge_chunks_linking;

-- 3. Reemplazar el índice ivfflat de knowledge_chunks
--    El viejo filtraba por has_embedding; el nuevo debe filtrar por embedding_status
DROP INDEX IF EXISTS idx_knowledge_chunks_embedding;
CREATE INDEX IF NOT EXISTS idx_knowledge_chunks_embedding_v2
  ON knowledge_chunks USING ivfflat (embedding vector_cosine_ops)
  WHERE embedding_status = 'embedded';

-- 4. CHECK constraint en embedding_status para knowledge_chunks
ALTER TABLE knowledge_chunks
  ADD CONSTRAINT IF NOT EXISTS chk_kc_embedding_status
  CHECK (embedding_status IN ('pending', 'queued', 'processing', 'embedded', 'done', 'failed', 'pending_review'));

-- 5. CHECK constraint en embedding_status para session_memory_chunks
ALTER TABLE session_memory_chunks
  ADD CONSTRAINT IF NOT EXISTS chk_smc_embedding_status
  CHECK (embedding_status IN ('pending', 'queued', 'processing', 'embedded', 'done', 'failed', 'pending_review'));

-- 6. Eliminar columna has_embedding de session_memory_chunks
--    (reemplazada por embedding_status; el código ya no debe escribirla después del fix A3)
ALTER TABLE session_memory_chunks
  DROP COLUMN IF EXISTS has_embedding;

-- 7. Eliminar columna has_embedding de knowledge_chunks
ALTER TABLE knowledge_chunks
  DROP COLUMN IF EXISTS has_embedding;
```

**IMPORTANTE sobre el DROP de `has_embedding`:** Antes de incluir los steps 6 y 7, verificar
que NO quede ningún INSERT/UPDATE/SELECT que referencie `has_embedding` en el código TypeScript
tras aplicar los otros fixes. Si quedan referencias, eliminarlas primero.

### F2. Paginación en `recoverPending`
**Archivo:** `src/modules/knowledge/embedding-queue.ts` — función `recoverPending`

**Fix:** Cambiar el LIMIT 500 por un loop:

```typescript
async recoverPending(): Promise<void> {
  let recovered = 0
  let batch: Array<{ id: string; source: EmbedSource }> = []

  do {
    const result = await this.db.query<{ id: string; source: EmbedSource }>(
      `SELECT id, source FROM /* ... la query actual ... */
       ORDER BY created_at
       LIMIT 500`
    )
    batch = result.rows
    for (const row of batch) {
      await this.enqueue({ chunkId: row.id, source: row.source })
      recovered++
    }
  } while (batch.length === 500)

  logger.info({ recovered }, '[EMBED-Q] Recovery complete')
}
```

### F3. Reconciliación de estado para chunks de memory
**Archivo:** `src/modules/knowledge/embedding-queue.ts` — función `reconcileDocumentStatus`
(o equivalente)

Problema: `reconcileDocumentStatus` solo actualiza el estado de documentos de knowledge.
Para `source === 'memory'`, nunca se actualiza el estado de la sesión.

**Fix:** Añadir un branch para `memory`:

```typescript
if (source === 'memory') {
  // Para memory, marcar la sesión como lista si todos sus chunks están embebidos
  await this.db.query(`
    UPDATE sessions
    SET embedding_status = 'done'
    WHERE id = (
      SELECT session_id FROM session_memory_chunks WHERE id = $1
    )
    AND NOT EXISTS (
      SELECT 1 FROM session_memory_chunks
      WHERE session_id = (SELECT session_id FROM session_memory_chunks WHERE id = $1)
        AND embedding_status != 'embedded'
    )
  `, [chunkId])
}
```

Ajustar según el schema real de `sessions` si no tiene `embedding_status`.

---

## GRUPO G — Limpieza de código muerto

### G1. Eliminar métodos obsoletos message-based del memory manager
**Archivos:** `src/modules/memory/memory-manager.ts` y `src/modules/memory/redis-buffer.ts`

Verificar si `getOldestMessages` y `trimOldestMessages` ya no se usan (la compresión ahora
es turn-based). Si no tienen ninguna referencia externa:
1. Eliminarlos de `memory-manager.ts`
2. Eliminarlos de `redis-buffer.ts`

Búsqueda en el codebase antes de eliminar:
```bash
grep -r "getOldestMessages\|trimOldestMessages" src/
```

---

## NOTAS DE IMPLEMENTACIÓN

1. **Compilar TS antes de cada commit:** `docker run --rm -v /docker/luna-repo:/app -w /app node:22-alpine npx tsc --noEmit`
2. **Orden recomendado:** A → D → B → C → E → F → G
   - Empezar por tipos (D) facilita que el compilador guíe los otros cambios
   - Los bugs críticos (A) son independientes y se pueden hacer en paralelo con D
3. **Migration 039:** Solo incluir DROP COLUMN de `has_embedding` si el TS compila limpio sin
   ninguna referencia a esa columna.
4. **Vectorize worker (E4):** Hacer en último lugar, después de verificar que embedding-queue
   funciona end-to-end.

---

## Items descartados (no cambiar)

- **#20:** `EmbeddingService` definida en 3 sitios con métodos distintos → diseño intencional, no tocar
- **#33:** `enrichDriveContent` mezcla fetch + LLM → complejidad aceptada, documentar en CLAUDE.md pero no refactorizar ahora
