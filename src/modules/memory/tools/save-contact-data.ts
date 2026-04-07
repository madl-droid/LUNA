// LUNA — Tool: save_contact_data
// Permite al agente guardar datos del contacto descubiertos durante la conversación:
// puntos de contacto (email, teléfono, canal), preferencias, fechas importantes, datos clave.

import type { Pool } from 'pg'
import pino from 'pino'
import type { ContactMemory } from '../types.js'
import { findMergeCandidates } from '../contact-merge.js'

const logger = pino({ name: 'tool:save_contact_data' })

export type ContactDataType = 'contact_point' | 'preference' | 'important_date' | 'key_fact'
export type ContactPointChannel = 'email' | 'whatsapp' | 'phone' | 'voice' | 'other'

export interface SaveContactDataInput {
  type: ContactDataType
  // contact_point fields
  channel?: ContactPointChannel
  value?: string
  // preference fields
  preference_key?: string
  preference_value?: string
  // important_date fields
  date?: string
  date_description?: string
  // key_fact fields
  fact?: string
}

export interface SaveContactDataResult {
  success: boolean
  message: string
  merge_candidate?: {
    contact_id: string
    display_name: string | null
    channel_type: string
  }
}

interface MemoryManagerLike {
  getAgentContact(contactId: string): Promise<{ contactMemory: ContactMemory } | null>
  updateContactMemory(contactId: string, memory: ContactMemory): Promise<void>
}

/**
 * Execute the save_contact_data tool.
 * Called by the tool registry when the agent invokes save_contact_data.
 */
export async function saveContactData(
  input: SaveContactDataInput,
  contactId: string,
  db: Pool,
  memoryManager: MemoryManagerLike,
): Promise<SaveContactDataResult> {
  try {
    switch (input.type) {
      case 'contact_point':
        return await handleContactPoint(input, contactId, db, memoryManager)
      case 'preference':
        return await handlePreference(input, contactId, memoryManager)
      case 'important_date':
        return await handleImportantDate(input, contactId, memoryManager)
      case 'key_fact':
        return await handleKeyFact(input, contactId, memoryManager)
      default:
        return { success: false, message: `Tipo desconocido: ${String(input.type)}` }
    }
  } catch (err) {
    logger.error({ err, contactId, input }, 'save_contact_data failed')
    return { success: false, message: `Error interno: ${err instanceof Error ? err.message : String(err)}` }
  }
}

// ─── Handlers ────────────────────────────────────────────────────────────────

async function handleContactPoint(
  input: SaveContactDataInput,
  contactId: string,
  db: Pool,
  memoryManager: MemoryManagerLike,
): Promise<SaveContactDataResult> {
  const { channel, value } = input

  if (!channel || !value) {
    return { success: false, message: 'Se requieren channel y value para contact_point' }
  }

  // Normalize identifier
  const normalized = normalizeIdentifier(channel, value)

  // Map channel alias to DB channel_type
  const channelType = mapChannelToType(channel)

  // Always save channel first (idempotent)
  const insertResult = await db.query(
    `INSERT INTO contact_channels (contact_id, channel_type, channel_identifier, is_primary, last_used_at)
     VALUES ($1, $2, $3, false, NOW())
     ON CONFLICT (channel_type, channel_identifier) DO NOTHING`,
    [contactId, channelType, normalized],
  )

  const inserted = (insertResult.rowCount ?? 0) > 0

  // Backfill email/phone on contacts table if applicable
  if (channel === 'email') {
    await db.query(
      `UPDATE contacts SET email = $1 WHERE id = $2 AND (email IS NULL OR email = '')`,
      [normalized, contactId],
    )
  } else if (channel === 'phone' || channel === 'whatsapp') {
    await db.query(
      `UPDATE contacts SET phone = $1 WHERE id = $2 AND (phone IS NULL OR phone = '')`,
      [normalized, contactId],
    )
  }

  // Add key_fact to contact_memory (always, even if channel already existed)
  const ac = await memoryManager.getAgentContact(contactId)
  if (ac) {
    const memory = ac.contactMemory
    const fact = `Contacto disponible por ${channelType}: ${normalized}`
    if (!memory.key_facts.some(f => f.fact === fact)) {
      memory.key_facts.push({ fact, source: 'agent:conversation', confidence: 0.95 })
      await memoryManager.updateContactMemory(contactId, memory)
    }
  }

  // Check for merge candidates (same identifier on a different contact)
  const mergeCandidates = await findMergeCandidates(db, contactId, normalized)
  if (mergeCandidates.length > 0) {
    const candidate = mergeCandidates[0]!
    return {
      success: true,
      message: `Canal guardado: ${channelType} ${normalized}. ATENCIÓN: este identificador ya existe en otro contacto: "${candidate.displayName ?? candidate.contactId}" (${candidate.channelType}). Si es la misma persona, usa la herramienta merge_contacts para unificarlos.`,
      merge_candidate: {
        contact_id: candidate.contactId,
        display_name: candidate.displayName,
        channel_type: candidate.channelType,
      },
    }
  }

  if (inserted) {
    logger.info({ contactId, channelType, normalized }, 'Contact point saved')
    return { success: true, message: `Punto de contacto guardado: ${channelType} ${normalized}` }
  } else {
    return { success: true, message: `El punto de contacto ${channelType} ${normalized} ya estaba registrado` }
  }
}

