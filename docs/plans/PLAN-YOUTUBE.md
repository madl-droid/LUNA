# PLAN — YouTube: Attachments, Knowledge, Playlists, Canales

## Contexto

YouTube tiene 5 escenarios de uso en LUNA:
1. **Attachment**: lead envía link de YouTube en chat
2. **Knowledge video**: admin carga URL de un video individual
3. **Knowledge playlist**: admin carga URL de una playlist
4. **Knowledge canal**: admin carga URL de un canal
5. **YouTube embebido**: video incrustado en página web (iframe)

### Estado actual
- `src/extractors/youtube.ts` — extractor global (función pura, no llama APIs)
- `src/modules/knowledge/item-manager.ts` — `loadYoutubeContent()` monolítico (80+ líneas) con implementación paralela que NO usa el extractor global
- `src/modules/knowledge/extractors/smart-chunker.ts` — `chunkYoutube()` con chapters o 5min/30s
- Librería `youtube-transcript` (scraping, no API oficial) para subtítulos
- YouTube Data API v3 con API key para metadata de playlists/canales
- **NO hay soporte de YouTube en attachments** — se redirige a `web_explore`
- **NO hay embedding multimodal** — chunks son solo texto
- **NO hay STT fallback** cuando no hay subtítulos
- **NO hay yt-dlp** instalado en Docker

### Principio de coherencia
YouTube es otro "source type" que pasa por los mismos extractores y chunkers que Drive:

| Concepto | Drive | YouTube |
|----------|-------|---------|
| Contenedor | Carpeta | Playlist / Canal |
| Item | Archivo | Video |
| Index | `listFiles()` | `playlistItems.list` |
| Metadata | Drive API | YouTube Data API v3 |
| Binario | `downloadFile()` | `yt-dlp` |
| Texto | Extractores globales | Transcript (API/scraping/STT) |
| Cambio detectado | md5 / modifiedTime | Nuevo videoId en playlist |

### Normas generales
- **yt-dlp** solo se usa en 2 casos: (1) video sin transcript → extraer audio → STT, (2) admin quiere descargar video como knowledge (opción en wizard)
- **Metadata estándar** por cada video consultado: título, descripción, tags, publishedAt, channelTitle, thumbnails, duration, defaultLanguage, topicCategories + transcript si existe + URL del video
- **Metadata de playlist**: lista de videos con snippet
- **Binarios temporales**: si se descarga audio solo para STT, se borra el binario después de transcribir

---

## WP1: YouTube Adapter — Capa unificada de datos

**Archivo nuevo:** `src/extractors/youtube-adapter.ts`

Encapsula todas las fuentes de datos de YouTube en una interfaz normalizada. Todos los escenarios usan este adapter.

### Interfaces

```typescript
export interface YouTubeVideoMeta {
  videoId: string
  title: string
  description: string
  tags: string[]
  publishedAt: string | null
  channelTitle: string | null
  duration: number | null          // segundos (parseado de ISO 8601)
  defaultLanguage: string | null
  topicCategories: string[]        // Wikipedia URLs
  thumbnailUrl: string | null      // URL de mejor resolución disponible
  url: string                      // https://youtube.com/watch?v=XXX
  hasCaption: boolean              // caption field de contentDetails
}

export interface YouTubeTranscriptResult {
  segments: Array<{ text: string; offset: number; duration?: number }>
  source: 'youtube-captions' | 'yt-dlp-stt'   // para logging/métricas
}

export interface YouTubePlaylistMeta {
  playlistId: string
  title: string
  description: string
  channelTitle: string | null
  videoCount: number
  url: string
}

export interface YouTubeChannelMeta {
  channelId: string
  title: string
  description: string
  uploadsPlaylistId: string | null
  playlists: YouTubePlaylistMeta[]
  url: string
}
```

### Funciones

