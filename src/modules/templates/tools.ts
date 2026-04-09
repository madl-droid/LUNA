// LUNA — Module: templates — Tools
// Registra las 3 tools del agente: create-from-template, search-generated-documents, reedit-document.

import pino from 'pino'
import type { Registry } from '../../kernel/registry.js'
import type { ToolRegistry } from '../tools/tool-registry.js'
import type { TemplatesService } from './service.js'
import type { DocType } from './types.js'
import type { CreateTicketInput } from '../hitl/types.js'

const logger = pino({ name: 'templates:tools' })

export async function registerTemplateTools(
  registry: Registry,
  service: TemplatesService,
  toolRegistry: ToolRegistry,
): Promise<void> {
  // ── Tool 1: create-from-template ─────────────────────────────────────────
  await toolRegistry.registerTool({
    definition: {
      name: 'create-from-template',
      displayName: 'Crear documento desde plantilla',
      description: 'Crea un documento (comparativo, cotización, presentación) a partir de una plantilla registrada, llenando los campos con la información proporcionada. El documento se organiza automáticamente en carpetas y se comparte vía enlace de Drive.',
      shortDescription: 'Crea documentos desde plantillas registradas llenando campos {KEY}.',
      detailedGuidance: `## Flujo para comparativos
1. SIEMPRE busca primero si ya existe: search-generated-documents con doc_type="comparativo" y tags relevantes
2. Si existe uno reciente y vigente → comparte el enlace existente, NO crees uno nuevo
3. Si NO existe → necesitas investigar:
   a. Usa run_subagent con slug="comparativo-researcher" y la tarea de investigar
   b. Incluye en la tarea: qué producto/competidor comparar y los keys de la plantilla con sus descripciones
   c. El subagente retorna los key_values investigados
   d. Usa esos key_values para llamar create-from-template
4. Si el subagente no pudo obtener todos los datos → NO crees un comparativo incompleto. Informa al contacto qué datos faltan.

## Flujo para cotizaciones y presentaciones
1. Los key_values provienen del contexto de la conversación (datos del contacto, producto, precio, etc.)
2. NO necesitas subagente para estos tipos
3. Puedes re-editar libremente con reedit-document si el contacto lo solicita

## Re-edición de comparativos
- Solo re-editar un comparativo si el contacto señala un ERROR FACTUAL específico
- "Los datos están desactualizados" o "el precio cambió" → sí re-editar
- "Me gusta pero quiero ver otras marcas" → NO re-editar, crear uno nuevo`,
      category: 'documents',
      sourceModule: 'templates',
      parameters: {
        type: 'object',
        properties: {
          template_id: {
            type: 'string',
            description: 'ID de la plantilla a usar. Si no se conoce, omitir y especificar doc_type para auto-selección.',
          },
          doc_type: {
            type: 'string',
            enum: ['comparativo', 'cotizacion', 'presentacion', 'otro'],
            description: 'Tipo de documento a crear. Se usa para auto-seleccionar plantilla si template_id no se proporciona.',
          },
          key_values: {
            type: 'object',
            description: 'Valores para llenar en la plantilla. Cada key debe corresponder a un placeholder {KEY} de la plantilla.',
          },
          doc_name: {
            type: 'string',
            description: 'Nombre del documento a crear.',
          },
          tags: {
            type: 'object',
            description: 'Tags para clasificar el documento (ej: {"brand": "Nike", "competitor": "Adidas"}).',
          },
        },
        required: ['key_values', 'doc_name'],
      },
    },
    handler: async (input, context) => {
      const keyValues = (input['key_values'] as Record<string, string>) ?? {}
      const docName = (input['doc_name'] as string) ?? 'Documento'
      const tags = (input['tags'] as Record<string, string>) ?? {}

      let templateId = input['template_id'] as string | undefined
      const docType = input['doc_type'] as DocType | undefined

      // Auto-select template by doc_type if template_id not provided
      if (!templateId) {
        if (!docType) {
          return { success: false, error: 'Se requiere template_id o doc_type para crear un documento.' }
        }

        const templates = await service.getTemplatesByType(docType)

        if (templates.length === 0) {
          // No template found — apply strict mode behavior
          if (service.isStrictMode()) {
            const action = service.getNoTemplateAction()

            if (action === 'hitl') {
              const hitlManager = registry.getOptional<{ createTicket(input: CreateTicketInput): Promise<unknown> }>('hitl:manager')
              if (hitlManager && context.contactId && context.senderId && context.channelName) {
                await hitlManager.createTicket({
                  requesterContactId: context.contactId,
                  requesterChannel: context.channelName,
                  requesterSenderId: context.senderId,
                  requestType: 'domain_help',
                  requestSummary: `Contacto solicitó documento tipo "${docType}" pero no hay plantilla registrada.`,
                  urgency: 'normal',
                  targetRole: 'admin',
                })
              }
              return {
                success: false,
                message: 'Estoy consultando internamente para poder ayudarte con ese documento.',
                hitlCreated: true,
              }
            }

            if (action === 'block') {
              return {
                success: false,
                message: 'En este momento no cuento con la plantilla para elaborar ese documento. Permíteme consultar internamente para resolver esto.',
              }
            }

            // warn
            return {
              success: false,
              message: 'No tengo una plantilla para ese tipo de documento. Puedo intentar crearlo de otra forma si lo deseas.',
              canProceedWithout: true,
            }
          }

          // Strict mode off — inform agent but don't block
          return {
            success: false,
            message: 'No hay plantilla para ese tipo de documento, pero el modo estricto está desactivado. Puedes crear el documento libremente.',
            strictModeOff: true,
          }
        }

        // Use first template (most recently created)
        templateId = templates[0]!.id
      }

      // Validate key_values against template
      const template = await service.getTemplate(templateId)
      if (!template) return { success: false, error: `Plantilla ${templateId} no encontrada.` }

      const missingKeys = template.keys.filter(k => !(k.key in keyValues))
      if (missingKeys.length > 0) {
        const missing = missingKeys.map(k =>
          `${k.key}${k.description ? ' (' + k.description + ')' : ''}`
        ).join(', ')
        return {
          success: false,
          error: `Faltan los siguientes campos requeridos: ${missing}`,
          missingKeys: missingKeys.map(k => ({ key: k.key, description: k.description })),
        }
      }

      // Auto-generate tags for comparativos if none were provided
      const effectiveDocType = (docType ?? template.docType) as DocType
      if (effectiveDocType === 'comparativo' && Object.keys(tags).length === 0) {
        // Auto-extract tags from key names for dedup search.
        // Map common key name patterns → canonical tag names.
        const tagPatterns: Array<{ pattern: RegExp; tag: string }> = [
          { pattern: /brand|marca/i, tag: 'brand' },
          { pattern: /competitor|competidor|competencia|rival/i, tag: 'competitor' },
          { pattern: /product|producto/i, tag: 'product' },
          { pattern: /company|empresa|cliente|customer/i, tag: 'company' },
          { pattern: /categor/i, tag: 'category' },
          { pattern: /nombre|name/i, tag: 'name' },
        ]
        for (const [key, value] of Object.entries(keyValues)) {
          for (const { pattern, tag } of tagPatterns) {
            if (pattern.test(key) && !tags[tag]) {
              tags[tag] = value
              break
            }
          }
        }
      }

      try {
        const doc = await service.createDocument({
          templateId,
          keyValues,
          contactId: context.contactId,
          requesterSenderId: context.senderId,
          requesterChannel: context.channelName,
          docName,
          tags,
        })

        return {
          success: true,
          data: {
            documentId: doc.id,
            webViewLink: doc.webViewLink,
            docName: doc.docName,
            docType: doc.docType,
            version: doc.version,
          },
        }
      } catch (err) {
        return { success: false, error: String(err) }
      }
    },
  })

  // ── Tool 2: search-generated-documents ───────────────────────────────────
  await toolRegistry.registerTool({
    definition: {
      name: 'search-generated-documents',
      displayName: 'Buscar documentos generados',
      description: 'Busca documentos que ya fueron creados desde plantillas. Útil para encontrar comparativos, cotizaciones o presentaciones existentes antes de crear uno nuevo.',
      shortDescription: 'Busca documentos ya generados desde plantillas.',
      detailedGuidance: `REGLA DE COMPARTIR:
- Comparativos: puedes compartir el enlace con cualquier contacto que lo solicite.
- Cotizaciones y presentaciones: SOLO comparte el enlace con:
  1. El contacto que originalmente solicitó el documento
  2. Coworkers internos que lo soliciten
  NO compartas cotizaciones ni presentaciones con otros contactos externos.

Usa esta tool SIEMPRE antes de crear un nuevo documento para evitar duplicados.`,
      category: 'documents',
      sourceModule: 'templates',
      parameters: {
        type: 'object',
        properties: {
          doc_type: {
            type: 'string',
            enum: ['comparativo', 'cotizacion', 'presentacion', 'otro'],
            description: 'Filtrar por tipo de documento.',
          },
          tags: {
            type: 'object',
            description: 'Filtrar por tags (ej: {"brand": "Nike"}).',
          },
          contact_id: {
            type: 'string',
            description: 'Filtrar por contacto que solicitó el documento.',
          },
          query: {
            type: 'string',
            description: 'Texto libre para buscar en nombre del documento.',
          },
        },
      },
    },
    handler: async (input, _context) => {
      try {
        const docs = await service.findExistingDocument({
          docType: input['doc_type'] as DocType | undefined,
          tags: input['tags'] as Record<string, string> | undefined,
          contactId: input['contact_id'] as string | undefined,
          docNameQuery: input['query'] as string | undefined,
        })

        return {
          success: true,
          data: docs.map(d => ({
            id: d.id,
            docName: d.docName,
            docType: d.docType,
            webViewLink: d.webViewLink,
            tags: d.tags,
            status: d.status,
            version: d.version,
            createdAt: d.createdAt.toISOString(),
          })),
          count: docs.length,
        }
      } catch (err) {
        return { success: false, error: String(err) }
      }
    },
  })

  // ── Tool 3: reedit-document ───────────────────────────────────────────────
  await toolRegistry.registerTool({
    definition: {
      name: 'reedit-document',
      displayName: 'Re-editar documento generado',
      description: 'Modifica valores en un documento ya generado desde plantilla. Actualiza el mismo documento (mismo enlace). Solo modifica los campos indicados.',
      shortDescription: 'Re-edita un documento generado actualizando campos específicos.',
      detailedGuidance: `Para comparativos: solo re-editar si se verificó que hay un error factual en el documento. No re-editar comparativos para actualizar información de competidores sin verificación previa.
Para cotizaciones y presentaciones: se puede re-editar libremente cuando el contacto solicite cambios.
El documento mantiene el mismo enlace de Drive después de la re-edición.`,
      category: 'documents',
      sourceModule: 'templates',
      parameters: {
        type: 'object',
        properties: {
          document_id: {
            type: 'string',
            description: 'ID del documento generado a re-editar.',
          },
          updated_key_values: {
            type: 'object',
            description: 'Keys a actualizar con sus nuevos valores. Solo incluir los que cambian.',
          },
          reason: {
            type: 'string',
            description: 'Razón de la re-edición.',
          },
        },
        required: ['document_id', 'updated_key_values'],
      },
    },
    handler: async (input, _context) => {
      const documentId = input['document_id'] as string
      const updatedKeyValues = (input['updated_key_values'] as Record<string, string>) ?? {}

      if (!documentId) return { success: false, error: 'document_id es requerido.' }
      if (Object.keys(updatedKeyValues).length === 0) {
        return { success: false, error: 'updated_key_values no puede estar vacío.' }
      }

      try {
        const doc = await service.reeditDocument({ generatedDocId: documentId, updatedKeyValues })

        if (doc.docType === 'comparativo') {
          logger.info({
            docId: doc.id,
            reason: input['reason'],
            updatedKeys: Object.keys(updatedKeyValues),
          }, 'Comparativo re-edit requested')
        }

        return {
          success: true,
          data: {
            documentId: doc.id,
            webViewLink: doc.webViewLink,
            version: doc.version,
            updatedKeys: Object.keys(updatedKeyValues),
          },
        }
      } catch (err) {
        return { success: false, error: String(err) }
      }
    },
  })
}
