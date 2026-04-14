# Hoja de Ruta: OpenClaw + Módulos LUNA + Chatwoot

> Fecha: 2026-04-14
> Decisión: OpenClaw como núcleo agentico, módulos LUNA portados como plugins, Chatwoot como canal principal
> Restricción: ~1 hora/día disponible

---

## Corrección importante sobre OpenClaw

Mi evaluación inicial estaba incompleta. Después de explorar los ~14,000 archivos del repo, OpenClaw es **mucho más sofisticado** de lo que pensaba:

- **NO es solo Markdown para memoria** — tiene `memory-lancedb` (embeddings vectoriales con LanceDB), `memory-wiki` (knowledge vault Obsidian-compatible), `active-memory` (sub-agente blocking de recall), y un sistema de "dreaming" (consolidación Light/Deep/REM)
- **Búsqueda híbrida ya existe** — 70% vector + 30% FTS, con temporal decay y MMR
- **111 extensiones** empaquetadas — incluyendo WhatsApp (Baileys), voice-call, webhooks
- **Plugin SDK maduro** — `openclaw.plugin.json` + `ChannelPlugin` interface con adapters tipados
- **247K GitHub stars** — ecosistema activo con 200+ contributors

Esto significa que hay **menos que portar de lo que pensaba**, pero lo que sí necesita LUNA son las piezas de **dominio empresarial** que OpenClaw no tiene.

---

## Lo que OpenClaw ya tiene (no portar)

| Capacidad | OpenClaw | Nota |
|-----------|----------|------|
| Proactividad | HEARTBEAT.md + Cron + Standing Orders | Mejor que LUNA |
| Personalidad | SOUL.md (per-agent) | Elegante y funcional |
| Memoria base | Markdown + SQLite + embeddings | Funcional |
| Búsqueda vectorial | memory-lancedb (LanceDB) | Multi-provider embeddings |
| Memory recall | active-memory (sub-agente blocking) | Pre-respuesta |
| Consolidación | Dream system (Light/Deep/REM) | Automático |
| WhatsApp | Baileys (bundled extension) | Ya funciona |
| Voice | voice-call extension | Base existente |
| Routing | Hierarchical binding matching | Sofisticado |
| Tool calling | AgentTool + Factory pattern | Funcional |
| Context engine | Pluggable via registry | Extensible |

## Lo que LUNA tiene y OpenClaw necesita (portar)

| Módulo LUNA | ¿Por qué se necesita? | Forma en OpenClaw |
|---|---|---|
| `knowledge/` | Knowledge base empresarial: docs, FAQs, chunking, búsqueda híbrida, knowledge mandate | Plugin con PG + pgvector |
| `hitl/` | Escalamiento a humanos: state machine, supervisor chain | Plugin + Standing Orders |
| `medilink/` | Integración HealthAtom: pacientes, citas, disponibilidad | Plugin con tools |
| `freight/` | Estimación de flete: SeaRates + DHL | Skill + Tool |
| `freshdesk/` | Knowledge base Freshdesk: búsqueda, artículos | Skill + Tool |
| `templates/` | Plantillas: comparativos, cotizaciones, presentaciones | Skill + Tool |
| `lead-scoring/` | Calificación BANT/CHAMP, scoring zero-LLM | Plugin con hook |
| `output-sanitizer` | Prevención de leakage de tool calls, redacción de API keys | Hook plugin |
| `email-triage` | Clasificación determinística de emails | Hook plugin |
| `normalizer` | Unicode cleanup, truncation | Utilidad compartida |
| Canal Chatwoot | Canal principal para operaciones | Channel plugin nuevo |
| Twilio Voice | Llamadas de voz con Gemini Live | Extender voice-call |

---

## Arquitectura objetivo

