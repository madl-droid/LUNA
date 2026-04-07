import { t, tWaStatus, type Lang } from './templates-i18n.js'
import { esc } from './templates-fields.js'
import { renderModulePanels } from './templates-modules.js'
import { cv, type SectionData } from './templates-section-data.js'

const GOOGLE_SVG = `<svg width="18" height="18" viewBox="0 0 18 18" class="google-icon" xmlns="http://www.w3.org/2000/svg">
  <path d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844c-.209 1.125-.843 2.078-1.796 2.717v2.258h2.908c1.702-1.567 2.684-3.875 2.684-6.615z" fill="#4285F4"/>
  <path d="M9 18c2.43 0 4.467-.806 5.956-2.18l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 0 0 9 18z" fill="#34A853"/>
  <path d="M3.964 10.71A5.41 5.41 0 0 1 3.682 9c0-.593.102-1.17.282-1.71V4.958H.957A8.996 8.996 0 0 0 0 9c0 1.452.348 2.827.957 4.042l3.007-2.332z" fill="#FBBC05"/>
  <path d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 0 0 .957 4.958L3.964 6.29C4.672 4.163 6.656 3.58 9 3.58z" fill="#EA4335"/>
</svg>`

export function renderWhatsappSection(data: SectionData): string {
  const wa = data.waState ?? { status: 'not_initialized', qrDataUrl: null, lastDisconnectReason: null, moduleEnabled: false }
  const moduleEnabled = wa.moduleEnabled !== false
  const statusLabel = tWaStatus(wa.status, data.lang)
  const showQr = wa.status === 'qr_ready' && wa.qrDataUrl
  const canConnect = moduleEnabled && (wa.status === 'disconnected' || wa.status === 'not_initialized')
  const canDisconnect = wa.status === 'connected' || wa.status === 'qr_ready' || wa.status === 'connecting'

  const waPhone = cv(data, 'WHATSAPP_PHONE_NUMBER')
  const twilioPhone = cv(data, 'TWILIO_PHONE_NUMBER')

  return `<div class="panel">
    <div class="panel-header" onclick="togglePanel(this)">
      <span class="panel-title">${t('sec_whatsapp_baileys', data.lang)}
        <span class="panel-badge badge-active">${statusLabel}</span>
        ${!moduleEnabled ? '<span class="panel-badge badge-soon">' + t('waModuleDisabled', data.lang) + '</span>' : ''}
      </span>
      <span class="panel-chevron">&#9660;</span>
    </div>
    <div class="panel-body">
      <div class="panel-info">${t('sec_whatsapp_baileys_info', data.lang)}</div>
      <div id="wa-inner">
        <div class="wa-status-row">
          <span class="wa-badge ${wa.status}"><span class="wa-dot"></span>${statusLabel}</span>
          ${wa.lastDisconnectReason ? `<span class="wa-reason">${t('reason', data.lang)}: ${esc(wa.lastDisconnectReason)}</span>` : ''}
        </div>
        <div class="wa-actions">
          <button class="wa-btn wa-btn-connect" onclick="waConnect()" ${canConnect ? '' : 'disabled'} ${!moduleEnabled ? 'title="' + t('waModuleDisabled', data.lang) + '"' : ''}>${t('connectBtn', data.lang)}</button>
          <button class="wa-btn wa-btn-disconnect" onclick="waDisconnect()" ${canDisconnect ? '' : 'disabled'}>${t('disconnectBtn', data.lang)}</button>
        </div>
        <div class="wa-qr-box ${showQr ? '' : 'wa-qr-hidden'}">
          ${showQr ? `<img src="${wa.qrDataUrl}" alt="QR" />` : ''}
          <div class="wa-qr-label">${t('scanLabel', data.lang)}</div>
        </div>
        <div class="wa-phones">
          <div><label>${t('f_WHATSAPP_PHONE', data.lang)}</label>
            <input type="text" name="WHATSAPP_PHONE_NUMBER" value="${esc(waPhone)}" data-original="${esc(waPhone)}"></div>
          <div><label>${t('f_TWILIO_PHONE', data.lang)}</label>
            <input type="text" name="TWILIO_PHONE_NUMBER" value="${esc(twilioPhone)}" data-original="${esc(twilioPhone)}"></div>
        </div>
      </div>
    </div>
  </div>
  ${renderModulePanels(data.moduleStates ?? [], data.config, data.lang, 'whatsapp')}`
}

