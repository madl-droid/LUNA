# Lead Scoring — Sistema de calificacion de leads

Califica leads usando frameworks predefinidos (CHAMP B2B, SPIN B2C, CHAMP+Gov B2G) o criterios custom. Extraccion natural por LLM, scoring por codigo, UI personalizable en console.

## Archivos
- `manifest.ts` — lifecycle, configSchema, console (fields + apiRoutes), servicios, campaign init, webhook init
- `types.ts` — FrameworkType, FrameworkStage, QualifyingConfig, ScoreResult, AutoSignalDefinition, LeadSummary (con campaña)
- `frameworks.ts` — presets CHAMP, SPIN, CHAMP+Gov con stages, criterios y disqualify reasons
- `scoring-engine.ts` — motor de scoring: calcula puntos por stage, transiciones, merge de datos, getCurrentStage()
- `config-store.ts` — lee/escribe instance/qualifying.json, hot-reload, applyFramework(), validacion
- `extract-tool.ts` — tool `extract_qualification` con prompts conscientes de framework/stage
- `pg-queries.ts` — queries: listar leads (con ultima campaña), detalle, actualizar score, recalcular batch, stats
- `templates.ts` — SSR HTML: selector de framework, criterios agrupados por stage, auto signals
- `campaign-types.ts` — tipos: CampaignRecord, CampaignTag, CampaignMatchResult, CampaignStatRow
- `campaign-queries.ts` — CRUD campañas, tags, contact-campaign history, stats (entries+conversiones)
- `campaign-matcher.ts` — fuse.js fuzzy matching con filtros de canal, ronda, y retry
- `webhook-handler.ts` — webhook de registro de leads: auth, validacion, upsert contacto, atribución campaña, outbound

## Manifest
- type: `feature`, removable: true, activateByDefault: true
- depends: `['tools']`
- configSchema: LEAD_SCORING_CONFIG_PATH, LEAD_WEBHOOK_ENABLED, LEAD_WEBHOOK_TOKEN, LEAD_WEBHOOK_PREFERRED_CHANNEL

## Servicios registrados
- `lead-scoring:config` — instancia de ConfigStore
- `lead-scoring:queries` — instancia de LeadQueries
- `lead-scoring:campaign-queries` — instancia de CampaignQueries (CRUD campañas, tags, stats)
- `lead-scoring:match-campaign` — funcion (text, channelName, channelType, roundNumber) => CampaignMatchResult | null
- `lead-scoring:reload-campaigns` — recarga indice del matcher

## Hook consumido
- `console:config_applied` — recarga qualifying.json, recalcula scores si config cambio

## Hook emitido
- `contact:status_changed` — cuando cambia qualification_status de un lead

## Frameworks disponibles
- `champ` — B2B: Challenges, Authority, Money, Prioritization (16 criterios, 4 stages)
- `spin` — B2C: Situation, Problem, Implication, Need-payoff (16 criterios, 4 stages)
- `champ_gov` — B2G: CHAMP + Process Stage + Compliance Fit (24 criterios, 6 stages)
- `custom` — criterios manuales sin framework (backward compatible con BANT)

## Tool registrada
- `extract_qualification` — extrae datos del mensaje via LLM, consciente del framework y stage actual

## API routes (montadas en /console/api/lead-scoring/)
- `GET /config` — config actual de qualifying.json
- `PUT /config` — guardar config nueva
- `POST /apply-framework` — aplicar un framework preset (reemplaza criterios)
- `GET /frameworks` — listar presets disponibles
- `POST /recalculate` — recalcular scores de todos los leads
- `GET /stats` — estadisticas por status
- `GET /leads?status=X&search=Y&campaignId=X&limit=50&offset=0&sort=score&dir=desc` — lista paginada (con ultima campaña)
- `GET /lead?id=X` — detalle de lead (canales, mensajes, datos)
- `PUT /lead-status` — cambiar status manualmente
- `POST /disqualify` — descalificar lead con motivo
- `GET /ui` — servir HTML de la tab
- **Campañas:**
- `GET /campaigns` — listar todas con tags
- `GET /campaign?id=X` — detalle
- `POST /campaign` — crear (name, keyword, matchThreshold, matchMaxRounds, allowedChannels, promptContext, tagIds)
- `PUT /campaign` — actualizar
- `DELETE /campaign?id=X` — eliminar
- **Tags:**
- `GET /tags?type=platform|source` — listar
- `POST /tag` — crear (name, tagType, color)
- `PUT /tag` — renombrar/cambiar color
- `DELETE /tag?id=X` — eliminar
- **Stats:**
- `GET /campaign-stats` — entries + conversiones por campaña + "sin campaña"
- `GET /contact-campaigns?contactId=X` — historial de campañas de un contacto
- **Webhook:**
- `POST /webhook` — registrar lead externo (auth: Bearer token, body: {email?, phone?, name?, campaign})
- `GET /webhook-stats` — estadisticas del webhook (éxitos, errores, sin campaña)
- `GET /webhook-log?limit=50&offset=0` — log de intentos del webhook
- `POST /webhook-regenerate-token` — regenerar token de autorización

