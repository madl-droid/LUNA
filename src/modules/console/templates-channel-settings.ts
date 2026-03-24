// templates-channel-settings.ts — 2-column channel settings page renderer
// Renders: status banner + collapsible config sections (left) | connection + budget + tips + activity (right)

import { t, type Lang } from './templates-i18n.js'
import { esc, renderConsoleField } from './templates-fields.js'
import type { ModuleInfo } from './templates-modules.js'
import type { SectionData } from './templates-sections.js'
import type { ConsoleField } from '../../kernel/types.js'

// ── Channel display names ──

const CHANNEL_NAMES: Record<string, Record<string, string>> = {
  whatsapp: { es: 'WhatsApp', en: 'WhatsApp' },
  gmail: { es: 'Gmail', en: 'Gmail' },
  'google-chat': { es: 'Google Chat', en: 'Google Chat' },
  'twilio-voice': { es: 'Twilio (Voz)', en: 'Twilio (Voice)' },
}

// ── Channel visual data ──

const CHANNEL_ICONS: Record<string, string> = {
  whatsapp: '<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/></svg>',
  gmail: '<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="4" width="20" height="16" rx="2"/><path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"/></svg>',
  'google-chat': '<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>',
  'twilio-voice': '<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/></svg>',
}

const CHANNEL_DESCRIPTIONS: Record<string, Record<string, string>> = {
  whatsapp: {
    es: 'Atencion al cliente y seguimiento de leads en tiempo real a traves de WhatsApp Business. Conversaciones directas, QR para vincular dispositivo, reconexion automatica.',
    en: 'Real-time customer support and lead follow-up through WhatsApp Business. Direct conversations, QR device linking, automatic reconnection.',
  },
  gmail: {
    es: 'Procesamiento inteligente de correos electronicos entrantes y salientes via Gmail API. Respuestas automaticas, hilos de conversacion, filtrado de no-reply y adjuntos.',
    en: 'Intelligent processing of incoming and outgoing emails via Gmail API. Automatic replies, conversation threads, no-reply filtering and attachments.',
  },
  'google-chat': {
    es: 'Colaboracion interna en Google Workspace. El agente responde consultas del equipo en espacios y mensajes directos como bot de Chat.',
    en: 'Internal collaboration via Google Workspace. The agent answers team queries in spaces and direct messages as a Chat bot.',
  },
  'twilio-voice': {
    es: 'Llamadas de voz con IA conversacional en tiempo real usando Twilio y Gemini Live. Atiende llamadas entrantes y realiza llamadas salientes con sintesis de voz natural.',
    en: 'Real-time conversational AI voice calls using Twilio and Gemini Live. Handles incoming calls and makes outbound calls with natural voice synthesis.',
  },
}

const CHANNEL_TIPS: Record<string, Record<string, { title: string; text: string }>> = {
  whatsapp: {
    es: { title: 'Reconexion automatica', text: 'Si la conexion se pierde, LUNA reintenta automaticamente. Ajusta el intervalo y maximo de intentos segun la estabilidad de tu red.' },
    en: { title: 'Auto reconnection', text: 'If the connection drops, LUNA automatically retries. Adjust the interval and max attempts based on your network stability.' },
  },
  gmail: {
    es: { title: 'Optimizacion de IA', text: 'Configurar etiquetas especificas (labels) para procesar reduce el consumo de tokens y mejora el tiempo de respuesta al filtrar ruido innecesario.' },
    en: { title: 'AI Optimization', text: 'Setting specific labels to process reduces token consumption and improves response time by filtering unnecessary noise.' },
  },
  'google-chat': {
    es: { title: 'Seguridad del webhook', text: 'Configura un token de verificacion para asegurar que solo Google Chat pueda enviar mensajes al webhook. Sin token, cualquier request es aceptado.' },
    en: { title: 'Webhook security', text: 'Set a verification token to ensure only Google Chat can send messages to the webhook. Without a token, any request is accepted.' },
  },
  'twilio-voice': {
    es: { title: 'Voz natural', text: 'Prueba diferentes voces de Gemini y ajusta los mensajes de saludo para que la experiencia del llamante sea lo mas natural posible.' },
    en: { title: 'Natural voice', text: 'Try different Gemini voices and adjust greeting messages so the caller experience is as natural as possible.' },
  },
}

