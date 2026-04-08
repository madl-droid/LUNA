# Marketing Data — Gestion de campanas de marketing

Modulo de campanas con deteccion dual (UTM + keyword), auto-creacion desde UTMs, metricas desglosadas por fuente, y tags de categorización.

## Archivos
- `manifest.ts` — lifecycle, servicios, API routes, console SSR, config toggles
- `campaign-types.ts` — CampaignRecord, UtmParams, CampaignMatchResult, stats types (incluye SourceBreakdown, UtmBreakdown, CampaignDetailedStats)
- `campaign-queries.ts` — CRUD campanas, tags, contact-campaign history, stats desglosadas
- `campaign-matcher.ts` — keyword fuzzy match (fuse.js) + UTM campaign lookup/auto-create
- `utm-parser.ts` — extraccion de UTMs de URLs en texto, normalizacion
- `templates.ts` — SSR HTML: tabs (campanas, tags, stats), modals, settings panel, JS inline

## Deteccion de campanas (prioridad)
1. **UTM match** (si habilitado): parsea URLs en mensaje o utm en webhook → busca/auto-crea campana por utm_campaign
2. **Keyword match** (si habilitado, solo si UTM no matcheo): fuzzy match fuse.js contra texto
3. **UTM SIEMPRE GANA sobre keyword**

## Auto-creacion
Cuando llega un utm_campaign sin campana existente, se auto-crea con origin='auto_utm'. Badge visible en consola.

## Config toggles (env vars)
- `CAMPAIGN_UTM_MATCH_ENABLED` (default true)
- `CAMPAIGN_KEYWORD_MATCH_ENABLED` (default true)

## Servicios registrados
- `marketing-data:campaign-queries` — instancia de CampaignQueries
- `marketing-data:match-campaign` — keyword match (sync)
- `marketing-data:match-campaign-utm` — UTM match (async, con auto-create)
- `marketing-data:reload-campaigns` — recarga indice del matcher
- `marketing-data:renderSection` — render SSR para consola

## API Routes (montadas en /console/api/marketing-data/)
- Campanas: `GET campaigns`, `GET campaign?id=X`, `POST campaign`, `PUT campaign`, `DELETE campaign?id=X`
- Tags: `GET tags?type=`, `POST tag`, `PUT tag`, `DELETE tag?id=X`
- Stats: `GET campaign-stats`, `GET campaign-detailed-stats`, `GET utm-breakdown`, `GET contact-campaigns?contactId=X`
- Config: `GET config`

## Tablas
- `campaigns` — campanas con keyword, utm_keys[], origin, threshold, channels
- `campaign_tags` — tags de plataforma y fuente
- `campaign_tag_assignments` — join table campana-tag
- `contact_campaigns` — historial con match_source y utm_data JSONB

## Metricas
- Entries + conversiones por campana (last-touch attribution)
- First-touch attribution
- Breakdown por match_source (keyword/url_utm/webhook/webhook_utm)
- Breakdown por UTM source/medium (global y por campana)

## Trampas
- keyword es OPCIONAL en campanas (las auto-creadas no tienen)
- utm_keys[] es un array: una campana puede tener multiples utm_campaign values
- Auto-creacion usa ON CONFLICT para evitar race conditions
- Toggles son readonly en consola (env vars, requieren reinicio)
- moduleConfig se asigna en init() y los handlers de API lo capturan via closure
