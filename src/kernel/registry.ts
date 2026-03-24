// LUNA — Registry
// Bus central del sistema modular. Hooks, servicios, config, módulos.

import { randomUUID } from 'node:crypto'
import type { Pool } from 'pg'
import type { Redis } from 'ioredis'
import pino from 'pino'
import type {
  HookMap,
  HookCallback,
  HookEntry,
  LoadedModule,
  ModuleManifest,
} from './types.js'
import { getAllEnv } from './config.js'
import * as configStore from './config-store.js'

const logger = pino({ name: 'registry' })

export class Registry {
  private modules = new Map<string, LoadedModule>()
  private hooks = new Map<string, HookEntry[]>()
  private services = new Map<string, unknown>()
  private moduleConfigs = new Map<string, Record<string, unknown>>()

  constructor(
    private readonly db: Pool,
    private readonly redis: Redis,
  ) {}

  // ─── Módulos ─────────────────────────────

  register(manifest: ModuleManifest, active = false): void {
    this.modules.set(manifest.name, { manifest, active })
  }

  isActive(name: string): boolean {
    return this.modules.get(name)?.active ?? false
  }

  getModule(name: string): LoadedModule | undefined {
    return this.modules.get(name)
  }

  listModules(): LoadedModule[] {
    return [...this.modules.values()]
  }

  async activate(name: string): Promise<void> {
    const mod = this.modules.get(name)
    if (!mod) throw new Error(`Module "${name}" not registered`)
    if (mod.active) return

    // Check dependencies
    for (const dep of mod.manifest.depends ?? []) {
      if (!this.isActive(dep)) {
        throw new Error(`Cannot activate "${name}": dependency "${dep}" is not active`)
      }
    }

    // Parse configSchema before init if not already set
    if (mod.manifest.configSchema && !this.moduleConfigs.has(name)) {
      try {
        const parsed = mod.manifest.configSchema.parse(getAllEnv())
        this.moduleConfigs.set(name, parsed as Record<string, unknown>)
      } catch {
        try {
          const defaults = mod.manifest.configSchema.parse({})
          this.moduleConfigs.set(name, defaults as Record<string, unknown>)
        } catch { /* no defaults */ }
      }
    }

    await mod.manifest.init(this)
    mod.active = true

    // Persist to DB
    await this.db.query(
      `UPDATE kernel_modules SET active = true, activated_at = now() WHERE name = $1`,
      [name],
    )

    await this.runHook('module:activated', { name })
    logger.info({ module: name }, 'Module activated')
  }

  async deactivate(name: string): Promise<void> {
    const mod = this.modules.get(name)
    if (!mod) throw new Error(`Module "${name}" not registered`)
    if (!mod.active) return
    if (!mod.manifest.removable) throw new Error(`Module "${name}" cannot be deactivated`)

    // Check no active module depends on this
    for (const [depName, depMod] of this.modules) {
      if (depMod.active && depMod.manifest.depends?.includes(name)) {
        throw new Error(`Cannot deactivate "${name}": module "${depName}" depends on it`)
      }
    }

    if (mod.manifest.stop) {
      await mod.manifest.stop()
    }

    // Remove hooks registered by this module
    for (const [hookName, entries] of this.hooks) {
      this.hooks.set(hookName, entries.filter(e => e.moduleName !== name))
    }

    // Remove services provided by this module (prefix convention: moduleName:*)
    for (const key of this.services.keys()) {
      if (key.startsWith(`${name}:`)) {
        this.services.delete(key)
      }
    }

    mod.active = false

    await this.db.query(
      `UPDATE kernel_modules SET active = false WHERE name = $1`,
      [name],
    )

    await this.runHook('module:deactivated', { name })
    logger.info({ module: name }, 'Module deactivated')
  }

