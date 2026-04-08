// LUNA — Module: google-apps — Tool Registration
// Registra herramientas de Drive, Sheets, Docs, Slides, Calendar en el sistema de tools.

import type { Registry } from '../../kernel/registry.js'
import type { ToolRegistry } from '../tools/tool-registry.js'
import type { DriveService } from './drive-service.js'
import type { SheetsService } from './sheets-service.js'
import type { DocsService } from './docs-service.js'
import type { SlidesService } from './slides-service.js'
import type { CalendarService } from './calendar-service.js'
import type { GoogleServiceName, CalendarEventUpdateOptions, CalendarSchedulingConfig, SheetBatchOperation, GoogleApiConfig, DocEditOperation } from './types.js'
import { CALENDAR_CONFIG_DEFAULTS } from './calendar-config.js'
import {
  formatEventsListForAgent,
  formatAvailabilityForAgent,
  formatSingleEventForAgent,
  validateEventTiming,
  isBusinessDay,
} from './calendar-helpers.js'
import pino from 'pino'
import { extractContent, enrichWithLLM } from '../../extractors/index.js'
import type { ExtractorResult } from '../../extractors/types.js'

const logger = pino({ name: 'google-apps:tools' })

// ─── Calendar config helpers ───────────────

function getCalendarConfig(registry: Registry): CalendarSchedulingConfig {
  const svc = registry.getOptional<{ get(): CalendarSchedulingConfig }>('google-apps:calendar-config')
  return svc?.get() ?? CALENDAR_CONFIG_DEFAULTS
}

function getBusinessHours(registry: Registry): { start: number; end: number; days: number[] } | null {
  const svc = registry.getOptional<{ get(): { start: number; end: number; days: number[] } }>('engine:business-hours')
  return svc?.get() ?? null
}

/** Google-native MIME types — agent must use dedicated read tools instead of drive-read-file */
const GOOGLE_NATIVE_MIMES = new Set([
  'application/vnd.google-apps.document',
  'application/vnd.google-apps.spreadsheet',
  'application/vnd.google-apps.presentation',
])

/** Suggested tool per Google-native MIME type */
const GOOGLE_NATIVE_TOOL_MAP: Record<string, string> = {
  'application/vnd.google-apps.document': 'docs-read',
  'application/vnd.google-apps.spreadsheet': 'sheets-read',
  'application/vnd.google-apps.presentation': 'slides-read',
}

/** Office mimeType → export format for files.export() */
const OFFICE_EXPORT_MAP: Record<string, { exportMime: string; extractorMime: string; label: string }> = {
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': { exportMime: 'text/plain', extractorMime: 'text/plain', label: 'Word' },
  'application/msword': { exportMime: 'text/plain', extractorMime: 'text/plain', label: 'Word' },
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': { exportMime: 'text/csv', extractorMime: 'text/csv', label: 'Excel' },
  'application/vnd.ms-excel': { exportMime: 'text/csv', extractorMime: 'text/csv', label: 'Excel' },
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': { exportMime: 'application/pdf', extractorMime: 'application/pdf', label: 'PowerPoint' },
  'application/vnd.ms-powerpoint': { exportMime: 'application/pdf', extractorMime: 'application/pdf', label: 'PowerPoint' },
}

