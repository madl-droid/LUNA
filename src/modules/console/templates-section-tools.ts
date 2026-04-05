import { t } from './templates-i18n.js'
import { esc } from './templates-fields.js'
import { ICON_OVERRIDES } from './templates.js'
import type { SectionData } from './templates-section-data.js'

export function renderLeadScoringSection(data: SectionData): string {
  if (data.leadScoringHtml) {
    return data.leadScoringHtml
  }
  // Fallback: link to standalone page
  return `<div class="panel">
    <div class="panel-header panel-header-link" onclick="window.location.href='/console/api/lead-scoring/ui'">
      <span class="panel-title">${t('sec_lead_scoring', data.lang)} <span class="panel-badge badge-active">${t('sec_lead_scoring_badge', data.lang)}</span></span>
      <span class="panel-chevron panel-chevron-right">&#9660;</span>
    </div>
  </div>`
}

export function renderScheduledTasksSection(data: SectionData): string {
  if (data.scheduledTasksHtml) return data.scheduledTasksHtml
  // Fallback if render service not available
  return `<div class="panel"><div class="panel-body panel-body-flat panel-body-empty">
    ${t('sec_scheduled_tasks_unavailable', data.lang)}
  </div></div>`
}

// ═══════════════════════════════════════════
// Knowledge items — custom section
// ═══════════════════════════════════════════

export function renderKnowledgeItemsSection(data: SectionData): string {
  if (data.knowledgeItemsHtml) return data.knowledgeItemsHtml
  return `<div class="panel"><div class="panel-body panel-body-flat panel-body-empty">
    <p>${data.lang === 'es' ? 'Módulo de conocimiento no disponible.' : 'Knowledge module not available.'}</p>
  </div></div>`
}

// ═══════════════════════════════════════════
// Channels overview — card grid
// ═══════════════════════════════════════════

