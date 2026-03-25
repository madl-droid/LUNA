// templates-sections.ts — Server-side section renderers (migrated from ui/js/render.js)

import { t, tWaStatus, type Lang } from './templates-i18n.js'
import { esc, textField, secretField, numField, boolField, modelDropdown } from './templates-fields.js'
import { renderModulePanels, type ModuleInfo } from './templates-modules.js'

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
  leadScoringHtml?: string
  usersData?: {
    configs: Array<{ listType: string; displayName: string; isEnabled: boolean; permissions: { tools: string[]; skills: string[]; subagents: boolean; allAccess: boolean }; unregisteredBehavior: string; unregisteredMessage: string | null; maxUsers: number | null }>
    usersByType: Record<string, Array<{ id: string; displayName: string | null; listType: string; isActive: boolean; source: string; contacts: Array<{ id: string; channel: string; senderId: string; isPrimary: boolean }> }>>
    counts: Record<string, number>
    channels: Array<{ id: string; label: { es: string; en: string } | string }>
    tools: Array<{ name: string; description: string; category?: string }>
  }
}

const GOOGLE_SVG = `<svg width="18" height="18" viewBox="0 0 18 18" class="google-icon" xmlns="http://www.w3.org/2000/svg">
  <path d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844c-.209 1.125-.843 2.078-1.796 2.717v2.258h2.908c1.702-1.567 2.684-3.875 2.684-6.615z" fill="#4285F4"/>
  <path d="M9 18c2.43 0 4.467-.806 5.956-2.18l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 0 0 9 18z" fill="#34A853"/>
  <path d="M3.964 10.71A5.41 5.41 0 0 1 3.682 9c0-.593.102-1.17.282-1.71V4.958H.957A8.996 8.996 0 0 0 0 9c0 1.452.348 2.827.957 4.042l3.007-2.332z" fill="#FBBC05"/>
  <path d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 0 0 .957 4.958L3.964 6.29C4.672 4.163 6.656 3.58 9 3.58z" fill="#EA4335"/>
</svg>`

function cv(data: SectionData, key: string): string {
  return data.config[key] ?? ''
}

export function renderWhatsappSection(data: SectionData): string {
  const wa = data.waState ?? { status: 'not_initialized', qrDataUrl: null, lastDisconnectReason: null, moduleEnabled: false }
  const moduleEnabled = wa.moduleEnabled !== false
  const statusLabel = tWaStatus(wa.status, data.lang)
  const showQr = wa.status === 'qr_ready' && wa.qrDataUrl
  const canConnect = moduleEnabled && (wa.status === 'disconnected' || wa.status === 'not_initialized')
  const canDisconnect = wa.status === 'connected' || wa.status === 'qr_ready' || wa.status === 'connecting'

  const waPhone = cv(data, 'WHATSAPP_PHONE_NUMBER')
  const twilioPhone = cv(data, 'TWILIO_PHONE_NUMBER')

  return `<div class="panel">
    <div class="panel-header" onclick="togglePanel(this)">
      <span class="panel-title">${t('sec_whatsapp_baileys', data.lang)}
        <span class="panel-badge badge-active">${statusLabel}</span>
        ${!moduleEnabled ? '<span class="panel-badge badge-soon">' + t('waModuleDisabled', data.lang) + '</span>' : ''}
      </span>
      <span class="panel-chevron">&#9660;</span>
    </div>
    <div class="panel-body">
      <div class="panel-info">${t('sec_whatsapp_baileys_info', data.lang)}</div>
      <div id="wa-inner">
        <div class="wa-status-row">
          <span class="wa-badge ${wa.status}"><span class="wa-dot"></span>${statusLabel}</span>
          ${wa.lastDisconnectReason ? `<span class="wa-reason">${t('reason', data.lang)}: ${esc(wa.lastDisconnectReason)}</span>` : ''}
        </div>
        <div class="wa-actions">
          <button class="wa-btn wa-btn-connect" onclick="waConnect()" ${canConnect ? '' : 'disabled'} ${!moduleEnabled ? 'title="' + t('waModuleDisabled', data.lang) + '"' : ''}>${t('connectBtn', data.lang)}</button>
          <button class="wa-btn wa-btn-disconnect" onclick="waDisconnect()" ${canDisconnect ? '' : 'disabled'}>${t('disconnectBtn', data.lang)}</button>
        </div>
        <div class="wa-qr-box ${showQr ? '' : 'wa-qr-hidden'}">
          ${showQr ? `<img src="${wa.qrDataUrl}" alt="QR" />` : ''}
          <div class="wa-qr-label">${t('scanLabel', data.lang)}</div>
        </div>
        <div class="wa-phones">
          <div><label>${t('f_WHATSAPP_PHONE', data.lang)}</label>
            <input type="text" name="WHATSAPP_PHONE_NUMBER" value="${esc(waPhone)}" data-original="${esc(waPhone)}"></div>
          <div><label>${t('f_TWILIO_PHONE', data.lang)}</label>
            <input type="text" name="TWILIO_PHONE_NUMBER" value="${esc(twilioPhone)}" data-original="${esc(twilioPhone)}"></div>
        </div>
      </div>
    </div>
  </div>
  ${renderModulePanels(data.moduleStates ?? [], data.config, data.lang, 'whatsapp')}`
}

// ═══════════════════════════════════════════
// Unified LLM page — apikeys + models + limits + circuit breaker
// ═══════════════════════════════════════════

