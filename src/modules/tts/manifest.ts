// LUNA — Module: tts
// Text-to-Speech via Google Gemini AI Studio TTS. Produces WAV audio (PCM 24kHz).
// TODO: For WhatsApp voice notes, OGG_OPUS is preferred but requires ffmpeg for PCM conversion.

import { z } from 'zod'
import pino from 'pino'
import type { ModuleManifest } from '../../kernel/types.js'
import type { Registry } from '../../kernel/registry.js'
import { boolEnv, numEnv, floatEnv } from '../../kernel/config-helpers.js'
import * as configStore from '../../kernel/config-store.js'
import { TTSService } from './tts-service.js'

const logger = pino({ name: 'tts' })

let service: TTSService | null = null

const manifest: ModuleManifest = {
  name: 'tts',
  version: '2.0.0',
  description: {
    es: 'Sintesis de voz via Google Gemini AI Studio TTS. Genera notas de voz WAV.',
    en: 'Speech synthesis via Google Gemini AI Studio TTS. Generates WAV voice notes.',
  },
  type: 'feature',
  removable: true,
  activateByDefault: true,
  depends: [],

  configSchema: z.object({
    TTS_ENABLED: boolEnv(true),
    TTS_MODEL: z.string().default('gemini-2.5-pro-preview-tts'),
    TTS_DOWNGRADE_MODEL: z.string().default('gemini-2.5-flash-preview-tts'),
    TTS_VOICE_NAME: z.string().default('Kore'),
    TTS_MAX_CHARS: numEnv(4000),
    TTS_ENABLED_CHANNELS: z.string().default('whatsapp'),
    TTS_AUTO_FOR_AUDIO_INPUT: boolEnv(true),
    TTS_AUDIO_TO_AUDIO_FREQ: numEnv(80),
    TTS_TEXT_TO_AUDIO_FREQ: numEnv(10),
    TTS_MAX_DURATION: z.string().default('2'),
    TTS_VOICE_STYLES: boolEnv(false),
    TTS_TEMPERATURE: floatEnv(1.2),
    TTS_SPEAKING_RATE: floatEnv(1.5),
  }),

  console: {
    title: { es: 'Sintesis de Voz (TTS)', en: 'Text-to-Speech (TTS)' },
    info: {
      es: 'Genera notas de voz a partir de texto usando Google Gemini AI Studio TTS.',
      en: 'Generate voice notes from text using Google Gemini AI Studio TTS.',
    },
    order: 45,
    group: 'modules',
    icon: '&#127908;',
    fields: [
      {
        key: 'TTS_VOICE_NAME',
        type: 'text',
        label: { es: 'Nombre de voz', en: 'Voice name' },
        info: { es: 'Voz de Gemini (ej: Kore, Puck, Charon, Zephyr)', en: 'Gemini voice (e.g., Kore, Puck, Charon, Zephyr)' },
        width: 'half',
      },
      {
        key: 'TTS_MAX_CHARS',
        type: 'number',
        label: { es: 'Max caracteres', en: 'Max characters' },
        info: { es: 'Maximo de caracteres a sintetizar', en: 'Maximum characters to synthesize' },
      },
      {
        key: 'TTS_ENABLED_CHANNELS',
        type: 'text',
        label: { es: 'Canales habilitados', en: 'Enabled channels' },
        info: { es: 'Canales donde TTS esta activo (separados por coma, ej: whatsapp)', en: 'Channels where TTS is active (comma-separated, e.g., whatsapp)' },
      },
      {
        key: 'TTS_AUTO_FOR_AUDIO_INPUT',
        type: 'boolean',
        label: { es: 'Responder audio con audio', en: 'Reply audio with audio' },
        info: { es: 'Si el usuario envia nota de voz, responder con nota de voz', en: 'If user sends voice note, reply with voice note' },
      },
      {
        key: 'TTS_SPEAKING_RATE',
        type: 'number',
        label: { es: 'Velocidad de habla', en: 'Speaking rate' },
        info: { es: 'Multiplicador de velocidad: 0.5 = muy lento, 1.0 = normal, 1.5 = rápido, 2.0 = muy rápido', en: 'Speed multiplier: 0.5 = very slow, 1.0 = normal, 1.5 = fast, 2.0 = very fast' },
        width: 'half',
      },
    ],
  },

  async init(registry: Registry) {
    const config = registry.getConfig<{
      TTS_ENABLED: boolean
      TTS_MODEL: string
      TTS_DOWNGRADE_MODEL: string
      TTS_VOICE_NAME: string
      TTS_MAX_CHARS: number
      TTS_ENABLED_CHANNELS: string
      TTS_AUTO_FOR_AUDIO_INPUT: boolean
      TTS_AUDIO_TO_AUDIO_FREQ: number
      TTS_TEXT_TO_AUDIO_FREQ: number
      TTS_MAX_DURATION: string
      TTS_VOICE_STYLES: boolean
      TTS_TEMPERATURE: number
      TTS_SPEAKING_RATE: number
    }>('tts')

    if (!config.TTS_ENABLED) {
      logger.info('TTS module loaded but disabled via TTS_ENABLED=false')
      return
    }

    // Use general Google AI API key (same as Gemini LLM)
    const pool = registry.getDb()
    const apiKey = await configStore.get(pool, 'GOOGLE_AI_API_KEY').catch(() => '') ?? ''

    if (!apiKey) {
      logger.warn('TTS module active but no API key configured (set GOOGLE_AI_API_KEY in LLM settings)')
    }

    // Load accent style and voice instructions from config_store (set by prompts module)
    const accentStyle = await configStore.get(pool, 'AGENT_TTS_STYLE_PROMPT').catch(() => '') ?? ''
    const voiceInstructions = await configStore.get(pool, 'TTS_VOICE_INSTRUCTIONS').catch(() => '') ?? ''

    const ttsConfig = {
      ...config,
      TTS_GOOGLE_API_KEY: apiKey,
      TTS_ACCENT_STYLE: accentStyle,
      TTS_VOICE_INSTRUCTIONS: voiceInstructions,
    }
    service = new TTSService(ttsConfig)
    registry.provide('tts:service', service)

    // Hot-reload: update service config when console applies changes
    registry.addHook('tts', 'console:config_applied', async () => {
      if (!service) return
      const fresh = registry.getConfig<typeof config>('tts')
      const freshApiKey = await configStore.get(pool, 'GOOGLE_AI_API_KEY').catch(() => '') ?? ''
      const freshAccentStyle = await configStore.get(pool, 'AGENT_TTS_STYLE_PROMPT').catch(() => '') ?? ''
      const freshVoiceInstructions = await configStore.get(pool, 'TTS_VOICE_INSTRUCTIONS').catch(() => '') ?? ''
      service.updateConfig({
        ...fresh,
        TTS_GOOGLE_API_KEY: freshApiKey,
        TTS_ACCENT_STYLE: freshAccentStyle,
        TTS_VOICE_INSTRUCTIONS: freshVoiceInstructions,
      })
      logger.info('TTS service hot-reloaded')
    })

    logger.info('TTS module initialized')
  },

  async stop() {
    service = null
  },
}

export default manifest
