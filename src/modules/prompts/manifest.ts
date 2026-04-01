// LUNA — Module: prompts
// Gestión centralizada de prompts del agente. Editables desde console, con cache en memoria.
// Evaluador generado on-demand por LLM. Campaign management moved to lead-scoring module.

import pino from 'pino'
import { z } from 'zod'
import { numEnv } from '../../kernel/config-helpers.js'
import type { ModuleManifest, ApiRoute } from '../../kernel/types.js'
import type { Registry } from '../../kernel/registry.js'
import { jsonResponse, parseBody, parseQuery } from '../../kernel/http-helpers.js'
import type { PromptSlot } from './types.js'
import { ensureTable } from './pg-queries.js'
import { PromptsServiceImpl } from './prompts-service.js'

const logger = pino({ name: 'prompts' })

let service: PromptsServiceImpl | null = null

/** Maps config key -> { slot, variant } for bidirectional sync between console and prompt_slots DB */
const PROMPT_SYNC_MAP: Array<{ configKey: string; slot: PromptSlot; variant: string }> = [
  { configKey: 'PROMPT_IDENTITY', slot: 'identity', variant: 'default' },
  { configKey: 'PROMPT_JOB', slot: 'job', variant: 'default' },
  { configKey: 'PROMPT_GUARDRAILS', slot: 'guardrails', variant: 'default' },
  { configKey: 'PROMPT_CRITICIZER', slot: 'criticizer', variant: 'default' },
  { configKey: 'PROMPT_RELATIONSHIP_LEAD', slot: 'relationship', variant: 'lead' },
  { configKey: 'PROMPT_RELATIONSHIP_ADMIN', slot: 'relationship', variant: 'admin' },
  { configKey: 'PROMPT_RELATIONSHIP_COWORKER', slot: 'relationship', variant: 'coworker' },
  { configKey: 'PROMPT_RELATIONSHIP_UNKNOWN', slot: 'relationship', variant: 'unknown' },
]

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
      // Sync to config_store so console UI reflects the change immediately
      try {
        const configStore = await import('../../kernel/config-store.js')
        const match = PROMPT_SYNC_MAP.find(m => m.slot === slot && m.variant === variant)
        if (match) {
          const db = service.db
          await configStore.set(db, match.configKey, content, false)
        }
      } catch { /* best-effort sync */ }
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

  // ─── Category 2: System prompt templates (read-only) ─────
  {
    method: 'GET',
    path: 'system-prompts',
    handler: async (_req, res) => {
      if (!service) { jsonResponse(res, 503, { error: 'Service not ready' }); return }
      const names = await service.listSystemPrompts()
      const templates: Array<{ name: string; content: string }> = []
      for (const name of names) {
        const content = await service.getSystemPrompt(name)
        templates.push({ name, content })
      }
      jsonResponse(res, 200, { templates })
    },
  },
  {
    method: 'POST',
    path: 'reload-system',
    handler: async (_req, res) => {
      if (!service) { jsonResponse(res, 503, { error: 'Service not ready' }); return }
      service.clearSystemPromptCache()
      jsonResponse(res, 200, { ok: true, message: 'System prompt template cache cleared' })
    },
  },
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
    COMPANY_NAME: z.string().default(''),
    COMPANY_WEBSITES: z.string().default(''),
    AGENT_ACCENT: z.string().default(''),
    // Generated accent prompt — injected into context when accent is set
    // Content will be built by a future accent prompt generator
    AGENT_ACCENT_PROMPT: z.string().default(''),
    // Prompts system config
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
        key: 'COMPANY_NAME',
        type: 'text',
        label: { es: 'Empresa', en: 'Company' },
        info: {
          es: 'Nombre de la empresa donde trabaja el agente. Se inyecta en la identidad del agente.',
          en: 'Company the agent works for. Injected into the agent identity.',
        },
        width: 'half',
      },
      {
        key: 'COMPANY_WEBSITES',
        type: 'tags',
        label: { es: 'Sitios web de la empresa', en: 'Company websites' },
        info: {
          es: 'URLs del sitio web de la empresa (separadas por coma). El agente puede leer estas páginas directamente sin usar el subagente de búsqueda web.',
          en: 'Company website URLs (comma separated). The agent can read these pages directly without the web search subagent.',
        },
        separator: ',',
        width: 'full',
        placeholder: 'https://miempresa.com, https://docs.miempresa.com',
      },
      {
        key: 'AGENT_COUNTRY',
        type: 'text',
        label: { es: 'Pa\u00eds', en: 'Country' },
        info: {
          es: 'Pa\u00eds donde opera el agente. Afecta contexto regional y referencias culturales.',
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
      { key: '_divider_criticizer', type: 'divider', label: { es: 'Checklist de calidad', en: 'Quality checklist' } },
      {
        key: '_info_criticizer_base',
        type: 'readonly',
        label: { es: 'Base del sistema (no editable)', en: 'System base (not editable)' },
        info: {
          es: 'Estas reglas son fijas y garantizan la eficiencia del sistema. Se cargan de instance/prompts/system/criticizer-base.md.',
          en: 'These rules are fixed and guarantee system efficiency. Loaded from instance/prompts/system/criticizer-base.md.',
        },
      },
      {
        key: 'PROMPT_CRITICIZER',
        type: 'textarea',
        label: { es: 'Checklist personalizable', en: 'Customizable checklist' },
        info: {
          es: 'Puntos adicionales de auto-revisión antes de enviar. Personaliza el estilo y metodología del agente.',
          en: 'Additional self-review points before sending. Customize the agent style and methodology.',
        },
      },
      { key: '_divider_relationships', type: 'divider', label: { es: 'Relaciones por tipo de usuario', en: 'Relationships by user type' } },
      {
        key: 'PROMPT_RELATIONSHIP_LEAD',
        type: 'textarea',
        label: { es: 'Relacion con leads', en: 'Relationship with leads' },
        info: {
          es: 'Como debe tratar el agente a los leads (clientes potenciales). Define tono, nivel de formalidad y objetivos.',
          en: 'How the agent should treat leads (potential customers). Define tone, formality level and objectives.',
        },
      },
      {
        key: 'PROMPT_RELATIONSHIP_ADMIN',
        type: 'textarea',
        label: { es: 'Relacion con admins', en: 'Relationship with admins' },
        info: {
          es: 'Como debe tratar el agente a los administradores del sistema. Puede ser mas tecnico y directo.',
          en: 'How the agent should treat system administrators. Can be more technical and direct.',
        },
      },
      {
        key: 'PROMPT_RELATIONSHIP_COWORKER',
        type: 'textarea',
        label: { es: 'Relacion con coworkers', en: 'Relationship with coworkers' },
        info: {
          es: 'Como debe tratar el agente a los companeros de trabajo. Tono colaborativo e informal.',
          en: 'How the agent should treat coworkers. Collaborative and informal tone.',
        },
      },
      {
        key: 'PROMPT_RELATIONSHIP_UNKNOWN',
        type: 'textarea',
        label: { es: 'Relacion con desconocidos', en: 'Relationship with unknowns' },
        info: {
          es: 'Como debe tratar el agente a contactos no identificados. Cauteloso pero amable.',
          en: 'How the agent should treat unidentified contacts. Cautious but friendly.',
        },
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
        service.clearSystemPromptCache()
      }
    })

    // Ensure accent prompt is generated if accent was set (e.g. by setup wizard)
    // but accent prompt was never generated yet
    const bootCfg = registry.getConfig<{ AGENT_ACCENT: string; AGENT_ACCENT_PROMPT: string }>('prompts')
    if (bootCfg.AGENT_ACCENT && !bootCfg.AGENT_ACCENT_PROMPT) {
      await generateAccentPrompt(registry)
      await registry.reloadAllModuleConfigs()
    }

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

  for (const { configKey, slot, variant } of PROMPT_SYNC_MAP) {
    const content = await service.getPrompt(slot, variant)
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

  for (const { configKey, slot, variant } of PROMPT_SYNC_MAP) {
    const value = await configStore.get(db, configKey).catch(() => null)
    if (value !== null && value !== undefined) {
      await service.upsert(slot, variant, value)
    }
  }
}

