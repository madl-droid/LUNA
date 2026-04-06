# INFORME DE CIERRE — Voice Phase 0: Migración a Gemini 3.1 Flash Live

## Branch: `claude/voice-phase-zero-p4KDc`

---

### Objetivos definidos

Migrar el módulo `twilio-voice` de `gemini-2.5-flash` a `gemini-3.1-flash-live-preview` como modelo primario, con:
1. Fallback automático a `gemini-2.5-flash-live-preview` si el primario falla
2. `thinkingConfig` adaptado por modelo (3.1 → `thinkingLevel`, 2.5 → `thinkingBudget`)
3. Transcripción nativa bidireccional (`inputAudioTranscription` + `outputAudioTranscription`)
4. Parsing de `toolCallCancellation` (barge-in cancels pending tools)
5. Registro de `model_used` en `voice_calls` DB

---

### Completado ✅

- **`manifest.ts`**: `VOICE_GEMINI_MODEL` default cambiado a `gemini-3.1-flash-live-preview`. Nuevos params en configSchema: `VOICE_GEMINI_FALLBACK_MODEL` (default: `gemini-2.5-flash-live-preview`) y `VOICE_GEMINI_THINKING_LEVEL` (enum minimal/low/medium/high, default: minimal). Console fields con dropdown para ambos.

- **`types.ts`**:
  - `TwilioVoiceConfig`: +`VOICE_GEMINI_FALLBACK_MODEL`, +`VOICE_GEMINI_THINKING_LEVEL`
  - `ActiveCall`: +`modelUsed: string`
  - `GeminiLiveConfig`: +`fallbackModel: string`, +`thinkingLevel: string`
  - `GeminiSetupMessage.generationConfig`: +`thinkingConfig?: { thinkingLevel?, thinkingBudget? }`, setup: +`outputAudioTranscription?`, +`inputAudioTranscription?`
  - `GeminiServerContent.serverContent`: +`outputTranscription?`, +`inputTranscription?`
  - `GeminiServerContent`: +`toolCallCancellation?: { ids: string[] }`
  - `VoiceCallRow`: +`model_used: string | null`

- **`gemini-live.ts`**:
  - `GeminiLiveEvents`: +`onUserTranscript`, +`onAgentTranscript`, +`onToolCallCancellation`
  - `GeminiLiveSession`: nueva propiedad pública `modelUsed: string`, privada `currentModel: string`
  - Nuevo método privado `buildModelSpecificConfig(model)`: devuelve `thinkingLevel` para 3.1, `thinkingBudget: 0` para 2.5
  - `connect()` refactorizado: intenta primary → si falla, intenta fallback → si ambos fallan, lanza error
  - Nuevo método privado `connectWithModel(model)`: extrae la lógica WS, limpia WS existente antes de retry
  - `sendSetup()`: usa `currentModel` (no `config.model`), agrega `thinkingConfig`, `outputAudioTranscription: {}`, `inputAudioTranscription: {}`
  - `handleMessage()`: parsea `toolCallCancellation`, `outputTranscription` (agent), `inputTranscription` (user)

- **`call-manager.ts`**:
  - Pasa `fallbackModel` y `thinkingLevel` al constructor de `GeminiLiveSession`
  - Inicializa `call.modelUsed = config.VOICE_GEMINI_MODEL` (actualizado después de connect)
  - Después de `gemini.connect()`: `call.modelUsed = gemini.modelUsed`
  - Log de `modelUsed` en "Audio bridge established"
  - Agrega 3 handlers: `onUserTranscript` (guarda entradas finales en transcript), `onAgentTranscript` (debug log), `onToolCallCancellation` (info log)
  - `endCall()`: pasa `call.modelUsed` a `pgStore.completeCall()`

- **`pg-store.ts`**: `completeCall()` acepta `modelUsed: string | null = null`, lo guarda en columna `model_used`

- **`src/migrations/041_voice-model-tracking.sql`**: `ALTER TABLE voice_calls ADD COLUMN IF NOT EXISTS model_used TEXT`

---

### No completado ❌

Nada — todos los objetivos de Fase 0 fueron implementados completamente.

---

### Archivos creados/modificados

