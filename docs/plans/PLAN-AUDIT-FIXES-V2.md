# PLAN — Audit Fixes V2 + Pendientes Post-Integración

## Contexto

Plan consolidado de:
1. **14 hallazgos** de Auditoría II (`docs/reports/audit-extractors-architecture-v2.md`)
2. **3 pendientes** del pre-cierre de la sesión de planificación

Organizado por prioridad. Cada fix incluye archivo, línea, qué cambiar, y verificación.

---

## PRIORIDAD CRITICA — Rompe build

### FIX-1: `extractImageWithVision` eliminada pero importada en knowledge-manager (BUG-N1)

**Archivo:** `src/modules/knowledge/knowledge-manager.ts:222`

**Problema:** `extractImageWithVision` fue eliminada de `image.ts` (FIX-3 de auditoría I) pero knowledge-manager.ts aún la importa → `tsc` falla.

**Cambio:**

```typescript
// ANTES (línea ~221-223):
const { extractImageWithVision } = await import('../../extractors/image.js')
const result = await extractImageWithVision(buffer, fileName, mimeType, this.registry)
const description = result.llmEnrichment?.description || null

// DESPUÉS:
const { extractImage, describeImage } = await import('../../extractors/image.js')
const imageResult = await extractImage(buffer, fileName, mimeType)
const enriched = await describeImage(imageResult, this.registry)
const description = enriched.llmEnrichment?.description || null
```

**Verificación:** `tsc --noEmit` pasa sin error en esa línea.

---

### FIX-2: `yt-dlp` falta en Dockerfile (DT-N4)

**Archivo:** `Dockerfile` (o `deploy/Dockerfile`)

**Problema:** `youtube-adapter.ts` llama `execFile('yt-dlp', ...)` pero el binario no está en la imagen Docker. Toda funcionalidad de descarga YouTube falla silenciosamente en producción.

**Cambio:**

```dockerfile
# Buscar la línea de apk add que tiene ffmpeg y libreoffice
# Agregar yt-dlp al final
RUN apk add --no-cache ffmpeg libreoffice-writer libreoffice-impress libreoffice-calc yt-dlp
```

**Nota:** Si `yt-dlp` no está en los repos de Alpine, usar pip:
```dockerfile
RUN apk add --no-cache python3 py3-pip && pip3 install --break-system-packages yt-dlp
```

**Verificación:** `docker run --rm luna-app yt-dlp --version`

---

## PRIORIDAD ALTA

### FIX-3: `hasFileChanged()` default incorrecto (BUG-N2)

**Archivo:** `src/modules/knowledge/item-manager.ts` (~línea 1800)

**Problema:** Retorna `false` cuando no hay hash ni modifiedTime. Google Workspace files (Sheets, Docs, Slides) no tienen md5Checksum. Si modifiedTime tampoco está, el sync ignora cambios silenciosamente.

**Cambio:**

```typescript
// ANTES:
return false  // Asume sin cambios si no hay data comparable

// DESPUÉS:
return true   // Sin data para comparar → asumir que cambió (re-procesar es seguro)
```

**Verificación:** Revisar que sync de carpetas con Google Docs/Sheets re-procese correctamente.

---

### FIX-4: Video/audio routing en Drive (PENDIENTE PRE-CIERRE)

**Archivo:** `src/modules/knowledge/item-manager.ts` — `loadDriveFile()`

**Problema:** `loadDriveFile()` no rutea `video/*` ni `audio/*` a `routeVideo()`/`routeAudio()`. Videos y audios de Drive se descargan pero solo se procesan como texto genérico, sin temporal split, sin STT, sin embedding multimodal.

**Cambio:** Agregar branches de MIME type en `loadDriveFile()`:

```typescript
// Después de los branches existentes (PDF, DOCX, PPTX, image/*)...

// Audio routing
if (mimeType.startsWith('audio/')) {
  const chunks = await this.knowledgeManager.routeAudio(buffer, file.name, mimeType, hashPrefix, mediaDir)
  totalChunks += await this.persistSmartChunks(item, file.name, mimeType, chunks, {
    description: `Audio from Drive: ${file.name}`,
    fileUrl: file.webViewLink,
  })
  return totalChunks
}

// Video routing
if (mimeType.startsWith('video/')) {
  const chunks = await this.knowledgeManager.routeVideo(buffer, file.name, mimeType, hashPrefix, mediaDir)
  totalChunks += await this.persistSmartChunks(item, file.name, mimeType, chunks, {
    description: `Video from Drive: ${file.name}`,
    fileUrl: file.webViewLink,
  })
  return totalChunks
}
```

