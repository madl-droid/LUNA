# Lista de Evolucion — Pinza → Plataforma Multi-Sector

## A. MEJORAR EN PINZA

| # | Que | Estado actual | Problema |
|---|-----|---------------|----------|
| M1 | Multi-tenancy | Single-instance OneScreen | No sirve para otro cliente sin fork |
| M2 | Busqueda semantica | Solo tsvector (keyword) | Para fidelidad a KB necesita vector search |
| M3 | Output sanitization | No existe | Tool call leakage y API keys pueden llegar al usuario |
| M4 | HITL formal | Escalamiento ad-hoc | Sin state machine, sin timeouts, sin supervisor chain |
| M5 | Queue persistente | In-memory (3 lanes) | Se pierde todo en restart |
| M6 | Tests | 12 archivos (solo libs) | Zero tests de pipeline, tools, heartbeat, RAG |
| M7 | Validacion webhooks | Minimal (solo Twilio firma) | Payloads de Baileys/Gmail sin schema validation |
| M8 | Multi-LLM gateway | Gemini directo + fallback manual | Sin abstraccion de provider unificada |
| M9 | Observabilidad | api-metrics in-memory + alter-ego | Sin metricas reales, sin tracing por request |
| M10 | Retry compartido | Cada servicio implementa el suyo | Duplicacion en gemini.ts, gmail.ts, google-auth.ts |

## B. TRAER DE LUNA

| # | Que | LOC | Portabilidad | Justificacion |
|---|-----|-----|-------------|---------------|
| L1 | output-sanitizer.ts | 70 | Copy-paste | Pinza no tiene NADA. 15 patrones de tool call leakage + API key redaction. Zero deps. |
| L2 | email-triage.ts | 114 | Copy-paste | Clasificador determinista pre-LLM. Ahorra tokens filtrando auto-replies, bounces, marketing. |
| L3 | effort-router.ts | 70 | Copy-paste | Routing por complejidad. Mensajes simples a Flash, complejos a Pro. Pinza manda todo igual. |
| L4 | normalizer.ts | 69 | Copy-paste | Normalizacion completa: unicode, surrogates, control chars. Pinza tiene version parcial. |
| L5 | knowledge/ (hybrid search) | ~7K | Medio | pgvector + FTS + RRF. Para KB fiel, busqueda semantica es obligatoria. |
| L6 | hitl/ (state machine) | ~2K | Medio | pending->notified->waiting->escalated->resolved. Supervisor chain. Timeouts por estado. |
| L7 | lead-scoring/ | ~1.5K | Alto | CHAMP/BANT determinista. Temporal decay. Configurable por framework. Zero LLM. |
| L8 | cortex/reflex | ~1.6K | Alto | 13 reglas de monitoreo code-driven. Complementa alter-ego con deteccion instantanea. |

## C. TRAER DE OPENCLAW

| # | Que | Tipo | Justificacion |
|---|-----|------|---------------|
| O1 | Standing Orders | Markdown convention | Define QUE puede hacer el agente sin permiso. Scope, triggers, gates, escalation. Hoy Pinza tiene esto hardcodeado en codigo. |
| O2 | SOUL.md estructura | Markdown convention | Pinza tiene identity.md pero sin Boundaries ni Continuity como concerns separados. |
| O3 | Dream system | Scheduled task + LLM | Pinza acumula memorias sin consolidar. Light (dedup), Deep (promover), REM (patrones). |
| O4 | Active Memory | Pre-response recall | Antes de responder, buscar memorias relevantes e inyectar. Pinza no hace recall activo. |
| O5 | Heartbeat hibrido | Patron complementario | Agregar paso LLM despues de los checks deterministicos del heartbeat actual. |
| O6 | SKILL.md metadata | Convention enhancement | Agregar requires, install specs, invocationPolicy al skill format existente de Pinza. |

## D. BORRAR / EXTRAER DE PINZA

### Extraer a template variables ({{VAR}})
- "Valeria West" (20+ locations) → `{{AGENT_NAME}}`, `{{AGENT_EMAIL}}`
- "OneScreen Solutions" (15+ locations) → `{{COMPANY_NAME}}`
- "@onescreensolutions.com" → config `INTERNAL_DOMAIN`
- "America/Bogota" (6 locations) → config `TIMEZONE`
- "felipe.martinez@..." (8+ locations) → config `DEMO_SPECIALIST_EMAIL`
- "pinza-caddy" (2 locations) → config `REVERSE_PROXY_CONTAINER`

### Renombrar en DB
- `interest_in_onescreen` → `product_interest` (migracion SQL, 10+ references)

### Eliminar defaults
- Sheet IDs de OneScreen en config.ts (son IDs reales de spreadsheets)
- Emails de empleados OneScreen como defaults en config.ts
- "ValeriaBot/1.0" user-agent → `{{AGENT_NAME}}Bot`
- Marketing claims ("+17,000 docentes") → mover a instance/knowledge/

### Mover a instance/onescreen/ (no eliminar, reubicar)
- identity.md, operations.md, skills/*.md, stages/*.md → son config de OneScreen
- workflows/*.json → son workflows de OneScreen
- subagent system prompts con "OneScreen" → template + instance override

## Orden sugerido de sesiones

### Fase 0: Setup (2 sesiones)
- S01: Crear repo nuevo, copiar core Pinza, verificar que compila
- S02: Extraer hardcoding OneScreen a template variables

### Fase 1: Quick wins de LUNA (4 sesiones)
- S03: Integrar output-sanitizer (L1)
- S04: Integrar email-triage (L2)
- S05: Integrar effort-router (L3)
- S06: Integrar normalizer mejorado (L4)

### Fase 2: Patrones OpenClaw (3 sesiones)
- S07: Standing Orders pattern (O1)
- S08: SOUL.md estructura (O2)
- S09: SKILL.md metadata mejorada (O6)

### Fase 3: Memoria y busqueda (4 sesiones)
- S10-S11: Knowledge hybrid search con pgvector (L5)
- S12: Active Memory pre-response (O4)
- S13: Dream system basico — Light phase (O3)

### Fase 4: Operaciones (4 sesiones)
- S14: HITL state machine (L6)
- S15: Lead scoring CHAMP/BANT (L7)
- S16: Cortex/Reflex monitoring (L8)
- S17: Heartbeat hibrido (O5)

### Fase 5: Infraestructura (3 sesiones)
- S18: Multi-LLM gateway (M8)
- S19: Queue persistente (M5)
- S20: Schema validation webhooks (M7)
