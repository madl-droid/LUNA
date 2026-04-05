// LUNA Engine — Channel Format Utilities
// Provides getChannelLimit() and buildFormatFromForm() for use across prompt builders.
// Extracted from compositor.ts to allow reuse without importing the full compositor module.

import type { Registry } from '../../kernel/registry.js'
import type { PromptsService } from '../../modules/prompts/types.js'

// Minimal fallback — full formats live in instance/prompts/system/channel-format-*.md
const DEFAULT_CHANNEL_LIMITS: Record<string, string> = {
  whatsapp: 'CANAL: WhatsApp — Categoría: mensajería instantánea\nMensajes cortos y conversacionales. Máximo 300 caracteres. Sin markdown.',
  email: 'CANAL: Email — Categoría: comunicación asíncrona\nFormato rico, tono profesional, párrafos cortos. Incluye saludo y despedida.',
}

/** Map channel names to their communication category */
const CHANNEL_CATEGORIES: Record<string, string> = {
  whatsapp: 'mensajería instantánea',
  'google-chat': 'mensajería instantánea',
  instagram: 'mensajería instantánea',
  messenger: 'mensajería instantánea',
  email: 'comunicación asíncrona',
  voice: 'voz en tiempo real',
}

/**
 * Get channel format instructions.
 * Priority: 1) config_store override, 2) system template, 3) hardcoded defaults.
 * Exported so agentic.ts can reuse without reimplementing.
 */
export async function getChannelLimit(channel: string, registry?: Registry): Promise<string> {
  if (registry) {
    try {
      const db = registry.getDb()
      // Build prompt from form fields in config_store
      const built = await buildFormatFromForm(channel, db)
      if (built) return built
    } catch { /* fallback */ }
  }
  // 2. Try system template
  const svc = registry?.getOptional<PromptsService>('prompts:service') ?? null
  if (svc) {
    const tmpl = await svc.getSystemPrompt(`channel-format-${channel}`)
    if (tmpl) return tmpl
  }
  // 3. Hardcoded defaults
  return DEFAULT_CHANNEL_LIMITS[channel] ?? DEFAULT_CHANNEL_LIMITS.whatsapp ?? ''
}