**Nota:** `routeAudio()` y `routeVideo()` son `private` en knowledge-manager.ts. Opciones:
- Hacerlos `public` (preferido — item-manager ya es un consumer legítimo)
- O mover la lógica de routing al item-manager con imports directos de extractores

**Verificación:** Subir un video mp4 y un audio mp3 a una carpeta de Drive indexada en knowledge. Verificar que se crean chunks con `contentType: 'video_frames'` / `'audio'` y mediaRefs con paths de segmentos.

---

### FIX-5: fallbackSTT sin límite de duración (BUG-N3)

**Archivo:** `src/engine/attachments/youtube-handler.ts` y `src/extractors/youtube-adapter.ts`

**Problema:** Si un video no tiene transcript, el STT fallback descarga el audio completo. Para un video de 3 horas = ~200MB de audio → envío a Gemini. Sin guard.

**Cambio en youtube-handler.ts:**

```typescript
// Antes de llamar getTranscript con fallbackSTT
const MAX_STT_DURATION_SECONDS = 30 * 60  // 30 minutos max para STT

const transcriptResult = await getTranscript(videoId, registry, {
  fallbackSTT: (meta.duration ?? 0) <= MAX_STT_DURATION_SECONDS,
})
```

**Cambio en youtube-adapter.ts `getTranscript()`:** Agregar guard adicional:

```typescript
// Al inicio de la rama de fallback STT
if (opts?.maxDurationSeconds && durationSeconds > opts.maxDurationSeconds) {
  logger.warn({ videoId, duration: durationSeconds }, '[YT] Video too long for STT fallback')
  return null
}
```

**Constante:** `MAX_STT_DURATION_SECONDS = 1800` (30 min). Videos más largos sin transcript simplemente no tendrán contenido textual.

**Verificación:** Testear con un video >30min sin subtítulos — debe retornar null sin descargar audio.

---

### FIX-6: SSRF via redirect en url-extractor (SEC-1)

**Archivo:** `src/engine/attachments/url-extractor.ts:196`

**Problema:** `fetch(url, { redirect: 'follow' })` sigue redirects automáticamente. Si un dominio autorizado redirige a IP interna, el SSRF guard se bypasea.

**Cambio:**

```typescript
// ANTES:
const response = await fetch(url, { redirect: 'follow', ... })

// DESPUÉS:
const response = await fetch(url, { redirect: 'manual', ... })

// Si es redirect, validar destino
if (response.status >= 300 && response.status < 400) {
  const location = response.headers.get('location')
  if (location) {
    const redirectUrl = new URL(location, url)
    // Validar que no es IP interna
    if (isInternalUrl(redirectUrl.hostname)) {
      logger.warn({ url, redirect: location }, 'SSRF: redirect to internal IP blocked')
      return null
    }
    // Seguir redirect manualmente (max 3)
    return fetchWithRedirectGuard(redirectUrl.toString(), depth + 1)
  }
}
```

**Helper `isInternalUrl()`:**

```typescript
function isInternalUrl(hostname: string): boolean {
  return /^(127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|169\.254\.|0\.|localhost|::1|\[::1\])/.test(hostname)
}
```

**Verificación:** Test con URL que redirige a 127.0.0.1 — debe ser bloqueada.

---

## PRIORIDAD MEDIA

### FIX-7: Sin límite de tamaño en descarga yt-dlp (SEC-3)

**Archivo:** `src/extractors/youtube-adapter.ts` — `downloadVideo()`

**Problema:** Sin `--max-filesize`, un video 4K largo podría descargar >5GB.

**Cambio:** Agregar flag a yt-dlp:

```typescript
const args = [
  '-f', 'bestvideo[height<=720]+bestaudio/best[height<=720]',
  '--max-filesize', '500m',   // NUEVO: máximo 500MB
  '-o', outputPath,
  `https://youtube.com/watch?v=${videoId}`,
]
```

**Verificación:** Intentar descargar un video que exceda 500MB — debe fallar con error de yt-dlp.

---

### FIX-8: `mediaDir` hardcodeado en 5+ lugares (DT-N1)

**Archivo:** Múltiples

**Problema:** `resolve(process.cwd(), 'instance/knowledge/media')` repetido en knowledge-manager.ts, embedding-queue.ts, item-manager.ts.

**Cambio:** Crear constante en el módulo knowledge:

```typescript
// src/modules/knowledge/constants.ts (nuevo)
import { resolve } from 'node:path'

