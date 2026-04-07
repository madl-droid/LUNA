# AUDITORLA II — Extractors Architecture v2 (Post-Integration)

**Branch auditada:** `claude/plan-extractors-architecture-eBWGv`
**Tracks nuevos:** F (integración knowledge-manager), Audit Fixes, Drive Folders, YouTube
**Fecha:** 2026-04-07
**Commits nuevos:** 15 commits, ~2,678 lineas netas nuevas
**Archivos impactados:** 33 source files

---

## Resumen ejecutivo

Esta segunda ronda cubre el trabajo de integración (Track F), correcciones de auditoría, Drive Folders, y YouTube. **La brecha critica GAP-1 de la primera auditoría (knowledge-manager desconectado) fue resuelta.** El router dual ahora funciona en producción. La mayoría de los bugs y duplicaciones reportados se corrigieron. Sin embargo, hay **1 bug que rompe el build**, nuevos problemas de integración, y deuda técnica residual.

**Severidad total:** 1 build-breaking bug, 4 bugs medios, 5 deudas técnicas, 3 hallazgos de seguridad/robustez.

---

## Estado de hallazgos de Auditoría I

| ID | Hallazgo original | Estado |
|----|-------------------|--------|
| BUG-1 | imageUrls en web.ts abusa de ExtractedImage.data | **CORREGIDO** — Se agregó campo `url?: string` a ExtractedImage, web.ts usa `img.url` en vez de `img.data.toString()`, `.data` ahora es `Buffer.alloc(0)` |
| BUG-3 | Speaker notes se mezclan con PDF chunks en linking | **CORREGIDO** — `linkChunks()` ahora excluye chunks con `isNote: true` del chain prev/next |
| BUG-4 | isLibreOfficeAvailable() no cachea resultado | **NO CORREGIDO** — sigue ejecutando `libreoffice --version` en cada llamada |
| DT-1 | pg-store binary lifecycle methods son código muerto | **CORREGIDO** — embedding-queue ahora usa `pgStore.getDocumentsForBinaryCleanup()` y `pgStore.clearBinaryCleanupFlag()` vía inyección |
| DT-2 | runNightlyBinaryCleanup() nunca se invoca | **CORREGIDO** — manifest.ts registra `setInterval` cada hora, ejecuta a las 3 AM |
| DT-3 | temporal-splitter nunca se invoca en producción | **CORREGIDO** — knowledge-manager.ts:routeAudio() y routeVideo() llaman `splitMediaFile()` |
| DT-4 | chunkSlidesAsPdf() nunca se invoca | **CORREGIDO** — knowledge-manager.ts e item-manager.ts lo invocan para PPTX/Slides |
| DT-5 | pdfBuffer de extractDocxSmart() nunca se consume | **CORREGIDO** — knowledge-manager.ts ruta DOCX con imágenes a chunkPdf via pdfBuffer |
| DUP-1 | SQL binary cleanup duplicado | **PARCIALMENTE CORREGIDO** — embedding-queue usa pgStore si disponible, pero mantiene SQL inline como fallback |
| DUP-2 | Parsing [DESCRIPCIÓN]/[RESUMEN] duplicado 3 veces | **CORREGIDO** — `parseDualDescription()` en utils.ts, usado por image.ts, video.ts, slides.ts |
| DUP-4 | wordCount computation copy-pasted | **CORREGIDO** — `countWords()` en utils.ts, usado por text.ts, pdf.ts, docx.ts |
| GAP-1 | No hay router dual en knowledge-manager | **CORREGIDO** — router completo por MIME type en addDocument() + loadDriveFile() |
| GAP-2 | csvBuffer de sheets no se persiste | **NO CORREGIDO** — csvBuffer se genera pero nadie lo escribe a disco |
| GAP-3 | Video transcript splitting proporcional es frágil | **MEJORADO** — chunkVideo() ahora acepta `transcriptSegments` para corte preciso por timestamps; fallback proporcional solo cuando no hay timestamps |
| CX-1 | extractPptxAsContent wrapper pierde pdfBuffer | **SIN CAMBIO** — wrapper sigue existiendo para MIGRATED_EXTRACTORS; knowledge-manager llama extractPptx() directo (correcto) |
| CX-2 | shortDescription inconsistente entre extractores | **CORREGIDO** — parseDualDescription() unifica; slides.ts ahora captura shortDescription |

