# Plan: Refactor LLM Model Config — Todo desde consola, nada hardcodeado

> Branch: `claude/audit-api-models-PpkMt`
> Basado en: auditoría de modelos (S-audit)

## Resumen

Eliminar todos los modelos hardcodeados. Todo configurable desde consola. Eliminar modo basic/advanced.
Organizar la UI en los 5 grupos funcionales. Scanner alimenta dropdowns. CB para servicios especializados.

---

## Fase 1: Modelos especializados configurables

**Objetivo**: Embeddings, TTS y voz dejan de tener modelos hardcodeados.

### 1a. Embeddings — `src/modules/knowledge/embedding-service.ts`
- **Quitar**: constante `MODEL = 'gemini-embedding-2-preview'` (línea 10)
- **Cambiar**: constructor recibe `model` y `dimensions` como parámetros
- **Cambiar**: las 3 fetch calls (líneas ~80, ~144, ~197) usan `this.model` en vez de constante
- **Agregar** en `src/modules/knowledge/manifest.ts` configSchema:
  - `KNOWLEDGE_EMBEDDING_MODEL: z.string().default('gemini-embedding-2-preview')`
  - `KNOWLEDGE_EMBEDDING_DIMENSIONS: numEnv(1536)`
- **Pasar** model+dimensions desde init() del manifest al construir EmbeddingService
- **Eliminar** `MEMORY_EMBEDDING_MODEL` de `src/modules/memory/manifest.ts` (línea 50) — no se usa

### 1b. TTS — `src/modules/tts/tts-service.ts`
- **Quitar**: constante `GEMINI_TTS_API_URL` con modelo hardcodeado (línea 34)
- **Cambiar**: URL se construye dinámicamente: `${API_BASE}/models/${this.model}:generateContent`
- **Agregar** en `src/modules/tts/manifest.ts` configSchema:
  - `TTS_MODEL: z.string().default('gemini-2.5-flash-preview-tts')`
- **Pasar** model al TTSService desde init()
- **Actualizar** TTS preview en `src/modules/console/server.ts` (~línea 2714): leer modelo de config en vez de hardcodear

### 1c. Voz — ya configurable
- `VOICE_GEMINI_MODEL` en `src/modules/twilio-voice/manifest.ts` (línea 298) ya es configurable. No requiere cambios.

**Archivos**: 6 archivos
- `src/modules/knowledge/embedding-service.ts` — quitar constante, parametrizar
- `src/modules/knowledge/manifest.ts` — agregar config fields
- `src/modules/memory/manifest.ts` — eliminar MEMORY_EMBEDDING_MODEL
- `src/modules/tts/tts-service.ts` — quitar URL hardcodeada, parametrizar
- `src/modules/tts/manifest.ts` — agregar TTS_MODEL
- `src/modules/console/server.ts` — TTS preview lee modelo de config

---

## Fase 2: Eliminar modo basic/advanced

**Objetivo**: Una sola sección de API keys. Sin toggle. Siempre se muestran las group keys (si están vacías, usa la principal como fallback — ya funciona así).

### Cambios:
- **`src/modules/llm/manifest.ts`**:
  - Eliminar campo `LLM_API_MODE` (línea 34)
  - Eliminar `visibleWhen: 'advanced'` de los console fields de group keys (líneas ~181-210)
  - Las group keys quedan siempre visibles, con info "Fallback: key principal"

- **`src/modules/llm/task-router.ts`**:
  - Eliminar `setApiMode()` method (línea 220)
  - Eliminar `this.apiMode` field (línea 204)
  - En `resolveApiKeyForTask()`: siempre intentar group key primero, luego default (quitar condicional de línea 505)

- **`src/modules/llm/llm-gateway.ts`**:
  - En constructor: quitar `config.LLM_API_MODE` (línea 120)
  - En `updateConfig()`: quitar `config.LLM_API_MODE` (línea 656)

- **`src/modules/console/templates-sections.ts`**:
  - Eliminar toggle basic/advanced (líneas ~747-762)
  - Group keys siempre visibles (quitar condicionales)

**Archivos**: 4 archivos

