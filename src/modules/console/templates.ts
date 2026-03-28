// templates.ts — Page layout, sidebar, header, save bar, flash (SSR)

import { t, type Lang } from './templates-i18n.js'
import { esc } from './templates-fields.js'

// ═══════════════════════════════════════════
// Sidebar categories (hardcoded, order matters)
// ═══════════════════════════════════════════

interface SidebarCategory {
  id: string
  key: string  // i18n key (cat_*)
}

const CATEGORIES: SidebarCategory[] = [
  { id: 'channels', key: 'cat_channels' },
  { id: 'agent', key: 'cat_agent' },
  { id: 'system', key: 'cat_system' },
]

// Fixed sections: have custom renderers in templates-sections.ts
// These always appear in the sidebar regardless of module state
interface FixedSection {
  id: string
  key: string
  icon: string
  group: string
  order: number
}

// SVG icon helper — monochrome, inherits color via currentColor
const svgIcon = (d: string) => `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`

const ICONS = {
  channels: svgIcon('<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/><line x1="10" y1="6.5" x2="14" y2="6.5"/><line x1="10" y1="17.5" x2="14" y2="17.5"/>'),
  whatsapp: svgIcon('<path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/>'),
  email: svgIcon('<rect x="2" y="4" width="20" height="16" rx="2"/><path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"/>'),
  pipeline: svgIcon('<circle cx="12" cy="12" r="3"/><path d="M12 2v7m0 6v7M2 12h7m6 0h7"/><path d="m4.93 4.93 4.24 4.24m5.66 5.66 4.24 4.24m0-14.14-4.24 4.24m-5.66 5.66-4.24 4.24"/>'),
  metrics: svgIcon('<line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/>'),
  scoring: svgIcon('<path d="M12 20V10"/><path d="M18 20V4"/><path d="M6 20v-4"/>'),
  google: svgIcon('<path d="M12.48 10.92v3.28h7.84c-.24 1.84-.853 3.187-1.787 4.133-1.147 1.147-2.933 2.4-6.053 2.4-4.827 0-8.6-3.893-8.6-8.72s3.773-8.72 8.6-8.72c2.6 0 4.507 1.027 5.907 2.347l2.307-2.307C18.747 1.44 16.133 0 12.48 0 5.867 0 .307 5.387.307 12s5.56 12 12.173 12c3.573 0 6.267-1.173 8.373-3.36 2.16-2.16 2.84-5.213 2.84-7.667 0-.76-.053-1.467-.173-2.053H12.48z"/>'),
  modules: svgIcon('<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>'),
  brain: svgIcon('<path d="M9.5 2A5.5 5.5 0 0 0 5 7.5c0 1.58.7 3 1.81 4L12 21l5.19-9.5A5.48 5.48 0 0 0 19 7.5 5.5 5.5 0 0 0 13.5 2h-4z"/><path d="M12 2v19"/>'),
  server: svgIcon('<rect x="2" y="2" width="20" height="8" rx="2"/><rect x="2" y="14" width="20" height="8" rx="2"/><line x1="6" y1="6" x2="6.01" y2="6"/><line x1="6" y1="18" x2="6.01" y2="18"/>'),
  fallback: svgIcon('<circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/>'),
  dashboard: svgIcon('<circle cx="12" cy="14" r="9"/><path d="M12 14l3.5-5"/><path d="M6.8 18h10.4"/><path d="M12 5v1.5"/><path d="M5.1 8.5l1 1"/><path d="M18.9 8.5l-1 1"/>'),
}

const FIXED_SECTIONS: FixedSection[] = [
  // Dashboard — overview with charts
  { id: 'dashboard', key: 'sec_dashboard', icon: ICONS.dashboard, group: 'channels', order: 0 },
  // Channels — solo la pestaña unificada; los canales individuales se gestionan desde ahí
  { id: 'channels', key: 'sec_channels', icon: ICONS.channels, group: 'channels', order: 1 },
  // Contacts — right below channels
  { id: 'contacts', key: 'sec_contacts', icon: svgIcon('<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>'), group: 'channels', order: 2 },
  // Agent — unified page with sub-tabs: knowledge, memory, identity, advanced
  { id: 'agente', key: 'sec_agente', icon: svgIcon('<path d="M12 8V4H8"/><rect x="2" y="8" width="20" height="12" rx="2"/><circle cx="8" cy="14" r="1.5"/><circle cx="16" cy="14" r="1.5"/><path d="M9 18h6"/>'), group: 'agent', order: 1 },
  // Herramientas — unified page with sub-tabs: tools, lead-scoring, freight, medilink, scheduled-tasks, google-apps
  { id: 'herramientas', key: 'sec_herramientas', icon: svgIcon('<path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/>'), group: 'agent', order: 25 },
  { id: 'modules', key: 'sec_modules', icon: ICONS.modules, group: 'agent', order: 30 },
]

// IDs of fixed sections (used to avoid duplicates with dynamic modules)
// Also include channel section IDs that have custom renderers but aren't in the sidebar anymore
// Include old section IDs + modules that are now inside the unified "agente" page
const FIXED_IDS = new Set([...FIXED_SECTIONS.map(s => s.id), 'gmail', 'whatsapp', 'email', 'users', 'llm', 'pipeline', 'infra', 'knowledge', 'memory', 'prompts', 'engine', 'tools', 'lead-scoring', 'freight', 'medilink', 'scheduled-tasks', 'google-apps', 'model-scanner', 'engine-metrics'])

