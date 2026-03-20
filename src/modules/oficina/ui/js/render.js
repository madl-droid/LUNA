// render.js — Main render: sidebar + content by active section
// Depends on: i18n (t), state (*), fields (*), panels (*), whatsapp (renderWa),
//             modules (renderModulePanels), navigation (activeSection, renderSidebar)

function render() {
  document.getElementById('btn-reset').textContent = t('discard')
  document.getElementById('btn-save').textContent = t('save')
  document.getElementById('btn-apply').textContent = t('applyBtn')
  document.getElementById('btn-resetdb').textContent = t('resetDbBtn')

  renderSidebar()
  renderContent()
}

function renderContent() {
  const el = document.getElementById('content')
  if (!el) return

  // Find section info for header
  const sec = NAV_SECTIONS.find(s => s.id === activeSection)
  const title = sec ? t(sec.key) : activeSection
  const descKey = sec ? sec.key + '_info' : ''
  const desc = descKey ? t(descKey) : ''

  let h = `<div class="section-header">
    <div class="section-title">${title}</div>
    ${desc && desc !== descKey ? `<div class="section-desc">${desc}</div>` : ''}
  </div>`

  h += renderSectionContent(activeSection)
  el.innerHTML = h

  // Post-render hooks
  if (activeSection === 'whatsapp') renderWa()
}

function renderSectionContent(id) {
  switch (id) {
    case 'whatsapp': return renderWhatsappSection()
    case 'apikeys': return renderApiKeysSection()
    case 'models': return renderModelsSection()
    case 'llm_limits': return renderLimitsSection()
    case 'llm_cb': return renderCbSection()
    case 'pipeline': return renderPipelineSection()
    case 'followup': return renderFollowupSection()
    case 'naturalidad': return renderNaturalidadSection()
    case 'lead_scoring': return renderLeadScoringSection()
    case 'modules': return renderModulesSection()
    case 'google': return renderGoogleSection()
    case 'email': return renderComingSoonSection()
    case 'db': return renderDbSection()
    case 'redis': return renderRedisSection()
    default: return '<div class="panel-info">Section not found</div>'
  }
}

// ═══ Section renderers ═══

function renderWhatsappSection() {
  const waModEnabled = waState.moduleEnabled !== false
  return `<div class="panel">
    <div class="panel-header" onclick="togglePanel(this)">
      <span class="panel-title">${t('sec_whatsapp_baileys')}
        <span class="panel-badge badge-active">${t('waStatus')[waState.status] || waState.status}</span>
        ${!waModEnabled ? '<span class="panel-badge badge-soon">' + t('waModuleDisabled') + '</span>' : ''}
      </span>
      <span class="panel-chevron">&#9660;</span>
    </div>
    <div class="panel-body">
      <div class="panel-info">${t('sec_whatsapp_baileys_info')}</div>
      <div id="wa-inner"></div>
    </div>
  </div>
  <div class="panel collapsed">
    <div class="panel-header" onclick="togglePanel(this)">
      <span class="panel-title">${t('sec_whatsapp_api')} <span class="panel-badge badge-soon">${t('comingSoon')}</span></span>
      <span class="panel-chevron">&#9660;</span>
    </div>
    <div class="panel-body">
      <div class="panel-info">${t('sec_whatsapp_api_info')}</div>
    </div>
  </div>`
}

function renderApiKeysSection() {
  return panelBody([
    secretField('ANTHROPIC_API_KEY', 'f_ANTHROPIC_API_KEY', 'i_ANTHROPIC_API_KEY'),
    secretField('OPENAI_API_KEY', 'f_OPENAI_API_KEY', 'i_OPENAI_API_KEY'),
    secretField('GOOGLE_AI_API_KEY', 'f_GOOGLE_AI_API_KEY', 'i_GOOGLE_AI_API_KEY'),
  ])
}

