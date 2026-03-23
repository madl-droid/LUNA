// console-minimal.js — Minimal client-side JS for SSR console
// Only handles: WA polling, panel collapse, info tooltips, toast dismiss,
// dirty tracking, model dropdown switch, model scanner, reset DB, Google OAuth

(function () {
  'use strict'

  // === Toast auto-dismiss ===
  var flash = document.querySelector('[data-flash]')
  if (flash) setTimeout(function () { flash.remove() }, 3500)

  // === Mobile search overlay ===
  window.openMobileSearch = function () {
    var overlay = document.getElementById('search-overlay')
    if (overlay) {
      overlay.classList.add('visible')
      var input = document.getElementById('mobile-search-input')
      if (input) input.focus()
    }
  }
  window.closeMobileSearch = function () {
    var overlay = document.getElementById('search-overlay')
    if (overlay) overlay.classList.remove('visible')
  }

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
    // Scroll sidebar to top when opening
    if (isOpen) sidebar.scrollTop = 0
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

  // === Google OAuth Wizard ===
  // 4-step wizard: account type → project setup → credentials creation → credential input

  var COPY_ICON = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg>'
  var CHECK_ICON = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>'

  var WIZARD_CONFIGS = {
    gmail: {
      statusUrl: '/console/api/gmail/auth-status',
      authUrl: '/console/api/gmail/auth-url',
      setupUrl: '/console/api/gmail/setup-credentials',
      pollStatusUrl: '/console/api/gmail/auth-status',
      pollKey: 'connected',
      label: 'Gmail',
      apis: 'Gmail API',
      scopes: 'Gmail (lectura, envio, modificacion)'
    },
    'google-apps': {
      statusUrl: '/console/api/google-apps/auth-status',
      authUrl: '/console/api/google-apps/auth-url',
      setupUrl: '/console/api/google-apps/setup-credentials',
      pollStatusUrl: '/console/api/google-apps/status',
      pollKey: 'status',
      pollValue: 'connected',
      label: 'Google Apps',
      apis: 'Google Drive API, Google Sheets API, Google Docs API, Google Slides API, Google Calendar API, Gmail API',
      scopes: 'Drive, Sheets, Docs, Slides, Calendar, Gmail'
    }
  }

  // Wizard state
  var _wizardModuleKey = ''
  var _wizardAccountType = '' // 'workspace' or 'personal'

  function openOAuthWizard(moduleKey) {
    var cfg = WIZARD_CONFIGS[moduleKey]
    if (!cfg) return
    fetch(cfg.statusUrl)
      .then(function (r) { return r.json() })
      .then(function (data) {
        if (data.hasCredentials) {
          startOAuthFlow(moduleKey, cfg)
        } else {
          showWizardModal(moduleKey, cfg, data.redirectUri || '')
        }
      })
      .catch(function () { showToast('Error checking auth status', 'error') })
  }

  function showWizardModal(moduleKey, cfg, redirectUri) {
    var lang = document.documentElement.lang || 'es'
    var isEs = lang === 'es'
    var uri = redirectUri || (location.origin + '/console/api/' + moduleKey + '/oauth2callback')
    _wizardModuleKey = moduleKey

    var existing = document.getElementById('oauth-wizard-modal')
    if (existing) existing.remove()

    var modal = document.createElement('div')
    modal.id = 'oauth-wizard-modal'
    modal.className = 'wizard-overlay'
    modal.innerHTML = '<div class="wizard-modal">'
      + '<button class="wizard-close" onclick="closeWizard()">&times;</button>'
      + '<div class="wizard-steps">'
      // Step indicator (4 steps)
      + '<div class="wizard-step-indicator">'
      + '<span class="wizard-dot active" data-step="1">1</span><span class="wizard-dot-line"></span>'
      + '<span class="wizard-dot" data-step="2">2</span><span class="wizard-dot-line"></span>'
      + '<span class="wizard-dot" data-step="3">3</span><span class="wizard-dot-line"></span>'
      + '<span class="wizard-dot" data-step="4">4</span>'
      + '</div>'

      // ── Step 1: Account type ──
      + '<div class="wizard-page active" data-wizard-page="1">'
      + '<h3>' + (isEs ? 'Tipo de cuenta Google' : 'Google Account Type') + '</h3>'
      + '<p class="wizard-text">' + (isEs
        ? 'Las instrucciones de configuracion dependen del tipo de cuenta que usaras:'
        : 'Setup instructions depend on which type of account you will use:') + '</p>'
      + '<div class="wizard-choice-group">'
      + '<button class="wizard-choice" onclick="wizardSetAccountType(\'workspace\')">'
      + '<div class="wizard-choice-icon"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="2" y="3" width="20" height="18" rx="2"/><path d="M8 7h8M8 11h8M8 15h4"/></svg></div>'
      + '<div class="wizard-choice-label">' + (isEs ? 'Google Workspace' : 'Google Workspace') + '</div>'
      + '<div class="wizard-choice-desc">' + (isEs
        ? 'Dominio corporativo (tu@empresa.com). No requiere usuarios de prueba.'
        : 'Corporate domain (you@company.com). No test users needed.') + '</div>'
      + '</button>'
      + '<button class="wizard-choice" onclick="wizardSetAccountType(\'personal\')">'
      + '<div class="wizard-choice-icon"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="12" cy="8" r="4"/><path d="M20 21a8 8 0 00-16 0"/></svg></div>'
      + '<div class="wizard-choice-label">' + (isEs ? 'Cuenta personal' : 'Personal account') + '</div>'
      + '<div class="wizard-choice-desc">' + (isEs
        ? 'Gmail personal (@gmail.com). Requiere registrar usuarios de prueba.'
        : 'Personal Gmail (@gmail.com). Requires adding test users.') + '</div>'
      + '</button>'
      + '</div>'
      + '</div>'

      // ── Step 2: Project setup + APIs ──
      + '<div class="wizard-page" data-wizard-page="2">'
      + '<h3>' + (isEs ? 'Crear proyecto y habilitar APIs' : 'Create Project & Enable APIs') + '</h3>'
      + '<div class="wizard-instructions">'
      + '<ol>'
      + '<li>' + (isEs
        ? 'Abre <a href="https://console.cloud.google.com" target="_blank" rel="noopener"><strong>Google Cloud Console</strong></a>'
        : 'Open <a href="https://console.cloud.google.com" target="_blank" rel="noopener"><strong>Google Cloud Console</strong></a>') + '</li>'
      + '<li>' + (isEs ? 'Crea un nuevo proyecto o usa uno existente' : 'Create a new project or use an existing one') + '</li>'
      + '<li>' + (isEs
        ? 'En el menu lateral: <strong>APIs y servicios</strong> &gt; <strong>Biblioteca</strong>'
        : 'In the sidebar: <strong>APIs & Services</strong> &gt; <strong>Library</strong>') + '</li>'
      + '<li>' + (isEs
        ? 'Busca y habilita: <strong>' + cfg.apis + '</strong>'
        : 'Search and enable: <strong>' + cfg.apis + '</strong>') + '</li>'
      + '<li>' + (isEs
        ? 'Ve a <strong>APIs y servicios</strong> &gt; <strong>Pantalla de consentimiento OAuth</strong>'
        : 'Go to <strong>APIs & Services</strong> &gt; <strong>OAuth consent screen</strong>') + '</li>'
      // Account-type-specific instructions
      + '<li data-account-workspace>' + (isEs
        ? 'Tipo de usuario: <strong>Interno</strong> (disponible en Workspace). Completa los campos obligatorios.'
        : 'User type: <strong>Internal</strong> (available on Workspace). Fill required fields.') + '</li>'
      + '<li data-account-personal>' + (isEs
        ? 'Tipo de usuario: <strong>Externo</strong>. Completa los campos obligatorios.'
        : 'User type: <strong>External</strong>. Fill required fields.') + '</li>'
      + '<li>' + (isEs
        ? 'Agrega los scopes: <strong>' + cfg.scopes + '</strong>'
        : 'Add scopes: <strong>' + cfg.scopes + '</strong>') + '</li>'
      + '<li data-account-personal>' + (isEs
        ? 'En <strong>Usuarios de prueba</strong>, agrega tu email de Google'
        : 'Under <strong>Test users</strong>, add your Google email') + '</li>'
      + '</ol>'
      + '</div>'
      + '<div class="wizard-actions">'
      + '<button class="wizard-btn wizard-btn-secondary" onclick="wizardGoTo(1)">' + (isEs ? 'Atras' : 'Back') + '</button>'
      + '<button class="wizard-btn wizard-btn-primary" onclick="wizardGoTo(3)">' + (isEs ? 'Continuar' : 'Continue') + '</button>'
      + '</div>'
      + '</div>'

      // ── Step 3: Create credentials ──
      + '<div class="wizard-page" data-wizard-page="3">'
      + '<h3>' + (isEs ? 'Crear credenciales OAuth' : 'Create OAuth Credentials') + '</h3>'
      + '<div class="wizard-instructions">'
      + '<ol>'
      + '<li>' + (isEs
        ? 'En <a href="https://console.cloud.google.com/apis/credentials" target="_blank" rel="noopener"><strong>Credenciales</strong></a>, haz clic en <strong>Crear credenciales</strong> &gt; <strong>ID de cliente OAuth</strong>'
        : 'In <a href="https://console.cloud.google.com/apis/credentials" target="_blank" rel="noopener"><strong>Credentials</strong></a>, click <strong>Create credentials</strong> &gt; <strong>OAuth client ID</strong>') + '</li>'
      + '<li>' + (isEs
        ? 'Tipo de aplicacion: <strong>Aplicacion web</strong>'
        : 'Application type: <strong>Web application</strong>') + '</li>'
      + '<li>' + (isEs
        ? 'En <strong>URIs de redireccionamiento autorizados</strong>, agrega:'
        : 'Under <strong>Authorized redirect URIs</strong>, add:')
      + '<div class="wizard-uri-box">'
      + '<code class="wizard-uri">' + escHtml(uri) + '</code>'
      + '<button type="button" class="wizard-copy-icon" onclick="copyWizardUri(this)" title="' + (isEs ? 'Copiar' : 'Copy') + '">' + COPY_ICON + '</button>'
      + '</div></li>'
      + '<li>' + (isEs
        ? 'Haz clic en <strong>Crear</strong>. Copia el <strong>Client ID</strong> y <strong>Client Secret</strong> que aparecen &mdash; los necesitaras en el siguiente paso.'
        : 'Click <strong>Create</strong>. Copy the <strong>Client ID</strong> and <strong>Client Secret</strong> shown &mdash; you will need them in the next step.') + '</li>'
      + '</ol>'
      + '</div>'
      + '<div class="wizard-actions">'
      + '<button class="wizard-btn wizard-btn-secondary" onclick="wizardGoTo(2)">' + (isEs ? 'Atras' : 'Back') + '</button>'
      + '<button class="wizard-btn wizard-btn-primary" onclick="wizardGoTo(4)">' + (isEs ? 'Continuar' : 'Continue') + '</button>'
      + '</div>'
      + '</div>'

      // ── Step 4: Credential input ──
      + '<div class="wizard-page" data-wizard-page="4">'
      + '<h3>' + (isEs ? 'Ingresar credenciales' : 'Enter Credentials') + '</h3>'
      + '<div class="wizard-form">'
      + '<label class="wizard-label">Client ID</label>'
      + '<input type="text" id="wizard-client-id" class="wizard-input" placeholder="xxxxxxxxx.apps.googleusercontent.com" autocomplete="off" spellcheck="false" />'
      + '<label class="wizard-label">Client Secret</label>'
      + '<input type="password" id="wizard-client-secret" class="wizard-input" placeholder="GOCSPX-xxxxxxxxxx" autocomplete="off" />'
      + '<p class="wizard-hint">' + (isEs
        ? 'Estos valores se guardan encriptados en la base de datos.'
        : 'These values are stored encrypted in the database.') + '</p>'
      + '<div id="wizard-error" class="wizard-error" style="display:none"></div>'
      + '</div>'
      + '<div class="wizard-actions">'
      + '<button class="wizard-btn wizard-btn-secondary" onclick="wizardGoTo(3)">' + (isEs ? 'Atras' : 'Back') + '</button>'
      + '<button class="wizard-btn wizard-btn-primary" id="wizard-submit" onclick="wizardSubmit(\'' + moduleKey + '\')">' + (isEs ? 'Conectar' : 'Connect') + '</button>'
      + '</div>'
      + '</div>'

      + '</div></div>'
    document.body.appendChild(modal)
    modal.addEventListener('click', function (e) { if (e.target === modal) closeWizard() })
  }

  window.closeWizard = function () {
    var m = document.getElementById('oauth-wizard-modal')
    if (m) m.remove()
    _wizardModuleKey = ''
    _wizardAccountType = ''
  }

  window.wizardSetAccountType = function (type) {
    _wizardAccountType = type
    // Show/hide account-specific instructions
    document.querySelectorAll('[data-account-workspace]').forEach(function (el) {
      el.style.display = type === 'workspace' ? '' : 'none'
    })
    document.querySelectorAll('[data-account-personal]').forEach(function (el) {
      el.style.display = type === 'personal' ? '' : 'none'
    })
    wizardGoTo(2)
  }

  window.wizardGoTo = function (step) {
    var pages = document.querySelectorAll('[data-wizard-page]')
    var dots = document.querySelectorAll('.wizard-dot[data-step]')
    pages.forEach(function (p) { p.classList.remove('active') })
    dots.forEach(function (d) {
      var s = parseInt(d.getAttribute('data-step'), 10)
      d.classList.toggle('active', s <= step)
    })
    var target = document.querySelector('[data-wizard-page="' + step + '"]')
    if (target) target.classList.add('active')
  }

  window.copyWizardUri = function (btn) {
    var box = btn.closest('.wizard-uri-box')
    var code = box ? box.querySelector('.wizard-uri') : null
    if (!code) return
    navigator.clipboard.writeText(code.textContent).then(function () {
      btn.innerHTML = CHECK_ICON
      btn.classList.add('copied')
      setTimeout(function () { btn.innerHTML = COPY_ICON; btn.classList.remove('copied') }, 2000)
    })
  }

  function showWizardError(msg) {
    var container = document.getElementById('wizard-error')
    if (container) {
      container.textContent = msg
      container.style.display = 'block'
    } else {
      showToast(msg, 'error')
    }
  }

  function hideWizardError() {
    var container = document.getElementById('wizard-error')
    if (container) container.style.display = 'none'
  }

  window.wizardSubmit = function (moduleKey) {
    var cfg = WIZARD_CONFIGS[moduleKey]
    if (!cfg) return
    var clientId = document.getElementById('wizard-client-id')
    var clientSecret = document.getElementById('wizard-client-secret')
    var submitBtn = document.getElementById('wizard-submit')
    var isEs = (document.documentElement.lang || 'es') === 'es'
    hideWizardError()

    if (!clientId || !clientSecret || !clientId.value.trim() || !clientSecret.value.trim()) {
      showWizardError(isEs ? 'Client ID y Client Secret son requeridos' : 'Client ID and Client Secret are required')
      return
    }

    if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = '...' }

    fetch(cfg.setupUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ clientId: clientId.value.trim(), clientSecret: clientSecret.value.trim() })
    })
      .then(function (r) { return r.json() })
      .then(function (data) {
        if (data.ok && data.authUrl) {
          closeWizard()
          openOAuthPopup(moduleKey, cfg, data.authUrl)
        } else {
          var errMsg = data.error || 'Error'
          if (errMsg === 'Not found') {
            errMsg = isEs
              ? 'El modulo ' + cfg.label + ' no esta activado. Activalo primero desde la consola.'
              : cfg.label + ' module is not active. Activate it first from the console.'
          }
          showWizardError(errMsg)
          if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = isEs ? 'Conectar' : 'Connect' }
        }
      })
      .catch(function () {
        showWizardError(isEs ? 'Error de conexion' : 'Connection error')
        if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = isEs ? 'Conectar' : 'Connect' }
      })
  }

  function startOAuthFlow(moduleKey, cfg) {
    fetch(cfg.authUrl)
      .then(function (r) { return r.json() })
      .then(function (data) {
        if (data.needsSetup) {
          fetch(cfg.statusUrl)
            .then(function (r) { return r.json() })
            .then(function (s) { showWizardModal(moduleKey, cfg, s.redirectUri || '') })
          return
        }
        if (data.url) {
          openOAuthPopup(moduleKey, cfg, data.url)
        } else {
          showToast(data.error || 'Error', 'error')
        }
      })
      .catch(function () { showToast('Error', 'error') })
  }

  function openOAuthPopup(moduleKey, cfg, url) {
    var isEs = (document.documentElement.lang || 'es') === 'es'
    showToast((isEs ? 'Abriendo autorizacion de ' : 'Opening ') + cfg.label + '...', 'success')
    var popup = window.open(url, moduleKey + '-oauth', 'width=500,height=620,scrollbars=yes')
    var poll = setInterval(function () {
      fetch(cfg.pollStatusUrl)
        .then(function (r) { return r.json() })
        .then(function (s) {
          var isConnected = cfg.pollValue ? s[cfg.pollKey] === cfg.pollValue : s[cfg.pollKey]
          if (isConnected) {
            clearInterval(poll)
            if (popup && !popup.closed) popup.close()
            showToast(cfg.label + (isEs ? ' conectado' : ' connected'), 'success')
            location.reload()
          } else if (popup && popup.closed) {
            clearInterval(poll)
          }
        })
        .catch(function () { clearInterval(poll) })
    }, 2000)
  }

  // === Gmail OAuth ===
  window.gmailConnect = function () { openOAuthWizard('gmail') }

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
  window.googleAppsConnect = function () { openOAuthWizard('google-apps') }

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

  // === Channel cards: toggle & metrics ===

  // Submit a toggle form for channel activation
  function submitChannelToggle(moduleName, active, redirect) {
    var form = document.createElement('form')
    form.method = 'POST'
    form.action = '/console/modules/toggle'
    form.style.display = 'none'
    var fields = { module: moduleName, active: active ? 'true' : 'false', _redirect: redirect }
    for (var key in fields) {
      var input = document.createElement('input')
      input.type = 'hidden'
      input.name = key
      input.value = fields[key]
      form.appendChild(input)
    }
    document.body.appendChild(form)
    form.submit()
  }

  // Toggle with confirmation for deactivation
  window.toggleChannelConfirm = function (checkbox) {
    var moduleName = checkbox.getAttribute('data-module')
    var active = checkbox.checked
    var redirect = checkbox.getAttribute('data-redirect') || '/console/channels'

    if (!active) {
      // Deactivating — ask for confirmation
      var msg = document.documentElement.lang === 'es'
        ? 'Desactivar este canal? Se detendran todas las conexiones activas.'
        : 'Deactivate this channel? All active connections will be stopped.'
      if (!confirm(msg)) {
        checkbox.checked = true // revert
        return
      }
    }
    submitChannelToggle(moduleName, active, redirect)
  }

  // Kept for backward compat
  window.toggleChannel = window.toggleChannelConfirm

  // ── Connect channel: inline flow modals ──
  var _chConnectPoll = null

  function closeConnectModal() {
    var m = document.getElementById('ch-connect-modal')
    if (m) m.remove()
    if (_chConnectPoll) { clearInterval(_chConnectPoll); _chConnectPoll = null }
  }

  function createConnectModal(title, bodyHtml) {
    closeConnectModal()
    var modal = document.createElement('div')
    modal.id = 'ch-connect-modal'
    modal.className = 'wizard-overlay'
    modal.innerHTML = '<div class="wizard-modal">'
      + '<button class="wizard-close" onclick="closeConnectModal()">&times;</button>'
      + '<div class="wizard-steps"><h3>' + title + '</h3>' + bodyHtml + '</div></div>'
    modal.addEventListener('click', function (e) { if (e.target === modal) closeConnectModal() })
    document.body.appendChild(modal)
    return modal
  }
  window.closeConnectModal = closeConnectModal

  // Load wizard definitions from module manifests (embedded by server in channels page)
  function getChannelWizards() {
    var el = document.getElementById('channel-wizards-data')
    if (!el) return {}
    try { return JSON.parse(el.textContent || '{}') } catch (e) { return {} }
  }

  // Tabbed wizard renderer: each step is a separate page with dot indicator + navigation
  function renderWizardFromManifest(channelId, wizard, lang) {
    var isEs = (lang || 'es') === 'es'
    var lk = isEs ? 'es' : 'en'
    var steps = wizard.steps || []
    var title = (wizard.title && wizard.title[lk]) || channelId
    var totalSteps = steps.length

    // Dot indicator
    var body = '<div class="wizard-step-indicator" id="wizard-dots">'
    for (var d = 0; d < totalSteps; d++) {
      if (d > 0) body += '<div class="wizard-dot-line"></div>'
      body += '<div class="wizard-dot' + (d === 0 ? ' active' : '') + '" data-dot="' + d + '">' + (d + 1) + '</div>'
    }
    body += '</div>'

    // Pages (one per step)
    for (var i = 0; i < steps.length; i++) {
      var step = steps[i]
      var stepTitle = step.title ? step.title[lk] : ''
      var instructions = step.instructions ? step.instructions[lk] : ''
      var isLast = i === totalSteps - 1

      body += '<div class="wizard-page' + (i === 0 ? ' active' : '') + '" data-page="' + i + '">'
      body += '<div class="wizard-step-header"><span class="wizard-step-num">' + (i + 1) + '</span><span class="wizard-step-title">' + stepTitle + '</span></div>'
      body += '<div class="wizard-instructions">' + instructions + '</div>'

      if (step.fields && step.fields.length > 0) {
        for (var f = 0; f < step.fields.length; f++) {
          var field = step.fields[f]
          var fieldLabel = field.label ? field.label[lk] : field.key
          var fieldType = field.type === 'secret' ? 'password' : (field.type === 'textarea' ? 'textarea' : 'text')
          body += '<label class="wizard-label">' + fieldLabel + '</label>'
          if (fieldType === 'textarea') {
            body += '<textarea id="ch-wizard-' + field.key + '" class="wizard-input" rows="6" placeholder="' + (field.placeholder || '') + '" style="width:100%;resize:vertical;font-family:monospace;font-size:12px"></textarea>'
          } else {
            body += '<input id="ch-wizard-' + field.key + '" class="wizard-input" type="' + fieldType + '" placeholder="' + (field.placeholder || '') + '">'
          }
        }
      }

      // Navigation buttons per page
      body += '<div id="ch-wizard-error" class="wizard-error" style="display:none"></div>'
      body += '<div class="wizard-actions">'
      if (i === 0) {
        body += '<button class="wizard-btn wizard-btn-secondary" onclick="closeConnectModal()">' + (isEs ? 'Cancelar' : 'Cancel') + '</button>'
      } else {
        body += '<button class="wizard-btn wizard-btn-secondary" onclick="wizardGoTo(' + (i - 1) + ')">' + (isEs ? 'Anterior' : 'Back') + '</button>'
      }
      if (isLast) {
        body += '<button class="wizard-btn wizard-btn-primary" onclick="saveWizardFields(\'' + channelId + '\', \'' + lang + '\', ' + (wizard.saveEndpoint ? "'" + wizard.saveEndpoint + "'" : 'null') + ')">' + (isEs ? 'Guardar y conectar' : 'Save & connect') + '</button>'
      } else {
        body += '<button class="wizard-btn wizard-btn-primary" onclick="wizardGoTo(' + (i + 1) + ')">' + (isEs ? 'Siguiente' : 'Next') + '</button>'
      }
      body += '</div>'
      body += '</div>' // end wizard-page
    }

    createConnectModal(title, body)
  }

  // Navigate wizard tabs
  window.wizardGoTo = function (pageIdx) {
    var pages = document.querySelectorAll('.wizard-page')
    var dots = document.querySelectorAll('.wizard-dot')
    var lines = document.querySelectorAll('.wizard-dot-line')
    for (var i = 0; i < pages.length; i++) {
      pages[i].classList.toggle('active', i === pageIdx)
    }
    for (var j = 0; j < dots.length; j++) {
      dots[j].classList.toggle('active', j <= pageIdx)
    }
    for (var k = 0; k < lines.length; k++) {
      lines[k].classList.toggle('active', k < pageIdx)
    }
    // Hide any previous error
    var errs = document.querySelectorAll('.wizard-error')
    for (var e = 0; e < errs.length; e++) errs[e].style.display = 'none'
    // Scroll modal to top
    var modal = document.querySelector('.wizard-modal')
    if (modal) modal.scrollTop = 0
  }

  // Generic save: collect all wizard field values and POST to /console/save + /console/apply
  window.saveWizardFields = function (channelId, lang, customValidateEndpoint) {
    var isEs = (lang || 'es') === 'es'
    var errEl = document.getElementById('ch-wizard-error')

    // Collect all ch-wizard-* input/textarea values
    var inputs = document.querySelectorAll('[id^="ch-wizard-"]')
    var bodyParts = ['_section=' + encodeURIComponent(channelId), '_lang=' + encodeURIComponent(lang)]
    var jsonBody = {}
    for (var i = 0; i < inputs.length; i++) {
      var el = inputs[i]
      var key = el.id.replace('ch-wizard-', '')
      var val = (el.value || '').trim()
      bodyParts.push(encodeURIComponent(key) + '=' + encodeURIComponent(val))
      jsonBody[key] = val
    }

    function doSave() {
      fetch('/console/save', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: bodyParts.join('&') })
        .then(function () {
          return fetch('/console/apply', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: '_section=' + encodeURIComponent(channelId) + '&_lang=' + encodeURIComponent(lang) })
        })
        .then(function () { closeConnectModal(); showToast(isEs ? 'Canal configurado' : 'Channel configured', 'success'); window.location.reload() })
        .catch(function () { if (errEl) { errEl.textContent = isEs ? 'Error al guardar' : 'Save error'; errEl.style.display = 'block' } })
    }

    if (customValidateEndpoint) {
      fetch('/console/api/' + channelId + '/' + customValidateEndpoint, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(jsonBody)
      })
        .then(function (r) { return r.json() })
        .then(function (data) {
          if (data.error || data.valid === false) {
            if (errEl) { errEl.textContent = data.error || (data.errors || []).join(', ') || (isEs ? 'Error de validacion' : 'Validation error'); errEl.style.display = 'block' }
            return
          }
          doSave()
        })
        .catch(function () { if (errEl) { errEl.textContent = isEs ? 'Error de conexion' : 'Connection error'; errEl.style.display = 'block' } })
    } else {
      doSave()
    }
  }

  window.channelConnect = function (channelId, lang) {
    var isEs = (lang || 'es') === 'es'
    var wizards = getChannelWizards()
    var wizard = wizards[channelId]
    var lk = isEs ? 'es' : 'en'

    if (!wizard) {
      // Wizard data not available — channel module must define connectionWizard.
      // Container restart required after adding a new channel module.
      console.warn('No wizard data for channel "' + channelId + '". Restart container if you just added this channel.')
      window.location.href = '/console/channels/' + channelId + '?lang=' + lang
      return
    }

    if (channelId === 'whatsapp') {
      // ── WhatsApp: tabbed wizard — step 1 instructions, step 2 auto-QR with countdown ──
      var waTitle = wizard.title[lk] || 'WhatsApp'
      var waSteps = wizard.steps || []
      var totalWa = waSteps.length

      // Dot indicator
      var body = '<div class="wizard-step-indicator" id="wizard-dots">'
      for (var d = 0; d < totalWa; d++) {
        if (d > 0) body += '<div class="wizard-dot-line"></div>'
        body += '<div class="wizard-dot' + (d === 0 ? ' active' : '') + '" data-dot="' + d + '">' + (d + 1) + '</div>'
      }
      body += '</div>'

      // Page 1: instructions from manifest
      for (var p = 0; p < totalWa; p++) {
        var ws = waSteps[p]
        var isLastWa = p === totalWa - 1

        body += '<div class="wizard-page' + (p === 0 ? ' active' : '') + '" data-page="' + p + '">'
        body += '<div class="wizard-step-header"><span class="wizard-step-num">' + (p + 1) + '</span><span class="wizard-step-title">' + (ws.title[lk] || '') + '</span></div>'
        body += '<div class="wizard-instructions">' + (ws.instructions[lk] || '') + '</div>'

        // Last step: QR area
        if (isLastWa) {
          body += '<div id="ch-wa-qr-area" style="text-align:center;padding:20px 0;min-height:120px">'
            + '<div style="color:var(--on-surface-dim)">' + (isEs ? 'El codigo QR se generara automaticamente...' : 'QR code will be generated automatically...') + '</div>'
            + '</div>'
            + '<div id="ch-wa-countdown" style="text-align:center;font-size:12px;color:var(--on-surface-dim);margin-top:4px"></div>'
            + '<div id="ch-wa-status" style="text-align:center;font-size:13px;color:var(--on-surface-variant);margin-top:8px"></div>'
        }

        // Navigation
        body += '<div class="wizard-actions">'
        if (p === 0) {
          body += '<button class="wizard-btn wizard-btn-secondary" onclick="closeConnectModal()">' + (isEs ? 'Cancelar' : 'Cancel') + '</button>'
          body += '<button class="wizard-btn wizard-btn-primary" onclick="wizardGoToWa(' + (p + 1) + ', \'' + lang + '\')">' + (isEs ? 'Siguiente' : 'Next') + '</button>'
        } else {
          body += '<button class="wizard-btn wizard-btn-secondary" onclick="wizardGoTo(' + (p - 1) + ')">' + (isEs ? 'Anterior' : 'Back') + '</button>'
          if (!isLastWa) {
            body += '<button class="wizard-btn wizard-btn-primary" onclick="wizardGoToWa(' + (p + 1) + ', \'' + lang + '\')">' + (isEs ? 'Siguiente' : 'Next') + '</button>'
          }
        }
        body += '</div>'
        body += '</div>' // end wizard-page
      }

      createConnectModal(waTitle, body)

    } else if (channelId === 'gmail') {
      // ── Gmail: check OAuth status first, then show manifest wizard ──
      fetch('/console/api/email/auth-status')
        .then(function (r) { return r.json() })
        .then(function (data) {
          if (data.connected) {
            showToast(isEs ? 'Gmail ya esta conectado' : 'Gmail is already connected', 'success')
          } else {
            renderWizardFromManifest('gmail', wizard, lang)
          }
        })
        .catch(function () { renderWizardFromManifest('gmail', wizard, lang) })

    } else {
      // ── Generic: google-chat, twilio-voice, future channels — all from manifest ──
      renderWizardFromManifest(channelId, wizard, lang)
    }
  }

  // WhatsApp: navigate to QR step — auto-triggers QR generation on last step
  var _waCountdownInterval = null
  var _waQrExpiry = 0

  window.wizardGoToWa = function (pageIdx, lang) {
    wizardGoTo(pageIdx)
    // Check if this is the last page (QR page) — auto-start QR
    var pages = document.querySelectorAll('.wizard-page')
    if (pageIdx === pages.length - 1) {
      startWhatsAppQRAuto(lang)
    }
  }

  function startWhatsAppQRAuto(lang) {
    var isEs = (lang || 'es') === 'es'
    var qrArea = document.getElementById('ch-wa-qr-area')
    var statusEl = document.getElementById('ch-wa-status')
    var countdownEl = document.getElementById('ch-wa-countdown')
    if (!qrArea) return

    // Clear any previous polling/countdown
    if (_chConnectPoll) { clearInterval(_chConnectPoll); _chConnectPoll = null }
    if (_waCountdownInterval) { clearInterval(_waCountdownInterval); _waCountdownInterval = null }

    qrArea.innerHTML = '<div style="color:var(--on-surface-dim)">' + (isEs ? 'Generando codigo QR...' : 'Generating QR code...') + '</div>'
    if (countdownEl) countdownEl.textContent = ''

    fetch('/console/api/whatsapp/connect', { method: 'POST' })
      .then(function () {
        _chConnectPoll = setInterval(function () {
          fetch('/console/api/whatsapp/status')
            .then(function (r) { return r.json() })
            .then(function (data) {
              if (data.status === 'connected') {
                clearInterval(_chConnectPoll); _chConnectPoll = null
                if (_waCountdownInterval) { clearInterval(_waCountdownInterval); _waCountdownInterval = null }
                qrArea.innerHTML = '<div style="color:var(--success);font-weight:600;font-size:18px">&#10003; ' + (isEs ? 'Conectado exitosamente' : 'Connected successfully') + '</div>'
                if (statusEl) statusEl.textContent = data.connectedNumber ? (isEs ? 'Numero: ' : 'Number: ') + data.connectedNumber : ''
                if (countdownEl) countdownEl.textContent = ''
                setTimeout(function () { closeConnectModal(); window.location.reload() }, 2000)
              } else if (data.qrDataUrl) {
                qrArea.innerHTML = '<div class="wa-qr-container"><img src="' + data.qrDataUrl + '" alt="QR" class="wa-qr-img"></div>'
                if (statusEl) statusEl.textContent = isEs ? 'Escanea este codigo con WhatsApp' : 'Scan this code with WhatsApp'
                // Start/reset countdown (QR codes expire in ~20s, new one comes every poll)
                _waQrExpiry = 20
                if (_waCountdownInterval) clearInterval(_waCountdownInterval)
                _waCountdownInterval = setInterval(function () {
                  _waQrExpiry--
                  if (countdownEl) {
                    if (_waQrExpiry > 0) {
                      countdownEl.textContent = (isEs ? 'El codigo expira en ' : 'Code expires in ') + _waQrExpiry + 's'
                    } else {
                      countdownEl.textContent = isEs ? 'Actualizando codigo...' : 'Refreshing code...'
                    }
                  }
                }, 1000)
              } else if (data.status === 'connecting') {
                if (statusEl) statusEl.textContent = isEs ? 'Conectando...' : 'Connecting...'
              }
            })
        }, 2000)
      })
      .catch(function () {
        qrArea.innerHTML = '<div style="color:var(--error)">' + (isEs ? 'Error al generar QR' : 'Error generating QR') + '</div>'
      })
  }

  // Legacy compat
  window.startWhatsAppQR = function (lang) { startWhatsAppQRAuto(lang) }

  // Legacy aliases
  window.saveGoogleChatKey = function (lang) { window.saveWizardFields('google-chat', lang, 'validate-key') }
  window.saveTwilioCredentials = function (lang) { window.saveWizardFields('twilio-voice', lang, null) }

  // Disconnect channel — confirm then call the channel's disconnect API
  window.channelDisconnect = function (channelId, lang) {
    var msg = document.documentElement.lang === 'es'
      ? 'Desconectar este canal? LUNA dejara de recibir y enviar mensajes por este medio.'
      : 'Disconnect this channel? LUNA will stop receiving and sending messages through this medium.'
    if (!confirm(msg)) return

    // Call disconnect API for known channels
    var apiMap = {
      whatsapp: '/console/api/whatsapp/disconnect',
      gmail: '/console/api/email/auth-disconnect',
    }
    var apiUrl = apiMap[channelId]
    if (apiUrl) {
      fetch(apiUrl, { method: 'POST' })
        .then(function () { window.location.reload() })
        .catch(function () { window.location.reload() })
    } else {
      window.location.reload()
    }
  }

  // Format seconds into human readable duration
  function formatDuration(seconds) {
    if (!seconds || seconds <= 0) return '--'
    if (seconds < 60) return seconds + 's'
    if (seconds < 3600) return Math.round(seconds / 60) + 'min'
    var h = Math.floor(seconds / 3600)
    var m = Math.round((seconds % 3600) / 60)
    return h + 'h ' + m + 'min'
  }

  // Format number with locale
  function formatNum(n) {
    if (n == null || n === '--') return '--'
    return Number(n).toLocaleString()
  }

  // Fetch and render channel metrics
  function loadChannelMetrics(metricsEl, period) {
    var channel = metricsEl.getAttribute('data-channel')
    var type = metricsEl.getAttribute('data-type')
    if (!channel || !type) return

    fetch('/console/api/console/channel-metrics?channel=' + encodeURIComponent(channel) + '&type=' + encodeURIComponent(type) + '&period=' + encodeURIComponent(period))
      .then(function (r) { return r.json() })
      .then(function (data) {
        // Update all data-field elements inside this metrics container
        var fields = metricsEl.querySelectorAll('[data-field]')
        for (var i = 0; i < fields.length; i++) {
          var field = fields[i]
          var key = field.getAttribute('data-field')
          var val = data[key]
          if (key === 'avg_duration_s') {
            field.textContent = formatDuration(val)
          } else {
            field.textContent = formatNum(val)
          }
        }
      })
      .catch(function () {
        // Leave as --
      })
  }

  // Load all channel metrics with global period
  function loadAllChannelMetrics(period) {
    var allMetrics = document.querySelectorAll('.ch-card-metrics')
    for (var i = 0; i < allMetrics.length; i++) {
      loadChannelMetrics(allMetrics[i], period)
    }
  }

  // Initialize on page load
  var globalPeriod = document.getElementById('ch-period-global')
  if (globalPeriod) {
    loadAllChannelMetrics(globalPeriod.value)
    globalPeriod.addEventListener('change', function () {
      loadAllChannelMetrics(this.value)
    })
  }

  // Channel status filter
  var statusFilter = document.getElementById('ch-filter-status')
  var typeFilter = document.getElementById('ch-filter-type')
  function applyChannelFilters() {
    var status = statusFilter ? statusFilter.value : 'all'
    var type = typeFilter ? typeFilter.value : 'all'
    var cards = document.querySelectorAll('.ch-card')
    for (var i = 0; i < cards.length; i++) {
      var card = cards[i]
      var matchStatus = status === 'all' || card.getAttribute('data-filter-status') === status
      var matchType = type === 'all' || card.getAttribute('data-filter-type') === type
      card.style.display = (matchStatus && matchType) ? '' : 'none'
    }
  }
  if (statusFilter) statusFilter.addEventListener('change', applyChannelFilters)
  if (typeFilter) typeFilter.addEventListener('change', applyChannelFilters)
})()
