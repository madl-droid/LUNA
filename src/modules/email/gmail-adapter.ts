// LUNA — Module: email — Gmail Adapter
// Lee, envía, responde y reenvía emails usando la API de Gmail.
// La firma se envía tal cual está configurada en la cuenta de Google, no se genera por el sistema.

import { google } from 'googleapis'
import type { OAuth2Client } from 'google-auth-library'
import pino from 'pino'
import type {
  EmailMessage,
  EmailAttachment,
  EmailSendOptions,
  EmailReplyOptions,
  EmailForwardOptions,
  EmailConfig,
} from './types.js'

const logger = pino({ name: 'email:gmail' })

export class GmailAdapter {
  private gmail
  private noReplyAddresses: Set<string>
  private noReplyPatterns: RegExp[]
  private processLabels: string[]
  private skipLabels: string[]

  constructor(
    private auth: OAuth2Client,
    private config: EmailConfig,
  ) {
    this.gmail = google.gmail({ version: 'v1', auth })
    this.noReplyAddresses = new Set(
      config.EMAIL_NOREPLY_ADDRESSES.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean),
    )
    this.noReplyPatterns = config.EMAIL_NOREPLY_PATTERNS
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
      .map((pattern) => new RegExp(pattern, 'i'))
    this.processLabels = config.EMAIL_PROCESS_LABELS.split(',').map((s) => s.trim()).filter(Boolean)
    this.skipLabels = config.EMAIL_SKIP_LABELS.split(',').map((s) => s.trim()).filter(Boolean)
  }

  // ─── Polling ───────────────────────────────

  async fetchNewMessages(afterHistoryId?: string): Promise<EmailMessage[]> {
    try {
      if (afterHistoryId) {
        return await this.fetchViaHistory(afterHistoryId)
      }
      return await this.fetchUnread()
    } catch (err) {
      logger.error({ err }, 'Failed to fetch new messages')
      throw err
    }
  }

  async getHistoryId(): Promise<string> {
    const profile = await this.gmail.users.getProfile({ userId: 'me' })
    return profile.data.historyId ?? '0'
  }

  private async fetchUnread(): Promise<EmailMessage[]> {
    const labelQuery = this.processLabels.length > 0
      ? this.processLabels.map((l) => `label:${l}`).join(' OR ')
      : 'in:inbox'

    const res = await this.gmail.users.messages.list({
      userId: 'me',
      q: `is:unread (${labelQuery})`,
      maxResults: this.config.EMAIL_MAX_HISTORY_FETCH,
    })

    const messageIds = res.data.messages ?? []
    const messages: EmailMessage[] = []

    for (const msg of messageIds) {
      if (!msg.id) continue
      try {
        const full = await this.getFullMessage(msg.id)
        if (full && !this.shouldSkip(full)) {
          messages.push(full)
        }
      } catch (err) {
        logger.warn({ messageId: msg.id, err }, 'Failed to fetch message')
      }
    }

    return messages
  }

  private async fetchViaHistory(startHistoryId: string): Promise<EmailMessage[]> {
    try {
      const res = await this.gmail.users.history.list({
        userId: 'me',
        startHistoryId,
        historyTypes: ['messageAdded'],
      })

      const histories = res.data.history ?? []
      const messageIds = new Set<string>()

      for (const history of histories) {
        const added = history.messagesAdded ?? []
        for (const item of added) {
          if (item.message?.id) {
            messageIds.add(item.message.id)
          }
        }
      }

      const messages: EmailMessage[] = []
      for (const id of messageIds) {
        try {
          const full = await this.getFullMessage(id)
          if (full && !this.shouldSkip(full)) {
            messages.push(full)
          }
        } catch (err) {
          logger.warn({ messageId: id, err }, 'Failed to fetch message from history')
        }
      }

      return messages
    } catch (err) {
      // History ID puede expirar — fallback a unread
      const error = err as Record<string, unknown>
      if (error.code === 404) {
        logger.warn('History ID expired, falling back to unread fetch')
        return this.fetchUnread()
      }
      throw err
    }
  }

  async getFullMessage(messageId: string): Promise<EmailMessage | null> {
    const res = await this.gmail.users.messages.get({
      userId: 'me',
      id: messageId,
      format: 'full',
    })

    const data = res.data
    if (!data.payload) return null

    const headers = data.payload.headers ?? []
    const getHeader = (name: string): string => {
      const h = headers.find((h) => h.name?.toLowerCase() === name.toLowerCase())
      return h?.value ?? ''
    }

    const from = getHeader('From')
    const fromEmail = this.extractEmail(from)
    const fromName = this.extractName(from)

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const payload = data.payload as any
    const bodyText = this.extractBodyText(payload)
    const bodyHtml = this.extractBodyHtml(payload)
    const attachments = this.extractAttachmentMeta(payload, messageId)

    const inReplyTo = getHeader('In-Reply-To') || null
    const references = getHeader('References').split(/\s+/).filter(Boolean)

    return {
      id: data.id ?? messageId,
      threadId: data.threadId ?? '',
      from: fromEmail,
      fromName,
      to: this.parseAddressList(getHeader('To')),
      cc: this.parseAddressList(getHeader('Cc')),
      bcc: this.parseAddressList(getHeader('Bcc')),
      replyTo: getHeader('Reply-To') ? this.extractEmail(getHeader('Reply-To')) : null,
      subject: getHeader('Subject'),
      bodyText,
      bodyHtml,
      date: new Date(getHeader('Date') || data.internalDate ? Number(data.internalDate) : Date.now()),
      labels: data.labelIds ?? [],
      attachments,
      inReplyTo,
      messageId: getHeader('Message-ID'),
      references,
      isReply: !!inReplyTo,
    }
  }

  async markAsRead(messageId: string): Promise<void> {
    await this.gmail.users.messages.modify({
      userId: 'me',
      id: messageId,
      requestBody: {
        removeLabelIds: ['UNREAD'],
      },
    })
  }

  // ─── Sending ───────────────────────────────

  async sendEmail(options: EmailSendOptions): Promise<{ messageId: string; threadId: string }> {
    const rawEmail = this.buildRawEmail(options)

    const res = await this.gmail.users.messages.send({
      userId: 'me',
      requestBody: {
        raw: rawEmail,
        threadId: options.threadId,
      },
    })

    logger.info({ to: options.to, subject: options.subject, messageId: res.data.id }, 'Email sent')
    return {
      messageId: res.data.id ?? '',
      threadId: res.data.threadId ?? '',
    }
  }

  async reply(options: EmailReplyOptions): Promise<{ messageId: string; threadId: string }> {
    // Obtener mensaje original para construir reply headers
    const original = await this.getFullMessage(options.originalMessageId)
    if (!original) {
      throw new Error(`Original message ${options.originalMessageId} not found`)
    }

    const to = options.replyAll
      ? [...new Set([original.from, ...original.to, ...original.cc])].filter(Boolean)
      : [original.replyTo ?? original.from]

    const references = [...original.references, original.messageId].filter(Boolean)

    const subject = original.subject.startsWith('Re:')
      ? original.subject
      : `Re: ${original.subject}`

    return this.sendEmail({
      to,
      subject,
      bodyHtml: options.bodyHtml,
      bodyText: options.bodyText,
      attachments: options.attachments,
      inReplyTo: original.messageId,
      references,
      threadId: original.threadId,
    })
  }

  async forward(options: EmailForwardOptions): Promise<{ messageId: string; threadId: string }> {
    const original = await this.getFullMessage(options.originalMessageId)
    if (!original) {
      throw new Error(`Original message ${options.originalMessageId} not found`)
    }

    const subject = original.subject.startsWith('Fwd:')
      ? original.subject
      : `Fwd: ${original.subject}`

    const forwardBody = `
${options.additionalText ? `<p>${options.additionalText}</p><hr/>` : ''}
<p>---------- Forwarded message ----------</p>
<p>From: ${original.fromName} &lt;${original.from}&gt;<br/>
Date: ${original.date.toISOString()}<br/>
Subject: ${original.subject}<br/>
To: ${original.to.join(', ')}</p>
<hr/>
${original.bodyHtml || `<pre>${original.bodyText}</pre>`}
`

    // Descargar adjuntos del original para reenviarlos
    const attachments: Array<{ filename: string; mimeType: string; content: Buffer }> = []
    for (const att of original.attachments) {
      try {
        const data = await this.downloadAttachment(original.id, att.id)
        if (data) {
          attachments.push({
            filename: att.filename,
            mimeType: att.mimeType,
            content: data,
          })
        }
      } catch (err) {
        logger.warn({ attachmentId: att.id, err }, 'Failed to download attachment for forward')
      }
    }

    return this.sendEmail({
      to: options.to,
      subject,
      bodyHtml: forwardBody,
      attachments,
      threadId: original.threadId,
    })
  }

  async downloadAttachment(messageId: string, attachmentId: string): Promise<Buffer | null> {
    try {
      const res = await this.gmail.users.messages.attachments.get({
        userId: 'me',
        messageId,
        id: attachmentId,
      })

      if (!res.data.data) return null
      return Buffer.from(res.data.data, 'base64url')
    } catch (err) {
      logger.error({ messageId, attachmentId, err }, 'Failed to download attachment')
      return null
    }
  }

  // ─── No-reply filtering ────────────────────

  isNoReply(email: string): boolean {
    const lower = email.toLowerCase()

    // Explicit list
    if (this.noReplyAddresses.has(lower)) return true

    // Pattern matching
    for (const pattern of this.noReplyPatterns) {
      if (pattern.test(lower)) return true
    }

    // Built-in patterns
    const builtInPatterns = [
      /^noreply@/,
      /^no-reply@/,
      /^donotreply@/,
      /^do-not-reply@/,
      /^mailer-daemon@/,
      /^postmaster@/,
      /notifications?@.*\.google\.com$/,
      /^.*@noreply\.github\.com$/,
    ]

    return builtInPatterns.some((p) => p.test(lower))
  }

  // ─── Private helpers ───────────────────────

  private shouldSkip(message: EmailMessage): boolean {
    // Skip no-reply
    if (this.isNoReply(message.from)) {
      logger.debug({ from: message.from }, 'Skipping no-reply message')
      return true
    }

    // Skip if has skip labels
    if (this.skipLabels.length > 0) {
      const hasSkipLabel = message.labels.some((l) => this.skipLabels.includes(l))
      if (hasSkipLabel) return true
    }

    // Skip sent by self
    if (message.labels.includes('SENT')) return true

    return false
  }

  private buildRawEmail(options: EmailSendOptions): string {
    const boundary = `boundary_${Date.now()}_${Math.random().toString(36).slice(2)}`
    const hasAttachments = options.attachments && options.attachments.length > 0

    const lines: string[] = []

    // Headers
    lines.push(`To: ${options.to.join(', ')}`)
    if (options.cc && options.cc.length > 0) lines.push(`Cc: ${options.cc.join(', ')}`)
    if (options.bcc && options.bcc.length > 0) lines.push(`Bcc: ${options.bcc.join(', ')}`)
    lines.push(`Subject: =?UTF-8?B?${Buffer.from(options.subject).toString('base64')}?=`)
    lines.push('MIME-Version: 1.0')

    if (options.inReplyTo) {
      lines.push(`In-Reply-To: ${options.inReplyTo}`)
    }
    if (options.references && options.references.length > 0) {
      lines.push(`References: ${options.references.join(' ')}`)
    }

    if (hasAttachments) {
      lines.push(`Content-Type: multipart/mixed; boundary="${boundary}"`)
      lines.push('')
      lines.push(`--${boundary}`)
    }

    // Body — HTML es lo que va por defecto (incluye firma de Google)
    lines.push('Content-Type: text/html; charset=UTF-8')
    lines.push('Content-Transfer-Encoding: base64')
    lines.push('')
    lines.push(Buffer.from(options.bodyHtml).toString('base64'))

    // Attachments
    if (hasAttachments && options.attachments) {
      for (const att of options.attachments) {
        lines.push(`--${boundary}`)
        lines.push(`Content-Type: ${att.mimeType}; name="${att.filename}"`)
        lines.push('Content-Transfer-Encoding: base64')
        lines.push(`Content-Disposition: attachment; filename="${att.filename}"`)
        lines.push('')
        const data = typeof att.content === 'string'
          ? Buffer.from(att.content)
          : att.content
        lines.push(data.toString('base64'))
      }
      lines.push(`--${boundary}--`)
    }

    const rawEmail = lines.join('\r\n')
    return Buffer.from(rawEmail)
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '')
  }

  private extractBodyText(payload: Record<string, unknown>): string {
    return this.extractBody(payload, 'text/plain')
  }

  private extractBodyHtml(payload: Record<string, unknown>): string {
    return this.extractBody(payload, 'text/html')
  }

  private extractBody(payload: Record<string, unknown>, mimeType: string): string {
    // Direct body
    if (payload.mimeType === mimeType) {
      const body = payload.body as Record<string, unknown> | undefined
      if (body?.data) {
        return Buffer.from(body.data as string, 'base64url').toString('utf-8')
      }
    }

    // Multipart
    const parts = (payload.parts ?? []) as Array<Record<string, unknown>>
    for (const part of parts) {
      if (part.mimeType === mimeType) {
        const body = part.body as Record<string, unknown> | undefined
        if (body?.data) {
          return Buffer.from(body.data as string, 'base64url').toString('utf-8')
        }
      }
      // Nested multipart
      if ((part.mimeType as string)?.startsWith('multipart/')) {
        const nested = this.extractBody(part, mimeType)
        if (nested) return nested
      }
    }

    return ''
  }

  private extractAttachmentMeta(payload: Record<string, unknown>, messageId: string): EmailAttachment[] {
    const attachments: EmailAttachment[] = []
    this.collectAttachments(payload, messageId, attachments)
    return attachments
  }

  private collectAttachments(
    part: Record<string, unknown>,
    messageId: string,
    result: EmailAttachment[],
  ): void {
    const body = part.body as Record<string, unknown> | undefined
    if (body?.attachmentId && part.filename) {
      result.push({
        id: body.attachmentId as string,
        filename: part.filename as string,
        mimeType: part.mimeType as string ?? 'application/octet-stream',
        size: (body.size as number) ?? 0,
      })
    }

    const parts = (part.parts ?? []) as Array<Record<string, unknown>>
    for (const child of parts) {
      this.collectAttachments(child, messageId, result)
    }
  }

  private extractEmail(header: string): string {
    const match = header.match(/<([^>]+)>/)
    return match ? match[1]! : header.trim()
  }

  private extractName(header: string): string {
    const match = header.match(/^"?([^"<]+)"?\s*</)
    return match ? match[1]!.trim() : this.extractEmail(header)
  }

  private parseAddressList(header: string): string[] {
    if (!header) return []
    return header
      .split(',')
      .map((addr) => this.extractEmail(addr.trim()))
      .filter(Boolean)
  }
}
