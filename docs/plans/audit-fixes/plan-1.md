# Plan 1 — Quick Fixes & Cleanup
**Items**: B1, B2, B3, Q1, L1, L2
**Esfuerzo**: ~1.5h
**Dependencias externas**: Ninguna

---

## B1: HITL SQL type mismatch en handoff.ts

### Contexto
`src/modules/hitl/handoff.ts` función `getShareableContact()`. Cuando un contacto de WhatsApp tiene LID (no phone), intenta resolver el teléfono desde la tabla `contacts`.

### Bug (líneas 69-76)
```typescript
const { rows: contactRows } = await db.query(
  `SELECT c.phone FROM contacts c
   JOIN user_contacts uc ON c.id = uc.user_id
   WHERE uc.sender_id = $1 AND uc.channel = 'whatsapp'
   LIMIT 1`,
  [requesterSenderId],
)
```

**Problema**: `contacts.id` es UUID (tabla de leads/clientes). `user_contacts.user_id` es VARCHAR(20) referenciando `users.id` (tabla de usuarios internos). Son entidades completamente diferentes. PostgreSQL lanza: `operator does not exist: uuid = character varying`.

### Fix
Reemplazar el JOIN con la tabla correcta: `contact_channels`, que vincula contacts con sus channel identifiers.

```typescript
const { rows: contactRows } = await db.query(
  `SELECT c.phone FROM contacts c
   JOIN contact_channels cc ON cc.contact_id = c.id
   WHERE cc.channel_identifier = $1 AND cc.channel_type = 'whatsapp'
   LIMIT 1`,
  [requesterSenderId],
)
```

**Schema de `contact_channels`** (post-migraciones 001+003+004+009):
- `contact_id UUID NOT NULL REFERENCES contacts(id) ON DELETE CASCADE`
- `channel_type TEXT NOT NULL` — 'whatsapp', 'email', etc.
- `channel_identifier TEXT NOT NULL` — sender_id/phone/email
- Constraint: `UNIQUE (channel_type, channel_identifier)`

### Archivo a modificar
- `src/modules/hitl/handoff.ts` — líneas 69-76: reemplazar query

### Verificación
- El query debe compilar sin error de tipos
- `tsc --noEmit` debe pasar

---

## B2: Buffer compression threshold — runtime clamping

### Contexto
`src/engine/buffer-compressor.ts` — compresión inline de buffer Redis.
`src/modules/memory/manifest.ts` — configSchema con defaults.

### Bug
- `MEMORY_BUFFER_MESSAGE_COUNT=50` → Redis almacena ~50 mensajes raw → ~25 turns (ida+vuelta)
- `MEMORY_COMPRESSION_THRESHOLD=30` → requiere 30 turns para disparar compresión
- **25 < 30** → `turnCount <= threshold` siempre true → compresión NUNCA se ejecuta

El valor 30 puede estar en config_store (guardado desde consola), así que cambiar solo el default en manifest no arregla deployments existentes.

### Fix: Dos cambios

#### 1. Runtime clamping en `buffer-compressor.ts`

Después de obtener la config, calcular el threshold efectivo:

```typescript
// En checkAndCompressBuffer(), después de línea 33:
const { threshold: configuredThreshold, keepRecent } = memoryManager.getCompressionConfig()

// Clamping: prevenir threshold imposible
const bufferMessageCount = memoryManager.getBufferMessageCount()
const maxPossibleTurns = Math.floor(bufferMessageCount / 2)
const threshold = Math.min(configuredThreshold, Math.max(1, maxPossibleTurns - keepRecent - 2))

if (threshold !== configuredThreshold) {
  logger.debug({ configuredThreshold, effectiveThreshold: threshold, maxPossibleTurns },
    'Compression threshold clamped — buffer too small for configured value')
}
```

**IMPORTANTE**: `memoryManager.getBufferMessageCount()` probablemente no existe aún. El ejecutor necesita:
1. Verificar si el método existe en `src/modules/memory/memory-manager.ts`
2. Si no existe, agregarlo — debe retornar el valor de `MEMORY_BUFFER_MESSAGE_COUNT` del config