export const KNOWLEDGE_MEDIA_DIR = resolve(process.cwd(), 'instance/knowledge/media')
```

Reemplazar todas las instancias por `import { KNOWLEDGE_MEDIA_DIR } from './constants.js'`.

**Archivos a modificar:**
- `src/modules/knowledge/knowledge-manager.ts` (~2 instancias)
- `src/modules/knowledge/embedding-queue.ts` (~1 instancia)
- `src/modules/knowledge/item-manager.ts` (~5+ instancias)

**Verificación:** `grep -r "instance/knowledge/media" src/modules/knowledge/` solo devuelve `constants.ts`.

---

### FIX-9: `isLibreOfficeAvailable()` sin cache (DT-N5, carry-over)

**Archivo:** `src/extractors/convert-to-pdf.ts`

**Problema:** Cada llamada ejecuta `libreoffice --version` como proceso hijo. En un crawl de carpeta con 50 DOCX, esto son 50 procesos innecesarios.

**Cambio:**

```typescript
let _libreOfficeAvailable: boolean | null = null

export async function isLibreOfficeAvailable(): Promise<boolean> {
  if (_libreOfficeAvailable !== null) return _libreOfficeAvailable
  try {
    await execFileAsync('libreoffice', ['--version'])
    _libreOfficeAvailable = true
  } catch {
    _libreOfficeAvailable = false
  }
  return _libreOfficeAvailable
}
```

**Verificación:** Llamar 3 veces, verificar en logs que solo 1 ejecución de `libreoffice --version`.

---

### FIX-10: Tests temporal-split 60/60/10 (PENDIENTE PRE-CIERRE)

**Archivo:** `tests/extractors/temporal-split.test.ts`

**Problema:** Tests de Track E usan AUDIO_SPLIT_CONFIG con `subsequentSeconds: 70` (viejo). Debe ser `60`.

**Cambio:** Actualizar assertions que validan segmentos de audio para esperar chunks de 60s (no 70s). Buscar tests que referencien `AUDIO_SPLIT_CONFIG` y validar que `subsequentSeconds` sea 60.

**Verificación:** `npm test -- temporal-split` pasa.

---

### FIX-11: Tests YouTube (PENDIENTE PRE-CIERRE)

**Archivos nuevos:**
- `tests/extractors/youtube-adapter.test.ts`
- `tests/extractors/youtube-attachment.test.ts`
- `tests/knowledge/youtube-knowledge.test.ts`

**Cobertura mínima requerida:**

**youtube-adapter.test.ts:**
- `parseYouTubeUrl()` — watch, shorts, youtu.be, embed, playlist, channel, handle, inválido
- `parseDuration()` — PT4M33S, PT1H2M, PT30S, string vacío
- `getVideoMeta()` — mock fetch → validar campos mapeados
- `getTranscript()` — mock youtube-transcript OK, mock fallo + fallback STT, mock ambos fallan

**youtube-attachment.test.ts:**
- `processYouTubeAttachment()` — video con transcript y chapters, video sin transcript (STT fallback mock), video sin nada

**youtube-knowledge.test.ts:**
- `loadYoutubeVideo()` — mock adapter → verificar chunks video_frames con transcriptSegments
- `loadYoutubePlaylist()` — mock listPlaylistVideos → verificar header + transcript + 60s preview
- `loadYoutubeChannel()` — mock getChannelMeta → verificar solo chunks texto

**Verificación:** `npm test -- youtube` pasa.

---

## PRIORIDAD BAJA

### FIX-12: Playlist trunca sin warning (BUG-N4)

**Archivo:** `src/extractors/youtube-adapter.ts` — `listPlaylistVideos()`

**Cambio:** Retornar metadata adicional o log warning:

```typescript
if (nextPageToken && pages >= 5) {
  logger.warn({ playlistId, videoCount: videos.length }, '[YT] Playlist truncated at 250 videos')
}
```

---

### FIX-13: CLAUDE.md knowledge desactualizado (BUG-N5)

**Archivo:** `src/modules/knowledge/CLAUDE.md`

**Cambio:** Actualizar línea que dice "5min segments con 30s overlap" a "60s/60s/10s (AUDIO_SPLIT_CONFIG via calculateSegments)".

También agregar documentación de:
- YouTube adapter y los 5 escenarios
- Drive folder crawl, index, sync incremental
- `routeVideo()` ahora acepta transcript

---

### FIX-14: Dynamic import en loop (DT-N2)

**Archivo:** `src/modules/knowledge/item-manager.ts:331`

**Cambio:**

```typescript
// ANTES: import dentro del for loop
for (const doc of docs.rows) {
  if (doc.file_path) {
    const { unlink } = await import('node:fs/promises')
    await unlink(...)
  }
}

