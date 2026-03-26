// lead-scoring/templates.ts — SSR HTML for console section
// Renders lead-scoring config + leads view inline in the console.

import type { ConfigStore } from './config-store.js'
import type { QualifyingConfig, QualifiedAction, FrameworkType } from './types.js'

type Lang = 'es' | 'en'

const labels: Record<Lang, Record<string, string>> = {
  es: {
    title: 'Calificacion de Leads',
    desc: 'Configura criterios de calificacion, umbrales, y visualiza leads del sistema.',
    tab_config: 'Configuracion',
    tab_leads: 'Leads',
    sec_criteria: 'Criterios de Calificacion',
    sec_criteria_info: 'Define los criterios que LUNA usa para calificar leads. BANT (Budget, Authority, Need, Timeline) viene por defecto. Puedes agregar hasta 6 criterios custom.',
    sec_thresholds: 'Umbrales de Puntuacion',
    sec_thresholds_info: 'Define los rangos de puntuacion. Score 0 a "Frio" = lead frio. "Frio+1" a "Calificado-1" = en calificacion. "Calificado" a 100 = calificado.',
    sec_actions: 'Acciones Post-Calificacion',
    sec_actions_info: 'Que sucede cuando un lead se califica.',
    sec_disqualify: 'Motivos de Descalificacion',
    sec_disqualify_info: 'Cuando se detecta uno de estos motivos, el lead se mueve automaticamente al estado correspondiente.',
    sec_options: 'Opciones',
    th_key: 'Clave', th_name_es: 'Nombre (ES)', th_name_en: 'Nombre (EN)',
    th_type: 'Tipo', th_weight: 'Peso', th_required: 'Req', th_never_ask: 'No preguntar',
    th_options: 'Opciones',
    th_dq_key: 'Clave', th_dq_name_es: 'Nombre (ES)', th_dq_name_en: 'Nombre (EN)',
    th_dq_target: 'Estado destino',
    add_criterion: '+ Agregar criterio', add_dq: '+ Agregar motivo',
    save: 'Guardar', recalc: 'Recalcular',
    saved: 'Configuracion guardada', save_error: 'Error al guardar',
    recalc_done: 'Recalculacion completada', recalc_error: 'Error al recalcular',
    threshold_cold: 'Frio (max)', threshold_qualified: 'Calificado (min)',
    weight_total: 'Total de pesos',
    weight_error: 'Los pesos deben sumar 100 (actual: {n})',
    opt_recalc: 'Recalcular scores al cambiar config',
    opt_max_custom: 'Max criterios custom',
    opt_min_confidence: 'Confianza minima para extraccion',
    search: 'Buscar...', all_status: 'Todos los estados',
    sort_updated: 'Recientes', sort_score: 'Puntuacion', sort_created: 'Creacion',
    refresh: 'Actualizar', detail: 'Detalle', no_leads: 'No hay leads',
    prev: 'Anterior', next: 'Siguiente', showing: 'Mostrando', of: 'de',
    detail_score: 'Puntuacion', detail_status: 'Estado', detail_channel: 'Canal',
    detail_created: 'Creado', detail_updated: 'Actualizado', detail_activity: 'Ultima actividad',
    detail_msgs: 'Mensajes', detail_criteria: 'Criterios', detail_messages: 'Mensajes recientes',
    detail_disqualify: 'Descalificar',
    act_scheduled: 'Agendado', act_transferred_to_sales: 'Transferido a ventas',
    act_sold: 'Vendido', act_purchase_complete: 'Compra completada',
    default_action: 'Accion por defecto',
    status_new: 'Nuevo', status_qualifying: 'En calificacion', status_qualified: 'Calificado',
    status_scheduled: 'Agendado', status_attended: 'Atendido', status_converted: 'Convertido',
    status_out_of_zone: 'Fuera de zona', status_not_interested: 'No interesado',
    status_cold: 'Frio', status_blocked: 'Bloqueado',
    confirm_delete: 'Eliminar este criterio?',
    confirm_delete_dq: 'Eliminar este motivo?',
    th_name_col: 'Nombre', th_channel: 'Canal', th_score: 'Score',
    th_status: 'Estado', th_msgs: 'Msgs', th_last: 'Ultima actividad',
    // Framework labels
    sec_framework: 'Framework de Calificacion',
    sec_framework_info: 'Selecciona un framework predefinido o usa uno personalizado. Al cambiar de framework se reemplazan criterios y motivos de descalificacion.',
    fw_custom: 'Personalizado',
    fw_champ: 'CHAMP (B2B)',
    fw_spin: 'SPIN Selling (B2C)',
    fw_champ_gov: 'CHAMP + Gov (B2G)',
    fw_current: 'Framework activo',
    fw_apply: 'Aplicar framework',
    fw_confirm: 'Esto reemplazara los criterios actuales con los del framework seleccionado. Continuar?',
    fw_applied: 'Framework aplicado',
    fw_apply_error: 'Error al aplicar framework',
    // Stage labels
    stage_label: 'Etapa',
    no_stage: 'Sin etapa',
    stage_progress: 'Progreso por etapa',
    // Auto signals
    sec_auto_signals: 'Senales Automaticas',
    sec_auto_signals_info: 'Senales calculadas automaticamente por codigo (no por LLM). Peso 0 = desactivada.',
    signal_enabled: 'Activa',
    signal_weight: 'Peso',
  },
  en: {
    title: 'Lead Scoring',
    desc: 'Configure qualification criteria, thresholds, and view system leads.',
    tab_config: 'Configuration',
    tab_leads: 'Leads',
    sec_criteria: 'Qualification Criteria',
    sec_criteria_info: 'Define the criteria LUNA uses to qualify leads. BANT (Budget, Authority, Need, Timeline) comes by default. You can add up to 6 custom criteria.',
    sec_thresholds: 'Score Thresholds',
    sec_thresholds_info: 'Define score ranges. Score 0 to "Cold" = cold lead. "Cold+1" to "Qualified-1" = qualifying. "Qualified" to 100 = qualified.',
    sec_actions: 'Post-Qualification Actions',
    sec_actions_info: 'What happens when a lead qualifies.',
    sec_disqualify: 'Disqualification Reasons',
    sec_disqualify_info: 'When one of these reasons is detected, the lead is automatically moved to the corresponding status.',
    sec_options: 'Options',
    th_key: 'Key', th_name_es: 'Name (ES)', th_name_en: 'Name (EN)',
    th_type: 'Type', th_weight: 'Weight', th_required: 'Req', th_never_ask: 'Never ask',
    th_options: 'Options',
    th_dq_key: 'Key', th_dq_name_es: 'Name (ES)', th_dq_name_en: 'Name (EN)',
    th_dq_target: 'Target status',
    add_criterion: '+ Add criterion', add_dq: '+ Add reason',
    save: 'Save', recalc: 'Recalculate',
    saved: 'Configuration saved', save_error: 'Failed to save',
    recalc_done: 'Recalculation complete', recalc_error: 'Recalculation failed',
    threshold_cold: 'Cold (max)', threshold_qualified: 'Qualified (min)',
    weight_total: 'Total weight',
    weight_error: 'Weights must sum to 100 (current: {n})',
    opt_recalc: 'Recalculate scores on config change',
    opt_max_custom: 'Max custom criteria',
    opt_min_confidence: 'Minimum extraction confidence',
    search: 'Search...', all_status: 'All statuses',
    sort_updated: 'Recent', sort_score: 'Score', sort_created: 'Created',
    refresh: 'Refresh', detail: 'Detail', no_leads: 'No leads found',
    prev: 'Previous', next: 'Next', showing: 'Showing', of: 'of',
    detail_score: 'Score', detail_status: 'Status', detail_channel: 'Channel',
    detail_created: 'Created', detail_updated: 'Updated', detail_activity: 'Last activity',
    detail_msgs: 'Messages', detail_criteria: 'Criteria', detail_messages: 'Recent messages',
    detail_disqualify: 'Disqualify',
    act_scheduled: 'Scheduled', act_transferred_to_sales: 'Transferred to sales',
    act_sold: 'Sold', act_purchase_complete: 'Purchase complete',
    default_action: 'Default action',
    status_new: 'New', status_qualifying: 'Qualifying', status_qualified: 'Qualified',
    status_scheduled: 'Scheduled', status_attended: 'Attended', status_converted: 'Converted',
    status_out_of_zone: 'Out of zone', status_not_interested: 'Not interested',
    status_cold: 'Cold', status_blocked: 'Blocked',
    confirm_delete: 'Delete this criterion?',
    confirm_delete_dq: 'Delete this reason?',
    th_name_col: 'Name', th_channel: 'Channel', th_score: 'Score',
    th_status: 'Status', th_msgs: 'Msgs', th_last: 'Last activity',
    // Framework labels
    sec_framework: 'Qualification Framework',
    sec_framework_info: 'Select a predefined framework or use a custom one. Changing the framework replaces criteria and disqualification reasons.',
    fw_custom: 'Custom',
    fw_champ: 'CHAMP (B2B)',
    fw_spin: 'SPIN Selling (B2C)',
    fw_champ_gov: 'CHAMP + Gov (B2G)',
    fw_current: 'Active framework',
    fw_apply: 'Apply framework',
    fw_confirm: 'This will replace current criteria with the selected framework defaults. Continue?',
    fw_applied: 'Framework applied',
    fw_apply_error: 'Failed to apply framework',
    // Stage labels
    stage_label: 'Stage',
    no_stage: 'No stage',
    stage_progress: 'Stage progress',
    // Auto signals
    sec_auto_signals: 'Auto Signals',
    sec_auto_signals_info: 'Signals computed automatically by code (not LLM). Weight 0 = disabled.',
    signal_enabled: 'Enabled',
    signal_weight: 'Weight',
  },
}

