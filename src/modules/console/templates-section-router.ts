// templates-section-router.ts - Server-side section router and shared section renderers

import { t } from './templates-i18n.js'
import { textField, secretField } from './templates-fields.js'
import { renderModulePanels } from './templates-modules.js'
import { renderChannelsSection, renderWhatsappSection, renderEmailSection, renderGoogleAppsSection } from './templates-section-channels.js'
import { renderDashboardSection, renderEngineMetricsSection, renderIdentitySection, renderLlmUnifiedSection, renderMemorySection, renderVoiceTTSSection } from './templates-section-agent.js'
import { renderLeadScoringSection, renderKnowledgeItemsSection, renderScheduledTasksSection, renderToolsCardsSection } from './templates-section-tools.js'
import { renderUsersSection } from './templates-section-contacts.js'
import { cv, type SectionData } from './templates-section-data.js'

export type { SectionData } from './templates-section-data.js'
export { renderAdvancedAgentSection, renderEngineMetricsSection } from './templates-section-agent.js'

export function renderModulesSection(data: SectionData): string {
  return renderModulePanels(data.moduleStates ?? [], data.config, data.lang)
}

export function renderInfraUnifiedSection(data: SectionData): string {
  let h = ''

  // Panel 1: PostgreSQL
  h += `<div class="panel">
    <div class="panel-header" onclick="togglePanel(this)">
      <span class="panel-title">${t('sec_db', data.lang)}</span>
      <span class="panel-chevron">&#9660;</span>
    </div>
    <div class="panel-body">
      <div class="panel-info">${t('sec_db_info', data.lang)}</div>
      ${textField('DB_HOST', cv(data, 'DB_HOST'), data.lang)}
      ${textField('DB_PORT', cv(data, 'DB_PORT'), data.lang)}
      ${textField('DB_NAME', cv(data, 'DB_NAME'), data.lang)}
      ${textField('DB_USER', cv(data, 'DB_USER'), data.lang)}
      ${secretField('DB_PASSWORD', cv(data, 'DB_PASSWORD'), data.lang)}
    </div>
  </div>`

  // Panel 2: Redis
  h += `<div class="panel">
    <div class="panel-header" onclick="togglePanel(this)">
      <span class="panel-title">${t('sec_redis', data.lang)}</span>
      <span class="panel-chevron">&#9660;</span>
    </div>
    <div class="panel-body">
      <div class="panel-info">${t('sec_redis_info', data.lang)}</div>
      ${textField('REDIS_HOST', cv(data, 'REDIS_HOST'), data.lang)}
      ${textField('REDIS_PORT', cv(data, 'REDIS_PORT'), data.lang)}
      ${secretField('REDIS_PASSWORD', cv(data, 'REDIS_PASSWORD'), data.lang)}
    </div>
  </div>`

  return h
}

// ═══════════════════════════════════════════
// Agent Advanced — API Keys + Model Assignment Table
// ═══════════════════════════════════════════

/** Short display name for a model id */

export function renderDatabaseViewer(data: SectionData): string {
  const lang = data.lang
  return `<!-- Password gate -->
<div class="db-auth-gate" id="db-auth-gate">
  <div class="db-auth-card">
    <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="var(--on-surface-dim)" stroke-width="1" stroke-linecap="round" stroke-linejoin="round"><ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3"/><path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"/></svg>
    <h3 class="db-auth-title">${t('dbg_db_title', lang)}</h3>
    <p class="db-auth-desc">${t('dbg_db_password_desc', lang)}</p>
    <input type="password" class="db-auth-input" id="db-auth-password" placeholder="${lang === 'es' ? 'Contraseña de admin' : 'Admin password'}" autocomplete="off">
    <div class="db-auth-error" id="db-auth-error" style="display:none"></div>
    <button class="db-auth-btn" id="db-auth-submit">${lang === 'es' ? 'Acceder' : 'Access'}</button>
  </div>
</div>
<!-- Viewer (hidden until auth) -->
<div class="db-viewer" id="db-viewer-container" data-lang="${lang}" style="display:none">
  <div class="db-viewer-sidebar">
    <div class="db-viewer-sidebar-header">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3"/><path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"/></svg>
      <span>${t('dbg_db_tables', lang)}</span>
    </div>
    <div class="db-table-list" id="db-table-list">
      <div class="db-loading">${t('dbg_db_loading', lang)}</div>
    </div>
  </div>
  <div class="db-viewer-main">
    <div class="db-viewer-toolbar" id="db-toolbar" style="display:none">
      <div class="db-toolbar-left">
        <span class="db-table-name" id="db-current-table"></span>
        <span class="db-table-meta" id="db-current-meta"></span>
      </div>
      <div class="db-toolbar-right">
        <label>${t('dbg_db_per_page', lang)}:
          <select id="db-per-page" class="db-select">
            <option value="25">25</option>
            <option value="50" selected>50</option>
            <option value="100">100</option>
          </select>
        </label>
      </div>
    </div>
    <div class="db-grid-wrap" id="db-grid-wrap">
      <div class="db-empty-state" id="db-empty-state">
        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="var(--on-surface-dim)" stroke-width="1" stroke-linecap="round" stroke-linejoin="round"><ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3"/><path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"/></svg>
        <p>${t('dbg_db_select_table', lang)}</p>
      </div>
      <div class="db-grid-scroll" id="db-grid-scroll" style="display:none">
        <table class="db-grid" id="db-grid">
          <thead id="db-grid-head"></thead>
          <tbody id="db-grid-body"></tbody>
        </table>
      </div>
    </div>
    <div class="db-pagination" id="db-pagination" style="display:none">
      <div class="db-pagination-info" id="db-pagination-info"></div>
      <div class="db-pagination-controls">
        <button class="db-page-btn" id="db-prev" disabled>&#8249; ${t('dbg_db_page', lang)}</button>
        <span id="db-page-num">1</span>
        <button class="db-page-btn" id="db-next">${t('dbg_db_page', lang)} &#8250;</button>
      </div>
    </div>
  </div>
</div>`
}

// ═══════════════════════════════════════════
// Memory section — tabbed: working / mid-term / advanced
// ═══════════════════════════════════════════

export function renderSection(section: string, data: SectionData): string | null {
  switch (section) {
    case 'dashboard': return renderDashboardSection(data)
    case 'channels': return renderChannelsSection(data)
    case 'whatsapp': return renderWhatsappSection(data)
    case 'llm': return renderLlmUnifiedSection(data)
    case 'engine-metrics': return renderEngineMetricsSection(data)
    case 'lead-scoring': return renderLeadScoringSection(data)
    case 'scheduled-tasks': return renderScheduledTasksSection(data)
    case 'memory': return renderMemorySection(data)
    case 'knowledge': return renderKnowledgeItemsSection(data)
    case 'contacts': return renderUsersSection(data)
    case 'agente': return data.agenteContent || '<div class="panel"><div class="panel-body"><p>Select a tab.</p></div></div>'
    case 'identity': return renderIdentitySection(data)
    case 'voice-tts': return renderVoiceTTSSection(data)
    case 'tools-cards': return renderToolsCardsSection(data)
    case 'herramientas': return data.herramientasContent || '<div class="panel"><div class="panel-body"><p>Select a tab.</p></div></div>'
    case 'modules': return renderModulesSection(data)
    case 'infra': return renderInfraUnifiedSection(data)
    case 'google-apps': return renderGoogleAppsSection(data)
    case 'email': return renderEmailSection(data)
    case 'debug-database': return renderDatabaseViewer(data)
    default: return null
  }
}
