// LUNA — Global Extractors — Sheets / Excel / CSV
// Extrae hojas de cálculo con estructura: headers separados + filas.
// XLSX: hoja por hoja. CSV: una sola hoja.
// Todas las hojas referencian al mismo archivo padre via parentId.

import { randomUUID } from 'node:crypto'
import { JSDOM } from 'jsdom'
import type { ExtractedContent, ExtractedSection, SheetsResult, ExtractedSheet } from './types.js'
import { MAX_FILE_SIZE } from './utils.js'

// ═══════════════════════════════════════════
// Resultado estructurado (nuevo)
// ═══════════════════════════════════════════

function isZipSpreadsheet(input: Buffer): boolean {
  return input.length >= 4
    && input[0] === 0x50
    && input[1] === 0x4b
    && input[2] === 0x03
    && input[3] === 0x04
}

function parseXml(xml: string): Document {
  return new JSDOM(xml, { contentType: 'text/xml' }).window.document
}

function columnRefToIndex(ref: string): number {
  let result = 0
  for (const char of ref.toUpperCase()) {
    if (char < 'A' || char > 'Z') break
    result = (result * 26) + (char.charCodeAt(0) - 64)
  }
  return Math.max(result - 1, 0)
}

function parseCsvRows(text: string): string[][] {
  const rows: string[][] = []
  let currentRow: string[] = []
  let currentCell = ''
  let inQuotes = false

  for (let i = 0; i < text.length; i++) {
    const char = text[i]!
    const next = text[i + 1]

    if (char === '"') {
      if (inQuotes && next === '"') {
        currentCell += '"'
        i++
      } else {
        inQuotes = !inQuotes
      }
      continue
    }

    if (!inQuotes && char === ',') {
      currentRow.push(currentCell.trim())
      currentCell = ''
      continue
    }

    if (!inQuotes && (char === '\n' || char === '\r')) {
      if (char === '\r' && next === '\n') i++
      currentRow.push(currentCell.trim())
      currentCell = ''
      if (currentRow.some(cell => cell !== '')) rows.push(currentRow)
      currentRow = []
      continue
    }

    currentCell += char
  }

  if (currentCell.length > 0 || currentRow.length > 0) {
    currentRow.push(currentCell.trim())
    if (currentRow.some(cell => cell !== '')) rows.push(currentRow)
  }

  return rows
}

async function parseCsvSheet(input: Buffer, fileName: string): Promise<ExtractedSheet[]> {
  const rows = parseCsvRows(input.toString('utf-8'))
  if (rows.length === 0) return []

  const [headerRow, ...dataRows] = rows
  return [{
    name: fileName.replace(/\.[^.]+$/, '') || 'Sheet1',
    position: 0,
    headers: (headerRow ?? []).map(cell => cell.trim()),
    rows: dataRows.map(row => row.map(cell => cell.trim())),
  }]
}

function readSharedString(si: Element): string {
  return Array.from(si.getElementsByTagName('t'))
    .map(node => node.textContent ?? '')
    .join('')
}

function readCellValue(cell: Element, sharedStrings: string[]): string {
  const cellType = cell.getAttribute('t') ?? ''

  if (cellType === 'inlineStr') {
    return Array.from(cell.getElementsByTagName('t'))
      .map(node => node.textContent ?? '')
      .join('')
      .trim()
  }

  const rawValue = cell.getElementsByTagName('v')[0]?.textContent ?? ''
  if (cellType === 's') {
    const sharedIndex = Number(rawValue)
    return sharedStrings[sharedIndex] ?? ''
  }
  if (cellType === 'b') {
    return rawValue === '1' ? 'TRUE' : 'FALSE'
  }
  return rawValue.trim()
}

