# LUNA — Guía para canales de voz

> Referencia técnica para agregar canales de voz al sistema. Complementa `channel-guide.md`.

## Diferencia: canal de voz vs canal de texto

Un canal de texto (WhatsApp, Email) envía mensajes discretos al pipeline de 5 fases del engine. Un canal de voz **NO usa el pipeline** — la conversación completa sucede en una sesión de streaming bidireccional con un modelo de voz (Gemini Live). LUNA provee contexto, tools y monitoreo, pero no controla la generación de cada respuesta.

```
Canal de texto:                       Canal de voz:
┌────────────┐                        ┌────────────┐
│  Mensaje   │                        │  Llamada   │
│  entrante  │                        │  entrante  │
└─────┬──────┘                        └─────┬──────┘
      │                                     │
      ▼                                     ▼
┌────────────┐                        ┌────────────────────────┐
│  Engine    │                        │  Voice Sub-Engine      │
│  Pipeline  │                        │                        │
│  5 fases   │                        │  1. Cargar contexto    │
│            │                        │  2. System instruction │
│  Phase 1   │                        │  3. Conectar Gemini    │
│  Phase 2   │                        │  4. Puente de audio    │
│  Phase 3   │                        │  5. Tool execution     │
│  Phase 4   │                        │  6. Transcripción      │
│  Phase 5   │                        │  7. Resumen + memoria  │
└────────────┘                        └────────────────────────┘
```

## Arquitectura de un canal de voz

```
Teléfono ←PSTN→ Proveedor telefonía ←WS→ LUNA ←WS→ Modelo de voz (LLM)
                 (Twilio, Vonage)          │         (Gemini Live)
                                           │
                                     ┌─────┴──────┐
                                     │  Contexto   │
                                     │  - Contacto │
                                     │  - Memoria  │
                                     │  - Prompts  │
                                     │  - Tools    │
                                     └────────────┘
```

### Componentes obligatorios

| Componente | Responsabilidad | Ejemplo (twilio-voice) |
|-----------|-----------------|----------------------|
| **Adapter** | Conecta con el proveedor de telefonía (REST API, TwiML, etc.) | `twilio-adapter.ts` |
| **Media Stream** | WebSocket server que recibe/envía audio del proveedor | `media-stream.ts` |
| **Voice LLM Client** | WebSocket client que conecta con el modelo de voz | `gemini-live.ts` |
| **Audio Converter** | Convierte entre formatos de audio (mulaw ↔ PCM, sample rates) | `audio-converter.ts` |
| **Call Manager** | State machine de llamadas, puente audio, tool execution | `call-manager.ts` |
| **Voice Engine** | Carga contexto, construye system instruction, genera resumen | `voice-engine.ts` |
| **Silence Detector** | VAD local para detectar silencio prolongado | `silence-detector.ts` |
| **PG Store** | Persistencia de llamadas y transcripciones | `pg-store.ts` |

## Paso 1: Estructura del módulo

```
src/modules/{mi-canal-voz}/
  manifest.ts          ← lifecycle, configSchema, console fields, webhooks
  types.ts             ← config interface, call states, API message types
  {provider}-adapter.ts    ← REST client del proveedor de telefonía
  media-stream.ts      ← WebSocket server para audio bidireccional
  {llm}-client.ts      ← WebSocket client para el modelo de voz
  audio-converter.ts   ← Conversión de formatos de audio
  call-manager.ts      ← State machine, puente audio, tool execution
  voice-engine.ts      ← Context loading, system instruction, summary
  silence-detector.ts  ← VAD local
  pg-store.ts          ← Tablas de llamadas y transcripciones
  CLAUDE.md            ← Documentación del módulo
  .env.example         ← Variables de entorno
```

## Paso 2: Manifest