// Channel type mapping for metrics API
const CHANNEL_TYPE_MAP: Record<string, string> = {
  whatsapp: 'instant', gmail: 'async', 'google-chat': 'instant', 'twilio-voice': 'voice',
}

// ── Main renderer ──

export function renderChannelSettingsPage(channel: ModuleInfo, data: SectionData): string {
  const lang = data.lang
  const fields = channel.console?.fields ?? []
  const config = data.config
  const channelId = channel.name
  const channelName = CHANNEL_NAMES[channelId]?.[lang] ?? channel.console?.title?.[lang] ?? channelId
  const desc = CHANNEL_DESCRIPTIONS[channelId]?.[lang] ?? channel.console?.info?.[lang] ?? ''

  // Embed wizard data for this channel so connect button works
  const wizardJson: Record<string, unknown> = {}
  if (channel.connectionWizard) {
    wizardJson[channelId] = {
      title: channel.connectionWizard.title,
      steps: channel.connectionWizard.steps,
      saveEndpoint: channel.connectionWizard.saveEndpoint,
      applyAfterSave: channel.connectionWizard.applyAfterSave,
      verifyEndpoint: channel.connectionWizard.verifyEndpoint,
    }
  }

  return `
    <div class="chs-desc">${esc(desc)}</div>
    <div class="chs-layout">
      <div class="chs-main">
        ${renderStatusBar(channel, data, channelName)}
        ${renderConfigSections(channelId, fields, config, lang)}
      </div>
      <div class="chs-sidebar">
        ${renderPeriodFilter(channelId, lang)}
        ${renderBudgetCard(channelId, lang, config)}
        ${renderActivityCard(channelId, lang)}
        ${renderTipCard(channelId, lang)}
      </div>
    </div>
<script type="application/json" id="channel-wizards-data">${JSON.stringify(wizardJson)}</script>`
}

// ── Status bar (icon with card-style colors + status + connect/disconnect + info) ──

function renderStatusBar(channel: ModuleInfo, data: SectionData, channelName: string): string {
  const lang = data.lang
  const channelId = channel.name
  const icon = CHANNEL_ICONS[channelId] ?? ''

  let connected = false
  let statusLabel = ''
  let connectionInfo = ''

  if (channelId === 'whatsapp') {
    connected = data.waState?.status === 'connected'
    statusLabel = connected
      ? (lang === 'es' ? 'Conectado' : 'Connected')
      : (lang === 'es' ? 'Desconectado' : 'Disconnected')
    connectionInfo = data.config['WHATSAPP_CONNECTED_NUMBER']
      ? (lang === 'es' ? 'Numero: ' : 'Number: ') + data.config['WHATSAPP_CONNECTED_NUMBER']
      : ''
  } else if (channelId === 'gmail') {
    connected = data.gmailAuth?.connected ?? false
    statusLabel = connected
      ? (lang === 'es' ? 'Conectado' : 'Connected')
      : (lang === 'es' ? 'No conectado' : 'Not connected')
    connectionInfo = data.gmailAuth?.email
      ? (lang === 'es' ? 'Cuenta: ' : 'Account: ') + data.gmailAuth.email
      : ''
  } else if (channelId === 'google-chat') {
    connected = data.googleChatConnected ?? false
    statusLabel = connected
      ? (lang === 'es' ? 'Conectado' : 'Connected')
      : (lang === 'es' ? 'No configurado' : 'Not configured')
  } else {
    const hasCreds = !!(data.config['TWILIO_ACCOUNT_SID'])
    connected = hasCreds
    statusLabel = hasCreds
      ? (lang === 'es' ? 'Configurado' : 'Configured')
      : (lang === 'es' ? 'No configurado' : 'Not configured')
    connectionInfo = data.config['TWILIO_PHONE_NUMBER']
      ? (lang === 'es' ? 'Telefono: ' : 'Phone: ') + data.config['TWILIO_PHONE_NUMBER']
      : ''
  }

  const iconStatus = connected ? 'connected' : 'disconnected'
  const btnLabel = connected
    ? (lang === 'es' ? 'Desconectar' : 'Disconnect')
    : (lang === 'es' ? 'Conectar' : 'Connect')
  const btnClass = connected ? 'chs-bar-btn-disconnect' : 'chs-bar-btn-connect'
  const btnAction = connected
    ? `channelDisconnect('${esc(channelId)}', '${lang}')`
    : `channelConnect('${esc(channelId)}', '${lang}')`

  // Reuse ch-card-icon for consistent icon styling across cards and config
  return `<div class="chs-status-bar" data-status="${iconStatus}">
    <div class="ch-card-icon">${icon}</div>
    <div class="chs-bar-info">
      <div class="chs-bar-status">
        <span class="chs-bar-dot ${iconStatus}"></span>
        ${esc(statusLabel)}
      </div>
      ${connectionInfo ? `<div class="chs-bar-detail">${esc(connectionInfo)}</div>` : ''}
    </div>
    <button class="ch-btn-action ${connected ? 'ch-btn-disconnect' : 'ch-btn-connect'}" onclick="${btnAction}">${btnLabel}</button>
  </div>`
}

