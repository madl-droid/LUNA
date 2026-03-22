// oficina-minimal.js — Minimal client-side JS for SSR oficina
// Only handles: WA polling, panel collapse, info tooltips, toast dismiss,
// dirty tracking, model dropdown switch, model scanner, reset DB, Google OAuth

(function () {
  'use strict'

  // === Toast auto-dismiss ===
  var flash = document.querySelector('[data-flash]')
  if (flash) setTimeout(function () { flash.remove() }, 3500)

  // === Hamburger menu (mobile drawer) ===
  var sidebar = document.getElementById('sidebar')
  var hamburger = document.getElementById('hamburger')
  var overlay = document.createElement('div')
  overlay.className = 'sidebar-overlay'
  document.body.appendChild(overlay)

  window.toggleSidebar = function () {
    if (!sidebar || !hamburger) return
    var isOpen = sidebar.classList.toggle('open')
    hamburger.classList.toggle('open', isOpen)
    overlay.classList.toggle('visible', isOpen)
  }

  overlay.addEventListener('click', function () {
    if (sidebar) sidebar.classList.remove('open')
    if (hamburger) hamburger.classList.remove('open')
    overlay.classList.remove('visible')
  })

  // Close sidebar on link click (mobile)
  if (sidebar) {
    sidebar.querySelectorAll('.sidebar-item').forEach(function (item) {
      item.addEventListener('click', function () {
        sidebar.classList.remove('open')
        if (hamburger) hamburger.classList.remove('open')
        overlay.classList.remove('visible')
      })
    })
  }

  // === Panel collapse ===
  window.togglePanel = function (header) {
    header.closest('.panel').classList.toggle('collapsed')
  }

  // === Info tooltips ===
  window.toggleInfo = function (id) {
    var el = document.getElementById(id)
    if (el) el.classList.toggle('visible')
  }

  // === Dirty tracking (Save/Apply enable) ===
  var saveBtn = document.getElementById('btn-save')
  var applyBtn = document.getElementById('btn-apply')
  var form = document.getElementById('save-form')

  function checkDirty() {
    if (!form) return
    var dirty = false
    var inputs = form.querySelectorAll('input[data-original], select[data-original], textarea[data-original]')
    for (var i = 0; i < inputs.length; i++) {
      var el = inputs[i]
      var current = el.type === 'checkbox' ? (el.checked ? 'true' : 'false') : el.value
      if (current !== el.getAttribute('data-original')) {
        dirty = true
        el.classList.add('modified')
      } else {
        el.classList.remove('modified')
      }
    }
    if (saveBtn) saveBtn.disabled = !dirty
    if (applyBtn) applyBtn.disabled = !dirty
  }

  // Also track inputs outside the save-form (e.g. in wa-inner)
  document.addEventListener('input', function (e) {
    var el = e.target
    if (el.hasAttribute && el.hasAttribute('data-original')) {
      var current = el.type === 'checkbox' ? (el.checked ? 'true' : 'false') : el.value
      el.classList.toggle('modified', current !== el.getAttribute('data-original'))
    }
    checkDirty()
  })
  document.addEventListener('change', function (e) {
    var el = e.target
    // Handle toggle checkboxes: update hidden sibling
    if (el.type === 'checkbox' && el.closest('.toggle-field')) {
      var hidden = el.closest('.toggle-field').querySelector('input[type="hidden"]')
      if (hidden) hidden.value = el.checked ? 'true' : 'false'
    }
    checkDirty()
  })

  // Before form submit, sync checkbox values to hidden fields
  if (form) {
    form.addEventListener('submit', function () {
      var toggles = form.querySelectorAll('.toggle-field')
      for (var i = 0; i < toggles.length; i++) {
        var cb = toggles[i].querySelector('input[type="checkbox"]')
        var hidden = toggles[i].querySelector('input[type="hidden"]')
        if (cb && hidden) hidden.value = cb.checked ? 'true' : 'false'
      }
      // Also collect inputs from #wa-inner (phone fields) and add to form
      var waInner = document.getElementById('wa-inner')
      if (waInner) {
        var waInputs = waInner.querySelectorAll('input[name]')
        for (var j = 0; j < waInputs.length; j++) {
          var inp = waInputs[j]
          if (!form.querySelector('input[name="' + inp.name + '"]')) {
            var clone = document.createElement('input')
            clone.type = 'hidden'
            clone.name = inp.name
            clone.value = inp.value
            form.appendChild(clone)
          }
        }
      }
    })
  }

  // === Model dropdown provider switch ===
  var modelsDataEl = document.getElementById('models-data')
  var modelsData = modelsDataEl ? JSON.parse(modelsDataEl.textContent || '{}') : {}

  var MODEL_NAMES = {
    'claude-haiku-4-5-20251001': 'Haiku 4.5',
    'claude-sonnet-4-5-20250929': 'Sonnet 4.5',
    'claude-sonnet-4-6': 'Sonnet 4.6',
    'claude-opus-4-5-20251101': 'Opus 4.5',
    'claude-opus-4-6': 'Opus 4.6',
    'claude-sonnet-4-20250514': 'Sonnet 4',
    'claude-opus-4-20250514': 'Opus 4',
    'claude-opus-4-1-20250805': 'Opus 4.1',
    'gemini-2.5-flash': 'Flash 2.5',
    'gemini-2.5-pro': 'Pro 2.5',
    'gemini-2.0-flash': 'Flash 2.0',
    'gemini-1.5-pro': 'Pro 1.5',
    'gemini-1.5-flash': 'Flash 1.5',
  }

  document.addEventListener('change', function (e) {
    var el = e.target
    var prefix = el.getAttribute('data-model-provider')
    if (!prefix) return
    var provider = el.value
    var modelKey = provider === 'google' ? 'gemini' : provider
    var models = modelsData[modelKey] || []
    var modelSelect = document.querySelector('[data-model-select="' + prefix + '"]')
    if (!modelSelect) return
    modelSelect.innerHTML = models.map(function (m) {
      return '<option value="' + m + '">' + (MODEL_NAMES[m] || m) + '</option>'
    }).join('')
    checkDirty()
  })

  // === WhatsApp polling (only on /oficina/whatsapp) ===
  var waInner = document.getElementById('wa-inner')
  if (waInner) {
    setInterval(function () {
      fetch('/oficina/api/whatsapp/status')
        .then(function (r) { return r.ok ? r.json() : null })
        .then(function (data) {
          if (!data) return
          // Update status badge
          var badge = waInner.querySelector('.wa-badge')
          if (badge) {
            badge.className = 'wa-badge ' + data.status
          }
          // Update QR
          var qrBox = waInner.querySelector('.wa-qr-box')
          if (qrBox) {
            var showQr = data.status === 'qr_ready' && data.qrDataUrl
            qrBox.className = 'wa-qr-box' + (showQr ? '' : ' wa-qr-hidden')
            var img = qrBox.querySelector('img')
            if (showQr && data.qrDataUrl) {
              if (img) { img.src = data.qrDataUrl }
              else { qrBox.insertAdjacentHTML('afterbegin', '<img src="' + data.qrDataUrl + '" alt="QR" />') }
            }
          }
          // Update button states
          var moduleEnabled = data.moduleEnabled !== false
          var connectBtn = waInner.querySelector('.wa-btn-connect')
          var disconnectBtn = waInner.querySelector('.wa-btn-disconnect')
          if (connectBtn) connectBtn.disabled = !(moduleEnabled && (data.status === 'disconnected' || data.status === 'not_initialized'))
          if (disconnectBtn) disconnectBtn.disabled = !(data.status === 'connected' || data.status === 'qr_ready' || data.status === 'connecting')
        })
        .catch(function () {})
    }, 3000)
  }

  window.waConnect = function () {
    showToast('Connecting...', 'success')
    fetch('/oficina/api/whatsapp/connect', { method: 'POST' }).catch(function () {})
  }

  window.waDisconnect = function () {
    if (!confirm('Disconnect WhatsApp?')) return
    fetch('/oficina/api/whatsapp/disconnect', { method: 'POST' })
      .then(function () { showToast('Disconnected', 'success') })
      .catch(function () {})
  }

  // === Model scanner ===
  window.triggerScan = function () {
    showToast('Scanning...', 'success')
    fetch('/oficina/api/model-scanner/scan', { method: 'POST' })
      .then(function (r) { return r.json() })
      .then(function (data) {
        if (data.ok) {
          showToast('Scan complete', 'success')
          var repDiv = document.getElementById('scan-replacements')
          if (repDiv && data.replacements && data.replacements.length > 0) {
            repDiv.innerHTML = data.replacements.map(function (r) {
              return '<div class="scan-replacement">' +
                r.configKey + ': <s>' + r.oldModel + '</s> → <b>' + r.newModel + '</b></div>'
            }).join('')
          }
          // Refresh models data for dropdowns
          fetch('/oficina/api/model-scanner/models')
            .then(function (r) { return r.json() })
            .then(function (d) { if (d.models) modelsData = d.models })
            .catch(function () {})
        } else {
          showToast('Scan failed', 'error')
        }
      })
      .catch(function () { showToast('Scan failed', 'error') })
  }

  // === Reset DB ===
  window.resetDb = function () {
    if (!confirm('WARNING: This will delete ALL messages and sessions. Continue?')) return
    var section = form ? (form.querySelector('[name="_section"]') || {}).value || 'whatsapp' : 'whatsapp'
    var lang = form ? (form.querySelector('[name="_lang"]') || {}).value || 'es' : 'es'
    // Submit as form POST
    var resetForm = document.createElement('form')
    resetForm.method = 'POST'
    resetForm.action = '/oficina/reset-db'
    resetForm.innerHTML = '<input type="hidden" name="_section" value="' + section + '"><input type="hidden" name="_lang" value="' + lang + '">'
    document.body.appendChild(resetForm)
    resetForm.submit()
  }

  // === Gmail OAuth ===
  window.gmailConnect = function () {
    fetch('/oficina/api/gmail/auth-url')
      .then(function (r) { return r.json() })
      .then(function (data) {
        if (data.url) {
          showToast('Opening Gmail auth...', 'success')
          var popup = window.open(data.url, 'gmail-oauth', 'width=500,height=620,scrollbars=yes')
          var poll = setInterval(function () {
            fetch('/oficina/api/gmail/auth-status')
              .then(function (r) { return r.json() })
              .then(function (s) {
                if (s.connected) {
                  clearInterval(poll)
                  if (popup && !popup.closed) popup.close()
                  showToast('Gmail connected', 'success')
                  location.reload()
                } else if (popup && popup.closed) {
                  clearInterval(poll)
                }
              })
              .catch(function () { clearInterval(poll) })
          }, 2000)
        } else {
          showToast(data.error || 'Error', 'error')
        }
      })
      .catch(function () { showToast('Error connecting Gmail', 'error') })
  }

  window.gmailDisconnect = function () {
    if (!confirm('Disconnect Gmail?')) return
    fetch('/oficina/api/gmail/auth-disconnect', { method: 'POST' })
      .then(function (r) { return r.json() })
      .then(function (data) {
        if (data.ok) {
          showToast('Gmail disconnected', 'success')
          location.reload()
        } else {
          showToast(data.error || 'Error', 'error')
        }
      })
      .catch(function () { showToast('Error disconnecting Gmail', 'error') })
  }

  window.refreshGmailStatus = function () {
    fetch('/oficina/api/gmail/auth-status')
      .then(function (r) { return r.json() })
      .then(function () { location.reload() })
      .catch(function () { showToast('Error', 'error') })
  }

  // === Google Apps OAuth ===
  window.googleAppsConnect = function () {
    fetch('/oficina/api/google-apps/auth-url')
      .then(function (r) { return r.json() })
      .then(function (data) {
        if (data.url) {
          showToast('Opening Google Apps auth...', 'success')
          var popup = window.open(data.url, 'google-apps-oauth', 'width=500,height=620,scrollbars=yes')
          var poll = setInterval(function () {
            fetch('/oficina/api/google-apps/status')
              .then(function (r) { return r.json() })
              .then(function (s) {
                if (s.status === 'connected' || s.status === 'active') {
                  clearInterval(poll)
                  if (popup && !popup.closed) popup.close()
                  showToast('Google Apps connected', 'success')
                  location.reload()
                } else if (popup && popup.closed) {
                  clearInterval(poll)
                }
              })
              .catch(function () { clearInterval(poll) })
          }, 2000)
        } else {
          showToast(data.error || 'Error', 'error')
        }
      })
      .catch(function () { showToast('Error connecting Google Apps', 'error') })
  }

  window.googleAppsDisconnect = function () {
    if (!confirm('Disconnect Google Apps?')) return
    fetch('/oficina/api/google-apps/disconnect', { method: 'POST' })
      .then(function (r) { return r.json() })
      .then(function (data) {
        if (data.ok) {
          showToast('Google Apps disconnected', 'success')
          location.reload()
        } else {
          showToast(data.error || 'Error', 'error')
        }
      })
      .catch(function () { showToast('Error disconnecting Google Apps', 'error') })
  }

  window.refreshGoogleAppsStatus = function () {
    fetch('/oficina/api/google-apps/status')
      .then(function (r) { return r.json() })
      .then(function () { location.reload() })
      .catch(function () { showToast('Error', 'error') })
  }

  // === Toast helper ===
  function showToast(msg, type) {
    var old = document.querySelector('.toast')
    if (old) old.remove()
    var el = document.createElement('div')
    el.className = 'toast ' + (type || 'success')
    el.textContent = msg
    document.body.appendChild(el)
    setTimeout(function () { el.remove() }, 3500)
  }

  // === Tags field interactivity ===
  document.querySelectorAll('[data-tag-add]').forEach(function (input) {
    var key = input.getAttribute('data-tag-add')
    var hidden = document.querySelector('input[type="hidden"][name="' + key + '"]')
    if (!hidden) return
    var sep = hidden.getAttribute('data-separator') || ','

    input.addEventListener('keydown', function (e) {
      if (e.key !== 'Enter') return
      e.preventDefault()
      var val = input.value.trim()
      if (!val) return
      var current = hidden.value ? hidden.value.split(sep).map(function (s) { return s.trim() }).filter(Boolean) : []
      if (current.indexOf(val) !== -1) { input.value = ''; return }
      current.push(val)
      hidden.value = current.join(sep + ' ')
      input.value = ''
      rebuildTags(key, hidden, sep)
      checkDirty()
    })
  })

  document.addEventListener('click', function (e) {
    var btn = e.target.closest('[data-tag-key]')
    if (!btn) return
    var key = btn.getAttribute('data-tag-key')
    var tagVal = btn.getAttribute('data-tag-value')
    var hidden = document.querySelector('input[type="hidden"][name="' + key + '"]')
    if (!hidden) return
    var sep = hidden.getAttribute('data-separator') || ','
    var current = hidden.value.split(sep).map(function (s) { return s.trim() }).filter(Boolean)
    current = current.filter(function (t) { return t !== tagVal })
    hidden.value = current.join(sep + ' ')
    rebuildTags(key, hidden, sep)
    checkDirty()
  })

  function rebuildTags(key, hidden, sep) {
    var container = document.querySelector('[data-tags-for="' + key + '"]')
    if (!container) return
    var tags = hidden.value ? hidden.value.split(sep).map(function (s) { return s.trim() }).filter(Boolean) : []
    container.innerHTML = tags.map(function (tag) {
      return '<span class="field-tag">' + escHtml(tag)
        + '<button type="button" class="field-tag-remove" data-tag-key="' + escHtml(key)
        + '" data-tag-value="' + escHtml(tag) + '">&times;</button></span>'
    }).join('')
  }

  function escHtml(s) {
    return String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;')
  }

  // Initial dirty check
  checkDirty()
})()