```typescript
/** Obtiene metadata completa de un video via YouTube Data API v3 (videos.list part=snippet,contentDetails,topicDetails) */
export async function getVideoMeta(videoId: string, apiKey: string): Promise<YouTubeVideoMeta>

/** Obtiene transcript: intenta youtube-transcript (es, luego default). Si falla y fallbackSTT=true → yt-dlp audio → Gemini STT → borra binario audio */
export async function getTranscript(videoId: string, registry: Registry, opts?: { fallbackSTT?: boolean }): Promise<YouTubeTranscriptResult | null>

/** Descarga thumbnail como Buffer */
export async function downloadThumbnail(url: string): Promise<{ buffer: Buffer; mimeType: string } | null>

/** Descarga video completo via yt-dlp (mp4, mejor calidad hasta 720p) */
export async function downloadVideo(videoId: string, outputDir: string): Promise<{ filePath: string; mimeType: string; sizeBytes: number }>

/** Descarga solo audio via yt-dlp (para STT fallback) */
export async function downloadAudio(videoId: string): Promise<{ buffer: Buffer; mimeType: string; tempPath: string }>

/** Lista videos de una playlist (paginado, max 250) */
export async function listPlaylistVideos(playlistId: string, apiKey: string): Promise<YouTubeVideoMeta[]>

/** Obtiene metadata de un canal: uploads playlist + playlists públicas + branding */
export async function getChannelMeta(handleOrId: string, apiKey: string): Promise<YouTubeChannelMeta>

/** Parsea videoId de URL (watch, shorts, youtu.be, embed) */
export function parseYouTubeUrl(url: string): { type: 'video' | 'playlist' | 'channel' | 'unknown'; id: string | null; playlistId?: string }

/** Parsea duración ISO 8601 (PT4M33S → 273) */
export function parseDuration(iso: string): number
```

### STT fallback (detalle)

```
getTranscript(videoId, registry, { fallbackSTT: true })
  1. youtube-transcript (lang='es') → si OK → return
  2. youtube-transcript (lang=default) → si OK → return
  3. yt-dlp --extract-audio → Buffer audio temporal
  4. transcribeAudioContent(audioResult, registry) → transcripción
  5. unlink(tempPath) → borrar binario audio
  6. return { segments: [parsear por silencios/puntuación], source: 'yt-dlp-stt' }
```

### Notas
- `getVideoMeta()` reemplaza las llamadas directas a YouTube Data API que hoy están en `item-manager.ts`
- `listPlaylistVideos()` reemplaza `ItemManager.listPlaylistVideos()` (misma lógica, mejor lugar)
- Todas las funciones manejan errores con logging y retorno null/vacío (non-fatal)
- API key viene del caller (knowledge config o kernel config)

---

## WP2: Docker — yt-dlp binario

**Archivo:** `deploy/Dockerfile`

### Cambios

```dockerfile
# Después de instalar ffmpeg (ya existe)
RUN apk add --no-cache yt-dlp
```

### Verificación

```bash
docker run --rm luna-app yt-dlp --version
```

### Notas
- yt-dlp es ~15MB, aceptable
- Alpine tiene paquete `yt-dlp` en community repo
- Se usa solo desde `youtube-adapter.ts` via `execFile('yt-dlp', [...])`
- NO se usa como dependencia npm, es binario del sistema como ffmpeg

---

## WP3: Escenario 1 — YouTube como Attachment

**Archivos:**
- `src/engine/attachments/url-extractor.ts` — detectar URLs de YouTube
- `src/engine/attachments/processor.ts` — routing a procesador YouTube
- `src/engine/attachments/youtube-handler.ts` (nuevo) — procesar link YouTube en chat

### Detección

En `url-extractor.ts`, agregar detección de URLs YouTube (watch, shorts, youtu.be, embed):

```typescript
// Detectar YouTube URLs en el texto del mensaje
const YOUTUBE_URL_REGEX = /(?:https?:\/\/)?(?:www\.)?(?:youtube\.com\/(?:watch\?v=|shorts\/)|youtu\.be\/)([\w-]{11})/g
```

### Handler

`youtube-handler.ts`:

```
1. parseYouTubeUrl(url) → videoId
2. getVideoMeta(videoId, apiKey) → metadata completa
3. downloadThumbnail(meta.thumbnailUrl) → Buffer imagen
4. getTranscript(videoId, registry, { fallbackSTT: true }) → segments
5. parseYoutubeChapters(meta.description) → chapters (o null)
6. Chunking:
   - Header chunk: thumbnail como mediaRef imagen + título + descripción + tags + metadata
   - Transcript chunks: por capítulos si hay, si no por 60s/60s/10s (AUDIO_SPLIT_CONFIG)
   - Cada chunk: contentType 'audio', metadata incluye URL del video, videoId, timestamps
7. Return: chunks para embedding en memoria (attachment lifecycle)
```

### Chunking del transcript (sin capítulos)

Se usa `calculateSegments(duration, AUDIO_SPLIT_CONFIG)` del temporal-splitter para calcular los rangos de tiempo, y luego se corta el transcript por esos timestamps. NO se descarga ni corta audio — solo se divide el texto del transcript por timestamps equivalentes a 60s/60s/10s.

