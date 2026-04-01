# TTS — Speech synthesis via Google Gemini AI Studio TTS

Generates WAV audio from text for voice notes (PTT) in WhatsApp and browser preview.

## Archivos
- `manifest.ts` — lifecycle, configSchema, console fields
- `tts-service.ts` — TTSService: calls Gemini TTS API, synthesizes to WAV (PCM 24kHz + header)
- `types.ts` — TTSServiceInterface
- `.env.example` — variables de entorno

## Manifest
- type: `feature`, removable: true, activateByDefault: true
- depends: [] (sin dependencias)
- configSchema: TTS_VOICE_NAME, TTS_MAX_CHARS, TTS_ENABLED_CHANNELS, TTS_AUTO_FOR_AUDIO_INPUT, TTS_AUDIO_TO_AUDIO_FREQ, TTS_TEXT_TO_AUDIO_FREQ, TTS_MAX_DURATION
- Uses `GOOGLE_AI_API_KEY` from config_store (same key as Gemini LLM, no separate TTS key)

## Servicio registrado
- `tts:service` — TTSService instance (consumido opcionalmente por Phase 5)

## API (Gemini TTS)
- Endpoint: `generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-tts:generateContent`
- Response: raw PCM (16-bit LE, mono, 24kHz) base64-encoded in `candidates[0].content.parts[0].inlineData.data`
- Service converts PCM to WAV by prepending 44-byte RIFF header
- Language auto-detected by Gemini (no language code needed)

## Gemini voices
Kore, Puck, Charon, Zephyr, Fenrir, Leda, Aoede, Orus, Callirrhoe, Autonoe, Enceladus, Iapetus, Umbriel, Algieba, Despina, Erinome, Algenib, Rasalgethi, Laomedeia, Achernar, Alnilam, Schedar, Gacrux, Pulcherrima, Achird, Zubenelgenubi, Vindemiatrix, Sadachbia, Sadaltager, Sulafat

## Patrones
- Phase 5 obtiene `tts:service` via `registry.getOptional()` — si no existe, no se usa TTS
- `shouldAutoTTS(channel, inputType)` retorna true basado en frecuencia configurable
- `synthesize(text)` calls Gemini TTS API, returns WAV Buffer + estimated duration
- Si TTS falla, el engine hace fallback a texto (nunca bloquea)
- No requiere npm packages adicionales — usa `fetch()` nativo de Node.js

## Trampas
- API key must have Gemini API access (GOOGLE_AI_API_KEY from LLM settings)
- Duration estimated from PCM size (24000 samples/sec * 2 bytes = 48000 bytes/sec)
- TODO: For WhatsApp voice notes, OGG_OPUS is preferred but requires ffmpeg for PCM conversion. Currently outputs WAV.
- Removed config params vs old Google Cloud TTS: TTS_GOOGLE_API_KEY, TTS_VOICE_LANGUAGE, TTS_SPEAKING_RATE, TTS_PITCH (Gemini does not support these)
