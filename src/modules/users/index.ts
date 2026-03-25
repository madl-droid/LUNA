// LUNA — Users module public exports

export type {
  UserType,
  UnregisteredBehavior,
  UserResolution,
  UserPermissions,
  User,
  UserContact,
  UserWithContacts,
  UserInput,
  UserListConfig,
  SyncConfig,
  BulkImportResult,
  // Legacy
  UserListEntry,
  UserListInput,
} from './types.js'

export { resolveUserType, invalidateUserCache, invalidateUserCacheForUser } from './resolver.js'
export { getUserPermissions } from './permissions.js'
