# Plan 14 — Audit Beta-Hardening Fixes

**Prioridad:** CRITICA (bloquea merge a pruebas)
**Branch auditado:** `claude/project-planning-session-Zwy1r`
**Fuente:** `docs/reports/audit-beta-hardening.md`
**Objetivo:** Corregir los 3 blockers de compilación/datos + 2 bugs alta prioridad encontrados en la auditoría integral de los 14 planes de beta-hardening (~75 fixes, ~60 archivos).

## Contexto — Qué encontró la auditoría

De los 82 fixes implementados en 14 planes, 81 están correctos. La auditoría reveló:
- **2 errores de compilación TS** que rompen el build de GitHub Actions
- **1 bug de datos** que puede corromper ownership de contactos
- **1 bug funcional** que descarta respuestas válidas del LLM
- **1 hueco funcional** donde orphan recovery choca con dedup

Los ~8 items de deuda técnica y ~3 violaciones de política son post-beta (documentados en sección "Diferidos").

## Archivos target

| Archivo | Scope |
|---------|-------|
| `src/engine/engine.ts` | TS-01: Redis SET NX overload |
| `src/engine/utils/llm-client.ts` | TS-02: cast inseguro a ModelParams |
| `src/modules/users/db.ts` | BUG-01: DO UPDATE → DO NOTHING |
| `src/engine/agentic/agentic-loop.ts` | BUG-02: reasoning patterns false positives |
| `src/engine/proactive/orphan-recovery.ts` | GAP-01: dedup collision en retry |

## Cambios previos relevantes

- **Plan 02** (Engine Hardening): Introdujo dedup Redis con SET NX (FIX-E1) y reasoning patterns (FIX-F13). Ambos son correctos en diseño pero tienen bugs de implementación.
- **Plan 07b** (Cross-Module): Implementó protección de ownership en `webhook-handler.ts` (FIX-03, correcto), pero la ruta alternativa via `db.ts:addContact()` quedó sin proteger.
- **Plan 02** (Engine): Introdujo orphan recovery con grace period de 5 min, coincidente con dedup TTL de 5 min.

## Paso 0 — Verificación obligatoria

1. Confirmar que estás en la rama correcta (derivada de `claude/project-planning-session-Zwy1r`)
2. Leer COMPLETOS los 5 archivos target
3. Compilar `npx tsc --noEmit` y confirmar que TS-01 y TS-02 existen como errores
4. Confirmar que `db.ts:331` tiene `DO UPDATE SET user_id`

---

## FIX-01: TS-01 — Redis SET NX tipo incorrecto [BLOQUEANTE]
**Archivo:** `src/engine/engine.ts:162`
**Error:** `error TS2769: Argument of type '"NX"' is not assignable to parameter of type '"KEEPTTL"'`
**Causa:** ioredis v5.10.0 no acepta `'NX'` como tercer argumento posicional de `set()`. El overload requiere que `PX` vaya antes de `NX`.

**Código actual (línea 162):**
```typescript
const set = await redis.set(dedupKey, '1', 'NX', 'PX', 300_000)
```

**Fix — reordenar argumentos para matchear el overload de ioredis v5:**
```typescript
const set = await redis.set(dedupKey, '1', 'PX', 300_000, 'NX')
```

Esto matchea el overload `set(key, value, 'PX', milliseconds, 'NX')` que es el correcto en ioredis v5.

**Verificación:** `npx tsc --noEmit` ya no debe mostrar error en esta línea.

---

## FIX-02: TS-02 — Cast inseguro a ModelParams [BLOQUEANTE]
**Archivo:** `src/engine/utils/llm-client.ts:320`
**Error:** `error TS2352: Conversion of type 'Record<string, unknown>' to type 'ModelParams' may be a mistake`
**Causa:** `modelConfig` se construye como object literal que TS infiere como `Record<string, unknown>`, y se castea directamente a `Parameters<typeof googleClient.getGenerativeModel>[0]` que es `ModelParams`. TS rechaza el cast directo entre tipos sin overlap suficiente.

**Código actual (línea 320):**
```typescript
const genModel = googleClient.getGenerativeModel(modelConfig as Parameters<typeof googleClient.getGenerativeModel>[0])
```

**Fix — agregar intermediate cast via `unknown`:**
```typescript
const genModel = googleClient.getGenerativeModel(modelConfig as unknown as Parameters<typeof googleClient.getGenerativeModel>[0])
```

**Verificación:** `npx tsc --noEmit` ya no debe mostrar error en esta línea.

---

