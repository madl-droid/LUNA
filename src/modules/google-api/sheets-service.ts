// LUNA — Module: google-api — Sheets Service
// Lectura, escritura y creación de Google Sheets.

import { google } from 'googleapis'
import type { OAuth2Client } from 'google-auth-library'
import pino from 'pino'
import type { SheetRange, SheetProperties } from './types.js'

const logger = pino({ name: 'google-api:sheets' })

export class SheetsService {
  private sheets

  constructor(private auth: OAuth2Client) {
    this.sheets = google.sheets({ version: 'v4', auth })
  }

  async getSpreadsheet(spreadsheetId: string): Promise<SheetProperties> {
    const res = await this.sheets.spreadsheets.get({
      spreadsheetId,
      fields: 'spreadsheetId, properties.title, sheets.properties',
    })

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
    const res = await this.sheets.spreadsheets.values.get({
      spreadsheetId,
      range,
    })

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
    const res = await this.sheets.spreadsheets.values.append({
      spreadsheetId,
      range,
      valueInputOption: inputOption,
      insertDataOption: 'INSERT_ROWS',
      requestBody: { values },
    })

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
      fields: 'spreadsheetId, properties.title, sheets.properties',
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
}
