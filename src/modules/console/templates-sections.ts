// templates-sections.ts — Server-side section renderers (migrated from ui/js/render.js)

import { t, tWaStatus, type Lang } from './templates-i18n.js'
import { esc, textField, secretField, numField, boolField, modelDropdown } from './templates-fields.js'
import { renderModulePanels, type ModuleInfo } from './templates-modules.js'
import { ICON_OVERRIDES } from './templates.js'

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
      ${numField('LLM_MAX_INPUT_TOKENS', cv(data, 'LLM_MAX_INPUT_TOKENS'), data.lang, 'f_LLM_MAX_INPUT_TOKENS', 'i_LLM_MAX_INPUT_TOKENS')}
      ${numField('LLM_MAX_OUTPUT_TOKENS', cv(data, 'LLM_MAX_OUTPUT_TOKENS'), data.lang, 'f_LLM_MAX_OUTPUT_TOKENS', 'i_LLM_MAX_OUTPUT_TOKENS')}
      ${numField('LLM_TEMPERATURE_CLASSIFY', cv(data, 'LLM_TEMPERATURE_CLASSIFY'), data.lang, 'f_LLM_TEMPERATURE_CLASSIFY', 'i_TEMPERATURE_CLASSIFY')}
      ${numField('LLM_TEMPERATURE_RESPOND', cv(data, 'LLM_TEMPERATURE_RESPOND'), data.lang, 'f_LLM_TEMPERATURE_RESPOND', 'i_TEMPERATURE_RESPOND')}
      ${numField('LLM_TEMPERATURE_COMPLEX', cv(data, 'LLM_TEMPERATURE_COMPLEX'), data.lang, 'f_LLM_TEMPERATURE_COMPLEX', 'i_TEMPERATURE_COMPLEX')}
      ${numField('LLM_REQUEST_TIMEOUT_MS', cv(data, 'LLM_REQUEST_TIMEOUT_MS'), data.lang, 'f_LLM_REQUEST_TIMEOUT_MS', 'i_LLM_REQUEST_TIMEOUT_MS')}
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
    <button type="button" class="act-btn act-btn-config" onclick="triggerScan()">${t('scanModelsBtn', data.lang)}</button>
    ${scanInfo}
  </div>
  <div id="scan-replacements">${scanReplacements}</div>
  <div class="section-label">${t('models_primary', data.lang)}</div>`

  for (const [prefix, labelKey, infoKey] of modelTasks) {
    h += modelDropdown(prefix, cv(data, prefix + '_PROVIDER') || 'anthropic', cv(data, prefix + '_MODEL'), models, data.lang, labelKey, infoKey)
  }
  // Downgrade targets (same provider, lesser model — used before cross-API fallback)
  const downgradeTasks: [string, string, string][] = [
    ['LLM_CLASSIFY_DOWNGRADE', 'f_LLM_CLASSIFY', 'i_LLM_DG'],
    ['LLM_RESPOND_DOWNGRADE', 'f_LLM_RESPOND', 'i_LLM_DG'],
    ['LLM_COMPLEX_DOWNGRADE', 'f_LLM_COMPLEX', 'i_LLM_DG'],
    ['LLM_TOOLS_DOWNGRADE', 'f_LLM_TOOLS', 'i_LLM_DG'],
    ['LLM_PROACTIVE_DOWNGRADE', 'f_LLM_PROACTIVE', 'i_LLM_DG'],
  ]

  h += `<div class="section-label with-border">${data.lang === 'es' ? 'Downgrade (mismo provider, modelo menor)' : 'Downgrade (same provider, lesser model)'}</div>`
  for (const [prefix, labelKey] of downgradeTasks) {
    h += modelDropdown(prefix, cv(data, prefix + '_PROVIDER') || '', cv(data, prefix + '_MODEL') || '', models, data.lang, labelKey)
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
      ${boolField('FOLLOWUP_ENABLED', cv(data, 'FOLLOWUP_ENABLED') || 'false', data.lang, 'f_FOLLOWUP_ENABLED', 'i_FOLLOWUP_ENABLED')}
      ${numField('FOLLOWUP_DELAY_MINUTES', cv(data, 'FOLLOWUP_DELAY_MINUTES'), data.lang, 'f_FOLLOWUP_DELAY_MINUTES', 'i_FOLLOWUP_DELAY')}
      ${numField('FOLLOWUP_MAX_ATTEMPTS', cv(data, 'FOLLOWUP_MAX_ATTEMPTS'), data.lang, 'f_FOLLOWUP_MAX_ATTEMPTS', 'i_FOLLOWUP_MAX')}
      ${numField('FOLLOWUP_COLD_AFTER_ATTEMPTS', cv(data, 'FOLLOWUP_COLD_AFTER_ATTEMPTS'), data.lang, 'f_FOLLOWUP_COLD_AFTER_ATTEMPTS', 'i_FOLLOWUP_COLD')}
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
        <button type="button" class="act-btn act-btn-add" onclick="gmailConnect()">
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
  const isEs = data.lang === 'es'

  if (!moduleActive) {
    const msg = isEs
      ? 'El modulo Google Workspace no esta activado. Activalo desde la seccion <a href="/console/modules">Modulos</a> para poder conectar.'
      : 'The Google Workspace module is not active. Activate it from the <a href="/console/modules">Modules</a> section to connect.'
    return `<div class="panel"><div class="panel-body panel-body-flat">
      <div class="panel-info module-inactive-notice">${msg}</div>
    </div></div>`
  }

  // Enabled services from config
  const enabledStr = (data.config['GOOGLE_ENABLED_SERVICES'] || 'drive,sheets,docs,slides,calendar').toLowerCase()
  const enabledSet = new Set(enabledStr.split(',').map(s => s.trim()).filter(Boolean))

  // Status box — channel-style
  const statusColor = ga.connected ? 'var(--success)' : 'var(--on-surface-dim)'
  const statusText = ga.connected ? t('googleAppsConnected', data.lang) : t('googleAppsNotConnected', data.lang)
  const googleSvg = GOOGLE_SVG

  const statusBox = `<div class="panel" style="margin-bottom:20px">
    <div class="panel-body panel-body-flat ts-gws-status-body">
      <div class="ts-gws-status-left">
        <div class="ts-gws-status-icon" style="border:2px solid ${statusColor}">
          ${googleSvg}
        </div>
        <div>
          <div class="ts-gws-status-name">${statusText}</div>
          ${ga.email ? `<div class="ts-gws-status-email">${esc(ga.email)}</div>` : ''}
        </div>
      </div>
      <div class="ts-gws-status-actions">
        <button type="button" class="btn-secondary ts-gws-btn-sm" onclick="refreshGoogleAppsStatus()">${t('googleRefreshStatus', data.lang)}</button>
        ${!ga.connected
          ? `<button type="button" class="act-btn act-btn-add act-btn--sm" onclick="googleAppsConnect()">${t('googleAppsConnectBtn', data.lang)}</button>`
          : `<button type="button" class="btn-danger ts-gws-btn-sm" onclick="googleAppsDisconnect()">${t('googleAppsDisconnectBtn', data.lang)}</button>`
        }
      </div>
    </div>
  </div>`

  // Service cards — 3 per row with toggle + expandable permissions
  const services = [
    { id: 'drive', name: 'Google Drive', icon: '&#128193;',
      perms: ['view', 'share', 'create', 'edit', 'delete'] },
    { id: 'sheets', name: 'Google Sheets', icon: '&#128202;',
      perms: ['view', 'share', 'create', 'edit', 'delete'] },
    { id: 'docs', name: 'Google Docs', icon: '&#128196;',
      perms: ['view', 'share', 'create', 'edit', 'delete'] },
    { id: 'slides', name: 'Google Slides', icon: '&#128253;',
      perms: ['view', 'share', 'create', 'edit', 'delete'] },
    { id: 'calendar', name: 'Google Calendar', icon: '&#128197;',
      perms: ['view', 'create', 'edit', 'delete'] },
    { id: 'gmail', name: 'Gmail', icon: '&#9993;',
      perms: ['view', 'create', 'edit', 'delete'] },
  ]

  const permLabels: Record<string, Record<string, string>> = {
    view:   { es: 'Ver', en: 'View' },
    share:  { es: 'Compartir', en: 'Share' },
    create: { es: 'Crear', en: 'Create' },
    edit:   { es: 'Editar', en: 'Edit' },
    delete: { es: 'Eliminar', en: 'Delete' },
  }

  // Gmail channel auth status for the Gmail service card
  const gmailConnected = data.gmailAuth?.connected ?? false
  const gmailEmail = data.gmailAuth?.email ?? null

  const serviceCards = services.map(svc => {
    const isActive = enabledSet.has(svc.id)
    // Read per-service permissions from config (e.g. GOOGLE_PERMS_DRIVE = "view,share,create,edit")
    const permsKey = `GOOGLE_PERMS_${svc.id.toUpperCase()}`
    const permsStr = data.config[permsKey] || (svc.perms.filter(p => p !== 'delete').join(','))
    const activePerms = new Set(permsStr.split(',').map(p => p.trim()).filter(Boolean))

    const permToggles = svc.perms.map(p => {
      const checked = activePerms.has(p)
      const isDelete = p === 'delete'
      return `<label class="ts-gws-perm-label${isDelete ? ' ts-gws-perm-label-delete' : ''}">
        <input type="checkbox" class="gws-perm ts-gws-perm-checkbox${isDelete ? ' ts-gws-perm-checkbox-delete' : ''}" data-service="${svc.id}" data-perm="${p}" ${checked ? 'checked' : ''} onchange="gwsPermChanged()">
        ${permLabels[p]?.[data.lang] || p}
      </label>`
    }).join('')

    // Gmail service card gets a connection status badge
    let statusBadge = ''
    if (svc.id === 'gmail') {
      const badgeColor = gmailConnected ? 'var(--success)' : 'var(--on-surface-dim)'
      const badgeText = gmailConnected
        ? (isEs ? 'Conectado' : 'Connected') + (gmailEmail ? ` (${esc(gmailEmail)})` : '')
        : (isEs ? 'No conectado' : 'Not connected')
      statusBadge = `<div style="padding:8px 14px;font-size:12px;color:${badgeColor};display:flex;align-items:center;gap:6px">
        <span style="width:8px;height:8px;border-radius:50%;background:${badgeColor};display:inline-block"></span>
        ${badgeText}
      </div>`
    }

    return `<div class="gws-card ts-gws-card${!isActive ? ' ts-gws-card-inactive' : ''}" data-service="${svc.id}">
      <div class="ts-gws-card-header" onclick="gwsToggleCard('${svc.id}')">
        <div class="ts-gws-card-name-wrap">
          <span class="ts-gws-card-icon">${svc.icon}</span>
          <span class="ts-gws-card-name">${svc.name}</span>
        </div>
        <label class="toggle u-flex-shrink-0" onclick="event.stopPropagation()">
          <input type="checkbox" class="gws-toggle" data-service="${svc.id}" ${isActive ? 'checked' : ''} onchange="gwsServiceToggled(this)">
          <span class="toggle-slider"></span>
        </label>
      </div>${statusBadge}
      <div class="gws-card-body ts-gws-card-body" data-card-body="${svc.id}">
        <div class="ts-gws-perms-title">${isEs ? 'Permisos del agente' : 'Agent permissions'}</div>
        <div class="ts-gws-perms-list">
          ${permToggles}
        </div>
      </div>
    </div>`
  }).join('')

  const servicesGrid = `<div class="ts-gws-services-wrap">
    <div class="ts-gws-services-title">${t('googleAppsServicesTitle', data.lang)}</div>
    <div class="ts-gws-services-grid">
      ${serviceCards}
    </div>
  </div>`

  // Script for card interactions
  const script = `<script>
