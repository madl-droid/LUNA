// LUNA — Global Extractors — Google Drive
// Extrae metadata y contenido de archivos de Google Drive via API.
// A diferencia de otros extractores, no recibe un Buffer sino una URL.
// Código extraction: metadata via getFile(). LLM enrichment: lee contenido via API nativa.

import pino from 'pino'
import type { Registry } from '../kernel/registry.js'
import type { DriveResult, DriveFileEntry } from './types.js'
import { validateInjection } from '../engine/attachments/injection-validator.js'

const logger = pino({ name: 'extractors:drive' })

/** DriveService interface (from google-apps module) */
interface DriveService {
  getFile(fileId: string): Promise<{
    id: string
    name: string
    mimeType: string
    modifiedTime?: string
  }>
  listFiles(options?: { folderId?: string; pageSize?: number; orderBy?: string }): Promise<{
    files: Array<{ id: string; name: string; mimeType: string; webViewLink?: string }>
    nextPageToken?: string
  }>
}

/** OAuthManager interface (from google-apps module) */
interface OAuthManager {
  getState(): { email: string | null; status: string }
  isConnected(): boolean
}

/** Google Docs service */
interface DocsService {
  getDocument(documentId: string): Promise<{ body: string; title: string }>
}

/** Google Sheets service */
interface SheetsService {
  readRange(spreadsheetId: string, range: string): Promise<{ values: string[][] }>
  getSpreadsheet(spreadsheetId: string): Promise<{ title: string; sheets: Array<{ title: string }> }>
}

/** Google Slides service */
interface SlidesService {
  getSlideText(presentationId: string): Promise<string>
}

// Google Drive mimeType → driveType + suggestedTool mapping
// Google-native types use their specific read tools.
// Office and binary types use drive-read-file (lazy download + extract).
const DRIVE_MIME_MAP: Record<string, { driveType: DriveResult['driveType']; suggestedTool: string }> = {
  // Google-native
  'application/vnd.google-apps.document': { driveType: 'document', suggestedTool: 'docs-read' },
  'application/vnd.google-apps.spreadsheet': { driveType: 'spreadsheet', suggestedTool: 'sheets-read' },
  'application/vnd.google-apps.presentation': { driveType: 'presentation', suggestedTool: 'slides-read' },
  'application/vnd.google-apps.folder': { driveType: 'folder', suggestedTool: 'drive-list-files' },
  // Office — exported via files.export() then extracted
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': { driveType: 'file', suggestedTool: 'drive-read-file' },
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': { driveType: 'file', suggestedTool: 'drive-read-file' },
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': { driveType: 'file', suggestedTool: 'drive-read-file' },
  'application/msword': { driveType: 'file', suggestedTool: 'drive-read-file' },
  'application/vnd.ms-excel': { driveType: 'file', suggestedTool: 'drive-read-file' },
  'application/vnd.ms-powerpoint': { driveType: 'file', suggestedTool: 'drive-read-file' },
  // Binary — downloaded via files.get({alt:'media'}) then extracted
  'application/pdf': { driveType: 'file', suggestedTool: 'drive-read-file' },
}

/**
 * Detect if a URL is a Google Drive/Docs/Sheets/Slides/Folder URL.
 */
export function isDriveUrl(url: string): boolean {
  return /^https?:\/\/(docs|drive)\.google\.com\//.test(url)
}

/**
 * Extract the file/folder ID from a Google Drive URL.
 */
export function extractDriveFileId(url: string): string | null {
  // docs.google.com/document/d/{ID}/, spreadsheets/d/{ID}/, presentation/d/{ID}/
  const docsMatch = url.match(/docs\.google\.com\/(document|spreadsheets|presentation)\/d\/([a-zA-Z0-9_-]+)/)
  if (docsMatch?.[2]) return docsMatch[2]

  // drive.google.com/file/d/{ID}/
  const fileMatch = url.match(/drive\.google\.com\/file\/d\/([a-zA-Z0-9_-]+)/)
  if (fileMatch?.[1]) return fileMatch[1]

  // drive.google.com/drive/folders/{ID}
  const folderMatch = url.match(/drive\.google\.com\/drive\/(?:u\/\d+\/)?folders\/([a-zA-Z0-9_-]+)/)
  if (folderMatch?.[1]) return folderMatch[1]

  // drive.google.com/open?id={ID}
  const openMatch = url.match(/drive\.google\.com\/open\?id=([a-zA-Z0-9_-]+)/)
  if (openMatch?.[1]) return openMatch[1]

  return null
}

/**
 * Resolve drive type and suggested tool from mimeType.
 */
