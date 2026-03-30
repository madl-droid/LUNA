// templates-fields.ts — Server-side field builders (migrated from ui/js/fields.js)

import { t, type Lang } from './templates-i18n.js'
import type { ConsoleField } from '../../kernel/types.js'

export function esc(s: string): string {
  return String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;')
}

export function textField(key: string, value: string, lang: Lang, labelKey?: string, infoKey?: string): string {
  const label = labelKey ? t(labelKey, lang) : key
  const tip = infoKey ? infoBtnWithTip(key, t(infoKey, lang)) : ''
  return `<div class="field"><div class="field-left"><span class="field-label">${label}</span>${tip}</div>
    <input type="text" name="${key}" value="${esc(value)}" data-original="${esc(value)}"></div>`
}

export function secretField(key: string, value: string, lang: Lang, labelKey?: string, infoKey?: string): string {
  const label = labelKey ? t(labelKey, lang) : key
  const tip = infoKey ? infoBtnWithTip(key, t(infoKey, lang)) : ''
  return `<div class="field"><div class="field-left"><span class="field-label">${label}</span>${tip}</div>
    <input type="password" name="${key}" value="${esc(value)}" data-original="${esc(value)}"></div>`
}

export function numField(key: string, value: string, lang: Lang, labelKey?: string, infoKey?: string): string {
  const label = labelKey ? t(labelKey, lang) : key
  const tip = infoKey ? infoBtnWithTip(key, t(infoKey, lang)) : ''
  return `<div class="field"><div class="field-left"><span class="field-label">${label}</span>${tip}</div>
    <input type="text" inputmode="numeric" name="${key}" value="${esc(value)}" data-original="${esc(value)}"></div>`
}

