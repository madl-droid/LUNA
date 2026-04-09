# Plan: Visual Re-query Tool (`inspect_image`)

Agrega la capacidad de re-consultar imágenes de adjuntos enviando el binario de vuelta al LLM vision con una pregunta específica del agente.

## Problema

Cuando un contacto envía una imagen, el extractor la describe una sola vez con un prompt genérico ("describe detalladamente todo el contenido"). Esa descripción se inyecta en el historial como `[images] descripción...`.

Si la descripción inicial no cubre un aspecto específico que el agente necesita para responder (ej: "¿qué marca es ese producto?", "¿el daño es en la parte frontal o trasera?"), el agente no tiene forma de re-examinar la imagen. Solo puede trabajar con la descripción textual que ya tiene.

El binario de la imagen YA se guarda en disco (`instance/knowledge/media/`) y su ruta se persiste en `attachment_extractions.file_path`. La infraestructura existe — solo falta el tool que la explote.

## Diseño

### Nueva tool: `inspect_image`

**Nombre**: `inspect_image` (no extender `query_attachment` — son concerns distintos: texto vs visual)

**Parámetros**:
```typescript
{
  attachment_id: string   // ID del adjunto en attachment_extractions
  question: string        // Pregunta específica sobre la imagen (ej: "¿qué texto aparece en la etiqueta?")
}
```

**Flujo**:
1. Buscar en `attachment_extractions` por `id` → obtener `file_path`, validar que `category = 'images'`
2. Leer el binario desde `file_path` (ej: `instance/knowledge/media/abc123_foto.jpg`)
3. Si el archivo no existe en disco → retornar error descriptivo
4. Enviar al LLM via `registry.callHook('llm:chat', ...)` con:
   - `task: 'extractor-image-vision'` (reusa el task routing existente → Gemini vision)
   - `system`: prompt enfocado en responder la pregunta específica (no descripción genérica)
   - `messages`: imagen como `image_url` + la pregunta del agente como texto
   - `maxTokens: 1000` (respuestas directas, no descripciones largas)
5. Retornar la respuesta del LLM como resultado del tool

**System prompt del re-query** (NO reusar el de descripción genérica):
```
Examina la imagen y responde EXCLUSIVAMENTE la pregunta del usuario.
Sé directo y específico. No describas la imagen completa — solo lo que se pregunta.
Si no puedes determinar la respuesta con certeza, indica qué ves y qué no es posible confirmar.
```

### Archivo: `src/engine/attachments/tools/inspect-image.ts`

```typescript
export async function registerInspectImageTool(registry: Registry): Promise<void>
```

Sigue el mismo patrón de `query-attachment.ts` y `web-explore.ts`:
- Importar Registry
- Obtener `tools:registry` del service registry
- Registrar tool con `registerTool()`
- Handler async con validación de inputs

### Registro

En el mismo lugar donde se registran `query_attachment` y `web_explore` — buscar dónde se llama `registerQueryAttachmentTool()` y agregar `registerInspectImageTool()` al lado.

---

## Pasos de implementación

### Paso 1: Crear `src/engine/attachments/tools/inspect-image.ts`