```typescript
const manifest: ModuleManifest = {
  name: 'mi-canal-voz',
  type: 'channel',
  channelType: 'voice',  // OBLIGATORIO para canales de voz
  removable: true,
  activateByDefault: false,
  depends: ['memory', 'llm'],

  configSchema: z.object({
    // ── Credenciales del proveedor de telefonía ──
    MIVOZ_PROVIDER_KEY: z.string().default(''),
    MIVOZ_PROVIDER_SECRET: z.string().default(''),
    MIVOZ_PHONE_NUMBER: z.string().default(''),

    // ── API key del modelo de voz ──
    MIVOZ_LLM_API_KEY: z.string().default(''),

    // ── Modelo de voz — configuración ──
    MIVOZ_MODEL: z.string().default('model-name'),
    MIVOZ_VOICE: z.string().default('default-voice'),
    MIVOZ_LANGUAGE: z.string().default(''),
    MIVOZ_TEMPERATURE: floatEnvMin(0, 0.7),
    MIVOZ_TOP_P: floatEnvMin(0, 0.95),
    MIVOZ_TOP_K: numEnvMin(0, 40),
    MIVOZ_MAX_OUTPUT_TOKENS: numEnvMin(0, 1024),

    // ── VAD (si el modelo soporta VAD nativo) ──
    MIVOZ_VAD_START_SENSITIVITY: z.string().default('HIGH'),
    MIVOZ_VAD_END_SENSITIVITY: z.string().default('HIGH'),
    MIVOZ_VAD_SILENCE_DURATION_MS: numEnvMin(0, 500),
    MIVOZ_BARGE_IN_ENABLED: boolEnv(true),

    // ── Detector de silencio local ──
    MIVOZ_SILENCE_RMS_THRESHOLD: numEnvMin(0, 200),
    MIVOZ_SILENCE_TIMEOUT_MS: numEnv(10000),
    MIVOZ_SILENCE_MESSAGE: z.string().default('¿Sigues ahí?'),

    // ── Comportamiento de llamada ──
    MIVOZ_GREETING_INBOUND: z.string().default('Hola, ¿en qué puedo ayudarte?'),
    MIVOZ_GREETING_OUTBOUND: z.string().default('Hola, te llamo de parte de...'),
    MIVOZ_FILLER_MESSAGE: z.string().default('Un momento...'),
    MIVOZ_GOODBYE_TIMEOUT_MS: numEnv(5000),
    MIVOZ_MAX_CALL_DURATION_MS: numEnv(1800000),
    MIVOZ_MAX_CONCURRENT_CALLS: numEnvMin(1, 5),
    MIVOZ_ENABLED: boolEnv(true),
    MIVOZ_CONNECTION_TIMEOUT_MS: numEnvMin(1000, 15000),

    // ── Channel runtime config (engine integration) ──
    MIVOZ_RATE_LIMIT_HOUR: numEnvMin(0, 0),
    MIVOZ_RATE_LIMIT_DAY: numEnvMin(0, 0),
    MIVOZ_SESSION_TIMEOUT_HOURS: numEnvMin(1, 1),
  }),
  // ... console, apiRoutes, init, stop
}
```

## Paso 3: Proveer `channel-config:voice`

Aunque los canales de voz no usan el pipeline de 5 fases, el engine necesita `channel-config:{nombre}` para rate limiting y sesiones. Para voz, los rate limits se refieren a **llamadas** (no mensajes).

```typescript
import type { ChannelRuntimeConfig } from '../../channels/types.js'

async init(registry: Registry) {
  let config = registry.getConfig<MiVozConfig>('mi-canal-voz')

  registry.provide('channel-config:voice', {
    get: (): ChannelRuntimeConfig => ({
      rateLimitHour: config.MIVOZ_RATE_LIMIT_HOUR,
      rateLimitDay: config.MIVOZ_RATE_LIMIT_DAY,
      avisoTriggerMs: 0,           // no aplica para voz
      avisoHoldMs: 0,              // no aplica para voz
      avisoMessages: [],           // no aplica para voz
      sessionTimeoutMs: config.MIVOZ_SESSION_TIMEOUT_HOURS * 3600000,
      batchWaitSeconds: 0,         // no aplica para voz
      precloseFollowupMs: 0,       // no aplica para voz
      precloseFollowupMessage: '', // no aplica para voz
    }),
  })

  // Hot-reload
  registry.addHook('mi-canal-voz', 'console:config_applied', async () => {
    const fresh = registry.getConfig<MiVozConfig>('mi-canal-voz')
    Object.assign(config, fresh)
  })
}
```

**Nota:** Los campos `aviso*`, `batchWaitSeconds` y `precloseFollowup*` no aplican para voz porque Gemini Live maneja la conversación en tiempo real. Se pasan como 0/vacío.

## Paso 4: Voice Sub-Engine (context loading)

El voice engine NO procesa mensajes individuales. Carga todo el contexto al inicio de la llamada y lo inyecta como system instruction:

```typescript
async function preloadContext(registry, db, phone, direction, config) {
  // Cargar en paralelo (similar a Phase 1 pero ligero):
  const [contact, prompts, tools, agentId] = await Promise.allSettled([
    loadContact(db, phone),
    loadPrompts(registry),      // via prompts:service
    loadTools(registry),        // via tools:registry
    loadAgentId(db),
  ])

  // Si hay contacto, cargar memoria
  if (contact) {
    const [memory, commitments, summaries] = await Promise.allSettled([
      loadContactMemory(registry, contact.id),
      loadCommitments(registry, contact.id),
      loadSummaries(registry, contact.id),
    ])
  }

  // Construir system instruction
  return {
    systemInstruction: buildSystemInstruction(prompts, contact, memory, config),
    tools: [...toolDeclarations, endCallTool],
    contactId, agentId,
  }
}
```

### System instruction para voz

La system instruction debe incluir instrucciones específicas para conversación hablada:

```
## Instrucciones de llamada de voz

Estás en una llamada telefónica en VIVO. Tu respuesta es audio hablado.

### Comportamiento natural:
- Habla de forma natural y conversacional
- Usa pausas naturales, muletillas y confirmaciones
- NO uses formato escrito (listas, markdown, URLs)
- Sé concisa: las respuestas largas son cansadoras por teléfono

### Saludo inicial:
Tu primer mensaje al conectar debe ser: "${greeting}"

### Cuando necesites procesar algo:
Di algo natural como "${fillerMessage}" antes de ejecutar herramientas.

### Silencio del caller:
Si el sistema indica silencio, pregunta: "${silenceMessage}"

### Finalizar la llamada:
- NUNCA cuelgues abruptamente
- Confirma: "¿Hay algo más?"
- Usa la herramienta end_call para terminar
```

## Paso 5: Puente de audio

El puente de audio conecta el proveedor de telefonía con el modelo de voz. Cada uno usa formatos de audio diferentes:

```
Proveedor                 LUNA                    Modelo de voz
(mulaw 8kHz)    →    [converter]    →    (PCM 16-bit 16kHz)
(mulaw 8kHz)    ←    [converter]    ←    (PCM 16-bit 16kHz)
```

### Flujo de audio (por cada frame ~20ms):

```typescript
// Caller habla → proveedor envía mulaw → LUNA convierte → modelo recibe PCM
onMediaReceived(streamSid, mulawBuffer) {
  const pcmBuffer = mulawToPcm16k(mulawBuffer)
  silenceDetector.feedAudio(streamSid, pcmBuffer)  // VAD local
  llmClient.sendAudio(pcmBuffer.toString('base64'))
}

// Modelo responde → LUNA convierte → proveedor recibe mulaw → caller escucha
onAudio: (audioBase64) => {
  const pcmBuffer = Buffer.from(audioBase64, 'base64')
  const mulawBuffer = pcmToMulaw8k(pcmBuffer)
  mediaStream.sendAudio(streamSid, mulawBuffer.toString('base64'))
}
```

## Paso 6: State machine de llamadas

```
initiated → ringing → connecting → active → completed
                                      ↗
                         failed ──────
                         no-answer ───
                         busy ────────
```

### End reasons
- `hangup` — agente cuelga
- `caller-hangup` — caller cuelga
- `silence` — silencio prolongado sin respuesta
- `goodbye` — despedida natural (via tool `end_call`)
- `max-duration` — llamada excedió duración máxima
- `error` — error de conexión

## Paso 7: Tool execution

El modelo de voz puede llamar tools via function calling. El canal ejecuta las tools via `tools:registry`:

```typescript
async handleToolCall(streamSid, toolCallId, toolName, args) {
  // Tool especial: end_call
  if (toolName === 'end_call') {
    llmClient.sendToolResponse(toolCallId, toolName, { success: true })
    setTimeout(() => this.endCall(streamSid, 'goodbye'), config.GOODBYE_TIMEOUT_MS)
    return
  }

  // Tools normales via registry
  const toolRegistry = registry.getOptional('tools:registry')
  const result = await toolRegistry.executeTool(toolName, args, {
    contactId, agentId, channel: 'voice',
  })
  llmClient.sendToolResponse(toolCallId, toolName, result)
}
```

## Paso 8: Hooks