---

## Fase 3: Task router sin defaults hardcodeados

**Objetivo**: `DEFAULT_ROUTES` se elimina. El router carga todo desde config_store. Los defaults viven solo en el configSchema (Zod `.default()`).

### Cambios:
- **`src/modules/llm/manifest.ts`** configSchema:
  - Cada tarea tiene `LLM_{TASK}_PROVIDER` y `LLM_{TASK}_MODEL` con `.default()` que es el valor actual del DEFAULT_ROUTES
  - Cada tarea tiene `LLM_{TASK}_DOWNGRADE_PROVIDER/MODEL` (ya existen)
  - Cada tarea tiene `LLM_{TASK}_FALLBACK_PROVIDER/MODEL` (nuevo — hoy el fallback viene de DEFAULT_ROUTES, no de config)
  - **Eliminar** `LLM_ROUTE_*` fields (líneas 85-92) — eran JSON strings, reemplazados por los campos individuales

- **`src/modules/llm/task-router.ts`**:
  - **Eliminar** `DEFAULT_ROUTES` array completo (líneas 21-147)
  - **Eliminar** `defaultModelFor()` (líneas 542-548)
  - Constructor ya no carga defaults — queda vacío hasta `loadFromConfig()`
  - `loadFromConfig()` construye TODAS las rutas desde config (primary + downgrade + fallback)
  - Si una ruta no tiene config → error en log (no hay fallback silencioso a hardcoded)
  - `resolve()` ya no necesita "last resort" (líneas 446-461) — si no hay rutas, falla explícitamente

- **`src/engine/config.ts`**:
  - **Eliminar** todos los `env()` calls con modelos hardcodeados (líneas 82-103)
  - Los campos `classifyModel`, `respondModel`, etc. se leen de `registry.getConfig('llm')` en vez de env vars con defaults
  - O mejor: el engine ya no necesita estos campos si todo pasa por el gateway

- **`src/modules/engine/manifest.ts`**:
  - Los effort models (`LLM_LOW/MEDIUM/HIGH_EFFORT_MODEL/PROVIDER`) mantienen sus defaults en el schema Zod — estos sí son del engine, no del task router

**Archivos**: 4 archivos

---

## Fase 4: Consola — dropdowns organizados

**Objetivo**: La tabla de modelos en `/console/agente/advanced` se reorganiza en los 5 grupos funcionales. Dropdowns alimentados por scanner con nombres limpios. Agrupados por provider.

### Cambios en `src/modules/console/templates-sections.ts`:

**4a. Dropdowns mejorados:**
- Eliminar `DEFAULT_ANTHROPIC_MODELS` y `DEFAULT_GOOGLE_MODELS` (líneas ~580-590)
- Los dropdowns se alimentan del model scanner (`data.models` que ya viene del gateway)
- Si scanner no ha corrido → lista vacía con mensaje "Escaneando modelos..."
- Organización interna del `<select>`:
  ```html
  <optgroup label="Anthropic">
    <option value="claude-opus-4-6">Opus 4.6</option>
    <option value="claude-sonnet-4-6">Sonnet 4.6</option>
    ...
  </optgroup>
  <optgroup label="Google Gemini">
    <option value="gemini-2.5-pro">Pro 2.5</option>
    <option value="gemini-2.5-flash">Flash 2.5</option>
    ...
  </optgroup>
  ```
- **Nombres limpios**: mapear IDs a display names (el scanner ya trae `displayName`)
- Quitar modelos obsoletos automáticamente (si scanner no los lista, no aparecen)

**4b. Tabla reorganizada por grupos:**
- Reemplazar array `TASKS` plano (líneas 679-691) por grupos:
  1. **Pipeline principal**: classify, respond, complex, tools, criticize
  2. **Multimedia y datos**: vision, document_read, web_search
  3. **Comunicación automática**: proactive, ack, batch
  4. **Mantenimiento**: compress
  5. **Servicios especializados**: embeddings (model only), TTS (model only), voz (model only)
- Cada grupo tiene header visual separador
- Para servicios especializados: solo selector de modelo (sin downgrade/fallback — no hay alternativa cross-provider)