#### 2. Default más sensato en `memory/manifest.ts`

Cambiar el default de `MEMORY_COMPRESSION_THRESHOLD`:

```typescript
// En configSchema:
MEMORY_COMPRESSION_THRESHOLD: numEnv(20),  // era 30
```

Agregar `.describe()` explicativo:
```typescript
MEMORY_COMPRESSION_THRESHOLD: numEnv(20)
  .describe('Turns (ida+vuelta) antes de comprimir. DEBE ser menor que MEMORY_BUFFER_MESSAGE_COUNT/2 - KEEP_RECENT'),
```

### Archivos a modificar
- `src/engine/buffer-compressor.ts` — agregar clamping después de leer config
- `src/modules/memory/manifest.ts` — cambiar default de 30 a 20
- `src/modules/memory/memory-manager.ts` — agregar `getBufferMessageCount()` si no existe

### Verificación
- Con BUFFER=50, THRESHOLD=30, KEEP=10: threshold efectivo = min(30, 25-10-2) = 13
- Con BUFFER=150, THRESHOLD=30, KEEP=10: threshold efectivo = min(30, 75-10-2) = 30 (sin clamp)
- Log debe aparecer cuando se clampea

---

## B3: Crear prompt de descripción de imagen

### Contexto
`src/extractors/image.ts:109-115` busca el prompt `image-description` via `promptsSvc.getSystemPrompt('image-description')`. El archivo no existe. Cae al fallback hardcoded (líneas 106-107) que funciona pero no está optimizado.

### Fix
Crear `instance/prompts/system/image-description.md` con un prompt optimizado.

**REQUISITO CRÍTICO**: El output del LLM DEBE usar el formato `[DESCRIPCIÓN]` / `[RESUMEN]` porque `parseDualDescription()` en `src/extractors/utils.ts:171-186` lo parsea con regex.

### Contenido del archivo

```markdown
Eres un analizador visual de imágenes. Tu trabajo es describir con precisión lo que observas.

## Instrucciones
- Describe objetivamente lo que ves: personas, objetos, texto, entorno, colores, estado.
- Si la imagen muestra una condición médica/dermatológica, describe las características visibles (color, textura, distribución, zona del cuerpo) sin emitir diagnóstico.
- Si hay texto visible en la imagen, transcríbelo textualmente.
- Si es un documento, describe su tipo y contenido principal.
- Si es un producto, identifica marca, presentación y estado.
- Si es una captura de pantalla, describe la interfaz y contenido visible.
- NO inventes lo que no se ve. Si algo no es claro, dilo.
- NO des diagnósticos médicos ni recomendaciones.
- Responde en español.

## Formato OBLIGATORIO de respuesta

[DESCRIPCIÓN]
(Descripción detallada de 2-5 oraciones. Incluye todos los elementos relevantes.)

[RESUMEN]
(Resumen de máximo 1 línea. Ejemplo: "Foto de antebrazo con lesiones rojizas distribuidas en zona interior")
```

### Archivo a crear
- `instance/prompts/system/image-description.md`

### Verificación
- Verificar que `promptsSvc.getSystemPrompt('image-description')` carga correctamente el archivo
- El prompt service busca en `instance/prompts/system/` por nombre de archivo sin extensión
- Confirmar que `parseDualDescription()` parsea correctamente el output resultante

---

## Q1: Instrucción para que Luna USE las descripciones de imagen

### Contexto
El extractor de imágenes funciona bien (Gemini Vision describe correctamente). Pero Luna ignora la descripción en sus respuestas y hace comentarios genéricos. El problema está en que el system prompt agentic no instruye a Luna a usar contenido visual.

Las descripciones de imagen se inyectan en el historial como mensajes con etiqueta `[images]` (ver `src/engine/CLAUDE.md` sección "Adjuntos"). Luna las VE en su contexto pero no tiene instrucción de USARLAS.

### Fix
Agregar instrucción en `instance/prompts/defaults/guardrails.md` (ya contiene reglas de comportamiento).

Agregar al final del archivo:

