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
    usagePeriod: 'PERIODO',
    usageHour: 'Ultima hora',
    usageDay: 'Ultimo dia',
    usageWeek: 'Ultima semana',
    usageMonth: 'Ultimo mes',
    usageExecs: 'Ejecuciones',
    usageCost: 'Costo',
    usageAvgTime: 'Tiempo prom.',
    usageTop3: 'Top subagentes',
    noUsage: 'Sin datos en este periodo.',
    allTools: 'Todas las herramientas',
    sortOrder: 'Orden',
    mockLabel: 'Datos de ejemplo',
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
    usagePeriod: 'PERIOD',
    usageHour: 'Last hour',
    usageDay: 'Last day',
    usageWeek: 'Last week',
    usageMonth: 'Last month',
    usageExecs: 'Executions',
    usageCost: 'Cost',
    usageAvgTime: 'Avg time',
    usageTop3: 'Top subagents',
    noUsage: 'No usage data for this period.',
    allTools: 'All tools',
    sortOrder: 'Order',
    mockLabel: 'Sample data',
  },
}

function l(key: string, lang: Lang): string {
  return labels[lang]?.[key] ?? labels.es[key] ?? key
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

function formatNumber(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M'
  if (n >= 1_000) return (n / 1_000).toFixed(1) + 'k'
  return String(n)
}

function renderStyles(): string {
  return `<style>
/* Subagents — scoped layout (.sa-) */
.sa-header { display:flex; align-items:center; justify-content:space-between; margin-bottom:16px }
.sa-header-left { display:flex; align-items:center; gap:10px }
.sa-counter { font-size:13px; color:var(--on-surface-dim) }

.sa-form-wrap { display:none; margin-bottom:16px }
.sa-row-top { display:flex; align-items:flex-start; gap:16px; margin-bottom:16px }
.sa-row-top-field { flex:1; min-width:0 }
.sa-row-toggle { display:flex; align-items:center; gap:8px; padding-top:20px }
.sa-label { font-size:12px; font-weight:600; text-transform:uppercase; color:var(--on-surface-dim); display:block; margin-bottom:4px }
.sa-toggle-label { font-size:12px; font-weight:500; color:var(--on-surface-variant) }

.sa-input { width:100%; padding:9px 12px; border:1px solid var(--outline-variant); border-radius:0.5rem; font-size:14px; background:var(--surface-container-lowest); color:var(--on-surface) }
.sa-input:focus { outline:none; border-color:var(--primary); box-shadow:0 0 0 3px var(--primary-focus) }
.sa-textarea { width:100%; padding:9px 12px; border:1px solid var(--outline-variant); border-radius:0.5rem; font-size:14px; resize:vertical; font-family:inherit; background:var(--surface-container-lowest); color:var(--on-surface) }
.sa-textarea:focus { outline:none; border-color:var(--primary); box-shadow:0 0 0 3px var(--primary-focus) }
.sa-input-sm { width:100%; padding:8px 10px; border:1px solid var(--outline-variant); border-radius:6px; font-size:13px; background:var(--surface-container-lowest); color:var(--on-surface) }
.sa-input-sm:focus { outline:none; border-color:var(--primary); box-shadow:0 0 0 3px var(--primary-focus) }

.sa-field-group { margin-bottom:16px }
.sa-grid { display:grid; grid-template-columns:1fr 1fr; gap:16px; margin-bottom:16px }
.sa-section { background:var(--surface-container-low); border-radius:0.5rem; padding:14px }
.sa-section-title { font-size:11px; font-weight:600; text-transform:uppercase; color:var(--on-surface-dim); margin-bottom:8px }
.sa-help { font-size:10px; color:var(--on-surface-dim); margin-top:4px }

.sa-tools-grid { display:flex; flex-wrap:wrap; gap:6px; margin-top:6px }
.sa-tool-chip { display:inline-flex; align-items:center; gap:4px; padding:4px 10px; border-radius:12px; font-size:11px; cursor:pointer; border:1px solid var(--outline-variant); background:var(--surface-container-lowest); transition:all 0.15s ease; user-select:none }
.sa-tool-chip.selected { background:var(--primary); color:var(--on-primary,#fff); border-color:var(--primary) }
.sa-tool-chip:hover { border-color:var(--primary) }

.sa-toggles-row { display:flex; gap:20px; flex-wrap:wrap }
.sa-toggle-item { display:flex; align-items:center; gap:8px }
.sa-form-footer { display:flex; gap:8px; justify-content:flex-end; padding-top:12px; border-top:1px solid var(--outline-variant) }

.sa-list { display:flex; flex-direction:column; gap:10px }
.sa-card-view { display:flex; align-items:flex-start; justify-content:space-between; gap:10px }
.sa-card-body { flex:1; min-width:0 }
.sa-card-title-row { display:flex; align-items:center; gap:8px; flex-wrap:wrap; margin-bottom:4px }
.sa-card-name { font-weight:600; font-size:14px }
.sa-card-slug { font-size:12px; color:var(--on-surface-dim); font-family:monospace }
.sa-card-meta { font-size:12px; color:var(--on-surface-dim); margin-bottom:4px; display:flex; align-items:center; gap:6px; flex-wrap:wrap }
.sa-card-desc { font-size:12px; color:var(--on-surface-variant); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; max-width:500px }
.sa-card-actions { display:flex; gap:4px; flex-shrink:0; align-items:center }
.sa-card-disabled { opacity:0.55 }
.sa-inline-form { display:none; padding-top:16px; border-top:1px solid var(--outline-variant); margin-top:12px }

.sa-badge-model { background:rgba(0,122,255,0.1); color:var(--info); font-size:10px }
.sa-badge-tokens { background:rgba(88,86,214,0.1); color:#5856d6; font-size:10px }
.sa-badge-verify { background:rgba(52,199,89,0.1); color:var(--success); font-size:10px }
.sa-badge-spawn { background:rgba(255,149,0,0.12); color:var(--warning); font-size:10px }
.sa-badge-tools { background:var(--surface-container-low); color:var(--on-surface-dim); font-size:10px }

.sa-empty { padding:40px 20px; text-align:center }
.sa-empty-icon { font-size:32px; margin-bottom:8px }
.sa-empty-text { color:var(--on-surface-dim); font-size:14px }

/* Usage metrics */
.sa-usage-panel { margin-top:24px }
.sa-metrics-grid { display:grid; grid-template-columns:1.8fr 1fr 1fr 1fr; gap:12px }
.sa-usage-stat { text-align:center; padding:16px 12px }
.sa-usage-stat-value { font-size:22px; font-weight:700; color:var(--on-surface) }
.sa-usage-stat-label { font-size:10px; text-transform:uppercase; letter-spacing:0.04em; color:var(--on-surface-dim); margin-top:4px }
.sa-top3-card { padding:16px }
.sa-top3-title { font-size:10px; text-transform:uppercase; letter-spacing:0.04em; color:var(--on-surface-dim); font-weight:600; margin-bottom:12px }
.sa-top3-row { display:flex; align-items:center; justify-content:space-between; padding:6px 0; border-bottom:1px solid var(--outline-variant) }
.sa-top3-row:last-child { border-bottom:none }
.sa-top3-name { font-size:13px; font-weight:500 }
.sa-top3-slug { font-size:10px; color:var(--on-surface-dim); font-family:monospace }
.sa-top3-count { font-size:13px; font-weight:700; color:var(--primary) }
.sa-mock-badge { display:inline-block; font-size:10px; padding:2px 8px; border-radius:12px; background:rgba(245,158,11,0.12); color:var(--warning); font-weight:600; margin-left:8px; vertical-align:middle }

@media (max-width: 768px) {
  .sa-grid { grid-template-columns:1fr }
  .sa-row-top { flex-direction:column }
  .sa-row-toggle { padding-top:0 }
  .sa-metrics-grid { grid-template-columns:1fr 1fr }
}
</style>`
}


export function renderSubagentsSection(
  types: SubagentTypeRow[],
  usage: SubagentUsageSummary,
  lang: Lang,
  availableTools: Array<{ name: string; description: string }> = [],
): string {
  const activeCount = types.filter(t => t.enabled).length

  const cards = types.length === 0
    ? `<div class="sa-empty">
        <div class="sa-empty-icon">&#129302;</div>
        <div class="sa-empty-text">${l('noSubagents', lang)}</div>
      </div>`
    : types.map(t => {
        const toolsLabel = t.allowedTools.length === 0 ? l('allTools', lang) : `${t.allowedTools.length} tools`
        const toolChips = availableTools.map(av =>
          `<div class="sa-tool-chip${t.allowedTools.includes(av.name) ? ' selected' : ''}" data-tool="${esc(av.name)}" onclick="saToggleTool(this)" title="${esc(av.description)}">${esc(av.name)}</div>`
        ).join('')
        return `
      <div class="panel${!t.enabled ? ' sa-card-disabled' : ''}" data-sa-id="${esc(t.id)}" style="padding:var(--section-gap)">
        <div class="sa-card-view">
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
            <button type="button" class="act-btn act-btn-config act-btn--compact" onclick="saEdit('${esc(t.id)}', this)">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 013 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>
              ${l('edit', lang)}
            </button>
            <button type="button" class="act-btn act-btn-remove act-btn--compact" onclick="saDelete('${esc(t.id)}')">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4h6v2"/></svg>
              ${l('delete', lang)}
            </button>
          </div>
        </div>
        <!-- Inline edit form (hidden by default) -->
        <div class="sa-inline-form" data-sa-inline="${esc(t.id)}">
          <div class="sa-row-top">
            <div class="sa-row-top-field">
              <label class="sa-label">${l('name', lang)}</label>
              <input type="text" class="sa-if-name sa-input" value="${esc(t.name)}" placeholder="${l('namePlaceholder', lang)}">
            </div>
            <div class="sa-row-toggle">
              <label class="toggle toggle-sm"><input type="checkbox" class="sa-if-enabled"${t.enabled ? ' checked' : ''}><span class="toggle-slider"></span></label>
              <span class="sa-toggle-label">${l('enabled', lang)}</span>
            </div>
          </div>
          <div class="sa-field-group">
            <label class="sa-label">${l('description', lang)}</label>
            <textarea class="sa-if-desc sa-textarea" rows="2">${esc(t.description)}</textarea>
          </div>
          <div class="sa-grid">
            <div class="sa-section">
              <div class="sa-section-title">${l('modelTier', lang)}</div>
              <select class="sa-if-model js-custom-select" style="width:100%;margin-bottom:8px">
                <option value="normal"${t.modelTier === 'normal' ? ' selected' : ''}>${l('modelNormal', lang)}</option>
                <option value="complex"${t.modelTier === 'complex' ? ' selected' : ''}>${l('modelComplex', lang)}</option>
              </select>
              <div class="sa-section-title" style="margin-top:10px">${l('tokenBudget', lang)}</div>
              <input type="number" class="sa-if-budget sa-input-sm" value="${t.tokenBudget}" min="5000" step="5000">
              <div class="sa-help">${l('tokenBudgetHelp', lang)}</div>
              <div class="sa-section-title" style="margin-top:10px">${l('sortOrder', lang)}</div>
              <input type="number" class="sa-if-order sa-input-sm" value="${t.sortOrder}" min="0" step="1">
            </div>
            <div class="sa-section">
              <div class="sa-section-title">Options</div>
              <div class="sa-toggles-row">
                <div class="sa-toggle-item">
                  <label class="toggle toggle-sm"><input type="checkbox" class="sa-if-verify"${t.verifyResult ? ' checked' : ''}><span class="toggle-slider"></span></label>
                  <div>
                    <span class="sa-toggle-label">${l('verifyResult', lang)}</span>
                    <div class="sa-help">${l('verifyHelp', lang)}</div>
                  </div>
                </div>
                <div class="sa-toggle-item" style="margin-top:10px">
                  <label class="toggle toggle-sm"><input type="checkbox" class="sa-if-spawn"${t.canSpawnChildren ? ' checked' : ''}><span class="toggle-slider"></span></label>
                  <div>
                    <span class="sa-toggle-label">${l('canSpawn', lang)}</span>
                    <div class="sa-help">${l('spawnHelp', lang)}</div>
                  </div>
                </div>
              </div>
            </div>
          </div>
          <div class="sa-field-group">
            <label class="sa-label">${l('tools', lang)}</label>
            <div class="sa-help" style="margin-bottom:6px">${l('toolsHelp', lang)}</div>
            <div class="sa-if-tools sa-tools-grid">${toolChips}</div>
          </div>
          <div class="sa-field-group">
            <label class="sa-label">${l('systemPrompt', lang)}</label>
            <textarea class="sa-if-prompt sa-textarea" rows="4" style="font-family:monospace;font-size:12px">${esc(t.systemPrompt)}</textarea>
          </div>
          <div class="sa-form-footer">
            <button type="button" class="act-btn act-btn-config" onclick="saCancelEdit('${esc(t.id)}')">${l('cancel', lang)}</button>
            <button type="button" class="act-btn act-btn-add" onclick="saSaveInline('${esc(t.id)}')">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M19 21H5a2 2 0 01-2-2V5a2 2 0 012-2h11l5 5v11a2 2 0 01-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg>
              ${l('save', lang)}
            </button>
          </div>
        </div>
      </div>`
      }).join('')

  return `
    ${renderStyles()}

    <!-- Header -->
    <div class="sa-header">
      <div class="sa-header-left">
        <span class="sa-counter">${types.length} ${l('subagentCount', lang)} · ${activeCount} ${l('activeCount', lang)}</span>
      </div>
      <button type="button" class="act-btn act-btn-add" onclick="saShowForm()">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
        ${l('newSubagent', lang)}
      </button>
    </div>

    <!-- New form (top, for create only) -->
    <div id="sa-form" class="sa-form-wrap">
      <div class="panel">
        <div class="panel-body" style="padding:20px">
          <input type="hidden" id="sa-edit-id" value="">
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
              <label class="toggle toggle-sm"><input type="checkbox" id="sa-enabled" checked><span class="toggle-slider"></span></label>
              <span class="sa-toggle-label">${l('enabled', lang)}</span>
            </div>
          </div>
          <div class="sa-field-group">
            <label class="sa-label">${l('description', lang)}</label>
            <textarea id="sa-description" rows="2" placeholder="${l('descPlaceholder', lang)}" class="sa-textarea"></textarea>
          </div>
          <div class="sa-grid">
            <div class="sa-section">
              <div class="sa-section-title">${l('modelTier', lang)}</div>
              <select id="sa-model-tier" class="js-custom-select" style="width:100%;margin-bottom:8px">
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
                  <label class="toggle toggle-sm"><input type="checkbox" id="sa-verify-result" checked><span class="toggle-slider"></span></label>
                  <div>
                    <span class="sa-toggle-label">${l('verifyResult', lang)}</span>
                    <div class="sa-help">${l('verifyHelp', lang)}</div>
                  </div>
                </div>
                <div class="sa-toggle-item" style="margin-top:10px">
                  <label class="toggle toggle-sm"><input type="checkbox" id="sa-can-spawn"><span class="toggle-slider"></span></label>
                  <div>
                    <span class="sa-toggle-label">${l('canSpawn', lang)}</span>
                    <div class="sa-help">${l('spawnHelp', lang)}</div>
                  </div>
                </div>
              </div>
            </div>
          </div>
          <div class="sa-field-group">
            <label class="sa-label">${l('tools', lang)}</label>
            <div class="sa-help" style="margin-bottom:6px">${l('toolsHelp', lang)}</div>
            <div id="sa-tools-grid" class="sa-tools-grid">
              ${availableTools.map(t => `<div class="sa-tool-chip" data-tool="${esc(t.name)}" onclick="saToggleTool(this)" title="${esc(t.description)}">${esc(t.name)}</div>`).join('')}
            </div>
          </div>
          <div class="sa-field-group">
            <label class="sa-label">${l('systemPrompt', lang)}</label>
            <textarea id="sa-system-prompt" rows="4" placeholder="${l('promptPlaceholder', lang)}" class="sa-textarea" style="font-family:monospace;font-size:12px"></textarea>
          </div>
          <div class="sa-form-footer">
            <button type="button" class="act-btn act-btn-config" onclick="saHideForm()">${l('cancel', lang)}</button>
            <button type="button" class="act-btn act-btn-add" onclick="saSaveNew()">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M19 21H5a2 2 0 01-2-2V5a2 2 0 012-2h11l5 5v11a2 2 0 01-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg>
              ${l('save', lang)}
            </button>
          </div>
        </div>
      </div>
    </div>

    <!-- Subagent list -->
    <div id="sa-list" class="sa-list">${cards}</div>

    <!-- Usage metrics -->
    ${renderUsagePanel(usage, lang)}

    ${renderScript(lang)}`
}

function renderTop3(entries: Array<{ name: string; slug: string; executions: number }>, lang: Lang): string {
  if (entries.length === 0) return `<p style="font-size:13px;color:var(--on-surface-dim);margin:0">${l('noUsage', lang)}</p>`
  return entries.slice(0, 3).map((e, i) => `
    <div class="sa-top3-row">
      <div>
        <span class="sa-top3-name">${i + 1}. ${esc(e.name)}</span>
        <span class="sa-top3-slug"> ${esc(e.slug)}</span>
      </div>
      <span class="sa-top3-count">${e.executions}</span>
    </div>`).join('')
}

function renderUsagePanel(usage: SubagentUsageSummary, lang: Lang): string {
  const hasData = usage.totalExecutions > 0

  const mockTop3 = [
    { name: 'Investigador', slug: 'researcher', executions: 12 },
    { name: 'Analista', slug: 'data-analyst', executions: 8 },
    { name: 'Redactor', slug: 'writer', executions: 4 },
  ]
  const mockStats = { totalExecutions: 24, avgDurationMs: 3180, totalCostUsd: 0.048 }

  const top3Entries = hasData
    ? Object.entries(usage.bySubagent)
        .map(([slug, s]) => ({ name: s.name, slug, executions: s.executions }))
        .sort((a, b) => b.executions - a.executions)
    : mockTop3

  const stats = hasData ? usage : { ...usage, ...mockStats }
  const mockBadge = !hasData ? `<span class="sa-mock-badge">${l('mockLabel', lang)}</span>` : ''

  return `
    <div class="sa-usage-panel">
      <div class="filter-bar">
        <div class="filter-group">
          <span class="filter-label">${l('usageTitle', lang)}${mockBadge}</span>
        </div>
        <div class="filter-group">
          <span class="filter-label">${l('usagePeriod', lang)}</span>
          <select id="sa-usage-period" class="js-custom-select" onchange="saLoadUsage()">
            <option value="hour">${l('usageHour', lang)}</option>
            <option value="day" selected>${l('usageDay', lang)}</option>
            <option value="week">${l('usageWeek', lang)}</option>
            <option value="month">${l('usageMonth', lang)}</option>
          </select>
        </div>
      </div>

      <div id="sa-usage-content">
        <div class="sa-metrics-grid">
          <div class="panel sa-top3-card">
            <div class="sa-top3-title">${l('usageTop3', lang)}</div>
            <div id="sa-top3-rows">${renderTop3(top3Entries, lang)}</div>
          </div>
          <div class="panel sa-usage-stat">
            <div class="sa-usage-stat-value">${stats.totalExecutions}</div>
            <div class="sa-usage-stat-label">${l('usageExecs', lang)}</div>
          </div>
          <div class="panel sa-usage-stat">
            <div class="sa-usage-stat-value">${(stats.avgDurationMs / 1000).toFixed(1)}s</div>
            <div class="sa-usage-stat-label">${l('usageAvgTime', lang)}</div>
          </div>
          <div class="panel sa-usage-stat">
            <div class="sa-usage-stat-value">$${stats.totalCostUsd.toFixed(3)}</div>
            <div class="sa-usage-stat-label">${l('usageCost', lang)}</div>
          </div>
        </div>
      </div>
    </div>`
}

function renderScript(lang: Lang): string {
  return `<script>
(function() {
  const API = '/console/api/subagents'
  const L = ${JSON.stringify(labels[lang])}

  window.saToggleTool = function(el) { el.classList.toggle('selected') }

  function getTools(container) {
    return Array.from(container.querySelectorAll('.sa-tool-chip.selected'))
      .map(function(c) { return c.getAttribute('data-tool') })
  }

  // ── New subagent form ──
  window.saShowForm = function() {
    var f = document.getElementById('sa-form')
    f.style.display = 'block'
    document.getElementById('sa-slug').value = ''
    document.getElementById('sa-name').value = ''
    document.getElementById('sa-description').value = ''
    document.getElementById('sa-enabled').checked = true
    document.getElementById('sa-token-budget').value = '100000'
    document.getElementById('sa-sort-order').value = '0'
    document.getElementById('sa-verify-result').checked = true
    document.getElementById('sa-can-spawn').checked = false
    document.getElementById('sa-system-prompt').value = ''
    document.querySelectorAll('#sa-tools-grid .sa-tool-chip').forEach(function(c) { c.classList.remove('selected') })
    var sel = document.getElementById('sa-model-tier')
    if (sel) { sel.value = 'normal'; sel.dispatchEvent(new Event('change')) }
    f.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  window.saHideForm = function() { document.getElementById('sa-form').style.display = 'none' }

  window.saSaveNew = async function() {
    var slug = document.getElementById('sa-slug').value.trim()
    var name = document.getElementById('sa-name').value.trim()
    var tokenBudget = parseInt(document.getElementById('sa-token-budget').value, 10)
    if (!name) { alert(L.name + ' is required'); return }
    if (!slug) { alert(L.slug + ' is required'); return }
    if (tokenBudget < 5000) { alert('Token budget minimum: 5,000'); return }
    try {
      var res = await fetch(API + '/type', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({
        slug: slug, name: name,
        description: document.getElementById('sa-description').value.trim(),
        enabled: document.getElementById('sa-enabled').checked,
        modelTier: document.getElementById('sa-model-tier').value,
        tokenBudget: tokenBudget,
        verifyResult: document.getElementById('sa-verify-result').checked,
        canSpawnChildren: document.getElementById('sa-can-spawn').checked,
        allowedTools: getTools(document.getElementById('sa-tools-grid')),
        systemPrompt: document.getElementById('sa-system-prompt').value,
        sortOrder: parseInt(document.getElementById('sa-sort-order').value, 10) || 0,
      })})
      if (!res.ok) { var err = await res.text(); alert('Error: ' + err); return }
      location.reload()
    } catch(e) { alert('Error: ' + e.message) }
  }

  // ── Inline edit ──
  window.saEdit = function(id, btn) {
    // Close any other open inline forms
    document.querySelectorAll('.sa-inline-form').forEach(function(f) { f.style.display = 'none' })
    document.querySelectorAll('.sa-card-view').forEach(function(v) { v.style.display = 'flex' })

    var card = document.querySelector('[data-sa-id="' + id + '"]')
    if (!card) return
    var view = card.querySelector('.sa-card-view')
    var form = card.querySelector('.sa-inline-form')
    if (!view || !form) return

    view.style.display = 'none'
    form.style.display = 'block'

    // Init any js-custom-select inside this form
    form.querySelectorAll('select.js-custom-select:not([data-custom-init])').forEach(function(sel) {
      if (typeof window._initOneCustomSelect === 'function') window._initOneCustomSelect(sel)
    })

    card.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
  }

  window.saCancelEdit = function(id) {
    var card = document.querySelector('[data-sa-id="' + id + '"]')
    if (!card) return
    card.querySelector('.sa-card-view').style.display = 'flex'
    card.querySelector('.sa-inline-form').style.display = 'none'
  }

  window.saSaveInline = async function(id) {
    var card = document.querySelector('[data-sa-id="' + id + '"]')
    if (!card) return
    var form = card.querySelector('.sa-inline-form')
    var name = form.querySelector('.sa-if-name').value.trim()
    var tokenBudget = parseInt(form.querySelector('.sa-if-budget').value, 10)
    if (!name) { alert(L.name + ' is required'); return }
    if (tokenBudget < 5000) { alert('Token budget minimum: 5,000'); return }
    try {
      var res = await fetch(API + '/type', { method: 'PUT', headers: {'Content-Type':'application/json'}, body: JSON.stringify({
        id: id, name: name,
        description: form.querySelector('.sa-if-desc').value.trim(),
        enabled: form.querySelector('.sa-if-enabled').checked,
        modelTier: form.querySelector('.sa-if-model').value,
        tokenBudget: tokenBudget,
        verifyResult: form.querySelector('.sa-if-verify').checked,
        canSpawnChildren: form.querySelector('.sa-if-spawn').checked,
        allowedTools: getTools(form.querySelector('.sa-if-tools')),
        systemPrompt: form.querySelector('.sa-if-prompt').value,
        sortOrder: parseInt(form.querySelector('.sa-if-order').value, 10) || 0,
      })})
      if (!res.ok) { var err = await res.text(); alert('Error: ' + err); return }
      location.reload()
    } catch(e) { alert('Error: ' + e.message) }
  }

  window.saDelete = async function(id) {
    if (!confirm(L.deleteConfirm)) return
    try {
      var res = await fetch(API + '/type?id=' + encodeURIComponent(id), { method: 'DELETE' })
      if (!res.ok) { var err = await res.text(); alert('Error: ' + err); return }
      location.reload()
    } catch(e) { alert('Error: ' + e.message) }
  }

  // ── Usage metrics ──
  window.saLoadUsage = async function() {
    var period = document.getElementById('sa-usage-period').value
    try {
      var res = await fetch(API + '/usage?period=' + period)
      var data = await res.json()
      var hasData = data.totalExecutions > 0
      var mock = { totalExecutions:24, avgDurationMs:3180, totalCostUsd:0.048 }
      var d = hasData ? data : mock

      var top3 = hasData
        ? Object.entries(data.bySubagent || {})
            .map(function(e) { return { name: e[1].name, slug: e[0], executions: e[1].executions } })
            .sort(function(a,b) { return b.executions - a.executions })
            .slice(0,3)
        : [{name:'Investigador',slug:'researcher',executions:12},{name:'Analista',slug:'data-analyst',executions:8},{name:'Redactor',slug:'writer',executions:4}]

      var top3Html = top3.length === 0
        ? '<p style="font-size:13px;color:var(--on-surface-dim);margin:0">' + L.noUsage + '</p>'
        : top3.map(function(e,i) {
            return '<div class="sa-top3-row"><div><span class="sa-top3-name">' + (i+1) + '. ' + esc(e.name) + '</span><span class="sa-top3-slug"> ' + esc(e.slug) + '</span></div><span class="sa-top3-count">' + e.executions + '</span></div>'
          }).join('')

      var content = document.getElementById('sa-usage-content')
      content.innerHTML =
        '<div class="sa-metrics-grid">' +
          '<div class="panel sa-top3-card"><div class="sa-top3-title">' + L.usageTop3 + '</div>' + top3Html + '</div>' +
          stat(d.totalExecutions, L.usageExecs) +
          stat((d.avgDurationMs/1000).toFixed(1)+'s', L.usageAvgTime) +
          stat('$'+d.totalCostUsd.toFixed(3), L.usageCost) +
        '</div>'
    } catch(e) { console.error('Failed to load usage', e) }
  }

  function stat(value, label) {
    return '<div class="panel sa-usage-stat"><div class="sa-usage-stat-value">' + value + '</div><div class="sa-usage-stat-label">' + label + '</div></div>'
  }

  function esc(s) {
    return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;')
  }
})()
</script>`
}
