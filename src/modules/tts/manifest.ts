// LUNA — Module: tts
// Text-to-Speech via Google Cloud TTS. Produces OGG_OPUS audio for WhatsApp voice notes.

import { z } from 'zod'
import pino from 'pino'
import type { ModuleManifest } from '../../kernel/types.js'
import type { Registry } from '../../kernel/registry.js'
import { boolEnv, numEnv } from '../../kernel/config-helpers.js'
import { TTSService } from './tts-service.js'

const logger = pino({ name: 'tts' })

let service: TTSService | null = null

const manifest: ModuleManifest = {
  name: 'tts',
  version: '1.0.0',
  description: {
    es: 'Síntesis de voz via Google Cloud TTS. Genera notas de voz OGG_OPUS.',
    en: 'Speech synthesis via Google Cloud TTS. Generates OGG_OPUS voice notes.',
  },
  type: 'feature',
  removable: true,
  activateByDefault: false,
  depends: [],

  configSchema: z.object({
    TTS_GOOGLE_API_KEY: z.string().default(''),
    TTS_VOICE_LANGUAGE: z.string().default('es-US'),
    TTS_VOICE_NAME: z.string().default('es-US-Studio-B'),
    TTS_SPEAKING_RATE: z.string().default('1.0'),
    TTS_PITCH: z.string().default('0.0'),
    TTS_MAX_CHARS: numEnv(4000),
    TTS_ENABLED_CHANNELS: z.string().default('whatsapp'),
    TTS_AUTO_FOR_AUDIO_INPUT: boolEnv(true),
    TTS_AUDIO_TO_AUDIO_FREQ: numEnv(80),
    TTS_TEXT_TO_AUDIO_FREQ: numEnv(10),
    TTS_MAX_DURATION: z.string().default('2'),
  }),

  console: {
    title: { es: 'Síntesis de Voz (TTS)', en: 'Text-to-Speech (TTS)' },
    info: {
      es: 'Genera notas de voz a partir de texto usando Google Cloud TTS.',
      en: 'Generate voice notes from text using Google Cloud TTS.',
    },
    order: 45,
    group: 'agent',
    icon: '&#127908;',
    fields: [
      {
        key: 'TTS_GOOGLE_API_KEY',
        type: 'secret',
        label: { es: 'Google Cloud API Key', en: 'Google Cloud API Key' },
        info: { es: 'API key con acceso a Cloud Text-to-Speech API', en: 'API key with access to Cloud Text-to-Speech API' },
      },
      {
        key: 'TTS_VOICE_LANGUAGE',
        type: 'text',
        label: { es: 'Idioma de voz', en: 'Voice language' },
        info: { es: 'Código BCP-47 (ej: es-US, es-ES, en-US)', en: 'BCP-47 code (e.g., es-US, es-ES, en-US)' },
        width: 'half',
      },
      {
        key: 'TTS_VOICE_NAME',
        type: 'text',
        label: { es: 'Nombre de voz', en: 'Voice name' },
        info: { es: 'Nombre de la voz de Google (ej: es-US-Studio-B)', en: 'Google voice name (e.g., es-US-Studio-B)' },
        width: 'half',
      },
      {
        key: 'TTS_SPEAKING_RATE',
        type: 'text',
        label: { es: 'Velocidad', en: 'Speaking rate' },
        info: { es: 'Velocidad de habla (0.25 - 4.0, default: 1.0)', en: 'Speaking rate (0.25 - 4.0, default: 1.0)' },
        width: 'half',
      },
      {
        key: 'TTS_PITCH',
        type: 'text',
        label: { es: 'Tono', en: 'Pitch' },
        info: { es: 'Ajuste de tono en semitonos (-20.0 a 20.0, default: 0.0)', en: 'Pitch adjustment in semitones (-20.0 to 20.0, default: 0.0)' },
        width: 'half',
      },
      {
        key: 'TTS_MAX_CHARS',
        type: 'number',
        label: { es: 'Max caracteres', en: 'Max characters' },
        info: { es: 'Máximo de caracteres a sintetizar (Google TTS limit ~5000)', en: 'Maximum characters to synthesize (Google TTS limit ~5000)' },
      },
      {
        key: 'TTS_ENABLED_CHANNELS',
        type: 'text',
        label: { es: 'Canales habilitados', en: 'Enabled channels' },
        info: { es: 'Canales donde TTS está activo (separados por coma, ej: whatsapp)', en: 'Channels where TTS is active (comma-separated, e.g., whatsapp)' },
      },
      {
        key: 'TTS_AUTO_FOR_AUDIO_INPUT',
        type: 'boolean',
        label: { es: 'Responder audio con audio', en: 'Reply audio with audio' },
        info: { es: 'Si el usuario envía nota de voz, responder con nota de voz', en: 'If user sends voice note, reply with voice note' },
      },
    ],
  },

  async init(registry: Registry) {
    const config = registry.getConfig<{
      TTS_GOOGLE_API_KEY: string
      TTS_VOICE_LANGUAGE: string
      TTS_VOICE_NAME: string
      TTS_SPEAKING_RATE: string
      TTS_PITCH: string
      TTS_MAX_CHARS: number
      TTS_ENABLED_CHANNELS: string
      TTS_AUTO_FOR_AUDIO_INPUT: boolean
    }>('tts')

    if (!config.TTS_GOOGLE_API_KEY) {
      logger.warn('TTS module active but no API key configured')
    }

    service = new TTSService(config)
    registry.provide('tts:service', service)

    logger.info('TTS module initialized')
  },

  async stop() {
    service = null
  },
}

export default manifest