// ═══════════════════════════════════════════
// Unified LLM page — apikeys + models + limits + circuit breaker
// ═══════════════════════════════════════════

export function renderEmailSection(data: SectionData): string {
  const ga = data.gmailAuth ?? { connected: false, email: null }
  const moduleActive = data.moduleStates?.some(m => m.name === 'gmail' && m.active) ?? false

  if (!moduleActive) {
    const msg = data.lang === 'es'
      ? 'El modulo Gmail no esta activado. Activalo desde la seccion <a href="/console/modules">Modulos</a> para poder conectar.'
      : 'The Gmail module is not active. Activate it from the <a href="/console/modules">Modules</a> section to connect.'
    return `<div class="panel"><div class="panel-body panel-body-flat">
      <div class="panel-info module-inactive-notice">${msg}</div>
    </div></div>`
  }

  const statusLabel = ga.connected
    ? `<span class="status-dot connected"></span><span class="status-label connected">${t('gmailConnected', data.lang)}</span>${ga.email ? ` — <span class="status-email">${esc(ga.email)}</span>` : ''}`
    : `<span class="status-dot disconnected"></span><span class="status-label disconnected">${t('gmailNotConnected', data.lang)}</span>`

  const googleSvg = GOOGLE_SVG

  return `<div class="panel">
    <div class="panel-body panel-body-flat">
      <div class="panel-info">${t('gmailAuthInfo', data.lang)}</div>
      <div class="status-row">
        <div class="status-label">${statusLabel}</div>
        <button type="button" class="btn-secondary" onclick="refreshGmailStatus()">${t('googleRefreshStatus', data.lang)}</button>
      </div>
      <div class="status-actions">
        ${!ga.connected ? `
        <button type="button" class="act-btn act-btn-add" onclick="gmailConnect()">
          ${googleSvg} ${t('gmailConnectBtn', data.lang)}
        </button>` : `
        <button type="button" class="btn-danger" onclick="gmailDisconnect()">
          ${t('gmailDisconnectBtn', data.lang)}
        </button>`}
      </div>
    </div>
  </div>
  ${renderModulePanels(data.moduleStates ?? [], data.config, data.lang, 'gmail')}`
}

