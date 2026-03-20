// handlers.js — Event handlers: onChange, save, apply, resetDb, triggerScan
// Depends on: i18n (t), state (*), utils (setStatus, showToast), render (render)

function onChange(el) {
  currentValues[el.dataset.key] = el.value
  el.classList.toggle('modified', el.value !== (originalValues[el.dataset.key] ?? ''))
  updateSaveBtn()
}

function onToggle(el) {
  currentValues[el.dataset.key] = el.checked ? 'true' : 'false'
  updateSaveBtn()
}

function onPhoneChange(key, el) {
  currentValues[key] = el.value
  el.classList.toggle('modified', el.value !== (originalValues[key] ?? ''))
  updateSaveBtn()
}

function onProviderChange(prefix, el) {
  currentValues[prefix + '_PROVIDER'] = el.value
  render()
  updateSaveBtn()
}

function updateSaveBtn() {
  const has = Object.keys(currentValues).some(k => currentValues[k] !== (originalValues[k] ?? ''))
  document.getElementById('btn-save').disabled = !has
  document.getElementById('btn-apply').disabled = !_pendingApply
}

function resetChanges() {
  currentValues = { ...originalValues }
  render()
  updateSaveBtn()
  setStatus(t('discarded'), '')
}

async function saveChanges() {
  const changes = {}
  for (const [k, v] of Object.entries(currentValues)) {
    if (v !== (originalValues[k] ?? '')) changes[k] = v
  }
  if (!Object.keys(changes).length) return
  try {
    setStatus(t('saving'), '')
    const res = await fetch('/oficina/api/oficina/config', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(changes) })
    const data = await res.json()
    if (data.ok) {
      originalValues = { ...currentValues }; _pendingApply = true; render(); updateSaveBtn()
      setStatus(t('saved'), 'saved'); showToast(t('configSaved'), 'success')
    } else { setStatus(t('errorSave'), 'error') }
  } catch { setStatus(t('errorConnect'), 'error') }
}

async function applyChanges() {
  if (!confirm(t('applyConfirm'))) return
  try {
    const res = await fetch('/oficina/api/oficina/apply', { method: 'POST' })
    const data = await res.json()
    if (data.ok) {
      _pendingApply = false; updateSaveBtn()
      showToast(t('applySuccess'), 'success')
    } else { showToast(t('applyError'), 'error') }
  } catch { showToast(t('applyError'), 'error') }
}

async function resetDb() {
  if (!confirm(t('resetDbConfirm'))) return
  try {
    const res = await fetch('/oficina/api/oficina/reset-db', { method: 'POST' })
    const data = await res.json()
    if (data.ok) {
      showToast(t('resetDbSuccess'), 'success')
    } else { showToast(t('resetDbError'), 'error') }
  } catch { showToast(t('resetDbError'), 'error') }
}

async function triggerScan() {
  showToast(t('scanScanning'), 'success')
  try {
    const res = await fetch('/oficina/api/model-scanner/scan', { method: 'POST' })
    const data = await res.json()
    if (data.ok) {
      if (data.errors && data.errors.length > 0) {
        showToast(data.errors.map(e => e.provider + ': ' + e.message).join('\n'), 'error')
      } else {
        showToast(t('scanSuccess'), 'success')
      }
      // Refresh models and scan data
      const modelsRes = await fetch('/oficina/api/model-scanner/models')
      const modelsData = await modelsRes.json()
      allModels = modelsData.models || { anthropic: [], gemini: [] }
      lastScan = modelsData.scan || null
      // Show replacements if any
      if (data.replacements && data.replacements.length > 0) {
        const repDiv = document.getElementById('scan-replacements')
        if (repDiv) {
          repDiv.innerHTML = data.replacements.map(r =>
            `<div style="font-size:13px;color:var(--warning);padding:6px 10px;background:rgba(255,149,0,0.08);border-radius:6px;margin-bottom:4px">
              ${r.configKey}: <s>${r.oldModel}</s> ${t('scanReplaced')} <b>${r.newModel}</b>
            </div>`
          ).join('')
        }
      }
      render()
    } else { showToast(t('scanError'), 'error') }
  } catch { showToast(t('scanError'), 'error') }
}

async function refreshGoogleStatus() {
  try {
    const res = await fetch('/oficina/api/gmail/auth-status')
    const data = await res.json()
    googleAuthState = { connected: data.connected ?? false, email: data.email ?? null, loading: false }
  } catch {
    googleAuthState = { connected: false, email: null, loading: false }
  }
  if (activeSection === 'google') renderContent()
}

async function googleConnect() {
  try {
    googleAuthState.loading = true
    renderContent()
    const res = await fetch('/oficina/api/gmail/auth-url')
    const data = await res.json()
    if (data.url) {
      showToast(t('googleConnecting'), 'success')
      const popup = window.open(data.url, 'google-oauth', 'width=500,height=620,scrollbars=yes')
      // Poll for completion (popup closes or token appears)
      const poll = setInterval(async () => {
        try {
          const statusRes = await fetch('/oficina/api/gmail/auth-status')
          const statusData = await statusRes.json()
          if (statusData.connected) {
            clearInterval(poll)
            if (popup && !popup.closed) popup.close()
            googleAuthState = { connected: true, email: statusData.email ?? null, loading: false }
            showToast(t('googleConnectSuccess'), 'success')
            renderContent()
          } else if (popup && popup.closed) {
            clearInterval(poll)
            googleAuthState.loading = false
            renderContent()
          }
        } catch { clearInterval(poll) }
      }, 2000)
    } else {
      showToast(data.error || t('googleConnectError'), 'error')
      googleAuthState.loading = false
      renderContent()
    }
  } catch {
    showToast(t('googleConnectError'), 'error')
    googleAuthState.loading = false
    renderContent()
  }
}

async function googleDisconnect() {
  if (!confirm(t('googleDisconnectConfirm'))) return
  try {
    const res = await fetch('/oficina/api/gmail/auth-disconnect', { method: 'POST' })
    const data = await res.json()
    if (data.ok) {
      googleAuthState = { connected: false, email: null, loading: false }
      showToast(t('googleDisconnectSuccess'), 'success')
      renderContent()
    } else {
      showToast(data.error || t('googleDisconnectError'), 'error')
    }
  } catch {
    showToast(t('googleDisconnectError'), 'error')
  }
}