function resolveDriveType(mimeType: string): { driveType: DriveResult['driveType']; suggestedTool: string } {
  return DRIVE_MIME_MAP[mimeType] ?? { driveType: 'file', suggestedTool: 'drive-read-file' }
}

/**
 * Get the connected Google account email.
 */
function getAccountEmail(registry: Registry): string | null {
  try {
    const oauthManager = registry.getOptional<OAuthManager>('google:oauth-manager')
    if (oauthManager?.isConnected()) {
      return oauthManager.getState().email
    }
  } catch { /* non-critical */ }
  return null
}

/**
 * Extract metadata from a Google Drive URL (code extraction step).
 * Returns DriveResult with metadata only — no content yet.
 * Content is read lazily via enrichDriveContent() when the agent decides to read.
 */
export async function extractDrive(url: string, registry: Registry): Promise<DriveResult> {
  const fileId = extractDriveFileId(url)
  if (!fileId) {
    return buildNoAccessResult(url, null, 'Could not extract file ID from URL')
  }

  const driveService = registry.getOptional<DriveService>('google:drive')
  if (!driveService) {
    logger.debug({ url }, 'Drive URL detected but google:drive service not available')
    return buildNoAccessResult(url, null, 'Google Drive service not available')
  }

  const accountEmail = getAccountEmail(registry)

  try {
    const file = await driveService.getFile(fileId)
    const { driveType, suggestedTool } = resolveDriveType(file.mimeType)

    logger.info({ fileId, name: file.name, mimeType: file.mimeType, driveType }, 'Drive URL resolved')

    // If folder, list contents with folder-first ordering
    let folderContents: DriveFileEntry[] | undefined
    let folderTreeText: string | undefined
    let hasMoreFiles = false
    if (driveType === 'folder') {
      try {
        const listing = await driveService.listFiles({
          folderId: fileId,
          pageSize: 50,
          orderBy: 'folder,name',
        })
        // Sort: folders first, then files, both alphabetical
        const sorted = [...listing.files].sort((a, b) => {
          const aIsFolder = a.mimeType === 'application/vnd.google-apps.folder'
          const bIsFolder = b.mimeType === 'application/vnd.google-apps.folder'
          if (aIsFolder !== bIsFolder) return aIsFolder ? -1 : 1
          return a.name.localeCompare(b.name)
        })
        folderContents = sorted.map(f => ({
          id: f.id,
          name: f.name,
          mimeType: f.mimeType,
          webViewLink: f.webViewLink,
          ...resolveDriveType(f.mimeType),
        }))
        hasMoreFiles = !!listing.nextPageToken

        // Build text tree for agent readability (WP8)
        const lines = folderContents.map(f => {
          const icon = f.isFolder ? '📁' : fileIcon(f.mimeType)
          const action = f.isFolder
            ? `drive-list-files(folderId: "${f.id}")`
            : `${f.suggestedTool}(${f.id})`
          return `${icon} ${f.name} → ${action}`
        })
        if (hasMoreFiles) lines.push('... (hay más archivos — usa pageToken para ver el resto)')
        folderTreeText = lines.join('\n')
      } catch (listErr) {
        logger.warn({ listErr, fileId }, 'Failed to list folder contents')
        folderContents = []
      }
    }

    return {
      kind: 'drive',
      url,
      fileId: file.id,
      name: file.name,
      mimeType: file.mimeType,
      driveType,
      suggestedTool,
      hasAccess: true,
      accountEmail,
      folderContents,
      modifiedTime: file.modifiedTime,
      extractedContent: folderTreeText ?? null,
      llmEnrichment: undefined,
      metadata: {
        originalName: file.name,
        driveModifiedTime: file.modifiedTime,
        extractorUsed: 'drive',
        hasMoreFiles: hasMoreFiles || undefined,
      },
    }
  } catch (err: unknown) {
    const code = (err as { code?: number })?.code
    if (code === 403 || code === 404) {
      logger.info({ fileId, url, accountEmail }, 'No access to Drive file')
      return buildNoAccessResult(url, accountEmail, 'No access — user needs to share the file')
    }

    logger.warn({ err, fileId, url }, 'Drive API call failed')
    return buildNoAccessResult(url, accountEmail, `Drive API error: ${String(err)}`)
  }
}

/**
 * Reads the file content from Google APIs.
 * Returns null if the service is unavailable or the drive type is unsupported.
 */