// Override colored emoji icons from module manifests with monochrome SVGs
export const ICON_OVERRIDES: Record<string, string> = {
  'tools': svgIcon('<path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/>'),
  'prompts': svgIcon('<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>'),
  'memory': svgIcon('<ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3"/><path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"/>'),
  'users': svgIcon('<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>'),
  'knowledge': svgIcon('<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/>'),
  'model-scanner': svgIcon('<circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>'),
  'scheduled-tasks': svgIcon('<rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>'),
  'google-chat': svgIcon('<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>'),
  'twilio-voice': svgIcon('<path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/>'),
  'gmail': ICONS.email,
  'whatsapp': ICONS.whatsapp,
  'llm': ICONS.brain,
  'google-apps': ICONS.google,
  'lead-scoring': ICONS.scoring,
  'engine-metrics': ICONS.metrics,
  'freight': svgIcon('<rect x="1" y="3" width="15" height="13" rx="2"/><path d="M16 8h4l3 3v5h-7V8z"/><circle cx="5.5" cy="18.5" r="2.5"/><circle cx="18.5" cy="18.5" r="2.5"/>'),
  'medilink': svgIcon('<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>'),
  'freshdesk': svgIcon('<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/><path d="M8 7h8"/><path d="M8 11h6"/>'),
  'tts': svgIcon('<path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/>'),
}

// ═══════════════════════════════════════════
// Dynamic module info (passed from server)
// ═══════════════════════════════════════════

export interface DynamicSidebarModule {
  name: string
  group: string
  icon: string
  order: number
  title: { es: string; en: string }
  active: boolean
}

/** Info about a connected/active channel for sidebar submenu */
export interface SidebarChannelInfo {
  id: string
  name: string
  status: 'connected' | 'disconnected' | 'inactive'
}

export interface PageOptions {
  section: string
  content: string
  lang: Lang
  version: string
  flash?: string
  waConnected?: boolean
  gmailConnected?: boolean
  googleAppsConnected?: boolean
  /** Active modules with console.group defined */
  dynamicModules?: DynamicSidebarModule[]
  /** When rendering a channel settings page nested under /console/channels/{id} */
  channelSettingsId?: string
  /** Active channel modules for sidebar submenu under Canales */
  channelModules?: SidebarChannelInfo[]
  /** Channel display name from manifest (for channel settings pages) */
  channelDisplayName?: string
  /** Whether ENGINE_TEST_MODE is currently active */
  testMode?: boolean
  /** Debug panel: cache enabled */
  debugCacheEnabled?: boolean
  /** Debug panel: extreme logging */
  debugExtremeLog?: boolean
  /** Debug panel: admin-only responses */
  debugAdminOnly?: boolean
  /** Active contacts sub-page (list type or 'config') */
  contactsSubpage?: string
  /** Available contact list types for sidebar submenu */
  contactLists?: Array<{ listType: string; displayName: string; count: number; isEnabled?: boolean }>
  /** Active agente sub-page (knowledge, memory, identity, advanced) */
  agenteSubpage?: string
  /** Active herramientas sub-page (tools, lead-scoring, freight, medilink, scheduled-tasks, google-apps) */
  herramientasSubpage?: string
}

// ═══════════════════════════════════════════
// Page layout
// ═══════════════════════════════════════════

export function pageLayout(opts: PageOptions): string {
  return `<!DOCTYPE html>
<html lang="${opts.lang}">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Luna — Console</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Montserrat:wght@400;500;600;700&display=swap" rel="stylesheet">
  <link rel="stylesheet" href="/console/static/styles/base.css">
  <link rel="stylesheet" href="/console/static/styles/layout.css">
  <link rel="stylesheet" href="/console/static/styles/components.css">
  <link rel="stylesheet" href="/console/static/styles/whatsapp.css">
  <link rel="stylesheet" href="/console/static/styles/sidebar.css">
</head>
<body>
  ${renderHeader(opts)}
  ${opts.flash ? renderFlash(opts.flash, opts.lang) : ''}
  <main id="main">
    <div class="app-layout">
      ${renderSidebar(opts)}
      <div class="content-area" id="content">${renderSectionHeader(opts)}${opts.content}</div>
    </div>
  </main>
  ${renderSaveBar(opts)}
  <div class="header-search-overlay" id="search-overlay">
    <input type="text" placeholder="${i18n('search', opts.lang)}" id="mobile-search-input">
    <button onclick="closeMobileSearch()">&#10005;</button>
  </div>
  <script src="/console/static/js/console-minimal.js"></script>
</body>
</html>`
}

// ═══════════════════════════════════════════
// Header
// ═══════════════════════════════════════════

const LANG_LABELS: Record<string, string> = { es: 'Español', en: 'English', pt: 'Português', fr: 'Français' }
// Inline SVG flags — simple geometric designs
const LANG_FLAGS: Record<string, string> = {
  es: `<svg width="20" height="14" viewBox="0 0 20 14" class="lang-flag"><rect width="20" height="14" rx="2" fill="#c60b1e"/><rect y="3.5" width="20" height="7" fill="#ffc400"/></svg>`,
  en: `<svg width="20" height="14" viewBox="0 0 20 14" class="lang-flag"><rect width="20" height="14" rx="2" fill="#b22234"/><rect y="0" width="20" height="1.08" fill="#fff"/><rect y="2.15" width="20" height="1.08" fill="#fff"/><rect y="4.31" width="20" height="1.08" fill="#fff"/><rect y="6.46" width="20" height="1.08" fill="#fff"/><rect y="8.62" width="20" height="1.08" fill="#fff"/><rect y="10.77" width="20" height="1.08" fill="#fff"/><rect y="12.92" width="20" height="1.08" fill="#fff"/><rect width="8" height="7.54" fill="#3c3b6e"/></svg>`,
  pt: `<svg width="20" height="14" viewBox="0 0 20 14" class="lang-flag"><rect width="20" height="14" rx="2" fill="#009c3b"/><polygon points="10,7 3,1.5 10,7 3,12.5" fill="#ffdf00"/><polygon points="10,2 17,7 10,12 3,7" fill="#ffdf00"/><circle cx="10" cy="7" r="2.8" fill="#002776"/></svg>`,
  fr: `<svg width="20" height="14" viewBox="0 0 20 14" class="lang-flag"><rect width="20" height="14" rx="2" fill="#fff"/><rect width="6.67" height="14" fill="#002395"/><rect x="13.33" width="6.67" height="14" fill="#ed2939"/></svg>`,
}
const AVAILABLE_LANGS = ['es', 'en', 'pt', 'fr'] as const

