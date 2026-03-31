// subagents/templates.ts — SSR HTML for console section

import type { SubagentTypeRow, SubagentUsageSummary } from './types.js'

type Lang = 'es' | 'en'
type AvailableTool = { name: string; displayName: string; description: string; group: string }
type AvailableCategory = { id: string; title: string }

const labels: Record<Lang, Record<string, string>> = {
  es: {
    title: 'Subagentes',
    newSubagent: 'Nuevo subagente',
    name: 'Nombre',
    namePlaceholder: 'Ej: Investigador, Analista de datos',
    slugPreview: 'slug:',
    description: 'Descripcion',
    descPlaceholder: 'Describe que hace este subagente y cuando deberia usarse...',
    enabled: 'Activo',
    sectionBasic: 'Datos basicos',
    sectionBehavior: 'Configuracion',
    sectionTools: 'Herramientas y conocimiento',
    sectionAdvanced: 'Avanzado',
    modelTier: 'Modelo',
    modelNormal: 'Normal (rapido)',
    modelComplex: 'Complejo (potente)',
    modelHelp: 'Normal: modelos rapidos y economicos. Complejo: modelos potentes para razonamiento profundo.',
    tokenBudget: 'Presupuesto de tokens',
    tokenBudgetHelp: 'Minimo 5,000. El subagente recibe advertencia al acercarse al limite.',
    priority: 'Prioridad',
    priorityHelp: 'Menor numero = aparece primero y se invoca con mayor prioridad.',
    verifyResult: 'Verificar resultado',
    verifyHelp: 'Un LLM revisa la calidad del resultado. Si no pasa, reintenta una vez.',
    canSpawn: 'Puede crear sub-subagentes',
    spawnHelp: 'Permite dividir la tarea en sub-tareas (max 1 nivel de profundidad).',
    tools: 'Herramientas permitidas',
    toolsHelp: 'Sin seleccion = todas las herramientas disponibles.',
    noTools: 'No hay herramientas disponibles.',
    knowledgeCategories: 'Categorias de conocimiento',
    knowledgeCategoriesHelp: 'Sin seleccion = accede a todas las categorias.',
    noCats: 'No hay categorias de conocimiento configuradas.',
    additionalPromptToggle: 'Agregar prompt de sistema adicional',
    additionalPromptHelp: 'Se carga junto con el prompt del orquestador al activar el subagente.',
    additionalPromptTitle: 'Prompt adicional',
    promptPlaceholder: 'Instrucciones especificas para este subagente...',
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
    allTools: 'Todas',
    mockLabel: 'Datos de ejemplo',
  },
  en: {
    title: 'Subagents',
    newSubagent: 'New subagent',
    name: 'Name',
    namePlaceholder: 'E.g.: Researcher, Data Analyst',
    slugPreview: 'slug:',
    description: 'Description',
    descPlaceholder: 'Describe what this subagent does and when it should be used...',
    enabled: 'Active',
    sectionBasic: 'Basic data',
    sectionBehavior: 'Configuration',
    sectionTools: 'Tools & knowledge',
    sectionAdvanced: 'Advanced',
    modelTier: 'Model',
    modelNormal: 'Normal (fast)',
    modelComplex: 'Complex (powerful)',
    modelHelp: 'Normal: fast, economical models. Complex: powerful models for deep reasoning.',
    tokenBudget: 'Token budget',
    tokenBudgetHelp: 'Minimum 5,000. Subagent receives a warning when approaching the limit.',
    priority: 'Priority',
    priorityHelp: 'Lower number = appears first and is invoked with higher priority.',
    verifyResult: 'Verify result',
    verifyHelp: 'An LLM reviews the result quality. If it fails, retries once.',
    canSpawn: 'Can create sub-subagents',
    spawnHelp: 'Allows splitting the task into sub-tasks (max 1 level deep).',
    tools: 'Allowed tools',
    toolsHelp: 'No selection = all available tools.',
    noTools: 'No tools available.',
    knowledgeCategories: 'Knowledge categories',
    knowledgeCategoriesHelp: 'No selection = access to all categories.',
    noCats: 'No knowledge categories configured.',
    additionalPromptToggle: 'Add additional system prompt',
    additionalPromptHelp: 'Loaded alongside the orchestrator\'s prompt when activating the subagent.',
    additionalPromptTitle: 'Additional prompt',
    promptPlaceholder: 'Specific instructions for this subagent...',
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
    allTools: 'All',
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

function formatGroupName(raw: string): string {
  return raw.split(/[-_]/).map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')
}

function codeEditorLines(value: string): string {
  const count = Math.max(1, (value || '').split('\n').length)
  let html = ''
  for (let i = 1; i <= count; i++) html += `<span class="code-editor-line-num">${i}</span>`
  return html
}

function renderStyles(): string {
  return `<style>
/* Subagents — scoped (.sa-) */
.sa-header { display:flex; align-items:center; justify-content:space-between; margin-bottom:16px }
.sa-counter { font-size:13px; color:var(--on-surface-dim) }

.sa-form-wrap { display:none; margin-bottom:16px }
.sa-label { font-size:12px; font-weight:600; text-transform:uppercase; color:var(--on-surface-dim); display:block; margin-bottom:4px }
.sa-toggle-label { font-size:12px; font-weight:500; color:var(--on-surface-variant) }
.sa-slug-preview { font-size:11px; font-family:monospace; color:var(--on-surface-dim); margin-top:3px }

.sa-input { width:100%; padding:9px 12px; border:1px solid var(--outline-variant); border-radius:0.5rem; font-size:14px; background:var(--surface-container-lowest); color:var(--on-surface) }
.sa-input:focus { outline:none; border-color:var(--primary); box-shadow:0 0 0 3px var(--primary-focus) }
.sa-textarea { width:100%; padding:9px 12px; border:1px solid var(--outline-variant); border-radius:0.5rem; font-size:14px; resize:vertical; font-family:inherit; background:var(--surface-container-lowest); color:var(--on-surface) }
.sa-textarea:focus { outline:none; border-color:var(--primary); box-shadow:0 0 0 3px var(--primary-focus) }
.sa-input-sm { width:100%; padding:8px 10px; border:1px solid var(--outline-variant); border-radius:6px; font-size:13px; background:var(--surface-container-lowest); color:var(--on-surface) }
.sa-input-sm:focus { outline:none; border-color:var(--primary); box-shadow:0 0 0 3px var(--primary-focus) }

.sa-field-group { margin-bottom:14px }
.sa-help { font-size:10px; color:var(--on-surface-dim); margin-top:3px }

/* Form sections */
.sa-form-section { background:var(--surface-container-low); border-radius:0.5rem; padding:16px; margin-bottom:12px }
.sa-form-section-title { font-size:11px; font-weight:700; text-transform:uppercase; letter-spacing:0.05em; color:var(--on-surface-dim); padding-bottom:10px; margin-bottom:14px; border-bottom:1px solid var(--outline-variant) }
.sa-basic-cols { display:grid; grid-template-columns:1fr 1fr; gap:12px; margin-bottom:12px }
.sa-func-cols { display:grid; grid-template-columns:1fr 1.6fr; gap:12px; margin-bottom:12px; align-items:start }

/* Toggles in behavior box */
.sa-toggles-list { display:flex; flex-direction:column; gap:12px; margin-top:4px }
.sa-toggle-item { display:flex; align-items:flex-start; gap:8px }
.sa-toggle-item .toggle { flex-shrink:0; margin-top:1px }

/* Tool groups */
.sa-tool-group { margin-bottom:14px }
.sa-tool-group:last-child { margin-bottom:0 }
.sa-tool-group-header { display:flex; align-items:center; justify-content:space-between; margin-bottom:6px }
.sa-tool-group-name { font-size:11px; font-weight:700; text-transform:uppercase; letter-spacing:0.04em; color:var(--on-surface-dim) }
.sa-tool-grid { display:grid; grid-template-columns:repeat(3,1fr); gap:2px }
.sa-tool-row { display:flex; align-items:center; gap:5px; padding:5px 6px; border-radius:4px; cursor:pointer; font-size:12px; color:var(--on-surface); user-select:none }
.sa-tool-row:hover { background:var(--surface-container-high) }
.sa-tool-row input[type=checkbox] { flex-shrink:0; margin:0; cursor:pointer }
.sa-tool-name { flex:1; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap }
.sa-info-btn { width:15px; height:15px; border-radius:50%; border:1px solid var(--outline-variant); background:none; cursor:pointer; font-size:9px; font-weight:700; color:var(--on-surface-dim); flex-shrink:0; padding:0; line-height:13px; text-align:center }
.sa-info-btn:hover { background:var(--primary-light); color:var(--primary); border-color:var(--primary) }
.sa-group-cb { cursor:pointer }
.sa-divider { height:1px; background:var(--outline-variant); margin:12px 0 }

/* Prompt section */
.sa-prompt-toggle-row { display:flex; align-items:flex-start; gap:8px }
.sa-prompt-section { margin-top:12px }

/* Card list */
.sa-list { display:flex; flex-direction:column; gap:10px }
.sa-card-view { display:flex; align-items:flex-start; justify-content:space-between; gap:10px }
.sa-card-body { flex:1; min-width:0 }
.sa-card-title-row { display:flex; align-items:center; gap:8px; flex-wrap:wrap; margin-bottom:4px }
.sa-card-name { font-weight:600; font-size:14px }
.sa-card-slug { font-size:12px; color:var(--on-surface-dim); font-family:monospace }
.sa-card-meta { font-size:12px; color:var(--on-surface-dim); margin-bottom:4px; display:flex; align-items:center; gap:6px; flex-wrap:wrap }
.sa-card-desc { font-size:12px; color:var(--on-surface-variant); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; max-width:500px }
.sa-card-actions { display:flex; gap:4px; flex-shrink:0; align-items:center }
.sa-card-toggle-wrap { display:flex; align-items:center; gap:6px; padding-right:6px; border-right:1px solid var(--outline-variant) }
.sa-card-disabled { opacity:0.55 }
.sa-inline-form { display:none; padding-top:16px; border-top:1px solid var(--outline-variant); margin-top:12px }
.sa-form-footer { display:flex; gap:8px; justify-content:flex-end; padding-top:4px }

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

@media (max-width:768px) {
  .sa-basic-cols { grid-template-columns:1fr }
  .sa-func-cols { grid-template-columns:1fr }
  .sa-tool-grid { grid-template-columns:repeat(2,1fr) }
  .sa-metrics-grid { grid-template-columns:1fr 1fr }
}
</style>`
}

// Render tools grouped by sourceModule
function renderToolsGroups(
  availableTools: AvailableTool[],
  allowedTools: string[],
  idPrefix: string,
  lang: Lang,
): string {
  if (availableTools.length === 0) return `<p class="sa-help">${l('noTools', lang)}</p>`

  // Group by group (sourceModule)
  const groupMap = new Map<string, AvailableTool[]>()
  for (const t of availableTools) {
    const g = t.group || 'general'
    if (!groupMap.has(g)) groupMap.set(g, [])
    groupMap.get(g)!.push(t)
  }

  let html = ''
  for (const [group, tools] of groupMap) {
    const groupLabel = formatGroupName(group)
    const allChecked = tools.length > 0 && tools.every(t => allowedTools.includes(t.name))
    const someChecked = tools.some(t => allowedTools.includes(t.name))
    const grpId = `${esc(idPrefix)}-grp-${group.replace(/[^a-z0-9]/gi, '-')}`

    html += `
      <div class="sa-tool-group">
        <div class="sa-tool-group-header">
          <span class="sa-tool-group-name">${esc(groupLabel)}</span>
          <input type="checkbox" class="sa-group-cb" id="${grpId}"
            data-group="${esc(group)}"
            ${allChecked ? 'checked' : ''}
            ${!allChecked && someChecked ? 'data-indeterminate="1"' : ''}
            onchange="saGroupToggle(this)">
        </div>
        <div class="sa-tool-grid">
          ${tools.map(tool => {
            const checked = allowedTools.includes(tool.name)
            const cbId = `${esc(idPrefix)}-t-${tool.name.replace(/[^a-z0-9]/gi, '-')}`
            return `<label class="sa-tool-row" for="${cbId}">
              <input type="checkbox" class="sa-tool-cb" id="${cbId}" value="${esc(tool.name)}"
                data-group="${esc(group)}"${checked ? ' checked' : ''}
                onchange="saToolCbChange(this)">
              <span class="sa-tool-name" title="${esc(tool.displayName)}">${esc(tool.displayName)}</span>
              <button type="button" class="sa-info-btn" title="${esc(tool.description)}"
                onclick="event.preventDefault();event.stopPropagation();alert(this.title)">i</button>
            </label>`
          }).join('')}
        </div>
      </div>`
  }
  return html
}

// Render knowledge categories as flat checkbox grid
function renderCatGrid(
  availableCategories: AvailableCategory[],
  allowedCategories: string[],
  idPrefix: string,
  lang: Lang,
): string {
  if (availableCategories.length === 0) return `<p class="sa-help">${l('noCats', lang)}</p>`
  return `<div class="sa-tool-grid">
    ${availableCategories.map(c => {
      const checked = allowedCategories.includes(c.id)
      const cbId = `${esc(idPrefix)}-c-${c.id.replace(/[^a-z0-9]/gi, '-')}`
      return `<label class="sa-tool-row" for="${cbId}">
        <input type="checkbox" class="sa-cat-cb" id="${cbId}" value="${esc(c.id)}"${checked ? ' checked' : ''}>
        <span class="sa-tool-name">${esc(c.title)}</span>
      </label>`
    }).join('')}
  </div>`
}

function renderFormSections(opts: {
  isNew: boolean
  idPrefix: string        // '' for new, t.id for inline
  t?: SubagentTypeRow
  availableTools: AvailableTool[]
  availableCategories: AvailableCategory[]
  lang: Lang
}): string {
  const { isNew, idPrefix, t, availableTools, availableCategories, lang } = opts
  const name = t ? esc(t.name) : ''
  const desc = t ? esc(t.description) : ''
  const modelTier = t ? t.modelTier : 'normal'
  const tokenBudget = t ? t.tokenBudget : 100000
  const priority = t ? t.sortOrder : 0
  const verifyResult = t ? t.verifyResult : true
  const canSpawn = t ? t.canSpawnChildren : false
  const systemPrompt = t ? t.systemPrompt : ''
  const allowedTools = t ? t.allowedTools : []
  const allowedCategories = t ? t.allowedKnowledgeCategories : []
  const hasPrompt = systemPrompt.length > 0

  // Selector helpers — new form uses id=, inline uses class=
  const A = (newAttr: string, inlineAttr: string) => isNew ? newAttr : inlineAttr
  const nameAttr = A('id="sa-name" class="sa-input"', 'class="sa-if-name sa-input"')
  const descAttr = A('id="sa-description" class="sa-textarea"', 'class="sa-if-desc sa-textarea"')
  const modelAttr = A('id="sa-model-tier" class="js-custom-select"', 'class="sa-if-model js-custom-select"')
  const budgetAttr = A('id="sa-token-budget" class="sa-input-sm"', 'class="sa-if-budget sa-input-sm"')
  const priorityAttr = A('id="sa-priority" class="sa-input-sm"', 'class="sa-if-priority sa-input-sm"')
  const verifyAttr = A('id="sa-verify-result"', 'class="sa-if-verify"')
  const spawnAttr = A('id="sa-can-spawn"', 'class="sa-if-spawn"')
  const promptToggleAttr = A('id="sa-prompt-toggle"', 'class="sa-if-prompt-toggle"')
  const promptSectionAttr = A('id="sa-prompt-section"', `class="sa-prompt-section" data-sa-ps="${esc(idPrefix)}"`)
  const promptLinesAttr = A('id="sa-prompt-lines" class="code-editor-lines"', 'class="sa-if-prompt-lines code-editor-lines"')
  const promptTextAttr = A('id="sa-system-prompt" class="code-editor-textarea"', 'class="sa-if-prompt code-editor-textarea"')
  const ceKey = isNew ? 'new' : esc(idPrefix)

  const slugRow = isNew
    ? `<div class="sa-slug-preview">${l('slugPreview', lang)} <code id="sa-slug-preview">...</code><input type="hidden" id="sa-slug" value=""></div>`
    : `<div class="sa-slug-preview">${l('slugPreview', lang)} <code>${esc(t?.slug ?? '')}</code></div>`

  const enabledRow = isNew ? `
    <div class="sa-field-group" style="display:flex;align-items:center;gap:8px;margin-top:12px">
      <label class="toggle toggle-sm"><input type="checkbox" id="sa-enabled" checked><span class="toggle-slider"></span></label>
      <span class="sa-toggle-label">${l('enabled', lang)}</span>
    </div>` : ''

  const toolsHtml = renderToolsGroups(availableTools, allowedTools, idPrefix || 'new', lang)
  const catsHtml = renderCatGrid(availableCategories, allowedCategories, idPrefix || 'new', lang)

  return `
    <!-- ① Datos básicos -->
    <div class="sa-form-section">
      <div class="sa-form-section-title">${l('sectionBasic', lang)}</div>
      <div class="sa-basic-cols">
        <div>
          <label class="sa-label">${l('name', lang)}</label>
          <input type="text" ${nameAttr} value="${name}" placeholder="${l('namePlaceholder', lang)}"${isNew ? ` oninput="saAutoSlug(this)"` : ''}>
          ${slugRow}
        </div>
        <div>
          <label class="sa-label">${l('modelTier', lang)}</label>
          <select ${modelAttr} style="width:100%">
            <option value="normal"${modelTier === 'normal' ? ' selected' : ''}>${l('modelNormal', lang)}</option>
            <option value="complex"${modelTier === 'complex' ? ' selected' : ''}>${l('modelComplex', lang)}</option>
          </select>
          <div class="sa-help">${l('modelHelp', lang)}</div>
        </div>
      </div>
      <div class="sa-field-group">
        <label class="sa-label">${l('description', lang)}</label>
        <textarea ${descAttr} rows="2" placeholder="${l('descPlaceholder', lang)}">${desc}</textarea>
      </div>
      ${enabledRow}
    </div>

    <!-- ② Funcionamiento: 2 side-by-side boxes -->
    <div class="sa-func-cols">
      <!-- Configuracion -->
      <div class="sa-form-section" style="margin-bottom:0">
        <div class="sa-form-section-title">${l('sectionBehavior', lang)}</div>
        <div class="sa-field-group">
          <label class="sa-label">${l('tokenBudget', lang)}</label>
          <input type="number" ${budgetAttr} value="${tokenBudget}" min="5000" step="5000">
          <div class="sa-help">${l('tokenBudgetHelp', lang)}</div>
        </div>
        <div class="sa-field-group">
          <label class="sa-label">${l('priority', lang)}</label>
          <input type="number" ${priorityAttr} value="${priority}" min="0" step="1">
          <div class="sa-help">${l('priorityHelp', lang)}</div>
        </div>
        <div class="sa-toggles-list">
          <div class="sa-toggle-item">
            <label class="toggle toggle-sm"><input type="checkbox" ${verifyAttr}${verifyResult ? ' checked' : ''}><span class="toggle-slider"></span></label>
            <div>
              <div class="sa-toggle-label">${l('verifyResult', lang)}</div>
              <div class="sa-help">${l('verifyHelp', lang)}</div>
            </div>
          </div>
          <div class="sa-toggle-item">
            <label class="toggle toggle-sm"><input type="checkbox" ${spawnAttr}${canSpawn ? ' checked' : ''}><span class="toggle-slider"></span></label>
            <div>
              <div class="sa-toggle-label">${l('canSpawn', lang)}</div>
              <div class="sa-help">${l('spawnHelp', lang)}</div>
            </div>
          </div>
        </div>
      </div>

      <!-- Herramientas y conocimiento -->
      <div class="sa-form-section" style="margin-bottom:0">
        <div class="sa-form-section-title">${l('sectionTools', lang)}</div>
        <div class="sa-label" style="margin-bottom:3px">${l('tools', lang)}</div>
        <div class="sa-help" style="margin-bottom:8px">${l('toolsHelp', lang)}</div>
        ${toolsHtml}
        <div class="sa-divider"></div>
        <div class="sa-label" style="margin-bottom:3px">${l('knowledgeCategories', lang)}</div>
        <div class="sa-help" style="margin-bottom:8px">${l('knowledgeCategoriesHelp', lang)}</div>
        ${catsHtml}
      </div>
    </div>

    <!-- ③ Avanzado -->
    <div class="sa-form-section">
      <div class="sa-form-section-title">${l('sectionAdvanced', lang)}</div>
      <div class="sa-prompt-toggle-row">
        <label class="toggle toggle-sm" style="flex-shrink:0;margin-top:1px">
          <input type="checkbox" ${promptToggleAttr}${hasPrompt ? ' checked' : ''}
            onchange="saTogglePrompt('${ceKey}', this.checked)">
          <span class="toggle-slider"></span>
        </label>
        <div>
          <div class="sa-toggle-label">${l('additionalPromptToggle', lang)}</div>
          <div class="sa-help">${l('additionalPromptHelp', lang)}</div>
        </div>
      </div>
      <div ${promptSectionAttr} style="display:${hasPrompt ? 'block' : 'none'}">
        <div class="code-editor" style="margin-top:12px">
          <div class="code-editor-header">
            <div class="code-editor-header-left">
              <svg class="code-editor-header-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg>
              <span>${l('additionalPromptTitle', lang)}</span>
            </div>
          </div>
          <div class="code-editor-body">
            <div ${promptLinesAttr}>${codeEditorLines(systemPrompt)}</div>
            <textarea ${promptTextAttr} rows="8" placeholder="${l('promptPlaceholder', lang)}"
              oninput="saSyncCodeLines(this)">${esc(systemPrompt)}</textarea>
          </div>
        </div>
      </div>
    </div>`
}

export function renderSubagentsSection(
  types: SubagentTypeRow[],
  usage: SubagentUsageSummary,
  lang: Lang,
  availableTools: AvailableTool[] = [],
  availableKnowledgeCategories: AvailableCategory[] = [],
): string {
  const activeCount = types.filter(t => t.enabled).length

  const cards = types.length === 0
    ? `<div class="sa-empty">
        <div class="sa-empty-icon">&#129302;</div>
        <div class="sa-empty-text">${l('noSubagents', lang)}</div>
      </div>`
    : types.map(t => {
        const toolsLabel = t.allowedTools.length === 0 ? l('allTools', lang) : `${t.allowedTools.length}`
        return `
      <div class="panel${!t.enabled ? ' sa-card-disabled' : ''}" data-sa-id="${esc(t.id)}" style="padding:var(--section-gap)">
        <div class="sa-card-view">
          <div class="sa-card-body">
            <div class="sa-card-title-row">
              <span class="sa-card-name">${esc(t.name)}</span>
              <span class="sa-card-slug">${esc(t.slug)}</span>
              ${!t.enabled ? '<span class="panel-badge badge-soon sa-badge-off">OFF</span>' : ''}
            </div>
            <div class="sa-card-meta">
              <span class="panel-badge sa-badge-model">${t.modelTier === 'complex' ? '&#9733; complex' : 'normal'}</span>
              <span class="panel-badge sa-badge-tokens">${formatNumber(t.tokenBudget)} tokens</span>
              ${t.verifyResult ? `<span class="panel-badge sa-badge-verify">&#10003; verify</span>` : ''}
              ${t.canSpawnChildren ? `<span class="panel-badge sa-badge-spawn">&#8618; spawn</span>` : ''}
              <span class="panel-badge sa-badge-tools">${esc(toolsLabel)} tools</span>
            </div>
            ${t.description ? `<div class="sa-card-desc" title="${esc(t.description)}">${esc(t.description)}</div>` : ''}
          </div>
          <div class="sa-card-actions">
            <!-- Toggle enabled (instant-apply, outside the form) -->
            <div class="sa-card-toggle-wrap">
              <label class="toggle toggle-sm">
                <input type="checkbox" class="sa-card-toggle" ${t.enabled ? 'checked' : ''}
                  onchange="saToggleEnabled('${esc(t.id)}', this.checked)">
                <span class="toggle-slider"></span>
              </label>
            </div>
            <button type="button" class="act-btn act-btn-config act-btn--compact" onclick="saEdit('${esc(t.id)}')">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 013 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>
              ${l('edit', lang)}
            </button>
            <button type="button" class="act-btn act-btn-remove act-btn--compact sa-delete-btn"
              style="${t.enabled ? 'display:none' : ''}"
              onclick="saDelete('${esc(t.id)}')">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4h6v2"/></svg>
              ${l('delete', lang)}
            </button>
          </div>
        </div>
        <!-- Inline edit form -->
        <div class="sa-inline-form" data-sa-inline="${esc(t.id)}">
          ${renderFormSections({ isNew: false, idPrefix: t.id, t, availableTools, availableCategories: availableKnowledgeCategories, lang })}
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

    <div class="sa-header">
      <span class="sa-counter">${types.length} ${l('subagentCount', lang)} · ${activeCount} ${l('activeCount', lang)}</span>
      <button type="button" class="act-btn act-btn-add" onclick="saShowForm()">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
        ${l('newSubagent', lang)}
      </button>
    </div>

    <!-- New subagent form -->
    <div id="sa-form" class="sa-form-wrap">
      <div class="panel">
        <div style="padding:20px">
          ${renderFormSections({ isNew: true, idPrefix: '', availableTools, availableCategories: availableKnowledgeCategories, lang })}
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

    <div id="sa-list" class="sa-list">${cards}</div>

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

  // Init indeterminate group checkboxes on load
  document.querySelectorAll('[data-indeterminate="1"]').forEach(function(cb) {
    cb.indeterminate = true
  })

  // ── Tool group checkbox logic ──
  window.saGroupToggle = function(groupCb) {
    var groupEl = groupCb.closest('.sa-tool-group')
    groupEl.querySelectorAll('.sa-tool-cb').forEach(function(cb) { cb.checked = groupCb.checked })
  }

  window.saToolCbChange = function(toolCb) {
    var groupEl = toolCb.closest('.sa-tool-group')
    var groupCb = groupEl.querySelector('.sa-group-cb')
    if (!groupCb) return
    var all = groupEl.querySelectorAll('.sa-tool-cb')
    var checked = groupEl.querySelectorAll('.sa-tool-cb:checked')
    groupCb.indeterminate = checked.length > 0 && checked.length < all.length
    groupCb.checked = checked.length === all.length
  }

  // ── Slug auto-generation ──
  window.saAutoSlug = function(nameInput) {
    var slug = (nameInput.value || '')
      .toLowerCase()
      .normalize('NFD').replace(/[\\u0300-\\u036f]/g, '')
      .replace(/[^a-z0-9\\s-]/g, '').trim()
      .replace(/\\s+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '')
    var preview = document.getElementById('sa-slug-preview')
    if (preview) preview.textContent = slug || '...'
    var hidden = document.getElementById('sa-slug')
    if (hidden) hidden.value = slug
  }

  // ── Additional prompt toggle ──
  window.saTogglePrompt = function(ceKey, checked) {
    var section = ceKey === 'new'
      ? document.getElementById('sa-prompt-section')
      : document.querySelector('[data-sa-ps="' + ceKey + '"]')
    if (section) section.style.display = checked ? 'block' : 'none'
  }

  // ── Code editor line sync ──
  window.saSyncCodeLines = function(textarea) {
    var linesEl = textarea.parentNode.querySelector('.code-editor-lines')
    if (!linesEl) return
    var lines = textarea.value.split('\\n')
    linesEl.innerHTML = lines.map(function(_, i) {
      return '<span class="code-editor-line-num">' + (i + 1) + '</span>'
    }).join('')
  }

  // ── Close all open forms ──
  function closeAllForms() {
    var topForm = document.getElementById('sa-form')
    if (topForm) topForm.style.display = 'none'
    document.querySelectorAll('.sa-inline-form').forEach(function(f) { f.style.display = 'none' })
    document.querySelectorAll('.sa-card-view').forEach(function(v) { v.style.display = 'flex' })
  }

  // ── Toggle enabled (instant-apply from card) ──
  window.saToggleEnabled = async function(id, checked) {
    try {
      var res = await fetch(API + '/type', {
        method: 'PUT',
        headers: {'Content-Type':'application/json'},
        body: JSON.stringify({ id: id, enabled: checked })
      })
      if (!res.ok) {
        var card = document.querySelector('[data-sa-id="' + id + '"]')
        if (card) { var t = card.querySelector('.sa-card-toggle'); if (t) t.checked = !checked }
        alert('Error al actualizar'); return
      }
      var card = document.querySelector('[data-sa-id="' + id + '"]')
      if (!card) return
      card.classList.toggle('sa-card-disabled', !checked)
      var badge = card.querySelector('.sa-badge-off')
      if (badge) badge.style.display = checked ? 'none' : ''
      var delBtn = card.querySelector('.sa-delete-btn')
      if (delBtn) delBtn.style.display = checked ? 'none' : ''
    } catch(e) { alert('Error: ' + e.message) }
  }

  // ── New subagent form ──
  window.saShowForm = function() {
    closeAllForms()
    var f = document.getElementById('sa-form')
    if (!f) return
    f.style.display = 'block'
    var n = document.getElementById('sa-name'); if (n) n.value = ''
    var sp = document.getElementById('sa-slug-preview'); if (sp) sp.textContent = '...'
    var sh = document.getElementById('sa-slug'); if (sh) sh.value = ''
    var d = document.getElementById('sa-description'); if (d) d.value = ''
    var e = document.getElementById('sa-enabled'); if (e) e.checked = true
    var b = document.getElementById('sa-token-budget'); if (b) b.value = '100000'
    var p = document.getElementById('sa-priority'); if (p) p.value = '0'
    var vr = document.getElementById('sa-verify-result'); if (vr) vr.checked = true
    var cs = document.getElementById('sa-can-spawn'); if (cs) cs.checked = false
    var pt = document.getElementById('sa-prompt-toggle'); if (pt) pt.checked = false
    var ps = document.getElementById('sa-prompt-section'); if (ps) ps.style.display = 'none'
    var sp2 = document.getElementById('sa-system-prompt'); if (sp2) sp2.value = ''
    f.querySelectorAll('.sa-tool-cb,.sa-cat-cb').forEach(function(cb) { cb.checked = false })
    f.querySelectorAll('.sa-group-cb').forEach(function(cb) { cb.checked = false; cb.indeterminate = false })
    var ms = document.getElementById('sa-model-tier')
    if (ms) { ms.value = 'normal'; ms.dispatchEvent(new Event('change')) }
    f.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  window.saHideForm = function() {
    var f = document.getElementById('sa-form'); if (f) f.style.display = 'none'
  }

  window.saSaveNew = async function() {
    var name = (document.getElementById('sa-name').value || '').trim()
    var slug = (document.getElementById('sa-slug').value || '').trim()
    var tokenBudget = parseInt(document.getElementById('sa-token-budget').value, 10)
    if (!name) { alert(L.name + ' es requerido'); return }
    if (!slug) { alert('El nombre debe tener al menos una letra para generar el slug'); return }
    if (tokenBudget < 5000) { alert('Presupuesto minimo: 5,000'); return }
    var form = document.getElementById('sa-form')
    var promptToggle = document.getElementById('sa-prompt-toggle')
    try {
      var res = await fetch(API + '/type', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({
        slug: slug, name: name,
        description: (document.getElementById('sa-description').value || '').trim(),
        enabled: document.getElementById('sa-enabled').checked,
        modelTier: document.getElementById('sa-model-tier').value,
        tokenBudget: tokenBudget,
        verifyResult: document.getElementById('sa-verify-result').checked,
        canSpawnChildren: document.getElementById('sa-can-spawn').checked,
        allowedTools: Array.from(form.querySelectorAll('.sa-tool-cb:checked')).map(function(cb) { return cb.value }),
        allowedKnowledgeCategories: Array.from(form.querySelectorAll('.sa-cat-cb:checked')).map(function(cb) { return cb.value }),
        systemPrompt: (promptToggle && promptToggle.checked) ? (document.getElementById('sa-system-prompt').value || '') : '',
        sortOrder: parseInt(document.getElementById('sa-priority').value, 10) || 0,
      })})
      if (!res.ok) { var err = await res.text(); alert('Error: ' + err); return }
      location.reload()
    } catch(e) { alert('Error: ' + e.message) }
  }

  // ── Inline edit ──
  window.saEdit = function(id) {
    closeAllForms()
    var card = document.querySelector('[data-sa-id="' + id + '"]')
    if (!card) return
    var view = card.querySelector('.sa-card-view')
    var form = card.querySelector('.sa-inline-form')
    if (!view || !form) return
    view.style.display = 'none'
    form.style.display = 'block'
    form.querySelectorAll('select.js-custom-select:not([data-custom-init])').forEach(function(sel) {
      if (typeof window._initOneCustomSelect === 'function') window._initOneCustomSelect(sel)
    })
    card.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
  }

  window.saCancelEdit = function(id) {
    var card = document.querySelector('[data-sa-id="' + id + '"]')
    if (!card) return
    var view = card.querySelector('.sa-card-view')
    var form = card.querySelector('.sa-inline-form')
    if (view) view.style.display = 'flex'
    if (form) form.style.display = 'none'
  }

  window.saSaveInline = async function(id) {
    var card = document.querySelector('[data-sa-id="' + id + '"]')
    if (!card) return
    var form = card.querySelector('.sa-inline-form')
    var name = (form.querySelector('.sa-if-name').value || '').trim()
    var tokenBudget = parseInt(form.querySelector('.sa-if-budget').value, 10)
    if (!name) { alert(L.name + ' es requerido'); return }
    if (tokenBudget < 5000) { alert('Presupuesto minimo: 5,000'); return }
    var promptToggle = form.querySelector('.sa-if-prompt-toggle')
    try {
      var res = await fetch(API + '/type', { method: 'PUT', headers: {'Content-Type':'application/json'}, body: JSON.stringify({
        id: id, name: name,
        description: (form.querySelector('.sa-if-desc').value || '').trim(),
        modelTier: form.querySelector('.sa-if-model').value,
        tokenBudget: tokenBudget,
        verifyResult: form.querySelector('.sa-if-verify').checked,
        canSpawnChildren: form.querySelector('.sa-if-spawn').checked,
        allowedTools: Array.from(form.querySelectorAll('.sa-tool-cb:checked')).map(function(cb) { return cb.value }),
        allowedKnowledgeCategories: Array.from(form.querySelectorAll('.sa-cat-cb:checked')).map(function(cb) { return cb.value }),
        systemPrompt: (promptToggle && promptToggle.checked) ? (form.querySelector('.sa-if-prompt').value || '') : '',
        sortOrder: parseInt(form.querySelector('.sa-if-priority').value, 10) || 0,
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
            .sort(function(a,b) { return b.executions - a.executions }).slice(0,3)
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
