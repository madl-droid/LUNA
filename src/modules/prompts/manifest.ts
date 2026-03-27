// LUNA — Module: prompts
// Gestión centralizada de prompts del agente. Editables desde console, con cache en memoria.
// Evaluador generado on-demand por LLM. Campaign management moved to lead-scoring module.

import pino from 'pino'
import { z } from 'zod'
import { boolEnv, numEnv } from '../../kernel/config-helpers.js'
import type { ModuleManifest, ApiRoute } from '../../kernel/types.js'
import type { Registry } from '../../kernel/registry.js'
import { jsonResponse, parseBody, parseQuery } from '../../kernel/http-helpers.js'
import type { PromptSlot } from './types.js'
import { ensureTable } from './pg-queries.js'
import { PromptsServiceImpl } from './prompts-service.js'

const logger = pino({ name: 'prompts' })

let service: PromptsServiceImpl | null = null

const apiRoutes: ApiRoute[] = [
  // ─── Prompt slots ─────────────────────────
  {
    method: 'GET',
    path: 'slots',
    handler: async (_req, res) => {
      if (!service) { jsonResponse(res, 503, { error: 'Service not ready' }); return }
      const all = await service.listAll()
      jsonResponse(res, 200, { slots: all })
    },
  },
  {
    method: 'GET',
    path: 'slot',
    handler: async (req, res) => {
      if (!service) { jsonResponse(res, 503, { error: 'Service not ready' }); return }
      const params = parseQuery(req)
      const slot = params.get('slot') as PromptSlot | null
      const variant = params.get('variant') ?? 'default'
      if (!slot) { jsonResponse(res, 400, { error: 'Missing slot parameter' }); return }
      const content = await service.getPrompt(slot, variant)
      jsonResponse(res, 200, { slot, variant, content })
    },
  },
  {
    method: 'PUT',
    path: 'slot',
    handler: async (req, res) => {
      if (!service) { jsonResponse(res, 503, { error: 'Service not ready' }); return }
      const body = await parseBody(req)
      const slot = body.slot as PromptSlot | undefined
      const variant = (body.variant as string) ?? 'default'
      const content = body.content as string | undefined
      if (!slot || content === undefined) {
        jsonResponse(res, 400, { error: 'Missing slot or content' }); return
      }
      await service.upsert(slot, variant, content)
      jsonResponse(res, 200, { ok: true })
    },
  },
  {
    method: 'POST',
    path: 'generate-evaluator',
    handler: async (_req, res) => {
      if (!service) { jsonResponse(res, 503, { error: 'Service not ready' }); return }
      const content = await service.generateEvaluator()
      jsonResponse(res, 200, { ok: true, content })
    },
  },
  // Campaign management moved to lead-scoring module
  // See: /console/api/lead-scoring/campaigns
]