function i18n(key: string, lang: Lang): string {
  const d: Record<string, Record<string, string>> = {
    search: { es: 'Buscar', en: 'Search', pt: 'Buscar', fr: 'Rechercher' },
    notif: { es: 'Notificaciones', en: 'Notifications', pt: 'Notificações', fr: 'Notifications' },
    noNotif: { es: 'Sin notificaciones', en: 'No notifications', pt: 'Sem notificações', fr: 'Aucune notification' },
    logout: { es: 'Cerrar sesión', en: 'Log out', pt: 'Sair', fr: 'Déconnexion' },
    testMode: { es: 'Debugging', en: 'Debugging', pt: 'Debugging', fr: 'Debugging' },
    resetDb: { es: 'Limpiar DB', en: 'Reset DB', pt: 'Limpar DB', fr: 'Réinitialiser DB' },
    statusOk: { es: 'Operativo', en: 'Operational', pt: 'Operacional', fr: 'Opérationnel' },
  }
  return d[key]?.[lang] ?? d[key]?.en ?? key
}

function renderHeader(opts: PageOptions): string {
  const v = opts.version.length > 12 ? opts.version.slice(0, 7) : opts.version

  const langOptions = AVAILABLE_LANGS.map(l =>
    `<a href="?lang=${l}" class="dropdown-item ${l === opts.lang ? 'active' : ''}">
      <span class="lang-flag">${LANG_FLAGS[l]}</span> ${LANG_LABELS[l]}
    </a>`
  ).join('')

  return `<header>
    <div class="header-left">
      <button class="hamburger" id="hamburger" onclick="toggleSidebar()" aria-label="Menu">
        <span></span><span></span><span></span>
      </button>
      <div class="header-brand">
        <div class="header-brand-icon">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
            <path d="M12 2C6.48 2 2 6 2 11v4c0 2.2 1.8 4 4 4h1v-7H4.5C4.5 7.6 7.86 4.5 12 4.5S19.5 7.6 19.5 12H17v7h1c2.2 0 4-1.8 4-4v-4c0-5-4.48-9-10-9z" fill="rgba(255,255,255,0.9)"/>
            <circle cx="9" cy="13" r="1.2" fill="rgba(255,255,255,0.9)"/>
            <circle cx="15" cy="13" r="1.2" fill="rgba(255,255,255,0.9)"/>
            <path d="M9.5 17c.8.7 1.5 1 2.5 1s1.7-.3 2.5-1" stroke="rgba(255,255,255,0.9)" stroke-width="1.2" stroke-linecap="round" fill="none"/>
          </svg>
        </div>
        <div class="header-brand-text">
          <span class="header-brand-name">L.U.N.A</span>
          <span class="header-brand-sub">Console <span class="header-version">v${esc(v)}</span></span>
        </div>
      </div>
    </div>
    <div class="header-center">
      <div class="header-search">
        <svg class="header-search-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
        <input type="text" class="header-search-input" placeholder="${i18n('search', opts.lang)}" id="header-search">
      </div>
    </div>
    <div class="header-right">
      <!-- Mobile search icon (visible only <=480px via CSS) -->
      <button class="header-search-mobile" id="btn-search-mobile" onclick="openMobileSearch()">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
      </button>
      ${opts.testMode ? `<!-- Debug panel (only in test mode) -->
      <div class="header-dropdown-wrap">
        <button class="header-icon-btn header-debug-btn" id="btn-debug" data-dropdown="debug-panel" title="Debug">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 2l1.88 1.88M14.12 3.88L16 2M9 7.13v-1a3.003 3.003 0 1 1 6 0v1"/><path d="M12 20c-3.3 0-6-2.7-6-6v-3a4 4 0 0 1 4-4h4a4 4 0 0 1 4 4v3c0 3.3-2.7 6-6 6"/><path d="M12 20v-9M6.53 9C4.6 8.8 3 7.1 3 5"/><path d="M6 13H2"/><path d="M3 21c0-2.1 1.7-3.9 3.8-4"/><path d="M20.97 5c0 2.1-1.6 3.8-3.5 4"/><path d="M22 13h-4"/><path d="M17.2 17c2.1.1 3.8 1.9 3.8 4"/></svg>
        </button>
        <div class="header-dropdown header-dropdown-debug" id="debug-panel">
          <div class="dropdown-header">${t('dbg_title', opts.lang)}</div>
          <div class="dropdown-item">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83"/></svg>
            <span>${t('dbg_cache', opts.lang)}</span>
            <label class="toggle toggle-sm"><input type="checkbox" id="debug-cache-cb"${opts.debugCacheEnabled !== false ? ' checked' : ''}><span class="toggle-slider"></span></label>
          </div>
          <div class="dropdown-item">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><polyline points="13 2 13 9 20 9"/><line x1="10" y1="13" x2="10" y2="17"/><line x1="14" y1="13" x2="14" y2="17"/></svg>
            <span>${t('dbg_extreme_log', opts.lang)}</span>
            <label class="toggle toggle-sm"><input type="checkbox" id="debug-log-cb"${opts.debugExtremeLog ? ' checked' : ''}><span class="toggle-slider"></span></label>
          </div>
          <div class="dropdown-item">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
            <span>${t('dbg_admin_only', opts.lang)}</span>
            <label class="toggle toggle-sm"><input type="checkbox" id="debug-admin-cb"${opts.debugAdminOnly !== false ? ' checked' : ''}><span class="toggle-slider"></span></label>
          </div>
          <div class="dropdown-divider"></div>
          <div class="dropdown-item" id="btn-db-viewer">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3"/><path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"/></svg>
            ${t('dbg_database_viewer', opts.lang)}
          </div>
          <div class="dropdown-divider"></div>
          <div class="dropdown-item dropdown-item-danger" id="btn-clear-cache">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>
            ${t('dbg_clear_cache', opts.lang)}
          </div>
          <div class="dropdown-item dropdown-item-danger" id="btn-clear-memory">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
            ${t('dbg_clear_memory', opts.lang)}
          </div>
          <div class="dropdown-item dropdown-item-danger" onclick="resetContacts()">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><line x1="18" y1="8" x2="23" y2="13"/><line x1="23" y1="8" x2="18" y2="13"/></svg>
            ${opts.lang === 'es' ? 'Limpiar contactos' : 'Clear contacts'}
          </div>
          <div class="dropdown-item dropdown-item-danger" id="btn-factory-reset">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
            ${t('dbg_factory_reset', opts.lang)}
          </div>
        </div>
      </div>` : ''}
      <!-- Notifications -->
      <div class="header-dropdown-wrap">
        <button class="header-icon-btn" id="btn-notifications" data-dropdown="notif-panel">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>
          <span class="header-notif-dot" id="notif-dot"></span>
        </button>
        <div class="header-dropdown" id="notif-panel">
          <div class="dropdown-header">${i18n('notif', opts.lang)}</div>
          <div class="dropdown-body" id="notif-list">
            <div class="dropdown-empty">${i18n('noNotif', opts.lang)}</div>
          </div>
        </div>
      </div>
      <!-- Status dot with tooltip -->
      <div class="header-status-wrap">
        <span class="header-status-dot" id="status-dot"></span>
        <span class="header-status-tooltip" id="status-tooltip">${i18n('statusOk', opts.lang)}</span>
      </div>
      <!-- User menu -->
      <div class="header-dropdown-wrap">
        <button class="header-user" data-dropdown="user-panel">
          <div class="header-user-info">
            <span class="header-user-name">Admin</span>
            <span class="header-user-role">LUNA</span>
          </div>
          <div class="header-avatar">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
          </div>
        </button>
        <div class="header-dropdown header-dropdown-sm header-dropdown-right" id="user-panel">
          <div class="dropdown-item" id="test-mode-toggle">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 2l1.88 1.88M14.12 3.88L16 2M9 7.13v-1a3.003 3.003 0 1 1 6 0v1"/><path d="M12 20c-3.3 0-6-2.7-6-6v-3a4 4 0 0 1 4-4h4a4 4 0 0 1 4 4v3c0 3.3-2.7 6-6 6"/><path d="M12 20v-9M6.53 9C4.6 8.8 3 7.1 3 5"/><path d="M6 13H2"/><path d="M3 21c0-2.1 1.7-3.9 3.8-4"/><path d="M20.97 5c0 2.1-1.6 3.8-3.5 4"/><path d="M22 13h-4"/><path d="M17.2 17c2.1.1 3.8 1.9 3.8 4"/></svg>
            <span>${i18n('testMode', opts.lang)}</span>
            <label class="toggle toggle-sm"><input type="checkbox" id="test-mode-cb"${opts.testMode ? ' checked' : ''}><span class="toggle-slider"></span></label>
          </div>
          <div class="dropdown-divider"></div>
          <!-- Language submenu -->
          <div class="dropdown-item dropdown-submenu-trigger" id="lang-submenu-trigger">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>
            <span>${LANG_LABELS[opts.lang]}</span>
            <svg class="dropdown-submenu-chevron" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>
          </div>
          <div class="dropdown-submenu" id="lang-submenu">
            ${langOptions}
          </div>
          <div class="dropdown-divider"></div>
          <a href="/console/logout" class="dropdown-item dropdown-item-danger">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>
            ${i18n('logout', opts.lang)}
          </a>
        </div>
      </div>
    </div>
  </header>
  <!-- Type-to-confirm modal (reusable for all destructive actions) -->
  <div class="confirm-modal-overlay" id="confirm-modal" style="display:none">
    <div class="confirm-modal">
      <div class="confirm-modal-title" id="confirm-modal-title"></div>
      <div class="confirm-modal-desc" id="confirm-modal-desc"></div>
      <input type="text" class="confirm-modal-input" id="confirm-modal-input" autocomplete="off" spellcheck="false">
      <div class="confirm-modal-actions">
        <button class="confirm-modal-cancel" id="confirm-modal-cancel">${t('dbg_confirm_cancel', opts.lang)}</button>
        <button class="confirm-modal-btn" id="confirm-modal-btn" disabled>${t('dbg_confirm_btn', opts.lang)}</button>
      </div>
    </div>
  </div>`
}

