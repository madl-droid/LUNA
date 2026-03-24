// LUNA — Module: google-apps — Tool Registration
// Registra herramientas de Drive, Sheets, Docs, Slides, Calendar en el sistema de tools.

import type { Registry } from '../../kernel/registry.js'
import type { ToolRegistry } from '../tools/tool-registry.js'
import type { DriveService } from './drive-service.js'
import type { SheetsService } from './sheets-service.js'
import type { DocsService } from './docs-service.js'
import type { SlidesService } from './slides-service.js'
import type { CalendarService } from './calendar-service.js'
import type { GoogleServiceName, CalendarEventUpdateOptions } from './types.js'
import pino from 'pino'

const logger = pino({ name: 'google-apps:tools' })

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
): Promise<void> {
  const toolRegistry = registry.getOptional<ToolRegistry>('tools:registry')
  if (!toolRegistry) {
    logger.warn('Tools module not available — skipping tool registration')
    return
  }

  // ─── Drive tools ───────────────────────────

  if (enabledServices.has('drive') && services.drive) {
    const drive = services.drive

    await toolRegistry.registerTool({
      definition: {
        name: 'drive-list-files',
        displayName: 'Listar archivos en Drive',
        description: 'Lista archivos y carpetas en Google Drive del agente. Puede buscar por nombre, carpeta o tipo.',
        category: 'drive',
        sourceModule: 'google-apps',
        parameters: {
          type: 'object',
          properties: {
            query: { type: 'string', description: 'Texto a buscar en nombres de archivo' },
            folderId: { type: 'string', description: 'ID de carpeta específica para listar contenido' },
            mimeType: { type: 'string', description: 'Filtrar por tipo MIME (ej: application/vnd.google-apps.spreadsheet)' },
            sharedWithMe: { type: 'boolean', description: 'Mostrar archivos compartidos conmigo' },
            pageSize: { type: 'number', description: 'Cantidad de resultados (default: 20)' },
          },
        },
      },
      handler: async (input) => {
        const result = await drive.listFiles({
          query: input.query as string | undefined,
          folderId: input.folderId as string | undefined,
          mimeType: input.mimeType as string | undefined,
          includeSharedWithMe: input.sharedWithMe as boolean | undefined,
          pageSize: input.pageSize as number | undefined,
        })
        return { success: true, data: result }
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
  }

  // ─── Sheets tools ──────────────────────────

  if (enabledServices.has('sheets') && services.sheets) {
    const sheets = services.sheets

    await toolRegistry.registerTool({
      definition: {
        name: 'sheets-read',
        displayName: 'Leer Google Sheet',
        description: 'Lee datos de un rango en una hoja de cálculo de Google Sheets.',
        category: 'sheets',
        sourceModule: 'google-apps',
        parameters: {
          type: 'object',
          properties: {
            spreadsheetId: { type: 'string', description: 'ID de la hoja de cálculo' },
            range: { type: 'string', description: 'Rango a leer (ej: Sheet1!A1:D10)' },
          },
          required: ['spreadsheetId', 'range'],
        },
      },
      handler: async (input) => {
        const data = await sheets.readRange(input.spreadsheetId as string, input.range as string)
        return { success: true, data }
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
        description: 'Agrega filas al final de una hoja de cálculo.',
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
        const result = await sheets.appendRows(
          input.spreadsheetId as string,
          input.range as string,
          input.values as string[][],
        )
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
        return { success: true, data: doc }
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
        return { success: true, data: result }
      },
    })

    await toolRegistry.registerTool({
      definition: {
        name: 'calendar-create-event',
        displayName: 'Crear evento en calendario',
        description: 'Crea un nuevo evento en Google Calendar. Puede incluir invitados, ubicación y recordatorios.',
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
          },
          required: ['summary'],
        },
      },
      handler: async (input) => {
        const start: Record<string, string> = {}
        const end: Record<string, string> = {}

        if (input.startDateTime) {
          start.dateTime = input.startDateTime as string
          if (input.timeZone) start.timeZone = input.timeZone as string
        } else if (input.startDate) {
          start.date = input.startDate as string
        }

        if (input.endDateTime) {
          end.dateTime = input.endDateTime as string
          if (input.timeZone) end.timeZone = input.timeZone as string
        } else if (input.endDate) {
          end.date = input.endDate as string
        }

        const attendees = input.attendees
          ? (input.attendees as string[]).map((email) => ({ email }))
          : undefined

        const event = await cal.createEvent({
          calendarId: input.calendarId as string | undefined,
          summary: input.summary as string,
          description: input.description as string | undefined,
          location: input.location as string | undefined,
          start,
          end,
          attendees,
        })
        return { success: true, data: event }
      },
    })

    await toolRegistry.registerTool({
      definition: {
        name: 'calendar-update-event',
        displayName: 'Actualizar evento del calendario',
        description: 'Actualiza un evento existente en Google Calendar.',
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
        const opts: Record<string, unknown> = {
          eventId: input.eventId as string,
          calendarId: input.calendarId as string | undefined,
        }
        if (input.summary) opts.summary = input.summary
        if (input.description) opts.description = input.description
        if (input.location) opts.location = input.location
        if (input.startDateTime) {
          opts.start = { dateTime: input.startDateTime as string, timeZone: input.timeZone as string | undefined }
        }
        if (input.endDateTime) {
          opts.end = { dateTime: input.endDateTime as string, timeZone: input.timeZone as string | undefined }
        }

        const event = await cal.updateEvent(opts as unknown as CalendarEventUpdateOptions)
        return { success: true, data: event }
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
        return { success: true, data: event }
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
        return { success: true, data: calendars }
      },
    })

    await toolRegistry.registerTool({
      definition: {
        name: 'calendar-check-availability',
        displayName: 'Verificar disponibilidad',
        description: 'Verifica horarios ocupados/libres en calendarios para un rango de fechas.',
        category: 'calendar',
        sourceModule: 'google-apps',
        parameters: {
          type: 'object',
          properties: {
            timeMin: { type: 'string', description: 'Fecha inicio ISO' },
            timeMax: { type: 'string', description: 'Fecha fin ISO' },
            calendarIds: { type: 'array', description: 'IDs de calendarios a verificar', items: { type: 'string', description: 'ID de calendario' } },
          },
          required: ['timeMin', 'timeMax'],
        },
      },
      handler: async (input) => {
        const result = await cal.findFreeSlots(
          input.timeMin as string,
          input.timeMax as string,
          input.calendarIds as string[] | undefined,
        )
        return { success: true, data: result }
      },
    })
  }

  logger.info(
    { services: [...enabledServices] },
    'Google tools registered',
  )
}