### Embedding

contentType `'audio'` → el embedding es textual (transcript), no multimodal de audio. El thumbnail del header chunk sí va como multimodal (imagen).

### Integración con agentic.ts

Eliminar la línea que redirige YouTube a `web_explore`. Ahora se procesa como attachment normal.

---

## WP4: Escenario 2 — Knowledge: Video Individual

**Archivos:**
- `src/modules/knowledge/item-manager.ts` — refactorizar `loadYoutubeContent()`
- `src/modules/knowledge/knowledge-manager.ts` — router en addDocument para YouTube

### Flujo

```
1. parseYouTubeUrl(sourceUrl) → videoId
2. getVideoMeta(videoId, apiKey) → metadata completa
3. downloadVideo(videoId, mediaDir) → archivo mp4 en disco
4. getTranscript(videoId, registry, { fallbackSTT: true }) → segments
5. extractVideo(buffer, fileName, mimeType) → VideoResult (duración, metadata)
6. describeVideo(videoResult, registry) → LLM description (qué se VE)
7. splitMediaFile(buffer, mimeType, duration, VIDEO_SPLIT_CONFIG) → segmentos temporales
8. chunkVideo({
     description: llmDescription,
     transcription: transcriptText,        // ← NUEVO: ahora pasa transcript
     segments: persistedSegments,
     sourceUrl: videoUrl,
     sourceFile: title,
     // + metadata YouTube en cada chunk
   })
9. persistSmartChunks() → DB
10. Embed como video_frames (multimodal)
```

### Transcript en chunkVideo

`chunkVideo()` ya soporta `transcription` y lo corta proporcionalmente por timestamps (líneas 702-707 de smart-chunker.ts). Con YouTube tenemos timestamps precisos del transcript, así que pasamos `transcriptSegments` para corte exacto (no proporcional).

**Cambio en chunkVideo()**: agregar soporte para `transcriptSegments` (como ya tiene `chunkAudio`):

```typescript
// Si hay transcriptSegments, usar corte preciso por timestamps
if (opts.transcriptSegments) {
  segmentText = opts.transcriptSegments
    .filter(t => t.offset >= seg.startSeconds && t.offset < seg.endSeconds)
    .map(t => t.text)
    .join(' ')
    .trim()
}
```

### Capítulos como alineación de corte

Si el video tiene capítulos, los cortes de `splitMediaFile` se mantienen estándar (VIDEO_SPLIT_CONFIG) pero el transcript dentro de cada segmento se enriquece con el título del capítulo correspondiente:

```
[Capítulo: "Introducción"]
{transcript del segmento}
```

### Overlap en cortes con capítulos

El overlap de 10s del VIDEO_SPLIT_CONFIG ya aplica entre segmentos de video. El transcript de cada segmento incluye el texto del overlap (por timestamps). No se necesita lógica adicional.

### Metadata YouTube en chunks

Cada chunk incluye en `metadata`:
```typescript
{
  sourceType: 'video',
  sourceUrl: 'https://youtube.com/watch?v=XXX',
  videoId: 'XXX',
  channelTitle: '...',
  publishedAt: '...',
  tags: [...],
  topicCategories: [...],
  // + timestamps, duration, etc. estándar
}
```

---

## WP5: Escenario 3 — Knowledge: Playlist

**Archivos:**
- `src/modules/knowledge/item-manager.ts` — refactorizar `loadYoutubeContent()` para playlists

### Flujo

```
1. listPlaylistVideos(playlistId, apiKey) → lista de YouTubeVideoMeta
2. Index en knowledge_folder_index:
   - parent_id = knowledge_item.id
   - source_type = 'youtube_playlist'
   - Cada video = row con videoId, title, status ('pending'|'done'|'error')
3. Por cada video (respetando tabs ignorados):
   a. getVideoMeta(videoId, apiKey) → metadata completa
   b. getTranscript(videoId, registry, { fallbackSTT: true }) → segments
   c. downloadThumbnail(meta.thumbnailUrl) → Buffer
   d. Primer 60s de video: downloadVideo → splitMediaFile con config especial:
      { firstChunkSeconds: 60, subsequentSeconds: 0, overlapSeconds: 0 }
      → 1 solo segmento de 60s → guardar en mediaDir
      → si video < 60s, guardar entero
   e. Chunks:
      - Header: thumbnail (multimodal imagen) + metadata YouTube
      - Transcript: por capítulos si hay, si no 60s/60s/10s (AUDIO_SPLIT_CONFIG)
        → contentType 'audio' (embed como texto)
      - Video preview: 1 chunk con los 60s
        → contentType 'video_frames' (embed multimodal)
   f. Cada chunk metadata incluye: URL video + URL playlist
   g. persistSmartChunks() → DB
   h. Actualizar status en knowledge_folder_index → 'done'
4. Si admin quiere video completo → carga URL individual del video (Escenario 2)
```

