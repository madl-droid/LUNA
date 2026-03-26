// LUNA — Users module types
// Tipos para identidad unificada de usuario, contactos multi-canal y permisos.

/** Tipos fijos del sistema. string permite custom lists. */
export type UserType = 'admin' | 'coworker' | 'lead' | string

/** Comportamiento cuando el contacto no está en ninguna lista y lead está desactivado. */
export type UnregisteredBehavior = 'silence' | 'generic_message' | 'register_only' | 'leads'

/** Resultado de resolver el tipo de un contacto. */
export interface UserResolution {
  userType: UserType
  listName: string
  contactId: string
  userId?: string
  fromCache: boolean
}

/** Permisos asociados a un tipo de usuario. */
export interface UserPermissions {
  tools: string[]
  skills: string[]
  subagents: boolean
  allAccess: boolean
  knowledgeCategories?: string[]
}

// ═══════════════════════════════════════════
// Unified user identity
// ═══════════════════════════════════════════

/** Fila de la tabla users (identidad unificada). */
export interface User {
  id: string               // USR-XXXXX
  displayName: string | null
  listType: string
  metadata: Record<string, unknown>
  isActive: boolean
  source: string
  createdAt: Date
  updatedAt: Date
}

/** Fila de la tabla user_contacts (forma de contacto por canal). */
export interface UserContact {
  id: string               // UUID
  userId: string
  channel: string
  senderId: string         // phone, email, chat id, etc.
  isPrimary: boolean
  verified: boolean
  createdAt: Date
}

/** Usuario con todos sus contactos. */
export interface UserWithContacts extends User {
  contacts: UserContact[]
}

/** Payload para crear un usuario nuevo con contactos. */
export interface UserInput {
  displayName?: string
  listType: string
  contacts: Array<{ channel: string; senderId: string }>
  metadata?: Record<string, unknown>
  source?: string
}

// ═══════════════════════════════════════════
// Legacy aliases (backward compat for sync/)
// ═══════════════════════════════════════════

/** @deprecated Use User instead */
export interface UserListEntry {
  id: string
  senderId: string
  channel: string
  listType: string
  listName: string | null
  displayName: string | null
  metadata: Record<string, unknown>
  isActive: boolean
  source: string
  createdAt: Date
  updatedAt: Date
}

/** @deprecated Use UserInput instead */
export interface UserListInput {
  senderId: string
  channel: string
  listType: string
  displayName?: string
  metadata?: Record<string, unknown>
  source?: string
}

// ═══════════════════════════════════════════
// List config
// ═══════════════════════════════════════════

/** System list types — fixed names, cannot be deleted. */
export const SYSTEM_LIST_TYPES = ['admin', 'lead', 'coworker', 'partners'] as const

/** Behavior when a list is disabled. */
export type DisableBehavior = 'leads' | 'silence' | 'move'

/** Config de una lista (tabla user_list_config). */
export interface UserListConfig {
  listType: string
  displayName: string
  description: string
  isEnabled: boolean
  isSystem: boolean
  permissions: UserPermissions
  knowledgeCategories: string[]
  assignmentEnabled: boolean
  assignmentPrompt: string
  disableBehavior: DisableBehavior
  disableTargetList: string | null
  syncConfig: SyncConfig
  unregisteredBehavior: UnregisteredBehavior
  unregisteredMessage: string | null
  maxUsers: number | null
  updatedAt: Date
}

/** Configuración de sincronización para una lista. */
export interface SyncConfig {
  sheetUrl?: string
  sheetTab?: string
  syncIntervalMs?: number
  lastSyncAt?: string
  lastSyncStatus?: 'ok' | 'error'
  lastSyncError?: string
}

/** Payload para importación masiva. */
export interface BulkImportResult {
  total: number
  created: number
  updated: number
  errors: Array<{ row: number; error: string }>
}

/** Config del módulo (desde configSchema). */
export interface UsersModuleConfig {
  USER_TYPE_CACHE_TTL: number
  USER_LISTS_ENABLED: boolean
  SHEET_SYNC_INTERVAL: number
}
