// LUNA — Users module types
// Tipos para resolución de usuarios y permisos.

/** Tipos fijos del sistema. string permite custom lists. */
export type UserType = 'admin' | 'coworker' | 'lead' | string

/** Comportamiento cuando el contacto no está en ninguna lista y lead está desactivado. */
export type UnregisteredBehavior = 'silence' | 'generic_message' | 'register_only'

/** Resultado de resolver el tipo de un contacto. */
export interface UserResolution {
  userType: UserType
  listName: string
  contactId: string
  fromCache: boolean
}

/** Permisos asociados a un tipo de usuario. */
export interface UserPermissions {
  tools: string[]
  skills: string[]
  subagents: boolean
  allAccess: boolean
}

/** Fila de la tabla user_lists. */
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

/** Config de una lista (tabla user_list_config). */
export interface UserListConfig {
  listType: string
  displayName: string
  isEnabled: boolean
  permissions: UserPermissions
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

/** Payload para crear/actualizar un usuario en una lista. */
export interface UserListInput {
  senderId: string
  channel: string
  listType: string
  displayName?: string
  metadata?: Record<string, unknown>
  source?: string
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