## FIX-03: BUG-01 — ON CONFLICT reasigna user_id silenciosamente [BLOQUEANTE]
**Archivo:** `src/modules/users/db.ts:331`
**Bug:** `addContact()` usa `DO UPDATE SET user_id = EXCLUDED.user_id` que sobrescribe el dueño de un contacto si otro usuario intenta registrar el mismo canal+sender_id. Esto permite "robar" contactos.
**Patrón correcto:** Ya implementado en `webhook-handler.ts:505` que usa `DO NOTHING`.

**Código actual (líneas 328-334):**
```typescript
const result = await this.pool.query(
  `INSERT INTO user_contacts (user_id, channel, sender_id, is_primary)
   VALUES ($1, $2, $3, false)
   ON CONFLICT (channel, sender_id) DO UPDATE SET user_id = EXCLUDED.user_id
   RETURNING *`,
  [userId, channel, normalized],
)
return result.rows[0] ? this.mapContactRow(result.rows[0]) : null
```

**Fix:**
```typescript
const result = await this.pool.query(
  `INSERT INTO user_contacts (user_id, channel, sender_id, is_primary)
   VALUES ($1, $2, $3, false)
   ON CONFLICT (channel, sender_id) DO NOTHING
   RETURNING *`,
  [userId, channel, normalized],
)
if (result.rows[0]) {
  return this.mapContactRow(result.rows[0])
}
// Conflict — contact already exists for another user. Return existing record.
const existing = await this.pool.query(
  `SELECT * FROM user_contacts WHERE channel = $1 AND sender_id = $2 LIMIT 1`,
  [channel, normalized],
)
return existing.rows[0] ? this.mapContactRow(existing.rows[0]) : null
```

**Lógica:** Si `DO NOTHING` no retorna fila (conflicto), buscar la existente. El caller necesita el registro (lo usa para asociar). No logueamos warn aquí porque el caller puede decidir qué hacer.

**Verificación:** Revisar qué callers de `addContact()` esperan como retorno. Si algún caller espera que siempre devuelva una fila, el fallback a SELECT es obligatorio. Si el caller tolera `null`, basta con `DO NOTHING` + `RETURNING *`.

---

## FIX-04: BUG-02 — Reasoning patterns producen false positives [ALTA]
**Archivo:** `src/engine/agentic/agentic-loop.ts:30-46`
**Bug:** 10 patrones con `string.includes()` matchean substrings sin contexto. Frases comunes como "Te voy a ayudar", "Let me explain", "Puedo usar esta herramienta" son respuestas legítimas del agente que se descartan como "razonamiento interno".
**Impacto:** El usuario recibe fallback genérico cuando el LLM había generado una respuesta válida.

**Código actual:**
```typescript
const REASONING_PATTERNS = [
  'voy a ',        // "Te voy a ayudar" ← false positive
  'let me ',       // "Let me explain" ← false positive
  "i'll ",
  'using tool',
  'herramienta',   // "Puedo usar esta herramienta" ← false positive
  'tool call',
  'i need to ',
  'vou usar',
  'llamaré a',     // "Te llamaré a las 3" ← false positive
  'utilizaré',
]

function isInternalReasoning(text: string): boolean {
  const lower = text.toLowerCase()
  return REASONING_PATTERNS.some(p => lower.includes(p))
}
```

**Contexto de uso (líneas 220-224 y 270-274):** Se llama en dos paths:
1. Cuando hay `partialText` pero el loop terminó por error
2. Cuando se fuerza respuesta de texto sin tool calls

**Fix — Restringir a patrones que solo aplican al inicio del texto:**

El razonamiento interno del LLM comienza con frases meta como "Voy a usar la herramienta X" o "Let me call the function". Una respuesta dirigida al usuario nunca empieza así — empieza con la respuesta misma.

```typescript
// Patterns que indican razonamiento interno SOLO si aparecen al inicio del texto
const REASONING_START_PATTERNS = [
  'voy a usar ',
  'voy a llamar ',
  'voy a buscar ',
  'voy a consultar ',
  'let me use ',
  'let me call ',
  'let me check ',
  'let me search ',
  "i'll use ",
  "i'll call ",
  "i'll check ",
  'i need to use ',
  'i need to call ',
  'i need to check ',
  'using tool',
  'calling tool',
  'tool call',
  'vou usar ',
  'llamaré a la herramienta',
  'utilizaré la herramienta',
]

function isInternalReasoning(text: string): boolean {
  const lower = text.trimStart().toLowerCase()
  return REASONING_START_PATTERNS.some(p => lower.startsWith(p))
}
```