// DESPUÉS: import fuera del loop
const { unlink } = await import('node:fs/promises')
for (const doc of docs.rows) {
  if (doc.file_path) {
    await unlink(...)
  }
}
```

---

### FIX-15: SQL fallback inline es código muerto (DT-N3)

**Archivo:** `src/modules/knowledge/embedding-queue.ts` — `runNightlyBinaryCleanup()`

**Cambio:** Eliminar el branch de fallback SQL inline (~20 líneas). `pgStore` siempre se inyecta desde manifest.ts. Si por alguna razón no se inyecta, el cleanup simplemente no corre (log warning).

```typescript
// ANTES:
if (this.pgStore) {
  // ... usar pgStore
} else {
  // ... 20 lineas de SQL inline (dead code)
}

// DESPUÉS:
if (!this.pgStore) {
  logger.warn('pgStore not injected, skipping nightly binary cleanup')
  return
}
// ... usar pgStore
```

---

### FIX-16: csvBuffer de sheets sin persistir (GAP-2, carry-over)

**Archivo:** `src/modules/knowledge/knowledge-manager.ts` — rama de Sheets en addDocument()

**Problema:** `extractSheets()` genera `csvBuffer` pero no se escribe a disco. Para embedding multimodal de sheets no es necesario (son tabulares), pero si se quisiera compartir el CSV como link, no hay binario.

**Decisión:** Documentar como "by design" — sheets se chunkean como texto, no necesitan binario. Agregar comentario:

```typescript
// csvBuffer no se persiste: sheets se indexan como texto, no requieren binario para embedding
```

---

### FIX-17: API key YouTube en query string (SEC-2)

**Acción:** No requiere cambio de código (limitación de la YouTube Data API). Documentar en CLAUDE.md del knowledge module:

```
## Seguridad: YouTube API Key
La key va en query string (limitación de YouTube Data API v3).
La key DEBE tener restricciones de IP en Google Cloud Console.
```

---

## Orden de ejecución

```
CRITICO (bloqueantes):
  FIX-1  extractImageWithVision → extractImage + describeImage
  FIX-2  yt-dlp en Dockerfile

ALTO (funcionalidad rota o insegura):
  FIX-3  hasFileChanged() default true
  FIX-4  Video/audio routing en Drive
  FIX-5  fallbackSTT límite duración
  FIX-6  SSRF redirect guard

MEDIO (calidad/DRY):
  FIX-7  max-filesize yt-dlp
  FIX-8  mediaDir constante
  FIX-9  isLibreOfficeAvailable cache
  FIX-10 Tests temporal-split
  FIX-11 Tests YouTube

BAJO (cleanup/docs):
  FIX-12 Playlist truncation warning
  FIX-13 CLAUDE.md actualizar
  FIX-14 Dynamic import en loop
  FIX-15 SQL fallback dead code
  FIX-16 csvBuffer documentar
  FIX-17 API key documentar
```

### Paralelización sugerida

```
Track FIX-A (CRITICO+ALTO): FIX-1, FIX-2, FIX-3, FIX-4, FIX-5, FIX-6
Track FIX-B (MEDIO código):  FIX-7, FIX-8, FIX-9, FIX-14, FIX-15
Track FIX-C (TESTS):         FIX-10, FIX-11
Track FIX-D (DOCS):          FIX-12, FIX-13, FIX-16, FIX-17
```

Tracks A y B pueden correr en paralelo. Track C necesita que FIX-1 (build) esté resuelto primero. Track D es independiente.

---

## Verificación final

Después de todos los fixes:
```bash
# Build
docker run --rm -v /docker/luna-repo:/app -w /app node:22-alpine npx tsc --noEmit

# Tests
npm test

# yt-dlp
docker run --rm luna-app yt-dlp --version

# Grep por código muerto
grep -r "extractImageWithVision" src/  # debe retornar 0
grep -r "instance/knowledge/media" src/modules/knowledge/ | grep -v constants.ts  # debe retornar 0
```