export function renderLlmUnifiedSection(data: SectionData): string {
  let h = ''

  // Panel 1: API Keys
  h += `<div class="panel">
    <div class="panel-header" onclick="togglePanel(this)">
      <span class="panel-title">${t('sec_apikeys', data.lang)}</span>
      <span class="panel-chevron">&#9660;</span>
    </div>
    <div class="panel-body">
      <div class="panel-info">${t('sec_apikeys_info', data.lang)}</div>
      ${secretField('ANTHROPIC_API_KEY', cv(data, 'ANTHROPIC_API_KEY'), data.lang, 'f_ANTHROPIC_API_KEY', 'i_ANTHROPIC_API_KEY')}
      ${secretField('GOOGLE_AI_API_KEY', cv(data, 'GOOGLE_AI_API_KEY'), data.lang, 'f_GOOGLE_AI_API_KEY', 'i_GOOGLE_AI_API_KEY')}
    </div>
  </div>`

  // Panel 2: Models
  h += `<div class="panel">
    <div class="panel-header" onclick="togglePanel(this)">
      <span class="panel-title">${t('sec_models', data.lang)}</span>
      <span class="panel-chevron">&#9660;</span>
    </div>
    <div class="panel-body">
      <div class="panel-info">${t('sec_models_info', data.lang)}</div>
      ${renderModelsContent(data)}
    </div>
  </div>`

  // Panel 3: Limits & Tokens
  h += `<div class="panel">
    <div class="panel-header" onclick="togglePanel(this)">
      <span class="panel-title">${t('sec_llm_limits', data.lang)}</span>
      <span class="panel-chevron">&#9660;</span>
    </div>
    <div class="panel-body">
      <div class="panel-info">${t('sec_llm_limits_info', data.lang)}</div>
      ${numField('LLM_MAX_INPUT_TOKENS', cv(data, 'LLM_MAX_INPUT_TOKENS'), data.lang, 'f_LLM_MAX_INPUT_TOKENS')}
      ${numField('LLM_MAX_OUTPUT_TOKENS', cv(data, 'LLM_MAX_OUTPUT_TOKENS'), data.lang, 'f_LLM_MAX_OUTPUT_TOKENS')}
      ${numField('LLM_TEMPERATURE_CLASSIFY', cv(data, 'LLM_TEMPERATURE_CLASSIFY'), data.lang, 'f_LLM_TEMPERATURE_CLASSIFY', 'i_TEMPERATURE_CLASSIFY')}
      ${numField('LLM_TEMPERATURE_RESPOND', cv(data, 'LLM_TEMPERATURE_RESPOND'), data.lang, 'f_LLM_TEMPERATURE_RESPOND', 'i_TEMPERATURE_RESPOND')}
      ${numField('LLM_TEMPERATURE_COMPLEX', cv(data, 'LLM_TEMPERATURE_COMPLEX'), data.lang, 'f_LLM_TEMPERATURE_COMPLEX', 'i_TEMPERATURE_COMPLEX')}
      ${numField('LLM_REQUEST_TIMEOUT_MS', cv(data, 'LLM_REQUEST_TIMEOUT_MS'), data.lang, 'f_LLM_REQUEST_TIMEOUT_MS')}
    </div>
  </div>`

  // Panel 4: Circuit Breaker
  h += `<div class="panel">
    <div class="panel-header" onclick="togglePanel(this)">
      <span class="panel-title">${t('sec_llm_cb', data.lang)}</span>
      <span class="panel-chevron">&#9660;</span>
    </div>
    <div class="panel-body">
      <div class="panel-info">${t('sec_llm_cb_info', data.lang)}</div>
      ${numField('LLM_CIRCUIT_BREAKER_FAILURES', cv(data, 'LLM_CIRCUIT_BREAKER_FAILURES'), data.lang, 'f_LLM_CIRCUIT_BREAKER_FAILURES', 'i_LLM_CB_FAILURES')}
      ${numField('LLM_CIRCUIT_BREAKER_WINDOW_MS', cv(data, 'LLM_CIRCUIT_BREAKER_WINDOW_MS'), data.lang, 'f_LLM_CIRCUIT_BREAKER_WINDOW_MS', 'i_LLM_CB_WINDOW')}
      ${numField('LLM_CIRCUIT_BREAKER_COOLDOWN_MS', cv(data, 'LLM_CIRCUIT_BREAKER_COOLDOWN_MS'), data.lang, 'f_LLM_CIRCUIT_BREAKER_COOLDOWN_MS', 'i_LLM_CB_COOLDOWN')}
    </div>
  </div>`

  // Panel 5: Routing overrides (force provider per task)
  const routeLabel = data.lang === 'es' ? 'Enrutamiento' : 'Routing'
  const routeInfo = data.lang === 'es'
    ? 'Forzar un provider específico por tarea. Dejar vacío para usar fallback chain automática.'
    : 'Force a specific provider per task. Leave empty to use automatic fallback chain.'
  h += `<div class="panel collapsed">
    <div class="panel-header" onclick="togglePanel(this)">
      <span class="panel-title">${routeLabel}</span>
      <span class="panel-chevron">&#9660;</span>
    </div>
    <div class="panel-body">
      <div class="panel-info">${routeInfo}</div>
      ${textField('LLM_ROUTE_CLASSIFY', cv(data, 'LLM_ROUTE_CLASSIFY'), data.lang, data.lang === 'es' ? 'Clasificar' : 'Classify')}
      ${textField('LLM_ROUTE_RESPOND', cv(data, 'LLM_ROUTE_RESPOND'), data.lang, data.lang === 'es' ? 'Responder' : 'Respond')}
      ${textField('LLM_ROUTE_COMPLEX', cv(data, 'LLM_ROUTE_COMPLEX'), data.lang, data.lang === 'es' ? 'Complejo' : 'Complex')}
      ${textField('LLM_ROUTE_TOOLS', cv(data, 'LLM_ROUTE_TOOLS'), data.lang, data.lang === 'es' ? 'Herramientas' : 'Tools')}
      ${textField('LLM_ROUTE_PROACTIVE', cv(data, 'LLM_ROUTE_PROACTIVE'), data.lang, data.lang === 'es' ? 'Proactivo' : 'Proactive')}
    </div>
  </div>`

  // Panel 6: Rate limits per provider
  const rateLabel = data.lang === 'es' ? 'Límites de tasa' : 'Rate Limits'
  const rateInfo = data.lang === 'es'
    ? 'Requests por minuto (RPM) y tokens por minuto (TPM) por provider. 0 = sin límite.'
    : 'Requests per minute (RPM) and tokens per minute (TPM) per provider. 0 = no limit.'
  h += `<div class="panel collapsed">
    <div class="panel-header" onclick="togglePanel(this)">
      <span class="panel-title">${rateLabel}</span>
      <span class="panel-chevron">&#9660;</span>
    </div>
    <div class="panel-body">
      <div class="panel-info">${rateInfo}</div>
      ${numField('LLM_RPM_ANTHROPIC', cv(data, 'LLM_RPM_ANTHROPIC'), data.lang, 'RPM Anthropic')}
      ${numField('LLM_RPM_GOOGLE', cv(data, 'LLM_RPM_GOOGLE'), data.lang, 'RPM Google')}
      ${numField('LLM_TPM_ANTHROPIC', cv(data, 'LLM_TPM_ANTHROPIC'), data.lang, 'TPM Anthropic')}
      ${numField('LLM_TPM_GOOGLE', cv(data, 'LLM_TPM_GOOGLE'), data.lang, 'TPM Google')}
    </div>
  </div>`

  return h
}

/** Inner content for the models panel (reused by both standalone and unified) */
function renderModelsContent(data: SectionData): string {
  const models = data.allModels ?? { anthropic: [], gemini: [] }
  const modelTasks: [string, string, string][] = [
    ['LLM_CLASSIFY', 'f_LLM_CLASSIFY', 'i_LLM_CLASSIFY'],
    ['LLM_RESPOND', 'f_LLM_RESPOND', 'i_LLM_RESPOND'],
    ['LLM_COMPLEX', 'f_LLM_COMPLEX', 'i_LLM_COMPLEX'],
    ['LLM_TOOLS', 'f_LLM_TOOLS', 'i_LLM_TOOLS'],
    ['LLM_COMPRESS', 'f_LLM_COMPRESS', 'i_LLM_COMPRESS'],
    ['LLM_PROACTIVE', 'f_LLM_PROACTIVE', 'i_LLM_PROACTIVE'],
  ]
  const fallbackTasks: [string, string, string][] = [
    ['LLM_FALLBACK_CLASSIFY', 'f_LLM_FB_CLASSIFY', 'i_LLM_FB_CLASSIFY'],
    ['LLM_FALLBACK_RESPOND', 'f_LLM_FB_RESPOND', 'i_LLM_FB_RESPOND'],
    ['LLM_FALLBACK_COMPLEX', 'f_LLM_FB_COMPLEX', 'i_LLM_FB_COMPLEX'],
  ]

  const scanInfo = data.lastScan
    ? `<span class="scan-info">${t('lastScan', data.lang)}: ${esc(data.lastScan.lastScanAt)}</span>`
    : ''
  const scanReplacements = (data.lastScan?.replacements?.length)
    ? data.lastScan.replacements.map(r =>
        `<div class="scan-replacement">
          ${esc(r.configKey)}: <s>${esc(r.oldModel)}</s> ${t('scanReplaced', data.lang)} <b>${esc(r.newModel)}</b>
        </div>`
      ).join('') : ''

  let h = `<div class="scan-bar">
    <button type="button" class="wa-btn wa-btn-connect" onclick="triggerScan()">${t('scanModelsBtn', data.lang)}</button>
    ${scanInfo}
  </div>
  <div id="scan-replacements">${scanReplacements}</div>
  <div class="section-label">${t('models_primary', data.lang)}</div>`

  for (const [prefix, labelKey, infoKey] of modelTasks) {
    h += modelDropdown(prefix, cv(data, prefix + '_PROVIDER') || 'anthropic', cv(data, prefix + '_MODEL'), models, data.lang, labelKey, infoKey)
  }
  h += `<div class="section-label with-border">${t('models_fallback', data.lang)}</div>`
  for (const [prefix, labelKey, infoKey] of fallbackTasks) {
    h += modelDropdown(prefix, cv(data, prefix + '_PROVIDER') || 'anthropic', cv(data, prefix + '_MODEL'), models, data.lang, labelKey, infoKey)
  }
  h += `<script type="application/json" id="models-data">${JSON.stringify(models)}</script>`
  return h
}