### Binarios

- Thumbnail: NO se guarda (ya va como base64 en el chunk)
- 60s de video: se guarda en `instance/knowledge/media/` (lifecycle de knowledge)
- Audio para STT (si se necesitó): se borra inmediatamente después de transcribir

---

## WP6: Escenario 4 — Knowledge: Canal (solo metadata)

**Archivos:**
- `src/modules/knowledge/item-manager.ts` — nuevo método `loadChannelContent()`

### Flujo

```
1. getChannelMeta(handleOrId, apiKey) → channelId, uploadsPlaylist, playlists[], branding
2. Index jerárquico en knowledge_folder_index:
   - Canal = root entry (source_type='youtube_channel')
   - Cada playlist = child entry (source_type='youtube_playlist')
   - Cada video = child de su playlist (source_type='youtube_video')
3. Solo metadata — NO se descarga transcript ni video
4. Chunks generados:
   - 1 chunk header del canal: nombre, descripción, branding, URL, conteo de playlists/videos
   - 1 chunk por playlist: título, descripción, conteo de videos, URL
   - Todos contentType 'text'
5. persistSmartChunks() → DB
```

### Notas
- El admin puede después cargar playlists individuales (escenario 3) o videos (escenario 2)
- YouTube Data API v3 con API key funciona para canales públicos (no necesita OAuth)
- Cuota: ~5 units por canal (channels.list + playlists.list + playlistItems.list)

---

## WP7: Escenario 5 — YouTube Embebido en Web

**Archivo:** `src/extractors/web.ts`

### Cambios

En `extractWeb()`, al parsear el HTML, detectar iframes de YouTube:

```typescript
// Detectar YouTube embeds
const iframes = dom.querySelectorAll('iframe[src*="youtube.com/embed/"], iframe[src*="youtube-nocookie.com/embed/"]')
for (const iframe of iframes) {
  const src = iframe.getAttribute('src')
  const match = src?.match(/\/embed\/([\w-]{11})/)
  if (match?.[1]) {
    // Agregar como referencia de video YouTube en el resultado
    result.embeddedVideos.push({ videoId: match[1], url: `https://www.youtube.com/watch?v=${match[1]}` })
  }
}
```

### En attachments

Cuando el attachment processor recibe un WebResult con `embeddedVideos`, procesa cada videoId como Escenario 1 (además del contenido web normal).

---

## WP8: Refactorizar loadYoutubeContent() — Unificación

**Archivo:** `src/modules/knowledge/item-manager.ts`

### Objetivo

Reemplazar el método monolítico `loadYoutubeContent()` (~80 líneas) que reimplementa todo, por un método que:
1. Usa `youtube-adapter.ts` para obtener datos
2. Delega a los chunkers estándar (`chunkVideo`, `chunkAudio`, `chunkYoutube`)
3. Usa `persistSmartChunks()` igual que Drive

### Antes (actual)

```
loadYoutubeContent():
  - import('youtube-transcript')          // acceso directo a librería
  - fetch(video.thumbnailUrl)             // download manual
  - parseYoutubeChapters()                // llamada directa
  - chunkYoutube()                        // chunker específico
  - persistSmartChunks(..., 'text/plain') // mime incorrecto
```

### Después

```
loadYoutubeContent():
  - parseYouTubeUrl(sourceUrl) → tipo (video/playlist/channel)
  - Si playlist → WP5
  - Si channel → WP6
  - Si video → WP4
  - Cada sub-flujo usa youtube-adapter para datos
  - Delega a routeVideo() / chunkYoutube() según escenario
  - persistSmartChunks() con metadata correcta
```

### Funciones movidas de item-manager a youtube-adapter
- `listPlaylistVideos()` → `youtube-adapter.ts`
- `listChannelPlaylists()` → `youtube-adapter.ts`  
- `getChannelUploadsPlaylist()` → `youtube-adapter.ts`
- Lógica de `youtube-transcript` → `youtube-adapter.getTranscript()`

---

## WP9: chunkYoutube() — Actualizar a 60s

**Archivo:** `src/modules/knowledge/extractors/smart-chunker.ts`

### Cambios

En `chunkYoutube()`, cuando no hay capítulos, cambiar de 5min/30s a 60s/60s/10s:

```typescript
// Antes:
const SEGMENT_SECONDS = 300  // 5 minutos
const OVERLAP_SECONDS = 30