export function renderToolsCardsSection(data: SectionData): string {
  const lang = data.lang
  const isEs = lang === 'es'
  const cfg = data.config

  // Collect tool modules from herramientas group
  // Exclude: core agent modules managed from Agente tab, and TTS (feature, not a tool)
  const TOOLS_PAGE_EXCLUDE = new Set(['tools', 'prompts', 'engine', 'memory', 'knowledge', 'subagents', 'tts'])
  const toolModules = (data.moduleStates ?? [])
    .filter(m => !TOOLS_PAGE_EXCLUDE.has(m.name))
    .filter(m => (m.console as unknown as Record<string, unknown>)?.group === 'agent' || (m.console as unknown as Record<string, unknown>)?.group === 'modules' || m.type === 'feature')
    .sort((a, b) => {
      // Active first, then alphabetical
      if (a.active !== b.active) return a.active ? -1 : 1
      const nameA = a.console?.title?.[lang] || a.name
      const nameB = b.console?.title?.[lang] || b.name
      return nameA.localeCompare(nameB)
    })

  let cardsHtml = '<div class="tool-cards">'
  for (const mod of toolModules) {
    const title = mod.console?.title?.[lang] || mod.console?.title?.['es'] || mod.name
    const desc = mod.console?.info?.[lang] || mod.console?.info?.['es'] || ''
    const icon = ICON_OVERRIDES[mod.name] || (mod.console as unknown as Record<string, unknown>)?.icon as string || '&#9881;'
    const active = mod.active
    const disabledClass = active ? '' : ' disabled'

    cardsHtml += `<div class="tool-card${disabledClass}">
      <div class="tool-card-header">
        <div class="tool-card-icon">${icon}</div>
        <span class="tool-card-title">${esc(title)}</span>
      </div>
      <div class="tool-card-desc">${esc(desc)}</div>
      <div class="tool-card-footer">
        <label class="toggle toggle-sm" onclick="event.stopPropagation()">
          <input type="checkbox" ${active ? 'checked' : ''} onchange="toggleToolModule('${esc(mod.name)}', this.checked)">
          <span class="toggle-slider"></span>
        </label>
        <a class="act-btn act-btn-config" href="/console/herramientas/${esc(mod.name)}?lang=${lang}"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg> ${isEs ? 'Configurar' : 'Configure'}</a>
      </div>
    </div>`
  }
  cardsHtml += '</div>'

  // Global tool params
  const backoff = cfg['TOOLS_RETRY_BACKOFF_S'] || '1'
  const timeout = cfg['TOOLS_EXECUTION_TIMEOUT_S'] || '30'
  const maxPerTurn = cfg['PIPELINE_MAX_TOOL_CALLS_PER_TURN'] || '5'

  const globalParams = `<div class="panel ts-tools-global-panel">
    <div class="panel-body ts-tools-global-body">
      <div class="ts-tools-global-grid">
        <div class="field ts-tools-global-field">
          <span class="field-label">${isEs ? 'Espera entre intentos (s)' : 'Wait between retries (s)'}</span>
          <input type="number" inputmode="numeric" name="TOOLS_RETRY_BACKOFF_S" value="${esc(backoff)}" data-original="${esc(backoff)}" min="1" max="30">
        </div>
        <div class="field ts-tools-global-field">
          <span class="field-label">${isEs ? 'Tiempo max. ejecucion (s)' : 'Max execution time (s)'}</span>
          <input type="number" inputmode="numeric" name="TOOLS_EXECUTION_TIMEOUT_S" value="${esc(timeout)}" data-original="${esc(timeout)}" min="5" max="120">
        </div>
        <div class="field ts-tools-global-field">
          <span class="field-label">${isEs ? 'Max herramientas por turno' : 'Max tools per turn'}</span>
          <input type="number" inputmode="numeric" name="PIPELINE_MAX_TOOL_CALLS_PER_TURN" value="${esc(maxPerTurn)}" data-original="${esc(maxPerTurn)}" min="1" max="20">
        </div>
      </div>
    </div>
  </div>`

  // Two-tier descriptions panel (per individual tool, editable)
  let descPanel = ''
  if (data.toolDescriptions && data.toolDescriptions.length > 0) {
    const rows = data.toolDescriptions.map(td => {
      const shortVal = esc(td.shortDescription)
      const guidanceVal = esc(td.detailedGuidance)
      const toolId = esc(td.name)
      return `<div class="panel-body" style="border-bottom:1px solid var(--surface-variant);padding:10px 16px">
        <div style="display:flex;align-items:baseline;gap:8px;margin-bottom:6px">
          <span style="font-size:12px;font-weight:600;color:var(--on-surface)">${esc(td.name)}</span>
          <span style="font-size:11px;color:var(--on-surface-dim)">${esc(td.sourceModule)}</span>
        </div>
        <div class="field" style="margin-bottom:6px">
          <span class="field-label" style="font-size:11px">${isEs ? 'Descripcion corta (IA)' : 'Short description (AI)'}</span>
          <span class="field-info" style="font-size:11px">${isEs ? '1 linea que el modelo ve al seleccionar herramientas. Vacio = auto-generado.' : '1-line the model sees when selecting tools. Empty = auto-generated.'}</span>
          <input type="text" id="td-short-${toolId}" value="${shortVal}" placeholder="${isEs ? 'Auto-generado de la descripcion...' : 'Auto-generated from description...'}" style="font-size:12px">
        </div>
        <div class="field">
          <span class="field-label" style="font-size:11px">${isEs ? 'Guia detallada' : 'Detailed guidance'}</span>
          <span class="field-info" style="font-size:11px">${isEs ? 'Instrucciones completas inyectadas al invocar la herramienta.' : 'Full instructions injected when the tool is invoked.'}</span>
          <textarea id="td-guidance-${toolId}" rows="2" placeholder="${isEs ? 'Instrucciones especificas...' : 'Specific instructions...'}" style="font-size:12px">${guidanceVal}</textarea>
        </div>
        <button class="act-btn" type="button" onclick="saveToolDescriptions('${toolId}')" style="font-size:11px;padding:3px 10px">${isEs ? 'Guardar' : 'Save'}</button>
      </div>`
    }).join('')

    descPanel = `<div class="panel" style="margin-top:12px">
      <div class="panel-header" onclick="togglePanel(this)">
        <span class="panel-title">${isEs ? 'Descripciones para IA (por herramienta)' : 'AI Descriptions (per tool)'}</span>
        <span class="panel-chevron">&#9660;</span>
      </div>
      <div class="panel-body" style="padding:8px 16px">
        <p class="panel-info">${isEs ? 'Descripcion corta: 1 linea que el LLM ve al decidir que herramienta usar. Guia detallada: instrucciones completas inyectadas al invocarla. Dejar vacios para usar valores por defecto del codigo.' : 'Short description: 1-line the LLM sees when deciding which tool to use. Detailed guidance: full instructions injected on invocation. Leave empty to use code defaults.'}</p>
      </div>
      ${rows}
    </div>`
  }

  return cardsHtml + globalParams + descPanel + `
  <script>
  function toggleToolModule(name, enabled) {
    fetch('/console/modules/toggle', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'module=' + encodeURIComponent(name) + '&action=' + (enabled ? 'activate' : 'deactivate') + '&_redirect=/console/herramientas'
    }).then(function() { location.reload() }).catch(function() { alert('Error') })
  }
  function saveToolDescriptions(toolName) {
    var shortEl = document.getElementById('td-short-' + toolName)
    var guidanceEl = document.getElementById('td-guidance-' + toolName)
    if (!shortEl || !guidanceEl) return
    fetch('/console/api/tools/settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        toolName: toolName,
        shortDescription: shortEl.value || null,
        detailedGuidance: guidanceEl.value || null
      })
    }).then(function(r) {
      if (r.ok) { shortEl.style.borderColor = 'var(--success)'; setTimeout(function(){ shortEl.style.borderColor = ''; }, 1500) }
      else { alert('Error saving') }
    }).catch(function() { alert('Error') })
  }
  </script>`
}

// ═══════════════════════════════════════════
// Identity section — 2-column layout (prompts + identity fields)
// ═══════════════════════════════════════════
