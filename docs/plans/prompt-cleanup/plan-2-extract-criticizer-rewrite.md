# Plan 2: Extraer criticizer-rewrite a .md

## Objetivo
El prompt de reescritura del criticizer está hardcoded en `src/engine/agentic/post-processor.ts:424-430`. Extraerlo a un archivo `.md` y cargarlo via `getSystemPrompt()`.

## Crear archivo

**Ruta:** `instance/prompts/system/criticizer-rewrite.md`

**Contenido:**
```markdown
You are a response editor for a sales agent. You receive the agent's original response and feedback from a quality reviewer. Your job is to rewrite the response incorporating the feedback.

Rules:
- Return ONLY the improved response text
- No explanation, no preamble, no labels, no headers
- Keep the same language as the original response
- Preserve the original intent and information — only improve what the feedback indicates
```

## Modificar: `src/engine/agentic/post-processor.ts`

### Cambio en la función `rewriteWithFeedback()` (línea ~418)

La función actualmente tiene esta firma:
```typescript
async function rewriteWithFeedback(
  originalResponse: string,
  feedback: string,
  ctx: ContextBundle,
  config: EngineConfig,
): Promise<string> {
```

1. **Agregar parámetro `registry: Registry`** a la firma:
```typescript
async function rewriteWithFeedback(
  originalResponse: string,
  feedback: string,
  ctx: ContextBundle,
  config: EngineConfig,
  registry: Registry,
): Promise<string> {
```

2. **Reemplazar la constante `system` hardcoded** (líneas 424-430) con carga dinámica + fallback:
```typescript
  // Load from .md file, fallback to inline
  const svc = registry.getOptional<{ getSystemPrompt(name: string): Promise<string> }>('prompts:service')
  const loaded = svc ? await svc.getSystemPrompt('criticizer-rewrite').catch(() => null) : null
  const system = loaded || `You are a response editor for a sales agent. You receive the agent's original response and feedback from a quality reviewer. Your job is to rewrite the response incorporating the feedback.

Rules:
- Return ONLY the improved response text
- No explanation, no preamble, no labels, no headers
- Keep the same language as the original response
- Preserve the original intent and information — only improve what the feedback indicates`
```

3. **Actualizar la llamada** a `rewriteWithFeedback()` — buscar en el mismo archivo dónde se invoca. Debería haber una sola llamada. Agregar `registry` como último argumento. El `registry` ya está disponible en la función que llama (verificar que la función padre recibe `registry: Registry`).

4. **Verificar imports** — `Registry` ya debería estar importado en el archivo. Si no, agregar:
```typescript
import type { Registry } from '../../kernel/registry.js'
```

## Verificación

```bash
docker run --rm -v /docker/luna-repo:/app -w /app node:22-alpine npx tsc --noEmit
```

## Riesgo
Bajo. El fallback inline mantiene el comportamiento actual si el .md no se carga.