function l(key: string, lang: Lang): string {
  return labels[lang]?.[key] ?? labels.es[key] ?? key
}

function esc(s: string): string {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

const ALL_ACTIONS: Array<{ value: QualifiedAction; labelKey: string }> = [
  { value: 'scheduled', labelKey: 'act_scheduled' },
  { value: 'transferred_to_sales', labelKey: 'act_transferred_to_sales' },
  { value: 'sold', labelKey: 'act_sold' },
  { value: 'purchase_complete', labelKey: 'act_purchase_complete' },
]

const ALL_STATUSES = [
  'new', 'qualifying', 'qualified', 'scheduled', 'attended', 'converted',
  'out_of_zone', 'not_interested', 'cold', 'blocked',
]

const DQ_TARGET_STATUSES = ['not_interested', 'out_of_zone', 'cold', 'blocked']

// ═══════════════════════════════════════════
// Main render
// ═══════════════════════════════════════════

export function renderLeadScoringConsole(store: ConfigStore, lang: Lang): string {
  const config = store.getConfig()

  return `
    ${renderStyles()}

    <!-- Tabs -->
    <div class="ls-tabs">
      <button class="ls-tab ls-tab-active" onclick="lsTab('config')" id="ls-tab-config">${l('tab_config', lang)}</button>
      <button class="ls-tab" onclick="lsTab('leads')" id="ls-tab-leads">${l('tab_leads', lang)}</button>
    </div>

    <!-- CONFIG TAB -->
    <div id="ls-content-config">
      ${renderFrameworkPanel(config, lang)}
      ${renderCriteriaPanel(config, lang)}
      ${renderThresholdsPanel(config, lang)}
      ${renderActionsPanel(config, lang)}
      ${renderDisqualifyPanel(config, lang)}
      ${renderAutoSignalsPanel(config, lang)}
      ${renderOptionsPanel(config, lang)}

      <!-- Save / Recalc buttons -->
      <div style="display:flex;gap:8px;padding:8px 0">
        <button type="button" class="wa-btn wa-btn-connect" onclick="lsSave()" id="ls-btn-save" style="font-size:13px;padding:6px 14px">${l('save', lang)}</button>
        <button type="button" class="wa-btn" onclick="lsRecalc()" style="font-size:13px;padding:6px 14px">${l('recalc', lang)}</button>
      </div>
    </div>

    <!-- LEADS TAB -->
    <div id="ls-content-leads" style="display:none">
      <div id="ls-stats" style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px"></div>

      <div style="display:flex;gap:8px;align-items:center;margin-bottom:12px;flex-wrap:wrap">
        <input type="text" placeholder="${l('search', lang)}" id="ls-search" oninput="lsDebounceSearch()"
          style="padding:6px 10px;border:1px solid var(--border);border-radius:6px;font-size:13px;width:180px">
        <select id="ls-status-filter" onchange="lsLoadLeads()" style="padding:6px 10px;border:1px solid var(--border);border-radius:6px;font-size:13px">
          <option value="">${l('all_status', lang)}</option>
          ${ALL_STATUSES.map(s => `<option value="${s}">${l('status_' + s, lang)}</option>`).join('')}
        </select>
        <select id="ls-sort" onchange="lsLoadLeads()" style="padding:6px 10px;border:1px solid var(--border);border-radius:6px;font-size:13px">
          <option value="updated">${l('sort_updated', lang)}</option>
          <option value="score">${l('sort_score', lang)}</option>
          <option value="created">${l('sort_created', lang)}</option>
        </select>
        <button class="wa-btn" onclick="lsLoadLeads()" style="font-size:12px;padding:4px 10px">${l('refresh', lang)}</button>
      </div>

      <div class="panel">
        <div class="panel-body" style="padding-top:8px">
          <table style="width:100%;border-collapse:collapse;font-size:13px">
            <thead>
              <tr style="border-bottom:2px solid var(--border)">
                <th style="text-align:left;padding:6px 8px;color:var(--text-tertiary);font-size:11px;text-transform:uppercase">${l('th_name_col', lang)}</th>
                <th style="text-align:left;padding:6px 8px;color:var(--text-tertiary);font-size:11px;text-transform:uppercase">${l('th_channel', lang)}</th>
                <th style="text-align:left;padding:6px 8px;color:var(--text-tertiary);font-size:11px;text-transform:uppercase">${l('th_score', lang)}</th>
                <th style="text-align:left;padding:6px 8px;color:var(--text-tertiary);font-size:11px;text-transform:uppercase">${l('th_status', lang)}</th>
                <th style="text-align:left;padding:6px 8px;color:var(--text-tertiary);font-size:11px;text-transform:uppercase">${l('th_msgs', lang)}</th>
                <th style="text-align:left;padding:6px 8px;color:var(--text-tertiary);font-size:11px;text-transform:uppercase">${l('th_last', lang)}</th>
                <th></th>
              </tr>
            </thead>
            <tbody id="ls-leads-tbody">
              <tr><td colspan="7" style="text-align:center;color:var(--text-tertiary);padding:24px">${l('no_leads', lang)}</td></tr>
            </tbody>
          </table>
          <div id="ls-pagination" style="display:flex;justify-content:space-between;align-items:center;margin-top:8px;font-size:12px;color:var(--text-tertiary)"></div>
        </div>
      </div>
    </div>

    <!-- Lead detail modal -->
    <div id="ls-modal" style="display:none;position:fixed;inset:0;background:rgba(0,0,0,0.5);z-index:1000;align-items:center;justify-content:center" onclick="if(event.target===this)lsCloseModal()">
      <div style="background:var(--bg-primary);border-radius:12px;padding:20px;max-width:700px;width:90%;max-height:85vh;overflow-y:auto" id="ls-modal-content"></div>
    </div>

    ${renderScript(config, lang)}`
}

// ═══════════════════════════════════════════
// Styles (scoped with ls- prefix)
// ═══════════════════════════════════════════

function renderStyles(): string {
  return `<style>
    .ls-tabs { display:flex;gap:0;margin-bottom:12px;border-bottom:2px solid var(--border) }
    .ls-tab { padding:8px 16px;font-size:13px;font-weight:500;cursor:pointer;color:var(--text-tertiary);
      border:none;border-bottom:2px solid transparent;margin-bottom:-2px;background:none }
    .ls-tab:hover { color:var(--text-primary) }
    .ls-tab-active { color:var(--accent,#38bdf8);border-bottom-color:var(--accent,#38bdf8) }
    .ls-table { width:100%;border-collapse:collapse;font-size:12px }
    .ls-table th { text-align:left;padding:6px 8px;color:var(--text-tertiary);font-size:10px;
      text-transform:uppercase;letter-spacing:0.05em;border-bottom:1px solid var(--border) }
    .ls-table td { padding:6px 8px;border-bottom:1px solid var(--border-light);vertical-align:middle }
    .ls-table input, .ls-table select { padding:4px 6px;border:1px solid var(--border);border-radius:4px;
      font-size:12px;width:100% }
    .ls-table .ls-w-input { width:55px;text-align:center }
    .ls-stat { border:1px solid var(--border);border-radius:8px;padding:8px 14px;min-width:80px;flex:1 }
    .ls-stat-val { font-size:1.4rem;font-weight:700 }
    .ls-stat-lbl { font-size:10px;color:var(--text-tertiary);text-transform:uppercase;letter-spacing:0.05em;margin-top:2px }
    .ls-status { display:inline-block;padding:2px 8px;border-radius:10px;font-size:11px;font-weight:600 }
    .ls-score-bar { width:50px;height:5px;background:var(--border);border-radius:3px;display:inline-block;vertical-align:middle;margin-right:4px }
    .ls-score-fill { height:100%;border-radius:3px }
    .ls-weight-total { font-size:11px;padding:6px 8px }
    .ls-dq-table { width:100%;border-collapse:collapse;font-size:12px }
    .ls-dq-table th { text-align:left;padding:6px 8px;color:var(--text-tertiary);font-size:10px;
      text-transform:uppercase;border-bottom:1px solid var(--border) }
    .ls-dq-table td { padding:6px 8px;border-bottom:1px solid var(--border-light) }
    .ls-dq-table input, .ls-dq-table select { padding:4px 6px;border:1px solid var(--border);border-radius:4px;font-size:12px;width:100% }
  </style>`
}

// ═══════════════════════════════════════════
// Config panels (SSR)
// ═══════════════════════════════════════════

const FRAMEWORK_OPTIONS: Array<{ value: FrameworkType; labelKey: string; desc: Record<Lang, string> }> = [
  { value: 'custom', labelKey: 'fw_custom', desc: { es: 'Criterios manuales sin framework predefinido', en: 'Manual criteria without predefined framework' } },
  { value: 'champ', labelKey: 'fw_champ', desc: { es: 'B2B: Desafios, Autoridad, Presupuesto, Priorizacion', en: 'B2B: Challenges, Authority, Money, Prioritization' } },
  { value: 'spin', labelKey: 'fw_spin', desc: { es: 'B2C: Situacion, Problema, Implicacion, Cierre', en: 'B2C: Situation, Problem, Implication, Need-payoff' } },
  { value: 'champ_gov', labelKey: 'fw_champ_gov', desc: { es: 'B2G: CHAMP + Etapa del proceso + Encaje normativo', en: 'B2G: CHAMP + Process Stage + Compliance Fit' } },
]

function renderFrameworkPanel(config: QualifyingConfig, lang: Lang): string {
  const currentFw = config.framework || 'custom'

  const options = FRAMEWORK_OPTIONS.map(fw => {
    const selected = fw.value === currentFw
    const borderColor = selected ? 'var(--accent,#38bdf8)' : 'var(--border)'
    const bg = selected ? 'rgba(56,189,248,0.08)' : 'transparent'
    return `<label style="display:flex;align-items:flex-start;gap:8px;padding:10px 12px;border:2px solid ${borderColor};border-radius:8px;cursor:pointer;background:${bg};transition:all 0.15s"
        onmouseover="this.style.borderColor='var(--accent,#38bdf8)'" onmouseout="this.style.borderColor='${selected ? 'var(--accent,#38bdf8)' : 'var(--border)'}'"
        onclick="document.getElementById('ls-fw-select').value='${fw.value}'">
        <input type="radio" name="ls-framework" value="${fw.value}" ${selected ? 'checked' : ''} style="margin-top:2px"
          onchange="document.getElementById('ls-fw-select').value='${fw.value}'">
        <div>
          <div style="font-weight:600;font-size:13px">${l(fw.labelKey, lang)}</div>
          <div style="font-size:11px;color:var(--text-tertiary);margin-top:2px">${fw.desc[lang]}</div>
        </div>
      </label>`
  }).join('')

  return `
    <div class="panel">
      <div class="panel-header" onclick="togglePanel(this)">
        <span class="panel-title">${l('sec_framework', lang)}</span>
        <span class="panel-chevron">&#9660;</span>
      </div>
      <div class="panel-body">
        <div class="panel-info">${l('sec_framework_info', lang)}</div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin:8px 0">
          ${options}
        </div>
        <input type="hidden" id="ls-fw-select" value="${currentFw}">
        <div style="display:flex;gap:8px;align-items:center;padding:8px 0">
          <button type="button" class="wa-btn wa-btn-connect" onclick="lsApplyFramework()" style="font-size:13px;padding:6px 14px">${l('fw_apply', lang)}</button>
          <span style="font-size:12px;color:var(--text-tertiary)">${l('fw_current', lang)}: <strong>${l('fw_' + currentFw, lang)}</strong></span>
        </div>
      </div>
    </div>`
}

function renderCriterionRow(cr: QualifyingConfig['criteria'][number], i: number): string {
  return `
    <tr data-ls-cri="${i}">
      <td><input value="${esc(cr.key)}" data-field="key" style="width:80px" onchange="lsUpdateCri(${i},'key',this.value)"></td>
      <td><input value="${esc(cr.name.es)}" data-field="name_es" onchange="lsUpdateCri(${i},'name_es',this.value)"></td>
      <td><input value="${esc(cr.name.en)}" data-field="name_en" onchange="lsUpdateCri(${i},'name_en',this.value)"></td>
      <td><select data-field="type" onchange="lsUpdateCri(${i},'type',this.value)">
        <option value="text" ${cr.type === 'text' ? 'selected' : ''}>Text</option>
        <option value="enum" ${cr.type === 'enum' ? 'selected' : ''}>Enum</option>
        <option value="boolean" ${cr.type === 'boolean' ? 'selected' : ''}>Boolean</option>
      </select></td>
      <td><input value="${esc((cr.options || []).join(','))}" data-field="options" placeholder="opt1,opt2"
        ${cr.type !== 'enum' ? 'disabled' : ''} onchange="lsUpdateCri(${i},'options',this.value)"></td>
      <td><input type="number" class="ls-w-input" value="${cr.weight}" min="0" max="100"
        onchange="lsUpdateCri(${i},'weight',this.value)"></td>
      <td style="text-align:center"><input type="checkbox" ${cr.required ? 'checked' : ''}
        onchange="lsUpdateCri(${i},'required',this.checked)"></td>
      <td style="text-align:center"><input type="checkbox" ${cr.neverAskDirectly ? 'checked' : ''}
        onchange="lsUpdateCri(${i},'neverAskDirectly',this.checked)"></td>
      <td><button type="button" class="wa-btn" onclick="lsRemoveCri(${i})" style="color:var(--error);font-size:12px;padding:2px 8px">X</button></td>
    </tr>`
}

function renderCriteriaPanel(config: QualifyingConfig, lang: Lang): string {
  const totalWeight = config.criteria.reduce((s, c) => s + c.weight, 0)
  const weightColor = totalWeight === 100 ? 'var(--success,#4ade80)' : 'var(--warning,#fbbf24)'
  const hasStages = config.stages && config.stages.length > 0

  const theadCols = `
    <th>${l('th_key', lang)}</th><th>${l('th_name_es', lang)}</th><th>${l('th_name_en', lang)}</th>
    <th>${l('th_type', lang)}</th><th>${l('th_options', lang)}</th><th>${l('th_weight', lang)}</th>
    <th>${l('th_required', lang)}</th><th>${l('th_never_ask', lang)}</th><th></th>`

  let bodyHtml: string

  if (hasStages) {
    // Group criteria by stage with stage headers
    const sortedStages = [...config.stages].sort((a, b) => a.order - b.order)
    const stageBlocks = sortedStages.map(stage => {
      const stageCriteria = config.criteria
        .map((cr, i) => ({ cr, i }))
        .filter(({ cr }) => cr.stage === stage.key)

      if (stageCriteria.length === 0) return ''

      const stageWeight = stageCriteria.reduce((s, { cr }) => s + cr.weight, 0)
      const stageHeader = `
        <tr class="ls-stage-header">
          <td colspan="9" style="background:rgba(56,189,248,0.06);padding:8px;font-weight:600;font-size:12px;border-bottom:2px solid var(--accent,#38bdf8)">
            ${esc(stage.name[lang] || stage.name.es)}
            <span style="font-weight:400;color:var(--text-tertiary);margin-left:8px">${esc(stage.description[lang] || stage.description.es)}</span>
            <span style="float:right;font-weight:400;color:var(--text-tertiary)">${stageWeight}pts</span>
          </td>
        </tr>`

      const rows = stageCriteria.map(({ cr, i }) => renderCriterionRow(cr, i)).join('')
      return stageHeader + rows
    }).join('')

    // Also render criteria without stage (orphans)
    const orphans = config.criteria
      .map((cr, i) => ({ cr, i }))
      .filter(({ cr }) => !cr.stage)
    const orphanRows = orphans.length > 0
      ? `<tr class="ls-stage-header"><td colspan="9" style="background:rgba(148,163,184,0.06);padding:8px;font-weight:600;font-size:12px;border-bottom:2px solid var(--border)">${l('no_stage', lang)}</td></tr>` +
        orphans.map(({ cr, i }) => renderCriterionRow(cr, i)).join('')
      : ''

    bodyHtml = stageBlocks + orphanRows
  } else {
    // Flat list (custom framework)
    bodyHtml = config.criteria.map((cr, i) => renderCriterionRow(cr, i)).join('')
  }

  const infoText = hasStages
    ? l('sec_criteria_info', lang) + ` <strong>(${l('fw_' + (config.framework || 'custom'), lang)})</strong>`
    : l('sec_criteria_info', lang)

  return `
    <div class="panel">
      <div class="panel-header" onclick="togglePanel(this)">
        <span class="panel-title">${l('sec_criteria', lang)} (${config.criteria.length})</span>
        <span class="panel-chevron">&#9660;</span>
      </div>
      <div class="panel-body">
        <div class="panel-info">${infoText}</div>
        <div style="overflow-x:auto">
          <table class="ls-table" id="ls-criteria-table">
            <thead><tr>${theadCols}</tr></thead>
            <tbody>${bodyHtml}</tbody>
          </table>
        </div>
        <div class="ls-weight-total" style="color:${weightColor}" id="ls-weight-total">${l('weight_total', lang)}: ${totalWeight}/100</div>
        <div style="padding:4px 0">
          <button type="button" class="wa-btn" onclick="lsAddCri()" style="font-size:12px;padding:4px 10px">${l('add_criterion', lang)}</button>
        </div>
      </div>
    </div>`
}

function renderThresholdsPanel(config: QualifyingConfig, lang: Lang): string {
  return `
    <div class="panel">
      <div class="panel-header" onclick="togglePanel(this)">
        <span class="panel-title">${l('sec_thresholds', lang)}</span>
        <span class="panel-chevron">&#9660;</span>
      </div>
      <div class="panel-body">
        <div class="panel-info">${l('sec_thresholds_info', lang)}</div>
        <div class="field">
          <div class="field-left"><span class="field-label">${l('threshold_cold', lang)}</span></div>
          <input type="number" id="ls-threshold-cold" value="${config.thresholds.cold}" min="0" max="99"
            style="width:80px" onchange="lsConfig.thresholds.cold=parseInt(this.value)">
        </div>
        <div class="field">
          <div class="field-left"><span class="field-label">${l('threshold_qualified', lang)}</span></div>
          <input type="number" id="ls-threshold-qualified" value="${config.thresholds.qualified}" min="1" max="100"
            style="width:80px" onchange="lsConfig.thresholds.qualified=parseInt(this.value)">
        </div>
        <div class="panel-info" style="padding-top:6px">
          0 - ${config.thresholds.cold} = <span class="ls-status" style="background:rgba(100,116,139,0.15);color:#64748b">${l('status_cold', lang)}</span>
          &nbsp; ${config.thresholds.cold + 1} - ${config.thresholds.qualified - 1} = <span class="ls-status" style="background:rgba(56,189,248,0.15);color:#38bdf8">${l('status_qualifying', lang)}</span>
          &nbsp; ${config.thresholds.qualified} - 100 = <span class="ls-status" style="background:rgba(74,222,128,0.15);color:#4ade80">${l('status_qualified', lang)}</span>
        </div>
      </div>
    </div>`
}

function renderActionsPanel(config: QualifyingConfig, lang: Lang): string {
  const actionRows = ALL_ACTIONS.map(a => {
    const enabled = config.qualifiedActions.includes(a.value)
    return `<div style="display:flex;align-items:center;gap:8px;padding:6px 0;border-bottom:1px solid var(--border-light)">
      <input type="checkbox" ${enabled ? 'checked' : ''} onchange="lsToggleAction('${a.value}',this.checked)">
      <span style="font-size:13px">${l(a.labelKey, lang)}</span>
    </div>`
  }).join('')

  const defaultOpts = config.qualifiedActions.map(a =>
    `<option value="${a}" ${a === config.defaultQualifiedAction ? 'selected' : ''}>${l('act_' + a, lang)}</option>`
  ).join('')

  return `
    <div class="panel">
      <div class="panel-header" onclick="togglePanel(this)">
        <span class="panel-title">${l('sec_actions', lang)}</span>
        <span class="panel-chevron">&#9660;</span>
      </div>
      <div class="panel-body">
        <div class="panel-info">${l('sec_actions_info', lang)}</div>
        ${actionRows}
        <div class="field" style="margin-top:8px">
          <div class="field-left"><span class="field-label">${l('default_action', lang)}</span></div>
          <select id="ls-default-action" onchange="lsConfig.defaultQualifiedAction=this.value">
            ${defaultOpts}
          </select>
        </div>
      </div>
    </div>`
}

function renderDisqualifyPanel(config: QualifyingConfig, lang: Lang): string {
  const rows = config.disqualifyReasons.map((dr, i) => `
    <tr>
      <td><input value="${esc(dr.key)}" onchange="lsUpdateDQ(${i},'key',this.value)" style="width:100px"></td>
      <td><input value="${esc(dr.name.es)}" onchange="lsUpdateDQ(${i},'name_es',this.value)"></td>
      <td><input value="${esc(dr.name.en)}" onchange="lsUpdateDQ(${i},'name_en',this.value)"></td>
      <td><select onchange="lsUpdateDQ(${i},'targetStatus',this.value)">
        ${DQ_TARGET_STATUSES.map(s => `<option value="${s}" ${s === dr.targetStatus ? 'selected' : ''}>${l('status_' + s, lang)}</option>`).join('')}
      </select></td>
      <td><button type="button" class="wa-btn" onclick="lsRemoveDQ(${i})" style="color:var(--error);font-size:12px;padding:2px 8px">X</button></td>
    </tr>`).join('')

  return `
    <div class="panel">
      <div class="panel-header" onclick="togglePanel(this)">
        <span class="panel-title">${l('sec_disqualify', lang)}</span>
        <span class="panel-chevron">&#9660;</span>
      </div>
      <div class="panel-body">
        <div class="panel-info">${l('sec_disqualify_info', lang)}</div>
        <div style="overflow-x:auto">
          <table class="ls-dq-table">
            <thead><tr>
              <th>${l('th_dq_key', lang)}</th><th>${l('th_dq_name_es', lang)}</th><th>${l('th_dq_name_en', lang)}</th>
              <th>${l('th_dq_target', lang)}</th><th></th>
            </tr></thead>
            <tbody id="ls-dq-tbody">${rows}</tbody>
          </table>
        </div>
        <div style="padding:4px 0">
          <button type="button" class="wa-btn" onclick="lsAddDQ()" style="font-size:12px;padding:4px 10px">${l('add_dq', lang)}</button>
        </div>
      </div>
    </div>`
}

function renderAutoSignalsPanel(config: QualifyingConfig, lang: Lang): string {
  const signals = config.autoSignals || []
  if (signals.length === 0) return ''

  const rows = signals.map((sig, i) => `
    <tr>
      <td style="font-weight:500;font-size:13px">${esc(sig.name[lang] || sig.name.es)}</td>
      <td style="font-size:11px;color:var(--text-tertiary)">${esc(sig.description[lang] || sig.description.es)}</td>
      <td style="text-align:center"><input type="checkbox" ${sig.enabled ? 'checked' : ''}
        onchange="lsUpdateSignal(${i},'enabled',this.checked)"></td>
      <td><input type="number" class="ls-w-input" value="${sig.weight}" min="0" max="100"
        onchange="lsUpdateSignal(${i},'weight',parseInt(this.value)||0)"></td>
    </tr>`).join('')

  return `
    <div class="panel">
      <div class="panel-header" onclick="togglePanel(this)">
        <span class="panel-title">${l('sec_auto_signals', lang)}</span>
        <span class="panel-chevron">&#9660;</span>
      </div>
      <div class="panel-body">
        <div class="panel-info">${l('sec_auto_signals_info', lang)}</div>
        <div style="overflow-x:auto">
          <table class="ls-table">
            <thead><tr>
              <th style="width:120px">${l('th_name_col', lang)}</th>
              <th>Info</th>
              <th style="width:60px">${l('signal_enabled', lang)}</th>
              <th style="width:60px">${l('signal_weight', lang)}</th>
            </tr></thead>
            <tbody>${rows}</tbody>
          </table>
        </div>
      </div>
    </div>`
}

function renderOptionsPanel(config: QualifyingConfig, lang: Lang): string {
  return `
    <div class="panel">
      <div class="panel-header" onclick="togglePanel(this)">
        <span class="panel-title">${l('sec_options', lang)}</span>
        <span class="panel-chevron">&#9660;</span>
      </div>
      <div class="panel-body">
        <div style="display:flex;align-items:center;gap:8px;padding:6px 0;border-bottom:1px solid var(--border-light)">
          <input type="checkbox" id="ls-opt-recalc" ${config.recalculateOnConfigChange ? 'checked' : ''}
            onchange="lsConfig.recalculateOnConfigChange=this.checked">
          <span style="font-size:13px">${l('opt_recalc', lang)}</span>
        </div>
        <div class="field">
          <div class="field-left"><span class="field-label">${l('opt_max_custom', lang)}</span></div>
          <input type="number" id="ls-opt-max-custom" value="${config.maxCustomCriteria}" min="0" max="6"
            style="width:60px" onchange="lsConfig.maxCustomCriteria=parseInt(this.value)">
        </div>
        <div class="field">
          <div class="field-left"><span class="field-label">${l('opt_min_confidence', lang)}</span></div>
          <input type="number" id="ls-opt-min-conf" value="${config.minConfidence}" min="0" max="1" step="0.1"
            style="width:80px" onchange="lsConfig.minConfidence=parseFloat(this.value)">
        </div>
      </div>
    </div>`
}

// ═══════════════════════════════════════════
// Client script
// ═══════════════════════════════════════════

function renderScript(config: QualifyingConfig, lang: Lang): string {
  return `<script>
(function() {
  var API = '/console/api/lead-scoring'
  var L = ${JSON.stringify(labels[lang])}
  var lsConfig = JSON.parse('${JSON.stringify(config).replace(/'/g, "\\'")}')
  var lsPage = 0, PAGE_SIZE = 25, searchTimeout = null

  // Expose config for inline onchange handlers
  window.lsConfig = lsConfig

  // ═══ Tabs ═══
  window.lsTab = function(tab) {
    document.getElementById('ls-content-config').style.display = tab === 'config' ? '' : 'none'
    document.getElementById('ls-content-leads').style.display = tab === 'leads' ? '' : 'none'
    document.getElementById('ls-tab-config').className = 'ls-tab' + (tab === 'config' ? ' ls-tab-active' : '')
    document.getElementById('ls-tab-leads').className = 'ls-tab' + (tab === 'leads' ? ' ls-tab-active' : '')
    if (tab === 'leads') { lsLoadStats(); lsLoadLeads() }
  }

  // ═══ Criteria CRUD ═══
  window.lsUpdateCri = function(i, field, value) {
    var cr = lsConfig.criteria[i]
    if (!cr) return
    if (field === 'key') cr.key = value
    else if (field === 'name_es') cr.name.es = value
    else if (field === 'name_en') cr.name.en = value
    else if (field === 'type') { cr.type = value; if (value !== 'enum') delete cr.options }
    else if (field === 'options') cr.options = value.split(',').map(function(s){return s.trim()}).filter(Boolean)
    else if (field === 'weight') cr.weight = parseInt(value, 10) || 0
    else if (field === 'required') cr.required = value
    else if (field === 'neverAskDirectly') cr.neverAskDirectly = value
    updateWeightTotal()
  }

  window.lsAddCri = function() {
    // For custom framework, enforce max criteria limit; presets are unlimited
    if (lsConfig.framework === 'custom') {
      var maxTotal = 4 + lsConfig.maxCustomCriteria
      if (lsConfig.criteria.length >= maxTotal) { lsToast('Max ' + maxTotal + ' criteria', 'error'); return }
    }
    var newCri = { key: 'custom_' + Date.now(), name: { es: 'Nuevo', en: 'New' }, type: 'text', weight: 0, required: false, neverAskDirectly: false }
    // If framework has stages, assign to first stage by default
    if (lsConfig.stages && lsConfig.stages.length > 0) {
      newCri.stage = lsConfig.stages[0].key
    }
    lsConfig.criteria.push(newCri)
    location.reload()
  }

  window.lsRemoveCri = function(i) {
    if (!confirm(L.confirm_delete)) return
    lsConfig.criteria.splice(i, 1)
    lsSave()
  }

  function updateWeightTotal() {
    var total = lsConfig.criteria.reduce(function(s,c){return s + c.weight}, 0)
    var el = document.getElementById('ls-weight-total')
    if (el) {
      el.textContent = L.weight_total + ': ' + total + '/100'
      el.style.color = total === 100 ? 'var(--success,#4ade80)' : 'var(--warning,#fbbf24)'
    }
  }

  // ═══ Disqualify CRUD ═══
  window.lsUpdateDQ = function(i, field, value) {
    var dr = lsConfig.disqualifyReasons[i]
    if (!dr) return
    if (field === 'key') dr.key = value
    else if (field === 'name_es') dr.name.es = value
    else if (field === 'name_en') dr.name.en = value
    else if (field === 'targetStatus') dr.targetStatus = value
  }

  window.lsAddDQ = function() {
    lsConfig.disqualifyReasons.push({ key: 'reason_' + Date.now(), name: { es: 'Nuevo', en: 'New' }, targetStatus: 'not_interested' })
    location.reload()
  }

  window.lsRemoveDQ = function(i) {
    if (!confirm(L.confirm_delete_dq)) return
    lsConfig.disqualifyReasons.splice(i, 1)
    lsSave()
  }

  // ═══ Actions ═══
  window.lsToggleAction = function(action, enabled) {
    if (enabled) {
      if (lsConfig.qualifiedActions.indexOf(action) === -1) lsConfig.qualifiedActions.push(action)
    } else {
      lsConfig.qualifiedActions = lsConfig.qualifiedActions.filter(function(a){return a !== action})
      if (lsConfig.defaultQualifiedAction === action && lsConfig.qualifiedActions.length > 0)
        lsConfig.defaultQualifiedAction = lsConfig.qualifiedActions[0]
    }
  }

  // ═══ Framework ═══
  window.lsApplyFramework = function() {
    var fw = document.getElementById('ls-fw-select').value
    if (!confirm(L.fw_confirm)) return
    fetch(API + '/apply-framework', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ framework: fw })
    }).then(function(r){return r.json()}).then(function(d) {
      if (d.ok) { lsToast(L.fw_applied, 'success'); location.reload() }
      else lsToast(d.error || L.fw_apply_error, 'error')
    }).catch(function(){ lsToast(L.fw_apply_error, 'error') })
  }

  // ═══ Auto Signals ═══
  window.lsUpdateSignal = function(i, field, value) {
    var sig = lsConfig.autoSignals && lsConfig.autoSignals[i]
    if (!sig) return
    if (field === 'enabled') sig.enabled = value
    else if (field === 'weight') sig.weight = value
  }

  // ═══ Save / Recalc ═══
  window.lsSave = function() {
    // Validate weights sum to 100 before saving
    if (lsConfig.criteria && lsConfig.criteria.length > 0) {
      var total = lsConfig.criteria.reduce(function(s,c){return s + (c.weight || 0)}, 0)
      if (total !== 100) {
        lsToast(L.weight_error.replace('{n}', total), 'error')
        return
      }
    }
    fetch(API + '/config', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(lsConfig)
    }).then(function(r){return r.json()}).then(function(d) {
      if (d.ok) { lsToast(L.saved, 'success'); location.reload() }
      else lsToast(d.error || L.save_error, 'error')
    }).catch(function(){ lsToast(L.save_error, 'error') })
  }

  window.lsRecalc = function() {
    fetch(API + '/recalculate', { method: 'POST' })
      .then(function(r){return r.json()}).then(function(d) {
        if (d.ok) lsToast(L.recalc_done + ' (' + d.recalculated + ')', 'success')
        else lsToast(L.recalc_error, 'error')
      }).catch(function(){ lsToast(L.recalc_error, 'error') })
  }

  // ═══ Leads tab ═══
  window.lsLoadStats = function() {
    fetch(API + '/stats').then(function(r){return r.json()}).then(function(d) {
      var stats = d.stats || {}
      var bar = document.getElementById('ls-stats')
      var keys = ['total','new','qualifying','qualified','scheduled','converted','cold']
      bar.innerHTML = keys.map(function(k) {
        var val = stats[k] || 0
        var label = k === 'total' ? 'Total' : (L['status_' + k] || k)
        return '<div class="ls-stat"><div class="ls-stat-val">' + val + '</div><div class="ls-stat-lbl">' + label + '</div></div>'
      }).join('')
    }).catch(function(){})
  }

  window.lsDebounceSearch = function() {
    clearTimeout(searchTimeout)
    searchTimeout = setTimeout(function(){ lsPage = 0; lsLoadLeads() }, 300)
  }

  window.lsLoadLeads = function() {
    var search = document.getElementById('ls-search').value
    var status = document.getElementById('ls-status-filter').value
    var sort = document.getElementById('ls-sort').value
    var params = new URLSearchParams({ limit: String(PAGE_SIZE), offset: String(lsPage * PAGE_SIZE), sort: sort, dir: 'desc' })
    if (search) params.set('search', search)
    if (status) params.set('status', status)

    fetch(API + '/leads?' + params.toString()).then(function(r){return r.json()}).then(function(data) {
      var tbody = document.getElementById('ls-leads-tbody')
      if (!data.leads || data.leads.length === 0) {
        tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;color:var(--text-tertiary);padding:24px">' + L.no_leads + '</td></tr>'
        document.getElementById('ls-pagination').innerHTML = ''
        return
      }
      tbody.innerHTML = data.leads.map(function(lead) {
        var pct = lead.qualificationScore
        var color = pct <= 30 ? '#64748b' : pct >= 70 ? '#4ade80' : '#fbbf24'
        var ago = lead.lastActivityAt ? lsTimeAgo(lead.lastActivityAt) : '-'
        var statusColor = lsStatusColor(lead.qualificationStatus)
        return '<tr style="cursor:pointer" onclick="lsDetail(\\'' + lead.contactId + '\\')">' +
          '<td>' + lsEsc(lead.displayName || lead.channelContactId || '-') + '</td>' +
          '<td style="font-size:12px;color:var(--text-tertiary)">' + lsEsc(lead.channel) + '</td>' +
          '<td><span class="ls-score-bar"><span class="ls-score-fill" style="width:' + pct + '%;background:' + color + '"></span></span> ' + pct + '</td>' +
          '<td><span class="ls-status" style="background:' + statusColor.bg + ';color:' + statusColor.fg + '">' + (L['status_' + lead.qualificationStatus] || lead.qualificationStatus) + '</span></td>' +
          '<td style="font-size:12px;color:var(--text-tertiary)">' + lead.messageCount + '</td>' +
          '<td style="font-size:12px;color:var(--text-tertiary)">' + ago + '</td>' +
          '<td><button class="wa-btn" onclick="event.stopPropagation();lsDetail(\\'' + lead.contactId + '\\')" style="font-size:11px;padding:2px 8px">' + L.detail + '</button></td>' +
          '</tr>'
      }).join('')

      var totalPages = Math.ceil(data.total / PAGE_SIZE)
      document.getElementById('ls-pagination').innerHTML =
        '<span>' + L.showing + ' ' + (lsPage * PAGE_SIZE + 1) + '-' + Math.min((lsPage + 1) * PAGE_SIZE, data.total) + ' ' + L.of + ' ' + data.total + '</span>' +
        '<div style="display:flex;gap:6px">' +
          '<button class="wa-btn" onclick="lsPage--;lsLoadLeads()" style="font-size:11px;padding:2px 8px"' + (lsPage === 0 ? ' disabled' : '') + '>' + L.prev + '</button>' +
          '<button class="wa-btn" onclick="lsPage++;lsLoadLeads()" style="font-size:11px;padding:2px 8px"' + (lsPage >= totalPages - 1 ? ' disabled' : '') + '>' + L.next + '</button>' +
        '</div>'
    }).catch(function() {
      document.getElementById('ls-leads-tbody').innerHTML = '<tr><td colspan="7" style="text-align:center;color:var(--text-tertiary);padding:24px">' + L.no_leads + '</td></tr>'
    })
  }

  // ═══ Lead detail ═══
  window.lsDetail = function(contactId) {
    fetch(API + '/lead?id=' + encodeURIComponent(contactId)).then(function(r){return r.json()}).then(function(data) {
      if (!data.lead) return
      var ld = data.lead
      var pct = ld.qualificationScore
      var color = pct <= 30 ? '#64748b' : pct >= 70 ? '#4ade80' : '#fbbf24'
      var statusColor = lsStatusColor(ld.qualificationStatus)

      var criteriaHtml = ''
      if (lsConfig.criteria) {
        var hasStages = lsConfig.stages && lsConfig.stages.length > 0
        if (hasStages) {
          // Group by stage
          var sortedStages = lsConfig.stages.slice().sort(function(a,b){return a.order - b.order})
          criteriaHtml = sortedStages.map(function(stage) {
            var stageCriteria = lsConfig.criteria.filter(function(cr){return cr.stage === stage.key})
            if (stageCriteria.length === 0) return ''
            var filledInStage = stageCriteria.filter(function(cr){
              var v = ld.qualificationData[cr.key]; return v !== undefined && v !== null && v !== ''
            }).length
            var stageHdr = '<div style="font-weight:600;font-size:12px;margin-top:8px;padding:4px 0;border-bottom:2px solid var(--accent,#38bdf8);display:flex;justify-content:space-between">' +
              '<span>' + lsEsc(stage.name.${lang === 'en' ? 'en' : 'es'} || stage.name.es) + '</span>' +
              '<span style="font-weight:400;color:var(--text-tertiary);font-size:11px">' + filledInStage + '/' + stageCriteria.length + '</span></div>'
            var rows = stageCriteria.map(function(cr) {
              var val = ld.qualificationData[cr.key]
              var filled = val !== undefined && val !== null && val !== ''
              return '<div style="display:flex;align-items:center;gap:8px;padding:4px 0 4px 8px;border-bottom:1px solid var(--border-light);font-size:13px">' +
                '<span style="color:var(--text-tertiary);width:100px;flex-shrink:0">' + lsEsc(cr.name.${lang === 'en' ? 'en' : 'es'} || cr.name.es) + '</span>' +
                '<span style="flex:1;color:' + (filled ? 'var(--text-primary)' : 'var(--text-tertiary)') + '">' + (filled ? lsEsc(String(val)) : '-') + '</span>' +
                '<span style="color:var(--text-tertiary);font-size:11px;width:50px;text-align:right">' + cr.weight + 'pts</span>' +
              '</div>'
            }).join('')
            return stageHdr + rows
          }).join('')
        } else {
          criteriaHtml = lsConfig.criteria.map(function(cr) {
            var val = ld.qualificationData[cr.key]
            var filled = val !== undefined && val !== null && val !== ''
            return '<div style="display:flex;align-items:center;gap:8px;padding:4px 0;border-bottom:1px solid var(--border-light);font-size:13px">' +
              '<span style="color:var(--text-tertiary);width:100px;flex-shrink:0">' + lsEsc(cr.name.${lang === 'en' ? 'en' : 'es'} || cr.name.es) + '</span>' +
              '<span style="flex:1;color:' + (filled ? 'var(--text-primary)' : 'var(--text-tertiary)') + '">' + (filled ? lsEsc(String(val)) : '-') + '</span>' +
              '<span style="color:var(--text-tertiary);font-size:11px;width:50px;text-align:right">' + cr.weight + 'pts</span>' +
            '</div>'
          }).join('')
        }
      }

      var msgsHtml = ''
      if (ld.recentMessages && ld.recentMessages.length > 0) {
        msgsHtml = ld.recentMessages.map(function(m) {
          var cls = m.senderType === 'user' ? 'background:var(--bg-secondary)' : 'background:rgba(30,58,95,0.5);margin-left:auto'
          var text = (m.content && m.content.text) || JSON.stringify(m.content)
          return '<div style="max-width:80%;padding:8px 10px;border-radius:8px;margin-bottom:4px;font-size:13px;' + cls + '">' +
            lsEsc(text) + '<div style="font-size:10px;color:var(--text-tertiary);margin-top:2px">' + new Date(m.createdAt).toLocaleString() + '</div></div>'
        }).join('')
      } else {
        msgsHtml = '<div style="color:var(--text-tertiary);font-size:13px;padding:12px 0">No messages</div>'
      }

      var dqOpts = lsConfig.disqualifyReasons.map(function(dr) {
        return '<option value="' + dr.key + '">' + lsEsc(dr.name.${lang === 'en' ? 'en' : 'es'} || dr.name.es) + '</option>'
      }).join('')

      var modal = document.getElementById('ls-modal-content')
      modal.innerHTML =
        '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">' +
          '<span style="font-weight:600;font-size:16px">' + lsEsc(ld.displayName || ld.channelContactId || 'Lead') + '</span>' +
          '<button type="button" onclick="lsCloseModal()" style="background:none;border:none;font-size:18px;cursor:pointer;color:var(--text-tertiary)">&times;</button>' +
        '</div>' +
        '<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:12px">' +
          '<div><div style="font-size:10px;color:var(--text-tertiary);text-transform:uppercase">' + L.detail_score + '</div>' +
            '<div><span class="ls-score-bar" style="width:80px"><span class="ls-score-fill" style="width:' + pct + '%;background:' + color + '"></span></span> ' + pct + '/100</div></div>' +
          '<div><div style="font-size:10px;color:var(--text-tertiary);text-transform:uppercase">' + L.detail_status + '</div>' +
            '<div><span class="ls-status" style="background:' + statusColor.bg + ';color:' + statusColor.fg + '">' + (L['status_' + ld.qualificationStatus] || ld.qualificationStatus) + '</span></div></div>' +
          '<div><div style="font-size:10px;color:var(--text-tertiary);text-transform:uppercase">' + L.detail_channel + '</div>' +
            '<div style="font-size:13px">' + ld.channels.map(function(ch){return lsEsc(ch.channel + ': ' + ch.channelContactId)}).join(', ') + '</div></div>' +
          '<div><div style="font-size:10px;color:var(--text-tertiary);text-transform:uppercase">' + L.detail_msgs + '</div>' +
            '<div style="font-size:13px">' + ld.messageCount + '</div></div>' +
        '</div>' +
        '<div style="margin-bottom:12px"><div style="font-size:12px;color:var(--text-tertiary);margin-bottom:6px">' + L.detail_criteria + '</div>' + (criteriaHtml || '<div style="color:var(--text-tertiary);font-size:13px">-</div>') + '</div>' +
        '<div style="margin-bottom:12px"><div style="font-size:12px;color:var(--text-tertiary);margin-bottom:6px">' + L.detail_messages + '</div><div style="max-height:250px;overflow-y:auto">' + msgsHtml + '</div></div>' +
        (dqOpts ? '<div style="display:flex;gap:6px;align-items:center;padding-top:10px;border-top:1px solid var(--border)">' +
          '<select id="ls-dq-select" style="padding:4px 8px;border:1px solid var(--border);border-radius:6px;font-size:12px">' + dqOpts + '</select>' +
          '<button class="wa-btn" onclick="lsDisqualify(\\'' + ld.contactId + '\\')" style="font-size:12px;padding:4px 10px;color:var(--error)">' + L.detail_disqualify + '</button>' +
        '</div>' : '')

      document.getElementById('ls-modal').style.display = 'flex'
    }).catch(function(){ lsToast('Failed to load detail', 'error') })
  }

  window.lsCloseModal = function() {
    document.getElementById('ls-modal').style.display = 'none'
  }

  window.lsDisqualify = function(contactId) {
    var reasonKey = document.getElementById('ls-dq-select').value
    fetch(API + '/disqualify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contactId: contactId, reasonKey: reasonKey })
    }).then(function(r){return r.json()}).then(function(d) {
      if (d.ok) { lsCloseModal(); lsLoadLeads(); lsLoadStats(); lsToast('Lead disqualified', 'success') }
    }).catch(function(){ lsToast('Failed', 'error') })
  }

  // ═══ Helpers ═══
  function lsEsc(s) { return String(s).replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;') }
  window.lsEsc = lsEsc

  function lsTimeAgo(iso) {
    var diff = Math.floor((Date.now() - new Date(iso).getTime()) / 1000)
    if (diff < 60) return diff + 's'
    if (diff < 3600) return Math.floor(diff/60) + 'm'
    if (diff < 86400) return Math.floor(diff/3600) + 'h'
    return Math.floor(diff/86400) + 'd'
  }
  window.lsTimeAgo = lsTimeAgo

  function lsStatusColor(status) {
    var m = {
      'new': { bg:'rgba(148,163,184,0.15)', fg:'#94a3b8' },
      'qualifying': { bg:'rgba(56,189,248,0.15)', fg:'#38bdf8' },
      'qualified': { bg:'rgba(74,222,128,0.15)', fg:'#4ade80' },
      'scheduled': { bg:'rgba(251,191,36,0.15)', fg:'#fbbf24' },
      'attended': { bg:'rgba(168,85,247,0.15)', fg:'#a855f7' },
      'converted': { bg:'rgba(34,197,94,0.15)', fg:'#22c55e' },
      'out_of_zone': { bg:'rgba(239,68,68,0.15)', fg:'#f87171' },
      'not_interested': { bg:'rgba(239,68,68,0.15)', fg:'#f87171' },
      'cold': { bg:'rgba(100,116,139,0.15)', fg:'#64748b' },
      'blocked': { bg:'rgba(239,68,68,0.25)', fg:'#f87171' }
    }
    return m[status] || { bg:'rgba(148,163,184,0.15)', fg:'#94a3b8' }
  }
  window.lsStatusColor = lsStatusColor

  function lsToast(msg, type) {
    if (window.showToast) { window.showToast(msg, type); return }
    var el = document.createElement('div')
    el.style.cssText = 'position:fixed;top:70px;right:24px;padding:10px 18px;border-radius:8px;font-size:13px;z-index:9999;' +
      (type === 'error' ? 'background:rgba(239,68,68,0.15);color:#f87171;border:1px solid rgba(239,68,68,0.3)' :
                          'background:rgba(34,197,94,0.15);color:#4ade80;border:1px solid rgba(34,197,94,0.3)')
    el.textContent = msg
    document.body.appendChild(el)
    setTimeout(function(){ el.remove() }, 3500)
  }

  document.addEventListener('keydown', function(e) { if (e.key === 'Escape') lsCloseModal() })
})()
</script>`
}