function renderModelsSection() {
  const modelTasks = [
    ['LLM_CLASSIFY', 'f_LLM_CLASSIFY', 'i_LLM_CLASSIFY'],
    ['LLM_RESPOND', 'f_LLM_RESPOND', 'i_LLM_RESPOND'],
    ['LLM_COMPLEX', 'f_LLM_COMPLEX', 'i_LLM_COMPLEX'],
    ['LLM_TOOLS', 'f_LLM_TOOLS', 'i_LLM_TOOLS'],
    ['LLM_COMPRESS', 'f_LLM_COMPRESS', 'i_LLM_COMPRESS'],
    ['LLM_PROACTIVE', 'f_LLM_PROACTIVE', 'i_LLM_PROACTIVE'],
  ]
  const fallbackTasks = [
    ['LLM_FALLBACK_CLASSIFY', 'f_LLM_FB_CLASSIFY', 'i_LLM_FB_CLASSIFY'],
    ['LLM_FALLBACK_RESPOND', 'f_LLM_FB_RESPOND', 'i_LLM_FB_RESPOND'],
    ['LLM_FALLBACK_COMPLEX', 'f_LLM_FB_COMPLEX', 'i_LLM_FB_COMPLEX'],
  ]
  const scanInfo = lastScan ? `<span style="font-size:13px;color:var(--text-tertiary)">${t('lastScan')}: ${new Date(lastScan.lastScanAt).toLocaleString()}</span>` : ''
  const scanReplacements = (lastScan && lastScan.replacements && lastScan.replacements.length > 0)
    ? lastScan.replacements.map(r =>
        `<div style="font-size:13px;color:var(--warning);padding:6px 10px;background:rgba(255,149,0,0.08);border-radius:6px;margin-bottom:4px">
          ${r.configKey}: <s>${r.oldModel}</s> ${t('scanReplaced')} <b>${r.newModel}</b>
        </div>`
      ).join('') : ''

  let h = `<div style="display:flex;align-items:center;justify-content:space-between;padding:8px 0">
    <button class="wa-btn wa-btn-connect" onclick="triggerScan()" style="font-size:13px;padding:6px 14px">${t('scanModelsBtn')}</button>
    ${scanInfo}
  </div>
  <div id="scan-replacements">${scanReplacements}</div>
  <div style="font-size:13px;color:var(--text-tertiary);font-weight:600;text-transform:uppercase;letter-spacing:0.05em;padding:8px 0 4px">${t('models_primary')}</div>`

  for (const [prefix, labelKey, infoKey] of modelTasks) {
    h += modelDropdown(prefix, labelKey, infoKey)
  }
  h += `<div style="font-size:13px;color:var(--text-tertiary);font-weight:600;text-transform:uppercase;letter-spacing:0.05em;padding:16px 0 4px;border-top:1px solid var(--border-light);margin-top:8px">${t('models_fallback')}</div>`
  for (const [prefix, labelKey, infoKey] of fallbackTasks) {
    h += modelDropdown(prefix, labelKey, infoKey)
  }
  return `<div class="panel"><div class="panel-body" style="border-top:none">${h}</div></div>`
}

function renderLimitsSection() {
  return panelBody([
    numField('LLM_MAX_INPUT_TOKENS', 'f_LLM_MAX_INPUT_TOKENS'),
    numField('LLM_MAX_OUTPUT_TOKENS', 'f_LLM_MAX_OUTPUT_TOKENS'),
    numField('LLM_TEMPERATURE_CLASSIFY', 'f_LLM_TEMPERATURE_CLASSIFY', 'i_TEMPERATURE_CLASSIFY'),
    numField('LLM_TEMPERATURE_RESPOND', 'f_LLM_TEMPERATURE_RESPOND', 'i_TEMPERATURE_RESPOND'),
    numField('LLM_TEMPERATURE_COMPLEX', 'f_LLM_TEMPERATURE_COMPLEX', 'i_TEMPERATURE_COMPLEX'),
    numField('LLM_REQUEST_TIMEOUT_MS', 'f_LLM_REQUEST_TIMEOUT_MS'),
  ])
}

function renderCbSection() {
  return panelBody([
    numField('LLM_CIRCUIT_BREAKER_FAILURES', 'f_LLM_CIRCUIT_BREAKER_FAILURES', 'i_LLM_CB_FAILURES'),
    numField('LLM_CIRCUIT_BREAKER_WINDOW_MS', 'f_LLM_CIRCUIT_BREAKER_WINDOW_MS', 'i_LLM_CB_WINDOW'),
    numField('LLM_CIRCUIT_BREAKER_COOLDOWN_MS', 'f_LLM_CIRCUIT_BREAKER_COOLDOWN_MS', 'i_LLM_CB_COOLDOWN'),
  ])
}

