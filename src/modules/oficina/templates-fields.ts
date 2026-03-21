// templates-fields.ts — Server-side field builders (migrated from ui/js/fields.js)

import { t, type Lang } from './templates-i18n.js'
import type { OficinaField } from '../../kernel/types.js'

export function esc(s: string): string {
  return String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;')
}

export function textField(key: string, value: string, lang: Lang, labelKey?: string, infoKey?: string): string {
  const label = labelKey ? t(labelKey, lang) : key
  const info = infoKey ? `${infoBtn(key)}` : ''
  const tooltip = infoKey ? infoTooltip(key, infoKey, lang) : ''
  return `<div class="field"><div class="field-left"><span class="field-label">${label}</span>${info}</div>
    <input type="text" name="${key}" value="${esc(value)}" data-original="${esc(value)}"></div>${tooltip}`
}

export function secretField(key: string, value: string, lang: Lang, labelKey?: string, infoKey?: string): string {
  const label = labelKey ? t(labelKey, lang) : key
  const info = infoKey ? `${infoBtn(key)}` : ''
  const tooltip = infoKey ? infoTooltip(key, infoKey, lang) : ''
  return `<div class="field"><div class="field-left"><span class="field-label">${label}</span>${info}</div>
    <input type="password" name="${key}" value="${esc(value)}" data-original="${esc(value)}"></div>${tooltip}`
}

export function numField(key: string, value: string, lang: Lang, labelKey?: string, infoKey?: string): string {
  const label = labelKey ? t(labelKey, lang) : key
  const info = infoKey ? `${infoBtn(key)}` : ''
  const tooltip = infoKey ? infoTooltip(key, infoKey, lang) : ''
  return `<div class="field"><div class="field-left"><span class="field-label">${label}</span>${info}</div>
    <input type="text" inputmode="numeric" name="${key}" value="${esc(value)}" data-original="${esc(value)}"></div>${tooltip}`
}

export function boolField(key: string, value: string, lang: Lang, labelKey?: string): string {
  const label = labelKey ? t(labelKey, lang) : key
  const checked = value === 'true'
  return `<div class="toggle-field">
    <span class="field-label">${label}</span>
    <label class="toggle"><input type="checkbox" name="${key}" value="true" ${checked ? 'checked' : ''} data-original="${esc(value)}"><span class="toggle-slider"></span></label>
    <input type="hidden" name="${key}" value="${checked ? 'true' : 'false'}" data-original="${esc(value)}">
  </div>`
}

export function selectField(key: string, value: string, options: Array<{value: string; label: string | Record<string, string>}>, lang: Lang, labelStr?: string): string {
  const optionsHtml = options.map(o => {
    const optLabel = typeof o.label === 'object' ? ((o.label as Record<string, string>)[lang] || (o.label as Record<string, string>)['es'] || o.value) : (o.label || o.value)
    return `<option value="${esc(o.value)}" ${o.value === value ? 'selected' : ''}>${esc(optLabel)}</option>`
  }).join('')
  return `<div class="field"><div class="field-left"><span class="field-label">${esc(labelStr ?? key)}</span></div>
    <select name="${key}" data-original="${esc(value)}">${optionsHtml}</select></div>`
}

export function textareaField(key: string, value: string, lang: Lang, labelKey?: string, infoKey?: string): string {
  const label = labelKey ? t(labelKey, lang) : key
  const info = infoKey ? `${infoBtn(key)}` : ''
  const tooltip = infoKey ? infoTooltip(key, infoKey, lang) : ''
  return `<div class="field"><div class="field-left"><span class="field-label">${label}</span>${info}</div>
    <textarea name="${key}" data-original="${esc(value)}">${esc(value)}</textarea></div>${tooltip}`
}