(function(){
  window.gwsToggleCard = function(serviceId) {
    var body = document.querySelector('[data-card-body="' + serviceId + '"]');
    if (!body) return;
    body.style.display = body.style.display === 'none' ? 'block' : 'none';
  };

  window.gwsServiceToggled = function(checkbox) {
    var serviceId = checkbox.dataset.service;
    var card = checkbox.closest('.gws-card');
    if (card) card.style.opacity = checkbox.checked ? '1' : '0.6';
    gwsSaveServices();
  };

  window.gwsPermChanged = function() { gwsSaveServices(); };

  function gwsSaveServices() {
    var toggles = document.querySelectorAll('.gws-toggle');
    var enabled = [];
    toggles.forEach(function(t) { if (t.checked) enabled.push(t.dataset.service); });

    // Build per-service perms
    var permsData = {};
    var services = ['drive','sheets','docs','slides','calendar','gmail'];
    services.forEach(function(svc) {
      var checks = document.querySelectorAll('.gws-perm[data-service="' + svc + '"]');
      var activePerms = [];
      checks.forEach(function(c) { if (c.checked) activePerms.push(c.dataset.perm); });
      permsData['GOOGLE_PERMS_' + svc.toUpperCase()] = activePerms.join(',');
    });

    var body = Object.assign({ GOOGLE_ENABLED_SERVICES: enabled.join(',') }, permsData);
    fetch('/console/save', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    }).then(function() {
      if (window.showToast) window.showToast('${isEs ? 'Guardado' : 'Saved'}', 'success');
    });
  }
})();
</script>`

  return `${statusBox}${servicesGrid}${script}`
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

// ═══════════════════════════════════════════
// Agent Advanced — API Keys + Model Assignment Table
// ═══════════════════════════════════════════

/** Short display name for a model id */
const MODEL_SHORT: Record<string, string> = {
  'claude-haiku-4-5-20251001': 'Haiku 4.5',
  'claude-sonnet-4-5-20250929': 'Sonnet 4.5',
  'claude-sonnet-4-6': 'Sonnet 4.6',
  'claude-opus-4-5-20251101': 'Opus 4.5',
  'claude-opus-4-6': 'Opus 4.6',
  'gemini-2.5-flash': 'Flash 2.5',
  'gemini-2.5-flash-lite': 'Flash-Lite 2.5',
  'gemini-2.5-flash-preview-05-20': 'Flash 2.5 Preview',
  'gemini-2.5-pro': 'Pro 2.5',
  'gemini-2.5-pro-preview-05-06': 'Pro 2.5 Preview',
  'gemini-2.0-flash': 'Flash 2.0',
  'gemini-1.5-pro': 'Pro 1.5',
  'gemini-1.5-flash': 'Flash 1.5',
}

function mShort(id: string): string {
  return MODEL_SHORT[id] ?? id
}

/** Known models as fallback when scanner hasn't run yet */
const DEFAULT_ANTHROPIC_MODELS = [
  'claude-opus-4-5-20251101',
  'claude-sonnet-4-5-20250929',
  'claude-haiku-4-5-20251001',
]
const DEFAULT_GOOGLE_MODELS = [
  'gemini-2.5-pro',
  'gemini-2.5-flash',
  'gemini-2.5-flash-lite',
  'gemini-2.0-flash',
]

/** Resolve current primary provider+model for a task (config override → default) */
function resolveTaskPrimary(config: Record<string, string>, task: string, defProv: string, defModel: string): [string, string] {
  const k = task.toUpperCase()
  return [config[`LLM_${k}_PROVIDER`] || defProv, config[`LLM_${k}_MODEL`] || defModel]
}

/** Resolve current downgrade provider+model for a task */
function resolveTaskDg(config: Record<string, string>, task: string, defProv: string, defModel: string): [string, string] {
  const k = task.toUpperCase()
  return [config[`LLM_${k}_DOWNGRADE_PROVIDER`] || defProv, config[`LLM_${k}_DOWNGRADE_MODEL`] || defModel]
}

/** Build a row in the model assignment table */
function mtRow(
  task: string, label: string,
  primaryProvider: string, primaryModel: string,
  dgProvider: string, dgModel: string,
  fbProvider: string, fbModel: string,
  anthropicModels: string[], googleModels: string[],
): string {
  const taskKey = task.toUpperCase()
  const primaryVal = `${primaryProvider}:${primaryModel}`
  const dgVal = dgModel ? `${dgProvider}:${dgModel}` : ''

  // Primary: combined optgroup select (Anthropic + Google)
  const anthOpts = anthropicModels.map(m =>
    `<option value="anthropic:${esc(m)}" ${`anthropic:${m}` === primaryVal ? 'selected' : ''}>${esc(mShort(m))}</option>`
  ).join('')
  const gooOpts = googleModels.map(m =>
    `<option value="google:${esc(m)}" ${`google:${m}` === primaryVal ? 'selected' : ''}>${esc(mShort(m))}</option>`
  ).join('')

  // Downgrade: filtered to same provider as primary
  const dgModels = primaryProvider === 'google' ? googleModels : anthropicModels
  const dgOpts = ['<option value="">—</option>',
    ...dgModels.map(m => {
      const v = `${primaryProvider}:${m}`
      return `<option value="${esc(v)}" ${v === dgVal ? 'selected' : ''}>${esc(mShort(m))}</option>`
    }),
  ].join('')

  // Fallback pill
  const fbClass = fbProvider === 'google' ? 'mt-fb-google' : 'mt-fb-anthropic'
  const fbLabel = fbProvider === 'google' ? 'G' : 'A'

  return `<div class="mt-row" data-task="${task}">
    <span class="mt-task">${esc(label)}</span>
    <span class="mt-primary">
      <select class="js-custom-select mt-primary-sel" data-task="${task}" data-original="${esc(primaryVal)}">
        <optgroup label="Anthropic">${anthOpts}</optgroup>
        <optgroup label="Google Gemini">${gooOpts}</optgroup>
      </select>
      <input type="hidden" name="LLM_${taskKey}_PROVIDER" value="${esc(primaryProvider)}" data-original="${esc(primaryProvider)}">
      <input type="hidden" name="LLM_${taskKey}_MODEL" value="${esc(primaryModel)}" data-original="${esc(primaryModel)}">
    </span>
    <span class="mt-dg">
      <select class="js-custom-select mt-dg-sel" data-task="${task}" data-original="${esc(dgVal)}">
        ${dgOpts}
      </select>
      <input type="hidden" name="LLM_${taskKey}_DOWNGRADE_PROVIDER" value="${esc(dgProvider)}" data-original="${esc(dgProvider)}">
      <input type="hidden" name="LLM_${taskKey}_DOWNGRADE_MODEL" value="${esc(dgModel)}" data-original="${esc(dgModel)}">
    </span>
    <span class="mt-fb">
      <span class="mt-fb-pill ${fbClass}"><span class="mt-fb-badge">${fbLabel}</span>${esc(mShort(fbModel))}</span>
    </span>
  </div>`
}

/** Model assignment table + scan bar */
function renderModelsTable(data: SectionData, lang: string): string {
  const isEs = lang === 'es'
  const cfg = data.config

  const anthropicModels = data.allModels?.anthropic?.length ? data.allModels.anthropic : DEFAULT_ANTHROPIC_MODELS
  const googleModels = data.allModels?.gemini?.length ? data.allModels.gemini : DEFAULT_GOOGLE_MODELS

  const scanInfo = data.lastScan
    ? `<span class="scan-info">${isEs ? 'Último scan' : 'Last scan'}: ${esc(data.lastScan.lastScanAt)}</span>`
    : `<span class="scan-info">${isEs ? 'Sin escaneo aún' : 'No scan yet'}</span>`

  const scanReplacements = (data.lastScan?.replacements?.length)
    ? `<div id="scan-replacements">` + data.lastScan.replacements.map(r =>
        `<div class="scan-replacement">${esc(r.configKey)}: <s>${esc(r.oldModel)}</s> → <b>${esc(r.newModel)}</b></div>`
      ).join('') + '</div>'
    : '<div id="scan-replacements"></div>'

  // Task definitions: task id, label es, label en, default primary, default downgrade, cross-api fallback
  const TASKS: Array<[string, string, string, string, string, string, string, string, string]> = [
    // [task, labelEs, labelEn, defPrimProv, defPrimModel, defDgProv, defDgModel, fbProv, fbModel]
    ['classify',    'Evaluación de intent',      'Intent evaluation',        'anthropic', 'claude-sonnet-4-5-20250929', '',         '',                          'google',    'gemini-2.5-flash'],
    ['respond',     'Respuesta (Fase 4)',         'Response (Phase 4)',       'google',    'gemini-2.5-flash',           'google',   'gemini-2.5-flash-lite',     'anthropic', 'claude-sonnet-4-5-20250929'],
    ['complex',     'Tarea compleja / subagente', 'Complex / subagent task', 'anthropic', 'claude-opus-4-5-20251101',   'anthropic','claude-sonnet-4-5-20250929','google',    'gemini-2.5-pro'],
    ['tools',       'Ejecución de tools',         'Tool execution',          'anthropic', 'claude-sonnet-4-5-20250929', '',         '',                          'google',    'gemini-2.5-flash'],
    ['proactive',   'Mensaje proactivo',          'Proactive message',       'anthropic', 'claude-sonnet-4-5-20250929', '',         '',                          'google',    'gemini-2.5-flash'],
    ['criticize',   'Criticizer (gate de calidad)','Criticizer (quality gate)','google',  'gemini-2.5-pro',             'google',   'gemini-2.5-flash',          'anthropic', 'claude-sonnet-4-5-20250929'],
    ['document_read','Lectura de documentos',     'Document reading',        'anthropic', 'claude-sonnet-4-5-20250929', '',         '',                          'google',    'gemini-2.5-flash'],
    ['batch',       'Batch nocturno',             'Nightly batch',           'anthropic', 'claude-sonnet-4-5-20250929', '',         '',                          'google',    'gemini-2.5-flash'],
    ['vision',      'Multimedia / Visión',        'Multimedia / Vision',     'google',    'gemini-2.5-flash',           'google',   'gemini-2.5-flash-lite',     'anthropic', 'claude-sonnet-4-5-20250929'],
    ['web_search',  'Búsqueda web',               'Web search',              'google',    'gemini-2.5-flash',           'google',   'gemini-2.5-pro',            'anthropic', 'claude-sonnet-4-5-20250929'],
  ]

  const rows = TASKS.map(([task, lEs, lEn, dPP, dPM, dDP, dDM, fbP, fbM]) => {
    const [pP, pM] = resolveTaskPrimary(cfg, task, dPP, dPM)
    const [dgP, dgM] = resolveTaskDg(cfg, task, dDP, dDM)
    return mtRow(task, isEs ? lEs : lEn, pP, pM, dgP, dgM, fbP, fbM, anthropicModels, googleModels)
  }).join('')

  // Criticizer mode
  const criticModeOptions = [
    { value: 'disabled', label: isEs ? 'Desactivado' : 'Disabled' },
    { value: 'complex_only', label: isEs ? 'Solo planes complejos (≥3 pasos)' : 'Complex plans only (≥3 steps)' },
    { value: 'always', label: isEs ? 'Siempre' : 'Always' },
  ]
  const currentCriticMode = cfg['LLM_CRITICIZER_MODE'] || 'complex_only'
  const criticOpts = criticModeOptions.map(o =>
    `<option value="${o.value}" ${o.value === currentCriticMode ? 'selected' : ''}>${o.label}</option>`
  ).join('')

  return `
  <div class="scan-bar">
    <button type="button" class="act-btn act-btn-config" onclick="triggerScan()">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
      ${isEs ? 'Escanear modelos' : 'Scan models'}
    </button>
    ${scanInfo}
  </div>
  ${scanReplacements}

  <div class="mt-table">
    <div class="mt-head">
      <span class="mt-col-task">${isEs ? 'Tarea' : 'Task'}</span>
      <span class="mt-col-primary">${isEs ? 'Modelo principal' : 'Primary model'}</span>
      <span class="mt-col-dg">${isEs ? 'Downgrade' : 'Downgrade'}</span>
      <span class="mt-col-fb">${isEs ? 'Fallback' : 'Fallback'}</span>
    </div>
    ${rows}
  </div>

  <div class="mt-fixed-rows">
    <div class="mt-fixed-label">${isEs ? 'Modelos fijos (no editables)' : 'Fixed models (not editable)'}</div>
    <div class="mt-fixed-row">
      <span class="mt-fixed-task">TTS</span>
      <span class="mt-fixed-model"><span class="mt-fb-pill mt-fb-google"><span class="mt-fb-badge">G</span>Gemini TTS</span></span>
      <span class="mt-fixed-note">${isEs ? 'Módulo Voz — configurable en canal de voz' : 'Voice module — configurable in voice channel'}</span>
    </div>
    <div class="mt-fixed-row">
      <span class="mt-fixed-task">${isEs ? 'Embeddings' : 'Embeddings'}</span>
      <span class="mt-fixed-model"><span class="mt-fb-pill mt-fb-google"><span class="mt-fb-badge">G</span>Embedding 2</span></span>
      <span class="mt-fixed-note">gemini-embedding-2-preview · ${isEs ? 'Módulo Knowledge' : 'Knowledge module'}</span>
    </div>
  </div>

  <div class="field-divider"><span class="field-divider-label">${isEs ? 'Criticizer' : 'Criticizer'}</span></div>
  <div class="field">
    <div class="field-left">
      <span class="field-label">${isEs ? 'Activación del criticizer' : 'Criticizer activation'}</span>
      <span class="field-info">${isEs
        ? 'Gemini Pro revisa la respuesta antes de enviarla. Si encuentra problemas Flash regenera.'
        : 'Gemini Pro reviews the response before sending. If issues found Flash regenerates.'}</span>
    </div>
    <select class="js-custom-select" name="LLM_CRITICIZER_MODE" data-original="${esc(currentCriticMode)}">${criticOpts}</select>
  </div>

  <script type="application/json" id="models-data">${JSON.stringify(data.allModels ?? {})}</script>`
}

export function renderAdvancedAgentSection(data: SectionData): string {
  const isEs = data.lang === 'es'
  let h = ''

  // Panel 1: API Keys — segment toggle (General | Por función) + 2-column layout
  const currentApiMode = cv(data, 'LLM_API_MODE') || 'basic'
  const isAdvanced = currentApiMode === 'advanced'

  h += `<div class="panel">
    <div class="panel-header" onclick="togglePanel(this)">
      <span class="panel-title">API Keys — LLM</span>
      <span class="panel-chevron">&#9660;</span>
    </div>
    <div class="panel-body">
      <div class="api-mode-row">
        <span class="api-mode-question">${isEs ? '¿Cómo quieres gestionar tus API keys?' : 'How do you want to manage your API keys?'}</span>
        <div class="seg-ctrl">
          <button type="button" class="seg-btn${!isAdvanced ? ' seg-btn--active' : ''}" data-mode="basic" onclick="setApiKeyMode('basic')">${isEs ? 'General' : 'General'}</button>
          <button type="button" class="seg-btn${isAdvanced ? ' seg-btn--active' : ''}" data-mode="advanced" onclick="setApiKeyMode('advanced')">${isEs ? 'Por función' : 'By function'}</button>
        </div>
        <input type="hidden" name="LLM_API_MODE" id="api-mode-input" value="${esc(currentApiMode)}" data-original="${esc(currentApiMode)}">
      </div>

      <div class="api-key-cols">
        <div class="api-key-col">
          <div class="api-key-col-hd api-key-col-hd--anthropic">Anthropic</div>
          ${secretField('ANTHROPIC_API_KEY', cv(data, 'ANTHROPIC_API_KEY'), data.lang,
            isEs ? 'API Key principal' : 'Main API Key',
            isEs ? 'Key principal de Anthropic. Usada para todas las llamadas si no hay key por grupo.' : 'Main Anthropic key. Used for all calls if no per-group key is set.')}
          <div class="adv-group-keys" id="adv-anthropic" style="display:${isAdvanced ? 'block' : 'none'}">
            <div class="api-key-group-divider">${isEs ? 'Por grupo de uso' : 'Per usage group'}</div>
            ${secretField('LLM_ANTHROPIC_ENGINE_API_KEY', cv(data, 'LLM_ANTHROPIC_ENGINE_API_KEY'), data.lang,
              'Engine',
              isEs ? 'classify · tools · complex · proactive — Fallback: key principal' : 'classify · tools · complex · proactive — Fallback: main key')}
            ${secretField('LLM_ANTHROPIC_CORTEX_API_KEY', cv(data, 'LLM_ANTHROPIC_CORTEX_API_KEY'), data.lang,
              'Cortex',
              isEs ? 'Pulse · Trace · Reflex — Fallback: key principal' : 'Pulse · Trace · Reflex — Fallback: main key')}
            ${secretField('LLM_ANTHROPIC_MEMORY_API_KEY', cv(data, 'LLM_ANTHROPIC_MEMORY_API_KEY'), data.lang,
              isEs ? 'Memoria' : 'Memory',
              isEs ? 'compress · batch nocturno — Fallback: key principal' : 'compress · nightly batch — Fallback: main key')}
          </div>
        </div>
        <div class="api-key-col">
          <div class="api-key-col-hd api-key-col-hd--google">Google Gemini</div>
          ${secretField('GOOGLE_AI_API_KEY', cv(data, 'GOOGLE_AI_API_KEY'), data.lang,
            isEs ? 'API Key principal' : 'Main API Key',
            isEs ? 'Key principal de Google AI. Usada para todas las llamadas si no hay key por grupo.' : 'Main Google AI key. Used for all calls if no per-group key is set.')}
          <div class="adv-group-keys" id="adv-google" style="display:${isAdvanced ? 'block' : 'none'}">
            <div class="api-key-group-divider">${isEs ? 'Por grupo de uso' : 'Per usage group'}</div>
            ${secretField('LLM_GOOGLE_ENGINE_API_KEY', cv(data, 'LLM_GOOGLE_ENGINE_API_KEY'), data.lang,
              'Multimedia / Voz',
              isEs ? 'respond · web_search · vision · TTS — Fallback: key principal' : 'respond · web_search · vision · TTS — Fallback: main key')}
            ${secretField('LLM_GOOGLE_MULTIMEDIA_API_KEY', cv(data, 'LLM_GOOGLE_MULTIMEDIA_API_KEY'), data.lang,
              'Multimedia',
              isEs ? 'vision · STT · archivos — Fallback: key principal' : 'vision · STT · files — Fallback: main key')}
            ${secretField('LLM_GOOGLE_VOICE_API_KEY', cv(data, 'LLM_GOOGLE_VOICE_API_KEY'), data.lang,
              isEs ? 'Voz' : 'Voice',
              isEs ? 'TTS · Gemini Live — Fallback: key principal' : 'TTS · Gemini Live — Fallback: main key')}
            ${secretField('LLM_GOOGLE_KNOWLEDGE_API_KEY', cv(data, 'LLM_GOOGLE_KNOWLEDGE_API_KEY'), data.lang,
              'Knowledge',
              isEs ? 'embeddings · knowledge — Fallback: key principal' : 'embeddings · knowledge — Fallback: main key')}
          </div>
        </div>
      </div>
    </div>
  </div>`

  // Panel 2: Models — interactive assignment table
  h += `<div class="panel">
    <div class="panel-header" onclick="togglePanel(this)">
      <span class="panel-title">${isEs ? 'Uso de modelos' : 'Model assignment'}</span>
      <span class="panel-chevron">&#9660;</span>
    </div>
    <div class="panel-body">
      <div class="panel-info">${isEs
        ? 'Asigna qué modelo usa cada tarea del motor. Principal es el modelo activo; Downgrade se activa si el circuit breaker del principal salta; Fallback cambia de proveedor.'
        : 'Assign which model each engine task uses. Primary is the active model; Downgrade activates if the primary circuit breaker trips; Fallback switches provider.'}</div>
      ${renderModelsTable(data, data.lang)}
    </div>
  </div>`

  // Panel 3: Funciones avanzadas
  h += `<div class="panel">
    <div class="panel-header" onclick="togglePanel(this)">
      <span class="panel-title">${isEs ? 'Funciones avanzadas' : 'Advanced features'}</span>
      <span class="panel-chevron">&#9660;</span>
    </div>
    <div class="panel-body">
      <div class="panel-info">${isEs
        ? 'Extraccion de URLs, scoring nocturno de leads, compresion de sesiones y reporte diario.'
        : 'URL extraction, nightly lead scoring, session compression and daily report.'}</div>
      ${boolField('ATTACHMENT_URL_ENABLED', cv(data, 'ATTACHMENT_URL_ENABLED') || 'true', data.lang,
        isEs ? 'Extraer contenido de URLs' : 'Extract URL content',
        isEs ? 'Detectar y extraer contenido de URLs en mensajes' : 'Detect and extract content from URLs in messages')}
      ${boolField('NIGHTLY_SCORING_ENABLED', cv(data, 'NIGHTLY_SCORING_ENABLED') || 'true', data.lang,
        isEs ? 'Scoring de leads frios' : 'Cold lead scoring',
        isEs ? 'Re-evalua leads frios con LLM para decidir si vale la pena reactivarlos' : 'Re-evaluate cold leads with LLM to decide if reactivation is worthwhile')}
      ${numField('NIGHTLY_SCORING_THRESHOLD', cv(data, 'NIGHTLY_SCORING_THRESHOLD'), data.lang,
        isEs ? 'Threshold de reactivacion' : 'Reactivation threshold',
        isEs ? 'Score minimo (0-100) para reactivar un lead frio' : 'Minimum score (0-100) to reactivate a cold lead')}
      ${boolField('NIGHTLY_COMPRESSION_ENABLED', cv(data, 'NIGHTLY_COMPRESSION_ENABLED') || 'true', data.lang,
        isEs ? 'Compresion de sesiones' : 'Session compression',
        isEs ? 'Comprime sesiones con muchos mensajes a un resumen usando LLM' : 'Compress sessions with many messages into a summary using LLM')}
      <div class="field-divider"><span class="field-divider-label">${isEs ? 'Reporte diario' : 'Daily report'}</span></div>
      ${boolField('NIGHTLY_REPORT_ENABLED', cv(data, 'NIGHTLY_REPORT_ENABLED') || 'true', data.lang,
        isEs ? 'Reporte diario' : 'Daily report',
        isEs ? 'Genera metricas del dia y las sincroniza a Google Sheets' : 'Generate daily metrics and sync them to Google Sheets')}
      ${textField('NIGHTLY_REPORT_SHEET_ID', cv(data, 'NIGHTLY_REPORT_SHEET_ID'), data.lang,
        'Spreadsheet ID',
        isEs ? 'ID del spreadsheet de Google donde sincronizar reportes' : 'Google spreadsheet ID for report sync')}
      ${textField('NIGHTLY_REPORT_SHEET_NAME', cv(data, 'NIGHTLY_REPORT_SHEET_NAME'), data.lang,
        isEs ? 'Nombre de hoja' : 'Sheet name',
        isEs ? 'Nombre de la hoja dentro del spreadsheet' : 'Sheet tab name within the spreadsheet')}
    </div>
  </div>`

  // Panel 4: Limites
  h += `<div class="panel">
    <div class="panel-header" onclick="togglePanel(this)">
      <span class="panel-title">${isEs ? 'Limites' : 'Limits'}</span>
      <span class="panel-chevron">&#9660;</span>
    </div>
    <div class="panel-body">
      <div class="panel-info">${isEs
        ? 'Circuit breaker y mantenimiento automatico de conocimiento.'
        : 'Circuit breaker and automatic knowledge maintenance.'}</div>
      ${numField('LLM_CB_FAILURE_THRESHOLD', cv(data, 'LLM_CB_FAILURE_THRESHOLD') || '5', data.lang,
        isEs ? 'Fallos para circuit breaker' : 'Failures for circuit breaker',
        isEs ? 'Cantidad de fallos en la ventana para marcar provider como DOWN (default: 5)' : 'Number of failures in window to mark provider as DOWN (default: 5)')}
      ${numField('KNOWLEDGE_AUTO_DOWNGRADE_DAYS', cv(data, 'KNOWLEDGE_AUTO_DOWNGRADE_DAYS') || '60', data.lang,
        isEs ? 'Auto-downgrade (dias)' : 'Auto-downgrade (days)',
        isEs ? 'Documentos core sin consultas en este periodo pierden el flag core automaticamente (default: 60)' : 'Core docs without hits in this period lose core flag automatically (default: 60)')}
    </div>
  </div>`

  // Panel 5: Motor Agentico (v2)
  const effortDefault = cv(data, 'AGENTIC_EFFORT_DEFAULT') || 'medium'
  const criticizerMode = cv(data, 'LLM_CRITICIZER_MODE') || 'complex_only'

  const effortOpts = [
    { v: 'low', l: isEs ? 'Bajo (rapido)' : 'Low (fast)' },
    { v: 'medium', l: isEs ? 'Medio (balanceado)' : 'Medium (balanced)' },
    { v: 'high', l: isEs ? 'Alto (potente)' : 'High (powerful)' },
  ]
  const criticizerOpts = [
    { v: 'disabled', l: isEs ? 'Desactivado' : 'Disabled' },
    { v: 'complex_only', l: isEs ? 'Solo mensajes complejos (recomendado)' : 'Complex messages only (recommended)' },
    { v: 'always', l: isEs ? 'Siempre' : 'Always' },
  ]

  h += `<div class="panel">
    <div class="panel-header" onclick="togglePanel(this)">
      <span class="panel-title">${isEs ? 'Motor Agentico (v2)' : 'Agentic Engine (v2)'}</span>
      <span class="panel-chevron">&#9660;</span>
    </div>
    <div class="panel-body">
      <div class="panel-info">${isEs
        ? 'Configuracion del loop agentico v2: esfuerzo, protecciones, recuperacion, modelos y cola de ejecucion.'
        : 'Agentic loop v2 configuration: effort, safeguards, recovery, models and execution queue.'}</div>

      <div class="field-divider"><span class="field-divider-label">${isEs ? 'Esfuerzo' : 'Effort'}</span></div>
      <div class="fields-row">
        <div class="field">
          <span class="field-label">${isEs ? 'Nivel de esfuerzo por defecto' : 'Default effort level'}</span>
          <span class="field-info">${isEs ? 'Usado cuando el enrutamiento por esfuerzo esta desactivado o no puede clasificar el mensaje.' : 'Used when effort routing is disabled or cannot classify the message.'}</span>
          <select name="AGENTIC_EFFORT_DEFAULT" data-original="${esc(effortDefault)}" class="js-custom-select">
            ${effortOpts.map(o => `<option value="${esc(o.v)}"${o.v === effortDefault ? ' selected' : ''}>${esc(o.l)}</option>`).join('')}
          </select>
        </div>
      </div>
      ${boolField('ENGINE_EFFORT_ROUTING', cv(data, 'ENGINE_EFFORT_ROUTING') || 'true', data.lang,
        isEs ? 'Enrutamiento por esfuerzo' : 'Effort routing',
        isEs ? 'Clasifica mensajes por complejidad para usar el modelo mas apropiado y optimizar costos.' : 'Classifies messages by complexity to use the most appropriate model and optimize costs.')}

      <div class="field-divider"><span class="field-divider-label">${isEs ? 'Protecciones del Loop' : 'Loop Safeguards'}</span></div>
      ${boolField('ENGINE_TOOL_DEDUP', cv(data, 'ENGINE_TOOL_DEDUP') || 'true', data.lang,
        isEs ? 'Cache de herramientas (dedup)' : 'Tool call deduplication',
        isEs ? 'Evita llamadas duplicadas a la misma herramienta con los mismos parametros en un pipeline.' : 'Prevents duplicate calls to the same tool with the same parameters within a pipeline.')}
      ${boolField('ENGINE_LOOP_DETECTION', cv(data, 'ENGINE_LOOP_DETECTION') || 'true', data.lang,
        isEs ? 'Deteccion de loops' : 'Loop detection',
        isEs ? 'Detecta y previene loops infinitos de herramientas con respuesta graduada: advertencia → bloqueo → corte.' : 'Detects and prevents infinite tool loops with graduated response: warn → block → circuit break.')}
      <div class="fields-row">
        ${numField('AGENTIC_LOOP_WARN_THRESHOLD', cv(data, 'AGENTIC_LOOP_WARN_THRESHOLD') || '3', data.lang,
          isEs ? 'Umbral advertencia' : 'Warn threshold',
          isEs ? 'Llamadas identicas antes de advertir al LLM.' : 'Identical calls before warning the LLM.')}
        ${numField('AGENTIC_LOOP_BLOCK_THRESHOLD', cv(data, 'AGENTIC_LOOP_BLOCK_THRESHOLD') || '5', data.lang,
          isEs ? 'Umbral bloqueo' : 'Block threshold',
          isEs ? 'Llamadas identicas antes de bloquear la herramienta.' : 'Identical calls before blocking the tool.')}
        ${numField('AGENTIC_LOOP_CIRCUIT_THRESHOLD', cv(data, 'AGENTIC_LOOP_CIRCUIT_THRESHOLD') || '8', data.lang,
          isEs ? 'Umbral corte (circuit)' : 'Circuit break threshold',
          isEs ? 'Llamadas identicas antes de forzar respuesta de texto sin herramientas.' : 'Identical calls before forcing text response without tools.')}
      </div>
      ${boolField('ENGINE_ERROR_AS_CONTEXT', cv(data, 'ENGINE_ERROR_AS_CONTEXT') || 'true', data.lang,
        isEs ? 'Errores como contexto' : 'Errors as context',
        isEs ? 'Envia errores de herramientas al LLM para que decida que hacer en vez de fallar silenciosamente.' : 'Feeds tool errors to the LLM so it can decide how to proceed instead of failing silently.')}

      <div class="field-divider"><span class="field-divider-label">${isEs ? 'Recuperacion' : 'Recovery'}</span></div>
      ${boolField('ENGINE_PARTIAL_RECOVERY', cv(data, 'ENGINE_PARTIAL_RECOVERY') || 'true', data.lang,
        isEs ? 'Recuperacion parcial' : 'Partial recovery',
        isEs ? 'Si el loop alcanza el timeout o limite de turnos pero ya genero texto, envia ese texto parcial.' : 'If the loop times out or hits the turn limit but already generated text, send that partial text.')}
      <div class="field">
        <span class="field-label">${isEs ? 'Verificador de calidad' : 'Quality checker'}</span>
        <span class="field-info">${isEs ? 'Controla cuando el verificador revisa la respuesta antes de enviarla.' : 'Controls when the quality checker reviews the response before sending.'}</span>
        <select name="LLM_CRITICIZER_MODE" data-original="${esc(criticizerMode)}" class="js-custom-select">
          ${criticizerOpts.map(o => `<option value="${esc(o.v)}"${o.v === criticizerMode ? ' selected' : ''}>${esc(o.l)}</option>`).join('')}
        </select>
      </div>

      <div class="field-divider"><span class="field-divider-label">${isEs ? 'Modelos por Esfuerzo' : 'Models by Effort'}</span></div>
      ${modelDropdown(
        'LLM_LOW_EFFORT',
        cv(data, 'LLM_LOW_EFFORT_PROVIDER') || 'anthropic',
        cv(data, 'LLM_LOW_EFFORT_MODEL') || 'claude-haiku-4-5-20251001',
        data.allModels ?? {},
        data.lang,
        isEs ? 'Modelo bajo esfuerzo' : 'Low effort model',
        isEs ? 'Modelo para mensajes simples: saludos, confirmaciones, preguntas directas.' : 'Model for simple messages: greetings, confirmations, direct questions.',
      )}
      ${modelDropdown(
        'LLM_MEDIUM_EFFORT',
        cv(data, 'LLM_MEDIUM_EFFORT_PROVIDER') || 'anthropic',
        cv(data, 'LLM_MEDIUM_EFFORT_MODEL') || 'claude-sonnet-4-6',
        data.allModels ?? {},
        data.lang,
        isEs ? 'Modelo medio esfuerzo' : 'Medium effort model',
        isEs ? 'Modelo para mensajes de complejidad media: consultas con contexto, seguimientos.' : 'Model for medium complexity messages: contextual queries, follow-ups.',
      )}
      ${modelDropdown(
        'LLM_HIGH_EFFORT',
        cv(data, 'LLM_HIGH_EFFORT_PROVIDER') || 'anthropic',
        cv(data, 'LLM_HIGH_EFFORT_MODEL') || 'claude-sonnet-4-6',
        data.allModels ?? {},
        data.lang,
        isEs ? 'Modelo alto esfuerzo' : 'High effort model',
        isEs ? 'Modelo para mensajes complejos: multiples herramientas, objeciones, razonamiento profundo.' : 'Model for complex messages: multiple tools, objections, deep reasoning.',
      )}

      <div class="field-divider"><span class="field-divider-label">${isEs ? 'Cola de Ejecucion' : 'Execution Queue'}</span></div>
      <div class="fields-row">
        ${numField('EXECUTION_QUEUE_REACTIVE_CONCURRENCY', cv(data, 'EXECUTION_QUEUE_REACTIVE_CONCURRENCY') || '8', data.lang,
          isEs ? 'Concurrencia reactiva' : 'Reactive concurrency',
          isEs ? 'Mensajes entrantes procesados en paralelo (maxima prioridad).' : 'Incoming messages processed in parallel (highest priority).')}
        ${numField('EXECUTION_QUEUE_PROACTIVE_CONCURRENCY', cv(data, 'EXECUTION_QUEUE_PROACTIVE_CONCURRENCY') || '3', data.lang,
          isEs ? 'Concurrencia proactiva' : 'Proactive concurrency',
          isEs ? 'Follow-ups y recordatorios procesados en paralelo.' : 'Follow-ups and reminders processed in parallel.')}
        ${numField('EXECUTION_QUEUE_BACKGROUND_CONCURRENCY', cv(data, 'EXECUTION_QUEUE_BACKGROUND_CONCURRENCY') || '2', data.lang,
          isEs ? 'Concurrencia background' : 'Background concurrency',
          isEs ? 'Tareas de fondo (nightly, cache) procesadas en paralelo.' : 'Background tasks (nightly, cache) processed in parallel.')}
      </div>
    </div>
  </div>`

  // Panel 6: Proactive Settings (config lives in instance/proactive.json)
  h += `<div class="panel">
    <div class="panel-header" onclick="togglePanel(this)">
      <span class="panel-title">${isEs ? 'Configuracion Proactiva' : 'Proactive Settings'}</span>
      <span class="panel-chevron">&#9660;</span>
    </div>
    <div class="panel-body">
      <div class="panel-info">${isEs
        ? 'Los ajustes proactivos (cooldown adaptativo, recuperacion de huerfanos, guardia de conversacion) se configuran en <code>instance/proactive.json</code>. Edita ese archivo para cambiar umbrales de cooldown, ventanas de follow-up y limites de mensajes por dia.'
        : 'Proactive settings (adaptive cooldown, orphan recovery, conversation guard) are configured in <code>instance/proactive.json</code>. Edit that file to change cooldown thresholds, follow-up windows and daily message limits.'}</div>
      <div class="field">
        <span class="field-label">${isEs ? 'Archivo de configuracion' : 'Config file'}</span>
        <code style="display:block;padding:6px 10px;background:var(--surface-variant);border-radius:6px;font-size:12px">instance/proactive.json</code>
      </div>
      <div class="field" style="margin-top:8px">
        <span class="field-label">${isEs ? 'Claves principales' : 'Main keys'}</span>
        <ul style="font-size:12px;color:var(--on-surface-dim);margin:4px 0;padding-left:18px;line-height:1.8">
          <li><code>cooldown.afterSentMinutes</code> — ${isEs ? 'minutos de espera despues de enviar un mensaje proactivo' : 'minutes to wait after sending a proactive message'}</li>
          <li><code>cooldown.afterNoActionMinutes</code> — ${isEs ? 'cooldown si el contacto no respondio' : 'cooldown if contact did not respond'}</li>
          <li><code>orphan.enabled</code> — ${isEs ? 'detecta mensajes sin respuesta y los reprocesa' : 'detects unanswered messages and reprocesses them'}</li>
          <li><code>conversationGuard.enabled</code> — ${isEs ? 'suprime mensajes si el contacto se despidio' : 'suppresses messages if contact said goodbye'}</li>
        </ul>
      </div>
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
          <select id="metrics-period" class="metrics-period-select js-custom-select">
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
// Knowledge items — custom section
// ═══════════════════════════════════════════

