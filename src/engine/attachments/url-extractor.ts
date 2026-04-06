// LUNA Engine — URL Extractor (v2)
// 3-tier URL routing:
//   1. Drive URLs → verify OAuth access, get metadata from API, store reference
//   2. Authorized domain URLs → fetch + extract (readability)
//   3. Unauthorized URLs → pass to agent for subagent delegation

import pino from 'pino'
import { Readability } from '@mozilla/readability'
import { JSDOM } from 'jsdom'
import type { UrlExtraction, AttachmentEngineConfig } from './types.js'
import type { Registry } from '../../kernel/registry.js'
import { validateInjection } from './injection-validator.js'

const logger = pino({ name: 'engine:url-extractor' })

// URL detection regex — matches http/https URLs in text
const URL_REGEX = /https?:\/\/[^\s<>"{}|\\^`\[\]]+/gi

// Blocked domains/patterns for SSRF prevention
const BLOCKED_PATTERNS: RegExp[] = [
  /^https?:\/\/localhost/i,
  /^https?:\/\/127\.\d+\.\d+\.\d+/,
  /^https?:\/\/10\.\d+\.\d+\.\d+/,
  /^https?:\/\/172\.(1[6-9]|2\d|3[01])\.\d+\.\d+/,
  /^https?:\/\/192\.168\.\d+\.\d+/,
  /^https?:\/\/0\.0\.0\.0/,
  /^https?:\/\/\[::1\]/,
  /^https?:\/\/\[f[cd]/i,    // fc00::/7 ULA (covers both fc00::/8 and fd00::/8)
  /^https?:\/\/\[fe80:/i,    // link-local
  /^https?:\/\/169\.254\./,  // link-local IPv4
  /^https?:\/\/metadata\./i, // cloud metadata endpoints
]

// Google Drive mimeType → driveType + suggestedTool mapping
const DRIVE_MIME_MAP: Record<string, { driveType: 'document' | 'spreadsheet' | 'presentation' | 'folder' | 'file'; suggestedTool: string }> = {
  'application/vnd.google-apps.document': { driveType: 'document', suggestedTool: 'docs-read' },
  'application/vnd.google-apps.spreadsheet': { driveType: 'spreadsheet', suggestedTool: 'sheets-read' },
  'application/vnd.google-apps.presentation': { driveType: 'presentation', suggestedTool: 'slides-read' },
  'application/vnd.google-apps.folder': { driveType: 'folder', suggestedTool: 'drive-list-files' },
}

/** DriveService interface (from google-apps module) */
interface DriveService {
  getFile(fileId: string): Promise<{
    id: string
    name: string
    mimeType: string
    modifiedTime?: string
  }>
  listFiles(options?: { folderId?: string; pageSize?: number }): Promise<{
    files: Array<{ id: string; name: string; mimeType: string }>
  }>
}

/** OAuthManager interface (from google-apps module) */
interface OAuthManager {
  getState(): { email: string | null; status: string }
  isConnected(): boolean
}

/**
 * Detect URLs in text.
 * Returns unique, non-blocked URLs.
 */
export function detectUrls(text: string): string[] {
  const matches = text.match(URL_REGEX) ?? []
  const unique = [...new Set(matches)]
  return unique.filter(url => !isBlockedUrl(url))
}

/**
 * Check if a URL targets a blocked/internal address.
 */
function isBlockedUrl(url: string): boolean {
  return BLOCKED_PATTERNS.some(pattern => pattern.test(url))
}

/**
 * Check if a URL is a Google Drive/Docs/Sheets/Slides/Folder URL.
 */
export function isDriveUrl(url: string): boolean {
  return /^https?:\/\/(docs|drive)\.google\.com\//.test(url)
}

/**
 * Extract the file/folder ID from a Google Drive URL.
 * Returns null if URL doesn't match any known Drive pattern.
 */
export function extractDriveFileId(url: string): string | null {
  // docs.google.com/document/d/{ID}/, docs.google.com/spreadsheets/d/{ID}/, etc.
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
function resolveDriveType(mimeType: string): { driveType: 'document' | 'spreadsheet' | 'presentation' | 'folder' | 'file'; suggestedTool: string } {
  return DRIVE_MIME_MAP[mimeType] ?? { driveType: 'file', suggestedTool: 'drive-get-file' }
}

/**
 * Check if a URL's domain is in the authorized list.
 */
function isAuthorizedDomain(url: string, authorizedDomains: string[]): boolean {
  if (authorizedDomains.length === 0) return false
  try {
    const hostname = new URL(url).hostname.toLowerCase()
    return authorizedDomains.some(domain => hostname === domain || hostname.endsWith(`.${domain}`))
  } catch {
    return false
  }
}

/**
 * Extract content from a list of URLs with 3-tier routing.
 * - Drive URLs → check OAuth access, get metadata
 * - Authorized domains → fetch + readability extract
 * - Unauthorized → mark as unauthorized for agent to handle
 */
export async function extractUrls(
  urls: string[],
  config: AttachmentEngineConfig,
  registry: Registry,
): Promise<UrlExtraction[]> {
  const results: UrlExtraction[] = []

  for (const url of urls) {
    try {
      // Tier 1: Drive URLs
      if (isDriveUrl(url)) {
        const result = await handleDriveUrl(url, registry)
        results.push(result)
        continue
      }

      // Tier 2: Authorized domains → fetch + extract
      if (isAuthorizedDomain(url, config.authorizedDomains)) {
        const result = await extractAuthorizedUrl(url, config)
        results.push(result)
        continue
      }

      // Tier 3: Unauthorized → pass to agent
      results.push({
        url,
        title: null,
        extractedText: null,
        tokenEstimate: 0,
        status: 'unauthorized',
        injectionRisk: false,
        cacheKey: null,
      })
    } catch (err) {
      logger.warn({ url, err }, 'URL extraction failed')
      results.push({
        url,
        title: null,
        extractedText: null,
        tokenEstimate: 0,
        status: 'needs_subagent',
        injectionRisk: false,
        cacheKey: null,
      })
    }
  }

  return results
}

/**
 * Handle a Google Drive URL:
 * - Check if google:drive service is available and connected
 * - Try to get file/folder metadata via API
 * - For folders, list contents (max 20 items)
 * - If no access, return drive_no_access with email so agent can ask user to share
 */
async function handleDriveUrl(url: string, registry: Registry): Promise<UrlExtraction> {
  const fileId = extractDriveFileId(url)
  if (!fileId) {
    return {
      url, title: null, extractedText: null, tokenEstimate: 0,
      status: 'unauthorized', injectionRisk: false, cacheKey: null,
    }
  }

  // Check if Google Drive service is available
  const driveService = registry.getOptional<DriveService>('google:drive')
  if (!driveService) {
    logger.debug({ url }, 'Drive URL detected but google:drive service not available')
    return {
      url, title: null, extractedText: null, tokenEstimate: 0,
      status: 'unauthorized', injectionRisk: false, cacheKey: null,
    }
  }

  // Get connected account email (for "share with" message)
  let accountEmail: string | null = null
  try {
    const oauthManager = registry.getOptional<OAuthManager>('google:oauth-manager')
    if (oauthManager?.isConnected()) {
      accountEmail = oauthManager.getState().email
    }
  } catch { /* non-critical */ }

  // Try to get file metadata
  try {
    const file = await driveService.getFile(fileId)
    const { driveType, suggestedTool } = resolveDriveType(file.mimeType)

    logger.info({ fileId, name: file.name, mimeType: file.mimeType, driveType }, 'Drive URL resolved')

    // If it's a folder, list its contents
    let folderContents: Array<{ name: string; mimeType: string; id: string }> | undefined
    if (driveType === 'folder') {
      try {
        const listing = await driveService.listFiles({ folderId: fileId, pageSize: 20 })
        folderContents = listing.files.map(f => ({ name: f.name, mimeType: f.mimeType, id: f.id }))
      } catch (listErr) {
        logger.warn({ listErr, fileId }, 'Failed to list folder contents')
        folderContents = []
      }
    }

    return {
      url,
      title: file.name,
      extractedText: null,
      tokenEstimate: 0,
      status: 'drive_reference',
      injectionRisk: false,
      cacheKey: null,
      driveMeta: {
        fileId: file.id,
        name: file.name,
        mimeType: file.mimeType,
        modifiedTime: file.modifiedTime,
        driveType,
        suggestedTool,
        folderContents,
      },
    }
  } catch (err: unknown) {
    // 403/404 = no access to file
    const status = (err as { code?: number })?.code
    if (status === 403 || status === 404) {
      logger.info({ fileId, url, accountEmail }, 'No access to Drive file — agent should ask user to share')
      return {
        url, title: null, extractedText: null, tokenEstimate: 0,
        status: 'drive_no_access', injectionRisk: false, cacheKey: null,
        driveEmail: accountEmail ?? undefined,
      }
    }

    // Other error (network, quota, etc.)
    logger.warn({ err, fileId, url }, 'Drive API call failed')
    return {
      url, title: null, extractedText: null, tokenEstimate: 0,
      status: 'needs_subagent', injectionRisk: false, cacheKey: null,
    }
  }
}

/**
 * Fetch and extract content from an authorized domain URL.
 * Same logic as the previous extractSingleUrl — fetch + readability.
 */
async function extractAuthorizedUrl(
  url: string,
  config: AttachmentEngineConfig,
): Promise<UrlExtraction> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), config.urlFetchTimeoutMs)

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; LUNA-Bot/1.0)',
        'Accept': 'text/html,application/xhtml+xml,text/plain',
      },
      redirect: 'follow',
    })

    if (!response.ok) {
      return {
        url, title: null, extractedText: null, tokenEstimate: 0,
        status: 'needs_subagent', injectionRisk: false, cacheKey: null,
      }
    }

    // Check content size
    const contentLength = response.headers.get('content-length')
    if (contentLength && Number(contentLength) > config.urlMaxSizeMb * 1024 * 1024) {
      return {
        url, title: null, extractedText: null, tokenEstimate: 0,
        status: 'too_large', injectionRisk: false, cacheKey: null,
      }
    }

    const contentType = response.headers.get('content-type') ?? ''
    const html = await response.text()

    // Size check on actual content
    if (html.length > config.urlMaxSizeMb * 1024 * 1024) {
      return {
        url, title: null, extractedText: null, tokenEstimate: 0,
        status: 'too_large', injectionRisk: false, cacheKey: null,
      }
    }

    // If plain text, use directly
    if (contentType.includes('text/plain')) {
      const validation = validateInjection(html, 'url', url)
      return {
        url,
        title: url,
        extractedText: validation.sanitizedText,
        tokenEstimate: estimateTokens(html),
        status: 'processed',
        injectionRisk: validation.injectionRisk,
        cacheKey: null,
      }
    }

    // Parse HTML with readability
    const dom = new JSDOM(html, { url })
    const reader = new Readability(dom.window.document)
    const article = reader.parse()

    if (!article || !article.textContent?.trim()) {
      // SPA or auth-protected page — needs subagent
      return {
        url,
        title: dom.window.document.title || null,
        extractedText: null,
        tokenEstimate: 0,
        status: 'needs_subagent',
        injectionRisk: false,
        cacheKey: null,
      }
    }

    const cleanText = article.textContent.trim()
    const validation = validateInjection(cleanText, 'url', url)

    return {
      url,
      title: article.title || null,
      extractedText: validation.sanitizedText,
      tokenEstimate: estimateTokens(cleanText),
      status: 'processed',
      injectionRisk: validation.injectionRisk,
      cacheKey: null,
    }
  } finally {
    clearTimeout(timeout)
  }
}

/** Estimate token count (~4 chars per token) */
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4)
}
