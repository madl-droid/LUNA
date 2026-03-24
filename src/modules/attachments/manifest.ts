// LUNA — Module: attachments
// Cross-channel attachment processing. Extracts text from PDFs, Word docs, spreadsheets,
// and describes images via LLM vision. Provides attachments:processor service for all channels.

import { z } from 'zod'
import pino from 'pino'
import type { ModuleManifest } from '../../kernel/types.js'
import type { Registry } from '../../kernel/registry.js'
import { numEnv, boolEnv, floatEnvMin } from '../../kernel/config-helpers.js'
import { AttachmentProcessorImpl } from './processor.js'
import type { AttachmentConfig } from './types.js'

const logger = pino({ name: 'attachments' })

const manifest: ModuleManifest = {
  name: 'attachments',
  version: '1.0.0',
  description: {
    es: 'Procesamiento de adjuntos cross-channel. Extrae texto de PDFs, Word, Excel e imagenes.',
    en: 'Cross-channel attachment processing. Extracts text from PDFs, Word, Excel, and images.',
  },
  type: 'feature',
  removable: true,
  activateByDefault: true,
  depends: ['llm'],

  configSchema: z.object({
    ATTACHMENT_MAX_SIZE_MB: floatEnvMin(0, 25),
    ATTACHMENT_PROCESS_IMAGES: boolEnv(true),
    ATTACHMENT_PROCESS_PDFS: boolEnv(true),
    ATTACHMENT_PROCESS_DOCUMENTS: boolEnv(true),
    ATTACHMENT_PROCESS_SPREADSHEETS: boolEnv(true),
    ATTACHMENT_SUMMARY_MAX_TOKENS: numEnv(500),
  }),

  console: {
    title: { es: 'Adjuntos', en: 'Attachments' },
    info: {
      es: 'Procesamiento inteligente de adjuntos para todos los canales. Extrae texto de PDFs, documentos Word, hojas de calculo y describe imagenes.',
      en: 'Intelligent attachment processing for all channels. Extracts text from PDFs, Word docs, spreadsheets, and describes images.',
    },
    order: 75,
    group: 'modules',
    icon: '&#128206;',
    fields: [
      {
        key: 'ATTACHMENT_MAX_SIZE_MB',
        type: 'number',
        label: { es: 'Tamano maximo (MB)', en: 'Max size (MB)' },
        info: { es: 'Tamano maximo de adjunto a procesar (default: 25 MB)', en: 'Maximum attachment size to process (default: 25 MB)' },
      },
      {
        key: 'ATTACHMENT_SUMMARY_MAX_TOKENS',
        type: 'number',
        label: { es: 'Max tokens del resumen', en: 'Summary max tokens' },
        info: { es: 'Longitud maxima del resumen de texto extraido (default: 500)', en: 'Maximum length of extracted text summary (default: 500)' },
      },
      { key: '_divider_types', type: 'divider', label: { es: 'Tipos de archivo', en: 'File types' } },
      {
        key: 'ATTACHMENT_PROCESS_IMAGES',
        type: 'boolean',
        label: { es: 'Procesar imagenes', en: 'Process images' },
        description: { es: 'Describir imagenes adjuntas usando vision LLM (PNG, JPG, WebP, GIF)', en: 'Describe attached images using LLM vision (PNG, JPG, WebP, GIF)' },
      },
      {
        key: 'ATTACHMENT_PROCESS_PDFS',
        type: 'boolean',
        label: { es: 'Procesar PDFs', en: 'Process PDFs' },
        description: { es: 'Extraer texto de archivos PDF adjuntos', en: 'Extract text from attached PDF files' },
      },
      {
        key: 'ATTACHMENT_PROCESS_DOCUMENTS',
        type: 'boolean',
        label: { es: 'Procesar documentos', en: 'Process documents' },
        description: { es: 'Extraer texto de documentos Word (.docx)', en: 'Extract text from Word documents (.docx)' },
      },
      {
        key: 'ATTACHMENT_PROCESS_SPREADSHEETS',
        type: 'boolean',
        label: { es: 'Procesar hojas de calculo', en: 'Process spreadsheets' },
        description: { es: 'Extraer datos de Excel (.xlsx, .xls) y CSV', en: 'Extract data from Excel (.xlsx, .xls) and CSV' },
      },
    ],
  },

  async init(registry: Registry) {
    const config = registry.getConfig<AttachmentConfig>('attachments')
    const processor = new AttachmentProcessorImpl(config, registry)
    registry.provide('attachments:processor', processor)
    logger.info('Attachments module initialized — processor registered')
  },

  async stop() {
    logger.info('Attachments module stopped')
  },
}

export default manifest