```
┌─────────────────────────────────────────────────────┐
│                    OpenClaw Core                     │
│  Gateway ← → Routing ← → Agent (SOUL.md)           │
│  HEARTBEAT.md + Cron + Standing Orders              │
│  Context Engine + Memory (LanceDB/Wiki/Active)      │
└─────────────┬───────────────────────┬───────────────┘
              │                       │
    ┌─────────┴─────────┐   ┌───────┴────────┐
    │   Channel Plugins  │   │  Business Plugins │
    │                    │   │  (from LUNA)       │
    │ • Chatwoot (nuevo) │   │ • knowledge-pg     │
    │ • WhatsApp         │   │ • hitl-manager     │
    │ • Twilio Voice     │   │ • lead-scoring     │
    │ • Baileys (backup) │   │ • output-guard     │
    └────────────────────┘   │ • email-triage     │
                             └───────┬────────────┘
                                     │
                            ┌────────┴────────┐
                            │  Domain Skills   │
                            │  (from LUNA)     │
                            │ • medilink       │
                            │ • freight        │
                            │ • freshdesk-kb   │
                            │ • templates      │
                            └─────────────────┘
```

---

## Fases detalladas

### Fase 0 — Setup (1-2 días)

**Objetivo:** OpenClaw corriendo local con SOUL.md personalizado

| # | Tarea | Tiempo | Detalle |
|---|-------|--------|---------|
| 0.1 | Fork openclaw/openclaw | 15 min | Fork propio para customización |
| 0.2 | Setup local (Docker o Node) | 30 min | `pnpm install && pnpm build` |
| 0.3 | Conectar LLM provider | 15 min | Anthropic Claude como provider principal |
| 0.4 | Crear SOUL.md empresarial | 30 min | Personalidad de agente de ventas/atención |
| 0.5 | Crear AGENTS.md con Standing Orders | 30 min | Reglas de operación para empresa #1 |
| 0.6 | Crear HEARTBEAT.md inicial | 15 min | Checklist proactivo básico |
| 0.7 | Test: chat básico funciona | 15 min | Validar que responde con personalidad |

**Entregable:** OpenClaw corriendo, respondiendo con personalidad empresarial.

---

### Fase 1 — Canal Chatwoot (1 semana, ~7 horas)

**Objetivo:** Chatwoot como canal principal del agente

**Referencia:** OpenClaw channel plugin interface (`ChannelPlugin` en `src/channels/plugins/types.plugin.ts`)

| # | Tarea | Tiempo | Detalle |
|---|-------|--------|---------|
| 1.1 | Crear `extensions/chatwoot/` | 15 min | Estructura: `openclaw.plugin.json`, `index.ts`, `src/` |
| 1.2 | Config adapter | 30 min | URL de Chatwoot, API token, account ID |
| 1.3 | Webhook inbound | 1.5h | Recibir `message_created` events, parsear, dispatch |
| 1.4 | API outbound | 1h | Enviar mensajes via Chatwoot API v1 |
| 1.5 | Session routing | 1h | Mapear conversation_id → session key |
| 1.6 | Media handling | 1h | Attachments in/out via Chatwoot API |
| 1.7 | Directory adapter | 30 min | Listar contactos/conversaciones |
| 1.8 | Test E2E | 1h | Mensaje in → respuesta out via Chatwoot |

**Interfaz de Chatwoot:**
```
Webhook IN:  POST /webhooks/chatwoot/:token  ← message_created events
API OUT:     POST /api/v1/accounts/{id}/conversations/{conv}/messages
```

**Entregable:** Agente responde por Chatwoot con personalidad SOUL.md.

---

### Fase 2 — Knowledge Base empresarial (1 semana, ~7 horas)

**Objetivo:** Agente fiel a su base de conocimiento, sin alucinaciones

**Decisión clave:** OpenClaw ya tiene `memory-lancedb` y `memory-wiki`, pero son memoria conversacional, NO knowledge base empresarial. Necesitamos un plugin dedicado.

**Opciones:**
- **A) Extender memory-wiki** — Ingestar docs empresariales en el vault Obsidian
- **B) Plugin `knowledge-pg` nuevo** — Portar la lógica de LUNA con PG + pgvector
- **C) Hybrid** — memory-wiki para docs generales + knowledge mandate en AGENTS.md

**Recomendación: Opción C primero, B después si necesitas más control.**

