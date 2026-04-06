# Track C: Infraestructura — Dockerfile + Binary Lifecycle

## Archivos a modificar
- `Dockerfile` (agregar LibreOffice)
- `src/modules/knowledge/embedding-queue.ts` (binary lifecycle)
- `src/modules/knowledge/knowledge-manager.ts` (guardar binarios por chunk)
- `src/modules/knowledge/pg-store.ts` (tracking de binary paths)

## Prerrequisitos
- Ninguno. Puede ejecutarse en paralelo con Track A y B.

## Orden de ejecución
1. WP-INFRA: LibreOffice en Dockerfile
2. WP10: Binary lifecycle management

---

## WP-INFRA: LibreOffice en Dockerfile

### Cambio en `Dockerfile`

Línea 12, después de `ffmpeg`:
```dockerfile
# ANTES:
RUN apk add --no-cache ffmpeg

# DESPUÉS:
RUN apk add --no-cache ffmpeg libreoffice
```

NOTA: `libreoffice` en Alpine es pesado (~200MB). Si esto es un problema para el tamaño de la imagen, hay alternativas:
- `libreoffice-writer libreoffice-calc libreoffice-impress` (solo los componentes necesarios, más liviano)
- La versión mínima en Alpine: `apk add --no-cache ffmpeg libreoffice-writer libreoffice-impress libreoffice-calc`

### Verificar que funciona
```bash
docker build -t luna-test .
docker run --rm luna-test libreoffice --version
# Debe retornar algo como: LibreOffice 24.x.x...
```

### Uso esperado
```bash
# Convertir DOCX a PDF
libreoffice --headless --convert-to pdf --outdir /tmp input.docx

# Convertir PPTX a PDF
libreoffice --headless --convert-to pdf --outdir /tmp input.pptx
```

### Helper de conversión: nuevo `src/extractors/convert-to-pdf.ts`

```typescript
// LUNA — Extractors — Document to PDF Converter
// Convierte DOCX/PPTX a PDF usando LibreOffice headless.
// Usado por: DOCX con imágenes, PPTX local (no de Drive).

import { execFile } from 'node:child_process'
import { writeFile, readFile, unlink, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import pino from 'pino'

const logger = pino({ name: 'extractors:convert-pdf' })

/**
 * Convierte un documento (DOCX, PPTX, etc.) a PDF usando LibreOffice headless.
 * Retorna el PDF como Buffer, o null si la conversión falla.
 *
 * IMPORTANTE: LibreOffice debe estar instalado en el container.
 * En Alpine: apk add --no-cache libreoffice-writer libreoffice-impress
 */
export async function convertToPdf(
  input: Buffer,
  fileName: string,
): Promise<Buffer | null> {
  const tmpDir = join(tmpdir(), `luna-lopdf-${randomUUID()}`)
  await mkdir(tmpDir, { recursive: true })

  const inputPath = join(tmpDir, fileName)
  const expectedPdfName = fileName.replace(/\.[^.]+$/, '.pdf')
  const outputPath = join(tmpDir, expectedPdfName)

  try {
    await writeFile(inputPath, input)

    await new Promise<void>((resolve, reject) => {
      execFile(
        'libreoffice',
        ['--headless', '--convert-to', 'pdf', '--outdir', tmpDir, inputPath],
        { timeout: 120_000, maxBuffer: 10 * 1024 * 1024 },
        (err) => {
          if (err) reject(err)
          else resolve()
        },
      )
    })

    const pdfBuffer = await readFile(outputPath)
    logger.info({ fileName, pdfSize: pdfBuffer.length }, 'Converted to PDF')
    return pdfBuffer
  } catch (err) {
    logger.warn({ err, fileName }, 'LibreOffice PDF conversion failed')
    return null
  } finally {
    // Cleanup
    await Promise.all([
      unlink(inputPath).catch(() => {}),
      unlink(outputPath).catch(() => {}),
    ])
  }
}

/**
 * Verifica si LibreOffice está disponible en el sistema.
 */
export async function isLibreOfficeAvailable(): Promise<boolean> {
  try {
    await new Promise<void>((resolve, reject) => {
      execFile('libreoffice', ['--version'], { timeout: 10_000 }, (err) => {
        if (err) reject(err)
        else resolve()
      })
    })
    return true
  } catch {
    return false
  }
}
```

---

## WP10: Binary Lifecycle Management

### Regla universal v2
- **Binarios SIEMPRE se guardan chunkeados** (tanto knowledge como attachment)
- El embedding multimodal necesita chunk + su binario correspondiente
- La diferencia entre knowledge y attachment es solo la VIDA del binario

### Lifecycle por source
- **Knowledge**: binario vive mientras el documento de KB exista. Se borra cuando el usuario lo elimina.
- **Attachment**: binario vive hasta que TODOS los chunks del documento estén en estado terminal (embedded o max-retry-failed). Nightly batch limpia.
- **Video attachment**: EXCEPCIÓN — NO se guarda binario (muy pesado para algo temporal). Solo knowledge guarda video.

### Problema actual
- Los binarios se guardan completos en `instance/knowledge/media/`
- No hay tracking de cuándo es seguro borrarlos
- El reconciler de documentos marca `embedding_status = 'embedded'` cuando todos los chunks terminan, pero no gestiona binarios

