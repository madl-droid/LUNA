// LUNA — Global Extractors — Markdown / Text / JSON
// Extrae contenido de archivos .md, .txt, .json.
// MD: títulos explícitos (#, ##, ###) + títulos implícitos.
// TXT: títulos implícitos (ALL CAPS, terminan en ":", seguidas de texto más largo).
// JSON: parseo + formato.

import type { ExtractedContent, ExtractedSection } from './types.js'
import { isImplicitTitle, countWords } from './utils.js'

// ═══════════════════════════════════════════
// Markdown
// ═══════════════════════════════════════════

export async function extractMarkdown(input: Buffer, fileName: string): Promise<ExtractedContent> {
  const text = input.toString('utf-8')
  const { sections, hasExplicitHeadings } = splitMarkdown(text)

  return {
    text,
    sections,
    metadata: {
      sizeBytes: input.length,
      originalName: fileName,
      extractorUsed: 'markdown',
      wordCount: countWords(text),
      lineCount: text.split('\n').length,
      sectionCount: sections.length,
      hasExplicitHeadings,
    },
  }
}

/**
 * Parte MD por headings explícitos (#, ##, ###).
 * Si no hay headings, aplica detección de títulos implícitos.
 * Si tampoco hay implícitos, parte por párrafos.
 */
function splitMarkdown(text: string): { sections: ExtractedSection[]; hasExplicitHeadings: boolean } {
  // Intentar por headings explícitos
  const byHeadings = splitByExplicitHeadings(text)
  if (byHeadings.length > 0) return { sections: byHeadings, hasExplicitHeadings: true }

  // Fallback: títulos implícitos
  const byImplicit = splitByImplicitTitles(text)
  if (byImplicit.length > 0) return { sections: byImplicit, hasExplicitHeadings: false }

  // Fallback final: párrafos
  return { sections: splitByParagraphs(text), hasExplicitHeadings: false }
}

/**
 * Parte texto por headings Markdown (#, ##, ###).
 * También detecta títulos implícitos dentro del texto entre headings.
 */
function splitByExplicitHeadings(text: string): ExtractedSection[] {
  const sections: ExtractedSection[] = []
  const parts = text.split(/(?=^#{1,3}\s)/m)

  for (const part of parts) {
    const trimmed = part.trim()
    if (trimmed.length < 20) continue

    const headingMatch = trimmed.match(/^(#{1,3})\s+(.+?)$/m)
    sections.push({
      title: headingMatch ? headingMatch[2]!.trim() : null,
      content: trimmed,
    })
  }

  return sections
}

// ═══════════════════════════════════════════
// Texto plano
// ═══════════════════════════════════════════

export async function extractPlainText(input: Buffer, fileName: string): Promise<ExtractedContent> {
  const text = input.toString('utf-8')
  const sections = splitPlainText(text)

  return {
    text,
    sections,
    metadata: {
      sizeBytes: input.length,
      originalName: fileName,
      extractorUsed: 'plain-text',
      wordCount: countWords(text),
      lineCount: text.split('\n').length,
      sectionCount: sections.length,
      hasExplicitHeadings: false,
    },
  }
}

/**
 * Parte texto plano detectando títulos implícitos.
 * Si no hay implícitos, parte por párrafos.
 */
function splitPlainText(text: string): ExtractedSection[] {
  const byImplicit = splitByImplicitTitles(text)
  if (byImplicit.length > 0) return byImplicit
  return splitByParagraphs(text)
}

// ═══════════════════════════════════════════
// JSON
// ═══════════════════════════════════════════

export async function extractJSON(input: Buffer, fileName: string): Promise<ExtractedContent> {
  const raw = input.toString('utf-8')
  let text: string

  try {
    const parsed = JSON.parse(raw) as unknown
    text = typeof parsed === 'string' ? parsed : JSON.stringify(parsed, null, 2)
  } catch {
    text = raw
  }

  return {
    text,
    sections: [{ title: fileName, content: text }],
    metadata: {
      sizeBytes: input.length,
      originalName: fileName,
      extractorUsed: 'json',
      wordCount: countWords(text),
      lineCount: text.split('\n').length,
      sectionCount: 1,
    },
  }
}

// ═══════════════════════════════════════════
// Funciones compartidas
// ═══════════════════════════════════════════

/**
 * Detecta títulos implícitos y agrupa el texto bajo ellos.
 * Retorna [] si no se encontró ningún título implícito.
 */
function splitByImplicitTitles(text: string): ExtractedSection[] {
  const lines = text.split('\n')
  const sections: ExtractedSection[] = []
  let currentTitle: string | null = null
  let currentContent: string[] = []
  let foundTitle = false

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!
    const nextLine = lines[i + 1]

    if (isImplicitTitle(line, nextLine)) {
      // Guardar sección anterior si hay contenido
      if (currentContent.length > 0 || currentTitle !== null) {
        const content = currentContent.join('\n').trim()
        if (content.length >= 20 || currentTitle !== null) {
          sections.push({ title: currentTitle, content: content || currentTitle || '' })
        }
      }
      currentTitle = line.trim().replace(/:$/, '')
      currentContent = []
      foundTitle = true
    } else {
      currentContent.push(line)
    }
  }

  // Última sección
  if (foundTitle && (currentContent.length > 0 || currentTitle !== null)) {
    const content = currentContent.join('\n').trim()
    if (content.length >= 20 || currentTitle !== null) {
      sections.push({ title: currentTitle, content: content || currentTitle || '' })
    }
  }

  return foundTitle ? sections : []
}

/**
 * Parte texto por párrafos (doble salto de línea).
 */
function splitByParagraphs(text: string): ExtractedSection[] {
  const sections: ExtractedSection[] = []
  const paragraphs = text.split(/\n\s*\n/)

  for (const para of paragraphs) {
    const trimmed = para.trim()
    if (trimmed.length < 20) continue
    sections.push({ title: null, content: trimmed })
  }

  return sections
}