// ── Config sections (collapsible panels) ──

function renderConfigSections(_channelId: string, fields: ConsoleField[], config: Record<string, string>, lang: Lang): string {
  const sections: Array<{ title: string; fields: ConsoleField[] }> = []
  let current: { title: string; fields: ConsoleField[] } = { title: '', fields: [] }

  for (const f of fields) {
    if (f.type === 'divider') {
      if (current.fields.length > 0 || current.title) sections.push(current)
      current = { title: f.label[lang] ?? f.label.es ?? '', fields: [] }
    } else {
      current.fields.push(f)
    }
  }
  if (current.fields.length > 0 || current.title) sections.push(current)

  // If first section has no title, give it a default
  if (sections.length > 0 && !sections[0]!.title) {
    sections[0]!.title = lang === 'es' ? 'General' : 'General'
  }

  let html = ''
  for (let idx = 0; idx < sections.length; idx++) {
    const sec = sections[idx]!
    const collapsed = idx > 0 ? ' collapsed' : '' // first section open, rest collapsed
    html += `<div class="panel${collapsed}">
      <div class="panel-header" onclick="togglePanel(this)">
        <span class="panel-title">${esc(sec.title)}</span>
        <span class="panel-chevron">&#9660;</span>
      </div>
      <div class="panel-body">
        ${renderFieldGroup(sec.fields, config, lang)}
      </div>
    </div>`
  }
  return html
}

function renderFieldGroup(fields: ConsoleField[], config: Record<string, string>, lang: Lang): string {
  let html = ''
  let i = 0

  while (i < fields.length) {
    const f = fields[i]!
    const val = config[f.key] ?? ''

    // Boolean fields: render as toggle rows
    if (f.type === 'boolean') {
      const iconHtml = f.icon ?? ''
      const descText = f.description?.[lang] ?? f.info?.[lang] ?? ''
      const label = f.label[lang] ?? f.label.es ?? f.key
      const checked = val === 'true' || val === '1'
      html += `<div class="chs-toggle-row">
        ${iconHtml ? `<div class="chs-toggle-icon">${iconHtml}</div>` : ''}
        <div class="chs-toggle-text">
          <div class="chs-toggle-title">${esc(label)}</div>
          ${descText ? `<div class="chs-toggle-desc">${esc(descText)}</div>` : ''}
        </div>
        <label class="toggle toggle-sm">
          <input type="checkbox" name="${f.key}" value="true" ${checked ? 'checked' : ''} data-original="${checked ? 'true' : 'false'}" onchange="instantApply(this)">
          <input type="hidden" name="${f.key}" value="false">
          <span class="toggle-slider"></span>
        </label>
      </div>`
      i++
      continue
    }

    // Readonly fields: render as status line
    if (f.type === 'readonly') {
      const label = f.label[lang] ?? f.label.es ?? f.key
      html += `<div class="chs-field chs-field-readonly">
        <div class="chs-field-label">${esc(label)}</div>
        <div class="chs-field-value">${esc(val) || '<span style="color:var(--on-surface-dim)">—</span>'}</div>
      </div>`
      i++
      continue
    }

    // Half-width fields: pair them
    if (f.width === 'half' && i + 1 < fields.length && fields[i + 1]!.width === 'half') {
      const f2 = fields[i + 1]!
      const val2 = config[f2.key] ?? ''
      html += '<div class="chs-field-row">'
      html += renderSingleField(f, val, lang)
      html += renderSingleField(f2, val2, lang)
      html += '</div>'
      i += 2
      continue
    }

    // Full-width field (default)
    html += renderSingleField(f, val, lang)
    i++
  }

  return html
}

