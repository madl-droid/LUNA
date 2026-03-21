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
  googleAuth?: { connected: boolean; email: string | null }
  moduleStates?: ModuleInfo[]
}

function panelBody(fieldsHtml: string[]): string {
  return `<div class="panel"><div class="panel-body" style="border-top:none">${fieldsHtml.join('')}</div></div>`
}

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
  <div class="panel collapsed">
    <div class="panel-header" onclick="togglePanel(this)">
      <span class="panel-title">${t('sec_whatsapp_api', data.lang)} <span class="panel-badge badge-soon">${t('comingSoon', data.lang)}</span></span>
      <span class="panel-chevron">&#9660;</span>
    </div>
    <div class="panel-body">
      <div class="panel-info">${t('sec_whatsapp_api_info', data.lang)}</div>
    </div>
  </div>`
}

export function renderApiKeysSection(data: SectionData): string {
  return panelBody([
    secretField('ANTHROPIC_API_KEY', cv(data, 'ANTHROPIC_API_KEY'), data.lang, 'f_ANTHROPIC_API_KEY', 'i_ANTHROPIC_API_KEY'),
    secretField('OPENAI_API_KEY', cv(data, 'OPENAI_API_KEY'), data.lang, 'f_OPENAI_API_KEY', 'i_OPENAI_API_KEY'),
    secretField('GOOGLE_AI_API_KEY', cv(data, 'GOOGLE_AI_API_KEY'), data.lang, 'f_GOOGLE_AI_API_KEY', 'i_GOOGLE_AI_API_KEY'),
  ])
}

export function renderModelsSection(data: SectionData): string {
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
    ? `<span style="font-size:13px;color:var(--text-tertiary)">${t('lastScan', data.lang)}: ${esc(data.lastScan.lastScanAt)}</span>`
    : ''
  const scanReplacements = (data.lastScan?.replacements?.length)
    ? data.lastScan.replacements.map(r =>
        `<div style="font-size:13px;color:var(--warning);padding:6px 10px;background:rgba(255,149,0,0.08);border-radius:6px;margin-bottom:4px">
          ${esc(r.configKey)}: <s>${esc(r.oldModel)}</s> ${t('scanReplaced', data.lang)} <b>${esc(r.newModel)}</b>
        </div>`
      ).join('') : ''

  let h = `<div style="display:flex;align-items:center;justify-content:space-between;padding:8px 0">
    <button type="button" class="wa-btn wa-btn-connect" onclick="triggerScan()" style="font-size:13px;padding:6px 14px">${t('scanModelsBtn', data.lang)}</button>
    ${scanInfo}
  </div>
  <div id="scan-replacements">${scanReplacements}</div>
  <div style="font-size:13px;color:var(--text-tertiary);font-weight:600;text-transform:uppercase;letter-spacing:0.05em;padding:8px 0 4px">${t('models_primary', data.lang)}</div>`

  for (const [prefix, labelKey, infoKey] of modelTasks) {
    h += modelDropdown(prefix, cv(data, prefix + '_PROVIDER') || 'anthropic', cv(data, prefix + '_MODEL'), models, data.lang, labelKey, infoKey)
  }
  h += `<div style="font-size:13px;color:var(--text-tertiary);font-weight:600;text-transform:uppercase;letter-spacing:0.05em;padding:16px 0 4px;border-top:1px solid var(--border-light);margin-top:8px">${t('models_fallback', data.lang)}</div>`
  for (const [prefix, labelKey, infoKey] of fallbackTasks) {
    h += modelDropdown(prefix, cv(data, prefix + '_PROVIDER') || 'anthropic', cv(data, prefix + '_MODEL'), models, data.lang, labelKey, infoKey)
  }

  // Embed allModels as JSON for client-side provider switching
  h += `<script type="application/json" id="models-data">${JSON.stringify(models)}</script>`

  return `<div class="panel"><div class="panel-body" style="border-top:none">${h}</div></div>`
}

export function renderLimitsSection(data: SectionData): string {
  return panelBody([
    numField('LLM_MAX_INPUT_TOKENS', cv(data, 'LLM_MAX_INPUT_TOKENS'), data.lang, 'f_LLM_MAX_INPUT_TOKENS'),
    numField('LLM_MAX_OUTPUT_TOKENS', cv(data, 'LLM_MAX_OUTPUT_TOKENS'), data.lang, 'f_LLM_MAX_OUTPUT_TOKENS'),
    numField('LLM_TEMPERATURE_CLASSIFY', cv(data, 'LLM_TEMPERATURE_CLASSIFY'), data.lang, 'f_LLM_TEMPERATURE_CLASSIFY', 'i_TEMPERATURE_CLASSIFY'),
    numField('LLM_TEMPERATURE_RESPOND', cv(data, 'LLM_TEMPERATURE_RESPOND'), data.lang, 'f_LLM_TEMPERATURE_RESPOND', 'i_TEMPERATURE_RESPOND'),
    numField('LLM_TEMPERATURE_COMPLEX', cv(data, 'LLM_TEMPERATURE_COMPLEX'), data.lang, 'f_LLM_TEMPERATURE_COMPLEX', 'i_TEMPERATURE_COMPLEX'),
    numField('LLM_REQUEST_TIMEOUT_MS', cv(data, 'LLM_REQUEST_TIMEOUT_MS'), data.lang, 'f_LLM_REQUEST_TIMEOUT_MS'),
  ])
}

export function renderCbSection(data: SectionData): string {
  return panelBody([
    numField('LLM_CIRCUIT_BREAKER_FAILURES', cv(data, 'LLM_CIRCUIT_BREAKER_FAILURES'), data.lang, 'f_LLM_CIRCUIT_BREAKER_FAILURES', 'i_LLM_CB_FAILURES'),
    numField('LLM_CIRCUIT_BREAKER_WINDOW_MS', cv(data, 'LLM_CIRCUIT_BREAKER_WINDOW_MS'), data.lang, 'f_LLM_CIRCUIT_BREAKER_WINDOW_MS', 'i_LLM_CB_WINDOW'),
    numField('LLM_CIRCUIT_BREAKER_COOLDOWN_MS', cv(data, 'LLM_CIRCUIT_BREAKER_COOLDOWN_MS'), data.lang, 'f_LLM_CIRCUIT_BREAKER_COOLDOWN_MS', 'i_LLM_CB_COOLDOWN'),
  ])
}

export function renderPipelineSection(data: SectionData): string {
  return panelBody([
    numField('PIPELINE_MAX_TOOL_CALLS_PER_TURN', cv(data, 'PIPELINE_MAX_TOOL_CALLS_PER_TURN'), data.lang, 'f_PIPELINE_MAX_TOOL_CALLS_PER_TURN', 'i_PIPELINE_TOOLS'),
    numField('PIPELINE_MAX_CONVERSATION_TURNS', cv(data, 'PIPELINE_MAX_CONVERSATION_TURNS'), data.lang, 'f_PIPELINE_MAX_CONVERSATION_TURNS', 'i_PIPELINE_TURNS'),
    numField('PIPELINE_SESSION_TTL_MS', cv(data, 'PIPELINE_SESSION_TTL_MS'), data.lang, 'f_PIPELINE_SESSION_TTL_MS', 'i_PIPELINE_TTL'),
    numField('SUBAGENT_MAX_ITERATIONS', cv(data, 'SUBAGENT_MAX_ITERATIONS') || '5', data.lang, 'f_SUBAGENT_MAX_ITERATIONS', 'i_SUBAGENT_ITER'),
    numField('PIPELINE_MAX_REPLAN_ATTEMPTS', cv(data, 'PIPELINE_MAX_REPLAN_ATTEMPTS') || '2', data.lang, 'f_PIPELINE_MAX_REPLAN_ATTEMPTS', 'i_PIPELINE_REPLAN'),
  ])
}

export function renderFollowupSection(data: SectionData): string {
  // SSR: render all fields always (unlike SPA which hid them when disabled)
  return panelBody([
    boolField('FOLLOWUP_ENABLED', cv(data, 'FOLLOWUP_ENABLED') || 'false', data.lang, 'f_FOLLOWUP_ENABLED'),
    numField('FOLLOWUP_DELAY_MINUTES', cv(data, 'FOLLOWUP_DELAY_MINUTES'), data.lang, 'f_FOLLOWUP_DELAY_MINUTES', 'i_FOLLOWUP_DELAY'),
    numField('FOLLOWUP_MAX_ATTEMPTS', cv(data, 'FOLLOWUP_MAX_ATTEMPTS'), data.lang, 'f_FOLLOWUP_MAX_ATTEMPTS', 'i_FOLLOWUP_MAX'),
    numField('FOLLOWUP_COLD_AFTER_ATTEMPTS', cv(data, 'FOLLOWUP_COLD_AFTER_ATTEMPTS'), data.lang, 'f_FOLLOWUP_COLD_AFTER_ATTEMPTS', 'i_FOLLOWUP_COLD'),
  ])
}

export function renderNaturalidadSection(data: SectionData): string {
  return panelBody([
    `<div class="field"><span class="field-label" style="font-weight:600;opacity:.7">${t('sub_ack_whatsapp', data.lang)}</span></div>`,
    numField('ACK_WHATSAPP_TRIGGER_MS', cv(data, 'ACK_WHATSAPP_TRIGGER_MS'), data.lang, 'f_ACK_WHATSAPP_TRIGGER_MS', 'i_ACK_WHATSAPP_TRIGGER_MS'),
    numField('ACK_WHATSAPP_HOLD_MS', cv(data, 'ACK_WHATSAPP_HOLD_MS'), data.lang, 'f_ACK_WHATSAPP_HOLD_MS', 'i_ACK_WHATSAPP_HOLD_MS'),
    textField('ACK_WHATSAPP_MESSAGE', cv(data, 'ACK_WHATSAPP_MESSAGE'), data.lang, 'f_ACK_WHATSAPP_MESSAGE', 'i_ACK_WHATSAPP_MESSAGE'),
    `<div class="field"><span class="field-label" style="font-weight:600;opacity:.7">${t('sub_ack_email', data.lang)}</span></div>`,
    numField('ACK_EMAIL_TRIGGER_MS', cv(data, 'ACK_EMAIL_TRIGGER_MS'), data.lang, 'f_ACK_EMAIL_TRIGGER_MS', 'i_ACK_EMAIL_TRIGGER_MS'),
    numField('ACK_EMAIL_HOLD_MS', cv(data, 'ACK_EMAIL_HOLD_MS'), data.lang, 'f_ACK_EMAIL_HOLD_MS', 'i_ACK_EMAIL_HOLD_MS'),
    textField('ACK_EMAIL_MESSAGE', cv(data, 'ACK_EMAIL_MESSAGE'), data.lang, 'f_ACK_EMAIL_MESSAGE', 'i_ACK_EMAIL_MESSAGE'),
  ])
}

export function renderLeadScoringSection(data: SectionData): string {
  return `<div class="panel">
    <div class="panel-header" onclick="window.location.href='/oficina/api/lead-scoring/ui'" style="cursor:pointer">
      <span class="panel-title">${t('sec_lead_scoring', data.lang)} <span class="panel-badge badge-active">${t('sec_lead_scoring_badge', data.lang)}</span></span>
      <span class="panel-chevron" style="transform:rotate(-90deg)">&#9660;</span>
    </div>
  </div>`
}

export function renderModulesSection(data: SectionData): string {
  return renderModulePanels(data.moduleStates ?? [], data.config, data.lang)
}

export function renderGoogleSection(data: SectionData): string {
  const ga = data.googleAuth ?? { connected: false, email: null }
  const modules = data.moduleStates ?? []

  const statusDot = ga.connected
    ? `<span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:var(--success);margin-right:6px"></span>`
    : `<span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:var(--error);margin-right:6px"></span>`

  const statusLabel = ga.connected
    ? `${statusDot}<span style="color:var(--success);font-weight:500">${t('googleConnected', data.lang)}</span>${ga.email ? ` — <span style="color:var(--text-secondary)">${esc(ga.email)}</span>` : ''}`
    : `${statusDot}<span style="color:var(--error);font-weight:500">${t('googleNotConnected', data.lang)}</span>`

  const gmailMod = modules.find(m => m.name === 'gmail')
  const sheetsMod = modules.find(m => m.name === 'google-apps' || m.name === 'google-sheets')
  const calendarMod = modules.find(m => m.name === 'google-calendar')
  const activeModules = [
    gmailMod?.active ? 'Gmail' : null,
    sheetsMod?.active ? 'Google Sheets' : null,
    calendarMod?.active ? 'Google Calendar' : null,
  ].filter(Boolean) as string[]

  const googleSvg = `<svg width="18" height="18" viewBox="0 0 18 18" style="vertical-align:middle;margin-right:8px" xmlns="http://www.w3.org/2000/svg">
    <path d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844c-.209 1.125-.843 2.078-1.796 2.717v2.258h2.908c1.702-1.567 2.684-3.875 2.684-6.615z" fill="#4285F4"/>
    <path d="M9 18c2.43 0 4.467-.806 5.956-2.18l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 0 0 9 18z" fill="#34A853"/>
    <path d="M3.964 10.71A5.41 5.41 0 0 1 3.682 9c0-.593.102-1.17.282-1.71V4.958H.957A8.996 8.996 0 0 0 0 9c0 1.452.348 2.827.957 4.042l3.007-2.332z" fill="#FBBC05"/>
    <path d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 0 0 .957 4.958L3.964 6.29C4.672 4.163 6.656 3.58 9 3.58z" fill="#EA4335"/>
  </svg>`

  return `<div class="panel">
    <div class="panel-body" style="border-top:none">
      <div class="panel-info">${t('googleAuthInfo', data.lang)}</div>

      <div style="display:flex;align-items:center;justify-content:space-between;padding:14px 0;border-bottom:1px solid var(--border-light)">
        <div style="font-size:15px">${statusLabel}</div>
        <button type="button" class="wa-btn" onclick="refreshGoogleStatus()" style="font-size:12px;padding:5px 12px;background:var(--bg-primary);color:var(--text-secondary);border:1px solid var(--border)">${t('googleRefreshStatus', data.lang)}</button>
      </div>

      <div style="padding:16px 0 8px;display:flex;gap:10px;flex-wrap:wrap">
        ${!ga.connected ? `
        <button type="button" class="wa-btn wa-btn-connect" onclick="googleConnect()" style="font-size:14px;padding:9px 20px">
          ${googleSvg}
          ${t('googleConnectBtn', data.lang)}
        </button>` : `
        <button type="button" class="wa-btn" onclick="googleDisconnect()" style="font-size:14px;padding:9px 20px;background:var(--error);color:#fff">
          ${t('googleDisconnectBtn', data.lang)}
        </button>`}
      </div>

      ${activeModules.length > 0 ? `
      <div style="margin-top:8px">
        <span style="font-size:12px;color:var(--text-tertiary);text-transform:uppercase;letter-spacing:0.05em;font-weight:600">${t('googleModulesTitle', data.lang)}: </span>
        ${activeModules.map(m => `<span class="panel-badge badge-active" style="margin-right:4px">${m}</span>`).join('')}
      </div>` : ''}
    </div>
  </div>`
}

