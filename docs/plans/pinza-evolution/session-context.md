# Contexto de Sesión — Pinza Evolution

## Resumen ejecutivo

Evaluamos 3 codebases: **LUNA** (107K LOC, arquitectura modular elegante pero no funciona completa), **Pinza-Colombiana** (29K LOC, agente "Valeria" en producción para OneScreen Solutions), y **OpenClaw** (framework open-source de agentes IA). Conclusión: evolucionar Pinza como base porque ya funciona, traer módulos específicos de LUNA y patrones de OpenClaw.

## Decisiones tomadas

1. **Repo nuevo, un solo repo.** Mismo código para todos los tenants, config por tenant en `instance/{tenant}/`.

2. **Multi-tenancy = container por tenant.** Cada worker es un container Docker con el agente completo (Fastify + Baileys + Gmail + Twilio + agent loop + todo). Mismo Docker image, distinto volumen de config. Traefik rutea por dominio al worker correcto. NO hay gateway separado — cada worker recibe sus propios webhooks.

3. **Chatwoot desde día 1** como canal principal y dashboard para equipos humanos. Baileys (WA directo) y Gmail API como canales alternativos independientes — no conectados a Chatwoot, no son backup, son opciones paralelas que cada tenant activa según necesite.

4. **Infraestructura compartida:** PostgreSQL (con pgvector + RLS + tenant_id) y Redis (BullMQ con prefix por tenant). Chatwoot tiene su propia DB y Redis separados.

5. **Modelo Salesforce a tu escala:** DB compartida con tenant_id es la misma idea que usan los grandes. La diferencia es container-per-tenant (tú, 2-10 clientes) vs app compartida (ellos, 100K+ clientes). Si algún día necesitas migrar al modelo compartido, la capa de datos ya está lista.

6. **Desarrollo con agentes especializados** en entornos cloud de Anthropic: Explorer (Sonnet, lee y analiza), Planner (Opus, diseña sesiones), Executor (Sonnet, implementa una cosa), Auditor (Opus, revisa adversarialmente). Prompts copy-paste por rol. Git como bus de comunicación.

7. **OneScreen es el primer tenant** — siempre debe funcionar. El segundo tenant es el verdadero test de neutralidad.

## Qué traer de cada codebase

- **De Pinza:** todo el core funcional (queue 3 lanes, heartbeat 17 checks, conversation guard, tools + policy chain, subagents, alter-ego, circuit breaker, RAG con skills lazy-loading, workflows)
- **De LUNA:** output-sanitizer, email-triage, effort-router, normalizer, knowledge hybrid search (pgvector+FTS+RRF), HITL state machine, lead-scoring CHAMP/BANT, Cortex/Reflex monitoring
- **De OpenClaw:** Standing Orders (autoridad operativa en markdown), SOUL.md (personalidad estructurada), Dream system (consolidación de memoria), Active Memory (recall pre-respuesta), Heartbeat híbrido (determinístico + LLM), SKILL.md metadata mejorada

## Archivos en el repo

Todo está en `madl-droid/luna` branch `claude/diagnose-luna-issues-tA9h5`:

```
docs/plans/pinza-evolution/
  CLAUDE.md.template       ← CLAUDE.md para root del repo nuevo
  README.md                ← visión general del workflow multi-agente
  evolution-list.md        ← qué mejorar / traer / borrar (detallado)
  master-plan.md           ← 26 sesiones en 7 fases (NECESITA ACTUALIZAR: quitar gateway separado, workers como containers, Chatwoot día 1)
  prompts/                 ← prompts copy-paste por rol
  roles/                   ← reglas por rol
  scripts/                 ← setup de entornos
```

## Pendiente para la próxima sesión

- Actualizar `master-plan.md` y `CLAUDE.md.template` con las correcciones de arquitectura (sin gateway separado, workers = containers completos, Chatwoot día 1)
- Decidir si empezar con Explorer extrayendo los 4 quick-wins de LUNA o con S01 (crear repo + copiar core de Pinza)
