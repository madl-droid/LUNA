// templates-channel-settings.ts — 2-column channel settings page renderer
// Renders: status banner + config sections (left) | connection + tips + activity (right)

import { t, type Lang } from './templates-i18n.js'
import { esc, renderConsoleField } from './templates-fields.js'
import type { ModuleInfo } from './templates-modules.js'
import type { SectionData } from './templates-sections.js'
import type { ConsoleField } from '../../kernel/types.js'

// ── Channel visual data (reuse from templates-sections) ──

const CHANNEL_ICONS: Record<string, string> = {
  whatsapp: '<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/></svg>',
  gmail: '<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="4" width="20" height="16" rx="2"/><path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"/></svg>',
  'google-chat': '<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>',
  'twilio-voice': '<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/></svg>',
}

const CHANNEL_DESCRIPTIONS: Record<string, Record<string, string>> = {
  whatsapp: {
    es: 'Atencion al cliente y seguimiento de leads en tiempo real a traves de WhatsApp Business.',
    en: 'Real-time customer support and lead follow-up through WhatsApp Business.',
  },
  gmail: {
    es: 'Canal de correo electronico via Gmail API. Procesa emails entrantes y envia respuestas.',
    en: 'Email channel via Gmail API. Processes incoming emails and sends responses.',
  },
  'google-chat': {
    es: 'Canal Google Chat para Google Workspace. El agente responde en espacios y mensajes directos.',
    en: 'Google Chat channel for Google Workspace. The agent responds in spaces and direct messages.',
  },
  'twilio-voice': {
    es: 'Llamadas de voz con IA conversacional en tiempo real usando Twilio y Gemini Live.',
    en: 'Real-time conversational AI voice calls using Twilio and Gemini Live.',
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

// ── Main renderer ──

export function renderChannelSettingsPage(channel: ModuleInfo, data: SectionData): string {
  const lang = data.lang
  const fields = channel.console?.fields ?? []
  const config = data.config
  const channelId = channel.name

  return `<div class="chs-layout">
    <div class="chs-main">
      ${renderStatusBanner(channel, data)}
      ${renderConfigSections(channelId, fields, config, lang)}
    </div>
    <div class="chs-sidebar">
      ${renderConnectionCard(channel, data)}
      ${renderTipCard(channelId, lang)}
      ${renderActivityCard(channelId, lang)}
    </div>
  </div>`
}

// ── Status banner ──

function renderStatusBanner(channel: ModuleInfo, data: SectionData): string {
  const lang = data.lang
  const icon = CHANNEL_ICONS[channel.name] ?? ''
  const title = channel.console?.title?.[lang] ?? channel.name
  const desc = CHANNEL_DESCRIPTIONS[channel.name]?.[lang] ?? channel.console?.info?.[lang] ?? ''
  const isActive = channel.active

  const statusLabel = lang === 'es'
    ? (isActive ? 'Canal Activado' : 'Canal Desactivado')
    : (isActive ? 'Channel Active' : 'Channel Inactive')
  const statusClass = isActive ? 'chs-badge-active' : 'chs-badge-inactive'

  return `<div class="chs-banner">
    <div class="chs-banner-icon">${icon}</div>
    <div class="chs-banner-info">
      <div class="chs-banner-title">${lang === 'es' ? 'Estado del Canal' : 'Channel Status'}</div>
      <div class="chs-banner-desc">${esc(desc)}</div>
    </div>
    <div class="chs-banner-status ${statusClass}">${statusLabel}</div>
  </div>`
}

// ── Config sections ──
// Fields are grouped by 'divider' type. Each divider starts a new section.

function renderConfigSections(channelId: string, fields: ConsoleField[], config: Record<string, string>, lang: Lang): string {
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

  let html = ''
  for (const sec of sections) {
    html += '<div class="chs-section">'
    if (sec.title) {
      html += `<div class="chs-section-title">${esc(sec.title)}</div>`
    }
    html += renderFieldGroup(sec.fields, config, lang)
    html += '</div>'
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
  // Use the existing renderConsoleField for the input, but wrap with our label style
  return `<div class="chs-field">
    ${renderConsoleField(f, val, lang)}
  </div>`
}

// ── Connection card (right sidebar) ──

function renderConnectionCard(channel: ModuleInfo, data: SectionData): string {
  const lang = data.lang
  const channelId = channel.name
  let connected = false
  let statusInfo = ''
  let accountInfo = ''

  if (channelId === 'whatsapp') {
    const wa = data.waState
    connected = wa?.status === 'connected'
    statusInfo = connected
      ? (lang === 'es' ? 'Dispositivo vinculado' : 'Device linked')
      : (lang === 'es' ? 'Sin conexion' : 'Not connected')
    accountInfo = data.config['WHATSAPP_CONNECTED_NUMBER'] || ''
  } else if (channelId === 'gmail') {
    connected = data.gmailAuth?.connected ?? false
    statusInfo = connected
      ? (lang === 'es' ? 'Conexion autorizada' : 'Connection authorized')
      : (lang === 'es' ? 'No conectado' : 'Not connected')
    accountInfo = data.gmailAuth?.email ?? ''
  } else if (channelId === 'google-chat') {
    connected = data.googleChatConnected ?? false
    statusInfo = connected
      ? (lang === 'es' ? 'Service Account activo' : 'Service Account active')
      : (lang === 'es' ? 'No configurado' : 'Not configured')
  } else {
    // Twilio and others: check via config
    const hasCreds = !!(data.config['TWILIO_ACCOUNT_SID'] || data.config['TWILIO_AUTH_TOKEN'])
    connected = hasCreds
    statusInfo = hasCreds
      ? (lang === 'es' ? 'Credenciales configuradas' : 'Credentials configured')
      : (lang === 'es' ? 'No configurado' : 'Not configured')
    accountInfo = data.config['TWILIO_PHONE_NUMBER'] || ''
  }

  const dotClass = connected ? 'connected' : 'disconnected'
  const statusTitle = connected
    ? (lang === 'es' ? 'Conexion Autorizada' : 'Connection Authorized')
    : (lang === 'es' ? 'Desconectado' : 'Disconnected')

  const icon = CHANNEL_ICONS[channelId] ?? ''

  const connectBtn = !connected
    ? `<button class="chs-connect-btn" onclick="channelConnect('${esc(channelId)}', '${lang}')">${lang === 'es' ? 'Conectar' : 'Connect'}</button>`
    : `<button class="chs-reconnect-btn" onclick="channelConnect('${esc(channelId)}', '${lang}')">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M23 4v6h-6"/><path d="M1 20v-6h6"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>
        ${lang === 'es' ? 'Re-autorizar cuenta' : 'Re-authorize account'}
      </button>`

  return `<div class="chs-card chs-connection-card">
    <div class="chs-connection-icon">
      ${icon}
      <span class="chs-connection-dot ${dotClass}"></span>
    </div>
    <div class="chs-connection-title">${statusTitle}</div>
    <div class="chs-connection-info">${esc(statusInfo)}</div>
    ${accountInfo ? `<div class="chs-connection-account">${esc(accountInfo)}</div>` : ''}
    ${connectBtn}
  </div>`
}

// ── Tip card ──

function renderTipCard(channelId: string, lang: Lang): string {
  const tip = CHANNEL_TIPS[channelId]?.[lang]
  if (!tip) return ''

  return `<div class="chs-card chs-tip-card">
    <div class="chs-tip-icon"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M9 18h6"/><path d="M10 22h4"/><path d="M12 2a7 7 0 0 0-4 12.7V17h8v-2.3A7 7 0 0 0 12 2z"/></svg></div>
    <div class="chs-tip-title">${esc(tip.title)}</div>
    <div class="chs-tip-text">${esc(tip.text)}</div>
  </div>`
}

// ── Activity card (client-side fetched) ──

function renderActivityCard(channelId: string, lang: Lang): string {
  const title = lang === 'es' ? 'ACTIVIDAD DE HOY' : "TODAY'S ACTIVITY"
  const labels = lang === 'es'
    ? { active: 'Sesiones activas', inbound: 'Entrantes', outbound: 'Salientes', duration: 'Duracion promedio' }
    : { active: 'Active sessions', inbound: 'Inbound', outbound: 'Outbound', duration: 'Avg duration' }

  return `<div class="chs-card chs-activity-card" id="chs-activity" data-channel="${esc(channelId)}">
    <div class="chs-activity-title">${title}</div>
    <div class="chs-activity-row"><span>${labels.active}</span><span class="chs-activity-val" data-metric="active">--</span></div>
    <div class="chs-activity-row"><span>${labels.inbound}</span><span class="chs-activity-val" data-metric="inbound">--</span></div>
    <div class="chs-activity-row"><span>${labels.outbound}</span><span class="chs-activity-val" data-metric="outbound">--</span></div>
    <div class="chs-activity-row"><span>${labels.duration}</span><span class="chs-activity-val" data-metric="avg_duration_s">--</span></div>
  </div>
  <script>
  (function(){
    var el = document.getElementById('chs-activity');
    if (!el) return;
    var ch = el.getAttribute('data-channel');
    var type = ${JSON.stringify({ whatsapp: 'instant', gmail: 'async', 'google-chat': 'instant', 'twilio-voice': 'voice' })}[ch] || 'instant';
    fetch('/console/api/console/channel-metrics?channel=' + ch + '&type=' + type + '&period=today')
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
  })();
  </script>`
}
