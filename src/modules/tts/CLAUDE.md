# TTS — Speech synthesis via Google Gemini AI Studio TTS

Generates OGG/Opus audio from text for voice notes (PTT) in WhatsApp and browser preview.

## Archivos
- `manifest.ts` — lifecycle, configSchema, console fields
- `tts-service.ts` — TTSService: Gemini TTS via @google/genai SDK → PCM → WAV → ffmpeg → OGG/Opus, chunking, splitting
- `types.ts` — TTSServiceInterface
- `.env.example` — variables de entorno

## Manifest
- type: `feature`, removable: true, activateByDefault: true
- depends: [] (sin dependencias)
- configSchema: TTS_VOICE_NAME, TTS_MAX_CHARS, TTS_ENABLED_CHANNELS, TTS_AUTO_FOR_AUDIO_INPUT, TTS_AUDIO_TO_AUDIO_FREQ, TTS_TEXT_TO_AUDIO_FREQ, TTS_MAX_DURATION
- Uses `GOOGLE_AI_API_KEY` from config_store (same key as Gemini LLM, no separate TTS key)

## Servicio registrado
- `tts:service` — TTSService instance (consumido opcionalmente por Phase 4)

## Audio pipeline
- Gemini TTS → raw PCM (16-bit LE, mono, 24kHz) → WAV header → ffmpeg → OGG/Opus
- ffmpeg with 15s timeout + stderr capture. Falls back to WAV if ffmpeg unavailable.
- `synthesizeChunks(text)`: caps by TTS_MAX_DURATION, splits ~900 chars at sentence boundaries, max 2 chunks
- `synthesize(text)`: single segment synthesis (no capping — caller is responsible)
- Phase 4 uses `synthesizeChunks()`, Phase 5 sends each chunk as separate voice note with delay

## Patrones
- Phase 4 obtiene `tts:service` via `registry.getOptional()` — si no existe, no se usa TTS
- `shouldAutoTTSWithMultiplier(channel, inputType, multiplier)` retorna true basado en frecuencia × preferencia contacto
- When `shouldTTS=true`, Phase 4 injects oral style modifier into compositor prompt (dynamic, on top of existing format)
- Si TTS falla, el engine hace fallback a texto (nunca bloquea)
- `WHATSAPP_FORMAT_AUDIO_ENABLED` → `ChannelRuntimeConfig.ttsEnabled` → Phase 1 `determineResponseFormat()`

## Trampas
- API key must have Gemini API access (GOOGLE_AI_API_KEY from LLM settings)
- Duration estimated from PCM size (24000 samples/sec * 2 bytes = 48000 bytes/sec)
- ffmpeg must be installed in Docker image (`apk add ffmpeg` in Dockerfile runtime stage)
- `synthesize()` does NOT cap text — `synthesizeChunks()` handles all capping/splitting
- Removed config params vs old Google Cloud TTS: TTS_GOOGLE_API_KEY, TTS_VOICE_LANGUAGE, TTS_SPEAKING_RATE, TTS_PITCH
