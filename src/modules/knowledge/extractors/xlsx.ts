// LUNA — Module: knowledge — Excel/CSV Extractor
// Extrae contenido de archivos .xlsx, .xls, .csv usando xlsx.

import type { ExtractedContent, ExtractedSection } from '../types.js'
import type { FAQImportRow } from '../types.js'

export async function extractXlsx(input: Buffer, fileName: string): Promise<ExtractedContent> {
  // Dynamic import — xlsx is optional dependency
  const XLSX = await import('xlsx')

  const workbook = XLSX.read(input, { type: 'buffer' })
  const sections: ExtractedSection[] = []
  const allText: string[] = []

  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName]
    if (!sheet) continue

    const jsonData = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: '' })
    if (jsonData.length === 0) continue

    // Convert each row to readable text
    const rows: string[] = []
    for (const row of jsonData) {
      const parts: string[] = []
      for (const [key, val] of Object.entries(row)) {
        if (val !== '' && val !== null && val !== undefined) {
          parts.push(`${key}: ${String(val)}`)
        }
      }
      if (parts.length > 0) rows.push(parts.join(' | '))
    }

    const content = rows.join('\n')
    allText.push(content)

    sections.push({
      title: sheetName,
      content,
    })
  }

  return {
    text: allText.join('\n\n'),
    sections,
    metadata: {
      sizeBytes: input.length,
      originalName: fileName,
      extractorUsed: 'xlsx',
    },
  }
}

/**
 * Parse an Excel/CSV file as FAQ import data.
 * Expects columns: question, answer, variants (optional), category (optional), active (optional)
 */
export async function parseFAQsFromXlsx(input: Buffer): Promise<FAQImportRow[]> {
  const XLSX = await import('xlsx')

  const workbook = XLSX.read(input, { type: 'buffer' })
  const firstSheet = workbook.Sheets[workbook.SheetNames[0]!]
  if (!firstSheet) return []

  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(firstSheet, { defval: '' })
  const faqs: FAQImportRow[] = []

  for (const row of rows) {
    // Flexible column names (Spanish and English)
    const question = findColumn(row, ['question', 'pregunta', 'q']) as string | undefined
    const answer = findColumn(row, ['answer', 'respuesta', 'a', 'r']) as string | undefined

    if (!question || !answer) continue

    faqs.push({
      question: String(question).trim(),
      answer: String(answer).trim(),
      variants: findColumn(row, ['variants', 'variantes', 'alternativas']) as string | undefined,
      category: findColumn(row, ['category', 'categoría', 'categoria', 'tema']) as string | undefined,
      active: findColumn(row, ['active', 'activa', 'activo']) as string | boolean | undefined,
    })
  }

  return faqs
}

function findColumn(row: Record<string, unknown>, candidates: string[]): unknown {
  for (const key of candidates) {
    const lowerKey = key.toLowerCase()
    for (const [rowKey, value] of Object.entries(row)) {
      if (rowKey.toLowerCase() === lowerKey) return value
    }
  }
  return undefined
}
