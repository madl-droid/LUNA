# AUDITORÍA — Voice Enhancement (branch claude/enhance-twilio-calling-WrqXc)

## Alcance

Revisión de los 5 commits correspondientes a las fases 0–4 del VOICE-PLAN-OVERVIEW.
12 archivos tocados, ~1229 líneas añadidas, ~109 eliminadas.

---

## BUGS

### BUG-1: `getLocalDayOfWeek()` es unreliable (call-manager.ts:831–835)

```typescript
function getLocalDayOfWeek(date: Date, timezone: string): number {
  try {
    return new Date(date.toLocaleString('en-US', { timeZone: timezone })).getDay()
  } catch {
    return date.getUTCDay()
  }
}
```

**Problema:** `new Date(string)` parsea el string de `toLocaleString` de forma implementation-defined. En Node.js 22, `toLocaleString('en-US', { timeZone: 'America/Bogota' })` produce algo como `"4/6/2026, 1:30:00 PM"` — el constructor `new Date()` lo parsea en la timezone LOCAL del server (UTC en Docker), no en la timezone destino. Si el server está en UTC y son las 23:00 UTC (6:00 PM Bogotá, sábado), `new Date("4/4/2026, 6:00:00 PM")` lo interpreta como las 18:00 UTC, que sigue siendo sábado. Pero si es **domingo 00:30 UTC** (sábado 19:30 Bogotá), el server en UTC ve domingo, parsea el string "4/4/2026, 7:30:00 PM" como domingo a las 19:30 UTC → `.getDay()` retorna 0 (domingo) en lugar de 6 (sábado).

**Fix correcto:** usar `Intl.DateTimeFormat` con `weekday`:
```typescript
function getLocalDayOfWeek(date: Date, tz: string): number {
  const weekday = new Intl.DateTimeFormat('en-US', { weekday: 'short', timeZone: tz }).format(date)
  return ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].indexOf(weekday)
}
```

**Severidad: ALTA** — Puede bloquear llamadas salientes en viernes por la tarde (cree que es sábado) o permitirlas en domingo por la mañana.

---

### BUG-2: Timer de timeout de tool nunca se cancela en éxito (call-manager.ts:660–666)

```typescript
result = await Promise.race([
  toolRegistry.executeTool(toolName, args, { ... }),
  new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error('tool_timeout')), this.config.VOICE_TOOL_TIMEOUT_MS),
  ),
])
```

Cuando la tool termina antes del timeout, el `Promise.race` resuelve pero el `setTimeout` interno sigue vivo. No se almacena referencia al timer, así que nunca se hace `clearTimeout`. El reject del timeout eventualmente dispara, pero como la promise ya resolvió, el error se pierde — **sin consecuencia funcional** en este caso porque el reject de una promise ya resuelta es no-op. Sin embargo:

- **Leak sutil**: el timer retiene la closure y sus references hasta que dispara (hasta 10s por defecto).
- Si hay muchas tool calls simultáneas, acumula timers fantasma.

**Fix:** Usar `AbortController` o almacenar el timer ID y limpiarlo en `finally`.

**Severidad: BAJA** — No es un bug funcional, pero es un leak de recursos en llamadas con mucho tool use.

---

### BUG-3: Fallback de Gemini re-registra event listeners (gemini-live.ts:135–156)

Cuando el primary model falla y se llama `connectWithModel(fallbackModel)`, se crea un nuevo WebSocket con nuevos listeners. **Pero** los listeners `onClose` y `onError` del WebSocket del primary ya llamaron `this.events.onClose()` y `this.events.onError()` antes del cleanup en línea 106.

Secuencia problemática:
1. Primary WS conecta → `on('open')` → `sendSetup()` 
2. Primary WS falla post-open (ej: setup message rechazado) → `on('error')` → `this.events.onError(err)` → **call-manager recibe error del primary**
3. Primary WS → `on('close')` → `this.events.onClose()` → **call-manager piensa que la sesión cerró**
4. `connect()` catch → intenta fallback
5. `connectWithModel(fallback)` → `removeAllListeners()` en WS anterior (ya cerrado, tarde)
6. Fallback conecta exitosamente

En paso 3, `call-manager.ts` tiene `onClose: () => { logger.info(...) }` que solo loguea. En `onError`, solo loguea. **No hay destrucción de estado**, así que el bug es cosmético (logs espurios). Pero si alguien agrega lógica real a `onClose` (cleanup, notificación), se rompe.