export function renderComingSoonSection(data: SectionData): string {
  return `<div class="panel">
    <div class="panel-body" style="border-top:none;padding-top:20px">
      <span class="panel-badge badge-soon">${t('comingSoon', data.lang)}</span>
    </div>
  </div>`
}

export function renderDbSection(data: SectionData): string {
  return panelBody([
    textField('DB_HOST', cv(data, 'DB_HOST'), data.lang),
    textField('DB_PORT', cv(data, 'DB_PORT'), data.lang),
    textField('DB_NAME', cv(data, 'DB_NAME'), data.lang),
    textField('DB_USER', cv(data, 'DB_USER'), data.lang),
    secretField('DB_PASSWORD', cv(data, 'DB_PASSWORD'), data.lang),
  ])
}

export function renderRedisSection(data: SectionData): string {
  return panelBody([
    textField('REDIS_HOST', cv(data, 'REDIS_HOST'), data.lang),
    textField('REDIS_PORT', cv(data, 'REDIS_PORT'), data.lang),
    secretField('REDIS_PASSWORD', cv(data, 'REDIS_PASSWORD'), data.lang),
  ])
}

export function renderEngineMetricsSection(data: SectionData): string {
  const lang = data.lang
  const title = lang === 'en' ? 'Engine Performance' : 'Rendimiento del engine'
  const loading = lang === 'en' ? 'Loading metrics...' : 'Cargando métricas...'
  const periodLabel = lang === 'en' ? 'Period' : 'Periodo'
  // Headers
  const hTotal = lang === 'en' ? 'Executions' : 'Ejecuciones'
  const hReplan = lang === 'en' ? 'With replan' : 'Con replan'
  const hAvgReplan = lang === 'en' ? 'Avg replans' : 'Avg replans'
  const hMaxReplan = lang === 'en' ? 'Max replans' : 'Max replans'
  const hSubagent = lang === 'en' ? 'With subagent' : 'Con subagent'
  const hAvgSubIter = lang === 'en' ? 'Avg subagent iter' : 'Avg iter subagent'
  const hMaxSubIter = lang === 'en' ? 'Max subagent iter' : 'Max iter subagent'
  const hAvgMs = lang === 'en' ? 'Avg latency (ms)' : 'Latencia prom (ms)'
  const hP95 = lang === 'en' ? 'P95 latency (ms)' : 'Latencia P95 (ms)'
  const hTrends = lang === 'en' ? 'Daily Trends (30d)' : 'Tendencias diarias (30d)'
  const hDay = lang === 'en' ? 'Day' : 'Día'

  return `<div class="panel">
    <div class="panel-header"><span class="panel-title">${esc(title)}</span></div>
    <div class="panel-body">
      <div style="margin-bottom:12px">
        <label>${esc(periodLabel)}:
          <select id="metrics-period" style="margin-left:4px">
            <option value="24h">24h</option>
            <option value="7d">7d</option>
            <option value="30d">30d</option>
          </select>
        </label>
      </div>
      <div id="metrics-summary">${esc(loading)}</div>
      <table id="metrics-table" style="width:100%;border-collapse:collapse;display:none">
        <tr>
          <th>${esc(hTotal)}</th><th>${esc(hReplan)}</th><th>${esc(hAvgReplan)}</th><th>${esc(hMaxReplan)}</th>
          <th>${esc(hSubagent)}</th><th>${esc(hAvgSubIter)}</th><th>${esc(hMaxSubIter)}</th>
          <th>${esc(hAvgMs)}</th><th>${esc(hP95)}</th>
        </tr>
        <tbody id="metrics-summary-row"></tbody>
      </table>
      <h4 style="margin-top:16px">${esc(hTrends)}</h4>
      <table id="metrics-trends" style="width:100%;border-collapse:collapse;display:none">
        <tr>
          <th>${esc(hDay)}</th><th>${esc(hTotal)}</th><th>${esc(hAvgReplan)}</th>
          <th>${esc(hAvgSubIter)}</th><th>${esc(hAvgMs)}</th>
        </tr>
        <tbody id="metrics-trends-rows"></tbody>
      </table>
      <script>
      (function(){
        var sel=document.getElementById('metrics-period');
        function load(){
          var p=sel.value;
          fetch('/oficina/api/oficina/engine-metrics?period='+p)
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
            .catch(function(){document.getElementById('metrics-summary').textContent='Error loading metrics'});
        }
        function n(v){return v==null?'-':v}
        sel.addEventListener('change',load);
        load();
      })();
      </script>
    </div>
  </div>`
}

export function renderSection(section: string, data: SectionData): string | null {
  switch (section) {
    case 'whatsapp': return renderWhatsappSection(data)
    case 'apikeys': return renderApiKeysSection(data)
    case 'models': return renderModelsSection(data)
    case 'llm-limits': return renderLimitsSection(data)
    case 'llm-cb': return renderCbSection(data)
    case 'pipeline': return renderPipelineSection(data)
    case 'followup': return renderFollowupSection(data)
    case 'naturalidad': return renderNaturalidadSection(data)
    case 'lead-scoring': return renderLeadScoringSection(data)
    case 'engine-metrics': return renderEngineMetricsSection(data)
    case 'modules': return renderModulesSection(data)
    case 'db': return renderDbSection(data)
    case 'redis': return renderRedisSection(data)
    case 'google': return renderGoogleSection(data)
    case 'email': return renderComingSoonSection(data)
    default: return null
  }
}
