# TTS — Síntesis de voz via Google Cloud TTS

Genera audio OGG_OPUS a partir de texto para enviar como notas de voz (PTT) en WhatsApp.

## Archivos
- `manifest.ts` — lifecycle, configSchema, console fields
- `tts-service.ts` — TTSService: llamada a Google Cloud TTS REST API, síntesis a OGG_OPUS
- `types.ts` — TTSServiceInterface
- `.env.example` — variables de entorno

## Manifest
- type: `feature`, removable: true, activateByDefault: false
- depends: [] (sin dependencias)
- configSchema: TTS_GOOGLE_API_KEY, TTS_VOICE_LANGUAGE, TTS_VOICE_NAME, TTS_SPEAKING_RATE, TTS_PITCH, TTS_MAX_CHARS, TTS_ENABLED_CHANNELS, TTS_AUTO_FOR_AUDIO_INPUT

## Servicio registrado
- `tts:service` — TTSService instance (consumido opcionalmente por Phase 5)

## Patrones
- Phase 5 obtiene `tts:service` via `registry.getOptional()` — si no existe, no se usa TTS
- `shouldAutoTTS(channel, inputType)` retorna true si canal habilitado + input es audio + auto habilitado
- `synthesize(text)` llama Google Cloud TTS REST API, retorna Buffer OGG_OPUS + duración estimada
- Si TTS falla, el engine hace fallback a texto (nunca bloquea)
- No requiere npm packages adicionales — usa `fetch()` nativo de Node.js

## Trampas
- API key debe tener acceso a Cloud Text-to-Speech API (habilitar en Google Cloud Console)
- Duración estimada por tamaño de buffer (~24kbps) — no es exacta
- Max 5000 chars por request en Google TTS — TTS_MAX_CHARS limita antes
- OGG_OPUS es el formato requerido por WhatsApp para notas de voz (PTT)