const manifest: ModuleManifest = {
  name: 'prompts',
  version: '1.0.0',
  description: {
    es: 'Gestión centralizada de prompts del agente',
    en: 'Centralized agent prompt management',
  },
  type: 'feature',
  removable: true,
  activateByDefault: true,
  depends: [], // llm is optional (only for evaluator generation)
  configSchema: z.object({
    AGENT_NAME: z.string().default('Luna'),
    AGENT_LAST_NAME: z.string().default(''),
    AGENT_TITLE: z.string().default(''),
    AGENT_LANGUAGE: z.string().default('es'),
    AGENT_COUNTRY: z.string().default(''),
    AGENT_ACCENT: z.string().default(''),
    // Generated accent prompt — injected into context when accent is set
    // Content will be built by a future accent prompt generator
    AGENT_ACCENT_PROMPT: z.string().default(''),
    // Prompts system config
    TTS_ENABLED: boolEnv(false),
    PROMPTS_MAX_SYSTEM_PROMPT_TOKENS: numEnv(4000),
    PROMPTS_MAX_COMPRESSION_SUMMARY_TOKENS: numEnv(1000),
  }),

  console: {
    title: { es: 'Prompts del Agente', en: 'Agent Prompts' },
    info: {
      es: 'Edita los prompts que definen la personalidad, trabajo, reglas y relaciones del agente. Los cambios se aplican inmediatamente.',
      en: 'Edit the prompts that define the agent\'s personality, job, rules and relationships. Changes apply immediately.',
    },
    order: 5,
    group: 'agent',
    icon: '&#128221;',
    fields: [
      { key: '_divider_agent_identity', type: 'divider', label: { es: 'Identidad del agente', en: 'Agent identity' } },
      {
        key: 'AGENT_NAME',
        type: 'text',
        label: { es: 'Nombre', en: 'First name' },
        info: {
          es: 'Nombre del agente. Usado para @mencion en canales instant, firmas, saludos. Fuente unica de verdad para todos los canales.',
          en: 'Agent first name. Used for @mention in instant channels, signatures, greetings. Single source of truth for all channels.',
        },
        width: 'half',
      },
      {
        key: 'AGENT_LAST_NAME',
        type: 'text',
        label: { es: 'Apellido', en: 'Last name' },
        info: {
          es: 'Apellido del agente. Opcional. Usado en firmas y presentaciones formales.',
          en: 'Agent last name. Optional. Used in signatures and formal introductions.',
        },
        width: 'half',
      },
      {
        key: 'AGENT_TITLE',
        type: 'text',
        label: { es: 'Cargo', en: 'Title' },
        info: {
          es: 'Cargo o rol del agente. Usado en presentaciones y firmas formales.',
          en: 'Agent title or role. Used in introductions and formal signatures.',
        },
        width: 'half',
      },
      {
        key: 'AGENT_LANGUAGE',
        type: 'select',
        label: { es: 'Idioma', en: 'Language' },
        info: {
          es: 'Idioma principal del agente. Afecta mensajes de sistema, avisos, y preferencia de respuesta.',
          en: 'Agent primary language. Affects system messages, ack messages, and response preference.',
        },
        options: [
          { value: 'es', label: 'Español / Spanish' },
          { value: 'en', label: 'English / Inglés' },
          { value: 'pt', label: 'Português / Portuguese' },
          { value: 'fr', label: 'Français / French' },
          { value: 'de', label: 'Deutsch / German' },
          { value: 'it', label: 'Italiano / Italian' },
        ],
        width: 'half',
      },
      {
        key: 'AGENT_COUNTRY',
        type: 'text',
        label: { es: 'Pais', en: 'Country' },
        info: {
          es: 'Pais donde opera el agente. Afecta contexto regional y referencias culturales.',
          en: 'Country where the agent operates. Affects regional context and cultural references.',
        },
        width: 'half',
      },
      {
        key: 'AGENT_ACCENT',
        type: 'text',
        label: { es: 'Acento / Locale', en: 'Accent / Locale' },
        info: {
          es: 'Código BCP-47 (ej: es-MX, es-ES, en-US, pt-BR). Usado para voz (TTS/STT) y regionalismos.',
          en: 'BCP-47 code (e.g. es-MX, es-ES, en-US, pt-BR). Used for voice (TTS/STT) and regional expressions.',
        },
        width: 'half',
      },
      { key: '_divider_prompts', type: 'divider', label: { es: 'Prompts del agente', en: 'Agent prompts' } },
      {
        key: 'PROMPT_IDENTITY',
        type: 'textarea',
        label: { es: 'Identidad', en: 'Identity' },
        info: { es: 'Quién es el agente. Define personalidad y tono base.', en: 'Who the agent is. Defines personality and base tone.' },
      },
      {
        key: 'PROMPT_JOB',
        type: 'textarea',
        label: { es: 'Trabajo / Misión', en: 'Job / Mission' },
        info: { es: 'Qué hace el agente. Su misión y objetivos principales.', en: 'What the agent does. Its mission and main objectives.' },
      },
      {
        key: 'PROMPT_GUARDRAILS',
        type: 'textarea',
        label: { es: 'Reglas / Guardrails', en: 'Rules / Guardrails' },
        info: { es: 'Reglas y límites que el agente nunca debe violar.', en: 'Rules and limits the agent must never violate.' },
      },
    ],
    apiRoutes,
  },

  async init(registry: Registry) {
    const db = registry.getDb()

    // Ensure tables
    await ensureTable(db)

    // Create service
    service = new PromptsServiceImpl(db, registry)
    await service.initialize()

    // Expose service
    registry.provide('prompts:service', service)

    // Sync console fields with DB content
    await syncConsoleFields(registry)

    // Hot-reload when console saves/applies config
    registry.addHook('prompts', 'console:config_saved', async (payload) => {
      const keys = payload.keys ?? []
      const promptKeys = keys.filter((k: string) => k.startsWith('PROMPT_'))
      if (promptKeys.length > 0 && service) {
        await syncFromConsole(registry)
      }
      // Auto-generate accent prompt when AGENT_ACCENT changes
      if (keys.includes('AGENT_ACCENT')) {
        await generateAccentPrompt(registry)
      }
    })

    registry.addHook('prompts', 'console:config_applied', async () => {
      if (service) {
        await syncFromConsole(registry)
        service.invalidateCache()
      }
    })

    logger.info('Prompts module initialized')
  },

  async stop() {
    service = null
  },
}

