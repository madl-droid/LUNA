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
    sectionTools: 'Herramientas permitidas',
    sectionCats: 'Categorias de conocimiento',
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
    verifyHelp: 'Un LLM revisa la calidad del resultado. Si no pasa, reintenta hasta 3 veces con feedback iterativo.',
    canSpawn: 'Puede crear sub-subagentes',
    spawnHelp: 'Permite dividir la tarea en sub-tareas (max 1 nivel de profundidad).',
    toolsHelp: 'Sin seleccion = todas las herramientas disponibles.',
    noTools: 'No hay herramientas disponibles.',
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
    mockLabel: 'Datos de ejemplo',
    cardModel: 'Modelo',
    cardVerify: 'Verificar',
    cardSpawn: 'Sub-agentes',
    cardTools: 'Herramientas',
    cardKnowledge: 'Conocimiento',
    cardYes: '✓ Activo',
    cardNo: '— No',
    allTools: 'Todas',
    allCats: 'Todas',
    systemBadge: 'Sistema',
    systemDeleteBlocked: 'Los subagentes de sistema no se pueden eliminar.',
    googleGrounding: 'Google Search',
    googleGroundingHelp: 'Usa Google Search Grounding nativo (Gemini) para buscar información en la web.',
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
    sectionTools: 'Allowed tools',
    sectionCats: 'Knowledge categories',
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
    verifyHelp: 'An LLM reviews the result quality. If it fails, retries up to 3 times with iterative feedback.',
    canSpawn: 'Can create sub-subagents',
    spawnHelp: 'Allows splitting the task into sub-tasks (max 1 level deep).',
    toolsHelp: 'No selection = all available tools.',
    noTools: 'No tools available.',
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
    mockLabel: 'Sample data',
    cardModel: 'Model',
    cardVerify: 'Verify',
    cardSpawn: 'Sub-agents',
    cardTools: 'Tools',
    cardKnowledge: 'Knowledge',
    cardYes: '✓ Active',
    cardNo: '— No',
    allTools: 'All',
    allCats: 'All',
    systemBadge: 'System',
    systemDeleteBlocked: 'System subagents cannot be deleted.',
    googleGrounding: 'Google Search',
    googleGroundingHelp: 'Uses native Google Search Grounding (Gemini) to search the web for information.',
  },
}