// ═══════════════════════════════════════════
// Unified Pipeline page — pipeline + follow-up + naturalidad
// ═══════════════════════════════════════════

export function renderPipelineUnifiedSection(data: SectionData): string {
  let h = ''

  // Panel 1: Pipeline limits
  h += `<div class="panel">
    <div class="panel-header" onclick="togglePanel(this)">
      <span class="panel-title">${t('sec_pipeline', data.lang)}</span>
      <span class="panel-chevron">&#9660;</span>
    </div>
    <div class="panel-body">
      <div class="panel-info">${t('sec_pipeline_info', data.lang)}</div>
      ${numField('PIPELINE_MAX_TOOL_CALLS_PER_TURN', cv(data, 'PIPELINE_MAX_TOOL_CALLS_PER_TURN'), data.lang, 'f_PIPELINE_MAX_TOOL_CALLS_PER_TURN', 'i_PIPELINE_TOOLS')}
      ${numField('PIPELINE_MAX_CONVERSATION_TURNS', cv(data, 'PIPELINE_MAX_CONVERSATION_TURNS'), data.lang, 'f_PIPELINE_MAX_CONVERSATION_TURNS', 'i_PIPELINE_TURNS')}
      ${numField('PIPELINE_SESSION_TTL_MS', cv(data, 'PIPELINE_SESSION_TTL_MS'), data.lang, 'f_PIPELINE_SESSION_TTL_MS', 'i_PIPELINE_TTL')}
      ${numField('SUBAGENT_MAX_ITERATIONS', cv(data, 'SUBAGENT_MAX_ITERATIONS') || '5', data.lang, 'f_SUBAGENT_MAX_ITERATIONS', 'i_SUBAGENT_ITER')}
      ${numField('PIPELINE_MAX_REPLAN_ATTEMPTS', cv(data, 'PIPELINE_MAX_REPLAN_ATTEMPTS') || '2', data.lang, 'f_PIPELINE_MAX_REPLAN_ATTEMPTS', 'i_PIPELINE_REPLAN')}
    </div>
  </div>`

  // Panel 2: Follow-up
  h += `<div class="panel">
    <div class="panel-header" onclick="togglePanel(this)">
      <span class="panel-title">${t('sec_followup', data.lang)}</span>
      <span class="panel-chevron">&#9660;</span>
    </div>
    <div class="panel-body">
      <div class="panel-info">${t('sec_followup_info', data.lang)}</div>
      ${boolField('FOLLOWUP_ENABLED', cv(data, 'FOLLOWUP_ENABLED') || 'false', data.lang, 'f_FOLLOWUP_ENABLED')}
      ${numField('FOLLOWUP_DELAY_MINUTES', cv(data, 'FOLLOWUP_DELAY_MINUTES'), data.lang, 'f_FOLLOWUP_DELAY_MINUTES', 'i_FOLLOWUP_DELAY')}
      ${numField('FOLLOWUP_MAX_ATTEMPTS', cv(data, 'FOLLOWUP_MAX_ATTEMPTS'), data.lang, 'f_FOLLOWUP_MAX_ATTEMPTS', 'i_FOLLOWUP_MAX')}
      ${numField('FOLLOWUP_COLD_AFTER_ATTEMPTS', cv(data, 'FOLLOWUP_COLD_AFTER_ATTEMPTS'), data.lang, 'f_FOLLOWUP_COLD_AFTER_ATTEMPTS', 'i_FOLLOWUP_COLD')}
    </div>
  </div>`

  // Panel 3: Naturalidad — ACK params moved to each channel's settings page
  const natInfo = data.lang === 'es'
    ? 'Los avisos de naturalidad (acknowledgments) se configuran ahora en la pestaña de ajustes de cada canal: WhatsApp y Gmail.'
    : 'Naturalness acknowledgments are now configured in each channel\'s settings tab: WhatsApp and Gmail.'
  h += `<div class="panel">
    <div class="panel-header" onclick="togglePanel(this)">
      <span class="panel-title">${t('sec_naturalidad', data.lang)}</span>
      <span class="panel-chevron">&#9660;</span>
    </div>
    <div class="panel-body">
      <div class="panel-info">${natInfo}</div>
    </div>
  </div>`

  return h
}

export function renderLeadScoringSection(data: SectionData): string {
  if (data.leadScoringHtml) {
    return data.leadScoringHtml
  }
  // Fallback: link to standalone page
  return `<div class="panel">
    <div class="panel-header panel-header-link" onclick="window.location.href='/console/api/lead-scoring/ui'">
      <span class="panel-title">${t('sec_lead_scoring', data.lang)} <span class="panel-badge badge-active">${t('sec_lead_scoring_badge', data.lang)}</span></span>
      <span class="panel-chevron panel-chevron-right">&#9660;</span>
    </div>
  </div>`
}

export function renderModulesSection(data: SectionData): string {
  return renderModulePanels(data.moduleStates ?? [], data.config, data.lang)
}

export function renderEmailSection(data: SectionData): string {
  const ga = data.gmailAuth ?? { connected: false, email: null }
  const moduleActive = data.moduleStates?.some(m => m.name === 'gmail' && m.active) ?? false

  if (!moduleActive) {
    const msg = data.lang === 'es'
      ? 'El modulo Gmail no esta activado. Activalo desde la seccion <a href="/console/modules">Modulos</a> para poder conectar.'
      : 'The Gmail module is not active. Activate it from the <a href="/console/modules">Modules</a> section to connect.'
    return `<div class="panel"><div class="panel-body panel-body-flat">
      <div class="panel-info module-inactive-notice">${msg}</div>
    </div></div>`
  }

  const statusLabel = ga.connected
    ? `<span class="status-dot connected"></span><span class="status-label connected">${t('gmailConnected', data.lang)}</span>${ga.email ? ` — <span class="status-email">${esc(ga.email)}</span>` : ''}`
    : `<span class="status-dot disconnected"></span><span class="status-label disconnected">${t('gmailNotConnected', data.lang)}</span>`

  const googleSvg = GOOGLE_SVG

  return `<div class="panel">
    <div class="panel-body panel-body-flat">
      <div class="panel-info">${t('gmailAuthInfo', data.lang)}</div>
      <div class="status-row">
        <div class="status-label">${statusLabel}</div>
        <button type="button" class="btn-secondary" onclick="refreshGmailStatus()">${t('googleRefreshStatus', data.lang)}</button>
      </div>
      <div class="status-actions">
        ${!ga.connected ? `
        <button type="button" class="wa-btn wa-btn-connect" onclick="gmailConnect()">
          ${googleSvg} ${t('gmailConnectBtn', data.lang)}
        </button>` : `
        <button type="button" class="btn-danger" onclick="gmailDisconnect()">
          ${t('gmailDisconnectBtn', data.lang)}
        </button>`}
      </div>
    </div>
  </div>
  ${renderModulePanels(data.moduleStates ?? [], data.config, data.lang, 'gmail')}`
}