| Archivo | Cambio |
|---------|--------|
| `src/modules/twilio-voice/types.ts` | Modificado — 7 interfaces extendidas |
| `src/modules/twilio-voice/gemini-live.ts` | Modificado — fallback, transcripción, cancellation |
| `src/modules/twilio-voice/manifest.ts` | Modificado — nuevo default + 2 params + console fields |
| `src/modules/twilio-voice/call-manager.ts` | Modificado — modelUsed tracking, 3 nuevos handlers |
| `src/modules/twilio-voice/pg-store.ts` | Modificado — completeCall con model_used |
| `src/migrations/041_voice-model-tracking.sql` | Creado — columna model_used en voice_calls |

---

### Interfaces expuestas (exports que otros consumen)

- `GeminiLiveSession.modelUsed: string` — accessible por call-manager después de `connect()`
- `GeminiLiveEvents` — tipo extendido con 3 callbacks nuevos (breaking change: los consumidores deben implementarlos)
- `GeminiLiveConfig` — tipo extendido con `fallbackModel` y `thinkingLevel` (required)
- `ActiveCall.modelUsed: string` — accesible para cualquier consumer del estado de llamada

---

### Dependencias instaladas

Ninguna nueva.

---

### Tests

No hay tests automatizados para este módulo. La verificación funcional requiere una llamada real.

Checklist de verificación manual (pendiente de deploy):
- [ ] Llamada inbound conecta con `gemini-3.1-flash-live-preview`
- [ ] Si 3.1 no disponible, cae a `gemini-2.5-flash-live-preview` automáticamente
- [ ] Log "Native caller transcript" aparece durante llamadas
- [ ] Log "Native agent transcript" aparece durante llamadas
- [ ] `toolCallCancellation` logueado correctamente en barge-in
- [ ] `model_used` guardado en `voice_calls` al terminar llamada
- [ ] Hot-reload desde console aplica nuevos valores de modelo

---

### Decisiones técnicas

1. **`connectWithModel()` privado**: evita duplicar la lógica WebSocket entre intento primario y fallback. Limpia el WS con `removeAllListeners()` antes del retry para evitar memory leaks / double-firing.

2. **`currentModel` vs `modelUsed`**: `currentModel` es estado interno durante la conexión; `modelUsed` es el resultado final expuesto públicamente. Separación clara de responsabilidades.

3. **`thinkingConfig` inline**: no se extrae a una función separada de `sendSetup()` porque `buildModelSpecificConfig()` ya hace el trabajo de branching. `sendSetup()` solo llama al helper.

4. **`onUserTranscript` agrega al transcript solo cuando `isFinal=true`**: evitar fragmentos parciales ruidosos. Los fragmentos intermedios se descartan silenciosamente.

5. **`onAgentTranscript` solo loguea**: el transcript del agente ya se captura por `onText`. La transcripción nativa se usa como validación/debug, no como fuente primaria para evitar duplicados.

6. **Migración `IF NOT EXISTS`**: idempotente para re-runs seguros.

---

### Riesgos o deuda técnica

- **API de Gemini 3.1 en preview**: los campos `outputAudioTranscription` / `inputAudioTranscription` en el setup message son los documentados pero podrían cambiar. Si se ignoran silenciosamente, la transcripción nativa simplemente no llega (degradación graceful).

- **`thinkingLevel` silently ignored**: si Gemini ignora `thinkingConfig` en el setup (modelos que no lo soportan), la llamada sigue funcionando sin penalización.

- **Doble transcript para el agente**: `onText` + `onAgentTranscript` pueden capturar el mismo contenido del agente. Si se quiere consolidar, en Fase 1+ se puede decidir usar solo la transcripción nativa y eliminar `onText` para el caso agent.

- **Fallback no reinicia silence detector**: el `silenceDetector.startMonitoring()` se inicia después de `gemini.connect()` independiente del modelo, lo que es correcto. Sin embargo, si el primary falla y el fallback tarda más, el timing del ring puede haberse consumido. Aceptable en esta fase.

---

### Notas para integración

- Fase 1 puede construir sobre `greetingDone` flag directamente en `call-manager.ts`.
- El campo `ActiveCall.modelUsed` está disponible para que Fases 1-4 logueen o tomen decisiones basadas en qué modelo se usó.
- Los 3 nuevos callbacks de `GeminiLiveEvents` son **required** en TypeScript — cualquier lugar que construya un objeto `GeminiLiveEvents` debe implementarlos (actualmente solo `call-manager.ts`).