| # | Tarea | Tiempo | Detalle |
|---|-------|--------|---------|
| 2.1 | Knowledge mandate en AGENTS.md | 30 min | Reglas: "solo responde con info verificada" |
| 2.2 | Configurar memory-wiki | 1h | Vault con docs de producto/servicio |
| 2.3 | Ingestar documentos empresariales | 1h | Cargar FAQs, catálogos, políticas |
| 2.4 | Configurar active-memory | 30 min | Sub-agente de recall con promptStyle: "strict" |
| 2.5 | Configurar memory-lancedb embeddings | 30 min | Embeddings para búsqueda semántica |
| 2.6 | Test: preguntas de producto | 1h | Verificar que responde con info correcta |
| 2.7 | Test: preguntas fuera de scope | 30 min | Verificar que NO alucina |
| 2.8 | Ajustar SOUL.md anti-hallucination | 30 min | Reforzar: "nunca inventes datos" |
| 2.9 | Standing Order: knowledge refresh | 30 min | Auto-sync periódico de docs |

**Entregable:** Agente responde con info verificada de la knowledge base.

---

### Fase 3 — Output Guard + Email Triage (3-4 días, ~4 horas)

**Objetivo:** Proteger salida del agente y clasificar emails

Estos son módulos pequeños y determinísticos de LUNA que se portan directamente.

| # | Tarea | Tiempo | Detalle |
|---|-------|--------|---------|
| 3.1 | Plugin `output-guard` | 1.5h | Hook `reply-dispatch` que valida output antes de enviar |
| 3.2 | Portar `validateOutput()` de LUNA | 30 min | Tool call leakage, API key redaction |
| 3.3 | Portar `sanitizeParts()` de LUNA | 15 min | Multi-part sanitization |
| 3.4 | Plugin `email-triage` (si Gmail activo) | 1h | Hook inbound para clasificar emails |
| 3.5 | Portar `classifyEmailTriage()` | 30 min | Auto-reply, DSN, CC-only, empty body |
| 3.6 | Tests | 30 min | Reusar tests de LUNA adaptados |

**Código fuente LUNA:**
- `src/engine/output-sanitizer.ts` — `validateOutput()`, `sanitizeParts()`
- `src/engine/agentic/email-triage.ts` — `classifyEmailTriage()`

**Entregable:** Respuestas sanitizadas, emails triageados automáticamente.

---

### Fase 4 — HITL (Human-in-the-Loop) (1 semana, ~5 horas)

**Objetivo:** Escalamiento a humanos cuando el agente no puede resolver

**Approach:** Combinar HITL state machine de LUNA con Standing Orders de OpenClaw.

| # | Tarea | Tiempo | Detalle |
|---|-------|--------|---------|
| 4.1 | Standing Order de escalamiento | 30 min | En AGENTS.md: reglas de cuándo escalar |
| 4.2 | Plugin `hitl-manager` | 1.5h | State machine: pending → notified → waiting → resolved |
| 4.3 | Integrar con Chatwoot HITL nativo | 1h | Chatwoot ya tiene handoff a agentes humanos |
| 4.4 | Tool `escalate-to-human` | 30 min | Tool que el agente puede invocar |
| 4.5 | Tool `consult-human` | 30 min | Consulta sin transferir |
| 4.6 | Timeout y auto-resolve | 30 min | Si humano no responde en X tiempo |
| 4.7 | Test E2E | 30 min | Escenario: agente escala, humano resuelve |

**Ventaja Chatwoot:** Ya tiene assignment de conversaciones a agentes humanos. Solo necesitamos triggerearlo via API.

**Entregable:** Agente puede escalar a humanos cuando necesita ayuda.

---

### Fase 5 — Tools de negocio (1-2 semanas, ~10 horas)

**Objetivo:** Tools específicas de cada empresa como plugins/skills

Cada tool de LUNA se convierte en un plugin de OpenClaw con `api.registerTool()`.

| # | Tarea | Tiempo | Detalle |
|---|-------|--------|---------|
| 5.1 | Plugin `medilink` | 2h | Tools: buscar paciente, check disponibilidad, agendar cita |
| 5.2 | Plugin `freight` | 1.5h | Tools: estimar flete SeaRates + DHL |
| 5.3 | Plugin `freshdesk-kb` | 1.5h | Tools: buscar artículos, get detail |
| 5.4 | Plugin `templates` | 1.5h | Skills: generar comparativo, cotización |
| 5.5 | Plugin `lead-scoring` | 1.5h | Hook: scoring BANT/CHAMP en cada mensaje |
| 5.6 | Skill files para cada tool | 1h | SKILL.md con instrucciones para el agente |
| 5.7 | Test por tool | 1h | Cada tool responde correctamente |

