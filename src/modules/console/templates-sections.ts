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
  moduleStates?: ModuleInfo[]
  scheduledTasksHtml?: string
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
  `
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
      ${secretField('OPENAI_API_KEY', cv(data, 'OPENAI_API_KEY'), data.lang, 'f_OPENAI_API_KEY', 'i_OPENAI_API_KEY')}
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
      ${numField('LLM_RPM_OPENAI', cv(data, 'LLM_RPM_OPENAI'), data.lang, 'RPM OpenAI')}
      ${numField('LLM_TPM_ANTHROPIC', cv(data, 'LLM_TPM_ANTHROPIC'), data.lang, 'TPM Anthropic')}
      ${numField('LLM_TPM_GOOGLE', cv(data, 'LLM_TPM_GOOGLE'), data.lang, 'TPM Google')}
      ${numField('LLM_TPM_OPENAI', cv(data, 'LLM_TPM_OPENAI'), data.lang, 'TPM OpenAI')}
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

  // Panel 3: Naturalidad
  h += `<div class="panel">
    <div class="panel-header" onclick="togglePanel(this)">
      <span class="panel-title">${t('sec_naturalidad', data.lang)}</span>
      <span class="panel-chevron">&#9660;</span>
    </div>
    <div class="panel-body">
      <div class="panel-info">${t('sec_naturalidad_info', data.lang)}</div>
      <div class="field-divider"><span class="field-divider-label">${t('sub_ack_whatsapp', data.lang)}</span></div>
      ${numField('ACK_WHATSAPP_TRIGGER_MS', cv(data, 'ACK_WHATSAPP_TRIGGER_MS'), data.lang, 'f_ACK_WHATSAPP_TRIGGER_MS', 'i_ACK_WHATSAPP_TRIGGER_MS')}
      ${numField('ACK_WHATSAPP_HOLD_MS', cv(data, 'ACK_WHATSAPP_HOLD_MS'), data.lang, 'f_ACK_WHATSAPP_HOLD_MS', 'i_ACK_WHATSAPP_HOLD_MS')}
      ${textField('ACK_WHATSAPP_MESSAGE', cv(data, 'ACK_WHATSAPP_MESSAGE'), data.lang, 'f_ACK_WHATSAPP_MESSAGE', 'i_ACK_WHATSAPP_MESSAGE')}
      <div class="field-divider"><span class="field-divider-label">${t('sub_ack_email', data.lang)}</span></div>
      ${numField('ACK_EMAIL_TRIGGER_MS', cv(data, 'ACK_EMAIL_TRIGGER_MS'), data.lang, 'f_ACK_EMAIL_TRIGGER_MS', 'i_ACK_EMAIL_TRIGGER_MS')}
      ${numField('ACK_EMAIL_HOLD_MS', cv(data, 'ACK_EMAIL_HOLD_MS'), data.lang, 'f_ACK_EMAIL_HOLD_MS', 'i_ACK_EMAIL_HOLD_MS')}
      ${textField('ACK_EMAIL_MESSAGE', cv(data, 'ACK_EMAIL_MESSAGE'), data.lang, 'f_ACK_EMAIL_MESSAGE', 'i_ACK_EMAIL_MESSAGE')}
    </div>
  </div>`

  return h
}

export function renderLeadScoringSection(data: SectionData): string {
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

/** Old section IDs that redirect to unified pages */
export const SECTION_REDIRECTS: Record<string, string> = {
  'apikeys': 'llm',
  'models': 'llm',
  'llm-limits': 'llm',
  'llm-cb': 'llm',
  'followup': 'pipeline',
  'naturalidad': 'pipeline',
  'db': 'infra',
  'redis': 'infra',
}

export function renderSection(section: string, data: SectionData): string | null {
  switch (section) {
    case 'whatsapp': return renderWhatsappSection(data)
    // Unified LLM page (replaces apikeys, models, llm-limits, llm-cb)
    case 'llm': return renderLlmUnifiedSection(data)
    // Unified Pipeline page (replaces pipeline, followup, naturalidad)
    case 'pipeline': return renderPipelineUnifiedSection(data)
    case 'engine-metrics': return renderEngineMetricsSection(data)
    case 'lead-scoring': return renderLeadScoringSection(data)
    case 'scheduled-tasks': return renderScheduledTasksSection(data)
    case 'modules': return renderModulesSection(data)
    case 'infra': return renderInfraUnifiedSection(data)
    case 'google-apps': return renderGoogleAppsSection(data)
    case 'email': return renderEmailSection(data)
    default: return null
  }
}