export function renderKnowledgeItemsSection(data: SectionData): string {
  if (data.knowledgeItemsHtml) return data.knowledgeItemsHtml
  return `<div class="panel"><div class="panel-body panel-body-flat panel-body-empty">
    <p>${data.lang === 'es' ? 'Módulo de conocimiento no disponible.' : 'Knowledge module not available.'}</p>
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
  telegram: {
    svg: `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M22 2L11 13"/><path d="M22 2L15 22L11 13L2 9L22 2Z"/></svg>`,
    bg: 'rgba(0, 136, 204, 0.08)',
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
  telegram: {
    es: 'Mensajeria instantanea via Telegram Bot API. Permite al agente interactuar con usuarios y grupos a traves de un bot, con soporte para texto, multimedia y comandos.',
    en: 'Instant messaging via Telegram Bot API. Allows the agent to interact with users and groups through a bot, with support for text, media and commands.',
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
    { id: 'telegram', moduleName: 'telegram', sectionId: 'telegram', defaultType: 'instant' },
  ]

  const googleAppsActive = modules.some(m => m.name === 'google-apps' && m.active)

  for (const ch of channelDefs) {
    // Gmail channel is only shown when google-apps module is active
    if (ch.id === 'gmail' && !googleAppsActive) continue

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

// ─── Channels marked as "coming soon" — toggle disabled, no settings link ───
// To enable a channel when it's ready, remove its ID from this set.
const COMING_SOON_CHANNELS: ReadonlySet<string> = new Set(['google-chat', 'twilio-voice', 'telegram'])
void COMING_SOON_CHANNELS // used on line 985

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
    const comingSoon = COMING_SOON_CHANNELS.has(card.id)
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
    if (!comingSoon && card.active && card.status === 'connected') {
      connectionBtn = `<button class="act-btn act-btn-remove" onclick="channelDisconnect('${esc(card.id)}', '${lang}')">${unplugSvg} ${t('ch_disconnect', lang)}</button>`
    } else if (!comingSoon && card.active && card.status !== 'connected') {
      connectionBtn = `<button class="act-btn act-btn-add" onclick="channelConnect('${esc(card.id)}', '${lang}')">${plugSvg} ${t('ch_connect', lang)}</button>`
    }

    // Footer: coming-soon badge OR config + connect/disconnect when active
    const footerHtml = comingSoon
      ? `<div class="ch-card-footer"><span class="panel-badge badge-soon">${lang === 'es' ? 'Próximamente' : 'Coming soon'}</span></div>`
      : card.active
        ? `<div class="ch-card-footer"><a href="${card.settingsUrl}" class="act-btn act-btn-config" title="${t('ch_settings', lang)}">${GEAR_SVG} ${t('ch_settings', lang)}</a><span class="ch-footer-spacer"></span>${connectionBtn}</div>`
        : ''

    // Toggle: disabled for coming-soon channels
    const toggleHtml = comingSoon
      ? `<label class="toggle toggle-sm"><input type="checkbox" disabled><span class="toggle-slider"></span></label>`
      : `<label class="toggle toggle-sm"><input type="checkbox" ${toggleChecked} data-module="${esc(card.moduleName)}" data-redirect="/console/channels?lang=${lang}" onchange="toggleChannelConfirm(this)"><span class="toggle-slider"></span></label>`

    // Status tooltip text
    const statusLabel = statusLabels[card.status] ?? card.status

    return `
    <div class="ch-card${(card.active && !comingSoon) ? '' : ' ch-card-inactive'}" data-channel-id="${esc(card.id)}" data-status="${comingSoon ? 'inactive' : card.status}" data-filter-status="${comingSoon ? 'inactive' : filterStatus}" data-filter-type="${card.channelType}">
      <div class="ch-card-top">
        <div class="ch-card-icon" title="${comingSoon ? (lang === 'es' ? 'Próximamente' : 'Coming soon') : statusLabel}">
          ${card.icon}
          <span class="ch-icon-tooltip">${comingSoon ? (lang === 'es' ? 'Próximamente' : 'Coming soon') : statusLabel}</span>
        </div>
        <div class="ch-card-title-area">
          <div class="ch-card-name">${esc(card.name)}</div>
          <div class="ch-card-type">${esc(typeLabel)}</div>
        </div>
        ${toggleHtml}
      </div>
      <div class="ch-card-desc">${esc(card.description)}</div>
      <div class="ch-card-error"></div>
      ${(!comingSoon && card.active) ? renderMetricsForType(card.channelType, card.id, lang) : ''}
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

/** Old section IDs that redirect to unified pages (kept empty — all legacy routes removed) */
export const SECTION_REDIRECTS: Record<string, string> = {}

// ═══════════════════════════════════════════
// Tools Cards section — card grid with global params
// ═══════════════════════════════════════════

function renderToolsCardsSection(data: SectionData): string {
  const lang = data.lang
  const isEs = lang === 'es'
  const cfg = data.config

  // Collect tool modules from herramientas group
  // Exclude: core agent modules managed from Agente tab, and TTS (feature, not a tool)
  const TOOLS_PAGE_EXCLUDE = new Set(['tools', 'prompts', 'engine', 'memory', 'knowledge', 'subagents', 'tts'])
  const toolModules = (data.moduleStates ?? [])
    .filter(m => !TOOLS_PAGE_EXCLUDE.has(m.name))
    .filter(m => (m.console as unknown as Record<string, unknown>)?.group === 'agent' || (m.console as unknown as Record<string, unknown>)?.group === 'modules' || m.type === 'feature')
    .sort((a, b) => {
      // Active first, then alphabetical
      if (a.active !== b.active) return a.active ? -1 : 1
      const nameA = a.console?.title?.[lang] || a.name
      const nameB = b.console?.title?.[lang] || b.name
      return nameA.localeCompare(nameB)
    })

  let cardsHtml = '<div class="tool-cards">'
  for (const mod of toolModules) {
    const title = mod.console?.title?.[lang] || mod.console?.title?.['es'] || mod.name
    const desc = mod.console?.info?.[lang] || mod.console?.info?.['es'] || ''
    const icon = ICON_OVERRIDES[mod.name] || (mod.console as unknown as Record<string, unknown>)?.icon as string || '&#9881;'
    const active = mod.active
    const disabledClass = active ? '' : ' disabled'

    cardsHtml += `<div class="tool-card${disabledClass}">
      <div class="tool-card-header">
        <div class="tool-card-icon">${icon}</div>
        <span class="tool-card-title">${esc(title)}</span>
      </div>
      <div class="tool-card-desc">${esc(desc)}</div>
      <div class="tool-card-footer">
        <label class="toggle toggle-sm" onclick="event.stopPropagation()">
          <input type="checkbox" ${active ? 'checked' : ''} onchange="toggleToolModule('${esc(mod.name)}', this.checked)">
          <span class="toggle-slider"></span>
        </label>
        <a class="act-btn act-btn-config" href="/console/herramientas/${esc(mod.name)}?lang=${lang}"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg> ${isEs ? 'Configurar' : 'Configure'}</a>
      </div>
    </div>`
  }
  cardsHtml += '</div>'

  // Global tool params
  const backoff = cfg['TOOLS_RETRY_BACKOFF_S'] || '1'
  const timeout = cfg['TOOLS_EXECUTION_TIMEOUT_S'] || '30'
  const maxPerTurn = cfg['PIPELINE_MAX_TOOL_CALLS_PER_TURN'] || '5'

  const globalParams = `<div class="panel ts-tools-global-panel">
    <div class="panel-body ts-tools-global-body">
      <div class="ts-tools-global-grid">
        <div class="field ts-tools-global-field">
          <span class="field-label">${isEs ? 'Espera entre intentos (s)' : 'Wait between retries (s)'}</span>
          <input type="number" inputmode="numeric" name="TOOLS_RETRY_BACKOFF_S" value="${esc(backoff)}" data-original="${esc(backoff)}" min="1" max="30">
        </div>
        <div class="field ts-tools-global-field">
          <span class="field-label">${isEs ? 'Tiempo max. ejecucion (s)' : 'Max execution time (s)'}</span>
          <input type="number" inputmode="numeric" name="TOOLS_EXECUTION_TIMEOUT_S" value="${esc(timeout)}" data-original="${esc(timeout)}" min="5" max="120">
        </div>
        <div class="field ts-tools-global-field">
          <span class="field-label">${isEs ? 'Max herramientas por turno' : 'Max tools per turn'}</span>
          <input type="number" inputmode="numeric" name="PIPELINE_MAX_TOOL_CALLS_PER_TURN" value="${esc(maxPerTurn)}" data-original="${esc(maxPerTurn)}" min="1" max="20">
        </div>
      </div>
    </div>
  </div>`

  // Two-tier descriptions panel (per individual tool, editable)
  let descPanel = ''
  if (data.toolDescriptions && data.toolDescriptions.length > 0) {
    const rows = data.toolDescriptions.map(td => {
      const shortVal = esc(td.shortDescription)
      const guidanceVal = esc(td.detailedGuidance)
      const toolId = esc(td.name)
      return `<div class="panel-body" style="border-bottom:1px solid var(--surface-variant);padding:10px 16px">
        <div style="display:flex;align-items:baseline;gap:8px;margin-bottom:6px">
          <span style="font-size:12px;font-weight:600;color:var(--on-surface)">${esc(td.name)}</span>
          <span style="font-size:11px;color:var(--on-surface-dim)">${esc(td.sourceModule)}</span>
        </div>
        <div class="field" style="margin-bottom:6px">
          <span class="field-label" style="font-size:11px">${isEs ? 'Descripcion corta (IA)' : 'Short description (AI)'}</span>
          <span class="field-info" style="font-size:11px">${isEs ? '1 linea que el modelo ve al seleccionar herramientas. Vacio = auto-generado.' : '1-line the model sees when selecting tools. Empty = auto-generated.'}</span>
          <input type="text" id="td-short-${toolId}" value="${shortVal}" placeholder="${isEs ? 'Auto-generado de la descripcion...' : 'Auto-generated from description...'}" style="font-size:12px">
        </div>
        <div class="field">
          <span class="field-label" style="font-size:11px">${isEs ? 'Guia detallada' : 'Detailed guidance'}</span>
          <span class="field-info" style="font-size:11px">${isEs ? 'Instrucciones completas inyectadas al invocar la herramienta.' : 'Full instructions injected when the tool is invoked.'}</span>
          <textarea id="td-guidance-${toolId}" rows="2" placeholder="${isEs ? 'Instrucciones especificas...' : 'Specific instructions...'}" style="font-size:12px">${guidanceVal}</textarea>
        </div>
        <button class="act-btn" type="button" onclick="saveToolDescriptions('${toolId}')" style="font-size:11px;padding:3px 10px">${isEs ? 'Guardar' : 'Save'}</button>
      </div>`
    }).join('')

    descPanel = `<div class="panel" style="margin-top:12px">
      <div class="panel-header" onclick="togglePanel(this)">
        <span class="panel-title">${isEs ? 'Descripciones para IA (por herramienta)' : 'AI Descriptions (per tool)'}</span>
        <span class="panel-chevron">&#9660;</span>
      </div>
      <div class="panel-body" style="padding:8px 16px">
        <p class="panel-info">${isEs ? 'Descripcion corta: 1 linea que el LLM ve al decidir que herramienta usar. Guia detallada: instrucciones completas inyectadas al invocarla. Dejar vacios para usar valores por defecto del codigo.' : 'Short description: 1-line the LLM sees when deciding which tool to use. Detailed guidance: full instructions injected on invocation. Leave empty to use code defaults.'}</p>
      </div>
      ${rows}
    </div>`
  }

  return cardsHtml + globalParams + descPanel + `
  <script>
  function toggleToolModule(name, enabled) {
    fetch('/console/modules/toggle', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'module=' + encodeURIComponent(name) + '&action=' + (enabled ? 'activate' : 'deactivate') + '&_redirect=/console/herramientas'
    }).then(function() { location.reload() }).catch(function() { alert('Error') })
  }
  function saveToolDescriptions(toolName) {
    var shortEl = document.getElementById('td-short-' + toolName)
    var guidanceEl = document.getElementById('td-guidance-' + toolName)
    if (!shortEl || !guidanceEl) return
    fetch('/console/api/tools/settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        toolName: toolName,
        shortDescription: shortEl.value || null,
        detailedGuidance: guidanceEl.value || null
      })
    }).then(function(r) {
      if (r.ok) { shortEl.style.borderColor = 'var(--success)'; setTimeout(function(){ shortEl.style.borderColor = ''; }, 1500) }
      else { alert('Error saving') }
    }).catch(function() { alert('Error') })
  }
  </script>`
}

// ═══════════════════════════════════════════
// Identity section — 2-column layout (prompts + identity fields)
// ═══════════════════════════════════════════

function renderIdentitySection(data: SectionData): string {
  const lang = data.lang
  const isEs = lang === 'es'
  const cfg = data.config

  // Prompt fields
  const prompts = [
    {
      key: 'PROMPT_IDENTITY', label: isEs ? 'Identidad' : 'Identity', title: 'IDENTITY PROMPT',
      info: isEs
        ? 'Personalidad, tono y características del agente. Define quién es y cómo se expresa.'
        : 'Agent personality, tone and traits. Defines who it is and how it expresses itself.',
    },
    {
      key: 'PROMPT_JOB', label: isEs ? 'Descripcion del trabajo' : 'Job description', title: 'JOB DESCRIPTION PROMPT',
      info: isEs
        ? 'Misión, objetivos y responsabilidades del agente. Define qué hace y cómo lo hace.'
        : 'Agent mission, objectives and responsibilities. Defines what it does and how.',
    },
    {
      key: 'PROMPT_GUARDRAILS', label: isEs ? 'Reglas' : 'Rules', title: 'RULES PROMPT',
      info: isEs
        ? 'Restricciones que el agente siempre debe respetar, sin excepciones. Límites éticos y operativos.'
        : 'Constraints the agent must always follow, without exception. Ethical and operational limits.',
    },
    {
      key: 'PROMPT_CRITICIZER', label: isEs ? 'Checklist de calidad' : 'Quality checklist', title: 'QUALITY CHECKLIST PROMPT',
      info: isEs
        ? 'Puntos adicionales que el agente revisa antes de enviar cada respuesta. Se suma al checklist base del sistema.'
        : 'Additional points the agent checks before sending each response. Added on top of the system base checklist.',
    },
  ]

  // Language → accent mapping (BCP-47 code → country label)
  // Each language maps to countries where it's an official language
  const ACCENT_MAP: Record<string, Array<{ code: string; country: string }>> = {
    es: [
      { code: 'es-AR', country: 'Argentina' },
      { code: 'es-BO', country: 'Bolivia' },
      { code: 'es-CL', country: 'Chile' },
      { code: 'es-CO', country: 'Colombia' },
      { code: 'es-CR', country: 'Costa Rica' },
      { code: 'es-CU', country: 'Cuba' },
      { code: 'es-DO', country: isEs ? 'Republica Dominicana' : 'Dominican Republic' },
      { code: 'es-EC', country: 'Ecuador' },
      { code: 'es-SV', country: 'El Salvador' },
      { code: 'es-GQ', country: isEs ? 'Guinea Ecuatorial' : 'Equatorial Guinea' },
      { code: 'es-GT', country: 'Guatemala' },
      { code: 'es-HN', country: 'Honduras' },
      { code: 'es-MX', country: isEs ? 'Mexico' : 'Mexico' },
      { code: 'es-NI', country: 'Nicaragua' },
      { code: 'es-PA', country: isEs ? 'Panama' : 'Panama' },
      { code: 'es-PY', country: 'Paraguay' },
      { code: 'es-PE', country: isEs ? 'Peru' : 'Peru' },
      { code: 'es-PR', country: 'Puerto Rico' },
      { code: 'es-ES', country: isEs ? 'Espana' : 'Spain' },
      { code: 'es-UY', country: 'Uruguay' },
      { code: 'es-VE', country: 'Venezuela' },
    ],
    en: [
      { code: 'en-AU', country: 'Australia' },
      { code: 'en-CA', country: isEs ? 'Canada' : 'Canada' },
      { code: 'en-GH', country: 'Ghana' },
      { code: 'en-IN', country: 'India' },
      { code: 'en-IE', country: isEs ? 'Irlanda' : 'Ireland' },
      { code: 'en-JM', country: 'Jamaica' },
      { code: 'en-KE', country: 'Kenya' },
      { code: 'en-NZ', country: isEs ? 'Nueva Zelanda' : 'New Zealand' },
      { code: 'en-NG', country: 'Nigeria' },
      { code: 'en-PH', country: isEs ? 'Filipinas' : 'Philippines' },
      { code: 'en-SG', country: isEs ? 'Singapur' : 'Singapore' },
      { code: 'en-ZA', country: isEs ? 'Sudafrica' : 'South Africa' },
      { code: 'en-GB', country: isEs ? 'Reino Unido' : 'United Kingdom' },
      { code: 'en-US', country: isEs ? 'Estados Unidos' : 'United States' },
    ],
    pt: [
      { code: 'pt-AO', country: 'Angola' },
      { code: 'pt-BR', country: isEs ? 'Brasil' : 'Brazil' },
      { code: 'pt-CV', country: isEs ? 'Cabo Verde' : 'Cape Verde' },
      { code: 'pt-MZ', country: isEs ? 'Mozambique' : 'Mozambique' },
      { code: 'pt-PT', country: 'Portugal' },
    ],
    fr: [
      { code: 'fr-BE', country: isEs ? 'Belgica' : 'Belgium' },
      { code: 'fr-CM', country: isEs ? 'Camerun' : 'Cameroon' },
      { code: 'fr-CA', country: isEs ? 'Canada (Quebec)' : 'Canada (Quebec)' },
      { code: 'fr-CD', country: isEs ? 'Congo (RDC)' : 'Congo (DRC)' },
      { code: 'fr-CI', country: isEs ? 'Costa de Marfil' : 'Ivory Coast' },
      { code: 'fr-FR', country: isEs ? 'Francia' : 'France' },
      { code: 'fr-HT', country: isEs ? 'Haiti' : 'Haiti' },
      { code: 'fr-SN', country: 'Senegal' },
      { code: 'fr-CH', country: isEs ? 'Suiza' : 'Switzerland' },
    ],
    de: [
      { code: 'de-AT', country: 'Austria' },
      { code: 'de-DE', country: isEs ? 'Alemania' : 'Germany' },
      { code: 'de-LI', country: 'Liechtenstein' },
      { code: 'de-LU', country: isEs ? 'Luxemburgo' : 'Luxembourg' },
      { code: 'de-CH', country: isEs ? 'Suiza' : 'Switzerland' },
    ],
    it: [
      { code: 'it-IT', country: isEs ? 'Italia' : 'Italy' },
      { code: 'it-CH', country: isEs ? 'Suiza' : 'Switzerland' },
      { code: 'it-SM', country: 'San Marino' },
    ],
  }

  // Language options
  const langOptions = [
    { value: 'es', label: 'Español' }, { value: 'en', label: 'English' },
    { value: 'pt', label: 'Português' }, { value: 'fr', label: 'Français' },
    { value: 'de', label: 'Deutsch' }, { value: 'it', label: 'Italiano' },
  ]

  // Slot mapping for prompt API
  const SLOT_MAP: Record<string, string> = {
    PROMPT_IDENTITY: 'identity',
    PROMPT_JOB: 'job',
    PROMPT_GUARDRAILS: 'guardrails',
    PROMPT_CRITICIZER: 'criticizer',
  }

  // Build identity column (right) — declared early so persona preview is available in prompts loop
  const agentName = cfg['AGENT_NAME'] || 'Luna'
  const agentLastName = cfg['AGENT_LAST_NAME'] || ''
  const agentTitle = cfg['AGENT_TITLE'] || ''
  const agentLang = cfg['AGENT_LANGUAGE'] || 'es'
  const agentAccent = cfg['AGENT_ACCENT'] || ''
  const agentCountry = cfg['AGENT_COUNTRY'] || ''
  const agentTimezone = cfg['AGENT_TIMEZONE'] || ''
  const companyName = cfg['COMPANY_NAME'] || ''

  // Persona header preview (auto-prepended to identity prompt in Phase 4)
  const personaHeaderParts: string[] = []
  const personaFullName = [agentName, agentLastName].filter(Boolean).join(' ')
  if (personaFullName) personaHeaderParts.push(`Tu nombre es ${personaFullName}.`)
  if (agentTitle) personaHeaderParts.push(`Tu cargo es ${agentTitle}.`)
  if (companyName) personaHeaderParts.push(`Trabajas en ${companyName}.`)
  if (agentLang) personaHeaderParts.push(`Tu idioma principal es ${agentLang}.`)
  if (agentCountry) personaHeaderParts.push(`Operas desde ${agentCountry}.`)
  const personaHeaderText = personaHeaderParts.join(' ')

  // Build prompts column (left)
  let promptsHtml = ''
  let isFirstPrompt = true

  for (const p of prompts) {
    const value = cfg[p.key] || ''
    const slot = SLOT_MAP[p.key] || ''
    const collapsedCls = isFirstPrompt ? '' : 'collapsed'
    isFirstPrompt = false
    promptsHtml += `<div class="panel ${collapsedCls} u-mb-sm" data-slot="${esc(slot)}">
      <div class="panel-header" onclick="togglePanel(this)">
        <span class="panel-title">
          ${esc(p.label)}
          <span class="info-wrap" onclick="event.stopPropagation()">
            <button class="info-btn">i</button>
            <div class="info-tooltip">${esc(p.info)}</div>
          </span>
        </span>
        <button type="button" class="act-btn prompt-edit-btn ts-prompt-edit-btn" onclick="event.stopPropagation();promptEdit(this)">${isEs ? 'Editar' : 'Edit'}</button>
        <span class="panel-chevron">&#9660;</span>
      </div>
      <div class="panel-body" style="padding:0">
        ${p.key === 'PROMPT_IDENTITY' ? `<div class="ts-identity-persona-preview" id="ts-identity-persona-preview"><span class="ts-identity-persona-preview-label">${isEs ? 'Se añade automáticamente al inicio:' : 'Auto-prepended to start:'}</span>${esc(personaHeaderText)}</div>` : ''}
        <div class="code-editor code-editor--flush">
          <div class="code-editor-header">
            <div class="code-editor-header-left">
              <svg class="code-editor-header-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg>
              <span>${esc(p.title)}</span>
            </div>
            <div class="prompt-save-cancel ts-prompt-save-cancel">
              <button type="button" class="act-btn act-btn-cta prompt-save-btn ts-prompt-btn-sm" onclick="promptSave(this)">${isEs ? 'Guardar' : 'Save'}</button>
              <button type="button" class="act-btn prompt-cancel-btn ts-prompt-btn-sm" onclick="promptCancel(this)">${isEs ? 'Cancelar' : 'Cancel'}</button>
            </div>
            <span class="code-editor-pos" data-ce-pos="${esc(p.key)}">LN 1, COL 1</span>
          </div>
          <div class="code-editor-body" style="min-height:420px;max-height:620px">
            <textarea class="code-editor-textarea" name="${esc(p.key)}" data-original="${esc(value)}" data-ce-key="${esc(p.key)}" style="min-height:420px" readonly>${esc(value)}</textarea>
          </div>
        </div>
      </div>
    </div>`
  }

  const langSelectHtml = langOptions.map(o =>
    `<option value="${o.value}" ${o.value === agentLang ? 'selected' : ''}>${esc(o.label)}</option>`
  ).join('')

  // Build country options for current language (derived from ACCENT_MAP)
  const currentCountries = ACCENT_MAP[agentLang] || []
  const noCountryLabel = isEs ? '— Sin especificar —' : '— Not specified —'
  const countryOptionsHtml = `<option value="">${esc(noCountryLabel)}</option>` +
    currentCountries.map(a =>
      `<option value="${esc(a.country)}" ${a.country === agentCountry ? 'selected' : ''}>${esc(a.country)}</option>`
    ).join('')

  // Build accent options for current language
  const currentAccents = ACCENT_MAP[agentLang] || []
  const neutralLabel = isEs ? 'Neutro' : 'Neutral'
  const accentOptionsHtml = `<option value="">${esc(neutralLabel)}</option>` +
    currentAccents.map(a =>
      `<option value="${esc(a.code)}" ${a.code === agentAccent ? 'selected' : ''}>${esc(a.country)} (${esc(a.code)})</option>`
    ).join('')

  const identityHtml = `<div class="panel">
    <div class="panel-header ts-panel-header-static">
      <span class="panel-title">${isEs ? 'Identidad del agente' : 'Agent identity'}</span>
    </div>
    <div class="panel-body">
      <div class="field ts-field-stack">
        <span class="field-label">${isEs ? 'Empresa' : 'Company'} *</span>
        <input type="text" name="COMPANY_NAME" id="ts-id-company" value="${esc(companyName)}" data-original="${esc(companyName)}" required></div>
      <div class="field ts-field-stack">
        <span class="field-label">${isEs ? 'Nombre' : 'First name'} *</span>
        <input type="text" name="AGENT_NAME" id="ts-id-name" value="${esc(agentName)}" data-original="${esc(agentName)}" required></div>
      <div class="field ts-field-stack">
        <span class="field-label">${isEs ? 'Apellido' : 'Last name'}</span>
        <input type="text" name="AGENT_LAST_NAME" id="ts-id-lastname" value="${esc(agentLastName)}" data-original="${esc(agentLastName)}"></div>
      <div class="field ts-field-stack">
        <span class="field-label">${isEs ? 'Cargo' : 'Title'}</span>
        <input type="text" name="AGENT_TITLE" id="ts-id-title" value="${esc(agentTitle)}" data-original="${esc(agentTitle)}"></div>
      <div class="field ts-field-stack">
        <span class="field-label">${isEs ? 'Idioma principal' : 'Main language'} *</span>
        <select name="AGENT_LANGUAGE" data-original="${esc(agentLang)}" id="agent-language-select" class="js-custom-select">${langSelectHtml}</select></div>
      <div class="field ts-field-stack">
        <span class="field-label">${isEs ? 'Pa\u00eds' : 'Country'} * <span class="ts-tz-badge" id="ts-tz-badge">${agentTimezone ? `(${esc(agentTimezone)})` : ''}</span></span>
        <p class="ts-field-hint">${isEs ? 'Usado para calcular la zona horaria del sistema.' : 'Used to calculate the system timezone.'}</p>
        <select name="AGENT_COUNTRY" data-original="${esc(agentCountry)}" id="agent-country-select" class="js-custom-select" required>${countryOptionsHtml}</select>
        <input type="hidden" name="AGENT_TIMEZONE" id="ts-agent-timezone-input" value="${esc(agentTimezone)}" data-original="${esc(agentTimezone)}"></div>
      <div class="field ts-field-stack">
        <span class="field-label">${isEs ? 'Acento' : 'Accent'}</span>
        <p class="ts-field-hint">${isEs
          ? 'La seleccion activa automaticamente el perfil de acento del sistema para ese locale.'
          : 'The selection automatically activates the system accent profile for that locale.'}</p>
        <select name="AGENT_ACCENT" data-original="${esc(agentAccent)}" id="agent-accent-select" class="js-custom-select">${accentOptionsHtml}</select></div>
    </div>
  </div>
  <script type="application/json" id="accent-map-data">${JSON.stringify(ACCENT_MAP)}</script>
  <script>
  (function() {
    var langSel = document.getElementById('agent-language-select');
    var countrySel = document.getElementById('agent-country-select');
    var accentSel = document.getElementById('agent-accent-select');
    var tzInput = document.getElementById('ts-agent-timezone-input');
    var tzBadge = document.getElementById('ts-tz-badge');
    var personaPreview = document.getElementById('ts-identity-persona-preview');
    var accentMap = JSON.parse(document.getElementById('accent-map-data').textContent);
    var isEs = ${isEs ? 'true' : 'false'};
    var accentWarningMsg = ${JSON.stringify(isEs
      ? 'Si configuras un acento, el agente puede tener dificultades al responder en otros idiomas. \u00bfDeseas continuar?'
      : 'Setting an accent may cause issues when responding in other languages. Continue?')};

    // IANA timezone by accent code
    var CODE_TZ = {
      'es-AR':'America/Argentina/Buenos_Aires','es-BO':'America/La_Paz','es-CL':'America/Santiago',
      'es-CO':'America/Bogota','es-CR':'America/Costa_Rica','es-CU':'America/Havana',
      'es-DO':'America/Santo_Domingo','es-EC':'America/Guayaquil','es-SV':'America/El_Salvador',
      'es-GQ':'Africa/Malabo','es-GT':'America/Guatemala','es-HN':'America/Tegucigalpa',
      'es-MX':'America/Mexico_City','es-NI':'America/Managua','es-PA':'America/Panama',
      'es-PY':'America/Asuncion','es-PE':'America/Lima','es-PR':'America/Puerto_Rico',
      'es-ES':'Europe/Madrid','es-UY':'America/Montevideo','es-VE':'America/Caracas',
      'en-AU':'Australia/Sydney','en-CA':'America/Toronto','en-GH':'Africa/Accra',
      'en-IN':'Asia/Kolkata','en-IE':'Europe/Dublin','en-JM':'America/Jamaica',
      'en-KE':'Africa/Nairobi','en-NZ':'Pacific/Auckland','en-NG':'Africa/Lagos',
      'en-PH':'Asia/Manila','en-SG':'Asia/Singapore','en-ZA':'Africa/Johannesburg',
      'en-GB':'Europe/London','en-US':'America/New_York',
      'pt-AO':'Africa/Luanda','pt-BR':'America/Sao_Paulo','pt-CV':'Atlantic/Cape_Verde',
      'pt-MZ':'Africa/Maputo','pt-PT':'Europe/Lisbon',
      'fr-BE':'Europe/Brussels','fr-CM':'Africa/Douala','fr-CA':'America/Toronto',
      'fr-CD':'Africa/Kinshasa','fr-CI':'Africa/Abidjan','fr-FR':'Europe/Paris',
      'fr-HT':'America/Port-au-Prince','fr-SN':'Africa/Dakar','fr-CH':'Europe/Zurich',
      'de-AT':'Europe/Vienna','de-DE':'Europe/Berlin','de-LI':'Europe/Vaduz',
      'de-LU':'Europe/Luxembourg','de-CH':'Europe/Zurich',
      'it-IT':'Europe/Rome','it-CH':'Europe/Zurich','it-SM':'Europe/San_Marino'
    };

    function getTzForCountry(country, lang) {
      var entries = accentMap[lang] || [];
      for (var i = 0; i < entries.length; i++) {
        if (entries[i].country === country) return CODE_TZ[entries[i].code] || '';
      }
      return '';
    }

    function updatePersonaPreview() {
      if (!personaPreview) return;
      var nameEl = document.getElementById('ts-id-name');
      var lastEl = document.getElementById('ts-id-lastname');
      var titleEl = document.getElementById('ts-id-title');
      var compEl = document.getElementById('ts-id-company');
      var name = nameEl ? nameEl.value.trim() : '';
      var last = lastEl ? lastEl.value.trim() : '';
      var title = titleEl ? titleEl.value.trim() : '';
      var company = compEl ? compEl.value.trim() : '';
      var lang = langSel ? langSel.value : '';
      var country = countrySel ? countrySel.value : '';
      var parts = [];
      var full = [name, last].filter(Boolean).join(' ');
      if (full) parts.push('Tu nombre es ' + full + '.');
      if (title) parts.push('Tu cargo es ' + title + '.');
      if (company) parts.push('Trabajas en ' + company + '.');
      if (lang) parts.push('Tu idioma principal es ' + lang + '.');
      if (country) parts.push('Operas desde ' + country + '.');
      var labelEl = personaPreview.querySelector('.ts-identity-persona-preview-label');
      personaPreview.innerHTML = (labelEl ? labelEl.outerHTML : '') +
        (parts.length ? parts.join(' ') : (isEs ? '(sin información de identidad)' : '(no identity info)'));
    }

    if (!langSel || !countrySel || !accentSel) return;

    langSel.addEventListener('change', function() {
      var selectedLang = langSel.value;
      var entries = accentMap[selectedLang] || [];
      var neutralLbl = isEs ? 'Neutro' : 'Neutral';
      var noCountryLbl = isEs ? '\u2014 Sin especificar \u2014' : '\u2014 Not specified \u2014';

      // Update country dropdown
      var ch = '<option value="">' + noCountryLbl + '</option>';
      entries.forEach(function(a) { ch += '<option value="' + a.country + '">' + a.country + '</option>'; });
      countrySel.innerHTML = ch;
      countrySel.value = '';

      // Update accent dropdown
      var ah = '<option value="">' + neutralLbl + '</option>';
      entries.forEach(function(a) { ah += '<option value="' + a.code + '">' + a.country + ' (' + a.code + ')</option>'; });
      accentSel.innerHTML = ah;
      accentSel.value = '';

      // Reset timezone
      if (tzInput) { tzInput.value = ''; tzInput.dispatchEvent(new Event('change', { bubbles: true })); }
      if (tzBadge) tzBadge.textContent = '';
      updatePersonaPreview();
    });

    countrySel.addEventListener('change', function() {
      var tz = getTzForCountry(countrySel.value, langSel.value);
      if (tzInput) { tzInput.value = tz; tzInput.dispatchEvent(new Event('change', { bubbles: true })); }
      if (tzBadge) tzBadge.textContent = tz ? '(' + tz + ')' : '';
      updatePersonaPreview();
    });

    accentSel.addEventListener('change', function() {
      if (accentSel.value && accentSel.value !== accentSel.getAttribute('data-original')) {
        if (!confirm(accentWarningMsg)) {
          accentSel.value = accentSel.getAttribute('data-original') || '';
          return;
        }
      }
    });

    // Persona preview: live update on text field changes
    ['ts-id-name','ts-id-lastname','ts-id-title','ts-id-company'].forEach(function(id) {
      var el = document.getElementById(id);
      if (el) el.addEventListener('input', updatePersonaPreview);
    });
  })();
  </script>`

  // --- Condensed Agent voice panel for column 2 ---
  // TTS uses the general Google AI API key (same as Gemini LLM)
  const ttsHasApiKey = !!(cfg['GOOGLE_AI_API_KEY'])
  const ttsEnabled = (cfg['TTS_ENABLED'] ?? 'true') === 'true'

  let voicePanelHtml = ''
  {
    const ttsAudioFreq = cfg['TTS_AUDIO_TO_AUDIO_FREQ'] || '80'
    const ttsTextFreq = cfg['TTS_TEXT_TO_AUDIO_FREQ'] || '10'
    const ttsMaxDur = cfg['TTS_MAX_DURATION'] || '2'
    const ttsVoice = cfg['TTS_VOICE_NAME'] || 'Kore'
    const ttsVoiceStyles = (cfg['TTS_VOICE_STYLES'] ?? 'false') === 'true'
    const ttsTemperature = cfg['TTS_TEMPERATURE'] || '1.2'
    const ttsSpeakingRate = cfg['TTS_SPEAKING_RATE'] || '1.5'

    const ttsFreqOpts = Array.from({ length: 11 }, (_, i) => i * 10)
    const ttsAudioFreqSel = ttsFreqOpts.map(v =>
      `<option value="${v}" ${String(v) === ttsAudioFreq ? 'selected' : ''}>${v}%</option>`
    ).join('')
    const ttsTextFreqSel = ttsFreqOpts.map(v =>
      `<option value="${v}" ${String(v) === ttsTextFreq ? 'selected' : ''}>${v}%</option>`
    ).join('')

    const ttsDurOpts = [
      { value: '1', label: '~1 min' },
      { value: '2', label: '~2 min' },
      { value: '3', label: '~3 min' },
      { value: '5', label: '~5 min' },
    ]
    const ttsDurSel = ttsDurOpts.map(d =>
      `<option value="${d.value}" ${d.value === ttsMaxDur ? 'selected' : ''}>${d.label}</option>`
    ).join('')

    // Gemini TTS voices (auto-detect language)
    const ttsVoiceList = [
      'Kore','Puck','Charon','Zephyr','Fenrir','Leda','Aoede','Orus',
      'Callirrhoe','Autonoe','Enceladus','Iapetus','Umbriel','Algieba',
      'Despina','Erinome','Algenib','Rasalgethi','Laomedeia','Achernar',
      'Alnilam','Schedar','Gacrux','Pulcherrima','Achird','Zubenelgenubi',
      'Vindemiatrix','Sadachbia','Sadaltager','Sulafat',
    ]
    const ttsHasCustom = !ttsVoiceList.includes(ttsVoice)
    const ttsCustomOpt = ttsHasCustom ? `<option value="${esc(ttsVoice)}" selected>${esc(ttsVoice)} (custom)</option>` : ''
    const ttsVoiceOpts = ttsVoiceList.map(v =>
      `<option value="${esc(v)}" ${v === ttsVoice ? 'selected' : ''}>${esc(v)}</option>`
    ).join('')

    // Dot status indicator
    const dotCls = !ttsEnabled ? '' : ttsHasApiKey ? ' dot-active' : ' dot-error'

    const ttsNoKeyMsg = !ttsHasApiKey
      ? `<div class="panel-info module-inactive-notice" style="margin-bottom:12px">${isEs
          ? 'Se necesita una API Key de Google AI para TTS. Conf\u00edgurala en <a href="/console/llm">LLM \u2192 API Keys</a>.'
          : 'A Google AI API Key is needed for TTS. Configure it in <a href="/console/llm">LLM \u2192 API Keys</a>.'}</div>`
      : ''

    // Local helper for info tooltip (TTS panel only)
    const tip = (key: string, text: string) =>
      `<span class="info-wrap"><button class="info-btn" onclick="event.stopPropagation()">i</button><div class="info-tooltip" id="tts-tip-${key}">${esc(text)}</div></span>`

    // Local helpers for standard field rows
    const selRow = (name: string, label: string, opts: string, orig: string) =>
      `<div class="field"><div class="field-left"><span class="field-label">${label}</span></div>` +
      `<select class="js-custom-select" name="${esc(name)}" data-original="${esc(orig)}">${opts}</select></div>`

    const rangeRow = (name: string, label: string, val: string) =>
      `<div class="field"><div class="field-left"><span class="field-label">${label}</span></div>` +
      `<div class="ts-tts-range-wrap">` +
      `<input type="range" class="range-primary" name="${esc(name)}" min="0" max="2" step="0.1" value="${esc(val)}" data-original="${esc(val)}" oninput="this.nextElementSibling.textContent=parseFloat(this.value).toFixed(1)">` +
      `<span class="ts-tts-range-value">${esc(val)}</span></div></div>`

    voicePanelHtml = `<div class="panel collapsed u-mt-md">
      <div class="panel-header" onclick="togglePanel(this)">
        <span class="panel-title">${isEs ? 'Voz del agente' : 'Agent voice'}<span class="ts-tts-dot${dotCls}"></span></span>
        <span class="panel-chevron">&#9660;</span>
      </div>
      <div class="panel-body">
        ${ttsNoKeyMsg}

        <div class="toggle-field">
          <div>
            <span class="field-label">${isEs ? 'Permitir uso de voz' : 'Allow voice usage'}</span>
            <p class="ts-tts-hint">${isEs ? 'Actívalo también en los ajustes del canal donde quieras enviar audios' : 'Also enable it in the channel settings where you want to send audio'}</p>
          </div>
          <label class="toggle toggle-sm">
            <input type="hidden" name="TTS_ENABLED" value="${ttsEnabled ? 'true' : 'false'}" data-original="${ttsEnabled ? 'true' : 'false'}">
            <input type="checkbox" name="TTS_ENABLED" value="true" data-original="${ttsEnabled ? 'true' : 'false'}" ${ttsEnabled ? 'checked' : ''}
              onchange="this.previousElementSibling.value=this.checked?'true':'false'">
            <span class="toggle-slider"></span>
          </label>
        </div>

        <div class="field-divider"><span class="field-divider-label">${isEs ? 'Ratio de respuesta texto-audio' : 'Text-to-audio response ratio'}</span>${tip('ratio', isEs ? 'Probabilidad de que el agente responda en formato de audio. 0% = nunca, 100% = siempre.' : 'Probability of the agent responding in audio format. 0% = never, 100% = always.')}</div>
        <div class="chs-field-row">
          ${selRow('TTS_AUDIO_TO_AUDIO_FREQ', isEs ? 'Audio \u2192 Audio' : 'Audio \u2192 Audio', ttsAudioFreqSel, ttsAudioFreq)}
          ${selRow('TTS_TEXT_TO_AUDIO_FREQ', isEs ? 'Texto \u2192 Audio' : 'Text \u2192 Audio', ttsTextFreqSel, ttsTextFreq)}
        </div>

        <div class="field-divider"><span class="field-divider-label">${isEs ? 'Naturalidad de voz' : 'Voice naturalness'}</span>${tip('natural', isEs ? 'Controla cómo suena la voz generada: duración máxima por fragmento, variación expresiva y velocidad al hablar.' : 'Controls how the generated voice sounds: max duration per fragment, expressive variation, and speaking speed.')}</div>
        <div class="chs-field-row">
          <div class="toggle-field">
            <span class="field-label">${isEs ? 'Estilos de voz' : 'Voice styles'}</span>
            <label class="toggle toggle-sm">
              <input type="hidden" name="TTS_VOICE_STYLES" value="${ttsVoiceStyles ? 'true' : 'false'}" data-original="${ttsVoiceStyles ? 'true' : 'false'}">
              <input type="checkbox" name="TTS_VOICE_STYLES" value="true" data-original="${ttsVoiceStyles ? 'true' : 'false'}" ${ttsVoiceStyles ? 'checked' : ''}
                onchange="this.previousElementSibling.value=this.checked?'true':'false'">
              <span class="toggle-slider"></span>
            </label>
          </div>
          ${selRow('TTS_MAX_DURATION', isEs ? 'Duración máx.' : 'Max duration', ttsDurSel, ttsMaxDur)}
        </div>
        <div class="chs-field-row">
          ${rangeRow('TTS_TEMPERATURE', isEs ? 'Variación' : 'Variation', ttsTemperature)}
          ${rangeRow('TTS_SPEAKING_RATE', isEs ? 'Velocidad' : 'Speed', ttsSpeakingRate)}
        </div>

        <div style="border-top:1px solid var(--outline-variant);margin:16px 0 12px"></div>

        <div class="chs-field-row" style="align-items:flex-end">
          ${selRow('TTS_VOICE_NAME', isEs ? 'Voz' : 'Voice', `${ttsCustomOpt}${ttsVoiceOpts}`, ttsVoice).replace('name="TTS_VOICE_NAME"', 'name="TTS_VOICE_NAME" id="id-tts-voice-select"')}
          <div class="field" style="justify-content:flex-end">
            <button type="button" id="id-tts-preview-btn" class="act-btn act-btn-add act-btn--compact" onclick="idTtsPreview()"
              ${!ttsHasApiKey ? 'disabled' : ''}>
              &#9654; ${isEs ? 'Previsualizar ajustes' : 'Preview settings'}
            </button>
          </div>
        </div>
        <div style="margin-top:8px">
          <span id="id-tts-preview-status" class="ts-tts-preview-status-compact"></span>
          <audio id="id-tts-preview-audio" style="width:100%;display:none;margin-top:6px" controls></audio>
        </div>
      </div>
    </div>`
  }

  // --- Prompt edit/save/cancel script ---
  const promptEditScript = `<script>