**Patrón de conversión:**
```typescript
// LUNA tool → OpenClaw plugin tool
api.registerTool({
  name: 'check-availability',
  description: 'Verifica disponibilidad en el calendario',
  inputSchema: Type.Object({
    date: Type.String({ description: 'Fecha YYYY-MM-DD' }),
    duration: Type.Optional(Type.Number({ description: 'Duración en minutos' })),
  }),
  execute: async (input, ctx) => {
    // Portar lógica del handler de LUNA
    const slots = await medilinkApi.checkAvailability(input.date, input.duration);
    return { content: [{ type: 'text', text: JSON.stringify(slots) }] };
  },
});
```

**Entregable:** Agente con tools funcionales por empresa.

---

### Fase 6 — Proactividad empresarial (3-4 días, ~4 horas)

**Objetivo:** Agente que actúa por iniciativa propia

Esto es lo que OpenClaw hace mejor que nadie. Solo necesitamos configurarlo para negocio.

| # | Tarea | Tiempo | Detalle |
|---|-------|--------|---------|
| 6.1 | HEARTBEAT.md empresarial | 30 min | Checklist: leads pendientes, citas hoy, follow-ups |
| 6.2 | Cron: follow-up diario | 30 min | `--cron "0 9 * * 1-5"` — lunes a viernes 9am |
| 6.3 | Cron: appointment reminders | 30 min | `--every "1h"` — check citas próximas |
| 6.4 | Standing Order: lead re-engagement | 30 min | Reglas de re-contacto automático |
| 6.5 | Standing Order: commitment tracking | 30 min | Seguimiento de compromisos del agente |
| 6.6 | Active Hours config | 15 min | Solo activo en horario laboral |
| 6.7 | Test proactividad | 30 min | Verificar que envía mensajes proactivos |

**Ejemplo HEARTBEAT.md empresarial:**
```markdown
# Heartbeat Tasks

- Check for appointments in the next 2 hours. Send confirmation to contacts who haven't confirmed.
- Check for leads that haven't been contacted in 48+ hours. Send re-engagement per standing orders.
- Check for pending commitments. If any are overdue, notify the team.
- Review inbox for urgent unread messages. Flag if any need immediate attention.
```

**Entregable:** Agente proactivo que sigue reglas de negocio.

---

### Fase 7 — Twilio Voice (1 semana, ~5 horas)

**Objetivo:** Llamadas de voz via Twilio

| # | Tarea | Tiempo | Detalle |
|---|-------|--------|---------|
| 7.1 | Evaluar extensión voice-call existente | 1h | ¿Sirve como base? |
| 7.2 | Integrar Twilio como provider | 2h | Webhook Twilio → OpenClaw |
| 7.3 | Portar lógica de voz de LUNA | 1.5h | Gemini Live para STT/TTS en tiempo real |
| 7.4 | Test E2E | 30 min | Llamada entrante → respuesta de voz |

**Entregable:** Agente atiende llamadas de voz.

---

### Fase 8 — Multi-empresa (3-4 días, ~4 horas)

**Objetivo:** Un deploy por empresa con config diferente

| # | Tarea | Tiempo | Detalle |
|---|-------|--------|---------|
| 8.1 | Workspace template por empresa | 1h | SOUL.md + AGENTS.md + HEARTBEAT.md por empresa |
| 8.2 | Plugin config por empresa | 1h | Tools activos/inactivos según sector |
| 8.3 | Knowledge base por empresa | 1h | Documentos separados |
| 8.4 | Deploy: Docker Compose | 1h | Un container por instancia |

**Entregable:** Sistema desplegable para múltiples empresas.

---

## Timeline resumen

| Fase | Semana | Horas est. | Entregable clave |
|------|--------|-----------|-------------------|
| 0: Setup | 1 | 2.5h | OpenClaw con SOUL.md empresarial |
| 1: Chatwoot | 1-2 | 7h | Canal principal funcionando |
| 2: Knowledge | 2-3 | 6h | Agente fiel a su info |
| 3: Output Guard | 3 | 4h | Respuestas seguras |
| 4: HITL | 4 | 5h | Escalamiento a humanos |
| 5: Tools | 4-6 | 10h | Tools por empresa |
| 6: Proactividad | 6-7 | 4h | Agente proactivo |
| 7: Voice | 7-8 | 5h | Llamadas de voz |
| 8: Multi-empresa | 8-9 | 4h | Multi-deploy |
| **Total** | **~9 semanas** | **~47.5h** | **Sistema completo** |