```typescript
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import pino from 'pino'
import type { Registry } from '../../../kernel/registry.js'

const logger = pino({ name: 'engine:tool:inspect-image' })

// Reusa el interface de tools:registry (mismo patrón que query-attachment.ts)
interface ToolRegistry { registerTool(toolDef: { ... }): Promise<void> }

export async function registerInspectImageTool(registry: Registry): Promise<void> {
  const toolRegistry = registry.getOptional<ToolRegistry>('tools:registry')
  if (!toolRegistry) return

  await toolRegistry.registerTool({
    definition: {
      name: 'inspect_image',
      displayName: 'Inspeccionar imagen',
      description: 'Re-examine a previously received image to answer a specific question about its visual content. Use when the initial image description does not contain the detail you need.',
      category: 'internal',
      sourceModule: 'engine',
      parameters: {
        type: 'object',
        properties: {
          attachment_id: {
            type: 'string',
            description: 'The ID of the image attachment (from attachmentContext or history).',
          },
          question: {
            type: 'string',
            description: 'Specific question about the image (e.g., "What brand is shown on the label?", "Is the damage on the front or back?").',
          },
        },
        required: ['attachment_id', 'question'],
      },
    },
    handler: async (input, ctx) => {
      const attachmentId = String(input.attachment_id ?? '')
      const question = String(input.question ?? '')

      if (!attachmentId || !question) {
        return { success: false, error: 'attachment_id and question are required' }
      }

      // 1. Buscar adjunto en DB
      const db = registry.getDb()
      const res = await db.query<{ file_path: string | null; category: string; mime_type: string; filename: string }>(
        'SELECT file_path, category, mime_type, filename FROM attachment_extractions WHERE id = $1 AND ($2::uuid IS NULL OR session_id = $2)',
        [attachmentId, ctx.sessionId ?? null],
      )

      const row = res.rows[0]
      if (!row) {
        return { success: false, error: 'Attachment not found.' }
      }
      if (row.category !== 'images') {
        return { success: false, error: `Attachment "${row.filename}" is ${row.category}, not an image. Use query_attachment for text-based content.` }
      }
      if (!row.file_path) {
        return { success: false, error: `Image binary not available on disk for "${row.filename}".` }
      }

      // 2. Leer binario de disco
      let buffer: Buffer
      try {
        const fullPath = resolve(process.cwd(), row.file_path)
        buffer = await readFile(fullPath)
      } catch {
        return { success: false, error: `Image file not found on disk: ${row.file_path}` }
      }

      // 3. Enviar a vision LLM con la pregunta específica
      const base64 = buffer.toString('base64')
      const system = 'Examina la imagen y responde EXCLUSIVAMENTE la pregunta del usuario. Sé directo y específico. No describas la imagen completa — solo lo que se pregunta. Si no puedes determinar la respuesta con certeza, indica qué ves y qué no es posible confirmar.'

      try {
        const result = await registry.callHook('llm:chat', {
          task: 'extractor-image-vision',
          system,
          messages: [{
            role: 'user' as const,
            content: [
              { type: 'image_url' as const, data: base64, mimeType: row.mime_type },
              { type: 'text' as const, text: question },
            ],
          }],
          maxTokens: 1000,
        })

        if (result && typeof result === 'object' && 'text' in result) {
          const answer = (result as { text: string }).text?.trim()
          if (answer) {
            logger.info({ attachmentId, questionLength: question.length, correlationId: ctx.correlationId }, 'inspect_image completed')
            return { success: true, data: { answer } }
          }
        }

        return { success: false, error: 'Vision model returned empty response.' }
      } catch (err) {
        logger.warn({ err, attachmentId }, 'inspect_image LLM call failed')
        return { success: false, error: 'Failed to analyze image. The vision service may be temporarily unavailable.' }
      }
    },
  })

  logger.info('inspect_image tool registered')
}
```

### Paso 2: Registrar la tool

Buscar dónde se llama `registerQueryAttachmentTool(registry)` y agregar:
```typescript
import { registerInspectImageTool } from './attachments/tools/inspect-image.js'
// ...
await registerInspectImageTool(registry)
```

### Paso 3: Exponer attachment_id en el contexto del agente

Verificar que `context-builder.ts` incluya el `attachment_id` cuando inyecta adjuntos procesados en la sección 16. Si no lo incluye, el agente no sabrá qué ID pasar al tool. Si es necesario, modificar el formato de inyección:
```
[images] (id: abc-123) descripción vision...
```

### Paso 4: Compilar y verificar

```bash
docker run --rm -v /docker/luna-repo:/app -w /app node:22-alpine npx tsc --noEmit
```

---

## Consideraciones

### Costos
- Cada `inspect_image` = 1 llamada LLM vision (~260 tokens input imagen + pregunta + ~200 tokens respuesta)
- Se mitiga naturalmente por el dedup cache del agentic loop (si pregunta lo mismo dos veces, se cachea)
- No necesita rate limit propio — el circuit breaker del LLM module ya protege

### Seguridad
- `injection-validator.ts` ya corre en Phase 1 sobre la descripción inicial. El re-query es pregunta del agente (no del usuario) → riesgo de injection bajo
- El tool valida que `category = 'images'` — no se puede usar para leer archivos arbitrarios de disco
- El `session_id` scope asegura que solo accede adjuntos de la sesión activa

### Video: fuera de scope
- Videos también se guardan procesados pero el binario no se persiste en disco actualmente
- Si se necesita re-query de video en el futuro, sería un tool separado (`inspect_video`)

### Relación con `query_attachment`
- `query_attachment`: búsqueda textual TF-IDF sobre `extracted_text` → para documentos grandes
- `inspect_image`: re-consulta visual del binario → para imágenes
- Ambos coexisten, no se solapan