export function renderGoogleAppsSection(data: SectionData): string {
  const ga = data.googleAppsAuth ?? { connected: false, email: null }
  const moduleActive = data.moduleStates?.some(m => m.name === 'google-apps' && m.active) ?? false

  if (!moduleActive) {
    const msg = data.lang === 'es'
      ? 'El modulo Google Apps no esta activado. Activalo desde la seccion <a href="/console/modules">Modulos</a> para poder conectar.'
      : 'The Google Apps module is not active. Activate it from the <a href="/console/modules">Modules</a> section to connect.'
    return `<div class="panel"><div class="panel-body panel-body-flat">
      <div class="panel-info module-inactive-notice">${msg}</div>
    </div></div>`
  }

  const statusLabel = ga.connected
    ? `<span class="status-dot connected"></span><span class="status-label connected">${t('googleAppsConnected', data.lang)}</span>${ga.email ? ` — <span class="status-email">${esc(ga.email)}</span>` : ''}`
    : `<span class="status-dot disconnected"></span><span class="status-label disconnected">${t('googleAppsNotConnected', data.lang)}</span>`

  const googleSvg = GOOGLE_SVG

  const serviceList = ['Drive', 'Sheets', 'Docs', 'Slides', 'Calendar']

  return `<div class="panel">
    <div class="panel-body panel-body-flat">
      <div class="panel-info">${t('googleAppsAuthInfo', data.lang)}</div>
      <div class="status-row">
        <div class="status-label">${statusLabel}</div>
        <button type="button" class="btn-secondary" onclick="refreshGoogleAppsStatus()">${t('googleRefreshStatus', data.lang)}</button>
      </div>
      <div class="status-actions">
        ${!ga.connected ? `
        <button type="button" class="wa-btn wa-btn-connect" onclick="googleAppsConnect()">
          ${googleSvg} ${t('googleAppsConnectBtn', data.lang)}
        </button>` : `
        <button type="button" class="btn-danger" onclick="googleAppsDisconnect()">
          ${t('googleAppsDisconnectBtn', data.lang)}
        </button>`}
      </div>
      <div class="services-list">
        <span class="services-label">${t('googleAppsServicesTitle', data.lang)}: </span>
        ${serviceList.map(s => `<span class="panel-badge badge-active">${s}</span>`).join(' ')}
      </div>
    </div>
  </div>
  ${renderModulePanels(data.moduleStates ?? [], data.config, data.lang, 'google-apps')}`
}

// ═══════════════════════════════════════════
// Unified Infrastructure page — DB + Redis
// ═══════════════════════════════════════════

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

export function renderEngineMetricsSection(data: SectionData): string {
  const lang = data.lang

  return `<div class="panel">
    <div class="panel-header" onclick="togglePanel(this)"><span class="panel-title">${t('em_title', lang)}</span><span class="panel-chevron">&#9660;</span></div>
    <div class="panel-body">
      <div class="metrics-period-row">
        <label>${t('em_period', lang)}:
          <select id="metrics-period" class="metrics-period-select">
            <option value="24h">24h</option>
            <option value="7d">7d</option>
            <option value="30d">30d</option>
          </select>
        </label>
      </div>
      <div id="metrics-summary">${t('em_loading', lang)}</div>
      <table id="metrics-table" class="metrics-table">
        <tr>
          <th>${t('em_total', lang)}</th><th>${t('em_replan', lang)}</th><th>${t('em_avg_replan', lang)}</th><th>${t('em_max_replan', lang)}</th>
          <th>${t('em_subagent', lang)}</th><th>${t('em_avg_sub_iter', lang)}</th><th>${t('em_max_sub_iter', lang)}</th>
          <th>${t('em_avg_ms', lang)}</th><th>${t('em_p95', lang)}</th>
        </tr>
        <tbody id="metrics-summary-row"></tbody>
      </table>
      <h4 class="metrics-trends-title">${t('em_trends', lang)}</h4>
      <table id="metrics-trends" class="metrics-table">
        <tr>
          <th>${t('em_day', lang)}</th><th>${t('em_total', lang)}</th><th>${t('em_avg_replan', lang)}</th>
          <th>${t('em_avg_sub_iter', lang)}</th><th>${t('em_avg_ms', lang)}</th>
        </tr>
        <tbody id="metrics-trends-rows"></tbody>
      </table>
      <script>
      (function(){
        var sel=document.getElementById('metrics-period');
        function load(){
          var p=sel.value;
          fetch('/console/api/console/engine-metrics?period='+p)
            .then(function(r){return r.json()})
            .then(function(d){
              var s=d.summary||{};
              document.getElementById('metrics-summary').style.display='none';
              var t=document.getElementById('metrics-table');t.style.display='table';
              document.getElementById('metrics-summary-row').innerHTML=
                '<tr><td>'+n(s.total_executions)+'</td><td>'+n(s.executions_with_replan)+'</td>'
                +'<td>'+n(s.avg_replan_attempts)+'</td><td>'+n(s.max_replan_attempts)+'</td>'
                +'<td>'+n(s.executions_with_subagent)+'</td><td>'+n(s.avg_subagent_iterations)+'</td>'
                +'<td>'+n(s.max_subagent_iterations)+'</td><td>'+n(s.avg_total_ms)+'</td>'
                +'<td>'+n(s.p95_total_ms)+'</td></tr>';
              var rows=d.trends||[];
              var tb=document.getElementById('metrics-trends-rows');
              var tt=document.getElementById('metrics-trends');
              if(rows.length>0){
                tt.style.display='table';
                tb.innerHTML=rows.map(function(r){
                  return '<tr><td>'+r.day+'</td><td>'+n(r.total)+'</td><td>'+n(r.avg_replan)
                    +'</td><td>'+n(r.avg_subagent_iter)+'</td><td>'+n(r.avg_ms)+'</td></tr>';
                }).join('');
              }
            })
            .catch(function(){document.getElementById('metrics-summary').textContent='${t('em_error', lang)}'});
        }
        function n(v){return v==null?'-':v}
        sel.addEventListener('change',load);
        load();
      })();
      </script>
    </div>
  </div>`
}

export function renderScheduledTasksSection(data: SectionData): string {
  if (data.scheduledTasksHtml) return data.scheduledTasksHtml
  // Fallback if render service not available
  return `<div class="panel"><div class="panel-body panel-body-flat panel-body-empty">
    ${t('sec_scheduled_tasks_unavailable', data.lang)}
  </div></div>`
}

// ═══════════════════════════════════════════
// Channels overview — card grid
// ═══════════════════════════════════════════

interface ChannelCard {
  id: string
  moduleName: string
  channelType: 'instant' | 'async' | 'voice'
  name: string
  description: string
  icon: string
  iconBg: string
  status: 'connected' | 'disconnected' | 'inactive' | 'error'
  active: boolean
  settingsUrl: string
}

// Icons use currentColor — color is controlled by CSS based on data-status
const CHANNEL_ICONS: Record<string, { svg: string; bg: string }> = {
  whatsapp: {
    svg: `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/></svg>`,
    bg: 'rgba(37, 211, 102, 0.08)',
  },
  gmail: {
    svg: `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="4" width="20" height="16" rx="2"/><path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"/></svg>`,
    bg: 'rgba(234, 67, 53, 0.08)',
  },
  'google-chat': {
    svg: `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>`,
    bg: 'rgba(26, 115, 232, 0.08)',
  },
  'twilio-voice': {
    svg: `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/></svg>`,
    bg: 'rgba(242, 47, 70, 0.08)',
  },
}

const CHANNEL_DESCRIPTIONS: Record<string, Record<string, string>> = {
  whatsapp: {
    es: 'Atencion al cliente y seguimiento de leads en tiempo real a traves de WhatsApp Business. Conversaciones directas, QR para vincular dispositivo, reconexion automatica.',
    en: 'Real-time customer support and lead follow-up through WhatsApp Business. Direct conversations, QR device linking, automatic reconnection.',
  },
  gmail: {
    es: 'Procesamiento inteligente de correos electronicos entrantes y salientes via Gmail API. Respuestas automaticas, hilos de conversacion, filtrado de no-reply y adjuntos.',
    en: 'Intelligent processing of incoming and outgoing emails via Gmail API. Automatic replies, conversation threads, no-reply filtering and attachments.',
  },
  'google-chat': {
    es: 'Colaboracion interna en Google Workspace. El agente responde consultas del equipo en espacios y mensajes directos como bot de Chat.',
    en: 'Internal collaboration via Google Workspace. The agent answers team queries in spaces and direct messages as a Chat bot.',
  },
  'twilio-voice': {
    es: 'Llamadas de voz con IA conversacional en tiempo real usando Twilio y Gemini Live. Atiende llamadas entrantes y realiza llamadas salientes con sintesis de voz natural.',
    en: 'Real-time conversational AI voice calls using Twilio and Gemini Live. Handles incoming calls and makes outbound calls with natural voice synthesis.',
  },
}

