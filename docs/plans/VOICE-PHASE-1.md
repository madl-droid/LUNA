# Fase 1: Experiencia de Llamada — Greeting Gate, Freeze Detection, Filler, Tool Cancel

## Objetivo
Eliminar los edge cases que hacen que LUNA pierda llamadas o suene poco natural: ruido pre-saludo, Gemini congelado, silencio durante tools, respuestas stale por barge-in.

## Prerequisitos
- **Fase 0 completa**: necesita onUserTranscript (para freeze detection) y onToolCallCancellation (para tool cancel)

## Archivos a modificar

### 1. `types.ts` — Nuevos campos en ActiveCall
**Líneas afectadas**: ActiveCall (76-91)

Agregar:
```typescript
// Greeting gate
greetingDone: boolean                           // false hasta primer turn de Gemini

// Freeze detection
geminiSpeaking: boolean                         // true mientras Gemini produce audio
geminiResponseTimer: ReturnType<typeof setTimeout> | null
geminiFreezeAttempts: number                    // 0=nada, 1=re-inyectado, 2+=hangup
lastCallerTranscript: string                    // último texto reconocido del caller
lastRawCallerAudioAt: number                    // timestamp último chunk de audio crudo

// Tool cancel por barge-in
cancelledToolCalls: Set<string>                 // IDs de tools cancelados
```

### 2. `manifest.ts` — Nuevos configs
**Líneas afectadas**: configSchema (291-331), console fields (345-573)

```
VOICE_GEMINI_FREEZE_TIMEOUT_MS    numEnv(10000)    // ms sin respuesta de Gemini → recovery
VOICE_TOOL_FILLER_DELAY_MS        numEnv(3000)     // ms antes de inyectar filler
VOICE_TOOL_TIMEOUT_MS             numEnv(10000)    // ms timeout por intento de tool
VOICE_TOOL_MAX_RETRIES            numEnvMin(0, 1)  // reintentos de tool
```

Console fields: sección "Comportamiento de llamada" con estos 4 params.

### 3. `call-manager.ts` — Greeting gate + Freeze + Filler + Tool cancel

#### 3A. Greeting Gate
**Líneas afectadas**: onMediaStreamStart (147-162, init ActiveCall), onMediaReceived (276-288)

**Inicialización** (en creación de ActiveCall):
```typescript
greetingDone: false,
```

**Gate en onMediaReceived()**:
```typescript
onMediaReceived(streamSid: string, mulawBuffer: Buffer): void {
  const call = this.getCallByStreamSid(streamSid)
  if (!call) return

  // GREETING GATE: no enviar audio del caller hasta que Gemini complete el saludo
  if (!call.greetingDone && call.direction === 'inbound') return

  // ... resto del flujo existente (convert, feed silence detector, send to Gemini)
}
```

**Desbloqueo** (en callback onTurnComplete, ~línea 240):
```typescript
// Primer turn completo = greeting terminó
if (!call.greetingDone) {
  call.greetingDone = true
  // Reiniciar silence detector con timeout normal
}
```

**Nota**: Para outbound, `greetingDone` empieza en `true` (el caller ya está escuchando cuando Gemini saluda).

#### 3B. Freeze Detection
**Líneas afectadas**: nuevas funciones, callbacks onAudio (~210), onUserTranscript (nuevo de Fase 0)

**Nueva función `startGeminiResponseTimer(call)`**:
```
Timer de VOICE_GEMINI_FREEZE_TIMEOUT_MS:
  │
  ├── Si call.geminiSpeaking → cancelar timer, resetear attempts (ok, está respondiendo)
  │
  ├── Si no hay audio crudo reciente del caller → dejar al silence detector
  │   (el caller se fue, no es freeze de Gemini)
  │
  ├── attempt < 2 → re-inyectar último transcript como texto:
  │   sendTextInput("[Sistema: No respondiste al caller. Su último mensaje fue:
  │   '{lastCallerTranscript}'. Respóndele ahora.]")
  │   Reiniciar timer para 2do intento
  │
  └── attempt >= 2 → endCall(callSid, "gemini_freeze")
```

**Se activa cuando** (callback onUserTranscript):
```typescript
call.lastCallerTranscript = text
call.lastRawCallerAudioAt = Date.now()
if (!call.geminiSpeaking) {
  startGeminiResponseTimer(call)
}
```

**Se cancela cuando** (callback onAudio, ~línea 210):
```typescript
if (!call.geminiSpeaking) {
  call.geminiSpeaking = true
  if (call.geminiResponseTimer) {
    clearTimeout(call.geminiResponseTimer)
    call.geminiResponseTimer = null
  }
  call.geminiFreezeAttempts = 0
}
```

