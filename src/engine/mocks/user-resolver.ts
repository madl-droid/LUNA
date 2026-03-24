// LUNA Engine — Mock User Resolver (S02)
// Hardcoded user lists for testing. Will be replaced by src/users/ module.

import type { UserResolution, UserPermissions, UserType } from '../types.js'

// Hardcoded test data — admins and coworkers
const ADMINS = new Map<string, string>([
  ['573155524620', 'Admin Principal'],
  ['573017279976', 'Admin Secundario'],
])

const COWORKERS = new Map<string, string>([
  ['18582097197', 'Equipo Ventas'],
])

// Full permissions for admins
const ADMIN_PERMISSIONS: UserPermissions = {
  tools: ['*'],
  skills: ['*'],
  subagents: true,
  canReceiveProactive: true,
}

// Configurable permissions for coworkers
const COWORKER_PERMISSIONS: UserPermissions = {
  tools: ['search', 'schedule', 'lookup_contact', 'update_contact'],
  skills: ['respond', 'schedule'],
  subagents: false,
  canReceiveProactive: true,
}

// Lead permissions
const LEAD_PERMISSIONS: UserPermissions = {
  tools: ['schedule', 'lookup_product', 'extract_qualification'],
  skills: ['respond', 'schedule'],
  subagents: false,
  canReceiveProactive: true,
}

const PERMISSIONS_BY_TYPE: Record<UserType, UserPermissions> = {
  admin: ADMIN_PERMISSIONS,
  coworker: COWORKER_PERMISSIONS,
  lead: LEAD_PERMISSIONS,
  custom1: LEAD_PERMISSIONS,
  custom2: LEAD_PERMISSIONS,
}

/**
 * Resolve user type from sender ID and channel.
 * Mock implementation: checks hardcoded maps, defaults to 'lead'.
 */
export async function resolveUserType(
  senderId: string,
  _channel: string,
): Promise<UserResolution> {
  // Check admins first (highest priority)
  if (ADMINS.has(senderId)) {
    return {
      userType: 'admin',
      contactId: `contact_${senderId}`,
      displayName: ADMINS.get(senderId)!,
    }
  }

  // Check coworkers
  if (COWORKERS.has(senderId)) {
    return {
      userType: 'coworker',
      contactId: `contact_${senderId}`,
      displayName: COWORKERS.get(senderId)!,
    }
  }

  // Default: lead
  return {
    userType: 'lead',
    contactId: null,
    displayName: null,
  }
}

/**
 * Get permissions for a user type.
 */
export async function getUserPermissions(
  userType: UserType,
): Promise<UserPermissions> {
  return PERMISSIONS_BY_TYPE[userType] ?? LEAD_PERMISSIONS
}
