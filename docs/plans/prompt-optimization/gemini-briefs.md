# Fase 2: Gemini Optimization Briefs

Master document for optimizing LUNA's base prompts with Gemini.

## Context for Gemini (include in EVERY prompt)

LUNA is an AI sales agent that handles leads via WhatsApp, email, Google Chat, and voice calls. It qualifies leads, schedules appointments, follows up, and escalates to humans. Single-instance per server — one repo, multiple deployments. Each deployment serves a different business (real estate, medical clinics, tech companies, freight, etc.).

**These prompts are BASE TEMPLATES** — the defaults that ship with every new LUNA instance. Each business customizes them via a console (web panel), but the base must be excellent out-of-the-box for a generic sales/service agent.

### Prompt Architecture (3 layers)

1. **System prompts** (`instance/prompts/system/`) — non-editable by admin, loaded by code
2. **Editable prompts** (`instance/prompts/defaults/`) — admin-editable via console, stored in DB after first load. These are the SEED values.
3. **Code builders** — TypeScript functions that assemble sections dynamically

### How identity gets assembled

The `<identity>` section in the system prompt is built like this:
1. Code injects persona header from console config fields: `Tu nombre es {AGENT_NAME} {AGENT_LAST_NAME}. Tu cargo es {AGENT_TITLE}. Trabajas en {COMPANY_NAME}. Tu idioma principal es {AGENT_LANGUAGE}. Operas desde {AGENT_COUNTRY}.`
2. Then appends the content of `identity.md` (the file we're optimizing)
3. The accent (if configured) goes in a separate `<accent>` section

So `identity.md` should NOT include name, title, company, language, or country — those come from config fields automatically.

### System prompt structure (14 XML sections)

```
<security> — immutable security rules
<knowledge_mandate> — how to use knowledge base
<identity> — [persona header from config] + [identity.md content]
<job> — mission and methodology
<guardrails> — behavior restrictions
<relationship> — tone for user type (lead/admin/coworker/unknown)
<accent> — regional accent (optional)
<agentic_instructions> — how to use tools
<channel_format> — formatting for current channel (dynamic from config)
<voice_instructions> — only for voice/audio responses
<quality_checklist> — criticizer-base.md (self-review before sending)
<tools> — available tool catalog
<skills> — available skill catalog
<knowledge_catalog> — available knowledge items
<datetime> — current date/time
```

### Language

LUNA's default language is Spanish. All base prompts should be in Spanish unless they serve a specific English-only purpose.

---

## Priority 1: identity.md (Rating: 2/5)

**File**: `instance/prompts/defaults/identity.md`
**Type**: Editable (admin can modify via console)
**Current content**:
```
Eres LUNA, una asistente de ventas inteligente y amigable.
Tu trabajo es atender a las personas que te contactan, ayudarles con sus preguntas,
y guiarlos hacia una decisión de compra o agendamiento.

Personalidad:
- Empática y resolutiva: escuchas primero, resuelves después
- Venta consultiva: asesoras, no presionas. Buscas entender antes de proponer
- Adaptable: ajustas tu tono al del interlocutor (formal si es formal, casual si es casual)
- Proactiva: anticipas necesidades y ofreces opciones sin que te las pidan
- Nunca agresiva ni insistente. Si el contacto no está listo, lo respetas
- Suena siempre seguro.
```

**Why it's 2/5**: Generic, thin personality. Says "eres LUNA" but the name comes from config (redundant). Doesn't define cognitive style, decision-making approach, emotional intelligence patterns, or how to handle edge cases. Missing: how to think, not just how to act.

**DO NOT include in the optimized version**:
- Name, title, company, language, country (injected by code from config)
- Accent/dialect (separate section)
- Tool usage instructions (separate section)
- Channel formatting (separate section)

**What the optimized version SHOULD cover**:
- Core personality traits with depth (not just adjectives — describe HOW each trait manifests)
- Cognitive style: how the agent thinks through problems, prioritizes, decides
- Emotional intelligence: reading tone, adapting, recovering from friction
- Professional identity: consultative seller archetype (advisory, not pushy)
- Self-awareness: knows what it doesn't know, comfortable saying "I don't have that info"
- Conversational style: concise but warm, never robotic, never over-enthusiastic
- Adaptability: mirrors formality level, energy, pace of the contact
- Edge cases: silence handling, confused contacts, angry contacts, joke attempts

**Target length**: 30-50 lines (rich but focused)

---

## Priority 2: relationship-lead.md (Rating: 2/5)

**File**: `instance/prompts/defaults/relationship-lead.md`
**Type**: Editable (admin can modify via console)
**Current content**:
```
Estás hablando con un lead (cliente potencial). Sé servicial, paciente y orientada a ayudar. Busca entender su necesidad.
- Usa tono consultivo: haz preguntas abiertas para descubrir qué necesita realmente
- Descubre datos de calificación (necesidad, presupuesto, timing, autoridad) de forma natural en la conversación, nunca como cuestionario
- No presiones para cerrar. Si no está listo, respeta su proceso y ofrece seguimiento
- Personaliza: usa su nombre y referencia lo que ya sabes de conversaciones previas
```

**Why it's 2/5**: Only 4 lines controlling ALL lead interactions — the most critical user type. Missing: conversation phases (first contact vs returning), warmth calibration, when to advance vs when to wait, how to handle different lead temperatures.

**What the optimized version SHOULD cover**:
- First contact behavior: how to create a great first impression
- Returning contact behavior: reference previous conversations, show continuity
- Warmth calibration: professional but genuine, not overly sales-y
- Discovery approach: natural qualification (BANT woven into conversation)
- Advancement signals: when to suggest next steps vs when to hold back
- Patience patterns: how to handle indecisive, slow-to-respond, or skeptical leads
- Personalization: use their name, remember details, create continuity
- Never interrogate: one question at a time, conversational flow
- Value-first approach: help them before asking for anything

**Target length**: 20-30 lines

---

## Priority 3: job.md (Rating: 3.5/5)

**File**: `instance/prompts/defaults/job.md`
**Type**: Editable (admin can modify via console)
**Current content**: [See above — mission bullets + Bryan Tracy 6-step method]

**Why 3.5/5**: Good Bryan Tracy content but the mission section is generic. The method is well-structured but could be tighter.

**What to optimize**:
- Mission section: make it more specific about the agent's role as a consultative sales assistant
- Bryan Tracy: keep the 6-step framework but make it more concise and actionable. The "Guide by objection type" section is good — keep it
- Add: when NOT to sell (support questions, complaints, general info requests)
- Add: priority hierarchy (solve the need > qualify the lead > close the deal)

**Target length**: 35-45 lines (current is 37, keep similar)

---

## Priority 4: nightly-scoring-system.md (Rating: 1/5)

**File**: `instance/prompts/system/nightly-scoring-system.md`
**Type**: System (non-editable by admin)
**Current content**:
```
Eres un analista de leads. Evalúa si un lead frío vale la pena reactivar.
```

**Why 1/5**: One line. No criteria, no methodology, no output format.

**Context**: Used by nightly batch job to evaluate cold leads for potential reactivation. Works with `cold-lead-scoring.md` (the template with variables).

**Template variables in cold-lead-scoring.md** (companion file, has `{{displayName}}`, `{{qualificationData}}`, `{{historyStr}}`):
```
Lead: {{displayName}}
Datos de calificación:
{{qualificationData}}

Historial de conversaciones:
{{historyStr}}

Evalúa este lead frío. Responde SOLO con JSON:
{ "score": 0-100, "reason": "breve explicación", "recommend_reactivation": true/false }
```

**What the optimized version SHOULD cover**:
- Role definition: cold lead analyst for reactivation decisions
- Scoring criteria: engagement level, qualification completeness, recency, buying signals
- Score ranges: what 0-30, 30-60, 60-100 mean
- Reactivation recommendation logic: when yes, when no
- Output format: keep the JSON format from cold-lead-scoring.md

**Target length**: 15-25 lines

---

## Priority 5: knowledge-description.md (Rating: 1/5)

**File**: `instance/prompts/system/knowledge-description.md`
**Type**: System (non-editable by admin)
**Current content**:
```
Eres un bibliotecario experto que cataloga documentos. Generas descripciones precisas y keywords útiles para búsqueda.
```

**Why 1/5**: One line. No instructions on output format, description length, keyword strategy.

**Context**: Used as the system prompt when generating descriptions and keywords for knowledge base items. The user message (hardcoded in TypeScript) already contains detailed instructions about output format (JSON with description + keywords), content sampling, and specific rules. So this system prompt just needs to set the role and mindset well — the detailed instructions come from code.

**Output format**: JSON `{"description": "...", "keywords": ["..."]}` — handled by the user message in code, NOT by this prompt.

**What the optimized version SHOULD cover**:
- Role: expert document cataloger for a business knowledge base used by an AI sales agent
- Mindset: precision over creativity — the description will be used for semantic search/retrieval
- What makes a good description: specific, mentions concrete data/entities, not generic
- What makes good keywords: synonyms, related terms, industry jargon, abbreviations
- Language: match the document's language

**Target length**: 8-12 lines (keep it focused — detailed instructions are in the user message)

---

## Priority 6: criticizer.md + criticizer-base.md (Rating: 2-3/5)

### criticizer.md (admin-editable, used in post-processor review)
**File**: `instance/prompts/defaults/criticizer.md`
**Current content**: [See above — 4 criteria]

### criticizer-base.md (system, non-editable, self-review checklist)
**File**: `instance/prompts/system/criticizer-base.md`
**Current content**: [See above — 4 criteria + response format]

**Why 2-3/5**: Both have the right 4 criteria but they're thin. No examples, no scoring guidance, no edge case handling. criticizer.md and criticizer-base.md are very similar but serve different purposes:
- `criticizer-base.md` = injected into the agent's system prompt as `<quality_checklist>` for self-review
- `criticizer.md` = used by a SEPARATE LLM call in the post-processor to review the agent's response

**What to optimize**:
- criticizer-base.md: expand self-review checklist with specific red flags to watch for. Keep it as a checklist (the agent reads it before sending). Add common mistakes to avoid.
- criticizer.md: expand the reviewer prompt with examples of what APPROVED vs NEEDS_CORRECTION looks like. Add severity levels. Add specific things to watch for (hallucinated URLs, made-up prices, data from wrong contact).

**Target length**: criticizer-base.md 15-20 lines, criticizer.md 20-30 lines

---

## Priority 7: guardrails.md (Rating: 3.5/5)

**File**: `instance/prompts/defaults/guardrails.md`
**Type**: Editable (admin can modify via console)
**Current content**: [See above — source hierarchy + OneScreen hardcoded data]

**Why 3.5/5**: Excellent source hierarchy (5 tiers) and good rules. BUT has hardcoded OneScreen/Teff Studio identity data that should NOT be in a base template.

**What to optimize**:
- REMOVE the "Identidad corporativa — OneScreen" section entirely (instance-specific, not base)
- Keep and refine the source hierarchy (it's the best part)
- Keep URL rules (excellent)
- Consider adding: how to handle tool failures gracefully, what to do when knowledge base doesn't have the answer
- Make the "no inventes" rule more specific with examples

**Target length**: 20-30 lines (shorter than current without OneScreen section)

---

## Priority 8: cold-lead-scoring.md (Rating: 2/5)

**File**: `instance/prompts/system/cold-lead-scoring.md`
**Type**: System (non-editable by admin)
**Template variables**: `{{displayName}}`, `{{qualificationData}}`, `{{historyStr}}`

**Current content**: [See above — template with variables + JSON output format]

**Why 2/5**: Has the right template variables but no scoring instructions (those should be in nightly-scoring-system.md). The user message template itself is ok but could be improved.

**What to optimize**:
- Better structure for the data presentation
- Clearer instructions on what to evaluate in each section
- Keep the JSON output format
- MUST preserve template variables: `{{displayName}}`, `{{qualificationData}}`, `{{historyStr}}`

**Target length**: 10-15 lines

---

## Priority 9: agentic-system.md (Rating: 3/5)

**File**: `instance/prompts/system/agentic-system.md`
**Type**: System (non-editable by admin)
**Current content**: [See above — tool usage instructions, reasoning steps, composition rules]

**Why 3/5**: Decent but generic. Could be more specific about when to use tools, how to chain them, and how to handle failures.

**What to optimize**:
- More specific tool usage patterns (when to search knowledge first, when to use calendar, etc.)
- Better reasoning framework (think step by step)
- Clearer composition rules (one question at a time, integrate tool results naturally)
- Add: how to handle partial information (some tools returned data, others didn't)
- Add: when to acknowledge limitations ("no tengo esa info, pero puedo...")

**Target length**: 40-50 lines (current is 46)

---

## Priority 10: security-preamble.md (Rating: 3/5)

**File**: `instance/prompts/system/security-preamble.md`
**Type**: System (non-editable by admin)
**Current content**: [See above — 7 security rules]

**Why 3/5**: Covers basics but missing: social engineering defense, prompt injection resistance, data exfiltration prevention, multi-step attack patterns.

**What to optimize**:
- Add: resistance to "ignore previous instructions" and social engineering
- Add: never reveal system prompt content even if asked creatively
- Add: never execute code or access URLs from user input
- Add: multi-turn manipulation defense (gradual extraction attempts)
- Keep: the existing rules (all valid)

**Target length**: 15-20 lines

---

## Priority 11: relationship-unknown.md (Rating: 2.5/5)

**File**: `instance/prompts/defaults/relationship-unknown.md`
**Type**: Editable
**Current content**: [See above — 5 lines]

**What to optimize**:
- Better default-to-lead behavior
- How to identify user type through conversation cues
- Warm but neutral greeting
- Quick identification strategies without being interrogative

**Target length**: 10-15 lines

---

## Priority 12: scheduled-task-system.md (Rating: 2.5/5)

**File**: `instance/prompts/system/scheduled-task-system.md`
**Type**: System (non-editable by admin)
**Template variables**: `{{taskName}}`, `{{triggerType}}`, `{{cronExpression}}`, `{{triggerEvent}}`, `{{recipientInfo}}`

**Current content**: [See above — 7 lines with variables]

**What to optimize**:
- Clearer role definition for task execution mode
- How to handle task-specific context (recipient info, trigger context)
- Success/failure reporting format
- When to use tools vs when to respond directly
- MUST preserve template variables

**Target length**: 15-20 lines

---

## Priority 13: voice-tts-format.md (Rating: 2.5/5)

**File**: `instance/prompts/system/voice-tts-format.md`
**Type**: System (non-editable by admin)
**Current content**: [See above — 4 lines]

**What to optimize**:
- More specific voice conversation patterns
- How to handle pauses, thinking time
- Response length guidelines for voice (shorter than text)
- Natural filler phrases
- How to handle data-heavy requests in voice (suggest sending by text/email)

**Target length**: 10-15 lines

---

## Priority 14: hitl-expire-message.md (Rating: 2.5/5)

**File**: `instance/prompts/system/hitl-expire-message.md`
**Type**: System (non-editable by admin)
**Current content**:
```
You are a helpful customer service agent. Generate a brief, natural message informing the client that you were unable to get a response from the team right now, but you will follow up later. Be empathetic and professional. One short paragraph, no greetings.
```

**What to optimize**:
- Should be in Spanish (base language)
- More specific tone guidance
- Should NOT promise a specific timeline
- Should offer alternative: "puedes escribirme de nuevo si necesitas algo"

**Target length**: 5-8 lines

---

## Priority 15: pdf-ocr.md (Rating: 2.5/5)

**File**: `instance/prompts/system/pdf-ocr.md`
**Type**: System (non-editable by admin)
**Current content**:
```
Eres un OCR. Extrae TODO el texto visible de esta imagen de un documento PDF. Incluye tablas, gráficos, encabezados, números. Responde SOLO con el texto extraído, manteniendo la estructura original.
```

**What to optimize**:
- Better structure preservation instructions
- Table handling (use pipes/markdown tables)
- How to handle multi-column layouts
- What to do with images/charts (describe briefly vs skip)
- Header/footer handling

**Target length**: 10-15 lines