export async function registerGoogleTools(
  registry: Registry,
  services: {
    drive?: DriveService
    sheets?: SheetsService
    docs?: DocsService
    slides?: SlidesService
    calendar?: CalendarService
  },
  enabledServices: Set<GoogleServiceName>,
  oauthConnected = false,
): Promise<void> {
  const toolRegistry = registry.getOptional<ToolRegistry>('tools:registry')
  if (!toolRegistry) {
    logger.warn('Tools module not available — skipping tool registration')
    return
  }

  if (!oauthConnected) {
    logger.info('Google OAuth not connected — skipping tool registration (tools would fail without auth)')
    return
  }

  // ─── Drive tools ───────────────────────────

  if (enabledServices.has('drive') && services.drive) {
    const drive = services.drive

    await toolRegistry.registerTool({
      definition: {
        name: 'drive-list-files',
        displayName: 'Listar archivos en Drive',
        description: 'Lista archivos y carpetas en Google Drive del agente. Puede navegar carpetas por folderId, buscar por nombre, filtrar por tipo y paginar resultados.',
        category: 'drive',
        sourceModule: 'google-apps',
        parameters: {
          type: 'object',
          properties: {
            query: { type: 'string', description: 'Texto a buscar en nombres de archivo' },
            folderId: { type: 'string', description: 'ID de carpeta para listar su contenido (carpetas primero, luego archivos)' },
            mimeType: { type: 'string', description: 'Filtrar por tipo MIME (ej: application/vnd.google-apps.spreadsheet)' },
            sharedWithMe: { type: 'boolean', description: 'Mostrar archivos compartidos conmigo' },
            pageSize: { type: 'number', description: 'Cantidad de resultados por página (default: 50, max: 100)' },
            pageToken: { type: 'string', description: 'Token para obtener la siguiente página de resultados (viene de nextPageToken)' },
          },
        },
      },
      handler: async (input) => {
        const pageSize = Math.min((input.pageSize as number | undefined) ?? 50, 100)
        const result = await drive.listFiles({
          query: input.query as string | undefined,
          folderId: input.folderId as string | undefined,
          mimeType: input.mimeType as string | undefined,
          includeSharedWithMe: input.sharedWithMe as boolean | undefined,
          pageSize,
          pageToken: input.pageToken as string | undefined,
        })
        return {
          success: true,
          data: {
            files: result.files.map(f => ({
              id: f.id,
              name: f.name,
              mimeType: f.mimeType,
              isFolder: f.mimeType === 'application/vnd.google-apps.folder',
              size: f.size,
              modifiedTime: f.modifiedTime,
              webViewLink: f.webViewLink,
            })),
            nextPageToken: result.nextPageToken ?? null,
            totalShown: result.files.length,
          },
        }
      },
    })

    await toolRegistry.registerTool({
      definition: {
        name: 'drive-get-file',
        displayName: 'Obtener detalle de archivo',
        description: 'Obtiene información detallada de un archivo en Drive incluyendo permisos y enlaces.',
        category: 'drive',
        sourceModule: 'google-apps',
        parameters: {
          type: 'object',
          properties: {
            fileId: { type: 'string', description: 'ID del archivo en Drive' },
          },
          required: ['fileId'],
        },
      },
      handler: async (input) => {
        const file = await drive.getFile(input.fileId as string)
        return { success: true, data: file }
      },
    })

    await toolRegistry.registerTool({
      definition: {
        name: 'drive-create-folder',
        displayName: 'Crear carpeta en Drive',
        description: 'Crea una nueva carpeta en Google Drive.',
        category: 'drive',
        sourceModule: 'google-apps',
        parameters: {
          type: 'object',
          properties: {
            name: { type: 'string', description: 'Nombre de la carpeta' },
            parentId: { type: 'string', description: 'ID de carpeta padre (opcional, root si no se especifica)' },
          },
          required: ['name'],
        },
      },
      handler: async (input) => {
        const folder = await drive.createFolder(input.name as string, input.parentId as string | undefined)
        return { success: true, data: folder }
      },
    })

    await toolRegistry.registerTool({
      definition: {
        name: 'drive-create-file',
        displayName: 'Crear archivo en Drive',
        description: 'Crea un archivo nuevo en Google Drive con contenido.',
        category: 'drive',
        sourceModule: 'google-apps',
        parameters: {
          type: 'object',
          properties: {
            name: { type: 'string', description: 'Nombre del archivo' },
            mimeType: { type: 'string', description: 'Tipo MIME del archivo (ej: text/plain, application/pdf)' },
            content: { type: 'string', description: 'Contenido del archivo (texto)' },
            parentId: { type: 'string', description: 'ID de carpeta padre (opcional)' },
          },
          required: ['name', 'mimeType', 'content'],
        },
      },
      handler: async (input) => {
        const file = await drive.createFile(
          input.name as string,
          input.mimeType as string,
          input.content as string,
          input.parentId as string | undefined,
        )
        return { success: true, data: file }
      },
    })

    await toolRegistry.registerTool({
      definition: {
        name: 'drive-share',
        displayName: 'Compartir archivo de Drive',
        description: 'Comparte un archivo o carpeta de Drive con un usuario por email.',
        category: 'drive',
        sourceModule: 'google-apps',
        parameters: {
          type: 'object',
          properties: {
            fileId: { type: 'string', description: 'ID del archivo o carpeta' },
            email: { type: 'string', description: 'Email del usuario con quien compartir' },
            role: { type: 'string', description: 'Permiso: reader, writer, commenter', enum: ['reader', 'writer', 'commenter'] },
          },
          required: ['fileId', 'email'],
        },
      },
      handler: async (input) => {
        const permission = await drive.shareFile(
          input.fileId as string,
          input.email as string,
          (input.role as 'reader' | 'writer' | 'commenter') ?? 'reader',
        )
        return { success: true, data: permission }
      },
    })

    await toolRegistry.registerTool({
      definition: {
        name: 'drive-move-file',
        displayName: 'Mover archivo en Drive',
        description: 'Mueve un archivo a otra carpeta en Google Drive.',
        category: 'drive',
        sourceModule: 'google-apps',
        parameters: {
          type: 'object',
          properties: {
            fileId: { type: 'string', description: 'ID del archivo a mover' },
            newParentId: { type: 'string', description: 'ID de la carpeta destino' },
            removeFromParent: { type: 'string', description: 'ID de la carpeta origen (para remover)' },
          },
          required: ['fileId', 'newParentId'],
        },
      },
      handler: async (input) => {
        await drive.moveFile(
          input.fileId as string,
          input.newParentId as string,
          input.removeFromParent as string | undefined,
        )
        return { success: true, data: { moved: true } }
      },
    })

    // drive-read-file: lazy download + extract for binary/Office files in Drive
    await toolRegistry.registerTool({
      definition: {
        name: 'drive-read-file',
        displayName: 'Leer archivo binario de Drive',
        description: 'Descarga y extrae contenido de un archivo en Google Drive (PDF, Word, Excel, PowerPoint, imágenes, video). Verifica tamaño antes de descargar. Usa esta herramienta cuando encuentres un archivo de Drive que no sea un Google Doc/Sheet/Slides nativo.',
        category: 'drive',
        sourceModule: 'google-apps',
        parameters: {
          type: 'object',
          properties: {
            fileId: { type: 'string', description: 'ID del archivo en Drive' },
          },
          required: ['fileId'],
        },
      },
      handler: async (input, ctx) => {
        const fileId = input.fileId as string

        // 1. Get file metadata (name, mimeType, size)
        const file = await drive.getFile(fileId)
        // Guard: reject folders — agent should use drive-list-files instead
        if (file.mimeType === 'application/vnd.google-apps.folder') {
          return {
            success: false,
            error: 'Este ID es una carpeta, no un archivo. Usa drive-list-files para ver su contenido.',
            data: { name: file.name, mimeType: file.mimeType },
          }
        }

        // Guard: reject Google-native types — agent should use docs-read/sheets-read/slides-read
        if (GOOGLE_NATIVE_MIMES.has(file.mimeType)) {
          return {
            success: false,
            error: `Este es un archivo nativo de Google. Usa ${GOOGLE_NATIVE_TOOL_MAP[file.mimeType]} en vez de drive-read-file.`,
            data: { name: file.name, mimeType: file.mimeType, suggestedTool: GOOGLE_NATIVE_TOOL_MAP[file.mimeType] },
          }
        }

        const fileSizeBytes = file.size ? parseInt(file.size, 10) : 0
        const maxSizeMb = registry.getConfig<{ ATTACHMENT_URL_MAX_SIZE_MB: number }>('engine')?.ATTACHMENT_URL_MAX_SIZE_MB ?? 10
        const maxSizeBytes = maxSizeMb * 1024 * 1024

        if (fileSizeBytes > maxSizeBytes) {
          return {
            success: false,
            error: `Archivo demasiado grande: ${(fileSizeBytes / 1024 / 1024).toFixed(1)}MB (máximo: ${maxSizeMb}MB)`,
            data: { name: file.name, mimeType: file.mimeType, sizeMb: +(fileSizeBytes / 1024 / 1024).toFixed(1) },
          }
        }

        // 2. Download or export the file
        let buffer: Buffer
        let extractorMime: string
        const officeExport = OFFICE_EXPORT_MAP[file.mimeType]

        if (officeExport) {
          // Office file: export via files.export() to a readable format
          const exported = await drive.exportFile(fileId, officeExport.exportMime)
          buffer = Buffer.isBuffer(exported) ? exported : Buffer.from(exported, 'utf-8')
          extractorMime = officeExport.extractorMime
          logger.info({ fileId, name: file.name, exportMime: officeExport.exportMime }, `Drive ${officeExport.label} exported`)
        } else {
          // Binary file (PDF, image, video, etc.): download via files.get({alt:'media'})
          buffer = await drive.downloadFile(fileId)
          extractorMime = file.mimeType
          logger.info({ fileId, name: file.name, mimeType: file.mimeType, bytes: buffer.length }, 'Drive binary downloaded')
        }

        // 3. Run extractor
        const extracted = await extractContent(buffer, file.name, extractorMime, registry)

        // 4. Try LLM enrichment for images (vision description)
        let llmDescription: string | null = null
        try {
          const mimePrefix = extractorMime.split('/')[0]
          if (mimePrefix === 'image') {
            const imageResult: ExtractorResult = {
              kind: 'image',
              buffer,
              mimeType: extractorMime,
              width: 0,
              height: 0,
              md5: '',
              accompanyingText: '',
              metadata: { originalName: file.name, sizeBytes: buffer.length },
            }
            const enriched = await enrichWithLLM(imageResult, registry)
            if ('llmEnrichment' in enriched && enriched.llmEnrichment?.description) {
              llmDescription = enriched.llmEnrichment.description
            }
          }
        } catch (enrichErr) {
          logger.warn({ enrichErr, fileId }, 'Drive file LLM enrichment failed — returning extracted text only')
        }

        // 5. Persist to attachment_extractions (fire-and-forget)
        persistDriveReadResult(registry, fileId, file.name, file.mimeType, extracted.text, llmDescription, ctx?.sessionId).catch(
          (err: unknown) => logger.warn({ err, fileId }, 'Failed to persist drive-read-file result'),
        )

        // 6. Return to agent
        const result: Record<string, unknown> = {
          name: file.name,
          mimeType: file.mimeType,
          sizeMb: fileSizeBytes ? +(fileSizeBytes / 1024 / 1024).toFixed(1) : null,
          extractedText: extracted.text?.slice(0, 32000) ?? null,
          sections: extracted.sections?.length ?? 0,
        }
        if (llmDescription) result.description = llmDescription
        if (extracted.metadata?.pages) result.pages = extracted.metadata.pages

        return { success: true, data: result }
      },
    })
  }

  // ─── Sheets tools ──────────────────────────

  if (enabledServices.has('sheets') && services.sheets) {
    const sheets = services.sheets

    /** Guard: retorna true si el spreadsheetId está en la lista de IDs protegidos */
    function isProtectedSheet(spreadsheetId: string): boolean {
      const config = registry.getConfig<GoogleApiConfig>('google-apps')
      const ids = config.GOOGLE_SHEETS_PROTECTED_IDS.split(',').map((s) => s.trim()).filter(Boolean)
      return ids.includes(spreadsheetId)
    }

    await toolRegistry.registerTool({
      definition: {
        name: 'sheets-read',
        displayName: 'Leer Google Sheet',
        description: 'Lee datos de un rango en una hoja de cálculo de Google Sheets. Soporta paginación con offset/limit y auto-detecta el primer tab si no se especifica rango.',
        category: 'sheets',
        sourceModule: 'google-apps',
        parameters: {
          type: 'object',
          properties: {
            spreadsheetId: { type: 'string', description: 'ID de la hoja de cálculo' },
            range: { type: 'string', description: 'Rango a leer (ej: Sheet1!A1:D10). Si se omite, se lee el primer tab completo.' },
            offset: { type: 'number', description: 'Fila de inicio para paginación (0-based, default 0). Excluye la fila de header.' },
            limit: { type: 'number', description: 'Máximo de filas de datos a retornar (default 100, max 500).' },
          },
          required: ['spreadsheetId'],
        },
      },
      handler: async (input) => {
        const spreadsheetId = input.spreadsheetId as string
        const offset = Math.max((input.offset as number | undefined) ?? 0, 0)
        const limit = Math.min(Math.max((input.limit as number | undefined) ?? 100, 1), 500)

        // Auto-detect primer tab si no se proporciona range
        let range = input.range as string | undefined
        if (!range) {
          const info = await sheets.getSpreadsheet(spreadsheetId)
          const firstSheet = info.sheets[0]
          const firstTitle = firstSheet?.title ?? 'Sheet1'
          range = `'${firstTitle}'`
        }

        const data = await sheets.readRange(spreadsheetId, range)
        const values = data.values

        // Hoja vacía
        if (values.length === 0) {
          return { success: true, data: { range, message: 'Hoja vacía — sin datos', totalRows: 0 } }
        }

        const header = values[0]!
        const dataRows = values.slice(1)
        const totalDataRows = dataRows.length

        // Paginar
        const pageRows = dataRows.slice(offset, offset + limit)
        const hasMore = (offset + limit) < totalDataRows
        const nextOffset = hasMore ? offset + limit : null

        // Formatear output tabular
        const separator = header.map(() => '────').join('─┼─')
        const headerLine = header.join(' | ')
        const dataLines = pageRows.map((row) => row.join(' | ')).join('\n')
        const rangeLabel = `Rango: ${data.range}`
        const countLabel = `${totalDataRows} filas de datos × ${header.length} columnas`
        const showingLabel = `Mostrando filas ${offset + 1}-${offset + pageRows.length} de ${totalDataRows}`
        const moreHint = hasMore ? `\n\n(${totalDataRows - offset - pageRows.length} filas más — usa offset=${nextOffset} para ver las siguientes)` : ''

        const formatted = `${rangeLabel}\n${countLabel}\n${showingLabel}\n\n${headerLine}\n${separator}\n${dataLines}${moreHint}`

        return {
          success: true,
          data: {
            formatted,
            totalRows: totalDataRows,
            columns: header.length,
            header,
            offset,
            limit,
            hasMore,
            nextOffset,
          },
        }
      },
    })

    await toolRegistry.registerTool({
      definition: {
        name: 'sheets-write',
        displayName: 'Escribir en Google Sheet',
        description: 'Escribe datos en un rango de una hoja de cálculo.',
        category: 'sheets',
        sourceModule: 'google-apps',
        parameters: {
          type: 'object',
          properties: {
            spreadsheetId: { type: 'string', description: 'ID de la hoja de cálculo' },
            range: { type: 'string', description: 'Rango donde escribir (ej: Sheet1!A1)' },
            values: { type: 'array', description: 'Array de arrays con los valores a escribir', items: { type: 'array', description: 'Fila de valores' } },
          },
          required: ['spreadsheetId', 'range', 'values'],
        },
      },
      handler: async (input) => {
        if (isProtectedSheet(input.spreadsheetId as string)) {
          return { success: false, error: 'Este spreadsheet está protegido contra escritura por el administrador.' }
        }
        const result = await sheets.writeRange(
          input.spreadsheetId as string,
          input.range as string,
          input.values as string[][],
        )
        return { success: true, data: result }
      },
    })

    await toolRegistry.registerTool({
      definition: {
        name: 'sheets-append',
        displayName: 'Agregar filas a Google Sheet',
        description: 'Agrega filas al final de una hoja de cálculo. Restaura automáticamente validaciones de datos (dropdowns) en las filas añadidas.',
        category: 'sheets',
        sourceModule: 'google-apps',
        parameters: {
          type: 'object',
          properties: {
            spreadsheetId: { type: 'string', description: 'ID de la hoja de cálculo' },
            range: { type: 'string', description: 'Rango de la hoja (ej: Sheet1!A:D)' },
            values: { type: 'array', description: 'Array de arrays con las filas a agregar', items: { type: 'array', description: 'Fila de valores' } },
          },
          required: ['spreadsheetId', 'range', 'values'],
        },
      },
      handler: async (input) => {
        const spreadsheetId = input.spreadsheetId as string
        const range = input.range as string
        const values = input.values as string[][]

        if (isProtectedSheet(spreadsheetId)) {
          return { success: false, error: 'Este spreadsheet está protegido contra escritura por el administrador.' }
        }

        // Parsear sheetTitle del range (ej: "Sheet1" de "Sheet1!A:D" o "'Mi hoja'!A:D")
        const sheetTitleMatch = /^'?([^'!]+)'?!/.exec(range)
        const sheetTitle = sheetTitleMatch?.[1] ?? range.split('!')[0] ?? 'Sheet1'

        // Obtener info del spreadsheet para sheetId y última fila con datos
        let sheetId: number | undefined
        let lastDataRow = 0
        try {
          const info = await sheets.getSpreadsheet(spreadsheetId)
          const sheetMeta = info.sheets.find((s) => s.title === sheetTitle)
          sheetId = sheetMeta?.sheetId
          // Leer rango para saber cuántas filas hay actualmente (para saber dónde aplicar validaciones)
          const existing = await sheets.readRange(spreadsheetId, range)
          lastDataRow = existing.values.length > 0 ? existing.values.length - 1 : 0 // -1 excluye header
        } catch {
          // Si falla la lectura previa, continuar sin restaurar validaciones
        }

        // Obtener validaciones de la última fila con datos (best-effort)
        let validations: Array<Record<string, unknown> | null> = []
        if (sheetId !== undefined && lastDataRow > 0) {
          try {
            validations = await sheets.getRowValidations(spreadsheetId, sheetTitle, lastDataRow)
          } catch {
            // best-effort
          }
        }

        // Ejecutar el append
        const result = await sheets.appendRows(spreadsheetId, range, values)

        // Restaurar validaciones post-append (best-effort, fire-and-forget)
        if (sheetId !== undefined && validations.some((v) => v !== null)) {
          sheets.applyValidations(spreadsheetId, sheetId, validations, lastDataRow + 1, values.length).catch((err) => {
            logger.warn({ err }, 'sheets-append: failed to restore validations (non-blocking)')
          })
        }

        return { success: true, data: result }
      },
    })

    await toolRegistry.registerTool({
      definition: {
        name: 'sheets-create',
        displayName: 'Crear Google Sheet',
        description: 'Crea una nueva hoja de cálculo en Google Sheets.',
        category: 'sheets',
        sourceModule: 'google-apps',
        parameters: {
          type: 'object',
          properties: {
            title: { type: 'string', description: 'Título de la hoja de cálculo' },
          },
          required: ['title'],
        },
      },
      handler: async (input) => {
        const sheet = await sheets.createSpreadsheet(input.title as string)
        return { success: true, data: sheet }
      },
    })

    await toolRegistry.registerTool({
      definition: {
        name: 'sheets-info',
        displayName: 'Info de Google Sheet',
        description: 'Obtiene información y lista de hojas de una hoja de cálculo.',
        category: 'sheets',
        sourceModule: 'google-apps',
        parameters: {
          type: 'object',
          properties: {
            spreadsheetId: { type: 'string', description: 'ID de la hoja de cálculo' },
          },
          required: ['spreadsheetId'],
        },
      },
      handler: async (input) => {
        const info = await sheets.getSpreadsheet(input.spreadsheetId as string)
        return { success: true, data: info }
      },
    })

    await toolRegistry.registerTool({
      definition: {
        name: 'sheets-find-replace',
        displayName: 'Buscar y reemplazar en Google Sheet',
        description: 'Busca un texto en toda la hoja de cálculo y lo reemplaza. Útil para actualizar valores en masa o aplicar plantillas con {claves}.',
        category: 'sheets',
        sourceModule: 'google-apps',
        parameters: {
          type: 'object',
          properties: {
            spreadsheetId: { type: 'string', description: 'ID de la hoja de cálculo' },
            find: { type: 'string', description: 'Texto a buscar (ej: {nombre})' },
            replacement: { type: 'string', description: 'Texto de reemplazo' },
            matchCase: { type: 'boolean', description: 'Coincidencia exacta de mayúsculas/minúsculas (default: false)' },
            matchEntireCell: { type: 'boolean', description: 'Solo reemplazar si la celda contiene exactamente el texto buscado (default: false)' },
          },
          required: ['spreadsheetId', 'find', 'replacement'],
        },
      },
      handler: async (input) => {
        if (isProtectedSheet(input.spreadsheetId as string)) {
          return { success: false, error: 'Este spreadsheet está protegido contra escritura.' }
        }
        const result = await sheets.findReplace(
          input.spreadsheetId as string,
          input.find as string,
          input.replacement as string,
          {
            matchCase: input.matchCase as boolean | undefined,
            matchEntireCell: input.matchEntireCell as boolean | undefined,
          },
        )
        return { success: true, data: result }
      },
    })

    await toolRegistry.registerTool({
      definition: {
        name: 'sheets-batch-edit',
        displayName: 'Edición batch en Google Sheet',
        description: 'Ejecuta múltiples operaciones (escribir, agregar filas, limpiar rangos, buscar/reemplazar) en una hoja de cálculo en una sola llamada.',
        category: 'sheets',
        sourceModule: 'google-apps',
        parameters: {
          type: 'object',
          properties: {
            spreadsheetId: { type: 'string', description: 'ID de la hoja de cálculo' },
            operations: {
              type: 'array',
              description: 'Array de operaciones. Cada objeto: { type: "write"|"append"|"clear"|"find_replace", range?: string, values?: string[][], find?: string, replacement?: string, matchCase?: boolean }',
              items: { type: 'object', description: 'Operación a ejecutar' },
            },
          },
          required: ['spreadsheetId', 'operations'],
        },
      },
      handler: async (input) => {
        if (isProtectedSheet(input.spreadsheetId as string)) {
          return { success: false, error: 'Este spreadsheet está protegido contra escritura.' }
        }
        const result = await sheets.batchEdit(
          input.spreadsheetId as string,
          input.operations as SheetBatchOperation[],
        )
        return { success: true, data: result }
      },
    })
  }

  // ─── Docs tools ────────────────────────────

  if (enabledServices.has('docs') && services.docs) {
    const docs = services.docs

    await toolRegistry.registerTool({
      definition: {
        name: 'docs-read',
        displayName: 'Leer Google Doc',
        description: 'Lee el contenido de texto de un documento de Google Docs.',
        category: 'docs',
        sourceModule: 'google-apps',
        parameters: {
          type: 'object',
          properties: {
            documentId: { type: 'string', description: 'ID del documento' },
          },
          required: ['documentId'],
        },
      },
      handler: async (input) => {
        const doc = await docs.getDocument(input.documentId as string)

        // Métricas sobre el documento completo
        const wordCount = doc.body.split(/\s+/).filter(Boolean).length
        const charCount = doc.body.length

        // Truncar si excede 30K chars
        const MAX_DOC_CHARS = 30_000
        let body = doc.body
        let truncated = false
        if (body.length > MAX_DOC_CHARS) {
          body = body.slice(0, MAX_DOC_CHARS)
            + `\n\n[... documento truncado: mostrando ${MAX_DOC_CHARS.toLocaleString()} de ${charCount.toLocaleString()} caracteres (${wordCount.toLocaleString()} palabras totales)]`
          truncated = true
        }

        return {
          success: true,
          data: {
            ...doc,
            body,
            wordCount,
            charCount,
            truncated,
          },
        }
      },
    })

    await toolRegistry.registerTool({
      definition: {
        name: 'docs-create',
        displayName: 'Crear Google Doc',
        description: 'Crea un nuevo documento de Google Docs con contenido opcional.',
        category: 'docs',
        sourceModule: 'google-apps',
        parameters: {
          type: 'object',
          properties: {
            title: { type: 'string', description: 'Título del documento' },
            content: { type: 'string', description: 'Contenido inicial (opcional)' },
          },
          required: ['title'],
        },
      },
      handler: async (input) => {
        const doc = await docs.createDocument(input.title as string, input.content as string | undefined)
        return { success: true, data: doc }
      },
    })

    await toolRegistry.registerTool({
      definition: {
        name: 'docs-append',
        displayName: 'Agregar texto a Google Doc',
        description: 'Agrega texto al final de un documento existente.',
        category: 'docs',
        sourceModule: 'google-apps',
        parameters: {
          type: 'object',
          properties: {
            documentId: { type: 'string', description: 'ID del documento' },
            text: { type: 'string', description: 'Texto a agregar' },
          },
          required: ['documentId', 'text'],
        },
      },
      handler: async (input) => {
        await docs.appendText(input.documentId as string, input.text as string)
        return { success: true, data: { appended: true } }
      },
    })

    await toolRegistry.registerTool({
      definition: {
        name: 'docs-replace',
        displayName: 'Reemplazar texto en Google Doc',
        description: 'Busca y reemplaza texto en un documento de Google Docs.',
        category: 'docs',
        sourceModule: 'google-apps',
        parameters: {
          type: 'object',
          properties: {
            documentId: { type: 'string', description: 'ID del documento' },
            searchText: { type: 'string', description: 'Texto a buscar' },
            replaceText: { type: 'string', description: 'Texto de reemplazo' },
          },
          required: ['documentId', 'searchText', 'replaceText'],
        },
      },
      handler: async (input) => {
        const count = await docs.replaceText(
          input.documentId as string,
          input.searchText as string,
          input.replaceText as string,
        )
        return { success: true, data: { occurrencesChanged: count } }
      },
    })

    await toolRegistry.registerTool({
      definition: {
        name: 'docs-batch-edit',
        displayName: 'Edición batch en Google Doc',
        description: 'Ejecuta múltiples operaciones de edición (agregar texto, insertar en posición, buscar/reemplazar) en un documento de Google Docs en una sola llamada. Ideal para aplicar plantillas con múltiples {claves}.',
        category: 'docs',
        sourceModule: 'google-apps',
        parameters: {
          type: 'object',
          properties: {
            documentId: { type: 'string', description: 'ID del documento' },
            operations: {
              type: 'array',
              description: 'Array de operaciones a ejecutar',
              items: {
                type: 'object',
                properties: {
                  type: { type: 'string', enum: ['append', 'insert', 'replace'], description: 'Tipo de operación' },
                  text: { type: 'string', description: 'Texto a insertar/agregar, o texto de reemplazo para replace' },
                  searchText: { type: 'string', description: 'Texto a buscar (solo para replace)' },
                  index: { type: 'number', description: 'Posición de inserción 1-based (solo para insert)' },
                },
                required: ['type', 'text'],
              },
            },
          },
          required: ['documentId', 'operations'],
        },
      },
      handler: async (input) => {
        const result = await docs.batchEdit(
          input.documentId as string,
          input.operations as DocEditOperation[],
        )
        return { success: true, data: result }
      },
    })
  }

  // ─── Slides tools ──────────────────────────

  if (enabledServices.has('slides') && services.slides) {
    const slides = services.slides

    await toolRegistry.registerTool({
      definition: {
        name: 'slides-read',
        displayName: 'Leer Google Slides',
        description: 'Lee el contenido de texto de una presentación de Google Slides.',
        category: 'slides',
        sourceModule: 'google-apps',
        parameters: {
          type: 'object',
          properties: {
            presentationId: { type: 'string', description: 'ID de la presentación' },
            slideIndex: { type: 'number', description: 'Índice de slide específico (opcional, 0-based)' },
          },
          required: ['presentationId'],
        },
      },
      handler: async (input) => {
        const text = await slides.getSlideText(
          input.presentationId as string,
          input.slideIndex as number | undefined,
        )
        return { success: true, data: { text } }
      },
    })

    await toolRegistry.registerTool({
      definition: {
        name: 'slides-info',
        displayName: 'Info de Google Slides',
        description: 'Obtiene información de una presentación (título, cantidad de slides).',
        category: 'slides',
        sourceModule: 'google-apps',
        parameters: {
          type: 'object',
          properties: {
            presentationId: { type: 'string', description: 'ID de la presentación' },
          },
          required: ['presentationId'],
        },
      },
      handler: async (input) => {
        const info = await slides.getPresentation(input.presentationId as string)
        return { success: true, data: info }
      },
    })

    await toolRegistry.registerTool({
      definition: {
        name: 'slides-create',
        displayName: 'Crear Google Slides',
        description: 'Crea una nueva presentación de Google Slides.',
        category: 'slides',
        sourceModule: 'google-apps',
        parameters: {
          type: 'object',
          properties: {
            title: { type: 'string', description: 'Título de la presentación' },
          },
          required: ['title'],
        },
      },
      handler: async (input) => {
        const presentation = await slides.createPresentation(input.title as string)
        return { success: true, data: presentation }
      },
    })

    await toolRegistry.registerTool({
      definition: {
        name: 'slides-replace-text',
        displayName: 'Reemplazar texto en Slides',
        description: 'Busca y reemplaza texto en toda la presentación.',
        category: 'slides',
        sourceModule: 'google-apps',
        parameters: {
          type: 'object',
          properties: {
            presentationId: { type: 'string', description: 'ID de la presentación' },
            searchText: { type: 'string', description: 'Texto a buscar' },
            replaceText: { type: 'string', description: 'Texto de reemplazo' },
          },
          required: ['presentationId', 'searchText', 'replaceText'],
        },
      },
      handler: async (input) => {
        const count = await slides.replaceText(
          input.presentationId as string,
          input.searchText as string,
          input.replaceText as string,
        )
        return { success: true, data: { occurrencesChanged: count } }
      },
    })
  }

  // ─── Calendar tools ────────────────────────

  if (enabledServices.has('calendar') && services.calendar) {
    const cal = services.calendar

    await toolRegistry.registerTool({
      definition: {
        name: 'calendar-list-events',
        displayName: 'Listar eventos del calendario',
        description: 'Lista eventos del calendario de Google en un rango de fechas. Puede buscar por texto.',
        category: 'calendar',
        sourceModule: 'google-apps',
        parameters: {
          type: 'object',
          properties: {
            calendarId: { type: 'string', description: 'ID del calendario (default: primary)' },
            timeMin: { type: 'string', description: 'Fecha inicio ISO (ej: 2026-03-18T00:00:00Z)' },
            timeMax: { type: 'string', description: 'Fecha fin ISO' },
            query: { type: 'string', description: 'Texto a buscar en eventos' },
            maxResults: { type: 'number', description: 'Máximo de resultados (default: 20)' },
          },
        },
      },
      handler: async (input) => {
        const result = await cal.listEvents({
          calendarId: input.calendarId as string | undefined,
          timeMin: input.timeMin as string | undefined,
          timeMax: input.timeMax as string | undefined,
          query: input.query as string | undefined,
          maxResults: input.maxResults as number | undefined,
        })
        return { success: true, data: formatEventsListForAgent(result.events) }
      },
    })

    await toolRegistry.registerTool({
      definition: {
        name: 'calendar-create-event',
        displayName: 'Crear evento en calendario',
        description: 'Crea un nuevo evento en Google Calendar. Incluye Google Meet automáticamente, valida horario laboral y revisa conflictos.',
        category: 'calendar',
        sourceModule: 'google-apps',
        parameters: {
          type: 'object',
          properties: {
            summary: { type: 'string', description: 'Título del evento' },
            description: { type: 'string', description: 'Descripción del evento' },
            location: { type: 'string', description: 'Ubicación del evento' },
            startDateTime: { type: 'string', description: 'Fecha y hora de inicio ISO (ej: 2026-03-20T10:00:00-06:00)' },
            endDateTime: { type: 'string', description: 'Fecha y hora de fin ISO' },
            startDate: { type: 'string', description: 'Fecha de inicio para eventos de día completo (ej: 2026-03-20)' },
            endDate: { type: 'string', description: 'Fecha de fin para eventos de día completo' },
            timeZone: { type: 'string', description: 'Zona horaria (ej: America/Mexico_City)' },
            attendees: { type: 'array', description: 'Lista de emails de invitados', items: { type: 'string', description: 'Email del invitado' } },
            calendarId: { type: 'string', description: 'ID del calendario (default: primary)' },
            durationMinutes: { type: 'number', description: 'Duración en minutos (default: según config)' },
            force: { type: 'boolean', description: 'Forzar creación aunque haya conflictos (default: false)' },
            addMeet: { type: 'boolean', description: 'Incluir link de Google Meet (default: según config)' },
          },
          required: ['summary'],
        },
      },
      handler: async (input, context) => {
        const calConfig = getCalendarConfig(registry)
        const bh = getBusinessHours(registry)

        const startDateTime = input.startDateTime as string | undefined
        const endDateTime = input.endDateTime as string | undefined
        const timezone = (input.timeZone as string | undefined) ?? 'UTC'

        // Validar business hours si hay startDateTime y business hours configurado
        if (startDateTime && bh && !(input.force as boolean | undefined)) {
          const validation = validateEventTiming(
            startDateTime,
            endDateTime,
            { start: bh.start, end: bh.end, days: bh.days },
            bh.days,
            calConfig.daysOff,
            timezone,
          )
          if (!validation.valid) {
            const errorMsg = validation.errors.join('. ')
            const suggestion = validation.suggestion ? ` Próximo slot disponible: ${validation.suggestion}` : ''
            return { success: false, error: `${errorMsg}.${suggestion}` }
          }
        }

        const start: Record<string, string> = {}
        const end: Record<string, string> = {}

        if (startDateTime) {
          start.dateTime = startDateTime
          if (timezone) start.timeZone = timezone
        } else if (input.startDate) {
          start.date = input.startDate as string
        }

        if (endDateTime) {
          end.dateTime = endDateTime
          if (timezone) end.timeZone = timezone
        } else if (input.endDate) {
          end.date = input.endDate as string
        } else if (startDateTime) {
          // Calcular end desde defaultDurationMinutes
          const durationMs = ((input.durationMinutes as number | undefined) ?? calConfig.defaultDurationMinutes) * 60000
          const endDate = new Date(new Date(startDateTime).getTime() + durationMs)
          end.dateTime = endDate.toISOString()
          if (timezone) end.timeZone = timezone
        }

        const attendees = input.attendees
          ? (input.attendees as string[]).map((email) => ({ email }))
          : undefined

        const result = await cal.createEvent({
          calendarId: input.calendarId as string | undefined,
          summary: input.summary as string,
          description: input.description as string | undefined,
          location: input.location as string | undefined,
          start,
          end,
          attendees,
          reminders: { useDefault: false, overrides: calConfig.defaultReminders },
          addMeet: (input.addMeet as boolean | undefined) ?? calConfig.meetEnabled,
          force: input.force as boolean | undefined,
        })

        if (!result.created) {
          return {
            success: false,
            error: result.warning ?? 'No se pudo crear el evento',
            conflicts: result.conflicts,
          }
        }

        // Emitir hook para follow-ups (Plan 4) — solo si hay contacto y canal disponibles
        if (context?.contactId && context?.channelName) {
          await registry.runHook('calendar:event-created', {
            event: result.event as Record<string, unknown> | undefined,
            meetLink: result.meetLink ?? undefined,
            contactId: context.contactId,
            channel: context.channelName,
          })
        }

        const formatted = formatSingleEventForAgent(result.event!, timezone)
        const meetLine = result.meetLink ? `\n🎥 Meet: ${result.meetLink}` : ''
        return { success: true, data: `${formatted}${meetLine}` }
      },
    })

    await toolRegistry.registerTool({
      definition: {
        name: 'calendar-get-event',
        displayName: 'Obtener detalle de evento',
        description: 'Obtiene los detalles completos de un evento de Google Calendar por su ID.',
        category: 'calendar',
        sourceModule: 'google-apps',
        parameters: {
          type: 'object',
          properties: {
            eventId: { type: 'string', description: 'ID del evento [REQUIRED]' },
            calendarId: { type: 'string', description: 'ID del calendario (default: primary)' },
          },
          required: ['eventId'],
        },
      },
      handler: async (input) => {
        const event = await cal.getEvent(
          input.eventId as string,
          input.calendarId as string | undefined,
        )
        return { success: true, data: formatSingleEventForAgent(event) }
      },
    })

    await toolRegistry.registerTool({
      definition: {
        name: 'calendar-delete-event',
        displayName: 'Cancelar/eliminar evento',
        description: 'Cancela y elimina un evento de Google Calendar. Notifica a todos los asistentes.',
        category: 'calendar',
        sourceModule: 'google-apps',
        parameters: {
          type: 'object',
          properties: {
            eventId: { type: 'string', description: 'ID del evento a cancelar [REQUIRED]' },
            calendarId: { type: 'string', description: 'ID del calendario (default: primary)' },
            notifyAttendees: { type: 'boolean', description: 'Notificar a asistentes (default: true)' },
          },
          required: ['eventId'],
        },
      },
      handler: async (input) => {
        const sendUpdates = (input.notifyAttendees as boolean | undefined) !== false ? 'all' : 'none'
        await cal.deleteEvent(
          input.eventId as string,
          input.calendarId as string | undefined,
          sendUpdates,
        )
        // Emitir hook para que Plan 4 cancele follow-ups
        await registry.runHook('calendar:event-deleted', { eventId: input.eventId as string })
        return { success: true, data: 'Evento cancelado exitosamente. Los asistentes fueron notificados.' }
      },
    })

    await toolRegistry.registerTool({
      definition: {
        name: 'calendar-update-event',
        displayName: 'Actualizar evento del calendario',
        description: 'Actualiza un evento existente en Google Calendar. Valida horario laboral si se cambia la fecha.',
        category: 'calendar',
        sourceModule: 'google-apps',
        parameters: {
          type: 'object',
          properties: {
            eventId: { type: 'string', description: 'ID del evento a actualizar' },
            summary: { type: 'string', description: 'Nuevo título' },
            description: { type: 'string', description: 'Nueva descripción' },
            location: { type: 'string', description: 'Nueva ubicación' },
            startDateTime: { type: 'string', description: 'Nueva fecha inicio ISO' },
            endDateTime: { type: 'string', description: 'Nueva fecha fin ISO' },
            timeZone: { type: 'string', description: 'Zona horaria' },
            calendarId: { type: 'string', description: 'ID del calendario (default: primary)' },
          },
          required: ['eventId'],
        },
      },
      handler: async (input) => {
        const startDateTime = input.startDateTime as string | undefined
        const endDateTime = input.endDateTime as string | undefined
        const timezone = (input.timeZone as string | undefined) ?? 'UTC'
        const dateChanged = !!(startDateTime ?? endDateTime)

        // Validar business hours si se cambia la fecha
        if (dateChanged && startDateTime) {
          const calConfig = getCalendarConfig(registry)
          const bh = getBusinessHours(registry)
          if (bh) {
            const validation = validateEventTiming(
              startDateTime,
              endDateTime,
              { start: bh.start, end: bh.end, days: bh.days },
              bh.days,
              calConfig.daysOff,
              timezone,
            )
            if (!validation.valid) {
              const errorMsg = validation.errors.join('. ')
              const suggestion = validation.suggestion ? ` Próximo slot: ${validation.suggestion}` : ''
              return { success: false, error: `${errorMsg}.${suggestion}` }
            }
          }
        }

        const opts: Record<string, unknown> = {
          eventId: input.eventId as string,
          calendarId: input.calendarId as string | undefined,
        }
        if (input.summary) opts.summary = input.summary
        if (input.description) opts.description = input.description
        if (input.location) opts.location = input.location
        if (startDateTime) {
          opts.start = { dateTime: startDateTime, timeZone: timezone }
        }
        if (endDateTime) {
          opts.end = { dateTime: endDateTime, timeZone: timezone }
        }

        const event = await cal.updateEvent(opts as unknown as CalendarEventUpdateOptions)

        // Emitir hook
        await registry.runHook('calendar:event-updated', {
          eventId: input.eventId as string,
          event: event as unknown as Record<string, unknown>,
          dateChanged,
        })

        return { success: true, data: formatSingleEventForAgent(event, timezone) }
      },
    })

    await toolRegistry.registerTool({
      definition: {
        name: 'calendar-add-attendees',
        displayName: 'Agregar invitados a evento',
        description: 'Agrega invitados a un evento existente en Google Calendar.',
        category: 'calendar',
        sourceModule: 'google-apps',
        parameters: {
          type: 'object',
          properties: {
            eventId: { type: 'string', description: 'ID del evento' },
            attendees: { type: 'array', description: 'Lista de emails a invitar', items: { type: 'string', description: 'Email del invitado' } },
            calendarId: { type: 'string', description: 'ID del calendario (default: primary)' },
          },
          required: ['eventId', 'attendees'],
        },
      },
      handler: async (input) => {
        const attendees = (input.attendees as string[]).map((email) => ({ email }))
        const event = await cal.addAttendees(
          input.eventId as string,
          attendees,
          input.calendarId as string | undefined,
        )
        const attendeeList = (event.attendees ?? [])
          .map((a) => `${a.displayName ?? a.email} (${a.responseStatus ?? 'pendiente'})`)
          .join(', ')
        return { success: true, data: `Invitados actualizados en "${event.summary}". Asistentes: ${attendeeList || 'ninguno'}` }
      },
    })

    await toolRegistry.registerTool({
      definition: {
        name: 'calendar-list-calendars',
        displayName: 'Listar calendarios',
        description: 'Lista todos los calendarios disponibles (propios y compartidos).',
        category: 'calendar',
        sourceModule: 'google-apps',
        parameters: { type: 'object', properties: {} },
      },
      handler: async () => {
        const calendars = await cal.listCalendars()
        const lines = calendars.map((c) => {
          const primary = c.primary ? ' [principal]' : ''
          return `${c.summary}${primary} (ID: ${c.id})`
        })
        return { success: true, data: lines.length > 0 ? lines.join('\n') : 'No hay calendarios disponibles.' }
      },
    })

    await toolRegistry.registerTool({
      definition: {
        name: 'calendar-check-availability',
        displayName: 'Verificar disponibilidad',
        description: 'Verifica slots libres para una fecha. Consulta los calendarios de las personas indicadas y muestra horarios disponibles.',
        category: 'calendar',
        sourceModule: 'google-apps',
        parameters: {
          type: 'object',
          properties: {
            date: { type: 'string', description: 'Fecha a consultar YYYY-MM-DD [REQUIRED]' },
            durationMinutes: { type: 'number', description: 'Duración mínima del slot en minutos (default: según config)' },
            emails: { type: 'array', description: 'Emails de personas a verificar', items: { type: 'string', description: 'Email' } },
            timeMin: { type: 'string', description: 'Fecha inicio ISO (legacy, usar date en su lugar)' },
            timeMax: { type: 'string', description: 'Fecha fin ISO (legacy)' },
          },
          required: ['date'],
        },
      },
      handler: async (input) => {
        const calConfig = getCalendarConfig(registry)
        const bh = getBusinessHours(registry)
        const date = input.date as string
        const durationMinutes = (input.durationMinutes as number | undefined) ?? calConfig.defaultDurationMinutes
        const emails = (input.emails as string[] | undefined) ?? []

        // Validar que la fecha no sea día off
        if (bh && bh.days.length > 0) {
          const check = isBusinessDay(date, bh.days, calConfig.daysOff)
          if (!check.valid) {
            return { success: false, error: check.reason ?? `${date} no es día laboral` }
          }
        }

        const result = await cal.checkAvailability({ emails, date, durationMinutes })
        return { success: true, data: formatAvailabilityForAgent(result) }
      },
    })

    await toolRegistry.registerTool({
      definition: {
        name: 'calendar-get-scheduling-context',
        displayName: 'Obtener contexto de agendamiento',
        description: 'Obtiene la configuración completa de agendamiento: roles habilitados, coworkers disponibles con instrucciones, días off, horario laboral, y configuración general. Llamar SIEMPRE como primera acción.',
        category: 'calendar',
        sourceModule: 'google-apps',
        parameters: { type: 'object', properties: {} },
      },
      handler: async () => {
        const calConfig = getCalendarConfig(registry)
        const bh = getBusinessHours(registry)
        const usersDb = registry.getOptional<{
          listByType(t: string, active: boolean): Promise<Array<{
            id: string
            displayName?: string
            contacts?: Array<{ channel: string; senderId: string }>
            metadata?: unknown
          }>>
        }>('users:db')

        // Obtener coworkers habilitados agrupados por rol
        const allCoworkers = await usersDb?.listByType?.('coworker', true) ?? []
        const enabledRoles: Array<{
          role: string
          instructions: string
          coworkers: Array<{ name: string; email: string; instructions: string }>
        }> = []

        for (const [roleName, roleConfig] of Object.entries(calConfig.schedulingRoles)) {
          if (!roleConfig.enabled) continue

          const roleCoworkers = allCoworkers
            .filter((u) => (u.metadata as Record<string, unknown>)?.role === roleName)
            .filter((u) => {
              const cwConfig = calConfig.schedulingCoworkers[u.id]
              return cwConfig ? cwConfig.enabled !== false : true
            })
            .map((u) => {
              const email = u.contacts?.find((c) => c.channel === 'email')?.senderId ?? ''
              const cwConfig = calConfig.schedulingCoworkers[u.id]
              return {
                name: u.displayName ?? u.id,
                email,
                instructions: cwConfig?.instructions ?? '',
              }
            })

          enabledRoles.push({
            role: roleName,
            instructions: roleConfig.instructions,
            coworkers: roleCoworkers,
          })
        }

        // Formatear output legible
        let output = `## Configuración de agendamiento\n`
        output += `- Google Meet: ${calConfig.meetEnabled ? 'habilitado' : 'deshabilitado'}\n`
        output += `- Duración default: ${calConfig.defaultDurationMinutes} min\n`
        output += `- Nombre de cita: "${calConfig.eventNamePrefix} - [nombre cliente] [empresa]"\n`
        if (calConfig.descriptionInstructions) {
          output += `- Instrucciones para descripción: ${calConfig.descriptionInstructions}\n`
        }

        if (bh) {
          const dayNames = ['', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom']
          const days = bh.days.map((d) => dayNames[d] ?? String(d)).join(', ')
          output += `\n## Horario laboral\n`
          output += `- Horas: ${bh.start}:00 a ${bh.end}:00\n`
          output += `- Días: ${days}\n`
        }

        if (calConfig.daysOff.length > 0) {
          output += `\n## Días no laborables\n`
          for (const d of calConfig.daysOff) {
            if (d.type === 'single') output += `- ${d.date}\n`
            else output += `- ${d.start} al ${d.end}\n`
          }
        }

        if (enabledRoles.length > 0) {
          output += `\n## Roles habilitados para agendamiento\n`
          for (const role of enabledRoles) {
            output += `\n### Rol: ${role.role}\n`
            if (role.instructions) output += `Instrucciones: ${role.instructions}\n`
            output += `Coworkers:\n`
            if (role.coworkers.length === 0) {
              output += `  (ninguno asignado a este rol)\n`
            }
            for (const cw of role.coworkers) {
              output += `  - ${cw.name} (${cw.email})`
              if (cw.instructions) output += ` — INSTRUCCIÓN: ${cw.instructions}`
              output += `\n`
            }
          }
        } else {
          output += `\n## Equipo\nNo hay roles habilitados para agendamiento.\n`
        }

        return { success: true, data: output }
      },
    })
  }

  logger.info(
    { services: [...enabledServices] },
    'Google tools registered',
  )
}