async function handlePreference(
  input: SaveContactDataInput,
  contactId: string,
  memoryManager: MemoryManagerLike,
): Promise<SaveContactDataResult> {
  const { preference_key, preference_value } = input

  if (!preference_key || preference_value === undefined || preference_value === null) {
    return { success: false, message: 'Se requieren preference_key y preference_value' }
  }

  const ac = await memoryManager.getAgentContact(contactId)
  if (!ac) return { success: false, message: 'Contacto no encontrado en memoria' }

  const memory = ac.contactMemory
  memory.preferences[preference_key] = preference_value
  await memoryManager.updateContactMemory(contactId, memory)

  logger.info({ contactId, preference_key }, 'Preference saved')
  return { success: true, message: `Preferencia guardada: ${preference_key} = ${preference_value}` }
}

async function handleImportantDate(
  input: SaveContactDataInput,
  contactId: string,
  memoryManager: MemoryManagerLike,
): Promise<SaveContactDataResult> {
  const { date, date_description } = input

  if (!date || !date_description) {
    return { success: false, message: 'Se requieren date y date_description para important_date' }
  }

  const ac = await memoryManager.getAgentContact(contactId)
  if (!ac) return { success: false, message: 'Contacto no encontrado en memoria' }

  const memory = ac.contactMemory

  // Dedup by date + what
  const alreadyExists = memory.important_dates.some(d => d.date === date && d.what === date_description)
  if (!alreadyExists) {
    memory.important_dates.push({ date, what: date_description })
    await memoryManager.updateContactMemory(contactId, memory)
    logger.info({ contactId, date, date_description }, 'Important date saved')
    return { success: true, message: `Fecha importante guardada: ${date_description} (${date})` }
  }

  return { success: true, message: `La fecha ${date_description} (${date}) ya estaba guardada` }
}

async function handleKeyFact(
  input: SaveContactDataInput,
  contactId: string,
  memoryManager: MemoryManagerLike,
): Promise<SaveContactDataResult> {
  const { fact } = input

  if (!fact) {
    return { success: false, message: 'Se requiere fact para key_fact' }
  }

  const ac = await memoryManager.getAgentContact(contactId)
  if (!ac) return { success: false, message: 'Contacto no encontrado en memoria' }

  const memory = ac.contactMemory

  // Check if a similar fact already exists (case-insensitive match)
  const existingIdx = memory.key_facts.findIndex(
    f => f.fact.toLowerCase() === fact.toLowerCase()
  )

  if (existingIdx >= 0) {
    // Update existing fact (supersede)
    const old = memory.key_facts[existingIdx]!
    memory.key_facts[existingIdx] = {
      fact,
      source: 'agent:conversation',
      confidence: 0.9,
      supersedes: old.fact,
    }
  } else {
    memory.key_facts.push({
      fact,
      source: 'agent:conversation',
      confidence: 0.9,
    })
  }

  await memoryManager.updateContactMemory(contactId, memory)
  logger.info({ contactId, fact }, 'Key fact saved')
  return { success: true, message: `Dato clave guardado: "${fact}"` }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function normalizeIdentifier(channel: ContactPointChannel, value: string): string {
  const trimmed = value.trim()
  if (channel === 'email') return trimmed.toLowerCase()
  if (channel === 'phone' || channel === 'whatsapp' || channel === 'voice') {
    // Strip everything except digits, then add single + prefix (proper E.164)
    const digits = trimmed.replace(/\D/g, '')
    if (!digits) return trimmed
    return `+${digits}`
  }
  return trimmed
}

function mapChannelToType(channel: ContactPointChannel): string {
  const map: Record<ContactPointChannel, string> = {
    email: 'email',
    whatsapp: 'whatsapp',
    phone: 'voice',
    voice: 'voice',
    other: 'other',
  }
  return map[channel]
}
