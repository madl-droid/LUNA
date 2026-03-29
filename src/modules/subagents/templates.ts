// subagents/templates.ts — SSR HTML for console section

import type { SubagentTypeRow, SubagentUsageSummary } from './types.js'

type Lang = 'es' | 'en'

const labels: Record<Lang, Record<string, string>> = {
  es: {
    title: 'Subagentes',
    desc: 'Crea y configura subagentes especializados. Cada subagente puede usar herramientas especificas, verificar resultados y dividir tareas complejas.',
    newSubagent: 'Nuevo subagente',
    slug: 'Slug (identificador)',
    slugPlaceholder: 'Ej: researcher, data-analyst',
    slugHelp: 'Minusculas, numeros y guiones. Se usa internamente para invocar al subagente.',
    name: 'Nombre',
    namePlaceholder: 'Ej: Investigador, Analista de datos',
    description: 'Descripcion',
    descPlaceholder: 'Describe que hace este subagente y cuando deberia usarse...',
    enabled: 'Activo',
    modelTier: 'Modelo',
    modelNormal: 'Normal (rapido)',
    modelComplex: 'Complejo (potente)',
    tokenBudget: 'Presupuesto de tokens',
    tokenBudgetHelp: 'Minimo 5,000. Limite suave — el subagente recibe advertencia al acercarse.',
    verifyResult: 'Verificar resultado',
    verifyHelp: 'Un LLM revisa la calidad del resultado. Si no pasa, reintenta una vez.',
    canSpawn: 'Puede crear sub-subagentes',
    spawnHelp: 'Permite dividir la tarea en sub-tareas (max 1 nivel de profundidad).',
    tools: 'Herramientas permitidas',
    toolsHelp: 'Selecciona que herramientas puede usar. Sin seleccion = todas.',
    systemPrompt: 'Prompt del sistema (opcional)',
    promptPlaceholder: 'Instrucciones especificas para este subagente. Si queda vacio, usa el prompt global.',
    save: 'Guardar',
    cancel: 'Cancelar',
    edit: 'Editar',
    delete: 'Eliminar',
    deleteConfirm: 'Eliminar este subagente? Esta accion no se puede deshacer.',
    noSubagents: 'No hay subagentes configurados. Crea uno nuevo para que el agente pueda delegar tareas complejas.',
    subagentCount: 'subagentes',
    activeCount: 'activos',
    usageTitle: 'Metricas de uso',
    usagePeriod: 'Periodo',
    usageHour: 'Ultima hora',
    usageDay: 'Ultimo dia',
    usageWeek: 'Ultima semana',
    usageMonth: 'Ultimo mes',
    usageExecs: 'Ejecuciones',
    usageTokens: 'Tokens',
    usageCost: 'Costo',
    usageErrors: 'Errores',
    usageAvgIter: 'Iter. prom.',
    usageAvgTime: 'Tiempo prom.',
    usageSuccess: 'Exito',
    noUsage: 'Sin datos de uso en este periodo.',
    allTools: 'Todas las herramientas',
    sortOrder: 'Orden',
  },
  en: {
    title: 'Subagents',
    desc: 'Create and configure specialized subagents. Each subagent can use specific tools, verify results and split complex tasks.',
    newSubagent: 'New subagent',
    slug: 'Slug (identifier)',
    slugPlaceholder: 'E.g.: researcher, data-analyst',
    slugHelp: 'Lowercase, numbers and hyphens. Used internally to invoke the subagent.',
    name: 'Name',
    namePlaceholder: 'E.g.: Researcher, Data Analyst',
    description: 'Description',
    descPlaceholder: 'Describe what this subagent does and when it should be used...',
    enabled: 'Enabled',
    modelTier: 'Model',
    modelNormal: 'Normal (fast)',
    modelComplex: 'Complex (powerful)',
    tokenBudget: 'Token budget',
    tokenBudgetHelp: 'Minimum 5,000. Soft limit — the subagent gets a warning when approaching it.',
    verifyResult: 'Verify result',
    verifyHelp: 'An LLM reviews the result quality. If it fails, retries once.',
    canSpawn: 'Can create sub-subagents',
    spawnHelp: 'Allows splitting the task into sub-tasks (max 1 level deep).',
    tools: 'Allowed tools',
    toolsHelp: 'Select which tools it can use. No selection = all tools.',
    systemPrompt: 'System prompt (optional)',
    promptPlaceholder: 'Specific instructions for this subagent. If empty, uses the global prompt.',
    save: 'Save',
    cancel: 'Cancel',
    edit: 'Edit',
    delete: 'Delete',
    deleteConfirm: 'Delete this subagent? This cannot be undone.',
    noSubagents: 'No subagents configured. Create a new one so the agent can delegate complex tasks.',
    subagentCount: 'subagents',
    activeCount: 'active',
    usageTitle: 'Usage metrics',
    usagePeriod: 'Period',
    usageHour: 'Last hour',
    usageDay: 'Last day',
    usageWeek: 'Last week',
    usageMonth: 'Last month',
    usageExecs: 'Executions',
    usageTokens: 'Tokens',
    usageCost: 'Cost',
    usageErrors: 'Errors',
    usageAvgIter: 'Avg iter.',
    usageAvgTime: 'Avg time',
    usageSuccess: 'Success',
    noUsage: 'No usage data for this period.',
    allTools: 'All tools',
    sortOrder: 'Order',
  },
}