export function boolField(key: string, value: string, lang: Lang, labelKey?: string, infoKey?: string): string {
  const label = labelKey ? t(labelKey, lang) : key
  const tip = infoKey ? infoBtnWithTip(key, t(infoKey, lang)) : ''
  const checked = value === 'true'
  return `<div class="toggle-field">
    <span class="field-label">${label}</span>${tip}
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
  const tip = infoKey ? infoBtnWithTip(key, t(infoKey, lang)) : ''
  return `<div class="field"><div class="field-left"><span class="field-label">${label}</span>${tip}</div>
    <textarea name="${key}" data-original="${esc(value)}">${esc(value)}</textarea></div>`
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
  const tip = infoKey ? infoBtnWithTip(prefix, t(infoKey, lang)) : ''

  return `<div class="field">
    <div class="field-left"><span class="field-label">${label}</span>${tip}</div>
    <div class="model-row">
      <select name="${providerKey}" data-original="${esc(providerValue)}" data-model-provider="${prefix}">${providerOpts}</select>
      <select name="${modelKey}" data-original="${esc(modelValue)}" data-model-select="${prefix}">${modelOpts}</select>
    </div>
  </div>`
}

/** (i) button + hover tooltip, wrapped in a positioned container */
function infoBtnWithTip(id: string, text: string): string {
  return ` <span class="info-wrap"><button class="info-btn">i</button><div class="info-tooltip" id="info-${id}">${text}</div></span>`
}

// --- New field types (Phase 1) ---

export function dividerField(label: string): string {
  return `<div class="field-divider"><span class="field-divider-label">${esc(label)}</span></div>`
}

export function readonlyField(_key: string, value: string, label: string): string {
  return `<div class="field"><div class="field-left"><span class="field-label">${esc(label)}</span></div>
    <span class="field-readonly">${esc(value)}</span></div>`
}

export function tagsField(key: string, value: string, lang: Lang, label: string, separator = ',', tip = ''): string {
  const tags = value ? value.split(separator).map(t => t.trim()).filter(Boolean) : []
  const tagsHtml = tags.map(tag =>
    `<span class="field-tag">${esc(tag)}<button type="button" class="field-tag-remove" data-tag-key="${esc(key)}" data-tag-value="${esc(tag)}">&times;</button></span>`
  ).join('')
  return `<div class="field"><div class="field-left"><span class="field-label">${esc(label)}</span>${tip}</div>
    <div class="field-tags-wrap">
      <div class="field-tags" data-tags-for="${esc(key)}">${tagsHtml}</div>
      <input type="text" class="field-tag-input" data-tag-add="${esc(key)}" placeholder="${t('fieldTagsAdd', lang)}">
      <input type="hidden" name="${esc(key)}" value="${esc(value)}" data-original="${esc(value)}" data-separator="${esc(separator)}">
    </div>
  </div>`
}

export function durationField(key: string, value: string, lang: Lang, label: string, unit = 'ms', info?: { es: string; en: string } | string, lang2?: Lang): string {
  // Support both old (infoKey string for i18n lookup) and new (info object) patterns
  let tip = ''
  if (typeof info === 'string') {
    tip = infoBtnWithTip(key, t(info, lang))
  } else if (info && lang2) {
    tip = infoBtnWithTip(key, esc(info[lang2] || info['es'] || ''))
  }
  return `<div class="field"><div class="field-left"><span class="field-label">${esc(label)}</span>${tip}</div>
    <div class="field-duration">
      <input type="text" inputmode="numeric" name="${esc(key)}" value="${esc(value)}" data-original="${esc(value)}">
      <span class="field-duration-unit">${esc(unit)}</span>
    </div>
  </div>`
}

/** Render a field-left with label + optional (i) hover tooltip */
function fieldLeft(key: string, label: string, info?: { es: string; en: string }, lang?: Lang): string {
  const infoHtml = info && lang ? infoBtnWithTip(key, esc(info[lang] || info['es'] || '')) : ''
  return `<div class="field-left"><span class="field-label">${esc(label)}</span>${infoHtml}</div>`
}

/** Render a generic input field directly (no string replacement) */
function directField(key: string, value: string, label: string, inputType: string, info?: { es: string; en: string }, lang?: Lang): string {
  const inputMode = inputType === 'number' ? ' inputmode="numeric"' : ''
  const type = inputType === 'number' ? 'text' : inputType
  return `<div class="field">${fieldLeft(key, label, info, lang)}
    <input type="${type}"${inputMode} name="${key}" value="${esc(value)}" data-original="${esc(value)}"></div>`
}

/** Volume selector — range input with min/max labels and current value */
export function volumeField(key: string, value: string, label: string, opts: {
  min: number; max: number; step: number; unit?: string;
  minLabel?: string; maxLabel?: string;
  info?: { es: string; en: string }; lang?: Lang;
}): string {
  const numVal = Number(value) || opts.min
  const tip = opts.info && opts.lang ? infoBtnWithTip(key, esc(opts.info[opts.lang] || opts.info['es'] || '')) : ''
  const displayVal = opts.unit ? `${numVal} ${opts.unit}` : String(numVal)
  const minLabel = opts.minLabel || String(opts.min)
  const maxLabel = opts.maxLabel || String(opts.max)
  return `<div class="field"><div class="field-left"><span class="field-label">${esc(label)}</span>${tip}</div>
    <div class="volume-selector">
      <span class="volume-selector-label vol-min">${esc(minLabel)}</span>
      <div class="volume-selector-track">
        <input type="range" class="volume-selector-input" name="${esc(key)}" value="${numVal}" min="${opts.min}" max="${opts.max}" step="${opts.step}" data-original="${esc(value)}" data-vol-display="${esc(key)}-display" data-vol-unit="${esc(opts.unit || '')}">
      </div>
      <span class="volume-selector-label vol-max">${esc(maxLabel)}</span>
      <span class="volume-selector-value" id="${esc(key)}-display">${esc(displayVal)}</span>
    </div>
  </div>`
}

/** Code editor — monospace textarea with line numbers and header bar */
export function codeEditorField(key: string, value: string, title: string, opts?: {
  readonly?: boolean; placeholder?: string;
}): string {
  const lines = (value || '').split('\n')
  const lineNums = lines.map((_, i) => `<span class="code-editor-line-num">${i + 1}</span>`).join('')
  const readonly = opts?.readonly ? ' disabled' : ''
  const placeholder = opts?.placeholder ? ` placeholder="${esc(opts.placeholder)}"` : ''
  return `<div class="code-editor">
    <div class="code-editor-header">
      <div class="code-editor-header-left">
        <svg class="code-editor-header-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg>
        <span>${esc(title)}</span>
      </div>
      <span class="code-editor-pos" data-ce-pos="${esc(key)}">LN 1, COL 1</span>
    </div>
    <div class="code-editor-body">
      <div class="code-editor-lines" data-ce-lines="${esc(key)}">${lineNums}</div>
      <textarea class="code-editor-textarea" name="${esc(key)}" data-original="${esc(value)}" data-ce-key="${esc(key)}"${readonly}${placeholder}>${esc(value)}</textarea>
    </div>
  </div>`
}

export function renderConsoleField(field: ConsoleField, value: string, lang: Lang): string {
  const label = field.label ? (field.label[lang] || field.label['es'] || field.key) : field.key
  const info = field.info ?? field.description
  const tip = info ? infoBtnWithTip(field.key, esc(info[lang] || info['es'] || '')) : ''

  switch (field.type) {
    case 'divider': return dividerField(label)
    case 'readonly':
      return `<div class="field"><div class="field-left"><span class="field-label">${esc(label)}</span>${tip}</div>
        <span class="field-readonly">${esc(value)}</span></div>`
    case 'tags':
      return tagsField(field.key, value, lang, label, field.separator, tip)
    case 'duration': return durationField(field.key, value, lang, label, field.unit || 'ms', info, lang)
    case 'secret':
      return `<div class="field">${fieldLeft(field.key, label, info, lang)}
        <input type="password" name="${field.key}" value="${esc(value)}" data-original="${esc(value)}"></div>`
    case 'boolean': {
      const checked = value === 'true'
      return `<div class="toggle-field">
        <span class="field-label">${esc(label)}</span>${tip}
        <label class="toggle"><input type="checkbox" name="${field.key}" value="true" ${checked ? 'checked' : ''} data-original="${esc(value)}"><span class="toggle-slider"></span></label>
        <input type="hidden" name="${field.key}" value="${checked ? 'true' : 'false'}" data-original="${esc(value)}">
      </div>`
    }
    case 'number':
      return field.unit
        ? durationField(field.key, value, lang, label, field.unit, info, lang)
        : directField(field.key, value, label, 'number', info, lang)
    case 'select': {
      const opts = field.options ?? []
      const optionsHtml = opts.map(o => {
        const optLabel = typeof o.label === 'object' ? ((o.label as Record<string, string>)[lang] || (o.label as Record<string, string>)['es'] || o.value) : (o.label || o.value)
        return `<option value="${esc(o.value)}" ${o.value === value ? 'selected' : ''}>${esc(optLabel)}</option>`
      }).join('')
      return `<div class="field"><div class="field-left"><span class="field-label">${esc(label)}</span>${tip}</div>
        <select name="${field.key}" data-original="${esc(value)}">${optionsHtml}</select></div>`
    }
    case 'textarea': {
      if ((field as unknown as Record<string, unknown>).fieldType === 'code-editor') {
        return codeEditorField(field.key, value, label)
      }
      const rows = field.rows ? ` rows="${field.rows}"` : ''
      return `<div class="field">${fieldLeft(field.key, label, info, lang)}
        <textarea name="${field.key}" data-original="${esc(value)}"${rows}>${esc(value)}</textarea></div>`
    }
    case 'model-select':
      return directField(field.key, value, label, 'text', info, lang)
    default:
      return directField(field.key, value, label, 'text', info, lang)
  }
}