function renderPipelineSection() {
  return panelBody([
    numField('PIPELINE_MAX_TOOL_CALLS_PER_TURN', 'f_PIPELINE_MAX_TOOL_CALLS_PER_TURN', 'i_PIPELINE_TOOLS'),
    numField('PIPELINE_MAX_CONVERSATION_TURNS', 'f_PIPELINE_MAX_CONVERSATION_TURNS', 'i_PIPELINE_TURNS'),
    numField('PIPELINE_SESSION_TTL_MS', 'f_PIPELINE_SESSION_TTL_MS', 'i_PIPELINE_TTL'),
  ])
}

function renderFollowupSection() {
  const followupEnabled = currentValues['FOLLOWUP_ENABLED'] === 'true'
  const fields = [boolField('FOLLOWUP_ENABLED', 'f_FOLLOWUP_ENABLED')]
  if (followupEnabled) {
    fields.push(
      numField('FOLLOWUP_DELAY_MINUTES', 'f_FOLLOWUP_DELAY_MINUTES', 'i_FOLLOWUP_DELAY'),
      numField('FOLLOWUP_MAX_ATTEMPTS', 'f_FOLLOWUP_MAX_ATTEMPTS', 'i_FOLLOWUP_MAX'),
      numField('FOLLOWUP_COLD_AFTER_ATTEMPTS', 'f_FOLLOWUP_COLD_AFTER_ATTEMPTS', 'i_FOLLOWUP_COLD'),
    )
  }
  return panelBody(fields)
}

function renderNaturalidadSection() {
  return panelBody([
    `<div class="field"><span class="field-label" style="font-weight:600;opacity:.7">${t('sub_aviso_whatsapp')}</span></div>`,
    numField('AVISO_WA_TRIGGER_MS', 'f_AVISO_WA_TRIGGER_MS', 'i_AVISO_TRIGGER_MS'),
    numField('AVISO_WA_HOLD_MS', 'f_AVISO_WA_HOLD_MS', 'i_AVISO_HOLD_MS'),
    textField('AVISO_WA_MSG_1', 'f_AVISO_MSG_1', 'i_AVISO_MSG'),
    textField('AVISO_WA_MSG_2', 'f_AVISO_MSG_2', 'i_AVISO_MSG'),
    textField('AVISO_WA_MSG_3', 'f_AVISO_MSG_3', 'i_AVISO_MSG'),
    `<div class="field"><span class="field-label" style="font-weight:600;opacity:.7">${t('sub_aviso_email')}</span></div>`,
    numField('AVISO_EMAIL_TRIGGER_MS', 'f_AVISO_EMAIL_TRIGGER_MS', 'i_AVISO_TRIGGER_MS'),
    numField('AVISO_EMAIL_HOLD_MS', 'f_AVISO_EMAIL_HOLD_MS', 'i_AVISO_HOLD_MS'),
    textField('AVISO_EMAIL_MSG_1', 'f_AVISO_MSG_1', 'i_AVISO_MSG'),
    textField('AVISO_EMAIL_MSG_2', 'f_AVISO_MSG_2', 'i_AVISO_MSG'),
    textField('AVISO_EMAIL_MSG_3', 'f_AVISO_MSG_3', 'i_AVISO_MSG'),
  ])
}

function renderLeadScoringSection() {
  return `<div class="panel">
    <div class="panel-header" onclick="window.location.href='/oficina/api/lead-scoring/ui'" style="cursor:pointer">
      <span class="panel-title">${t('sec_lead_scoring')} <span class="panel-badge badge-active">${t('sec_lead_scoring_badge')}</span></span>
      <span class="panel-chevron" style="transform:rotate(-90deg)">&#9660;</span>
    </div>
  </div>`
}

function renderModulesSection() {
  return renderModulePanels()
}