async function fetchDriveContent(
  result: DriveResult,
  registry: Registry,
): Promise<string | null> {
  switch (result.driveType) {
    case 'document': {
      const docs = registry.getOptional<DocsService>('google:docs')
      if (!docs) return null
      const doc = await docs.getDocument(result.fileId)
      return doc.body
    }
    case 'spreadsheet': {
      const sheets = registry.getOptional<SheetsService>('google:sheets')
      if (!sheets) return null
      const info = await sheets.getSpreadsheet(result.fileId)
      const firstSheet = info.sheets[0]
      if (!firstSheet) return null
      const data = await sheets.readRange(result.fileId, `'${firstSheet.title}'`)
      return data.values.map(row => row.join('\t')).join('\n')
    }
    case 'presentation': {
      const slides = registry.getOptional<SlidesService>('google:slides')
      if (!slides) return null
      return slides.getSlideText(result.fileId)
    }
    default:
      return null
  }
}

/**
 * Sanitizes content against prompt injection (H3).
 */
function sanitizeDriveContent(
  content: string,
  result: DriveResult,
): string {
  const check = validateInjection(content, 'drive', result.name ?? result.fileId)
  if (check.injectionRisk) {
    logger.warn({ fileId: result.fileId, threats: check.threats }, '[Drive] Injection risk detected')
  }
  return check.sanitizedText
}

/**
 * For large content, generates an LLM summary.
 * If the LLM fails, returns the result without summary (does not propagate the error).
 */
async function generateDriveSummary(
  content: string,
  result: DriveResult,
  registry: Registry,
): Promise<DriveResult> {
  const enriched: DriveResult = { ...result, extractedContent: content }
  const tokenEstimate = Math.ceil(content.length / 4)
  if (tokenEstimate <= 8000) return enriched

  try {
    const llmResult = await registry.callHook('llm:chat', {
      task: 'drive-summarize-large',
      system: 'Eres un asistente que resume documentos. Genera una descripción concisa pero completa del documento, cubriendo los puntos principales, estructura y datos relevantes. Responde en español. Máximo 500 palabras.',
      messages: [{
        role: 'user' as const,
        content: [
          { type: 'text' as const, text: `Resume este documento ("${result.name}"):\n\n${content.slice(0, 24000)}` },
        ],
      }],
      maxTokens: 1500,
    })

    if (llmResult && typeof llmResult === 'object' && 'text' in llmResult) {
      const summary = (llmResult as { text: string }).text?.trim()
      if (summary) {
        enriched.llmEnrichment = {
          description: summary,
          provider: 'drive-enrichment',
          generatedAt: new Date(),
        }
      }
    }
  } catch (err) {
    logger.warn({ err, fileId: result.fileId }, '[Drive] LLM summary failed')
  }

  return enriched
}

/**
 * Public orchestrator. Same signature and behavior as before.
 * Internally separates fetch, sanitization and LLM for clearer diagnostics.
 * Called by enrichWithLLM() orchestrator in index.ts.
 */
export async function enrichDriveContent(
  result: DriveResult,
  registry: Registry,
): Promise<DriveResult> {
  if (!result.hasAccess || result.driveType === 'folder') return result

  try {
    const content = await fetchDriveContent(result, registry)
    if (!content) return result
    const safeContent = sanitizeDriveContent(content, result)
    const enriched = await generateDriveSummary(safeContent, result, registry)
    logger.info({ fileId: result.fileId, name: result.name, contentLen: content.length }, 'Drive content enriched')
    return enriched
  } catch (err) {
    logger.warn({ err, fileId: result.fileId }, '[Drive] Content enrichment failed')
    return result
  }
}

/** Returns a display icon for a MIME type */
function fileIcon(mimeType: string): string {
  if (mimeType === 'application/vnd.google-apps.document') return '📄'
  if (mimeType === 'application/vnd.google-apps.spreadsheet') return '📊'
  if (mimeType === 'application/vnd.google-apps.presentation') return '📑'
  if (mimeType === 'application/pdf') return '📕'
  if (mimeType.startsWith('image/')) return '🖼️'
  if (mimeType.startsWith('video/')) return '🎬'
  if (mimeType.startsWith('audio/')) return '🎵'
  return '📄'
}

function buildNoAccessResult(url: string, accountEmail: string | null, error: string): DriveResult {
  const fileId = extractDriveFileId(url) ?? ''
  return {
    kind: 'drive',
    url,
    fileId,
    name: url,
    mimeType: 'unknown',
    driveType: 'file',
    suggestedTool: 'drive-read-file',
    hasAccess: false,
    accountEmail,
    folderContents: undefined,
    modifiedTime: undefined,
    extractedContent: null,
    llmEnrichment: undefined,
    metadata: {
      originalName: url,
      extractorUsed: 'drive',
      error,
    },
  }
}
