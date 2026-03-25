// LUNA Engine — URL Extractor
// Detects URLs in message text, fetches their content, and extracts readable text.
// Uses @mozilla/readability + jsdom for clean text extraction.

import pino from 'pino'
import { Readability } from '@mozilla/readability'
import { JSDOM } from 'jsdom'
import type { UrlExtraction, AttachmentEngineConfig } from './types.js'
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
 * Extract content from a list of URLs.
 * Fetches each URL, parses with readability, validates injection.
 */
export async function extractUrls(
  urls: string[],
  config: AttachmentEngineConfig,
): Promise<UrlExtraction[]> {
  const results: UrlExtraction[] = []

  for (const url of urls) {
    try {
      const extraction = await extractSingleUrl(url, config)
      results.push(extraction)
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

async function extractSingleUrl(
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
        url,
        title: null,
        extractedText: null,
        tokenEstimate: 0,
        status: 'needs_subagent',
        injectionRisk: false,
        cacheKey: null,
      }
    }

    // Check content size
    const contentLength = response.headers.get('content-length')
    if (contentLength && Number(contentLength) > config.urlMaxSizeMb * 1024 * 1024) {
      return {
        url,
        title: null,
        extractedText: null,
        tokenEstimate: 0,
        status: 'too_large',
        injectionRisk: false,
        cacheKey: null,
      }
    }

    const contentType = response.headers.get('content-type') ?? ''
    const html = await response.text()

    // Size check on actual content
    if (html.length > config.urlMaxSizeMb * 1024 * 1024) {
      return {
        url,
        title: null,
        extractedText: null,
        tokenEstimate: 0,
        status: 'too_large',
        injectionRisk: false,
        cacheKey: null,
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
