// whatsapp.js — WhatsApp polling, connect, disconnect, render
// Depends on: i18n (t), state (waState, waPolling, currentValues, originalValues), utils (esc, showToast)

async function pollWa() {
  try {
    const res = await fetch('/oficina/api/whatsapp/status')
    if (!res.ok) { waState = { status: 'not_initialized', qrDataUrl: null, lastDisconnectReason: null, moduleEnabled: false }; return }
    const ns = await res.json()
    const changed = ns.status !== waState.status || ns.qrDataUrl !== waState.qrDataUrl
    waState = ns
    if (changed) renderWa()
  } catch {}
}

function startWaPolling() { waPolling = setInterval(pollWa, 3000) }

async function waConnect() {
  showToast(t('connectingWa'), 'success')
  await fetch('/oficina/api/whatsapp/connect', { method: 'POST' })
  setTimeout(pollWa, 500); setTimeout(pollWa, 2000); setTimeout(pollWa, 4000)
}

async function waDisconnect() {
  if (!confirm(t('disconnectConfirm'))) return
  await fetch('/oficina/api/whatsapp/disconnect', { method: 'POST' })
  await pollWa()
  showToast('WhatsApp disconnected', 'success')
}

function renderWa() {
  const inner = document.getElementById('wa-inner')
  if (!inner) return
  const s = waState
  const showQr = s.status === 'qr_ready' && s.qrDataUrl
  const moduleEnabled = s.moduleEnabled !== false
  const canConnect = moduleEnabled && (s.status === 'disconnected' || s.status === 'not_initialized')
  const canDisconnect = s.status === 'connected' || s.status === 'qr_ready' || s.status === 'connecting'

  const waPhone = currentValues['WHATSAPP_PHONE_NUMBER'] ?? ''
  const twilioPhone = currentValues['TWILIO_PHONE_NUMBER'] ?? ''

  inner.innerHTML = `
    <div class="wa-status-row">
      <span class="wa-badge ${s.status}"><span class="wa-dot"></span>${t('waStatus')[s.status] || s.status}</span>
      ${s.lastDisconnectReason ? `<span class="wa-reason">${t('reason')}: ${s.lastDisconnectReason}</span>` : ''}
    </div>
    <div class="wa-actions">
      <button class="wa-btn wa-btn-connect" onclick="waConnect()" ${canConnect ? '' : 'disabled'} ${!moduleEnabled ? 'title="' + t('waModuleDisabled') + '"' : ''}>${t('connectBtn')}</button>
      <button class="wa-btn wa-btn-disconnect" onclick="waDisconnect()" ${canDisconnect ? '' : 'disabled'}>${t('disconnectBtn')}</button>
    </div>
    <div class="wa-qr-box ${showQr ? '' : 'wa-qr-hidden'}">
      ${showQr ? `<img src="${s.qrDataUrl}" alt="QR" />` : ''}
      <div class="wa-qr-label">${t('scanLabel')}</div>
    </div>
    <div class="wa-phones">
      <div><label>${t('f_WHATSAPP_PHONE')}</label>
        <input type="text" value="${esc(waPhone)}" oninput="onPhoneChange('WHATSAPP_PHONE_NUMBER',this)" class="${waPhone !== (originalValues['WHATSAPP_PHONE_NUMBER'] ?? '') ? 'modified' : ''}"></div>
      <div><label>${t('f_TWILIO_PHONE')}</label>
        <input type="text" value="${esc(twilioPhone)}" oninput="onPhoneChange('TWILIO_PHONE_NUMBER',this)" class="${twilioPhone !== (originalValues['TWILIO_PHONE_NUMBER'] ?? '') ? 'modified' : ''}"></div>
    </div>`
}