**Se resetea en onTurnComplete**:
```typescript
call.geminiSpeaking = false
```

#### 3C. Filler Inteligente + Timeout + Retry
**Líneas afectadas**: handleToolCall (422-481)

Nueva lógica de handleToolCall():
```
Gemini pide tool(id, name, args)
  │
  ├── Es end_call? → manejar como ahora (líneas 433-444)
  │
  └── Tool normal:
      │
      ├── Iniciar fillerTimer (VOICE_TOOL_FILLER_DELAY_MS = 3s):
      │   → sendTextInput("[Sistema: la herramienta '{name}' está tardando.
      │      Decile algo breve y natural al caller mientras esperamos.]")
      │
      ├── Ejecutar con timeout (VOICE_TOOL_TIMEOUT_MS = 10s):
      │   result = await Promise.race([
      │     toolRegistry.executeTool(name, args, context),
      │     timeoutPromise(VOICE_TOOL_TIMEOUT_MS)
      │   ])
      │
      ├── Si timeout + retries disponibles:
      │   → sendTextInput("[Sistema: Sigue tardando. Decile que estás 
      │      reintentando, algo como 'hmm, dejame intentar de nuevo'.]")
      │   → Reintentar tool (mismo loop)
      │
      ├── Si timeout + sin retries:
      │   → sendTextInput("[Sistema: La herramienta '{name}' falló después 
      │      de reintentar. Decile que no pudiste completar esa acción ahora
      │      pero que lo dejás agendado para hacerlo después de la llamada.
      │      Usa la herramienta end_call si ya no hay más temas.]")
      │   → Enviar toolResponse con error a Gemini
      │   → (Gemini registra commitment naturalmente via su system instruction)
      │
      ├── Si cancelado por barge-in (cancelledToolCalls.has(id)):
      │   → Descartar resultado
      │   → Limpiar buffer de Twilio: mediaServer.clearAudio(streamSid)
      │   → return (no enviar toolResponse)
      │
      └── Success:
          → Limpiar fillerTimer
          → Enviar toolResponse con resultado a Gemini
          → Agregar a transcript: [Tool: {name}] success/error
```

#### 3D. Tool Cancel por Barge-in
**Líneas afectadas**: callback de onToolCallCancellation (nuevo de Fase 0)

```typescript
// En callbacks de GeminiLiveSession:
onToolCallCancellation: (ids: string[]) => {
  for (const id of ids) {
    call.cancelledToolCalls.add(id)
  }
  // Limpiar buffer de audio de Twilio (el caller interrumpió)
  if (call.streamSid) {
    mediaServer.clearAudio(call.streamSid)
  }
}
```

**En media-stream.ts** — agregar método `clearAudio(streamSid)`:
```typescript
// Envía evento "clear" a Twilio para limpiar buffer de audio pendiente
clearAudio(streamSid: string): void {
  const ws = this.connections.get(streamSid)
  if (ws?.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ event: 'clear', streamSid }))
  }
}
```

## Inicialización de ActiveCall (valores nuevos)

```typescript
const call: ActiveCall = {
  // ... campos existentes ...
  greetingDone: direction === 'outbound',  // outbound empieza desbloqueado
  geminiSpeaking: false,
  geminiResponseTimer: null,
  geminiFreezeAttempts: 0,
  lastCallerTranscript: '',
  lastRawCallerAudioAt: 0,
  cancelledToolCalls: new Set(),
}
```

## Verificación
- [ ] Inbound: no se escucha ruido del caller durante el saludo de Gemini
- [ ] Outbound: audio del caller pasa inmediatamente (greetingDone=true)
- [ ] Si Gemini se congela >10s, re-inyecta transcript y responde
- [ ] 2do freeze consecutivo = hangup con razón "gemini_freeze"
- [ ] Tool >3s: Gemini dice algo natural como filler
- [ ] Tool >10s: retry automático con filler
- [ ] Tool falla 2 veces: propone agendar como commitment
- [ ] Barge-in durante tool: resultado descartado, buffer limpiado
- [ ] Transcript refleja todos estos eventos como entries tipo "system"

## Riesgos
- **Greeting gate en outbound**: si el caller contesta y habla antes de que Gemini salude, podría perderse audio. Por eso outbound empieza con greetingDone=true.
- **Freeze detection false positives**: si el caller habla pero Gemini tarda naturalmente en responder (e.g., procesando algo complejo), el timer podría activarse prematuramente. El timeout de 10s debería ser suficiente para la mayoría de casos.
- **Filler puede sonar repetitivo**: las frases las genera Gemini según contexto, no son fijas. Pero si hay muchos tools lentos en una llamada, podría repetirse el patrón. Mitigación: el prompt de filler pide "algo breve y natural", Gemini varía.