**Severidad: MEDIA** — No rompe ahora, pero es una trampa para futuros cambios.

---

## CÓDIGO MUERTO / REDUNDANCIA

### DEAD-1: `outboundCallInfo` Map + `getOutboundCallInfo()` + `OutboundCallInfo` type (call-manager.ts:24, 184–186)

El método `getOutboundCallInfo()` **nunca se invoca** en ningún archivo. El `reason` se pasa directamente a `preloadContext → buildSystemInstruction`, haciendo innecesario almacenar `OutboundCallInfo` en un Map separado.

- `outboundCallInfo` Map: almacena info que nadie lee
- `outboundInfoCleanupTimers` Map: timers para limpiar algo que nadie usa
- `OutboundCallInfo` interface (types.ts:385–390): tipo para datos que nadie consume
- Cleanup en `endCall()` (lines 539–550): limpia un Map que nadie lee
- Cleanup en `shutdown()` (lines 589–593): limpia timers de un Map que nadie lee

**Son ~30 líneas de código muerto.** La info `contactName` y `contactId` dentro de `OutboundCallInfo` están siempre `null` — nunca se actualizan.

---

### DEAD-2: `VOICE_ANSWER_DELAY_RINGS` config param (manifest.ts:319, types.ts:36)

Marcado como "deprecated" en comentario pero sigue en el schema y en `TwilioVoiceConfig`. Nadie lo lee. Solo genera confusión en la consola para el usuario.

---

## DEUDA TÉCNICA

### DEBT-1: Context promise almacenada vía cast a `Record<string, unknown>` (call-manager.ts:98, 177)

```typescript
;(this as unknown as Record<string, unknown>)[`_ctx_${callSid}`] = contextPromise
```

Esto ya existía antes de estos cambios, pero los nuevos cambios lo perpetúan. Es type-unsafe, invisible al compilador, y propenso a leaks si `onMediaStreamStart` nunca se llama (el delete en línea ~204 no ejecuta). Debería ser un `Map<string, Promise<PreloadedContext>>`.

**Nota:** Este pattern pre-existía; no fue introducido en estas fases. Lo menciono porque se tocó y no se mejoró.

---

### DEBT-2: Session huérfana si la llamada crashea (call-manager.ts:211–218)

Si se crea la session (`INSERT INTO sessions`) pero Gemini falla en `connect()`, la llamada se termina con `endCall(streamSid, 'error')`. En `endCall()`, `persistToMemory` requiere `call.contactId && call.sessionId`, y si el transcript está vacío, no pasa nada. **Pero la session queda `status='active'` eternamente** porque:

1. `persistToMemory` solo cierra la session si hay transcript (`if (transcript.length === 0) return`)
2. `endCall` no cierra la session directamente

**Fix necesario:** En `endCall()`, si `call.sessionId` existe y el transcript está vacío, ejecutar un `UPDATE sessions SET status='closed' WHERE id = $1`.

**Severidad: MEDIA** — Sessions zombie acumulándose. El plan menciona "nightly batch sweep for active sessions >2h" como mitigación, pero ese sweep no fue implementado.

---

### DEBT-3: `cancelledToolCalls` Set crece indefinidamente durante la llamada (call-manager.ts, types.ts:131)

Cada barge-in agrega IDs al Set. Nunca se limpian durante la vida de la llamada. En llamadas largas con muchos tool calls + barge-ins, el Set crece sin límite. Bajo en práctica (pocas tools por llamada), pero el principio es incorrecto.

---

### DEBT-4: No se valida que `VOICE_ANSWER_DELAY_MIN_RINGS <= VOICE_ANSWER_DELAY_MAX_RINGS` (manifest.ts:320–321)

Si el usuario configura min=5, max=2 en la consola, `Math.random() * (2 - 5 + 1) + 5` produce valores entre 2 y 5, lo cual contradice la intención. Debería haber un `.refine()` en el Zod schema o un guard en runtime.

---

### DEBT-5: Rate limit por teléfono, no por contactId (call-manager.ts:143)

El plan dice "Rate Limit by Contact" con `contactId`, pero la implementación usa `toNumber` (teléfono). Funciona, pero un contacto con múltiples números no queda protegido como grupo. Discrepancia plan vs implementación.