A 1 hora/día = **~10 semanas**. A 2 horas/día = **~5 semanas**.

---

## Riesgos identificados

| Riesgo | Impacto | Mitigación |
|--------|---------|------------|
| OpenClaw actualiza y rompe plugins | Alto | Fijar versión del fork, cherry-pick updates |
| memory-wiki/lancedb insuficiente para knowledge empresarial | Medio | Fase 2 tiene plan B (plugin PG+pgvector) |
| Chatwoot webhook reliability | Medio | Retry + queue + health checks |
| Conversión tools LUNA → OpenClaw más compleja de lo estimado | Bajo | Tools son independientes, portar uno a la vez |
| Twilio + OpenClaw voice incompatible | Medio | LUNA tiene módulo funcional como fallback |

---

## Archivos de LUNA a reusar (código portable)

### Copiar directamente (sin dependencias de kernel)
- `src/engine/output-sanitizer.ts` → output-guard plugin
- `src/engine/agentic/email-triage.ts` → email-triage plugin
- `src/engine/utils/normalizer.ts` → utilidad compartida
- `src/engine/agentic/effort-router.ts` → referencia (OpenClaw maneja diferente)

### Adaptar (extraer lógica, cambiar interfaz)
- `src/modules/knowledge/` → knowledge-pg plugin o memory-wiki config
- `src/modules/hitl/` → hitl-manager plugin
- `src/modules/lead-scoring/` → lead-scoring plugin
- `src/modules/tools/tool-converter.ts` → referencia para tool registration

### Portar handlers (cambiar interfaz de ToolHandler a AgentTool.execute)
- `src/tools/freight/` → freight plugin tools
- `src/tools/freshdesk/` → freshdesk-kb plugin tools
- `src/modules/medilink/` → medilink plugin tools
- `src/modules/templates/` → templates plugin skills

### No portar (OpenClaw ya tiene mejor)
- `src/modules/memory/` → OpenClaw tiene mejor (LanceDB + wiki + active + dreams)
- `src/modules/whatsapp/` → OpenClaw ya tiene Baileys extension
- `src/kernel/` → reemplazado por OpenClaw core
- `src/engine/agentic/` (loop) → reemplazado por agent core de OpenClaw
- `src/modules/console/` → Chatwoot + OpenClaw UI
- `src/modules/llm/` → OpenClaw tiene provider system con 30+ providers

---

## Cómo empezar mañana (Fase 0)

```bash
# 1. Fork y clone
gh repo fork openclaw/openclaw --clone

# 2. Install
cd openclaw && pnpm install

# 3. Build
pnpm build

# 4. Config (API key)
export ANTHROPIC_API_KEY=sk-ant-...

# 5. Crear workspace
mkdir -p ~/mi-agente
cd ~/mi-agente

# 6. Crear SOUL.md
cat > SOUL.md << 'EOF'
# SOUL.md — Agente de Ventas Empresarial

## Quién soy
Soy un agente de ventas y atención al cliente profesional. Represento a la empresa con cortesía, conocimiento profundo del producto, y orientación a resultados.

## Principios
- **Fidelidad a la información:** Solo comparto datos verificados de la base de conocimiento. Si no sé algo, lo digo honestamente.
- **Proactividad:** No espero a que me pregunten. Si hay algo pendiente, lo manejo.
- **Escalamiento inteligente:** Si algo excede mi capacidad, escalo a un humano inmediatamente.
- **Memoria:** Recuerdo cada interacción y contexto del cliente.

## Tono
Profesional pero cálido. En español por defecto. Conciso pero completo. Sin emojis excesivos.

## Límites
- Nunca invento precios, disponibilidad, o especificaciones que no estén en mi knowledge base.
- Nunca comparto información de un cliente con otro.
- Si el cliente está frustrado, paso a un humano.
EOF

# 7. Run
openclaw --workspace ~/mi-agente
```