function renderSingleField(f: ConsoleField, val: string, lang: Lang): string {
  return `<div class="chs-field">
    ${renderConsoleField(f, val, lang)}
  </div>`
}

// (Connection card removed — replaced by inline status bar above the layout)

// ── Period filter (affects budget + activity) ──

function renderPeriodFilter(channelId: string, lang: Lang): string {
  const label = lang === 'es' ? 'Periodo' : 'Period'
  const periods: Array<[string, string]> = lang === 'es'
    ? [['today', 'Hoy'], ['24h', '24 horas'], ['7d', '7 dias'], ['30d', '30 dias'], ['90d', '90 dias'], ['180d', '180 dias']]
    : [['today', 'Today'], ['24h', '24 hours'], ['7d', '7 days'], ['30d', '30 days'], ['90d', '90 days'], ['180d', '180 days']]
  const opts = periods.map(([v, l]) => `<option value="${v}"${v === '30d' ? ' selected' : ''}>${l}</option>`).join('')

  return `<div class="chs-period-filter" id="chs-period-wrap">
    <span class="chs-period-label">${label}</span>
    <select class="chs-period-select js-custom-select" id="chs-period">${opts}</select>
  </div>`
}

// ── Budget card ──
// NOTE: Budget/spend metrics are placeholders. The actual data will come from the reporting
// system (not yet built). Variables to connect later:
//   - CHANNEL_BUDGET_{channelId}: monthly budget in USD (0 = no budget)
//   - channel_spend_total: total spend for current period (from reporting module)
//   - channel_spend_per_interaction: avg cost per interaction (from reporting module)
// When reporting module is built, replace the mock data with real API calls.

function renderBudgetCard(channelId: string, lang: Lang, config: Record<string, string>): string {
  const budgetKey = 'CHANNEL_BUDGET_' + channelId.toUpperCase().replace(/-/g, '_')
  const budget = parseInt(config[budgetKey] ?? '0', 10)

  const budgetLabel = lang === 'es' ? 'PRESUPUESTO' : 'BUDGET'
  const totalLabel = lang === 'es' ? 'Gasto total' : 'Total spend'
  const avgLabel = lang === 'es' ? 'Gasto promedio por interaccion' : 'Avg cost per interaction'
  const addBudgetLabel = lang === 'es' ? 'Agregar presupuesto' : 'Add budget'

  // TODO: Replace mock spend data with real data from reporting module
  // Variables: channel_spend_total, channel_spend_per_interaction (from reporting API)
  const spent = 0 // placeholder until reporting module is built
  const avgCost = 0 // placeholder

  if (budget > 0) {
    const pct = Math.min((spent / budget) * 100, 100)
    const overBudget = spent > budget
    const overPct = overBudget ? Math.round(((spent - budget) / budget) * 100) : 0
    const barColor = overBudget ? 'var(--error, #dc2626)' : 'var(--success, #34c759)'
    const overLabel = overBudget
      ? (lang === 'es' ? `${overPct}% sobre presupuesto` : `${overPct}% over budget`)
      : ''

    const pencilSvg = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3a2.83 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/><path d="m15 5 4 4"/></svg>'
    const editLabel = lang === 'es' ? 'Editar' : 'Edit'
    return `<div class="chs-card chs-budget-card">
      <div class="chs-budget-header">
        <div class="chs-activity-title">${budgetLabel}</div>
        <button class="chs-budget-edit-btn" onclick="openBudgetModal('${esc(channelId)}', '${lang}', ${budget})">${pencilSvg} ${editLabel}</button>
      </div>
      <div class="chs-budget-row">
        <span>${totalLabel}</span>
        <span class="chs-budget-val ${overBudget ? 'chs-budget-over' : ''}">$${spent.toFixed(2)} / $${budget}</span>
      </div>
      <div class="chs-budget-bar">
        <div class="chs-budget-bar-fill" style="width:${pct}%;background:${barColor}"></div>
        ${overBudget ? `<div class="chs-budget-bar-over" style="width:${Math.min(overPct, 100)}%;background:var(--error, #dc2626);opacity:0.3"></div>` : ''}
      </div>
      ${overLabel ? `<div class="chs-budget-warning">${overLabel}</div>` : ''}
      <div class="chs-budget-row" style="margin-top:12px">
        <span>${avgLabel}</span>
        <span class="chs-budget-val">$${avgCost.toFixed(2)}</span>
      </div>
    </div>`
  }

  // Default: no budget set — show zero with option to add
  return `<div class="chs-card chs-budget-card">
    <div class="chs-activity-title">${budgetLabel}</div>
    <div class="chs-budget-row">
      <span>${totalLabel}</span>
      <span class="chs-budget-val">$0.00</span>
    </div>
    <div class="chs-budget-bar">
      <div class="chs-budget-bar-fill" style="width:0%;background:var(--on-surface-dim)"></div>
    </div>
    <div class="chs-budget-row" style="margin-top:12px">
      <span>${avgLabel}</span>
      <span class="chs-budget-val">$0.00</span>
    </div>
    <button class="chs-budget-add-btn" onclick="openBudgetModal('${esc(channelId)}', '${lang}', 0)">${addBudgetLabel}</button>
  </div>`
}

