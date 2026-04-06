# Fase 0: Migración a Gemini 3.1 Flash Live + Fallback

## Objetivo
Migrar de gemini-2.5-flash a gemini-3.1-flash-live-preview como modelo primario, con fallback automático a 2.5 si falla la conexión. Habilitar transcripción nativa bidireccional y toolCallCancellation.

## Prerequisitos
- Ninguno (es la base)

## Archivos a modificar

### 1. `manifest.ts` — Nuevos configs
**Líneas afectadas**: configSchema (291-331), console fields (345-573)

Agregar:
```
VOICE_GEMINI_FALLBACK_MODEL   string   default: "gemini-2.5-flash-live-preview"
VOICE_GEMINI_THINKING_LEVEL   enum     "minimal"|"low"|"medium"|"high"  default: "minimal"
```

Cambiar:
```
VOICE_GEMINI_MODEL            default: "gemini-2.5-flash" → "gemini-3.1-flash-live-preview"
```

Console fields: agregar dropdown para fallback model y thinking level.

### 2. `types.ts` — Nuevos eventos + campos ActiveCall
**Líneas afectadas**: GeminiLiveEvents (~gemini-live.ts:19-27), ActiveCall (76-91)

**GeminiLiveEvents** — agregar 3 callbacks:
```typescript
onUserTranscript: (text: string, isFinal: boolean) => void
onAgentTranscript: (text: string, isFinal: boolean) => void
onToolCallCancellation: (ids: string[]) => void
```

**ActiveCall** — agregar:
```typescript
modelUsed: string    // qué modelo se conectó realmente (3.1 o 2.5 fallback)
```

### 3. `gemini-live.ts` — Setup message + parsing + fallback
**Líneas afectadas**: sendSetup (165-223), handleMessage (225-282), connect (45-91)

#### 3A. `sendSetup()` — Adaptar al modelo conectado

Agregar al setup message:
```typescript
// Transcripción nativa (ambas direcciones)
outputAudioTranscription: {},
inputAudioTranscription: {},

// Thinking level (varía por modelo)
// 3.1: thinkingConfig: { thinkingLevel: "MINIMAL" }
// 2.5: thinkingConfig: { thinkingBudget: 0 }
```

Crear helper `buildModelSpecificConfig(model: string)`:
- Si model contiene "3.1" → `{ thinkingLevel: config.thinkingLevel.toUpperCase() }`
- Si model contiene "2.5" → `{ thinkingBudget: 0 }`
- Default → `{ thinkingLevel: "MINIMAL" }`

#### 3B. `handleMessage()` — Parsear nuevos eventos

Agregar parsing para:
```typescript
// Transcripción del agente (lo que Gemini DIJO)
if (msg.serverContent?.outputTranscription?.text) {
  events.onAgentTranscript(text, isFinal)
}

// Transcripción del caller (lo que el usuario DIJO)
if (msg.serverContent?.inputTranscription?.text) {
  events.onUserTranscript(text, isFinal)
}

// Tools cancelados por barge-in
if (msg.toolCallCancellation?.ids) {
  events.onToolCallCancellation(ids)
}
```

#### 3C. `connect()` — Fallback automático

Lógica actual (línea 45-91): intenta conexión una vez.

Nueva lógica:
```
1. Intentar conexión con modelo primario (VOICE_GEMINI_MODEL)
2. Si falla (timeout o error WS):
   a. Log warning: "Primary model failed, trying fallback"
   b. Intentar conexión con VOICE_GEMINI_FALLBACK_MODEL
   c. Adaptar setup message al modelo fallback (buildModelSpecificConfig)
3. Si ambos fallan → throw error (llamada no se puede establecer)
4. Guardar modelo usado en session para registro en DB
```

Exponer `modelUsed: string` en la instancia de GeminiLiveSession para que call-manager lo guarde en ActiveCall.

### 4. `call-manager.ts` — Registrar modelo usado
**Líneas afectadas**: onMediaStreamStart (130-271)

Después de conectar Gemini:
```typescript
call.modelUsed = gemini.modelUsed
```

En `endCall()`: incluir `modelUsed` al guardar en DB (pg-store).

### 5. `pg-store.ts` — Columna model_used (opcional)
Agregar columna `model_used TEXT` a tabla `voice_calls`.
Migración: `src/migrations/0XX_voice-model-tracking.sql`

## Verificación
- [ ] Llamada inbound conecta con gemini-3.1-flash-live-preview
- [ ] Si 3.1 no disponible, cae a 2.5 automáticamente
- [ ] Transcripción nativa aparece en logs (onUserTranscript, onAgentTranscript)
- [ ] toolCallCancellation se parsea correctamente
- [ ] model_used se registra en voice_calls
- [ ] Config hot-reload funciona para cambiar modelo primario/fallback

## Riesgos
- **API de Gemini 3.1 puede tener campos diferentes** a lo documentado. Testear con llamada real.
- **Transcripción nativa puede no estar disponible** en preview. Si falla, degradar gracefully (los callbacks no se llaman, todo sigue funcionando).
- **thinkingLevel vs thinkingBudget**: si el modelo no reconoce el campo, puede ignorarlo silenciosamente o rechazar el setup. El fallback a 2.5 cubre este caso.
