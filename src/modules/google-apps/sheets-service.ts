// LUNA — Module: google-apps — Sheets Service
// Lectura, escritura y creación de Google Sheets.

import { google } from 'googleapis'
import type { OAuth2Client } from 'google-auth-library'
import type { SheetRange, SheetProperties, SheetBatchOperation, GoogleApiConfig } from './types.js'
import { googleApiCall } from './api-wrapper.js'

export class SheetsService {
  private sheets
  // FIX: GA-3 — API timeout/retry config
  private apiConfig: { timeoutMs: number; maxRetries: number }

  constructor(auth: OAuth2Client, config?: GoogleApiConfig) {
    this.sheets = google.sheets({ version: 'v4', auth })
    this.apiConfig = {
      timeoutMs: config?.GOOGLE_API_TIMEOUT_MS ?? 30000,
      maxRetries: config?.GOOGLE_API_RETRY_MAX ?? 2,
    }
  }

  async getSpreadsheet(spreadsheetId: string): Promise<SheetProperties> {
    const res = await googleApiCall(() => this.sheets.spreadsheets.get({
      spreadsheetId,
      fields: 'spreadsheetId,properties.title,sheets.properties',
    }), this.apiConfig, 'sheets.spreadsheets.get')

    return {
      spreadsheetId: res.data.spreadsheetId ?? spreadsheetId,
      title: res.data.properties?.title ?? '',
      sheets: (res.data.sheets ?? []).map((s) => ({
        sheetId: s.properties?.sheetId ?? 0,
        title: s.properties?.title ?? '',
        rowCount: s.properties?.gridProperties?.rowCount ?? 0,
        columnCount: s.properties?.gridProperties?.columnCount ?? 0,
      })),
    }
  }

  async readRange(spreadsheetId: string, range: string): Promise<SheetRange> {
    const res = await googleApiCall(() => this.sheets.spreadsheets.values.get({
      spreadsheetId,
      range,
    }), this.apiConfig, 'sheets.values.get')

    return {
      spreadsheetId,
      range: res.data.range ?? range,
      values: (res.data.values ?? []) as string[][],
    }
  }

  async writeRange(
    spreadsheetId: string,
    range: string,
    values: string[][],
    inputOption: 'RAW' | 'USER_ENTERED' = 'USER_ENTERED',
  ): Promise<{ updatedCells: number; updatedRows: number }> {
    const res = await this.sheets.spreadsheets.values.update({
      spreadsheetId,
      range,
      valueInputOption: inputOption,
      requestBody: { values },
    })

    return {
      updatedCells: res.data.updatedCells ?? 0,
      updatedRows: res.data.updatedRows ?? 0,
    }
  }

  async appendRows(
    spreadsheetId: string,
    range: string,
    values: string[][],
    inputOption: 'RAW' | 'USER_ENTERED' = 'USER_ENTERED',
  ): Promise<{ updatedCells: number; updatedRows: number }> {
    const res = await googleApiCall(() => this.sheets.spreadsheets.values.append({
      spreadsheetId,
      range,
      valueInputOption: inputOption,
      insertDataOption: 'INSERT_ROWS',
      requestBody: { values },
    }), this.apiConfig, 'sheets.values.append')

    return {
      updatedCells: res.data.updates?.updatedCells ?? 0,
      updatedRows: res.data.updates?.updatedRows ?? 0,
    }
  }

  async clearRange(spreadsheetId: string, range: string): Promise<void> {
    await this.sheets.spreadsheets.values.clear({
      spreadsheetId,
      range,
      requestBody: {},
    })
  }

  async createSpreadsheet(title: string): Promise<SheetProperties> {
    const res = await this.sheets.spreadsheets.create({
      requestBody: {
        properties: { title },
      },
      fields: 'spreadsheetId,properties.title,sheets.properties',
    })

    return {
      spreadsheetId: res.data.spreadsheetId ?? '',
      title: res.data.properties?.title ?? title,
      sheets: (res.data.sheets ?? []).map((s) => ({
        sheetId: s.properties?.sheetId ?? 0,
        title: s.properties?.title ?? '',
        rowCount: s.properties?.gridProperties?.rowCount ?? 0,
        columnCount: s.properties?.gridProperties?.columnCount ?? 0,
      })),
    }
  }