**Score: 12/16 corregidos, 2 parciales, 2 sin corregir.**

---

## 1. BUGS NUEVOS

### BUG-N1: `extractImageWithVision` fue eliminada pero knowledge-manager.ts la sigue importando (CRITICO — ROMPE BUILD)

**Archivo:** `src/modules/knowledge/knowledge-manager.ts:222`

```typescript
const { extractImageWithVision } = await import('../../extractors/image.js')
```

`extractImageWithVision` fue correctamente eliminada de `image.ts` (FIX-3 del plan audit fixes) y removida de los exports de `index.ts`. Pero el caller en `knowledge-manager.ts:222` **no fue actualizado**.

**Verificado con tsc:**
```
src/modules/knowledge/knowledge-manager.ts(222,15): error TS2339: Property 'extractImageWithVision'
does not exist on type 'typeof import(".../src/extractors/image")'
```

**Fix:** Reemplazar lineas 221-223 por:
```typescript
const { extractImage, describeImage } = await import('../../extractors/image.js')
const imageResult = await extractImage(buffer, fileName, mimeType)
const enriched = await describeImage(imageResult, this.registry)
const description = enriched.llmEnrichment?.description || null
```

---

### BUG-N2: `hasFileChanged()` retorna `false` cuando no hay hash ni modifiedTime (MEDIO)

**Archivo:** `src/modules/knowledge/item-manager.ts` (~linea 1800)

```typescript
function hasFileChanged(existing: FolderIndexEntry, fresh: DriveFolderNode): boolean {
  if (fresh.contentHash && existing.contentHash) {
    return fresh.contentHash !== existing.contentHash
  }
  if (fresh.modifiedTime && existing.modifiedTime) {
    return new Date(fresh.modifiedTime).getTime() > new Date(existing.modifiedTime).getTime()
  }
  return false  // Asume sin cambios si no hay data comparable
}
```

Google Workspace native files (Sheets, Docs, Slides) **no tienen md5Checksum**. Si `modifiedTime` tampoco está disponible (edge case), el sync silenciosamente los ignora. El default seguro debería ser `return true` (re-procesar en duda).

---

### BUG-N3: `fallbackSTT: true` en YouTube handler sin límite de duración (MEDIO)

**Archivo:** `src/engine/attachments/youtube-handler.ts:73`

```typescript
const transcriptResult = await getTranscript(videoId, { fallbackSTT: true })
```

Si el video no tiene transcript (ej: música sin subtítulos), intenta STT fallback que descarga el audio completo vía yt-dlp y lo envía a Gemini. Para un video de 3 horas, esto es:
- Descarga de ~200MB de audio
- Envío de ~200MB a la API de Gemini
- Costo de tokens considerable

No hay guard por duración. Debería verificar `meta.durationSeconds < MAX_STT_DURATION` antes de fallbackSTT.

---

### BUG-N4: YouTube playlist trunca silenciosamente a 250 videos (BAJO)

**Archivo:** `src/extractors/youtube-adapter.ts:396`

```typescript
while (nextPageToken && pages < 5) {  // max 5 pages = 250 videos
```

Playlists con >250 videos se truncan sin warning al caller. Debería retornar un flag `truncated: true` o log warning.

---

### BUG-N5: `chunkYoutube()` cambió de 5min/30s a 60s/10s pero CLAUDE.md de knowledge dice "5min" (BAJO)

**Archivo:** `src/modules/knowledge/CLAUDE.md:53`

```
- **YouTube**: `chunkYoutube()` → por chapter o 5min segments con 30s overlap
```