function l(key: string, lang: Lang): string {
  return labels[lang]?.[key] ?? labels.es[key] ?? key
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
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

const chevronSvg = `<svg class="sa-collapse-chevron" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"/></svg>`

function renderStyles(): string {
  return `<style>
/* Subagents — scoped (.sa-) */
.sa-header { display:flex; align-items:center; justify-content:space-between; margin-bottom:16px }
.sa-counter { font-size:13px; color:var(--on-surface-dim) }
.sa-form-wrap { display:none; margin-bottom:16px }

.sa-label { font-size:12px; font-weight:600; text-transform:uppercase; color:var(--on-surface-dim); display:block; margin-bottom:4px }
.sa-toggle-label { font-size:12px; font-weight:500; color:var(--on-surface-variant) }
.sa-slug-preview { font-size:11px; font-family:monospace; color:var(--on-surface-dim); margin-top:3px }
.sa-help { font-size:10px; color:var(--on-surface-dim); margin-top:3px }
.sa-field-group { margin-bottom:14px }

.sa-input { width:100%; padding:9px 12px; border:1px solid var(--outline-variant); border-radius:0.5rem; font-size:14px; background:var(--surface-container-lowest); color:var(--on-surface) }
.sa-input:focus { outline:none; border-color:var(--primary); box-shadow:0 0 0 3px var(--primary-focus) }
.sa-textarea { width:100%; padding:9px 12px; border:1px solid var(--outline-variant); border-radius:0.5rem; font-size:14px; resize:vertical; font-family:inherit; background:var(--surface-container-lowest); color:var(--on-surface) }
.sa-textarea:focus { outline:none; border-color:var(--primary); box-shadow:0 0 0 3px var(--primary-focus) }
.sa-input-sm { width:100%; padding:8px 10px; border:1px solid var(--outline-variant); border-radius:6px; font-size:13px; background:var(--surface-container-lowest); color:var(--on-surface) }
.sa-input-sm:focus { outline:none; border-color:var(--primary); box-shadow:0 0 0 3px var(--primary-focus) }

/* Form sections (panel-like white boxes) */
.sa-form-section { background:var(--surface-container-lowest); border-radius:var(--radius-sm); padding:var(--panel-padding); margin-bottom:12px; box-shadow:var(--shadow-subtle); transition:box-shadow 0.2s ease }
.sa-form-section:hover { box-shadow:var(--shadow-float) }
.sa-form-section:last-of-type { margin-bottom:0 }
.sa-form-section-title { font-size:11px; font-weight:700; text-transform:uppercase; letter-spacing:0.05em; color:var(--on-surface-dim); padding-bottom:10px; margin-bottom:14px; border-bottom:1px solid var(--outline-variant) }
.sa-basic-cols { display:grid; grid-template-columns:1fr 1fr; gap:12px; margin-bottom:12px }
.sa-func-cols { display:grid; grid-template-columns:1fr 1.6fr; gap:12px; margin-bottom:12px; align-items:start }
.sa-func-right { display:flex; flex-direction:column; gap:8px }

/* Collapsible sections */
.sa-collapse { background:var(--surface-container-lowest); border-radius:var(--radius-sm); overflow:hidden; box-shadow:var(--shadow-subtle); transition:box-shadow 0.2s ease }
.sa-collapse:hover { box-shadow:var(--shadow-float) }
.sa-collapse-header { width:100%; display:flex; align-items:center; justify-content:space-between; padding:12px 14px; background:none; border:none; cursor:pointer; text-align:left; gap:8px }
.sa-collapse-header:hover { background:var(--surface-container-low) }
.sa-collapse-label { font-size:11px; font-weight:700; text-transform:uppercase; letter-spacing:0.05em; color:var(--on-surface-dim); flex:1 }
.sa-collapse-chevron { transition:transform 0.2s ease; flex-shrink:0; color:var(--on-surface-dim) }
.sa-collapse-open .sa-collapse-chevron { transform:rotate(180deg) }
.sa-collapse-body { padding:0 14px 14px }

/* Tool groups */
.sa-tool-group { margin-bottom:12px }
.sa-tool-group:last-child { margin-bottom:0 }
.sa-tool-group-header { display:flex; align-items:center; justify-content:space-between; padding:4px 0; margin-bottom:6px }
.sa-tool-group-name { font-size:10px; font-weight:700; text-transform:uppercase; letter-spacing:0.04em; color:var(--on-surface-dim) }
.sa-tool-grid { display:grid; grid-template-columns:repeat(3,1fr); gap:2px }
.sa-tool-row { display:flex; align-items:center; gap:5px; padding:5px 6px; border-radius:4px; cursor:pointer; font-size:12px; color:var(--on-surface); user-select:none }
.sa-tool-row:hover { background:var(--surface-container-high) }
.sa-tool-row input[type=checkbox] { flex-shrink:0; margin:0; cursor:pointer; accent-color:var(--primary) }
.sa-tool-name { flex:1; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap }
.sa-info-btn { width:15px; height:15px; border-radius:50%; border:1px solid var(--outline-variant); background:none; cursor:pointer; font-size:9px; font-weight:700; color:var(--on-surface-dim); flex-shrink:0; padding:0; line-height:13px; text-align:center }
.sa-info-btn:hover { background:var(--primary-light); color:var(--primary); border-color:var(--primary) }
.sa-divider { height:1px; background:var(--outline-variant); margin:10px 0 }

/* Toggles in config */
.sa-toggles-list { display:flex; flex-direction:column; gap:12px; margin-top:4px }
.sa-toggle-item { display:flex; align-items:flex-start; gap:8px }
.sa-toggle-item .toggle { flex-shrink:0; margin-top:1px }

/* Prompt */
.sa-prompt-toggle-row { display:flex; align-items:flex-start; gap:8px }
.sa-prompt-section { margin-top:12px }
.sa-form-footer { display:flex; gap:8px; justify-content:flex-end; padding-top:4px }

/* Card list */
.sa-list { display:flex; flex-direction:column; gap:10px }
.sa-card-disabled { opacity:0.55 }

/* Panel transparent when editing inline */
.panel.sa-card-editing {
  background:transparent !important;
  box-shadow:none !important;
  padding:0 !important;
  overflow:visible !important;
}

/* Card — horizontal layout */
.sa-card-row { display:flex; align-items:center; gap:16px; min-height:48px; padding:2px 0 }
.sa-card-main { flex:1; min-width:0 }
.sa-card-name-row { display:flex; align-items:baseline; gap:8px; margin-bottom:1px }
.sa-card-name { font-weight:700; font-size:14px; color:var(--on-surface) }
.sa-card-slug { font-size:11px; color:var(--on-surface-dim); font-family:monospace }
.sa-system-badge { display:inline-flex; align-items:center; gap:3px; padding:2px 8px; border-radius:var(--radius-pill); background:rgba(255,94,14,0.1); color:var(--primary); font-size:10px; font-weight:700; text-transform:uppercase; letter-spacing:0.03em }
.sa-card-desc { font-size:12px; color:var(--on-surface-variant); overflow:hidden; text-overflow:ellipsis; white-space:nowrap; max-width:400px }
/* Meta area — chips + action buttons, all same height and gap */
.sa-card-meta { display:flex; align-items:center; gap:6px; flex-shrink:0 }
.sa-meta-item { display:inline-flex; align-items:center; gap:3px; position:relative }
.sa-badge-model { font-size:11px; font-weight:600; white-space:nowrap; color:var(--info) }
.sa-badge-model.sa-badge-model--complex { color:var(--primary) }
.sa-stat-chip { display:inline-flex; align-items:center; gap:4px; padding:4px 9px; border-radius:var(--radius-pill); background:var(--surface-container-low); font-size:11px; font-weight:600; color:var(--on-surface-dim); white-space:nowrap }
.sa-verify-chip { background:var(--surface-container-low); color:var(--on-surface-dim) }
.sa-verify-chip.sa-verify-active { background:rgba(52,199,89,0.1); color:var(--success) }
.sa-edit-plain,.sa-del-plain { border:none; background:none; cursor:pointer; display:flex; align-items:center; padding:4px 6px; border-radius:6px; transition:all 0.15s; flex-shrink:0; color:var(--on-surface-dim) }
.sa-edit-plain:hover { color:var(--primary); background:var(--primary-light) }
.sa-del-plain:hover { color:var(--error); background:rgba(230,33,17,0.08) }
.sa-card-right { display:flex; align-items:center; flex-shrink:0; margin-left:4px }

.sa-inline-form { display:none; margin-top:4px }

/* Usage metrics */
.sa-usage-panel { margin-top:24px }
.sa-metrics-grid { display:grid; grid-template-columns:1.8fr 1fr 1fr 1fr; gap:12px; align-items:stretch }
.sa-usage-stat { display:flex; flex-direction:column; align-items:center; justify-content:center; padding:16px 12px; text-align:center }
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

.sa-empty { padding:40px 20px; text-align:center }
.sa-empty-icon { font-size:32px; margin-bottom:8px }
.sa-empty-text { color:var(--on-surface-dim); font-size:14px }

@media (max-width:768px) {
  .sa-basic-cols,.sa-func-cols { grid-template-columns:1fr }
  .sa-tool-grid { grid-template-columns:repeat(2,1fr) }
  .sa-metrics-grid { grid-template-columns:1fr 1fr }
  .sa-card-desc { max-width:280px }
}
</style>`
}

// Render tool groups for a form (new or inline)
function renderToolGroups(
  availableTools: AvailableTool[],
  allowedTools: string[],  // empty = all allowed
  idPrefix: string,
  lang: Lang,
): string {
  if (availableTools.length === 0) return `<p class="sa-help" style="margin:0">${l('noTools', lang)}</p>`

  const groupMap = new Map<string, AvailableTool[]>()
  for (const t of availableTools) {
    const g = t.group || 'general'
    if (!groupMap.has(g)) groupMap.set(g, [])
    groupMap.get(g)!.push(t)
  }

  const allAllowed = allowedTools.length === 0
  let html = ''
  for (const [group, tools] of groupMap) {
    const groupLabel = formatGroupName(group)
    // Group is enabled if allAllowed OR at least one tool from this group is in allowedTools
    const groupEnabled = allAllowed || tools.some(t => allowedTools.includes(t.name))
    const grpId = `${esc(idPrefix)}-grp-${group.replace(/[^a-z0-9]/gi, '-')}`

    html += `
      <div class="sa-tool-group">
        <div class="sa-tool-group-header">
          <span class="sa-tool-group-name">${esc(groupLabel)}</span>
          <label class="toggle toggle-sm" title="${esc(groupLabel)}">
            <input type="checkbox" class="sa-group-toggle" id="${grpId}"
              data-group="${esc(group)}"${groupEnabled ? ' checked' : ''}
              onchange="saGroupToggle(this)">
            <span class="toggle-slider"></span>
          </label>
        </div>
        <div class="sa-tool-grid" style="${groupEnabled ? '' : 'display:none'}">
          ${tools.map(tool => {
            const checked = allAllowed || allowedTools.includes(tool.name)
            const cbId = `${esc(idPrefix)}-t-${tool.name.replace(/[^a-z0-9]/gi, '-')}`
            return `<label class="sa-tool-row" for="${cbId}">
              <input type="checkbox" class="sa-tool-cb" id="${cbId}" value="${esc(tool.name)}"
                data-group="${esc(group)}"${checked ? ' checked' : ''}>
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

// Render category checkboxes
function renderCatRows(
  availableCategories: AvailableCategory[],
  allowedCategories: string[],
  idPrefix: string,
  lang: Lang,
): string {
  if (availableCategories.length === 0) return `<p class="sa-help" style="margin:0">${l('noCats', lang)}</p>`
  const allAllowed = allowedCategories.length === 0
  return `<div class="sa-tool-grid">
    ${availableCategories.map(c => {
      const checked = allAllowed || allowedCategories.includes(c.id)
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
  idPrefix: string
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
  const grounding = t ? t.googleSearchGrounding : false
  const systemPrompt = t ? t.systemPrompt : ''
  const allowedTools = t ? t.allowedTools : []
  const allowedCategories = t ? t.allowedKnowledgeCategories : []
  const hasPrompt = systemPrompt.length > 0
  const isSystem = t?.isSystem ?? false
  // System subagents: name, model, tools, verify, spawn, prompt, grounding are read-only
  const sysDisabled = isSystem ? ' disabled' : ''

  const A = (newAttr: string, inlineClass: string) => isNew ? newAttr : inlineClass
  const nameAttr = A('id="sa-name" class="sa-input"', 'class="sa-if-name sa-input"')
  const descAttr = A('id="sa-description" class="sa-textarea"', 'class="sa-if-desc sa-textarea"')
  const modelAttr = A('id="sa-model-tier" class="js-custom-select"', 'class="sa-if-model js-custom-select"')
  const budgetAttr = A('id="sa-token-budget" class="sa-input-sm"', 'class="sa-if-budget sa-input-sm"')
  const priorityAttr = A('id="sa-priority" class="sa-input-sm"', 'class="sa-if-priority sa-input-sm"')
  const verifyAttr = A('id="sa-verify-result"', 'class="sa-if-verify"')
  const spawnAttr = A('id="sa-can-spawn"', 'class="sa-if-spawn"')
  const groundingAttr = A('id="sa-grounding"', 'class="sa-if-grounding"')
  const promptToggleAttr = A('id="sa-prompt-toggle"', 'class="sa-if-prompt-toggle"')
  const promptSectionAttr = A('id="sa-prompt-section"', `class="sa-prompt-section" data-sa-ps="${esc(idPrefix)}"`)
  const promptLinesAttr = A('id="sa-prompt-lines" class="code-editor-lines"', 'class="sa-if-prompt-lines code-editor-lines"')
  const promptTextAttr = A('id="sa-system-prompt" class="code-editor-textarea"', 'class="sa-if-prompt code-editor-textarea"')
  const ceKey = isNew ? 'new' : esc(idPrefix)
  const pfx = idPrefix || 'new'

  const slugRow = isNew
    ? `<div class="sa-slug-preview">${l('slugPreview', lang)} <code id="sa-slug-preview">...</code><input type="hidden" id="sa-slug" value=""></div>`
    : `<div class="sa-slug-preview">${l('slugPreview', lang)} <code>${esc(t?.slug ?? '')}</code></div>`

  const enabledRow = isNew ? `
    <div style="display:flex;align-items:center;gap:8px;margin-top:10px">
      <label class="toggle toggle-sm"><input type="checkbox" id="sa-enabled" checked><span class="toggle-slider"></span></label>
      <span class="sa-toggle-label">${l('enabled', lang)}</span>
    </div>` : ''

  const toolsHtml = renderToolGroups(availableTools, allowedTools, pfx, lang)
  const catsHtml = renderCatRows(availableCategories, allowedCategories, pfx, lang)

  return `
    <!-- ① Datos básicos -->
    <div class="sa-form-section">
      <div class="sa-form-section-title">${l('sectionBasic', lang)}</div>
      <div class="sa-basic-cols">
        <div>
          <label class="sa-label">${l('name', lang)}</label>
          <input type="text" ${nameAttr} value="${name}" placeholder="${l('namePlaceholder', lang)}"${isNew ? ` oninput="saAutoSlug(this)"` : ''}${sysDisabled}>
          ${slugRow}
        </div>
        <div>
          <label class="sa-label">${l('modelTier', lang)}</label>
          <select ${modelAttr} style="width:100%"${sysDisabled}>
            <option value="normal"${modelTier === 'normal' ? ' selected' : ''}>${l('modelNormal', lang)}</option>
            <option value="complex"${modelTier === 'complex' ? ' selected' : ''}>${l('modelComplex', lang)}</option>
          </select>
          <div class="sa-help">${l('modelHelp', lang)}</div>
        </div>
      </div>
      <div>
        <label class="sa-label">${l('description', lang)}</label>
        <textarea ${descAttr} rows="2" placeholder="${l('descPlaceholder', lang)}">${desc}</textarea>
      </div>
      ${enabledRow}
    </div>

    <!-- ② Funcionamiento: 2 side-by-side boxes -->
    <div class="sa-func-cols">
      <!-- Left: Configuración -->
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
            <label class="toggle toggle-sm"><input type="checkbox" ${verifyAttr}${verifyResult ? ' checked' : ''}${sysDisabled}><span class="toggle-slider"></span></label>
            <div>
              <div class="sa-toggle-label">${l('verifyResult', lang)}</div>
              <div class="sa-help">${l('verifyHelp', lang)}</div>
            </div>
          </div>
          <div class="sa-toggle-item">
            <label class="toggle toggle-sm"><input type="checkbox" ${spawnAttr}${canSpawn ? ' checked' : ''}${sysDisabled}><span class="toggle-slider"></span></label>
            <div>
              <div class="sa-toggle-label">${l('canSpawn', lang)}</div>
              <div class="sa-help">${l('spawnHelp', lang)}</div>
            </div>
          </div>
          <div class="sa-toggle-item">
            <label class="toggle toggle-sm"><input type="checkbox" ${groundingAttr}${grounding ? ' checked' : ''}${sysDisabled}><span class="toggle-slider"></span></label>
            <div>
              <div class="sa-toggle-label">${l('googleGrounding', lang)}</div>
              <div class="sa-help">${l('googleGroundingHelp', lang)}</div>
            </div>
          </div>
        </div>
      </div>

      <!-- Right: 2 collapsibles -->
      <div class="sa-func-right">
        <!-- Herramientas collapsible (closed by default) -->
        <div class="sa-collapse">
          <button type="button" class="sa-collapse-header" onclick="saCollapseToggle(this)">
            <span class="sa-collapse-label">${l('sectionTools', lang)}</span>
            ${chevronSvg}
          </button>
          <div class="sa-collapse-body" style="display:none">
            <div class="sa-help" style="margin-bottom:10px">${l('toolsHelp', lang)}</div>
            ${toolsHtml}
          </div>
        </div>

        <!-- Categorías collapsible (closed by default) -->
        <div class="sa-collapse">
          <button type="button" class="sa-collapse-header" onclick="saCollapseToggle(this)">
            <span class="sa-collapse-label">${l('sectionCats', lang)}</span>
            ${chevronSvg}
          </button>
          <div class="sa-collapse-body" style="display:none">
            <div class="sa-help" style="margin-bottom:10px">${l('knowledgeCategoriesHelp', lang)}</div>
            ${catsHtml}
          </div>
        </div>
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
              oninput="saSyncCodeLines(this)"${sysDisabled}>${esc(systemPrompt)}</textarea>
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
        const toolsCount = t.allowedTools.length === 0 ? availableTools.length : t.allowedTools.length
        const catsCount = t.allowedKnowledgeCategories.length === 0 ? availableKnowledgeCategories.length : t.allowedKnowledgeCategories.length
        const toolsDisplay = String(toolsCount).padStart(3, '0')
        const catsDisplay = String(catsCount).padStart(3, '0')
        const modelLabel = t.modelTier === 'complex' ? 'Complejo' : 'Normal'

        return `
      <div class="panel${!t.enabled ? ' sa-card-disabled' : ''}" data-sa-id="${esc(t.id)}" ${t.isSystem ? 'data-sa-system="1"' : ''} style="padding:var(--panel-padding)">
        <!-- Card preview — horizontal layout -->
        <div class="sa-card-row">
          <div class="sa-card-main">
            <div class="sa-card-name-row">
              <span class="sa-card-name">${esc(t.name)}</span>
              <span class="sa-card-slug">${esc(t.slug)}</span>
              ${t.isSystem ? `<span class="sa-system-badge">${l('systemBadge', lang)}</span>` : ''}
            </div>
            ${t.description ? `<div class="sa-card-desc">${esc(t.description)}</div>` : ''}
          </div>
          <!-- Meta — all chips + edit/delete, uniform height/gap -->
          <div class="sa-card-meta">
            <div class="sa-meta-item">
              <span class="sa-badge-model${t.modelTier === 'complex' ? ' sa-badge-model--complex' : ''}">${esc(modelLabel)}</span>
              <button class="info-btn" type="button">i</button>
              <span class="info-tooltip info-flip">${esc(l('modelHelp', lang))}</span>
            </div>
            <div class="sa-meta-item">
              <span class="sa-stat-chip sa-verify-chip${t.verifyResult ? ' sa-verify-active' : ''}">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>
                ok
              </span>
              <button class="info-btn" type="button">i</button>
              <span class="info-tooltip info-flip">${esc(l('verifyHelp', lang))}</span>
            </div>
            <div class="sa-meta-item">
              <span class="sa-stat-chip">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/></svg>
                ${toolsDisplay}
              </span>
              <button class="info-btn" type="button">i</button>
              <span class="info-tooltip info-flip">${esc(l('toolsHelp', lang))}</span>
            </div>
            <div class="sa-meta-item">
              <span class="sa-stat-chip">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg>
                ${catsDisplay}
              </span>
              <button class="info-btn" type="button">i</button>
              <span class="info-tooltip info-flip">${esc(l('knowledgeCategoriesHelp', lang))}</span>
            </div>
            <button type="button" class="sa-edit-plain sa-edit-btn"
              style="${!t.enabled ? 'display:none' : ''}"
              onclick="saEdit('${esc(t.id)}')">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 013 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>
            </button>
            <button type="button" class="sa-del-plain sa-delete-btn"
              style="${t.enabled || t.isSystem ? 'display:none' : ''}"
              ${t.isSystem ? `disabled title="${l('systemDeleteBlocked', lang)}"` : ''}
              onclick="saDelete('${esc(t.id)}')">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4h6v2"/></svg>
            </button>
          </div>
          <div class="sa-card-right">
            <label class="toggle toggle-sm">
              <input type="checkbox" class="sa-card-toggle"${t.enabled ? ' checked' : ''}
                onchange="saToggleEnabled('${esc(t.id)}', this.checked)">
              <span class="toggle-slider"></span>
            </label>
          </div>
        </div>
        <!-- Inline edit form -->
        <div class="sa-inline-form" data-sa-inline="${esc(t.id)}">
          ${renderFormSections({ isNew: false, idPrefix: t.id, t, availableTools, availableCategories: availableKnowledgeCategories, lang })}
          <div class="sa-form-footer" style="margin-top:12px">
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

    <!-- New subagent form — no outer white box, sections are the gray boxes -->
    <div id="sa-form" class="sa-form-wrap">
      ${renderFormSections({ isNew: true, idPrefix: '', availableTools, availableCategories: availableKnowledgeCategories, lang })}
      <div class="sa-form-footer">
        <button type="button" class="act-btn act-btn-config" onclick="saHideForm()">${l('cancel', lang)}</button>
        <button type="button" class="act-btn act-btn-add" onclick="saSaveNew()">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M19 21H5a2 2 0 01-2-2V5a2 2 0 012-2h11l5 5v11a2 2 0 01-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg>
          ${l('save', lang)}
        </button>
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

  // ── Collapsible sections ──
  window.saCollapseToggle = function(header) {
    var body = header.parentNode.querySelector('.sa-collapse-body')
    var open = body.style.display !== 'none'
    body.style.display = open ? 'none' : 'block'
    header.classList.toggle('sa-collapse-open', !open)
  }

  // ── Group toggle (show/hide tools, check/uncheck all) ──
  window.saGroupToggle = function(toggleInput) {
    var groupEl = toggleInput.closest('.sa-tool-group')
    var grid = groupEl.querySelector('.sa-tool-grid')
    if (!grid) return
    grid.style.display = toggleInput.checked ? 'grid' : 'none'
    groupEl.querySelectorAll('.sa-tool-cb').forEach(function(cb) {
      cb.checked = toggleInput.checked
    })
  }

  // ── Slug auto-generation ──
  window.saAutoSlug = function(nameInput) {
    var slug = (nameInput.value || '')
      .toLowerCase().normalize('NFD').replace(/[\\u0300-\\u036f]/g, '')
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
    linesEl.innerHTML = textarea.value.split('\\n').map(function(_, i) {
      return '<span class="code-editor-line-num">' + (i + 1) + '</span>'
    }).join('')
  }

  // ── Close all open forms ──
  function closeAllForms() {
    var top = document.getElementById('sa-form')
    if (top) top.style.display = 'none'
    document.querySelectorAll('.sa-inline-form').forEach(function(f) { f.style.display = 'none' })
    document.querySelectorAll('.sa-card-row').forEach(function(v) { v.style.display = 'flex' })
    document.querySelectorAll('[data-sa-id]').forEach(function(card) { card.classList.remove('sa-card-editing') })
  }

  // Collect selected tools from a form container (only from enabled groups)
  function getSelectedTools(container) {
    var tools = []
    container.querySelectorAll('.sa-tool-group').forEach(function(group) {
      var toggle = group.querySelector('.sa-group-toggle')
      if (toggle && !toggle.checked) return
      group.querySelectorAll('.sa-tool-cb:checked').forEach(function(cb) { tools.push(cb.value) })
    })
    return tools
  }

  // Collect selected categories
  function getSelectedCats(container) {
    return Array.from(container.querySelectorAll('.sa-cat-cb:checked')).map(function(cb) { return cb.value })
  }

  // ── Toggle enabled (instant-apply from card) ──
  window.saToggleEnabled = async function(id, checked) {
    try {
      var res = await fetch(API + '/type', {
        method: 'PUT', headers: {'Content-Type':'application/json'},
        body: JSON.stringify({ id: id, enabled: checked })
      })
      if (!res.ok) {
        var card2 = document.querySelector('[data-sa-id="' + id + '"]')
        if (card2) { var t2 = card2.querySelector('.sa-card-toggle'); if (t2) t2.checked = !checked }
        alert('Error al actualizar'); return
      }
      var card = document.querySelector('[data-sa-id="' + id + '"]')
      if (!card) return
      card.classList.toggle('sa-card-disabled', !checked)
      var editBtn = card.querySelector('.sa-edit-btn')
      var delBtn = card.querySelector('.sa-delete-btn')
      if (editBtn) editBtn.style.display = checked ? '' : 'none'
      if (delBtn && !card.dataset.saSystem) delBtn.style.display = checked ? 'none' : ''
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
    var gr = document.getElementById('sa-grounding'); if (gr) gr.checked = false
    var pt = document.getElementById('sa-prompt-toggle'); if (pt) pt.checked = false
    var ps = document.getElementById('sa-prompt-section'); if (ps) ps.style.display = 'none'
    var sp2 = document.getElementById('sa-system-prompt'); if (sp2) sp2.value = ''
    // Reset tools: all group toggles ON, all tools checked
    f.querySelectorAll('.sa-group-toggle').forEach(function(t) {
      t.checked = true
      var grid = t.closest('.sa-tool-group').querySelector('.sa-tool-grid')
      if (grid) grid.style.display = 'grid'
    })
    f.querySelectorAll('.sa-tool-cb,.sa-cat-cb').forEach(function(cb) { cb.checked = true })
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
        googleSearchGrounding: document.getElementById('sa-grounding').checked,
        allowedTools: getSelectedTools(form),
        allowedKnowledgeCategories: getSelectedCats(form),
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
    var row = card.querySelector('.sa-card-row')
    var form = card.querySelector('.sa-inline-form')
    if (!row || !form) return
    row.style.display = 'none'
    card.classList.add('sa-card-editing')
    form.style.display = 'block'
    form.querySelectorAll('select.js-custom-select:not([data-custom-init])').forEach(function(sel) {
      if (typeof window._initOneCustomSelect === 'function') window._initOneCustomSelect(sel)
    })
    card.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
  }

  window.saCancelEdit = function(id) {
    var card = document.querySelector('[data-sa-id="' + id + '"]')
    if (!card) return
    var row = card.querySelector('.sa-card-row')
    var form = card.querySelector('.sa-inline-form')
    card.classList.remove('sa-card-editing')
    if (row) row.style.display = 'flex'
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
        googleSearchGrounding: form.querySelector('.sa-if-grounding').checked,
        allowedTools: getSelectedTools(form),
        allowedKnowledgeCategories: getSelectedCats(form),
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
      document.getElementById('sa-usage-content').innerHTML =
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