/** Build format prompt dynamically from form fields stored in config_store */
export async function buildFormatFromForm(channel: string, db: import('pg').Pool): Promise<string | null> {
  const configStore = await import('../../kernel/config-store.js')
  const prefix = channel.toUpperCase()
  const all = await configStore.getAll(db)

  const tone = all[`${prefix}_FORMAT_TONE`] || 'directo'
  const maxSentences = all[`${prefix}_FORMAT_MAX_SENTENCES`] || '2'
  const maxParagraphs = all[`${prefix}_FORMAT_MAX_PARAGRAPHS`] || '2'
  const emojiLevel = all[`${prefix}_FORMAT_EMOJI_LEVEL`] || 'bajo'
  const openingSigns = all[`${prefix}_FORMAT_OPENING_SIGNS`] || 'nunca'
  const typosEnabled = all[`${prefix}_FORMAT_TYPOS_ENABLED`] === 'true'
  const typosIntensity = all[`${prefix}_FORMAT_TYPOS_INTENSITY`] || '0.3'
  const typosTypes = all[`${prefix}_FORMAT_TYPOS_TYPES`] || ''
  const audioEnabled = all[`${prefix}_FORMAT_AUDIO_ENABLED`] === 'true'
  const additionalInstructions = all[`FORMAT_INSTRUCTIONS_${prefix}`] || ''

  const category = CHANNEL_CATEGORIES[channel] ?? 'mensajería instantánea'
  const lines: string[] = []

  // --- Core format ---
  lines.push(`FORMATO DE RESPUESTA — ${category.toUpperCase()}`)
  lines.push(`- REGLA CLAVE: Se breve y ${tone}. Es un canal de mensajería, no es email — los mensajes largos no se leen.`)
  lines.push(`- Escribe tu respuesta con saltos de párrafo naturales (doble enter entre ideas). Cada párrafo se enviará como un mensaje separado. Usa entre 1 y ${maxParagraphs} párrafos según la situación:`)
  lines.push(`  - Saludos o respuestas cortas: un solo mensaje`)
  lines.push(`  - Respuestas con mucha información: ${maxParagraphs} (máximo absoluto)`)
  lines.push(`- MÁXIMO 1-${maxSentences} oraciones por párrafo.`)
  lines.push(`- Un párrafo = UNA idea. Si cambias de tema, nuevo párrafo.`)
  lines.push(`- PROHIBIDO: párrafos largos. Si se ve largo, está largo.`)
  lines.push(`- NO uses markdown ni formato especial, solo texto plano (es WhatsApp)`)
  lines.push(`- NUNCA uses asteriscos (*) en tus mensajes. En WhatsApp los asteriscos activan negritas no deseadas. Si quieres enfatizar algo, escríbelo en mayúsculas o reescribe la frase para que sea clara sin formato.`)
  // Emoji instructions — explicit per level
  const emojiInstructions: Record<string, string> = {
    nunca: 'NUNCA uses emojis. Ni uno solo. Cero emojis en toda la respuesta.',
    bajo: 'Usa 0-1 emoji por respuesta. Inclúyelo solo cuando aporte calidez o confirmación, como saludos, agradecimientos, cierres amables o mensajes positivos. Si el contexto es formal, delicado, técnico, de reclamo, cobro o error, usa 0 emojis.',
    moderado: 'Usa 1-2 emojis en la mayoría de respuestas cálidas, comerciales o conversacionales. En saludos, seguimientos, confirmaciones y cierres amistosos deberías incluir al menos 1 emoji. Si el contexto es formal, delicado, técnico, de reclamo, cobro o error, puedes usar 0 emojis.',
    alto: 'Usa 1-3 emojis en casi toda respuesta casual, comercial o cercana. Normalmente debe haber al menos 1 emoji por respuesta cuando el tono sea amistoso, de venta, seguimiento o confirmación. Si el contexto es formal, delicado, técnico, de reclamo, cobro o error, puedes bajar a 0 emojis.',
  }
  lines.push(`- ${emojiInstructions[emojiLevel] ?? emojiInstructions.bajo}`)

  // --- Opening signs ---
  if (openingSigns === 'nunca') {
    lines.push(`- REGLA CRÍTICA de puntuación: los signos de exclamación e interrogación se usan SOLO al final, NUNCA al inicio.`)
    lines.push(`  Correcto: "Que bueno" "Como estas" "Perfecto, te mando la info"`)
    lines.push(`  Incorrecto: "¡Qué bueno!" "¿Cómo estás?" "¡Perfecto!"`)
  } else if (openingSigns === 'final') {
    lines.push(`- REGLA CRÍTICA de puntuación: usa signos de exclamación e interrogación SOLO al final.`)
    lines.push(`  Correcto: "Que bueno!" "Como estas?" "Perfecto, te mando la info!"`)
    lines.push(`  Incorrecto: "¡Qué bueno!" "¿Cómo estás?"`)
  } else if (openingSigns === 'ambos') {
    lines.push(`- REGLA CRÍTICA de puntuación: usa signos de apertura Y cierre en preguntas y exclamaciones.`)
    lines.push(`  Correcto: "¡Que bueno!" "¿Como estas?" "¡Perfecto, te mando la info!"`)
    lines.push(`  Incorrecto: "Qué bueno!" "Cómo estás?"`)
  }

  // --- Sales message architecture ---
  lines.push('')
  lines.push('Arquitectura de mensajes de venta:')
  lines.push('- Respuesta directa y corta a lo que preguntó')
  lines.push('- Link, video o recurso relevante (si aplica)')
  lines.push('- UNA pregunta que avance la conversación')

  // --- Typos section (conditional) ---
  if (typosEnabled) {
    lines.push('')
    lines.push('Naturalidad y errores (canal casual):')
    lines.push(`- Temperatura de typos: ${typosIntensity} — introduce errores tipográficos menores de forma ocasional, como escribirías rápido en el celular.`)
    lines.push(`- Errores que puedes cometer:`)
    const types = typosTypes.split(',').map(t => t.trim().toLowerCase())
    if (types.includes('tildes')) lines.push(`  - Tildes omitidas: "información" → "informacion", "más" → "mas", "está" → "esta"`)
    if (types.includes('invertidas')) lines.push(`  - Letras invertidas ocasionales: "que" → "qeu", "pero" → "preo"`)
    if (types.includes('doble_letra')) lines.push(`  - Doble letra accidental: "hola" → "holaa", "dale" → "dalee"`)
    lines.push(`- Mantén estos errores sutiles y ocasionales — no todos los mensajes deben tener typos`)
    lines.push(`- Los typos deben sentirse como escritura rápida genuina, no como errores gramaticales graves`)
  }

  // --- Audio section (conditional — only when audio enabled) ---
  if (audioEnabled) {
    lines.push('')
    lines.push('Notas de voz (cuando aplica):')
    lines.push('A veces tu respuesta se enviará como nota de voz. Cuando veas la indicación "[RESPONDER CON AUDIO]" en el mensaje, escribe tu respuesta pensando en que se va a ESCUCHAR, no leer:')
    lines.push('- Usa frases cortas y naturales, como si hablaras en una llamada.')
    lines.push('- Evita listas largas, números de teléfono, direcciones de correo o URLs (no se entienden bien en audio).')
    lines.push('- Si necesitas compartir datos específicos (precios, emails, links), mejor envíalos como texto en un mensaje aparte mencionando que lo enviarás por escrito.')
    lines.push('- Mantén tu respuesta concisa: las notas de voz largas cansan al oyente.')
    lines.push('- Si el cliente te pide explícitamente que respondas con audio, voz o nota de voz, agrega [VOICE] al INICIO de tu respuesta (antes de cualquier texto). Esto activa la respuesta por audio. Solo hazlo cuando el cliente lo pida expresamente.')
    lines.push('- Nunca menciones el "sistema de transcripción" ni hagas comentarios técnicos sobre el audio.')
  }

  // --- Additional instructions (user-provided) ---
  if (additionalInstructions.trim()) {
    lines.push('')
    lines.push(additionalInstructions.trim())
  }

  return lines.join('\n')
}
