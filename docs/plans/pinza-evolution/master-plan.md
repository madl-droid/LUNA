# Plan Maestro: Pinza Evolution

## Vision

Plataforma multi-sector de agentes IA conversacionales.
Base: Pinza-Colombiana (funcional, probado).
Mejoras: LUNA (modulos), OpenClaw (patrones), Chatwoot (canal principal).

## Arquitectura target

```
                    ┌──────────────────┐
                    │     Chatwoot      │  canal principal (web, WA, email, etc)
                    │   (compartido)    │
                    └────────┬─────────┘
                             │ webhooks
                    ┌────────▼─────────┐
                    │   Gateway API     │  rutea por tenant, rate limit, auth
                    │   (compartido)    │
                    └────────┬─────────┘
                             │
              ┌──────────────┼──────────────┐
              ▼              ▼              ▼
        ┌──────────┐  ┌──────────┐  ┌──────────┐
        │ Worker 1 │  │ Worker 2 │  │ Worker N │   procesos aislados
        │ tenant A │  │ tenant B │  │ tenant N │   por empresa
        └────┬─────┘  └────┬─────┘  └────┬─────┘
             │              │              │
        ┌────▼──────────────▼──────────────▼────┐
        │         PostgreSQL + pgvector          │  compartido, RLS
        ├───────────────────────────────────────-┤
        │              Redis + BullMQ            │  compartido, prefix
        └───────────────────────────────────────-┘
```

## Estructura del repo

```
src/
  gateway/              ← HTTP server compartido (Fastify)
    routes/             ← webhook receivers, admin API
    middleware/         ← auth, tenant resolution, rate limit
  worker/               ← proceso por tenant
    bootstrap.ts        ← carga config de instance/{tenant}/
    agent-loop.ts       ← pipeline: intake → effort → agentic → sanitize → send
    heartbeat.ts        ← checks deterministicos + LLM hibrido
    queue/              ← execution queue (3 lanes: reactive/proactive/background)
  core/                 ← logica compartida (de Pinza, probada)
    llm/                ← multi-LLM gateway (Gemini, Anthropic, etc)
    memory/             ← 3-tier: contacts(T1) → summaries(T2) → messages(T3)
    knowledge/          ← hybrid search: pgvector + FTS + RRF (de LUNA)
    tools/              ← tool registry + policy chain
    rag/                ← prompt builder (XML sections)
    sanitizer/          ← output-sanitizer (de LUNA)
    scoring/            ← lead-scoring CHAMP/BANT (de LUNA)
    hitl/               ← state machine (de LUNA)
    monitoring/         ← reflex rules (de LUNA) + alter-ego (de Pinza)
  channels/             ← adaptadores de canal
    chatwoot/           ← canal principal (nuevo)
    baileys/            ← backup WhatsApp directo (de Pinza)
    twilio-voice/       ← voz (de Pinza)
    gmail/              ← email (de Pinza)
  lib/                  ← utilidades
    circuit-breaker.ts  ← (de Pinza)
    normalizer.ts       ← (de LUNA, mejorado)
    email-triage.ts     ← (de LUNA)
    effort-router.ts    ← (de LUNA)
    retry.ts            ← utility compartido (nuevo, reemplaza duplicacion)
instance/
  _template/            ← template vacio para nuevo cliente
    identity.md         ← SOUL.md estructura (de OpenClaw)
    standing-orders.md  ← autoridad operativa (de OpenClaw)
    skills/             ← skills con metadata mejorada (de OpenClaw)
    config.json         ← env vars del tenant
  onescreen/            ← primer tenant (config actual de Pinza)
    identity.md
    standing-orders.md
    skills/
    knowledge/
    config.json
tests/
  unit/                 ← tests por modulo
  adversarial/          ← tests del Auditor
  integration/          ← tests contra tenant real
migrations/             ← SQL numeradas
deploy/                 ← docker-compose + Traefik
```

## Orden de sesiones

### FASE 0: Fundacion (S01-S03)
Crear repo, copiar core de Pinza, verificar que funciona.

#### S01: Crear repo y copiar core
- Crear repo nuevo en GitHub
- Copiar de Pinza: queue/, lib/ (circuit-breaker, gemini, logger), services/ (rag, tools, memory, heartbeat, conversation-guard)
- Copiar: types, config (sin defaults OneScreen)
- Copiar: tests existentes (12 archivos)
- TEST: npx tsc --noEmit pasa, npm test pasa

