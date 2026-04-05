import { t } from './templates-i18n.js'
import { esc, textField, secretField, numField, boolField, modelDropdown } from './templates-fields.js'
import { cv, type SectionData } from './templates-section-data.js'

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

  // Panel 5: Rate limits per provider
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
  'gemini-2.5-flash-preview-tts': 'Flash 2.5 TTS',
  'gemini-2.5-pro-preview-tts': 'Pro 2.5 TTS',
  'gemini-2.0-flash-preview-tts': 'Flash 2.0 TTS',
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

/** Resolve current fallback provider+model for a task */
function resolveTaskFb(config: Record<string, string>, task: string, defProv: string, defModel: string): [string, string] {
  const k = task.toUpperCase()
  return [config[`LLM_${k}_FALLBACK_PROVIDER`] || defProv, config[`LLM_${k}_FALLBACK_MODEL`] || defModel]
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
  const fbVal = fbModel ? `${fbProvider}:${fbModel}` : ''

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

  // Fallback: combined optgroup select (opposite provider first)
  const fbAnthOpts = anthropicModels.map(m =>
    `<option value="anthropic:${esc(m)}" ${`anthropic:${m}` === fbVal ? 'selected' : ''}>${esc(mShort(m))}</option>`
  ).join('')
  const fbGooOpts = googleModels.map(m =>
    `<option value="google:${esc(m)}" ${`google:${m}` === fbVal ? 'selected' : ''}>${esc(mShort(m))}</option>`
  ).join('')

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
      <select class="js-custom-select mt-fb-sel" data-task="${task}" data-original="${esc(fbVal)}">
        <option value="">—</option>
        <optgroup label="Anthropic">${fbAnthOpts}</optgroup>
        <optgroup label="Google Gemini">${fbGooOpts}</optgroup>
      </select>
      <input type="hidden" name="LLM_${taskKey}_FALLBACK_PROVIDER" value="${esc(fbProvider)}" data-original="${esc(fbProvider)}">
      <input type="hidden" name="LLM_${taskKey}_FALLBACK_MODEL" value="${esc(fbModel)}" data-original="${esc(fbModel)}">
    </span>
  </div>`
}

/** Google-only specialized service row (TTS, embeddings, voice) with optional downgrade */
function renderSpecializedRow(
  label: string, configKey: string, currentModel: string,
  note: string, scannedGoogleModels: string[], extraModels: string[],
  downgradeConfigKey?: string, currentDowngradeModel?: string, downgradeExtraModels?: string[],
): string {
  const allModels = [...new Set([...extraModels, ...scannedGoogleModels])]
  const opts = allModels.map(m =>
    `<option value="${esc(m)}" ${m === currentModel ? 'selected' : ''}>${esc(mShort(m) || m)}</option>`
  ).join('')

  let downgradeCell = ''
  if (downgradeConfigKey !== undefined) {
    const dgModels = [...new Set([...(downgradeExtraModels ?? []), ...scannedGoogleModels])]
    const dgOpts = ['<option value="">—</option>',
      ...dgModels.map(m =>
        `<option value="${esc(m)}" ${m === currentDowngradeModel ? 'selected' : ''}>${esc(mShort(m) || m)}</option>`
      ),
    ].join('')
    downgradeCell = `<span class="mt-dg">
      <select class="js-custom-select" name="${esc(downgradeConfigKey)}" data-original="${esc(currentDowngradeModel ?? '')}">
        ${dgOpts}
      </select>
    </span>`
  }

  const gridStyle = downgradeConfigKey !== undefined
    ? 'style="grid-template-columns: 1.6fr 2fr 1.4fr"'
    : ''

  return `<div class="mt-row mt-row--special" data-task="${configKey}" ${gridStyle}>
    <span class="mt-task">${esc(label)}<span class="mt-task-note">${esc(note)}</span></span>
    <span class="mt-primary"${downgradeConfigKey === undefined ? ' style="grid-column:span 3"' : ''}>
      <span class="mt-fb-pill mt-fb-google" style="margin-right:8px"><span class="mt-fb-badge">G</span>Google</span>
      <select class="js-custom-select mt-special-sel" name="${esc(configKey)}" data-original="${esc(currentModel)}">
        ${opts}
      </select>
    </span>
    ${downgradeCell}
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

  // Task definitions grouped by function
  // [task, labelEs, labelEn, defPrimProv, defPrimModel, defDgProv, defDgModel, defFbProv, defFbModel]
  type TaskDef = [string, string, string, string, string, string, string, string, string]

  const GROUPS: Array<{ titleEs: string; titleEn: string; tasks: TaskDef[] }> = [
    {
      titleEs: 'Pipeline principal', titleEn: 'Main pipeline',
      tasks: [
        ['classify',     'Evaluador (Fase 2)',        'Evaluator (Phase 2)',      'anthropic', 'claude-sonnet-4-5-20250929', '',         '',                          'google',    'gemini-2.5-flash'],
        ['respond',      'Compositor (Fase 4)',       'Composer (Phase 4)',       'google',    'gemini-2.5-flash',           'google',   'gemini-2.5-flash-lite',     'anthropic', 'claude-sonnet-4-5-20250929'],
        ['complex',      'Tarea compleja (3+ pasos)', 'Complex task (3+ steps)',  'anthropic', 'claude-opus-4-5-20251101',   'anthropic','claude-sonnet-4-5-20250929','google',    'gemini-2.5-pro'],
        ['tools',        'Subagentes / Tools',        'Subagents / Tools',        'anthropic', 'claude-sonnet-4-5-20250929', '',         '',                          'google',    'gemini-2.5-flash'],
        ['criticize',    'Criticizer (calidad)',      'Criticizer (quality)',     'google',    'gemini-2.5-pro',             'google',   'gemini-2.5-flash',          'anthropic', 'claude-sonnet-4-5-20250929'],
      ],
    },
    {
      titleEs: 'Multimedia', titleEn: 'Multimedia',
      tasks: [
        ['vision',       'Visión / Archivos',         'Vision / Files',           'google',    'gemini-2.5-flash',           'google',   'gemini-2.5-flash-lite',     'anthropic', 'claude-sonnet-4-5-20250929'],
        ['web_search',   'Búsqueda web',              'Web search',               'google',    'gemini-2.5-flash',           'google',   'gemini-2.5-pro',            'anthropic', 'claude-sonnet-4-5-20250929'],
        ['document_read','Lectura de documentos',     'Document reading',         'anthropic', 'claude-sonnet-4-5-20250929', '',         '',                          'google',    'gemini-2.5-flash'],
      ],
    },
    {
      titleEs: 'Comunicación automática', titleEn: 'Automatic communication',
      tasks: [
        ['proactive',    'Mensaje proactivo',         'Proactive message',        'anthropic', 'claude-sonnet-4-5-20250929', '',         '',                          'google',    'gemini-2.5-flash'],
        ['ack',          'ACK (confirmación rápida)', 'ACK (quick confirmation)', 'anthropic', 'claude-haiku-4-5-20251001',  '',         '',                          'google',    'gemini-2.5-flash'],
      ],
    },
    {
      titleEs: 'Mantenimiento', titleEn: 'Maintenance',
      tasks: [
        ['compress',     'Compresión de sesiones',    'Session compression',      'anthropic', 'claude-haiku-4-5-20251001',  '',         '',                          'google',    'gemini-2.5-flash'],
        ['batch',        'Batch nocturno',            'Nightly batch',            'anthropic', 'claude-sonnet-4-5-20250929', '',         '',                          'google',    'gemini-2.5-flash'],
      ],
    },
  ]

  let rows = ''
  for (const group of GROUPS) {
    rows += `<div class="mt-group-header">${isEs ? group.titleEs : group.titleEn}</div>`
    for (const [task, lEs, lEn, dPP, dPM, dDP, dDM, dFP, dFM] of group.tasks) {
      const [pP, pM] = resolveTaskPrimary(cfg, task, dPP, dPM)
      const [dgP, dgM] = resolveTaskDg(cfg, task, dDP, dDM)
      const [fbP, fbM] = resolveTaskFb(cfg, task, dFP, dFM)
      rows += mtRow(task, isEs ? lEs : lEn, pP, pM, dgP, dgM, fbP, fbM, anthropicModels, googleModels)
    }
  }


  return `
  <div class="scan-bar">
    <button type="button" class="act-btn act-btn-config" onclick="triggerScan()">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
      ${isEs ? 'Escanear modelos' : 'Scan models'}
    </button>
    ${scanInfo}
  </div>
  ${scanReplacements}

  <div class="panel-info" style="margin:12px 0 14px 0">${isEs
    ? 'Estos modelos controlan subsistemas especializados como criticizer, subagentes, batch, vision y tareas proactivas. El loop agentico principal usa los modelos por esfuerzo del panel Motor Agentico.'
    : 'These models control specialized subsystems such as criticizer, subagents, batch, vision and proactive tasks. The main agentic loop uses the effort-based models in the Agentic Engine panel.'}</div>

  <div class="mt-table">
    <div class="mt-head">
      <span class="mt-col-task">${isEs ? 'Tarea' : 'Task'}</span>
      <span class="mt-col-primary">${isEs ? 'Modelo principal' : 'Primary model'}</span>
      <span class="mt-col-dg">${isEs ? 'Downgrade' : 'Downgrade'}</span>
      <span class="mt-col-fb">${isEs ? 'Fallback' : 'Fallback'}</span>
    </div>
    ${rows}
  </div>

  <div class="mt-group-header">${isEs ? 'Servicios especializados' : 'Specialized services'}</div>
  <div class="mt-special-info">${isEs ? 'Estos modelos son exclusivos de Google y se usan en servicios específicos.' : 'These models are Google-exclusive and used in specific services.'}</div>
  ${renderSpecializedRow('TTS', 'TTS_MODEL', cfg['TTS_MODEL'] || 'gemini-2.5-flash-preview-tts', isEs ? 'Síntesis de voz' : 'Text to speech', googleModels, [
    'gemini-2.5-flash-preview-tts',
    'gemini-2.5-pro-preview-tts',
  ], 'TTS_DOWNGRADE_MODEL', cfg['TTS_DOWNGRADE_MODEL'] || '', [
    'gemini-2.0-flash-preview-tts',
  ])}
  ${renderSpecializedRow(isEs ? 'Embeddings' : 'Embeddings', 'KNOWLEDGE_EMBEDDING_MODEL', cfg['KNOWLEDGE_EMBEDDING_MODEL'] || 'gemini-embedding-2-preview', isEs ? 'Vectorización de conocimiento' : 'Knowledge vectorization', googleModels, [
    'gemini-embedding-2-preview',
    'text-embedding-004',
  ])}
  ${renderSpecializedRow(isEs ? 'Voz (Live)' : 'Voice (Live)', 'VOICE_GEMINI_MODEL', cfg['VOICE_GEMINI_MODEL'] || 'gemini-2.5-flash', isEs ? 'Modelo para llamadas de voz en vivo' : 'Model for live voice calls', googleModels, [])}


  <script type="application/json" id="models-data">${JSON.stringify(data.allModels ?? {})}</script>`
}

