// templates.ts — Page layout, sidebar, header, save bar, flash (SSR)

import { t, type Lang } from './templates-i18n.js'
import { esc } from './templates-fields.js'

const NAV_SECTIONS = [
  // Channels
  { id: 'whatsapp', key: 'sec_whatsapp', icon: '&#128172;', group: 'channels' },
  { id: 'email', key: 'sec_email', icon: '&#9993;', group: 'channels', soon: true },
  { id: 'google', key: 'sec_google', icon: '&#128279;', group: 'channels', soon: true },
  // AI
  { id: 'apikeys', key: 'sec_apikeys', icon: '&#128273;', group: 'ai' },
  { id: 'models', key: 'sec_models', icon: '&#129504;', group: 'ai' },
  { id: 'llm-limits', key: 'sec_llm_limits', icon: '&#9881;', group: 'ai' },
  { id: 'llm-cb', key: 'sec_llm_cb', icon: '&#128268;', group: 'ai' },
  // Pipeline
  { id: 'pipeline', key: 'sec_pipeline', icon: '&#9654;', group: 'pipeline' },
  { id: 'followup', key: 'sec_followup', icon: '&#128260;', group: 'pipeline' },
  { id: 'naturalidad', key: 'sec_naturalidad', icon: '&#127917;', group: 'pipeline' },
  // Leads
  { id: 'lead-scoring', key: 'sec_lead_scoring', icon: '&#128202;', group: 'leads' },
  // System
  { id: 'modules', key: 'sec_modules', icon: '&#128230;', group: 'system' },
  { id: 'db', key: 'sec_db', icon: '&#128452;', group: 'system' },
  { id: 'redis', key: 'sec_redis', icon: '&#9889;', group: 'system' },
] as const

const NAV_GROUPS: Record<string, Record<string, string>> = {
  channels: { es: 'Canales', en: 'Channels' },
  ai: { es: 'Inteligencia Artificial', en: 'AI' },
  pipeline: { es: 'Pipeline', en: 'Pipeline' },
  leads: { es: 'Leads', en: 'Leads' },
  system: { es: 'Sistema', en: 'System' },
}

export interface PageOptions {
  section: string
  content: string
  lang: Lang
  version: string
  flash?: string
  waConnected?: boolean
}

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

function renderHeader(opts: PageOptions): string {
  const otherLang = opts.lang === 'es' ? 'en' : 'es'
  const langLabel = opts.lang === 'es' ? 'EN' : 'ES'
  const v = opts.version.length > 7 ? opts.version.slice(0, 7) : opts.version
  return `<header>
    <h1>Oficina <span>| LUNA</span></h1>
    <div class="header-right">
      <span class="build-ver">v${esc(v)}</span>
      <a href="?lang=${otherLang}" class="lang-toggle">${langLabel}</a>
      <span class="status-text" id="status">${t('connected', opts.lang)}</span>
    </div>
  </header>`
}

function renderSidebar(opts: PageOptions): string {
  let h = ''
  let currentGroup = ''

  for (const sec of NAV_SECTIONS) {
    if (sec.group !== currentGroup) {
      if (currentGroup) h += '</div>'
      currentGroup = sec.group
      const groupLabel = NAV_GROUPS[currentGroup]?.[opts.lang] || currentGroup
      h += `<div class="sidebar-group"><div class="sidebar-group-title">${groupLabel}</div>`
    }

    const isActive = opts.section === sec.id
    const badge = getBadgeForSection(sec, opts)
    h += `<a href="/oficina/${sec.id}?lang=${opts.lang}" class="sidebar-item ${isActive ? 'active' : ''}">
      <span class="nav-icon">${sec.icon}</span>
      <span>${t(sec.key, opts.lang)}</span>
      ${badge}
    </a>`
  }
  if (currentGroup) h += '</div>'

  return `<nav class="sidebar" id="sidebar">${h}</nav>`
}

function getBadgeForSection(sec: typeof NAV_SECTIONS[number], opts: PageOptions): string {
  if ('soon' in sec && sec.soon) return '<span class="nav-badge badge-soon">soon</span>'
  if (sec.id === 'whatsapp') {
    if (opts.waConnected === true) return '<span class="nav-badge badge-active">&#9679;</span>'
    if (opts.waConnected === false) return '<span class="nav-badge badge-off">&#9679;</span>'
    return ''
  }
  return ''
}

function renderSectionHeader(opts: PageOptions): string {
  const sec = NAV_SECTIONS.find(s => s.id === opts.section)
  const title = sec ? t(sec.key, opts.lang) : opts.section
  const descKey = sec ? sec.key + '_info' : ''
  const desc = descKey ? t(descKey, opts.lang) : ''

  return `<div class="section-header">
    <div class="section-title">${title}</div>
    ${desc && desc !== descKey ? `<div class="section-desc">${desc}</div>` : ''}
  </div>`
}

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