#### S02: Estructura multi-tenant basica
- Crear gateway/ con Fastify + tenant resolution middleware
- Crear worker/ con bootstrap que lee instance/{tenant}/
- Agregar tenant_id a schema SQL (contacts, messages, interactions, etc)
- Mover config OneScreen a instance/onescreen/
- TEST: worker arranca con config de onescreen, compila

#### S03: Extraer hardcoding
- Template variables: {{AGENT_NAME}}, {{COMPANY}}, {{TIMEZONE}}, etc.
- Renombrar interest_in_onescreen → product_interest
- Eliminar defaults de Sheet IDs y emails de OneScreen
- Parametrizar subagent system prompts
- TEST: grep -r "OneScreen\|Valeria\|onescreensolutions" src/ devuelve 0

### FASE 1: Seguridad y eficiencia (S04-S07)
Quick wins de LUNA — bajo riesgo, alto impacto.

#### S04: Output sanitizer
- EXPLORER: extraer de LUNA (70 LOC, zero deps)
- EXECUTOR: crear src/core/sanitizer/, integrar en agent-loop despues de LLM response
- TEST: tool call leakage se detecta, API keys se redactan

#### S05: Email triage
- EXPLORER: extraer de LUNA (114 LOC, zero deps)
- EXECUTOR: crear src/lib/email-triage.ts, integrar en gmail intake
- TEST: auto-replies, bounces, marketing se filtran sin LLM

#### S06: Effort router
- EXPLORER: extraer de LUNA (70 LOC, zero deps)
- EXECUTOR: crear src/lib/effort-router.ts, integrar en agent-loop antes de LLM
- TEST: "hola" → Flash, pregunta compleja → Pro

#### S07: Normalizer mejorado
- EXPLORER: extraer de LUNA (69 LOC, zero deps)
- EXECUTOR: reemplazar normalizeForMatching() parcial de Pinza
- TEST: unicode, surrogates, control chars se normalizan

### FASE 2: Canal principal — Chatwoot (S08-S10)
Reemplazar Baileys como canal principal con Chatwoot.

#### S08: Chatwoot adapter basico
- Investigar Chatwoot webhook API y Agent Bot API
- Crear src/channels/chatwoot/adapter.ts
- Recibir mensajes de Chatwoot → pipeline → responder
- TEST: enviar mensaje en Chatwoot, recibir respuesta del agente

#### S09: Chatwoot features completos
- Typing indicators, attachments, contact sync
- Mapear contactos Chatwoot ↔ contacts table
- Conversation assignment (agent bot → humano via HITL)
- TEST: adjunto llega, se procesa, respuesta incluye contexto

#### S10: Baileys como backup
- Mover Baileys a channel secundario (fallback si Chatwoot se cae)
- Compartir pipeline — solo cambia el adapter de I/O
- TEST: desconectar Chatwoot, mensaje por Baileys sigue funcionando

### FASE 3: Identidad y autonomia — Patrones OpenClaw (S11-S13)

#### S11: Standing Orders
- Crear formato standing-orders.md en instance/{tenant}/
- Inyectar en system prompt via rag.ts
- Crear template con SO basicas (respond support, follow-up leads)
- Llenar instance/onescreen/ con SOs actuales de Pinza (hoy hardcoded)
- TEST: cambiar una SO en el .md, reiniciar, agente sigue la nueva regla

#### S12: SOUL.md estructura
- Evolucionar identity.md a formato SOUL.md (Core Truths, Boundaries, Vibe, Continuity)
- Migrar identity.md de OneScreen al nuevo formato
- Crear _template/identity.md vacio con secciones
- TEST: crear identity para tenant ficticio, agente responde en el tono correcto

#### S13: Skill metadata mejorada
- Agregar requires, install, invocationPolicy al formato .md de skills
- Pre-filtrar skills por config del tenant
- Crear template de skill con metadata completa
- TEST: skill con requires faltante no se carga

### FASE 4: Memoria inteligente (S14-S17)

#### S14-S15: Knowledge hybrid search (pgvector)
- Instalar pgvector extension
- Portar search-engine.ts de LUNA (RRF: vector 0.6 + FTS 0.3 + FAQ 0.1)
- Portar chunker.ts y embeddings service
- Crear tabla knowledge_chunks con vector column
- Integrar en RAG pipeline
- TEST: buscar "pantallas para salas de reunion" devuelve resultados semanticos (no solo keyword match)