const MODEL_NAMES: Record<string, string> = {
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

function modelLabel(id: string): string { return MODEL_NAMES[id] || id }

export function modelDropdown(
  prefix: string, providerValue: string, modelValue: string,
  allModels: Record<string, string[]>, lang: Lang,
  labelKey?: string, infoKey?: string,
): string {
  const label = labelKey ? t(labelKey, lang) : prefix
  const providers = ['anthropic', 'google']
  const models = allModels[providerValue === 'google' ? 'gemini' : providerValue] || []

  const providerOpts = providers.map(p =>
    `<option value="${p}" ${p === providerValue ? 'selected' : ''}>${p}</option>`
  ).join('')

  let modelOpts = models.map(m =>
    `<option value="${m}" ${m === modelValue ? 'selected' : ''}>${modelLabel(m)}</option>`
  ).join('')
  if (modelValue && !models.includes(modelValue)) {
    modelOpts = `<option value="${modelValue}" selected>${modelLabel(modelValue)}</option>` + modelOpts
  }

  const providerKey = prefix + '_PROVIDER'
  const modelKey = prefix + '_MODEL'
  const info = infoKey ? infoBtn(prefix) : ''
  const tooltip = infoKey ? infoTooltip(prefix, infoKey, lang) : ''

  return `<div class="field">
    <div class="field-left"><span class="field-label">${label}</span>${info}</div>
    <div class="model-row">
      <select name="${providerKey}" data-original="${esc(providerValue)}" data-model-provider="${prefix}">${providerOpts}</select>
      <select name="${modelKey}" data-original="${esc(modelValue)}" data-model-select="${prefix}">${modelOpts}</select>
    </div>
  </div>${tooltip}`
}

function infoBtn(id: string): string {
  return ` <button class="info-btn" onclick="event.stopPropagation();toggleInfo('info-${id}')">i</button>`
}

function infoTooltip(id: string, key: string, lang: Lang): string {
  return `<div class="info-tooltip" id="info-${id}">${t(key, lang)}</div>`
}

// --- New field types (Phase 1) ---

export function dividerField(label: string): string {
  return `<div class="field-divider"><span class="field-divider-label">${esc(label)}</span></div>`
}

export function readonlyField(key: string, value: string, label: string): string {
  return `<div class="field"><div class="field-left"><span class="field-label">${esc(label)}</span></div>
    <span class="field-readonly">${esc(value)}</span></div>`
}

export function tagsField(key: string, value: string, lang: Lang, label: string, separator = ','): string {
  const tags = value ? value.split(separator).map(t => t.trim()).filter(Boolean) : []
  const tagsHtml = tags.map(tag =>
    `<span class="field-tag">${esc(tag)}<button type="button" class="field-tag-remove" data-tag-key="${esc(key)}" data-tag-value="${esc(tag)}">&times;</button></span>`
  ).join('')
  return `<div class="field"><div class="field-left"><span class="field-label">${esc(label)}</span></div>
    <div class="field-tags-wrap">
      <div class="field-tags" data-tags-for="${esc(key)}">${tagsHtml}</div>
      <input type="text" class="field-tag-input" data-tag-add="${esc(key)}" placeholder="${t('fieldTagsAdd', lang)}">
      <input type="hidden" name="${esc(key)}" value="${esc(value)}" data-original="${esc(value)}" data-separator="${esc(separator)}">
    </div>
  </div>`
}

export function durationField(key: string, value: string, lang: Lang, label: string, unit = 'ms', infoKey?: string): string {
  const info = infoKey ? infoBtn(key) : ''
  const tooltip = infoKey ? infoTooltip(key, infoKey, lang) : ''
  return `<div class="field"><div class="field-left"><span class="field-label">${esc(label)}</span>${info}</div>
    <div class="field-duration">
      <input type="text" inputmode="numeric" name="${esc(key)}" value="${esc(value)}" data-original="${esc(value)}">
      <span class="field-duration-unit">${esc(unit)}</span>
    </div>
  </div>${tooltip}`
}

export function renderOficinaField(field: OficinaField, value: string, lang: Lang): string {
  const label = field.label ? (field.label[lang] || field.label['es'] || field.key) : field.key
  const infoId = field.info ? field.key : undefined
  const infoHtml = field.info ? infoBtn(field.key) : ''
  const tooltipHtml = field.info ? infoTooltip(field.key, '', lang).replace(`>${t('', lang)}<`, `>${field.info[lang] || field.info['es'] || ''}<`) : ''

  // Helper to add info button to field-left and tooltip after
  const withInfo = (html: string) => {
    if (!field.info) return html
    // Insert info button after field-label span
    const labelEnd = html.indexOf('</span>')
    if (labelEnd === -1) return html
    const afterLabel = labelEnd + '</span>'.length
    const withBtn = html.slice(0, afterLabel) + infoHtml + html.slice(afterLabel)
    // Add tooltip div at end
    return withBtn + `<div class="info-tooltip" id="info-${field.key}">${esc(field.info[lang] || field.info['es'] || '')}</div>`
  }

  switch (field.type) {
    case 'divider': return dividerField(label)
    case 'readonly': return readonlyField(field.key, value, label)
    case 'tags': return tagsField(field.key, value, lang, label, field.separator)
    case 'duration': return durationField(field.key, value, lang, label, field.unit || 'ms', infoId)
    case 'secret': return withInfo(secretField(field.key, value, lang, undefined, undefined).replace('class="field-label">' + field.key, 'class="field-label">' + esc(label)))
    case 'boolean': return withInfo(boolField(field.key, value, lang, undefined).replace('class="field-label">' + field.key, 'class="field-label">' + esc(label)))
    case 'number': {
      const numHtml = field.unit
        ? durationField(field.key, value, lang, label, field.unit, infoId)
        : withInfo(numField(field.key, value, lang, undefined, undefined).replace('class="field-label">' + field.key, 'class="field-label">' + esc(label)))
      return numHtml
    }
    case 'select': return withInfo(selectField(field.key, value, field.options ?? [], lang, label))
    case 'textarea': return withInfo(textareaField(field.key, value, lang, undefined, undefined).replace('class="field-label">' + field.key, 'class="field-label">' + esc(label)))
    case 'model-select': return withInfo(textField(field.key, value, lang, undefined, undefined).replace('class="field-label">' + field.key, 'class="field-label">' + esc(label)))
    default: return withInfo(textField(field.key, value, lang, undefined, undefined).replace('class="field-label">' + field.key, 'class="field-label">' + esc(label)))
  }
}
