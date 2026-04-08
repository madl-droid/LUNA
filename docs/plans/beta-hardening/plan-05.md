# Plan 05 — Criticizer, Post-Processor & Loop Detection

**Prioridad:** HIGH
**Módulo:** Engine post-processing (calidad de output)
**Objetivo:** Fix criticizer (0% approval rate), sanitizar tool call markers, detectar loops de repetición, y asegurar que HITL no se cachee incorrectamente.

## Archivos target

| Archivo | Líneas | Scope |
|---------|--------|-------|
| `src/engine/agentic/post-processor.ts` | ~244 | Criticizer parsing, tool call sanitizer, loop detection |
| `src/engine/agentic/tool-dedup-cache.ts` | ~77 | WRITE_TOOLS set (request_human_help missing) |
| `instance/prompts/system/criticizer-review.md` | — | Prompt del reviewer |
| `instance/prompts/system/criticizer-base.md` | — | Criterios base de revisión |
| `instance/prompts/defaults/criticizer.md` | — | Criterios adicionales |

## Paso 0 — Verificación obligatoria

Leer cada archivo y confirmar:
- `post-processor.ts:201` — que el parsing busca `APPROVED` como texto pero el prompt pide JSON
- `post-processor.ts:47-52` — que el threshold de tool calls es `>= 3`
- `tool-dedup-cache.ts:22-37` — que `request_human_help` NO está en WRITE_TOOLS
- Leer los 3 archivos de prompts del criticizer para entender los criterios actuales

## Fixes

### FIX-01: Tool call markers sanitization [CRITICAL]
**Fuente:** LAB BUG-01 del audit report
**Archivo:** `src/engine/agentic/post-processor.ts`
**Bug:** El texto `[Tool call: sheets-read({"spreadsheetId":"1eAOr2...","range":"I:L"})]` llegó visible al usuario. El post-processor no limpia estos markers antes de enviar.
**Fix:**
1. En la función principal del post-processor (antes del return final), agregar un sanitizer:
   ```typescript
   // Remove tool call markers that leaked into the response text
   responseText = responseText
     .replace(/\[Tool call:.*?\]/g, '')
     .replace(/\[tool_use:.*?\]/g, '')
     .replace(/\[Calling tool:.*?\]/g, '')
     .replace(/```tool_call[\s\S]*?```/g, '')
     .trim()
   ```
2. Si después del sanitize el texto queda vacío → usar fallback (misma lógica que E3 en Plan 02)
3. Log WARN cuando se detectan y limpian markers (indica que el LLM está mezclando formatos)
4. Ubicar el sanitizer DESPUÉS del criticizer (para limpiar también outputs del rewriter) y ANTES del delivery

### FIX-02: Criticizer parsing — soportar JSON y texto [CRITICAL]
**Fuente:** LAB BUG-02 del audit report
**Archivo:** `src/engine/agentic/post-processor.ts` ~línea 201, prompts del criticizer
**Bug DOBLE:**
1. **Parsing:** El prompt pide JSON `{"approved": true}` pero el código busca texto `APPROVED`. Gemini responde con JSON → el código no lo reconoce → 0% approval rate.
2. **Criterios:** 10 puntos de evaluación demasiado subjetivos (tono, CTA, nombre) → siempre hay algo que criticar.

**Fix del parsing (~línea 201):**
```typescript
// ANTES:
if (feedback.toUpperCase().startsWith('APPROVED') || feedback.length < 10) {
  return null
}

// DESPUÉS:
// 1. Check text format
if (feedback.toUpperCase().startsWith('APPROVED') || feedback.length < 10) {
  return null
}
// 2. Check JSON format
try {
  const parsed = JSON.parse(feedback.trim())
  if (parsed.approved === true) return null
} catch { /* not JSON, continue with feedback as refinements */ }
```

**Fix de los criterios (prompts):**
1. Leer `criticizer-base.md` y `criticizer.md` (en `instance/prompts/defaults/`)
2. Reducir de 10 puntos a 4 objetivos:
   - **Precisión factual**: ¿La información es correcta según los resultados de las herramientas?
   - **Guardrails**: ¿Respeta las restricciones del sistema (no inventar URLs, no compartir precios sin verificar)?
   - **Coherencia**: ¿Contradice algo que se dijo antes en la conversación?
   - **Seguridad**: ¿Contiene información sensible que no debería compartirse?
3. ELIMINAR criterios subjetivos: tono cálido, terminar con CTA, usar nombre del contacto, longitud ideal
4. En `criticizer-review.md`: unificar formato de respuesta. Pedir que responda `APPROVED` como texto plano (no JSON) si todo está bien, o los refinements si no

### FIX-03: Effort-router — subir threshold de tool calls [HIGH]
**Fuente:** LAB PEND-02 del audit report
**Archivo:** `src/engine/agentic/post-processor.ts` línea 51
**Bug:** El threshold de 3+ tool calls para activar el criticizer es demasiado bajo. Un flujo normal (search_knowledge + sheets-info + sheets-read = 3 tools) activa el criticizer innecesariamente.
**Fix:**
1. Cambiar la condición en línea 51:
   ```typescript
   // ANTES:
   agenticResult.toolCallsLog.filter(t => !t.blocked && !t.fromCache).length >= 3
   
   // DESPUÉS:
   agenticResult.toolCallsLog.filter(t => !t.blocked && !t.fromCache).length >= 6
   ```
