// LUNA — Global Extractors — Web
// Extrae contenido de URLs con limpieza HTML completa.
// Secciones por H1/H2/H3 (sin títulos implícitos en web).
// Imágenes filtradas: alt no vacío, no icons/logos, mismo dominio, min 75x75.
// NO pasa por subagent de research.

import type { WebResult, ExtractedSection, ExtractedImage } from './types.js'
import { computeMD5, isSmallImage } from './utils.js'
const DEFAULT_TIMEOUT_MS = 30_000
const MAX_CONTENT_SIZE = 10 * 1024 * 1024 // 10MB

// Patrones de URL de imágenes a descartar
const IMAGE_URL_BLOCKLIST = /icon|logo|banner|avatar|pixel|tracking|spacer|sprite|badge/i

// Tags HTML a eliminar antes de procesar
const STRIP_TAGS = ['script', 'style', 'nav', 'footer', 'header', 'aside', 'form', 'noscript', 'iframe']

// SSRF protection
const BLOCKED_HOSTS = /^(localhost|127\.|10\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.|0\.0\.0\.0|\[::1\]|169\.254\.|metadata\.)/

// ═══════════════════════════════════════════
// Función principal
// ═══════════════════════════════════════════

export interface WebExtractOptions {
  timeoutMs?: number
  maxSizeBytes?: number
}

/**
 * Extrae contenido de una URL web.
 * Limpia HTML, parte por headings H1-H3, filtra imágenes.
 */