// Después: usar calculateSegments con AUDIO_SPLIT_CONFIG
import { calculateSegments, AUDIO_SPLIT_CONFIG } from './temporal-splitter.js'

const segments = calculateSegments(totalDuration, AUDIO_SPLIT_CONFIG)
// Cortar transcript por estos timestamps
```

Esto alinea YouTube con el temporal splitting estándar de audio.

---

## WP10: routeVideo() — Agregar transcript

**Archivo:** `src/modules/knowledge/knowledge-manager.ts`

### Cambios

`routeVideo()` actualmente pasa `transcription: null`. Agregar soporte para transcript opcional:

```typescript
private async routeVideo(
  buffer: Buffer,
  fileName: string,
  mimeType: string,
  hashPrefix: string,
  mediaDir: string,
  opts?: { transcription?: string; transcriptSegments?: Array<{ text: string; offset: number; duration?: number }> }
): Promise<EmbeddableChunk[]> {
  // ... existing code ...
  
  return chunkVideo({
    description,
    transcription: opts?.transcription ?? null,       // ← NUEVO
    transcriptSegments: opts?.transcriptSegments,      // ← NUEVO
    // ... rest
  })
}
```

### Impacto
- Drive videos: siguen pasando sin transcript (como hoy)
- YouTube videos (escenario 2): pasan con transcript
- Futuro: si se agrega STT a Drive videos, mismo parámetro

---

## WP11: chunkVideo() — transcriptSegments preciso

**Archivo:** `src/modules/knowledge/extractors/smart-chunker.ts`

### Cambios

Agregar `transcriptSegments` a `chunkVideo()` opts (igual que `chunkAudio()` ya lo tiene):

```typescript
export function chunkVideo(opts: {
  // ... existing ...
  transcriptSegments?: Array<{ text: string; offset: number; duration?: number }>  // NUEVO
}): EmbeddableChunk[] {
```

En el loop de segmentos, si hay `transcriptSegments`, usar corte preciso por timestamps en vez del corte proporcional por caracteres:

```typescript
if (opts.transcriptSegments) {
  segmentText = opts.transcriptSegments
    .filter(t => t.offset >= seg.startSeconds && t.offset < seg.endSeconds)
    .map(t => t.text)
    .join(' ')
    .trim()
} else if (opts.transcription) {
  // corte proporcional existente (fallback)
}
```

---

## Orden de ejecución

```
WP1  youtube-adapter.ts (base, sin dependencias)
WP2  Docker yt-dlp (infraestructura, independiente)
  ↓
WP9  chunkYoutube 60s (chunker update, solo necesita WP1 para imports)
WP10 routeVideo transcript (knowledge-manager update)
WP11 chunkVideo transcriptSegments (smart-chunker update)
  ↓
WP3  Attachment handler (necesita WP1 + WP9)
WP4  Knowledge video (necesita WP1 + WP10 + WP11)
WP5  Knowledge playlist (necesita WP1 + WP4)
WP6  Knowledge canal (necesita WP1)
WP7  YouTube embebido (necesita WP3)
WP8  Refactorizar loadYoutubeContent (necesita WP4 + WP5 + WP6)
```

### Paralelización sugerida

```
Track YT-A: WP1 + WP2 (adapter + Docker)
Track YT-B: WP9 + WP10 + WP11 (chunker updates, pueden empezar con stubs)
Track YT-C: WP3 + WP7 (attachments, necesita YT-A)
Track YT-D: WP4 + WP5 + WP6 + WP8 (knowledge, necesita YT-A + YT-B)
```

---

## Tests esperados

- `tests/extractors/youtube-adapter.test.ts` — parseYouTubeUrl, parseDuration, getVideoMeta (mock API), getTranscript (mock youtube-transcript + fallback)
- `tests/extractors/youtube-attachment.test.ts` — handler completo con mocks
- `tests/knowledge/youtube-knowledge.test.ts` — escenarios 2-4 con mocks
- `tests/extractors/youtube-embed.test.ts` — detección de iframes en HTML
- Actualizar `tests/extractors/smart-chunker.test.ts` — chunkYoutube con 60s, chunkVideo con transcriptSegments
