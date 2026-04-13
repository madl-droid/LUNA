// lead-scoring/templates.ts — SSR HTML for console section
// Renders lead-scoring qualification view: filters, metrics, frameworks, behavior, signals.

import type { ConfigStore } from './config-store.js'
import type { QualifyingConfig, QualifyingCriterion } from './types.js'

type Lang = 'es' | 'en'

const labels: Record<Lang, Record<string, string>> = {
  es: {
    // Filters
    filter_period: 'Periodo',
    filter_channel: 'Canal',
    filter_qualification: 'Calificacion',
    period_all: 'Todo',
    period_today: 'Hoy',
    period_7d: '7 dias',
    period_30d: '30 dias',
    period_90d: '90 dias',
    all_channels: 'Todos',
    all_qualifications: 'Todas',
    // Metrics
    metric_attended: 'Contactos atendidos',
    metric_cold: 'Contactos frios',
    metric_qualifying: 'En calificacion',
    metric_qualified: 'Calificados',
    metric_converted: 'Convertidos',
    // Preset
    preset_label: 'Preset activo',
    preset_apply: 'Aplicar preset',
    preset_confirm: 'Esto reemplazara los criterios actuales. Continuar?',
    objective_label: 'Objetivo',
    priority_high: 'Alta',
    priority_medium: 'Media',
    priority_low: 'Baja',
    scoring_indexed: 'Orden',
    scoring_presence: 'Presencia',
    criteria_count: 'criterios',
    freshness_label: 'Frescura de datos (dias)',
    freshness_info: 'Despues de este periodo, los datos contribuyen solo 30% al score',
    // Criteria
    th_key: 'Clave',
    th_name: 'Nombre',
    th_type: 'Tipo',
    th_options: 'Opciones',
    th_required: 'Req',
    th_never_ask: 'No preguntar',
    type_text: 'Texto',
    type_list: 'Lista',
    type_boolean: 'Si/No',
    add_criterion: 'Agregar criterio',
    // Behavior tab
    tab_behavior: 'Comportamiento',
    tab_signals: 'Senales automaticas',
    sec_post_action: 'Accion post-calificacion',
    sec_post_action_info: 'Que accion ejecuta el agente cuando un lead se califica.',
    act_scheduled: 'Agendar',
    act_payment_link: 'Link de pago',
    act_payment_link_soon: 'Proximamente',
    act_escalate_human: 'Escalar a humano',
    sec_confidence: 'Confianza minima para extraccion',
    sec_confidence_info: 'Nivel minimo de confianza del LLM para aceptar un dato extraido.',
    sec_cold_threshold: 'Umbral Lead frio',
    sec_cold_threshold_info: 'Score igual o menor a este valor = lead frio.',
    sec_qualified_threshold: 'Umbral calificado',
    sec_qualified_threshold_info: 'Score igual o mayor a este valor = lead calificado.',
    // Signals tab
    sig_response_speed: 'Velocidad de respuesta',
    sig_response_speed_desc: 'Debajo del rango promedio = bueno, dentro = ok, por encima = malo.',
    sig_question_count: 'Cantidad de preguntas',
    sig_question_count_desc: '0-2 bajo, 2-4 medio, mas de 4 bueno.',
    sig_has_campaign: 'Tiene campana?',
    sig_has_campaign_desc: 'Si = 2 puntos, No = 0 puntos.',
    // General
    save: 'Guardar',
    saved: 'Configuracion guardada',
    save_error: 'Error al guardar',
    weight_error: 'Los pesos deben sumar 100 (actual: {n})',
    status_attended: 'Atendido',
    status_cold: 'Frio',
    status_qualifying: 'En calificacion',
    status_qualified: 'Calificado',
    status_converted: 'Convertido',
  },
  en: {
    filter_period: 'Period',
    filter_channel: 'Channel',
    filter_qualification: 'Qualification',
    period_all: 'All',
    period_today: 'Today',
    period_7d: '7 days',
    period_30d: '30 days',
    period_90d: '90 days',
    all_channels: 'All',
    all_qualifications: 'All',
    metric_attended: 'Attended contacts',
    metric_cold: 'Cold contacts',
    metric_qualifying: 'Qualifying',
    metric_qualified: 'Qualified',
    metric_converted: 'Converted',
    // Preset
    preset_label: 'Active preset',
    preset_apply: 'Apply preset',
    preset_confirm: 'This will replace current criteria. Continue?',
    objective_label: 'Objective',
    priority_high: 'High',
    priority_medium: 'Medium',
    priority_low: 'Low',
    scoring_indexed: 'Indexed',
    scoring_presence: 'Presence',
    criteria_count: 'criteria',
    freshness_label: 'Data freshness (days)',
    freshness_info: 'After this period, data contributes only 30% to score',
    th_key: 'Key',
    th_name: 'Name',
    th_type: 'Type',
    th_options: 'Options',
    th_required: 'Req',
    th_never_ask: 'Never ask',
    type_text: 'Text',
    type_list: 'List',
    type_boolean: 'Yes/No',
    add_criterion: 'Add criterion',
    tab_behavior: 'Behavior',
    tab_signals: 'Auto signals',
    sec_post_action: 'Post-qualification action',
    sec_post_action_info: 'What action the agent executes when a lead qualifies.',
    act_scheduled: 'Schedule',
    act_payment_link: 'Payment link',
    act_payment_link_soon: 'Coming soon',
    act_escalate_human: 'Escalate to human',
    sec_confidence: 'Minimum extraction confidence',
    sec_confidence_info: 'Minimum LLM confidence level to accept an extracted data point.',
    sec_cold_threshold: 'Cold lead threshold',
    sec_cold_threshold_info: 'Score at or below this value = cold lead.',
    sec_qualified_threshold: 'Qualified threshold',
    sec_qualified_threshold_info: 'Score at or above this value = qualified lead.',
    sig_response_speed: 'Response speed',
    sig_response_speed_desc: 'Below average range = good, within = ok, above = bad.',
    sig_question_count: 'Question count',
    sig_question_count_desc: '0-2 low, 2-4 medium, more than 4 good.',
    sig_has_campaign: 'Has campaign?',
    sig_has_campaign_desc: 'Yes = 2 points, No = 0 points.',
    save: 'Save',
    saved: 'Configuration saved',
    save_error: 'Failed to save',
    weight_error: 'Weights must sum to 100 (current: {n})',
    status_attended: 'Attended',
    status_cold: 'Cold',
    status_qualifying: 'Qualifying',
    status_qualified: 'Qualified',
    status_converted: 'Converted',
  },
}

