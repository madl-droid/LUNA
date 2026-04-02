# Tools — Sistema de herramientas del agente

Registro, ejecución y configuración de tools que los módulos proveen al pipeline. Las tools se invocan en Phase 3 (Execute Plan).

## Archivos
- `manifest.ts` — lifecycle, configSchema, console (fields + apiRoutes), servicio `tools:registry`
- `types.ts` — ToolDefinition, ToolSettings, ToolResult, ToolHandler, formatos nativos (Anthropic/Gemini)
- `tool-registry.ts` — clase central: registro en memoria + DB sync + catálogo + ejecución
- `tool-executor.ts` — retry con backoff exponencial, timeout, paralelismo (Promise.allSettled)
- `tool-converter.ts` — funciones puras: ToolDefinition → formato nativo Anthropic/Gemini
- `pg-store.ts` — tablas: tools, tool_access_rules, tool_executions

## Manifest
- type: `feature`, removable: true, activateByDefault: true
- configSchema: TOOLS_RETRY_BACKOFF_MS (1000), TOOLS_EXECUTION_TIMEOUT_MS (30000), PIPELINE_MAX_TOOL_CALLS_PER_TURN (5)

## Servicio registrado
- `tools:registry` — instancia de ToolRegistry

## Hooks emitidos
- `tools:register` — cuando se registra una tool
- `tools:before_execute` — antes de ejecutar
- `tools:executed` — después de ejecutar (con resultado)

## Hook consumido
- `module:deactivated` — limpia tools del módulo desactivado

## API routes (montadas en /console/api/tools/)
- `GET /by-module?module=nombre` — tools de un módulo con settings
- `PUT /settings` — { toolName, enabled?, maxRetries?, maxUsesPerLoop? }
- `GET /access?tool=nombre` — reglas de acceso por contact_type
- `PUT /access` — { toolName, contactType, allowed }
- `GET /executions?tool=nombre&limit=50` — log de ejecuciones
- `GET /catalog` — catálogo de tools habilitadas

## Cómo registran tools otros módulos
```typescript
const toolRegistry = registry.get<ToolRegistry>('tools:registry')
await toolRegistry.registerTool({
  definition: { name: 'mi-tool', displayName: '...', description: '...', category: '...', sourceModule: 'mi-modulo', parameters: { type: 'object', properties: {}, required: [] } },
  handler: async (input, ctx) => ({ success: true, data: {} }),
})
```

## Sistema de two-tier descriptions (v2)

`ToolDefinition` ahora soporta dos niveles de descripción:

```typescript
interface ToolDefinition {
  description: string         // descripción completa (para catálogo interno, DB)
  shortDescription?: string   // 1 línea para declaraciones LLM (token-efficient)
  detailedGuidance?: string   // guía extendida inyectada en tool_result por el agentic loop
}
```

### Cómo funciona
- **Declaración al LLM**: `toAnthropicTools()` / `toGeminiTools()` usan `shortDescription ?? description`
- **Catálogo** (`getCatalog()`): usa `shortDescription ?? description` para el campo description
- **Auto-generación**: si un tool se registra sin `shortDescription`, se auto-genera desde la primera oración de `description`
- **Guidance**: Instance 1 (agentic loop) consume `getToolGuidance(name)` para inyectar contexto detallado en `tool_result`

### Registro con two-tier
```typescript
await toolRegistry.registerTool({
  definition: {
    name: 'calendar-check',
    displayName: 'Verificar Disponibilidad',
    description: 'Verifica disponibilidad en el calendario para agendar citas. Retorna slots disponibles por fecha.',
    shortDescription: 'Verifica disponibilidad en el calendario',  // optional — auto-generado si omitido
    detailedGuidance: 'Devuelve un array de slots disponibles. Cada slot tiene start/end ISO 8601. Interpretar en timezone del contacto. Si array vacío = no hay disponibilidad.',
    category: 'calendar',
    sourceModule: 'google-apps',
    parameters: { ... }
  },
  handler: async (input, ctx) => ({ success: true, data: slots }),
})
```

### API nuevo en ToolRegistry
- `getToolGuidance(name: string): string | null` — retorna `detailedGuidance` o null

## Patrones
- `upsertTool()` actualiza metadata pero NUNCA sobreescribe enabled/maxRetries/maxUsesPerLoop (controlados por console)
- Ejecución log es fire-and-forget (no bloquea pipeline)
- Access rules: deny-list por contact_type. Sin regla = permitido.
- Tool converter: las 3 providers usan JSON Schema; la diferencia es el wrapping (input_schema vs function.parameters vs parameters)
- Backward compatibility: tools sin `shortDescription` hacen fallback a `description` — no hay breaking change

## Trampas
- PIPELINE_MAX_TOOL_CALLS_PER_TURN se comparte con el config del pipeline — declarado en este módulo para que sea configurable desde console
- Los módulos que registran tools deben listar 'tools' en depends[] para garantizar orden de init
- Al desactivar un módulo, sus tools desaparecen del catálogo pero persisten en DB (re-aparecen al reactivar)
- **Helpers HTTP y config**: usa `jsonResponse`, `parseBody`, `parseQuery` de `kernel/http-helpers.js` y `numEnv` de `kernel/config-helpers.js`. NO redefinir localmente.
- `shortDescription` se auto-genera en `registerTool()` si no se proporciona — esto modifica el objeto `definition` in-place