**4c. Fallback visible:**
- Agregar columna "Fallback" a la tabla (hoy solo muestra primary + downgrade)
- El fallback cross-API ahora también es editable desde la tabla

**Archivos**: 1 archivo principal (`templates-sections.ts`), posiblemente `templates-i18n.ts` para labels

---

## Fase 5: CB para TTS + degradación consciente

**Objetivo**: Cuando un servicio especializado falla, el sistema lo sabe y deja de intentar usarlo temporalmente.

### 5a. Circuit breaker para TTS — `src/modules/tts/tts-service.ts`
- Agregar CB simple (mismo patrón que embedding-service.ts):
  - 3 fallas en 5 min → open 5 min
  - Cuando open: `synthesize()` retorna `null` inmediatamente
  - El caller (post-processor) ya maneja null → envía solo texto

### 5b. Estado de servicio expuesto via registry
- `tts:service` expone `isAvailable(): boolean` (lee estado del CB)
- `knowledge:embedding-service` ya tiene CB — exponer `isAvailable()` via registry
- El engine/prompts puede consultar estos estados para no ofrecer capabilities que no funcionan
  - Ej: si TTS down → no agregar "puedo enviarte audio" al prompt
  - Ej: si embeddings down → knowledge search usa FTS puro (ya implementado)

### 5c. Cola de embeddings cuando servicio se recupera
- Cuando embedding CB se abre → los jobs de vectorización en BullMQ quedan en "waiting"
- Cuando CB cierra → BullMQ los procesa automáticamente (ya funciona así por diseño de BullMQ)
- Solo verificar que el worker checkea `isAvailable()` antes de procesar

**Archivos**: 3-4 archivos
- `src/modules/tts/tts-service.ts` — agregar CB
- `src/modules/tts/manifest.ts` — exponer `isAvailable` como service
- `src/modules/knowledge/embedding-service.ts` — exponer `isAvailable`
- `src/modules/knowledge/vectorize-worker.ts` — verificar check de disponibilidad

---

## Fase 6: Limpiar legacy

**Objetivo**: Eliminar código muerto y defaults duplicados.

### Cambios:
- **`src/engine/config.ts`**: eliminar campos legacy de modelos (classifyModel, respondModel, etc.) si el engine ya no los usa directamente
- **`src/modules/memory/manifest.ts`**: eliminar `MEMORY_EMBEDDING_MODEL` (línea 50)
- **`src/modules/llm/manifest.ts`**: eliminar `LLM_ROUTE_*` JSON fields (líneas 85-92) — reemplazados por campos individuales
- **`src/modules/llm/llm-gateway.ts`**: eliminar método `tts()` legacy (líneas 424-466) si TTS module lo maneja
- Verificar que no haya imports rotos

**Archivos**: 4 archivos

---

## Orden de ejecución

```
Fase 1 (especializados) → Fase 2 (quitar basic/advanced) → Fase 3 (task router) → Fase 4 (consola) → Fase 5 (CB) → Fase 6 (cleanup)
```

Cada fase es un commit independiente. Compilar TS después de cada fase.

## Archivos totales impactados

| Archivo | Fases |
|---------|-------|
| `src/modules/llm/manifest.ts` | 2, 3 |
| `src/modules/llm/task-router.ts` | 2, 3 |
| `src/modules/llm/llm-gateway.ts` | 2, 6 |
| `src/modules/console/templates-sections.ts` | 2, 4 |
| `src/modules/console/server.ts` | 1 |
| `src/modules/knowledge/embedding-service.ts` | 1, 5 |
| `src/modules/knowledge/manifest.ts` | 1 |
| `src/modules/knowledge/vectorize-worker.ts` | 5 |
| `src/modules/tts/tts-service.ts` | 1, 5 |
| `src/modules/tts/manifest.ts` | 1, 5 |
| `src/modules/memory/manifest.ts` | 1, 6 |
| `src/modules/engine/manifest.ts` | 3 |
| `src/engine/config.ts` | 3, 6 |
| `src/modules/console/templates-i18n.ts` | 4 |