### Hooks que el canal EMITE:
```typescript
// Al conectar la llamada
registry.runHook('call:connected', { callId, callSid, direction, from, to, agentId, contactId })

// Al terminar la llamada
registry.runHook('call:ended', { callId, callSid, direction, durationSeconds, endReason })

// Por cada entrada en la transcripción
registry.runHook('call:transcript', { callId, speaker, text, timestampMs })
```

### Hooks que el canal ESCUCHA:
```typescript
// Hot-reload de configuración
registry.addHook('mi-canal-voz', 'console:config_applied', async () => {
  const fresh = registry.getConfig('mi-canal-voz')
  Object.assign(config, fresh)
})
```

**Nota:** Los canales de voz NO escuchan `message:send` ni `channel:composing` porque no envían mensajes de texto — la conversación la maneja el modelo de voz directamente.

## Paso 9: Post-llamada

Al terminar una llamada:

1. **Generar resumen** — LLM resume la transcripción en 2-3 oraciones
2. **Guardar en DB** — Transcripción completa + resumen en `voice_calls` y `voice_call_transcripts`
3. **Persistir en memoria** — Guardar turnos significativos via `memory:manager`
4. **Colgar via API** — Si el caller no colgó, colgar via REST API del proveedor

## Parámetros que NO aplican para voz

Estos campos de `ChannelRuntimeConfig` se setean en 0/vacío para canales de voz:

| Campo | Por qué no aplica |
|-------|------------------|
| `avisoTriggerMs` | Gemini Live responde en tiempo real, no hay espera |
| `avisoHoldMs` | No hay retención de respuesta |
| `avisoMessages` | No hay mensajes de aviso |
| `batchWaitSeconds` | No hay batching de audio |
| `precloseFollowupMs` | No hay follow-up pre-cierre por otro canal |
| `precloseFollowupMessage` | Ídem |

## Parámetros específicos de canales de voz

Además de los params estándar de canal, un canal de voz debe exponer:

| Categoría | Parámetros típicos |
|-----------|-------------------|
| **Credenciales** | API keys del proveedor + del modelo de voz |
| **Modelo** | Nombre del modelo, voz, idioma |
| **Generación** | temperature, topP, topK, maxOutputTokens |
| **VAD nativo** | Sensibilidades, padding, duración de silencio |
| **VAD local** | Umbral RMS, timeout de silencio |
| **Comportamiento** | Saludos, mensajes de filler/silencio, delay de contestar |
| **Límites** | Duración máxima, llamadas concurrentes, barge-in |

## Checklist de verificación para canal de voz

- [ ] `manifest.ts` con `channelType: 'voice'` y `configSchema` completo
- [ ] Servicio `channel-config:voice` registrado en init() (aunque aviso/batching = 0)
- [ ] Hot-reload via `console:config_applied`
- [ ] VOICE_ENABLED checked en handleIncomingCall e initiateOutboundCall
- [ ] TODOS los params del modelo de voz configurables desde consola (no hardcodeados)
- [ ] Audio conversion correcta entre proveedor y modelo
- [ ] Tool `end_call` registrada internamente
- [ ] Transcripción guardada en DB
- [ ] Resumen generado y guardado en memoria
- [ ] `.env.example` con todos los params
- [ ] `CLAUDE.md` del módulo creado
- [ ] `connectionWizard` con instrucciones de setup del proveedor

## Canal de referencia

**`src/modules/twilio-voice/`** es la implementación de referencia completa para canales de voz. Usa Twilio para telefonía y Gemini Live para conversación.

| Archivo | Líneas | Propósito |
|---------|--------|-----------|
| `manifest.ts` | ~700 | Lifecycle, 29 params, 9 API routes, channel-config, hot-reload |
| `types.ts` | ~340 | Config (29 campos), call states, Gemini/Twilio messages, 30 voces |
| `gemini-live.ts` | ~260 | WebSocket client Gemini Live con generationConfig + VAD |
| `call-manager.ts` | ~500 | State machine, audio bridge, tool execution |
| `voice-engine.ts` | ~390 | Context loading, system instruction, summary |
| `silence-detector.ts` | ~130 | VAD local (RMS configurable) |
| `audio-converter.ts` | ~130 | mulaw 8kHz ↔ PCM 16-bit 16kHz |
| `twilio-adapter.ts` | ~185 | REST client Twilio, TwiML |
| `media-stream.ts` | ~170 | WebSocket server para Twilio Media Streams |
| `pg-store.ts` | ~100 | CRUD voice_calls + transcripts |
