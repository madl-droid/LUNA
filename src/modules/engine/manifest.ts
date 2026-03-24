// LUNA — Module: engine
// Wrapper que inicializa el pipeline de procesamiento de mensajes.
// Expone configSchema para attachment engine params (editable desde console).

import { z } from 'zod'
import type { ModuleManifest } from '../../kernel/types.js'
import type { Registry } from '../../kernel/registry.js'
import { boolEnv, numEnv, numEnvMin } from '../../kernel/config-helpers.js'
import { initEngine, stopEngine } from '../../engine/index.js'
import { runAttachmentMigration } from '../../engine/attachments/migration.js'
import { registerQueryAttachmentTool } from '../../engine/attachments/tools/query-attachment.js'
import { registerWebExploreTool } from '../../engine/attachments/tools/web-explore.js'
import type { AttachmentEngineConfig } from '../../engine/attachments/types.js'
import { SYSTEM_HARD_LIMITS } from '../../engine/attachments/types.js'

/** Config type for attachment engine params */
interface EngineModuleConfig {
  ATTACHMENT_ENABLED: boolean
  ATTACHMENT_SMALL_DOC_TOKENS: number
  ATTACHMENT_MEDIUM_DOC_TOKENS: number
  ATTACHMENT_SUMMARY_MAX_TOKENS: number
  ATTACHMENT_CACHE_TTL_MS: number
  ATTACHMENT_URL_ENABLED: boolean
  ATTACHMENT_URL_FETCH_TIMEOUT_MS: number
  ATTACHMENT_URL_MAX_SIZE_MB: number
}