// ─── Accent TTS Style Prompts ─────────────────────
// Gemini TTS style instructions per BCP-47 accent code.
// These guide the TTS engine to speak with the correct regional style, intonation, and expressions.
// Based on Gemini TTS documentation: use natural language style descriptions for voice persona.

const ACCENT_STYLE_PROMPTS: Record<string, string> = {
  // ── Spanish accents ──
  'es-MX': `Habla con acento mexicano neutro (zona centro/Ciudad de Mexico). Entonacion melodica y amable. Tuteo natural. Pronuncia las 's' claramente. Las 'd' intervocalicas se suavizan en habla casual ("cansado" suena mas como "cansao"). Muletillas: "o sea", "bueno pues", "este...", "no?", "fijate que", "mira". Expresiones: "orale" (=genial/OK), "que onda" (=que tal), "padre/padrisimo" (=genial), "chido", "neta" (=verdad), "a poco" (=en serio?), "sale" (=OK). Tono calido y cercano, ritmo moderado.`,
  'es-AR': `Habla con acento argentino rioplatense (Buenos Aires). Usa voseo ("vos sos", "dale"). Entonacion italiana con cadencia ascendente al final de las frases. Pronuncia "ll/y" como "sh". Expresiones: "che", "barbaro", "genial". Ritmo expresivo y enfatico.`,
  'es-CO': `Habla con acento colombiano (Bogota/zona andina). Entonacion suave y melodica. Usa "usted" en contextos formales o con desconocidos, tuteo con confianza. Pronunciacion clara y pausada, todas las letras se articulan. Muletillas: "pues" (al final: "si pues", "bueno pues"), "o sea", "digamos", "listo?". Expresiones: "que pena" (=disculpa), "con mucho gusto" (respuesta a gracias), "a la orden", "parce/parcero" (=amigo informal), "bacano/chevere" (=genial), "berraco" (=impresionante o dificil), "de una" (=de inmediato). Tono muy amable y servicial, ritmo moderado-pausado.`,
  'es-CL': `Habla con acento chileno (Santiago). Ritmo rapido, aspira las 's' finales ("entonces" suena "entonce"). Las 'd' intervocalicas desaparecen ("cansado" → "cansao", "helado" → "helao"). Muletillas: "po" (al final de todo: "si po", "ya po", "no po"), "cachai" (=entiendes?), "weon/weon" (coloquial, como "dude"), "al tiro" (=de inmediato). Expresiones: "bacan" (=genial), "fome" (=aburrido), "carrete" (=fiesta), "polola/pololo" (=novia/novio), "luca" (=mil pesos). Entonacion con subidas y bajadas marcadas. Tono directo pero amigable.`,
  'es-PE': `Habla con acento peruano (Lima). Entonacion clara y neutra, sin melodia marcada. Tuteo en Lima, "usted" en sierra. Pronunciacion limpia de todas las consonantes. Muletillas: "pe" (al final: "ya pe", "claro pe", "no pe"), "pues", "oe" (llamar atencion), "manyas?" (=entiendes?). Expresiones: "chevere" (=genial), "causa" (=amigo), "al toque" (=rapido), "jato" (=casa), "pituco" (=elegante/fresa), "misio" (=sin dinero), "yapa" (=extra gratis). Tono respetuoso y amable, ritmo moderado.`,
  'es-VE': `Habla con acento venezolano (Caracas). Entonacion cantarina y expresiva, con melodia marcada. Tuteo. Aspira las 's' finales ("entonces" → "entonce"). La 'r' final suena suave. Muletillas: "vale" (=OK, al final de todo), "mira", "verga" (coloquial, expresion de sorpresa), "coño" (sorpresa informal), "o sea". Expresiones: "chamo/chama" (=amigo/a), "chevere" (=genial), "arrecho" (=enojado o genial segun contexto), "ladilla" (=fastidio), "fino" (=perfecto), "burda" (=mucho), "pana" (=amigo cercano), "vaina" (=cosa). Tono calido y entusiasta, ritmo rapido y animado.`,
  'es-EC': `Habla con acento ecuatoriano (Sierra/Quito). Entonacion pausada y melodica con influencia quichua. Pronuncia todas las letras claramente, especialmente las 's'. Usa "usted" mas que tuteo, incluso entre amigos. Muletillas: "pues" (al final: "si pues"), "ve" (llamar atencion: "ve, escucha"), "no cierto?", "verás". Expresiones: "que fue" (=que tal, saludo informal), "ahi nos vemos" (=nos vemos), "chuta" (=sorpresa), "de ley" (=seguro/obligatorio), "bacán" (=genial), "achachay" (=que frio), "arrarray" (=que calor), "mande" (=digame?). Tono amable y respetuoso, ritmo moderado-pausado.`,
  'es-ES': `Habla con acento espanol castellano (Madrid). Distingue z/c de s (ceceo/distincion). Usa "vosotros". Expresiones: "vale", "tio", "mola", "venga". Entonacion directa y energica. Ritmo moderado-rapido.`,
  'es-BO': `Habla con acento boliviano. Entonacion pausada y suave. Pronunciacion clara de todas las consonantes. Tono respetuoso, ritmo tranquilo. Expresiones: "puej", "yaa".`,
  'es-CR': `Habla con acento costarricense. Entonacion amigable y melodica. Expresiones: "pura vida", "mae", "tuanis". Tono relajado y positivo. Ritmo moderado.`,
  'es-CU': `Habla con acento cubano (La Habana). Entonacion expresiva y ritmica, con cadencia musical. Aspira las 's' ("vamos" → "vamo"), la 'r' final suena como 'l' ("comer" → "comel"), omite las 'd' intervocalicas ("cansado" → "cansao"). Tuteo. Muletillas: "mira", "oye", "no?", "acere/asere" (=amigo), "dale". Expresiones: "que bola" (=que tal), "tremendo" (=genial o impresionante), "la cosa" (=la situacion), "jama" (=comida), "guagua" (=autobus), "fula" (=dolar), "yuma" (=extranjero). Tono animado y calido, ritmo rapido con mucha energia.`,
  'es-DO': `Habla con acento dominicano (Santo Domingo). Entonacion ritmica y animada, muy expresiva. Aspira las 's' ("estas" → "etai"), cambia 'r' final por 'l' o la omite ("comer" → "comel"), elimina 'd' intervocalicas ("cansado" → "cansao"). Tuteo. Muletillas: "dime a ver", "mira", "tu ta claro?", "verdad?", "ombe" (=hombre, sorpresa). Expresiones: "que lo que" (=que tal), "vaina" (=cosa), "tigre/tiguere" (=tipo listo), "chin" (=poquito), "jevi" (=cool), "ta to" (=esta todo bien), "klk" (=que lo que, escrito). Tono alegre y directo, ritmo rapido y energico.`,
  'es-SV': `Habla con acento salvadoreno. Entonacion suave y melodica. Usa voseo ("vos"). Expresiones: "va pues", "cipote". Tono amable, ritmo moderado.`,
  'es-GT': `Habla con acento guatemalteco. Entonacion pausada y respetuosa. Usa voseo. Expresiones: "que onda", "pisto", "a la gran". Tono cordial, ritmo tranquilo.`,
  'es-HN': `Habla con acento hondureno. Entonacion melodica y amable. Usa voseo. Expresiones: "maje", "va pues", "que onda". Tono calido, ritmo moderado.`,
  'es-NI': `Habla con acento nicaraguense. Entonacion cantarina. Usa voseo. Expresiones: "ideay", "que onda". Tono amigable, ritmo moderado.`,
  'es-PA': `Habla con acento panameno (Ciudad de Panama). Entonacion caribena y melodica. Aspira las 's', suaviza las consonantes finales. Tuteo. Muletillas: "mira", "oye", "viste", "chuzo" (=sorpresa). Expresiones: "que xopa" (=que tal), "fren" (=amigo), "vaina" (=cosa), "juega vivo" (=ponerse listo), "pelao" (=nino), "yeye" (=elegante/fresa), "chantin" (=casa). Tono relajado y amigable, ritmo moderado-rapido.`,
  'es-PY': `Habla con acento paraguayo. Entonacion influida por guarani. Pronuncia las vocales con claridad. Expresiones: "luego", "nde". Tono amable y respetuoso. Ritmo pausado.`,
  'es-PR': `Habla con acento puertorriqueno (San Juan). Entonacion ritmica y expresiva con influencia del ingles. La 'r' doble suena como 'l' o jota suave ("perro" → "pelro"), aspira las 's', la 'r' final suena como 'l'. Mezcla espanol e ingles naturalmente (Spanglish). Muletillas: "mano" (=hermano), "brutal" (=genial), "nah", "bro", "tu sabes". Expresiones: "wepa" (=exclamacion de alegria), "boricua" (=puertorriqueno), "corillo" (=grupo de amigos), "chavos" (=dinero), "pai" (=padre, sorpresa), "diantre", "so" (=tipo/persona). Tono animado y expresivo, ritmo rapido.`,
  'es-UY': `Habla con acento uruguayo. Similar al argentino con voseo. Pronuncia "ll/y" como "sh". Expresiones: "ta", "bo", "que hacemo". Tono tranquilo y amigable. Ritmo moderado.`,
  'es-GQ': `Habla con acento de Guinea Ecuatorial. Entonacion clara y formal. Pronunciacion cuidada de todas las consonantes. Tono respetuoso. Ritmo moderado.`,

  // ── English accents ──
  'en-US': `Speak with a standard American English accent (General American, Midwest neutral). Clear pronunciation, rhotic 'r' (pronounce all r's). Natural contractions: "gonna", "wanna", "gotta", "y'all" (informal). Fillers: "like", "you know", "I mean", "basically", "so", "right?". Expressions: "awesome", "cool", "sounds good", "for sure", "no worries", "gotcha" (=got you), "my bad" (=sorry), "heads up" (=warning). Warm and professional tone. Moderate pace with slight upward inflection on questions.`,
  'en-GB': `Speak with a British Received Pronunciation accent. Clear enunciation, measured pace. Use British expressions: "brilliant", "lovely", "cheers". Professional and polished tone.`,
  'en-AU': `Speak with an Australian English accent. Rising intonation at end of sentences. Use Australian expressions: "no worries", "mate", "reckon". Friendly and relaxed tone. Moderate pace.`,
  'en-CA': `Speak with a Canadian English accent. Similar to American but with distinct vowel sounds. Use "eh" naturally. Polite and friendly tone. Moderate pace.`,
  'en-IN': `Speak with an Indian English accent. Distinctive rhythm and intonation patterns. Clear pronunciation. Use expressions like "kindly", "do the needful". Professional and courteous tone.`,
  'en-IE': `Speak with an Irish English accent. Musical intonation with lilting rhythm. Use expressions: "grand", "craic", "sure". Warm and engaging tone.`,
  'en-JM': `Speak with a Jamaican English accent (Kingston). Rhythmic and melodic intonation influenced by Patois. 'th' sounds like 'd' or 't' ("the" → "de", "thing" → "ting"). Drop 'h' at start of words. Fillers: "yuh know", "seen?", "ya dun know". Expressions: "no problem" (=you're welcome), "yeah man", "irie" (=good/great), "likkle" (=little), "mi soon come" (=I'll be right back), "wah gwaan" (=what's going on), "big up" (=respect/shout out), "everyting criss" (=everything's good). Warm, relaxed and confident tone. Moderate-slow pace with sing-song rhythm.`,
  'en-TT': `Speak with a Trinidadian English accent (Port of Spain). Melodic and rhythmic intonation with Caribbean lilt. 'th' often becomes 'd' or 't'. Fillers: "yuh know", "right", "boy/gyul". Expressions: "lime/liming" (=hanging out), "fete" (=party), "steups" (=disapproval sound), "horning" (=cheating), "wha happening" (=what's up), "real" (intensifier: "real nice"), "eh eh" (=surprise), "bacchanal" (=drama/chaos). Warm, animated and friendly tone. Moderate pace with musical cadence.`,
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
