// LUNA — Global Extractors — DOCX/Word
// Extrae texto e imágenes de archivos .docx.
// Headings explícitos: Heading1/2/3 via mammoth style mapping.
// Headings implícitos: bold + <15 palabras + seguido de texto más largo.
// Imágenes: embebidas en el cuerpo, filtradas por tamaño y dedup MD5.

import type { ExtractedContent, ExtractedSection, ExtractedImage } from './types.js'
import { computeMD5, isSmallImage, MAX_FILE_SIZE } from './utils.js'

// ═══════════════════════════════════════════
// Función principal
// ═══════════════════════════════════════════

export async function extractDocx(input: Buffer, fileName: string): Promise<ExtractedContent> {
  if (input.length > MAX_FILE_SIZE) {
    throw new Error(`DOCX too large: ${(input.length / 1024 / 1024).toFixed(1)}MB exceeds ${MAX_FILE_SIZE / 1024 / 1024}MB limit`)
  }

  const mammoth = await import('mammoth')

  // ── Paso 1: Extraer HTML con heading styles mapeados ──
  const htmlResult = await mammoth.convertToHtml({
    buffer: input,
  })
  const html = htmlResult.value

  // ── Paso 2: Extraer imágenes embebidas ──
  const images = await extractImages(input)

  // ── Paso 3: Parsear HTML en secciones ──
  const sections = parseHtmlSections(html, images)

  // ── Paso 4: Texto plano para .text ──
  const rawResult = await mammoth.extractRawText({ buffer: input })
  const text = rawResult.value

  return {
    text,
    sections,
    metadata: {
      sizeBytes: input.length,
      originalName: fileName,
      extractorUsed: 'docx-mammoth',
      wordCount: text.split(/\s+/).filter(Boolean).length,
      hasImages: images.length > 0,
      imageCount: images.length,
      sectionCount: sections.length,
      hasExplicitHeadings: sections.some(s => s.title !== null),
    },
  }
}

// ═══════════════════════════════════════════
// Parser de HTML a secciones
// ═══════════════════════════════════════════

interface RawBlock {
  tag: string
  text: string
  isBold: boolean
  isHeading: boolean
  headingLevel: number
}

/**
 * Parsea el HTML de mammoth en bloques y agrupa por headings.
 * Headings explícitos (h1-h3) tienen prioridad.
 * Headings implícitos detectados en párrafos (bold, cortos, seguidos de texto largo).
 */
function parseHtmlSections(html: string, images: ExtractedImage[]): ExtractedSection[] {
  const blocks = parseBlocks(html)
  if (blocks.length === 0) return []

  const sections: ExtractedSection[] = []
  let currentTitle: string | null = null
  let currentContent: string[] = []
  let currentImages: ExtractedImage[] = []
  let imageAssignIndex = 0

  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i]!
    const nextBlock = blocks[i + 1]

    const isExplicitHeading = block.isHeading
    const isImplicit = !isExplicitHeading && isDocxImplicitTitle(block, nextBlock)

    if (isExplicitHeading || isImplicit) {
      // Guardar sección anterior
      if (currentContent.length > 0 || currentTitle !== null) {
        const content = currentContent.join('\n\n').trim()
        if (content.length >= 10 || currentTitle !== null) {
          sections.push({
            title: currentTitle,
            content: content || currentTitle || '',
            images: currentImages.length > 0 ? currentImages : undefined,
          })
        }
      }
      currentTitle = block.text.trim()
      currentContent = []
      currentImages = []
    } else {
      currentContent.push(block.text)
    }

    // Asignar imágenes a la sección activa
    // Las imágenes se asignan por orden de aparición en el documento
    while (imageAssignIndex < images.length && imageAssignIndex <= i) {
      currentImages.push(images[imageAssignIndex]!)
      imageAssignIndex++
    }
  }

  // Última sección
  if (currentContent.length > 0 || currentTitle !== null) {
    const content = currentContent.join('\n\n').trim()
    if (content.length >= 10 || currentTitle !== null) {
      // Asignar imágenes restantes
      while (imageAssignIndex < images.length) {
        currentImages.push(images[imageAssignIndex]!)
        imageAssignIndex++
      }
      sections.push({
        title: currentTitle,
        content: content || currentTitle || '',
        images: currentImages.length > 0 ? currentImages : undefined,
      })
    }
  }

  // Fallback: si no se encontraron headings, una sola sección
  if (sections.length === 0) {
    const allText = blocks.map(b => b.text).join('\n\n').trim()
    if (allText.length > 0) {
      sections.push({
        title: null,
        content: allText,
        images: images.length > 0 ? images : undefined,
      })
    }
  }

  return sections
}

/**
 * Parsea HTML de mammoth en bloques simplificados.
 */