  /** Stop all active modules in reverse activation order (for graceful shutdown) */
  async stopAll(): Promise<void> {
    const active = [...this.modules.entries()].filter(([, m]) => m.active).reverse()
    for (const [name, mod] of active) {
      try {
        if (mod.manifest.stop) {
          await mod.manifest.stop()
        }
        mod.active = false
        logger.info({ module: name }, 'Module stopped')
      } catch (err) {
        logger.error({ module: name, err }, 'Error stopping module')
      }
    }
  }

  // ─── Hooks (typed) ───────────────────────

  addHook<K extends keyof HookMap>(
    moduleName: string,
    hookName: K,
    callback: HookCallback<K>,
    priority = 10,
  ): void {
    const entries = this.hooks.get(hookName as string) ?? []
    entries.push({ moduleName, callback: callback as unknown as HookCallback, priority })
    entries.sort((a, b) => a.priority - b.priority)
    this.hooks.set(hookName as string, entries)
  }

  /** Run all callbacks for a hook (action — fire and forget) */
  async runHook<K extends keyof HookMap>(
    hookName: K,
    payload: HookMap[K][0],
    correlationId?: string,
  ): Promise<void> {
    const cid = correlationId ?? randomUUID()
    const entries = this.hooks.get(hookName as string) ?? []
    for (const entry of entries) {
      try {
        await entry.callback(payload, cid)
      } catch (err) {
        logger.error({ hook: hookName, module: entry.moduleName, err, correlationId: cid }, 'Hook error')
      }
    }
  }

  /** Call first matching hook and return result (like a service call via hook) */
  async callHook<K extends keyof HookMap>(
    hookName: K,
    payload: HookMap[K][0],
    correlationId?: string,
  ): Promise<HookMap[K][1] | null> {
    const cid = correlationId ?? randomUUID()
    const entries = this.hooks.get(hookName as string) ?? []
    for (const entry of entries) {
      try {
        const result = await entry.callback(payload, cid)
        if (result !== undefined && result !== null) return result as HookMap[K][1]
      } catch (err) {
        logger.error({ hook: hookName, module: entry.moduleName, err, correlationId: cid }, 'Hook call error')
      }
    }
    return null
  }

  hasHookListeners(hookName: keyof HookMap): boolean {
    return (this.hooks.get(hookName as string)?.length ?? 0) > 0
  }

  // ─── Services (dependency injection) ─────

  provide<T>(name: string, service: T): void {
    this.services.set(name, service)
  }

  get<T>(name: string): T {
    const service = this.services.get(name)
    if (service === undefined) throw new Error(`Service "${name}" not registered`)
    return service as T
  }

  getOptional<T>(name: string): T | null {
    return (this.services.get(name) as T) ?? null
  }

  // ─── Config ──────────────────────────────

  setModuleConfig(moduleName: string, config: Record<string, unknown>): void {
    this.moduleConfigs.set(moduleName, config)
  }

  getConfig<T = Record<string, unknown>>(moduleName: string): T {
    return (this.moduleConfigs.get(moduleName) ?? {}) as T
  }

  /** Re-parse all module configSchemas with fresh env + DB values. Called on config apply. */
  async reloadAllModuleConfigs(): Promise<void> {
    let dbConfig: Record<string, string> = {}
    try {
      dbConfig = await configStore.getAll(this.db)
    } catch { /* config_store may not be ready */ }
    const env = { ...getAllEnv(), ...dbConfig }

    for (const [name, mod] of this.modules) {
      if (!mod.active || !mod.manifest.configSchema) continue
      try {
        const parsed = mod.manifest.configSchema.parse(env)
        this.moduleConfigs.set(name, parsed as Record<string, unknown>)
        logger.debug({ module: name }, 'Module config reloaded')
      } catch (err) {
        logger.warn({ module: name, err }, 'Failed to reload module config, keeping previous')
      }
    }
    logger.info('All module configs reloaded from env + DB')
  }

  // ─── Infrastructure ──────────────────────

  getDb(): Pool {
    return this.db
  }

  getRedis(): Redis {
    return this.redis
  }
}
