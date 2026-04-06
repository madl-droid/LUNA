// LUNA — Module: gmail — Email Body Cleaner
// Strips noise from email body text before sending to the engine.
// The original bodyText is preserved intact for signature-parser and DB persistence.
// This module produces cleanBodyText which is used as content.text in message:incoming.

/** Strip HTML tags and decode common entities to plain text. */
export function stripHtml(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<\/div>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/**
 * Clean an email body by removing quoted replies, disclaimers,
 * third-party signatures, and compacting forward headers.
 */
export function cleanEmailBody(bodyText: string): string {
  if (!bodyText) return ''

  let text = bodyText

  // Order matters: forwards first (preserve body, compact headers),
  // then quoted replies, then signatures, then disclaimers.
  text = compactForwardHeaders(text)
  text = stripQuotedReplies(text)
  text = stripThirdPartySignatures(text)
  text = stripDisclaimers(text)

  // Final cleanup
  text = text.replace(/\n{3,}/g, '\n\n').trim()

  return text
}

// ── Quoted replies ───────────────────────────────────────────

/**
 * Pattern for "On <date>, <person> wrote:" in multiple languages.
 * Requires a date-like fragment (digit or month word) between the prefix and "wrote"
 * to avoid false positives like "El cliente escribió: quiero el plan".
 */
const WROTE_LINE = /^(?:On |El |Em |Le |Am )(?=.*\d).{10,80}(?:wrote|escribi[oó]|escreveu|[eé]crit|schrieb)\s*:?\s*$/im

/**
 * Strip quoted reply blocks.
 * Detects "> " prefixed lines and "On ... wrote:" headers.
 * Keeps everything before the first quote block.
 */
function stripQuotedReplies(text: string): string {
  const lines = text.split('\n')
  const result: string[] = []
  let inQuoteBlock = false

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!

    // "On March 15, Juan wrote:" — start of quote block
    if (!inQuoteBlock && WROTE_LINE.test(line)) {
      inQuoteBlock = true
      continue
    }

    // Lines starting with ">" are quoted
    if (line.startsWith('>')) {
      inQuoteBlock = true
      continue
    }

    // If we were in a quote block and hit a non-quoted non-empty line,
    // we might be back to original content (rare: inline reply after quotes)
    if (inQuoteBlock && line.trim().length > 0 && !line.startsWith('>')) {
      // Check if next few lines are also non-quoted — if so, it's real content
      const nextLines = lines.slice(i, i + 3)
      const nonQuoted = nextLines.filter(l => !l!.startsWith('>') && l!.trim().length > 0)
      if (nonQuoted.length >= 2) {
        inQuoteBlock = false
      } else {
        continue
      }
    }

    if (!inQuoteBlock) {
      result.push(line)
    }
  }

  return result.join('\n')
}

// ── Forward headers ──────────────────────────────────────────

const FORWARD_PATTERNS = [
  /^-{5,}\s*Forwarded message\s*-{5,}\s*$/im,
  /^-{5,}\s*Mensaje reenviado\s*-{5,}\s*$/im,
  /^-{5,}\s*Mensagem encaminhada\s*-{5,}\s*$/im,
  /^Begin forwarded message\s*:?\s*$/im,
]

const FORWARD_HEADER_KEYS = /^(?:From|De|To|Para|A|Date|Fecha|Subject|Asunto)\s*:/i

/**
 * Compact forward headers into a single-line summary.
 * Preserves the forwarded body content.
 *
 * Before: "---------- Forwarded message ----------\nFrom: x@y.com\nDate: ...\nSubject: RE: Quote\n\nActual content"
 * After:  "[Forwarded from x@y.com — \"RE: Quote\"]:\nActual content"
 */
function compactForwardHeaders(text: string): string {
  const lines = text.split('\n')
  const result: string[] = []
  let i = 0

  while (i < lines.length) {
    const line = lines[i]!

    // Check if this line matches a forward delimiter
    const isForward = FORWARD_PATTERNS.some(p => p.test(line))
    if (!isForward) {
      result.push(line)
      i++
      continue
    }

    // Parse forward headers
    let from = ''
    let subject = ''
    i++ // skip delimiter line

    while (i < lines.length) {
      const headerLine = lines[i]!
      if (headerLine.trim() === '') {
        i++ // skip empty line after headers
        break
      }
      if (!FORWARD_HEADER_KEYS.test(headerLine)) break

      const lower = headerLine.toLowerCase()
      if (lower.startsWith('from:') || lower.startsWith('de:')) {
        from = headerLine.replace(/^(?:From|De)\s*:\s*/i, '').trim()
      } else if (lower.startsWith('subject:') || lower.startsWith('asunto:')) {
        subject = headerLine.replace(/^(?:Subject|Asunto)\s*:\s*/i, '').trim()
      }
      i++
    }

    // Build compact line
    const parts: string[] = []
    if (from) parts.push(`from ${from}`)
    if (subject) parts.push(`"${subject}"`)
    const compact = parts.length > 0
      ? `[Forwarded ${parts.join(' — ')}]:`
      : '[Forwarded message]:'
    result.push(compact)
  }

  return result.join('\n')
}

// ── Third-party signatures ───────────────────────────────────

const SIGNATURE_DELIMITERS = [
  /^-- ?\n/m,          // Standard delimiter (RFC 3676)
  /^_{3,}\s*$/m,       // _____ line
  /^—\s*$/m,           // Em dash line
]

/**
 * Strip third-party signatures (content after signature delimiter).
 * Only strips if the delimiter is in the last 30% of the text
 * (to avoid false positives from "-- " used as a separator mid-text).
 */
function stripThirdPartySignatures(text: string): string {
  for (const delim of SIGNATURE_DELIMITERS) {
    const match = delim.exec(text)
    if (!match) continue

    const position = match.index
    const ratio = position / text.length

    // Only strip if delimiter is in the last 30% of text
    if (ratio >= 0.7) {
      return text.substring(0, position).trimEnd()
    }
  }

  return text
}

// ── Disclaimers ──────────────────────────────────────────────

const DISCLAIMER_PATTERNS = [
  /^(?:CONFIDENTIALITY|DISCLAIMER|AVISO LEGAL|AVISO DE CONFIDENCIALIDAD|LEGAL NOTICE|NOTICE OF CONFIDENTIALITY).{0,20}$/im,
  /^Este (?:correo|mensaje|e-?mail).{0,30}(?:confidencial|privado)/im,
  /^This (?:email|message|communication).{0,30}(?:confidential|privileged|intended)/im,
  /^(?:Si usted no es el destinatario|If you are not the intended recipient)/im,
]

/**
 * Strip legal disclaimers. Removes everything from the disclaimer start to end of text.
 */
function stripDisclaimers(text: string): string {
  let earliestIndex = text.length

  for (const pattern of DISCLAIMER_PATTERNS) {
    const match = pattern.exec(text)
    if (match && match.index < earliestIndex) {
      earliestIndex = match.index
    }
  }

  if (earliestIndex < text.length) {
    return text.substring(0, earliestIndex).trimEnd()
  }

  return text
}
