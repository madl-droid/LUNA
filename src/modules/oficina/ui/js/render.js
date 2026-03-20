// render.js — Main render function
// Depends on: i18n (t), state (*), fields (*), panels (*), whatsapp (renderWa), modules (renderModulePanels)

function render() {
  const m = document.getElementById('main')
  document.getElementById('btn-reset').textContent = t('discard')
  document.getElementById('btn-save').textContent = t('save')
  document.getElementById('btn-apply').textContent = t('applyBtn')
  document.getElementById('btn-resetdb').textContent = t('resetDbBtn')
  let h = ''

  // 1. WhatsApp panel
  const waModEnabled = waState.moduleEnabled !== false
  h += `<div class="panel" id="wa-panel-wrap"><div class="panel-header" onclick="togglePanel(this)">
    <span class="panel-title">${t('sec_whatsapp')} <span class="panel-badge badge-active">${t('waStatus')[waState.status] || waState.status}</span>
    ${!waModEnabled ? '<span class="panel-badge badge-soon">' + t('waModuleDisabled') + '</span>' : ''}</span>
    <span class="panel-chevron">&#9660;</span>
  </div><div class="panel-body"><div class="panel-info">${t('sec_whatsapp_info')}</div>
    <div style="font-size:13px;color:var(--text-tertiary);font-weight:600;text-transform:uppercase;letter-spacing:0.05em;padding:12px 0 4px">${t('sec_whatsapp_baileys')}</div>
    <div class="panel-info">${t('sec_whatsapp_baileys_info')}</div>
    <div id="wa-inner"></div>
    <div style="font-size:13px;color:var(--text-tertiary);font-weight:600;text-transform:uppercase;letter-spacing:0.05em;padding:16px 0 4px;border-top:1px solid var(--border-light);margin-top:12px">${t('sec_whatsapp_api')}</div>
    <div class="panel-info">${t('sec_whatsapp_api_info')}</div>
    <div style="display:flex;align-items:center;gap:0.5rem;padding:0.5rem 0">
      <span class="panel-badge badge-soon">${t('comingSoon')}</span>
    </div>
  </div></div>`

  // 1.5. Lead Scoring (link to separate page)
  h += `<div class="panel"><div class="panel-header" onclick="window.location.href='/oficina/api/lead-scoring/ui'" style="cursor:pointer">
    <span class="panel-title">${t('sec_lead_scoring')} <span class="panel-badge badge-active">${t('sec_lead_scoring_badge')}</span></span>
    <span class="panel-chevron" style="transform:rotate(-90deg)">&#9660;</span>
  </div></div>`

  // 2. API Keys
  h += panel('apikeys', [
    secretField('ANTHROPIC_API_KEY', 'f_ANTHROPIC_API_KEY', 'i_ANTHROPIC_API_KEY'),
    secretField('OPENAI_API_KEY', 'f_OPENAI_API_KEY', 'i_OPENAI_API_KEY'),
    secretField('GOOGLE_AI_API_KEY', 'f_GOOGLE_AI_API_KEY', 'i_GOOGLE_AI_API_KEY'),
  ])

  // 3. Models (dropdowns) — primary + fallback
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
  let modelFields = `<div style="display:flex;align-items:center;justify-content:space-between;padding:8px 0">
    <button class="wa-btn wa-btn-connect" onclick="triggerScan()" style="font-size:13px;padding:6px 14px">${t('scanModelsBtn')}</button>
    ${scanInfo}
  </div>
  <div id="scan-replacements">${scanReplacements}</div>
  <div style="font-size:13px;color:var(--text-tertiary);font-weight:600;text-transform:uppercase;letter-spacing:0.05em;padding:8px 0 4px">${t('models_primary')}</div>`
  for (const [prefix, labelKey, infoKey] of modelTasks) {
    modelFields += modelDropdown(prefix, labelKey, infoKey)
  }
  modelFields += `<div style="font-size:13px;color:var(--text-tertiary);font-weight:600;text-transform:uppercase;letter-spacing:0.05em;padding:16px 0 4px;border-top:1px solid var(--border-light);margin-top:8px">${t('models_fallback')}</div>`
  for (const [prefix, labelKey, infoKey] of fallbackTasks) {
    modelFields += modelDropdown(prefix, labelKey, infoKey)
  }
  h += panelRaw('models', modelFields)

  // 4. Limits & Tokens
  h += panel('llm_limits', [
    numField('LLM_MAX_INPUT_TOKENS', 'f_LLM_MAX_INPUT_TOKENS'),
    numField('LLM_MAX_OUTPUT_TOKENS', 'f_LLM_MAX_OUTPUT_TOKENS'),
    numField('LLM_TEMPERATURE_CLASSIFY', 'f_LLM_TEMPERATURE_CLASSIFY', 'i_TEMPERATURE_CLASSIFY'),
    numField('LLM_TEMPERATURE_RESPOND', 'f_LLM_TEMPERATURE_RESPOND', 'i_TEMPERATURE_RESPOND'),
    numField('LLM_TEMPERATURE_COMPLEX', 'f_LLM_TEMPERATURE_COMPLEX', 'i_TEMPERATURE_COMPLEX'),
    numField('LLM_REQUEST_TIMEOUT_MS', 'f_LLM_REQUEST_TIMEOUT_MS'),
  ])

  // 5. Circuit Breaker
  h += panel('llm_cb', [
    numField('LLM_CIRCUIT_BREAKER_FAILURES', 'f_LLM_CIRCUIT_BREAKER_FAILURES', 'i_LLM_CB_FAILURES'),
    numField('LLM_CIRCUIT_BREAKER_WINDOW_MS', 'f_LLM_CIRCUIT_BREAKER_WINDOW_MS', 'i_LLM_CB_WINDOW'),
    numField('LLM_CIRCUIT_BREAKER_COOLDOWN_MS', 'f_LLM_CIRCUIT_BREAKER_COOLDOWN_MS', 'i_LLM_CB_COOLDOWN'),
  ])

  // 6. Pipeline
  h += panel('pipeline', [
    numField('PIPELINE_MAX_TOOL_CALLS_PER_TURN', 'f_PIPELINE_MAX_TOOL_CALLS_PER_TURN', 'i_PIPELINE_TOOLS'),
    numField('PIPELINE_MAX_CONVERSATION_TURNS', 'f_PIPELINE_MAX_CONVERSATION_TURNS', 'i_PIPELINE_TURNS'),
    numField('PIPELINE_SESSION_TTL_MS', 'f_PIPELINE_SESSION_TTL_MS', 'i_PIPELINE_TTL'),
  ])

  // 7. Follow-up (only show params if enabled)
  const followupEnabled = currentValues['FOLLOWUP_ENABLED'] === 'true'
  const followupFields = [boolField('FOLLOWUP_ENABLED', 'f_FOLLOWUP_ENABLED')]
  if (followupEnabled) {
    followupFields.push(
      numField('FOLLOWUP_DELAY_MINUTES', 'f_FOLLOWUP_DELAY_MINUTES', 'i_FOLLOWUP_DELAY'),
      numField('FOLLOWUP_MAX_ATTEMPTS', 'f_FOLLOWUP_MAX_ATTEMPTS', 'i_FOLLOWUP_MAX'),
      numField('FOLLOWUP_COLD_AFTER_ATTEMPTS', 'f_FOLLOWUP_COLD_AFTER_ATTEMPTS', 'i_FOLLOWUP_COLD'),
    )
  }
  h += panel('followup', followupFields)

  // 8. Dynamic module panels from registry
  h += renderModulePanels()

  // 9. Google (coming soon)
  h += panelSoon('google')

  // 10. Email (coming soon)
  h += panelSoon('email')

  // 11. DB (collapsed)
  h += panelCollapsed('db', [
    textField('DB_HOST'), textField('DB_PORT'), textField('DB_NAME'),
    textField('DB_USER'), secretField('DB_PASSWORD', null, null),
  ])

  // 12. Redis (collapsed)
  h += panelCollapsed('redis', [
    textField('REDIS_HOST'), textField('REDIS_PORT'), secretField('REDIS_PASSWORD', null, null),
  ])

  m.innerHTML = h
  renderWa()
}