function buildChannelCards(data: SectionData): ChannelCard[] {
  const lang = data.lang
  const modules = data.moduleStates ?? []
  const cards: ChannelCard[] = []

  const channelDefs: Array<{ id: string; moduleName: string; sectionId: string; defaultType: 'instant' | 'async' | 'voice' }> = [
    { id: 'whatsapp', moduleName: 'whatsapp', sectionId: 'whatsapp', defaultType: 'instant' },
    { id: 'gmail', moduleName: 'gmail', sectionId: 'email', defaultType: 'async' },
    { id: 'google-chat', moduleName: 'google-chat', sectionId: 'google-chat', defaultType: 'instant' },
    { id: 'twilio-voice', moduleName: 'twilio-voice', sectionId: 'twilio-voice', defaultType: 'voice' },
  ]

  for (const ch of channelDefs) {
    const mod = modules.find(m => m.name === ch.moduleName)
    const isActive = mod?.active ?? false
    const channelType = mod?.channelType ?? ch.defaultType

    let status: ChannelCard['status'] = 'inactive'
    if (isActive) {
      status = 'disconnected'
      if (ch.id === 'whatsapp' && data.waState) {
        status = data.waState.status === 'connected' ? 'connected' : 'disconnected'
      }
      if (ch.id === 'gmail' && data.gmailAuth) {
        status = data.gmailAuth.connected ? 'connected' : 'disconnected'
      }
      if (ch.id === 'google-chat') {
        status = data.googleChatConnected ? 'connected' : 'disconnected'
      }
    }

    const iconInfo = CHANNEL_ICONS[ch.id] ?? { svg: '', bg: 'rgba(0,0,0,0.05)' }
    const desc = CHANNEL_DESCRIPTIONS[ch.id]?.[lang] ?? CHANNEL_DESCRIPTIONS[ch.id]?.es ?? ''
    // Read name from manifest console.title (single source of truth)
    const name = mod?.console?.title?.[lang as 'es' | 'en'] ?? ch.id

    cards.push({
      id: ch.id,
      moduleName: ch.moduleName,
      channelType,
      name,
      description: desc,
      icon: iconInfo.svg,
      iconBg: iconInfo.bg,
      status,
      active: isActive,
      settingsUrl: `/console/channels/${ch.id}?lang=${lang}`,
    })
  }

  // Dynamic channel modules not in the hardcoded list
  for (const mod of modules) {
    if (mod.type !== 'channel') continue
    if (channelDefs.some(c => c.moduleName === mod.name)) continue

    const iconInfo = CHANNEL_ICONS[mod.name] ?? { svg: '', bg: 'rgba(0,0,0,0.05)' }
    const title = mod.console?.title?.[lang as 'es' | 'en'] ?? mod.name
    cards.push({
      id: mod.name,
      moduleName: mod.name,
      channelType: mod.channelType ?? 'instant',
      name: title,
      description: '',
      icon: iconInfo.svg,
      iconBg: iconInfo.bg,
      status: mod.active ? 'connected' : 'inactive',
      active: mod.active,
      settingsUrl: `/console/channels/${mod.name}?lang=${lang}`,
    })
  }

  return cards
}

const GEAR_SVG = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>`

// Helper: renders a single metric cell with label + hover tooltip
function metricCell(field: string, label: string, info: string, nd: string): string {
  return `<div class="ch-metric">
    <div class="ch-metric-head">
      <span class="ch-metric-label">${label}</span>
      <span class="ch-info-btn" tabindex="0">i</span>
      <div class="ch-info-tip">${info}</div>
    </div>
    <span class="ch-metric-value" data-field="${field}">${nd}</span>
  </div>`
}

function renderMetricsForType(channelType: 'instant' | 'async' | 'voice', channelId: string, lang: Lang): string {
  const nd = t('ch_no_data', lang)

  // Standardized 4 metrics for ALL channel types: active, inbound, outbound, avg_duration_s
  return `<div class="ch-card-metrics ch-metrics-4" data-channel="${esc(channelId)}" data-type="${channelType}">
    ${metricCell('active', t('ch_m_active', lang), t('ch_m_active_info_' + channelType, lang) || t('ch_m_active_info', lang), nd)}
    ${metricCell('inbound', t('ch_m_inbound', lang), t('ch_m_inbound_info_' + channelType, lang) || t('ch_m_inbound_info', lang), nd)}
    ${metricCell('outbound', t('ch_m_outbound', lang), t('ch_m_outbound_info_' + channelType, lang) || t('ch_m_outbound_info', lang), nd)}
    ${metricCell('avg_duration_s', t('ch_m_avg_duration', lang), t('ch_m_avg_duration_info_' + channelType, lang) || t('ch_m_avg_duration_info', lang), nd)}
  </div>`
}

export function renderChannelsSection(data: SectionData): string {
  const cards = buildChannelCards(data)
  const lang = data.lang

  // Period options in order
  const periods = [
    ['today', t('ch_period_today', lang)],
    ['24h', t('ch_period_24h', lang)],
    ['7d', t('ch_period_7d', lang)],
    ['30d', t('ch_period_30d', lang)],
    ['90d', t('ch_period_90d', lang)],
    ['180d', t('ch_period_180d', lang)],
  ]
  const periodOpts = periods.map(([v, l]) => `<option value="${v}"${v === '30d' ? ' selected' : ''}>${l}</option>`).join('')

  // Filter bar
  const filterBar = `<div class="filter-bar">
    <div class="ch-filter-group">
      <span class="ch-filter-label">${t('ch_filter_metrics', lang)}</span>
      <select class="ch-filter-select js-custom-select" id="ch-period-global">${periodOpts}</select>
    </div>
    <div class="ch-filter-sep"></div>
    <div class="ch-filter-group">
      <span class="ch-filter-label">${t('ch_filter_status', lang)}</span>
      <select class="ch-filter-select js-custom-select" id="ch-filter-status">
        <option value="all">${t('ch_filter_all', lang)}</option>
        <option value="active">${t('ch_filter_active', lang)}</option>
        <option value="inactive">${t('ch_filter_inactive', lang)}</option>
        <option value="disconnected">${t('ch_filter_disconnected', lang)}</option>
      </select>
    </div>
    <div class="ch-filter-sep"></div>
    <div class="ch-filter-group">
      <span class="ch-filter-label">${t('ch_filter_type', lang)}</span>
      <select class="ch-filter-select js-custom-select" id="ch-filter-type">
        <option value="all">${t('ch_filter_all', lang)}</option>
        <option value="instant">${t('ch_type_instant', lang)}</option>
        <option value="async">${t('ch_type_async', lang)}</option>
        <option value="voice">${t('ch_type_voice', lang)}</option>
      </select>
    </div>
  </div>`

  const cardsHtml = cards.map(card => {
    const typeLabel = t('ch_type_' + card.channelType, lang)
    const statusLabels: Record<string, string> = {
      connected: t('ch_connected', lang),
      disconnected: t('ch_disconnected', lang),
      inactive: t('ch_inactive', lang),
      error: t('ch_error', lang),
    }
    const toggleChecked = card.active ? 'checked' : ''
    const filterStatus = card.active ? (card.status === 'disconnected' ? 'disconnected' : 'active') : 'inactive'

    // SVG icons for connect/disconnect — same size as gear (16x16)
    const plugSvg = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14"/><path d="M12 5l7 7-7 7"/></svg>`
    const unplugSvg = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 12H5"/><path d="M12 19l-7-7 7-7"/></svg>`

    let connectionBtn = ''
    if (card.active && card.status === 'connected') {
      connectionBtn = `<button class="ch-btn-action ch-btn-disconnect" onclick="channelDisconnect('${esc(card.id)}', '${lang}')">${unplugSvg} ${t('ch_disconnect', lang)}</button>`
    } else if (card.active && card.status !== 'connected') {
      connectionBtn = `<button class="ch-btn-action ch-btn-connect" onclick="channelConnect('${esc(card.id)}', '${lang}')">${plugSvg} ${t('ch_connect', lang)}</button>`
    }

    // Footer: config + connect/disconnect only when active
    const footerHtml = card.active
      ? `<div class="ch-card-footer"><a href="${card.settingsUrl}" class="ch-btn-action ch-btn-gear" title="${t('ch_settings', lang)}">${GEAR_SVG} ${t('ch_settings', lang)}</a><span class="ch-footer-spacer"></span>${connectionBtn}</div>`
      : ''

    // Status tooltip text
    const statusLabel = statusLabels[card.status] ?? card.status

    return `
    <div class="ch-card${card.active ? '' : ' ch-card-inactive'}" data-channel-id="${esc(card.id)}" data-status="${card.status}" data-filter-status="${filterStatus}" data-filter-type="${card.channelType}">
      <div class="ch-card-top">
        <div class="ch-card-icon" title="${statusLabel}">
          ${card.icon}
          <span class="ch-icon-tooltip">${statusLabel}</span>
        </div>
        <div class="ch-card-title-area">
          <div class="ch-card-name">${esc(card.name)}</div>
          <div class="ch-card-type">${esc(typeLabel)}</div>
        </div>
        <label class="toggle toggle-sm">
          <input type="checkbox" ${toggleChecked} data-module="${esc(card.moduleName)}" data-redirect="/console/channels?lang=${lang}" onchange="toggleChannelConfirm(this)">
          <span class="toggle-slider"></span>
        </label>
      </div>
      <div class="ch-card-desc">${esc(card.description)}</div>
      <div class="ch-card-error"></div>
      ${card.active ? renderMetricsForType(card.channelType, card.id, lang) : ''}
      ${footerHtml}
    </div>`
  }).join('')

  // Embed wizard data from module manifests so the client-side JS reads instructions
  // from the module, not hardcoded in the UI.
  const wizardData: Record<string, unknown> = {}
  for (const mod of (data.moduleStates ?? [])) {
    if (mod.type !== 'channel') continue
    if (mod.connectionWizard) {
      wizardData[mod.name] = {
        title: mod.connectionWizard.title,
        steps: mod.connectionWizard.steps,
        saveEndpoint: mod.connectionWizard.saveEndpoint,
        applyAfterSave: mod.connectionWizard.applyAfterSave,
        verifyEndpoint: mod.connectionWizard.verifyEndpoint,
      }
    }
  }

  return `${filterBar}<div class="ch-grid" id="ch-grid">${cardsHtml}</div>
<script type="application/json" id="channel-wizards-data">${JSON.stringify(wizardData)}</script>`
}