// ═══════════════════════════════════════════
// Sidebar — hardcoded categories + dynamic items
// ═══════════════════════════════════════════

interface SidebarItem {
  id: string
  label: string
  icon: string
  order: number
  badge?: string
}

function renderSidebar(opts: PageOptions): string {
  const dynModules = opts.dynamicModules ?? []

  // Build items per category
  const categoryItems: Record<string, SidebarItem[]> = {}

  for (const cat of CATEGORIES) {
    categoryItems[cat.id] = []
  }

  // 1. Add fixed sections
  for (const sec of FIXED_SECTIONS) {
    const items = categoryItems[sec.group]
    if (!items) continue
    items.push({
      id: sec.id,
      label: t(sec.key, opts.lang),
      icon: sec.icon,
      order: sec.order,
      badge: getBadge(sec.id, opts),
    })
  }

  // 2. Add dynamic modules (only if not already a fixed section)
  //    Skip channel modules — managed from Canales tab
  //    Skip agent-group modules that aren't fixed — they go into Herramientas submenu
  const HERRAMIENTAS_FIXED = new Set(['tools', 'lead-scoring', 'freight', 'medilink', 'scheduled-tasks', 'google-apps'])
  for (const mod of dynModules) {
    if (FIXED_IDS.has(mod.name)) continue
    if (!mod.active) continue
    if (mod.group === 'channels') continue
    // Agent-group modules that are not fixed sidebar items → Herramientas subtab (not sidebar item)
    if (mod.group === 'agent' && !HERRAMIENTAS_FIXED.has(mod.name)) continue
    const group = mod.group
    if (!categoryItems[group]) {
      // Unknown group — add as new category (key = group name as fallback)
      categoryItems[group] = []
      CATEGORIES.push({ id: group, key: group })
    }
    categoryItems[group]!.push({
      id: mod.name,
      label: mod.title[opts.lang] || mod.title.es || mod.name,
      icon: ICON_OVERRIDES[mod.name] || ICONS.fallback,
      order: mod.order,
    })
  }

  // 3. Sort items within each category by order
  for (const items of Object.values(categoryItems)) {
    items.sort((a, b) => a.order - b.order)
  }

  // 4. Render — brand area + nav + bottom
  let nav = ''
  for (const cat of CATEGORIES) {
    const items = categoryItems[cat.id]
    if (!items || items.length === 0) continue

    const groupLabel = t(cat.key, opts.lang)
    // Hide category title for channels and agent groups
    const titleHtml = (cat.id === 'channels' || cat.id === 'agent') ? '' : `<div class="sidebar-group-title">${groupLabel}</div>`
    nav += `<div class="sidebar-group">${titleHtml}`

    for (const item of items) {
      const isActive = opts.section === item.id
      const itemHref = item.id === 'dashboard' ? `/console?lang=${opts.lang}` : `/console/${item.id}?lang=${opts.lang}`
      nav += `<a href="${itemHref}" class="sidebar-item ${isActive ? 'active' : ''}">
        <span class="nav-icon">${item.icon}</span>
        <span>${item.label}</span>
        ${item.badge || ''}
      </a>`

      // Contacts submenu: only show when section is active
      if (item.id === 'contacts' && (isActive || opts.contactsSubpage)) {
        const lists = (opts.contactLists ?? []).filter(l => l.isEnabled)
        if (lists.length > 0) {
          nav += '<div class="sidebar-submenu">'
          for (const list of lists) {
            const subActive = opts.contactsSubpage === list.listType
            nav += `<a href="/console/contacts/${list.listType}?lang=${opts.lang}" class="sidebar-submenu-item ${subActive ? 'active' : ''}">
              <span class="sidebar-count">${list.count}</span>
              <span>${esc(list.displayName)}</span>
            </a>`
          }
          nav += '</div>'
        }
      }

      // Agente submenu: only show when section is active
      if (item.id === 'agente' && (isActive || opts.agenteSubpage)) {
        const agenteIcons = {
          knowledge: svgIcon('<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/>'),
          memory: svgIcon('<path d="M12 2a7 7 0 0 0-5.42 2.57A5.5 5.5 0 0 0 2 9.5a5.5 5.5 0 0 0 3.36 5.07A5 5 0 0 0 9 19h2v3h2v-3h2a5 5 0 0 0 3.64-4.43A5.5 5.5 0 0 0 22 9.5a5.5 5.5 0 0 0-4.58-5.43A7 7 0 0 0 12 2z"/><path d="M12 2v20"/><path d="M5 9.5c2.5 0 4.5.5 7 2"/><path d="M19 9.5c-2.5 0-4.5.5-7 2"/>'),
          identity: svgIcon('<path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/>'),
          voice: svgIcon('<path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/>'),
          advanced: svgIcon('<rect x="4" y="4" width="16" height="16" rx="2"/><path d="M9 1v3"/><path d="M15 1v3"/><path d="M9 20v3"/><path d="M15 20v3"/><path d="M20 9h3"/><path d="M20 14h3"/><path d="M1 9h3"/><path d="M1 14h3"/>'),
        }
        const agenteTabs = [
          { id: 'knowledge', key: 'sec_agente_knowledge' },
          { id: 'memory', key: 'sec_agente_memory' },
          { id: 'identity', key: 'sec_agente_identity' },
          { id: 'voice', key: 'sec_agente_voice' },
          { id: 'advanced', key: 'sec_agente_advanced' },
        ]
        nav += '<div class="sidebar-submenu">'
        for (const tab of agenteTabs) {
          const subActive = opts.agenteSubpage === tab.id
          const tabIcon = agenteIcons[tab.id as keyof typeof agenteIcons] || ''
          nav += `<a href="/console/agente/${tab.id}?lang=${opts.lang}" class="sidebar-submenu-item ${subActive ? 'active' : ''}">
            <span class="nav-icon-sm">${tabIcon}</span>
            <span>${t(tab.key, opts.lang)}</span>
          </a>`
        }
        nav += '</div>'
      }

      // Herramientas submenu: only show when section is active
      if (item.id === 'herramientas' && (isActive || opts.herramientasSubpage)) {
        const herramientasIcons: Record<string, string> = {
          'tools': svgIcon('<path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/>'),
          'lead-scoring': ICONS.scoring,
          'freight': svgIcon('<rect x="1" y="6" width="22" height="12" rx="2"/><path d="M1 10h22"/><circle cx="7" cy="18" r="2"/><circle cx="17" cy="18" r="2"/>'),
          'medilink': svgIcon('<path d="M22 12h-4l-3 9L9 3l-3 9H2"/>'),
          'scheduled-tasks': svgIcon('<rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>'),
          'google-apps': ICONS.google,
          'freshdesk': svgIcon('<path d="M21 12a9 9 0 0 1-9 9m9-9a9 9 0 0 0-9-9m9 9H3m9 9a9 9 0 0 1-9-9m9 9c1.66 0 3-4.03 3-9s-1.34-9-3-9m0 18c-1.66 0-3-4.03-3-9s1.34-9 3-9m-9 9a9 9 0 0 1 9-9"/>'),
        }
        // Modules that belong to the "Agente" page, not herramientas
        const AGENTE_PAGE_MODULES = new Set(['prompts', 'engine', 'tools', 'memory', 'knowledge', 'tts'])
        // Build active module lookup from dynModules
        const activeModules = new Set(dynModules.filter(m => m.active).map(m => m.name))
        // Fixed herramientas tabs — only show if module is active
        const allFixedTabs = [
          { id: 'lead-scoring', key: 'sec_herramientas_lead_scoring' },
          { id: 'freight', key: 'sec_herramientas_freight' },
          { id: 'medilink', key: 'sec_herramientas_medilink' },
          { id: 'scheduled-tasks', key: 'sec_herramientas_scheduled_tasks' },
          { id: 'google-apps', key: 'sec_herramientas_google_apps' },
          { id: 'freshdesk', key: 'sec_herramientas_freshdesk' },
        ]
        const herramientasTabs: Array<{ id: string; key: string; label?: string }> = allFixedTabs.filter(tab => activeModules.has(tab.id))
        // Dynamic: add active agent-group modules not in fixed list or agente page
        for (const mod of dynModules) {
          if (!mod.active || mod.group !== 'agent') continue
          if (HERRAMIENTAS_FIXED.has(mod.name)) continue
          if (AGENTE_PAGE_MODULES.has(mod.name)) continue
          if (herramientasTabs.some(t => t.id === mod.name)) continue
          herramientasTabs.push({ id: mod.name, key: '', label: mod.title[opts.lang] || mod.title.es || mod.name })
          herramientasIcons[mod.name] = ICON_OVERRIDES[mod.name] || ICONS.fallback
        }
        // Sort alphabetically by displayed label
        herramientasTabs.sort((a, b) => {
          const la = (a.label || t(a.key, opts.lang)).toLowerCase()
          const lb = (b.label || t(b.key, opts.lang)).toLowerCase()
          return la.localeCompare(lb)
        })
        nav += '<div class="sidebar-submenu">'
        for (const tab of herramientasTabs) {
          const subActive = opts.herramientasSubpage === tab.id
          const tabIcon = herramientasIcons[tab.id] || ICONS.fallback
          nav += `<a href="/console/herramientas/${tab.id}?lang=${opts.lang}" class="sidebar-submenu-item ${subActive ? 'active' : ''}">
            <span class="nav-icon-sm">${tabIcon}</span>
            <span>${tab.label || t(tab.key, opts.lang)}</span>
          </a>`
        }
        nav += '</div>'
      }

      // Channel submenu: show active channels under "Canales" when it's active
      if (item.id === 'channels' && (isActive || opts.channelSettingsId)) {
        const channels = opts.channelModules ?? []
        if (channels.length > 0) {
          nav += '<div class="sidebar-submenu">'
          for (const ch of channels) {
            const chActive = opts.channelSettingsId === ch.id
            const chIcon = ICON_OVERRIDES[ch.id] || ICONS.fallback
            nav += `<a href="/console/channels/${ch.id}?lang=${opts.lang}" class="sidebar-submenu-item ${chActive ? 'active' : ''}">
              <span class="nav-icon-sm">${chIcon}</span>
              <span>${ch.name}</span>
            </a>`
          }
          // ACK Messages — last item in channels submenu
          const ackActive = opts.channelSettingsId === 'ack-messages'
          const ackLabel = opts.lang === 'es' ? 'Mensajes ACK' : 'ACK Messages'
          const ackIcon = svgIcon('<path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/>')
          nav += `<a href="/console/channels/ack-messages?lang=${opts.lang}" class="sidebar-submenu-item ${ackActive ? 'active' : ''}">
            <span class="nav-icon-sm">${ackIcon}</span>
            <span>${ackLabel}</span>
          </a>`
          nav += '</div>'
        }
      }
    }
    nav += '</div>'
  }

  return `<nav class="sidebar" id="sidebar"><div class="sidebar-nav">${nav}</div></nav>`
}

