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
    case 'lead_scoring': return renderLeadScoringSection()
    case 'modules': return renderModulesSection()
    case 'google': return renderComingSoonSection()
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
