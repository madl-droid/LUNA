# Plan 06 — Knowledge & Training

**Prioridad:** HIGH
**Módulo:** Knowledge (base de conocimiento + entrenamiento)
**Objetivo:** Category filtering para evitar fuga de información entre líneas de negocio, YouTube funcional, bulk train completo, y sheets-read resiliente.

## Archivos target

| Archivo | Líneas | Scope |
|---------|--------|-------|
| `src/modules/knowledge/search-engine.ts` | ~235 | Category filtering (boost → exclusión) |
| `src/modules/knowledge/manifest.ts` | — | search_knowledge handler |
| `src/modules/knowledge/knowledge-manager.ts` | — | triggerBulkVectorization |
| `src/modules/knowledge/console-section.ts` | ~1304 | Bulk train UI handler |
| `src/extractors/youtube-adapter.ts` | ~553 | OAuth vs API key |
| `src/modules/knowledge/item-manager.ts` | ~2006 | YouTube API key → OAuth |

## Paso 0 — Verificación obligatoria

Leer cada archivo y confirmar:
- `search-engine.ts:154-161` — que category_hint solo hace boost (+0.2) sin excluir
- `item-manager.ts` — que usa `KNOWLEDGE_GOOGLE_AI_API_KEY` para YouTube API en vez de OAuth
- `knowledge-manager.ts` o `console-section.ts` — que `triggerBulkVectorization()` no llama `loadContent()` para items pendientes
- `youtube-adapter.ts` — que acepta API key pero no access token

## Fixes

### FIX-01: Knowledge search — filtro por categoría de contacto [CRITICAL]
**Fuente:** LAB BUG-03 del audit report
**Archivo:** `src/modules/knowledge/search-engine.ts` ~líneas 154-161, `src/modules/knowledge/manifest.ts`
**Bug:** `category_hint` solo aplica un boost de +0.2 al score pero NUNCA excluye resultados de otras categorías. Un lead de la clínica puede recibir información de pantallas OneScreen.

**Fix en search-engine.ts:**
1. Agregar parámetro `allowedCategoryIds?: string[]` a la función `search()`
2. Si `allowedCategoryIds` está presente y no vacío:
   - Filtrar resultados ANTES del ranking: excluir entries cuyo `categoryIds` no tenga intersección con `allowedCategoryIds`
   - Mantener el boost de `category_hint` como criterio adicional de relevancia
3. Si `allowedCategoryIds` está vacío o undefined: comportamiento actual (sin filtro)

**Fix en manifest.ts (handler de search_knowledge):**
1. Buscar el handler que recibe las tool calls de `search_knowledge`
2. Obtener el `contact_type` del contacto actual (del ctx o del contact record)
3. Buscar el mapeo de `contact_type → allowed_categories`:
   - Opción A: tabla `tool_access_rules` (ya existe pero vacía) — popular con los mapeos
   - Opción B: configuración en `config_store` o en el manifest configSchema
   - **Recomendación: Opción B** — crear un mapeo simple en config, ej: JSON `{ "lead_teff": ["teff", "general"], "lead_onescreen": ["onescreen", "general"] }`
4. Pasar `allowedCategoryIds` al search engine

**Nota:** El mapeo contact_type → categories es una decisión de negocio. Implementar el mecanismo pero dejar el mapeo configurable (no hardcodeado). Si no hay mapeo configurado para un contact_type, no filtrar (fail-open).

### FIX-02: YouTube usa OAuth en vez de API key [HIGH]
**Fuente:** QA BUG-1 del QA report
**Archivo:** `src/extractors/youtube-adapter.ts`, `src/modules/knowledge/item-manager.ts`
**Bug:** `item-manager.ts` pasa `KNOWLEDGE_GOOGLE_AI_API_KEY` (key de Google AI Studio / Gemini) a las funciones de YouTube. Esa key NO tiene habilitado YouTube Data API v3 → 403. El sistema ya tiene OAuth con scope `youtube.readonly`.

**Fix en youtube-adapter.ts:**
1. Agregar parámetro opcional `opts?: { accessToken?: string }` a:
   - `getVideoMeta()`
   - `listPlaylistVideos()`
   - `getChannelMeta()`
2. Cuando `accessToken` está presente: usar header `Authorization: Bearer ${accessToken}` en vez de `key=${apiKey}` en query string
3. Mantener backward compatibility: si no hay accessToken, seguir usando apiKey

**Fix en item-manager.ts:**
1. Buscar donde se llaman las funciones de YouTube (~buscar `listPlaylistVideos`, `getVideoMeta`, `getChannelMeta`)
2. Obtener access token vía OAuth:
   ```typescript
   const oauthClient = this.registry.getOptional<OAuthClient>('google:oauth-client')
   const accessToken = oauthClient ? await oauthClient.getAccessToken() : null
   ```
3. Pasar `{ accessToken }` a las funciones de YouTube
4. Si no hay OAuth disponible: fallback a API key (comportamiento actual, con log WARN)

### FIX-03: Bulk train carga contenido pendiente [HIGH]
**Fuente:** QA BUG-2 del QA report
**Archivo:** `src/modules/knowledge/knowledge-manager.ts` o `console-section.ts`
**Bug:** El botón "Entrenar agente" llama `triggerBulkVectorization()` que solo re-embede chunks existentes. Items con `content_loaded=false` se ignoran.

**Fix:**
1. Buscar `triggerBulkVectorization()` y el handler de `POST /vectorize`
2. Antes de vectorizar, buscar items pendientes:
   ```sql
   SELECT id FROM knowledge_items WHERE content_loaded = false AND active = true
   ```
3. Para cada item pendiente: llamar `loadContent(itemId)` primero
4. Después de cargar contenido, proceder con la vectorización normal
5. El flujo correcto es: load content → chunk → embed → done
6. Log progreso: "Loading content for {N} pending items before vectorization"

### FIX-04: sheets-read auto-recovery [MEDIUM]
**Fuente:** LAB BUG-06 del audit report
**Archivo:** Buscar el handler de la tool `sheets-read` (probablemente en `src/modules/google-apps/` o `src/tools/`)
**Bug:** El LLM asume nombres de rango como `Sheet1!A1:Z100` que fallan con "Unable to parse range". Se recupera llamando `sheets-info` + retry, pero gasta tokens extra.

**Fix:**
1. Buscar el handler de `sheets-read` (probablemente en google-apps manifest o tools)
2. Si la llamada a Sheets API falla con error de rango ("Unable to parse range"):
   a. Automáticamente llamar a la lógica de `sheets-info` para obtener los nombres reales de las hojas
   b. Re-intentar con el nombre correcto de la primera hoja
   c. Retornar el resultado del retry + un hint: "Nota: el rango solicitado era inválido. Se usó {rango_correcto}."
3. Esto elimina un round-trip completo de tool call (ahorro de ~1-2s y tokens)
4. Log DEBUG con el rango original y el corregido

## Verificación post-fix

```bash
docker run --rm -v /docker/luna-repo:/app -w /app node:22-alpine npx tsc --noEmit
```

## Archivos de documentación a actualizar

- `src/modules/knowledge/CLAUDE.md` — documentar: category filtering (allowedCategoryIds), bulk train con content loading
- `src/extractors/CLAUDE.md` — documentar: YouTube adapter soporta OAuth access token
