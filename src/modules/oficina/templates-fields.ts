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

export function renderOficinaField(field: OficinaField, value: string, lang: Lang): string {
  const label = field.label ? (field.label[lang] || field.label['es'] || field.key) : field.key
  // field.info available for future tooltip support on dynamic fields
  const replaceLabel = (html: string) => html.replace('class="field-label">' + field.key, 'class="field-label">' + esc(label))
  switch (field.type) {
    case 'secret': return replaceLabel(secretField(field.key, value, lang))
    case 'boolean': return replaceLabel(boolField(field.key, value, lang))
    case 'number': return replaceLabel(numField(field.key, value, lang))
    case 'select': return selectField(field.key, value, field.options ?? [], lang, label)
    case 'textarea': return replaceLabel(textareaField(field.key, value, lang))
    default: return replaceLabel(textField(field.key, value, lang))
  }
}