2. Justificación: un flujo con knowledge + sheets + medilink son 5-6 tools fácilmente. El criticizer debería activarse solo en flujos realmente complejos (7+ herramientas no-cacheadas)
3. Considerar si el threshold debería ser configurable (ej: `LLM_CRITICIZER_TOOL_THRESHOLD` en configSchema). Si sí, agregarlo al configSchema del módulo engine.

### FIX-04: Detección de loop de repetición [HIGH]
**Fuente:** LAB BUG-09 del audit report
**Archivo:** `src/engine/agentic/post-processor.ts` (agregar nueva función)
**Bug:** El bot entra en loops enviando 7+ mensajes casi idénticos pidiendo los mismos datos.

**Diseño del loop detector:**

1. **Dónde:** En el post-processor, como paso adicional antes del return final

2. **Lógica:**
   ```
   Obtener último mensaje del bot para este contacto (del ctx o vía memoria)
   Calcular similitud Jaccard entre responseText y lastBotMessage
   Si similitud >= 0.80:
     Incrementar counter en Redis: INCR repeat:{contactId}, EXPIRE 1800 (30 min)
     Si counter == 1: dejar pasar (primera repetición, puede ser legítimo)
     Si counter == 2: dejar pasar + inyectar nota en historial de sesión:
       "[SYSTEM: Repetición detectada. El agente ha dado la misma respuesta 2 veces. Debe cambiar de approach.]"
     Si counter >= 3: HARD STOP
       - NO enviar responseText del LLM
       - Enviar mensaje hardcoded: "Dame un momento, déjame revisar bien tu caso para ayudarte mejor"
       - Persistir nota en historial del turno: "[SYSTEM: Repetición detectada turno N. Respuesta automática pausada por 3 repeticiones. Contexto del usuario: {último mensaje del usuario}. Se creó ticket HITL.]"
       - Crear ticket HITL automáticamente
       - Resetear counter
   Si similitud < 0.80: resetear counter, enviar normalmente
   ```

3. **Función de similitud Jaccard (por palabras):**
   ```typescript
   function jaccardSimilarity(a: string, b: string): number {
     const normalize = (s: string) => s.toLowerCase().replace(/[^\w\s]/g, '').split(/\s+/).filter(Boolean)
     const setA = new Set(normalize(a))
     const setB = new Set(normalize(b))
     const intersection = new Set([...setA].filter(x => setB.has(x)))
     const union = new Set([...setA, ...setB])
     return union.size === 0 ? 0 : intersection.size / union.size
   }
   ```

4. **Counter en Redis:** `repeat:{contactId}` con TTL 30 min. Si pasan 30 min sin repetición, se resetea.

5. **El mensaje hardcoded NO lo genera el LLM** — es código puro. Esto garantiza que el loop se rompe.

6. **La nota en el historial** permite que el agente, cuando el cliente vuelva a escribir, vea qué pasó y cambie su approach.

7. **Acceso a Redis:** El post-processor necesita acceso a Redis para el counter. Verificar si ya tiene referencia al registry o si hay que pasarla.

8. **Acceso al último mensaje del bot:** Verificar si el `ctx` (ContextBundle) ya incluye el historial reciente. Si sí, obtener el último mensaje con `role: 'assistant'`. Si no, obtener vía el servicio de memoria.

### FIX-05: request_human_help en WRITE_TOOLS [HIGH]
**Fuente:** F14 del análisis profundo
**Archivo:** `src/engine/agentic/tool-dedup-cache.ts` ~líneas 22-37
**Bug:** `request_human_help` no está en `WRITE_TOOLS`. Consecuencia: si el agente llama `request_human_help` 2 veces con los mismos argumentos, la segunda vez el cache retorna el resultado de la primera. El segundo ticket HITL nunca se crea.
**Fix:**
1. Agregar `'request_human_help'` al set WRITE_TOOLS:
   ```typescript
   private static readonly WRITE_TOOLS: ReadonlySet<string> = new Set([
     'create_commitment',
     'send_email',
     'create_event',
     'update_event',
     'delete_event',
     'create_contact',
     'update_contact',
     'write_sheet',
     'update_sheet',
     'create_ticket',
     'update_ticket',
     'escalate_to_human',
     'spawn_subagent',
     'schedule_follow_up',
     'request_human_help',  // ← AGREGAR
   ])
   ```
2. Verificar si hay otras tools de side-effect que falten (revisar la lista de tools registradas vs WRITE_TOOLS)

## Verificación post-fix

```bash
docker run --rm -v /docker/luna-repo:/app -w /app node:22-alpine npx tsc --noEmit
```

## Archivos de documentación a actualizar

- `src/engine/CLAUDE.md` — documentar: loop detector (threshold, counter, HITL escalation), tool call sanitizer
- `src/engine/agentic/CLAUDE.md` (si existe) — documentar criticizer parsing fix, WRITE_TOOLS policy