export function renderAdvancedAgentSection(data: SectionData): string {
  const isEs = data.lang === 'es'
  let h = ''

  // Panel 1: API Keys - unified layout with group keys always visible
  h += `<div class="panel">
    <div class="panel-header" onclick="togglePanel(this)">
      <span class="panel-title">API Keys - LLM</span>
      <span class="panel-chevron">&#9660;</span>
    </div>
    <div class="panel-body">
      <div class="api-key-cols">
        <div class="api-key-col">
          <div class="api-key-col-hd api-key-col-hd--anthropic">Anthropic</div>
          ${secretField('ANTHROPIC_API_KEY', cv(data, 'ANTHROPIC_API_KEY'), data.lang,
            isEs ? 'API Key principal' : 'Main API Key',
            isEs ? 'Key principal de Anthropic. Usada para todas las llamadas si no hay key por grupo.' : 'Main Anthropic key. Used for all calls if no per-group key is set.')}
          <div class="adv-group-keys">
            <div class="api-key-group-divider">${isEs ? 'Por grupo de uso (opcional)' : 'Per usage group (optional)'}</div>
            ${secretField('LLM_ANTHROPIC_ENGINE_API_KEY', cv(data, 'LLM_ANTHROPIC_ENGINE_API_KEY'), data.lang,
              'Engine',
              isEs ? 'classify / tools / complex / proactive' : 'classify / tools / complex / proactive')}
            ${secretField('LLM_ANTHROPIC_CORTEX_API_KEY', cv(data, 'LLM_ANTHROPIC_CORTEX_API_KEY'), data.lang,
              'Cortex',
              isEs ? 'Pulse / Trace / Reflex' : 'Pulse / Trace / Reflex')}
            ${secretField('LLM_ANTHROPIC_MEMORY_API_KEY', cv(data, 'LLM_ANTHROPIC_MEMORY_API_KEY'), data.lang,
              isEs ? 'Memoria' : 'Memory',
              isEs ? 'compress / batch nocturno' : 'compress / nightly batch')}
          </div>
        </div>
        <div class="api-key-col">
          <div class="api-key-col-hd api-key-col-hd--google">Google Gemini</div>
          ${secretField('GOOGLE_AI_API_KEY', cv(data, 'GOOGLE_AI_API_KEY'), data.lang,
            isEs ? 'API Key principal' : 'Main API Key',
            isEs ? 'Key principal de Google AI. Usada para todas las llamadas si no hay key por grupo.' : 'Main Google AI key. Used for all calls if no per-group key is set.')}
          <div class="adv-group-keys">
            <div class="api-key-group-divider">${isEs ? 'Por grupo de uso (opcional)' : 'Per usage group (optional)'}</div>
            ${secretField('LLM_GOOGLE_ENGINE_API_KEY', cv(data, 'LLM_GOOGLE_ENGINE_API_KEY'), data.lang,
              'Engine',
              isEs ? 'compose / web_search' : 'compose / web_search')}
            ${secretField('LLM_GOOGLE_MULTIMEDIA_API_KEY', cv(data, 'LLM_GOOGLE_MULTIMEDIA_API_KEY'), data.lang,
              'Multimedia',
              isEs ? 'vision / STT / archivos' : 'vision / STT / files')}
            ${secretField('LLM_GOOGLE_VOICE_API_KEY', cv(data, 'LLM_GOOGLE_VOICE_API_KEY'), data.lang,
              isEs ? 'Voz' : 'Voice',
              isEs ? 'TTS / Gemini Live' : 'TTS / Gemini Live')}
            ${secretField('LLM_GOOGLE_KNOWLEDGE_API_KEY', cv(data, 'LLM_GOOGLE_KNOWLEDGE_API_KEY'), data.lang,
              'Knowledge',
              isEs ? 'embeddings / knowledge' : 'embeddings / knowledge')}
          </div>
        </div>
      </div>
    </div>
  </div>`

  h += `<div class="panel">
    <div class="panel-header" onclick="togglePanel(this)">
      <span class="panel-title">${isEs ? 'Uso de modelos' : 'Model assignment'}</span>
      <span class="panel-chevron">&#9660;</span>
    </div>
    <div class="panel-body">
      <div class="panel-info">${isEs
        ? 'Asigna que modelo usa cada tarea del motor. Principal es el modelo activo; Downgrade se activa si el circuit breaker del principal salta; Fallback cambia de proveedor.'
        : 'Assign which model each engine task uses. Primary is the active model; Downgrade activates if the primary circuit breaker trips; Fallback switches provider.'}</div>
      ${renderModelsTable(data, data.lang)}
    </div>
  </div>`

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

  const criticizerMode = cv(data, 'LLM_CRITICIZER_MODE') || 'complex_only'
  const maxTurns = cv(data, 'ENGINE_AGENTIC_MAX_TURNS') || '12'
  const sessionTtlMs = cv(data, 'PIPELINE_SESSION_TTL_MS') || '900000'
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
        ? 'Configuracion del loop agentico actual: limites operativos, routing por esfuerzo, verificacion de calidad y modelos por esfuerzo.'
        : 'Current agentic loop configuration: operational limits, effort routing, quality checks and effort-based models.'}</div>
      <div class="fields-row">
        ${numField('ENGINE_AGENTIC_MAX_TURNS', maxTurns, data.lang,
          isEs ? 'Max turnos agenticos' : 'Max agentic turns',
          isEs ? 'Limite maximo del loop agentico antes de forzar cierre o recuperacion.' : 'Maximum agentic loop limit before forcing close or recovery.')}
      </div>
      <div class="fields-row">
        ${numField('PIPELINE_SESSION_TTL_MS', sessionTtlMs, data.lang,
          isEs ? 'TTL de sesion (ms)' : 'Session TTL (ms)',
          isEs ? 'Tiempo maximo que se mantiene el lock/sesion activa antes de expirar.' : 'Maximum time the active lock/session is kept before it expires.')}
      </div>
      ${boolField('ENGINE_EFFORT_ROUTING', cv(data, 'ENGINE_EFFORT_ROUTING') || 'true', data.lang,
        isEs ? 'Enrutamiento por esfuerzo' : 'Effort routing',
        isEs ? 'Clasifica mensajes por complejidad para usar el modelo mas apropiado y optimizar costos.' : 'Classifies messages by complexity to use the most appropriate model and optimize costs.')}
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
    </div>
  </div>`

  // Panel 6: Business Hours
  const bhStart = cv(data, 'ENGINE_BUSINESS_HOURS_START') || '8'
  const bhEnd = cv(data, 'ENGINE_BUSINESS_HOURS_END') || '17'
  const bhDays = cv(data, 'ENGINE_BUSINESS_DAYS') || '1,2,3,4,5'

  h += `<div class="panel">
    <div class="panel-header" onclick="togglePanel(this)">
      <span class="panel-title">${isEs ? 'Horario Laboral' : 'Business Hours'}</span>
      <span class="panel-chevron">&#9660;</span>
    </div>
    <div class="panel-body">
      <div class="panel-info">${isEs
        ? 'Rango de horas permitidas para contactar clientes proactivamente. La zona horaria se toma del pais del agente (identidad). Para clientes internacionales, el sistema detecta su pais por telefono y aplica el mismo rango en su zona horaria local.'
        : 'Allowed hours for proactive client contact. Timezone defaults from agent country (identity). For international clients, the system detects their country by phone and applies the same range in their local timezone.'}</div>
      <div class="two-col">
        <div class="field">
          <div class="field-left"><span class="field-label">${isEs ? 'Hora de inicio' : 'Start hour'}</span></div>
          <input type="text" inputmode="numeric" name="ENGINE_BUSINESS_HOURS_START" value="${esc(bhStart)}" data-original="${esc(bhStart)}" placeholder="8" style="width:80px">
          <span style="font-size:12px;color:var(--on-surface-dim);margin-left:6px">:00</span>
        </div>
        <div class="field">
          <div class="field-left"><span class="field-label">${isEs ? 'Hora de cierre' : 'End hour'}</span></div>
          <input type="text" inputmode="numeric" name="ENGINE_BUSINESS_HOURS_END" value="${esc(bhEnd)}" data-original="${esc(bhEnd)}" placeholder="17" style="width:80px">
          <span style="font-size:12px;color:var(--on-surface-dim);margin-left:6px">:00</span>
        </div>
      </div>
      <div class="field" style="margin-top:8px">
        <div class="field-left"><span class="field-label">${isEs ? 'Dias laborales' : 'Business days'}</span></div>
        <div class="bh-days" style="display:flex;gap:6px;margin-top:4px">
          ${[
            { d: 0, l: isEs ? 'Dom' : 'Sun' },
            { d: 1, l: isEs ? 'Lun' : 'Mon' },
            { d: 2, l: isEs ? 'Mar' : 'Tue' },
            { d: 3, l: isEs ? 'Mie' : 'Wed' },
            { d: 4, l: isEs ? 'Jue' : 'Thu' },
            { d: 5, l: isEs ? 'Vie' : 'Fri' },
            { d: 6, l: isEs ? 'Sab' : 'Sat' },
          ].map(({ d, l }) => {
            const active = bhDays.split(',').map(s => s.trim()).includes(String(d))
            return `<button type="button" class="bh-day-btn${active ? ' bh-day-btn--active' : ''}" data-day="${d}" onclick="toggleBhDay(this)">${l}</button>`
          }).join('')}
        </div>
        <input type="hidden" name="ENGINE_BUSINESS_DAYS" id="bh-days-input" value="${esc(bhDays)}" data-original="${esc(bhDays)}">
      </div>
    </div>
  </div>`

  // Panel 7: Proactive Settings (reference to proactive.json)
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

export function renderIdentitySection(data: SectionData): string {
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

  // Persona header preview (auto-prepended to the identity prompt)
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

export function renderVoiceTTSSection(data: SectionData): string {
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

export function renderDashboardSection(data: SectionData): string {
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

export function renderMemorySection(data: SectionData): string {
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