/** Old section IDs that redirect to unified pages */
export const SECTION_REDIRECTS: Record<string, string> = {
  'apikeys': 'llm',
  'models': 'llm',
  'llm-limits': 'llm',
  'llm-cb': 'llm',
  'followup': 'pipeline',
  'naturalidad': 'pipeline',
  'db': 'infra',
  // Old channel direct URLs → nested under channels
  'whatsapp': 'channels/whatsapp',
  'email': 'channels/gmail',
  'redis': 'infra',
}

export function renderSection(section: string, data: SectionData): string | null {
  switch (section) {
    case 'channels': return renderChannelsSection(data)
    case 'whatsapp': return renderWhatsappSection(data)
    // Unified LLM page (replaces apikeys, models, llm-limits, llm-cb)
    case 'llm': return renderLlmUnifiedSection(data)
    // Unified Pipeline page (replaces pipeline, followup, naturalidad)
    case 'pipeline': return renderPipelineUnifiedSection(data)
    case 'engine-metrics': return renderEngineMetricsSection(data)
    case 'lead-scoring': return renderLeadScoringSection(data)
    case 'scheduled-tasks': return renderScheduledTasksSection(data)
    case 'users': return renderUsersSection(data)
    case 'modules': return renderModulesSection(data)
    case 'infra': return renderInfraUnifiedSection(data)
    case 'google-apps': return renderGoogleAppsSection(data)
    case 'email': return renderEmailSection(data)
    default: return null
  }
}

// ═══════════════════════════════════════════
// Users & Permissions section
// ═══════════════════════════════════════════

// SVG icons for channels (monochrome, stroke-based, inherit currentColor)
const CH_SVG: Record<string, string> = {
  whatsapp: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/></svg>',
  gmail: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="20" height="16" x="2" y="4" rx="2"/><path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"/></svg>',
  'google-chat': '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m3 21 1.9-5.7a8.5 8.5 0 1 1 3.8 3.8z"/></svg>',
  'twilio-voice': '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z"/></svg>',
}

const CH_PLACEHOLDER: Record<string, string> = {
  whatsapp: '+521234567890', gmail: 'user@example.com', 'google-chat': 'spaces/XXX/members/YYY', 'twilio-voice': '+15550123',
}

// Validation patterns per channel (HTML5 pattern attribute)
const CH_PATTERN: Record<string, string> = {
  whatsapp: '\\+[0-9]{7,15}',
  gmail: '[^@\\s]+@[^@\\s]+\\.[^@\\s]+',
  'twilio-voice': '\\+[0-9]{7,15}',
}

const CH_PATTERN_TITLE: Record<string, Record<string, string>> = {
  whatsapp: { es: 'Numero con codigo de pais: +521234567890', en: 'Phone with country code: +521234567890' },
  gmail: { es: 'Email valido: user@example.com', en: 'Valid email: user@example.com' },
  'twilio-voice': { es: 'Numero E.164: +15550123', en: 'E.164 number: +15550123' },
}

// SVG icons for action buttons
const SVG_PLUS = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14"/><path d="M5 12h14"/></svg>'
const SVG_EDIT = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>'
const SVG_DEACTIVATE = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 12H5"/><path d="M12 19l-7-7 7-7"/></svg>'
const SVG_DELETE = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>'