function l(key: string, lang: Lang): string {
  return labels[lang]?.[key] ?? labels.es[key] ?? key
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

function renderStyles(): string {
  return `<style>
/* Subagents — scoped styles (.sa-) */
.sa-header { display:flex; align-items:center; justify-content:space-between; margin-bottom:16px }
.sa-header-left { display:flex; align-items:center; gap:10px }
.sa-counter { font-size:13px; color:var(--on-surface-dim) }
.sa-btn-new { font-size:13px; padding:7px 16px; border-radius:0.5rem }

.sa-form-wrap { display:none; margin-bottom:16px }
.sa-form-body { padding:20px }

.sa-row-top { display:flex; align-items:flex-start; gap:16px; margin-bottom:16px }
.sa-row-top-field { flex:1 }
.sa-row-toggle { display:flex; align-items:center; gap:8px; padding-top:20px }
.sa-label { font-size:12px; font-weight:600; text-transform:uppercase; color:var(--on-surface-dim); display:block; margin-bottom:4px }
.sa-toggle-label { font-size:12px; font-weight:500; color:var(--on-surface-variant) }

.sa-input { width:100%; padding:9px 12px; border:1px solid var(--outline-variant); border-radius:0.5rem; font-size:14px; background:var(--surface-container-lowest) }
.sa-textarea { width:100%; padding:9px 12px; border:1px solid var(--outline-variant); border-radius:0.5rem; font-size:14px; resize:vertical; font-family:inherit; background:var(--surface-container-lowest) }

.sa-field-group { margin-bottom:16px }

.sa-grid { display:grid; grid-template-columns:1fr 1fr; gap:16px; margin-bottom:16px }
.sa-section { background:var(--surface-container-low); border-radius:0.5rem; padding:14px }
.sa-section-title { font-size:11px; font-weight:600; text-transform:uppercase; color:var(--on-surface-dim); margin-bottom:8px }
.sa-select { width:100%; padding:8px 10px; border:1px solid var(--outline-variant); border-radius:6px; font-size:13px; background:var(--surface-container-lowest); margin-bottom:8px }
.sa-input-sm { width:100%; padding:8px 10px; border:1px solid var(--outline-variant); border-radius:6px; font-size:13px; background:var(--surface-container-lowest) }
.sa-help { font-size:10px; color:var(--on-surface-dim); margin-top:4px }

.sa-tools-grid { display:flex; flex-wrap:wrap; gap:6px; margin-top:6px }
.sa-tool-chip { display:inline-flex; align-items:center; gap:4px; padding:4px 10px; border-radius:12px; font-size:11px; cursor:pointer; border:1px solid var(--outline-variant); background:var(--surface-container-lowest); transition:all 0.15s ease; user-select:none }
.sa-tool-chip.selected { background:var(--primary); color:var(--on-primary); border-color:var(--primary) }
.sa-tool-chip:hover { border-color:var(--primary) }

.sa-toggles-row { display:flex; gap:20px; flex-wrap:wrap }
.sa-toggle-item { display:flex; align-items:center; gap:8px }

.sa-form-footer { display:flex; gap:8px; justify-content:flex-end; padding-top:12px; border-top:1px solid var(--outline-variant) }
.sa-btn-form { font-size:13px; padding:7px 16px; border-radius:0.5rem }

.sa-list { display:flex; flex-direction:column; gap:8px }

.sa-card { background:var(--surface-container-lowest); border:1px solid var(--outline-variant); border-radius:0.5rem; padding:14px 16px; transition:border-color 0.15s ease }
.sa-card-disabled { opacity:0.55 }
.sa-card-row { display:flex; align-items:flex-start; justify-content:space-between; gap:10px }
.sa-card-body { flex:1; min-width:0 }
.sa-card-title-row { display:flex; align-items:center; gap:8px; flex-wrap:wrap; margin-bottom:4px }
.sa-card-name { font-weight:600; font-size:14px }
.sa-card-slug { font-size:12px; color:var(--on-surface-dim); font-family:monospace }
.sa-card-meta { font-size:12px; color:var(--on-surface-dim); margin-bottom:4px; display:flex; align-items:center; gap:6px; flex-wrap:wrap }
.sa-card-desc { font-size:12px; color:var(--on-surface-variant); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; max-width:500px }
.sa-card-actions { display:flex; gap:4px; flex-shrink:0 }
.sa-btn-card { font-size:12px; padding:5px 10px; border-radius:6px }
.sa-btn-delete { font-size:12px; padding:5px 10px; border-radius:6px; color:var(--error) }

.sa-badge-model { background:rgba(0,122,255,0.1); color:var(--info); font-size:10px }
.sa-badge-tokens { background:rgba(88,86,214,0.1); color:#5856d6; font-size:10px }
.sa-badge-verify { background:rgba(52,199,89,0.1); color:var(--success); font-size:10px }
.sa-badge-spawn { background:rgba(255,149,0,0.12); color:var(--warning); font-size:10px }
.sa-badge-tools { background:var(--surface-container-low); color:var(--on-surface-dim); font-size:10px }

.sa-empty { padding:40px 20px; text-align:center }
.sa-empty-icon { font-size:32px; margin-bottom:8px }
.sa-empty-text { color:var(--on-surface-dim); font-size:14px }

/* Usage metrics panel */
.sa-usage-panel { margin-top:20px }
.sa-usage-header { display:flex; align-items:center; justify-content:space-between; margin-bottom:12px }
.sa-usage-title { font-weight:600; font-size:14px }
.sa-usage-period { padding:6px 10px; border:1px solid var(--outline-variant); border-radius:6px; font-size:12px; background:var(--surface-container-lowest) }

.sa-usage-grid { display:grid; grid-template-columns:repeat(auto-fit, minmax(120px, 1fr)); gap:10px; margin-bottom:16px }
.sa-usage-stat { background:var(--surface-container-low); border-radius:0.5rem; padding:12px; text-align:center }
.sa-usage-stat-value { font-size:20px; font-weight:700; color:var(--on-surface) }
.sa-usage-stat-label { font-size:10px; text-transform:uppercase; color:var(--on-surface-dim); margin-top:2px }

.sa-usage-table { width:100%; border-collapse:collapse; font-size:12px }
.sa-usage-table th { text-align:left; padding:8px 10px; font-size:10px; text-transform:uppercase; color:var(--on-surface-dim); border-bottom:1px solid var(--outline-variant) }
.sa-usage-table td { padding:8px 10px; border-bottom:1px solid var(--outline-variant) }
.sa-usage-table tr:last-child td { border-bottom:none }
.sa-usage-empty { text-align:center; padding:20px; color:var(--on-surface-dim); font-size:13px }

@media (max-width: 768px) {
  .sa-grid { grid-template-columns:1fr }
  .sa-row-top { flex-direction:column }
  .sa-row-toggle { padding-top:0 }
  .sa-usage-grid { grid-template-columns:repeat(3, 1fr) }
}
</style>`
}

function formatNumber(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M'
  if (n >= 1_000) return (n / 1_000).toFixed(1) + 'k'
  return String(n)
}

export function renderSubagentsSection(
  types: SubagentTypeRow[],
  usage: SubagentUsageSummary,
  lang: Lang,
  availableTools: Array<{ name: string; description: string }> = [],
): string {
  const activeCount = types.filter(t => t.enabled).length

  // --- Subagent cards ---
  const cards = types.length === 0
    ? `<div class="sa-empty">
        <div class="sa-empty-icon">&#129302;</div>
        <div class="sa-empty-text">${l('noSubagents', lang)}</div>
      </div>`
    : types.map(t => {
        const toolsLabel = t.allowedTools.length === 0
          ? l('allTools', lang)
          : `${t.allowedTools.length} tools`
        return `
      <div class="sa-card${!t.enabled ? ' sa-card-disabled' : ''}" data-sa-id="${esc(t.id)}">
        <div class="sa-card-row">
          <div class="sa-card-body">
            <div class="sa-card-title-row">
              <span class="sa-card-name">${esc(t.name)}</span>
              <span class="sa-card-slug">${esc(t.slug)}</span>
              ${!t.enabled ? '<span class="panel-badge badge-soon">OFF</span>' : ''}
            </div>
            <div class="sa-card-meta">
              <span class="panel-badge sa-badge-model">${t.modelTier === 'complex' ? '&#9733; complex' : 'normal'}</span>
              <span class="panel-badge sa-badge-tokens">${formatNumber(t.tokenBudget)} tokens</span>
              ${t.verifyResult ? `<span class="panel-badge sa-badge-verify">&#10003; verify</span>` : ''}
              ${t.canSpawnChildren ? `<span class="panel-badge sa-badge-spawn">&#8618; spawn</span>` : ''}
              <span class="panel-badge sa-badge-tools">${esc(toolsLabel)}</span>
            </div>
            ${t.description ? `<div class="sa-card-desc" title="${esc(t.description)}">${esc(t.description)}</div>` : ''}
          </div>
          <div class="sa-card-actions">
            <button type="button" class="wa-btn sa-btn-card" onclick="saEdit('${esc(t.id)}')">${l('edit', lang)}</button>
            <button type="button" class="wa-btn sa-btn-delete" onclick="saDelete('${esc(t.id)}')">${l('delete', lang)}</button>
          </div>
        </div>
      </div>`
      }).join('')

  // --- Usage metrics ---
  const usageHtml = renderUsagePanel(usage, lang)

  return `
    ${renderStyles()}

    <!-- Header with counter and new button -->
    <div class="sa-header">
      <div class="sa-header-left">
        <span class="sa-counter">${types.length} ${l('subagentCount', lang)} · ${activeCount} ${l('activeCount', lang)}</span>
      </div>
      <button type="button" class="wa-btn wa-btn-connect sa-btn-new" onclick="saShowForm()">+ ${l('newSubagent', lang)}</button>
    </div>

    <!-- Create/Edit form -->
    <div id="sa-form" class="sa-form-wrap">
      <div class="panel">
        <div class="panel-body sa-form-body">
          <input type="hidden" id="sa-edit-id" value="">

          <!-- Row 1: Slug + Name + Enabled -->
          <div class="sa-row-top">
            <div class="sa-row-top-field">
              <label class="sa-label">${l('slug', lang)}</label>
              <input type="text" id="sa-slug" placeholder="${l('slugPlaceholder', lang)}" class="sa-input" pattern="[a-z0-9]([a-z0-9-]*[a-z0-9])?">
              <div class="sa-help">${l('slugHelp', lang)}</div>
            </div>
            <div class="sa-row-top-field">
              <label class="sa-label">${l('name', lang)}</label>
              <input type="text" id="sa-name" placeholder="${l('namePlaceholder', lang)}" class="sa-input">
            </div>
            <div class="sa-row-toggle">
              <label class="toggle"><input type="checkbox" id="sa-enabled" checked><span class="toggle-slider"></span></label>
              <span class="sa-toggle-label">${l('enabled', lang)}</span>
            </div>
          </div>

          <!-- Description -->
          <div class="sa-field-group">
            <label class="sa-label">${l('description', lang)}</label>
            <textarea id="sa-description" rows="2" placeholder="${l('descPlaceholder', lang)}" class="sa-textarea"></textarea>
          </div>

          <!-- 2-column grid: Model config | Options -->
          <div class="sa-grid">
            <div class="sa-section">
              <div class="sa-section-title">${l('modelTier', lang)}</div>
              <select id="sa-model-tier" class="sa-select">
                <option value="normal">${l('modelNormal', lang)}</option>
                <option value="complex">${l('modelComplex', lang)}</option>
              </select>

              <div class="sa-section-title" style="margin-top:10px">${l('tokenBudget', lang)}</div>
              <input type="number" id="sa-token-budget" value="100000" min="5000" step="5000" class="sa-input-sm">
              <div class="sa-help">${l('tokenBudgetHelp', lang)}</div>

              <div class="sa-section-title" style="margin-top:10px">${l('sortOrder', lang)}</div>
              <input type="number" id="sa-sort-order" value="0" min="0" step="1" class="sa-input-sm">
            </div>

            <div class="sa-section">
              <div class="sa-section-title">Options</div>
              <div class="sa-toggles-row">
                <div class="sa-toggle-item">
                  <label class="toggle"><input type="checkbox" id="sa-verify-result" checked><span class="toggle-slider"></span></label>
                  <div>
                    <span class="sa-toggle-label">${l('verifyResult', lang)}</span>
                    <div class="sa-help">${l('verifyHelp', lang)}</div>
                  </div>
                </div>
                <div class="sa-toggle-item" style="margin-top:10px">
                  <label class="toggle"><input type="checkbox" id="sa-can-spawn"><span class="toggle-slider"></span></label>
                  <div>
                    <span class="sa-toggle-label">${l('canSpawn', lang)}</span>
                    <div class="sa-help">${l('spawnHelp', lang)}</div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <!-- Tools selection -->
          <div class="sa-field-group">
            <label class="sa-label">${l('tools', lang)}</label>
            <div class="sa-help" style="margin-bottom:6px">${l('toolsHelp', lang)}</div>
            <div id="sa-tools-grid" class="sa-tools-grid">
              ${availableTools.map(t => `<div class="sa-tool-chip" data-tool="${esc(t.name)}" onclick="saToggleTool(this)" title="${esc(t.description)}">${esc(t.name)}</div>`).join('')}
            </div>
          </div>

          <!-- System prompt -->
          <div class="sa-field-group">
            <label class="sa-label">${l('systemPrompt', lang)}</label>
            <textarea id="sa-system-prompt" rows="4" placeholder="${l('promptPlaceholder', lang)}" class="sa-textarea" style="font-family:monospace; font-size:12px"></textarea>
          </div>

          <!-- Form buttons -->
          <div class="sa-form-footer">
            <button type="button" class="wa-btn sa-btn-form" onclick="saHideForm()">${l('cancel', lang)}</button>
            <button type="button" class="wa-btn wa-btn-connect sa-btn-form" onclick="saSave()">${l('save', lang)}</button>
          </div>
        </div>
      </div>
    </div>

    <!-- Subagent list -->
    <div id="sa-list" class="sa-list">${cards}</div>

    <!-- Usage metrics -->
    ${usageHtml}

    ${renderScript(lang)}`
}

function renderUsagePanel(usage: SubagentUsageSummary, lang: Lang): string {
  const hasData = usage.totalExecutions > 0
  const bySubagent = Object.entries(usage.bySubagent)

  return `
    <div class="sa-usage-panel">
      <div class="sa-usage-header">
        <span class="sa-usage-title">${l('usageTitle', lang)}</span>
        <select id="sa-usage-period" class="sa-usage-period" onchange="saLoadUsage()">
          <option value="hour">${l('usageHour', lang)}</option>
          <option value="day" selected>${l('usageDay', lang)}</option>
          <option value="week">${l('usageWeek', lang)}</option>
          <option value="month">${l('usageMonth', lang)}</option>
        </select>
      </div>

      <div id="sa-usage-content">
        ${hasData ? `
          <div class="sa-usage-grid">
            <div class="sa-usage-stat">
              <div class="sa-usage-stat-value">${usage.totalExecutions}</div>
              <div class="sa-usage-stat-label">${l('usageExecs', lang)}</div>
            </div>
            <div class="sa-usage-stat">
              <div class="sa-usage-stat-value">${formatNumber(usage.totalTokens)}</div>
              <div class="sa-usage-stat-label">${l('usageTokens', lang)}</div>
            </div>
            <div class="sa-usage-stat">
              <div class="sa-usage-stat-value">$${usage.totalCostUsd.toFixed(3)}</div>
              <div class="sa-usage-stat-label">${l('usageCost', lang)}</div>
            </div>
            <div class="sa-usage-stat">
              <div class="sa-usage-stat-value">${usage.totalErrors}</div>
              <div class="sa-usage-stat-label">${l('usageErrors', lang)}</div>
            </div>
            <div class="sa-usage-stat">
              <div class="sa-usage-stat-value">${usage.avgIterations}</div>
              <div class="sa-usage-stat-label">${l('usageAvgIter', lang)}</div>
            </div>
            <div class="sa-usage-stat">
              <div class="sa-usage-stat-value">${(usage.avgDurationMs / 1000).toFixed(1)}s</div>
              <div class="sa-usage-stat-label">${l('usageAvgTime', lang)}</div>
            </div>
          </div>

          ${bySubagent.length > 0 ? `
          <table class="sa-usage-table">
            <thead><tr>
              <th>Subagent</th>
              <th>${l('usageExecs', lang)}</th>
              <th>${l('usageTokens', lang)}</th>
              <th>${l('usageCost', lang)}</th>
              <th>${l('usageSuccess', lang)}</th>
              <th>${l('usageAvgIter', lang)}</th>
              <th>${l('usageAvgTime', lang)}</th>
            </tr></thead>
            <tbody>
              ${bySubagent.map(([slug, s]) => `<tr>
                <td><strong>${esc(s.name)}</strong> <span style="color:var(--on-surface-dim); font-size:10px">${esc(slug)}</span></td>
                <td>${s.executions}</td>
                <td>${formatNumber(s.tokens)}</td>
                <td>$${s.costUsd.toFixed(3)}</td>
                <td>${s.successRate}%</td>
                <td>${s.avgIterations}</td>
                <td>${(s.avgDurationMs / 1000).toFixed(1)}s</td>
              </tr>`).join('')}
            </tbody>
          </table>` : ''}
        ` : `<div class="sa-usage-empty">${l('noUsage', lang)}</div>`}
      </div>
    </div>`
}

function renderScript(lang: Lang): string {
  return `<script>
(function() {
  const API = '/console/api/subagents'
  const L = ${JSON.stringify(labels[lang])}

  // --- Tool chip toggle ---
  window.saToggleTool = function(el) {
    el.classList.toggle('selected')
  }

  function getSelectedTools() {
    const chips = document.querySelectorAll('#sa-tools-grid .sa-tool-chip.selected')
    return Array.from(chips).map(function(c) { return c.getAttribute('data-tool') })
  }

  function setSelectedTools(tools) {
    document.querySelectorAll('#sa-tools-grid .sa-tool-chip').forEach(function(c) {
      if (tools.includes(c.getAttribute('data-tool'))) {
        c.classList.add('selected')
      } else {
        c.classList.remove('selected')
      }
    })
  }

  // --- Form show/hide ---
  window.saShowForm = function() {
    document.getElementById('sa-form').style.display = 'block'
    document.getElementById('sa-edit-id').value = ''
    document.getElementById('sa-slug').value = ''
    document.getElementById('sa-slug').disabled = false
    document.getElementById('sa-name').value = ''
    document.getElementById('sa-description').value = ''
    document.getElementById('sa-enabled').checked = true
    document.getElementById('sa-model-tier').value = 'normal'
    document.getElementById('sa-token-budget').value = '100000'
    document.getElementById('sa-sort-order').value = '0'
    document.getElementById('sa-verify-result').checked = true
    document.getElementById('sa-can-spawn').checked = false
    document.getElementById('sa-system-prompt').value = ''
    setSelectedTools([])
    document.getElementById('sa-form').scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  window.saHideForm = function() {
    document.getElementById('sa-form').style.display = 'none'
  }

  window.saEdit = async function(id) {
    try {
      var res = await fetch(API + '/type?id=' + encodeURIComponent(id))
      var data = await res.json()
      var t = data.type
      if (!t) return

      document.getElementById('sa-form').style.display = 'block'
      document.getElementById('sa-edit-id').value = t.id
      document.getElementById('sa-slug').value = t.slug
      document.getElementById('sa-slug').disabled = true
      document.getElementById('sa-name').value = t.name
      document.getElementById('sa-description').value = t.description || ''
      document.getElementById('sa-enabled').checked = t.enabled
      document.getElementById('sa-model-tier').value = t.modelTier
      document.getElementById('sa-token-budget').value = String(t.tokenBudget)
      document.getElementById('sa-sort-order').value = String(t.sortOrder || 0)
      document.getElementById('sa-verify-result').checked = t.verifyResult
      document.getElementById('sa-can-spawn').checked = t.canSpawnChildren
      document.getElementById('sa-system-prompt').value = t.systemPrompt || ''
      setSelectedTools(t.allowedTools || [])
      document.getElementById('sa-form').scrollIntoView({ behavior: 'smooth', block: 'start' })
    } catch(e) {
      console.error('Failed to load subagent', e)
    }
  }

  window.saSave = async function() {
    var editId = document.getElementById('sa-edit-id').value
    var slug = document.getElementById('sa-slug').value.trim()
    var name = document.getElementById('sa-name').value.trim()
    var tokenBudget = parseInt(document.getElementById('sa-token-budget').value, 10)

    if (!name) {
      alert(L.name + ' is required')
      return
    }
    if (!editId && !slug) {
      alert(L.slug + ' is required')
      return
    }
    if (tokenBudget < 5000) {
      alert('Token budget minimum: 5,000')
      return
    }

    var body = {
      name: name,
      description: document.getElementById('sa-description').value.trim(),
      enabled: document.getElementById('sa-enabled').checked,
      modelTier: document.getElementById('sa-model-tier').value,
      tokenBudget: tokenBudget,
      verifyResult: document.getElementById('sa-verify-result').checked,
      canSpawnChildren: document.getElementById('sa-can-spawn').checked,
      allowedTools: getSelectedTools(),
      systemPrompt: document.getElementById('sa-system-prompt').value,
      sortOrder: parseInt(document.getElementById('sa-sort-order').value, 10) || 0,
    }

    try {
      if (editId) {
        body.id = editId
        await fetch(API + '/type', { method: 'PUT', headers: {'Content-Type':'application/json'}, body: JSON.stringify(body) })
      } else {
        body.slug = slug
        await fetch(API + '/type', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify(body) })
      }
      location.reload()
    } catch(e) {
      alert('Error: ' + e.message)
    }
  }

  window.saDelete = async function(id) {
    if (!confirm(L.deleteConfirm)) return
    try {
      await fetch(API + '/type?id=' + encodeURIComponent(id), { method: 'DELETE' })
      location.reload()
    } catch(e) {
      alert('Error: ' + e.message)
    }
  }

  // --- Usage metrics ---
  window.saLoadUsage = async function() {
    var period = document.getElementById('sa-usage-period').value
    try {
      var res = await fetch(API + '/usage?period=' + period)
      var data = await res.json()
      var container = document.getElementById('sa-usage-content')

      if (data.totalExecutions === 0) {
        container.innerHTML = '<div class="sa-usage-empty">' + L.noUsage + '</div>'
        return
      }

      var statsHtml = '<div class="sa-usage-grid">' +
        stat(data.totalExecutions, L.usageExecs) +
        stat(fmtNum(data.totalTokens), L.usageTokens) +
        stat('$' + data.totalCostUsd.toFixed(3), L.usageCost) +
        stat(data.totalErrors, L.usageErrors) +
        stat(data.avgIterations, L.usageAvgIter) +
        stat((data.avgDurationMs / 1000).toFixed(1) + 's', L.usageAvgTime) +
      '</div>'

      var entries = Object.entries(data.bySubagent || {})
      if (entries.length > 0) {
        statsHtml += '<table class="sa-usage-table"><thead><tr>' +
          '<th>Subagent</th><th>' + L.usageExecs + '</th><th>' + L.usageTokens + '</th><th>' + L.usageCost + '</th><th>' + L.usageSuccess + '</th><th>' + L.usageAvgIter + '</th><th>' + L.usageAvgTime + '</th>' +
          '</tr></thead><tbody>'
        for (var i = 0; i < entries.length; i++) {
          var slug = entries[i][0]
          var s = entries[i][1]
          statsHtml += '<tr><td><strong>' + esc(s.name) + '</strong> <span style="color:var(--on-surface-dim);font-size:10px">' + esc(slug) + '</span></td>' +
            '<td>' + s.executions + '</td><td>' + fmtNum(s.tokens) + '</td><td>$' + s.costUsd.toFixed(3) + '</td><td>' + s.successRate + '%</td><td>' + s.avgIterations + '</td><td>' + (s.avgDurationMs / 1000).toFixed(1) + 's</td></tr>'
        }
        statsHtml += '</tbody></table>'
      }

      container.innerHTML = statsHtml
    } catch(e) {
      console.error('Failed to load usage', e)
    }
  }

  function stat(value, label) {
    return '<div class="sa-usage-stat"><div class="sa-usage-stat-value">' + value + '</div><div class="sa-usage-stat-label">' + label + '</div></div>'
  }

  function fmtNum(n) {
    if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M'
    if (n >= 1000) return (n / 1000).toFixed(1) + 'k'
    return String(n)
  }

  function esc(s) {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
  }
})()
</script>`
}
