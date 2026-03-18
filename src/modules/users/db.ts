// LUNA — Users module: PostgreSQL operations
// Tablas, CRUD y queries para user_lists y user_list_config.

import type { Pool } from 'pg'
import pino from 'pino'
import type {
  UserListEntry,
  UserListConfig,
  UserListInput,
  UserPermissions,
  UnregisteredBehavior,
  SyncConfig,
} from './types.js'

const logger = pino({ name: 'users:db' })

// ═══════════════════════════════════════════
// DDL — Create tables on init
// ═══════════════════════════════════════════

const CREATE_TABLES_SQL = `
CREATE TABLE IF NOT EXISTS user_lists (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sender_id VARCHAR(255) NOT NULL,
  channel VARCHAR(50) NOT NULL,
  list_type VARCHAR(50) NOT NULL,
  list_name VARCHAR(100),
  display_name VARCHAR(255),
  metadata JSONB DEFAULT '{}',
  is_active BOOLEAN DEFAULT true,
  source VARCHAR(50) DEFAULT 'manual',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(sender_id, channel, list_type)
);

CREATE INDEX IF NOT EXISTS idx_user_lists_sender ON user_lists(sender_id, channel);
CREATE INDEX IF NOT EXISTS idx_user_lists_type ON user_lists(list_type, is_active);

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
      logger.info('User tables ensured')
    } finally {
      client.release()
    }
  }

  /** Seed default configs for admin and lead if they don't exist. */
  async seedDefaults(): Promise<void> {
    // Admin config — always enabled, max 5 users
    await this.pool.query(
      `INSERT INTO user_list_config (list_type, display_name, is_enabled, permissions, max_users)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (list_type) DO NOTHING`,
      ['admin', 'Administradores', true, JSON.stringify(DEFAULT_ADMIN_PERMISSIONS), 5],
    )

    // Lead config — enabled by default, no max
    await this.pool.query(
      `INSERT INTO user_list_config (list_type, display_name, is_enabled, permissions, unregistered_behavior)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (list_type) DO NOTHING`,
      ['lead', 'Leads', true, JSON.stringify(DEFAULT_LEAD_PERMISSIONS), 'silence'],
    )

    logger.info('Default user list configs seeded')
  }

  // ─── User CRUD ──────────────────────────

  async createUser(input: UserListInput): Promise<UserListEntry> {
    // Enforce max_users limit
    const config = await this.getListConfig(input.listType)
    if (config?.maxUsers) {
      const count = await this.countActiveUsers(input.listType)
      if (count >= config.maxUsers) {
        throw new Error(`List "${input.listType}" has reached max users (${config.maxUsers})`)
      }
    }

    const result = await this.pool.query<UserListEntry>(
      `INSERT INTO user_lists (sender_id, channel, list_type, list_name, display_name, metadata, source)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (sender_id, channel, list_type)
       DO UPDATE SET
         display_name = COALESCE(EXCLUDED.display_name, user_lists.display_name),
         metadata = user_lists.metadata || EXCLUDED.metadata,
         is_active = true,
         source = EXCLUDED.source,
         updated_at = NOW()
       RETURNING *`,
      [
        input.senderId,
        input.channel,
        input.listType,
        config?.displayName ?? input.listType,
        input.displayName ?? null,
        JSON.stringify(input.metadata ?? {}),
        input.source ?? 'manual',
      ],
    )

    return this.mapRow(result.rows[0])
  }

  async updateUser(id: string, updates: Partial<Pick<UserListInput, 'displayName' | 'metadata'>>): Promise<UserListEntry | null> {
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

    values.push(id)
    const result = await this.pool.query(
      `UPDATE user_lists SET ${sets.join(', ')} WHERE id = $${idx} RETURNING *`,
      values,
    )

    return result.rows[0] ? this.mapRow(result.rows[0]) : null
  }

  async deactivateUser(id: string): Promise<boolean> {
    const result = await this.pool.query(
      `UPDATE user_lists SET is_active = false, updated_at = NOW() WHERE id = $1`,
      [id],
    )
    return (result.rowCount ?? 0) > 0
  }

  async listUsers(listType: string, activeOnly = true): Promise<UserListEntry[]> {
    const query = activeOnly
      ? `SELECT * FROM user_lists WHERE list_type = $1 AND is_active = true ORDER BY created_at`
      : `SELECT * FROM user_lists WHERE list_type = $1 ORDER BY created_at`

    const result = await this.pool.query(query, [listType])
    return result.rows.map(r => this.mapRow(r))
  }

  async findUserById(id: string): Promise<UserListEntry | null> {
    const result = await this.pool.query(`SELECT * FROM user_lists WHERE id = $1`, [id])
    return result.rows[0] ? this.mapRow(result.rows[0]) : null
  }

  // ─── Resolution query ──────────────────

  /**
   * Find which list a sender belongs to.
   * Order: admin first, then coworker, then custom lists.
   * First match wins.
   */
  async resolveUser(senderId: string, channel: string): Promise<{ listType: string; listName: string } | null> {
    const result = await this.pool.query<{ list_type: string; list_name: string }>(
      `SELECT ul.list_type, COALESCE(ul.list_name, ulc.display_name, ul.list_type) AS list_name
       FROM user_lists ul
       LEFT JOIN user_list_config ulc ON ul.list_type = ulc.list_type
       WHERE ul.sender_id = $1 AND ul.channel = $2 AND ul.is_active = true
       ORDER BY
         CASE ul.list_type
           WHEN 'admin' THEN 0
           WHEN 'coworker' THEN 1
           ELSE 2
         END
       LIMIT 1`,
      [senderId, channel],
    )

    if (result.rows.length === 0) return null
    const row = result.rows[0]!
    return { listType: row.list_type, listName: row.list_name }
  }

  // ─── List config ────────────────────────

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
      syncConfig?: SyncConfig
      unregisteredBehavior?: UnregisteredBehavior
      unregisteredMessage?: string | null
      maxUsers?: number | null
    },
  ): Promise<UserListConfig> {
    const result = await this.pool.query(
      `INSERT INTO user_list_config (list_type, display_name, is_enabled, permissions, sync_config, unregistered_behavior, unregistered_message, max_users)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (list_type)
       DO UPDATE SET
         display_name = EXCLUDED.display_name,
         is_enabled = EXCLUDED.is_enabled,
         permissions = EXCLUDED.permissions,
         sync_config = EXCLUDED.sync_config,
         unregistered_behavior = EXCLUDED.unregistered_behavior,
         unregistered_message = EXCLUDED.unregistered_message,
         max_users = EXCLUDED.max_users,
         updated_at = NOW()
       RETURNING *`,
      [
        listType,
        displayName,
        opts?.isEnabled ?? true,
        JSON.stringify(permissions),
        JSON.stringify(opts?.syncConfig ?? {}),
        opts?.unregisteredBehavior ?? 'silence',
        opts?.unregisteredMessage ?? null,
        opts?.maxUsers ?? null,
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

  async countActiveUsers(listType: string): Promise<number> {
    const result = await this.pool.query<{ count: string }>(
      `SELECT COUNT(*) as count FROM user_lists WHERE list_type = $1 AND is_active = true`,
      [listType],
    )
    return parseInt(result.rows[0]!.count, 10)
  }

  async countListTypes(): Promise<number> {
    const result = await this.pool.query<{ count: string }>(
      `SELECT COUNT(*) as count FROM user_list_config`,
    )
    return parseInt(result.rows[0]!.count, 10)
  }

  /** Deactivate all users from a specific source in a list (used before re-sync). */
  async deactivateBySource(listType: string, source: string): Promise<number> {
    const result = await this.pool.query(
      `UPDATE user_lists SET is_active = false, updated_at = NOW()
       WHERE list_type = $1 AND source = $2 AND is_active = true`,
      [listType, source],
    )
    return result.rowCount ?? 0
  }

  // ─── Row mapping ────────────────────────

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private mapRow(row: any): UserListEntry {
    return {
      id: row.id,
      senderId: row.sender_id,
      channel: row.channel,
      listType: row.list_type,
      listName: row.list_name,
      displayName: row.display_name,
      metadata: row.metadata ?? {},
      isActive: row.is_active,
      source: row.source,
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at),
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private mapConfigRow(row: any): UserListConfig {
    return {
      listType: row.list_type,
      displayName: row.display_name,
      isEnabled: row.is_enabled,
      permissions: row.permissions as UserPermissions,
      syncConfig: (row.sync_config ?? {}) as SyncConfig,
      unregisteredBehavior: row.unregistered_behavior as UnregisteredBehavior,
      unregisteredMessage: row.unregistered_message,
      maxUsers: row.max_users,
      updatedAt: new Date(row.updated_at),
    }
  }
}
