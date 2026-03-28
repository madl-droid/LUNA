// templates-modules.ts — Server-side module panels (migrated from ui/js/modules.js)

import { t, type Lang } from './templates-i18n.js'
import { esc, renderConsoleField } from './templates-fields.js'
import type { ConsoleField } from '../../kernel/types.js'

export interface ModuleInfo {
  name: string
  type: string
  channelType?: 'instant' | 'async' | 'voice'
  active: boolean
  removable: boolean
  console?: {
    title: { es: string; en: string }
    info?: { es: string; en: string }
    fields?: ConsoleField[]
  } | null
  connectionWizard?: {
    title: { es: string; en: string }
    steps: Array<{
      title: { es: string; en: string }
      instructions: { es: string; en: string }
      fields?: Array<{ key: string; label: { es: string; en: string }; type: string; placeholder?: string }>
    }>
    saveEndpoint?: string
    applyAfterSave?: boolean
    verifyEndpoint?: string
  }
}

export function renderModulePanels(modules: ModuleInfo[], config: Record<string, string>, lang: Lang, filterName?: string): string {
  let h = ''

  const displayModules = filterName
    ? modules.filter(m => m.name === filterName)
    : modules.filter(m => m.name !== 'console')

  for (const mod of displayModules) {
    const title = mod.console?.title ? (mod.console.title[lang] || mod.console.title.es || mod.name) : mod.name
    const info = mod.console?.info ? (mod.console.info[lang] || mod.console.info.es || '') : ''
    const isActive = mod.active
    const canToggle = mod.removable !== false && !filterName

    h += `<div class="module-panel">
      <div class="module-panel-header">
        <div>
          <span class="module-panel-title">${esc(title)}</span>
          <span class="panel-badge module-badge ${isActive ? 'badge-active' : 'badge-soon'}">${isActive ? t('activated', lang) : t('deactivated', lang)}</span>
          <span class="module-panel-type">${esc(mod.type)}</span>
        </div>
        ${canToggle ? `<form method="POST" action="/console/modules/toggle" class="module-toggle-form">
          <input type="hidden" name="module" value="${esc(mod.name)}">
          <input type="hidden" name="active" value="${isActive ? 'false' : 'true'}">
          <input type="hidden" name="_section" value="modules">
          <input type="hidden" name="_lang" value="${lang}">
          <label class="toggle"><input type="checkbox" ${isActive ? 'checked' : ''} onchange="this.form.submit()"><span class="toggle-slider"></span></label>
        </form>` : ''}
      </div>`

    if (isActive && mod.console?.fields && mod.console.fields.length > 0) {
      h += `<div class="module-panel-body">`
      if (info) h += `<div class="panel-info">${esc(info)}</div>`
      for (const field of mod.console.fields) {
        const value = config[field.key] ?? ''
        h += renderConsoleField(field, value, lang)
      }
      h += `</div>`
    }

    h += `</div>`
  }

  return h
}