(function(){
  var savingMsg = ${JSON.stringify(isEs ? 'Guardando...' : 'Saving...')};
  var savedMsg = ${JSON.stringify(isEs ? 'Guardado' : 'Saved')};
  var errorMsg = ${JSON.stringify(isEs ? 'Error al guardar' : 'Save error')};

  function getPanel(el) {
    return el.closest('.panel[data-slot]');
  }

  window.promptEdit = function(btn) {
    var panel = getPanel(btn);
    if (!panel) return;
    var ta = panel.querySelector('.code-editor-textarea');
    var sc = panel.querySelector('.prompt-save-cancel');
    ta.removeAttribute('readonly');
    ta.focus();
    btn.style.display = 'none';
    sc.style.display = 'flex';
  };

  window.promptCancel = function(btn) {
    var panel = getPanel(btn);
    if (!panel) return;
    var ta = panel.querySelector('.code-editor-textarea');
    var editBtn = panel.querySelector('.prompt-edit-btn');
    var sc = panel.querySelector('.prompt-save-cancel');
    ta.value = ta.getAttribute('data-original');
    ta.setAttribute('readonly', '');
    sc.style.display = 'none';
    editBtn.style.display = '';
    // Update line numbers
    var key = ta.getAttribute('data-ce-key');
    if (key && typeof window.updateLineNums === 'function') window.updateLineNums(key);
    // Trigger dirty tracking reset
    ta.dispatchEvent(new Event('input', { bubbles: true }));
  };

  window.promptSave = async function(btn) {
    var panel = getPanel(btn);
    if (!panel) return;
    var slot = panel.getAttribute('data-slot');
    var ta = panel.querySelector('.code-editor-textarea');
    var editBtn = panel.querySelector('.prompt-edit-btn');
    var sc = panel.querySelector('.prompt-save-cancel');

    btn.disabled = true;
    btn.textContent = savingMsg;

    try {
      var res = await fetch('/console/api/prompts/slot', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slot: slot, variant: 'default', content: ta.value })
      });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      ta.setAttribute('data-original', ta.value);
      ta.setAttribute('readonly', '');
      sc.style.display = 'none';
      editBtn.style.display = '';
      // Flash success
      if (typeof window.showToast === 'function') window.showToast(savedMsg, 'success');
      // Reset dirty tracking
      ta.dispatchEvent(new Event('input', { bubbles: true }));
    } catch(e) {
      if (typeof window.showToast === 'function') window.showToast(errorMsg + ': ' + e.message, 'error');
    } finally {
      btn.disabled = false;
      btn.textContent = ${JSON.stringify(isEs ? 'Guardar' : 'Save')};
    }
  };
})();
</script>`

  // --- TTS preview script for identity page ---
  const idTtsPreviewScript = ttsHasApiKey ? `<script>
