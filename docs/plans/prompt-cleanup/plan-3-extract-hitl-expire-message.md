# Plan 3: Extraer hitl-expire-message a .md

## Objetivo
El prompt de expiración HITL está hardcoded en `src/modules/hitl/notifier.ts:139`. Extraerlo a `.md` y cargarlo via `getSystemPrompt()`.

## Crear archivo

**Ruta:** `instance/prompts/system/hitl-expire-message.md`

**Contenido:**
```markdown
You are a helpful customer service agent. Generate a brief, natural message informing the client that you were unable to get a response from the team right now, but you will follow up later. Be empathetic and professional. One short paragraph, no greetings.
```

## Modificar: `src/modules/hitl/notifier.ts`

### Cambio en `notifyRequesterExpired()` (línea ~132)

La función ya recibe `registry: Registry` como parámetro. Solo cambiar cómo se obtiene el `system` prompt.

**Antes** (línea ~137-139):
```typescript
  const result = await registry.callHook('llm:chat', {
    task: 'hitl-expire-message',
    system: `You are a helpful customer service agent. Generate a brief, natural message informing the client that you were unable to get a response from the team right now, but you will follow up later. Be empathetic and professional. One short paragraph, no greetings.`,
    messages: [
```

**Después:**
```typescript
  // Load system prompt from .md, fallback to inline
  const promptsSvc = registry.getOptional<{ getSystemPrompt(name: string): Promise<string> }>('prompts:service')
  const hitlSystem = promptsSvc
    ? await promptsSvc.getSystemPrompt('hitl-expire-message').catch(() => null)
    : null

  const result = await registry.callHook('llm:chat', {
    task: 'hitl-expire-message',
    system: hitlSystem || `You are a helpful customer service agent. Generate a brief, natural message informing the client that you were unable to get a response from the team right now, but you will follow up later. Be empathetic and professional. One short paragraph, no greetings.`,
    messages: [
```

**No tocar** nada más de la función. Solo la fuente del string `system`.

## Verificación

```bash
docker run --rm -v /docker/luna-repo:/app -w /app node:22-alpine npx tsc --noEmit
```

## Riesgo
Bajo. Fallback inline mantiene comportamiento actual.
