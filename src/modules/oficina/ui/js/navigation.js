// navigation.js — Sidebar navigation logic
// Depends on: i18n (t, lang), state (waState, moduleStates)

let activeSection = 'whatsapp'

// Section definitions: id, i18n key, icon, group
const NAV_SECTIONS = [
  // Canales
  { id: 'whatsapp', key: 'sec_whatsapp', icon: '💬', group: 'channels' },
  { id: 'email', key: 'sec_email', icon: '✉️', group: 'channels', soon: true },
  { id: 'google', key: 'sec_google', icon: '🔗', group: 'channels', soon: true },
  // IA
  { id: 'apikeys', key: 'sec_apikeys', icon: '🔑', group: 'ai' },
  { id: 'models', key: 'sec_models', icon: '🧠', group: 'ai' },
  { id: 'llm_limits', key: 'sec_llm_limits', icon: '⚙️', group: 'ai' },
  { id: 'llm_cb', key: 'sec_llm_cb', icon: '🔌', group: 'ai' },
  // Pipeline
  { id: 'pipeline', key: 'sec_pipeline', icon: '▶️', group: 'pipeline' },
  { id: 'followup', key: 'sec_followup', icon: '🔄', group: 'pipeline' },
  // Leads
  { id: 'lead_scoring', key: 'sec_lead_scoring', icon: '📊', group: 'leads' },
  // Sistema
  { id: 'modules', key: 'sec_modules', icon: '📦', group: 'system' },
  { id: 'db', key: 'sec_db', icon: '🗄️', group: 'system' },
  { id: 'redis', key: 'sec_redis', icon: '⚡', group: 'system' },
]

const NAV_GROUPS = {
  channels: { es: 'Canales', en: 'Channels' },
  ai: { es: 'Inteligencia Artificial', en: 'AI' },
  pipeline: { es: 'Pipeline', en: 'Pipeline' },
  leads: { es: 'Leads', en: 'Leads' },
  system: { es: 'Sistema', en: 'System' },
}

function navigateTo(sectionId) {
  activeSection = sectionId
  renderSidebar()
  renderContent()
}

function getBadgeForSection(sec) {
  if (sec.soon) return '<span class="nav-badge badge-soon">soon</span>'
  if (sec.id === 'whatsapp') {
    const st = waState.status
    if (st === 'connected') return '<span class="nav-badge badge-active">●</span>'
    if (st === 'disconnected' || st === 'not_initialized') return '<span class="nav-badge badge-off">●</span>'
    return ''
  }
  return ''
}

function renderSidebar() {
  const el = document.getElementById('sidebar')
  if (!el) return

  let h = ''
  let currentGroup = ''

  for (const sec of NAV_SECTIONS) {
    if (sec.group !== currentGroup) {
      currentGroup = sec.group
      const groupLabel = NAV_GROUPS[currentGroup]?.[lang] || currentGroup
      h += `<div class="sidebar-group"><div class="sidebar-group-title">${groupLabel}</div>`
    }

    const isActive = activeSection === sec.id
    const badge = getBadgeForSection(sec)
    h += `<div class="sidebar-item ${isActive ? 'active' : ''}" onclick="navigateTo('${sec.id}')">
      <span class="nav-icon">${sec.icon}</span>
      <span>${t(sec.key)}</span>
      ${badge}
    </div>`

    // Check if next section is different group to close div
    const idx = NAV_SECTIONS.indexOf(sec)
    const next = NAV_SECTIONS[idx + 1]
    if (!next || next.group !== sec.group) {
      h += '</div>'
    }
  }

  el.innerHTML = h
}
