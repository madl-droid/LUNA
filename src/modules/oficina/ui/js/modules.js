// modules.js — Dynamic module panels, toggle, refresh
// Depends on: i18n (t, lang), state (moduleStates, currentValues), utils (esc, showToast), fields (*)

function renderModulePanels() {
  let h = `<div class="panel"><div class="panel-header" onclick="togglePanel(this)">
    <span class="panel-title">${t('sec_modules')}</span>
    <span class="panel-chevron">&#9660;</span>
  </div><div class="panel-body"><div class="panel-info">${t('sec_modules_info')}</div>`

  // Filter: skip oficina itself (it's the panel we're in)
  const displayModules = moduleStates.filter(m => m.name !== 'oficina')

  for (const mod of displayModules) {
    const title = mod.oficina?.title ? (mod.oficina.title[lang] || mod.oficina.title.es || mod.name) : mod.name
    const info = mod.oficina?.info ? (mod.oficina.info[lang] || mod.oficina.info.es || '') : ''
    const isActive = mod.active
    const canToggle = mod.removable !== false

    h += `<div style="border:1px solid var(--border);border-radius:12px;margin-bottom:12px;overflow:hidden;box-shadow:var(--shadow-sm)">
      <div style="display:flex;align-items:center;justify-content:space-between;padding:12px 16px;background:var(--bg-primary)">
        <div>
          <span style="font-size:15px;font-weight:600;color:var(--text-primary)">${esc(title)}</span>
          <span class="panel-badge ${isActive ? 'badge-active' : 'badge-soon'}" style="margin-left:8px">${isActive ? t('activated') : t('deactivated')}</span>
          <span style="font-size:11px;color:var(--text-tertiary);margin-left:8px">${mod.type}</span>
        </div>
        ${canToggle ? `<label class="toggle"><input type="checkbox" ${isActive ? 'checked' : ''} onchange="toggleModule('${esc(mod.name)}', this.checked)"><span class="toggle-slider"></span></label>` : ''}
      </div>`

    // Only show config fields if module is active and has oficina fields
    if (isActive && mod.oficina?.fields && mod.oficina.fields.length > 0) {
      h += `<div style="padding:8px 16px 14px;border-top:1px solid var(--border-light);background:var(--bg-secondary)">`
      if (info) h += `<div class="panel-info">${esc(info)}</div>`
      for (const field of mod.oficina.fields) {
        const label = field.label ? (field.label[lang] || field.label.es || field.key) : field.key
        if (field.type === 'secret') {
          h += secretField(field.key, null, null).replace('class="field-label">' + field.key, 'class="field-label">' + esc(label))
        } else if (field.type === 'boolean') {
          h += boolField(field.key, null).replace('class="field-label">' + field.key, 'class="field-label">' + esc(label))
        } else if (field.type === 'number') {
          h += numField(field.key, null, null).replace('class="field-label">' + field.key, 'class="field-label">' + esc(label))
        } else if (field.type === 'select' && field.options) {
          h += selectField(field.key, label, field.options)
        } else {
          h += textField(field.key, null, null).replace('class="field-label">' + field.key, 'class="field-label">' + esc(label))
        }
      }
      h += `</div>`
    }

    h += `</div>`
  }

  h += `</div></div>`
  return h
}

async function toggleModule(name, active) {
  const endpoint = active ? '/oficina/api/oficina/activate' : '/oficina/api/oficina/deactivate'
  try {
    const res = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }) })
    const data = await res.json()
    if (data.ok) {
      showToast(`${name} ${active ? t('activated') : t('deactivated')}`, 'success')
      await refreshModuleStates()
      render()
    } else {
      showToast(data.error || t('moduleToggleError'), 'error')
    }
  } catch {
    showToast(t('moduleToggleError'), 'error')
  }
}

async function refreshModuleStates() {
  try {
    const res = await fetch('/oficina/api/oficina/modules')
    const data = await res.json()
    moduleStates = data.modules || []
  } catch { /* ignore */ }
}