function parseBlocks(html: string): RawBlock[] {
  const blocks: RawBlock[] = []
  // Regex para capturar bloques HTML (h1-h6, p, li)
  const blockRegex = /<(h[1-6]|p|li)[^>]*>([\s\S]*?)<\/\1>/gi
  let match: RegExpExecArray | null

  while ((match = blockRegex.exec(html)) !== null) {
    const tag = match[1]!.toLowerCase()
    const innerHtml = match[2]!
    const text = stripHtmlTags(innerHtml).trim()

    if (!text) continue

    const isHeading = /^h[1-3]$/.test(tag)
    const headingLevel = isHeading ? parseInt(tag.charAt(1), 10) : 0
    const isBold = /<strong[^>]*>/.test(innerHtml)
      && stripHtmlTags(innerHtml.replace(/<\/?strong[^>]*>/gi, '')).trim().length < text.length * 0.3

    blocks.push({ tag, text, isBold, isHeading, headingLevel })
  }

  return blocks
}

/**
 * Detecta títulos implícitos en DOCX.
 * Al menos 2 de: bold, <15 palabras, seguido de texto más largo.
 */
function isDocxImplicitTitle(block: RawBlock, nextBlock?: RawBlock): boolean {
  const words = block.text.split(/\s+/)
  let score = 0

  // Bold completo
  if (block.isBold) score++

  // Menos de 15 palabras
  if (words.length < 15) score++

  // Seguido de texto más largo
  if (nextBlock && nextBlock.text.length > block.text.length) score++

  return score >= 2
}

// ═══════════════════════════════════════════
// Extracción de imágenes
// ═══════════════════════════════════════════

/**
 * Extrae imágenes embebidas del DOCX.
 * Filtra: <75x75px, duplicados por MD5.
 */
async function extractImages(input: Buffer): Promise<ExtractedImage[]> {
  const images: ExtractedImage[] = []
  const seenMd5 = new Map<string, number>()

  try {
    const mammoth = await import('mammoth')

    // Usar convertToHtml con options.convertImage para capturar imágenes
    const collectedImages: Array<{ buffer: Buffer; contentType: string }> = []

    await mammoth.convertToHtml({
      buffer: input,
    }, {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      convertImage: mammoth.images.imgElement(async (image: any) => {
        const buffer = await image.read()
        const contentType = image.contentType ?? 'image/png'
        collectedImages.push({ buffer: Buffer.from(buffer), contentType })
        return { src: '' }  // No necesitamos el HTML de la imagen
      }),
    })

    // Contar MD5 para detectar logos repetidos
    for (const img of collectedImages) {
      const md5 = computeMD5(img.buffer)
      seenMd5.set(md5, (seenMd5.get(md5) ?? 0) + 1)
    }

    // Filtrar
    for (const img of collectedImages) {
      const md5 = computeMD5(img.buffer)

      // Descartar duplicados (logos repetidos)
      if ((seenMd5.get(md5) ?? 0) > 1) continue

      // Descartar imágenes muy pequeñas
      const dims = estimateImageDimensions(img.buffer)
      if (dims && isSmallImage(dims.width, dims.height)) continue

      images.push({
        data: img.buffer,
        mimeType: img.contentType,
        width: dims?.width,
        height: dims?.height,
        md5,
      })
    }
  } catch {
    // Si la extracción de imágenes falla, continuamos sin imágenes
  }

  return images
}

/**
 * Estima dimensiones de una imagen desde el header del buffer.
 * Soporta PNG y JPEG.
 */
function estimateImageDimensions(buffer: Buffer): { width: number; height: number } | null {
  // PNG: bytes 16-19 = width, 20-23 = height
  if (buffer.length > 24 && buffer[0] === 0x89 && buffer[1] === 0x50) {
    const width = buffer.readUInt32BE(16)
    const height = buffer.readUInt32BE(20)
    return { width, height }
  }

  // JPEG: buscar marcador SOF0 (0xFF 0xC0)
  if (buffer.length > 10 && buffer[0] === 0xFF && buffer[1] === 0xD8) {
    let offset = 2
    while (offset < buffer.length - 10) {
      if (buffer[offset] === 0xFF) {
        const marker = buffer[offset + 1]
        if (marker !== undefined && marker >= 0xC0 && marker <= 0xCF && marker !== 0xC4 && marker !== 0xC8) {
          const height = buffer.readUInt16BE(offset + 5)
          const width = buffer.readUInt16BE(offset + 7)
          return { width, height }
        }
        const segLen = buffer.readUInt16BE(offset + 2)
        offset += 2 + segLen
      } else {
        offset++
      }
    }
  }

  return null
}

// ═══════════════════════════════════════════
// Utilidades HTML
// ═══════════════════════════════════════════

function stripHtmlTags(html: string): string {
  return html.replace(/<[^>]+>/g, '')
}
