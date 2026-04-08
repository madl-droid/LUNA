// LUNA — Module: templates
// Gestión de plantillas de documentos (Drive) y generación desde el agente.

import { z } from 'zod'
import pino from 'pino'
import type { ModuleManifest } from '../../kernel/types.js'
import type { Registry } from '../../kernel/registry.js'
import { boolEnv } from '../../kernel/config-helpers.js'
import { jsonResponse, parseBody, parseQuery } from '../../kernel/http-helpers.js'
import { TemplatesService } from './service.js'
import { renderTemplatesSection } from './render-section.js'
import { registerTemplateTools } from './tools.js'
import { COMPARATIVO_SLUG, COMPARATIVO_SYSTEM_PROMPT } from './comparativo-subagent.js'
import type { ToolRegistry } from '../tools/tool-registry.js'
import type {
  TemplatesConfig,
  CreateTemplateInput,
  UpdateTemplateInput,
  DocType,
  MimeType,
  SharingMode,
} from './types.js'

const logger = pino({ name: 'templates' })

// Module-level references — set during init, used by API route handlers and stop()
let service: TemplatesService | undefined
let _registry: Registry | undefined

const manifest: ModuleManifest = {
  name: 'templates',
  version: '1.0.0',
  description: {
    es: 'Plantillas de documentos: comparativos, cotizaciones, presentaciones desde Google Drive',
    en: 'Document templates: comparisons, quotes, presentations from Google Drive',
  },
  type: 'feature',
  removable: true,
  activateByDefault: false,
  depends: ['google-apps', 'tools'],

  configSchema: z.object({
    TEMPLATES_STRICT_MODE: boolEnv(false),
    TEMPLATES_NO_TEMPLATE_ACTION: z.enum(['warn', 'block', 'hitl']).default('hitl'),
    TEMPLATES_ROOT_FOLDER_ID: z.string().default(''),
  }),

  console: {
    title: { es: 'Plantillas', en: 'Templates' },
    info: {
      es: 'Gestión de plantillas de documentos para el agente',
      en: 'Document template management for the agent',
    },
    order: 55,
    group: 'agent',
    icon: '&#128196;',
    fields: [
      {
        key: 'TEMPLATES_STRICT_MODE',
        type: 'boolean',
        label: { es: 'Modo estricto', en: 'Strict mode' },
        info: {
          es: 'Si está activo, el agente solo puede crear documentos desde plantillas registradas',
          en: 'If active, agent can only create documents from registered templates',
        },
      },
      {
        key: 'TEMPLATES_NO_TEMPLATE_ACTION',
        type: 'select',
        label: { es: 'Sin plantilla', en: 'No template' },
        info: {
          es: 'Qué hacer cuando no hay plantilla para el tipo de documento solicitado',
          en: 'What to do when there is no template for the requested document type',
        },
        options: [
          { value: 'warn',  label: { es: 'Avisar al contacto', en: 'Warn the contact' } },
          { value: 'block', label: { es: 'Bloquear creación', en: 'Block creation' } },
          { value: 'hitl',  label: { es: 'Escalar (HITL)', en: 'Escalate (HITL)' } },
        ],
      },
      {
        key: 'TEMPLATES_ROOT_FOLDER_ID',
        type: 'text',
        label: { es: 'Carpeta raíz (Drive ID)', en: 'Root folder (Drive ID)' },
        info: {
          es: 'ID de la carpeta de Drive donde se organizan los documentos generados',
          en: 'Drive folder ID where generated documents are organized',
        },
      },
    ],
    apiRoutes: [
      // ── Templates CRUD ────────────────────────────────────────────────
      {
        method: 'GET',
        path: 'list',
        handler: async (req, res) => {
          if (!service) { jsonResponse(res, 503, { ok: false, error: 'Not initialized' }); return }
          try {
            const query = parseQuery(req)
            const filters: { docType?: DocType; enabled?: boolean } = {}
            const dt = query.get('docType')
            if (dt) filters.docType = dt as DocType
            const en = query.get('enabled')
            if (en !== null) filters.enabled = en === 'true'
            const templates = await service.listTemplates(filters)
            jsonResponse(res, 200, { ok: true, templates })
          } catch (err) {
            logger.error({ err }, 'GET /list error')
            jsonResponse(res, 500, { ok: false, error: String(err) })
          }
        },
      },
      {
        method: 'GET',
        path: 'get',
        handler: async (req, res) => {
          if (!service) { jsonResponse(res, 503, { ok: false, error: 'Not initialized' }); return }
          try {
            const query = parseQuery(req)
            const id = query.get('id')
            if (!id) { jsonResponse(res, 400, { ok: false, error: 'id required' }); return }
            const template = await service.getTemplate(id)
            if (!template) { jsonResponse(res, 404, { ok: false, error: 'Not found' }); return }
            jsonResponse(res, 200, { ok: true, template })
          } catch (err) {
            logger.error({ err }, 'GET /get error')
            jsonResponse(res, 500, { ok: false, error: String(err) })
          }
        },
      },
      {
        method: 'POST',
        path: 'create',
        handler: async (req, res) => {
          if (!service) { jsonResponse(res, 503, { ok: false, error: 'Not initialized' }); return }
          try {
            const body = await parseBody<{
              name: string
              description?: string
              docType: DocType
              driveFileId: string
              mimeType: MimeType
              keys?: Array<{ key: string; description: string }>
              folderPattern?: string
              sharingMode?: SharingMode
            }>(req)
            if (!body.name || !body.docType || !body.driveFileId || !body.mimeType) {
              jsonResponse(res, 400, { ok: false, error: 'name, docType, driveFileId, mimeType required' })
              return
            }
            const input: CreateTemplateInput = {
              name: body.name,
              description: body.description,
              docType: body.docType,
              driveFileId: body.driveFileId,
              mimeType: body.mimeType,
              keys: body.keys ?? [],
              folderPattern: body.folderPattern,
              sharingMode: body.sharingMode,
            }
            const template = await service.createTemplate(input)
            jsonResponse(res, 200, { ok: true, template })
          } catch (err) {
            logger.error({ err }, 'POST /create error')
            jsonResponse(res, 500, { ok: false, error: String(err) })
          }
        },
      },
      {
        method: 'PUT',
        path: 'update',
        handler: async (req, res) => {
          if (!service) { jsonResponse(res, 503, { ok: false, error: 'Not initialized' }); return }
          try {
            const body = await parseBody<{ id: string } & UpdateTemplateInput>(req)
            if (!body.id) { jsonResponse(res, 400, { ok: false, error: 'id required' }); return }
            const { id, ...input } = body
            const template = await service.updateTemplate(id, input)
            if (!template) { jsonResponse(res, 404, { ok: false, error: 'Not found' }); return }
            jsonResponse(res, 200, { ok: true, template })
          } catch (err) {
            logger.error({ err }, 'PUT /update error')
            jsonResponse(res, 500, { ok: false, error: String(err) })
          }
        },
      },
      {
        method: 'DELETE',
        path: 'delete',
        handler: async (req, res) => {
          if (!service) { jsonResponse(res, 503, { ok: false, error: 'Not initialized' }); return }
          try {
            const query = parseQuery(req)
            const id = query.get('id')
            if (!id) { jsonResponse(res, 400, { ok: false, error: 'id required' }); return }
            const deleted = await service.deleteTemplate(id)
            jsonResponse(res, 200, { ok: deleted })
          } catch (err) {
            logger.error({ err }, 'DELETE /delete error')
            jsonResponse(res, 500, { ok: false, error: String(err) })
          }
        },
      },
      // ── Scan keys ─────────────────────────────────────────────────────
      {
        method: 'POST',
        path: 'scan-keys',
        handler: async (req, res) => {
          if (!service) { jsonResponse(res, 503, { ok: false, error: 'Not initialized' }); return }
          try {
            const body = await parseBody<{ driveFileId: string }>(req)
            if (!body.driveFileId) {
              jsonResponse(res, 400, { ok: false, error: 'driveFileId required' })
              return
            }
            const result = await service.scanKeysFromDrive(body.driveFileId)
            jsonResponse(res, 200, { ok: true, ...result })
          } catch (err) {
            logger.error({ err }, 'POST /scan-keys error')
            jsonResponse(res, 500, { ok: false, error: String(err) })
          }
        },
      },
      // ── Generated docs ────────────────────────────────────────────────
      {
        method: 'GET',
        path: 'generated',
        handler: async (req, res) => {
          if (!service) { jsonResponse(res, 503, { ok: false, error: 'Not initialized' }); return }
          try {
            const query = parseQuery(req)
            const filters: { templateId?: string; contactId?: string; docType?: string; status?: string } = {}
            const dt = query.get('docType'); if (dt) filters.docType = dt
            const ci = query.get('contactId'); if (ci) filters.contactId = ci
            const tid = query.get('templateId'); if (tid) filters.templateId = tid
            const st = query.get('status'); if (st) filters.status = st
            const generated = await service.searchGeneratedDocs(filters)
            jsonResponse(res, 200, { ok: true, generated })
          } catch (err) {
            logger.error({ err }, 'GET /generated error')
            jsonResponse(res, 500, { ok: false, error: String(err) })
          }
        },
      },
      {
        method: 'GET',
        path: 'generated-detail',
        handler: async (req, res) => {
          if (!service) { jsonResponse(res, 503, { ok: false, error: 'Not initialized' }); return }
          try {
            const query = parseQuery(req)
            const id = query.get('id')
            if (!id) { jsonResponse(res, 400, { ok: false, error: 'id required' }); return }
            const doc = await service.getGeneratedDoc(id)
            if (!doc) { jsonResponse(res, 404, { ok: false, error: 'Not found' }); return }
            jsonResponse(res, 200, { ok: true, doc })
          } catch (err) {
            logger.error({ err }, 'GET /generated-detail error')
            jsonResponse(res, 500, { ok: false, error: String(err) })
          }
        },
      },
    ],
  },

  async init(registry: Registry) {
    _registry = registry
    const config = registry.getConfig<TemplatesConfig>('templates')
    const db = registry.getDb()

    service = new TemplatesService(db, registry, config)
    registry.provide('templates:service', service)

    registry.provide('templates:renderSection', (lang: string) =>
      renderTemplatesSection(lang as 'es' | 'en'),
    )

    // Provide catalog service for engine prompt injection
    registry.provide('templates:catalog', {
      getCatalogText: () => service!.getCatalogForPrompt(),
    })

    // Register agent tools
    const toolRegistry = registry.getOptional<ToolRegistry>('tools:registry')
    if (toolRegistry) {
      await registerTemplateTools(registry, service, toolRegistry)
      logger.info('templates tools registered')
    } else {
      logger.warn('tools:registry not available — templates tools not registered')
    }

    // Invalidate folder cache when config changes (root folder might change)
    registry.addHook('templates', 'console:config_applied', () => {
      service?.invalidateFolderCache()
    })

    // Enable comparativo-researcher subagent and inject system prompt
    try {
      await db.query(
        `UPDATE subagent_types SET system_prompt = $1, enabled = true, updated_at = now() WHERE slug = $2`,
        [COMPARATIVO_SYSTEM_PROMPT, COMPARATIVO_SLUG],
      )
      const saCatalog = registry.getOptional<{ reload(): Promise<void> }>('subagents:catalog')
      await saCatalog?.reload()
      logger.info('comparativo-researcher subagent enabled')
    } catch (err) {
      logger.warn({ err }, 'Could not enable comparativo-researcher subagent')
    }

    logger.info('templates module initialized')
  },

  async stop() {
    // Disable comparativo-researcher subagent when module deactivates
    if (_registry) {
      try {
        const db = _registry.getDb()
        await db.query(
          `UPDATE subagent_types SET enabled = false, updated_at = now() WHERE slug = $1`,
          [COMPARATIVO_SLUG],
        )
        const saCatalog = _registry.getOptional<{ reload(): Promise<void> }>('subagents:catalog')
        await saCatalog?.reload()
        logger.info('comparativo-researcher subagent disabled')
      } catch (err) {
        logger.warn({ err }, 'Could not disable comparativo-researcher subagent')
      }
    }

    service = undefined
    _registry = undefined
    logger.info('templates module stopped')
  },
}

export default manifest