Pero el código ahora usa `AUDIO_SPLIT_CONFIG` (60s/60s/10s). Documentación desactualizada.

---

## 2. DEUDA TECNICA NUEVA

### DT-N1: `mediaDir` hardcodeado en múltiples lugares (MEDIO)

`resolve(process.cwd(), 'instance/knowledge/media')` aparece en:
- `knowledge-manager.ts:119` y `:342` (addDocument, removeDocument)
- `embedding-queue.ts:320` (runNightlyBinaryCleanup)
- `item-manager.ts` (múltiples funciones: persistVisualPdf, persistVisualSlides, loadYoutubeVideo, etc.)

Debería ser una constante del módulo o derivarse del config (`KNOWLEDGE_DIR`).

---

### DT-N2: Dynamic import en loop (`node:fs/promises` en item-manager remove) (BAJO)

**Archivo:** `src/modules/knowledge/item-manager.ts:331`

```typescript
for (const doc of docs.rows) {
  if (doc.file_path) {
    const { unlink } = await import('node:fs/promises')  // importado N veces
    await unlink(join(knowledgeDir, doc.file_path)).catch(() => {})
  }
}
```

`import('node:fs/promises')` se ejecuta por cada archivo. Debería importarse una vez fuera del loop.

---

### DT-N3: SQL inline duplicado parcialmente resuelto (BAJO)

`embedding-queue.ts:runNightlyBinaryCleanup()` ahora usa `pgStore` si está disponible, pero mantiene el SQL inline completo como fallback (~20 líneas). En la práctica, `pgStore` siempre se inyecta (manifest.ts linea 1238 pasa `pgStore` al constructor), así que el fallback es código muerto.

---

### DT-N4: `yt-dlp` agregado al Dockerfile pero NO verificado en el diff (MEDIO)

**Archivo:** `Dockerfile` — el diff muestra:
```
-RUN apk add --no-cache ffmpeg
+RUN apk add --no-cache ffmpeg libreoffice-writer libreoffice-impress libreoffice-calc
```

Pero `yt-dlp` **no fue agregado al Dockerfile**, a pesar de que el PLAN-YOUTUBE (WP2) lo requiere. `youtube-adapter.ts` llama `execFile('yt-dlp', ...)` que fallará en producción.

---

### DT-N5: `isLibreOfficeAvailable()` sigue sin cache (BAJO, carry-over)

No se corrigió desde la primera auditoría. Cada llamada a `extractDocxSmart()` ejecuta `libreoffice --version` como proceso hijo.

---

## 3. SEGURIDAD Y ROBUSTEZ

### SEC-1: SSRF via redirect en url-extractor.ts (MEDIO)

**Archivo:** `src/engine/attachments/url-extractor.ts:196`

```typescript
const response = await fetch(url, {
  redirect: 'follow',
  ...
})
```

Si un dominio en `authorizedDomains` redirige a una IP interna (127.0.0.1, 169.254.x.x), el SSRF guard se bypasea porque solo se chequea la URL original, no el destino del redirect. Recomendación: usar `redirect: 'manual'` y validar la Location header, o limitar redirects.

---

### SEC-2: API key de YouTube en query string (BAJO)

**Archivo:** `src/extractors/youtube-adapter.ts:158, 424, 489, 510`

