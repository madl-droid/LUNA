# Plan 04 — LLM Gateway Hardening

**Prioridad:** CRITICAL / HIGH
**Módulo:** LLM Gateway + providers + circuit breaker
**Objetivo:** Timeouts reales en todos los providers, circuit breaker funcional, fallback con tools, y SQL seguro.

## Archivos target

| Archivo | Líneas | Scope |
|---------|--------|-------|
| `src/modules/llm/providers.ts` | ~598 | Google LLM timeout con AbortController |
| `src/engine/utils/llm-client.ts` | ~354 | Direct SDK timeout, retry, tools support |
| `src/modules/llm/circuit-breaker.ts` | ~350+ | halfOpenRequests, backoff cap |
| `src/modules/llm/llm-gateway.ts` | ~758 | Circuit breaker counting fix, retry conteo |
| `src/modules/llm/pg-store.ts` | ~230 | SQL interpolation fix |

## Paso 0 — Verificación obligatoria

Leer cada archivo y confirmar:
- `providers.ts:445-450` — que AbortController se crea pero nunca se pasa al SDK de Google
- `llm-client.ts:121-137` — que el path directo no tiene timeout
- `llm-client.ts:282-313` — que el path directo de Google no soporta tools
- `circuit-breaker.ts:58` — que halfOpenRequests nunca se incrementa
- `llm-gateway.ts:629-638` — que el CB cuenta bloques de retry como 1 falla en vez de cada falla individual
- `llm-gateway.ts` — que trace_id no se propaga a los inserts de llm_usage
- `pg-store.ts:117` — que hay `'${interval}'` interpolado directamente

## Fixes

### FIX-01: Google LLM timeout real [CRITICAL]
**Fuente:** E4 del análisis profundo
**Archivo:** `src/modules/llm/providers.ts` ~líneas 445-450
**Bug:** Se crea un `AbortController` y un timer para el timeout, pero el `controller.signal` nunca se pasa a la llamada del SDK de Google. La request puede colgarse indefinidamente → bot muerto para ese contacto.
**Fix:**
1. Leer el adapter de Google en providers.ts (~líneas 440-460)
2. Confirmar que `AbortController` se crea pero `signal` no se pasa
3. Pasar `signal: controller.signal` a la llamada del SDK de Google:
   - Para `@google/generative-ai`: verificar si `generateContent()` acepta `signal` en su `RequestOptions`
   - Si el SDK no soporta `signal` nativamente: envolver en `Promise.race([sdkCall, timeoutPromise])`
4. Asegurar que el timer se limpia en todos los paths (success, error, abort) con `clearTimeout`
5. En caso de abort: retornar error descriptivo para que el gateway sepa que fue timeout (no error de contenido)

### FIX-02: LLM direct SDK con timeout, retry y circuit breaker [CRITICAL]
**Fuente:** E11 del análisis profundo
**Archivo:** `src/engine/utils/llm-client.ts` ~líneas 121-137
**Bug:** Cuando el módulo LLM no está activo (o no existe), `llm-client.ts` llama al SDK directamente sin timeout, sin retry, sin circuit breaker. Un request colgado = pipeline colgado indefinido.
**Fix:**
1. Leer `callProvider()` o la función que hace la llamada directa al SDK (~líneas 121-137)
2. Agregar timeout: `AbortController` + `setTimeout(30_000)` (30s)
3. Agregar retry: 2 intentos con backoff 1s entre ellos
4. En caso de timeout: retornar error claro, no colgarse
5. Nota: NO necesita circuit breaker propio — si el módulo LLM no está activo, esto es un fallback de emergencia

### FIX-03: Google direct SDK con soporte de tools [HIGH]
**Fuente:** F7 del análisis profundo
**Archivo:** `src/engine/utils/llm-client.ts` ~líneas 282-313
**Bug:** El path directo a Google ignora silenciosamente las `tools` pasadas en el request. Si el agente cae a este fallback, pierde todas sus herramientas y responde con puro texto.
**Fix:**
1. Leer el adapter directo de Google en llm-client.ts (~líneas 282-313)
2. Verificar cómo se construye el request al SDK de Google
3. Si hay `tools` en el request, convertirlas al formato de Google (`functionDeclarations`) y pasarlas
4. Manejar `tool_calls` en la respuesta de Google (mapear `functionCall` a formato normalizado)
5. Si la conversión de tools es demasiado compleja para este path de emergencia: al menos log WARN "Direct Google SDK: tools not supported, falling back to text-only"