**Cambios clave:**
1. `includes()` → `startsWith()` — solo coincide si el texto empieza con el patrón
2. `trimStart()` antes de comparar — ignora whitespace inicial
3. Patrones más específicos: "voy a usar" en vez de "voy a " (elimina "te voy a ayudar")
4. Eliminar patrones genéricos: "herramienta" (demasiado amplio), "i'll " (demasiado corto)
5. Agregar patrones específicos de tool calling: "calling tool", "i'll use ", "i'll call "

**Verificación manual:**
- `"Te voy a enviar la información"` → `false` ✓ (no empieza con "voy a usar")
- `"Let me explain how this works"` → `false` ✓ (no matchea "let me use/call/check")
- `"Voy a usar la herramienta de búsqueda"` → `true` ✓ (razonamiento interno real)
- `"Let me check the calendar for you"` → `true` ✓ (razonamiento interno)

---

## FIX-05: GAP-01 — Orphan recovery choca con dedup de Redis [ALTA]
**Archivo:** `src/engine/proactive/orphan-recovery.ts:118`
**Bug:** `redispatchOrphan` usa el `messageId` original como `channelMessageId` del nuevo `IncomingMessage`. Si la entrada dedup de Redis aún existe (TTL 5 min), el retry se rechaza como duplicado. El grace period del orphan recovery es también 5 min, creando una ventana de colisión exacta.

**Código actual (línea 115-122):**
```typescript
const message: IncomingMessage = {
  id: randomUUID(),
  channelName: orphan.channel,
  channelMessageId: orphan.messageId,  // ← usa el mismo ID que el original
  from: orphan.channelContactId,
  timestamp: orphan.receivedAt,
  content: orphan.content,
}
```

**Fix — Usar channelMessageId distinto para retries:**
```typescript
const message: IncomingMessage = {
  id: randomUUID(),
  channelName: orphan.channel,
  channelMessageId: `${orphan.messageId}:orphan-retry`,
  from: orphan.channelContactId,
  timestamp: orphan.receivedAt,
  content: orphan.content,
}
```

El sufijo `:orphan-retry` hace que el dedup key sea diferente (`dedup:msg:{id}:orphan-retry`), evitando la colisión con el mensaje original. Si el orphan recovery se ejecuta múltiples veces para el mismo mensaje, el dedup dentro de la misma ventana de 5 min evitará procesamiento doble del retry (que es correcto).

**Nota:** Solo se ejecuta UN retry por huérfano (no hay loop de retries), así que un solo sufijo basta. Si en el futuro se agregan múltiples retries, agregar el número de intento: `${orphan.messageId}:orphan-retry-${attempt}`.

---

## Verificación post-fix

1. **Compilación:** `docker run --rm -v /docker/luna-repo:/app -w /app node:22-alpine npx tsc --noEmit` → 0 errores
2. **FIX-01:** Grep `redis.set` en engine.ts → argumentos en orden `'PX', N, 'NX'`
3. **FIX-02:** Grep `as unknown as` en llm-client.ts → intermediate cast presente
4. **FIX-03:** Grep `DO NOTHING` en db.ts → confirmado, no hay `DO UPDATE SET user_id`
5. **FIX-04:** Verificar que `isInternalReasoning("Te voy a ayudar")` retorna `false`
6. **FIX-05:** Grep `orphan-retry` en orphan-recovery.ts → sufijo presente

## Estrategia de ejecución

**Todo en un solo agente, un solo commit.** Son 5 fixes puntuales en 5 archivos sin interdependencias.

Orden recomendado:
1. FIX-01 + FIX-02 (bloqueantes de TS — una línea cada uno)
2. FIX-03 (bug datos — SQL change + fallback query)
3. FIX-04 (reasoning patterns — reemplazar array + función)
4. FIX-05 (orphan retry — una línea)
5. Compilar + verificar

## Diferidos (post-beta — documentados en auditoría)

| ID | Descripción | Prioridad |
|----|-------------|-----------|
| DT-01 | 8 constantes hardcodeadas → configSchema | BAJA |
| DT-02 | llm-client.ts backoff fijo 1s → exponencial | BAJA |
| DT-03 | precloseTimers Map nunca se limpia | BAJA |
| DT-04 | AVISO field names confusos (_MS = minutos) | BAJA |
| DT-05 | Migration 025 sin IF EXISTS guards | BAJA |
| POL-01 | config-store.ts lee process.env directamente | BAJA (kernel) |
| POL-02 | console/server.ts: 29× res.writeHead → jsonResponse() | BAJA |
| POL-03 | engine/prompts/agentic.ts importa módulo directamente | BAJA |
| GAP-02 | Rate limit pre-check vs delivery race condition | BAJA (best-effort) |
| GAP-03 | Pipeline log matching es por sesión, no por mensaje | MEDIA |