  async addSheet(spreadsheetId: string, title: string): Promise<{ sheetId: number }> {
    const res = await this.sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: {
        requests: [{ addSheet: { properties: { title } } }],
      },
    })

    const reply = res.data.replies?.[0]
    return { sheetId: reply?.addSheet?.properties?.sheetId ?? 0 }
  }

  /**
   * Obtiene las validaciones de datos de una fila específica.
   * Retorna un array donde cada elemento es la validación de esa columna (null = sin validación).
   */
  async getRowValidations(
    spreadsheetId: string,
    sheetTitle: string,
    rowIndex: number,
  ): Promise<Array<Record<string, unknown> | null>> {
    const row = rowIndex + 1 // 0-based → 1-based
    const res = await googleApiCall(
      () =>
        this.sheets.spreadsheets.get({
          spreadsheetId,
          ranges: [`'${sheetTitle}'!${row}:${row}`],
          fields: 'sheets.data.rowData.values.dataValidation',
        }),
      this.apiConfig,
      'sheets.spreadsheets.get(validations)',
    )

    const rowData = res.data.sheets?.[0]?.data?.[0]?.rowData?.[0]
    if (!rowData?.values) return []

    return rowData.values.map((cell) => (cell.dataValidation ?? null) as Record<string, unknown> | null)
  }

  /**
   * Aplica validaciones de datos a un rango de filas comenzando en startRow.
   * validations[i] = regla de validación para columna i (null = sin validación).
   */
  async applyValidations(
    spreadsheetId: string,
    sheetId: number,
    validations: Array<Record<string, unknown> | null>,
    startRow: number,
    numRows: number,
  ): Promise<void> {
    const requests = validations
      .map((rule, colIndex) => {
        if (!rule) return null
        return {
          setDataValidation: {
            range: {
              sheetId,
              startRowIndex: startRow,
              endRowIndex: startRow + numRows,
              startColumnIndex: colIndex,
              endColumnIndex: colIndex + 1,
            },
            rule,
          },
        }
      })
      .filter(Boolean)

    if (requests.length === 0) return

    await googleApiCall(
      () =>
        this.sheets.spreadsheets.batchUpdate({
          spreadsheetId,
          requestBody: { requests },
        }),
      this.apiConfig,
      'sheets.spreadsheets.batchUpdate(applyValidations)',
    )
  }

  /**
   * Append rows and restore data validations (dropdowns) from the last data row.
   * Used by both the sheets-append tool handler and batchEdit.
   */
  async appendWithValidations(
    spreadsheetId: string,
    range: string,
    values: string[][],
  ): Promise<{ updatedCells: number; updatedRows: number }> {
    // Parsear sheetTitle del range (ej: "Sheet1" de "Sheet1!A:D" o "'Mi hoja'!A:D")
    const sheetTitleMatch = /^'?([^'!]+)'?!/.exec(range)
    const sheetTitle = sheetTitleMatch?.[1] ?? range.split('!')[0] ?? 'Sheet1'

    // Best-effort: capturar validaciones antes del append
    let sheetId: number | undefined
    let lastDataRow = 0
    let validations: Array<Record<string, unknown> | null> = []
    try {
      const info = await this.getSpreadsheet(spreadsheetId)
      const sheetMeta = info.sheets.find((s) => s.title === sheetTitle)
      sheetId = sheetMeta?.sheetId
      const existing = await this.readRange(spreadsheetId, range)
      lastDataRow = existing.values.length > 0 ? existing.values.length - 1 : 0
      if (sheetId !== undefined && lastDataRow > 0) {
        validations = await this.getRowValidations(spreadsheetId, sheetTitle, lastDataRow)
      }
    } catch {
      // best-effort — continuar sin validaciones
    }

    // Ejecutar append
    const result = await this.appendRows(spreadsheetId, range, values)

    // Restaurar validaciones (fire-and-forget)
    if (sheetId !== undefined && validations.some((v) => v !== null)) {
      this.applyValidations(spreadsheetId, sheetId, validations, lastDataRow + 1, values.length).catch(() => {})
    }

    return result
  }

  /**
   * Busca un texto en toda la hoja (o en una hoja específica) y lo reemplaza.
   */
  async findReplace(
    spreadsheetId: string,
    find: string,
    replacement: string,
    options?: { sheetId?: number; matchCase?: boolean; matchEntireCell?: boolean },
  ): Promise<{ occurrencesChanged: number; sheetsChanged: number }> {
    const res = await googleApiCall(
      () =>
        this.sheets.spreadsheets.batchUpdate({
          spreadsheetId,
          requestBody: {
            requests: [
              {
                findReplace: {
                  find,
                  replacement,
                  matchCase: options?.matchCase ?? false,
                  matchEntireCell: options?.matchEntireCell ?? false,
                  allSheets: options?.sheetId === undefined,
                  sheetId: options?.sheetId,
                },
              },
            ],
          },
        }),
      this.apiConfig,
      'sheets.spreadsheets.batchUpdate(findReplace)',
    )

    const reply = res.data.replies?.[0]?.findReplace
    return {
      occurrencesChanged: reply?.occurrencesChanged ?? 0,
      sheetsChanged: reply?.sheetsChanged ?? 0,
    }
  }

  /**
   * Ejecuta múltiples operaciones (write, append, clear, find_replace) en una sola llamada.
   * Agrupa por tipo para minimizar llamadas a la API.
   */
  async batchEdit(
    spreadsheetId: string,
    operations: SheetBatchOperation[],
  ): Promise<{ results: Array<{ type: string; detail: unknown }> }> {
    const results: Array<{ type: string; detail: unknown }> = []

    // WRITES — batchUpdate values
    const writeOps = operations.filter((op) => op.type === 'write' && op.range && op.values)
    if (writeOps.length > 0) {
      const res = await googleApiCall(
        () =>
          this.sheets.spreadsheets.values.batchUpdate({
            spreadsheetId,
            requestBody: {
              valueInputOption: 'USER_ENTERED',
              data: writeOps.map((op) => ({ range: op.range!, values: op.values! })),
            },
          }),
        this.apiConfig,
        'sheets.values.batchUpdate',
      )
      results.push({ type: 'write', detail: { updatedCells: res.data.totalUpdatedCells ?? 0 } })
    }

    // APPENDS — ejecutar secuencialmente con restauración de validaciones
    const appendOps = operations.filter((op) => op.type === 'append' && op.range && op.values)
    for (const op of appendOps) {
      const r = await this.appendWithValidations(spreadsheetId, op.range!, op.values!)
      results.push({ type: 'append', detail: r })
    }

    // CLEARS — batchClear
    const clearOps = operations.filter((op) => op.type === 'clear' && op.range)
    if (clearOps.length > 0) {
      await googleApiCall(
        () =>
          this.sheets.spreadsheets.values.batchClear({
            spreadsheetId,
            requestBody: { ranges: clearOps.map((op) => op.range!) },
          }),
        this.apiConfig,
        'sheets.values.batchClear',
      )
      results.push({ type: 'clear', detail: { clearedRanges: clearOps.length } })
    }

    // FIND_REPLACE — batchUpdate con múltiples FindReplaceRequests
    const frOps = operations.filter((op) => op.type === 'find_replace' && op.find !== undefined && op.replacement !== undefined)
    if (frOps.length > 0) {
      const res = await googleApiCall(
        () =>
          this.sheets.spreadsheets.batchUpdate({
            spreadsheetId,
            requestBody: {
              requests: frOps.map((op) => ({
                findReplace: {
                  find: op.find!,
                  replacement: op.replacement!,
                  matchCase: op.matchCase ?? false,
                  matchEntireCell: false,
                  allSheets: true,
                },
              })),
            },
          }),
        this.apiConfig,
        'sheets.spreadsheets.batchUpdate(batchFindReplace)',
      )
      const occurrences = (res.data.replies ?? []).reduce(
        (sum, r) => sum + (r.findReplace?.occurrencesChanged ?? 0),
        0,
      )
      results.push({ type: 'find_replace', detail: { occurrencesChanged: occurrences } })
    }

    return { results }
  }
}
