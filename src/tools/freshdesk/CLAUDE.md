# Freshdesk KB — Tools de Knowledge Base

Tools `freshdesk_get_article` y `freshdesk_search`: acceso a la Knowledge Base de Freshdesk para soporte técnico.

## Archivos
- `types.ts` — interfaces: API responses, metadata cache, tool outputs, module config, Phase 1 match
- `freshdesk-client.ts` — cliente HTTP para Freshdesk API (Basic Auth, rate limit aware, 15s timeout)
- `freshdesk-get-article.ts` — tool: obtiene artículo completo por ID (cache Redis 24h TTL)
- `freshdesk-search.ts` — tool: busca artículos por keyword via API (sin cache de búsquedas)
- `freshdesk-sync.ts` — job de sync: baja metadata de artículos publicados a Redis
- `freshdesk-rag.ts` — búsqueda fuse.js sobre índice de metadata (Phase 1 integration)

## Config
- Credenciales via env: FRESHDESK_DOMAIN, FRESHDESK_API_KEY
- Sync: FRESHDESK_SYNC_ENABLED, FRESHDESK_SYNC_CRON (default: domingos 1AM)
- Cache: FRESHDESK_CACHE_TTL_HOURS (default: 24)
- Filtro: FRESHDESK_CATEGORIES (IDs comma-separated, vacío = todas)

## Redis keys
- `freshdesk:index` — JSON array de FreshdeskArticleMeta (metadata de todos los artículos publicados)
- `freshdesk:sync_at` — timestamp ISO del último sync
- `freshdesk:article:{id}` — artículo completo cacheado (TTL configurable, default 24h)

## Flujo
1. Sync semanal → metadata en Redis (`freshdesk:index`)
2. Phase 1: fuse.js busca en índice → FreshdeskMatch[] en ContextBundle
3. Phase 2: evaluador ve matches, puede planificar `freshdesk_get_article` o `freshdesk_search`
4. Phase 3: tool ejecuta, cachea artículo completo en Redis
5. Phase 4: compositor usa contenido del artículo para responder

## Patrones
- Auth Freshdesk: Basic Auth con `{apiKey}:X` en base64
- Rate limit: max 100 calls/min interno + monitoreo de header X-Ratelimit-Remaining
- Sync idempotente: reemplaza índice completo, no merge
- Si sync falla: no borra cache existente, logea error
- Cache stale >14 días: logea WARNING

## Trampas
- La API de Freshdesk pagina artículos de 30 en 30
- Solo artículos con status=2 (published) se sincronizan
- `description_text` es el texto plano; `description` es HTML
- Búsquedas no se cachean (keywords varían mucho); artículos individuales sí
