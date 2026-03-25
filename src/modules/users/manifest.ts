// LUNA — Module: users
// Sistema de listas de usuarios y permisos.
// Resuelve quién es cada contacto y qué puede hacer el agente con él.

import { z } from 'zod'
import type { ModuleManifest } from '../../kernel/types.js'
import type { Registry } from '../../kernel/registry.js'
import { numEnv, boolEnv } from '../../kernel/config-helpers.js'
import { UsersDb } from './db.js'
import { UserCache } from './cache.js'
import { initResolver } from './resolver.js'
import { initPermissions } from './permissions.js'
import { createApiRoutes } from './sync/api-handler.js'
import { startSheetSync, stopSheetSync } from './sync/sheet-sync.js'

let db: UsersDb | null = null
let cache: UserCache | null = null

const manifest: ModuleManifest = {
  name: 'users',
  version: '1.0.0',
  description: {
    es: 'Listas de usuarios y permisos: resuelve tipo de contacto y accesos',
    en: 'User lists and permissions: resolves contact type and access rights',
  },
  type: 'core-module',
  removable: false,
  activateByDefault: true,
  depends: [],

  configSchema: z.object({
    USER_TYPE_CACHE_TTL: numEnv(43200),
    USER_LISTS_ENABLED: boolEnv(true),
    SHEET_SYNC_INTERVAL: numEnv(3600000),
  }),

  console: {
    title: { es: 'Usuarios y Permisos', en: 'Users & Permissions' },
    info: {
      es: 'Listas de usuarios (admin, coworker, custom) y permisos por tipo.',
      en: 'User lists (admin, coworker, custom) and permissions by type.',
    },
    order: 15,
    group: 'system',
    icon: '&#128101;',
    fields: [
      {
        key: 'USER_TYPE_CACHE_TTL',
        type: 'number',
        label: { es: 'Cache TTL (segundos)', en: 'Cache TTL (seconds)' },
        info: { es: 'Tiempo de cache del tipo de usuario. Default: 43200 (12h)', en: 'User type cache duration. Default: 43200 (12h)' },
      },
      {
        key: 'USER_LISTS_ENABLED',
        type: 'boolean',
        label: { es: 'Módulo activo', en: 'Module enabled' },
      },
      {
        key: 'SHEET_SYNC_INTERVAL',
        type: 'number',
        label: { es: 'Intervalo sync Sheets (ms)', en: 'Sheet sync interval (ms)' },
        info: { es: 'Default: 3600000 (1h)', en: 'Default: 3600000 (1h)' },
      },
    ],
    apiRoutes: [], // populated in init()
  },

  async init(registry: Registry) {
    const config = registry.getConfig<{
      USER_TYPE_CACHE_TTL: number
      USER_LISTS_ENABLED: boolean
      SHEET_SYNC_INTERVAL: number
    }>('users')

    if (!config.USER_LISTS_ENABLED) return

    // Setup DB
    db = new UsersDb(registry.getDb())
    await db.ensureTables()
    await db.seedDefaults()

    // Setup cache
    cache = new UserCache(registry.getRedis(), config.USER_TYPE_CACHE_TTL)

    // Init resolver and permissions
    initResolver(registry, cache, db)
    initPermissions(db)

    // Expose services for other modules
    registry.provide('users:db', db)
    registry.provide('users:cache', cache)
    registry.provide('users:resolve', (await import('./resolver.js')).resolveUserType)
    registry.provide('users:permissions', (await import('./permissions.js')).getUserPermissions)
    registry.provide('users:invalidate', (await import('./resolver.js')).invalidateUserCache)

    // Expose data provider for console section renderer
    registry.provide('users:sectionData', async () => {
      const configs = await db!.getAllListConfigs()
      const usersByType: Record<string, import('./types.js').UserWithContacts[]> = {}
      const counts: Record<string, number> = {}
      for (const c of configs) {
        usersByType[c.listType] = await db!.listByType(c.listType)
        counts[c.listType] = usersByType[c.listType]!.length
      }
      // Active channels for contact type dropdowns
      const channels = registry.listModules()
        .filter(m => m.manifest.type === 'channel' && m.active)
        .map(m => ({ id: m.manifest.name, label: m.manifest.console?.title ?? { es: m.manifest.name, en: m.manifest.name } }))
      // Available tools for permissions grid
      const toolsRegistry = registry.getOptional<{ getCatalog(): Array<{ name: string; description: string; category?: string }> }>('tools:registry')
      const tools = toolsRegistry ? toolsRegistry.getCatalog() : []
      return { configs, usersByType, counts, channels, tools }
    })

    // Mount API routes (for external/programmatic access only)
    const apiRoutes = createApiRoutes(registry, db, cache)
    if (manifest.console) {
      manifest.console.apiRoutes = apiRoutes
    }

    // Start sheet sync (will check for Google OAuth availability)
    startSheetSync(registry, db, cache, config.SHEET_SYNC_INTERVAL)
  },

  async stop() {
    stopSheetSync()
    db = null
    cache = null
  },
}

export default manifest