```typescript
const url = `https://www.googleapis.com/youtube/v3/videos?key=${apiKey}&...`
```

API key va en el query string. Si hay un proxy o WAF que logea URLs completas, la key queda expuesta. Limitación del diseño de la YouTube API (no soporta header auth), pero vale documentar que la key debe tener restricciones de IP/referrer en Google Cloud Console.

---

### SEC-3: Sin validación de tamaño en descarga yt-dlp (BAJO)

**Archivo:** `src/extractors/youtube-adapter.ts:337-351`

`downloadVideo()` ejecuta yt-dlp sin límite de tamaño. Un video de 4K de 2 horas podría descargar >5GB al disco temporal. Debería haber un flag `--max-filesize` o verificación post-descarga.

---

## 4. ANÁLISIS POR PLAN

### Track F — Integración knowledge-manager

| WP | Descripción | Estado | Observaciones |
|----|-------------|--------|---------------|
| WP1 | Router dual en addDocument() | **COMPLETO** | 9 branches por MIME type, fallback a TEXT |
| WP2 | Router en loadDriveFile() | **COMPLETO** | item-manager.ts maneja DOCX, PPTX, PDF, text |
| WP3 | Slides export como PDF | **COMPLETO** | item-manager.ts exporta via Drive API |
| WP4 | Audio 60/60/10 + contentType | **COMPLETO** | AUDIO_SPLIT_CONFIG actualizado, contentType='audio' |
| WP5 | Binary lifecycle activación | **COMPLETO** | Nightly cleanup registrado en manifest.ts |
| WP6 | Metadata propagation | **PARCIAL** | Chunks reciben sourceFile, sourceMimeType; pero no todos los metadata del extractor se propagan |
| WP7 | persistSmartChunks actualizado | **COMPLETO** | Acepta EmbeddableChunk |
| WP8 | Multimodal embedding | **COMPLETO** | 'audio' agregado a MULTIMODAL_TYPES |

### Audit Fixes

| FIX | Descripción | Estado | Observaciones |
|-----|-------------|--------|---------------|
| FIX-1 | imageUrls web.ts | **CORREGIDO** | Campo url en ExtractedImage |
| FIX-2 | Speaker notes linking | **CORREGIDO** | linkChunks() excluye isNote |
| FIX-3 | Eliminar extractImageWithVision legacy | **PARCIAL** — eliminada de image.ts y index.ts, pero **knowledge-manager.ts:222 aún la importa → BUILD ROTO** |
| FIX-4 | ODP en MIGRATED_EXTRACTORS | **CORREGIDO** | application/vnd.oasis.opendocument.presentation agregado |
| FIX-5 | Test hasExplicitHeadings=false | **CORREGIDO** | Test agregado en metadata.test.ts |
| FIX-6 | DRY parseDualDescription | **CORREGIDO** | Helper en utils.ts |
| FIX-7 | DRY countWords | **CORREGIDO** | Helper en utils.ts |
| FIX-8 | SQL cleanup dedup | **PARCIAL** | Usa pgStore si disponible, mantiene fallback inline |

### Drive Folders

| WP | Descripción | Estado | Observaciones |
|----|-------------|--------|---------------|
| WP1 | supportsAllDrives + ordering | **COMPLETO** | Shared Drives soportados |
| WP2 | Tool navegación on-demand | **COMPLETO** | drive-list-files con folderId |
| WP3 | Knowledge crawl + index | **COMPLETO** | Crawl recursivo con depth limit 10 |
| WP4 | Change detection sync | **COMPLETO** | Pero hasFileChanged() tiene bug (BUG-N2) |
| WP5 | Sharing (webViewLink) | **COMPLETO** | Links individuales en metadata |
| WP6 | pg-store folder index | **COMPLETO** | CRUD con migration 042 |
| WP7 | sync-manager delegación | **COMPLETO** | setItemManager + syncDriveFolder |
| WP8 | Folder tree view | **COMPLETO** | Skill drive-navigation.md |

### YouTube

| WP | Descripción | Estado | Observaciones |
|----|-------------|--------|---------------|
| WP1 | YouTube Adapter | **COMPLETO** | 549 lineas, 7 funciones principales |
| WP2 | yt-dlp en Docker | **NO COMPLETADO** | Falta en Dockerfile |
| WP3 | Attachment scenario | **COMPLETO** | youtube-handler.ts + url-extractor.ts |
| WP4 | Video knowledge | **COMPLETO** | loadYoutubeVideo con temporal split |
| WP5 | Playlist knowledge | **COMPLETO** | 60s preview + transcript |
| WP6 | Channel knowledge | **COMPLETO** | Metadata-only index |
| WP7 | YouTube in web | **COMPLETO** | Embedded iframe detection en web.ts |
| WP8 | Refactor loadYoutubeContent | **COMPLETO** | Usa adapter |
| WP9 | chunkYoutube 60s/10s | **COMPLETO** | Usa AUDIO_SPLIT_CONFIG via calculateSegments |
| WP10 | routeVideo transcript | **COMPLETO** | transcriptSegments parameter |
| WP11 | chunkVideo timestamps | **COMPLETO** | Precise transcript cutting |

---

## 5. ITEMS PENDIENTES CONFIRMADOS

Del informe de pre-cierre del usuario:

| Item | Estado de auditoría |
|------|---------------------|
| Video/audio routing en Drive | **CONFIRMADO PENDIENTE** — loadDriveFile() no rutea `video/*` ni `audio/*` a pipelines multimedia. Videos de Drive se descargan pero solo se convierten a texto |
| Tests temporal-split 60/60/10 | **CONFIRMADO PENDIENTE** — Tests originales de Track E usan 60/70/10 |
| Tests YouTube | **CONFIRMADO PENDIENTE** — 0 tests para youtube-adapter, youtube-handler, attachment scenarios |
| yt-dlp en Dockerfile | **CONFIRMADO PENDIENTE** — no agregado |

---

## Resumen por severidad

| # | Tipo | Severidad | Resumen |
|---|------|-----------|---------|
| BUG-N1 | Bug | **CRITICO** | extractImageWithVision eliminada pero knowledge-manager.ts la importa → build roto |
| BUG-N2 | Bug | Medio | hasFileChanged() retorna false sin data → sync silenciosamente ignora cambios |
| BUG-N3 | Bug | Medio | fallbackSTT sin límite de duración → descarga y procesa videos enormes |
| BUG-N4 | Bug | Bajo | Playlist trunca a 250 videos sin warning |
| BUG-N5 | Doc | Bajo | CLAUDE.md de knowledge dice "5min" pero código usa 60s |
| DT-N1 | Deuda | Medio | mediaDir hardcodeado en 5+ lugares |
| DT-N2 | Deuda | Bajo | Dynamic import en loop |
| DT-N3 | Deuda | Bajo | SQL fallback inline ahora es código muerto |
| DT-N4 | Deuda | Medio | yt-dlp falta en Dockerfile (YouTube download falla en prod) |
| DT-N5 | Deuda | Bajo | isLibreOfficeAvailable() sin cache (carry-over) |
| SEC-1 | Seguridad | Medio | SSRF via redirect en url-extractor |
| SEC-2 | Seguridad | Bajo | YouTube API key en query string |
| SEC-3 | Seguridad | Bajo | Sin límite de tamaño en download yt-dlp |
| GAP-2 | Brecha | Bajo | csvBuffer de sheets sigue sin persistirse (carry-over) |

---

## Veredicto

**La integración se completó: las tuberías ahora están conectadas a la casa.** El router dual funciona, temporal splitting corre en producción, binary lifecycle tiene nightly cleanup, y YouTube tiene pipeline completo desde attachment hasta knowledge.

Sin embargo, **hay un bug que rompe el build** (`extractImageWithVision` eliminada pero aún importada) que debe corregirse antes de mergear. Y `yt-dlp` falta del Dockerfile, lo que hace que toda la funcionalidad de descarga de YouTube falle en producción silenciosamente.

**Comparado con Auditoría I:** La situación mejoró significativamente. De 16 hallazgos originales, 12 fueron corregidos, 2 parcialmente. La arquitectura pasó de "tuberías sueltas" a "sistema integrado con brechas menores".

**Acción inmediata requerida:**
1. Corregir knowledge-manager.ts:222 — reemplazar `extractImageWithVision` por `extractImage` + `describeImage`
2. Agregar `yt-dlp` al Dockerfile
3. Corregir `hasFileChanged()` default a `true`