export async function extractWeb(url: string, options?: WebExtractOptions): Promise<WebResult> {
  const timeoutMs = options?.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const maxSize = options?.maxSizeBytes ?? MAX_CONTENT_SIZE

  // Validar URL
  const parsedUrl = new URL(url)
  if (BLOCKED_HOSTS.test(parsedUrl.hostname)) {
    throw new Error(`Blocked URL: ${parsedUrl.hostname} (SSRF protection)`)
  }

  // Fetch
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)

  let html: string
  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; LUNA-Bot/1.0)',
        'Accept': 'text/html,application/xhtml+xml',
      },
      signal: controller.signal,
      redirect: 'follow',
    })

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`)
    }

    const contentLength = parseInt(response.headers.get('content-length') ?? '0', 10)
    if (contentLength > maxSize) {
      throw new Error(`Content too large: ${contentLength} bytes`)
    }

    html = await response.text()
    if (html.length > maxSize) {
      html = html.substring(0, maxSize)
    }
  } finally {
    clearTimeout(timer)
  }

  // Parsear con JSDOM + Readability
  const { JSDOM } = await import('jsdom')
  const dom = new JSDOM(html, { url })
  const doc = dom.window.document

  // Eliminar tags no deseados
  for (const tag of STRIP_TAGS) {
    const elements = doc.querySelectorAll(tag)
    for (const el of elements) el.remove()
  }

  // Eliminar sidebars (class/role based)
  const sidebarSelectors = '[role="complementary"], [role="navigation"], .sidebar, .nav, .menu, .ad, .advertisement, .social-share'
  try {
    const sidebars = doc.querySelectorAll(sidebarSelectors)
    for (const el of sidebars) el.remove()
  } catch {
    // Selector inválido, continuar
  }

  // Extraer título de la página
  const pageTitle = doc.querySelector('title')?.textContent?.trim() ?? null

  // Extraer secciones por headings H1-H3
  const sections = extractSectionsFromDom(doc, parsedUrl.hostname)

  // Fallback: si no hay headings, usar Readability
  if (sections.length === 0) {
    try {
      const { Readability } = await import('@mozilla/readability')
      const reader = new Readability(doc)
      const article = reader.parse()
      if (article?.textContent?.trim()) {
        sections.push({
          title: article.title ?? pageTitle,
          content: article.textContent.trim(),
        })
      }
    } catch {
      // Readability falló, usar body
      const bodyText = doc.body?.textContent?.trim()
      if (bodyText) {
        sections.push({ title: pageTitle, content: bodyText })
      }
    }
  }

  const imageUrls = sections
    .flatMap(s => s.images ?? [])
    .map(img => img.url)
    .filter((u): u is string => !!u && u.startsWith('http'))

  return {
    kind: 'web',
    url,
    title: pageTitle,
    sections,
    metadata: {
      originalName: url,
      extractorUsed: 'web-jsdom',
      sizeBytes: html.length,
      domain: parsedUrl.hostname,
      title: pageTitle,
      fetchedAt: new Date().toISOString(),
      sectionCount: sections.length,
      imageCount: sections.reduce((sum, s) => sum + (s.images?.length ?? 0), 0),
      imageUrls: imageUrls.length > 0 ? imageUrls : undefined,
    },
  }
}

// ═══════════════════════════════════════════
// Extracción de secciones desde DOM
// ═══════════════════════════════════════════

function extractSectionsFromDom(doc: Document, hostname: string): ExtractedSection[] {
  const sections: ExtractedSection[] = []
  const body = doc.body
  if (!body) return sections

  // Encontrar todos los headings
  const headings = body.querySelectorAll('h1, h2, h3')
  if (headings.length === 0) return sections

  for (let i = 0; i < headings.length; i++) {
    const heading = headings[i]!
    const title = heading.textContent?.trim() ?? null

    // Recopilar contenido hasta el siguiente heading
    const contentParts: string[] = []
    const sectionImages: ExtractedImage[] = []
    let sibling = heading.nextElementSibling

    while (sibling && !isHeading(sibling)) {
      const text = sibling.textContent?.trim()
      if (text) contentParts.push(text)

      // Buscar imágenes en este elemento y 2 niveles abajo
      collectImages(sibling, hostname, sectionImages)

      sibling = sibling.nextElementSibling
    }

    const content = contentParts.join('\n\n').trim()
    if (content.length >= 10 || title) {
      sections.push({
        title,
        content: content || title || '',
        images: sectionImages.length > 0 ? sectionImages : undefined,
      })
    }
  }

  return sections
}

function isHeading(el: Element): boolean {
  return /^H[1-3]$/i.test(el.tagName)
}

/**
 * Recopila imágenes de un elemento DOM y sus hijos.
 * Aplica filtros según diseño.
 */
function collectImages(el: Element, hostname: string, images: ExtractedImage[]): void {
  const imgElements = el.querySelectorAll('img')

  for (const img of imgElements) {
    const src = img.getAttribute('src')
    const alt = img.getAttribute('alt')

    // Filtro: alt no vacío
    if (!alt || !alt.trim()) continue

    // Filtro: URL no contiene patrones bloqueados
    if (src && IMAGE_URL_BLOCKLIST.test(src)) continue

    // Filtro: mismo dominio
    if (src) {
      try {
        const imgUrl = new URL(src, `https://${hostname}`)
        if (imgUrl.hostname !== hostname) continue
      } catch {
        continue
      }
    }

    // Filtro: dimensiones mínimas (si están en atributos)
    const width = parseInt(img.getAttribute('width') ?? '0', 10)
    const height = parseInt(img.getAttribute('height') ?? '0', 10)
    if (width > 0 && height > 0 && isSmallImage(width, height)) continue

    // Nota: no descargamos la imagen aquí — guardamos la URL de referencia
    // El consumer decidirá si la descarga. data es Buffer vacío (no tenemos los bytes).
    images.push({
      data: Buffer.alloc(0),
      mimeType: 'image/unknown',
      url: src ?? undefined,
      width: width || undefined,
      height: height || undefined,
      md5: computeMD5(Buffer.from(src ?? '')),
      altText: alt.trim(),
    })
  }
}

// ═══════════════════════════════════════════
// Backward-compatible: ExtractedContent
// ═══════════════════════════════════════════

import type { ExtractedContent } from './types.js'

/**
 * Extrae web y devuelve ExtractedContent.
 */
export async function extractWebAsContent(url: string, options?: WebExtractOptions): Promise<ExtractedContent> {
  const result = await extractWeb(url, options)
  return {
    text: result.sections.map(s => s.content).join('\n\n'),
    sections: result.sections,
    metadata: result.metadata,
  }
}