## Campañas — subsistema de tracking
- 1 keyword por campaña (frase de matching, puede estar dentro de un párrafo)
- ID visible autoincramental (1, 2, 3...)
- promptContext: frase corta (max 200 chars), default = keyword. Se inyecta al LLM compositor
- Tags: platform y source (M:N). Cada tag tiene nombre, tipo y color (paleta clara)
- Matching: fuse.js con ignoreLocation, threshold 95% default, retry en error
- NO match en canales de voz (channelType === 'voice')
- Solo en las primeras N rondas (matchMaxRounds, 1-3, default 1)
- allowedChannels: filtro por canal (vacío = todos los no-voz)
- contact_campaigns: historial de todas las campañas de un contacto
- Conversión atribuida a la ÚLTIMA campaña
- Stats: entries (contactos únicos) + conversiones por campaña + "sin campaña"

## Webhook de registro de leads
- Endpoint externo: `POST /console/api/lead-scoring/webhook`
- Auth: `Authorization: Bearer <token>` (token visible en config de la console)
- Body: `{ email?, phone?, campaign, name? }` — campaign es keyword, visible_id o UUID
- Validación: al menos email o phone; campaign obligatorio (si no match → registra sin campaña + warning)
- Crea o encuentra contacto existente (unificación cross-channel por email/phone)
- Marca metadata `source: "webhook-outbound"` automáticamente
- Atribuye campaña si keyword válida, sino cuenta como "sin campaña"
- Dispara `message:send` en el canal preferido (configurable: auto/whatsapp/email/google-chat)
- Canal auto: prefiere WhatsApp si hay phone, luego email si hay email
- Token auto-generado al iniciar módulo, regenerable desde console
- Config en console.fields: toggle, token (secret), canal preferido
- Log de intentos en tabla `webhook_lead_log`

## Tablas DB del subsistema de campañas
- `campaigns` — tabla base (existente) + columnas nuevas: visible_id, match_max_rounds, allowed_channels, prompt_context, updated_at
- `campaign_tags` — tags de plataforma y fuente (id, name, tag_type, color)
- `campaign_tag_assignments` — join M:N (campaign_id, tag_id)
- `contact_campaigns` — historial contact↔campaign (contact_id, campaign_id, session_id, channel, score, matched_at)
- `webhook_lead_log` — log de registros via webhook (email, phone, campaign_keyword, contact_id, success, error)

## Integracion con pipeline
- Phase 1: `detectCampaign()` llama `lead-scoring:match-campaign` (después de cargar sesión)
- Phase 3: tool `extract_qualification` se ejecuta cuando el evaluador detecta info relevante
- Phase 4: compositor inyecta `promptContext` de la campaña detectada
- Phase 5: `recordMatch()` persiste el match en `contact_campaigns` (fire-and-forget)
- Phase 5: transicion automatica `new → qualifying` en primera interaccion

## Patrones
- Scoring es 100% codigo — LLM extrae, codigo decide
- Weights se normalizan a 100 si no suman 100
- Enum scoring: opciones ordenadas de peor a mejor (indice/total)
- `_disqualified` en qualification_data = lead descalificado
- `_confidence` en qualification_data = tracking de confianza por campo
- Recalculacion batch usa transaccion SQL
- getCurrentStage() determina la etapa con campos pendientes para enfocar extraccion
- Auto signals: senales calculadas por codigo (engagement, geo, canal, historial, horario), peso configurable

## Trampas
- Config se guarda en instance/qualifying.json (archivo JSON), NO en .env
- Max 10 criterios para custom framework; presets no tienen limite
- Tool solo se registra si modulo tools esta activo (depends: ['tools'])
- Al aplicar framework preset se reemplazan criterios y disqualifyReasons pero se conservan thresholds y actions
- Configs viejas sin campo `framework` se migran automaticamente a `framework: 'custom'`
- **Helpers HTTP y config**: usa `jsonResponse`, `parseBody`, `parseQuery` de `kernel/http-helpers.js`. NO redefinir localmente.