/**
 * Load prompt content from DB into config_store so console fields show current values.
 */
async function syncConsoleFields(registry: Registry): Promise<void> {
  if (!service) return
  const configStore = await import('../../kernel/config-store.js')
  const db = registry.getDb()

  const slotToKey: Record<string, PromptSlot> = {
    'PROMPT_IDENTITY': 'identity',
    'PROMPT_JOB': 'job',
    'PROMPT_GUARDRAILS': 'guardrails',
  }

  for (const [configKey, slot] of Object.entries(slotToKey)) {
    const content = await service.getPrompt(slot, 'default')
    if (content) {
      await configStore.set(db, configKey, content, false).catch(() => {})
    }
  }
}

/**
 * When console saves PROMPT_* fields, sync them back to prompt_slots table.
 */
async function syncFromConsole(registry: Registry): Promise<void> {
  if (!service) return
  const configStore = await import('../../kernel/config-store.js')
  const db = registry.getDb()

  const slotToKey: Record<string, PromptSlot> = {
    'PROMPT_IDENTITY': 'identity',
    'PROMPT_JOB': 'job',
    'PROMPT_GUARDRAILS': 'guardrails',
  }

  for (const [configKey, slot] of Object.entries(slotToKey)) {
    const value = await configStore.get(db, configKey).catch(() => null)
    if (value !== null && value !== undefined) {
      await service.upsert(slot, 'default', value)
    }
  }
}

// ─── Accent TTS Style Prompts ─────────────────────
// Gemini TTS style instructions per BCP-47 accent code.
// These guide the TTS engine to speak with the correct regional style, intonation, and expressions.
// Based on Gemini TTS documentation: use natural language style descriptions for voice persona.

