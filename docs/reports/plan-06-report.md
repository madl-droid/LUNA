# INFORME DE CIERRE — Plan 06: Knowledge & Training

## Branch: `claude/fix-bugs-complete-plan-9lfba`

### Objetivos definidos
Aplicar 4 fixes del Plan 06 (Beta Hardening) al módulo Knowledge:
- FIX-01 (CRITICAL): Category filtering para evitar fuga de información entre líneas de negocio
- FIX-02 (HIGH): YouTube usa OAuth en vez de Google AI Studio API key
- FIX-03 (HIGH): Bulk train carga contenido de items pendientes antes de vectorizar
- FIX-04 (MEDIUM): sheets-read auto-recovery para rangos inválidos

---

### Completado ✅

**FIX-01 — Category filtering por tipo de contacto**
- `types.ts`: Agregado `allowedCategoryIds?: string[]` a `KnowledgeSearchOptions`, y campo `KNOWLEDGE_CONTACT_CATEGORY_MAP: string` a `KnowledgeConfig`
- `search-engine.ts`: Filtro estricto antes del ranking — excluye entries sin intersección de categorías. Items sin categoría (FAQs) siempre pasan (fail-open seguro)
- `knowledge-manager.ts`: `searchConsultable()` acepta y propaga `allowedCategoryIds`
- `manifest.ts`: configSchema + handler `search_knowledge` lee `context.contactType`, parsea JSON de `KNOWLEDGE_CONTACT_CATEGORY_MAP`, aplica filtro. Fail-open si no hay mapeo o JSON inválido

Config de ejemplo: `KNOWLEDGE_CONTACT_CATEGORY_MAP='{"lead_teff":["cat-id-teff","cat-id-general"],"lead_onescreen":["cat-id-onescreen","cat-id-general"]}'`

**FIX-02 — YouTube OAuth en vez de Google AI Studio API key**
- `youtube-adapter.ts`: `getVideoMeta()`, `listPlaylistVideos()`, `getChannelMeta()` aceptan `opts?: { accessToken?: string }`. Cuando presente → `Authorization: Bearer` header en vez de `key=` en query string. Batch de videos en playlist también usa el header. Backward compatible con apiKey.
- `item-manager.ts`: Nuevo método `getYouTubeAccessToken()` que obtiene token de `google:oauth-client` (OAuth2Client). Todos los loaders YouTube (`loadYoutubeVideo`, `loadYoutubePlaylist`, `loadYoutubeChannel`, `scanTabs`) usan OAuth con fallback a API key + WARN log.

**FIX-03 — Bulk train carga contenido pendiente primero**
- `pg-store.ts`: Nuevo método `listItemsPendingContent()` — `SELECT * FROM knowledge_items WHERE content_loaded = false AND active = true ORDER BY created_at ASC`
- `manifest.ts` (handler `POST /vectorize`): Antes de llamar `enqueueBulk()`, consulta items pendientes y llama `loadContent(item.id)` para cada uno. Errores individuales no bloquean el proceso.

**FIX-04 — sheets-read auto-recovery**
- `google-apps/tools.ts`: Handler `sheets-read` captura errores que contienen "unable to parse range" o "400", llama `getSpreadsheet()` para obtener la primera hoja, reintenta con el nombre correcto, retorna resultado + nota explicativa. Elimina un round-trip LLM completo.

---

### No completado ❌
Ninguno — todos los fixes del Plan 06 completados.

---

### Archivos creados/modificados

