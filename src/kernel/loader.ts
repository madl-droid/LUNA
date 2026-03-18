// LUNA — Module loader
// Escanea src/modules/*, lee DB, resuelve dependencias, carga módulos activos.

import * as fs from 'node:fs'
import * as path from 'node:path'
import pino from 'pino'
import type { Pool } from 'pg'
import type { Registry } from './registry.js'
import type { ModuleManifest } from './types.js'
import { getAllEnv } from './config.js'

const logger = pino({ name: 'kernel:loader' })

interface DbModuleRow {
  name: string
  active: boolean
}

/**
 * Scan modules/ directory, sync with DB, resolve dependencies, load active modules.
 */
export async function loadModules(registry: Registry): Promise<void> {
  const db = registry.getDb()
  const modulesDir = path.resolve(import.meta.dirname, '..', 'modules')

  // 1. Scan filesystem for manifests
  const discovered = await discoverModules(modulesDir)
  logger.info({ count: discovered.length, modules: discovered.map(m => m.name) }, 'Modules discovered')

  // 2. Read DB state
  const dbState = await getDbState(db)

  // 3. Sync: new modules → insert as inactive, missing modules → log warning
  await syncWithDb(db, discovered, dbState)

  // 4. Register all discovered modules
  for (const manifest of discovered) {
    const dbRow = dbState.get(manifest.name)
    const active = dbRow?.active ?? false
    registry.register(manifest, false) // register as inactive, we activate below
  }

  // 5. Determine which modules to activate (from DB state)
  const toActivate = discovered.filter(m => {
    const row = dbState.get(m.name)
    return row?.active ?? false
  })

  // 6. Topological sort by dependencies
  const sorted = topologicalSort(toActivate)

  // 6b. Parse configSchemas from env vars and store validated config
  const env = getAllEnv()
  for (const manifest of discovered) {
    if (manifest.configSchema) {
      try {
        const parsed = manifest.configSchema.parse(env)
        registry.setModuleConfig(manifest.name, parsed as Record<string, unknown>)
        logger.debug({ module: manifest.name }, 'Module config parsed')
      } catch (err) {
        logger.warn({ module: manifest.name, err }, 'Failed to parse module config, using defaults')
        // Try parsing with empty object to get defaults
        try {
          const defaults = manifest.configSchema.parse({})
          registry.setModuleConfig(manifest.name, defaults as Record<string, unknown>)
        } catch { /* no defaults available */ }
      }
    }
  }

  // 7. Activate in order
  for (const manifest of sorted) {
    try {
      // Set active flag directly (bypass DB write since it's already active in DB)
      const mod = registry.getModule(manifest.name)
      if (!mod) continue

      await manifest.init(registry)
      mod.active = true
      logger.info({ module: manifest.name, version: manifest.version }, 'Module activated')
    } catch (err) {
      logger.error({ module: manifest.name, err }, 'Failed to activate module')
    }
  }

  logger.info({ active: sorted.length, total: discovered.length }, 'Module loading complete')
}

async function discoverModules(modulesDir: string): Promise<ModuleManifest[]> {
  if (!fs.existsSync(modulesDir)) {
    logger.warn({ path: modulesDir }, 'Modules directory not found')
    return []
  }

  const entries = fs.readdirSync(modulesDir, { withFileTypes: true })
  const manifests: ModuleManifest[] = []

  for (const entry of entries) {
    if (!entry.isDirectory()) continue

    const manifestPath = path.join(modulesDir, entry.name, 'manifest.ts')
    const manifestPathJs = path.join(modulesDir, entry.name, 'manifest.js')

    // In dev (tsx) we can import .ts directly, in prod we import .js
    const importPath = fs.existsSync(manifestPathJs) ? manifestPathJs : manifestPath
    if (!fs.existsSync(importPath) && !fs.existsSync(manifestPath)) {
      logger.warn({ dir: entry.name }, 'Module directory without manifest, skipping')
      continue
    }

    try {
      const mod = await import(importPath)
      const manifest: ModuleManifest = mod.default ?? mod.manifest
      if (!manifest?.name) {
        logger.warn({ dir: entry.name }, 'Invalid manifest (missing name), skipping')
        continue
      }
      manifests.push(manifest)
    } catch (err) {
      logger.error({ dir: entry.name, err }, 'Failed to import manifest')
    }
  }

  return manifests
}

async function getDbState(db: Pool): Promise<Map<string, DbModuleRow>> {
  const result = await db.query<DbModuleRow>('SELECT name, active FROM kernel_modules')
  const map = new Map<string, DbModuleRow>()
  for (const row of result.rows) {
    map.set(row.name, row)
  }
  return map
}

async function syncWithDb(
  db: Pool,
  discovered: ModuleManifest[],
  dbState: Map<string, DbModuleRow>,
): Promise<void> {
  // New modules → insert. If activateByDefault, activate immediately.
  for (const manifest of discovered) {
    if (!dbState.has(manifest.name)) {
      const shouldActivate = manifest.activateByDefault ?? false
      await db.query(
        `INSERT INTO kernel_modules (name, active, activated_at, meta)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (name) DO NOTHING`,
        [
          manifest.name,
          shouldActivate,
          shouldActivate ? new Date() : null,
          JSON.stringify({ version: manifest.version, type: manifest.type }),
        ],
      )
      // Update dbState so the activation logic below picks it up
      dbState.set(manifest.name, { name: manifest.name, active: shouldActivate })
      logger.info({ module: manifest.name, active: shouldActivate }, `New module registered in DB${shouldActivate ? ' (auto-activated)' : ''}`)
    }
  }

  // Modules in DB but not in filesystem → log warning
  const discoveredNames = new Set(discovered.map(m => m.name))
  for (const [name] of dbState) {
    if (!discoveredNames.has(name)) {
      logger.warn({ module: name }, 'Module in DB but not in filesystem (missing)')
    }
  }
}

function topologicalSort(modules: ModuleManifest[]): ModuleManifest[] {
  const byName = new Map(modules.map(m => [m.name, m]))
  const visited = new Set<string>()
  const sorted: ModuleManifest[] = []

  function visit(name: string, stack: Set<string>): void {
    if (visited.has(name)) return
    if (stack.has(name)) {
      throw new Error(`Circular dependency detected: ${[...stack, name].join(' → ')}`)
    }

    const manifest = byName.get(name)
    if (!manifest) return // dependency not in active set, skip

    stack.add(name)
    for (const dep of manifest.depends ?? []) {
      visit(dep, stack)
    }
    stack.delete(name)

    visited.add(name)
    sorted.push(manifest)
  }

  for (const mod of modules) {
    visit(mod.name, new Set())
  }

  return sorted
}