const manifest: ModuleManifest = {
  name: 'engine',
  version: '1.1.0',
  description: {
    es: 'Motor de procesamiento de mensajes (pipeline de 5 fases)',
    en: 'Message processing engine (5-phase pipeline)',
  },
  type: 'core-module',
  removable: false,
  activateByDefault: true,
  depends: ['memory', 'llm'],

  configSchema: z.object({
    ATTACHMENT_ENABLED: boolEnv(true),
    ATTACHMENT_SMALL_DOC_TOKENS: numEnvMin(1000, 8000),
    ATTACHMENT_MEDIUM_DOC_TOKENS: numEnvMin(1000, 32000),
    ATTACHMENT_SUMMARY_MAX_TOKENS: numEnvMin(100, 2000),
    ATTACHMENT_CACHE_TTL_MS: numEnvMin(60000, 3600000),
    ATTACHMENT_URL_ENABLED: boolEnv(true),
    ATTACHMENT_URL_FETCH_TIMEOUT_MS: numEnvMin(1000, 10000),
    ATTACHMENT_URL_MAX_SIZE_MB: numEnvMin(1, 5),
  }),

  console: {
    title: { es: 'Adjuntos', en: 'Attachments' },
    info: {
      es: `Configuracion del procesamiento de archivos adjuntos en el engine. Limites del sistema: max ${SYSTEM_HARD_LIMITS.maxFileSizeMb} MB por archivo, max ${SYSTEM_HARD_LIMITS.maxAttachmentsPerMessage} adjuntos por mensaje.`,
      en: `Attachment processing configuration for the engine. System limits: max ${SYSTEM_HARD_LIMITS.maxFileSizeMb} MB per file, max ${SYSTEM_HARD_LIMITS.maxAttachmentsPerMessage} attachments per message.`,
    },
    order: 25,
    group: 'agent',
    icon: '&#128206;',
    fields: [
      { key: '_div_att_general', type: 'divider', label: { es: 'General', en: 'General' } },
      {
        key: 'ATTACHMENT_ENABLED',
        type: 'boolean',
        label: { es: 'Procesar adjuntos', en: 'Process attachments' },
        description: { es: 'Activa o desactiva el procesamiento de adjuntos globalmente', en: 'Enable or disable attachment processing globally' },
        icon: '&#128206;',
      },
      {
        key: 'ATTACHMENT_URL_ENABLED',
        type: 'boolean',
        label: { es: 'Extraer contenido de URLs', en: 'Extract URL content' },
        description: { es: 'Detectar y extraer contenido de URLs en mensajes', en: 'Detect and extract content from URLs in messages' },
        icon: '&#128279;',
      },
      { key: '_div_att_docs', type: 'divider', label: { es: 'Clasificacion de documentos', en: 'Document classification' } },
      {
        key: 'ATTACHMENT_SMALL_DOC_TOKENS',
        type: 'number',
        label: { es: 'Umbral doc pequeno (tokens)', en: 'Small doc threshold (tokens)' },
        info: { es: 'Documentos con menos tokens se inyectan completos en el contexto', en: 'Documents with fewer tokens are fully injected into context' },
        min: 1000,
        max: 50000,
        width: 'half',
      },
      {
        key: 'ATTACHMENT_MEDIUM_DOC_TOKENS',
        type: 'number',
        label: { es: 'Umbral doc mediano (tokens)', en: 'Medium doc threshold (tokens)' },
        info: { es: 'Documentos entre pequeno y mediano se cachean en Redis y se inyectan parcialmente', en: 'Documents between small and medium are cached in Redis and partially injected' },
        min: 1000,
        max: 200000,
        width: 'half',
      },
      {
        key: 'ATTACHMENT_SUMMARY_MAX_TOKENS',
        type: 'number',
        label: { es: 'Max tokens de resumen', en: 'Summary max tokens' },
        info: { es: 'Longitud maxima del resumen para documentos grandes', en: 'Maximum summary length for large documents' },
        min: 100,
        max: 10000,
        width: 'half',
      },
      {
        key: 'ATTACHMENT_CACHE_TTL_MS',
        type: 'duration',
        label: { es: 'Cache TTL', en: 'Cache TTL' },
        info: { es: 'Tiempo que los documentos medianos/grandes permanecen en cache Redis', en: 'Time medium/large docs stay cached in Redis' },
        unit: 'ms',
        width: 'half',
      },
      { key: '_div_att_urls', type: 'divider', label: { es: 'Extraccion de URLs', en: 'URL extraction' } },
      {
        key: 'ATTACHMENT_URL_FETCH_TIMEOUT_MS',
        type: 'duration',
        label: { es: 'Timeout de fetch (ms)', en: 'Fetch timeout (ms)' },
        info: { es: 'Tiempo maximo para descargar contenido de una URL', en: 'Maximum time to download content from a URL' },
        unit: 'ms',
        width: 'half',
      },
      {
        key: 'ATTACHMENT_URL_MAX_SIZE_MB',
        type: 'number',
        label: { es: 'Max tamano URL (MB)', en: 'Max URL size (MB)' },
        info: { es: 'Tamano maximo del contenido descargado de una URL', en: 'Maximum size of content downloaded from a URL' },
        min: 1,
        max: 20,
        unit: 'MB',
        width: 'half',
      },
    ],
    apiRoutes: [],
  },

  async init(registry: Registry) {
    // Run attachment_extractions table migration
    const db = registry.getDb()
    await runAttachmentMigration(db)

    initEngine(registry)

    // Register attachment tools (after engine init, tools:registry may now be available)
    await registerQueryAttachmentTool(registry)
    await registerWebExploreTool(registry)

    // ── Attachment engine config service (hot-reloadable via console) ──
    let attConfig = registry.getConfig<EngineModuleConfig>('engine')

    const buildAttEngineConfig = (): AttachmentEngineConfig => ({
      enabled: attConfig.ATTACHMENT_ENABLED,
      smallDocTokens: attConfig.ATTACHMENT_SMALL_DOC_TOKENS,
      mediumDocTokens: attConfig.ATTACHMENT_MEDIUM_DOC_TOKENS,
      summaryMaxTokens: attConfig.ATTACHMENT_SUMMARY_MAX_TOKENS,
      cacheTtlMs: attConfig.ATTACHMENT_CACHE_TTL_MS,
      urlFetchTimeoutMs: attConfig.ATTACHMENT_URL_FETCH_TIMEOUT_MS,
      urlMaxSizeMb: attConfig.ATTACHMENT_URL_MAX_SIZE_MB,
      urlEnabled: attConfig.ATTACHMENT_URL_ENABLED,
    })

    registry.provide('engine:attachment-config', {
      get: buildAttEngineConfig,
    })

    // Hot-reload on console config change
    registry.addHook('engine', 'console:config_applied', async () => {
      attConfig = registry.getConfig<EngineModuleConfig>('engine')
    })
  },

  async stop() {
    await stopEngine()
  },
}

export default manifest