const ACCENT_STYLE_PROMPTS: Record<string, string> = {
  // ── Spanish accents ──
  'es-MX': `Habla con acento mexicano neutro (zona centro/Ciudad de Mexico). Entonacion melodica y amable. Usa expresiones como "orale", "mira", "fijate que". Tuteo. Pronuncia las 's' claramente. Tono calido y cercano, ritmo moderado.`,
  'es-AR': `Habla con acento argentino rioplatense (Buenos Aires). Usa voseo ("vos sos", "dale"). Entonacion italiana con cadencia ascendente al final de las frases. Pronuncia "ll/y" como "sh". Expresiones: "che", "barbaro", "genial". Ritmo expresivo y enfatico.`,
  'es-CO': `Habla con acento colombiano (Bogota/zona andina). Entonacion suave y melodica. Usa "usted" o tuteo segun contexto. Pronunciacion clara y pausada. Expresiones: "que pena", "con mucho gusto", "a la orden". Tono muy amable y servicial.`,
  'es-CL': `Habla con acento chileno. Ritmo rapido, aspira las 's' finales. Expresiones: "cachai", "po", "ya". Entonacion con subidas y bajadas marcadas. Tono directo pero amigable.`,
  'es-PE': `Habla con acento peruano (Lima). Entonacion clara y neutra. Ritmo moderado. Expresiones: "ya pe", "chevere", "causa". Pronunciacion limpia de las consonantes. Tono respetuoso y amable.`,
  'es-VE': `Habla con acento venezolano. Entonacion cantarina y expresiva. Ritmo rapido y animado. Expresiones: "chamo", "chevere", "vale". Tono calido y entusiasta. Aspira las 's' finales.`,
  'es-EC': `Habla con acento ecuatoriano (Sierra). Entonacion pausada y melodica. Pronunciacion clara. Expresiones: "ahi nos vemos", "que fue". Tono amable y respetuoso. Ritmo moderado.`,
  'es-ES': `Habla con acento espanol castellano (Madrid). Distingue z/c de s (ceceo/distincion). Usa "vosotros". Expresiones: "vale", "tio", "mola", "venga". Entonacion directa y energica. Ritmo moderado-rapido.`,
  'es-BO': `Habla con acento boliviano. Entonacion pausada y suave. Pronunciacion clara de todas las consonantes. Tono respetuoso, ritmo tranquilo. Expresiones: "puej", "yaa".`,
  'es-CR': `Habla con acento costarricense. Entonacion amigable y melodica. Expresiones: "pura vida", "mae", "tuanis". Tono relajado y positivo. Ritmo moderado.`,
  'es-CU': `Habla con acento cubano. Entonacion expresiva y ritmica. Aspira las 's' y suaviza las 'r' finales. Expresiones: "asere", "que bola". Tono animado y calido. Ritmo rapido.`,
  'es-DO': `Habla con acento dominicano. Entonacion ritmica y animada. Aspira las 's', suaviza las 'r' finales. Expresiones: "dime a ver", "que lo que". Tono alegre y directo. Ritmo rapido.`,
  'es-SV': `Habla con acento salvadoreno. Entonacion suave y melodica. Usa voseo ("vos"). Expresiones: "va pues", "cipote". Tono amable, ritmo moderado.`,
  'es-GT': `Habla con acento guatemalteco. Entonacion pausada y respetuosa. Usa voseo. Expresiones: "que onda", "pisto", "a la gran". Tono cordial, ritmo tranquilo.`,
  'es-HN': `Habla con acento hondureno. Entonacion melodica y amable. Usa voseo. Expresiones: "maje", "va pues", "que onda". Tono calido, ritmo moderado.`,
  'es-NI': `Habla con acento nicaraguense. Entonacion cantarina. Usa voseo. Expresiones: "ideay", "que onda". Tono amigable, ritmo moderado.`,
  'es-PA': `Habla con acento panameno. Entonacion caribena, melodica. Expresiones: "que xopa", "fren". Tono relajado y amigable. Ritmo moderado-rapido.`,
  'es-PY': `Habla con acento paraguayo. Entonacion influida por guarani. Pronuncia las vocales con claridad. Expresiones: "luego", "nde". Tono amable y respetuoso. Ritmo pausado.`,
  'es-PR': `Habla con acento puertorriqueno. Entonacion ritmica y expresiva. Mezcla espanol e ingles naturalmente. Expresiones: "wepa", "mano", "boricua". Tono animado, ritmo rapido.`,
  'es-UY': `Habla con acento uruguayo. Similar al argentino con voseo. Pronuncia "ll/y" como "sh". Expresiones: "ta", "bo", "que hacemo". Tono tranquilo y amigable. Ritmo moderado.`,
  'es-GQ': `Habla con acento de Guinea Ecuatorial. Entonacion clara y formal. Pronunciacion cuidada de todas las consonantes. Tono respetuoso. Ritmo moderado.`,

  // ── English accents ──
  'en-US': `Speak with a standard American English accent. Clear pronunciation, neutral intonation. Use common American expressions naturally. Warm and professional tone. Moderate pace.`,
  'en-GB': `Speak with a British Received Pronunciation accent. Clear enunciation, measured pace. Use British expressions: "brilliant", "lovely", "cheers". Professional and polished tone.`,
  'en-AU': `Speak with an Australian English accent. Rising intonation at end of sentences. Use Australian expressions: "no worries", "mate", "reckon". Friendly and relaxed tone. Moderate pace.`,
  'en-CA': `Speak with a Canadian English accent. Similar to American but with distinct vowel sounds. Use "eh" naturally. Polite and friendly tone. Moderate pace.`,
  'en-IN': `Speak with an Indian English accent. Distinctive rhythm and intonation patterns. Clear pronunciation. Use expressions like "kindly", "do the needful". Professional and courteous tone.`,
  'en-IE': `Speak with an Irish English accent. Musical intonation with lilting rhythm. Use expressions: "grand", "craic", "sure". Warm and engaging tone.`,
  'en-JM': `Speak with a Jamaican English accent. Rhythmic and melodic intonation. Use expressions: "no problem", "yeah man". Warm and relaxed tone.`,
  'en-KE': `Speak with a Kenyan English accent. Clear and measured pronunciation. Professional and warm tone. Moderate pace with distinct rhythm.`,
  'en-NZ': `Speak with a New Zealand English accent. Similar to Australian but with distinct vowel shifts. Use expressions: "sweet as", "choice". Friendly and laid-back tone.`,
  'en-NG': `Speak with a Nigerian English accent. Clear pronunciation with distinctive rhythm. Professional and confident tone. Moderate pace.`,
  'en-PH': `Speak with a Filipino English accent. Clear and precise pronunciation. Friendly and warm tone. Moderate pace with slight tonal variations.`,
  'en-SG': `Speak with a Singaporean English accent. Clear pronunciation with distinct rhythm. Use particles naturally: "lah", "leh". Professional and efficient tone.`,
  'en-ZA': `Speak with a South African English accent. Distinctive vowel sounds and rhythm. Use expressions: "shame" (sympathy), "just now". Professional and warm tone.`,
  'en-GH': `Speak with a Ghanaian English accent. Clear and measured pronunciation. Professional and warm tone. Moderate pace.`,

  // ── Portuguese accents ──
  'pt-BR': `Fale com sotaque brasileiro (Sao Paulo/sudeste). Entonacao melodica e calorosa. Use expressoes: "legal", "beleza", "tranquilo". Tom amigavel e descontraido. Ritmo moderado. Pronuncie as vogais abertas.`,
  'pt-PT': `Fale com sotaque portugues europeu (Lisboa). Entonacao mais fechada, vogais reduzidas. Use expressoes: "fixe", "pois", "pronto". Tom profissional e direto. Ritmo moderado-rapido.`,
  'pt-AO': `Fale com sotaque angolano. Entonacao clara e ritmica. Tom respeitoso e caloroso. Ritmo moderado. Pronuncia clara das vogais.`,
  'pt-MZ': `Fale com sotaque mocambicano. Entonacao clara e melodica. Tom amavel e profissional. Ritmo moderado.`,
  'pt-CV': `Fale com sotaque cabo-verdiano. Entonacao ritmica e melodica. Tom caloroso e amigavel. Ritmo moderado.`,

  // ── French accents ──
  'fr-FR': `Parle avec un accent francais standard (parisien). Intonation elegante et mesuree. Utilise des expressions: "c'est genial", "formidable", "d'accord". Ton professionnel et chaleureux. Rythme modere.`,
  'fr-CA': `Parle avec un accent quebecois. Intonation chantante et expressive. Utilise le "tu" naturellement. Expressions: "correct", "pas de trouble", "c'est l'fun". Ton chaleureux et direct.`,
  'fr-BE': `Parle avec un accent belge francophone. Intonation douce et mesuree. Utilise "septante", "nonante". Ton amical et professionnel. Rythme modere.`,
  'fr-CH': `Parle avec un accent suisse romand. Intonation posee et claire. Utilise "huitante". Ton professionnel et cordial. Rythme mesure.`,
  'fr-SN': `Parle avec un accent senegalais. Intonation claire et rythmee. Ton respectueux et chaleureux. Rythme modere.`,
  'fr-CM': `Parle avec un accent camerounais. Intonation melodique et expressive. Ton chaleureux et professionnel. Rythme modere.`,
  'fr-CD': `Parle avec un accent congolais (RDC). Intonation melodique et chaleureuse. Ton respectueux et amical. Rythme modere.`,
  'fr-CI': `Parle avec un accent ivoirien. Intonation melodique et animee. Ton chaleureux et direct. Rythme modere-rapide.`,
  'fr-HT': `Parle avec un accent haitien. Intonation chantante et expressive. Ton chaleureux et amical. Rythme modere.`,

  // ── German accents ──
  'de-DE': `Sprich mit einem standarddeutschen Akzent (Hochdeutsch). Klare Aussprache und gemessene Intonation. Professioneller und freundlicher Ton. Moderates Tempo.`,
  'de-AT': `Sprich mit einem oesterreichischen Akzent. Weichere Intonation als Hochdeutsch. Verwende Ausdruecke: "passt", "gell", "leiwand". Freundlicher und warmer Ton.`,
  'de-CH': `Sprich mit einem Schweizer Hochdeutsch Akzent. Klare und gemessene Aussprache. Verwende "grueezi". Hoeflicher und professioneller Ton. Ruhiges Tempo.`,
  'de-LI': `Sprich mit einem liechtensteinischen Akzent. Aehnlich wie Schweizer Deutsch. Hoeflich und professionell. Ruhiges Tempo.`,
  'de-LU': `Sprich mit einem luxemburgischen Akzent. Klare Aussprache mit franzoesischem Einfluss. Professioneller Ton. Moderates Tempo.`,

  // ── Italian accents ──
  'it-IT': `Parla con un accento italiano standard (Roma/Milano). Intonazione melodica e espressiva. Usa espressioni: "perfetto", "benissimo", "certo". Tono caldo e professionale. Ritmo moderato.`,
  'it-CH': `Parla con un accento ticinese (Svizzera italiana). Intonazione chiara e misurata. Tono professionale e cordiale. Ritmo moderato.`,
  'it-SM': `Parla con un accento sammarinese. Intonazione simile all'italiano standard con sfumature romagnole. Tono cordiale e professionale.`,
}

/**
 * Auto-generate AGENT_ACCENT_PROMPT when accent changes.
 */
async function generateAccentPrompt(registry: Registry): Promise<void> {
  const configStore = await import('../../kernel/config-store.js')
  const db = registry.getDb()
  const accent = await configStore.get(db, 'AGENT_ACCENT').catch(() => '')

  if (!accent) {
    // Clear accent prompt when no accent selected
    await configStore.set(db, 'AGENT_ACCENT_PROMPT', '', false).catch(() => {})
    return
  }

  const stylePrompt = ACCENT_STYLE_PROMPTS[accent] ?? ''
  if (!stylePrompt) {
    logger.warn({ accent }, 'No TTS style prompt defined for accent')
    await configStore.set(db, 'AGENT_ACCENT_PROMPT', '', false).catch(() => {})
    return
  }

  await configStore.set(db, 'AGENT_ACCENT_PROMPT', stylePrompt, false).catch(() => {})
  logger.info({ accent }, 'Accent prompt auto-generated')
}

export default manifest
