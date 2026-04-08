# AUDITORÍA COMPLETA — Beta Hardening (rama `claude/project-planning-session-Zwy1r`)

**Fecha:** 2026-04-08  
**Auditor:** Claude Opus 4.6 (sesión independiente)  
**Scope:** 14 planes de hardening (Plans 01–13b), ~75 fixes, ~2400 líneas cambiadas en ~60 archivos  
**Branch base:** misma que `claude/audit-project-planning-TZhV6` (commit `c722680`)

---

## Resumen ejecutivo

La rama de beta-hardening es **trabajo sólido en general**. De los ~75 fixes planificados, todos fueron implementados. La calidad promedio es alta: buen manejo de errores, patrones consistentes, y resiliencia real agregada al sistema. Sin embargo, la auditoría revela **2 bugs reales, 2 errores de compilación TypeScript, y ~15 hallazgos entre deuda técnica, huecos, y violaciones menores de políticas**.

### Veredicto por severidad

| Severidad | Cantidad | Resumen |
|-----------|----------|---------|
| **CRITICO (bloqueante)** | 2 | Errores de compilación TS que rompen build |
| **BUG REAL** | 2 | Silently reassign user ownership + reasoning pattern false positives |
| **DEUDA TÉCNICA** | 8 | Hardcoded constants, missing config, fixed backoff |
| **HUECOS** | 3 | precloseTimers leak, orphan recovery dedup, pre-check race |
| **VIOLACIONES DE POLÍTICA** | 3 | process.env read, res.writeHead en console, module import |
| **COMPLEJIDAD INNECESARIA** | 1 | Reasoning patterns overly aggressive |

---

## 1. BUGS REALES

### BUG-01: `users/db.ts:331` — ON CONFLICT reasigna user_id silenciosamente
**Plan:** 07b, FIX-03  
**Severidad:** ALTA  
**Archivo:** `src/modules/users/db.ts:331`

```typescript
// ACTUAL (buggy):
ON CONFLICT (channel, sender_id) DO UPDATE SET user_id = EXCLUDED.user_id

// DEBERÍA SER:
ON CONFLICT (channel, sender_id) DO NOTHING
```

**Problema:** `addContact()` sobrescribe el `user_id` existente si el canal+sender ya existe con otro dueño. Esto contradice FIX-03 que se implementó correctamente en `webhook-handler.ts:477-508` (verifica propietario antes de INSERT y usa DO NOTHING). Pero la ruta alternativa via `db.ts:addContact()` no tiene esta protección.

**Impacto:** Si dos usuarios distintos intentan registrar el mismo número de teléfono, el segundo "roba" silenciosamente el contacto del primero. Corrupción de datos.

**Fix:** Cambiar `DO UPDATE SET user_id = EXCLUDED.user_id` por `DO NOTHING` en línea 331.

---

### BUG-02: Reasoning patterns demasiado agresivos — false positives en español
**Plan:** 02, FIX-07  
**Severidad:** MEDIA  
**Archivo:** `src/engine/agentic/agentic-loop.ts:30-41`

```typescript
const REASONING_PATTERNS = [
  'voy a ',        // ← "Te voy a ayudar" es respuesta válida
  'let me ',       // ← "Let me explain..." es respuesta válida
  'herramienta',   // ← "Puedo usar esta herramienta" puede ser legítimo
  'llamaré a',     // ← Podría ser parte de respuesta ("llamaré a la clínica")
  ...
]
```

**Problema:** Estos patrones se buscan con `string.includes()` sin word boundaries ni contexto. Una respuesta legítima como "Te voy a enviar la información" se rechazaría como "razonamiento interno". Esto causa fallbacks innecesarios al usuario.

**Impacto:** Respuestas válidas del LLM descartadas y reemplazadas por mensajes genéricos de error. El usuario recibe "lo siento, hubo un problema" cuando la respuesta era perfectamente válida.

**Fix:** Restringir patrones para que solo coincidan al inicio del texto, o requerir combinación de patrones (e.g., "voy a " + mención de tool name). Mejor aún: solo activar este guard cuando `partialText` viene de un error/catch, no de texto normal.

