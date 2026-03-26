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
  contactsSubpage?: string
  usersData?: {
    configs: Array<{
      listType: string; displayName: string; description: string; isEnabled: boolean; isSystem: boolean
      permissions: { tools: string[]; skills: string[]; subagents: boolean; allAccess: boolean }
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
    case 'contacts': return renderUsersSection(data)
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

  const subpage = data.contactsSubpage || configs[0]?.listType || 'admin'
  const isConfigPage = subpage === 'config'

  // Channel filter options
  const chFilterOpts = channels.map(ch => {
    const lbl = typeof ch.label === 'string' ? ch.label : (ch.label[lang] || ch.label['es'] || ch.id)
    return `<option value="${esc(ch.id)}">${esc(lbl)}</option>`
  }).join('')

  const svgSearch = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>'

  let html = `<div class="users-section">${warning}`

  if (!isConfigPage) {
    // Channel multi-select checkboxes
    const chCheckboxes = channels.map(ch => {
      const lbl = typeof ch.label === 'string' ? ch.label : (ch.label[lang] || ch.label['es'] || ch.id)
      return `<label class="uf-ch-option"><input type="checkbox" value="${esc(ch.id)}" checked onchange="userFilterApply()"> ${esc(lbl)}</label>`
    }).join('')

    // Filter bar
    html += `<div class="filter-bar">
      <div class="filter-group">
        <span class="filter-label">${lang === 'es' ? 'Nombre' : 'Name'}</span>
        <select class="ch-filter-select js-custom-select" id="uf-sort" onchange="userFilterApply()">
          <option value="asc">A → Z</option>
          <option value="desc">Z → A</option>
        </select>
      </div>
      <div class="filter-group">
        <span class="filter-label">${lang === 'es' ? 'Canal' : 'Channel'}</span>
        <div class="custom-select" id="uf-channel-wrap">
          <button type="button" class="custom-select-btn" onclick="event.stopPropagation();this.parentElement.classList.toggle('open')">${lang === 'es' ? 'Todos' : 'All'} <svg class="custom-select-arrow" width="10" height="6" viewBox="0 0 10 6" fill="none"><path d="M1 1L5 5L9 1" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg></button>
          <div class="custom-select-panel" style="padding:8px 12px;min-width:160px" onclick="event.stopPropagation()">
            ${chCheckboxes}
          </div>
        </div>
      </div>
      <div class="filter-group">
        <span class="filter-label">${lang === 'es' ? 'Fuente' : 'Source'}</span>
        <select class="ch-filter-select js-custom-select" id="uf-source" onchange="userFilterApply()">
          <option value="all">${lang === 'es' ? 'Todos' : 'All'}</option>
          <option value="manual">Manual</option>
          <option value="inbound">Inbound</option>
          <option value="outbound">Outbound</option>
          <option value="sync">Sync</option>
        </select>
      </div>
      <div class="filter-group">
        <span class="filter-label">${lang === 'es' ? 'Ultima interaccion' : 'Last interaction'}</span>
        <select class="ch-filter-select js-custom-select" id="uf-activity" onchange="userFilterApply()">
          <option value="all">${lang === 'es' ? 'Todos' : 'All'}</option>
          <option value="1h">1h</option><option value="12h">12h</option><option value="24h">24h</option>
          <option value="7d">7d</option><option value="30d">30d</option><option value="90d">90d</option>
        </select>
      </div>
      <div class="user-filter-search">
        ${svgSearch}
        <input type="text" id="uf-search" placeholder="${lang === 'es' ? 'Buscar contacto' : 'Search contact'}" oninput="userFilterApply()">
      </div>
    </div>`
  }

  const canEdit = (lt: string) => lt !== 'lead'
  const canDelete = (lt: string) => lt !== 'admin' && lt !== 'lead'

  // ── Show only the active subpage ──
  if (isConfigPage) {
    // Config page: permissions + unregistered behavior
    // (rendered below after the list panels block)
  } else {
    const cfg = configs.find(c => c.listType === subpage)
    if (!cfg) {
      html += `<div class="panel"><div class="panel-body">${lang === 'es' ? 'Lista no encontrada.' : 'List not found.'}</div></div>`
      return html + '</div>'
    }
    const users = usersByType[cfg.listType] ?? []
    const isLead = cfg.listType === 'lead'
    const lt = cfg.listType

    // Single panel for this list type
    html += `<div class="panel"><div class="panel-body">`

    // (selection bar moved to footer row with add button)

    if (users.length > 0) {
      const isCoworker = lt === 'coworker'
      html += `<div class="users-table-scroll"><table class="users-table" id="tbl-${esc(lt)}"><thead><tr class="users-table-head">
        <th><input type="checkbox" class="user-cb" id="cb-all-${esc(lt)}" title="${lang === 'es' ? 'Seleccionar todos' : 'Select all'}" onclick="userToggleAll('${esc(lt)}')"></th>
        <th>ID</th>
        <th>${lang === 'es' ? 'Nombre' : 'Name'}</th>
        ${isCoworker ? `<th>${lang === 'es' ? 'Rol' : 'Role'}</th>` : ''}
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
          : `<span class="user-status-inactive">${lang === 'es' ? 'Desactivado' : 'Deactivated'}</span>
             <form method="POST" action="/console/users/reactivate" style="display:inline;margin-left:4px">
               <input type="hidden" name="_section" value="users"><input type="hidden" name="_lang" value="${lang}">
               <input type="hidden" name="userId" value="${esc(user.id)}">
               <button type="submit" class="act-btn act-btn-add" style="font-size:10px;padding:3px 8px">${lang === 'es' ? 'Reactivar' : 'Reactivate'}</button>
             </form>`

        // Data attributes for edit modal + filtering
        const contactsJson = JSON.stringify(Object.fromEntries(user.contacts.map(c => [c.channel, c.senderId])))
        const channelList = user.contacts.map(c => c.channel).join(',')
        const senderIds = user.contacts.map(c => c.senderId).join(' ')
        const userRole = (user.metadata as Record<string, unknown>)?.role as string ?? ''
        html += `<tr data-user-id="${esc(user.id)}" data-user-name="${esc(user.displayName || '')}" data-user-active="${user.isActive}" data-contacts="${esc(contactsJson)}" data-channels="${esc(channelList)}" data-source="${esc(user.source)}" data-role="${esc(userRole)}" data-search="${esc((user.displayName || '') + ' ' + senderIds)}">`

        html += `<td><input type="checkbox" class="user-cb" data-list="${esc(lt)}" value="${esc(user.id)}" onclick="event.stopPropagation();userSelChanged('${esc(lt)}')"></td>
          <td><code>${esc(user.id)}</code></td>
          <td>${esc(user.displayName || '—')}</td>
          ${isCoworker ? `<td>${userRole ? `<span class="user-source-badge">${esc(userRole)}</span>` : '—'}</td>` : ''}
          <td>${contactBadges}</td>
          <td><span class="user-source-badge">${esc(user.source)}</span></td>
          <td>${statusHtml}</td>
        </tr>`

        // (contacts editing moved to modal)
      }
      html += `</tbody></table></div>`
    } else {
      html += `<p class="panel-description">${lang === 'es' ? 'Sin usuarios en esta lista.' : 'No users in this list.'}</p>`
    }

    // Footer row: add (left) + selection actions (right) — same template for all list types
    html += `<div class="ch-card-footer">`
    if (canEdit(lt)) {
      html += `<button type="button" class="act-btn act-btn-add" onclick="openAddUserModal('${esc(lt)}', '${lang}')">${SVG_PLUS} ${lang === 'es' ? 'Agregar usuario' : 'Add user'}</button>`
    }
    html += `<span class="ch-footer-spacer"></span>
      <div class="user-selection-bar" id="sel-bar-${esc(lt)}">
        ${canEdit(lt) ? `<button type="button" class="act-btn act-btn-config" onclick="userEditSelected('${esc(lt)}')">${SVG_EDIT} ${lang === 'es' ? 'Editar' : 'Edit'}</button>` : ''}
        <button type="button" class="act-btn act-btn-remove" onclick="userDeactivateSelected('${esc(lt)}')">${SVG_DEACTIVATE} ${lang === 'es' ? 'Desactivar' : 'Deactivate'}</button>`
    if (canDelete(lt)) {
      html += `<button type="button" class="act-btn act-btn-remove" onclick="userDeleteSelected('${esc(lt)}')">${SVG_DELETE} ${lang === 'es' ? 'Eliminar' : 'Delete'}</button>`
    }
    html += `</div></div>`

    html += `</div></div>
    <div class="user-pager" id="pager-${esc(subpage)}">
      <span class="user-pager-info" id="pager-info-${esc(subpage)}"></span>
      <span class="ch-footer-spacer"></span>
      <div class="filter-group">
        <select class="ch-filter-select js-custom-select" id="uf-perpage" onchange="userFilterApply()">
          <option value="10" selected>10</option>
          <option value="50">50</option>
          <option value="100">100</option>
          <option value="500">500</option>
        </select>
      </div>
      <button type="button" class="act-btn act-btn-config" onclick="userPage('${esc(subpage)}',-1)">&lsaquo; ${lang === 'es' ? 'Anterior' : 'Previous'}</button>
      <button type="button" class="act-btn act-btn-config" onclick="userPage('${esc(subpage)}',1)">${lang === 'es' ? 'Siguiente' : 'Next'} &rsaquo;</button>
    </div>`
  } // end of list type subpage

  // Build list type options for move-list dropdown
  const listTypeOpts = configs.map(c =>
    `<option value="${esc(c.listType)}">${esc(c.displayName)}</option>`
  ).join('')

  // Validation messages per channel
  const chValidMsg: Record<string, Record<string, string>> = {
    whatsapp: { es: 'Formato: +codigo pais seguido de numero (ej: +521234567890)', en: 'Format: +country code followed by number (e.g. +521234567890)' },
    gmail: { es: 'Formato: email valido (ej: user@example.com)', en: 'Format: valid email (e.g. user@example.com)' },
    'twilio-voice': { es: 'Formato E.164: +codigo pais seguido de numero (ej: +15550123)', en: 'E.164 format: +country code followed by number (e.g. +15550123)' },
  }

  // User modal (wizard style — used for add/edit + import)
  html += `<div class="wizard-overlay" id="user-modal" style="display:none" onclick="if(event.target===this)closeUserModal()">
    <div class="wizard-modal" style="max-width:520px">
      <button class="wizard-close" onclick="closeUserModal()">&times;</button>
      <div class="wizard-steps">
        <div class="wizard-title" id="user-modal-title">${lang === 'es' ? 'Agregar contacto' : 'Add contact'}</div>
        <div class="wizard-error" id="user-modal-error" style="display:none"></div>

        <!-- Step 0: Mode selector (only for add, not edit) -->
        <div id="import-step-0">
          <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px;margin:16px 0">
            <button type="button" class="import-mode-card" onclick="showImportStep('manual')">
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><line x1="19" y1="8" x2="19" y2="14"/><line x1="16" y1="11" x2="22" y2="11"/></svg>
              <span>${lang === 'es' ? 'Agregar manual' : 'Add manually'}</span>
            </button>
            <button type="button" class="import-mode-card" onclick="showImportStep('file')">
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>
              <span>${lang === 'es' ? 'Importar CSV' : 'Import CSV'}</span>
            </button>
            <button type="button" class="import-mode-card" onclick="showImportStep('drive')">
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M12 2L2 19.5h20L12 2z"/><path d="M17 19.5L22 10H12"/><path d="M7 19.5L2 10h10"/></svg>
              <span>Google Sheets</span>
            </button>
          </div>
        </div>

        <!-- Step 1a: Manual form -->
        <div id="import-step-manual" style="display:none">
          <form method="POST" id="user-modal-form" action="/console/users/update" onsubmit="return validateUserModal()">
            <input type="hidden" name="_section" value="users"><input type="hidden" name="_lang" value="${lang}">
            <input type="hidden" name="userId" id="user-modal-userId">
            <input type="hidden" name="listType" id="user-modal-listType">

            <label class="wizard-label">${lang === 'es' ? 'Nombre' : 'Name'}</label>
            <input type="text" class="wizard-input" name="displayName" id="user-modal-name" placeholder="${lang === 'es' ? 'Nombre del usuario' : 'User name'}">

            <label class="wizard-label" id="user-modal-list-label" style="display:none">${lang === 'es' ? 'Mover a lista' : 'Move to list'}</label>
            <select class="wizard-input" name="listType" id="user-modal-listSelect" style="display:none" onchange="userModalListChange(this)">
              ${listTypeOpts}
            </select>

            <div id="user-modal-role-wrap" style="display:none">
              <label class="wizard-label">${lang === 'es' ? 'Rol' : 'Role'}</label>
              <select class="wizard-input" name="userRole" id="user-modal-role">
                <option value="">${lang === 'es' ? '— Sin rol —' : '— No role —'}</option>
              </select>
            </div>`

  for (let i = 0; i < channels.length; i++) {
    const ch = channels[i]!
    const lbl = typeof ch.label === 'string' ? ch.label : (ch.label[lang] || ch.label['es'] || ch.id)
    const errMsg = chValidMsg[ch.id] ? esc(chValidMsg[ch.id]![lang] || chValidMsg[ch.id]!['es'] || '') : ''
    html += `<label class="wizard-label">${CH_SVG[ch.id] || ''} ${esc(lbl)}</label>
        <input type="hidden" name="contact_channel_${i}" value="${esc(ch.id)}">
        <input type="text" class="wizard-input" name="contact_senderid_${i}" id="user-modal-ch-${esc(ch.id)}" placeholder="${esc(CH_PLACEHOLDER[ch.id] || 'ID')}" data-channel="${esc(ch.id)}">
        <div class="wizard-field-error" id="user-modal-err-${esc(ch.id)}">${errMsg}</div>`
  }

  html += `<div class="wizard-actions" style="display:flex;justify-content:flex-end;gap:8px;margin-top:24px">
            <button type="button" class="act-btn act-btn-config" id="manual-back-btn" onclick="showImportStep('select')" style="display:none">${lang === 'es' ? 'Atras' : 'Back'}</button>
            <button type="button" class="act-btn act-btn-config" onclick="closeUserModal()">${lang === 'es' ? 'Cancelar' : 'Cancel'}</button>
            <button type="submit" class="act-btn act-btn-cta" id="user-modal-submit">${lang === 'es' ? 'Guardar' : 'Save'}</button>
          </div>
        </form>
      </div>

      <!-- Step 1b: File import (CSV) -->
      <div id="import-step-file" style="display:none">
        <div class="import-dropzone" id="csv-dropzone" onclick="document.getElementById('csv-file-input').click()"
          ondragover="event.preventDefault();this.classList.add('dragover')" ondragleave="this.classList.remove('dragover')"
          ondrop="event.preventDefault();this.classList.remove('dragover');handleCsvFile(event.dataTransfer.files[0])">
          <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="var(--on-surface-dim)" stroke-width="1.5"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
          <div style="margin-top:8px;font-size:14px;color:var(--on-surface-variant)">${lang === 'es' ? 'Arrastra un archivo CSV o haz clic para seleccionar' : 'Drag a CSV file or click to select'}</div>
          <div style="font-size:11px;color:var(--on-surface-dim);margin-top:4px">${lang === 'es' ? 'Columnas requeridas: sender_id, channel. Opcionales: display_name, [metadata]' : 'Required columns: sender_id, channel. Optional: display_name, [metadata]'}</div>
          <input type="file" id="csv-file-input" accept=".csv" style="display:none" onchange="handleCsvFile(this.files[0])">
        </div>
        <div id="csv-preview" style="display:none;margin-top:12px">
          <div style="font-size:13px;font-weight:600;margin-bottom:6px" id="csv-preview-label"></div>
          <div style="overflow-x:auto;max-height:200px"><table class="users-table" id="csv-preview-table"></table></div>
        </div>
        <div id="csv-result" style="display:none;margin-top:12px;padding:12px;border-radius:8px;background:var(--surface-container-low)"></div>
        <div class="wizard-actions" style="display:flex;justify-content:flex-end;gap:8px;margin-top:16px">
          <button type="button" class="act-btn act-btn-config" onclick="showImportStep('select')">${lang === 'es' ? 'Atras' : 'Back'}</button>
          <button type="button" class="act-btn act-btn-cta" id="csv-import-btn" style="display:none" onclick="submitCsvImport()">${lang === 'es' ? 'Importar' : 'Import'}</button>
        </div>
      </div>

      <!-- Step 1c: Google Drive import -->
      <div id="import-step-drive" style="display:none">
        <label class="wizard-label">Google Sheets URL</label>
        <input type="text" class="wizard-input" id="drive-sheet-url" placeholder="https://docs.google.com/spreadsheets/d/...">
        <div style="font-size:11px;color:var(--on-surface-dim);margin-top:4px;margin-bottom:12px" id="drive-hint">${lang === 'es' ? 'Pega la URL de una Google Sheet. Debe estar compartida publicamente o con enlace.' : 'Paste a Google Sheet URL. Must be shared publicly or via link.'}</div>
        <button type="button" class="act-btn act-btn-config" onclick="previewDriveSheet()" id="drive-preview-btn">${lang === 'es' ? 'Previsualizar' : 'Preview'}</button>
        <div id="drive-preview" style="display:none;margin-top:12px">
          <div style="font-size:13px;font-weight:600;margin-bottom:6px" id="drive-preview-label"></div>
          <div style="overflow-x:auto;max-height:200px"><table class="users-table" id="drive-preview-table"></table></div>
        </div>
        <div id="drive-result" style="display:none;margin-top:12px;padding:12px;border-radius:8px;background:var(--surface-container-low)"></div>
        <div class="wizard-actions" style="display:flex;justify-content:flex-end;gap:8px;margin-top:16px">
          <button type="button" class="act-btn act-btn-config" onclick="showImportStep('select')">${lang === 'es' ? 'Atras' : 'Back'}</button>
          <button type="button" class="act-btn act-btn-cta" id="drive-import-btn" style="display:none" onclick="submitDriveImport()">${lang === 'es' ? 'Importar' : 'Import'}</button>
        </div>
      </div>

    </div>
  </div>
</div>`

  // Embed coworker roles data for JS
  const coworkerCfg = configs.find(c => c.listType === 'coworker')
  const coworkerRoles: string[] = (coworkerCfg?.syncConfig as Record<string, unknown>)?.roles as string[] ?? []

  // Users JS
  html += `<script>(function(){
    var modal=document.getElementById('user-modal');
    var form=document.getElementById('user-modal-form');
    var errorBox=document.getElementById('user-modal-error');
    var coworkerRoles=${JSON.stringify(coworkerRoles)};
    var listLabel=document.getElementById('user-modal-list-label');
    var listSelect=document.getElementById('user-modal-listSelect');
    var lang=document.documentElement.lang||'es';

    // ── Validation patterns ──
    var patterns={whatsapp:/^\\+[0-9]{7,15}$/,'twilio-voice':/^\\+[0-9]{7,15}$/,gmail:/^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/};

    window.validateUserModal=function(){
      var valid=true;
      var errors=[];
      errorBox.style.display='none';
      form.querySelectorAll('.wizard-input').forEach(function(inp){inp.classList.remove('invalid')});
      form.querySelectorAll('.wizard-field-error').forEach(function(e){e.style.display='none'});

      // Name required
      var nameInp=document.getElementById('user-modal-name');
      if(!nameInp.value.trim()){
        nameInp.classList.add('invalid');
        errors.push(lang==='es'?'El nombre es obligatorio.':'Name is required.');
        valid=false;
      }

      // At least 1 contact on create
      var isCreate=form.action.indexOf('/users/add')!==-1;
      var hasContact=false;

      form.querySelectorAll('[data-channel]').forEach(function(inp){
        var ch=inp.getAttribute('data-channel');
        var val=inp.value.trim();
        if(!val)return;
        hasContact=true;
        var pat=patterns[ch];
        if(pat&&!pat.test(val)){
          inp.classList.add('invalid');
          var errEl=document.getElementById('user-modal-err-'+ch);
          if(errEl)errEl.style.display='block';
          valid=false;
        }
      });

      if(isCreate&&!hasContact){
        errors.push(lang==='es'?'Agrega al menos un dato de contacto.':'Add at least one contact.');
        valid=false;
      }

      if(!valid){
        errorBox.textContent=errors.length>0?errors.join(' '):(lang==='es'?'Corrige los campos marcados en rojo.':'Fix the fields marked in red.');
        errorBox.style.display='block';
      }
      return valid;
    };

    // ── Clear errors on input ──
    form.addEventListener('input',function(e){
      var inp=e.target;
      if(inp.classList.contains('invalid')){
        inp.classList.remove('invalid');
        var ch=inp.getAttribute('data-channel');
        if(ch){var err=document.getElementById('user-modal-err-'+ch);if(err)err.style.display='none'}
      }
    });

    // ── Import step navigation ──
    var _currentListType='';
    var _csvData='';
    var _isEditMode=false;

    window.showImportStep=function(step){
      document.getElementById('import-step-0').style.display='none';
      document.getElementById('import-step-manual').style.display='none';
      document.getElementById('import-step-file').style.display='none';
      document.getElementById('import-step-drive').style.display='none';
      errorBox.style.display='none';
      if(step==='select'){
        document.getElementById('import-step-0').style.display='block';
        document.getElementById('user-modal-title').textContent=lang==='es'?'Agregar contacto':'Add contact';
      }else if(step==='manual'){
        document.getElementById('import-step-manual').style.display='block';
        document.getElementById('user-modal-title').textContent=lang==='es'?'Agregar manual':'Add manually';
        document.getElementById('manual-back-btn').style.display='inline-flex';
      }else if(step==='file'){
        document.getElementById('import-step-file').style.display='block';
        document.getElementById('user-modal-title').textContent=lang==='es'?'Importar CSV':'Import CSV';
        // Reset file state
        document.getElementById('csv-preview').style.display='none';
        document.getElementById('csv-result').style.display='none';
        document.getElementById('csv-import-btn').style.display='none';
        document.getElementById('csv-file-input').value='';
        _csvData='';
      }else if(step==='drive'){
        document.getElementById('import-step-drive').style.display='block';
        document.getElementById('user-modal-title').textContent=lang==='es'?'Importar Google Sheets':'Import Google Sheets';
        document.getElementById('drive-preview').style.display='none';
        document.getElementById('drive-result').style.display='none';
        document.getElementById('drive-import-btn').style.display='none';
      }
    };

    // ── CSV file handling ──
    window.handleCsvFile=function(file){
      if(!file)return;
      var reader=new FileReader();
      reader.onload=function(e){
        _csvData=e.target.result;
        // Simple CSV preview
        var lines=_csvData.split('\\n').filter(function(l){return l.trim()});
        if(lines.length<2){
          errorBox.textContent=lang==='es'?'El archivo CSV esta vacio o no tiene datos.':'The CSV file is empty or has no data.';
          errorBox.style.display='block';
          return;
        }
        var headers=lines[0].split(',').map(function(h){return h.replace(/^"|"$/g,'').trim()});
        var previewRows=lines.slice(1,6);
        var tbl='<thead><tr>'+headers.map(function(h){return '<th>'+h+'</th>'}).join('')+'</tr></thead><tbody>';
        previewRows.forEach(function(row){
          var cols=row.split(',').map(function(c){return c.replace(/^"|"$/g,'').trim()});
          tbl+='<tr>'+cols.map(function(c){return '<td>'+c+'</td>'}).join('')+'</tr>';
        });
        tbl+='</tbody>';
        document.getElementById('csv-preview-table').innerHTML=tbl;
        document.getElementById('csv-preview-label').textContent=(lang==='es'?'Vista previa':'Preview')+' ('+lines.length+' '+(lang==='es'?'filas':'rows')+')';
        document.getElementById('csv-preview').style.display='block';
        document.getElementById('csv-import-btn').style.display='inline-flex';
        errorBox.style.display='none';
      };
      reader.readAsText(file);
    };

    window.submitCsvImport=function(){
      if(!_csvData||!_currentListType)return;
      var btn=document.getElementById('csv-import-btn');
      btn.disabled=true;btn.textContent=lang==='es'?'Importando...':'Importing...';
      fetch('/console/api/users/bulk-import',{
        method:'POST',
        headers:{'Content-Type':'application/json'},
        body:JSON.stringify({listType:_currentListType,format:'csv',data:_csvData,source:'manual'})
      }).then(function(r){return r.json()}).then(function(data){
        btn.disabled=false;btn.textContent=lang==='es'?'Importar':'Import';
        var res=document.getElementById('csv-result');
        if(data.ok){
          var r=data.result;
          var errTxt=r.errors&&r.errors.length>0?' | '+(lang==='es'?'Errores':'Errors')+': '+r.errors.length:'';
          res.innerHTML='<div style="color:var(--success,green);font-weight:600">'+(lang==='es'?'Importacion completada':'Import completed')+'</div><div style="font-size:13px;margin-top:4px">'+(lang==='es'?'Creados':'Created')+': '+r.created+' / '+r.total+errTxt+'</div>';
          res.style.display='block';
          document.getElementById('csv-import-btn').style.display='none';
          setTimeout(function(){location.reload()},2000);
        }else{
          res.innerHTML='<div style="color:var(--error,red)">'+(data.error||'Error')+'</div>';
          res.style.display='block';
        }
      }).catch(function(err){
        btn.disabled=false;btn.textContent=lang==='es'?'Importar':'Import';
        errorBox.textContent=err.message||'Error';errorBox.style.display='block';
      });
    };

    // ── Google Drive import ──
    window.previewDriveSheet=function(){
      var url=document.getElementById('drive-sheet-url').value.trim();
      if(!url){errorBox.textContent=lang==='es'?'Ingresa una URL de Google Sheets.':'Enter a Google Sheets URL.';errorBox.style.display='block';return}
      var btn=document.getElementById('drive-preview-btn');
      btn.disabled=true;btn.textContent=lang==='es'?'Cargando...':'Loading...';
      errorBox.style.display='none';
      fetch('/console/api/users/drive-preview',{
        method:'POST',
        headers:{'Content-Type':'application/json'},
        body:JSON.stringify({sheetUrl:url})
      }).then(function(r){return r.json()}).then(function(data){
        btn.disabled=false;btn.textContent=lang==='es'?'Previsualizar':'Preview';
        if(data.ok&&data.rows&&data.rows.length>0){
          var headers=data.rows[0];
          var tbl='<thead><tr>'+headers.map(function(h){return '<th>'+h+'</th>'}).join('')+'</tr></thead><tbody>';
          data.rows.slice(1).forEach(function(row){
            tbl+='<tr>'+row.map(function(c){return '<td>'+(c||'')+'</td>'}).join('')+'</tr>';
          });
          tbl+='</tbody>';
          document.getElementById('drive-preview-table').innerHTML=tbl;
          document.getElementById('drive-preview-label').textContent=(lang==='es'?'Vista previa':'Preview')+' ('+data.rows.length+' '+(lang==='es'?'filas':'rows')+')';
          document.getElementById('drive-preview').style.display='block';
          document.getElementById('drive-import-btn').style.display='inline-flex';
        }else{
          errorBox.textContent=data.error||(lang==='es'?'No se pudo leer la hoja.':'Could not read the sheet.');
          errorBox.style.display='block';
        }
      }).catch(function(err){
        btn.disabled=false;btn.textContent=lang==='es'?'Previsualizar':'Preview';
        errorBox.textContent=err.message||'Error';errorBox.style.display='block';
      });
    };

    window.submitDriveImport=function(){
      var url=document.getElementById('drive-sheet-url').value.trim();
      if(!url||!_currentListType)return;
      var btn=document.getElementById('drive-import-btn');
      btn.disabled=true;btn.textContent=lang==='es'?'Importando...':'Importing...';
      fetch('/console/api/users/drive-import',{
        method:'POST',
        headers:{'Content-Type':'application/json'},
        body:JSON.stringify({listType:_currentListType,sheetUrl:url})
      }).then(function(r){return r.json()}).then(function(data){
        btn.disabled=false;btn.textContent=lang==='es'?'Importar':'Import';
        var res=document.getElementById('drive-result');
        if(data.ok){
          var r=data.result;
          var errTxt=r.errors&&r.errors.length>0?' | '+(lang==='es'?'Errores':'Errors')+': '+r.errors.length:'';
          res.innerHTML='<div style="color:var(--success,green);font-weight:600">'+(lang==='es'?'Importacion completada':'Import completed')+'</div><div style="font-size:13px;margin-top:4px">'+(lang==='es'?'Creados':'Created')+': '+r.created+' / '+r.total+errTxt+'</div>';
          res.style.display='block';
          document.getElementById('drive-import-btn').style.display='none';
          setTimeout(function(){location.reload()},2000);
        }else{
          res.innerHTML='<div style="color:var(--error,red)">'+(data.error||'Error')+'</div>';
          res.style.display='block';
        }
      }).catch(function(err){
        btn.disabled=false;btn.textContent=lang==='es'?'Importar':'Import';
        errorBox.textContent=err.message||'Error';errorBox.style.display='block';
      });
    };

    // ── Role dropdown helper ──
    function setupRoleDropdown(lt,selectedRole){
      var wrap=document.getElementById('user-modal-role-wrap');
      var sel=document.getElementById('user-modal-role');
      if(lt==='coworker'&&coworkerRoles.length>0){
        wrap.style.display='block';
        sel.innerHTML='<option value="">'+(lang==='es'?'— Sin rol —':'— No role —')+'</option>';
        coworkerRoles.forEach(function(r){
          var opt=document.createElement('option');opt.value=r;opt.textContent=r;
          if(r===selectedRole)opt.selected=true;
          sel.appendChild(opt);
        });
      }else{
        wrap.style.display='none';sel.value='';
      }
    }

    // ── Modal open: add ──
    window.openAddUserModal=function(lt){
      _currentListType=lt;
      _isEditMode=false;
      // Reset manual form
      document.getElementById('user-modal-submit').textContent=lang==='es'?'Crear':'Create';
      form.action='/console/users/add';
      document.getElementById('user-modal-userId').value='';
      document.getElementById('user-modal-listType').value=lt;
      document.getElementById('user-modal-name').value='';
      form.querySelectorAll('[data-channel]').forEach(function(inp){inp.value='';inp.classList.remove('invalid')});
      form.querySelectorAll('.wizard-field-error').forEach(function(e){e.style.display='none'});
      errorBox.style.display='none';
      listLabel.style.display='none';listSelect.style.display='none';
      setupRoleDropdown(lt,'');
      // Show step 0 (mode selector)
      showImportStep('select');
      modal.style.display='flex';
    };

    // ── Modal open: edit ──
    window.userEditSelected=function(lt){
      _currentListType=lt;
      _isEditMode=true;
      var cbs=document.querySelectorAll('.user-cb[data-list="'+lt+'"]:checked');
      if(cbs.length!==1){alert(lang==='es'?'Selecciona exactamente 1 usuario.':'Select exactly 1 user.');return}
      var tr=cbs[0].closest('tr');
      var uid=tr.getAttribute('data-user-id');
      var name=tr.getAttribute('data-user-name')||'';
      var currentRole=tr.getAttribute('data-role')||'';
      var contacts={};try{contacts=JSON.parse(tr.getAttribute('data-contacts')||'{}')}catch(e){}
      document.getElementById('user-modal-title').textContent=lang==='es'?'Editar usuario':'Edit user';
      document.getElementById('user-modal-submit').textContent=lang==='es'?'Guardar':'Save';
      form.action='/console/users/update';
      document.getElementById('user-modal-userId').value=uid;
      document.getElementById('user-modal-listType').value=lt;
      document.getElementById('user-modal-name').value=name;
      setupRoleDropdown(lt,currentRole);
      form.querySelectorAll('[data-channel]').forEach(function(inp){
        var chId=inp.getAttribute('data-channel');
        inp.value=contacts[chId]||'';
        inp.classList.remove('invalid');
      });
      form.querySelectorAll('.wizard-field-error').forEach(function(e){e.style.display='none'});
      errorBox.style.display='none';
      // Show list change dropdown
      listLabel.style.display='block';listSelect.style.display='block';
      listSelect.value=lt;
      // Skip step 0, go directly to manual form (no back button for edit)
      document.getElementById('import-step-0').style.display='none';
      document.getElementById('import-step-manual').style.display='block';
      document.getElementById('import-step-file').style.display='none';
      document.getElementById('import-step-drive').style.display='none';
      document.getElementById('manual-back-btn').style.display='none';
      modal.style.display='flex';
    };

    // ── List change confirm ──
    var _origList='';
    window.userModalListChange=function(sel){
      if(!_origList)_origList=sel.getAttribute('data-orig')||sel.value;
      if(sel.value!==_origList){
        var msg=lang==='es'?'¿Mover este usuario a la lista "'+sel.options[sel.selectedIndex].text+'"?':'Move this user to the "'+sel.options[sel.selectedIndex].text+'" list?';
        if(!confirm(msg)){sel.value=_origList}
      }
    };

    window.closeUserModal=function(){modal.style.display='none';_origList=''};

    // ── Checkbox selection ──
    window.userSelChanged=function(lt){
      var bar=document.getElementById('sel-bar-'+lt);
      var cbs=document.querySelectorAll('.user-cb[data-list="'+lt+'"]:checked');
      if(bar){
        bar.classList.toggle('visible',cbs.length>0);
        // Hide edit button when multiple selected (edit = single only)
        var editBtn=bar.querySelector('[onclick*="userEditSelected"]');
        if(editBtn)editBtn.style.display=cbs.length===1?'':'none';
      }
    };

    // ── Deactivate/delete ──
    window.userDeactivateSelected=function(lt){
      var cbs=document.querySelectorAll('.user-cb[data-list="'+lt+'"]:checked');
      if(!cbs.length)return;
      if(!confirm(lang==='es'?'¿Desactivar '+cbs.length+' usuario(s)?':'Deactivate '+cbs.length+' user(s)?'))return;
      cbs.forEach(function(cb){
        var f=document.createElement('form');f.method='POST';f.action='/console/users/deactivate';
        f.innerHTML='<input name="_section" value="users"><input name="_lang" value="'+lang+'"><input name="userId" value="'+cb.value+'">';
        document.body.appendChild(f);f.submit();
      });
    };
    window.userDeleteSelected=function(lt){
      var cbs=document.querySelectorAll('.user-cb[data-list="'+lt+'"]:checked');
      var allInactive=true;
      cbs.forEach(function(cb){var tr=cb.closest('tr');if(tr&&tr.getAttribute('data-user-active')==='true')allInactive=false});
      if(!allInactive){alert(lang==='es'?'Solo se pueden eliminar usuarios desactivados.':'Can only delete deactivated users.');return}
      if(!confirm(lang==='es'?'¿Eliminar permanentemente?':'Delete permanently?'))return;
      alert(lang==='es'?'Eliminacion permanente aun no implementada.':'Permanent deletion not yet implemented.');
    };

    // ── Select all ──
    window.userToggleAll=function(lt){
      var cbAll=document.getElementById('cb-all-'+lt);
      var checked=cbAll?cbAll.checked:false;
      document.querySelectorAll('.user-cb[data-list="'+lt+'"]').forEach(function(cb){
        if(cb.closest('tr').style.display!=='none')cb.checked=checked;
      });
      userSelChanged(lt);
    };

    // ── Pagination state ──
    var _page={};
    window.userPage=function(lt,dir){
      if(!_page[lt])_page[lt]=0;
      _page[lt]=Math.max(0,_page[lt]+dir);
      userFilterApply();
    };

    // ── Filtering + pagination ──
    window.userFilterApply=function(){
      var sortEl=document.getElementById('uf-sort');
      var sourceEl=document.getElementById('uf-source');
      var activityEl=document.getElementById('uf-activity');
      var perpageEl=document.getElementById('uf-perpage');
      var sort=sortEl?sortEl.value:'asc';
      var source=sourceEl?sourceEl.value:'all';
      var activity=activityEl?activityEl.value:'all';
      var perpage=perpageEl?parseInt(perpageEl.value,10):50;
      // Multi-select channels
      var channelCbs=document.querySelectorAll('.uf-ch-option input[type="checkbox"]');
      var selectedChannels=[];
      channelCbs.forEach(function(cb){if(cb.checked)selectedChannels.push(cb.value)});
      var allChannels=channelCbs.length===selectedChannels.length;
      // Update channel button label
      var chBtn=document.querySelector('#uf-channel-wrap .custom-select-btn');
      if(chBtn){
        var arrow=' <svg class="custom-select-arrow" width="10" height="6" viewBox="0 0 10 6" fill="none"><path d="M1 1L5 5L9 1" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>';
        chBtn.innerHTML=(allChannels?(lang==='es'?'Todos':'All'):selectedChannels.length+' '+(lang==='es'?'canales':'channels'))+arrow;
      }
      var search=(document.getElementById('uf-search')||{}).value||'';
      search=search.toLowerCase();

      // Collect all rows, filter, then paginate
      var tables=document.querySelectorAll('.users-table');
      tables.forEach(function(tbl){
        var lt=tbl.id.replace('tbl-','');
        var rows=Array.prototype.slice.call(tbl.querySelectorAll('tbody tr[data-user-id]'));

        // Filter
        var visible=rows.filter(function(tr){
          if(!allChannels){
            var chs=(tr.getAttribute('data-channels')||'').split(',');
            var hasMatch=false;
            for(var ci=0;ci<selectedChannels.length;ci++){if(chs.indexOf(selectedChannels[ci])!==-1){hasMatch=true;break}}
            if(!hasMatch)return false;
          }
          if(source!=='all'){
            var s=tr.getAttribute('data-source')||'';
            if(source==='manual'&&s!=='manual')return false;
            if(source==='inbound'&&s!=='inbound')return false;
            if(source==='outbound'&&s!=='outbound')return false;
            if(source==='sync'&&s!=='csv_import'&&s!=='sheet_sync')return false;
          }
          if(activity!=='all'){
            // Time-based filters: show only active users (timestamps not available yet)
            if(tr.getAttribute('data-user-active')!=='true')return false;
          }
          if(search){
            var h=(tr.getAttribute('data-search')||'').toLowerCase();
            if(h.indexOf(search)===-1)return false;
          }
          return true;
        });

        // Sort by name
        visible.sort(function(a,b){
          var na=(a.getAttribute('data-user-name')||'').toLowerCase();
          var nb=(b.getAttribute('data-user-name')||'').toLowerCase();
          return sort==='desc'?nb.localeCompare(na):na.localeCompare(nb);
        });

        // Paginate
        if(!_page[lt])_page[lt]=0;
        var totalPages=Math.max(1,Math.ceil(visible.length/perpage));
        if(_page[lt]>=totalPages)_page[lt]=totalPages-1;
        var start=_page[lt]*perpage;
        var end=start+perpage;

        // Reorder DOM to match sort, then hide/show for pagination
        var tbody=tbl.querySelector('tbody');
        if(tbody){
          visible.forEach(function(tr){tbody.appendChild(tr)});
          // Also append filtered-out rows at end (hidden)
          rows.forEach(function(tr){if(visible.indexOf(tr)===-1)tbody.appendChild(tr)});
        }
        rows.forEach(function(tr){tr.style.display='none'});
        for(var i=start;i<Math.min(end,visible.length);i++){visible[i].style.display=''}

        // Update pager info
        var info=document.getElementById('pager-info-'+lt);
        if(info)info.textContent=(start+1)+'-'+Math.min(end,visible.length)+' / '+visible.length;
      });
    };
    // Initial filter
    setTimeout(userFilterApply,100);

    // ── Module toggle: select/deselect all tools in a module ──
    window.toggleModuleTools=function(lt,mod,checked){
      document.querySelectorAll('.tool-cb-'+lt+'-'+mod).forEach(function(cb){
        cb.checked=checked;
        var h=document.querySelector('input[name="'+cb.getAttribute('data-hidden')+'"]');
        if(h){h.value=checked?'on':'';h.dispatchEvent(new Event('input',{bubbles:true}))}
      });
    };

    // ── Perm sync (all checkboxes with data-hidden) ──
    document.querySelectorAll('.perm-cb').forEach(function(cb){
      cb.addEventListener('change',function(){
        var h=document.querySelector('input[name="'+cb.getAttribute('data-hidden')+'"]');
        if(h){h.value=cb.checked?'on':'';h.dispatchEvent(new Event('input',{bubbles:true}))}
      })
    });

    // Re-init custom selects for filter bar (loaded after initial init)
    if(typeof initCustomSelects==='function')initCustomSelects();
  })()</script>`

  // ── Config page ──
  if (isConfigPage) {
  const { activeModules = [], knowledgeCategories: kCats = [] } = ud
  const SYSTEM_TYPES = ['admin', 'lead', 'coworker', 'partners']
  const activeCount = configs.filter(c => c.isEnabled).length

  // Section A: Base Cards Grid
  const SVG_CONTACTS_ICON = '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>'
  const SVG_EYE = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>'

  html += `<div class="cb-grid">`
  for (const cfg of configs) {
    const lt = cfg.listType
    const isSys = cfg.isSystem || SYSTEM_TYPES.includes(lt)
    const count = counts[lt] ?? 0
    const enabledOrig = cfg.isEnabled ? 'true' : 'false'
    const isPartners = lt === 'partners'
    const inactiveClass = !cfg.isEnabled ? ' ch-card-inactive' : ''
    const typeLabel = isSys ? (lang === 'es' ? 'Sistema' : 'System') : (lang === 'es' ? 'Custom' : 'Custom')
    const countLabel = lang === 'es' ? 'contactos' : 'contacts'

    html += `<div class="ch-card cb-card${inactiveClass}" data-base-id="${esc(lt)}" data-enabled="${cfg.isEnabled}" ${!isPartners ? `onclick="if(!event.target.closest('.toggle,.ch-btn-action,a'))toggleBaseConfigClick('${esc(lt)}')" style="cursor:pointer"` : ''}>
      <div class="ch-card-top">
        <div class="ch-card-icon" style="border-color:var(--primary);color:var(--primary);background:rgba(255,94,14,0.08)">
          ${SVG_CONTACTS_ICON}
        </div>
        <div class="ch-card-title-area">
          <div class="ch-card-name">${esc(cfg.displayName)}</div>
          <div class="ch-card-type">${typeLabel}</div>
        </div>
        ${lt === 'admin' ? '' : `<label class="toggle toggle-sm" onclick="event.stopPropagation()">
          <input type="checkbox" ${cfg.isEnabled ? 'checked' : ''} ${isPartners ? 'disabled' : ''}
            data-list-toggle="${esc(lt)}" data-list-name="${esc(cfg.displayName)}"
            onchange="toggleBaseList(this)">
          <span class="toggle-slider"></span>
        </label>`}
      </div>
      <div class="ch-card-metrics ch-metrics-1">
        <div class="ch-metric" style="border:none">
          <span class="ch-metric-label">${countLabel}</span>
          <span class="ch-metric-value">${count}</span>
        </div>
      </div>
      <div class="ch-card-footer">${isPartners
        ? `<span class="panel-badge badge-soon">${lang === 'es' ? 'Proximamente' : 'Coming soon'}</span>`
        : `<button type="button" class="ch-btn-action ch-btn-gear" onclick="event.stopPropagation();toggleBaseConfigClick('${esc(lt)}')">${GEAR_SVG} ${lang === 'es' ? 'Configurar' : 'Configure'}</button>
           <span class="ch-footer-spacer"></span>
           <a href="/console/contacts/${esc(lt)}?lang=${lang}" class="ch-btn-action ch-btn-connect" onclick="event.stopPropagation()">${SVG_EYE} ${lang === 'es' ? 'Ver' : 'View'}</a>`
      }</div>
    </div>`
  }
  html += `</div>`

  // ── Tip box: shown when no base is selected for config ──
  const SVG_CONFIG_TIP = '<svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>'

  html += `<div class="cb-config-tip" id="cb-config-tip">
    ${SVG_CONFIG_TIP}
    <div style="margin-top:8px;font-size:0.95rem">${lang === 'es' ? 'Selecciona una base para configurar' : 'Select a base to configure'}</div>
  </div>`

  // ── System base explanations ──
  const BASE_EXPLANATIONS: Record<string, Record<string, string>> = {
    lead: {
      es: 'Todos los contactos no registrados cuando la atencion al publico esta abierta. Se registran automaticamente como leads y se califican segun las reglas configuradas.',
      en: 'All unregistered contacts when public attention is open. They are automatically registered as leads and scored according to configured rules.',
    },
    coworker: {
      es: 'Empleados de la empresa. Se asignan por dominio de correo electronico o manualmente. Los contactos cuyo email coincida con los dominios configurados se asignan automaticamente a esta base.',
      en: 'Company employees. Assigned by email domain or manually. Contacts whose email matches configured domains are automatically assigned to this base.',
    },
  }

  // ── Per-base config panels (2-column layout, hidden by default) ──
  // Layout: LEFT = info/rules (narrow, ~1 card), RIGHT = collapsible tabs (wide, ~3 cards)
  for (const cfg of configs) {
    const lt = cfg.listType
    if (lt === 'partners') continue // Partners = "proximamente"
    const isSys = cfg.isSystem || SYSTEM_TYPES.includes(lt)
    const perms = cfg.permissions
    const isAllTools = perms.tools.includes('*')

    html += `<div class="cb-config-panel" id="cb-config-${esc(lt)}">
      <div class="cb-config-layout">`

    // ══ Column 1 (LEFT, narrow): name, description, assignment rules ══
    html += `<div><div class="panel"><div class="panel-body">
      <div style="font-size:1.1rem;font-weight:700;color:var(--on-surface);margin-bottom:4px">${esc(cfg.displayName)}</div>
      ${cfg.description ? `<div style="font-size:13px;color:var(--on-surface-variant);margin-bottom:12px">${esc(cfg.description)}</div>` : ''}`

    // System-specific explanations
    const explanation = BASE_EXPLANATIONS[lt]
    if (explanation) {
      html += `<div class="field-divider"><span class="field-divider-label">${lang === 'es' ? 'Reglas de asignacion' : 'Assignment rules'}</span></div>
        <div style="font-size:13px;color:var(--on-surface-variant);line-height:1.6;padding:12px 16px;background:var(--surface-container-low);border-radius:0.5rem;margin-bottom:12px">
        ${esc(explanation[lang] || explanation['es']!)}</div>`
    }

    // Coworker: email domain tags input
    if (lt === 'coworker') {
      const domains: string[] = (cfg.syncConfig as Record<string, unknown>)?.domains as string[] ?? []
      const domainsOrig = domains.join(',')
      const domainChips = domains.map(d => `<span class="tag-chip">${esc(d)} <button type="button" onclick="removeDomainTag(this)">×</button></span>`).join('')
      html += `<div class="field-divider"><span class="field-divider-label">${lang === 'es' ? 'Dominios de correo' : 'Email domains'}</span></div>
        <div style="margin-bottom:12px">
          <div class="tags-container" id="coworker-domains-tags">
            ${domainChips}
            <input type="text" class="tags-input" id="coworker-domain-input" placeholder="${lang === 'es' ? 'Ej: @miempresa.com + Enter' : 'E.g. @company.com + Enter'}" onkeydown="if(event.key==='Enter'){event.preventDefault();addDomainTag()}">
          </div>
          <input type="hidden" name="coworker_domains" value="${esc(domainsOrig)}" data-original="${esc(domainsOrig)}" id="coworker-domains-hidden">
        </div>`

      // Coworker: roles tags input
      const roles: string[] = (cfg.syncConfig as Record<string, unknown>)?.roles as string[] ?? []
      const rolesOrig = roles.join(',')
      const roleChips = roles.map(r => `<span class="tag-chip">${esc(r)} <button type="button" onclick="removeRoleTag(this)">×</button></span>`).join('')
      html += `<div class="field-divider"><span class="field-divider-label">${lang === 'es' ? 'Roles disponibles' : 'Available roles'}</span></div>
        <div style="margin-bottom:12px">
          <div style="font-size:12px;color:var(--on-surface-variant);margin-bottom:6px">${lang === 'es' ? 'Define los roles disponibles para asignar a coworkers. Se usan para escalamientos y human-in-the-loop.' : 'Define available roles to assign to coworkers. Used for escalations and human-in-the-loop.'}</div>
          <div class="tags-container" id="coworker-roles-tags">
            ${roleChips}
            <input type="text" class="tags-input" id="coworker-role-input" placeholder="${lang === 'es' ? 'Ej: Gerente + Enter' : 'E.g. Manager + Enter'}" onkeydown="if(event.key==='Enter'){event.preventDefault();addRoleTag()}">
          </div>
          <input type="hidden" name="coworker_roles" value="${esc(rolesOrig)}" data-original="${esc(rolesOrig)}" id="coworker-roles-hidden">
        </div>`
    }

    // Assignment rules (custom lists only — not system)
    if (!['admin', 'lead', 'coworker'].includes(lt)) {
      const aEnabled = cfg.assignmentEnabled
      const aPrompt = cfg.assignmentPrompt || ''
      const aOrig = aEnabled ? 'on' : ''
      html += `<div class="field-divider"><span class="field-divider-label">${lang === 'es' ? 'Reglas de asignacion' : 'Assignment rules'}</span></div>
        <div class="chs-toggle-row" style="padding:10px 14px">
          <span style="font-size:13px">${lang === 'es' ? 'Asignacion automatica por LLM' : 'LLM auto-assignment'}</span>
          <span class="ch-footer-spacer"></span>
          <input type="checkbox" class="perm-cb" style="accent-color:var(--primary);width:15px;height:15px"
            ${aEnabled ? 'checked' : ''} data-hidden="assignment_enabled_${esc(lt)}"
            onchange="document.getElementById('assignment-prompt-${esc(lt)}').style.display=this.checked?'block':'none'">
          <input type="hidden" name="assignment_enabled_${esc(lt)}" value="${aOrig}" data-original="${aOrig}">
        </div>
        <div id="assignment-prompt-${esc(lt)}" style="display:${aEnabled ? 'block' : 'none'};margin-top:8px">
          <label class="wizard-label">${lang === 'es' ? 'Instrucciones para el modelo' : 'Instructions for the model'}</label>
          <textarea class="wizard-input" name="assignment_prompt_${esc(lt)}" rows="3" data-original="${esc(aPrompt)}"
            placeholder="${lang === 'es' ? 'Ej: Si el contacto menciona que es proveedor o viene referido por un partner, asignalo a esta lista.' : 'E.g. If the contact mentions they are a vendor or referred by a partner, assign them to this list.'}">${esc(aPrompt)}</textarea>
        </div>`
    }

    // Delete button for custom lists
    if (!isSys) {
      html += `<div style="margin-top:1rem;padding-top:1rem;border-top:1px solid rgba(0,0,0,0.04)">
        <form method="POST" action="/console/users/delete-list" style="display:inline" onclick="return confirm('${lang === 'es' ? '¿Eliminar esta lista? Los contactos se moveran.' : 'Delete this list? Contacts will be moved.'}')">
          <input type="hidden" name="_section" value="contacts"><input type="hidden" name="_lang" value="${lang}">
          <input type="hidden" name="listType" value="${esc(lt)}">
          <button type="submit" class="act-btn act-btn-remove">${SVG_DELETE} ${lang === 'es' ? 'Eliminar lista' : 'Delete list'}</button>
        </form>
      </div>`
    }

    html += `</div></div></div>` // end left column

    // ══ Column 2 (RIGHT, wide): collapsible tabs — Modules, Subagents, Knowledge ══
    html += `<div>`

    // Admin = read-only (all access, informational only)
    const isAdmin = lt === 'admin'
    const disabledAttr = isAdmin ? ' disabled' : ''

    // Tab 1: Modules
    html += `<div class="panel collapsed"><div class="panel-header" onclick="togglePanel(this)">
      <span class="panel-title">${lang === 'es' ? 'Modulos' : 'Modules'}</span>
      <span class="panel-chevron">&#9660;</span></div><div class="panel-body">`

    for (const mod of activeModules) {
      const modLabel = typeof mod.displayName === 'string' ? mod.displayName : (mod.displayName[lang] || mod.displayName['es'] || mod.name)
      const modToolNames = mod.tools.map(t => t.name)
      const allModToolsOn = isAdmin || isAllTools || modToolNames.every(tn => perms.tools.includes(tn))
      const someModToolsOn = !allModToolsOn && modToolNames.some(tn => perms.tools.includes(tn))

      const modOrig = allModToolsOn ? 'on' : ''
      html += `<div class="chs-toggle-row" style="margin-bottom:4px;padding:10px 14px">
        <span style="font-size:13px;font-weight:600">${esc(modLabel)}</span>
        <span class="ch-footer-spacer"></span>
        <input type="checkbox" class="perm-cb" style="accent-color:var(--primary);width:15px;height:15px"
          ${allModToolsOn ? 'checked' : ''} ${someModToolsOn ? 'indeterminate' : ''}${disabledAttr}
          data-hidden="mod_${esc(lt)}_${esc(mod.name)}"
          onchange="toggleModuleTools('${esc(lt)}','${esc(mod.name)}',this.checked)">
        <input type="hidden" name="mod_${esc(lt)}_${esc(mod.name)}" value="${modOrig}" data-original="${modOrig}">
      </div>`

      html += `<div class="perm-grid" style="padding-left:28px;margin-bottom:8px" id="mod-tools-${esc(lt)}-${esc(mod.name)}">`
      for (const tool of mod.tools) {
        const checked = isAdmin || isAllTools || perms.tools.includes(tool.name)
        const origVal = checked ? 'on' : ''
        const toolDesc = tool.description || ''
        const infoHtml = toolDesc ? `<span class="info-wrap"><span class="info-btn" tabindex="0">i</span><span class="info-tooltip">${esc(toolDesc)}</span></span>` : ''
        html += `<label>
          <input type="checkbox" class="perm-cb tool-cb-${esc(lt)}-${esc(mod.name)}" ${checked ? 'checked' : ''}${disabledAttr}
            data-hidden="tool_${esc(lt)}_${esc(tool.name)}">
          <input type="hidden" name="tool_${esc(lt)}_${esc(tool.name)}" value="${origVal}" data-original="${origVal}">
          ${esc(tool.displayName || tool.name)}${infoHtml}</label>`
      }
      html += `</div>`
    }
    html += `</div></div>` // end Modules panel

    // Tab 2: Subagents
    const subOrig = perms.subagents ? 'on' : ''
    html += `<div class="panel collapsed"><div class="panel-header" onclick="togglePanel(this)">
      <span class="panel-title">${lang === 'es' ? 'Subagentes' : 'Subagents'}</span>
      <span class="panel-chevron">&#9660;</span></div><div class="panel-body">
      <div class="chs-toggle-row" style="padding:10px 14px">
        <span style="font-size:13px">${lang === 'es' ? 'Permitir subagentes' : 'Allow subagents'}</span>
        <span class="ch-footer-spacer"></span>
        <input type="checkbox" class="perm-cb" style="accent-color:var(--primary);width:15px;height:15px"
          ${isAdmin || perms.subagents ? 'checked' : ''}${disabledAttr} data-hidden="sub_${esc(lt)}">
        <input type="hidden" name="sub_${esc(lt)}" value="${subOrig}" data-original="${subOrig}">
      </div>
    </div></div>` // end Subagents panel

    // Tab 3: Knowledge Categories (always show, even if empty)
    const allowedCats = cfg.knowledgeCategories ?? []
    const allCats = isAdmin || allowedCats.length === 0
    html += `<div class="panel collapsed"><div class="panel-header" onclick="togglePanel(this)">
      <span class="panel-title">${lang === 'es' ? 'Categorias de conocimiento' : 'Knowledge categories'}</span>
      <span class="panel-chevron">&#9660;</span></div><div class="panel-body">`
    if (kCats.length > 0) {
      html += `<div class="perm-grid">`
      for (const cat of kCats) {
        const checked = allCats || allowedCats.includes(cat.id)
        const origVal = checked ? 'on' : ''
        html += `<label title="${esc(cat.description)}">
          <input type="checkbox" class="perm-cb" ${checked ? 'checked' : ''}${disabledAttr} data-hidden="kcat_${esc(lt)}_${esc(cat.id)}">
          <input type="hidden" name="kcat_${esc(lt)}_${esc(cat.id)}" value="${origVal}" data-original="${origVal}">
          ${esc(cat.title)}</label>`
      }
      html += `</div>`
    } else {
      html += `<p class="panel-description" style="font-size:12px;color:var(--on-surface-dim)">${lang === 'es' ? 'No hay categorias de conocimiento configuradas. Activa el modulo de Knowledge para gestionar categorias.' : 'No knowledge categories configured. Activate the Knowledge module to manage categories.'}</p>`
    }
    html += `</div></div>` // end Knowledge panel

    html += `</div>` // end right column
    html += `</div></div>` // end cb-config-layout + cb-config-panel
  }

  // ── Create base box + Unregistered contacts (global config) ──
  html += `<div class="cb-create-box">
    <div class="cb-create-box-header">
      <div>
        <div style="font-size:1.05rem;font-weight:700;color:var(--on-surface)">${lang === 'es' ? 'Organiza tus usuarios' : 'Organize your users'}</div>
        <div style="font-size:0.82rem;color:var(--on-surface-variant);margin-top:4px">${lang === 'es' ? 'Crea tus bases de contactos aqui para segmentar y organizar tu audiencia.' : 'Create your contact bases here to segment and organize your audience.'}</div>
      </div>
      <button type="button" class="act-btn act-btn-cta" onclick="toggleCreateBase()">${SVG_PLUS} ${lang === 'es' ? 'Crear base de contactos' : 'Create contact base'}</button>
    </div>
    <form id="cb-create-form" method="POST" action="/console/users/create-list" style="display:none;margin-top:20px;flex-direction:column;gap:12px">
      <input type="hidden" name="_section" value="contacts"><input type="hidden" name="_lang" value="${lang}">
      <label class="wizard-label">${lang === 'es' ? 'Nombre de la lista' : 'List name'}</label>
      <input type="text" class="wizard-input" name="listName" required placeholder="${lang === 'es' ? 'Ej: Proveedores' : 'E.g. Vendors'}">
      <label class="wizard-label">${lang === 'es' ? 'Descripcion (80-200 caracteres)' : 'Description (80-200 chars)'}</label>
      <textarea class="wizard-input" name="listDescription" required minlength="80" maxlength="200" rows="2" placeholder="${lang === 'es' ? 'Describe el proposito de esta lista...' : 'Describe this list purpose...'}"></textarea>
      <div class="chs-toggle-row" style="padding:10px 14px">
        <span style="font-size:13px">${lang === 'es' ? 'Crear regla de asignacion?' : 'Create assignment rule?'}</span>
        <span class="ch-footer-spacer"></span>
        <label class="toggle toggle-sm">
          <input type="checkbox" name="createAssignmentRule" disabled>
          <span class="toggle-slider"></span>
        </label>
      </div>
      <div style="display:flex;align-items:center;gap:12px">
        <button type="submit" class="act-btn act-btn-cta" disabled>${lang === 'es' ? 'Crear' : 'Create'}</button>
        <span class="panel-badge badge-soon">${lang === 'es' ? 'Proximamente' : 'Coming soon'}</span>
      </div>
    </form>
  </div>`

  // ── Contactos no registrados (global config) ──
  const leadCfg = configs.find(c => c.listType === 'lead')
  if (leadCfg) {
    const behavior = leadCfg.unregisteredBehavior || 'silence'
    html += `<div class="cb-create-box" style="margin-top:16px">
      <div class="cb-create-box-header">
        <div>
          <div style="font-size:1.05rem;font-weight:700;color:var(--on-surface)">${lang === 'es' ? 'Contactos no registrados' : 'Unregistered contacts'}</div>
          <div style="font-size:0.82rem;color:var(--on-surface-variant);margin-top:4px">${lang === 'es' ? 'Configura que sucede cuando un contacto desconocido escribe por primera vez.' : 'Configure what happens when an unknown contact writes for the first time.'}</div>
        </div>
        <select name="unregisteredBehavior" data-original="${esc(behavior)}" style="max-width:240px" onchange="document.getElementById('unregistered-msg-field').style.display=this.value==='generic_message'?'block':'none'">
          <option value="silence" ${behavior === 'silence' ? 'selected' : ''}>${lang === 'es' ? 'Silencio — sin respuesta' : 'Silence — no response'}</option>
          <option value="generic_message" ${behavior === 'generic_message' ? 'selected' : ''}>${lang === 'es' ? 'Mensaje generico' : 'Generic message'}</option>
          <option value="register_only" ${behavior === 'register_only' ? 'selected' : ''}>${lang === 'es' ? 'Registrar sin responder' : 'Register without responding'}</option>
          <option value="leads" ${behavior === 'leads' ? 'selected' : ''}>${lang === 'es' ? 'Leads — activar tabla de leads' : 'Leads — enable leads table'}</option>
        </select>
      </div>
      <div id="unregistered-msg-field" style="display:${behavior === 'generic_message' ? 'block' : 'none'};margin-top:12px">
        <label class="wizard-label">${lang === 'es' ? 'Mensaje' : 'Message'}</label>
        <textarea class="wizard-input" name="unregisteredMessage" data-original="${esc(leadCfg.unregisteredMessage || '')}" rows="2">${esc(leadCfg.unregisteredMessage || '')}</textarea>
      </div>
    </div>`
  }

  // ── Deactivation modal (2-step confirmation) ──
  const listOptsForModal = configs.filter(c => !['admin', 'partners'].includes(c.listType)).map(c =>
    `<option value="${esc(c.listType)}">${esc(c.displayName)}</option>`
  ).join('')

  html += `<div class="cb-deact-overlay" id="cb-deact-overlay" onclick="if(event.target===this)closeDeactModal()">
    <div class="cb-deact-modal">
      <div class="cb-deact-step active" id="cb-deact-step1">
        <h3>${lang === 'es' ? 'Desactivar base' : 'Deactivate base'}</h3>
        <p id="cb-deact-desc">${lang === 'es' ? '¿Que deseas hacer con los contactos de esta base?' : 'What do you want to do with the contacts in this base?'}</p>
        <div class="field" style="margin-bottom:16px">
          <div class="field-left"><span class="field-label">${lang === 'es' ? 'Accion' : 'Action'}</span></div>
          <select id="cb-deact-action" required>
            <option value="" disabled selected>${lang === 'es' ? 'Selecciona una opcion...' : 'Select an option...'}</option>
            <option value="leads">${lang === 'es' ? 'Tratar como leads' : 'Treat as leads'}</option>
            <option value="silence">${lang === 'es' ? 'Ignorar silenciosamente' : 'Ignore silently'}</option>
            <option value="move">${lang === 'es' ? 'Mover a otra lista' : 'Move to another list'}</option>
          </select>
        </div>
        <div class="field" id="cb-deact-target-wrap" style="display:none;margin-bottom:16px">
          <div class="field-left"><span class="field-label">${lang === 'es' ? 'Lista destino' : 'Target list'}</span></div>
          <select id="cb-deact-target">${listOptsForModal}</select>
        </div>
        <div style="display:flex;gap:8px;justify-content:flex-end">
          <button type="button" class="act-btn act-btn-config" onclick="closeDeactModal()">${lang === 'es' ? 'Cancelar' : 'Cancel'}</button>
          <button type="button" class="act-btn act-btn-remove" id="cb-deact-next" onclick="deactNextStep()">${lang === 'es' ? 'Continuar' : 'Continue'}</button>
        </div>
      </div>
      <div class="cb-deact-step" id="cb-deact-step2">
        <h3>${lang === 'es' ? 'Confirmar desactivacion' : 'Confirm deactivation'}</h3>
        <p id="cb-deact-confirm-msg"></p>
        <div style="display:flex;gap:8px;justify-content:flex-end">
          <button type="button" class="act-btn act-btn-config" onclick="deactBackStep()">${lang === 'es' ? 'Atras' : 'Back'}</button>
          <button type="button" class="act-btn act-btn-remove" onclick="confirmDeactivation()">${lang === 'es' ? 'Desactivar' : 'Deactivate'}</button>
        </div>
      </div>
    </div>
  </div>`

  // ── Config page JavaScript ──
  html += `<script>(function(){
    var _deactLt='';
    var _deactName='';
    var lang=document.documentElement.lang||'es';

    // Submit toggle form (instant apply, like channels)
    function submitListToggle(lt,enabled,behavior,target){
      var form=document.createElement('form');
      form.method='POST';form.action='/console/users/toggle-list';form.style.display='none';
      var fields={listType:lt,enabled:enabled?'true':'false',_redirect:'/console/contacts?page=config&lang='+lang};
      if(behavior)fields.disableBehavior=behavior;
      if(target)fields.disableTarget=target;
      for(var k in fields){var inp=document.createElement('input');inp.type='hidden';inp.name=k;inp.value=fields[k];form.appendChild(inp)}
      document.body.appendChild(form);form.submit();
    }

    // Toggle handler: activate = instant, deactivate = modal
    window.toggleBaseList=function(cb){
      var lt=cb.getAttribute('data-list-toggle');
      var name=cb.getAttribute('data-list-name');
      if(cb.checked){
        // Activating — instant apply
        submitListToggle(lt,true);
      } else {
        // Deactivating — revert and open modal
        cb.checked=true;
        openDeactModal(lt,name);
      }
    };

    // Click on card: only open config if enabled
    window.toggleBaseConfigClick=function(lt){
      var card=document.querySelector('.ch-card[data-base-id="'+lt+'"]');
      if(card&&card.getAttribute('data-enabled')!=='true')return;
      openBaseConfig(lt);
    };

    window.openBaseConfig=function(lt){
      var tip=document.getElementById('cb-config-tip');
      if(tip)tip.style.display='none';
      document.querySelectorAll('.cb-config-panel').forEach(function(p){p.classList.remove('active')});
      var panel=document.getElementById('cb-config-'+lt);
      if(panel){panel.classList.add('active');panel.scrollIntoView({behavior:'smooth',block:'start'})}
      document.querySelectorAll('.ch-card[data-base-id]').forEach(function(c){c.classList.remove('cb-active')});
      var card=document.querySelector('.ch-card[data-base-id="'+lt+'"]');
      if(card)card.classList.add('cb-active');
    };
    window.toggleCreateBase=function(){
      var form=document.getElementById('cb-create-form');
      if(form)form.style.display=form.style.display==='flex'?'none':'flex';
    };
    window.addDomainTag=function(){
      var inp=document.getElementById('coworker-domain-input');
      if(!inp)return;
      var val=inp.value.trim();
      if(!val)return;
      if(val.indexOf('@')!==0)val='@'+val;
      var container=document.getElementById('coworker-domains-tags');
      var tag=document.createElement('span');
      tag.className='tag-chip';
      tag.innerHTML=val+' <button type="button" onclick="this.parentElement.remove();updateDomainHidden()">&times;</button>';
      container.insertBefore(tag,inp);
      inp.value='';
      updateDomainHidden();
    };
    window.updateDomainHidden=function(){
      var chips=document.querySelectorAll('#coworker-domains-tags .tag-chip');
      var vals=[];
      chips.forEach(function(c){vals.push(c.textContent.replace('\\u00d7','').replace('\u00d7','').trim())});
      var hidden=document.getElementById('coworker-domains-hidden');
      if(hidden){hidden.value=vals.join(',');hidden.dispatchEvent(new Event('input',{bubbles:true}))}
    };
    window.removeDomainTag=function(btn){
      btn.parentElement.remove();updateDomainHidden();
    };

    // ── Role tags (coworker) ──
    window.addRoleTag=function(){
      var inp=document.getElementById('coworker-role-input');
      if(!inp)return;
      var val=inp.value.trim();
      if(!val)return;
      var container=document.getElementById('coworker-roles-tags');
      var tag=document.createElement('span');
      tag.className='tag-chip';
      tag.innerHTML=val+' <button type="button" onclick="removeRoleTag(this)">&times;</button>';
      container.insertBefore(tag,inp);
      inp.value='';
      updateRoleHidden();
    };
    window.removeRoleTag=function(btn){
      btn.parentElement.remove();updateRoleHidden();
    };
    window.updateRoleHidden=function(){
      var chips=document.querySelectorAll('#coworker-roles-tags .tag-chip');
      var vals=[];
      chips.forEach(function(c){vals.push(c.textContent.replace('\\u00d7','').replace('\u00d7','').trim())});
      var hidden=document.getElementById('coworker-roles-hidden');
      if(hidden){hidden.value=vals.join(',');hidden.dispatchEvent(new Event('input',{bubbles:true}))}
    };

    // ── Deactivation modal ──
    window.openDeactModal=function(lt,name){
      _deactLt=lt;_deactName=name;
      document.getElementById('cb-deact-action').selectedIndex=0;
      document.getElementById('cb-deact-target-wrap').style.display='none';
      document.getElementById('cb-deact-step1').classList.add('active');
      document.getElementById('cb-deact-step2').classList.remove('active');
      document.getElementById('cb-deact-overlay').classList.add('open');
    };
    window.closeDeactModal=function(){
      document.getElementById('cb-deact-overlay').classList.remove('open');
    };
    document.getElementById('cb-deact-action').addEventListener('change',function(){
      document.getElementById('cb-deact-target-wrap').style.display=this.value==='move'?'grid':'none';
    });
    window.deactNextStep=function(){
      var action=document.getElementById('cb-deact-action').value;
      if(!action){alert(lang==='es'?'Selecciona una opcion.':'Select an option.');return}
      if(action==='move'&&!document.getElementById('cb-deact-target').value){alert(lang==='es'?'Selecciona una lista destino.':'Select a target list.');return}
      var actionText={leads:lang==='es'?'tratar como leads':'treat as leads',silence:lang==='es'?'ignorar silenciosamente':'ignore silently',move:lang==='es'?'mover a otra lista':'move to another list'};
      var msg=lang==='es'
        ?'Estas a punto de desactivar la base "'+_deactName+'". Los contactos se van a '+actionText[action]+'. Esta accion se puede revertir reactivando la base.'
        :'You are about to deactivate the base "'+_deactName+'". Contacts will be '+actionText[action]+'. This action can be reversed by reactivating the base.';
      document.getElementById('cb-deact-confirm-msg').textContent=msg;
      document.getElementById('cb-deact-step1').classList.remove('active');
      document.getElementById('cb-deact-step2').classList.add('active');
    };
    window.deactBackStep=function(){
      document.getElementById('cb-deact-step2').classList.remove('active');
      document.getElementById('cb-deact-step1').classList.add('active');
    };
    window.confirmDeactivation=function(){
      var action=document.getElementById('cb-deact-action').value;
      var target=action==='move'?document.getElementById('cb-deact-target').value:'';
      submitListToggle(_deactLt,false,action,target);
    };

    // ── Perm sync: checkbox → hidden field → dirty tracking ──
    document.querySelectorAll('.cb-config-panel .perm-cb').forEach(function(cb){
      cb.addEventListener('change',function(){
        var hName=cb.getAttribute('data-hidden');
        if(!hName)return;
        var h=document.querySelector('input[name="'+hName+'"]');
        if(h){h.value=cb.checked?'on':'';h.dispatchEvent(new Event('input',{bubbles:true}))}
      });
    });

    // ── Admin: force all checkboxes disabled (belt + suspenders) ──
    document.querySelectorAll('#cb-config-admin input[type="checkbox"]').forEach(function(cb){
      cb.disabled=true;
      cb.checked=true;
    });

    if(typeof initCustomSelects==='function')initCustomSelects();
  })()</script>`

  } // end isConfigPage

  return html + '</div>'
}