(function(){
  window.idTtsPreview = async function() {
    var btn = document.getElementById('id-tts-preview-btn');
    var status = document.getElementById('id-tts-preview-status');
    var audio = document.getElementById('id-tts-preview-audio');
    var voiceSel = document.getElementById('id-tts-voice-select');
    if (!btn || !voiceSel) return;

    btn.disabled = true;
    status.textContent = ${JSON.stringify(isEs ? 'Generando...' : 'Generating...')};
    audio.style.display = 'none';

    var voiceName = voiceSel.value;

    try {
      var res = await fetch('/console/api/console/tts-preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          voiceName: voiceName,
          text: ${JSON.stringify(isEs
            ? 'Hola, soy tu agente de inteligencia artificial. Asi es como suena mi voz.'
            : 'Hello, I am your AI agent. This is how my voice sounds.')}
        })
      });
      if (!res.ok) throw new Error('API error ' + res.status);
      var blob = await res.blob();
      var url = URL.createObjectURL(blob);
      audio.src = url;
      audio.style.display = 'block';
      audio.play();
      status.textContent = '';
      status.classList.remove('has-error');
    } catch(e) {
      status.textContent = ${JSON.stringify(isEs ? 'Error' : 'Error')} + ': ' + e.message;
      status.classList.add('has-error');
    } finally {
      btn.disabled = false;
    }
  };
})();
</script>` : ''

  // Skills readonly section
  let skillsPanel = ''
  if (data.skills && data.skills.length > 0) {
    const skillRows = data.skills.map(s => {
      const utLabel = s.userTypes === 'all' || !s.userTypes ? (isEs ? 'Todos' : 'All') : s.userTypes
      return `<div style="display:flex;gap:12px;padding:8px 0;border-bottom:1px solid var(--surface-variant)">
        <div style="flex:1">
          <span style="font-size:13px;font-weight:600;color:var(--on-surface)">${esc(s.name)}</span>
          <p style="font-size:12px;color:var(--on-surface-dim);margin:2px 0 0">${esc(s.description)}</p>
        </div>
        <div style="text-align:right;flex-shrink:0">
          <span style="font-size:11px;color:var(--on-surface-dim)">${isEs ? 'Tipos de usuario: ' : 'User types: '}<strong>${esc(utLabel)}</strong></span>
        </div>
      </div>`
    }).join('')
    skillsPanel = `<div class="panel" style="margin-top:12px">
      <div class="panel-header" onclick="togglePanel(this)">
        <span class="panel-title">${isEs ? 'Habilidades del Agente' : 'Agent Skills'}</span>
        <span class="panel-chevron">&#9660;</span>
      </div>
      <div class="panel-body">
        <p class="panel-info">${isEs
          ? 'Las habilidades son protocolos de interaccion especializados. Se gestionan como archivos .md en <code>instance/prompts/system/skills/</code>.'
          : 'Skills are specialized interaction protocols. Managed as .md files in <code>instance/prompts/system/skills/</code>.'}</p>
        ${skillRows}
      </div>
    </div>`
  }

  return `<div class="ts-identity-layout">
    <div>${promptsHtml}</div>
    <div>${identityHtml}${voicePanelHtml}</div>
  </div>
  ${skillsPanel}
  ${promptEditScript}
  ${idTtsPreviewScript}`
}

// ═══════════════════════════════════════════
// Agent voice section — agent voice settings
// ═══════════════════════════════════════════

function renderVoiceTTSSection(data: SectionData): string {
  const isEs = data.lang === 'es'
  const cfg = data.config

  const ttsActive = data.moduleStates?.some(m => m.name === 'tts' && m.active) ?? false

  if (!ttsActive) {
    const msg = isEs
      ? 'La voz del agente no esta activada. Activa "Permitir uso de voz" en la pestaña de Voz del agente.'
      : 'Agent voice is not active. Enable "Allow voice usage" in the Agent voice tab.'
    return `<div class="panel"><div class="panel-body panel-body-flat">
      <div class="panel-info module-inactive-notice">${msg}</div>
    </div></div>`
  }

  const hasApiKey = !!(cfg['GOOGLE_AI_API_KEY'])

  // --- Frequency controls ---
  // Audio-to-audio frequency (default 80%)
  const audioToAudioFreq = cfg['TTS_AUDIO_TO_AUDIO_FREQ'] || '80'
  // Text-to-audio frequency (default 10%)
  const textToAudioFreq = cfg['TTS_TEXT_TO_AUDIO_FREQ'] || '10'

  const freqOptions = Array.from({ length: 11 }, (_, i) => i * 10)
  const audioFreqSelect = freqOptions.map(v =>
    `<option value="${v}" ${String(v) === audioToAudioFreq ? 'selected' : ''}>${v}%</option>`
  ).join('')
  const textFreqSelect = freqOptions.map(v =>
    `<option value="${v}" ${String(v) === textToAudioFreq ? 'selected' : ''}>${v}%</option>`
  ).join('')

  // --- Max duration ---
  const maxDurationVal = cfg['TTS_MAX_DURATION'] || '2'
  const durationOptions = [
    { value: '1', chars: 1400, label: isEs ? 'Alrededor de 1 min' : 'Around 1 min' },
    { value: '2', chars: 2800, label: isEs ? 'Alrededor de 2 min' : 'Around 2 min' },
    { value: '3', chars: 4200, label: isEs ? 'Alrededor de 3 min' : 'Around 3 min' },
    { value: '5', chars: 7000, label: isEs ? 'Alrededor de 5 min' : 'Around 5 min' },
  ]
  const durationSelect = durationOptions.map(d =>
    `<option value="${d.value}" ${d.value === maxDurationVal ? 'selected' : ''}>${d.label}</option>`
  ).join('')

  // --- Voice selection ---
  // Gemini AI Studio TTS voices (auto-detect language)
  const voices = [
    { value: 'Kore', label: 'Kore' },
    { value: 'Puck', label: 'Puck' },
    { value: 'Charon', label: 'Charon' },
    { value: 'Zephyr', label: 'Zephyr' },
    { value: 'Fenrir', label: 'Fenrir' },
    { value: 'Leda', label: 'Leda' },
    { value: 'Aoede', label: 'Aoede' },
    { value: 'Orus', label: 'Orus' },
    { value: 'Callirrhoe', label: 'Callirrhoe' },
    { value: 'Autonoe', label: 'Autonoe' },
    { value: 'Enceladus', label: 'Enceladus' },
    { value: 'Iapetus', label: 'Iapetus' },
    { value: 'Umbriel', label: 'Umbriel' },
    { value: 'Algieba', label: 'Algieba' },
    { value: 'Despina', label: 'Despina' },
    { value: 'Erinome', label: 'Erinome' },
    { value: 'Algenib', label: 'Algenib' },
    { value: 'Rasalgethi', label: 'Rasalgethi' },
    { value: 'Laomedeia', label: 'Laomedeia' },
    { value: 'Achernar', label: 'Achernar' },
    { value: 'Alnilam', label: 'Alnilam' },
    { value: 'Schedar', label: 'Schedar' },
    { value: 'Gacrux', label: 'Gacrux' },
    { value: 'Pulcherrima', label: 'Pulcherrima' },
    { value: 'Achird', label: 'Achird' },
    { value: 'Zubenelgenubi', label: 'Zubenelgenubi' },
    { value: 'Vindemiatrix', label: 'Vindemiatrix' },
    { value: 'Sadachbia', label: 'Sadachbia' },
    { value: 'Sadaltager', label: 'Sadaltager' },
    { value: 'Sulafat', label: 'Sulafat' },
  ]

  const currentVoice = cfg['TTS_VOICE_NAME'] || 'Kore'
  const voiceOptions = voices.map(v =>
    `<option value="${esc(v.value)}" ${v.value === currentVoice ? 'selected' : ''}>${esc(v.label)}</option>`
  ).join('')
  // Allow custom voice via typing
  const hasCustom = !voices.some(v => v.value === currentVoice)
  const customOption = hasCustom ? `<option value="${esc(currentVoice)}" selected>${esc(currentVoice)} (custom)</option>` : ''

  // --- API Key status ---
  const apiKeyStatus = hasApiKey
    ? `<span class="panel-badge badge-active">${isEs ? 'API Key configurada' : 'API Key configured'}</span>`
    : `<span class="panel-badge" class="ts-badge-error">${isEs ? 'API Key no configurada' : 'API Key not configured'}</span>`

  // Column 1: Behavior
  const behaviorCol = `<div>
    <div class="panel">
      <div class="panel-header ts-panel-header-static">
        <span class="panel-title">${isEs ? 'Comportamiento de voz' : 'Voice behavior'}</span>
        ${apiKeyStatus}
      </div>
      <div class="panel-body">
        <div class="ts-tts-field">
          <label class="ts-tts-label">${isEs ? 'Responder audio con audio' : 'Reply audio with audio'}</label>
          <select name="TTS_AUDIO_TO_AUDIO_FREQ" data-original="${esc(audioToAudioFreq)}" class="ts-tts-select js-custom-select">
            ${audioFreqSelect}
          </select>
          <span class="ts-tts-hint">${isEs ? 'Frecuencia con la que el agente responde notas de voz con audio' : 'How often the agent replies to voice notes with audio'}</span>
        </div>

        <div class="ts-tts-field">
          <label class="ts-tts-label">${isEs ? 'Responder texto con audio' : 'Reply text with audio'}</label>
          <select name="TTS_TEXT_TO_AUDIO_FREQ" data-original="${esc(textToAudioFreq)}" class="ts-tts-select js-custom-select">
            ${textFreqSelect}
          </select>
          <span class="ts-tts-hint">${isEs ? 'Frecuencia con la que el agente responde mensajes de texto con audio' : 'How often the agent replies to text messages with audio'}</span>
        </div>

        <div class="ts-tts-field">
          <label class="ts-tts-label">${isEs ? 'Duracion maxima de audios' : 'Max audio duration'}</label>
          <select name="TTS_MAX_DURATION" data-original="${esc(maxDurationVal)}" class="ts-tts-select js-custom-select" id="tts-max-duration">
            ${durationSelect}
          </select>
          <span class="ts-tts-hint">${isEs ? 'El agente ajustara la longitud de sus respuestas para no exceder este limite' : 'The agent will adjust response length to stay within this limit'}</span>
        </div>

        <div class="ts-tts-field">
          <label class="ts-tts-label">${isEs ? 'Canales habilitados' : 'Enabled channels'}</label>
          <input type="text" name="TTS_ENABLED_CHANNELS" value="${esc(cfg['TTS_ENABLED_CHANNELS'] || 'whatsapp')}"
            data-original="${esc(cfg['TTS_ENABLED_CHANNELS'] || 'whatsapp')}"
            class="ts-tts-select js-custom-select" placeholder="whatsapp, google-chat">
          <span class="ts-tts-hint">${isEs ? 'Separados por coma' : 'Comma-separated'}</span>
        </div>
      </div>
    </div>
  </div>`

  // Column 2: Voice config + preview
  const voiceCol = `<div>
    <div class="panel">
      <div class="panel-header ts-panel-header-static">
        <span class="panel-title">${isEs ? 'Configuracion de voz' : 'Voice configuration'}</span>
      </div>
      <div class="panel-body">
        <div class="ts-tts-field">
          <label class="ts-tts-label">${isEs ? 'Voz (Gemini)' : 'Voice (Gemini)'}</label>
          <select name="TTS_VOICE_NAME" data-original="${esc(currentVoice)}" class="ts-tts-select js-custom-select" id="tts-voice-select">
            ${customOption}${voiceOptions}
          </select>
          <span class="ts-tts-hint">${isEs ? 'Gemini detecta el idioma automaticamente' : 'Gemini auto-detects language'}</span>
        </div>

        <!-- Preview button -->
        <div class="ts-tts-preview-area">
          <div class="ts-tts-preview-row">
            <button type="button" id="tts-preview-btn" class="act-btn act-btn-add act-btn--sm" onclick="ttsPreview()"
              ${!hasApiKey ? 'disabled' : ''}>
              &#9654; ${isEs ? 'Previsualizar voz' : 'Preview voice'}
            </button>
            <span id="tts-preview-status" class="ts-tts-preview-status"></span>
          </div>
          <audio id="tts-preview-audio" style="width:100%;display:none" controls></audio>
        </div>
      </div>
    </div>
  </div>`

  // Preview script
  const script = `<script>