---

## 2. ERRORES DE COMPILACIÓN TYPESCRIPT (Build-breaking)

### TS-01: `engine/engine.ts:162` — Redis SET NX tipo incorrecto
```
error TS2769: Argument of type '"NX"' is not assignable to parameter of type '"KEEPTTL"'
```
**Causa:** La versión de `ioredis` types no acepta `'NX'` como string separado en el overload de `set()`. Necesita usar la forma de opciones: `redis.set(key, val, 'PX', 300000, 'NX')` o el formato de opciones `{NX: true, PX: 300000}`.

### TS-02: `engine/utils/llm-client.ts:320` — Cast inseguro a ModelParams
```
error TS2352: Conversion of type 'Record<string, unknown>' to type 'ModelParams' may be a mistake
```
**Causa:** Falta `as unknown as` intermediate cast. Fix: `modelConfig as unknown as Parameters<typeof googleClient.getGenerativeModel>[0]`.

**Impacto:** Estos 2 errores **rompen el build** de GitHub Actions. Deben corregirse antes de merge.

---

## 3. DEUDA TÉCNICA

### DT-01: Constantes hardcodeadas que deberían ser configurables
Múltiples fixes introducen constantes hardcodeadas donde la política del proyecto requiere configurabilidad via `configSchema`:

| Constante | Archivo | Valor | Debería ser config |
|-----------|---------|-------|-------------------|
| `DEDUP_MEMORY_MAX` | engine.ts:36 | 10,000 | `ENGINE_DEDUP_MEMORY_MAX` |
| `DEDUP_TTL` | engine.ts:162 | 300,000ms | `ENGINE_DEDUP_TTL_MS` |
| `DEFAULT_LOCK_TIMEOUT_MS` | contact-lock.ts:9 | 150,000 | `ENGINE_CONTACT_LOCK_TIMEOUT_MS` |
| `DRAIN_TIMEOUT_MS` | engine.ts | 30,000 | `ENGINE_DRAIN_TIMEOUT_MS` |
| `GRACE_PERIOD_MINUTES` | orphan-recovery.ts:13 | 5 | Ya en config proactive.json |
| `REASONING_PATTERNS` | agentic-loop.ts:30 | Array fijo | Configurable o en prompts |
| `SYSTEM_MAX_MESSAGES_PER_HOUR` | delivery.ts:43 | 20 | `ENGINE_SYSTEM_MAX_MSG_HOUR` |
| `INTER_CHUNK_DELAY_MS` | delivery.ts:477 | 1,500 | `ENGINE_VOICE_CHUNK_DELAY_MS` |

**Nota:** Estos no son bugs — los defaults son razonables. Pero violan el espíritu de la regla de configuración distribuida del proyecto.

### DT-02: llm-client.ts usa backoff fijo (no exponencial)
**Archivo:** `src/engine/utils/llm-client.ts:147`  
El SDK directo fallback usa `setTimeout(r, 1000)` fijo entre reintentos en lugar de exponencial con cap como hace el gateway principal (`Math.min(backoff * Math.pow(2, attempt), 30_000)`).

**Impacto:** Bajo — esta ruta solo se usa cuando el módulo LLM no está activo. Pero es inconsistente con el patrón del gateway.

### DT-03: precloseTimers nunca se limpia para contactos inactivos
**Archivo:** `src/modules/whatsapp/manifest.ts:22`  
El Map `precloseTimers` acumula entradas para contactos que dejan de responder. Se limpia en `stop()` pero no tiene TTL ni sweep periódico.

**Impacto:** En contenedores de larga duración con muchos contactos, puede acumular miles de entradas muertas (~100 bytes cada una). No es un memory leak catastrófico pero es innecesario.

### DT-04: AVISO field names confusos (`_MS` almacena minutos)
**Archivo:** `src/modules/whatsapp/manifest.ts:201-202`  
`WHATSAPP_AVISO_TRIGGER_MS` almacena minutos, no millisegundos. La conversión está en `buildChannelConfig` (×60000) pero el nombre es misleading.

