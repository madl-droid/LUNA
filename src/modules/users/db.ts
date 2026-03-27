// LUNA — Users module: PostgreSQL operations
// Unified user identity: users + user_contacts tables.

import type { Pool, PoolClient } from 'pg'
import pino from 'pino'
import type {
  User,
  UserContact,
  UserWithContacts,
  UserInput,
  UserListConfig,
  UserPermissions,
  UnregisteredBehavior,
  SyncConfig,
  UserListEntry,
  UserListInput,
} from './types.js'

const logger = pino({ name: 'users:db' })

// ═══════════════════════════════════════════
// ID generation
// ═══════════════════════════════════════════

const ID_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'

function generateUserId(): string {
  let code = ''
  for (let i = 0; i < 5; i++) code += ID_CHARS[Math.floor(Math.random() * ID_CHARS.length)]!
  return `USR-${code}`
}

// ═══════════════════════════════════════════
// DDL — Create tables on init
// ═══════════════════════════════════════════

const CREATE_TABLES_SQL = `
CREATE TABLE IF NOT EXISTS users (
  id VARCHAR(20) PRIMARY KEY,
  display_name VARCHAR(255),
  list_type VARCHAR(50) NOT NULL DEFAULT 'lead',
  metadata JSONB DEFAULT '{}',
  is_active BOOLEAN DEFAULT true,
  source VARCHAR(50) DEFAULT 'manual',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_users_type ON users(list_type, is_active);

CREATE TABLE IF NOT EXISTS user_contacts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id VARCHAR(20) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  channel VARCHAR(50) NOT NULL,
  sender_id VARCHAR(255) NOT NULL,
  is_primary BOOLEAN DEFAULT false,
  verified BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(channel, sender_id)
);

CREATE INDEX IF NOT EXISTS idx_user_contacts_sender ON user_contacts(sender_id, channel);
CREATE INDEX IF NOT EXISTS idx_user_contacts_user ON user_contacts(user_id);

CREATE TABLE IF NOT EXISTS user_list_config (
  list_type VARCHAR(50) PRIMARY KEY,
  display_name VARCHAR(100) NOT NULL,
  is_enabled BOOLEAN DEFAULT true,
  permissions JSONB NOT NULL,
  sync_config JSONB DEFAULT '{}',
  unregistered_behavior VARCHAR(50) DEFAULT 'silence',
  unregistered_message TEXT,
  max_users INT,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
`

const DEFAULT_ADMIN_PERMISSIONS: UserPermissions = {
  tools: ['*'],
  skills: ['*'],
  subagents: true,
  allAccess: true,
}

const DEFAULT_LEAD_PERMISSIONS: UserPermissions = {
  tools: [],
  skills: [],
  subagents: false,
  allAccess: false,
}

export class UsersDb {
  constructor(private pool: Pool) {}

  // ─── Schema ─────────────────────────────

  async ensureTables(): Promise<void> {
    const client = await this.pool.connect()
    try {
      await client.query(CREATE_TABLES_SQL)

      // Check for migration from old schema
      const oldTable = await client.query(
        `SELECT EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'user_lists') AS exists`,
      )
      if (oldTable.rows[0]?.exists) {
        await this.migrateFromUserLists(client)
      }

      // Add new columns to user_list_config (idempotent)
      await client.query(`
        ALTER TABLE user_list_config ADD COLUMN IF NOT EXISTS description TEXT DEFAULT '';
        ALTER TABLE user_list_config ADD COLUMN IF NOT EXISTS is_system BOOLEAN DEFAULT false;
        ALTER TABLE user_list_config ADD COLUMN IF NOT EXISTS knowledge_categories TEXT[] DEFAULT '{}';
        ALTER TABLE user_list_config ADD COLUMN IF NOT EXISTS assignment_enabled BOOLEAN DEFAULT false;
        ALTER TABLE user_list_config ADD COLUMN IF NOT EXISTS assignment_prompt TEXT DEFAULT '';
        ALTER TABLE user_list_config ADD COLUMN IF NOT EXISTS disable_behavior VARCHAR(50) DEFAULT 'leads';
        ALTER TABLE user_list_config ADD COLUMN IF NOT EXISTS disable_target_list VARCHAR(50);
      `)

      logger.info('User tables ensured')
    } finally {
      client.release()
    }
  }

