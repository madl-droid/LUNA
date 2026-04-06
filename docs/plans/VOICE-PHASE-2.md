# Fase 2: Silence Detector Mejorado

## Objetivo
Manejo de silencio más inteligente: timeout extendido post-greeting (dar tiempo al caller), debounce por audio reciente, y reset del state machine cuando la conversación fluye.

## Prerequisitos
- **Fase 0**: conexión Gemini funcional
- **Fase 1A**: `greetingDone` flag (necesario para saber cuándo activar timeout extendido)

## Archivos a modificar

### 1. `manifest.ts` — Nuevos configs
**Líneas afectadas**: configSchema (291-331)

```
VOICE_POST_GREETING_SILENCE_TIMEOUT_MS   numEnv(30000)   // 30s timeout tras saludo
```

Console fields: agregar en sección "Silencio y timeouts".

### 2. `silence-detector.ts` — 3 mejoras
**Archivo completo afectado** (135 líneas actuales)

#### 2A. Post-greeting extended timeout

**Estado actual** (línea 32-36): constructor recibe un solo `timeoutMs`.

**Cambio**: Aceptar `postGreetingTimeoutMs` adicional.

```typescript
constructor(
  timeoutMs: number,              // timeout normal (10s)
  postGreetingTimeoutMs: number,  // timeout post-greeting (30s)
  rmsThreshold: number,
  events: SilenceEvents
)
```

**Nuevo estado por call**:
```typescript
interface CallSilenceState {
  // ... campos existentes ...
  isPostGreeting: boolean      // true hasta que caller hable por primera vez
}
```

**En createTimer()**: usar `postGreetingTimeoutMs` si `isPostGreeting`, sino `timeoutMs`.

**Transición**: cuando `feedAudio()` detecta voz (`rms > threshold`) y `isPostGreeting=true`:
```typescript
state.isPostGreeting = false  // caller habló, switch a timeout normal
```

#### 2B. Reset en conversación fluida

**Problema actual**: el state machine acumula estado (listening → prompting → final-warning) y solo resetea con voz detectada.

**Agregar método público**:
```typescript
resetState(callId: string): void {
  const state = this.calls.get(callId)
  if (!state) return
  state.state = 'listening'
  state.silencePromptsSent = 0  // si existe, o equivalent
  this.restartTimer(callId)
}
```

**Llamar desde call-manager.ts** en callback `onTurnComplete`:
```typescript
// Gemini completó un turn = conversación fluye normalmente
silenceDetector.resetState(callId)
```

Esto evita que un silencio natural entre turns (mientras Gemini procesa) acumule estado innecesariamente hacia "prompting" o "final-warning".

#### 2C. Debounce por audio reciente

**Problema actual** (handleTimeout, línea 102-133): cuando el timer dispara, actúa inmediatamente sin verificar si hubo actividad reciente.

**Cambio en handleTimeout()**:
```typescript
handleTimeout(callId: string): void {
  const state = this.calls.get(callId)
  if (!state) return

  // DEBOUNCE: si hubo voz reciente, reiniciar timer en vez de escalar
  const msSinceVoice = Date.now() - state.lastVoiceActivity
  const currentTimeout = state.isPostGreeting 
    ? this.postGreetingTimeoutMs 
    : this.timeoutMs

  if (state.lastVoiceActivity > 0 && msSinceVoice < currentTimeout) {
    this.restartTimer(callId)  // hay actividad reciente, no escalar
    return
  }

  // ... lógica existente de escalamiento (listening → prompting → final-warning)
}
```

Esto previene false positives cuando el silence detector no captura bien un RMS bajo (e.g., caller susurrando) pero sí hay actividad real.

### 3. `call-manager.ts` — Integración
**Líneas afectadas**: constructor de SilenceDetector (~línea 248), onTurnComplete callback (~línea 240)

**Constructor**: pasar nuevo param `postGreetingTimeoutMs` al crear SilenceDetector.

**onTurnComplete**: llamar `silenceDetector.resetState(callId)`.

**startSilenceMonitoring()**: marcar `isPostGreeting = true` al iniciar (tras greeting).

## Flujo completo post-cambios

```
Gemini completa greeting (greetingDone = true)
  │
  ├── Silence detector arranca con timeout = 30s (post-greeting)
  │
  ├── Caller NO habla en 30s:
  │   └── prompting: Gemini pregunta "Hola? Me escuchás?"
  │       └── +30s sin respuesta: final-warning → hangup
  │
  ├── Caller habla:
  │   ├── isPostGreeting = false (switch a timeout normal 10s)
  │   └── Conversación fluye normalmente
  │
  ├── Conversación normal:
  │   ├── Gemini completa turn → resetState() → listening, timer fresh
  │   ├── Silencio >10s → prompting: "¿Sigues ahí?"
  │   ├── Caller responde → reset a listening
  │   └── 2do silencio consecutivo → final-warning → hangup
  │
  └── Debounce:
      └── Timer dispara pero lastVoiceActivity fue hace 3s
          → reiniciar timer (no escalar)
```

## Verificación
- [ ] Tras greeting: caller tiene 30s para responder (no se cuelga a los 10s)
- [ ] Una vez que caller habla, timeout baja a 10s normal
- [ ] Entre turns de Gemini, el state machine resetea a "listening"
- [ ] Audio reciente (debounce) previene false positives de silencio
- [ ] Caller en silencio real: prompt → final warning → hangup (funciona como antes)

## Riesgos
- **Post-greeting 30s puede ser mucho** para algunos casos. Configurable via console, el operador ajusta.
- **Reset en onTurnComplete** asume que un turn completo = conversación fluye. Si Gemini hace turns muy cortos (e.g., un "hmm"), podría resetear el silence detector prematuramente. El debounce mitiga esto.
