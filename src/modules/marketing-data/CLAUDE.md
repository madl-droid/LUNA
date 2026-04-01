# Marketing Data — Gestion de campanas de marketing

Modulo independiente de campanas: CRUD, tags, fuzzy matching, stats de conversion. Extraido de lead-scoring para desacoplar funcionalidad.

## Archivos
- `manifest.ts` — lifecycle, servicios, API routes, console SSR
- `campaign-types.ts` — CampaignRecord, CampaignTag, CampaignMatchResult, ContactCampaignEntry, CampaignStatRow
- `campaign-queries.ts` — CRUD campanas, tags, contact-campaign history, stats (PostgreSQL)
- `campaign-matcher.ts` — fuse.js fuzzy matching de keywords contra texto entrante
- `templates.ts` — SSR HTML: tabs (campanas, tags, stats), modals CRUD, JS inline

## Manifest
- type: `feature`, removable: true, activateByDefault: true
- depends: `[]` (sin dependencias)
- console: group `modules`, order 16

## Servicios registrados
- `marketing-data:campaign-queries` — instancia de CampaignQueries
- `marketing-data:match-campaign` — funcion de matching (text, channel, type, round) -> CampaignMatchResult | null
- `marketing-data:reload-campaigns` — recarga indice del matcher
- `marketing-data:renderSection` — render SSR para consola

## API Routes (montadas en /console/api/marketing-data/)
- Campanas: `GET campaigns`, `GET campaign?id=X`, `POST campaign`, `PUT campaign`, `DELETE campaign?id=X`
- Tags: `GET tags?type=`, `POST tag`, `PUT tag`, `DELETE tag?id=X`
- Stats: `GET campaign-stats`, `GET contact-campaigns?contactId=X`

## Tablas (creadas en ensureTables)
- `campaigns` — campanas con keyword, threshold, channels, utm_data
- `campaign_tags` — tags de plataforma y fuente
- `campaign_tag_assignments` — join table campana-tag
- `contact_campaigns` — historial de matching contacto-campana

## Consumidores
- Engine Phase 1: `marketing-data:match-campaign` para detectar campana
- Engine Phase 5: `marketing-data:campaign-queries` para registrar match
- Users webhook: `marketing-data:campaign-queries` para registrar campana de webhook

## Trampas
- Las tablas son las mismas que usaba lead-scoring — no hay migracion necesaria
- Helpers HTTP: usa jsonResponse, parseBody, parseQuery de kernel/http-helpers.js
- El matcher se recarga automaticamente al crear/editar/eliminar campanas
