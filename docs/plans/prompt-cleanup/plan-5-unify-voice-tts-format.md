# Plan 5: Extraer voice inline a voice-tts-format.md

## Objetivo
Hay un `buildVoiceSection()` hardcoded en `src/engine/prompts/agentic.ts:200-205` con 4 líneas de instrucciones para cuando la respuesta se convierte a nota de voz (TTS en canales instant como WhatsApp).

Extraerlo a un `.md` para que sea editable sin recompilar.

**IMPORTANTE:** Esto es DISTINTO de `voice-system-instruction.md` que es para llamadas telefónicas Twilio y tiene variables de template (`{{greeting}}`, `{{callDirection}}`, etc.). No tocar ese archivo.

## Crear archivo

**Ruta:** `instance/prompts/system/voice-tts-format.md`

**Contenido:**
```markdown
Tu respuesta será convertida a nota de voz (audio). Escribe como si hablaras en voz alta:
- NO uses listas, viñetas, markdown ni formato visual — el contacto no las verá
- Usa frases cortas y naturales. Habla como en una conversación telefónica
- Evita compartir URLs, emails o datos que se vean mejor por escrito
```

## Modificar: `src/engine/prompts/agentic.ts`

### Paso 1: Eliminar la función `buildVoiceSection()`

Buscar y eliminar (líneas ~200-205):
```typescript
function buildVoiceSection(): string {
  return `Tu respuesta será convertida a nota de voz (audio). Escribe como si hablaras en voz alta:
- NO uses listas, viñetas, markdown ni formato visual — el contacto no las verá
- Usa frases cortas y naturales. Habla como en una conversación telefónica
- Evita compartir URLs, emails o datos que se vean mejor por escrito`
}
```

### Paso 2: Actualizar donde se llama

Buscar el bloque `if (prepareForVoice)` (líneas ~132-137):

**Antes:**
```typescript
  if (prepareForVoice) {
    const voiceSection = buildVoiceSection()
    const voiceTags = svc ? await svc.getSystemPrompt('tts-voice-tags') : ''
    let voiceContent = voiceSection
    if (voiceTags) voiceContent += `\n\n${voiceTags}`
    systemParts.push(`<voice_instructions>\n${voiceContent}\n</voice_instructions>`)
  }
```

**Después:**
```typescript
  if (prepareForVoice) {
    const voiceSection = svc
      ? await svc.getSystemPrompt('voice-tts-format').catch(() => null)
      : null
    const voiceFallback = 'Tu respuesta será convertida a nota de voz (audio). Escribe como si hablaras en voz alta. NO uses listas, viñetas ni markdown. Usa frases cortas y naturales.'
    const voiceTags = svc ? await svc.getSystemPrompt('tts-voice-tags') : ''
    let voiceContent = voiceSection || voiceFallback
    if (voiceTags) voiceContent += `\n\n${voiceTags}`
    systemParts.push(`<voice_instructions>\n${voiceContent}\n</voice_instructions>`)
  }
```

### NO tocar
- `instance/prompts/system/voice-system-instruction.md` — es para llamadas Twilio
- `src/modules/twilio-voice/voice-engine.ts` — usa `voice-system-instruction` con variables, contexto diferente
- `instance/prompts/system/tts-voice-tags.md` — se carga por separado, no cambia

## Verificación

```bash
docker run --rm -v /docker/luna-repo:/app -w /app node:22-alpine npx tsc --noEmit
```

## Riesgo
Bajo. Fallback inline mantiene comportamiento si el .md no se carga.
