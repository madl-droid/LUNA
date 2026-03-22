// console-minimal.js — Minimal client-side JS for SSR console
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

  // === Save bar state machine ===
  // Phase "dirty": Descartar + Guardar visible
  // Phase "saved": Aplicar cambios visible (after successful save)
  var saveBar = document.getElementById('save-bar')
  var saveForm = document.getElementById('save-form')
  var phaseDirty = saveBar ? saveBar.querySelector('[data-phase="dirty"]') : null
  var phaseSaved = saveBar ? saveBar.querySelector('[data-phase="saved"]') : null

  function setSaveBarPhase(phase) {
    if (!saveBar) return
    if (phase === 'hidden') {
      saveBar.classList.remove('visible')
    } else if (phase === 'dirty') {
      if (phaseDirty) phaseDirty.style.display = 'flex'
      if (phaseSaved) phaseSaved.style.display = 'none'
      saveBar.classList.add('visible')
    } else if (phase === 'saved') {
      if (phaseDirty) phaseDirty.style.display = 'none'
      if (phaseSaved) phaseSaved.style.display = 'flex'
      saveBar.classList.add('visible')
    }
  }

  function isDirty() {
    var inputs = document.querySelectorAll('input[data-original], select[data-original], textarea[data-original]')
    for (var i = 0; i < inputs.length; i++) {
      var el = inputs[i]
      // Skip toggles — they apply instantly
      if (el.type === 'checkbox' && el.closest('.toggle-field')) continue
      if (el.type === 'hidden' && el.closest('.toggle-field')) continue
      var current = el.value
      if (current !== el.getAttribute('data-original')) return true
    }
    return false
  }

  function checkDirty() {
    var dirty = isDirty()
    // Update modified classes on non-toggle inputs
    var inputs = document.querySelectorAll('input[data-original], select[data-original], textarea[data-original]')
    for (var i = 0; i < inputs.length; i++) {
      var el = inputs[i]
      if (el.type === 'checkbox' && el.closest('.toggle-field')) continue
      if (el.type === 'hidden' && el.closest('.toggle-field')) continue
      var current = el.value
      el.classList.toggle('modified', current !== el.getAttribute('data-original'))
    }
    setSaveBarPhase(dirty ? 'dirty' : 'hidden')
  }

  // Track non-toggle input/change
  document.addEventListener('input', function (e) {
    var el = e.target
    if (el.closest && el.closest('.toggle-field')) return // skip toggles
    if (el.hasAttribute && el.hasAttribute('data-original')) checkDirty()
  })

  document.addEventListener('change', function (e) {
    var el = e.target
    if (el.closest && el.closest('.toggle-field')) return // skip toggles
    checkDirty()
  })

  // Save via fetch (no page reload) → show "Aplicar" phase
  if (saveForm) {
    saveForm.addEventListener('submit', function (e) {
      e.preventDefault()

      // Collect all non-toggle inputs into URLSearchParams
      var body = new URLSearchParams()
      var formData = new FormData(saveForm)
      formData.forEach(function (v, k) { body.append(k, v) })

      // Also collect inputs outside the form (e.g. wa-inner)
      var allInputs = document.querySelectorAll('input[name][data-original], select[name][data-original], textarea[name][data-original]')
      for (var i = 0; i < allInputs.length; i++) {
        var inp = allInputs[i]
        if (inp.closest('.toggle-field')) continue
        if (saveForm.contains(inp)) continue
        body.append(inp.name, inp.value)
      }

      fetch('/console/save', { method: 'POST', body: body })
        .then(function (r) {
          if (r.ok || r.redirected) {
            showToast(document.documentElement.lang === 'es' ? 'Guardado' : 'Saved', 'success')
            // Update data-original so fields are no longer dirty
            allInputs.forEach(function (inp) {
              if (inp.closest('.toggle-field')) return
              inp.setAttribute('data-original', inp.value)
              inp.classList.remove('modified')
            })
            // Switch to "saved" phase → show Aplicar
            setSaveBarPhase('saved')
          } else {
            showToast('Error', 'error')
          }
        })
        .catch(function () { showToast('Error', 'error') })
    })
  }

  // === Toggle instant apply ===
  // Toggles (.toggle-field checkboxes) apply immediately via fetch, bypassing save flow
  document.addEventListener('change', function (e) {
    var el = e.target
    if (el.type !== 'checkbox' || !el.closest('.toggle-field')) return

    var toggleField = el.closest('.toggle-field')
    var hidden = toggleField.querySelector('input[type="hidden"]')
    if (!hidden || !hidden.name) return

    // If there are dirty non-toggle fields, warn
    if (isDirty()) {
      var lang = document.documentElement.lang || 'es'
      var msg = lang === 'es'
        ? 'Hay cambios sin guardar que se pueden perder. ¿Continuar?'
        : 'There are unsaved changes that may be lost. Continue?'
      if (!confirm(msg)) {
        // Revert toggle
        el.checked = !el.checked
        return
      }
    }

    // Update hidden value
    hidden.value = el.checked ? 'true' : 'false'

    // Save immediately via fetch
    var section = document.querySelector('input[name="_section"]')
    var lang2 = document.querySelector('input[name="_lang"]')
    var body = new URLSearchParams()
    body.append('_section', section ? section.value : '')
    body.append('_lang', lang2 ? lang2.value : 'es')
    body.append(hidden.name, hidden.value)

    fetch('/console/apply', { method: 'POST', body: body, headers: { 'X-Instant-Toggle': '1' } })
      .then(function (r) {
        if (r.ok || r.redirected) {
          showToast(el.checked ? 'Activado' : 'Desactivado', 'success')
          // Update data-original so it's no longer "dirty"
          hidden.setAttribute('data-original', hidden.value)
          if (el.hasAttribute('data-original')) el.setAttribute('data-original', el.checked ? 'true' : 'false')
        } else {
          showToast('Error', 'error')
          el.checked = !el.checked
          hidden.value = el.checked ? 'true' : 'false'
        }
      })
      .catch(function () {
        showToast('Error', 'error')
        el.checked = !el.checked
        hidden.value = el.checked ? 'true' : 'false'
      })
  })

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

  // === WhatsApp polling (only on /console/whatsapp) ===
  var waInner = document.getElementById('wa-inner')
  if (waInner) {
    setInterval(function () {
      fetch('/console/api/whatsapp/status')
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
    fetch('/console/api/whatsapp/connect', { method: 'POST' }).catch(function () {})
  }

  window.waDisconnect = function () {
    if (!confirm('Disconnect WhatsApp?')) return
    fetch('/console/api/whatsapp/disconnect', { method: 'POST' })
      .then(function () { showToast('Disconnected', 'success') })
      .catch(function () {})
  }

  // === Model scanner ===
  window.triggerScan = function () {
    showToast('Scanning...', 'success')
    fetch('/console/api/model-scanner/scan', { method: 'POST' })
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
          fetch('/console/api/model-scanner/models')
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
    resetForm.action = '/console/reset-db'
    resetForm.innerHTML = '<input type="hidden" name="_section" value="' + section + '"><input type="hidden" name="_lang" value="' + lang + '">'
    document.body.appendChild(resetForm)
    resetForm.submit()
  }

  // === Gmail OAuth ===
  window.gmailConnect = function () {
    fetch('/console/api/gmail/auth-url')
      .then(function (r) { return r.json() })
      .then(function (data) {
        if (data.url) {
          showToast('Opening Gmail auth...', 'success')
          var popup = window.open(data.url, 'gmail-oauth', 'width=500,height=620,scrollbars=yes')
          var poll = setInterval(function () {
            fetch('/console/api/gmail/auth-status')
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
    fetch('/console/api/gmail/auth-disconnect', { method: 'POST' })
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
    fetch('/console/api/gmail/auth-status')
      .then(function (r) { return r.json() })
      .then(function () { location.reload() })
      .catch(function () { showToast('Error', 'error') })
  }

  // === Google Apps OAuth ===
  window.googleAppsConnect = function () {
    fetch('/console/api/google-apps/auth-url')
      .then(function (r) { return r.json() })
      .then(function (data) {
        if (data.url) {
          showToast('Opening Google Apps auth...', 'success')
          var popup = window.open(data.url, 'google-apps-oauth', 'width=500,height=620,scrollbars=yes')
          var poll = setInterval(function () {
            fetch('/console/api/google-apps/status')
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
    fetch('/console/api/google-apps/disconnect', { method: 'POST' })
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
    fetch('/console/api/google-apps/status')
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

  // === Header dropdowns (notifications, lang, user menu) ===
  // Any button with data-dropdown="<id>" toggles the panel with that id
  document.addEventListener('click', function (e) {
    var trigger = e.target.closest('[data-dropdown]')
    if (trigger) {
      e.stopPropagation()
      var panelId = trigger.getAttribute('data-dropdown')
      var panel = document.getElementById(panelId)
      if (!panel) return
      var wasOpen = panel.classList.contains('open')
      // Close all dropdowns first
      document.querySelectorAll('.header-dropdown.open').forEach(function (d) { d.classList.remove('open') })
      // Toggle clicked one
      if (!wasOpen) panel.classList.add('open')
      return
    }
    // Click inside dropdown — don't close (unless it's a link)
    if (e.target.closest('.header-dropdown')) return
    // Click outside — close all
    document.querySelectorAll('.header-dropdown.open').forEach(function (d) { d.classList.remove('open') })
  })

  // Close dropdowns on Escape
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') {
      document.querySelectorAll('.header-dropdown.open').forEach(function (d) { d.classList.remove('open') })
    }
  })

  // === Notification API ===
  // Exposes window.lunaNotifications for the reflex/system to push notifications
  // Usage:
  //   lunaNotifications.add({ title: 'Error', text: 'LLM provider down', type: 'error' })
  //   lunaNotifications.add({ title: 'Info', text: 'Config applied', type: 'info' })
  //   lunaNotifications.clear()
  //
  // Types: 'error' | 'warning' | 'info' | 'success'
  // Items are stored in-memory (not persisted). Max 20 items.
  window.lunaNotifications = (function () {
    var items = []
    var MAX = 20
    var notifList = document.getElementById('notif-list')
    var notifDot = document.getElementById('notif-dot')

    function render() {
      if (!notifList) return
      if (items.length === 0) {
        notifList.innerHTML = '<div class="dropdown-empty">' + (document.documentElement.lang === 'es' ? 'Sin notificaciones nuevas' : 'No new notifications') + '</div>'
        if (notifDot) notifDot.classList.remove('active')
        return
      }
      if (notifDot) notifDot.classList.add('active')
      notifList.innerHTML = items.map(function (n) {
        var iconSvg = n.type === 'error'
          ? '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>'
          : '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>'
        return '<div class="notif-item' + (n.read ? '' : ' notif-unread') + '" data-notif-idx="' + n.idx + '">'
          + '<div class="notif-icon">' + iconSvg + '</div>'
          + '<div class="notif-content">'
          + '<div class="notif-title">' + escHtml(n.title) + '</div>'
          + (n.text ? '<div class="notif-text">' + escHtml(n.text) + '</div>' : '')
          + '<div class="notif-time">' + escHtml(n.time || '') + '</div>'
          + '</div></div>'
      }).join('')
    }

    function add(opts) {
      var now = new Date()
      items.unshift({
        title: opts.title || '',
        text: opts.text || '',
        type: opts.type || 'info',
        time: now.getHours() + ':' + String(now.getMinutes()).padStart(2, '0'),
        read: false,
        idx: Date.now()
      })
      if (items.length > MAX) items = items.slice(0, MAX)
      render()
    }

    function clear() {
      items = []
      render()
    }

    function markAllRead() {
      items.forEach(function (n) { n.read = true })
      render()
    }

    render()
    return { add: add, clear: clear, markAllRead: markAllRead, items: items }
  })()

  // Mark notifications read when opening the panel
  var notifBtn = document.getElementById('btn-notifications')
  if (notifBtn) {
    notifBtn.addEventListener('click', function () {
      setTimeout(function () { window.lunaNotifications.markAllRead() }, 300)
    })
  }

  // === Test mode toggle (in user dropdown) ===
  var testModeCb = document.getElementById('test-mode-cb')
  var resetDbMenu = document.getElementById('btn-resetdb-menu')

  if (testModeCb) {
    testModeCb.addEventListener('change', function () {
      if (testModeCb.checked) {
        var lang = document.documentElement.lang || 'es'
        var msg = lang === 'es'
          ? '¿Activar modo de pruebas? Esto habilita acciones destructivas como limpiar la base de datos.'
          : 'Enable test mode? This enables destructive actions like database reset.'
        if (!confirm(msg)) {
          testModeCb.checked = false
          return
        }
      }
      if (resetDbMenu) resetDbMenu.style.display = testModeCb.checked ? 'flex' : 'none'
    })
  }

  if (resetDbMenu) {
    resetDbMenu.addEventListener('click', function () {
      window.resetDb()
    })
  }

  // Initial state: save bar hidden
  setSaveBarPhase('hidden')
})()