#### S16: Active Memory (pre-response recall)
- Antes de LLM call, buscar en interaction_summaries + knowledge
- Inyectar memorias relevantes como contexto
- Configurable por tenant (enabled, query mode, max results)
- TEST: preguntar algo que el agente discutio hace 2 semanas, lo recuerda

#### S17: Dream system (Light phase)
- Scheduled task: cada 6h, consolidar memorias recientes
- Dedup interaction_summaries similares
- Actualizar importance scores
- TEST: despues de dream, summaries duplicados se mergean

### FASE 5: Operaciones (S18-S21)

#### S18: HITL state machine
- Portar de LUNA: pending→notified→waiting→escalated→resolved
- Integrar con Chatwoot conversation assignment
- Supervisor chain configurable por tenant
- TEST: agente escala, humano responde en Chatwoot, agente retoma

#### S19: Lead scoring
- Portar CHAMP/BANT deterministico de LUNA
- Config por tenant en instance/{tenant}/qualifying.json
- Temporal decay, threshold-based tiers
- TEST: lead con budget+authority+need = hot, sin nada = cold

#### S20: Reflex monitoring
- Portar 13 reglas de monitoreo de LUNA cortex
- Alertas via Chatwoot (channel interno de ops) o email
- Complementar alter-ego existente
- TEST: simular circuit breaker open → alerta llega

#### S21: Heartbeat hibrido
- Mantener checks deterministicos de Pinza (17 checks)
- Agregar paso LLM al final para follow-ups creativos
- Configurable por tenant (solo deterministico o hibrido)
- TEST: heartbeat corre, checks pasan, LLM sugiere follow-up

### FASE 6: Infraestructura (S22-S24)

#### S22: Multi-LLM gateway
- Abstraer Gemini/Anthropic tras interfaz unificada
- Circuit breaker por provider
- Fallback chain configurable por tenant
- TEST: desactivar Gemini, cae a Anthropic sin interrupcion

#### S23: Queue persistente
- Migrar execution queue de in-memory a BullMQ + Redis
- Mantener 3 lanes (reactive/proactive/background)
- Jobs sobreviven restart
- TEST: matar proceso, reiniciar, jobs pendientes se ejecutan

#### S24: Webhook validation + retry utility
- Zod schemas para payloads de Chatwoot, Twilio, Gmail
- Utility de retry compartido (reemplazar duplicacion)
- TEST: payload invalido → 400 con error descriptivo

### FASE 7: Segundo tenant (S25-S26)
El verdadero test de multi-tenancy.

#### S25: Onboarding tenant 2
- Crear instance/clinica-demo/ con identity, skills, knowledge diferentes
- Levantar segundo worker
- Configurar inbox en Chatwoot
- TEST: enviar mensaje al tenant 2, responde con su personalidad, no la de OneScreen

#### S26: Aislamiento verificado
- Verificar que tenant 1 no ve datos de tenant 2
- Verificar que crash de worker 1 no afecta worker 2
- Verificar que knowledge search es por tenant
- TEST: buscar producto de OneScreen desde tenant 2 → 0 resultados

## Estimacion

| Fase | Sesiones | Semanas | Costo agentes (~) |
|------|----------|---------|-------------------|
| 0: Fundacion | 3 | 1-2 | $40 |
| 1: Quick wins LUNA | 4 | 1 | $50 |
| 2: Chatwoot | 3 | 2 | $60 |
| 3: OpenClaw patterns | 3 | 1 | $40 |
| 4: Memoria | 4 | 2-3 | $70 |
| 5: Operaciones | 4 | 2 | $60 |
| 6: Infraestructura | 3 | 1-2 | $50 |
| 7: Multi-tenant test | 2 | 1 | $30 |
| **TOTAL** | **26** | **~12-14** | **~$400** |

A ritmo de 1h/dia (honeymoon mode): ~2 sesiones por semana → 13 semanas.
A ritmo normal (3-4h/dia): ~1 sesion por dia → 5-6 semanas.

## Principios inquebrantables

1. **Nunca a mas de 1 sesion de un sistema que funciona**
2. **OneScreen es el primer tenant — siempre debe funcionar**
3. **Cada sesion: compila + tests + commit**
4. **Explorer y Executor nunca son la misma sesion**
5. **Auditor revisa CADA PR antes de merge**
6. **El segundo tenant es el verdadero test de neutralidad**