### DT-05: Variable names en migration 025 (Cortex Trace)
**Archivo:** `src/migrations/025_trace-rename-phases.sql`  
Renaming correcto de columnas pero sin IF EXISTS guards — si se ejecuta en una DB sin las columnas originales, falla.

---

## 4. HUECOS FUNCIONALES

### GAP-01: Orphan recovery puede re-dispatchar mensajes deduplicados
**Archivo:** `src/engine/proactive/triggers.ts`  
Cuando `redispatchOrphan()` crea un nuevo `IncomingMessage` con `channelMessageId` del original, el dedup de engine.ts puede rechazarlo si la entrada Redis no ha expirado (~5 min TTL). El orphan recovery tiene grace period de 5 min, creando una ventana donde el retry coincide con el TTL del dedup.

**Fix:** Usar un channelMessageId distinto para retries (e.g., `{original}-retry-{attempt}`) o limpiar la entrada dedup antes de re-dispatch.

### GAP-02: Rate limit pre-check vs delivery race condition
**Archivo:** `src/engine/engine.ts:199-216` + `src/engine/boundaries/delivery.ts:242-281`  
El pre-check es read-only (no incrementa contadores). Entre el pre-check y el delivery real, otros mensajes pueden incrementar el contador causando que el pipeline consuma tokens LLM y luego sea rechazado en delivery.

**Impacto:** Bajo — el pre-check es best-effort y ahorra la mayoría de los tokens. Pero en bursts simultáneos del mismo contacto, puede no ahorrar nada.

### GAP-03: Pipeline log matching en orphan recovery es por sesión, no por mensaje
**Archivo:** orphan-recovery.ts SQL query  
El `NOT EXISTS (SELECT 1 FROM pipeline_logs pl WHERE pl.session_id = m.session_id ...)` excluye un mensaje si CUALQUIER pipeline_log reciente existe para esa sesión, no específicamente para ESE mensaje. Si un contacto envía msg1 y msg2, y msg2 se procesa pero msg1 no, msg1 nunca se reintenta.

---

## 5. VIOLACIONES DE POLÍTICAS

### POL-01: `process.env` fuera de kernel/config.ts
**Archivo:** `src/kernel/config-store.ts:30`  
```typescript
const envKey = process.env['CONFIG_ENCRYPTION_KEY']
```
Viola la regla "NINGÚN módulo lee process.env directamente" — aunque config-store es parte del kernel, la lectura debería estar centralizada en config.ts.

### POL-02: `res.writeHead` en console/server.ts (29 instancias)
**Archivo:** `src/modules/console/server.ts`  
Usa `res.writeHead()` + `res.end()` en lugar del helper `jsonResponse()` del kernel. Esto es comprensible (la consola sirve HTML, CSS, JS además de JSON) pero las respuestas JSON sí deberían usar el helper.

### POL-03: Import directo entre módulos (implementation, no type)
**Archivo:** `src/engine/prompts/agentic.ts:70`  
```typescript
import { loadSystemPrompt, renderTemplate } from '../../modules/prompts/template-loader.js'
```
Importa implementación de otro módulo. Debería usar un servicio del registry.

---

## 6. COMPLEJIDAD INNECESARIA

### CMPLX-01: Reasoning patterns regex es una solución frágil
**Archivo:** `src/engine/agentic/agentic-loop.ts:28-46`  
10 patrones de string matching para detectar "razonamiento interno" del LLM. Esta lógica:
- Produce false positives (ver BUG-02)
- Es frágil (patterns dependen del idioma, estilo del modelo)
- No escala (nuevo modelo = nuevos patterns)

**Alternativa más robusta:** Solo aplicar este guard cuando `text` viene de un catch/error path, no verificar TODA respuesta parcial contra estos patterns. El LLM no debería producir reasoning text en respuestas normales — si lo hace, es un problema del prompt, no del post-processor.

---

## 7. REDUNDANCIAS O DUPLICACIONES

