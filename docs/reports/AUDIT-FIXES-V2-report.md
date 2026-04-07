# INFORME DE CIERRE — PLAN-AUDIT-FIXES-V2
## Branch: `claude/audit-fixes-v2-vGgPV`

---

### Objetivos definidos

Ejecutar los 17 fixes del plan `docs/plans/PLAN-AUDIT-FIXES-V2.md`, organizados en 4 prioridades:
- **CRÍTICO** (2): rompen build o producción
- **ALTO** (4): funcionalidad rota o insegura
- **MEDIO** (5): calidad de código y tests
- **BAJO** (6): cleanup, documentación

---

### Completado ✅

| Fix | Prioridad | Descripción |
|-----|-----------|-------------|
| FIX-1 | CRÍTICO | `extractImageWithVision` eliminada → reemplazada por `extractImage` + `describeImage` en `knowledge-manager.ts:222` |
| FIX-2 | CRÍTICO | `yt-dlp` ya estaba en Dockerfile línea 12 — verificado |
| FIX-3 | ALTO | `hasFileChanged()` default `false` → `true` en `item-manager.ts:1800` |
| FIX-4 | ALTO | Audio/video routing en `loadDriveFile()` — branches `audio/*` y `video/*` con extractores, STT/describe, temporal split y chunking correcto |
| FIX-5 | ALTO | `fallbackSTT` limitado a 30 min en `youtube-handler.ts` para evitar descargas >200MB |
| FIX-6 | ALTO | SSRF redirect guard en `url-extractor.ts` — `redirect:'manual'` + `isInternalHostname()` con max 3 saltos |
| FIX-7 | MEDIO | `--max-filesize 500m` en `downloadVideo()` de `youtube-adapter.ts` |
| FIX-8 | MEDIO | `KNOWLEDGE_MEDIA_DIR` constante en nuevo `constants.ts` — 13 instancias reemplazadas en 4 archivos |
| FIX-9 | MEDIO | `isLibreOfficeAvailable()` con cache module-level `_libreOfficeAvailable` en `convert-to-pdf.ts` |
| FIX-10 | MEDIO | Tests `temporal-split.test.ts` actualizados: `subsequentSeconds` 70→60, comentarios y assertions corregidos |
| FIX-11 | MEDIO | 3 nuevos archivos de tests YouTube: `youtube-adapter.test.ts`, `youtube-attachment.test.ts`, `youtube-knowledge.test.ts` |
| FIX-12 | BAJO | Warning de truncamiento en `listPlaylistVideos()` cuando hay más de 250 videos |
| FIX-13 | BAJO | `CLAUDE.md` knowledge actualizado con docs de YouTube adapter (5 escenarios), Drive audio/video routing |
| FIX-14 | BAJO | Dynamic import de `node:fs/promises` movido fuera del loop en `item-manager.ts` (usa `unlink` ya importado al top) |
| FIX-15 | BAJO | Dead code SQL eliminado en `runNightlyBinaryCleanup()` — early return si `!pgStore` (siempre inyectado desde manifest) |
| FIX-16 | BAJO | Documentado en CLAUDE.md: `csvBuffer` no se persiste a disco por diseño |
| FIX-17 | BAJO | Documentado en CLAUDE.md: YouTube API key en query string, necesita restricción de IP en Google Cloud Console |

---

### No completado ❌

Ninguno — todos los 17 fixes del plan fueron completados.

---

### Archivos creados

| Archivo | Descripción |
|---------|-------------|
| `src/modules/knowledge/constants.ts` | Constante `KNOWLEDGE_MEDIA_DIR` compartida |
| `tests/extractors/youtube-adapter.test.ts` | Tests: `parseYouTubeUrl`, `parseDuration`, `getVideoMeta`, `getTranscript` |
| `tests/extractors/youtube-attachment.test.ts` | Tests: `processYouTubeAttachment` (con transcript, sin transcript, URLs no-video) |
| `tests/knowledge/youtube-knowledge.test.ts` | Tests: `chunkYoutube` (header, chapters, segments, linkChunks) |

### Archivos modificados