function getBadge(sectionId: string, opts: PageOptions): string {
  if (sectionId === 'whatsapp') {
    if (opts.waConnected === true) return '<span class="nav-badge badge-active">&#9679;</span>'
    if (opts.waConnected === false) return '<span class="nav-badge badge-off">&#9679;</span>'
  }
  if (sectionId === 'email') {
    return opts.gmailConnected ? '<span class="nav-badge badge-active">&#9679;</span>' : '<span class="nav-badge badge-off">&#9679;</span>'
  }
  if (sectionId === 'google-apps') {
    return opts.googleAppsConnected ? '<span class="nav-badge badge-active">&#9679;</span>' : '<span class="nav-badge badge-off">&#9679;</span>'
  }
  return ''
}

// ═══════════════════════════════════════════
// Section header
// ═══════════════════════════════════════════

function renderSectionHeader(opts: PageOptions): string {
  // Breadcrumb
  const consoleLbl = opts.lang === 'es' ? 'Consola' : 'Console'
  const channelsLbl = t('sec_channels', opts.lang)
  const sep = '<span class="ch-breadcrumb-sep">&#9656;</span>'
  let breadcrumb = ''

  if (opts.channelSettingsId) {
    // 3rd level: Consola > Canales > ChannelName (from manifest)
    const chName = opts.channelDisplayName ?? opts.channelSettingsId
    breadcrumb = `<div class="ch-breadcrumb">
      <a href="/console?lang=${opts.lang}">${consoleLbl}</a>${sep}
      <a href="/console/channels?lang=${opts.lang}">${channelsLbl}</a>${sep}
      <span>${esc(chName)}</span>
    </div>`
  } else if (opts.contactsSubpage && opts.contactsSubpage !== 'config') {
    // 3rd level: Consola > Contactos > ListName
    const contactsLbl = t('sec_contacts', opts.lang)
    const listInfo = opts.contactLists?.find(l => l.listType === opts.contactsSubpage)
    const listName = listInfo?.displayName ?? opts.contactsSubpage
    breadcrumb = `<div class="ch-breadcrumb">
      <a href="/console?lang=${opts.lang}">${consoleLbl}</a>${sep}
      <a href="/console/contacts?lang=${opts.lang}">${contactsLbl}</a>${sep}
      <span>${esc(listName)}</span>
    </div>`
    // Return early with list-specific header
    const listDesc: Record<string, Record<string, string>> = {
      admin: { es: 'Usuarios con acceso total al sistema. Solo los admins reciben respuesta cuando el modo de pruebas esta activo. Maximo 5 por instancia.', en: 'Users with full system access. Only admins receive responses when test mode is active. Maximum 5 per instance.' },
      lead: { es: 'Contactos capturados automaticamente por el agente. Esta tabla es gestionada por el sistema — los leads se registran y califican de forma automatica.', en: 'Contacts captured automatically by the agent. This table is managed by the system — leads are registered and scored automatically.' },
      coworker: { es: 'Colaboradores del equipo con acceso limitado a herramientas. Configura los permisos desde la pestaña de configuracion.', en: 'Team collaborators with limited tool access. Configure permissions from the configuration tab.' },
    }
    const desc = listDesc[opts.contactsSubpage]?.[opts.lang] || listDesc[opts.contactsSubpage]?.['es'] || ''
    return `${breadcrumb}<div class="section-header">
      <div class="section-title">${esc(listName)}</div>
      ${desc ? `<div class="section-desc">${desc}</div>` : ''}
    </div>`
  } else if (opts.section === 'channels') {
    // 2nd level: Consola > Canales
    breadcrumb = `<div class="ch-breadcrumb">
      <a href="/console?lang=${opts.lang}">${consoleLbl}</a>${sep}
      <span>${channelsLbl}</span>
    </div>`
  }

  // Channel settings page: title from manifest
  if (opts.channelSettingsId) {
    const configLabel = opts.lang === 'es' ? 'Configuracion' : 'Settings'
    const chName = opts.channelDisplayName ?? opts.channelSettingsId
    return `${breadcrumb}<div class="section-header">
      <div class="section-title">${configLabel} ${esc(chName)}</div>
    </div>`
  }

  // Agente sub-tabs: 3rd level breadcrumb (Consola > Agente > SubTab)
  if (!breadcrumb && opts.section === 'agente' && opts.agenteSubpage) {
    const agenteLbl = t('sec_agente', opts.lang)
    const subKey = `sec_agente_${opts.agenteSubpage}` as Parameters<typeof t>[0]
    const subLbl = t(subKey, opts.lang)
    breadcrumb = `<div class="ch-breadcrumb">
      <a href="/console?lang=${opts.lang}">${consoleLbl}</a>${sep}
      <a href="/console/agente?lang=${opts.lang}">${agenteLbl}</a>${sep}
      <span>${esc(subLbl)}</span>
    </div>`
  }

  // Herramientas sub-tabs: 3rd level breadcrumb (Consola > Herramientas > SubTab)
  if (!breadcrumb && opts.section === 'herramientas' && opts.herramientasSubpage) {
    const herramientasLbl = t('sec_herramientas', opts.lang)
    const subKey = `sec_herramientas_${opts.herramientasSubpage.replace(/-/g, '_')}` as Parameters<typeof t>[0]
    const subLbl = t(subKey, opts.lang)
    breadcrumb = `<div class="ch-breadcrumb">
      <a href="/console?lang=${opts.lang}">${consoleLbl}</a>${sep}
      <a href="/console/herramientas?lang=${opts.lang}">${herramientasLbl}</a>${sep}
      <span>${esc(subLbl)}</span>
    </div>`
  }

  // Build breadcrumb for non-channel sections too
  if (!breadcrumb && opts.section !== 'channels') {
    let sectionLabel = opts.section
    const fixed = FIXED_SECTIONS.find(s => s.id === opts.section)
    if (fixed) {
      sectionLabel = t(fixed.key, opts.lang)
    } else {
      const dynMod = (opts.dynamicModules ?? []).find(m => m.name === opts.section)
      if (dynMod) sectionLabel = dynMod.title[opts.lang] || dynMod.title.es || opts.section
    }
    breadcrumb = `<div class="ch-breadcrumb">
      <a href="/console?lang=${opts.lang}">${consoleLbl}</a>${sep}
      <span>${esc(sectionLabel)}</span>
    </div>`
  }

  // Subpage-specific header: use subpage title + description if available
  if (opts.section === 'agente' && opts.agenteSubpage) {
    const subKey = `sec_agente_${opts.agenteSubpage}` as Parameters<typeof t>[0]
    const subTitle = t(subKey, opts.lang)
    const subDescKey = `sec_agente_${opts.agenteSubpage}_info` as Parameters<typeof t>[0]
    const subDesc = t(subDescKey, opts.lang)
    return `${breadcrumb}<div class="section-header">
      <div class="section-title">${esc(subTitle)}</div>
      ${subDesc && subDesc !== subDescKey ? `<div class="section-desc">${subDesc}</div>` : ''}
    </div>`
  }
  if (opts.section === 'herramientas' && opts.herramientasSubpage) {
    const subKey = `sec_herramientas_${opts.herramientasSubpage.replace(/-/g, '_')}` as Parameters<typeof t>[0]
    const subTitle = t(subKey, opts.lang)
    const subDescKey = `sec_herramientas_${opts.herramientasSubpage.replace(/-/g, '_')}_info` as Parameters<typeof t>[0]
    const subDesc = t(subDescKey, opts.lang)
    return `${breadcrumb}<div class="section-header">
      <div class="section-title">${esc(subTitle)}</div>
      ${subDesc && subDesc !== subDescKey ? `<div class="section-desc">${subDesc}</div>` : ''}
    </div>`
  }

  // Try fixed section first
  const fixed = FIXED_SECTIONS.find(s => s.id === opts.section)
  if (fixed) {
    const title = t(fixed.key, opts.lang)
    const descKey = fixed.key + '_info'
    const desc = t(descKey, opts.lang)
    return `${breadcrumb}<div class="section-header">
      <div class="section-title">${title}</div>
      ${desc && desc !== descKey ? `<div class="section-desc">${desc}</div>` : ''}
    </div>`
  }

  // Try dynamic module
  const dynMod = (opts.dynamicModules ?? []).find(m => m.name === opts.section)
  if (dynMod) {
    const title = dynMod.title[opts.lang] || dynMod.title.es || opts.section
    const infoKey = 'sec_' + opts.section.replace(/-/g, '_') + '_info'
    const info = t(infoKey, opts.lang)
    return `${breadcrumb}<div class="section-header">
      <div class="section-title">${esc(title)}</div>
      ${info && info !== infoKey ? `<div class="section-desc">${info}</div>` : ''}
    </div>`
  }

  return `${breadcrumb}<div class="section-header"><div class="section-title">${esc(opts.section)}</div></div>`
}