No se encontraron redundancias significativas. Los patrones de retry, circuit breaker, y fallback están correctamente centralizados. El único patrón duplicado es el `sleep()` helper que se define localmente en 4 archivos (`medilink/api-client.ts`, `llm/llm-gateway.ts`, `tools/tool-executor.ts`, `gmail/gmail-adapter.ts`), pero esto es aceptable ya que es un one-liner y extraerlo a un helper compartido sería over-engineering.

---

## 8. ANÁLISIS POR PLAN — Tabla resumen

| Plan | Fixes | Implementados | Bugs | Deuda | Calificación |
|------|-------|---------------|------|-------|-------------|
| **01** WhatsApp | 10 | 10/10 | 0 | 2 (precloseTimers, AVISO names) | ⭐⭐⭐⭐ |
| **02** Engine | 8 | 8/8 | 1 (reasoning patterns) | 4 (hardcoded constants) | ⭐⭐⭐ |
| **03** Memory/Redis | 9 | 9/9 | 0 | 0 | ⭐⭐⭐⭐⭐ |
| **04** LLM Gateway | 8 | 8/8 | 0 | 1 (llm-client backoff) | ⭐⭐⭐⭐ |
| **05** Criticizer | 5 | 5/5 | 0 | 0 | ⭐⭐⭐⭐⭐ |
| **06** Knowledge | 4 | 4/4 | 0 | 1 (category map UX) | ⭐⭐⭐⭐ |
| **07a** Scheduled | 5 | 5/5 | 0 | 0 | ⭐⭐⭐⭐⭐ |
| **07b** Cross-module | 6 | 5/6 | 1 (db.ts DO UPDATE) | 0 | ⭐⭐⭐ |
| **08** Prompts | 6 | 6/6 | 0 | 0 | ⭐⭐⭐⭐⭐ |
| **10** Legacy cleanup | 6 | 6/6 | 0 | 1 (migration guard) | ⭐⭐⭐⭐ |
| **11** Operational | 4 | 4/4 | 0 | 0 | ⭐⭐⭐⭐ |
| **12** UI Console | 1 | 1/1 | 0 | 0 | ⭐⭐⭐⭐ |
| **13a** Quick Fixes | 4 | 4/4 | 0 | 0 | ⭐⭐⭐⭐ |
| **13b** Medilink | 6 | 6/6 | 0 | 0 | ⭐⭐⭐⭐ |
| **TOTAL** | **82** | **81/82** | **2** | **9** | |

---

## 9. ACCIÓN REQUERIDA (priorizada)

### Antes de merge (blockers):
1. **TS-01:** Fix Redis SET NX syntax en `engine.ts:162`
2. **TS-02:** Fix cast inseguro en `llm-client.ts:320`
3. **BUG-01:** Cambiar `DO UPDATE` → `DO NOTHING` en `users/db.ts:331`

### Antes de beta (alta prioridad):
4. **BUG-02:** Refinar reasoning patterns — restringir a error paths o agregar word boundaries
5. **GAP-01:** Fix dedup collision en orphan recovery retries

### Post-beta (deuda aceptable):
6. **DT-01:** Extraer constantes hardcodeadas a configSchema
7. **DT-03:** Agregar sweep periódico a precloseTimers
8. **DT-04:** Renombrar AVISO field names
9. **POL-02:** Migrar respuestas JSON de console/server a usar jsonResponse()
10. **POL-03:** Wrappear prompts/template-loader en servicio del registry

---

## 10. CONCLUSIÓN

El trabajo de beta-hardening es **competente y profesional**. Se nota un enfoque metódico: los planes son claros, la ejecución sigue los planes fielmente, y la calidad promedio del código es alta. Los patrones de resiliencia (retry con backoff, circuit breakers, graceful degradation, dual writes) están bien aplicados.

Los 2 bugs reales encontrados (db.ts ownership y reasoning patterns) son fácilmente corregibles. Los 2 errores de compilación TS son mecánicos. La deuda técnica es manejable y no afecta funcionalidad.

**Calificación global: 8/10** — Producción-ready con los 3 fixes blockers aplicados.
