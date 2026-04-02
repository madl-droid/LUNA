# Prompts — Gestión centralizada de prompts del agente

Prompts editables desde console, almacenados en DB, con cache en memoria. Evaluador generado on-demand por LLM.

## Archivos
- `manifest.ts` — lifecycle, console fields (textarea), API routes, sync con config_store
- `types.ts` — PromptSlot, PromptRecord, CompositorPrompts, PromptsService, SkillDefinition
- `pg-queries.ts` — CRUD para prompt_slots
- `prompts-service.ts` — PromptsServiceImpl con cache Map, seed desde archivos/defaults, generación evaluador, listSkills()
- `template-loader.ts` — loadSystemPrompt(), loadDefaultPrompt(), renderTemplate(), preloadAll()

## Manifest
- type: `feature`, removable: true, activateByDefault: true
- depends: [] (llm es opcional, solo para generar evaluador)

## Tabla DB: prompt_slots
- `id` UUID PK, `slot` TEXT, `variant` TEXT, `content` TEXT, `is_generated` BOOLEAN, timestamps
- UNIQUE (slot, variant)
- Slots: identity, job, guardrails, relationship, evaluator, criticizer
- Variants: 'default' para la mayoría; relationship tiene 'lead', 'admin', 'coworker', 'unknown'

## Servicio expuesto
- `prompts:service` — PromptsService interface

## API Routes (bajo /console/api/prompts/)
- GET/PUT slots, POST generate-evaluator

## Sistema de skills (v2 — reset instance 2)

Skills = protocolos de interacción especializados (≠ tools que ejecutan acciones).

### Dónde viven
`instance/prompts/system/skills/*.md` — cada skill es un archivo .md con frontmatter HTML:
```
<!-- description: Descripción corta para el catálogo -->
<!-- userTypes: lead,admin -->
<!-- triggerPatterns: patron1,patron2 -->
```

### Skills incluidos (iniciales)
- `sales-discovery.md` — calificación BANT
- `objection-handling.md` — método Bryan Tracy 6 pasos
- `appointment-scheduling.md` — flujo de agendamiento
- `follow-up-strategy.md` — estrategia por etapa del lead

### API del skill system (`src/engine/prompts/skills.ts`)
```typescript
loadSkillCatalog(registry, userType): Promise<SkillDefinition[]>
loadSkillDetail(skillName): Promise<string>
buildSkillCatalogSection(skills): string
clearSkillCache(): void
```

### Acceso via PromptsService
```typescript
const svc = registry.get<PromptsService>('prompts:service')
const skills = await svc.listSkills(userType)  // delega a loadSkillCatalog()
```

## Sistema de acento (v2 — reset instance 2)

`src/engine/prompts/accent.ts` — buildAccentSection(registry)
- Lee AGENT_ACCENT y AGENT_ACCENT_PROMPT del registry config del módulo prompts
- Retorna sección `<accent>...</accent>` o string vacío si no hay acento configurado

## Agentic prompt builder (v2 — reset instance 2)

`src/engine/prompts/agentic.ts` — buildAgenticPrompt(ctx, toolCatalog, registry, options?)
- Reemplaza evaluator.ts + compositor.ts para el nuevo engine mode
- 14 secciones XML-tagged en el system prompt
- Context layers via context-builder.ts (compartido con legacy evaluator)

`src/engine/prompts/context-builder.ts` — buildContextLayers(ctx, registry, options?)
- Extrae la lógica de contexto del evaluator.ts legacy
- Compartido por evaluator.ts y agentic.ts

## Trampas
- `db` es `readonly` público en PromptsServiceImpl — API routes lo acceden directamente
- `invalidateCache()` recarga async — breve momento sin cache
- **Helpers HTTP**: usa `jsonResponse`, `parseBody`, `parseQuery` de `kernel/http-helpers.js`. NO redefinir localmente.
- Los skills se cargan lazy y se cachean en memoria — `clearSkillCache()` para hot-reload
- `listSkills()` delega a `engine/prompts/skills.ts` via import dinámico — sin circular deps
