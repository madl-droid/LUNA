// templates-modules.ts — Server-side module panels (migrated from ui/js/modules.js)

import { t, type Lang } from './templates-i18n.js'
import { esc, renderOficinaField } from './templates-fields.js'
import type { OficinaField } from '../../kernel/types.js'

export interface ModuleInfo {
  name: string
  type: string
  active: boolean
  removable: boolean
  oficina?: {
    title: { es: string; en: string }
    info?: { es: string; en: string }
    fields?: OficinaField[]
  } | null
}

export function renderModulePanels(modules: ModuleInfo[], config: Record<string, string>, lang: Lang, filterName?: string): string {
  let h = ''

  const displayModules = filterName
    ? modules.filter(m => m.name === filterName)
    : modules.filter(m => m.name !== 'oficina')

  for (const mod of displayModules) {
    const title = mod.oficina?.title ? (mod.oficina.title[lang] || mod.oficina.title.es || mod.name) : mod.name
    const info = mod.oficina?.info ? (mod.oficina.info[lang] || mod.oficina.info.es || '') : ''
    const isActive = mod.active
    const canToggle = mod.removable !== false

    h += `<div class="module-panel">
      <div class="module-panel-header">
        <div>
          <span class="module-panel-title">${esc(title)}</span>
          <span class="panel-badge ${isActive ? 'badge-active' : 'badge-soon'}" style="margin-left:8px">${isActive ? t('activated', lang) : t('deactivated', lang)}</span>
          <span class="module-panel-type">${esc(mod.type)}</span>
        </div>
        ${canToggle ? `<form method="POST" action="/oficina/modules/toggle" style="margin:0">
          <input type="hidden" name="module" value="${esc(mod.name)}">
          <input type="hidden" name="active" value="${isActive ? 'false' : 'true'}">
          <input type="hidden" name="_section" value="modules">
          <input type="hidden" name="_lang" value="${lang}">
          <label class="toggle"><input type="checkbox" ${isActive ? 'checked' : ''} onchange="this.form.submit()"><span class="toggle-slider"></span></label>
        </form>` : ''}
      </div>`

    if (isActive && mod.oficina?.fields && mod.oficina.fields.length > 0) {
      h += `<div class="module-panel-body">`
      if (info) h += `<div class="panel-info">${esc(info)}</div>`
      for (const field of mod.oficina.fields) {
        const value = config[field.key] ?? ''
        h += renderOficinaField(field, value, lang)
      }
      h += `</div>`
    }

    h += `</div>`
  }

  return h
}