```markdown

## Contenido visual
Cuando el historial incluya descripciones de imágenes (etiquetadas como [images]), DEBES basar tu respuesta en lo que la descripción indica. Referencia específicamente lo que se describe en la imagen. NUNCA hagas comentarios genéricos o halagos que contradigan el contenido visual descrito. Si la imagen muestra un problema, reconócelo directamente.
```

### Archivo a modificar
- `instance/prompts/defaults/guardrails.md` — agregar sección al final

### Verificación
- Leer el archivo actualizado y confirmar que la sección se integra bien con el contenido existente
- La instrucción es general (aplica a cualquier tipo de imagen, no solo médica)

---

## L1: Eliminar ExecutionQueue (código muerto)

### Contexto
`src/engine/concurrency/execution-queue.ts` exporta `createExecutionQueue()` que implementa priority lanes (reactive=8, proactive=3, background=2, globalMax=12). **Nunca se llama en ningún lugar del codebase.** El sistema usa `PipelineSemaphore` + `ContactLock`.

El archivo se re-exporta desde `src/engine/concurrency/index.ts`.

### Fix
1. Eliminar `src/engine/concurrency/execution-queue.ts`
2. Remover su export de `src/engine/concurrency/index.ts`

### Verificación
- `grep -r "execution-queue\|ExecutionQueue\|createExecutionQueue" src/` no debe encontrar nada (excepto en archivos de documentación/plans)
- `tsc --noEmit` debe pasar sin errores

---

## L2: Limpiar config keys huérfanas

### Contexto
El audit reporta keys en `config_store` que nadie lee:
- `EXECUTION_QUEUE_REACTIVE_CONCURRENCY=8`
- `EXECUTION_QUEUE_PROACTIVE_CONCURRENCY=3`
- `EXECUTION_QUEUE_BACKGROUND_CONCURRENCY=2`

Estas no están declaradas en ningún `configSchema` y ningún código las consume.

### Fix
Agregar limpieza en la nueva migración (el ejecutor debe usar el siguiente número disponible en `src/migrations/`):

```sql
-- Cleanup: remove orphaned EXECUTION_QUEUE config keys
DELETE FROM config_store WHERE key LIKE 'EXECUTION_QUEUE_%';
```

**NOTA**: Si `config_store` no tiene estas keys (puede que solo existan en una instancia específica), el DELETE es idempotente y no causa error.

### Archivo a crear
- `src/migrations/{NNN}_cleanup-dead-config.sql` — el ejecutor determina NNN según el estado actual del directorio

### Verificación
- La migración es idempotente (IF EXISTS / WHERE pattern)
- No elimina keys que NO empiecen con `EXECUTION_QUEUE_`

---

## Documentación

### Actualizar `src/modules/memory/CLAUDE.md`
Agregar nota sobre el clamping del threshold de compresión:
> El buffer-compressor auto-ajusta el threshold si el valor configurado excede los turns posibles en el buffer. Log `debug` cuando ocurre el clamp.

### Actualizar `src/modules/hitl/CLAUDE.md`
En la sección de trampas, agregar:
> El query de `getShareableContact()` en `handoff.ts` usa `contact_channels` (no `user_contacts`) para resolver phone de leads.

---

## Checklist final
- [ ] B1: Query en handoff.ts usa `contact_channels` con `channel_type` y `channel_identifier`
- [ ] B2: buffer-compressor.ts tiene clamping runtime
- [ ] B2: memory/manifest.ts default threshold = 20
- [ ] B2: memory-manager.ts expone `getBufferMessageCount()`
- [ ] B3: `instance/prompts/system/image-description.md` creado con formato [DESCRIPCIÓN]/[RESUMEN]
- [ ] Q1: `instance/prompts/defaults/guardrails.md` tiene sección de contenido visual
- [ ] L1: `execution-queue.ts` eliminado + export removido de `index.ts`
- [ ] L2: Migración SQL para limpiar EXECUTION_QUEUE keys
- [ ] `tsc --noEmit` pasa sin errores
- [ ] CLAUDE.md de memory y hitl actualizados