// ═══════════════════════════════════════════
// Save bar
// ═══════════════════════════════════════════

function renderSaveBar(opts: PageOptions): string {
  const discardLabel = opts.lang === 'es' ? 'Descartar' : 'Discard'
  const saveLabel = opts.lang === 'es' ? 'Guardar' : 'Save'
  const applyLabel = opts.lang === 'es' ? 'Aplicar cambios' : 'Apply changes'

  return `<!-- Save bar: Phase 1 (dirty): Descartar + Guardar. Phase 2 (saved): Aplicar. -->
  <div class="save-bar" id="save-bar">
    <form method="POST" action="/console/save" id="save-form" class="save-bar-phase" data-phase="dirty">
      <input type="hidden" name="_section" value="${opts.section}">
      <input type="hidden" name="_lang" value="${opts.lang}">
      <span class="save-bar-label">&#9888; ${opts.lang === 'es' ? 'Cambios sin guardar' : 'Unsaved changes'}</span>
      <div class="save-bar-actions">
        <a href="/console/${opts.section}?lang=${opts.lang}" class="btn-discard" id="btn-reset">${discardLabel}</a>
        <button type="submit" class="btn-save" id="btn-save">${saveLabel}</button>
      </div>
    </form>
    <div class="save-bar-phase" data-phase="saved" style="display:none">
      <span class="save-bar-label save-bar-label-ok">&#10003; ${opts.lang === 'es' ? 'Guardado correctamente' : 'Saved successfully'}</span>
      <div class="save-bar-actions">
        <form method="POST" action="/console/apply" style="display:contents">
          <input type="hidden" name="_section" value="${opts.section}">
          <input type="hidden" name="_lang" value="${opts.lang}">
          <button type="submit" class="btn-apply" id="btn-apply">${applyLabel}</button>
        </form>
      </div>
    </div>
  </div>`
}

// ═══════════════════════════════════════════
// Flash messages
// ═══════════════════════════════════════════

function renderFlash(flash: string, lang: Lang): string {
  const messages: Record<string, string> = {
    saved: t('configSaved', lang),
    applied: t('applySuccess', lang),
    reset: t('resetDbSuccess', lang),
    toggled: t('activated', lang),
    error: t('errorSave', lang),
  }
  // FIX: SEC-3.1 — XSS en flash param: escapar fallback para evitar inyección HTML
  const msg = messages[flash] || esc(flash)
  const type = flash === 'error' ? 'error' : 'success'
  return `<div class="toast ${type}" data-flash>${msg}</div>`
}