  /** Migrate data from old user_lists table to users + user_contacts. */
  private async migrateFromUserLists(client: PoolClient): Promise<void> {
    // Check if already migrated (users table has data)
    const hasUsers = await client.query(`SELECT COUNT(*) AS c FROM users`)
    if (parseInt(hasUsers.rows[0]!.c, 10) > 0) {
      // Already migrated, drop backup if exists
      return
    }

    const oldRows = await client.query(
      `SELECT * FROM user_lists WHERE is_active = true ORDER BY
        CASE list_type WHEN 'admin' THEN 0 WHEN 'coworker' THEN 1 ELSE 2 END,
        created_at`,
    )

    if (oldRows.rows.length === 0) {
      logger.info('No data to migrate from user_lists')
      await client.query(`ALTER TABLE IF EXISTS user_lists RENAME TO user_lists_backup`)
      return
    }

    // Group by sender_id — each unique sender_id becomes one user
    // If same sender_id in multiple list_types, highest priority wins
    const senderMap = new Map<string, { row: Record<string, unknown>; channels: Set<string> }>()

    for (const row of oldRows.rows) {
      const existing = senderMap.get(row.sender_id as string)
      if (!existing) {
        senderMap.set(row.sender_id as string, {
          row: row as Record<string, unknown>,
          channels: new Set([row.channel as string]),
        })
      } else {
        existing.channels.add(row.channel as string)
      }
    }

    await client.query('BEGIN')
    try {
      let migrated = 0
      for (const [senderId, { row, channels }] of senderMap) {
        const userId = generateUserId()
        await client.query(
          `INSERT INTO users (id, display_name, list_type, metadata, is_active, source, created_at, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [
            userId,
            row.display_name ?? null,
            row.list_type,
            JSON.stringify(row.metadata ?? {}),
            true,
            row.source ?? 'migration',
            row.created_at,
            row.updated_at,
          ],
        )

        let first = true
        for (const channel of channels) {
          await client.query(
            `INSERT INTO user_contacts (user_id, channel, sender_id, is_primary, verified)
             VALUES ($1, $2, $3, $4, true)
             ON CONFLICT (channel, sender_id) DO NOTHING`,
            [userId, channel, senderId, first],
          )
          first = false
        }
        migrated++
      }

      await client.query(`ALTER TABLE user_lists RENAME TO user_lists_backup`)
      await client.query('COMMIT')
      logger.info({ migrated }, 'Migrated user_lists → users + user_contacts')
    } catch (err) {
      await client.query('ROLLBACK')
      logger.error({ err }, 'Migration failed, keeping user_lists')
    }
  }

  /** Seed default configs for system lists if they don't exist. */
  async seedDefaults(): Promise<void> {
    const DEFAULT_COWORKER_PERMISSIONS: UserPermissions = { tools: [], skills: [], subagents: false, allAccess: false }

    const systemLists: Array<{ type: string; name: string; perms: UserPermissions; maxUsers?: number; behavior?: string }> = [
      { type: 'admin', name: 'Administradores', perms: DEFAULT_ADMIN_PERMISSIONS, maxUsers: 5 },
      { type: 'lead', name: 'Leads', perms: DEFAULT_LEAD_PERMISSIONS, behavior: 'silence' },
      { type: 'coworker', name: 'Coworkers', perms: DEFAULT_COWORKER_PERMISSIONS },
      { type: 'partners', name: 'Partners', perms: DEFAULT_COWORKER_PERMISSIONS },
    ]

    for (const list of systemLists) {
      await this.pool.query(
        `INSERT INTO user_list_config (list_type, display_name, is_enabled, is_system, permissions, max_users, unregistered_behavior)
         VALUES ($1, $2, $3, true, $4, $5, $6)
         ON CONFLICT (list_type) DO UPDATE SET is_system = true`,
        [list.type, list.name, list.type === 'admin', JSON.stringify(list.perms), list.maxUsers ?? null, list.behavior ?? 'silence'],
      )
    }

    logger.info('Default user list configs seeded')
  }

  // ─── User CRUD ──────────────────────────

  async createUser(input: UserInput): Promise<UserWithContacts> {
    // Enforce max_users limit
    const config = await this.getListConfig(input.listType)
    if (config?.maxUsers) {
      const count = await this.countActiveUsers(input.listType)
      if (count >= config.maxUsers) {
        throw new Error(`List "${input.listType}" has reached max users (${config.maxUsers})`)
      }
    }

    // Generate unique ID (retry on collision)
    let userId = ''
    for (let attempt = 0; attempt < 5; attempt++) {
      userId = generateUserId()
      const exists = await this.pool.query(`SELECT 1 FROM users WHERE id = $1`, [userId])
      if (exists.rows.length === 0) break
    }

    const client = await this.pool.connect()
    try {
      await client.query('BEGIN')

      await client.query(
        `INSERT INTO users (id, display_name, list_type, metadata, source)
         VALUES ($1, $2, $3, $4, $5)`,
        [
          userId,
          input.displayName ?? null,
          input.listType,
          JSON.stringify(input.metadata ?? {}),
          input.source ?? 'manual',
        ],
      )

      const contacts: UserContact[] = []
      for (let i = 0; i < input.contacts.length; i++) {
        const c = input.contacts[i]!
        if (!c.senderId.trim()) continue
        // Normalize phone numbers to E.164 (+prefix) for WhatsApp channel
        let normalizedSenderId = c.senderId.trim()
        if (c.channel === 'whatsapp' && /^\d+$/.test(normalizedSenderId)) {
          normalizedSenderId = `+${normalizedSenderId}`
        }
        const result = await client.query(
          `INSERT INTO user_contacts (user_id, channel, sender_id, is_primary)
           VALUES ($1, $2, $3, $4)
           ON CONFLICT (channel, sender_id) DO NOTHING
           RETURNING *`,
          [userId, c.channel, normalizedSenderId, i === 0],
        )
        if (result.rows[0]) {
          contacts.push(this.mapContactRow(result.rows[0]))
        }
      }

      await client.query('COMMIT')

      const userRow = await this.pool.query(`SELECT * FROM users WHERE id = $1`, [userId])
      return { ...this.mapUserRow(userRow.rows[0]!), contacts }
    } catch (err) {
      await client.query('ROLLBACK')
      throw err
    } finally {
      client.release()
    }
  }

  /** Legacy: create user from old flat input (used by sync/). */
  async createUserLegacy(input: UserListInput): Promise<UserListEntry> {
    const user = await this.createUser({
      displayName: input.displayName,
      listType: input.listType,
      contacts: [{ channel: input.channel, senderId: input.senderId }],
      metadata: input.metadata,
      source: input.source,
    })
    return {
      id: user.id,
      senderId: input.senderId,
      channel: input.channel,
      listType: user.listType,
      listName: null,
      displayName: user.displayName,
      metadata: user.metadata,
      isActive: user.isActive,
      source: user.source,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
    }
  }

  async addContact(userId: string, channel: string, senderId: string): Promise<UserContact | null> {
    // Normalize phone numbers to E.164 (+prefix) for WhatsApp channel
    let normalized = senderId.trim()
    if (channel === 'whatsapp' && /^\d+$/.test(normalized)) {
      normalized = `+${normalized}`
    }
    const result = await this.pool.query(
      `INSERT INTO user_contacts (user_id, channel, sender_id, is_primary)
       VALUES ($1, $2, $3, false)
       ON CONFLICT (channel, sender_id) DO UPDATE SET user_id = EXCLUDED.user_id
       RETURNING *`,
      [userId, channel, normalized],
    )
    return result.rows[0] ? this.mapContactRow(result.rows[0]) : null
  }

  /** Update the sender_id of an existing contact (e.g. phone number changed). */
  async updateContact(contactId: string, newSenderId: string): Promise<UserContact | null> {
    const result = await this.pool.query(
      `UPDATE user_contacts SET sender_id = $1 WHERE id = $2 RETURNING *`,
      [newSenderId.trim(), contactId],
    )
    return result.rows[0] ? this.mapContactRow(result.rows[0]) : null
  }

  async removeContact(contactId: string): Promise<{ senderId: string; channel: string } | null> {
    // Get contact info before deleting (for cache invalidation)
    const existing = await this.pool.query(
      `SELECT sender_id, channel, user_id FROM user_contacts WHERE id = $1`,
      [contactId],
    )
    if (existing.rows.length === 0) return null

    // Ensure at least 1 contact remains
    const count = await this.pool.query(
      `SELECT COUNT(*) AS c FROM user_contacts WHERE user_id = $1`,
      [existing.rows[0]!.user_id],
    )
    if (parseInt(count.rows[0]!.c, 10) <= 1) {
      throw new Error('Cannot remove last contact — deactivate the user instead')
    }

    await this.pool.query(`DELETE FROM user_contacts WHERE id = $1`, [contactId])
    return { senderId: existing.rows[0]!.sender_id, channel: existing.rows[0]!.channel }
  }

  async updateUser(id: string, updates: { displayName?: string; metadata?: Record<string, unknown>; listType?: string }): Promise<User | null> {
    const sets: string[] = ['updated_at = NOW()']
    const values: unknown[] = []
    let idx = 1

    if (updates.displayName !== undefined) {
      sets.push(`display_name = $${idx++}`)
      values.push(updates.displayName)
    }
    if (updates.metadata !== undefined) {
      sets.push(`metadata = metadata || $${idx++}`)
      values.push(JSON.stringify(updates.metadata))
    }
    if (updates.listType !== undefined) {
      sets.push(`list_type = $${idx++}`)
      values.push(updates.listType)
    }

    values.push(id)
    const result = await this.pool.query(
      `UPDATE users SET ${sets.join(', ')} WHERE id = $${idx} RETURNING *`,
      values,
    )

    return result.rows[0] ? this.mapUserRow(result.rows[0]) : null
  }

  async deactivateUser(id: string): Promise<boolean> {
    const result = await this.pool.query(
      `UPDATE users SET is_active = false, updated_at = NOW() WHERE id = $1`,
      [id],
    )
    return (result.rowCount ?? 0) > 0
  }

  async mergeUsers(keepId: string, mergeId: string): Promise<UserWithContacts | null> {
    const client = await this.pool.connect()
    try {
      await client.query('BEGIN')

      // Move contacts from mergeId to keepId
      await client.query(
        `UPDATE user_contacts SET user_id = $1 WHERE user_id = $2`,
        [keepId, mergeId],
      )

      // Merge metadata
      await client.query(
        `UPDATE users SET metadata = (SELECT metadata FROM users WHERE id = $1) || (SELECT metadata FROM users WHERE id = $2), updated_at = NOW() WHERE id = $1`,
        [keepId, mergeId],
      )

      // Deactivate merged user
      await client.query(
        `UPDATE users SET is_active = false, updated_at = NOW() WHERE id = $1`,
        [mergeId],
      )

      await client.query('COMMIT')
      return this.findUserById(keepId)
    } catch (err) {
      await client.query('ROLLBACK')
      throw err
    } finally {
      client.release()
    }
  }

  // ─── Queries ────────────────────────────

  async listByType(listType: string, activeOnly = true): Promise<UserWithContacts[]> {
    const whereActive = activeOnly ? 'AND u.is_active = true' : ''
    const result = await this.pool.query(
      `SELECT u.*, uc.id AS contact_id, uc.channel, uc.sender_id, uc.is_primary, uc.verified, uc.created_at AS contact_created
       FROM users u
       LEFT JOIN user_contacts uc ON u.id = uc.user_id
       WHERE u.list_type = $1 ${whereActive}
       ORDER BY u.created_at, uc.is_primary DESC`,
      [listType],
    )

    return this.groupUserContacts(result.rows)
  }

  async findUserById(id: string): Promise<UserWithContacts | null> {
    const result = await this.pool.query(
      `SELECT u.*, uc.id AS contact_id, uc.channel, uc.sender_id, uc.is_primary, uc.verified, uc.created_at AS contact_created
       FROM users u
       LEFT JOIN user_contacts uc ON u.id = uc.user_id
       WHERE u.id = $1`,
      [id],
    )
    if (result.rows.length === 0) return null
    const users = this.groupUserContacts(result.rows)
    return users[0] ?? null
  }

  /**
   * Resolution query: find which user a sender belongs to.
   * Supports fallback: if senderId (LID) doesn't match, tries fallbackSenderId (phone).
   * When found by fallback, auto-migrates sender_id to the new value (LID replaces phone).
   */
  async resolveByContact(
    senderId: string,
    channel: string,
    fallbackSenderId?: string,
  ): Promise<{ userId: string; listType: string; listName: string } | null> {
    const query = `SELECT u.id AS user_id, u.list_type, COALESCE(ulc.display_name, u.list_type) AS list_name,
                          uc.id AS contact_id
       FROM user_contacts uc
       JOIN users u ON uc.user_id = u.id
       LEFT JOIN user_list_config ulc ON u.list_type = ulc.list_type
       WHERE uc.sender_id = $1 AND uc.channel = $2 AND u.is_active = true
       ORDER BY CASE u.list_type WHEN 'admin' THEN 0 WHEN 'coworker' THEN 1 ELSE 2 END
       LIMIT 1`

    const result = await this.pool.query<{ user_id: string; list_type: string; list_name: string; contact_id: string }>(
      query, [senderId, channel],
    )

    if (result.rows.length > 0) {
      const row = result.rows[0]!
      return { userId: row.user_id, listType: row.list_type, listName: row.list_name }
    }

    // Fallback: try phone number (manually-saved contacts use phone, not LID)
    if (fallbackSenderId) {
      const fallbackResult = await this.pool.query<{ user_id: string; list_type: string; list_name: string; contact_id: string }>(
        query, [fallbackSenderId, channel],
      )

      if (fallbackResult.rows.length > 0) {
        const row = fallbackResult.rows[0]!
        // Auto-migrate: update sender_id from phone to LID so next lookup is direct
        try {
          await this.pool.query(
            `UPDATE user_contacts SET sender_id = $1 WHERE id = $2`,
            [senderId, row.contact_id],
          )
          logger.info({ userId: row.user_id, oldSenderId: fallbackSenderId, newSenderId: senderId, channel }, 'Auto-migrated user_contacts sender_id (phone → LID)')
        } catch (err) {
          logger.warn({ err, userId: row.user_id }, 'Failed to auto-migrate sender_id')
        }
        return { userId: row.user_id, listType: row.list_type, listName: row.list_name }
      }
    }

    return null
  }

  /** Get all contacts for a user (used for cache invalidation). */
  async getContactsForUser(userId: string): Promise<Array<{ senderId: string; channel: string }>> {
    const result = await this.pool.query(
      `SELECT sender_id, channel FROM user_contacts WHERE user_id = $1`,
      [userId],
    )
    return result.rows.map(r => ({ senderId: r.sender_id, channel: r.channel }))
  }

  async countActiveUsers(listType: string): Promise<number> {
    const result = await this.pool.query<{ count: string }>(
      `SELECT COUNT(*) AS count FROM users WHERE list_type = $1 AND is_active = true`,
      [listType],
    )
    return parseInt(result.rows[0]!.count, 10)
  }

  async countListTypes(): Promise<number> {
    const result = await this.pool.query<{ count: string }>(
      `SELECT COUNT(*) AS count FROM user_list_config`,
    )
    return parseInt(result.rows[0]!.count, 10)
  }

  /** Deactivate all users from a specific source in a list (used before re-sync). */
  async deactivateBySource(listType: string, source: string): Promise<number> {
    const result = await this.pool.query(
      `UPDATE users SET is_active = false, updated_at = NOW()
       WHERE list_type = $1 AND source = $2 AND is_active = true`,
      [listType, source],
    )
    return result.rowCount ?? 0
  }

  // ─── List config (unchanged) ────────────

  async getListConfig(listType: string): Promise<UserListConfig | null> {
    const result = await this.pool.query(
      `SELECT * FROM user_list_config WHERE list_type = $1`,
      [listType],
    )
    return result.rows[0] ? this.mapConfigRow(result.rows[0]) : null
  }

  async getAllListConfigs(): Promise<UserListConfig[]> {
    const result = await this.pool.query(
      `SELECT * FROM user_list_config ORDER BY
        CASE list_type WHEN 'admin' THEN 0 WHEN 'coworker' THEN 1 WHEN 'lead' THEN 2 ELSE 3 END`,
    )
    return result.rows.map(r => this.mapConfigRow(r))
  }

  async upsertListConfig(
    listType: string,
    displayName: string,
    permissions: UserPermissions,
    opts?: {
      isEnabled?: boolean
      description?: string
      syncConfig?: SyncConfig
      unregisteredBehavior?: UnregisteredBehavior
      unregisteredMessage?: string | null
      maxUsers?: number | null
      knowledgeCategories?: string[]
      assignmentEnabled?: boolean
      assignmentPrompt?: string
      disableBehavior?: string
      disableTargetList?: string | null
    },
  ): Promise<UserListConfig> {
    const result = await this.pool.query(
      `INSERT INTO user_list_config (list_type, display_name, description, is_enabled, permissions, sync_config, unregistered_behavior, unregistered_message, max_users, knowledge_categories, assignment_enabled, assignment_prompt, disable_behavior, disable_target_list)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
       ON CONFLICT (list_type)
       DO UPDATE SET
         display_name = EXCLUDED.display_name,
         description = EXCLUDED.description,
         is_enabled = EXCLUDED.is_enabled,
         permissions = EXCLUDED.permissions,
         sync_config = EXCLUDED.sync_config,
         unregistered_behavior = EXCLUDED.unregistered_behavior,
         unregistered_message = EXCLUDED.unregistered_message,
         max_users = EXCLUDED.max_users,
         knowledge_categories = EXCLUDED.knowledge_categories,
         assignment_enabled = EXCLUDED.assignment_enabled,
         assignment_prompt = EXCLUDED.assignment_prompt,
         disable_behavior = EXCLUDED.disable_behavior,
         disable_target_list = EXCLUDED.disable_target_list,
         updated_at = NOW()
       RETURNING *`,
      [
        listType,
        displayName,
        opts?.description ?? '',
        opts?.isEnabled ?? true,
        JSON.stringify(permissions),
        JSON.stringify(opts?.syncConfig ?? {}),
        opts?.unregisteredBehavior ?? 'silence',
        opts?.unregisteredMessage ?? null,
        opts?.maxUsers ?? null,
        opts?.knowledgeCategories ?? [],
        opts?.assignmentEnabled ?? false,
        opts?.assignmentPrompt ?? '',
        opts?.disableBehavior ?? 'leads',
        opts?.disableTargetList ?? null,
      ],
    )

    return this.mapConfigRow(result.rows[0])
  }

  async updateListPermissions(listType: string, permissions: UserPermissions): Promise<void> {
    await this.pool.query(
      `UPDATE user_list_config SET permissions = $1, updated_at = NOW() WHERE list_type = $2`,
      [JSON.stringify(permissions), listType],
    )
  }

  // ─── Row mapping ────────────────────────

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private mapUserRow(row: any): User {
    return {
      id: row.id,
      displayName: row.display_name,
      listType: row.list_type,
      metadata: row.metadata ?? {},
      isActive: row.is_active,
      source: row.source,
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at),
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private mapContactRow(row: any): UserContact {
    return {
      id: row.id ?? row.contact_id,
      userId: row.user_id,
      channel: row.channel,
      senderId: row.sender_id,
      isPrimary: row.is_primary ?? false,
      verified: row.verified ?? false,
      createdAt: new Date(row.created_at ?? row.contact_created),
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private groupUserContacts(rows: any[]): UserWithContacts[] {
    const map = new Map<string, UserWithContacts>()

    for (const row of rows) {
      const userId = row.id as string
      if (!map.has(userId)) {
        map.set(userId, { ...this.mapUserRow(row), contacts: [] })
      }
      if (row.contact_id) {
        map.get(userId)!.contacts.push(this.mapContactRow(row))
      }
    }

    return [...map.values()]
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private mapConfigRow(row: any): UserListConfig {
    return {
      listType: row.list_type,
      displayName: row.display_name,
      description: row.description ?? '',
      isEnabled: row.is_enabled,
      isSystem: row.is_system ?? false,
      permissions: row.permissions as UserPermissions,
      knowledgeCategories: row.knowledge_categories ?? [],
      assignmentEnabled: row.assignment_enabled ?? false,
      assignmentPrompt: row.assignment_prompt ?? '',
      disableBehavior: (row.disable_behavior ?? 'leads') as import('./types.js').DisableBehavior,
      disableTargetList: row.disable_target_list ?? null,
      syncConfig: (row.sync_config ?? {}) as SyncConfig,
      unregisteredBehavior: row.unregistered_behavior as UnregisteredBehavior,
      unregisteredMessage: row.unregistered_message,
      maxUsers: row.max_users,
      updatedAt: new Date(row.updated_at),
    }
  }

  /** Delete a custom list config. Moves users to target list first. */
  async deleteListConfig(listType: string, moveToList = 'lead'): Promise<void> {
    // Move all users to target list
    await this.pool.query(
      `UPDATE users SET list_type = $1, updated_at = NOW() WHERE list_type = $2`,
      [moveToList, listType],
    )
    // Delete config
    await this.pool.query(`DELETE FROM user_list_config WHERE list_type = $1 AND is_system = false`, [listType])
  }
}
