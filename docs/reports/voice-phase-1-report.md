# INFORME DE CIERRE — Sesión Voice Phase 1: Experiencia de Llamada
## Branch: claude/voice-phase-1-ZbCzq

### Objetivos definidos
Implementar los 4 sub-features de Fase 1 del plan de mejora de voz:
- **3A. Greeting Gate**: bloquear ruido pre-saludo en llamadas inbound
- **3B. Freeze Detection**: recuperar o colgar si Gemini se congela tras turno del caller
- **3C. Filler + Timeout + Retry**: filler natural mientras tools lentas, reintentos, fallback a commitment
- **3D. Tool Cancel por barge-in**: descartar resultado si caller interrumpió, limpiar buffer Twilio

### Completado ✅
- **3A. Greeting Gate** (`call-manager.ts` + `types.ts`)
  - `greetingDone: boolean` en `ActiveCall` (inbound=false, outbound=true)
  - `onMediaReceived`: gate que bloquea audio del caller hasta `greetingDone=true`
  - `onTurnComplete`: primer turn completo → `greetingDone=true`, inicia `silenceDetector`
  - Silence detector: inbound lo arranca en `onTurnComplete`, outbound lo arranca tras `connect()`
  - `lastRawCallerAudioAt` actualizado en cada chunk que pasa el gate

- **3B. Freeze Detection** (`call-manager.ts` + `types.ts`)
  - Nuevos campos: `geminiSpeaking`, `geminiResponseTimer`, `geminiFreezeAttempts`, `lastCallerTranscript`, `lastRawCallerAudioAt`
  - `onAudio`: cuando Gemini produce audio → `geminiSpeaking=true`, cancela timer, resetea `geminiFreezeAttempts`
  - `onTurnComplete`: `geminiSpeaking=false`
  - `onUserTranscript` (isFinal): actualiza `lastCallerTranscript` + `lastRawCallerAudioAt`, arranca `startGeminiResponseTimer`
  - `startGeminiResponseTimer()`: timer privado con re-inyección en intento 1, hangup `'gemini_freeze'` en intento 2
  - Guard: si caller está en silencio (`lastRawCallerAudioAt` viejo) → no es freeze, silence detector lo maneja
  - `endCall`: limpia `geminiResponseTimer` para evitar leaks
  - `CallEndReason` extendido con `'gemini_freeze'`

- **3C. Filler + Timeout + Retry** (`call-manager.ts`)
  - `handleToolCall` reescrito con loop `while (attempt <= maxRetries)`
  - `fillerTimer`: a los `VOICE_TOOL_FILLER_DELAY_MS` ms inyecta prompt contextual a Gemini (variado entre primer intento y reintentos)
  - `Promise.race` con `VOICE_TOOL_TIMEOUT_MS` para timeout por intento
  - Agota reintentos: Gemini recibe prompt para proponer agendar el commitment + `toolResponse` con error
  - Barge-in check dentro del loop antes de enviar resultado

- **3D. Tool Cancel por barge-in** (`call-manager.ts`)
  - `cancelledToolCalls: Set<string>` en `ActiveCall`
  - `onToolCallCancellation`: registra IDs + `mediaServer.clearAudio(streamSid)`
  - `handleToolCall`: check `cancelledToolCalls.has(toolCallId)` → descarta resultado, limpia buffer, `return`

- **manifest.ts**: 4 nuevos config params + console fields en sección "Comportamiento de llamada"
  - `VOICE_GEMINI_FREEZE_TIMEOUT_MS` (default 10000 ms)
  - `VOICE_TOOL_FILLER_DELAY_MS` (default 3000 ms)
  - `VOICE_TOOL_TIMEOUT_MS` (default 10000 ms)
  - `VOICE_TOOL_MAX_RETRIES` (default 1)

- **types.ts**: `TwilioVoiceConfig` extendido con los 4 nuevos parámetros

