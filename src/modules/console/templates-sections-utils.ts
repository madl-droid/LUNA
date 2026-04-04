import type { Lang } from './templates-i18n.js'
import type { ModuleInfo } from './templates-modules.js'

export interface SectionData {
  config: Record<string, string>
  lang: Lang
  allModels?: Record<string, string[]>
  lastScan?: { lastScanAt: string; replacements: Array<{ configKey: string; oldModel: string; newModel: string }> } | null
  waState?: { status: string; qrDataUrl: string | null; lastDisconnectReason: string | null; moduleEnabled: boolean }
  gmailAuth?: { connected: boolean; email: string | null }
  googleAppsAuth?: { connected: boolean; email: string | null }
  googleChatConnected?: boolean
  moduleStates?: ModuleInfo[]
  scheduledTasksHtml?: string
  knowledgeItemsHtml?: string
  leadScoringHtml?: string
  contactsSubpage?: string
  agenteSubpage?: string
  agenteContent?: string
  herramientasSubpage?: string
  herramientasContent?: string
  dashboardData?: {
    totalContacts: number
    contactsChange: number
    activeSessions: number
    llmCost: number
    costChange: number
    channels: Array<{ name: string; contacts: number; sessions: number }>
    sources?: Array<{ name: string; pct: number; color: string }>
    totalSourceContacts?: number
    models?: Array<{ name: string; desc: string; tokens: string; pct: number }>
    quality?: Array<{ channel: string; score: number; status: string; stars: number }>
  }
  toolDescriptions?: Array<{ name: string; sourceModule: string; shortDescription: string; detailedGuidance: string }>
  skills?: Array<{ name: string; description: string; userTypes: string; triggerPatterns: string }>
  usersData?: {
    configs: Array<{
      listType: string; displayName: string; description: string; isEnabled: boolean; isSystem: boolean
      permissions: { tools: string[]; skills: string[]; subagents: boolean; allowedSubagents?: string[]; allAccess: boolean }
      knowledgeCategories: string[]; assignmentEnabled: boolean; assignmentPrompt: string
      disableBehavior: string; disableTargetList: string | null
      unregisteredBehavior: string; unregisteredMessage: string | null; maxUsers: number | null
      syncConfig?: Record<string, unknown>
    }>
    usersByType: Record<string, Array<{ id: string; displayName: string | null; listType: string; isActive: boolean; source: string; contacts: Array<{ id: string; channel: string; senderId: string; isPrimary: boolean }>; metadata?: Record<string, unknown> }>>

    counts: Record<string, number>
    channels: Array<{ id: string; label: { es: string; en: string } | string }>
    tools: Array<{ name: string; description: string; category?: string }>
    activeModules: Array<{ name: string; displayName: { es: string; en: string } | string; type: string; tools: Array<{ name: string; displayName: string; description: string; enabled: boolean }> }>
    knowledgeCategories: Array<{ id: string; title: string; description: string }>
    subagentTypes: Array<{ slug: string; name: string; description: string }>
  }
}

export function cv(data: SectionData, key: string): string {
  return data.config[key] ?? ''
}
