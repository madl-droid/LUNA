# twilio-voice — Canal de voz (Twilio + Gemini Live)

Llamadas telefónicas con IA conversacional en tiempo real. Twilio provee la telefonía, Gemini Live la conversación.

## Archivos
- `manifest.ts` — lifecycle, configSchema (29 params), console fields, 9 API routes, channel-config:voice
- `types.ts` — tipos: config, call states, Twilio events, Gemini Live messages, DB rows, 30+ voces
- `twilio-adapter.ts` — REST client Twilio (make/hangup calls, TwiML, signature validation)
- `media-stream.ts` — WebSocket server para Twilio Media Streams (audio bidireccional)
- `gemini-live.ts` — WebSocket client para Gemini Multimodal Live API
- `audio-converter.ts` — mulaw 8kHz ↔ PCM 16-bit 16kHz (puro, sin deps)
- `voice-engine.ts` — pipeline ligero (context loading, system instruction, tool bridging, memory)
- `call-manager.ts` — state machine de llamadas, puente audio Twilio↔Gemini, tool execution
- `silence-detector.ts` — VAD simple (RMS configurable), timer de silencio, prompting
- `pg-store.ts` — tablas voice_calls + voice_call_transcripts, CRUD

## Manifest
- type: `channel`, channelType: `voice`, removable: true, activateByDefault: false
- depends: `['memory', 'llm']`
- configSchema: 29 params organizados en secciones (Twilio, Gemini Live, Generación, VAD, Silencio, Límites)

## Servicios
- `twilio-voice:callManager` — CallManager instance
- `twilio-voice:adapter` — TwilioAdapter instance
- `channel-config:voice` — ChannelRuntimeConfig para el engine

## Hooks
- Emite: `call:connected`, `call:ended`, `call:transcript`
- Escucha: `console:config_applied` (hot-reload)

## API Routes (bajo /console/api/twilio-voice/)
- GET /status, GET /calls, POST /calls, GET /call-details, GET /call-stats
- POST /voice-preview, POST /webhook/incoming, POST /webhook/outbound-twiml, POST /webhook/status

## Arquitectura: Voice Sub-Engine
No usa el pipeline de 5 fases. Gemini Live maneja la conversación completa:
1. Al iniciar llamada → carga contexto mínimo (contacto, memoria, prompts, tools)
2. Inyecta todo como system instruction en sesión Gemini Live
3. Gemini maneja la conversación en tiempo real (audio bidireccional)
4. Tools se ejecutan via function calling de Gemini → tools:registry
5. Al terminar → guarda transcripción + resumen en memoria

## Puente de Audio
```
Teléfono ←PSTN→ Twilio ←WS (mulaw 8kHz)→ LUNA ←WS (PCM 16kHz)→ Gemini Live
```

## Config: Gemini Live params
- Modelo, voz, idioma, temperature, topP, topK, maxOutputTokens
- VAD nativo: sensibilidad inicio/fin habla, prefix padding, silence duration
- Barge-in (interrupciones), connection timeout
- Silence detector local: RMS threshold configurable

## Trampas
- WebSocket upgrade requiere `kernel:server` service (registrado en src/index.ts)
- Audio mulaw↔PCM: la conversión es CPU-bound, pero los chunks son pequeños (~20ms)
- Gemini Live API key puede ser separada (VOICE_GOOGLE_API_KEY) o compartida con LLM module
- La tool `end_call` es registrada internamente, no vía tools:registry
- Pre-carga de contexto durante ring delay → latencia mínima al conectar
- Hot-reload: config se actualiza via console:config_applied, afecta llamadas nuevas (no activas)