function renderUsersSection(data: SectionData): string {
  const lang = data.lang
  const ud = data.usersData
  if (!ud) return `<div class="panel"><div class="panel-body">${lang === 'es' ? 'Módulo de usuarios no disponible.' : 'Users module not available.'}</div></div>`

  const { configs, usersByType, counts, channels, tools } = ud

  // Test mode warning
  const testMode = data.config.ENGINE_TEST_MODE === 'true'
  const adminCount = counts['admin'] ?? 0
  let warning = ''
  if (testMode && adminCount === 0) {
    warning = `<div class="flash flash-error">${lang === 'es'
      ? 'Modo de pruebas activo pero no hay admins configurados — nadie recibirá respuesta.'
      : 'Test mode active but no admins configured — nobody will receive responses.'}</div>`
  }

  let html = `<div class="users-section">${warning}`
  const canEdit = (lt: string) => lt !== 'lead'
  const canDelete = (lt: string) => lt !== 'admin' && lt !== 'lead'

  // ── Panel per list type ──
  for (const cfg of configs) {
    const users = usersByType[cfg.listType] ?? []
    const isLead = cfg.listType === 'lead'
    const lt = cfg.listType
    const count = counts[lt] ?? 0
    const badgeStyle = cfg.isEnabled ? 'badge-active' : 'badge-soon'

    html += `<div class="panel">
      <div class="panel-header" onclick="togglePanel(this)">
        <span class="panel-title">${esc(cfg.displayName)} <span class="panel-badge ${badgeStyle}">${count}</span></span>
        <span class="panel-chevron">&#9660;</span>
      </div>
      <div class="panel-body">`

    // (selection bar moved to footer row with add button)

    if (users.length > 0) {
      html += `<table class="users-table" id="tbl-${esc(lt)}"><thead><tr class="users-table-head">
        ${canEdit(lt) ? '<th></th>' : ''}
        <th>ID</th>
        <th>${lang === 'es' ? 'Nombre' : 'Name'}</th>
        <th>${lang === 'es' ? 'Datos de contacto' : 'Contact info'}</th>
        <th>${lang === 'es' ? 'Fuente' : 'Source'}</th>
        <th>${lang === 'es' ? 'Estado' : 'Status'}</th>
      </tr></thead><tbody>`

      for (const user of users) {
        const contactBadges = user.contacts.map(c =>
          `<span class="user-contact-badge">${CH_SVG[c.channel] || ''} ${esc(c.senderId.length > 22 ? c.senderId.slice(0, 20) + '…' : c.senderId)}</span>`
        ).join(' ')

        // Status: inactive → red label; active → last interaction time (placeholder for now)
        const statusHtml = user.isActive
          ? `<span class="user-status-active">—</span>`
          : `<span class="user-status-inactive">${lang === 'es' ? 'Desactivado' : 'Deactivated'}</span>`

        html += `<tr data-user-id="${esc(user.id)}" data-user-name="${esc(user.displayName || '')}" data-user-active="${user.isActive}">`

        if (canEdit(lt)) {
          html += `<td><input type="checkbox" class="user-cb" data-list="${esc(lt)}" value="${esc(user.id)}" onclick="event.stopPropagation();userSelChanged('${esc(lt)}')"></td>`
        }

        html += `<td><code>${esc(user.id)}</code></td>
          <td>${esc(user.displayName || '—')}</td>
          <td>${contactBadges}</td>
          <td><span class="user-source-badge">${esc(user.source)}</span></td>
          <td>${statusHtml}</td>
        </tr>`

        // (contacts editing moved to modal)
      }
      html += `</tbody></table>`
    } else {
      html += `<p class="panel-description">${lang === 'es' ? 'Sin usuarios en esta lista.' : 'No users in this list.'}</p>`
    }

    // Footer row: add (left) + selection actions (right)
    if (!isLead) {
      html += `<div class="ch-card-footer">
        <button type="button" class="act-btn act-btn-add" onclick="openAddUserModal('${esc(lt)}', '${lang}')">${SVG_PLUS} ${lang === 'es' ? 'Agregar usuario' : 'Add user'}</button>
        <span class="ch-footer-spacer"></span>
        <div class="user-selection-bar" id="sel-bar-${esc(lt)}">
          <button type="button" class="act-btn act-btn-config" onclick="userEditSelected('${esc(lt)}', '${lang}')">${SVG_EDIT} ${lang === 'es' ? 'Editar' : 'Edit'}</button>
          <button type="button" class="act-btn act-btn-remove" onclick="userDeactivateSelected('${esc(lt)}', '${lang}')">${SVG_DEACTIVATE} ${lang === 'es' ? 'Desactivar' : 'Deactivate'}</button>`
      if (canDelete(lt)) {
        html += `<button type="button" class="act-btn act-btn-remove" onclick="userDeleteSelected('${esc(lt)}', '${lang}')">${SVG_DELETE} ${lang === 'es' ? 'Eliminar' : 'Delete'}</button>`
      }
      html += `</div></div>`
    }

    html += `</div></div>`
  }

  // User modal (wizard style — used for both add and edit)
  html += `<div class="wizard-overlay" id="user-modal" style="display:none" onclick="if(event.target===this)closeUserModal()">
    <div class="wizard-modal">
      <button class="wizard-close" onclick="closeUserModal()">&times;</button>
      <div class="wizard-steps">
        <div class="wizard-title" id="user-modal-title">${lang === 'es' ? 'Editar usuario' : 'Edit user'}</div>
        <form method="POST" id="user-modal-form" action="/console/users/update">
          <input type="hidden" name="_section" value="users"><input type="hidden" name="_lang" value="${lang}">
          <input type="hidden" name="userId" id="user-modal-userId">
          <input type="hidden" name="listType" id="user-modal-listType">
          <label class="wizard-label">${lang === 'es' ? 'Nombre' : 'Name'}</label>
          <input type="text" class="wizard-input" name="displayName" id="user-modal-name" placeholder="${lang === 'es' ? 'Nombre del usuario' : 'User name'}">`

  for (let i = 0; i < channels.length; i++) {
    const ch = channels[i]!
    const lbl = typeof ch.label === 'string' ? ch.label : (ch.label[lang] || ch.label['es'] || ch.id)
    const pat = CH_PATTERN[ch.id] ? ` pattern="${CH_PATTERN[ch.id]}"` : ''
    const patTitle = CH_PATTERN_TITLE[ch.id] ? ` title="${esc(CH_PATTERN_TITLE[ch.id]![lang] || CH_PATTERN_TITLE[ch.id]!['es'] || '')}"` : ''
    html += `<label class="wizard-label">${CH_SVG[ch.id] || ''} ${esc(lbl)}</label>
        <input type="hidden" name="contact_channel_${i}" value="${esc(ch.id)}">
        <input type="${ch.id === 'gmail' ? 'email' : 'text'}" class="wizard-input" name="contact_senderid_${i}" id="user-modal-ch-${esc(ch.id)}" placeholder="${esc(CH_PLACEHOLDER[ch.id] || 'ID')}"${pat}${patTitle}>`
  }

  html += `<div class="wizard-actions" style="display:flex;justify-content:flex-end;gap:8px;margin-top:24px">
          <button type="button" class="act-btn act-btn-config" onclick="closeUserModal()">${lang === 'es' ? 'Cancelar' : 'Cancel'}</button>
          <button type="submit" class="act-btn act-btn-cta" id="user-modal-submit">${lang === 'es' ? 'Guardar' : 'Save'}</button>
        </div>
      </form>
    </div>
  </div>
</div>`

  // Users JS — checkbox selection, modals, perm sync
  html += `<script>(function(){
    var modal=document.getElementById('user-modal');
    var form=document.getElementById('user-modal-form');

    // Checkbox selection → show/hide action bar
    window.userSelChanged=function(lt){
      var bar=document.getElementById('sel-bar-'+lt);
      var cbs=document.querySelectorAll('.user-cb[data-list="'+lt+'"]:checked');
      if(bar) bar.classList.toggle('visible',cbs.length>0);
    };

    // Open modal for adding a new user
    window.openAddUserModal=function(lt,lang){
      document.getElementById('user-modal-title').textContent=lang==='es'?'Agregar usuario':'Add user';
      document.getElementById('user-modal-submit').textContent=lang==='es'?'Crear':'Create';
      form.action='/console/users/add';
      document.getElementById('user-modal-userId').value='';
      document.getElementById('user-modal-listType').value=lt;
      document.getElementById('user-modal-name').value='';
      // Clear all channel fields
      form.querySelectorAll('[id^="user-modal-ch-"]').forEach(function(inp){inp.value='';inp.disabled=false});
      modal.style.display='flex';
    };

    // Open modal for editing existing user
    window.userEditSelected=function(lt,lang){
      var cbs=document.querySelectorAll('.user-cb[data-list="'+lt+'"]:checked');
      if(cbs.length!==1){alert(lang==='es'?'Selecciona exactamente 1 usuario.':'Select exactly 1 user.');return}
      var tr=cbs[0].closest('tr');
      var uid=tr.getAttribute('data-user-id');
      var name=tr.getAttribute('data-user-name')||'';
      document.getElementById('user-modal-title').textContent=lang==='es'?'Editar usuario':'Edit user';
      document.getElementById('user-modal-submit').textContent=lang==='es'?'Guardar':'Save';
      form.action='/console/users/update';
      document.getElementById('user-modal-userId').value=uid;
      document.getElementById('user-modal-listType').value=lt;
      document.getElementById('user-modal-name').value=name;
      // Populate existing contacts from badges in the row
      form.querySelectorAll('[id^="user-modal-ch-"]').forEach(function(inp){inp.value='';inp.disabled=false});
      var badges=tr.querySelectorAll('.user-contact-badge');
      badges.forEach(function(b){
        var svg=b.querySelector('svg');
        var text=b.textContent.trim();
        // Find which channel this badge belongs to by matching SVG
        var chInputs=form.querySelectorAll('[id^="user-modal-ch-"]');
        chInputs.forEach(function(inp){
          var chId=inp.id.replace('user-modal-ch-','');
          var parentDiv=inp.closest('.chs-field');
          if(parentDiv&&parentDiv.querySelector('svg')&&b.querySelector('svg')){
            // Match by checking the hidden input value for this channel
            var hiddenCh=inp.previousElementSibling;
            if(hiddenCh&&hiddenCh.value===chId&&text){inp.value=text}
          }
        });
      });
      modal.style.display='flex';
    };

    window.closeUserModal=function(){modal.style.display='none'};

    // Deactivate selected
    window.userDeactivateSelected=function(lt,lang){
      var cbs=document.querySelectorAll('.user-cb[data-list="'+lt+'"]:checked');
      if(!cbs.length)return;
      var msg=lang==='es'?'¿Desactivar '+cbs.length+' usuario(s)?':'Deactivate '+cbs.length+' user(s)?';
      if(!confirm(msg))return;
      cbs.forEach(function(cb){
        var f=document.createElement('form');f.method='POST';f.action='/console/users/deactivate';
        f.innerHTML='<input name="_section" value="users"><input name="_lang" value="'+lang+'"><input name="userId" value="'+cb.value+'">';
        document.body.appendChild(f);f.submit();
      });
    };

    // Delete selected (only if all deactivated)
    window.userDeleteSelected=function(lt,lang){
      var cbs=document.querySelectorAll('.user-cb[data-list="'+lt+'"]:checked');
      var allInactive=true;
      cbs.forEach(function(cb){var tr=cb.closest('tr');if(tr&&tr.getAttribute('data-user-active')==='true')allInactive=false});
      if(!allInactive){alert(lang==='es'?'Solo se pueden eliminar usuarios desactivados.':'Can only delete deactivated users.');return}
      if(!confirm(lang==='es'?'¿Eliminar permanentemente?':'Delete permanently?'))return;
      alert(lang==='es'?'Eliminación permanente aún no implementada.':'Permanent deletion not yet implemented.');
    };

    // Sync perm checkboxes to hidden inputs for save bar dirty tracking
    document.querySelectorAll('.perm-cb').forEach(function(cb){
      cb.addEventListener('change',function(){
        var h=document.querySelector('input[name="'+cb.getAttribute('data-hidden')+'"]');
        if(h){h.value=cb.checked?'on':'';h.dispatchEvent(new Event('input',{bubbles:true}))}
      })
    });
  })()</script>`

  // ── Permissions panels (per non-lead list) — integrated with save bar ──
  for (const cfg of configs) {
    if (cfg.listType === 'lead') continue
    const lt = cfg.listType
    const perms = cfg.permissions
    const isAllTools = perms.tools.includes('*')

    html += `<div class="panel">
      <div class="panel-header" onclick="togglePanel(this)">
        <span class="panel-title">${lang === 'es' ? 'Permisos' : 'Permissions'}: ${esc(cfg.displayName)}</span>
        <span class="panel-chevron">&#9660;</span>
      </div>
      <div class="panel-body">`

    // Tools — tracked by save bar via hidden inputs
    html += `<div class="field-divider"><span class="field-divider-label">Tools</span></div>
      <div class="perm-grid">`

    const toolsByCategory = new Map<string, typeof tools>()
    for (const tool of tools) {
      const cat = tool.category || 'other'
      if (!toolsByCategory.has(cat)) toolsByCategory.set(cat, [])
      toolsByCategory.get(cat)!.push(tool)
    }
    for (const [cat, catTools] of toolsByCategory) {
      html += `<div class="perm-grid-category">${esc(cat)}</div>`
      for (const tool of catTools) {
        const checked = isAllTools || perms.tools.includes(tool.name)
        const origVal = checked ? 'on' : ''
        // Hidden input tracked by save bar; checkbox syncs it
        html += `<label>
          <input type="checkbox" class="perm-cb" ${checked ? 'checked' : ''} data-hidden="perm_${esc(lt)}_tool_${esc(tool.name)}">
          <input type="hidden" name="perm_${esc(lt)}_tool_${esc(tool.name)}" value="${origVal}" data-original="${origVal}">
          ${esc(tool.name)}</label>`
      }
    }
    html += `</div>`

    // Subagents
    const subOrig = perms.subagents ? 'on' : ''
    html += `<div class="field" style="margin-top:1rem;display:flex;align-items:center;gap:8px">
        <span class="field-label">Subagents</span>
        <input type="checkbox" class="perm-cb" ${perms.subagents ? 'checked' : ''} data-hidden="perm_${esc(lt)}_subagents">
        <input type="hidden" name="perm_${esc(lt)}_subagents" value="${subOrig}" data-original="${subOrig}">
      </div>
      </div></div>`
  }

  // ── Unregistered behavior (from lead config) — integrated with save bar ──
  const leadCfg = configs.find(c => c.listType === 'lead')
  if (leadCfg) {
    const behavior = leadCfg.unregisteredBehavior || 'silence'
    html += `<div class="panel">
      <div class="panel-header" onclick="togglePanel(this)">
        <span class="panel-title">${lang === 'es' ? 'Contactos no registrados' : 'Unregistered contacts'}</span>
        <span class="panel-chevron">&#9660;</span>
      </div>
      <div class="panel-body">
        <div class="field">
          <div class="field-left"><span class="field-label">${lang === 'es' ? 'Comportamiento' : 'Behavior'}</span></div>
          <select name="unregisteredBehavior" data-original="${esc(behavior)}">
            <option value="silence" ${behavior === 'silence' ? 'selected' : ''}>${lang === 'es' ? 'Silencio — sin respuesta' : 'Silence — no response'}</option>
            <option value="generic_message" ${behavior === 'generic_message' ? 'selected' : ''}>${lang === 'es' ? 'Mensaje genérico' : 'Generic message'}</option>
            <option value="register_only" ${behavior === 'register_only' ? 'selected' : ''}>${lang === 'es' ? 'Registrar sin responder' : 'Register without responding'}</option>
            <option value="leads" ${behavior === 'leads' ? 'selected' : ''}>${lang === 'es' ? 'Leads — activar tabla de leads' : 'Leads — enable leads table'}</option>
          </select>
        </div>
        <div class="field" id="unregistered-msg-field" style="display:${behavior === 'generic_message' ? 'grid' : 'none'}">
          <div class="field-left"><span class="field-label">${lang === 'es' ? 'Mensaje' : 'Message'}</span></div>
          <textarea name="unregisteredMessage" data-original="${esc(leadCfg.unregisteredMessage || '')}" rows="2">${esc(leadCfg.unregisteredMessage || '')}</textarea>
        </div>
        <script>
        (function(){
          var sel=document.querySelector('[name="unregisteredBehavior"]');
          var msgField=document.getElementById('unregistered-msg-field');
          if(sel&&msgField){sel.addEventListener('change',function(){msgField.style.display=sel.value==='generic_message'?'grid':'none'})}
        })();
        </script>
      </div></div>`
  }

  return html + '</div>'
}