(function(){
  window.ttsPreview = async function() {
    var btn = document.getElementById('tts-preview-btn');
    var status = document.getElementById('tts-preview-status');
    var audio = document.getElementById('tts-preview-audio');
    var voiceSel = document.getElementById('tts-voice-select');

    btn.disabled = true;
    status.textContent = '${isEs ? 'Generando...' : 'Generating...'}';
    audio.style.display = 'none';

    var voiceName = voiceSel.value;

    try {
      var res = await fetch('/console/api/console/tts-preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          voiceName: voiceName,
          text: ${JSON.stringify(isEs
            ? 'Hola, soy tu agente de inteligencia artificial. Asi es como suena mi voz con esta configuracion.'
            : 'Hello, I am your AI agent. This is how my voice sounds with this configuration.')}
        })
      });
      if (!res.ok) throw new Error('API error ' + res.status);
      var blob = await res.blob();
      var url = URL.createObjectURL(blob);
      audio.src = url;
      audio.style.display = 'block';
      audio.play();
      status.textContent = '';
      status.classList.remove('has-error');
    } catch(e) {
      status.textContent = '${isEs ? 'Error al generar preview' : 'Preview generation error'}: ' + e.message;
      status.classList.add('has-error');
    } finally {
      btn.disabled = false;
    }
  };
})();
</script>`

  return `<div class="ts-voice-layout">
    ${behaviorCol}
    ${voiceCol}
  </div>
  ${script}`
}

// ═══════════════════════════════════════════
// Dashboard section — SaaS executive overview
// ═══════════════════════════════════════════

function renderDashboardSection(data: SectionData): string {
  const lang = data.lang
  const isEs = lang === 'es'

  // Data from server (with fallbacks for mock display)
  const dashData = data.dashboardData
  const totalContacts = dashData?.totalContacts ?? 0
  const contactsChange = dashData?.contactsChange ?? 0
  const activeSessions = dashData?.activeSessions ?? 0
  const llmCost = dashData?.llmCost ?? 0
  const costChange = dashData?.costChange ?? 0
  const avgRating = 0

  // Channel breakdown data
  const channels = dashData?.channels?.length
    ? dashData.channels
    : [] as Array<{ name: string; contacts: number; sessions: number }>
  const maxChannelTotal = Math.max(...channels.map(c => c.contacts + c.sessions), 1)

  // Contact sources
  const sources = dashData?.sources ?? [
    { name: isEs ? 'Organico' : 'Organic', pct: 40, color: 'var(--primary)' },
    { name: 'Referrals', pct: 25, color: '#FFB800' },
    { name: 'Ads', pct: 20, color: 'var(--info)' },
    { name: 'Social', pct: 15, color: 'var(--surface-container-high)' },
  ]
  const totalSourceContacts = dashData?.totalSourceContacts ?? 0

  // LLM token usage
  const models = dashData?.models ?? [] as Array<{ name: string; desc: string; tokens: string; pct: number }>

  // Quality per channel
  const quality = dashData?.quality ?? [] as Array<{ channel: string; score: number; status: string; stars: number }>

  // Stars helper
  function stars(count: number, max = 5): string {
    let html = ''
    for (let i = 0; i < max; i++) {
      html += `<span class="dash-kpi-star${i < count ? '' : ' empty'}">&#9733;</span>`
    }
    return html
  }

  // Quality status class
  function qualityClass(status: string): string {
    const s = status.toLowerCase()
    if (s.includes('optim') || s.includes('excelen') || s.includes('excellent')) return 'optimal'
    if (s.includes('estab') || s.includes('stable')) return 'stable'
    return 'warning'
  }

  // SVG donut chart
  function renderDonut(): string {
    let cumulative = 0
    const r = 70
    const cx = 90
    const cy = 90
    const circumference = 2 * Math.PI * r
    let segments = ''
    for (const src of sources) {
      const dashLen = (src.pct / 100) * circumference
      const dashOff = circumference - dashLen
      const rotation = (cumulative / 100) * 360 - 90
      segments += `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${src.color}" stroke-width="24"
        stroke-dasharray="${dashLen} ${dashOff}" transform="rotate(${rotation} ${cx} ${cy})" />`
      cumulative += src.pct
    }
    return `<svg viewBox="0 0 180 180" width="180" height="180">
      <circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="var(--surface-container-low)" stroke-width="24"/>
      ${segments}
    </svg>`
  }

  // Format large numbers
  function fmtNum(n: number): string {
    if (n >= 1000) return (n / 1000).toFixed(1) + 'k'
    return String(n)
  }

  const changeBadge = (val: number, label?: string) => {
    if (label) return `<span class="dash-kpi-badge ${label}">${label === 'live' ? 'Live' : label === 'top' ? 'Top Rated' : ''}</span>`
    const cls = val >= 0 ? 'up' : 'down'
    const sign = val >= 0 ? '+' : ''
    return `<span class="dash-kpi-badge ${cls}">${sign}${val}%</span>`
  }

  return `<!-- KPI Cards -->
<div class="dash-kpis">
  <div class="dash-kpi">
    <div class="dash-kpi-icon blue"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/></svg></div>
    <div class="dash-kpi-body">
      <div class="dash-kpi-label">${isEs ? 'Nuevos contactos' : 'New Contacts'}</div>
      <div class="dash-kpi-value">+${totalContacts} ${changeBadge(contactsChange)}</div>
    </div>
  </div>
  <div class="dash-kpi">
    <div class="dash-kpi-icon orange"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg></div>
    <div class="dash-kpi-body">
      <div class="dash-kpi-label">${isEs ? 'Sesiones activas' : 'Active Sessions'}</div>
      <div class="dash-kpi-value">${activeSessions} ${changeBadge(0, 'live')}</div>
    </div>
  </div>
  <div class="dash-kpi">
    <div class="dash-kpi-icon pink"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg></div>
    <div class="dash-kpi-body">
      <div class="dash-kpi-label">${isEs ? 'Costo estimado' : 'Estimated Cost'}</div>
      <div class="dash-kpi-value">$${llmCost.toLocaleString('en-US', { minimumFractionDigits: 2 })} ${changeBadge(costChange)}</div>
    </div>
  </div>
  <div class="dash-kpi">
    <div class="dash-kpi-icon green"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg></div>
    <div class="dash-kpi-body">
      <div class="dash-kpi-label">${isEs ? 'Calificacion promedio' : 'Avg. Quality Rating'}</div>
      <div class="dash-kpi-value">${avgRating} <span class="dash-kpi-stars">${stars(Math.round(avgRating))}</span> ${changeBadge(0, 'top')}</div>
    </div>
  </div>
</div>

<!-- Row 2: Channel Breakdown + Contact Sources -->
<div class="dash-row">
  <div class="dash-card">
    <div class="dash-card-header">
      <span class="dash-card-title">${isEs ? 'Desglose por canal' : 'Channel Breakdown'}</span>
    </div>
    <div class="dash-card-subtitle">${isEs ? 'Contactos vs Sesiones por canal' : 'Contacts vs Sessions per channel'}</div>
    ${channels.map(ch => {
      const contactW = Math.round((ch.contacts / maxChannelTotal) * 100)
      const sessionW = Math.round((ch.sessions / maxChannelTotal) * 100)
      return `<div class="dash-hbar">
        <div class="dash-hbar-label">${esc(ch.name)} <span>${(ch.contacts + ch.sessions).toLocaleString()}</span></div>
        <div class="dash-hbar-track">
          <div class="dash-hbar-fill primary" style="width:${contactW}%"></div>
          <div class="dash-hbar-fill secondary" style="width:${sessionW}%"></div>
        </div>
      </div>`
    }).join('')}
  </div>

  <div class="dash-card">
    <div class="dash-card-header">
      <span class="dash-card-title">${isEs ? 'Fuentes de contacto' : 'Contact Sources'}</span>
    </div>
    <div class="dash-card-subtitle">${isEs ? 'Distribución de trafico' : 'Traffic distribution'}</div>
    <div class="dash-donut-wrap">
      <div class="dash-donut">
        ${renderDonut()}
        <div class="dash-donut-center">
          <div class="dash-donut-total">${fmtNum(totalSourceContacts)}</div>
          <div class="dash-donut-label">TOTAL</div>
        </div>
      </div>
      <div class="dash-donut-legend">
        ${sources.map(s => `<span class="dash-donut-legend-item"><span class="dash-donut-legend-dot" style="background:${s.color}"></span>${esc(s.name)} (${s.pct}%)</span>`).join('')}
      </div>
    </div>
  </div>
</div>

<!-- Row 3: LLM Token Performance + Channel Quality -->
<div class="dash-row">
  <div class="dash-card">
    <div class="dash-card-header">
      <span class="dash-card-title">${isEs ? 'Rendimiento de tokens LLM' : 'LLM Token Performance'}</span>
      <a class="dash-card-link" href="/console/llm?lang=${lang}">${isEs ? 'Ver detalle' : 'Full Report'}</a>
    </div>
    <div class="dash-card-subtitle">${isEs ? 'Eficiencia por modelo' : 'Efficiency per model'}</div>
    ${models.length > 0
      ? models.map(m => `<div class="dash-token-row">
      <div class="dash-token-icon ts-dash-token-icon">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/></svg>
      </div>
      <div class="dash-token-info">
        <div class="dash-token-name">${esc(m.name)}</div>
        <div class="dash-token-desc">${esc(m.desc)}</div>
      </div>
      <div class="dash-token-bar">
        <div class="dash-token-bar-label">${esc(m.tokens)} tokens</div>
        <div class="dash-token-bar-track"><div class="dash-token-bar-fill" style="width:${m.pct}%"></div></div>
      </div>
    </div>`).join('')
      : `<p style="font-size:13px;color:var(--on-surface-dim);margin:12px 0">${isEs ? 'Sin datos aún' : 'No data yet'}</p>`}
  </div>

  <div class="dash-card">
    <div class="dash-card-header">
      <span class="dash-card-title">${isEs ? 'Calidad por canal' : 'Channel Quality Rating'}</span>
    </div>
    <div class="dash-card-subtitle">${isEs ? 'Satisfaccion del cliente por canal' : 'Customer satisfaction per node'}</div>
    <div class="dash-quality-grid">
      ${quality.length > 0
        ? quality.map(q => `<div class="dash-quality-card">
        <div class="dash-quality-channel">${esc(q.channel)}</div>
        <span class="dash-quality-score">${q.score}</span>
        <span class="dash-quality-status ${qualityClass(q.status)}">${esc(q.status)}</span>
        <div class="dash-quality-stars">${stars(q.stars)}</div>
      </div>`).join('')
        : `<p style="font-size:13px;color:var(--on-surface-dim);margin:12px 0">${isEs ? 'Sin datos aún' : 'No data yet'}</p>`}
    </div>
  </div>
</div>`
}

// ═══════════════════════════════════════════
// Database Viewer (debug mode only)
// ═══════════════════════════════════════════
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

function renderMemorySection(data: SectionData): string {
  const lang = data.lang

  function itip(key: string, text: string): string {
    return ` <span class="info-wrap"><button class="info-btn">i</button><div class="info-tooltip" id="info-${key}">${text}</div></span>`
  }

  function numF(key: string, label: string, info: string): string {
    const v = cv(data, key)
    return `<div class="field">
      <div class="field-left"><span class="field-label">${esc(label)}</span>${itip(key, esc(info))}</div>
      <input type="text" inputmode="numeric" name="${key}" value="${esc(v)}" data-original="${esc(v)}">
    </div>`
  }

  // Duration field: unit displayed inside the input (e.g. "24 horas")
  function durF(key: string, label: string, unit: string, info: string): string {
    const v = cv(data, key)
    return `<div class="field">
      <div class="field-left"><span class="field-label">${esc(label)}</span>${itip(key, esc(info))}</div>
      <div class="field-duration">
        <input type="text" inputmode="numeric" name="${key}" value="${esc(v)}" data-original="${esc(v)}">
        <span class="field-duration-unit">${esc(unit)}</span>
      </div>
    </div>`
  }

  function hourSel(key: string, label: string, info: string): string {
    const v = cv(data, key) || '0'
    const opts = Array.from({ length: 24 }, (_, i) => {
      const h = String(i).padStart(2, '0')
      return `<option value="${i}"${String(i) === v ? ' selected' : ''}>${h}:00</option>`
    }).join('')
    return `<div class="field">
      <div class="field-left"><span class="field-label">${esc(label)}</span>${itip(key, esc(info))}</div>
      <select class="js-custom-select" name="${key}" data-original="${esc(v)}">${opts}</select>
    </div>`
  }

  function selF(key: string, label: string, info: string, options: Array<{ value: string; label: string }>): string {
    const v = cv(data, key)
    const opts = options.map(o => `<option value="${esc(o.value)}"${o.value === v ? ' selected' : ''}>${esc(o.label)}</option>`).join('')
    return `<div class="field">
      <div class="field-left"><span class="field-label">${esc(label)}</span>${itip(key, esc(info))}</div>
      <select class="js-custom-select" name="${key}" data-original="${esc(v)}">${opts}</select>
    </div>`
  }

  function smBool(key: string, label: string, info: string): string {
    const checked = cv(data, key) === 'true'
    const orig = cv(data, key) || 'false'
    return `<div class="toggle-field">
      <span class="field-label">${esc(label)}</span>${itip(key, esc(info))}
      <label class="toggle toggle-sm"><input type="checkbox" name="${key}" value="true"${checked ? ' checked' : ''} data-original="${esc(orig)}"><span class="toggle-slider"></span></label>
      <input type="hidden" name="${key}" value="${checked ? 'true' : 'false'}" data-original="${esc(orig)}">
    </div>`
  }

  function row2(a: string, b: string): string {
    return `<div class="chs-field-row">${a}${b}</div>`
  }

  function sdiv(label: string): string {
    return `<div class="field-divider"><span class="field-divider-label">${esc(label)}</span></div>`
  }

  function panel(title: string, body: string, collapsed = false): string {
    return `<div class="panel${collapsed ? ' collapsed' : ''}">
      <div class="panel-header" onclick="togglePanel(this)">
        <span class="panel-title">${esc(title)}</span>
        <span class="panel-chevron">&#9660;</span>
      </div>
      <div class="panel-body">${body}</div>
    </div>`
  }

  const l = (es: string, en: string) => lang === 'es' ? es : en

  const TURNS_INFO = l(
    'Un turno es el intercambio completo entre usuario y agente (un mensaje + su respuesta). Define cuántos turnos recientes se cargan en el contexto activo de la conversación.',
    'A turn is the complete exchange between user and agent (one message + its response). Defines how many recent turns are loaded into the active conversation context.'
  )
  const PAST_INFO = l(
    'Número de conversaciones previas resumidas que se inyectan como contexto. Permite al agente recordar interacciones de sesiones anteriores con este contacto.',
    'Number of previous summarized conversations injected as context. Allows the agent to remember past session interactions with this contact.'
  )

  // ── Panel 1: Memoria de trabajo ──
  const p1 = panel(l('Memoria de trabajo', 'Working memory'), `
    ${sdiv(l('Canales instantáneos', 'Instant channels'))}
    ${row2(
      numF('MEMORY_BUFFER_TURNS_INSTANT', l('Turnos en memoria', 'Turns in memory'), TURNS_INFO),
      numF('MEMORY_CONTEXT_SUMMARIES_INSTANT', l('Conversaciones pasadas en memoria', 'Past conversations in memory'), PAST_INFO)
    )}
    ${sdiv(l('Canales asíncronos', 'Async channels'))}
    ${row2(
      numF('MEMORY_BUFFER_TURNS_ASYNC', l('Turnos en memoria', 'Turns in memory'), TURNS_INFO),
      numF('MEMORY_CONTEXT_SUMMARIES_ASYNC', l('Conversaciones pasadas en memoria', 'Past conversations in memory'), PAST_INFO)
    )}
    ${sdiv(l('Canales de voz', 'Voice channels'))}
    ${row2(
      numF('MEMORY_BUFFER_TURNS_VOICE', l('Turnos en memoria', 'Turns in memory'), TURNS_INFO),
      numF('MEMORY_CONTEXT_SUMMARIES_VOICE', l('Conversaciones pasadas en memoria', 'Past conversations in memory'), PAST_INFO)
    )}
    ${sdiv(l('Compresión de memoria', 'Memory compression'))}
    ${row2(
      numF('MEMORY_COMPRESSION_THRESHOLD', l('Umbral de compresión', 'Compression threshold'), l('Cantidad mínima de mensajes en una sesión para activar compresión automática', 'Minimum messages in a session to trigger automatic compression')),
      numF('MEMORY_COMPRESSION_KEEP_RECENT', l('Mensajes recientes a conservar', 'Recent messages to keep'), l('Mensajes que se mantienen sin comprimir para contexto inmediato al comprimir una sesión', 'Messages kept uncompressed for immediate context when a session is compressed'))
    )}
  `)

  // ── Panel 2: Memoria de mediano plazo (collapsed) ──
  const p2 = panel(l('Memoria de mediano plazo', 'Mid-term memory'), `
    ${durF('MEMORY_SUMMARY_RETENTION_DAYS', l('Resúmenes de interacciones', 'Interaction summaries'), l('días', 'days'), l('Días antes de eliminar resúmenes de sesión. Máximo 730 días (2 años).', 'Days before deleting session summaries. Maximum 730 days (2 years).'))}
    ${durF('MEMORY_PIPELINE_LOGS_RETENTION_DAYS', l('Registros del sistema', 'System logs'), l('días', 'days'), l('Días antes de eliminar registros de procesamiento interno del pipeline', 'Days before deleting internal pipeline processing logs'))}
    ${durF('MEMORY_MEDIA_RETENTION_MONTHS', l('Almacenamiento de media', 'Media storage'), l('meses', 'months'), l('Meses de retención de imágenes y archivos en disco. Máximo 24 meses.', 'Months to retain images and media files on disk. Maximum 24 months.'))}
  `, true)

  // ── Panel 3: Avanzado (collapsed) — grid uniforme 3-col ──
  const archiveOpts = [
    { value: '0', label: l('Desactivado', 'Disabled') },
    { value: '1', label: l('1 año', '1 year') },
    { value: '2', label: l('2 años', '2 years') },
    { value: '5', label: l('5 años', '5 years') },
    { value: '10', label: l('10 años', '10 years') },
    { value: '999', label: l('Vitalicio', 'Lifetime') },
  ]

  const p3 = panel(l('Avanzado', 'Advanced'), `
    <div class="chs-field-row chs-field-row-3">
      ${selF('MEMORY_ARCHIVE_RETENTION_YEARS', l('Duración del backup legal', 'Legal backup duration'), l('Retención de conversaciones completas para cumplimiento legal. "Desactivado" no guarda backups.', 'Retention of full conversations for legal compliance. "Disabled" skips backups.'), archiveOpts)}
      ${hourSel('MEMORY_BATCH_COMPRESS_HOUR', l('Compresión nocturna', 'Nightly compression'), l('Hora UTC para comprimir sesiones inactivas. Los embeddings se generan automáticamente 30 minutos después.', 'UTC hour to compress inactive sessions. Embeddings are generated automatically 30 minutes later.'))}
      ${hourSel('MEMORY_BATCH_PURGE_HOUR', l('Purga de datos', 'Data purge'), l('Hora UTC para purgar media expirada, logs del pipeline y archivos legales expirados según sus ventanas de retención.', 'UTC hour to purge expired media, pipeline logs and legal archives according to their retention windows.'))}
      ${durF('MEMORY_SESSION_REOPEN_WINDOW_HOURS', l('Ventana de reapertura', 'Session reopen window'), l('horas', 'hours'), l('Horas en que un nuevo mensaje reactiva la sesión anterior en vez de abrir una nueva. Máximo 12h.', 'Hours a new message reactivates the previous session instead of opening a new one. Max 12h.'))}
      ${smBool('LLM_PROMPT_CACHE_ENABLED', l('Cache de prompts', 'Prompt cache'), l('Cachea el system prompt y el historial para reducir costos en conversaciones largas', 'Caches the system prompt and history to reduce costs in long conversations'))}
    </div>
  `, true)

  return p1 + p2 + p3
}