### FIX-04: Circuit breaker cuenta cada fallo individual [HIGH]
**Fuente:** F4 del análisis profundo
**Archivo:** `src/modules/llm/llm-gateway.ts` ~líneas 629-638
**Bug:** Cuando un request tiene 3 retries y todos fallan, el circuit breaker solo registra 1 falla (del bloque completo) en vez de 3. Necesita 15 errores (5 bloques × 3 retries) para abrir cuando debería ser 5.
**Fix:**
1. Leer el error handling post-retry en llm-gateway.ts (~líneas 629-638)
2. Buscar dónde se llama `recordFailure()` del circuit breaker
3. Cambiar: llamar `recordFailure()` por CADA intento fallido, no solo al final del bloque de retry
4. El retry loop debería llamar `recordFailure()` en cada catch, y `recordSuccess()` si un retry tiene éxito
5. Verificar que esto aplica tanto al CB legacy (por provider) como al EscalatingCBManager (por target)

### FIX-05: halfOpenRequests se incrementa correctamente [HIGH]
**Fuente:** G1 del análisis profundo
**Archivo:** `src/modules/llm/circuit-breaker.ts` ~línea 58 y ~línea 233
**Bug:** `halfOpenRequests` se declara en 0, se compara con `halfOpenMax`, pero NUNCA se incrementa. En half-open state, TODAS las requests pasan (0 < 1 siempre true) en vez de solo 1 de prueba.
**Fix:**
1. Hay DOS implementaciones de CB en el archivo: la legacy (~línea 26) y `EscalatingCBManager` (~línea 205)
2. En AMBAS, en `isAvailable()`, cuando state es 'half-open':
   ```typescript
   // ANTES (buggy):
   return this.halfOpenRequests < this.config.halfOpenMax
   
   // DESPUÉS (fixed):
   if (this.halfOpenRequests < this.config.halfOpenMax) {
     this.halfOpenRequests++
     return true
   }
   return false
   ```
3. Verificar que `halfOpenRequests` se resetea a 0 en `transitionTo()` (ya lo hace, confirmar)
4. Aplicar el fix a AMBAS implementaciones

### FIX-06: Backoff exponencial con cap [MEDIUM]
**Fuente:** G2 del análisis profundo
**Archivo:** `src/modules/llm/circuit-breaker.ts` o `src/modules/llm/llm-gateway.ts`
**Bug:** El backoff exponencial `2^attempt * baseDelay` no tiene cap. Si maxRetries es alto (ej: 10), el último retry espera 85+ minutos.
**Fix:**
1. Buscar la función de cálculo de backoff (probablemente en llm-gateway.ts o en un utility)
2. Agregar cap: `Math.min(calculatedDelay, 30_000)` (30s máximo)
3. Es un cambio de 1 línea

### FIX-07: SQL parametrizado en usage summary [HIGH]
**Fuente:** F5 del análisis profundo
**Archivo:** `src/modules/llm/pg-store.ts` línea 117
**Bug:** `WHERE timestamp >= now() - interval '${interval}'` — interpolación directa de `interval` en SQL.
**Fix:**
1. Leer la función que contiene esta query (~líneas 105-120)
2. Verificar de dónde viene `interval` (¿user input? ¿config? ¿hardcoded?)
3. Cambiar a parámetro SQL:
   ```sql
   WHERE timestamp >= now() - $1::interval
   ```
   Y pasar `interval` como parámetro: `[interval]`
4. Si `interval` es un string como `'24 hours'` o `'7 days'`, pasarlo directamente como parámetro
5. Buscar si hay otros `${...}` en el mismo archivo y corregirlos todos

### FIX-08: Sanitización de Unicode surrogates antes de enviar al LLM [MEDIUM]
**Fuente:** VER-09 del LAB audit
**Bug:** 2 errores "no low surrogate in string" al serializar contenido con emojis/caracteres Unicode malformados (nombres como 🎬❤️🎄, 𝓢𝓽𝓮𝓯𝓪𝓷𝓲𝓪 🌙) → request al LLM falla.
**Fix:**
1. Buscar en `llm-gateway.ts` o `providers.ts` dónde se serializa el request al LLM
2. Agregar sanitización de surrogates antes de serializar:
   ```typescript
   function sanitizeUnicode(text: string): string {
     // Remove unpaired surrogates
     return text.replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, '\uFFFD')
   }
   ```
3. Aplicar a todos los strings que van al LLM: messages, system prompt, tool results
4. Alternativa: aplicar solo en el catch de JSON.stringify errors (más quirúrgico, menos overhead)

## Verificación post-fix

```bash
docker run --rm -v /docker/luna-repo:/app -w /app node:22-alpine npx tsc --noEmit
```

## Archivos de documentación a actualizar

- `src/modules/llm/CLAUDE.md` — documentar: timeout real en Google, halfOpen fix, backoff cap, SQL parametrizado, Unicode sanitization
