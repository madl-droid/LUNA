// LUNA — Users module: Permission resolution
// Obtiene los permisos configurados para un tipo de usuario.

import pino from 'pino'
import type { UserPermissions, UserType } from './types.js'
import type { UsersDb } from './db.js'

const logger = pino({ name: 'users:permissions' })

let _db: UsersDb | null = null

export function initPermissions(db: UsersDb): void {
  _db = db
}

/** Default permissions when no config found (restrictive). */
const EMPTY_PERMISSIONS: UserPermissions = {
  tools: [],
  skills: [],
  subagents: false,
  allAccess: false,
  knowledgeCategories: [],
}

/**
 * Get the permissions for a user type.
 * Reads from user_list_config in DB.
 * Admin always gets allAccess = true.
 * allAccess materializes into tools:['*'], skills:['*'], subagents:true
 * so downstream code only checks concrete flags, never allAccess.
 */
export async function getUserPermissions(userType: UserType): Promise<UserPermissions> {
  if (!_db) throw new Error('Users module not initialized')

  // Unregistered contacts get no permissions
  if (userType.startsWith('_unregistered:')) {
    return { ...EMPTY_PERMISSIONS }
  }

  const config = await _db.getListConfig(userType)
  if (!config) {
    logger.warn({ userType }, 'No config found for user type, defaulting to full access')
    return { tools: ['*'], skills: ['*'], subagents: true, allAccess: false, knowledgeCategories: [] }
  }

  const perms = {
    ...config.permissions,
    knowledgeCategories: config.knowledgeCategories ?? [],
  }

  // Admin always gets allAccess — defensive, in case DB value is stale
  if (userType === 'admin') {
    perms.allAccess = true
  }

  // allAccess is the single source of truth for full permissions.
  // Materialize into concrete flags here so no downstream code needs to check allAccess.
  if (perms.allAccess) {
    perms.tools = ['*']
    perms.skills = ['*']
    perms.subagents = true
  }

  return perms
}

/**
 * Update admin permissions to include a new tool/skill.
 * Called when a new tool or skill is registered in the system.
 */
export async function ensureAdminHasAccess(
  type: 'tool' | 'skill',
  name: string,
): Promise<void> {
  if (!_db) return

  const config = await _db.getListConfig('admin')
  if (!config) return

  const perms = config.permissions

  // Admin uses wildcard '*' so explicit adds are not strictly needed,
  // but if someone replaced the wildcard with explicit list, keep it updated.
  if (perms.allAccess) return

  const list = type === 'tool' ? perms.tools : perms.skills
  if (!list.includes(name) && !list.includes('*')) {
    list.push(name)
    await _db.updateListPermissions('admin', perms)
    logger.info({ type, name }, 'Admin permissions updated with new access')
  }
}