export function renderGoogleAppsSection(data: SectionData): string {
  const ga = data.googleAppsAuth ?? { connected: false, email: null }
  const moduleActive = data.moduleStates?.some(m => m.name === 'google-apps' && m.active) ?? false
  const isEs = data.lang === 'es'

  if (!moduleActive) {
    const msg = isEs
      ? 'El modulo Google Workspace no esta activado. Activalo desde la seccion <a href="/console/modules">Modulos</a> para poder conectar.'
      : 'The Google Workspace module is not active. Activate it from the <a href="/console/modules">Modules</a> section to connect.'
    return `<div class="panel"><div class="panel-body panel-body-flat">
      <div class="panel-info module-inactive-notice">${msg}</div>
    </div></div>`
  }

  // Enabled services from config
  const enabledStr = (data.config['GOOGLE_ENABLED_SERVICES'] || 'drive,sheets,docs,slides,calendar').toLowerCase()
  const enabledSet = new Set(enabledStr.split(',').map(s => s.trim()).filter(Boolean))

  // Status box — channel-style
  const statusColor = ga.connected ? 'var(--success)' : 'var(--on-surface-dim)'
  const statusText = ga.connected ? t('googleAppsConnected', data.lang) : t('googleAppsNotConnected', data.lang)
  const googleSvg = GOOGLE_SVG

  const statusBox = `<div class="panel" style="margin-bottom:20px">
    <div class="panel-body panel-body-flat ts-gws-status-body">
      <div class="ts-gws-status-left">
        <div class="ts-gws-status-icon" style="border:2px solid ${statusColor}">
          ${googleSvg}
        </div>
        <div>
          <div class="ts-gws-status-name">${statusText}</div>
          ${ga.email ? `<div class="ts-gws-status-email">${esc(ga.email)}</div>` : ''}
        </div>
      </div>
      <div class="ts-gws-status-actions">
        <button type="button" class="btn-secondary ts-gws-btn-sm" onclick="refreshGoogleAppsStatus()">${t('googleRefreshStatus', data.lang)}</button>
        ${!ga.connected
          ? `<button type="button" class="act-btn act-btn-add act-btn--sm" onclick="googleAppsConnect()">${t('googleAppsConnectBtn', data.lang)}</button>`
          : `<button type="button" class="btn-danger ts-gws-btn-sm" onclick="googleAppsDisconnect()">${t('googleAppsDisconnectBtn', data.lang)}</button>`
        }
      </div>
    </div>
  </div>`

  // Service cards — 3 per row with toggle + expandable permissions
  const services = [
    { id: 'drive', name: 'Google Drive', icon: '&#128193;',
      perms: ['view', 'share', 'create', 'edit', 'delete'] },
    { id: 'sheets', name: 'Google Sheets', icon: '&#128202;',
      perms: ['view', 'share', 'create', 'edit', 'delete'] },
    { id: 'docs', name: 'Google Docs', icon: '&#128196;',
      perms: ['view', 'share', 'create', 'edit', 'delete'] },
    { id: 'slides', name: 'Google Slides', icon: '&#128253;',
      perms: ['view', 'share', 'create', 'edit', 'delete'] },
    { id: 'calendar', name: 'Google Calendar', icon: '&#128197;',
      perms: ['view', 'create', 'edit', 'delete'], hasSettings: true },
    { id: 'gmail', name: 'Gmail', icon: '&#9993;',
      perms: ['view', 'create', 'edit', 'delete'] },
  ]

  const permLabels: Record<string, Record<string, string>> = {
    view:   { es: 'Ver', en: 'View' },
    share:  { es: 'Compartir', en: 'Share' },
    create: { es: 'Crear', en: 'Create' },
    edit:   { es: 'Editar', en: 'Edit' },
    delete: { es: 'Eliminar', en: 'Delete' },
  }

  // Gmail channel auth status for the Gmail service card
  const gmailConnected = data.gmailAuth?.connected ?? false
  const gmailEmail = data.gmailAuth?.email ?? null

  const serviceCards = services.map(svc => {
    const isActive = enabledSet.has(svc.id)
    // Read per-service permissions from config (e.g. GOOGLE_PERMS_DRIVE = "view,share,create,edit")
    const permsKey = `GOOGLE_PERMS_${svc.id.toUpperCase()}`
    const permsStr = data.config[permsKey] || (svc.perms.filter(p => p !== 'delete').join(','))
    const activePerms = new Set(permsStr.split(',').map(p => p.trim()).filter(Boolean))

    const permToggles = svc.perms.map(p => {
      const checked = activePerms.has(p)
      const isDelete = p === 'delete'
      return `<label class="ts-gws-perm-label${isDelete ? ' ts-gws-perm-label-delete' : ''}">
        <input type="checkbox" class="gws-perm ts-gws-perm-checkbox${isDelete ? ' ts-gws-perm-checkbox-delete' : ''}" data-service="${svc.id}" data-perm="${p}" ${checked ? 'checked' : ''} onchange="gwsPermChanged()">
        ${permLabels[p]?.[data.lang] || p}
      </label>`
    }).join('')

    // Gmail service card gets a connection status badge
    let statusBadge = ''
    if (svc.id === 'gmail') {
      const badgeColor = gmailConnected ? 'var(--success)' : 'var(--on-surface-dim)'
      const badgeText = gmailConnected
        ? (isEs ? 'Conectado' : 'Connected') + (gmailEmail ? ` (${esc(gmailEmail)})` : '')
        : (isEs ? 'No conectado' : 'Not connected')
      statusBadge = `<div style="padding:8px 14px;font-size:12px;color:${badgeColor};display:flex;align-items:center;gap:6px">
        <span style="width:8px;height:8px;border-radius:50%;background:${badgeColor};display:inline-block"></span>
        ${badgeText}
      </div>`
    }

    const settingsBtn = (svc as { hasSettings?: boolean }).hasSettings && isActive
      ? `<a href="/console/herramientas/google-apps/${svc.id}" class="btn-secondary" style="font-size:12px;padding:4px 10px;margin-left:8px;text-decoration:none" onclick="event.stopPropagation()">${isEs ? 'Configurar' : 'Configure'}</a>`
      : ''

    return `<div class="gws-card ts-gws-card${!isActive ? ' ts-gws-card-inactive' : ''}" data-service="${svc.id}">
      <div class="ts-gws-card-header" onclick="gwsToggleCard('${svc.id}')">
        <div class="ts-gws-card-name-wrap">
          <span class="ts-gws-card-icon">${svc.icon}</span>
          <span class="ts-gws-card-name">${svc.name}</span>
        </div>
        <div style="display:flex;align-items:center;flex-shrink:0" onclick="event.stopPropagation()">
          ${settingsBtn}
          <label class="toggle" style="margin-left:8px">
            <input type="checkbox" class="gws-toggle" data-service="${svc.id}" ${isActive ? 'checked' : ''} onchange="gwsServiceToggled(this)">
            <span class="toggle-slider"></span>
          </label>
        </div>
      </div>${statusBadge}
      <div class="gws-card-body ts-gws-card-body" data-card-body="${svc.id}">
        <div class="ts-gws-perms-title">${isEs ? 'Permisos del agente' : 'Agent permissions'}</div>
        <div class="ts-gws-perms-list">
          ${permToggles}
        </div>
      </div>
    </div>`
  }).join('')

  const servicesGrid = `<div class="ts-gws-services-wrap">
    <div class="ts-gws-services-title">${t('googleAppsServicesTitle', data.lang)}</div>
    <div class="ts-gws-services-grid">
      ${serviceCards}
    </div>
  </div>`

  // Script for card interactions
  const script = `<script>
(function(){
  window.gwsToggleCard = function(serviceId) {
    var body = document.querySelector('[data-card-body="' + serviceId + '"]');
    if (!body) return;
    body.style.display = body.style.display === 'none' ? 'block' : 'none';
  };

  window.gwsServiceToggled = function(checkbox) {
    var serviceId = checkbox.dataset.service;
    var card = checkbox.closest('.gws-card');
    if (card) card.style.opacity = checkbox.checked ? '1' : '0.6';
    gwsSaveServices();
  };

  window.gwsPermChanged = function() { gwsSaveServices(); };

  function gwsSaveServices() {
    var toggles = document.querySelectorAll('.gws-toggle');
    var enabled = [];
    toggles.forEach(function(t) { if (t.checked) enabled.push(t.dataset.service); });

    // Build per-service perms
    var permsData = {};
    var services = ['drive','sheets','docs','slides','calendar','gmail'];
    services.forEach(function(svc) {
      var checks = document.querySelectorAll('.gws-perm[data-service="' + svc + '"]');
      var activePerms = [];
      checks.forEach(function(c) { if (c.checked) activePerms.push(c.dataset.perm); });
      permsData['GOOGLE_PERMS_' + svc.toUpperCase()] = activePerms.join(',');
    });

    var params = new URLSearchParams();
    params.append('_section', 'google-apps');
    params.append('_lang', '${data.lang}');
    params.append('GOOGLE_ENABLED_SERVICES', enabled.join(','));
    Object.keys(permsData).forEach(function(key) {
      params.append(key, permsData[key]);
    });

    fetch('/console/save', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params.toString()
    })
      .then(function(r) {
        if (!(r.ok || r.redirected)) throw new Error('save failed');
        return fetch('/console/apply', {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: '_section=google-apps&_lang=${data.lang}'
        });
      })
      .then(function(r) {
        if (!(r.ok || r.redirected)) throw new Error('apply failed');
        if (window.showToast) window.showToast('${isEs ? 'Guardado y aplicado' : 'Saved and applied'}', 'success');
      })
      .catch(function() {
        if (window.showToast) window.showToast('Error', 'error');
      });
  }
})();
</script>`

  return `${statusBox}${servicesGrid}${script}`
}

