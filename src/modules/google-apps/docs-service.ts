// LUNA — Module: google-apps — Docs Service
// Lectura, edición y creación de Google Docs.

import { google } from 'googleapis'
import type { OAuth2Client } from 'google-auth-library'
import type { DocInfo, DocEditOperation } from './types.js'

export class DocsService {
  private docs

  constructor(auth: OAuth2Client) {
    this.docs = google.docs({ version: 'v1', auth })
  }

  async getDocument(documentId: string): Promise<DocInfo> {
    const res = await this.docs.documents.get({
      documentId,
      includeTabsContent: true,
    })

    // Extract tabs info from response
    const rawTabs = (res.data as Record<string, unknown>).tabs as
      Array<{ tabProperties?: { tabId?: string; title?: string; index?: number }; childTabs?: unknown[] }> | undefined

    const tabs = this.flattenTabs(rawTabs ?? [])

    // Extraer texto plano del body (legacy field — populated from first tab when includeTabsContent=false)
    // With includeTabsContent=true, body may be empty; content lives inside each tab's documentTab.body
    let body = this.extractPlainText(res.data.body?.content ?? [])

    // Bug fix: when includeTabsContent=true, body may be empty — extract from tabs instead
    if (!body.trim() && rawTabs && rawTabs.length > 0) {
      const tabBodies: string[] = []
      for (const tab of rawTabs) {
        const tabData = tab as Record<string, unknown>
        const docTab = tabData.documentTab as Record<string, unknown> | undefined
        if (docTab) {
          const tabBody = docTab.body as Record<string, unknown> | undefined
          const tabContent = (tabBody?.content ?? []) as unknown[]
          const tabText = this.extractPlainText(tabContent)
          if (tabText.trim()) tabBodies.push(tabText)
        }
      }
      if (tabBodies.length > 0) body = tabBodies.join('\n\n')
    }

    return {
      documentId: res.data.documentId ?? documentId,
      title: res.data.title ?? '',
      body,
      revisionId: res.data.revisionId ?? undefined,
      tabs: tabs.length > 0 ? tabs : undefined,
    }
  }

  /** Flatten nested tab tree into a flat array with tabId, title, index */
  private flattenTabs(
    tabs: Array<{ tabProperties?: { tabId?: string; title?: string; index?: number }; childTabs?: unknown[] }>,
  ): Array<{ tabId: string; title: string; index: number }> {
    const result: Array<{ tabId: string; title: string; index: number }> = []
    for (const tab of tabs) {
      if (tab.tabProperties) {
        result.push({
          tabId: tab.tabProperties.tabId ?? '',
          title: tab.tabProperties.title ?? '',
          index: tab.tabProperties.index ?? result.length,
        })
      }
      if (Array.isArray(tab.childTabs)) {
        result.push(...this.flattenTabs(
          tab.childTabs as Array<{ tabProperties?: { tabId?: string; title?: string; index?: number }; childTabs?: unknown[] }>,
        ))
      }
    }
    return result
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

  async batchEdit(
    documentId: string,
    operations: DocEditOperation[],
  ): Promise<{ applied: number }> {
    const replaceOps = operations.filter(op => op.type === 'replace')
    const insertOps = operations.filter(op => op.type === 'insert')
    const appendOps = operations.filter(op => op.type === 'append')

    const hasMixed = replaceOps.length > 0 && (insertOps.length > 0 || appendOps.length > 0)

    // Build replace requests
    const buildReplaceRequests = (ops: DocEditOperation[]) =>
      ops.map(op => ({
        replaceAllText: {
          containsText: { text: op.searchText ?? op.text, matchCase: true },
          replaceText: op.text,
        },
      }))

    // Build insert/append requests given a document endIndex
    const buildInsertAppendRequests = (
      inserts: DocEditOperation[],
      appends: DocEditOperation[],
      endIndex: number,
    ) => {
      const requests: object[] = []

      // Inserts: ordered from largest to smallest index to avoid index displacement
      const sortedInserts = [...inserts].sort((a, b) => (b.index ?? 1) - (a.index ?? 1))
      for (const op of sortedInserts) {
        requests.push({
          insertText: {
            location: { index: op.index ?? 1 },
            text: op.text,
          },
        })
      }

      // Appends: accumulate offset so each insert goes after the previous
      let offset = 0
      const insertIndex = Math.max(endIndex - 1, 1)
      for (const op of appends) {
        requests.push({
          insertText: {
            location: { index: insertIndex + offset },
            text: op.text,
          },
        })
        offset += op.text.length
      }

      return requests
    }

    if (hasMixed) {
      // Two-call strategy: replaces first, then re-fetch endIndex for inserts/appends
      if (replaceOps.length > 0) {
        await this.docs.documents.batchUpdate({
          documentId,
          requestBody: { requests: buildReplaceRequests(replaceOps) },
        })
      }

      if (insertOps.length > 0 || appendOps.length > 0) {
        const doc = await this.docs.documents.get({ documentId })
        const content = doc.data.body?.content ?? []
        const lastElement = content[content.length - 1]
        const endIndex = lastElement?.endIndex ?? 1

        await this.docs.documents.batchUpdate({
          documentId,
          requestBody: { requests: buildInsertAppendRequests(insertOps, appendOps, endIndex) },
        })
      }
    } else if (replaceOps.length > 0) {
      // Only replaces — single call
      await this.docs.documents.batchUpdate({
        documentId,
        requestBody: { requests: buildReplaceRequests(replaceOps) },
      })
    } else if (insertOps.length > 0 || appendOps.length > 0) {
      // Only inserts/appends — single call after fetching endIndex
      const doc = await this.docs.documents.get({ documentId })
      const content = doc.data.body?.content ?? []
      const lastElement = content[content.length - 1]
      const endIndex = lastElement?.endIndex ?? 1

      await this.docs.documents.batchUpdate({
        documentId,
        requestBody: { requests: buildInsertAppendRequests(insertOps, appendOps, endIndex) },
      })
    }

    return { applied: operations.length }
  }

  private extractPlainText(content: unknown[]): string {
    const parts: string[] = []

    // Mapping of Google Docs namedStyleType → Markdown heading prefix
    const HEADING_PREFIX: Record<string, string> = {
      TITLE: '# ',
      HEADING_1: '# ',
      HEADING_2: '## ',
      HEADING_3: '### ',
      HEADING_4: '#### ',
      HEADING_5: '##### ',
      HEADING_6: '###### ',
      SUBTITLE: '## ',
    }

    for (const element of content) {
      const el = element as Record<string, unknown>
      if (el.paragraph) {
        const paragraph = el.paragraph as Record<string, unknown>
        const paragraphStyle = paragraph.paragraphStyle as Record<string, unknown> | undefined
        const namedStyleType = paragraphStyle?.namedStyleType as string | undefined
        const headingPrefix = (namedStyleType && HEADING_PREFIX[namedStyleType]) ? HEADING_PREFIX[namedStyleType]! : ''

        const elements = (paragraph.elements ?? []) as Array<Record<string, unknown>>
        const lineText = elements.map(pe => {
          const textRun = pe.textRun as Record<string, unknown> | undefined
          return textRun?.content ? String(textRun.content) : ''
        }).join('')

        if (lineText.trim()) {
          parts.push(headingPrefix + lineText)
        } else if (lineText) {
          // Preserve whitespace/newline-only runs as-is
          parts.push(lineText)
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
