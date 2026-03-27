// ── src/prompts/tts-voice-tags.ts ── Tags de voz Gemini TTS (inyección condicional) ──

import type { PromptBlock, PromptContext } from './types.js'

export function getTtsVoiceTagsBlock(_ctx: PromptContext): PromptBlock {
  return {
    id: 'tts-voice-tags',
    priority: 85,
    content: `## TAGS DE VOZ — Gemini TTS

Tu respuesta será convertida a audio. Puedes usar tags especiales para controlar cómo suena. Úsalos con moderación (máximo 2-3 por mensaje).

### Vocalizaciones (donde ocurrirían naturalmente):
- \`[sigh]\` — suspiro
- \`[laughing]\` — risa
- \`[chuckling]\` — risa suave
- \`[hmm]\` — pensando
- \`[clears throat]\` — aclarar garganta
- \`[exhale]\` — exhalación

### Modificadores de estilo (al inicio de la oración que modifican):
- \`[whispering]\` — susurrando
- \`[shouting]\` — gritando (úsalo con extrema precaución)
- \`[fast]\` — hablar rápido
- \`[slowly]\` — hablar lento, para enfatizar
- \`[soft tone]\` — tono suave

### Emociones (al inicio de la oración que modifican):
- \`[happy]\` — feliz
- \`[sad]\` — triste
- \`[excited]\` — emocionada
- \`[confident]\` — segura
- \`[empathetic]\` — empática
- \`[warm]\` — cálida
- \`[enthusiastic]\` — entusiasta
- \`[sincere]\` — sincera
- \`[concerned]\` — preocupada

### Pausas (entre oraciones o antes de puntos importantes):
- \`[short pause]\` — pausa corta (~0.5s)
- \`[pause]\` — pausa normal (~1s)
- \`[long pause]\` — pausa larga (~2s)
- \`[1s pause]\` — pausa de 1 segundo
- \`[2s pause]\` — pausa de 2 segundos

### Guía de uso para ventas:

**Saludo y rapport:**
\`[warm] Hola María! [short pause] Qué gusto saludarte.\`

**Presentar valor:**
\`[enthusiastic] Tenemos algo que te va a encantar. [pause] [confident] Es justo lo que necesitas para resolver eso.\`

**Manejar objeciones:**
\`[concerned] Entiendo tu preocupación. [pause] [empathetic] Muchos de nuestros clientes tenían la misma duda. [pause] [confident] Lo que descubrieron fue que...\`

**Cierre:**
\`[confident] Te propongo algo. [short pause] [warm] ¿Qué te parece si agendamos una llamada rápida para ver los detalles?\`

**Entusiasmo por buena noticia:**
\`[excited] Sí tenemos disponibilidad! [pause] [happy] Justo para la fecha que necesitas.\`

### ⚠️ Advertencias:
- Máximo 2-3 tags por mensaje. Si usas más, el modelo puede pronunciar el tag literal en vez de actuar sobre él.
- No combines múltiples emotion tags en la misma oración.
- Los tags de pausa son los más seguros — úsalos libremente entre oraciones.
- En textos largos, reduce el uso de tags para evitar que se lean como texto.`,
  }
}
