# Lead Status — Qualification (v3)

## Qué es
El sistema de calificación de LUNA. Determina si un lead vale la pena — si tiene necesidad, si decide, si tiene urgencia, y si está listo. Todo sin que el lead sienta que lo evalúan. Para él es una conversación natural con un vendedor atento.

## Por qué existe
Un vendedor humano califica inconscientemente: en 2 minutos ya sabe si alguien va en serio. LUNA hace lo mismo de forma sistemática, medible y configurable por tenant.

## Framework: preset único por tenant (v3)
El tenant elige UN preset al configurar. Si cambia de giro, cambia de preset. No hay routing automático entre frameworks.

**Presets disponibles:**
- **SPIN (B2C)** — Situation, Problem, Implication, Need-payoff. Para ventas a persona natural.
- **CHAMP (B2B)** — Challenges, Authority, Money, Prioritization. Para ventas corporativas.
- **CHAMP+Gov (B2G)** — CHAMP + Process Stage. Para licitaciones y entidades gobierno.

Cada preset tiene max 10 criterios. El admin puede agregar/quitar criterios (hasta 10 total) sin romper la suma de pesos porque los pesos no existen — el scoring usa **prioridad** (high/medium/low).

## Pesos por prioridad
Cada criterio tiene `priority: 'high' | 'medium' | 'low'`. El scoring engine traduce:
- high → peso 3
- medium → peso 2
- low → peso 1

El score final (0-100) se calcula normalizando los pesos dinámicamente. Agregar o quitar un criterio nunca rompe la config.

## EnumScoring configurable
Criterios de tipo `enum` admiten dos modos:
- `indexed` (default): opciones en escala (low/medium/high) → mayor índice = mejor score
- `presence`: opciones sin orden semántico (entity_type, prior_experience) → cualquier opción llena = score completo

## Cómo califica el agente
- **Extracción natural:** el agente NO hace encuestas. Extrae info de lo que el lead dice. "Somos 50 personas" → llena company_size.
- **Pursuit activo:** el agente sabe qué le falta y busca la forma natural de obtenerlo. Tiene límites: no insiste, no repite, y hay criterios (como budget) que nunca pregunta directo (`neverAskDirectly: true`).
- **Tool en agentic loop:** la extracción es la tool `extract_qualification` que el evaluador activa cuando detecta info relevante. No se ejecuta en cada mensaje.
- **Score por código:** el código suma pesos, evalúa criterios required/disqualifying, y decide transiciones de status. El LLM extrae, el código decide.
- **Timestamps de extracción:** `_extracted_at[key]` registra cuándo se extrajo cada campo.

## Máquina de estados (qualification_status)
```
new → qualifying → qualified → scheduled → attended → converted
         │
         ├→ directo → converted
         ├→ out_of_zone
         ├→ not_interested
         └→ cold

scheduled → cold
ANY → blocked
```
Todas las transiciones son triggers de código en el postprocessor. El LLM nunca cambia el status directamente.

## Flujo directo (directo)
Status `directo`: lead pide acción objetivo antes de completar la calificación.
- `essentialQuestions` (max 2 keys): preguntas mínimas antes de convertir directo.
- Estado: new/qualifying → directo → converted/blocked

## Objetivo del framework
`objective: 'schedule' | 'sell' | 'escalate' | 'attend_only'` — qué hace el agente cuando el lead califica. Configurable por tenant desde la consola.

## Config
Todo vive en `instance/qualifying.json` (formato v3: `preset`, `objective`, `stages`, `criteria`, `thresholds`, etc.).
La consola lo edita, hot-reload vía Apply.
Los datos extraídos viven en `contacts.qualification_data` (JSONB).
El score vive en `contacts.qualification_score` (INT).

### Migración automática de formatos anteriores
Al cargar `qualifying.json`, el config-store detecta el formato y migra automáticamente:
- **Formato 1 (BANT plano):** `criteria` en root, sin `frameworks`, sin `preset` → migra a v3 con preset='spin', weight→priority
- **Formato 2 (multi-framework v2):** tiene `frameworks[]` → toma el primer framework activo, migra a v3
- **Formato 3 (v3):** tiene `preset` → carga directo

## contact_type vs qualification_status
Son campos SEPARADOS. `contact_type` dice QUÉ es la persona (lead, cliente, proveedor, equipo). `qualification_status` dice EN QUÉ PUNTO del funnel está el lead.
No confundirlos.

## Decay temporal (Plan 2)
Los campos `_extracted_at[key]` (timestamps de extracción) permiten implementar decay temporal en Plan 2: datos de hace 6 meses pesarán menos que datos recientes. Por defecto `dataFreshnessWindowDays: 90`.
