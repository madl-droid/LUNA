import type { Registry } from '../../kernel/registry.js'
import { kernelConfig } from '../../kernel/config.js'
import * as configStore from '../../kernel/config-store.js'
import { logger, findEnvFile, parseEnvFile, packageJsonVersion } from './server-helpers.js'
import type { DynamicSidebarModule } from './templates.js'
import type { ModuleInfo } from './templates-modules.js'

async function fetchSectionData(registry: Registry, _section: string): Promise<{
  config: Record<string, string>
  version: string
  allModels: Record<string, string[]>
  lastScan: { lastScanAt: string; replacements: Array<{ configKey: string; oldModel: string; newModel: string }> } | null
  moduleStates: ModuleInfo[]
  waState: { status: string; qrDataUrl: string | null; lastDisconnectReason: string | null; moduleEnabled: boolean }
  gmailAuth: { connected: boolean; email: string | null }
  googleAppsAuth: { connected: boolean; email: string | null }
  waConnected: boolean
  gmailConnected: boolean
  googleAppsConnected: boolean
  googleChatConnected: boolean
  dynamicModules: DynamicSidebarModule[]
}> {
  // Config: DB > .env > defaults
  const envFile = findEnvFile()
  const envValues = parseEnvFile(envFile)
  const defaults: Record<string, string> = {
    DB_HOST: 'localhost', DB_PORT: '5432', DB_NAME: 'luna', DB_USER: 'luna',
    REDIS_HOST: 'localhost', REDIS_PORT: '6379',
  }

  let dbValues: Record<string, string> = {}
  try {
    dbValues = await configStore.getAll(registry.getDb())
  } catch (err) {
    logger.warn({ err }, 'Could not read config from DB')
  }
  // Merge module config defaults (Zod-parsed with .default()) so UI sees defaults for unset fields
  const moduleDefaults: Record<string, string> = {}
  try {
    for (const m of registry.listModules()) {
      if (!m.active || !m.manifest.configSchema) continue
      try {
        const parsed = registry.getConfig<Record<string, unknown>>(m.manifest.name)
        for (const [k, v] of Object.entries(parsed)) {
          if (v !== undefined && v !== null) moduleDefaults[k] = String(v)
        }
      } catch { /* skip modules without config */ }
    }
  } catch { /* ignore */ }
  const config = { ...moduleDefaults, ...defaults, ...envValues, ...dbValues }

  // Version
  // Prefer semver from package.json; fall back to build hash for unversioned dev builds
  const version = packageJsonVersion && packageJsonVersion !== '0.0.0'
    ? packageJsonVersion
    : kernelConfig.buildVersion || 'dev'

  // Models: try to get from LLM module's integrated model scanner
  let allModels: Record<string, string[]> = { anthropic: [], gemini: [] }
  let lastScan: { lastScanAt: string; replacements: Array<{ configKey: string; oldModel: string; newModel: string }> } | null = null
  try {
    const { getLastScanResult } = await import('../llm/model-scanner.js')
    const scan = getLastScanResult()
    if (scan) {
      allModels = {
        anthropic: scan.anthropic?.map((m: { id: string }) => m.id) ?? [],
        gemini: scan.google?.map((m: { id: string }) => m.id) ?? [],
      }
      lastScan = scan.lastScanAt ? { lastScanAt: scan.lastScanAt, replacements: scan.replacements ?? [] } : null
    }
  } catch { /* llm model-scanner not available */ }

  // Module states
  let moduleStates: ModuleInfo[] = []
  try {
    moduleStates = registry.listModules().map(m => ({
      name: m.manifest.name,
      type: m.manifest.type,
      channelType: m.manifest.channelType,
      active: m.active,
      removable: m.manifest.removable,
      console: m.manifest.console ? {
        title: m.manifest.console.title,
        info: m.manifest.console.info,
        fields: m.manifest.console.fields,
        group: m.manifest.console.group,
        icon: m.manifest.console.icon,
      } : null,
      connectionWizard: m.manifest.console?.connectionWizard ? {
        title: m.manifest.console.connectionWizard.title,
        steps: m.manifest.console.connectionWizard.steps.map(s => ({
          title: s.title,
          instructions: s.instructions,
          fields: s.fields,
        })),
        saveEndpoint: m.manifest.console.connectionWizard.saveEndpoint,
        applyAfterSave: m.manifest.console.connectionWizard.applyAfterSave,
        verifyEndpoint: m.manifest.console.connectionWizard.verifyEndpoint,
      } : undefined,
    }))
    moduleStates.sort((a, b) => {
      const aOrder = registry.listModules().find(m => m.manifest.name === a.name)?.manifest.console?.order ?? 999
      const bOrder = registry.listModules().find(m => m.manifest.name === b.name)?.manifest.console?.order ?? 999
      return aOrder - bOrder
    })
  } catch { /* ignore */ }

  // WhatsApp state (adapter provides getState(), not a separate status service)
  let waState = { status: 'not_initialized', qrDataUrl: null as string | null, lastDisconnectReason: null as string | null, moduleEnabled: false }
  try {
    const moduleEnabled = registry.isActive('whatsapp')
    waState.moduleEnabled = moduleEnabled
    const adapter = registry.getOptional<{ getState(): { status: string; qr: string | null; lastDisconnectReason: string | null; connectedNumber: string | null } }>('whatsapp:adapter')
    if (adapter) {
      const state = adapter.getState()
      waState.status = state.status
      waState.lastDisconnectReason = state.lastDisconnectReason
      // QR data URL is generated by the API route handler, not stored on adapter
      // Initial render won't have QR — client JS polling will get it via API
    }
  } catch { /* whatsapp not available */ }

  // Gmail auth — check standalone OAuth or shared OAuth
  const gmailAuth = { connected: false, email: null as string | null }
  try {
    const gmailOAuth = registry.getOptional<{ isConnected(): boolean; getState(): { email: string | null } }>('gmail:oauth-manager')
    if (gmailOAuth && gmailOAuth.isConnected()) {
      gmailAuth.connected = true
      gmailAuth.email = gmailOAuth.getState().email
    } else {
      // Fallback: shared google-apps OAuth
      const sharedOAuth = registry.getOptional<{ isConnected(): boolean; getState(): { email: string | null } }>('google:oauth-manager')
      if (sharedOAuth && sharedOAuth.isConnected()) {
        gmailAuth.connected = true
        gmailAuth.email = sharedOAuth.getState().email
      }
    }
  } catch { /* gmail not available */ }

  // Google Apps auth — try to get state from OAuthManager service.
  const googleAppsAuth = { connected: false, email: null as string | null }
  try {
    const oauthManager = registry.getOptional<{ isConnected(): boolean; getState(): { status: string; email: string | null } }>('google:oauth-manager')
    if (oauthManager) {
      googleAppsAuth.connected = oauthManager.isConnected()
      googleAppsAuth.email = oauthManager.getState().email
    }
  } catch { /* google-apps not available */ }

  // Google Chat — check if adapter is connected
  let googleChatConnected = false
  try {
    const chatAdapter = registry.getOptional<{ getState(): { status: string } }>('google-chat:adapter')
    if (chatAdapter) {
      googleChatConnected = chatAdapter.getState().status === 'connected'
    }
  } catch { /* google-chat not available */ }

  // Dynamic sidebar modules (modules with console.group defined)
  const dynamicModules: DynamicSidebarModule[] = []
  for (const m of moduleStates) {
    const manifest = registry.listModules().find(lm => lm.manifest.name === m.name)?.manifest
    if (manifest?.console?.group) {
      dynamicModules.push({
        name: manifest.name,
        group: manifest.console.group,
        icon: manifest.console.icon || '&#128230;',
        order: manifest.console.order,
        title: manifest.console.title,
        active: m.active,
      })
    }
  }

  return {
    config,
    version,
    allModels,
    lastScan,
    moduleStates,
    waState,
    gmailAuth,
    googleAppsAuth,
    waConnected: waState.status === 'connected',
    gmailConnected: gmailAuth.connected,
    googleAppsConnected: googleAppsAuth.connected,
    googleChatConnected,
    dynamicModules,
  }
}

/**
 * Creates the request handler for serving /console (SSR multi-page)
 */

export { fetchSectionData }
