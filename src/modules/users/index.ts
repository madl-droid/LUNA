// LUNA — Users module public exports
// S01 (engine) y otros módulos consumen estas funciones.

export type {
  UserType,
  UnregisteredBehavior,
  UserResolution,
  UserPermissions,
  UserListEntry,
  UserListConfig,
  UserListInput,
  BulkImportResult,
  SyncConfig,
} from './types.js'

export { resolveUserType, invalidateUserCache } from './resolver.js'
export { getUserPermissions } from './permissions.js'