// ─── Persistence helper ──────────────────────

/**
 * Persist drive-read-file extraction to attachment_extractions.
 * Updates existing drive_reference row if present, otherwise inserts new.
 */
async function persistDriveReadResult(
  registry: Registry,
  fileId: string,
  fileName: string,
  mimeType: string,
  extractedText: string | null,
  llmText: string | null,
  sessionId?: string,
): Promise<void> {
  const db = registry.getDb()
  const tokenEstimate = extractedText ? Math.ceil(extractedText.length / 4) : 0

  // Try to update existing drive_reference row (created by URL extractor in intake)
  const updated = await db.query(
    `UPDATE attachment_extractions
     SET extracted_text = $1, llm_text = $2, token_estimate = $3, status = 'processed'
     WHERE source_type = 'drive_reference' AND metadata->>'fileId' = $4
       AND status != 'processed'
     RETURNING id`,
    [extractedText, llmText, tokenEstimate, fileId],
  )

  if (updated.rows.length > 0) {
    logger.info({ fileId, rowId: updated.rows[0]!.id }, 'drive-read-file result persisted (updated existing row)')
    return
  }

  // No existing row — insert new one (tool called directly by agent, not from a URL)
  await db.query(
    `INSERT INTO attachment_extractions
      (id, session_id, filename, mime_type, category, category_label, source_type,
       extracted_text, llm_text, token_estimate, status, metadata)
     VALUES (gen_random_uuid(), $7, $1, $2, 'documents', 'documents', 'drive_read',
       $3, $4, $5, 'processed', $6)`,
    [fileName, mimeType, extractedText, llmText, tokenEstimate, JSON.stringify({ fileId }), sessionId ?? null],
  )

  logger.info({ fileId, fileName }, 'drive-read-file result persisted (new row)')
}