// ═══════════════════════════════════════════
// Unified Infrastructure page — DB + Redis
// ═══════════════════════════════════════════

interface ChannelCard {
  id: string
  moduleName: string
  channelType: 'instant' | 'async' | 'voice'
  name: string
  description: string
  icon: string
  iconBg: string
  status: 'connected' | 'disconnected' | 'inactive' | 'error'
  active: boolean
  settingsUrl: string
}

const CHANNEL_ICONS: Record<string, { svg: string; bg: string }> = {
  whatsapp: {
    svg: `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/></svg>`,
    bg: 'rgba(37, 211, 102, 0.08)',
  },
  gmail: {
    svg: `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="4" width="20" height="16" rx="2"/><path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"/></svg>`,
    bg: 'rgba(234, 67, 53, 0.08)',
  },
  'google-chat': {
    svg: `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>`,
    bg: 'rgba(26, 115, 232, 0.08)',
  },
  'twilio-voice': {
    svg: `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/></svg>`,
    bg: 'rgba(242, 47, 70, 0.08)',
  },
  telegram: {
    svg: `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M22 2L11 13"/><path d="M22 2L15 22L11 13L2 9L22 2Z"/></svg>`,
    bg: 'rgba(0, 136, 204, 0.08)',
  },
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
  telegram: {
    es: 'Mensajeria instantanea via Telegram Bot API. Permite al agente interactuar con usuarios y grupos a traves de un bot, con soporte para texto, multimedia y comandos.',
    en: 'Instant messaging via Telegram Bot API. Allows the agent to interact with users and groups through a bot, with support for text, media and commands.',
  },
}

