// LUNA — Gmail module: Email signature parser (LLM-based)
// Extracts contact info from email signatures using LLM.
// Tracks attempts per user (max 3) to avoid repeated costly calls.

import pino from 'pino'
import type { Registry } from '../../kernel/registry.js'

const logger = pino({ name: 'gmail:signature-parser' })

/** Data extracted from an email signature. */
export interface SignatureData {
  phone?: string
  title?: string
  company?: string
  website?: string
  linkedin?: string
  address?: string
}

/** Metadata fields stored on the user for tracking extraction attempts. */
export interface SignatureMetadata {
  signatureExtracted?: boolean
  signatureAttempts?: number
  signatureData?: SignatureData
}

const MAX_ATTEMPTS = 3

/**
 * Extract the signature block from an email body.
 * Uses common signature delimiters and heuristics.
 */
function extractSignatureBlock(body: string): string | null {
  // Try common signature delimiters
  const delimiters = ['-- \n', '--\n', '___', '—\n', '\n\n---']
  for (const delim of delimiters) {
    const idx = body.lastIndexOf(delim)
    if (idx !== -1 && idx > body.length * 0.4) {
      return body.slice(idx).trim()
    }
  }

  // Fallback: last ~15 lines of the email (often contains signature)
  const lines = body.split('\n')
  if (lines.length > 15) {
    return lines.slice(-15).join('\n').trim()
  }

  // Short email — use the whole body
  return body.length > 50 ? body : null
}

/**
 * Attempt to extract contact data from an email signature using LLM.
 * Returns null if extraction fails or signature block is too short.
 */
async function callLlmForSignature(signatureBlock: string, registry: Registry): Promise<SignatureData | null> {
  const result = await registry.callHook('llm:chat', {
    task: 'signature_extraction',
    messages: [{
      role: 'user' as const,
      content: `Extract contact information from this email signature. Return ONLY a JSON object with these fields (omit fields that are not found):
- phone: phone number(s)
- title: job title or position
- company: company or organization name
- website: website URL
- linkedin: LinkedIn profile URL
- address: physical address

Email signature:
---
${signatureBlock}
---

Respond with ONLY the JSON object, no markdown, no explanation. If no contact info is found, respond with: {}`,
    }],
    maxTokens: 300,
    temperature: 0.1,
  })

  if (!result || typeof result !== 'object' || !('text' in result)) {
    return null
  }

  const text = (result as { text: string }).text?.trim()
  if (!text) return null

  try {
    // Extract JSON from response (handle potential markdown wrapping)
    const jsonMatch = text.match(/\{[\s\S]*\}/)
    if (!jsonMatch) return null

    const parsed = JSON.parse(jsonMatch[0]) as Record<string, unknown>
    const data: SignatureData = {}

    if (parsed.phone && typeof parsed.phone === 'string') data.phone = parsed.phone
    if (parsed.title && typeof parsed.title === 'string') data.title = parsed.title
    if (parsed.company && typeof parsed.company === 'string') data.company = parsed.company
    if (parsed.website && typeof parsed.website === 'string') data.website = parsed.website
    if (parsed.linkedin && typeof parsed.linkedin === 'string') data.linkedin = parsed.linkedin
    if (parsed.address && typeof parsed.address === 'string') data.address = parsed.address

    // Return null if no fields extracted
    return Object.keys(data).length > 0 ? data : null
  } catch {
    logger.warn({ text: text.slice(0, 100) }, 'Failed to parse LLM signature extraction response')
    return null
  }
}

/**
 * Try to extract signature data from an incoming email and update user metadata.
 * Skips if already extracted or max attempts reached.
 */
export async function tryExtractSignature(
  registry: Registry,
  senderEmail: string,
  emailBody: string,
): Promise<void> {
  const usersDb = registry.getOptional<import('../users/db.js').UsersDb>('users:db')
  if (!usersDb) return

  // Find the user by email contact
  const resolved = await usersDb.resolveByContact(senderEmail, 'gmail')
  if (!resolved) return // unknown sender, skip

  // Get current user to check metadata
  const user = await usersDb.findUserById(resolved.userId)
  if (!user) return

  const meta = user.metadata as SignatureMetadata
  // Skip if already extracted successfully
  if (meta.signatureExtracted) return
  // Skip if max attempts reached
  if ((meta.signatureAttempts ?? 0) >= MAX_ATTEMPTS) return

  // Extract signature block from email body
  const signatureBlock = extractSignatureBlock(emailBody)
  if (!signatureBlock || signatureBlock.length < 20) {
    // Too short to be a meaningful signature
    return
  }

  const currentAttempts = (meta.signatureAttempts ?? 0) + 1

  try {
    const data = await callLlmForSignature(signatureBlock, registry)

    if (data) {
      // Success — store extracted data and mark as done
      await usersDb.updateUser(resolved.userId, {
        metadata: {
          signatureExtracted: true,
          signatureAttempts: currentAttempts,
          signatureData: data,
        },
      })
      logger.info({ email: senderEmail, userId: resolved.userId, fields: Object.keys(data) }, 'Signature data extracted')
    } else {
      // No data found — increment attempts only
      await usersDb.updateUser(resolved.userId, {
        metadata: { signatureAttempts: currentAttempts },
      })
      logger.debug({ email: senderEmail, attempt: currentAttempts }, 'No signature data found')
    }
  } catch (err) {
    // LLM error — increment attempts
    await usersDb.updateUser(resolved.userId, {
      metadata: { signatureAttempts: currentAttempts },
    })
    logger.warn({ err, email: senderEmail, attempt: currentAttempts }, 'Signature extraction LLM call failed')
  }
}