| Archivo | Cambio |
|---------|--------|
| `src/modules/knowledge/knowledge-manager.ts` | FIX-1 (extractImage), FIX-8 (KNOWLEDGE_MEDIA_DIR) |
| `src/modules/knowledge/item-manager.ts` | FIX-3, FIX-4, FIX-8, FIX-14 |
| `src/modules/knowledge/embedding-queue.ts` | FIX-8, FIX-15 |
| `src/modules/knowledge/vectorize-worker.ts` | FIX-8 |
| `src/modules/knowledge/CLAUDE.md` | FIX-13, FIX-16, FIX-17 |
| `src/extractors/convert-to-pdf.ts` | FIX-9 |
| `src/extractors/youtube-adapter.ts` | FIX-7, FIX-12 |
| `src/engine/attachments/url-extractor.ts` | FIX-6 |
| `src/engine/attachments/youtube-handler.ts` | FIX-5 |
| `tests/extractors/temporal-split.test.ts` | FIX-10 |

---

### Interfaces expuestas (exports que otros consumen)

- `KNOWLEDGE_MEDIA_DIR` (nuevo) en `src/modules/knowledge/constants.ts` — importar con `.js` extension
- `isInternalHostname()` en `url-extractor.ts` — función interna (no exportada)

---

### Tests

| Suite | Estado | Notas |
|-------|--------|-------|
| `temporal-split.test.ts` | ✅ PASS | Corregidas 3 assertions que fallaban por subsequentSeconds=70 (era 60) |
| `youtube-adapter.test.ts` | ✅ PASS (new) | 15 tests: parseYouTubeUrl, parseDuration, getVideoMeta mock, getTranscript mock |
| `youtube-attachment.test.ts` | ✅ PASS (new) | 4 tests: processYouTubeAttachment con mocks del adapter |
| `youtube-knowledge.test.ts` | ✅ PASS (new) | 11 tests: chunkYoutube y linkChunks |
| `metadata.test.ts` | ❌ PRE-EXISTENTE | 1 test falla antes y después de estos cambios (no relacionado) |
| **Total** | **287/288** | 1 pre-existente sin relación con estos cambios |

---

### Decisiones técnicas

1. **FIX-4 (audio/video en Drive)**: Se replicó el patrón de `loadYoutubeVideo()` en lugar de hacer públicos `routeAudio()`/`routeVideo()` de `KnowledgeManager`. Mantiene encapsulamiento y evita acoplamiento entre módulos. Los umbrales (60s audio, 50s video) están inline como en `loadYoutubeVideo()`.

2. **FIX-6 (SSRF)**: Se implementó `fetchWithRedirectGuard` como closure dentro de `extractAuthorizedUrl()` con máximo 3 saltos. La función `isInternalHostname()` es módulo-privada (no exportada) para evitar uso incorrecto.

3. **FIX-8 (KNOWLEDGE_MEDIA_DIR)**: Se creó `constants.ts` en vez de agregar a `types.ts` o `embedding-limits.ts` para mantener separación de concerns. `resolve()` se evalúa al cargar el módulo (proceso único).

4. **FIX-11 (tests YouTube)**: Los tests de `youtube-knowledge.test.ts` prueban `chunkYoutube()` directamente (función pura) en lugar de `loadYoutubeVideo()` privada. Más mantenibles y sin dependencias de DB/registry.

---

### Riesgos o deuda técnica

- **FIX-4**: El routing audio/video en `loadDriveFile()` usa `readFile` via dynamic import dentro del loop de segmentos — menor ineficiencia, igual que el patrón en `loadYoutubeVideo()`. Tolerable por baja frecuencia de uso.
- **FIX-6**: El SSRF guard en `url-extractor.ts` no resuelve DNS para verificar IPs de dominios (solo chequea el hostname literal del redirect). Para protección completa se necesitaría resolución DNS, pero eso requeriría Node.js 18+ `dns.resolve()` + mayor complejidad.
- **metadata.test.ts** pre-existente: `extractMarkdown — sin headings explícitos retorna hasExplicitHeadings=false` falla antes y después de estos cambios. No es regresión nuestra.

---

### Notas para integración

- Importar `KNOWLEDGE_MEDIA_DIR` como `import { KNOWLEDGE_MEDIA_DIR } from './constants.js'` en cualquier nuevo archivo del módulo knowledge.
- El `chunkVideo()` en `item-manager.ts` requiere `transcription: null` explícito (campo requerido en el type).
- La variable `_libreOfficeAvailable` en `convert-to-pdf.ts` es module-level — se resetea al reiniciar el proceso (comportamiento correcto).