---

## COMPLEJIDAD INNECESARIA

### COMPLEX-1: Doble sistema de "reason" para outbound calls

El `reason` fluye por dos caminos paralelos:
1. **Funcional:** `initiateOutboundCall(reason)` → `preloadContext(reason)` → `buildSystemInstruction(reason)` — este es el que realmente se usa
2. **Muerto:** `initiateOutboundCall(reason)` → `outboundCallInfo.set(callSid, { reason, ... })` → nunca se lee

Eliminar el camino 2 simplifica significativamente.

---

## INCOHERENCIAS

### INCO-1: Business hours usa `throw new Error()` vs el plan que dice `return { error: ... }` (call-manager.ts:133–139)

El plan Phase 3 especifica:
```typescript
return { error: 'Fuera de horario laboral (fin de semana)' }
```

La implementación hace:
```typescript
throw new Error('Fuera de horario laboral (fin de semana)')
```

Ambos funcionan porque la API route tiene try/catch, pero el contrato es diferente: throw lanza un 500 genérico, return daría un error semántico. Actualmente en `manifest.ts:87–96` el route handler no distingue — captura todo con un catch genérico. No es un bug porque el error llega al caller, pero es una incoherencia con el plan.

---

### INCO-2: La sesión se crea ANTES de saber si Gemini conecta (call-manager.ts:211 vs 290)

La session se inserta en `sessions` table inmediatamente al recibir el media stream. Pero Gemini podría fallar al conectar (línea 290). Resultado: session creada en DB pero sin mensajes, sin cierre, sin cleanup. Relacionado con DEBT-2.

---

### INCO-3: `generateCallSummary` removida pero `completeCall` sigue recibiendo `summary` param (pg-store.ts:107)

```typescript
export async function completeCall(db, callSid, endReason, summary, modelUsed)
```

Siempre se llama con `summary = null`. El parámetro debería eliminarse o el UPDATE no debería tocar la columna summary.

---

## LO QUE ESTÁ BIEN

- **Fase 0 (Gemini 3.1 + fallback):** Bien estructurada. La separación `connect()` / `connectWithModel()` es clean. El `buildModelSpecificConfig()` maneja correctamente la diferencia 3.1 vs 2.5.
- **Fase 1 (Greeting gate):** Lógica simple y efectiva. `greetingDone = direction === 'outbound'` es elegante.
- **Fase 1 (Freeze detection):** El pattern de re-inyectar transcript + escalamiento es robusto. Timer cleanup en `endCall` correcto.
- **Fase 2 (Silence detector):** `resetState()` en `onTurnComplete` es una mejora real. Post-greeting timeout configurable resuelve un problema real de UX.
- **Fase 4 (Memory pipeline):** Integración con el pipeline de compresión existente bien hecha. Uso de `crypto.randomUUID()` en lugar de pseudo-IDs es correcto. El throttle de `updateSessionActivity` (1/min) es sensato para el hot path de audio.
- **Config y console fields:** Bien organizados, con dividers apropiados, labels bilingües, info descriptiva.
- **Migration 041:** Simple, idempotente con `IF NOT EXISTS`. Correcto.

---

## RESUMEN EJECUTIVO

| Categoría | Count | Severidad más alta |
|-----------|-------|--------------------|
| Bugs | 3 | ALTA (BUG-1) |
| Código muerto | 2 | — |
| Deuda técnica | 5 | MEDIA (DEBT-2) |
| Complejidad innecesaria | 1 | — |
| Incoherencias | 3 | — |

**Acción inmediata requerida:**
1. Fixear `getLocalDayOfWeek()` (BUG-1) — puede bloquear/permitir llamadas en horas incorrectas
2. Cerrar sessions huérfanas en `endCall()` cuando transcript está vacío (DEBT-2)

**Cleanup recomendado:**
3. Eliminar `outboundCallInfo` Map, `getOutboundCallInfo()`, `OutboundCallInfo` type, y todos los timers/cleanup asociados (DEAD-1)
4. Eliminar `VOICE_ANSWER_DELAY_RINGS` deprecated de config y types (DEAD-2)
5. Limpiar el timeout timer del `Promise.race` en tool execution (BUG-2)
6. Eliminar param `summary` de `completeCall()` (INCO-3)
7. Validar min ≤ max para ring delay (DEBT-4)