function buildChannelCards(data: SectionData): ChannelCard[] {
  const lang = data.lang
  const modules = data.moduleStates ?? []
  const cards: ChannelCard[] = []

  const channelDefs: Array<{ id: string; moduleName: string; sectionId: string; defaultType: 'instant' | 'async' | 'voice' }> = [
    { id: 'whatsapp', moduleName: 'whatsapp', sectionId: 'whatsapp', defaultType: 'instant' },
    { id: 'gmail', moduleName: 'gmail', sectionId: 'email', defaultType: 'async' },
    { id: 'google-chat', moduleName: 'google-chat', sectionId: 'google-chat', defaultType: 'instant' },
    { id: 'twilio-voice', moduleName: 'twilio-voice', sectionId: 'twilio-voice', defaultType: 'voice' },
    { id: 'telegram', moduleName: 'telegram', sectionId: 'telegram', defaultType: 'instant' },
  ]

  const googleAppsActive = modules.some(m => m.name === 'google-apps' && m.active)

  for (const ch of channelDefs) {
    // Gmail channel is only shown when google-apps module is active
    if (ch.id === 'gmail' && !googleAppsActive) continue

    const mod = modules.find(m => m.name === ch.moduleName)
    const isActive = mod?.active ?? false
    const channelType = mod?.channelType ?? ch.defaultType

    let status: ChannelCard['status'] = 'inactive'
    if (isActive) {
      status = 'disconnected'
      if (ch.id === 'whatsapp' && data.waState) {
        status = data.waState.status === 'connected' ? 'connected' : 'disconnected'
      }
      if (ch.id === 'gmail' && data.gmailAuth) {
        status = data.gmailAuth.connected ? 'connected' : 'disconnected'
      }
      if (ch.id === 'google-chat') {
        status = data.googleChatConnected ? 'connected' : 'disconnected'
      }
    }

    const iconInfo = CHANNEL_ICONS[ch.id] ?? { svg: '', bg: 'rgba(0,0,0,0.05)' }
    const desc = CHANNEL_DESCRIPTIONS[ch.id]?.[lang] ?? CHANNEL_DESCRIPTIONS[ch.id]?.es ?? ''
    // Read name from manifest console.title (single source of truth)
    const name = mod?.console?.title?.[lang as 'es' | 'en'] ?? ch.id

    cards.push({
      id: ch.id,
      moduleName: ch.moduleName,
      channelType,
      name,
      description: desc,
      icon: iconInfo.svg,
      iconBg: iconInfo.bg,
      status,
      active: isActive,
      settingsUrl: `/console/channels/${ch.id}?lang=${lang}`,
    })
  }

  // Dynamic channel modules not in the hardcoded list
  for (const mod of modules) {
    if (mod.type !== 'channel') continue
    if (channelDefs.some(c => c.moduleName === mod.name)) continue

    const iconInfo = CHANNEL_ICONS[mod.name] ?? { svg: '', bg: 'rgba(0,0,0,0.05)' }
    const title = mod.console?.title?.[lang as 'es' | 'en'] ?? mod.name
    cards.push({
      id: mod.name,
      moduleName: mod.name,
      channelType: mod.channelType ?? 'instant',
      name: title,
      description: '',
      icon: iconInfo.svg,
      iconBg: iconInfo.bg,
      status: mod.active ? 'connected' : 'inactive',
      active: mod.active,
      settingsUrl: `/console/channels/${mod.name}?lang=${lang}`,
    })
  }

  return cards
}