### No completado ❌
Nada. Todos los objetivos de Fase 1 fueron implementados.

### Archivos creados/modificados
| Archivo | Tipo | Cambio |
|---------|------|--------|
| `src/modules/twilio-voice/types.ts` | Modificado | +7 campos en `ActiveCall`, +4 en `TwilioVoiceConfig`, `'gemini_freeze'` en `CallEndReason` |
| `src/modules/twilio-voice/manifest.ts` | Modificado | +4 config params en schema, +4 console fields |
| `src/modules/twilio-voice/call-manager.ts` | Modificado | +~187 líneas: greeting gate, freeze detection, filler/timeout/retry, tool cancel |

**Archivos NO modificados** (ya tenían lo necesario):
- `media-stream.ts`: `clearAudio()` ya existía

### Interfaces expuestas (exports que otros consumen)
- `ActiveCall` en `types.ts`: nuevos campos (ningún consumidor externo directo, solo `call-manager.ts`)
- `TwilioVoiceConfig`: campos nuevos disponibles para cualquier módulo que lea la config
- `CallEndReason`: `'gemini_freeze'` disponible para hooks `call:ended`

### Dependencias instaladas
Ninguna nueva.

### Tests
No hay tests automáticos para este módulo. Verificación manual según checklist del plan:
- [ ] Inbound: no se escucha ruido del caller durante saludo de Gemini
- [ ] Outbound: audio del caller pasa inmediatamente (greetingDone=true)
- [ ] Si Gemini se congela >10s, re-inyecta transcript y responde
- [ ] 2do freeze consecutivo = hangup con razón "gemini_freeze"
- [ ] Tool >3s: Gemini dice algo natural como filler
- [ ] Tool >10s: retry automático con filler
- [ ] Tool falla 2 veces: propone agendar como commitment
- [ ] Barge-in durante tool: resultado descartado, buffer limpiado
- [ ] Transcript refleja eventos como entries tipo "system"

### Decisiones técnicas
1. **Silence detector diferido para inbound**: en vez de arrancarlo en `connect()` y que expire durante el greeting, se arranca en `onTurnComplete` al hacer `greetingDone=true`. Outbound lo arranca inmediatamente (ya tiene `greetingDone=true`).
2. **Freeze detection by `lastRawCallerAudioAt`**: el guard "¿está el caller en silencio?" usa el timestamp de audio crudo (no transcripción) para no activar freeze si el caller se fue silencioso naturalmente — en ese caso el silence detector ya lo maneja.
3. **Filler generado por Gemini**: el prompt de filler no es un texto hardcodeado sino una instrucción sistema para que Gemini genere algo contextual y variado. Evita repetición robótica.
4. **`cancelledToolCalls` no se limpia**: se acumulan en el Set. Para llamadas largas con muchos tools esto es un leak menor, pero aceptable dado el scope de las llamadas de voz.
5. **`geminiFreezeAttempts` se resetea en `onAudio`**: no en `onTurnComplete`, para cubrir el caso de que Gemini empiece a responder pero no complete el turn aún.

### Riesgos o deuda técnica
- **False positives de freeze**: si Gemini tarda naturalmente en procesar (e.g., contexto pesado), el timer de 10s podría activarse. Valores default conservadores mitigan esto.
- **`cancelledToolCalls` no purgado**: si una llamada invoca muchas tools con barge-in repetido, el Set crece. Riesgo menor, acotado por duración de llamada.
- **Greeting gate y outbound**: si el caller habla antes de que Gemini salude en outbound, el audio pasa (greetingDone=true). Es el comportamiento correcto.

### Notas para integración
- Los 4 nuevos params de config tienen valores por defecto razonables. No requieren config en `.env` para funcionar.
- `CallEndReason: 'gemini_freeze'` ya puede ser consumido en hooks `call:ended` para métricas/alertas.
- Fase 2 (Silence Detector mejorado) depende de `greetingDone` de esta fase — ya está disponible.
