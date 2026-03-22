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
  { id: 'leads', key: 'cat_leads' },
  { id: 'data', key: 'cat_data' },
  { id: 'modules', key: 'cat_modules' },
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
  whatsapp: svgIcon('<path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/>'),
  email: svgIcon('<rect x="2" y="4" width="20" height="16" rx="2"/><path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"/>'),
  pipeline: svgIcon('<circle cx="12" cy="12" r="3"/><path d="M12 2v7m0 6v7M2 12h7m6 0h7"/><path d="m4.93 4.93 4.24 4.24m5.66 5.66 4.24 4.24m0-14.14-4.24 4.24m-5.66 5.66-4.24 4.24"/>'),
  metrics: svgIcon('<line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/>'),
  scoring: svgIcon('<path d="M12 20V10"/><path d="M18 20V4"/><path d="M6 20v-4"/>'),
  google: svgIcon('<circle cx="12" cy="12" r="10"/><path d="M2 12h20"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>'),
  modules: svgIcon('<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>'),
  brain: svgIcon('<path d="M9.5 2A5.5 5.5 0 0 0 5 7.5c0 1.58.7 3 1.81 4L12 21l5.19-9.5A5.48 5.48 0 0 0 19 7.5 5.5 5.5 0 0 0 13.5 2h-4z"/><path d="M12 2v19"/>'),
  server: svgIcon('<rect x="2" y="2" width="20" height="8" rx="2"/><rect x="2" y="14" width="20" height="8" rx="2"/><line x1="6" y1="6" x2="6.01" y2="6"/><line x1="6" y1="18" x2="6.01" y2="18"/>'),
  fallback: svgIcon('<circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/>'),
}

const FIXED_SECTIONS: FixedSection[] = [
  // Channels
  { id: 'whatsapp', key: 'sec_whatsapp', icon: ICONS.whatsapp, group: 'channels', order: 10 },
  { id: 'email', key: 'sec_email', icon: ICONS.email, group: 'channels', order: 12 },
  // Agent
  { id: 'pipeline', key: 'sec_pipeline_unified', icon: ICONS.pipeline, group: 'agent', order: 20 },
  { id: 'engine-metrics', key: 'sec_engine_metrics', icon: ICONS.metrics, group: 'agent', order: 25 },
  // Leads
  { id: 'lead-scoring', key: 'sec_lead_scoring', icon: ICONS.scoring, group: 'leads', order: 15 },
  // Modules
  { id: 'google-apps', key: 'sec_google_apps', icon: ICONS.google, group: 'modules', order: 15 },
  { id: 'modules', key: 'sec_modules', icon: ICONS.modules, group: 'modules', order: 99 },
  // System
  { id: 'llm', key: 'sec_llm_unified', icon: ICONS.brain, group: 'system', order: 1 },
  { id: 'infra', key: 'sec_infra', icon: ICONS.server, group: 'system', order: 90 },
]

// IDs of fixed sections (used to avoid duplicates with dynamic modules)
const FIXED_IDS = new Set([...FIXED_SECTIONS.map(s => s.id), 'gmail']) // gmail covered by fixed 'email' section

// Override colored emoji icons from module manifests with monochrome SVGs
const ICON_OVERRIDES: Record<string, string> = {
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
  pt: `<svg width="20" height="14" viewBox="0 0 14 14" class="lang-flag"><rect width="20" height="14" rx="2" fill="#009c3b"/><polygon points="10,7 5,2 0,7 5,12" fill="#ffdf00"/><circle cx="5" cy="7" r="2.2" fill="#002776"/></svg>`,
  fr: `<svg width="20" height="14" viewBox="0 0 20 14" class="lang-flag"><rect width="20" height="14" rx="2" fill="#fff"/><rect width="6.67" height="14" fill="#002395"/><rect x="13.33" width="6.67" height="14" fill="#ed2939"/></svg>`,
}
const AVAILABLE_LANGS = ['es', 'en', 'pt', 'fr'] as const

function i18n(key: string, lang: Lang): string {
  const d: Record<string, Record<string, string>> = {
    search: { es: 'Buscar', en: 'Search', pt: 'Buscar', fr: 'Rechercher' },
    notif: { es: 'Notificaciones', en: 'Notifications', pt: 'Notificações', fr: 'Notifications' },
    noNotif: { es: 'Sin notificaciones', en: 'No notifications', pt: 'Sem notificações', fr: 'Aucune notification' },
    logout: { es: 'Cerrar sesión', en: 'Log out', pt: 'Sair', fr: 'Déconnexion' },
    testMode: { es: 'Modo de pruebas', en: 'Test mode', pt: 'Modo de teste', fr: 'Mode test' },
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
      <!-- Language -->
      <div class="header-dropdown-wrap">
        <button class="header-icon-btn" data-dropdown="lang-panel"><span class="lang-flag">${LANG_FLAGS[opts.lang] ?? '🌐'}</span> ${opts.lang.toUpperCase()}</button>
        <div class="header-dropdown header-dropdown-sm" id="lang-panel">
          ${langOptions}
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
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/></svg>
            <span>${i18n('testMode', opts.lang)}</span>
            <label class="toggle toggle-sm"><input type="checkbox" id="test-mode-cb"><span class="toggle-slider"></span></label>
          </div>
          <div class="dropdown-item dropdown-item-danger" id="btn-resetdb-menu" style="display:none">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
            ${i18n('resetDb', opts.lang)}
          </div>
          <div class="dropdown-divider"></div>
          <a href="/console/logout" class="dropdown-item dropdown-item-danger">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>
            ${i18n('logout', opts.lang)}
          </a>
        </div>
      </div>
    </div>
  </header>`
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
  for (const mod of dynModules) {
    if (FIXED_IDS.has(mod.name)) continue
    if (!mod.active) continue
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
    nav += `<div class="sidebar-group"><div class="sidebar-group-title">${groupLabel}</div>`

    for (const item of items) {
      const isActive = opts.section === item.id
      nav += `<a href="/console/${item.id}?lang=${opts.lang}" class="sidebar-item ${isActive ? 'active' : ''}">
        <span class="nav-icon">${item.icon}</span>
        <span>${item.label}</span>
        ${item.badge || ''}
      </a>`
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
  // Try fixed section first
  const fixed = FIXED_SECTIONS.find(s => s.id === opts.section)
  if (fixed) {
    const title = t(fixed.key, opts.lang)
    const descKey = fixed.key + '_info'
    const desc = t(descKey, opts.lang)
    return `<div class="section-header">
      <div class="section-title">${title}</div>
      ${desc && desc !== descKey ? `<div class="section-desc">${desc}</div>` : ''}
    </div>`
  }

  // Try dynamic module
  const dynMod = (opts.dynamicModules ?? []).find(m => m.name === opts.section)
  if (dynMod) {
    const title = dynMod.title[opts.lang] || dynMod.title.es || opts.section
    // Try i18n info key, fall back to nothing
    const infoKey = 'sec_' + opts.section.replace(/-/g, '_') + '_info'
    const info = t(infoKey, opts.lang)
    return `<div class="section-header">
      <div class="section-title">${esc(title)}</div>
      ${info && info !== infoKey ? `<div class="section-desc">${info}</div>` : ''}
    </div>`
  }

  return `<div class="section-header"><div class="section-title">${esc(opts.section)}</div></div>`
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
  const msg = messages[flash] || flash
  const type = flash === 'error' ? 'error' : 'success'
  return `<div class="toast ${type}" data-flash>${msg}</div>`
}