const GEAR_SVG = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>`

// ─── Channels marked as "coming soon" — toggle disabled, no settings link ───
// To enable a channel when it's ready, remove its ID from this set.
const COMING_SOON_CHANNELS: ReadonlySet<string> = new Set(['google-chat', 'twilio-voice', 'telegram'])
void COMING_SOON_CHANNELS // used on line 985

// Helper: renders a single metric cell with label + hover tooltip
function metricCell(field: string, label: string, info: string, nd: string): string {
  return `<div class="ch-metric">
    <div class="ch-metric-head">
      <span class="ch-metric-label">${label}</span>
      <span class="ch-info-btn" tabindex="0">i</span>
      <div class="ch-info-tip">${info}</div>
    </div>
    <span class="ch-metric-value" data-field="${field}">${nd}</span>
  </div>`
}

function renderMetricsForType(channelType: 'instant' | 'async' | 'voice', channelId: string, lang: Lang): string {
  const nd = t('ch_no_data', lang)

  // Standardized 4 metrics for ALL channel types: active, inbound, outbound, avg_duration_s
  return `<div class="ch-card-metrics ch-metrics-4" data-channel="${esc(channelId)}" data-type="${channelType}">
    ${metricCell('active', t('ch_m_active', lang), t('ch_m_active_info_' + channelType, lang) || t('ch_m_active_info', lang), nd)}
    ${metricCell('inbound', t('ch_m_inbound', lang), t('ch_m_inbound_info_' + channelType, lang) || t('ch_m_inbound_info', lang), nd)}
    ${metricCell('outbound', t('ch_m_outbound', lang), t('ch_m_outbound_info_' + channelType, lang) || t('ch_m_outbound_info', lang), nd)}
    ${metricCell('avg_duration_s', t('ch_m_avg_duration', lang), t('ch_m_avg_duration_info_' + channelType, lang) || t('ch_m_avg_duration_info', lang), nd)}
  </div>`
}

export function renderChannelsSection(data: SectionData): string {
  const cards = buildChannelCards(data)
  const lang = data.lang

  // Period options in order
  const periods = [
    ['today', t('ch_period_today', lang)],
    ['24h', t('ch_period_24h', lang)],
    ['7d', t('ch_period_7d', lang)],
    ['30d', t('ch_period_30d', lang)],
    ['90d', t('ch_period_90d', lang)],
    ['180d', t('ch_period_180d', lang)],
  ]
  const periodOpts = periods.map(([v, l]) => `<option value="${v}"${v === '30d' ? ' selected' : ''}>${l}</option>`).join('')

  // Filter bar
  const filterBar = `<div class="filter-bar">
    <div class="ch-filter-group">
      <span class="ch-filter-label">${t('ch_filter_metrics', lang)}</span>
      <select class="ch-filter-select js-custom-select" id="ch-period-global">${periodOpts}</select>
    </div>
    <div class="ch-filter-sep"></div>
    <div class="ch-filter-group">
      <span class="ch-filter-label">${t('ch_filter_status', lang)}</span>
      <select class="ch-filter-select js-custom-select" id="ch-filter-status">
        <option value="all">${t('ch_filter_all', lang)}</option>
        <option value="active">${t('ch_filter_active', lang)}</option>
        <option value="inactive">${t('ch_filter_inactive', lang)}</option>
        <option value="disconnected">${t('ch_filter_disconnected', lang)}</option>
      </select>
    </div>
    <div class="ch-filter-sep"></div>
    <div class="ch-filter-group">
      <span class="ch-filter-label">${t('ch_filter_type', lang)}</span>
      <select class="ch-filter-select js-custom-select" id="ch-filter-type">
        <option value="all">${t('ch_filter_all', lang)}</option>
        <option value="instant">${t('ch_type_instant', lang)}</option>
        <option value="async">${t('ch_type_async', lang)}</option>
        <option value="voice">${t('ch_type_voice', lang)}</option>
      </select>
    </div>
  </div>`

  const cardsHtml = cards.map(card => {
    const comingSoon = COMING_SOON_CHANNELS.has(card.id)
    const typeLabel = t('ch_type_' + card.channelType, lang)
    const statusLabels: Record<string, string> = {
      connected: t('ch_connected', lang),
      disconnected: t('ch_disconnected', lang),
      inactive: t('ch_inactive', lang),
      error: t('ch_error', lang),
    }
    const toggleChecked = card.active ? 'checked' : ''
    const filterStatus = card.active ? (card.status === 'disconnected' ? 'disconnected' : 'active') : 'inactive'

    // SVG icons for connect/disconnect — same size as gear (16x16)
    const plugSvg = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14"/><path d="M12 5l7 7-7 7"/></svg>`
    const unplugSvg = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 12H5"/><path d="M12 19l-7-7 7-7"/></svg>`

    let connectionBtn = ''
    if (!comingSoon && card.active && card.status === 'connected') {
      connectionBtn = `<button class="act-btn act-btn-remove" onclick="channelDisconnect('${esc(card.id)}', '${lang}')">${unplugSvg} ${t('ch_disconnect', lang)}</button>`
    } else if (!comingSoon && card.active && card.status !== 'connected') {
      connectionBtn = `<button class="act-btn act-btn-add" onclick="channelConnect('${esc(card.id)}', '${lang}')">${plugSvg} ${t('ch_connect', lang)}</button>`
    }

    // Footer: coming-soon badge OR config + connect/disconnect when active
    const footerHtml = comingSoon
      ? `<div class="ch-card-footer"><span class="panel-badge badge-soon">${lang === 'es' ? 'Próximamente' : 'Coming soon'}</span></div>`
      : card.active
        ? `<div class="ch-card-footer"><a href="${card.settingsUrl}" class="act-btn act-btn-config" title="${t('ch_settings', lang)}">${GEAR_SVG} ${t('ch_settings', lang)}</a><span class="ch-footer-spacer"></span>${connectionBtn}</div>`
        : ''

    // Toggle: disabled for coming-soon channels
    const toggleHtml = comingSoon
      ? `<label class="toggle toggle-sm"><input type="checkbox" disabled><span class="toggle-slider"></span></label>`
      : `<label class="toggle toggle-sm"><input type="checkbox" ${toggleChecked} data-module="${esc(card.moduleName)}" data-redirect="/console/channels?lang=${lang}" onchange="toggleChannelConfirm(this)"><span class="toggle-slider"></span></label>`

    // Status tooltip text
    const statusLabel = statusLabels[card.status] ?? card.status

    return `
    <div class="ch-card${(card.active && !comingSoon) ? '' : ' ch-card-inactive'}" data-channel-id="${esc(card.id)}" data-status="${comingSoon ? 'inactive' : card.status}" data-filter-status="${comingSoon ? 'inactive' : filterStatus}" data-filter-type="${card.channelType}">
      <div class="ch-card-top">
        <div class="ch-card-icon" title="${comingSoon ? (lang === 'es' ? 'Próximamente' : 'Coming soon') : statusLabel}">
          ${card.icon}
          <span class="ch-icon-tooltip">${comingSoon ? (lang === 'es' ? 'Próximamente' : 'Coming soon') : statusLabel}</span>
        </div>
        <div class="ch-card-title-area">
          <div class="ch-card-name">${esc(card.name)}</div>
          <div class="ch-card-type">${esc(typeLabel)}</div>
        </div>
        ${toggleHtml}
      </div>
      <div class="ch-card-desc">${esc(card.description)}</div>
      <div class="ch-card-error"></div>
      ${(!comingSoon && card.active) ? renderMetricsForType(card.channelType, card.id, lang) : ''}
      ${footerHtml}
    </div>`
  }).join('')

  // Embed wizard data from module manifests so the client-side JS reads instructions
  // from the module, not hardcoded in the UI.
  const wizardData: Record<string, unknown> = {}
  for (const mod of (data.moduleStates ?? [])) {
    if (mod.type !== 'channel') continue
    if (mod.connectionWizard) {
      wizardData[mod.name] = {
        title: mod.connectionWizard.title,
        steps: mod.connectionWizard.steps,
        saveEndpoint: mod.connectionWizard.saveEndpoint,
        applyAfterSave: mod.connectionWizard.applyAfterSave,
        verifyEndpoint: mod.connectionWizard.verifyEndpoint,
      }
    }
  }

  return `${filterBar}<div class="ch-grid" id="ch-grid">${cardsHtml}</div>
<script type="application/json" id="channel-wizards-data">${JSON.stringify(wizardData)}</script>`
}

// ═══════════════════════════════════════════
// Tools Cards section — card grid with global params
// ═══════════════════════════════════════════
