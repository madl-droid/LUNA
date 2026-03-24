// LUNA — Module: google-apps — Docs Service
// Lectura, edición y creación de Google Docs.

import { google } from 'googleapis'
import type { OAuth2Client } from 'google-auth-library'
import pino from 'pino'
import type { DocInfo } from './types.js'

const logger = pino({ name: 'google-apps:docs' })

export class DocsService {
  private docs

  constructor(private auth: OAuth2Client) {
    this.docs = google.docs({ version: 'v1', auth })
  }

  async getDocument(documentId: string): Promise<DocInfo> {
    const res = await this.docs.documents.get({ documentId })

    // Extraer texto plano del body
    const body = this.extractPlainText(res.data.body?.content ?? [])

    return {
      documentId: res.data.documentId ?? documentId,
      title: res.data.title ?? '',
      body,
      revisionId: res.data.revisionId ?? undefined,
    }
  }

  async createDocument(title: string, content?: string): Promise<DocInfo> {
    const res = await this.docs.documents.create({
      requestBody: { title },
    })

    const documentId = res.data.documentId ?? ''

    // Si hay contenido, insertarlo
    if (content && documentId) {
      await this.docs.documents.batchUpdate({
        documentId,
        requestBody: {
          requests: [
            {
              insertText: {
                location: { index: 1 },
                text: content,
              },
            },
          ],
        },
      })
    }

    return {
      documentId,
      title: res.data.title ?? title,
      body: content ?? '',
    }
  }

  async insertText(documentId: string, text: string, index?: number): Promise<void> {
    await this.docs.documents.batchUpdate({
      documentId,
      requestBody: {
        requests: [
          {
            insertText: {
              location: { index: index ?? 1 },
              text,
            },
          },
        ],
      },
    })
  }

  async replaceText(documentId: string, searchText: string, replaceText: string): Promise<number> {
    const res = await this.docs.documents.batchUpdate({
      documentId,
      requestBody: {
        requests: [
          {
            replaceAllText: {
              containsText: { text: searchText, matchCase: true },
              replaceText,
            },
          },
        ],
      },
    })

    const reply = res.data.replies?.[0]
    return reply?.replaceAllText?.occurrencesChanged ?? 0
  }

  async appendText(documentId: string, text: string): Promise<void> {
    // Obtener longitud del documento para insertar al final
    const doc = await this.docs.documents.get({ documentId })
    const content = doc.data.body?.content ?? []
    const lastElement = content[content.length - 1]
    const endIndex = lastElement?.endIndex ?? 1

    await this.docs.documents.batchUpdate({
      documentId,
      requestBody: {
        requests: [
          {
            insertText: {
              location: { index: Math.max(endIndex - 1, 1) },
              text,
            },
          },
        ],
      },
    })
  }

  private extractPlainText(content: unknown[]): string {
    const parts: string[] = []

    for (const element of content) {
      const el = element as Record<string, unknown>
      if (el.paragraph) {
        const paragraph = el.paragraph as Record<string, unknown>
        const elements = (paragraph.elements ?? []) as Array<Record<string, unknown>>
        for (const pe of elements) {
          const textRun = pe.textRun as Record<string, unknown> | undefined
          if (textRun?.content) {
            parts.push(String(textRun.content))
          }
        }
      } else if (el.table) {
        // Extraer texto de tablas recursivamente
        const table = el.table as Record<string, unknown>
        const rows = (table.tableRows ?? []) as Array<Record<string, unknown>>
        for (const row of rows) {
          const cells = (row.tableCells ?? []) as Array<Record<string, unknown>>
          for (const cell of cells) {
            const cellContent = (cell.content ?? []) as unknown[]
            parts.push(this.extractPlainText(cellContent))
          }
        }
      }
    }

    return parts.join('')
  }
}
