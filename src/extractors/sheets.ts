// LUNA — Global Extractors — Sheets / Excel / CSV
// Extrae hojas de cálculo con estructura: headers separados + filas.
// XLSX/XLS: hoja por hoja. CSV: una sola hoja.
// Todas las hojas referencian al mismo archivo padre via parentId.

import { randomUUID } from 'node:crypto'
import type { ExtractedContent, ExtractedSection, SheetsResult, ExtractedSheet } from './types.js'
import { MAX_FILE_SIZE } from './utils.js'

// ═══════════════════════════════════════════
// Resultado estructurado (nuevo)
// ═══════════════════════════════════════════

/**
 * Extrae hojas de cálculo con estructura completa.
 * Retorna SheetsResult con headers y filas separadas.
 */
export async function extractSheets(input: Buffer, fileName: string): Promise<SheetsResult> {
  if (input.length > MAX_FILE_SIZE) {
    throw new Error(`Sheets file too large: ${(input.length / 1024 / 1024).toFixed(1)}MB exceeds ${MAX_FILE_SIZE / 1024 / 1024}MB limit`)
  }

  const XLSX = await import('xlsx')
  const workbook = XLSX.read(input, { type: 'buffer' })
  const parentId = randomUUID()
  const sheets: ExtractedSheet[] = []

  for (let i = 0; i < workbook.SheetNames.length; i++) {
    const sheetName = workbook.SheetNames[i]!
    const sheet = workbook.Sheets[sheetName]
    if (!sheet) continue

    const jsonData = XLSX.utils.sheet_to_json(sheet, { defval: '', header: 1 }) as unknown[][]
    if (jsonData.length === 0) continue

    // Primera fila = headers
    const headerRow = jsonData[0]
    if (!headerRow) continue

    const headers = headerRow.map(cell => String(cell ?? '').trim())

    // Resto = filas de datos
    const rows: string[][] = []
    for (let r = 1; r < jsonData.length; r++) {
      const rawRow = jsonData[r]
      if (!rawRow) continue
      const row = rawRow.map(cell => String(cell ?? '').trim())
      // Saltar filas completamente vacías
      if (row.every(cell => cell === '')) continue
      rows.push(row)
    }

    if (rows.length === 0 && headers.every(h => h === '')) continue

    sheets.push({
      name: sheetName,
      position: i,
      headers,
      rows,
    })
  }

  return {
    kind: 'sheets',
    parentId,
    fileName,
    sheets,
    metadata: {
      sizeBytes: input.length,
      originalName: fileName,
      extractorUsed: 'xlsx',
    },
  }
}

// ═══════════════════════════════════════════
// Backward-compatible (devuelve ExtractedContent)
// Para consumers existentes que esperan text + sections
// ═══════════════════════════════════════════

/**
 * Extrae hojas de cálculo y devuelve ExtractedContent.
 * Formato: cada fila como "header1: val1 | header2: val2".
 */
export async function extractXlsx(input: Buffer, fileName: string): Promise<ExtractedContent> {
  const result = await extractSheets(input, fileName)

  const sections: ExtractedSection[] = []
  const allText: string[] = []

  for (const sheet of result.sheets) {
    const rows: string[] = []
    for (const row of sheet.rows) {
      const parts: string[] = []
      for (let c = 0; c < sheet.headers.length; c++) {
        const header = sheet.headers[c] ?? `Col${c + 1}`
        const value = row[c] ?? ''
        if (value !== '') {
          parts.push(`${header}: ${value}`)
        }
      }
      if (parts.length > 0) rows.push(parts.join(' | '))
    }

    const content = rows.join('\n')
    allText.push(content)
    sections.push({ title: sheet.name, content })
  }

  return {
    text: allText.join('\n\n'),
    sections,
    metadata: result.metadata,
  }
}