export function renderSection(section: string, data: SectionData): string | null {
  switch (section) {
    case 'dashboard': return renderDashboardSection(data)
    case 'channels': return renderChannelsSection(data)
    case 'whatsapp': return renderWhatsappSection(data)
    // Unified LLM page (replaces apikeys, models, llm-limits, llm-cb)
    case 'llm': return renderLlmUnifiedSection(data)
    // Unified Pipeline page (replaces pipeline, followup, naturalidad)
    case 'pipeline': return renderPipelineUnifiedSection(data)
    case 'engine-metrics': return renderEngineMetricsSection(data)
    case 'lead-scoring': return renderLeadScoringSection(data)
    case 'scheduled-tasks': return renderScheduledTasksSection(data)
    case 'memory': return renderMemorySection(data)
    case 'knowledge': return renderKnowledgeItemsSection(data)
    case 'contacts': return renderUsersSection(data)
    case 'agente': return data.agenteContent || `<div class="panel"><div class="panel-body"><p>Select a tab.</p></div></div>`
    case 'identity': return renderIdentitySection(data)
    case 'voice-tts': return renderVoiceTTSSection(data)
    case 'tools-cards': return renderToolsCardsSection(data)
    case 'herramientas': return data.herramientasContent || `<div class="panel"><div class="panel-body"><p>Select a tab.</p></div></div>`
    case 'modules': return renderModulesSection(data)
    case 'infra': return renderInfraUnifiedSection(data)
    case 'google-apps': return renderGoogleAppsSection(data)
    case 'email': return renderEmailSection(data)
    case 'debug-database': return renderDatabaseViewer(data)
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

// SVG icons for action buttons
const SVG_PLUS = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14"/><path d="M5 12h14"/></svg>'
const SVG_EDIT = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>'
const SVG_DEACTIVATE = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 12H5"/><path d="M12 19l-7-7 7-7"/></svg>'
const SVG_DELETE = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>'
const SVG_EYE_SMALL = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>'

function renderUsersSection(data: SectionData): string {
  const lang = data.lang
  const ud = data.usersData
  if (!ud) return `<div class="panel"><div class="panel-body">${lang === 'es' ? 'Módulo de usuarios no disponible.' : 'Users module not available.'}</div></div>`

  const { configs, usersByType, counts, channels } = ud

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
    const lt = cfg.listType

    // Single panel for this list type
    html += `<div class="panel"><div class="panel-body">`

    // (selection bar moved to footer row with add button)

    if (users.length > 0) {
      const isCoworker = lt === 'coworker'
      const isLead = lt === 'lead'

      if (isLead) {
        html += `<style>
.lead-detail-row td { padding: 0 !important; border-top: none !important; }
.lead-detail-container { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; padding: 16px 20px; background: var(--surface-container-lowest); border-top: 1px solid var(--outline-variant); }
.lead-detail-col { min-width: 0; }
.lead-detail-title { font-size: 12px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px; color: var(--on-surface-variant); margin-bottom: 8px; }
.lead-detail-content { font-size: 13px; }
.ts-score-badge { display: inline-block; padding: 2px 8px; border-radius: var(--radius-pill); font-size: 11px; font-weight: 600; background: var(--surface-container-high); }
.ts-time-ago { font-size: 12px; color: var(--on-surface-variant); }
.ts-commit-item { padding: 6px 0; border-bottom: 1px solid var(--outline-variant); }
.ts-commit-item:last-child { border-bottom: none; }
.ts-criteria-item { display: flex; justify-content: space-between; padding: 4px 0; border-bottom: 1px solid var(--outline-variant); }
.ts-criteria-item:last-child { border-bottom: none; }
.ts-criteria-key { font-weight: 500; text-transform: capitalize; }
.ts-criteria-val { color: var(--on-surface-variant); }
</style>`
      }

      html += `<div class="users-table-scroll"><table class="users-table" id="tbl-${esc(lt)}"><thead><tr class="users-table-head">
        <th><input type="checkbox" class="user-cb" id="cb-all-${esc(lt)}" title="${lang === 'es' ? 'Seleccionar todos' : 'Select all'}" onclick="userToggleAll('${esc(lt)}')"></th>
        <th>ID</th>
        <th>${lang === 'es' ? 'Nombre' : 'Name'}</th>
        ${isCoworker ? `<th>${lang === 'es' ? 'Rol' : 'Role'}</th>` : ''}
        <th>${lang === 'es' ? 'Datos de contacto' : 'Contact info'}</th>
        <th>${lang === 'es' ? 'Fuente' : 'Source'}</th>
        <th>${lang === 'es' ? 'Estado' : 'Status'}</th>
        ${isLead ? `<th>${lang === 'es' ? 'Campaña' : 'Campaign'}</th>` : ''}
        ${isLead ? `<th>${lang === 'es' ? 'Interacciones' : 'Interactions'}</th>` : ''}
        ${isLead ? `<th>${lang === 'es' ? 'Calificación' : 'Score'}</th>` : ''}
        ${isLead ? `<th>${lang === 'es' ? 'Compromisos' : 'Commitments'}</th>` : ''}
        ${isLead ? `<th>${lang === 'es' ? 'Último recibido' : 'Last received'}</th>` : ''}
        ${isLead ? `<th>${lang === 'es' ? 'Último enviado' : 'Last sent'}</th>` : ''}
        ${isLead ? `<th></th>` : ''}
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

        // Lead-specific metadata
        const meta = (user.metadata ?? {}) as Record<string, unknown>
        const campaign = (meta.campaign as string) ?? (meta.source_campaign as string) ?? ''
        const interactions = (meta.messageCount as number) ?? (meta.interactions as number) ?? 0
        const qScore = (meta.qualificationScore as number) ?? 0
        const pendingCommits = (meta.pendingCommitments as number) ?? 0
        const lastInbound = (meta.lastInbound as string) ?? ''
        const lastOutbound = (meta.lastOutbound as string) ?? ''

        html += `<tr data-user-id="${esc(user.id)}" data-user-name="${esc(user.displayName || '')}" data-user-active="${user.isActive}" data-contacts="${esc(contactsJson)}" data-channels="${esc(channelList)}" data-source="${esc(user.source)}" data-role="${esc(userRole)}" data-search="${esc((user.displayName || '') + ' ' + senderIds)}">`

        const isSuperAdmin = user.source === 'setup_wizard'
        const superBadge = isSuperAdmin ? ` <span class="panel-badge badge-active" style="font-size:9px;padding:1px 6px">${lang === 'es' ? 'Super Admin' : 'Super Admin'}</span>` : ''
        html += `<td>${isSuperAdmin ? '<input type="checkbox" disabled title="Super admin">' : `<input type="checkbox" class="user-cb" data-list="${esc(lt)}" value="${esc(user.id)}" onclick="event.stopPropagation();userSelChanged('${esc(lt)}')">`}</td>
          <td><code>${esc(user.id)}</code></td>
          <td>${esc(user.displayName || '—')}${superBadge}</td>
          ${isCoworker ? `<td>${userRole ? `<span class="user-source-badge">${esc(userRole)}</span>` : '—'}</td>` : ''}
          <td>${contactBadges}</td>
          <td><span class="user-source-badge">${esc(user.source)}</span></td>
          <td>${statusHtml}</td>
          ${isLead ? `<td>${campaign ? `<span class="user-source-badge">${esc(campaign)}</span>` : '—'}</td>` : ''}
          ${isLead ? `<td>${interactions}</td>` : ''}
          ${isLead ? `<td>${qScore > 0 ? `<span class="ts-score-badge" style="--score:${qScore}">${qScore}</span>` : '—'}</td>` : ''}
          ${isLead ? `<td>${pendingCommits > 0 ? pendingCommits : '—'}</td>` : ''}
          ${isLead ? `<td>${lastInbound ? `<span class="ts-time-ago" data-ts="${esc(lastInbound)}">${esc(lastInbound)}</span>` : '—'}</td>` : ''}
          ${isLead ? `<td>${lastOutbound ? `<span class="ts-time-ago" data-ts="${esc(lastOutbound)}">${esc(lastOutbound)}</span>` : '—'}</td>` : ''}
          ${isLead ? `<td><button type="button" class="act-btn act-btn-config act-btn--compact" onclick="toggleLeadDetail(this, '${esc(user.id)}')">${SVG_EYE_SMALL} ${lang === 'es' ? 'Ver' : 'View'}</button></td>` : ''}
        </tr>`

        if (isLead) {
          const detailColspan = isCoworker ? 8 : 7 + 7
          html += `<tr class="lead-detail-row" id="lead-detail-${esc(user.id)}" style="display:none">
  <td colspan="${detailColspan}">
    <div class="lead-detail-container">
      <div class="lead-detail-col">
        <div class="lead-detail-title">${lang === 'es' ? 'Compromisos pendientes' : 'Pending commitments'}</div>
        <div class="lead-detail-content" id="lead-commits-${esc(user.id)}">
          <span class="ts-config-muted">${lang === 'es' ? 'Cargando...' : 'Loading...'}</span>
        </div>
      </div>
      <div class="lead-detail-col">
        <div class="lead-detail-title">${lang === 'es' ? 'Criterios de calificación' : 'Qualification criteria'}</div>
        <div class="lead-detail-content" id="lead-criteria-${esc(user.id)}">
          <span class="ts-config-muted">${lang === 'es' ? 'Cargando...' : 'Loading...'}</span>
        </div>
      </div>
    </div>
  </td>
</tr>`
        }

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
          <div class="ts-import-modes-grid">
            <button type="button" class="import-mode-card" onclick="showImportStep('manual')">
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><line x1="19" y1="8" x2="19" y2="14"/><line x1="16" y1="11" x2="22" y2="11"/></svg>
              <span>${lang === 'es' ? 'Agregar manual' : 'Add manually'}</span>
            </button>
            <button type="button" class="import-mode-card" onclick="showImportStep('file')">
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>
              <span>${lang === 'es' ? 'Importar CSV' : 'Import CSV'}</span>
            </button>
            <button type="button" class="import-mode-card" onclick="showImportStep('drive')">
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="3" y1="9" x2="21" y2="9"/><line x1="3" y1="15" x2="21" y2="15"/><line x1="9" y1="3" x2="9" y2="21"/></svg>
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

  html += `<div class="wizard-actions">
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
          <div class="ts-import-dropzone-title">${lang === 'es' ? 'Arrastra un archivo CSV o haz clic para seleccionar' : 'Drag a CSV file or click to select'}</div>
          <div class="ts-import-hint">${lang === 'es' ? 'Columnas requeridas: sender_id, channel. Opcionales: display_name, [metadata]' : 'Required columns: sender_id, channel. Optional: display_name, [metadata]'}</div>
          <input type="file" id="csv-file-input" accept=".csv" style="display:none" onchange="handleCsvFile(this.files[0])">
        </div>
        <div id="csv-preview" style="display:none;margin-top:12px">
          <div class="ts-import-preview-label" id="csv-preview-label"></div>
          <div style="overflow-x:auto;max-height:200px"><table class="users-table" id="csv-preview-table"></table></div>
        </div>
        <div id="csv-result" class="ts-import-result"></div>
        <div class="wizard-actions">
          <button type="button" class="act-btn act-btn-config" onclick="showImportStep('select')">${lang === 'es' ? 'Atras' : 'Back'}</button>
          <button type="button" class="act-btn act-btn-cta" id="csv-import-btn" style="display:none" onclick="submitCsvImport()">${lang === 'es' ? 'Importar' : 'Import'}</button>
        </div>
      </div>

      <!-- Step 1c: Google Drive import -->
      <div id="import-step-drive" style="display:none">
        <label class="wizard-label">Google Sheets URL</label>
        <input type="text" class="wizard-input" id="drive-sheet-url" placeholder="https://docs.google.com/spreadsheets/d/...">
        <div class="ts-import-hint" style="margin-bottom:12px" id="drive-hint">${lang === 'es' ? 'Pega la URL de una Google Sheet. Debe estar compartida publicamente o con enlace.' : 'Paste a Google Sheet URL. Must be shared publicly or via link.'}</div>
        <button type="button" class="act-btn act-btn-config" onclick="previewDriveSheet()" id="drive-preview-btn">${lang === 'es' ? 'Previsualizar' : 'Preview'}</button>
        <div id="drive-preview" style="display:none;margin-top:12px">
          <div class="ts-import-preview-label" id="drive-preview-label"></div>
          <div style="overflow-x:auto;max-height:200px"><table class="users-table" id="drive-preview-table"></table></div>
        </div>
        <div id="drive-result" class="ts-import-result"></div>
        <div class="wizard-actions">
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
          res.innerHTML='<div class="ts-import-success">'+(lang==='es'?'Importacion completada':'Import completed')+'</div><div class="ts-import-detail">'+(lang==='es'?'Creados':'Created')+': '+r.created+' / '+r.total+errTxt+'</div>';
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
          res.innerHTML='<div class="ts-import-success">'+(lang==='es'?'Importacion completada':'Import completed')+'</div><div class="ts-import-detail">'+(lang==='es'?'Creados':'Created')+': '+r.created+' / '+r.total+errTxt+'</div>';
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
        f.innerHTML='<input name="_section" value="users"><input name="_lang" value="'+lang+'"><input name="userId" value="'+cb.value+'"><input name="_redirect" value="'+location.pathname+location.search+'">';
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

    // ── Toggle lead detail row ──
    window.toggleLeadDetail=function(btn,userId){
      var row=document.getElementById('lead-detail-'+userId);
      if(!row)return;
      var isOpen=row.style.display!=='none';
      row.style.display=isOpen?'none':'';
      if(!isOpen&&!row.getAttribute('data-loaded')){
        row.setAttribute('data-loaded','1');
        fetch('/console/api/users/lead-detail?userId='+encodeURIComponent(userId))
          .then(function(r){return r.json()})
          .then(function(d){
            var commitsEl=document.getElementById('lead-commits-'+userId);
            var criteriaEl=document.getElementById('lead-criteria-'+userId);
            if(commitsEl){
              if(d.commitments&&d.commitments.length>0){
                commitsEl.innerHTML=d.commitments.map(function(c){
                  return '<div class="ts-commit-item"><strong>'+(c.description||c.type||'—')+'</strong>'+
                    (c.dueDate?'<br><span class="ts-time-ago">'+c.dueDate+'</span>':'')+
                    (c.status?' <span class="user-source-badge">'+c.status+'</span>':'')+'</div>';
                }).join('');
              }else{
                commitsEl.innerHTML='<span class="ts-config-muted">'+(lang==='es'?'Sin compromisos pendientes':'No pending commitments')+'</span>';
              }
            }
            if(criteriaEl){
              if(d.criteria&&Object.keys(d.criteria).length>0){
                var items='';
                for(var key in d.criteria){
                  if(d.criteria.hasOwnProperty(key)){
                    var val=d.criteria[key];
                    items+='<div class="ts-criteria-item"><span class="ts-criteria-key">'+key+'</span><span class="ts-criteria-val">'+(val!=null?val:'—')+'</span></div>';
                  }
                }
                criteriaEl.innerHTML=items;
              }else{
                criteriaEl.innerHTML='<span class="ts-config-muted">'+(lang==='es'?'Sin datos de calificación':'No qualification data')+'</span>';
              }
            }
          })
          .catch(function(){
            var commitsEl=document.getElementById('lead-commits-'+userId);
            if(commitsEl)commitsEl.innerHTML='<span style="color:var(--error)">Error</span>';
          });
      }
    };

    // ── Format timestamps as relative time ──
    document.querySelectorAll('.ts-time-ago[data-ts]').forEach(function(el){
      var ts=el.getAttribute('data-ts');
      if(!ts)return;
      var date=new Date(ts);
      if(isNaN(date.getTime()))return;
      var now=new Date();
      var diff=Math.floor((now.getTime()-date.getTime())/1000);
      var text='';
      if(diff<60)text=(lang==='es'?'hace ':'')+diff+'s'+(lang!=='es'?' ago':'');
      else if(diff<3600)text=(lang==='es'?'hace ':'')+Math.floor(diff/60)+'m'+(lang!=='es'?' ago':'');
      else if(diff<86400)text=(lang==='es'?'hace ':'')+Math.floor(diff/3600)+'h'+(lang!=='es'?' ago':'');
      else text=(lang==='es'?'hace ':'')+Math.floor(diff/86400)+'d'+(lang!=='es'?' ago':'');
      el.textContent=text;
      el.title=date.toLocaleString();
    });

    // Re-init custom selects for filter bar (loaded after initial init)
    if(typeof initCustomSelects==='function')initCustomSelects();
  })()</script>`

  // ── Config page ──
  if (isConfigPage) {
  const { activeModules = [], knowledgeCategories: kCats = [], subagentTypes: saTypesAll = [] } = ud
  const SYSTEM_TYPES = ['admin', 'lead', 'coworker', 'partners']
  // Section A: Base Cards Grid
  const SVG_CONTACTS_ICON = '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>'
  const SVG_EYE = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>'

  // Sort cards: admin first, then active alphabetically, then inactive alphabetically
  const sortedConfigs = [...configs].sort((a, b) => {
    if (a.listType === 'admin') return -1
    if (b.listType === 'admin') return 1
    if (a.isEnabled !== b.isEnabled) return a.isEnabled ? -1 : 1
    return a.displayName.localeCompare(b.displayName)
  })

  html += `<div class="cb-grid">`
  for (const cfg of sortedConfigs) {
    const lt = cfg.listType
    const isSys = cfg.isSystem || SYSTEM_TYPES.includes(lt)
    const count = counts[lt] ?? 0
    const isPartners = lt === 'partners'
    const inactiveClass = !cfg.isEnabled ? ' ch-card-inactive' : ''
    const typeLabel = isSys ? (lang === 'es' ? 'Sistema' : 'System') : (lang === 'es' ? 'Custom' : 'Custom')
    const countLabel = lang === 'es' ? 'contactos' : 'contacts'

    html += `<div class="ch-card cb-card${inactiveClass}" data-base-id="${esc(lt)}" data-enabled="${cfg.isEnabled}" ${!isPartners ? `onclick="if(!event.target.closest('.toggle,.act-btn,.ch-btn-action,a'))toggleBaseConfigClick('${esc(lt)}')" style="cursor:pointer"` : ''}>
      <div class="ch-card-top">
        <div class="ch-card-icon ts-cb-icon-primary">
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
        <div class="ch-metric ts-metric-no-border">
          <span class="ch-metric-label">${countLabel}</span>
          <span class="ch-metric-value">${count}</span>
        </div>
      </div>
      <div class="ch-card-footer">${isPartners
        ? `<span class="panel-badge badge-soon">${lang === 'es' ? 'Proximamente' : 'Coming soon'}</span>`
        : `<button type="button" class="act-btn act-btn-config" onclick="event.stopPropagation();toggleBaseConfigClick('${esc(lt)}')">${GEAR_SVG} ${lang === 'es' ? 'Configurar' : 'Configure'}</button>
           <span class="ch-footer-spacer"></span>
           <a href="/console/contacts/${esc(lt)}?lang=${lang}" class="act-btn act-btn-add" onclick="event.stopPropagation()">${SVG_EYE} ${lang === 'es' ? 'Ver' : 'View'}</a>`
      }</div>
    </div>`
  }
  html += `</div>`

  // ── Tip box: shown when no base is selected for config ──
  const SVG_CONFIG_TIP = '<svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>'

  html += `<div class="cb-config-tip" id="cb-config-tip">
    ${SVG_CONFIG_TIP}
    <div class="ts-create-box-desc" style="margin-top:8px;font-size:0.95rem">${lang === 'es' ? 'Selecciona una base para configurar' : 'Select a base to configure'}</div>
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
      <div class="ts-config-title">${esc(cfg.displayName)}</div>
      ${cfg.description ? `<div class="ts-config-desc">${esc(cfg.description)}</div>` : ''}`

    // System-specific explanations
    const explanation = BASE_EXPLANATIONS[lt]
    if (explanation) {
      html += `<div class="field-divider"><span class="field-divider-label">${lang === 'es' ? 'Reglas de asignacion' : 'Assignment rules'}</span></div>
        <div class="ts-config-explanation">
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

    }

    // Lead: webhook toggle in column 1
    if (lt === 'lead') {
      const whEnabledCol1 = (cfg.syncConfig as Record<string, unknown>)?.webhookEnabled === true
      const whEnabledOrigCol1 = whEnabledCol1 ? 'on' : ''
      html += `<div class="field-divider"><span class="field-divider-label">Webhook</span></div>
        <div class="chs-toggle-row chs-toggle-row--compact">
          <span style="font-size:13px">${lang === 'es' ? 'Recibir leads desde webhook' : 'Receive leads from webhook'}</span>
          <span class="ch-footer-spacer"></span>
          <label class="toggle toggle-sm" onclick="event.stopPropagation()">
            <input type="checkbox" ${whEnabledCol1 ? 'checked' : ''} data-hidden="webhook_enabled_lead"
              onchange="document.querySelector('[name=webhook_enabled_lead]').value=this.checked?'on':'';var p=document.getElementById('webhook-panel-lead');if(p){if(this.checked){p.style.display='';p.classList.remove('collapsed')}else{p.style.display='none'}}">
            <span class="toggle-slider"></span>
          </label>
          <input type="hidden" name="webhook_enabled_lead" value="${whEnabledOrigCol1}" data-original="${whEnabledOrigCol1}">
        </div>
        <div class="ts-contact-ignored-wrap">
          <button class="act-btn act-btn-cta ts-contact-ignored-btn" onclick="contactIgnored('${lang}')">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 2L11 13"/><path d="M22 2L15 22 11 13 2 9l20-7z"/></svg>
            ${lang === 'es' ? 'Contactar ignorados' : 'Contact ignored leads'}
          </button>
        </div>
        <script>
        function contactIgnored(lang) {
          if (!confirm(lang === 'es' ? '¿Iniciar contacto proactivo con leads ignorados (fuente: engine)? Se actualizará su fuente a outbound.' : 'Start proactive contact with ignored leads (source: engine)? Their source will be updated to outbound.')) return;
          fetch('/console/api/lead-scoring/contact-ignored', { method: 'POST', headers: { 'Content-Type': 'application/json' } })
            .then(function(r) { return r.json() })
            .then(function(d) {
              var msg = lang === 'es'
                ? (d.count || 0) + ' contactos programados para contacto'
                : (d.count || 0) + ' contacts scheduled for outreach';
              window.lunaNotifications ? window.lunaNotifications.add({ title: 'OK', text: msg, type: 'success' }) : alert(msg);
            })
            .catch(function() { alert('Error'); });
        }
        </script>`
    }

    // Assignment rules (custom lists only — not system)
    if (!['admin', 'lead', 'coworker'].includes(lt)) {
      const aEnabled = cfg.assignmentEnabled
      const aPrompt = cfg.assignmentPrompt || ''
      const aOrig = aEnabled ? 'on' : ''
      html += `<div class="field-divider"><span class="field-divider-label">${lang === 'es' ? 'Reglas de asignacion' : 'Assignment rules'}</span></div>
        <div class="chs-toggle-row chs-toggle-row--compact">
          <span style="font-size:13px">${lang === 'es' ? 'Asignacion automatica por LLM' : 'LLM auto-assignment'}</span>
          <span class="ch-footer-spacer"></span>
          <input type="checkbox" class="perm-cb" class="ts-perm-cb"
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
      html += `<div class="ts-config-delete-area">
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
        <input type="checkbox" class="perm-cb" class="ts-perm-cb"
          ${allModToolsOn ? 'checked' : ''} ${someModToolsOn ? 'indeterminate' : ''}${disabledAttr}
          data-hidden="mod_${esc(lt)}_${esc(mod.name)}"
          onchange="toggleModuleTools('${esc(lt)}','${esc(mod.name)}',this.checked)">
        <input type="hidden" name="mod_${esc(lt)}_${esc(mod.name)}" value="${modOrig}" data-original="${modOrig}">
      </div>`

      html += `<div class="perm-grid u-mb-sm" style="padding-left:28px" id="mod-tools-${esc(lt)}-${esc(mod.name)}">`
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

    // Tab 2: Subagents (toggle + per-subagent selection)
    const subOrig = (isAdmin || perms.subagents) ? 'on' : ''
    const saTypes = saTypesAll
    const allowedSa = perms.allowedSubagents ?? []
    const allSaAccess = isAdmin || allowedSa.length === 0
    html += `<div class="panel collapsed"><div class="panel-header" onclick="togglePanel(this)">
      <span class="panel-title">${lang === 'es' ? 'Subagentes' : 'Subagents'}</span>
      <span class="panel-chevron">&#9660;</span></div><div class="panel-body">
      <div class="chs-toggle-row chs-toggle-row--compact">
        <span style="font-size:13px">${lang === 'es' ? 'Permitir subagentes' : 'Allow subagents'}</span>
        <span class="ch-footer-spacer"></span>
        <input type="checkbox" class="perm-cb" class="ts-perm-cb"
          ${isAdmin || perms.subagents ? 'checked' : ''}${disabledAttr} data-hidden="sub_${esc(lt)}">
        <input type="hidden" name="sub_${esc(lt)}" value="${subOrig}" data-original="${subOrig}">
      </div>`
    if (saTypes.length > 0) {
      html += `<p class="panel-description ts-config-muted" style="margin:8px 0 4px">${lang === 'es' ? 'Sin seleccion = acceso a todos. Selecciona para restringir.' : 'No selection = access to all. Select to restrict.'}</p>`
      html += `<div class="perm-grid">`
      for (const sa of saTypes) {
        const checked = allSaAccess || allowedSa.includes(sa.slug)
        const origVal = checked && !allSaAccess ? 'on' : ''
        html += `<label title="${esc(sa.description)}">
          <input type="checkbox" class="perm-cb" ${checked ? 'checked' : ''}${disabledAttr} data-hidden="sa_${esc(lt)}_${esc(sa.slug)}">
          <input type="hidden" name="sa_${esc(lt)}_${esc(sa.slug)}" value="${origVal}" data-original="${origVal}">
          ${esc(sa.name)}</label>`
      }
      html += `</div>`
    }
    html += `</div></div>` // end Subagents panel

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
      html += `<p class="panel-description ts-config-muted">${lang === 'es' ? 'No hay categorias de conocimiento configuradas. Activa el modulo de Knowledge para gestionar categorias.' : 'No knowledge categories configured. Activate the Knowledge module to manage categories.'}</p>`
    }
    html += `</div></div>` // end Knowledge panel

    // Tab 4: Roles (coworker only — column 2)
    if (lt === 'coworker') {
      const roles: string[] = (cfg.syncConfig as Record<string, unknown>)?.roles as string[] ?? []
      const rolesOrig = roles.join(',')
      const roleList = roles.length > 0
        ? roles.map(r => `<div class="ts-role-row">
            <span class="ts-role-name">${esc(r)}</span>
          </div>`).join('')
        : `<div class="ts-roles-empty">${lang === 'es' ? 'No hay etiquetas definidas.' : 'No labels defined.'}</div>`
      html += `<div class="panel collapsed"><div class="panel-header" onclick="togglePanel(this)">
        <span class="panel-title">${lang === 'es' ? 'Etiquetas / Roles' : 'Labels / Roles'}</span>
        <span class="panel-chevron">&#9660;</span></div><div class="panel-body">
        <div class="ts-roles-desc">${lang === 'es' ? 'Define etiquetas para clasificar coworkers. Se usan para escalamientos y human-in-the-loop.' : 'Define labels to classify coworkers. Used for escalations and human-in-the-loop.'}</div>
        <div id="coworker-roles-list">${roleList}</div>
        <input type="hidden" name="coworker_roles" value="${esc(rolesOrig)}" data-original="${esc(rolesOrig)}" id="coworker-roles-hidden">
        <button type="button" class="act-btn act-btn-config u-mt-md" onclick="openRolesModal()">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
          ${lang === 'es' ? 'Editar etiquetas' : 'Edit labels'}
        </button>
      </div></div>`
    }

    // Tab 5: Webhook de registro (leads only — column 2, hidden when webhook disabled)
    if (lt === 'lead') {
      const whEnabled = (cfg.syncConfig as Record<string, unknown>)?.webhookEnabled === true
      const whToken = ((cfg.syncConfig as Record<string, unknown>)?.webhookToken as string) ?? ''
      const whChannel = ((cfg.syncConfig as Record<string, unknown>)?.webhookPreferredChannel as string) || 'auto'
      const SVG_COPY = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg>'
      const SVG_REFRESH = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 11-2.12-9.36L23 10"/></svg>'
      html += `<div id="webhook-panel-lead" class="panel" style="${whEnabled ? '' : 'display:none'}"><div class="panel-header" onclick="togglePanel(this)">
        <span class="panel-title">${lang === 'es' ? 'Webhook de registro' : 'Registration webhook'}</span>
        <span class="panel-chevron">&#9660;</span></div><div class="panel-body">
        <div class="ts-webhook-desc">${lang === 'es'
          ? 'Registra leads desde sistemas externos (CRM, ads, formularios) via HTTP POST.'
          : 'Register leads from external systems (CRM, ads, forms) via HTTP POST.'}</div>
        <div id="webhook-settings-lead">
          <label class="ts-webhook-label">Endpoint <span class="ts-webhook-label-sub">(POST)</span></label>
          <div class="wizard-uri-box" style="margin-bottom:14px">
            <code class="wizard-uri" id="webhook-endpoint-display">{BASE_URL}/console/api/leads/webhook/register</code>
            <button type="button" class="wizard-copy-icon" onclick="copyWizardUri(this)" title="${lang === 'es' ? 'Copiar' : 'Copy'}">${SVG_COPY}</button>
          </div>
          <label class="ts-webhook-label">${lang === 'es' ? 'Token de autorizacion' : 'Authorization token'}</label>
          <div class="wizard-uri-box" style="margin-bottom:14px">
            <code class="wizard-uri" id="webhook-token-display" style="font-size:12px">${esc(whToken)}</code>
            <button type="button" class="wizard-copy-icon" onclick="copyWizardUri(this)" title="${lang === 'es' ? 'Copiar' : 'Copy'}">${SVG_COPY}</button>
            <button type="button" class="wizard-copy-icon" onclick="regenerateWebhookToken()" title="${lang === 'es' ? 'Regenerar' : 'Regenerate'}">${SVG_REFRESH}</button>
          </div>
          <input type="hidden" name="webhook_token_lead" value="${esc(whToken)}" data-original="${esc(whToken)}">
          <label class="ts-webhook-label">${lang === 'es' ? 'Canal preferido de contacto' : 'Preferred contact channel'}</label>
          <select class="wizard-input js-custom-select" name="webhook_channel_lead" data-original="${esc(whChannel)}" style="margin-bottom:14px">
            <option value="auto" ${whChannel === 'auto' ? 'selected' : ''}>Auto</option>
            <option value="whatsapp" ${whChannel === 'whatsapp' ? 'selected' : ''}>WhatsApp</option>
            <option value="email" ${whChannel === 'email' ? 'selected' : ''}>Email (Gmail)</option>
            <option value="google-chat" ${whChannel === 'google-chat' ? 'selected' : ''}>Google Chat</option>
          </select>
          <div class="field-divider" style="margin:8px 0"><span class="field-divider-label">${lang === 'es' ? 'Instrucciones de uso' : 'Usage instructions'}</span></div>
          <div class="ts-webhook-instructions">
            <p style="margin:0 0 8px"><strong>Headers:</strong> <code class="ts-webhook-code">Authorization: Bearer {token}</code></p>
            <p style="margin:0 0 4px"><strong>Body (JSON):</strong></p>
            <div style="position:relative">
              <pre id="webhook-json-example" class="ts-webhook-pre">{
  "phone": "573001234567",
  "email": "contacto@ejemplo.com",
  "name": "Nombre del contacto",
  "campaign": "keyword-o-id"
}</pre>
              <button type="button" class="wizard-copy-icon ts-webhook-copy-abs" onclick="navigator.clipboard.writeText(document.getElementById('webhook-json-example').textContent);this.classList.add('copied');setTimeout(()=>this.classList.remove('copied'),1500)" title="${lang === 'es' ? 'Copiar' : 'Copy'}">${SVG_COPY}</button>
            </div>
            <p style="margin:0 0 4px"><strong>${lang === 'es' ? 'Parametros' : 'Parameters'}:</strong></p>
            <ul style="margin:0 0 8px;padding-left:16px">
              <li><code>phone</code> ${lang === 'es' ? 'o' : 'or'} <code>email</code> — ${lang === 'es' ? 'al menos uno requerido' : 'at least one required'}</li>
              <li><code>name</code> — ${lang === 'es' ? 'nombre del contacto (opcional)' : 'contact name (optional)'}</li>
              <li><code>campaign</code> — ${lang === 'es' ? 'keyword o ID de la campaña (opcional). Consulta el ID en' : 'campaign keyword or ID (optional). Check the ID in'} <a href="/console/lead-scoring?lang=${lang}" style="color:var(--primary)">${lang === 'es' ? 'Campañas' : 'Campaigns'}</a></li>
            </ul>
          </div>
        </div>
      </div></div>`
    }

    html += `</div>` // end right column
    html += `</div></div>` // end cb-config-layout + cb-config-panel
  }

  // ── Create base box + Unregistered contacts (global config) ──
  html += `<div class="cb-create-box">
    <div class="cb-create-box-header">
      <div>
        <div class="ts-create-box-title">${lang === 'es' ? 'Organiza tus usuarios' : 'Organize your users'}</div>
        <div class="ts-create-box-desc">${lang === 'es' ? 'Crea tus bases de contactos aqui para segmentar y organizar tu audiencia.' : 'Create your contact bases here to segment and organize your audience.'}</div>
      </div>
      <span class="panel-badge badge-soon" style="font-size:0.8rem;padding:6px 14px">${lang === 'es' ? 'Proximamente' : 'Coming soon'}</span>
    </div>
  </div>`

  // ── Contactos no registrados (global config) ──
  const leadCfg = configs.find(c => c.listType === 'lead')
  if (leadCfg) {
    const behavior = leadCfg.unregisteredBehavior || 'ignore'
    const savedMsg = leadCfg.unregisteredMessage || ''
    const hasSavedMsg = behavior === 'message' && savedMsg.length > 0
    html += `<div class="cb-create-box" style="margin-top:16px">
      <div class="cb-create-box-header">
        <div>
          <div class="ts-create-box-title">${lang === 'es' ? 'Contactos no registrados' : 'Unregistered contacts'}</div>
          <div class="ts-create-box-desc">${lang === 'es' ? 'Configura que sucede cuando un contacto desconocido escribe por primera vez.' : 'Configure what happens when an unknown contact writes for the first time.'}</div>
        </div>
        <select class="wizard-input js-custom-select" name="unregisteredBehavior" data-original="${esc(behavior)}" style="max-width:280px;width:280px" onchange="onUnregBehaviorChange(this.value)">
          <option value="ignore" ${behavior === 'ignore' ? 'selected' : ''}>${lang === 'es' ? 'Ignorar — Luna no se activa' : 'Ignore — Luna does not activate'}</option>
          <option value="silence" ${behavior === 'silence' ? 'selected' : ''}>${lang === 'es' ? 'Silencio — registra pero no responde' : 'Silence — registers but does not respond'}</option>
          <option value="message" ${behavior === 'message' ? 'selected' : ''}>${lang === 'es' ? 'Mensaje — registra y envia mensaje automatico' : 'Message — registers and sends auto-message'}</option>
          <option value="attend" ${behavior === 'attend' ? 'selected' : ''}>${lang === 'es' ? 'Atender — registra y responde' : 'Attend — registers and responds'}</option>
        </select>
      </div>
      <div id="unregistered-msg-field" style="display:${behavior === 'message' ? 'block' : 'none'};margin-top:12px">
        <div class="ts-unreg-msg-header">
          <label class="wizard-label" style="margin:0">${lang === 'es' ? 'Mensaje automatico' : 'Auto-message'}</label>
          <button type="button" id="unregistered-msg-edit-btn" class="act-btn act-btn-config act-btn--compact" style="display:${hasSavedMsg ? 'inline-flex' : 'none'}" onclick="enableUnregMsgEdit()">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
            ${lang === 'es' ? 'Editar' : 'Edit'}
          </button>
        </div>
        <textarea class="wizard-input" id="unregistered-msg-textarea" name="unregisteredMessage" data-original="${esc(savedMsg)}" rows="2" ${hasSavedMsg ? 'readonly style="background:var(--surface-container-low);cursor:default"' : ''} placeholder="${lang === 'es' ? 'Gracias por tu mensaje. Te contactaremos pronto.' : 'Thank you for your message. We will get back to you soon.'}">${esc(savedMsg)}</textarea>
      </div>
    </div>`
  }

  // ── Deactivation modal (2-step confirmation) ──
  html += `<div class="cb-deact-overlay" id="cb-deact-overlay" onclick="if(event.target===this)closeDeactModal()">
    <div class="cb-deact-modal">
      <div class="cb-deact-step active" id="cb-deact-step1">
        <h3>${lang === 'es' ? 'Desactivar base' : 'Deactivate base'}</h3>
        <p id="cb-deact-desc">${lang === 'es' ? '¿Que deseas hacer con los contactos de esta base?' : 'What do you want to do with the contacts in this base?'}</p>
        <label class="ts-webhook-label">${lang === 'es' ? 'Accion' : 'Action'}</label>
        <select class="wizard-input js-custom-select" id="cb-deact-action" required style="margin-bottom:12px">
          <option value="" disabled selected>${lang === 'es' ? 'Selecciona una opcion...' : 'Select an option...'}</option>
          <option value="silence">${lang === 'es' ? 'Silencio — solo registrar, sin respuesta' : 'Silence — register only, no response'}</option>
          <option value="leads">${lang === 'es' ? 'Mover a Leads' : 'Move to Leads'}</option>
          <option value="unregistered">${lang === 'es' ? 'Contacto no registrado — tratar como nuevo' : 'Unregistered — treat as new contact'}</option>
        </select>
        <div class="ts-modal-actions">
          <button type="button" class="act-btn act-btn-config" onclick="closeDeactModal()">${lang === 'es' ? 'Cancelar' : 'Cancel'}</button>
          <button type="button" class="act-btn act-btn-remove" id="cb-deact-next" onclick="deactNextStep()">${lang === 'es' ? 'Continuar' : 'Continue'}</button>
        </div>
      </div>
      <div class="cb-deact-step" id="cb-deact-step2">
        <h3>${lang === 'es' ? 'Confirmar desactivacion' : 'Confirm deactivation'}</h3>
        <p id="cb-deact-confirm-msg"></p>
        <div class="ts-modal-actions-compact">
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
    // toggleCreateBase removed — button replaced by "Proximamente" badge
    window.addDomainTag=function(){
      var inp=document.getElementById('coworker-domain-input');
      if(!inp)return;
      var val=inp.value.trim();
      if(!val)return;
      if(val.indexOf('@')!==0)val='@'+val;
      var container=document.getElementById('coworker-domains-tags');
      var tag=document.createElement('span');
      tag.className='tag-chip';
      tag.innerHTML=val+' <button type="button" onclick="this.parentElement.remove();updateDomainHidden()">&times;<'+'/button>';
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

    // ── Unregistered behavior change ──
    window.onUnregBehaviorChange=function(val){
      var msgField=document.getElementById('unregistered-msg-field');
      if(msgField)msgField.style.display=val==='message'?'block':'none';
      if(val==='message'){
        var ta=document.getElementById('unregistered-msg-textarea');
        if(ta&&!ta.value.trim()){ta.removeAttribute('readonly');ta.style.background='';ta.style.cursor='';
          var btn=document.getElementById('unregistered-msg-edit-btn');if(btn)btn.style.display='none'}
      }
      // Trigger dirty tracking — the hidden select has data-original
      var sel=document.querySelector('select[name="unregisteredBehavior"]');
      if(sel)sel.dispatchEvent(new Event('input',{bubbles:true}));
    };
    window.enableUnregMsgEdit=function(){
      var ta=document.getElementById('unregistered-msg-textarea');
      if(ta){ta.removeAttribute('readonly');ta.style.background='';ta.style.cursor='';ta.focus()}
      var btn=document.getElementById('unregistered-msg-edit-btn');
      if(btn)btn.style.display='none';
    };

    // ── Roles modal (coworker) ──
    // NOTE: All closing tags in innerHTML strings MUST use '<'+'/' to avoid breaking the HTML parser
    var CL='<'+'/'; // closing tag helper — avoids </ which breaks inline script
    window.openRolesModal=function(){
      var hidden=document.getElementById('coworker-roles-hidden');
      var roles=(hidden&&hidden.value)?hidden.value.split(',').filter(Boolean):[];
      var overlay=document.getElementById('roles-modal-overlay');
      if(!overlay){
        overlay=document.createElement('div');overlay.id='roles-modal-overlay';
        overlay.className='cb-deact-overlay open';
        overlay.onclick=function(e){if(e.target===overlay)closeRolesModal()};
        overlay.innerHTML='<div class="cb-deact-modal" style="max-width:420px"><h3>'+(lang==='es'?'Editar etiquetas':'Edit labels')+CL+'h3>'
          +'<div id="roles-modal-list" class="ts-roles-modal-list">'+CL+'div>'
          +'<div style="display:flex;gap:6px;margin:12px 0"><input type="text" class="wizard-input" id="roles-modal-input" placeholder="'+(lang==='es'?'Nueva etiqueta + Enter':'New label + Enter')+'" onkeydown="if(event.keyCode===13){event.preventDefault();addRoleFromModal()}" style="flex:1"><button type="button" class="wizard-btn wizard-btn-primary" onclick="addRoleFromModal()" style="padding:8px 16px">'+(lang==='es'?'Agregar':'Add')+CL+'button>'+CL+'div>'
          +'<div class="ts-modal-actions"><button type="button" class="act-btn act-btn-config" onclick="closeRolesModal()">'+(lang==='es'?'Cerrar':'Close')+CL+'button>'+CL+'div>'
          +CL+'div>';
        document.body.appendChild(overlay);
      } else {overlay.classList.add('open')}
      renderRolesModalList(roles);
    };
    function renderRolesModalList(roles){
      var list=document.getElementById('roles-modal-list');
      if(!list)return;
      if(roles.length===0){list.innerHTML='<div class="ts-roles-empty">'+(lang==='es'?'No hay etiquetas':'No labels')+CL+'div>';return}
      list.innerHTML=roles.map(function(r,i){
        return '<div class="ts-role-row-edit">'
          +'<input type="text" class="wizard-input" value="'+r.replace(/"/g,'&quot;')+'" data-role-idx="'+i+'" style="flex:1;font-size:13px;padding:6px 10px" onchange="renameRole('+i+',this.value)">'
          +'<button type="button" class="ts-role-delete-btn" onclick="deleteRole('+i+')" title="'+(lang==='es'?'Eliminar':'Delete')+'">&times;'+CL+'button>'
          +CL+'div>'
      }).join('');
    }
    function getCurrentRoles(){
      var hidden=document.getElementById('coworker-roles-hidden');
      return (hidden&&hidden.value)?hidden.value.split(',').filter(Boolean):[];
    }
    function saveRolesToHidden(roles){
      var hidden=document.getElementById('coworker-roles-hidden');
      if(hidden){hidden.value=roles.join(',');hidden.dispatchEvent(new Event('input',{bubbles:true}))}
      var listEl=document.getElementById('coworker-roles-list');
      if(listEl){
        listEl.innerHTML=roles.length>0?roles.map(function(r){
          return '<div class="ts-role-row"><span class="ts-role-name">'+r.split('<').join('&lt;')+CL+'span>'+CL+'div>'
        }).join(''):'<div class="ts-roles-empty">'+(lang==='es'?'No hay etiquetas definidas.':'No labels defined.')+CL+'div>';
      }
    }
    window.addRoleFromModal=function(){
      var inp=document.getElementById('roles-modal-input');
      if(!inp)return;var val=inp.value.trim();if(!val)return;
      var roles=getCurrentRoles();roles.push(val);
      saveRolesToHidden(roles);renderRolesModalList(roles);inp.value='';inp.focus();
    };
    window.renameRole=function(idx,newName){
      var roles=getCurrentRoles();
      if(idx>=0&&idx<roles.length&&newName.trim()){roles[idx]=newName.trim();saveRolesToHidden(roles)}
    };
    window.deleteRole=function(idx){
      var roles=getCurrentRoles();
      if(idx>=0&&idx<roles.length){roles.splice(idx,1);saveRolesToHidden(roles);renderRolesModalList(roles)}
    };
    window.closeRolesModal=function(){
      var overlay=document.getElementById('roles-modal-overlay');
      if(overlay)overlay.classList.remove('open');
    };

    // ── Webhook helpers ──
    window.regenerateWebhookToken=function(){
      fetch('/console/api/users/webhook/regenerate-token',{method:'POST'}).then(function(r){return r.json()}).then(function(d){
        if(d.token){
          var display=document.getElementById('webhook-token-display');
          if(display)display.textContent=d.token;
          var hidden=document.querySelector('[name=webhook_token_lead]');
          if(hidden){hidden.value=d.token;hidden.dispatchEvent(new Event('input',{bubbles:true}))}
          showToast(lang==='es'?'Token regenerado':'Token regenerated');
        }
      });
    };
    // copyWizardUri fallback (if console-minimal.js hasn't loaded yet)
    if(!window.copyWizardUri){
      window.copyWizardUri=function(btn){
        var box=btn.closest('.wizard-uri-box');
        var code=box?box.querySelector('.wizard-uri'):null;
        if(!code)return;
        navigator.clipboard.writeText(code.textContent).then(function(){
          btn.classList.add('copied');setTimeout(function(){btn.classList.remove('copied')},1500);
        });
      };
    }

    // ── Deactivation modal ──
    window.openDeactModal=function(lt,name){
      _deactLt=lt;_deactName=name;
      document.getElementById('cb-deact-action').selectedIndex=0;
      document.getElementById('cb-deact-step1').classList.add('active');
      document.getElementById('cb-deact-step2').classList.remove('active');
      document.getElementById('cb-deact-overlay').classList.add('open');
      if(typeof initCustomSelects==='function')initCustomSelects();
    };
    window.closeDeactModal=function(){
      document.getElementById('cb-deact-overlay').classList.remove('open');
    };
    window.deactNextStep=function(){
      var action=document.getElementById('cb-deact-action').value;
      if(!action){alert(lang==='es'?'Selecciona una opcion.':'Select an option.');return}
      var actionText={silence:lang==='es'?'registrar sin respuesta':'register without response',leads:lang==='es'?'mover a Leads':'move to Leads',unregistered:lang==='es'?'tratar como contacto nuevo en la proxima interaccion':'treat as new contact on next interaction'};
      var msg=lang==='es'
        ?'Estas a punto de desactivar la base "'+_deactName+'". Accion: '+actionText[action]+'. Esta accion se puede revertir reactivando la base.'
        :'You are about to deactivate the base "'+_deactName+'". Action: '+actionText[action]+'. This action can be reversed by reactivating the base.';
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
      submitListToggle(_deactLt,false,action,'');
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

    // Replace {BASE_URL} placeholders in wizard-uri elements
    document.querySelectorAll('.wizard-uri').forEach(function(el){
      if(el.textContent.indexOf('{BASE_URL}')!==-1){
        el.textContent=el.textContent.replace(/\{BASE_URL\}/g,location.origin);
      }
    });

    if(typeof initCustomSelects==='function')initCustomSelects();
  })()</script>`

  } // end isConfigPage

  return html + '</div>'
}