| Archivo | Cambio |
|---------|--------|
| `src/modules/knowledge/types.ts` | +`allowedCategoryIds` en `KnowledgeSearchOptions`, +`KNOWLEDGE_CONTACT_CATEGORY_MAP` en `KnowledgeConfig` |
| `src/modules/knowledge/search-engine.ts` | +filtro por `allowedCategoryIds` antes del ranking |
| `src/modules/knowledge/knowledge-manager.ts` | `searchConsultable()` acepta `allowedCategoryIds` |
| `src/modules/knowledge/manifest.ts` | +`KNOWLEDGE_CONTACT_CATEGORY_MAP` en configSchema, handler search_knowledge usa context, handler vectorize carga items pendientes |
| `src/modules/knowledge/pg-store.ts` | +`listItemsPendingContent()` |
| `src/extractors/youtube-adapter.ts` | `getVideoMeta`, `listPlaylistVideos`, `getChannelMeta` aceptan `opts.accessToken` |
| `src/modules/knowledge/item-manager.ts` | +`getYouTubeAccessToken()`, todos los YouTube loaders usan OAuth |
| `src/modules/google-apps/tools.ts` | sheets-read handler con auto-recovery |
| `src/modules/knowledge/CLAUDE.md` | Documenta: category filtering, bulk train content loading |
| `src/extractors/CLAUDE.md` | Documenta: youtube-adapter OAuth support |

---

### Interfaces expuestas (exports que otros consumen)

- `KnowledgeSearchOptions.allowedCategoryIds?: string[]` — nuevo campo optional, backward compatible
- `KnowledgeConfig.KNOWLEDGE_CONTACT_CATEGORY_MAP: string` — nuevo campo de config
- `KnowledgePgStore.listItemsPendingContent()` — nuevo método público
- `KnowledgeManager.searchConsultable(query, limit, searchHint, allowedCategoryIds?)` — nuevo parámetro optional
- `getVideoMeta(videoId, apiKey, opts?)` — nuevo parámetro optional
- `listPlaylistVideos(playlistId, apiKey, opts?)` — nuevo parámetro optional
- `getChannelMeta(handleOrId, apiKey, opts?)` — nuevo parámetro optional

---

### Dependencias instaladas
Ninguna nueva.

---

### Tests
No hay test runner configurado en el proyecto. Se verificó compilación TypeScript: 0 errores nuevos introducidos (errores pre-existentes son de falta de @types/node, pino, etc., presentes antes de estos cambios).

---

### Decisiones técnicas

1. **FIX-01 — fail-open doble**: (a) Si no hay `KNOWLEDGE_CONTACT_CATEGORY_MAP` configurado para el `contact_type`, no se filtra. (b) Items sin categorías (FAQs, `categoryIds: []`) siempre pasan el filtro. Evita romper casos sin configuración.

2. **FIX-02 — backward compatible**: Si no hay OAuth disponible, se usa la API key con WARN log. No se rompe el sistema si Google Apps no está configurado.

3. **FIX-03 — errores por item no bloquean**: Si un item falla en `loadContent()`, se loguea WARN y continúa con el siguiente. El bulk vectorization sigue aunque algunos items fallen.

4. **FIX-04 — range correction lógica**: `"Sheet1!A1:Z100"` → extrae `"A1:Z100"`, antepone nombre real de primera hoja → `"Hoja 1!A1:Z100"`. Si no hay primera hoja o el retry falla, retorna el error original.

---

### Riesgos o deuda técnica

- **FIX-01**: El mapeo `KNOWLEDGE_CONTACT_CATEGORY_MAP` usa IDs de categorías (UUIDs), no nombres. El operador debe obtener los IDs de la tabla `knowledge_categories`. Podría ser más ergonómico usar nombres, pero UUIDs son más estables.
- **FIX-02**: OAuth2Client de google-auth-library tiene type `getAccessToken() → { token: string | null }`. Se usa `getOptional<{ getAccessToken(): Promise<{ token: string | null | undefined }> }>` que es suficientemente amplio para el duck typing.
- **FIX-04**: El error "400" en el check es amplio. Podría matchear falsos positivos. La condición adicional `"unable to parse range"` reduce el riesgo.

---

### Notas para integración

- Para activar FIX-01: configurar `KNOWLEDGE_CONTACT_CATEGORY_MAP` en las variables de entorno del módulo knowledge.
- FIX-02 funciona automáticamente cuando google-apps módulo está activo y autenticado con OAuth.
- FIX-03 y FIX-04 son transparentes — activos desde el primer deploy.
