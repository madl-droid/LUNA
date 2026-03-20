// fields.js — Field builder functions for form rendering
// Depends on: i18n (t), state (currentValues, originalValues, allModels), utils (esc)

function textField(key, labelKey, infoKey) {
  const label = labelKey ? t(labelKey) : key
  const val = esc(currentValues[key] ?? '')
  const mod = currentValues[key] !== (originalValues[key] ?? '') ? ' modified' : ''
  let info = infoKey ? infoTooltip(key, infoKey) : ''
  return `<div class="field"><div class="field-left"><span class="field-label">${label}</span>${infoKey ? infoBtn(key) : ''}</div>
    <input type="text" data-key="${key}" value="${val}" oninput="onChange(this)" class="${mod}"></div>${info}`
}

function secretField(key, labelKey, infoKey) {
  const label = labelKey ? t(labelKey) : key
  const val = esc(currentValues[key] ?? '')
  const mod = currentValues[key] !== (originalValues[key] ?? '') ? ' modified' : ''
  let info = infoKey ? infoTooltip(key, infoKey) : ''
  return `<div class="field"><div class="field-left"><span class="field-label">${label}</span>${infoKey ? infoBtn(key) : ''}</div>
    <input type="password" data-key="${key}" value="${val}" oninput="onChange(this)" class="${mod}"></div>${info}`
}

function numField(key, labelKey, infoKey) {
  const label = labelKey ? t(labelKey) : key
  const val = esc(currentValues[key] ?? '')
  const mod = currentValues[key] !== (originalValues[key] ?? '') ? ' modified' : ''
  let info = infoKey ? infoTooltip(key, infoKey) : ''
  return `<div class="field"><div class="field-left"><span class="field-label">${label}</span>${infoKey ? infoBtn(key) : ''}</div>
    <input type="text" data-key="${key}" value="${val}" oninput="onChange(this)" class="${mod}"></div>${info}`
}

function boolField(key, labelKey) {
  const label = labelKey ? t(labelKey) : key
  const val = (currentValues[key] ?? 'false') === 'true'
  return `<div class="toggle-field">
    <span class="field-label">${label}</span>
    <label class="toggle"><input type="checkbox" data-key="${key}" ${val ? 'checked' : ''} onchange="onToggle(this)"><span class="toggle-slider"></span></label>
  </div>`
}

function selectField(key, label, options) {
  const val = currentValues[key] ?? ''
  const mod = currentValues[key] !== (originalValues[key] ?? '') ? ' modified' : ''
  const opts = options.map(o => `<option value="${esc(o.value)}" ${o.value === val ? 'selected' : ''}>${esc(o.label?.[lang] || o.label?.es || o.value)}</option>`).join('')
  return `<div class="field"><div class="field-left"><span class="field-label">${esc(label)}</span></div>
    <select data-key="${key}" onchange="onChange(this)" class="${mod}">${opts}</select></div>`
}

// Model name display mapping
const MODEL_NAMES = {
  'claude-haiku-4-5-20251001': 'Haiku 4.5',
  'claude-sonnet-4-5-20250929': 'Sonnet 4.5',
  'claude-sonnet-4-6': 'Sonnet 4.6',
  'claude-opus-4-5-20251101': 'Opus 4.5',
  'claude-opus-4-6': 'Opus 4.6',
  'claude-sonnet-4-20250514': 'Sonnet 4',
  'claude-opus-4-20250514': 'Opus 4',
  'claude-opus-4-1-20250805': 'Opus 4.1',
  'gemini-2.5-flash': 'Flash 2.5',
  'gemini-2.5-pro': 'Pro 2.5',
  'gemini-2.0-flash': 'Flash 2.0',
  'gemini-1.5-pro': 'Pro 1.5',
  'gemini-1.5-flash': 'Flash 1.5',
}

function modelLabel(id) { return MODEL_NAMES[id] || id }

function modelDropdown(prefix, labelKey, infoKey) {
  const providerKey = prefix + '_PROVIDER'
  const modelKey = prefix + '_MODEL'
  const curProvider = currentValues[providerKey] ?? 'anthropic'
  const curModel = currentValues[modelKey] ?? ''
  const label = t(labelKey)
  const providers = ['anthropic', 'google']
  const models = allModels[curProvider === 'google' ? 'gemini' : curProvider] || []

  let providerOpts = providers.map(p => `<option value="${p}" ${p === curProvider ? 'selected' : ''}>${p}</option>`).join('')
  let modelOpts = models.map(m => `<option value="${m}" ${m === curModel ? 'selected' : ''}>${modelLabel(m)}</option>`).join('')
  // Add current model if not in list
  if (curModel && !models.includes(curModel)) {
    modelOpts = `<option value="${curModel}" selected>${modelLabel(curModel)}</option>` + modelOpts
  }

  return `<div class="field">
    <div class="field-left"><span class="field-label">${label}</span>${infoKey ? infoBtn(prefix) : ''}</div>
    <div class="model-row">
      <select data-key="${providerKey}" onchange="onProviderChange('${prefix}', this)">${providerOpts}</select>
      <select data-key="${modelKey}" onchange="onChange(this)">${modelOpts}</select>
    </div>
  </div>${infoKey ? infoTooltip(prefix, infoKey) : ''}`
}

// Info button & tooltip
function infoBtn(id) {
  return ` <button class="info-btn" onclick="event.stopPropagation();toggleInfo('info-${id}')">i</button>`
}

function infoTooltip(id, key) {
  return `<div class="info-tooltip" id="info-${id}">${t(key)}</div>`
}

function toggleInfo(id) {
  const el = document.getElementById(id)
  if (el) el.classList.toggle('visible')
}