function l(key: string, lang: Lang): string {
  return labels[lang]?.[key] ?? labels.es[key] ?? key
}

function esc(s: string): string {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

// ═══════════════════════════════════════════
// Main render — no tabs, boxes layout
// ═══════════════════════════════════════════

export function renderLeadScoringConsole(store: ConfigStore, lang: Lang): string {
  const config = store.getConfig()

  return `
    ${renderStyles()}

    <!-- Filters -->
    ${renderFilters(lang)}

    <!-- Metrics bars -->
    <div id="ls-metrics" style="margin-bottom:16px"></div>

    <!-- Framework cards -->
    ${renderFrameworkCards(config, lang)}

    <!-- Criteria panel (hidden, shown on "Ver") -->
    <div id="ls-criteria-panel" style="display:none;margin-bottom:16px">
      ${renderCriteriaPanel(config, lang)}
    </div>

    <!-- Settings: Comportamiento -->
    <div id="ls-settings-behavior">
      ${renderBehaviorTab(config, lang)}
    </div>

    <!-- Save button -->
    <div style="display:flex;gap:8px;padding:12px 0">
      <button type="button" class="wa-btn wa-btn-connect" onclick="lsSave()" id="ls-btn-save" style="font-size:13px;padding:6px 14px">${l('save', lang)}</button>
    </div>

    ${renderScript(config, lang)}`
}

// ═══════════════════════════════════════════
// Styles (scoped with ls- prefix)
// ═══════════════════════════════════════════

function renderStyles(): string {
  return `<style>
    /* ── Filters ── */
    .ls-filters { display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-bottom:16px;padding:10px 14px;
      border:1px solid var(--outline-variant);border-radius:0.5rem;background:var(--surface-container-low) }
    .ls-filter-group { display:flex;align-items:center;gap:6px }
    .ls-filter-label { font-size:11px;color:var(--on-surface-dim);text-transform:uppercase;letter-spacing:0.05em;font-weight:600 }
    .ls-filter-select { padding:5px 10px;border:1px solid var(--outline-variant);border-radius:0.5rem;font-size:12px;
      background:var(--surface-container-lowest);color:var(--on-surface) }

    /* ── Channel multi-select dropdown ── */
    .ls-ch-dropdown { position:relative }
    .ls-ch-btn { padding:5px 10px;border:1px solid var(--outline-variant);border-radius:0.5rem;font-size:12px;cursor:pointer;
      background:var(--surface-container-lowest);color:var(--on-surface);display:flex;align-items:center;gap:4px }
    .ls-ch-panel { display:none;position:absolute;top:100%;left:0;margin-top:4px;background:var(--surface-container-lowest);
      border:1px solid var(--outline-variant);border-radius:0.5rem;padding:8px 12px;z-index:100;min-width:160px;
      box-shadow:var(--shadow-float) }
    .ls-ch-dropdown.open .ls-ch-panel { display:block }
    .ls-ch-option { display:flex;align-items:center;gap:6px;padding:4px 0;font-size:12px;cursor:pointer }
    .ls-ch-option input { margin:0 }

    /* ── Metric bars ── */
    .ls-metric-row { display:flex;align-items:center;gap:10px;margin-bottom:8px }
    .ls-metric-label { width:150px;font-size:12px;color:var(--on-surface-variant);flex-shrink:0 }
    .ls-metric-bar { flex:1;height:22px;background:var(--outline-variant);border-radius:0.5rem;overflow:hidden;display:flex }
    .ls-metric-seg { height:100%;min-width:1px;transition:width 0.3s }
    .ls-metric-val { width:40px;text-align:right;font-size:13px;font-weight:600;flex-shrink:0 }

    /* ── Framework cards ── */
    .ls-fw-grid { display:grid;grid-template-columns:repeat(3,1fr);gap:var(--space-md);margin-bottom:12px }
    .ls-fw-card { border:2px solid var(--outline-variant);border-radius:0.5rem;padding:var(--section-gap);transition:all 0.2s;
      background:var(--surface-container-lowest);cursor:default }
    .ls-fw-card:not(.active):hover { box-shadow:var(--shadow-float) }
    .ls-fw-card.active { border-color:var(--primary);box-shadow:0 0 12px var(--primary-medium) }
    .ls-fw-card-title { font-weight:700;font-size:14px;margin-bottom:2px }
    .ls-fw-card-type { font-size:11px;font-weight:600;color:var(--primary);text-transform:uppercase;letter-spacing:0.05em }
    .ls-fw-card-desc { font-size:11px;color:var(--on-surface-dim);margin:6px 0 10px }
    .ls-fw-card-actions { display:flex;gap:6px;align-items:center }
    .ls-fw-toggle { position:relative;width:36px;height:20px;border-radius:10px;cursor:pointer;
      background:var(--outline-variant);transition:background 0.2s;border:none;padding:0 }
    .ls-fw-toggle.on { background:var(--success) }
    .ls-fw-toggle::after { content:'';position:absolute;top:2px;left:2px;width:16px;height:16px;
      border-radius:50%;background:#fff;transition:transform 0.2s }
    .ls-fw-toggle.on::after { transform:translateX(16px) }
    .ls-fw-note { font-size:11px;color:var(--warning);padding:8px 12px;border:1px solid var(--outline-variant);
      border-radius:0.5rem;background:var(--surface-container-low);margin-bottom:12px;display:none }

    /* ── Criteria table ── */
    .ls-table { width:100%;border-collapse:collapse;font-size:12px }
    .ls-table th { text-align:left;padding:8px 10px;color:var(--on-surface-dim);font-size:10px;
      text-transform:uppercase;letter-spacing:0.05em;border-bottom:2px solid var(--outline-variant);font-weight:600 }
    .ls-table td { padding:6px 10px;border-bottom:1px solid var(--outline-variant);vertical-align:middle }
    .ls-table tr:hover td { background:var(--primary-light) }
    .ls-table input, .ls-table select { padding:5px 8px;border:1px solid var(--outline-variant);border-radius:0.5rem;
      font-size:12px;width:100%;background:var(--surface-container-lowest);color:var(--on-surface) }
    .ls-table input:focus, .ls-table select:focus { outline:none;box-shadow:0 0 0 3px var(--primary-focus) }
    .ls-table .ls-w-input { width:55px;text-align:center }
    .ls-stage-header td { background:var(--primary-light);padding:8px 10px;font-weight:600;font-size:12px;
      border-bottom:2px solid var(--primary) }
    .ls-weight-total { font-size:11px;padding:6px 8px }
    .ls-clear-btn { background:none;border:1px solid var(--outline-variant);border-radius:4px;cursor:pointer;
      color:var(--on-surface-dim);font-size:11px;padding:2px 8px;transition:color 0.15s }
    .ls-clear-btn:hover { color:var(--on-surface);border-color:var(--on-surface-dim) }

    /* ── Settings tabs ── */
    .ls-settings-tabs { display:flex;gap:0;margin-bottom:0;border-bottom:2px solid var(--outline-variant);margin-top:16px }
    .ls-stab { padding:8px 16px;font-size:13px;font-weight:500;cursor:pointer;color:var(--on-surface-dim);
      border:none;border-bottom:2px solid transparent;margin-bottom:-2px;background:none }
    .ls-stab:hover { color:var(--on-surface) }
    .ls-stab-active { color:var(--primary);border-bottom-color:var(--primary) }

    /* ── Behavior / signals panels ── */
    .ls-setting-row { display:flex;align-items:center;gap:12px;padding:12px 0;border-bottom:1px solid var(--outline-variant) }
    .ls-setting-left { flex:1 }
    .ls-setting-label { font-size:13px;font-weight:500 }
    .ls-setting-info { font-size:11px;color:var(--on-surface-dim);margin-top:2px }
    .ls-info-icon { display:inline-flex;align-items:center;justify-content:center;width:16px;height:16px;
      border-radius:50%;border:1px solid var(--on-surface-dim);font-size:10px;color:var(--on-surface-dim);
      cursor:help;margin-left:4px;flex-shrink:0;font-style:italic;font-weight:600;font-family:serif }

    /* ── Volume slider (like WhatsApp module) ── */
    .ls-volume { display:flex;align-items:center;gap:10px;width:260px }
    .ls-vol-label { font-size:11px;font-weight:500;color:var(--on-surface-dim);min-width:32px;text-align:center }
    .ls-vol-track { flex:1;position:relative;display:flex;align-items:center }
    .ls-vol-input { -webkit-appearance:none;appearance:none;width:100%;height:6px;border-radius:3px;
      background:var(--outline-variant);outline:none;cursor:pointer }
    .ls-vol-input::-webkit-slider-thumb { -webkit-appearance:none;appearance:none;width:18px;height:18px;
      border-radius:50%;background:var(--primary);cursor:pointer;box-shadow:var(--shadow-subtle);
      transition:transform 0.15s }
    .ls-vol-input::-webkit-slider-thumb:hover { transform:scale(1.15) }
    .ls-vol-input::-moz-range-thumb { width:18px;height:18px;border-radius:50%;background:var(--primary);
      cursor:pointer;border:none;box-shadow:var(--shadow-subtle) }
    .ls-vol-value { font-size:13px;font-weight:600;font-family:'SF Mono','Fira Code',monospace;
      color:var(--primary);min-width:48px;text-align:center;background:var(--primary-light);
      padding:3px 8px;border-radius:0.4rem }

    /* ── Signal toggle ── */
    .ls-sig-toggle { position:relative;width:40px;height:22px;border-radius:11px;cursor:pointer;
      background:var(--outline-variant);transition:background 0.2s;border:none;padding:0;flex-shrink:0 }
    .ls-sig-toggle.on { background:var(--success) }
    .ls-sig-toggle::after { content:'';position:absolute;top:2px;left:2px;width:18px;height:18px;
      border-radius:50%;background:#fff;transition:transform 0.2s }
    .ls-sig-toggle.on::after { transform:translateX(18px) }

    /* ── Disabled dropdown option ── */
    .ls-dropdown-disabled { color:var(--on-surface-dim);pointer-events:none;opacity:0.6 }

    @media (max-width:768px) {
      .ls-fw-grid { grid-template-columns:1fr }
      .ls-metric-label { width:110px;font-size:11px }
      .ls-volume { width:100% }
    }
  </style>`
}

// ═══════════════════════════════════════════
// Filters panel
// ═══════════════════════════════════════════

const CHANNELS = [
  { value: 'whatsapp', label: 'WhatsApp', color: '#25D366' },
  { value: 'gmail', label: 'Gmail', color: '#EA4335' },
  { value: 'google-chat', label: 'Google Chat', color: '#4285F4' },
  { value: 'twilio-voice', label: 'Twilio', color: '#F22F46' },
]

const PERIODS: Array<{ value: string; labelKey: string }> = [
  { value: 'all', labelKey: 'period_all' },
  { value: 'today', labelKey: 'period_today' },
  { value: '7d', labelKey: 'period_7d' },
  { value: '30d', labelKey: 'period_30d' },
  { value: '90d', labelKey: 'period_90d' },
]

const QUAL_STATUSES = ['attended', 'cold', 'qualifying', 'qualified', 'converted']

function renderFilters(lang: Lang): string {
  const periodOpts = PERIODS.map(p =>
    `<option value="${p.value}">${l(p.labelKey, lang)}</option>`
  ).join('')

  const channelChecks = CHANNELS.map(ch =>
    `<label class="ls-ch-option">
      <input type="checkbox" value="${ch.value}" checked onchange="lsApplyFilters()">
      <span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${ch.color}"></span> ${ch.label}
    </label>`
  ).join('')

  const qualOpts = `<option value="">${l('all_qualifications', lang)}</option>` +
    QUAL_STATUSES.map(s => `<option value="${s}">${l('status_' + s, lang)}</option>`).join('')

  return `
    <div class="ls-filters">
      <div class="ls-filter-group">
        <span class="ls-filter-label">${l('filter_period', lang)}</span>
        <select class="ls-filter-select js-custom-select" id="ls-filter-period" onchange="lsApplyFilters()">
          ${periodOpts}
        </select>
      </div>
      <div class="ls-filter-group">
        <span class="ls-filter-label">${l('filter_channel', lang)}</span>
        <div class="ls-ch-dropdown" id="ls-ch-dropdown">
          <button type="button" class="ls-ch-btn" onclick="event.stopPropagation();this.parentElement.classList.toggle('open')">
            ${l('all_channels', lang)}
            <svg width="10" height="6" viewBox="0 0 10 6" fill="none"><path d="M1 1L5 5L9 1" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
          </button>
          <div class="ls-ch-panel" onclick="event.stopPropagation()">
            ${channelChecks}
          </div>
        </div>
      </div>
      <div class="ls-filter-group">
        <span class="ls-filter-label">${l('filter_qualification', lang)}</span>
        <select class="ls-filter-select js-custom-select" id="ls-filter-qual" onchange="lsApplyFilters()">
          ${qualOpts}
        </select>
      </div>
    </div>`
}

// ═══════════════════════════════════════════
// Framework cards
// ═══════════════════════════════════════════

/** Render single-framework info card (v3: one active preset per tenant) */
function renderFrameworkCards(config: QualifyingConfig, lang: Lang): string {
  const preset = config.preset ?? 'custom'
  const objective = config.objective ?? 'schedule'
  const criteriaCount = config.criteria.length
  const stageCount = config.stages.length

  return `
    <div class="ls-fw-card active" style="margin-bottom:12px">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:12px">
        <div>
          <div class="ls-fw-card-type">${l('preset_label', lang)}: <strong>${esc(preset.toUpperCase())}</strong></div>
          <div class="ls-fw-card-desc">${criteriaCount}/30 ${l('criteria_count', lang)} &middot; ${stageCount} ${lang === 'es' ? 'etapas' : 'stages'}</div>
          <div style="font-size:11px;color:var(--on-surface-dim);margin-top:6px">
            ${l('objective_label', lang)}:
            <select style="font-size:11px;padding:2px 6px;border:1px solid var(--outline-variant);border-radius:4px;background:var(--surface-container-lowest);color:var(--on-surface)"
              onchange="lsConfig.objective=this.value">
              <option value="schedule" ${objective === 'schedule' ? 'selected' : ''}>${l('act_scheduled', lang)}</option>
              <option value="sell" ${objective === 'sell' ? 'selected' : ''}>${lang === 'es' ? 'Vender' : 'Sell'}</option>
              <option value="escalate" ${objective === 'escalate' ? 'selected' : ''}>${l('act_escalate_human', lang)}</option>
              <option value="attend_only" ${objective === 'attend_only' ? 'selected' : ''}>${lang === 'es' ? 'Solo atender' : 'Attend only'}</option>
            </select>
          </div>
        </div>
        <div style="display:flex;flex-direction:column;gap:6px">
          <div style="font-size:11px;color:var(--on-surface-dim);font-weight:600">${l('preset_apply', lang)}</div>
          <div style="display:flex;gap:6px;align-items:center">
            <select id="ls-preset-select" style="font-size:11px;padding:4px 8px;border:1px solid var(--outline-variant);border-radius:4px;background:var(--surface-container-lowest);color:var(--on-surface)">
              <option value="spin">SPIN (B2C)</option>
              <option value="champ">CHAMP (B2B)</option>
              <option value="champ_gov">CHAMP+Gov (B2G)</option>
            </select>
            <button type="button" class="wa-btn" onclick="lsApplyPreset()"
              style="font-size:11px;padding:3px 10px">${l('preset_apply', lang)}</button>
          </div>
          <button type="button" class="wa-btn" onclick="lsViewFramework()"
            style="font-size:11px;padding:3px 10px;margin-top:2px">${lang === 'es' ? 'Ver criterios' : 'View criteria'}</button>
        </div>
      </div>
    </div>`
}

// ═══════════════════════════════════════════
// Criteria panel (shown when "Ver" clicked)
// ═══════════════════════════════════════════

function renderCriterionRow(cr: QualifyingCriterion, i: number, lang: Lang, _stageCount: number): string {
  const nameVal = esc(cr.name[lang] || cr.name.es)
  const priorityOpts = ['high', 'medium', 'low'] as const
  const priorityLabel: Record<string, string> = {
    high: l('priority_high', lang),
    medium: l('priority_medium', lang),
    low: l('priority_low', lang),
  }

  const enumScoringCell = cr.type === 'enum'
    ? `<select data-field="enumScoring" onchange="lsUpdateCri(${i},'enumScoring',this.value)">
        <option value="indexed" ${!cr.enumScoring || cr.enumScoring === 'indexed' ? 'selected' : ''}>${l('scoring_indexed', lang)}</option>
        <option value="presence" ${cr.enumScoring === 'presence' ? 'selected' : ''}>${l('scoring_presence', lang)}</option>
      </select>`
    : `<span style="color:var(--on-surface-dim);font-size:11px">—</span>`

  return `
    <tr data-ls-cri="${i}">
      <td><input value="${esc(cr.key)}" data-field="key" style="width:80px" readonly></td>
      <td><input value="${nameVal}" data-field="name" onchange="lsUpdateCri(${i},'name',this.value)"></td>
      <td><select data-field="type" onchange="lsUpdateCri(${i},'type',this.value)">
        <option value="text" ${cr.type === 'text' ? 'selected' : ''}>${l('type_text', lang)}</option>
        <option value="enum" ${cr.type === 'enum' ? 'selected' : ''}>${l('type_list', lang)}</option>
        <option value="boolean" ${cr.type === 'boolean' ? 'selected' : ''}>${l('type_boolean', lang)}</option>
      </select></td>
      <td><input value="${esc((cr.options || []).join(','))}" data-field="options" placeholder="opt1,opt2"
        ${cr.type !== 'enum' ? 'disabled' : ''} onchange="lsUpdateCri(${i},'options',this.value)"></td>
      <td><select data-field="priority" onchange="lsUpdateCri(${i},'priority',this.value)">
        ${priorityOpts.map(p => `<option value="${p}" ${cr.priority === p ? 'selected' : ''}>${priorityLabel[p]!}</option>`).join('')}
      </select></td>
      <td>${enumScoringCell}</td>
      <td style="text-align:center"><input type="checkbox" ${cr.required ? 'checked' : ''}
        onchange="lsUpdateCri(${i},'required',this.checked)"></td>
      <td style="text-align:center"><input type="checkbox" ${cr.neverAskDirectly ? 'checked' : ''}
        onchange="lsUpdateCri(${i},'neverAskDirectly',this.checked)"></td>
      <td><button type="button" class="ls-clear-btn" onclick="lsClearCri(${i})" title="Eliminar">&#10005;</button></td>
    </tr>`
}

function renderCriteriaPanel(config: QualifyingConfig, lang: Lang): string {
  const criteria = config.criteria
  const stages = config.stages
  const hasStages = stages && stages.length > 0

  const theadCols = `
    <th>${l('th_key', lang)}</th><th>${l('th_name', lang)}</th>
    <th>${l('th_type', lang)}</th><th>${l('th_options', lang)}</th>
    <th>${lang === 'es' ? 'Prioridad' : 'Priority'}</th>
    <th>Scoring</th>
    <th>${l('th_required', lang)}</th><th>${l('th_never_ask', lang)}</th><th></th>`

  let bodyHtml: string

  if (hasStages) {
    const sortedStages = [...stages].sort((a, b) => a.order - b.order)
    const stageBlocks = sortedStages.map(stage => {
      const stageCriteria = criteria
        .map((cr, i) => ({ cr, i }))
        .filter(({ cr }) => cr.stage === stage.key)

      if (stageCriteria.length === 0) return ''

      const stageHeader = `
        <tr class="ls-stage-header">
          <td colspan="9">
            ${esc(stage.name[lang] || stage.name.es)}
            <span style="font-weight:400;color:var(--on-surface-dim);margin-left:8px">${esc(stage.description[lang] || stage.description.es)}</span>
            <span style="float:right;font-weight:400;color:var(--on-surface-dim)">${stageCriteria.length} ${lang === 'es' ? 'criterios' : 'criteria'}</span>
          </td>
        </tr>`

      const rows = stageCriteria.map(({ cr, i }) => renderCriterionRow(cr, i, lang, stageCriteria.length)).join('')
      return stageHeader + rows
    }).join('')
    const orphans = criteria
      .map((cr, i) => ({ cr, i }))
      .filter(({ cr }) => !cr.stage)
    const orphanRows = orphans.length > 0
      ? orphans.map(({ cr, i }) => renderCriterionRow(cr, i, lang, orphans.length)).join('')
      : ''

    bodyHtml = stageBlocks + orphanRows
  } else {
    bodyHtml = criteria.map((cr, i) => renderCriterionRow(cr, i, lang, criteria.length)).join('')
  }

  const countLabel = `${criteria.length}/30 ${lang === 'es' ? 'criterios' : 'criteria'}`

  return `
    <div style="overflow-x:auto">
      <table class="ls-table" id="ls-criteria-table">
        <thead><tr>${theadCols}</tr></thead>
        <tbody>${bodyHtml}</tbody>
      </table>
    </div>
    <div style="padding:8px 12px;display:flex;justify-content:space-between;align-items:center">
      <span style="font-size:12px;color:var(--on-surface-dim)">${countLabel}</span>
      <button type="button" class="act-btn" onclick="lsAddCri()" style="font-size:12px"
        ${criteria.length >= 10 ? 'disabled' : ''}>
        + ${l('add_criterion', lang)}
      </button>
    </div>`
}

// ═══════════════════════════════════════════
// Behavior tab
// ═══════════════════════════════════════════

function renderBehaviorTab(config: QualifyingConfig, lang: Lang): string {
  return `
    <div style="padding:12px 0">
      <!-- Min confidence slider -->
      <div class="ls-setting-row">
        <div class="ls-setting-left">
          <span class="ls-setting-label">${l('sec_confidence', lang)}</span>
          <span class="ls-info-icon" title="${l('sec_confidence_info', lang)}">i</span>
          <div class="ls-setting-info">${l('sec_confidence_info', lang)}</div>
        </div>
        <div class="ls-volume">
          <span class="ls-vol-label">0.1</span>
          <div class="ls-vol-track">
            <input type="range" class="ls-vol-input" id="ls-confidence-slider"
              value="${config.minConfidence}" min="0.1" max="0.95" step="0.05"
              oninput="lsConfig.minConfidence=parseFloat(this.value);document.getElementById('ls-confidence-val').textContent=this.value">
          </div>
          <span class="ls-vol-label">0.95</span>
          <span class="ls-vol-value" id="ls-confidence-val">${config.minConfidence}</span>
        </div>
      </div>

      <!-- Cold threshold -->
      <div class="ls-setting-row">
        <div class="ls-setting-left">
          <span class="ls-setting-label">${l('sec_cold_threshold', lang)}</span>
          <span class="ls-info-icon" title="${l('sec_cold_threshold_info', lang)}">i</span>
          <div class="ls-setting-info">${l('sec_cold_threshold_info', lang)}</div>
        </div>
        <input type="number" id="ls-threshold-cold" value="${config.thresholds.cold}" min="0" max="80"
          style="width:80px;padding:6px 10px;border:1px solid var(--outline-variant);border-radius:6px;font-size:13px"
          onchange="lsConfig.thresholds.cold=parseInt(this.value)||0">
      </div>

      <!-- Qualified threshold -->
      <div class="ls-setting-row">
        <div class="ls-setting-left">
          <span class="ls-setting-label">${l('sec_qualified_threshold', lang)}</span>
          <span class="ls-info-icon" title="${l('sec_qualified_threshold_info', lang)}">i</span>
          <div class="ls-setting-info">${l('sec_qualified_threshold_info', lang)}</div>
        </div>
        <input type="number" id="ls-threshold-qualified" value="${config.thresholds.qualified}" min="50" max="100"
          style="width:80px;padding:6px 10px;border:1px solid var(--outline-variant);border-radius:6px;font-size:13px"
          onchange="lsConfig.thresholds.qualified=parseInt(this.value)||50">
      </div>

      <!-- Data freshness window -->
      <div class="ls-setting-row">
        <div class="ls-setting-left">
          <span class="ls-setting-label">${l('freshness_label', lang)}</span>
          <span class="ls-info-icon" title="${l('freshness_info', lang)}">i</span>
          <div class="ls-setting-info">${l('freshness_info', lang)}</div>
        </div>
        <input type="number" id="ls-freshness-days" value="${config.dataFreshnessWindowDays ?? 90}" min="7" max="730"
          style="width:80px;padding:6px 10px;border:1px solid var(--outline-variant);border-radius:6px;font-size:13px"
          onchange="lsConfig.dataFreshnessWindowDays=parseInt(this.value)||90">
      </div>
    </div>`
}

// ═══════════════════════════════════════════
// Client script
// ═══════════════════════════════════════════

function renderScript(config: QualifyingConfig, lang: Lang): string {
  const channelColors = JSON.stringify(Object.fromEntries(CHANNELS.map(c => [c.value, c.color])))

  return `<script>
(function() {
  var API = '/console/api/lead-scoring'
  var L = ${JSON.stringify(labels[lang])}
  var LANG = '${lang}'
  var lsConfig = JSON.parse('${JSON.stringify(config).replace(/'/g, "\\'")}')
  var CH_COLORS = ${channelColors}

  window.lsConfig = lsConfig

  // ═══ Filters ═══
  window.lsApplyFilters = function() {
    lsLoadMetrics()
    var checks = document.querySelectorAll('#ls-ch-dropdown input[type=checkbox]')
    var all = true, count = 0
    checks.forEach(function(c) { if (c.checked) count++; else all = false })
    var btn = document.querySelector('#ls-ch-dropdown .ls-ch-btn')
    if (btn) btn.firstChild.textContent = all ? L.all_channels : count + ' canales '
  }

  // Close channel dropdown on outside click
  document.addEventListener('click', function() {
    var dd = document.getElementById('ls-ch-dropdown')
    if (dd) dd.classList.remove('open')
  })

  // ═══ Metrics ═══
  function getFilterParams() {
    var period = document.getElementById('ls-filter-period')
    var qual = document.getElementById('ls-filter-qual')
    var params = new URLSearchParams()
    if (period && period.value !== 'all') params.set('period', period.value)
    if (qual && qual.value) params.set('qualification', qual.value)
    var checks = document.querySelectorAll('#ls-ch-dropdown input[type=checkbox]:checked')
    var chs = []
    checks.forEach(function(c) { chs.push(c.value) })
    if (chs.length > 0 && chs.length < 4) params.set('channels', chs.join(','))
    return params.toString()
  }

  window.lsLoadMetrics = function() {
    var qs = getFilterParams()
    fetch(API + '/stats-detailed' + (qs ? '?' + qs : '')).then(function(r){return r.json()}).then(function(d) {
      var container = document.getElementById('ls-metrics')
      if (!container || !d.metrics) return
      var metricLabels = {
        attended: L.metric_attended, cold: L.metric_cold,
        qualifying: L.metric_qualifying, qualified: L.metric_qualified, converted: L.metric_converted
      }
      var maxTotal = Math.max.apply(null, d.metrics.map(function(m){return m.total})) || 1
      container.innerHTML = d.metrics.map(function(m) {
        var segs = m.channels.map(function(ch) {
          var pct = (ch.count / maxTotal * 100).toFixed(1)
          var color = CH_COLORS[ch.channel] || '#94a3b8'
          return '<div class="ls-metric-seg" style="width:' + pct + '%;background:' + color + '" title="' + ch.channel + ': ' + ch.count + '"></div>'
        }).join('')
        return '<div class="ls-metric-row">' +
          '<span class="ls-metric-label">' + (metricLabels[m.status] || m.status) + '</span>' +
          '<div class="ls-metric-bar">' + segs + '</div>' +
          '<span class="ls-metric-val">' + m.total + '</span>' +
        '</div>'
      }).join('')
    }).catch(function(){})
  }

  // ═══ Apply preset ═══
  window.lsApplyPreset = function() {
    var select = document.getElementById('ls-preset-select')
    if (!select || !select.value) return
    var preset = select.value
    if (!confirm(L.preset_confirm)) return
    fetch(API + '/apply-preset', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ preset: preset })
    }).then(function(r){return r.json()}).then(function(d) {
      if (d.ok) { location.reload() }
      else lsToast(d.error || L.save_error, 'error')
    }).catch(function(){ lsToast(L.save_error, 'error') })
  }

  // ═══ Criteria panel toggle ═══
  window.lsViewFramework = function() {
    var panel = document.getElementById('ls-criteria-panel')
    if (!panel) return
    panel.style.display = (panel.style.display === 'none') ? 'block' : 'none'
  }

  // ═══ Criteria CRUD helpers ═══
  function lsEsc(s) {
    return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;')
  }

  function buildCriRow(cr, i) {
    var nameVal = lsEsc((cr.name && (cr.name[LANG] || cr.name.es)) || '')
    var optVal = lsEsc((cr.options || []).join(','))
    var optDisabled = cr.type !== 'enum' ? 'disabled' : ''
    var enumScoringCell = ''
    if (cr.type === 'enum') {
      var idxSel = (!cr.enumScoring || cr.enumScoring === 'indexed') ? ' selected' : ''
      var presSel = cr.enumScoring === 'presence' ? ' selected' : ''
      enumScoringCell = '<select onchange="lsUpdateCri(' + i + ',\'enumScoring\',this.value)">' +
        '<option value="indexed"' + idxSel + '>' + L.scoring_indexed + '</option>' +
        '<option value="presence"' + presSel + '>' + L.scoring_presence + '</option>' +
        '</select>'
    } else {
      enumScoringCell = '<span style="color:var(--on-surface-dim);font-size:11px">\u2014</span>'
    }
    var hiSel = cr.priority === 'high' ? ' selected' : ''
    var mdSel = (!cr.priority || cr.priority === 'medium') ? ' selected' : ''
    var loSel = cr.priority === 'low' ? ' selected' : ''
    return '<tr data-ls-cri="' + i + '">' +
      '<td><input value="' + lsEsc(cr.key||'') + '" data-field="key" style="width:80px" readonly></td>' +
      '<td><input value="' + nameVal + '" data-field="name" onchange="lsUpdateCri(' + i + ',\'name\',this.value)"></td>' +
      '<td><select data-field="type" onchange="lsUpdateCri(' + i + ',\'type\',this.value)">' +
        '<option value="text"' + (cr.type==='text'?' selected':'') + '>' + L.type_text + '</option>' +
        '<option value="enum"' + (cr.type==='enum'?' selected':'') + '>' + L.type_list + '</option>' +
        '<option value="boolean"' + (cr.type==='boolean'?' selected':'') + '>' + L.type_boolean + '</option>' +
      '</select></td>' +
      '<td><input value="' + optVal + '" data-field="options" placeholder="opt1,opt2" ' + optDisabled + ' onchange="lsUpdateCri(' + i + ',\'options\',this.value)"></td>' +
      '<td><select data-field="priority" onchange="lsUpdateCri(' + i + ',\'priority\',this.value)">' +
        '<option value="high"' + hiSel + '>' + L.priority_high + '</option>' +
        '<option value="medium"' + mdSel + '>' + L.priority_medium + '</option>' +
        '<option value="low"' + loSel + '>' + L.priority_low + '</option>' +
      '</select></td>' +
      '<td>' + enumScoringCell + '</td>' +
      '<td style="text-align:center"><input type="checkbox"' + (cr.required?' checked':'') + ' onchange="lsUpdateCri(' + i + ',\'required\',this.checked)"></td>' +
      '<td style="text-align:center"><input type="checkbox"' + (cr.neverAskDirectly?' checked':'') + ' onchange="lsUpdateCri(' + i + ',\'neverAskDirectly\',this.checked)"></td>' +
      '<td><button type="button" class="ls-clear-btn" onclick="lsClearCri(' + i + ')" title="Eliminar">&#10005;</button></td></tr>'
  }

  function lsRerenderCriteriaPanel() {
    var criteria = lsConfig.criteria || []
    var stages = lsConfig.stages || []
    var hasStages = stages.length > 0
    var theadCols = '<th>' + L.th_key + '</th><th>' + L.th_name + '</th>' +
      '<th>' + L.th_type + '</th><th>' + L.th_options + '</th>' +
      '<th>' + (LANG === 'es' ? 'Prioridad' : 'Priority') + '</th>' +
      '<th>Scoring</th>' +
      '<th>' + L.th_required + '</th><th>' + L.th_never_ask + '</th><th></th>'
    var bodyHtml = ''
    if (hasStages) {
      var sorted = stages.slice().sort(function(a,b){return a.order-b.order})
      sorted.forEach(function(stage) {
        var stageCri = []
        criteria.forEach(function(cr,i){ if(cr.stage===stage.key) stageCri.push({cr:cr,i:i}) })
        if (stageCri.length === 0) return
        var stageName = (stage.name && (stage.name[LANG] || stage.name.es)) || ''
        var stageDesc = (stage.description && (stage.description[LANG] || stage.description.es)) || ''
        bodyHtml += '<tr class="ls-stage-header"><td colspan="9">' + lsEsc(stageName) +
          '<span style="font-weight:400;color:var(--on-surface-dim);margin-left:8px">' + lsEsc(stageDesc) + '</span>' +
          '<span style="float:right;font-weight:400;color:var(--on-surface-dim)">' + stageCri.length + ' ' + L.criteria_count + '</span></td></tr>'
        stageCri.forEach(function(x){ bodyHtml += buildCriRow(x.cr, x.i) })
      })
      criteria.forEach(function(cr,i){ if(!cr.stage) bodyHtml += buildCriRow(cr, i) })
    } else {
      criteria.forEach(function(cr, i){ bodyHtml += buildCriRow(cr, i) })
    }
    var countLabel = criteria.length + '/30 ' + L.criteria_count
    var addDisabled = criteria.length >= 30 ? ' disabled' : ''
    var panel = document.getElementById('ls-criteria-panel')
    if (!panel) return
    panel.innerHTML = '<div style="overflow-x:auto"><table class="ls-table" id="ls-criteria-table">' +
      '<thead><tr>' + theadCols + '</tr></thead>' +
      '<tbody>' + bodyHtml + '</tbody></table></div>' +
      '<div style="padding:8px 12px;display:flex;justify-content:space-between;align-items:center">' +
      '<span style="font-size:12px;color:var(--on-surface-dim)">' + countLabel + '</span>' +
      '<button type="button" class="act-btn" onclick="lsAddCri()" style="font-size:12px"' + addDisabled + '>+ ' + L.add_criterion + '</button>' +
      '</div>'
  }

  // ═══ Criteria CRUD ═══
  window.lsUpdateCri = function(i, field, value) {
    var cr = (lsConfig.criteria || [])[i]
    if (!cr) return
    if (field === 'name') {
      cr.name.es = value; cr.name.en = value
    }
    else if (field === 'type') {
      cr.type = value
      if (value !== 'enum') { delete cr.options; delete cr.enumScoring }
      lsRerenderCriteriaPanel()
    }
    else if (field === 'options') cr.options = value.split(',').map(function(s){return s.trim()}).filter(Boolean)
    else if (field === 'priority') cr.priority = value
    else if (field === 'enumScoring') cr.enumScoring = value
    else if (field === 'required') cr.required = value
    else if (field === 'neverAskDirectly') cr.neverAskDirectly = value
  }

  window.lsClearCri = function(i) {
    lsConfig.criteria = lsConfig.criteria || []
    lsConfig.criteria.splice(i, 1)
    lsRerenderCriteriaPanel()
  }

  window.lsAddCri = function() {
    lsConfig.criteria = lsConfig.criteria || []
    if (lsConfig.criteria.length >= 30) {
      lsToast(LANG === 'es' ? 'Maximo 30 criterios' : 'Max 30 criteria', 'error')
      return
    }
    lsConfig.criteria.push({
      key: '', name: { es: '', en: '' }, type: 'text',
      priority: 'medium', required: false, neverAskDirectly: false
    })
    lsRerenderCriteriaPanel()
  }

  // ═══ Save ═══
  window.lsSave = function() {
    // Validate thresholds
    var cold = lsConfig.thresholds.cold
    var qualified = lsConfig.thresholds.qualified
    if (cold > 80) { lsConfig.thresholds.cold = 80 }
    if (qualified < Math.max(cold + 1, 50)) { lsConfig.thresholds.qualified = Math.max(cold + 1, 50) }
    if (qualified > 100) { lsConfig.thresholds.qualified = 100 }

    fetch(API + '/config', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(lsConfig)
    }).then(function(r){return r.json()}).then(function(d) {
      if (d.ok) { lsToast(L.saved, 'success'); location.reload() }
      else lsToast(d.error || L.save_error, 'error')
    }).catch(function(){ lsToast(L.save_error, 'error') })
  }

  // ═══ Helpers ═══
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

  // Load metrics on init
  lsLoadMetrics()
})()
</script>`
}