async function parseXlsxSheets(input: Buffer): Promise<ExtractedSheet[]> {
  const { default: JSZip } = await import('jszip')
  const zip = await JSZip.loadAsync(input)

  const workbookXml = await zip.file('xl/workbook.xml')?.async('string')
  const relsXml = await zip.file('xl/_rels/workbook.xml.rels')?.async('string')
  if (!workbookXml || !relsXml) {
    throw new Error('Invalid XLSX file: workbook metadata is missing')
  }

  const workbookDoc = parseXml(workbookXml)
  const relsDoc = parseXml(relsXml)
  const sharedStringsXml = await zip.file('xl/sharedStrings.xml')?.async('string')
  const sharedStrings = sharedStringsXml
    ? Array.from(parseXml(sharedStringsXml).getElementsByTagName('si')).map(readSharedString)
    : []

  const relMap = new Map<string, string>()
  for (const rel of Array.from(relsDoc.getElementsByTagName('Relationship'))) {
    const id = rel.getAttribute('Id')
    const target = rel.getAttribute('Target')
    if (!id || !target) continue
    relMap.set(id, target.startsWith('/') ? target.slice(1) : `xl/${target.replace(/^\/+/, '')}`)
  }

  const sheets: ExtractedSheet[] = []
  const sheetNodes = Array.from(workbookDoc.getElementsByTagName('sheet'))

  for (let i = 0; i < sheetNodes.length; i++) {
    const sheetNode = sheetNodes[i]!
    const sheetName = sheetNode.getAttribute('name') ?? `Sheet${i + 1}`
    const relId = sheetNode.getAttribute('r:id') ?? sheetNode.getAttribute('id')
    if (!relId) continue

    const sheetPath = relMap.get(relId)
    if (!sheetPath) continue

    const sheetXml = await zip.file(sheetPath)?.async('string')
    if (!sheetXml) continue

    const sheetDoc = parseXml(sheetXml)
    const rowNodes = Array.from(sheetDoc.getElementsByTagName('row'))
    const parsedRows: string[][] = []

    for (const rowNode of rowNodes) {
      const row: string[] = []
      for (const cell of Array.from(rowNode.getElementsByTagName('c'))) {
        const ref = cell.getAttribute('r') ?? ''
        const colIndex = columnRefToIndex(ref.replace(/\d+/g, ''))
        while (row.length <= colIndex) row.push('')
        row[colIndex] = readCellValue(cell, sharedStrings)
      }
      if (row.some(cell => cell !== '')) parsedRows.push(row)
    }

    if (parsedRows.length === 0) continue

    const [headerRow, ...dataRows] = parsedRows
    sheets.push({
      name: sheetName,
      position: i,
      headers: (headerRow ?? []).map(cell => cell.trim()),
      rows: dataRows.map(row => row.map(cell => cell.trim())),
    })
  }

  return sheets
}

export async function readSpreadsheetSheets(input: Buffer, fileName: string): Promise<ExtractedSheet[]> {
  const lowerName = fileName.toLowerCase()
  if (lowerName.endsWith('.csv') || !isZipSpreadsheet(input)) {
    if (!lowerName.endsWith('.csv')) {
      throw new Error('Legacy .xls spreadsheets are not supported by the secure parser')
    }
    return parseCsvSheet(input, fileName)
  }
  return parseXlsxSheets(input)
}

/**
 * Extrae hojas de cálculo con estructura completa.
 * Retorna SheetsResult con headers y filas separadas.
 */
export async function extractSheets(input: Buffer, fileName: string): Promise<SheetsResult> {
  if (input.length > MAX_FILE_SIZE) {
    throw new Error(`Sheets file too large: ${(input.length / 1024 / 1024).toFixed(1)}MB exceeds ${MAX_FILE_SIZE / 1024 / 1024}MB limit`)
  }

  const parentId = randomUUID()
  const sheets = await readSpreadsheetSheets(input, fileName)

  // Generar CSV buffer para guardar como binario
  const csvLines: string[] = []
  for (const sheet of sheets) {
    csvLines.push(`# Sheet: ${sheet.name}`)
    csvLines.push(sheet.headers.join(','))
    for (const row of sheet.rows) {
      csvLines.push(row.map(cell => cell.includes(',') || cell.includes('"') ? `"${cell.replace(/"/g, '""')}"` : cell).join(','))
    }
    csvLines.push('')
  }
  const csvBuffer = Buffer.from(csvLines.join('\n'), 'utf-8')

  return {
    kind: 'sheets',
    parentId,
    fileName,
    sheets,
    csvBuffer,
    metadata: {
      sizeBytes: input.length,
      originalName: fileName,
      extractorUsed: isZipSpreadsheet(input) ? 'jszip' : 'csv',
      sheetCount: sheets.length,
      totalRows: sheets.reduce((sum, s) => sum + s.rows.length, 0),
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
