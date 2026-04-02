// LUNA — Knowledge — Excel/CSV Extractor (SHIM)
// Re-exports from global src/extractors/sheets.ts
// parseFAQsFromXlsx stays here — it is knowledge-specific business logic.

export { extractXlsx } from '../../../extractors/sheets.js'

import type { FAQImportRow } from '../types.js'
import { readSpreadsheetSheets } from '../../../extractors/sheets.js'

/**
 * Parse an Excel/CSV file as FAQ import data.
 * Expects columns: question, answer, variants (optional), category (optional), active (optional)
 */
export async function parseFAQsFromXlsx(input: Buffer): Promise<FAQImportRow[]> {
  const [firstSheet] = await readSpreadsheetSheets(input, 'faq-import.xlsx')
  if (!firstSheet) return []

  const rows = firstSheet.rows.map((row) => {
    const entry: Record<string, unknown> = {}
    for (let i = 0; i < firstSheet.headers.length; i++) {
      const header = firstSheet.headers[i]?.trim()
      if (!header) continue
      entry[header] = row[i] ?? ''
    }
    return entry
  })
  const faqs: FAQImportRow[] = []

  for (const row of rows) {
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
