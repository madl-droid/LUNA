# INFORME DE CIERRE — Track C: Infraestructura
## Branch: claude/execute-track-c-dFeVF

### Objetivos definidos
1. WP-INFRA: Agregar LibreOffice al Dockerfile para conversión DOCX/PPTX→PDF
2. WP-INFRA: Crear helper `src/extractors/convert-to-pdf.ts`
3. WP10: Binary lifecycle management — tracking y limpieza de binarios de attachments

### Completado ✅

**WP-INFRA: Dockerfile**
- Línea 12: `apk add --no-cache ffmpeg` → `apk add --no-cache ffmpeg libreoffice-writer libreoffice-impress libreoffice-calc`
- Se usaron los sub-paquetes (`-writer`, `-impress`, `-calc`) en vez del paquete monolítico `libreoffice` para minimizar tamaño de imagen (~100MB vs ~200MB)

**WP-INFRA: `src/extractors/convert-to-pdf.ts`** (nuevo)
- `convertToPdf(input: Buffer, fileName: string): Promise<Buffer | null>` — usa LibreOffice headless, tmpdir aislado por UUID, cleanup automático
- `isLibreOfficeAvailable(): Promise<boolean>` — verificación de disponibilidad
- Timeout: 120s, maxBuffer: 10MB

**WP10: `src/modules/knowledge/types.ts`**
- Agregado `'attachment'` a `DocumentSourceType` (era `'upload' | 'drive' | 'url' | 'web'`)

**WP10: `src/migrations/041_binary-lifecycle.sql`** (nuevo)
- `ALTER TABLE knowledge_documents ADD COLUMN IF NOT EXISTS binary_cleanup_ready BOOLEAN NOT NULL DEFAULT FALSE`
- `CREATE INDEX IF NOT EXISTS idx_kd_binary_cleanup ON knowledge_documents (binary_cleanup_ready) WHERE binary_cleanup_ready = TRUE`

**WP10: `src/modules/knowledge/pg-store.ts`**
- `markBinariesForCleanup(documentId)` — establece `binary_cleanup_ready = TRUE` solo si `source_type = 'attachment'`
- `getDocumentsForBinaryCleanup()` — retorna documentos con `binary_cleanup_ready = TRUE` y sus `filePaths` de chunks via `jsonb_array_elements`
- `clearBinaryCleanupFlag(documentId)` — limpia el flag después de borrar los archivos

**WP10: `src/modules/knowledge/embedding-queue.ts`**
- Import agregado: `unlink` (node:fs/promises), `resolve` (node:path)
- `reconcileDocumentStatus()`: ahora también lee `source_type` del documento; si es `'attachment'`, setea `binary_cleanup_ready = TRUE` al completar todos los chunks
- `runNightlyBinaryCleanup()`: nuevo método público — escanea documentos con `binary_cleanup_ready = TRUE`, borra archivos de `instance/knowledge/media/` con path traversal guard, limpia el flag solo si todos los archivos se eliminaron exitosamente. Retorna `{ cleaned, errors }`.

### No completado ❌
- Ninguno. El plan de Track C se completó íntegramente.

### Archivos creados/modificados
| Archivo | Acción |
|---------|--------|
| `Dockerfile` | Modificado — LibreOffice |
| `src/extractors/convert-to-pdf.ts` | Creado |
| `src/migrations/041_binary-lifecycle.sql` | Creado |
| `src/modules/knowledge/types.ts` | Modificado — nuevo valor en DocumentSourceType |
| `src/modules/knowledge/pg-store.ts` | Modificado — 3 métodos nuevos |
| `src/modules/knowledge/embedding-queue.ts` | Modificado — reconcile + nightly cleanup |

### Interfaces expuestas (exports que otros consumen)
- `convertToPdf(input: Buffer, fileName: string): Promise<Buffer | null>` — Track D lo usará para DOCX→PDF y PPTX→PDF
- `isLibreOfficeAvailable(): Promise<boolean>` — Track D puede verificar disponibilidad antes de intentar conversión
- `EmbeddingQueue.runNightlyBinaryCleanup(): Promise<{ cleaned: number; errors: number }>` — el módulo `scheduled-tasks` debe llamarlo nocturnamente

### Dependencias instaladas
- Ninguna nueva dependencia npm. LibreOffice se instala en runtime vía Alpine apk.

### Tests
- No hay tests unitarios para estos componentes. La compilación TypeScript pasa sin errores (`tsc --noEmit` limpio).

### Decisiones técnicas
1. **Sub-paquetes LibreOffice vs monolítico**: Se usa `libreoffice-writer libreoffice-impress libreoffice-calc` en lugar de `libreoffice` para reducir el tamaño de imagen (~100MB ahorro aprox).
2. **Path traversal guard en `runNightlyBinaryCleanup`**: Solo borra archivos dentro de `instance/knowledge/media/`. Archivos fuera de ese directorio se loguean y se saltan.
3. **Clear flag condicional**: `binary_cleanup_ready` solo se borra si TODOS los archivos del documento se eliminaron exitosamente. Si alguno falla, el documento queda marcado para reintento.
4. **Inline SQL en embedding-queue**: Los nuevos queries de cleanup usan `this.db` directamente (consistente con el resto del archivo) para evitar acoplamiento con `pg-store`.

### Riesgos o deuda técnica
- `runNightlyBinaryCleanup()` debe conectarse a un scheduler en `scheduled-tasks` o al cron del módulo knowledge. Actualmente está implementado pero no wired a ningún trigger — esto es trabajo de Track D/E.
- La conversión DOCX/PPTX en `convert-to-pdf.ts` usa un tmpdir por UUID pero **no limpia el directorio** (solo los dos archivos individuales). Si la conversión produce archivos adicionales, pueden quedar residuos en `/tmp`.

### Notas para integración
- **Track D** (Unification) importará `convertToPdf` desde `../../extractors/convert-to-pdf.js` para el extractor DOCX con imágenes y PPTX local.
- **Track D** debe wiring de `runNightlyBinaryCleanup()` al scheduler de tareas nocturnas.
- La migración `041_binary-lifecycle.sql` se aplica automáticamente en el siguiente arranque del servidor.
