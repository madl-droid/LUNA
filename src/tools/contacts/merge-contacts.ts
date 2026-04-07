// LUNA — Tool: merge_contacts
// Permite al agente fusionar dos contactos que son la misma persona.
// Mantiene keep_contact_id y absorbe canales, sesiones, mensajes y memoria de merge_contact_id.

import type { Pool } from 'pg'
import pino from 'pino'
import { mergeContacts } from '../../modules/memory/contact-merge.js'

const logger = pino({ name: 'tool:merge_contacts' })

export interface MergeContactsInput {
  keep_contact_id: string
  merge_contact_id: string
  reason: string
}

export interface MergeContactsResult {
  success: boolean
  message: string
  details?: {
    channels_moved: number
    sessions_moved: number
    messages_moved: number
  }
}

/**
 * Execute the merge_contacts tool.
 * Called by the tool registry when the agent invokes merge_contacts.
 */
export async function executeMergeContacts(
  input: MergeContactsInput,
  db: Pool,
): Promise<MergeContactsResult> {
  const { keep_contact_id, merge_contact_id, reason } = input

  if (!keep_contact_id || !merge_contact_id) {
    return { success: false, message: 'Se requieren keep_contact_id y merge_contact_id' }
  }

  if (keep_contact_id === merge_contact_id) {
    return { success: false, message: 'Los dos contact_id son iguales — no hay nada que fusionar' }
  }

  if (!reason) {
    return { success: false, message: 'Se requiere reason para auditoría del merge' }
  }

  logger.info({ keep_contact_id, merge_contact_id, reason }, 'merge_contacts tool invoked')

  const result = await mergeContacts(db, keep_contact_id, merge_contact_id, reason, 'agent')

  if (!result.success) {
    return {
      success: false,
      message: `Merge fallido: ${result.error ?? 'Error desconocido'}`,
    }
  }

  return {
    success: true,
    message: `Contactos fusionados exitosamente. ${result.channelsMoved} canales, ${result.sessionsMoved} sesiones y ${result.messagesMoved} mensajes transferidos al contacto principal.`,
    details: {
      channels_moved: result.channelsMoved,
      sessions_moved: result.sessionsMoved,
      messages_moved: result.messagesMoved,
    },
  }
}