### Cambios en `src/modules/knowledge/knowledge-manager.ts`

#### Para Knowledge: guardar binario por chunk

Cuando se procesa un documento para knowledge y se crean chunks con `mediaRefs`:

```typescript
// Después de splitMediaFile() o chunkPdf()
// Cada chunk que tiene mediaRefs.filePath apunta a su segmento
// Para PDFs: extraer las páginas correspondientes al chunk como PDF parcial
// Para audio/video: los segmentos ya están creados por temporal-splitter

// Guardar segmentos en instance/knowledge/media/ con nombre que incluya chunk info
const mediaDir = 'instance/knowledge/media'

for (const chunk of linkedChunks) {
  if (!chunk.mediaRefs) continue

  for (const ref of chunk.mediaRefs) {
    if (ref.filePath && ref.filePath.startsWith('/tmp/')) {
      // Mover de /tmp/ a media dir con nombre persistente
      const ext = ref.filePath.split('.').pop() ?? 'bin'
      const persistName = `${chunk.sourceId}_chunk${chunk.chunkIndex}.${ext}`
      const persistPath = join(mediaDir, persistName)

      await copyFile(ref.filePath, persistPath)
      ref.filePath = persistPath  // Actualizar referencia
    }

    // Agregar metadata de rutas
    chunk.metadata.localBinaryPath = ref.filePath
    chunk.metadata.remoteBinaryUrl = opts?.sourceUrl  // URL de origen si existe
  }
}
```

#### Para Attachments: TAMBIÉN guardar chunkeado

Los attachments se guardan chunkeados igual que knowledge. El embedding multimodal necesita
chunk + binario independientemente del source. La única diferencia es la vida del archivo.

Mismo código que knowledge para guardar:
```typescript
// Attachments: mismo flujo de guardado que knowledge
// Mover segmentos de /tmp/ a instance/knowledge/media/
// Cada chunk tiene su propio archivo referenciado en mediaRefs
```

EXCEPCIÓN: **video attachments NO guardan binario** (muy pesado para algo temporal).
El video se procesa en memoria, se extrae descripción+transcripción, y se descarta.

#### Lifecycle: marcar para cleanup

En `embedding-queue.ts`, modificar `reconcileDocumentStatus()`:

```typescript
// ANTES: solo actualiza embedding_status del documento
// DESPUÉS: también gestiona cleanup de binarios para attachments

async reconcileDocumentStatus(documentId: string): Promise<void> {
  const stats = await this.pgStore.getChunkEmbeddingStats(documentId)

  const allTerminal = stats.total === stats.embedded + stats.maxRetryFailed

  if (allTerminal) {
    const newStatus = stats.maxRetryFailed > 0 ? 'failed' : 'embedded'
    await this.pgStore.updateDocumentEmbeddingStatus(documentId, newStatus)

    // Binary cleanup para attachments (no knowledge)
    const doc = await this.pgStore.getDocument(documentId)
    if (doc?.source === 'attachment') {
      // Ahora es seguro marcar binarios chunkeados para limpieza
      await this.pgStore.markBinariesForCleanup(documentId)
      logger.info({ documentId }, 'Attachment binaries marked for cleanup after full embedding')
    }
  }
}
```

#### Tracking en DB

Agregar columna a `knowledge_documents` (nueva migración):

```sql
-- src/migrations/0XX_binary-lifecycle.sql

ALTER TABLE knowledge_documents
  ADD COLUMN IF NOT EXISTS binary_cleanup_ready BOOLEAN NOT NULL DEFAULT FALSE;

-- Index para nightly cleanup query
CREATE INDEX IF NOT EXISTS idx_kd_binary_cleanup
  ON knowledge_documents (binary_cleanup_ready)
  WHERE binary_cleanup_ready = TRUE;
```

#### Nightly cleanup

En el batch nocturno, agregar paso de limpieza de binarios:
```typescript
// Solo para attachments con binary_cleanup_ready = TRUE
// Leer los mediaRefs de todos los chunks del documento
// Eliminar los archivos de instance/knowledge/media/
// Marcar binary_cleanup_ready = FALSE (o eliminar el doc si ya no se necesita)
```

### IMPORTANTE: No borrar binarios de Knowledge

Los binarios de knowledge se mantienen indefinidamente porque:
1. El usuario puede re-embeder si cambia el modelo
2. El documento puede necesitar re-procesamiento
3. Solo se borran cuando el usuario elimina el documento de knowledge

---

## Compilación y verificación

```bash
# Verificar Dockerfile
docker build -t luna-test .
docker run --rm luna-test libreoffice --version
docker run --rm luna-test ffmpeg -version

# Verificar TypeScript
docker run --rm -v /docker/luna-repo:/app -w /app node:22-alpine npx tsc --noEmit
```

## Commit messages sugeridos

```
chore(docker): add LibreOffice for DOCX/PPTX to PDF conversion

feat(extractors): add convert-to-pdf helper using LibreOffice headless

feat(knowledge): binary lifecycle management for chunks
- Knowledge: persist binaries per chunk with local path + remote URL
- Attachments: don't delete binaries until all chunks are embedded
- Add binary_cleanup_ready tracking column
- Nightly batch cleanup for attachment binaries
```