function renderGoogleSection() {
  const { connected, email, loading } = googleAuthState
  const gmailMod = moduleStates.find(m => m.name === 'gmail')
  const sheetsMod = moduleStates.find(m => m.name === 'google-apps' || m.name === 'google-sheets')
  const calendarMod = moduleStates.find(m => m.name === 'google-calendar')

  const statusDot = connected
    ? `<span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:var(--success);margin-right:6px"></span>`
    : `<span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:var(--error);margin-right:6px"></span>`

  const statusLabel = connected
    ? `${statusDot}<span style="color:var(--success);font-weight:500">${t('googleConnected')}</span>${email ? ` — <span style="color:var(--text-secondary)">${esc(email)}</span>` : ''}`
    : `${statusDot}<span style="color:var(--error);font-weight:500">${t('googleNotConnected')}</span>`

  const activeModules = [
    gmailMod?.active ? 'Gmail' : null,
    sheetsMod?.active ? 'Google Sheets' : null,
    calendarMod?.active ? 'Google Calendar' : null,
  ].filter(Boolean)

  return `<div class="panel">
    <div class="panel-body" style="border-top:none">
      <div class="panel-info">${t('googleAuthInfo')}</div>

      <div style="display:flex;align-items:center;justify-content:space-between;padding:14px 0;border-bottom:1px solid var(--border-light)">
        <div style="font-size:15px">${statusLabel}</div>
        <button class="wa-btn" onclick="refreshGoogleStatus()" style="font-size:12px;padding:5px 12px;background:var(--bg-primary);color:var(--text-secondary);border:1px solid var(--border)">${t('googleRefreshStatus')}</button>
      </div>

      <div style="padding:16px 0 8px;display:flex;gap:10px;flex-wrap:wrap">
        ${!connected ? `
        <button class="wa-btn wa-btn-connect" onclick="googleConnect()" ${loading ? 'disabled' : ''} style="font-size:14px;padding:9px 20px">
          <svg width="18" height="18" viewBox="0 0 18 18" style="vertical-align:middle;margin-right:8px" xmlns="http://www.w3.org/2000/svg">
            <path d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844c-.209 1.125-.843 2.078-1.796 2.717v2.258h2.908c1.702-1.567 2.684-3.875 2.684-6.615z" fill="#4285F4"/>
            <path d="M9 18c2.43 0 4.467-.806 5.956-2.18l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 0 0 9 18z" fill="#34A853"/>
            <path d="M3.964 10.71A5.41 5.41 0 0 1 3.682 9c0-.593.102-1.17.282-1.71V4.958H.957A8.996 8.996 0 0 0 0 9c0 1.452.348 2.827.957 4.042l3.007-2.332z" fill="#FBBC05"/>
            <path d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 0 0 .957 4.958L3.964 6.29C4.672 4.163 6.656 3.58 9 3.58z" fill="#EA4335"/>
          </svg>
          ${t('googleConnectBtn')}
        </button>` : `
        <button class="wa-btn" onclick="googleDisconnect()" style="font-size:14px;padding:9px 20px;background:var(--error);color:#fff">
          ${t('googleDisconnectBtn')}
        </button>`}
      </div>

      ${activeModules.length > 0 ? `
      <div style="margin-top:8px">
        <span style="font-size:12px;color:var(--text-tertiary);text-transform:uppercase;letter-spacing:0.05em;font-weight:600">${t('googleModulesTitle')}: </span>
        ${activeModules.map(m => `<span class="panel-badge badge-active" style="margin-right:4px">${m}</span>`).join('')}
      </div>` : ''}
    </div>
  </div>`
}

function renderComingSoonSection() {
  return `<div class="panel">
    <div class="panel-body" style="border-top:none;padding-top:20px">
      <span class="panel-badge badge-soon">${t('comingSoon')}</span>
    </div>
  </div>`
}

function renderDbSection() {
  return panelBody([
    textField('DB_HOST'), textField('DB_PORT'), textField('DB_NAME'),
    textField('DB_USER'), secretField('DB_PASSWORD', null, null),
  ])
}

function renderRedisSection() {
  return panelBody([
    textField('REDIS_HOST'), textField('REDIS_PORT'), secretField('REDIS_PASSWORD', null, null),
  ])
}

// Helper: wrap fields in a panel body (no header, no collapse)
function panelBody(fieldsHtml) {
  return `<div class="panel"><div class="panel-body" style="border-top:none">${fieldsHtml.join('')}</div></div>`
}