// ── Tip card ──

function renderTipCard(channelId: string, lang: Lang): string {
  const tip = CHANNEL_TIPS[channelId]?.[lang]
  if (!tip) return ''

  return `<div class="chs-tip-card">
    <div class="chs-tip-icon"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M9 18h6"/><path d="M10 22h4"/><path d="M12 2a7 7 0 0 0-4 12.7V17h8v-2.3A7 7 0 0 0 12 2z"/></svg></div>
    <div class="chs-tip-title">${esc(tip.title)}</div>
    <div class="chs-tip-text">${esc(tip.text)}</div>
  </div>`
}

// ── Activity card (client-side fetched, with period filter) ──

function renderActivityCard(channelId: string, lang: Lang): string {
  const title = lang === 'es' ? 'ACTIVIDAD' : 'ACTIVITY'
  const labels = lang === 'es'
    ? { active: 'Sesiones activas', inbound: 'Entrantes', outbound: 'Salientes', duration: 'Duracion promedio' }
    : { active: 'Active sessions', inbound: 'Inbound', outbound: 'Outbound', duration: 'Avg duration' }

  const chType = CHANNEL_TYPE_MAP[channelId] ?? 'instant'

  return `<div class="chs-card chs-activity-card" id="chs-activity" data-channel="${esc(channelId)}" data-type="${esc(chType)}">
    <div class="chs-activity-title">${title}</div>
    <div class="chs-activity-row"><span>${labels.active}</span><span class="chs-activity-val" data-metric="active">--</span></div>
    <div class="chs-activity-row"><span>${labels.inbound}</span><span class="chs-activity-val" data-metric="inbound">--</span></div>
    <div class="chs-activity-row"><span>${labels.outbound}</span><span class="chs-activity-val" data-metric="outbound">--</span></div>
    <div class="chs-activity-row"><span>${labels.duration}</span><span class="chs-activity-val" data-metric="avg_duration_s">--</span></div>
  </div>
  <script>
  (function(){
    var el = document.getElementById('chs-activity');
    var sel = document.getElementById('chs-period');
    if (!el) return;
    var ch = el.getAttribute('data-channel');
    var type = el.getAttribute('data-type');
    function load(period) {
      fetch('/console/api/console/channel-metrics?channel=' + ch + '&type=' + type + '&period=' + period)
        .then(function(r){ return r.json() })
        .then(function(d){
          el.querySelectorAll('[data-metric]').forEach(function(s){
            var k = s.getAttribute('data-metric');
            var v = d[k];
            if (k === 'avg_duration_s' && v != null) {
              var m = Math.floor(v/60), sec = v%60;
              s.textContent = m > 0 ? m+'m '+sec+'s' : sec+'s';
            } else {
              s.textContent = v != null ? Number(v).toLocaleString() : '--';
            }
          });
        }).catch(function(){});
    }
    // Listen to shared period filter
    if (sel) {
      sel.addEventListener('change', function(){ load(this.value); });
      load(sel.value);
    } else {
      load('30d');
    }
  })();
  </script>`
}
