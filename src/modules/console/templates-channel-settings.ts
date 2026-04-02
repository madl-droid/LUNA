// templates-channel-settings.ts — 2-column channel settings page renderer
// Renders: status banner + collapsible config sections (left) | connection + budget + tips + activity (right)

import type { Lang } from './templates-i18n.js'
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
        ${renderConfigSections(channelId, fields, config, lang, (channel.console as Record<string, unknown>)?.tabs as Array<{ id: string; label: { es: string; en: string } }> | undefined)}
      </div>
      <div class="chs-sidebar">
        ${renderPeriodFilter(channelId, lang)}
        ${renderBudgetCard(channelId, lang, config)}
        ${renderActivityCard(channelId, lang)}
      </div>
    </div>
<script type="application/json" id="channel-wizards-data">${JSON.stringify(wizardJson)}</script>`
}

// ── Status bar (icon with card-style colors + status + connect/disconnect + info) ──

function renderStatusBar(channel: ModuleInfo, data: SectionData, _channelName: string): string {
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
  const btnAction = connected
    ? `channelDisconnect('${esc(channelId)}', '${lang}')`
    : `channelConnect('${esc(channelId)}', '${lang}')`

  // WhatsApp-specific extra buttons (visible via JS polling)
  const waExtras = channelId === 'whatsapp' && !connected
    ? `<button class="act-btn act-btn-config act-btn--compact" id="wa-force-retry" style="display:none" onclick="waForceRetry('${lang}')">${lang === 'es' ? 'Reintentar ahora' : 'Retry now'}</button>`
      + `<button class="act-btn act-btn-remove act-btn--compact" id="wa-disconnect-creds" style="display:none" onclick="channelDisconnect('whatsapp','${lang}')">${lang === 'es' ? 'Desconectar' : 'Disconnect'}</button>`
    : ''
  const retryInfo = channelId === 'whatsapp' && !connected
    ? `<span id="wa-retry-info" class="chs-bar-retry" style="display:none"></span>`
    : ''

  // Reuse ch-card-icon for consistent icon styling across cards and config
  return `<div class="chs-status-bar" data-status="${iconStatus}">
    <div class="ch-card-icon">${icon}</div>
    <div class="chs-bar-info">
      <div class="chs-bar-status">
        <span class="chs-bar-dot ${iconStatus}"></span>
        ${esc(statusLabel)}
        ${retryInfo}
      </div>
      ${connectionInfo ? `<div class="chs-bar-detail">${esc(connectionInfo)}</div>` : ''}
    </div>
    <div class="chs-bar-actions">
      ${waExtras}
      <button class="act-btn ${connected ? 'act-btn-remove' : 'act-btn-add'}" onclick="${btnAction}">${btnLabel}</button>
    </div>
  </div>`
}

// ── Config sections (tabs or collapsible panels) ──

function renderConfigSections(channelId: string, fields: ConsoleField[], config: Record<string, string>, lang: Lang, tabs?: Array<{ id: string; label: { es: string; en: string } }>): string {
  // If channel defines tabs, render tab-based layout
  if (tabs && tabs.length > 0) {
    return renderTabSections(channelId, fields, config, lang, tabs)
  }

  // Fallback: collapsible panels (original behavior)
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

  if (sections.length > 0 && !sections[0]!.title) {
    sections[0]!.title = lang === 'es' ? 'General' : 'General'
  }

  let html = ''
  for (let idx = 0; idx < sections.length; idx++) {
    const sec = sections[idx]!
    const collapsed = idx > 0 ? ' collapsed' : ''
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

function renderTabSections(_channelId: string, fields: ConsoleField[], config: Record<string, string>, lang: Lang, tabs: Array<{ id: string; label: { es: string; en: string } }>): string {
  // Build tab bar
  let tabBar = '<div class="chs-tabs">'
  for (let i = 0; i < tabs.length; i++) {
    const tab = tabs[i]!
    const active = i === 0 ? ' active' : ''
    tabBar += `<button class="chs-tab${active}" data-tab="${esc(tab.id)}">${esc(tab.label[lang] || tab.label.es)}</button>`
  }
  tabBar += '</div>'

  // Build tab content areas
  let content = ''
  for (let i = 0; i < tabs.length; i++) {
    const tab = tabs[i]!
    const active = i === 0 ? ' active' : ''
    const tabFields = fields.filter((f) => (f as unknown as Record<string, unknown>).tab === tab.id)

    // Group by dividers within the tab
    const sections: Array<{ title: string; fields: ConsoleField[] }> = []
    let current: { title: string; fields: ConsoleField[] } = { title: '', fields: [] }
    for (const f of tabFields) {
      if (f.type === 'divider') {
        if (current.fields.length > 0 || current.title) sections.push(current)
        current = { title: f.label[lang] ?? f.label.es ?? '', fields: [] }
      } else {
        current.fields.push(f)
      }
    }
    if (current.fields.length > 0 || current.title) sections.push(current)

    let tabHtml = ''
    for (const sec of sections) {
      if (sec.title) {
        tabHtml += `<div class="field-divider"><span class="field-divider-label">${esc(sec.title)}</span></div>`
      }
      tabHtml += renderFieldGroup(sec.fields, config, lang)
    }

    content += `<div class="chs-tab-content${active}" data-tab-content="${esc(tab.id)}">${tabHtml}</div>`
  }

  return tabBar + content
}

function visibleWhenAttrs(f: ConsoleField, config: Record<string, string>): { attrs: string; hidden: boolean } {
  if (!f.visibleWhen) return { attrs: '', hidden: false }
  const depVal = config[f.visibleWhen.key] ?? ''
  const hidden = depVal !== f.visibleWhen.value
  return {
    attrs: ` data-visible-when-key="${esc(f.visibleWhen.key)}" data-visible-when-value="${esc(f.visibleWhen.value)}"`,
    hidden,
  }
}

function renderFieldGroup(fields: ConsoleField[], config: Record<string, string>, lang: Lang): string {
  let html = ''
  let i = 0

  while (i < fields.length) {
    const f = fields[i]!
    const val = config[f.key] ?? ''
    const vw = visibleWhenAttrs(f, config)

    // Quarter-width fields — group consecutive quarter fields into 4-column grid rows
    if (f.width === 'quarter') {
      const quarterFields: ConsoleField[] = [f]
      while (i + quarterFields.length < fields.length) {
        const next = fields[i + quarterFields.length]!
        if (next.width === 'quarter') quarterFields.push(next)
        else break
      }
      html += '<div class="chs-field-row chs-field-row-4">'
      for (const qf of quarterFields) {
        const qv = config[qf.key] ?? ''
        const qvw = visibleWhenAttrs(qf, config)
        if (qf.type === 'boolean') {
          const label = qf.label[lang] ?? qf.label.es ?? qf.key
          const checked = qv === 'true' || qv === '1'
          const infoText = qf.info?.[lang] ?? ''
          const tip = infoText ? ` <span class="info-wrap"><button class="info-btn">i</button><div class="info-tooltip">${esc(infoText)}</div></span>` : ''
          html += `<div class="chs-field"${qvw.attrs}${qvw.hidden ? ' style="display:none"' : ''}>
            <div class="chs-field-label">${esc(label)}${tip}</div>
            <div style="margin-top:6px">
              <input type="hidden" name="${qf.key}" value="false">
              <label class="toggle toggle-sm">
                <input type="checkbox" name="${qf.key}" value="true" ${checked ? 'checked' : ''} data-original="${checked ? 'true' : 'false'}" onchange="instantApply(this)">
                <span class="toggle-slider"></span>
              </label>
            </div>
          </div>`
        } else {
          html += renderSingleField(qf, qv, lang, qvw)
        }
      }
      html += '</div>'
      i += quarterFields.length
      continue
    }

    // Boolean fields with width: 'third' — group into 3-column grid rows
    if (f.type === 'boolean' && f.width === 'third') {
      // Collect consecutive 'third' boolean fields
      const thirdFields: ConsoleField[] = [f]
      while (i + thirdFields.length < fields.length) {
        const next = fields[i + thirdFields.length]!
        if (next.type === 'boolean' && next.width === 'third') thirdFields.push(next)
        else break
      }
      html += '<div class="chs-field-row chs-field-row-3">'
      for (const tf of thirdFields) {
        const tv = config[tf.key] ?? ''
        const twv = visibleWhenAttrs(tf, config)
        const iconHtml = tf.icon ?? ''
        const descText = tf.description?.[lang] ?? tf.info?.[lang] ?? ''
        const label = tf.label[lang] ?? tf.label.es ?? tf.key
        const checked = tv === 'true' || tv === '1'
        html += `<div class="chs-toggle-row chs-toggle-compact"${twv.attrs}${twv.hidden ? ' style="display:none"' : ''}>
          ${iconHtml ? `<div class="chs-toggle-icon">${iconHtml}</div>` : ''}
          <div class="chs-toggle-text">
            <div class="chs-toggle-title">${esc(label)}</div>
            ${descText ? `<div class="chs-toggle-desc">${esc(descText)}</div>` : ''}
          </div>
          <input type="hidden" name="${tf.key}" value="false">
          <label class="toggle toggle-sm">
            <input type="checkbox" name="${tf.key}" value="true" ${checked ? 'checked' : ''} data-original="${checked ? 'true' : 'false'}" onchange="instantApply(this)">
            <span class="toggle-slider"></span>
          </label>
        </div>`
      }
      html += '</div>'
      i += thirdFields.length
      continue
    }

    // Boolean fields: render as toggle rows
    if (f.type === 'boolean') {
      const iconHtml = f.icon ?? ''
      const descText = f.description?.[lang] ?? f.info?.[lang] ?? ''
      const label = f.label[lang] ?? f.label.es ?? f.key
      const checked = val === 'true' || val === '1'
      html += `<div class="chs-toggle-row"${vw.attrs}${vw.hidden ? ' style="display:none"' : ''}>
        ${iconHtml ? `<div class="chs-toggle-icon">${iconHtml}</div>` : ''}
        <div class="chs-toggle-text">
          <div class="chs-toggle-title">${esc(label)}</div>
          ${descText ? `<div class="chs-toggle-desc">${esc(descText)}</div>` : ''}
        </div>
        <input type="hidden" name="${f.key}" value="false">
        <label class="toggle toggle-sm">
          <input type="checkbox" name="${f.key}" value="true" ${checked ? 'checked' : ''} data-original="${checked ? 'true' : 'false'}" onchange="instantApply(this)">
          <span class="toggle-slider"></span>
        </label>
      </div>`
      i++
      continue
    }

    // Readonly fields: render as status line
    if (f.type === 'readonly') {
      const label = f.label[lang] ?? f.label.es ?? f.key
      html += `<div class="chs-field chs-field-readonly"${vw.attrs}${vw.hidden ? ' style="display:none"' : ''}>
        <div class="chs-field-label">${esc(label)}</div>
        <div class="chs-field-value">${esc(val) || '<span class="u-text-muted">—</span>'}</div>
      </div>`
      i++
      continue
    }

    // Half-width fields: pair them
    if (f.width === 'half' && i + 1 < fields.length && fields[i + 1]!.width === 'half') {
      const f2 = fields[i + 1]!
      const val2 = config[f2.key] ?? ''
      const vw2 = visibleWhenAttrs(f2, config)
      const rowHidden = vw.hidden && vw2.hidden
      // If both fields share the same visibleWhen, apply it to the row wrapper too
      const sameVW = f.visibleWhen && f2.visibleWhen
        && f.visibleWhen.key === f2.visibleWhen.key
        && f.visibleWhen.value === f2.visibleWhen.value
      const rowVWAttrs = sameVW ? vw.attrs : ''
      html += `<div class="chs-field-row"${rowVWAttrs}${rowHidden ? ' style="display:none"' : ''}>`
      html += renderSingleField(f, val, lang, vw)
      html += renderSingleField(f2, val2, lang, vw2)
      html += '</div>'
      i += 2
      continue
    }

    // Full-width field (default)
    html += renderSingleField(f, val, lang, vw)
    i++
  }

  return html
}

function renderSingleField(f: ConsoleField, val: string, lang: Lang, vw?: { attrs: string; hidden: boolean }): string {
  const va = vw ?? { attrs: '', hidden: false }
  const spaceBefore = !!f.spaceBefore
  const styleStr = [va.hidden ? 'display:none' : '', spaceBefore ? 'margin-top:16px' : ''].filter(Boolean).join(';')
  return `<div class="chs-field"${va.attrs}${styleStr ? ` style="${styleStr}"` : ''}>
    ${renderConsoleField(f, val, lang)}
  </div>`
}

// (Connection card removed — replaced by inline status bar above the layout)

// ── Period filter (affects budget + activity) ──

function renderPeriodFilter(_channelId: string, lang: Lang): string {
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

function renderBudgetCard(channelId: string, lang: Lang, config: Record<string, string>): string {
  const budgetKey = 'CHANNEL_BUDGET_' + channelId.toUpperCase().replace(/-/g, '_')
  const budget = parseInt(config[budgetKey] ?? '0', 10)

  const budgetLabel = lang === 'es' ? 'PRESUPUESTO' : 'BUDGET'
  const totalLabel = lang === 'es' ? 'Gasto total' : 'Total spend'
  const avgLabel = lang === 'es' ? 'Gasto promedio por interaccion' : 'Avg cost per interaction'
  const addBudgetLabel = lang === 'es' ? 'Agregar presupuesto' : 'Add budget'
  const pencilSvg = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3a2.83 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/><path d="m15 5 4 4"/></svg>'
  const editLabel = lang === 'es' ? 'Editar' : 'Edit'

  const cardInner = budget > 0
    ? `<div class="chs-budget-header">
        <div class="chs-activity-title">${budgetLabel}</div>
        <button class="chs-budget-edit-btn" onclick="openBudgetModal('${esc(channelId)}', '${lang}', ${budget})">${pencilSvg} ${editLabel}</button>
      </div>
      <div class="chs-budget-row">
        <span>${totalLabel}</span>
        <span class="chs-budget-val" id="chs-spend-total">--</span>
      </div>
      <div class="chs-budget-bar">
        <div class="chs-budget-bar-fill" id="chs-spend-bar" style="width:0%;background:var(--success)"></div>
      </div>
      <div class="chs-budget-warning" id="chs-spend-warning" style="display:none"></div>
      <div class="chs-budget-row u-mt-md">
        <span>${avgLabel}</span>
        <span class="chs-budget-val" id="chs-spend-avg">--</span>
      </div>`
    : `<div class="chs-activity-title">${budgetLabel}</div>
      <div class="chs-budget-row">
        <span>${totalLabel}</span>
        <span class="chs-budget-val" id="chs-spend-total">--</span>
      </div>
      <div class="chs-budget-bar">
        <div class="chs-budget-bar-fill" style="width:0%;background:var(--on-surface-dim)"></div>
      </div>
      <div class="chs-budget-row u-mt-md">
        <span>${avgLabel}</span>
        <span class="chs-budget-val" id="chs-spend-avg">--</span>
      </div>
      <button class="chs-budget-add-btn" onclick="openBudgetModal('${esc(channelId)}', '${lang}', 0)">${addBudgetLabel}</button>`

  return `<div class="chs-card chs-budget-card" id="chs-budget" data-channel="${esc(channelId)}" data-budget="${budget}">
    ${cardInner}
  </div>
  <script>
  (function(){
    var card = document.getElementById('chs-budget');
    var sel = document.getElementById('chs-period');
    if (!card) return;
    var ch = card.getAttribute('data-channel');
    var budget = parseInt(card.getAttribute('data-budget') || '0', 10);
    function load(period) {
      fetch('/console/api/console/channel-spend?channel=' + ch + '&period=' + period)
        .then(function(r){ return r.json() })
        .then(function(d){
          var spent = d.total_spend || 0;
          var avg = d.avg_cost || 0;
          var totalEl = document.getElementById('chs-spend-total');
          var avgEl = document.getElementById('chs-spend-avg');
          var barEl = document.getElementById('chs-spend-bar');
          var warnEl = document.getElementById('chs-spend-warning');
          if (totalEl) {
            totalEl.textContent = budget > 0 ? '$' + spent.toFixed(2) + ' / $' + budget : '$' + spent.toFixed(2);
            if (budget > 0 && spent > budget) totalEl.classList.add('chs-budget-over');
            else totalEl.classList.remove('chs-budget-over');
          }
          if (avgEl) avgEl.textContent = '$' + avg.toFixed(4);
          if (barEl && budget > 0) {
            var pct = Math.min((spent / budget) * 100, 100);
            var over = spent > budget;
            barEl.style.width = pct + '%';
            barEl.style.background = over ? 'var(--error)' : 'var(--success)';
          }
          if (warnEl && budget > 0 && spent > budget) {
            var overPct = Math.round(((spent - budget) / budget) * 100);
            warnEl.textContent = ${lang === 'es' ? "overPct + '% sobre presupuesto'" : "overPct + '% over budget'"};
            warnEl.style.display = '';
          } else if (warnEl) {
            warnEl.style.display = 'none';
          }
        }).catch(function(){
          var totalEl = document.getElementById('chs-spend-total');
          var avgEl = document.getElementById('chs-spend-avg');
          if (totalEl) totalEl.textContent = '$0.00';
          if (avgEl) avgEl.textContent = '$0.00';
        });
    }
    if (sel) {
      sel.addEventListener('change', function(){ load(this.value); });
      load(sel.value);
    } else {
      load('month');
    }
  })();
  </script>`
}

// ── Tip card ──

export function renderTipCard(channelId: string, lang: Lang): string {
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
