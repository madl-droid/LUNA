# twilio-voice — Canal de voz (Twilio + Gemini Live)

Llamadas telefónicas con IA conversacional en tiempo real. Twilio provee la telefonía, Gemini Live la conversación.

## Archivos
- `manifest.ts` — lifecycle, configSchema (16 params), console fields, 9 API routes
- `types.ts` — tipos: call states, Twilio events, Gemini Live messages, DB rows
- `twilio-adapter.ts` — REST client Twilio (make/hangup calls, TwiML, signature validation)
- `media-stream.ts` — WebSocket server para Twilio Media Streams (audio bidireccional)
- `gemini-live.ts` — WebSocket client para Gemini Multimodal Live API
- `audio-converter.ts` — mulaw 8kHz ↔ PCM 16-bit 16kHz (puro, sin deps)
- `voice-engine.ts` — pipeline ligero (context loading, system instruction, tool bridging, memory)
- `call-manager.ts` — state machine de llamadas, puente audio Twilio↔Gemini, tool execution
- `silence-detector.ts` — VAD simple (RMS), timer de silencio, prompting
- `pg-store.ts` — tablas voice_calls + voice_call_transcripts, CRUD

## Manifest
- type: `channel`, removable: true, activateByDefault: false
- depends: `['memory', 'llm']`
- configSchema: TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_PHONE_NUMBER, VOICE_GEMINI_VOICE, VOICE_PREVIEW_TEXT, VOICE_ANSWER_DELAY_RINGS, VOICE_SILENCE_TIMEOUT_MS, VOICE_SILENCE_MESSAGE, VOICE_GREETING_INBOUND, VOICE_GREETING_OUTBOUND, VOICE_FILLER_MESSAGE, VOICE_GOODBYE_TIMEOUT_MS, VOICE_MAX_CALL_DURATION_MS, VOICE_MAX_CONCURRENT_CALLS, VOICE_ENABLED, VOICE_GOOGLE_API_KEY

## Servicios
- `twilio-voice:callManager` — CallManager instance
- `twilio-voice:adapter` — TwilioAdapter instance

## Hooks
Emite: `call:incoming`, `call:outgoing`, `call:connected`, `call:ended`, `call:transcript`

## API Routes (bajo /console/api/twilio-voice/)
- `GET /status` — estado de Twilio y llamadas activas
- `GET /calls` — lista de llamadas (?limit, ?offset, ?status)
- `POST /calls` — iniciar llamada outbound { to, agentId?, context? }
- `GET /call-details` — detalle + transcripción (?id=uuid)
- `GET /call-stats` — estadísticas (?period=day|week|month)
- `POST /voice-preview` — preview de voz { voice, text }
- `POST /webhook/incoming` — webhook Twilio llamadas entrantes
- `POST /webhook/outbound-twiml` — TwiML para llamadas salientes
- `POST /webhook/status` — status callbacks de Twilio

## Arquitectura: Voice Sub-Engine
No usa el pipeline de 5 fases. En su lugar:
1. Al iniciar llamada → carga contexto mínimo (contacto, memoria, prompts, tools)
2. Inyecta todo como system instruction en sesión Gemini Live
3. Gemini maneja la conversación en tiempo real (audio bidireccional)
4. Tools se ejecutan via function calling de Gemini → tools:registry
5. Al terminar → guarda transcripción + resumen en memoria

## Puente de Audio
```
Teléfono ←PSTN→ Twilio ←WS (mulaw 8kHz)→ LUNA ←WS (PCM 16kHz)→ Gemini Live
```

## Trampas
- WebSocket upgrade requiere `kernel:server` service (registrado en src/index.ts)
- Audio mulaw↔PCM: la conversión es CPU-bound, pero los chunks son pequeños (~20ms)
- Gemini Live API key puede ser separada (VOICE_GOOGLE_API_KEY) o compartida con LLM module
- La tool `end_call` es registrada internamente, no vía tools:registry
- Pre-carga de contexto durante ring delay → latencia mínima al conectar
