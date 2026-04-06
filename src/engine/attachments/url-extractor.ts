// LUNA Engine — URL Extractor (v2)
// 3-tier URL routing:
//   1. Drive URLs → delegated to src/extractors/drive.ts
//   2. Authorized domain URLs → fetch + extract (readability)
//   3. Unauthorized URLs → pass to agent for subagent delegation

import pino from 'pino'
import { Readability } from '@mozilla/readability'
import { JSDOM } from 'jsdom'
import type { UrlExtraction, AttachmentEngineConfig } from './types.js'
import type { Registry } from '../../kernel/registry.js'
import { validateInjection } from './injection-validator.js'
import { isDriveUrl, extractDrive } from '../../extractors/drive.js'

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
  /^https?:\/\/\[f[cd]/i,    // fc00::/7 ULA
  /^https?:\/\/\[fe80:/i,    // link-local
  /^https?:\/\/169\.254\./,  // link-local IPv4
  /^https?:\/\/metadata\./i, // cloud metadata endpoints
]

/**
 * Detect URLs in text.
 * Returns unique, non-blocked URLs.
 */
export function detectUrls(text: string): string[] {
  const matches = text.match(URL_REGEX) ?? []
  const unique = [...new Set(matches)]
  return unique.filter(url => !isBlockedUrl(url))
}

function isBlockedUrl(url: string): boolean {
  return BLOCKED_PATTERNS.some(pattern => pattern.test(url))
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
 * - Drive URLs → extractDrive() from src/extractors/drive.ts
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
      // Tier 1: Drive URLs → delegate to drive extractor
      if (isDriveUrl(url)) {
        const driveResult = await extractDrive(url, registry)
        results.push(driveResultToUrlExtraction(driveResult))
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
 * Convert a DriveResult (from extractor) to UrlExtraction (engine format).
 */
function driveResultToUrlExtraction(drive: import('../../extractors/types.js').DriveResult): UrlExtraction {
  if (!drive.hasAccess) {
    return {
      url: drive.url,
      title: null,
      extractedText: null,
      tokenEstimate: 0,
      status: 'drive_no_access',
      injectionRisk: false,
      cacheKey: null,
      driveEmail: drive.accountEmail ?? undefined,
    }
  }

  return {
    url: drive.url,
    title: drive.name,
    extractedText: drive.extractedContent,
    tokenEstimate: drive.extractedContent ? Math.ceil(drive.extractedContent.length / 4) : 0,
    status: 'drive_reference',
    injectionRisk: false,
    cacheKey: null,
    driveMeta: {
      fileId: drive.fileId,
      name: drive.name,
      mimeType: drive.mimeType,
      modifiedTime: drive.modifiedTime,
      driveType: drive.driveType,
      suggestedTool: drive.suggestedTool,
      folderContents: drive.folderContents?.map(f => ({ name: f.name, mimeType: f.mimeType, id: f.id })),
    },
  }
}

/**
 * Fetch and extract content from an authorized domain URL.
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

    const contentLength = response.headers.get('content-length')
    if (contentLength && Number(contentLength) > config.urlMaxSizeMb * 1024 * 1024) {
      return {
        url, title: null, extractedText: null, tokenEstimate: 0,
        status: 'too_large', injectionRisk: false, cacheKey: null,
      }
    }

    const contentType = response.headers.get('content-type') ?? ''
    const html = await response.text()

    if (html.length > config.urlMaxSizeMb * 1024 * 1024) {
      return {
        url, title: null, extractedText: null, tokenEstimate: 0,
        status: 'too_large', injectionRisk: false, cacheKey: null,
      }
    }

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

    const dom = new JSDOM(html, { url })
    const reader = new Readability(dom.window.document)
    const article = reader.parse()

    if (!article || !article.textContent?.trim()) {
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

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4)
}
