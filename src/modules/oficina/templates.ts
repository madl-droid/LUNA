// templates.ts — Page layout, sidebar, header, save bar, flash (SSR)

import { t, type Lang } from './templates-i18n.js'
import { esc } from './templates-fields.js'

// ═══════════════════════════════════════════
// Sidebar categories (hardcoded, order matters)
// ═══════════════════════════════════════════

interface SidebarCategory {
  id: string
  label: { es: string; en: string }
}

const CATEGORIES: SidebarCategory[] = [
  { id: 'channels', label: { es: 'Canales', en: 'Channels' } },
  { id: 'agent', label: { es: 'Agente', en: 'Agent' } },
  { id: 'leads', label: { es: 'Leads', en: 'Leads' } },
  { id: 'data', label: { es: 'Datos', en: 'Data' } },
  { id: 'modules', label: { es: 'Modulos', en: 'Modules' } },
  { id: 'system', label: { es: 'Sistema', en: 'System' } },
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

const FIXED_SECTIONS: FixedSection[] = [
  // Channels
  { id: 'whatsapp', key: 'sec_whatsapp', icon: '&#128172;', group: 'channels', order: 10 },
  { id: 'email', key: 'sec_email', icon: '&#9993;', group: 'channels', order: 12 },
  // Agent
  { id: 'pipeline', key: 'sec_pipeline', icon: '&#9654;', group: 'agent', order: 20 },
  { id: 'engine-metrics', key: 'sec_engine_metrics', icon: '&#128200;', group: 'agent', order: 21 },
  { id: 'followup', key: 'sec_followup', icon: '&#128260;', group: 'agent', order: 22 },
  { id: 'naturalidad', key: 'sec_naturalidad', icon: '&#127917;', group: 'agent', order: 23 },
  // Leads
  { id: 'lead-scoring', key: 'sec_lead_scoring', icon: '&#128202;', group: 'leads', order: 15 },
  // Modules
  { id: 'google-apps', key: 'sec_google_apps', icon: '&#128279;', group: 'modules', order: 15 },
  { id: 'modules', key: 'sec_modules', icon: '&#128230;', group: 'modules', order: 99 },
  // System
  { id: 'apikeys', key: 'sec_apikeys', icon: '&#128273;', group: 'system', order: 1 },
  { id: 'models', key: 'sec_models', icon: '&#129504;', group: 'system', order: 2 },
  { id: 'llm-limits', key: 'sec_llm_limits', icon: '&#9881;', group: 'system', order: 3 },
  { id: 'llm-cb', key: 'sec_llm_cb', icon: '&#128268;', group: 'system', order: 4 },
  { id: 'db', key: 'sec_db', icon: '&#128452;', group: 'system', order: 90 },
  { id: 'redis', key: 'sec_redis', icon: '&#9889;', group: 'system', order: 91 },
]

// IDs of fixed sections (used to avoid duplicates with dynamic modules)
const FIXED_IDS = new Set(FIXED_SECTIONS.map(s => s.id))

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
  /** Active modules with oficina.group defined */
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
  <title>Luna — Oficina</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Montserrat:wght@400;500;600;700&display=swap" rel="stylesheet">
  <link rel="stylesheet" href="/oficina/static/styles/base.css">
  <link rel="stylesheet" href="/oficina/static/styles/layout.css">
  <link rel="stylesheet" href="/oficina/static/styles/components.css">
  <link rel="stylesheet" href="/oficina/static/styles/whatsapp.css">
  <link rel="stylesheet" href="/oficina/static/styles/sidebar.css">
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
  <script src="/oficina/static/js/oficina-minimal.js"></script>
</body>
</html>`
}

// ═══════════════════════════════════════════
// Header
// ═══════════════════════════════════════════

function renderHeader(opts: PageOptions): string {
  const otherLang = opts.lang === 'es' ? 'en' : 'es'
  const langLabel = opts.lang === 'es' ? 'EN' : 'ES'
  const v = opts.version.length > 7 ? opts.version.slice(0, 7) : opts.version
  return `<header>
    <div class="header-left">
      <button class="hamburger" id="hamburger" onclick="toggleSidebar()" aria-label="Menu">
        <span></span><span></span><span></span>
      </button>
      <h1>Oficina <span>| LUNA</span></h1>
    </div>
    <div class="header-right">
      <span class="build-ver">v${esc(v)}</span>
      <a href="?lang=${otherLang}" class="lang-toggle">${langLabel}</a>
      <span class="status-text" id="status">${t('connected', opts.lang)}</span>
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
      // Unknown group — add as new category
      categoryItems[group] = []
      CATEGORIES.push({ id: group, label: { es: group, en: group } })
    }
    categoryItems[group]!.push({
      id: mod.name,
      label: mod.title[opts.lang] || mod.title.es || mod.name,
      icon: mod.icon || '&#128230;',
      order: mod.order,
    })
  }

  // 3. Sort items within each category by order
  for (const items of Object.values(categoryItems)) {
    items.sort((a, b) => a.order - b.order)
  }

  // 4. Render
  let h = ''
  for (const cat of CATEGORIES) {
    const items = categoryItems[cat.id]
    if (!items || items.length === 0) continue

    const groupLabel = cat.label[opts.lang] || cat.label.es
    h += `<div class="sidebar-group"><div class="sidebar-group-title">${groupLabel}</div>`

    for (const item of items) {
      const isActive = opts.section === item.id
      h += `<a href="/oficina/${item.id}?lang=${opts.lang}" class="sidebar-item ${isActive ? 'active' : ''}">
        <span class="nav-icon">${item.icon}</span>
        <span>${item.label}</span>
        ${item.badge || ''}
      </a>`
    }
    h += '</div>'
  }

  return `<nav class="sidebar" id="sidebar">${h}</nav>`
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
  return `<form method="POST" action="/oficina/save" class="save-bar" id="save-form">
    <input type="hidden" name="_section" value="${opts.section}">
    <input type="hidden" name="_lang" value="${opts.lang}">
    <button type="button" class="btn-resetdb" id="btn-resetdb" onclick="resetDb()">${t('resetDbBtn', opts.lang)}</button>
    <a href="/oficina/${opts.section}?lang=${opts.lang}" class="btn-reset" id="btn-reset">${t('discard', opts.lang)}</a>
    <button type="submit" class="btn-save" id="btn-save" disabled>${t('save', opts.lang)}</button>
    <button type="submit" formaction="/oficina/apply" class="btn-save btn-apply" id="btn-apply" disabled>${t('applyBtn', opts.lang)}</button>
  </form>`
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
