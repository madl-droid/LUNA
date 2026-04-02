# INFORME DE CIERRE — Instance 2: Prompt System Rebuild

## Branch: `claude/infrastructure-adjustments-VvubG`
## Plan de referencia: `docs/plans/reset-v2/instance-2-prompts.md`

---

### Objetivos definidos

Reconstruir el sistema de prompts para el nuevo engine agéntico de LUNA v2.0.0:
1. Crear un builder central para el loop agéntico (`agentic.ts`)
2. Extraer lógica compartida de contexto (`context-builder.ts`)
3. Implementar sistema de skills modular
4. Implementar sistema de acento dinámico
5. Crear archivos `.md` de instrucciones para el loop agéntico
6. Optimizar prompts de compresión de sesión
7. Actualizar types e interfaz de `PromptsService`
8. Documentar en CLAUDE.md

---

### Completado ✅

**Archivos nuevos:**

| Archivo | Propósito |
|---|---|
| `src/engine/prompts/agentic.ts` | Prompt builder principal agéntico — 14 secciones XML-tagged |
| `src/engine/prompts/context-builder.ts` | Builder de capas de contexto compartido (legacy + agéntico) |
| `src/engine/prompts/skills.ts` | Sistema de skills: carga .md, filtra por userType, stub catalog |
| `src/engine/prompts/accent.ts` | Sección de acento dinámico desde PromptsService/config |
| `instance/prompts/system/agentic-system.md` | Instrucciones del loop agéntico (<500 palabras) |
| `instance/prompts/system/proactive-agentic-system.md` | Instrucciones de contacto proactivo |
| `instance/prompts/system/skills/sales-discovery.md` | Skill: calificación BANT |
| `instance/prompts/system/skills/objection-handling.md` | Skill: Bryan Tracy 6 pasos |
| `instance/prompts/system/skills/appointment-scheduling.md` | Skill: flujo de agendamiento |
| `instance/prompts/system/skills/follow-up-strategy.md` | Skill: estrategia por etapa de lead |

**Archivos modificados:**

| Archivo | Cambio |
|---|---|
| `src/engine/prompts/evaluator.ts` | Delegó ~200 líneas de contexto a `context-builder.ts` |
| `src/modules/prompts/types.ts` | Agregó `SkillDefinition` interface; `listSkills()` al interface `PromptsService` |
| `src/modules/prompts/prompts-service.ts` | Implementó `listSkills()` delegando a `engine/prompts/skills.ts` |
| `src/modules/prompts/CLAUDE.md` | Documentación de skills, accent, agentic builder |
| `instance/prompts/system/session-compression.md` | Optimizado con estructura BANT+commitments+JSON |
| `instance/prompts/system/buffer-compressor.md` | Optimizado con micro-compact pattern |

---

### No completado ❌

Nada. Todos los steps del plan ejecutados.

---

### Archivos creados/modificados

Total: **16 archivos**, 1485 líneas agregadas, 256 eliminadas.

---

### Interfaces expuestas (exports que otros consumen)

#### `src/engine/prompts/agentic.ts`
```typescript
export async function buildAgenticPrompt(
  ctx: ContextBundle,
  toolCatalog: ToolCatalogEntry[],
  registry: Registry,
  options?: AgenticPromptOptions
): Promise<{ system: string; userMessage: string }>

export interface AgenticPromptOptions {
  isProactive?: boolean
  proactiveTrigger?: ProactiveTrigger
  subagentCatalog?: SubagentCatalogEntry[]
}
```

#### `src/engine/prompts/context-builder.ts`
```typescript
export async function buildContextLayers(
  ctx: ContextBundle,
  registry: Registry | undefined,
  options?: ContextLayerOptions
): Promise<string>
```

#### `src/engine/prompts/skills.ts`
```typescript
export interface SkillDefinition { name, description, file, userTypes, triggerPatterns? }
export async function loadSkillCatalog(registry, userType): Promise<SkillDefinition[]>
export async function loadSkillDetail(skillName): Promise<string>
export function buildSkillCatalogSection(skills): string
export function clearSkillCache(): void
```

#### `src/engine/prompts/accent.ts`
```typescript
export async function buildAccentSection(registry): Promise<string>
```

#### `src/modules/prompts/types.ts` (interface extendida)
```typescript
export interface SkillDefinition { ... }
// PromptsService ahora incluye:
listSkills(userType?: string): Promise<SkillDefinition[]>
```

---

### Dependencias instaladas

Ninguna nueva. Reutiliza todas las existentes.

---

### Tests

No hay tests unitarios (el proyecto no tiene suite de tests automatizados para este módulo). La verificación se hizo via `npx tsc --noEmit` — sin errores nuevos en los archivos de esta instancia.

---

### Decisiones técnicas

1. **Frontmatter como comentarios HTML** en los skill `.md` files: `<!-- key: value -->`. No requiere librería de parseo externa, es compatible con cualquier renderer markdown, y el parser es trivial (4 líneas de regex).

2. **`context-builder.ts` como función pura** (no clase): Se alinea con el patrón del resto del engine. No tiene estado propio — todo llega vía parámetros.

3. **`skills.ts` en `engine/prompts/`** (no en `modules/prompts/`): Los skills son assets del engine, no del módulo de prompts. El módulo expone `listSkills()` como conveniente proxy, pero la lógica vive en el engine.

4. **14 secciones XML-tagged** en el system prompt de `agentic.ts`: Las etiquetas XML (`<security>`, `<identity>`, etc.) ayudan a los LLMs a estructurar mentalmente el prompt y a seguir prioridades correctas.

5. **`buildFormatFromForm()` duplicado** en `agentic.ts` (de `compositor.ts`): Por ahora están coordinados manualmente. Instance 4 (Integration) podría extraerlo a un helper compartido si ambas necesitan el mismo comportamiento exacto.

---

### Riesgos o deuda técnica

- **`buildFormatFromForm` duplicado**: existe en `compositor.ts` y ahora también en `agentic.ts`. Si el formato cambia, hay que actualizarlo en dos lugares. Bajo riesgo a corto plazo dado que el modo legacy (`compositor.ts`) quedará obsoleto cuando Instance 4 active el nuevo engine.

- **Cache de skills no tiene invalidación automática**: `clearSkillCache()` existe pero no hay hot-reload wired. Si se edita un skill `.md`, requiere reiniciar el proceso. Bajo impacto porque los skills cambian raramente.

---

### Notas para integración

**Para Instance 1 (Engine Agentic Core):** Consumir `buildAgenticPrompt()` desde `src/engine/prompts/agentic.ts`. Signature completa arriba. Pasar `toolCatalog` desde `toolRegistry.getCatalog(userType)` y `subagentCatalog` desde `registry.getOptional('subagents:catalog')?.getEnabledTypes()`.

**Para Instance 3 (Tools):** `ToolCatalogEntry.description` ya es el campo que aparece en el `<tools>` stub. Si se agrega `shortDescription` al tipo, actualizar `buildToolsSection()` en `agentic.ts` para usar `shortDescription ?? description`.

**Para Instance 4 (Integration):** Considerar extraer `buildFormatFromForm()` a `src/engine/utils/channel-format.ts` compartido entre `compositor.ts` y `agentic.ts`.
