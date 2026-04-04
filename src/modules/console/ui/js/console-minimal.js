// console-minimal.js — Minimal client-side JS for SSR console
// Only handles: WA polling, panel collapse, info tooltips, toast dismiss,
// dirty tracking, model dropdown switch, model scanner, reset DB, Google OAuth

(function () {

  // ═══ Custom dropdown (replaces native <select>) ═══
  // Converts any <select> with class "js-custom-select" into a styled dropdown.
  // After conversion, dispatches 'change' on the hidden <select> so existing listeners work.

  function initCustomSelects() {
    document.querySelectorAll('select.js-custom-select').forEach(function (sel) {
      if (sel.getAttribute('data-custom-init')) return
      sel.setAttribute('data-custom-init', '1')
      sel.style.display = 'none'

      var wrap = document.createElement('div')
      wrap.className = 'custom-select'

      var btn = document.createElement('button')
      btn.type = 'button'
      btn.className = 'custom-select-btn'
      var arrowSvg = '<svg class="custom-select-arrow" width="10" height="6" viewBox="0 0 10 6" fill="none"><path d="M1 1L5 5L9 1" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>'

      function updateLabel() {
        var opt = sel.options[sel.selectedIndex]
        btn.innerHTML = (opt ? opt.textContent : '') + ' ' + arrowSvg
      }
      updateLabel()

      var panel = document.createElement('div')
      panel.className = 'custom-select-panel'

      function buildOptions() {
        panel.innerHTML = ''
        var groups = sel.querySelectorAll('optgroup')
        if (groups.length > 0) {
          // Optgroup mode: show group headers as separators
          groups.forEach(function (grp) {
            var hd = document.createElement('div')
            hd.className = 'custom-select-optgroup'
            hd.textContent = grp.getAttribute('label') || ''
            panel.appendChild(hd)
            grp.querySelectorAll('option').forEach(function (opt) {
              var item = document.createElement('button')
              item.type = 'button'
              item.className = 'custom-select-option' + (opt.selected ? ' selected' : '')
              item.textContent = opt.textContent
              item.setAttribute('data-value', opt.value)
              item.addEventListener('click', (function (val) {
                return function () {
                  sel.value = val
                  sel.dispatchEvent(new Event('change'))
                  wrap.classList.remove('open')
                  updateLabel()
                  panel.querySelectorAll('.custom-select-option').forEach(function (o) {
                    o.classList.toggle('selected', o.getAttribute('data-value') === val)
                  })
                }
              })(opt.value))
              panel.appendChild(item)
            })
          })
        } else {
          for (var i = 0; i < sel.options.length; i++) {
            var opt = sel.options[i]
            var item = document.createElement('button')
            item.type = 'button'
            item.className = 'custom-select-option' + (opt.selected ? ' selected' : '')
            item.textContent = opt.textContent
            item.setAttribute('data-value', opt.value)
            item.addEventListener('click', (function (val) {
              return function () {
                sel.value = val
                sel.dispatchEvent(new Event('change'))
                wrap.classList.remove('open')
                updateLabel()
                // Update selected class
                panel.querySelectorAll('.custom-select-option').forEach(function (o) {
                  o.classList.toggle('selected', o.getAttribute('data-value') === val)
                })
              }
            })(opt.value))
            panel.appendChild(item)
          }
        }
      }
      buildOptions()

      btn.addEventListener('click', function (e) {
        e.stopPropagation()
        // Close other open dropdowns
        document.querySelectorAll('.custom-select.open').forEach(function (d) {
          if (d !== wrap) d.classList.remove('open')
        })
        var opening = !wrap.classList.contains('open')
        wrap.classList.toggle('open')
        // Use position:fixed so the panel escapes overflow:hidden ancestors
        if (opening) {
          var rect = wrap.getBoundingClientRect()
          panel.style.position = 'fixed'
          panel.style.top = (rect.bottom + 4) + 'px'
          panel.style.left = rect.left + 'px'
          panel.style.minWidth = rect.width + 'px'
          panel.style.zIndex = '9999'
        }
      })

      sel.parentNode.insertBefore(wrap, sel)
      wrap.appendChild(btn)
      wrap.appendChild(panel)
      wrap.appendChild(sel) // keep hidden select inside for form submission
    })

    // Close on outside click
    document.addEventListener('click', function () {
      document.querySelectorAll('.custom-select.open').forEach(function (d) {
        d.classList.remove('open')
      })
    })

    // Close on scroll (position:fixed stays at original coords otherwise)
    window.addEventListener('scroll', function () {
      document.querySelectorAll('.custom-select.open').forEach(function (d) {
        d.classList.remove('open')
      })
    }, { passive: true })
  }

  // Init on load and after any dynamic content
  window.initCustomSelects = initCustomSelects
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initCustomSelects)
  } else {
    initCustomSelects()
  }
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

  function isInstantToggle(el) {
    // Permission toggles inside .cb-config-panel are NOT instant — they require save
    if (el.closest('.cb-config-panel')) return false
    return el.closest('.toggle-field') || el.closest('.chs-toggle-row')
  }

  function isDirty() {
    var inputs = document.querySelectorAll('input[data-original], select[data-original], textarea[data-original]')
    for (var i = 0; i < inputs.length; i++) {
      var el = inputs[i]
      // Skip toggles — they apply instantly (both module toggles and channel settings toggles)
      if (el.type === 'checkbox' && isInstantToggle(el)) continue
      if (el.type === 'hidden' && isInstantToggle(el)) continue
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
      if (el.type === 'checkbox' && isInstantToggle(el)) continue
      if (el.type === 'hidden' && isInstantToggle(el)) continue
      var current = el.value
      el.classList.toggle('modified', current !== el.getAttribute('data-original'))
    }
    setSaveBarPhase(dirty ? 'dirty' : 'hidden')
  }

  // Track non-toggle input/change
  document.addEventListener('input', function (e) {
    var el = e.target
    if (el.closest && isInstantToggle(el)) return
    if (el.hasAttribute && el.hasAttribute('data-original')) checkDirty()
  })

  document.addEventListener('change', function (e) {
    var el = e.target
    if (el.closest && isInstantToggle(el)) return
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
        if (isInstantToggle(inp)) continue
        if (saveForm.contains(inp)) continue
        body.append(inp.name, inp.value)
      }

      fetch('/console/save', { method: 'POST', body: body })
        .then(function (r) {
          if (r.ok || r.redirected) {
            showToast(document.documentElement.lang === 'es' ? 'Guardado' : 'Saved', 'success')
            // Update data-original so fields are no longer dirty
            allInputs.forEach(function (inp) {
              if (inp.closest('.toggle-field') || inp.closest('.chs-toggle-row')) return
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

  // === instantApply for channel settings toggles ===
  // Called by onchange="instantApply(this)" on channel settings boolean fields
  window.instantApply = function (el) {
    // Find the hidden input that carries the value for form submission
    var row = el.closest('.chs-toggle-row') || el.closest('.toggle')
    var hidden = row ? row.querySelector('input[type="hidden"][name="' + el.name + '"]') : el.nextElementSibling
    if (!hidden && row) hidden = row.querySelector('input[type="hidden"]')

    // If there are dirty non-toggle fields, warn
    if (isDirty()) {
      var lang = document.documentElement.lang || 'es'
      var msg = lang === 'es'
        ? 'Hay cambios sin guardar que se pueden perder. ¿Continuar?'
        : 'There are unsaved changes that may be lost. Continue?'
      if (!confirm(msg)) {
        el.checked = !el.checked
        return
      }
    }

    // Update hidden value
    if (hidden) hidden.value = el.checked ? 'true' : 'false'

    // Save + apply immediately via fetch
    var section = document.querySelector('input[name="_section"]')
    var lang2 = document.querySelector('input[name="_lang"]')
    var body = new URLSearchParams()
    body.append('_section', section ? section.value : '')
    body.append('_lang', lang2 ? lang2.value : 'es')
    body.append(el.name, el.checked ? 'true' : 'false')

    // Toggle visibility of dependent fields
    updateVisibleWhen(el.name, el.checked ? 'true' : 'false')

    // When toggling advanced format mode, populate/clear the code editor
    if (el.name === 'WHATSAPP_FORMAT_ADVANCED' || el.name === 'EMAIL_FORMAT_ADVANCED' || el.name === 'GOOGLE_CHAT_FORMAT_ADVANCED') {
      var channel = el.name.replace('_FORMAT_ADVANCED', '')
      var formatKey = 'FORMAT_INSTRUCTIONS_' + channel
      var ta = document.querySelector('textarea[name="' + formatKey + '"]')
      if (ta) {
        if (el.checked) {
          // Build prompt from form fields and populate the code editor
          ta.value = buildFormatPromptFromForm(channel)
          ta.setAttribute('data-original', ta.value)
          // Update line numbers if code editor
          var ceKey = ta.getAttribute('data-ce-key')
          if (ceKey) {
            var linesEl = document.querySelector('[data-ce-lines="' + ceKey + '"]')
            if (linesEl) {
              var count = (ta.value || '').split('\n').length
              var nums = ''
              for (var li = 1; li <= count; li++) nums += '<span class="code-editor-line-num">' + li + '</span>'
              linesEl.innerHTML = nums
            }
          }
        } else {
          // Clear when deactivating advanced mode
          ta.value = ''
          ta.setAttribute('data-original', '')
          var ceKey2 = ta.getAttribute('data-ce-key')
          if (ceKey2) {
            var linesEl2 = document.querySelector('[data-ce-lines="' + ceKey2 + '"]')
            if (linesEl2) linesEl2.innerHTML = '<span class="code-editor-line-num">1</span>'
          }
        }
      }
    }

    fetch('/console/apply', { method: 'POST', body: body, headers: { 'X-Instant-Toggle': '1' } })
      .then(function (r) {
        if (r.ok || r.redirected) {
          showToast(el.checked ? 'Activado' : 'Desactivado', 'success')
          el.setAttribute('data-original', el.checked ? 'true' : 'false')
          if (hidden) hidden.setAttribute('data-original', el.checked ? 'true' : 'false')
        } else {
          showToast('Error', 'error')
          el.checked = !el.checked
          if (hidden) hidden.value = el.checked ? 'true' : 'false'
          updateVisibleWhen(el.name, el.checked ? 'true' : 'false')
        }
      })
      .catch(function () {
        showToast('Error', 'error')
        el.checked = !el.checked
        if (hidden) hidden.value = el.checked ? 'true' : 'false'
        updateVisibleWhen(el.name, el.checked ? 'true' : 'false')
      })
  }

  // Toggle visibility of fields depending on another field's value
  function updateVisibleWhen(key, value) {
    document.querySelectorAll('[data-visible-when-key="' + key + '"]').forEach(function (el) {
      var expected = el.getAttribute('data-visible-when-value')
      el.style.display = (value === expected) ? '' : 'none'
    })
  }

  // Build format prompt from form fields (mirrors engine/prompts/compositor.ts buildFormatFromForm)
  function buildFormatPromptFromForm(channelPrefix) {
    function getVal(key) {
      var el = document.querySelector('[name="' + channelPrefix + '_FORMAT_' + key + '"]')
      if (!el) return ''
      if (el.type === 'checkbox') return el.checked ? 'true' : 'false'
      // For hidden inputs paired with checkboxes
      if (el.type === 'hidden' && el.name.indexOf('FORMAT_') !== -1) {
        var cb = document.querySelector('input[type="checkbox"][name="' + el.name + '"]')
        if (cb) return cb.checked ? 'true' : 'false'
        return el.value
      }
      return el.value || ''
    }

    var tone = getVal('TONE') || 'ninguno'
    var maxSentences = getVal('MAX_SENTENCES') || '2'
    var maxParagraphs = getVal('MAX_PARAGRAPHS') || '2'
    var emojiLevel = getVal('EMOJI_LEVEL') || 'bajo'
    var typosEnabled = getVal('TYPOS_ENABLED') === 'true'
    var typosIntensity = getVal('TYPOS_INTENSITY') || '0'
    var typosTypes = getVal('TYPOS_TYPES') || ''
    var openingSigns = getVal('OPENING_SIGNS') || 'nunca'
    var audioEnabled = getVal('AUDIO_ENABLED') === 'true'
    var voiceStyles = getVal('VOICE_STYLES') === 'true'
    var ex1 = getVal('EXAMPLE_1') || ''
    var ex2 = getVal('EXAMPLE_2') || ''
    var ex3 = getVal('EXAMPLE_3') || ''

    var channelName = channelPrefix.replace('WHATSAPP', 'WHATSAPP').replace('EMAIL', 'EMAIL').replace('GOOGLE_CHAT', 'GOOGLE_CHAT')
    var lines = ['FORMATO ' + channelName + ':']

    if (tone !== 'ninguno') lines.push('- Tono: ' + tone)
    lines.push('- Maximo ' + maxSentences + ' oraciones por parrafo')
    lines.push('- Maximo ' + maxParagraphs + ' parrafos por respuesta')

    var emojiMap = { nunca: 'No uses emojis', bajo: 'Usa emojis con moderacion (1-2 por mensaje)', moderado: 'Usa emojis moderadamente', alto: 'Usa emojis libremente' }
    lines.push('- ' + (emojiMap[emojiLevel] || emojiMap.bajo))

    if (openingSigns === 'inicio') lines.push('- Usa signos de apertura al inicio de preguntas y exclamaciones (¿ ¡)')
    else if (openingSigns === 'ambos') lines.push('- Usa signos de apertura y cierre en preguntas y exclamaciones (¿...? ¡...!)')
    else lines.push('- No uses signos de apertura (¿ ¡), solo cierra con ? y !')

    if (typosEnabled) {
      lines.push('- Introduce errores de escritura sutiles para sonar mas natural (intensidad: ' + typosIntensity + ')')
      if (typosTypes) lines.push('  Tipos: ' + typosTypes)
    }

    if (audioEnabled) {
      lines.push('- Puedes responder con notas de voz cuando sea apropiado')
      if (voiceStyles) lines.push('- Varia el estilo de voz segun el contexto (energetico, calmado, empatico)')
    }

    var examples = [ex1, ex2, ex3].filter(Boolean)
    if (examples.length > 0) {
      lines.push('- Ejemplos del estilo esperado:')
      for (var ei = 0; ei < examples.length; ei++) lines.push('  ' + (ei + 1) + '. "' + examples[ei] + '"')
    }

    return lines.join('\n')
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
  window._modelsData = modelsData

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
    'gemini-2.5-flash-lite': 'Flash-Lite 2.5',
    'gemini-2.5-flash-preview-05-20': 'Flash 2.5 Preview',
    'gemini-2.5-pro': 'Pro 2.5',
    'gemini-2.5-pro-preview-05-06': 'Pro 2.5 Preview',
    'gemini-2.0-flash': 'Flash 2.0',
    'gemini-1.5-pro': 'Pro 1.5',
    'gemini-1.5-flash': 'Flash 1.5',
  }
  window._modelNames = MODEL_NAMES

  document.addEventListener('change', function (e) {
    var el = e.target
    var prefix = el.getAttribute('data-model-provider')
    if (!prefix) return
    var provider = el.value
    var modelKey = provider === 'google' ? 'gemini' : provider
    var models = (window._modelsData || modelsData)[modelKey] || []
    var modelSelect = document.querySelector('[data-model-select="' + prefix + '"]')
    if (!modelSelect) return
    modelSelect.innerHTML = models.map(function (m) {
      return '<option value="' + m + '">' + (MODEL_NAMES[m] || m) + '</option>'
    }).join('')
    checkDirty()
  })

  // === API Key Mode segment toggle ===
  window.setApiKeyMode = function (mode) {
    var input = document.getElementById('api-mode-input')
    if (input) {
      input.value = mode
      input.dispatchEvent(new Event('change', { bubbles: true }))
    }
    document.querySelectorAll('.seg-btn').forEach(function (btn) {
      btn.classList.toggle('seg-btn--active', btn.getAttribute('data-mode') === mode)
    })
    var advGroups = document.querySelectorAll('.adv-group-keys')
    advGroups.forEach(function (el) {
      el.style.display = mode === 'advanced' ? 'block' : 'none'
    })
  }

  // === Business Hours day toggle ===
  window.toggleBhDay = function (btn) {
    btn.classList.toggle('bh-day-btn--active')
    var input = document.getElementById('bh-days-input')
    if (!input) return
    var days = []
    document.querySelectorAll('.bh-day-btn--active').forEach(function (el) {
      days.push(el.getAttribute('data-day'))
    })
    days.sort()
    input.value = days.join(',')
    input.dispatchEvent(new Event('change', { bubbles: true }))
  }

  // === Model table — refresh custom select widget ===
  function refreshCustomSelect(sel) {
    var wrapper = sel.parentNode
    while (wrapper && !wrapper.classList.contains('custom-select')) {
      wrapper = wrapper.parentNode
    }
    if (wrapper && wrapper.parentNode) {
      wrapper.parentNode.insertBefore(sel, wrapper)
      wrapper.remove()
    }
    sel.removeAttribute('data-custom-init')
    sel.style.display = ''
    if (window.initCustomSelects) window.initCustomSelects()
  }

  // === Model table — primary select change (update hidden inputs + filter downgrade) ===
  document.addEventListener('change', function (e) {
    var sel = e.target
    if (!sel.classList || !sel.classList.contains('mt-primary-sel')) return
    var val = sel.value // "provider:model"
    var colonIdx = val.indexOf(':')
    if (colonIdx < 0) return
    var provider = val.substring(0, colonIdx)
    var model = val.substring(colonIdx + 1)
    var task = sel.getAttribute('data-task')
    if (!task) return
    var taskKey = task.toUpperCase()
    var row = sel.closest ? sel.closest('.mt-row') : null
    if (!row) return

    // Update primary hidden inputs
    var provInput = row.querySelector('input[name="LLM_' + taskKey + '_PROVIDER"]')
    var modInput = row.querySelector('input[name="LLM_' + taskKey + '_MODEL"]')
    if (provInput) provInput.value = provider
    if (modInput) modInput.value = model

    // Filter downgrade select to same provider
    var dgSel = row.querySelector('.mt-dg-sel')
    if (!dgSel) return
    var data = window._modelsData || {}
    var models = provider === 'google' ? (data.gemini || []) : (data.anthropic || [])
    var names = window._modelNames || {}
    var newOpts = '<option value="">—</option>' + models.map(function (m) {
      return '<option value="' + provider + ':' + m + '">' + (names[m] || m) + '</option>'
    }).join('')
    dgSel.innerHTML = newOpts
    dgSel.value = ''

    // Reset downgrade hidden inputs
    var dgProvInput = row.querySelector('input[name="LLM_' + taskKey + '_DOWNGRADE_PROVIDER"]')
    var dgModInput = row.querySelector('input[name="LLM_' + taskKey + '_DOWNGRADE_MODEL"]')
    if (dgProvInput) dgProvInput.value = ''
    if (dgModInput) dgModInput.value = ''

    refreshCustomSelect(dgSel)
    checkDirty()
  })

  // === Model table — downgrade select change (update hidden inputs) ===
  document.addEventListener('change', function (e) {
    var sel = e.target
    if (!sel.classList || !sel.classList.contains('mt-dg-sel')) return
    var val = sel.value // "provider:model" or ""
    var task = sel.getAttribute('data-task')
    if (!task) return
    var taskKey = task.toUpperCase()
    var row = sel.closest ? sel.closest('.mt-row') : null
    if (!row) return
    var colonIdx = val ? val.indexOf(':') : -1
    var provider = colonIdx >= 0 ? val.substring(0, colonIdx) : ''
    var model = colonIdx >= 0 ? val.substring(colonIdx + 1) : ''
    var dgProvInput = row.querySelector('input[name="LLM_' + taskKey + '_DOWNGRADE_PROVIDER"]')
    var dgModInput = row.querySelector('input[name="LLM_' + taskKey + '_DOWNGRADE_MODEL"]')
    if (dgProvInput) dgProvInput.value = provider
    if (dgModInput) dgModInput.value = model
    checkDirty()
  })

  // === Model table — fallback select change (update hidden inputs) ===
  document.addEventListener('change', function (e) {
    var sel = e.target
    if (!sel.classList || !sel.classList.contains('mt-fb-sel')) return
    var val = sel.value // "provider:model" or ""
    var task = sel.getAttribute('data-task')
    if (!task) return
    var taskKey = task.toUpperCase()
    var row = sel.closest ? sel.closest('.mt-row') : null
    if (!row) return
    var colonIdx = val ? val.indexOf(':') : -1
    var provider = colonIdx >= 0 ? val.substring(0, colonIdx) : ''
    var model = colonIdx >= 0 ? val.substring(colonIdx + 1) : ''
    var fbProvInput = row.querySelector('input[name="LLM_' + taskKey + '_FALLBACK_PROVIDER"]')
    var fbModInput = row.querySelector('input[name="LLM_' + taskKey + '_FALLBACK_MODEL"]')
    if (fbProvInput) fbProvInput.value = provider
    if (fbModInput) fbModInput.value = model
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
    fetch('/console/api/llm/scanner/scan', { method: 'POST' })
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
          fetch('/console/api/llm/scanner/models')
            .then(function (r) { return r.json() })
            .then(function (d) { if (d.models) { modelsData = d.models; window._modelsData = d.models } })
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

  // === Reset Contacts ===
  window.resetContacts = function () {
    var lang = document.documentElement.lang || 'es'
    var msg = lang === 'es'
      ? 'ADVERTENCIA: Esto eliminara TODAS las bases de contactos, usuarios y permisos. ¿Continuar?'
      : 'WARNING: This will delete ALL contact bases, users and permissions. Continue?'
    if (!confirm(msg)) return
    var section = form ? (form.querySelector('[name="_section"]') || {}).value || '' : ''
    var resetForm = document.createElement('form')
    resetForm.method = 'POST'
    resetForm.action = '/console/reset-contacts'
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
    var wizardTitle = isEs ? ('Conectar ' + cfg.label) : ('Connect ' + cfg.label)
    modal.innerHTML = '<div class="wizard-modal">'
      + '<button class="wizard-close" onclick="closeWizard()">&times;</button>'
      + '<div class="wizard-steps">'
      + '<div class="wizard-title">' + wizardTitle + '</div>'
      + '<div class="wizard-step-count">4 ' + (isEs ? 'pasos' : 'steps') + '</div>'
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

  // Tag options (predefined selectable chips)
  document.addEventListener('click', function (e) {
    var chip = e.target.closest('[data-tag-option]')
    if (!chip) return
    var key = chip.getAttribute('data-tag-option')
    var tagVal = chip.getAttribute('data-tag-value')
    var hidden = document.querySelector('input[type="hidden"][name="' + key + '"]')
    if (!hidden) return
    var sep = hidden.getAttribute('data-separator') || ','
    var current = hidden.value ? hidden.value.split(sep).map(function (s) { return s.trim() }).filter(Boolean) : []
    var idx = current.indexOf(tagVal)
    if (idx >= 0) {
      current.splice(idx, 1)
      chip.classList.remove('field-tag-option--active')
    } else {
      current.push(tagVal)
      chip.classList.add('field-tag-option--active')
    }
    hidden.value = current.join(sep)
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

  // === Notification API (server-backed) ===
  // Polls /console/api/cortex/notifications every 30s.
  // Local notifications (config saved, etc.) are merged with server notifications.
  // Server notifications persist in PostgreSQL, local ones are ephemeral.
  window.lunaNotifications = (function () {
    var localItems = []
    var serverItems = []
    var unreadCount = 0
    var MAX_LOCAL = 10
    var POLL_MS = 30000
    var notifList = document.getElementById('notif-list')
    var notifDot = document.getElementById('notif-dot')
    var notifCount = document.getElementById('notif-count')
    var markAllBtn = document.getElementById('notif-mark-all')
    var isEs = document.documentElement.lang === 'es'

    var ICON_SVG = {
      error: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>',
      success: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M9 12l2 2 4-4"/></svg>',
      info: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>'
    }

    function severityToIcon(sev) {
      if (sev === 'critical' || sev === 'error') return ICON_SVG.error
      if (sev === 'success') return ICON_SVG.success
      return ICON_SVG.info
    }

    function formatTime(dateStr) {
      try {
        var d = new Date(dateStr)
        var now = new Date()
        var diffMs = now - d
        if (diffMs < 60000) return isEs ? 'ahora' : 'now'
        if (diffMs < 3600000) return Math.floor(diffMs / 60000) + 'm'
        if (diffMs < 86400000) return Math.floor(diffMs / 3600000) + 'h'
        return d.toLocaleDateString()
      } catch { return '' }
    }

    function render() {
      if (!notifList) return
      // Merge: local items first, then server items
      var all = localItems.concat(serverItems)

      if (all.length === 0) {
        notifList.innerHTML = '<div class="dropdown-empty">' + (isEs ? 'Sin notificaciones' : 'No notifications') + '</div>'
        if (notifDot) notifDot.classList.remove('active')
        if (notifCount) notifCount.classList.remove('active')
        if (markAllBtn) markAllBtn.style.display = ''
        return
      }

      var hasUnread = unreadCount > 0 || localItems.some(function (n) { return !n.read })
      if (notifDot) notifDot.classList.toggle('active', hasUnread)
      if (notifCount && unreadCount > 0) {
        notifCount.textContent = unreadCount > 99 ? '99+' : String(unreadCount)
        notifCount.classList.add('active')
      } else if (notifCount) {
        notifCount.classList.remove('active')
      }
      if (markAllBtn) markAllBtn.style.display = hasUnread ? 'block' : ''

      notifList.innerHTML = all.map(function (n) {
        var iconSvg = severityToIcon(n.severity || n.type)
        var isUnread = n.server ? !n.read : !n.read
        return '<div class="notif-item' + (isUnread ? ' notif-unread' : '') + '">'
          + '<div class="notif-icon">' + iconSvg + '</div>'
          + '<div class="notif-content">'
          + '<div class="notif-title">' + escHtml(n.title) + '</div>'
          + (n.body || n.text ? '<div class="notif-text">' + escHtml(n.body || n.text) + '</div>' : '')
          + '<div class="notif-time">' + escHtml(n.time || formatTime(n.created_at) || '') + '</div>'
          + '</div></div>'
      }).join('')
    }

    // Local notification (ephemeral — config saved, etc.)
    function add(opts) {
      var now = new Date()
      localItems.unshift({
        title: opts.title || '',
        text: opts.text || '',
        type: opts.type || 'info',
        severity: opts.type || 'info',
        time: now.getHours() + ':' + String(now.getMinutes()).padStart(2, '0'),
        read: false
      })
      if (localItems.length > MAX_LOCAL) localItems = localItems.slice(0, MAX_LOCAL)
      render()
    }

    function clear() { localItems = []; render() }

    function markAllRead() {
      localItems.forEach(function (n) { n.read = true })
      // Mark server notifications read
      fetch('/console/api/cortex/notifications/read-all', { method: 'POST' })
        .then(function () { unreadCount = 0; serverItems.forEach(function (n) { n.read = true }); render() })
        .catch(function () {})
    }

    // Poll server for notifications
    function poll() {
      fetch('/console/api/cortex/notifications?limit=20')
        .then(function (r) { return r.ok ? r.json() : null })
        .then(function (data) {
          if (!data) return
          serverItems = (data.notifications || []).map(function (n) {
            n.server = true; return n
          })
          unreadCount = data.unreadCount || 0
          render()
        })
        .catch(function () {})
    }

    // Initial poll + periodic
    poll()
    setInterval(poll, POLL_MS)

    render()
    return { add: add, clear: clear, markAllRead: markAllRead, poll: poll }
  })()

  // Mark notifications read when opening the panel
  var notifBtn = document.getElementById('btn-notifications')
  if (notifBtn) {
    notifBtn.addEventListener('click', function () {
      setTimeout(function () { window.lunaNotifications.markAllRead() }, 500)
    })
  }
  // Also wire the "Mark all read" button
  var markAllBtn2 = document.getElementById('notif-mark-all')
  if (markAllBtn2) {
    markAllBtn2.addEventListener('click', function (e) {
      e.stopPropagation()
      window.lunaNotifications.markAllRead()
    })
  }

  // === Test mode toggle (in user dropdown) — persists ENGINE_TEST_MODE ===
  // When deactivated: resets DEBUG_CACHE_ENABLED=true, DEBUG_ADMIN_ONLY=false, DEBUG_EXTREME_LOG=false
  var testModeCb = document.getElementById('test-mode-cb')

  if (testModeCb) {
    testModeCb.addEventListener('change', function () {
      var lang = document.documentElement.lang || 'es'
      if (testModeCb.checked) {
        var msg = lang === 'es'
          ? '¿Activar debugging? Se habilitarán acciones destructivas y el panel de debug.'
          : 'Enable debugging? Destructive actions and debug panel will be enabled.'
        if (!confirm(msg)) {
          testModeCb.checked = false
          return
        }
      }
      var val = testModeCb.checked ? 'true' : 'false'
      var section = (document.querySelector('input[name="_section"]') || {}).value || 'engine'
      var body = new URLSearchParams()
      body.append('_section', section)
      body.append('_lang', lang)
      body.append('ENGINE_TEST_MODE', val)
      // When deactivating: reset all debug flags
      if (!testModeCb.checked) {
        body.append('DEBUG_CACHE_ENABLED', 'true')
        body.append('DEBUG_ADMIN_ONLY', 'false')
        body.append('DEBUG_EXTREME_LOG', 'false')
      }

      fetch('/console/apply', { method: 'POST', body: body, headers: { 'X-Instant-Toggle': '1' } })
        .then(function (r) {
          if (r.ok || r.redirected) {
            showToast(testModeCb.checked
              ? (lang === 'es' ? 'Debugging activado' : 'Debugging enabled')
              : (lang === 'es' ? 'Debugging desactivado' : 'Debugging disabled'),
              testModeCb.checked ? 'warning' : 'success')
            // Reload page so debug icon appears/disappears
            setTimeout(function () { location.reload() }, 600)
          } else {
            throw new Error('save failed')
          }
        })
        .catch(function () {
          testModeCb.checked = !testModeCb.checked
          showToast('Error', 'error')
        })
    })
  }

  // === Debug panel toggles ===
  function debugToggle(cbId, configKey, toastOn, toastOff) {
    var cb = document.getElementById(cbId)
    if (!cb) return
    cb.addEventListener('change', function () {
      var val = cb.checked ? 'true' : 'false'
      var section = (document.querySelector('input[name="_section"]') || {}).value || 'engine'
      var lang = document.documentElement.lang || 'es'
      var body = new URLSearchParams()
      body.append('_section', section)
      body.append('_lang', lang)
      body.append(configKey, val)

      fetch('/console/apply', { method: 'POST', body: body, headers: { 'X-Instant-Toggle': '1' } })
        .then(function (r) {
          if (r.ok || r.redirected) {
            showToast(cb.checked ? toastOn : toastOff, 'success')
          } else { throw new Error('fail') }
        })
        .catch(function () {
          cb.checked = !cb.checked
          showToast('Error', 'error')
        })
    })
  }

  debugToggle('debug-cache-cb', 'DEBUG_CACHE_ENABLED', 'Cache ON', 'Cache OFF')
  debugToggle('debug-log-cb', 'DEBUG_EXTREME_LOG', 'Extreme log ON', 'Extreme log OFF')
  debugToggle('debug-admin-cb', 'DEBUG_ADMIN_ONLY', 'Admin only ON', 'Admin only OFF')

  // === Type-to-confirm modal system ===
  var confirmModal = document.getElementById('confirm-modal')
  var confirmTitle = document.getElementById('confirm-modal-title')
  var confirmDesc = document.getElementById('confirm-modal-desc')
  var confirmInput = document.getElementById('confirm-modal-input')
  var confirmBtn = document.getElementById('confirm-modal-btn')
  var confirmCancel = document.getElementById('confirm-modal-cancel')
  var confirmCallback = null
  var confirmWord = ''

  var confirmIsPassword = false

  function openConfirmModal(opts) {
    if (!confirmModal) return
    confirmIsPassword = !!opts.passwordMode
    confirmWord = opts.word || 'BORRAR'
    confirmTitle.textContent = opts.title || ''
    confirmDesc.textContent = opts.desc || ''
    confirmInput.setAttribute('placeholder', opts.placeholder || '')
    confirmInput.value = ''
    confirmInput.type = confirmIsPassword ? 'password' : 'text'
    confirmBtn.disabled = true
    confirmCallback = opts.onConfirm || null
    confirmModal.style.display = ''
    setTimeout(function () { confirmInput.focus() }, 100)
  }

  function closeConfirmModal() {
    if (confirmModal) confirmModal.style.display = 'none'
    confirmCallback = null
    if (confirmInput) { confirmInput.value = ''; confirmInput.type = 'text' }
    confirmIsPassword = false
  }

  if (confirmInput) {
    confirmInput.addEventListener('input', function () {
      confirmBtn.disabled = confirmIsPassword
        ? confirmInput.value.length === 0
        : confirmInput.value.trim() !== confirmWord
    })
    confirmInput.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && !confirmBtn.disabled && confirmCallback) {
        confirmCallback()
        closeConfirmModal()
      }
    })
  }
  if (confirmBtn) {
    confirmBtn.addEventListener('click', function () {
      if (confirmCallback) confirmCallback()
      closeConfirmModal()
    })
  }
  if (confirmCancel) confirmCancel.addEventListener('click', closeConfirmModal)
  if (confirmModal) {
    confirmModal.addEventListener('click', function (e) {
      if (e.target === confirmModal) closeConfirmModal()
    })
  }

  // === Debug destructive actions ===
  var dlang = document.documentElement.lang || 'es'
  var cword = dlang === 'es' ? 'BORRAR' : 'DELETE'
  var cplaceholder = dlang === 'es' ? 'Escribe BORRAR para confirmar' : 'Type DELETE to confirm'

  function debugDestructiveAction(btnId, endpoint, title, desc, successMsg) {
    var btn = document.getElementById(btnId)
    if (!btn) return
    btn.addEventListener('click', function () {
      openConfirmModal({
        title: title,
        desc: desc,
        word: cword,
        placeholder: cplaceholder,
        onConfirm: function () {
          fetch(endpoint, { method: 'POST' })
            .then(function (r) {
              if (r.ok) { showToast(successMsg, 'success') }
              else { throw new Error('fail') }
            })
            .catch(function () { showToast('Error', 'error') })
        }
      })
    })
  }

  debugDestructiveAction('btn-clear-cache', '/console/api/console/clear-cache',
    dlang === 'es' ? '¿Limpiar todo el cache?' : 'Clear all cache?',
    dlang === 'es' ? 'Se borrará todo el cache de Redis (resolución de usuarios, contextos, sesiones).' : 'All Redis cache will be cleared (user resolution, contexts, sessions).',
    dlang === 'es' ? 'Cache limpiado' : 'Cache cleared')

  debugDestructiveAction('btn-clear-memory', '/console/api/console/clear-memory',
    dlang === 'es' ? '¿Limpiar la memoria?' : 'Clear memory?',
    dlang === 'es' ? 'Se borrarán mensajes, sesiones, contactos y logs. Se conservan knowledge, subagentes, herramientas, prompts y configuración.' : 'Messages, sessions, contacts and logs will be deleted. Knowledge, subagents, tools, prompts and config are preserved.',
    dlang === 'es' ? 'Memoria limpiada' : 'Memory cleared')

  debugDestructiveAction('btn-clear-agent', '/console/api/console/clear-agent',
    dlang === 'es' ? '¿Limpiar el agente?' : 'Clear agent?',
    dlang === 'es' ? 'Se borrarán knowledge base, subagentes, herramientas y prompts. Los subagentes de sistema se re-siembran automáticamente.' : 'Knowledge base, subagents, tools and prompts will be deleted. System subagents are re-seeded automatically.',
    dlang === 'es' ? 'Agente limpiado' : 'Agent cleared')

  // Admin override dropdown: test as lead/coworker
  ;(function () {
    var sel = document.getElementById('debug-admin-override')
    if (!sel) return
    sel.addEventListener('change', function () {
      var val = sel.value
      fetch('/console/api/console/admin-override', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ overrideType: val })
      })
        .then(function (r) {
          if (r.ok) {
            showToast(
              val
                ? (dlang === 'es' ? 'Admin tratado como ' + val : 'Admin treated as ' + val)
                : (dlang === 'es' ? 'Override desactivado' : 'Override disabled'),
              'success'
            )
          } else { throw new Error('fail') }
        })
        .catch(function () { showToast('Error', 'error') })
    })
  })()



  // Factory reset: password-protected, triggers wizard with prefilled values
  ;(function () {
    var btn = document.getElementById('btn-factory-reset')
    if (!btn) return
    btn.addEventListener('click', function () {
      openConfirmModal({
        title: dlang === 'es' ? '⚠️ Reset de fábrica' : '⚠️ Factory reset',
        desc: dlang === 'es'
          ? 'Se reiniciará el wizard de instalación con los valores actuales precargados. Ingresa tu contraseña de admin para confirmar.'
          : 'The installation wizard will restart with current values preloaded. Enter your admin password to confirm.',
        passwordMode: true,
        placeholder: dlang === 'es' ? 'Contraseña de admin' : 'Admin password',
        onConfirm: function () {
          var pw = confirmInput.value
          fetch('/console/api/console/factory-reset', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ password: pw })
          })
            .then(function (r) {
              if (r.status === 403) { showToast(dlang === 'es' ? 'Contraseña incorrecta' : 'Invalid password', 'error'); return }
              if (!r.ok) throw new Error('fail')
              return r.json()
            })
            .then(function (data) {
              if (!data) return
              showToast(dlang === 'es' ? 'Redirigiendo al wizard...' : 'Redirecting to wizard...', 'success')
              var setupCookie = 'luna_setup_token=' + data.prefillToken + '; path=/'
              document.cookie = setupCookie
              setTimeout(function () { window.location.href = '/setup' }, 500)
            })
            .catch(function () { showToast('Error', 'error') })
        }
      })
    })
  })()

  // === Language submenu (accordion in user dropdown) ===
  var langTrigger = document.getElementById('lang-submenu-trigger')
  var langPanel = document.getElementById('lang-submenu')
  if (langTrigger && langPanel) {
    langTrigger.addEventListener('click', function (e) {
      e.stopPropagation()
      langPanel.classList.toggle('open')
      langTrigger.classList.toggle('open')
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
      + '<div class="wizard-steps">'
      + '<div class="wizard-title">' + title + '</div>'
      + bodyHtml + '</div></div>'
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
  // Layout per page: step title (no number) → instructions → fields → nav buttons
  function renderWizardFromManifest(channelId, wizard, lang) {
    var isEs = (lang || 'es') === 'es'
    var lk = isEs ? 'es' : 'en'
    var steps = wizard.steps || []
    var title = (wizard.title && wizard.title[lk]) || channelId
    var totalSteps = steps.length

    // Step count label
    var body = '<div class="wizard-step-count">' + totalSteps + (isEs ? ' pasos' : ' steps') + '</div>'

    // Dot indicator (numbers inside dots)
    body += '<div class="wizard-step-indicator" id="wizard-dots">'
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
      // Replace {BASE_URL} placeholder with actual server origin
      instructions = instructions.replace(/\{BASE_URL\}/g, location.origin)
      var isLast = i === totalSteps - 1

      body += '<div class="wizard-page' + (i === 0 ? ' active' : '') + '" data-page="' + i + '">'
      body += '<div class="wizard-page-title">' + stepTitle + '</div>'
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
      body += '<div class="wizard-error" style="display:none"></div>'
      body += '<div class="wizard-actions">'
      if (i === 0) {
        body += '<button class="wizard-btn wizard-btn-secondary" onclick="closeConnectModal()">' + (isEs ? 'Cancelar' : 'Cancel') + '</button>'
      } else {
        body += '<button class="wizard-btn wizard-btn-secondary" onclick="chWizardGoTo(' + (i - 1) + ')">' + (isEs ? 'Anterior' : 'Back') + '</button>'
      }
      if (isLast) {
        body += '<button class="wizard-btn wizard-btn-primary" onclick="saveWizardFields(\'' + channelId + '\', \'' + lang + '\', ' + (wizard.saveEndpoint ? "'" + wizard.saveEndpoint + "'" : 'null') + ')">' + (isEs ? 'Guardar y conectar' : 'Save & connect') + '</button>'
      } else {
        body += '<button class="wizard-btn wizard-btn-primary" onclick="chWizardGoTo(' + (i + 1) + ')">' + (isEs ? 'Siguiente' : 'Next') + '</button>'
      }
      body += '</div>'
      body += '</div>' // end wizard-page
    }

    createConnectModal(title, body)
  }

  // Navigate channel wizard tabs (uses data-page, 0-based — separate from OAuth wizard)
  window.chWizardGoTo = function (pageIdx) {
    var modal = document.getElementById('ch-connect-modal')
    if (!modal) return
    var pages = modal.querySelectorAll('[data-page]')
    var dots = modal.querySelectorAll('.wizard-dot')
    var lines = modal.querySelectorAll('.wizard-dot-line')
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
    var errs = modal.querySelectorAll('.wizard-error')
    for (var e = 0; e < errs.length; e++) errs[e].style.display = 'none'
    // Scroll modal to top
    var mBody = modal.querySelector('.wizard-modal')
    if (mBody) mBody.scrollTop = 0
  }

  // Copy URI helper for channel wizards (reuses pattern from OAuth wizard)
  window.copyChWizardUri = function (btn) {
    var box = btn.closest('.wizard-uri-box')
    var code = box ? box.querySelector('.wizard-uri') : null
    if (!code) return
    navigator.clipboard.writeText(code.textContent).then(function () {
      var origHtml = btn.innerHTML
      btn.innerHTML = CHECK_ICON
      btn.classList.add('copied')
      setTimeout(function () { btn.innerHTML = origHtml; btn.classList.remove('copied') }, 2000)
    })
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

      // Step count
      var body = '<div class="wizard-step-count">' + totalWa + (isEs ? ' pasos' : ' steps') + '</div>'

      // Dot indicator
      body += '<div class="wizard-step-indicator" id="wizard-dots">'
      for (var d = 0; d < totalWa; d++) {
        if (d > 0) body += '<div class="wizard-dot-line"></div>'
        body += '<div class="wizard-dot' + (d === 0 ? ' active' : '') + '" data-dot="' + d + '">' + (d + 1) + '</div>'
      }
      body += '</div>'

      // Pages from manifest
      for (var p = 0; p < totalWa; p++) {
        var ws = waSteps[p]
        var isLastWa = p === totalWa - 1

        var waInstr = (ws.instructions[lk] || '').replace(/\{BASE_URL\}/g, location.origin)
        body += '<div class="wizard-page' + (p === 0 ? ' active' : '') + '" data-page="' + p + '">'
        body += '<div class="wizard-page-title">' + (ws.title[lk] || '') + '</div>'
        body += '<div class="wizard-instructions">' + waInstr + '</div>'

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
          body += '<button class="wizard-btn wizard-btn-secondary" onclick="chWizardGoTo(' + (p - 1) + ')">' + (isEs ? 'Anterior' : 'Back') + '</button>'
          if (!isLastWa) {
            body += '<button class="wizard-btn wizard-btn-primary" onclick="wizardGoToWa(' + (p + 1) + ', \'' + lang + '\')">' + (isEs ? 'Siguiente' : 'Next') + '</button>'
          }
        }
        body += '</div>'
        body += '</div>' // end wizard-page
      }

      createConnectModal(waTitle, body)

    } else if (channelId === 'gmail') {
      // ── Gmail: redirect to Google Workspace config (gmail is managed there) ──
      window.location.href = '/console/google-apps?lang=' + (document.documentElement.lang || 'es')
      return

    } else {
      // ── Generic: google-chat, twilio-voice, future channels — all from manifest ──
      renderWizardFromManifest(channelId, wizard, lang)
    }
  }

  // WhatsApp: navigate to QR step — auto-triggers QR generation on last step
  var _waLastQrUrl = '' // Track last QR to detect changes

  window.wizardGoToWa = function (pageIdx, lang) {
    chWizardGoTo(pageIdx)
    var pages = document.querySelectorAll('.wizard-page')
    if (pageIdx === pages.length - 1) {
      startWhatsAppQRAuto(lang)
    }
  }

  // Track when last QR was received to show a subtle "refreshing" hint
  var _waLastQrTime = 0

  function updateWaCountdown(countdownEl, isEs) {
    if (!countdownEl) return
    var elapsed = Math.floor((Date.now() - _waLastQrTime) / 1000)
    if (elapsed < 18) {
      countdownEl.textContent = ''
    } else {
      countdownEl.textContent = isEs ? 'Actualizando codigo...' : 'Refreshing code...'
    }
  }

  function startWhatsAppQRAuto(lang) {
    var isEs = (lang || 'es') === 'es'
    var qrArea = document.getElementById('ch-wa-qr-area')
    var statusEl = document.getElementById('ch-wa-status')
    var countdownEl = document.getElementById('ch-wa-countdown')
    if (!qrArea) return

    // Reset state
    if (_chConnectPoll) { clearInterval(_chConnectPoll); _chConnectPoll = null }
    _waLastQrUrl = ''
    _waLastQrTime = 0

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
                qrArea.innerHTML = '<div style="color:var(--success);font-weight:600;font-size:18px">&#10003; ' + (isEs ? 'Conectado exitosamente' : 'Connected successfully') + '</div>'
                if (statusEl) statusEl.textContent = data.connectedNumber ? (isEs ? 'Numero: ' : 'Number: ') + data.connectedNumber : ''
                if (countdownEl) countdownEl.textContent = ''
                setTimeout(function () { closeConnectModal(); window.location.reload() }, 2000)
              } else if (data.qrDataUrl) {
                // Update QR image when it changes; show "refreshing" hint when stale
                if (data.qrDataUrl !== _waLastQrUrl) {
                  _waLastQrUrl = data.qrDataUrl
                  _waLastQrTime = Date.now()
                  qrArea.innerHTML = '<div class="wa-qr-container"><img src="' + data.qrDataUrl + '" alt="QR" class="wa-qr-img"></div>'
                  if (statusEl) statusEl.textContent = isEs ? 'Escanea este codigo con WhatsApp' : 'Scan this code with WhatsApp'
                  if (countdownEl) countdownEl.textContent = ''
                }
                updateWaCountdown(countdownEl, isEs)
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

  // ── Budget modal ──
  // Persists CHANNEL_BUDGET_{channelId} to config_store via /console/save + /console/apply
  window.openBudgetModal = function (channelId, lang, currentBudget) {
    var isEs = (lang || 'es') === 'es'
    var title = isEs ? 'Configurar presupuesto' : 'Set budget'
    var note = isEs
      ? 'Presupuesto mensual (30 dias) en USD. Se ajusta proporcionalmente al periodo seleccionado en el filtro.'
      : 'Monthly budget (30 days) in USD. Adjusts proportionally to the selected filter period.'
    var saveLabel = isEs ? 'Guardar' : 'Save'
    var cancelLabel = isEs ? 'Descartar' : 'Discard'
    var inputLabel = isEs ? 'Presupuesto mensual (USD)' : 'Monthly budget (USD)'

    var existing = document.getElementById('budget-modal')
    if (existing) existing.remove()

    var modal = document.createElement('div')
    modal.id = 'budget-modal'
    modal.className = 'wizard-overlay'
    modal.innerHTML = '<div class="wizard-modal" style="max-width:400px">'
      + '<button class="wizard-close" onclick="closeBudgetModal()">&times;</button>'
      + '<div class="wizard-steps">'
      + '<div class="wizard-title">' + title + '</div>'
      + '<p class="wizard-text" style="font-size:0.82rem;color:var(--on-surface-variant);margin-bottom:16px">' + note + '</p>'
      + '<label class="wizard-label">' + inputLabel + '</label>'
      + '<input type="number" id="budget-input" class="wizard-input" min="0" step="1" value="' + (currentBudget || '') + '" placeholder="0">'
      + '<div id="budget-error" class="wizard-error" style="display:none"></div>'
      + '<div class="wizard-actions">'
      + '<button class="wizard-btn wizard-btn-secondary" onclick="closeBudgetModal()">' + cancelLabel + '</button>'
      + '<button class="wizard-btn wizard-btn-primary" onclick="saveBudget(\'' + channelId + '\', \'' + lang + '\')">' + saveLabel + '</button>'
      + '</div>'
      + '</div></div>'
    modal.addEventListener('click', function (e) { if (e.target === modal) closeBudgetModal() })
    document.body.appendChild(modal)
    var input = document.getElementById('budget-input')
    if (input) input.focus()
  }

  window.closeBudgetModal = function () {
    var m = document.getElementById('budget-modal')
    if (m) m.remove()
  }

  window.saveBudget = function (channelId, lang) {
    var isEs = (lang || 'es') === 'es'
    var input = document.getElementById('budget-input')
    var errEl = document.getElementById('budget-error')
    if (!input) return
    var val = parseInt(input.value, 10)
    if (isNaN(val) || val < 0) {
      if (errEl) { errEl.textContent = isEs ? 'Ingresa un valor valido' : 'Enter a valid value'; errEl.style.display = 'block' }
      return
    }
    var key = 'CHANNEL_BUDGET_' + channelId.toUpperCase().replace(/-/g, '_')
    var body = '_section=' + encodeURIComponent(channelId) + '&_lang=' + encodeURIComponent(lang) + '&' + encodeURIComponent(key) + '=' + val
    fetch('/console/save', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: body })
      .then(function () {
        return fetch('/console/apply', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: '_section=' + encodeURIComponent(channelId) + '&_lang=' + encodeURIComponent(lang) })
      })
      .then(function () {
        closeBudgetModal()
        showToast(isEs ? 'Presupuesto guardado' : 'Budget saved', 'success')
        window.location.reload()
      })
      .catch(function () {
        if (errEl) { errEl.textContent = isEs ? 'Error al guardar' : 'Save error'; errEl.style.display = 'block' }
      })
  }

  // ── WhatsApp: force reconnect + retry status polling ──
  window.waForceRetry = function (lang) {
    var btn = document.getElementById('wa-force-retry')
    if (btn) { btn.disabled = true; btn.textContent = '...' }
    fetch('/console/api/whatsapp/force-reconnect', { method: 'POST' })
      .then(function () { window.location.reload() })
      .catch(function () { window.location.reload() })
  }

  // Poll WhatsApp retry status on channel settings page (when disconnected)
  ;(function () {
    var retryInfo = document.getElementById('wa-retry-info')
    var retryBtn = document.getElementById('wa-force-retry')
    var disconnectCredsBtn = document.getElementById('wa-disconnect-creds')
    if (!retryInfo && !retryBtn && !disconnectCredsBtn) return
    var isEs = (document.documentElement.lang || 'es') === 'es'

    function formatRetryDelay(ms) {
      var s = Math.ceil(ms / 1000)
      if (s < 60) return s + 's'
      var m = Math.ceil(s / 60)
      return m + (isEs ? ' min' : ' min')
    }

    function pollRetryStatus() {
      fetch('/console/api/whatsapp/status')
        .then(function (r) { return r.json() })
        .then(function (data) {
          // Show disconnect button whenever there are saved credentials
          if (disconnectCredsBtn) {
            disconnectCredsBtn.style.display = data.hasCreds ? '' : 'none'
          }

          if (data.status === 'connected') {
            window.location.reload()
            return
          }
          if (data.status === 'qr_ready' || data.status === 'connecting') {
            if (retryInfo) { retryInfo.textContent = isEs ? '— reconectando...' : '— reconnecting...'; retryInfo.style.display = '' }
            if (retryBtn) retryBtn.style.display = 'none'
            return
          }
          if (data.nextRetryAt) {
            var remaining = data.nextRetryAt - Date.now()
            if (remaining > 0) {
              if (retryInfo) { retryInfo.textContent = (isEs ? '— reintento en ' : '— retry in ') + formatRetryDelay(remaining); retryInfo.style.display = '' }
              if (retryBtn) retryBtn.style.display = ''
            } else {
              if (retryInfo) { retryInfo.textContent = isEs ? '— reconectando...' : '— reconnecting...'; retryInfo.style.display = '' }
              if (retryBtn) retryBtn.style.display = 'none'
            }
          } else if (data.reconnectAttempt >= 10) {
            if (retryInfo) { retryInfo.textContent = isEs ? '— reconexion agotada' : '— reconnection exhausted'; retryInfo.style.display = '' }
            if (retryBtn) retryBtn.style.display = ''
          } else {
            if (retryInfo) retryInfo.style.display = 'none'
            if (retryBtn) retryBtn.style.display = ''
          }
        })
        .catch(function () {})
    }

    pollRetryStatus()
    setInterval(pollRetryStatus, 5000)
  })()

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

// === Database Viewer — password gate + spreadsheet UI ===
;(function () {
  var dlang = document.documentElement.lang || 'es'

  // Button in debug dropdown → navigate directly to db viewer page (page handles auth)
  var btnDbViewer = document.getElementById('btn-db-viewer')
  if (btnDbViewer) {
    btnDbViewer.addEventListener('click', function () {
      window.location.href = '/console/debug/database'
    })
  }

  // Database viewer page logic — password gate on page load
  var dbAuthGate = document.getElementById('db-auth-gate')
  var dbContainer = document.getElementById('db-viewer-container')
  if (!dbAuthGate || !dbContainer) return

  var authPassword = document.getElementById('db-auth-password')
  var authSubmit = document.getElementById('db-auth-submit')
  var authError = document.getElementById('db-auth-error')

  function doAuth() {
    var pw = authPassword.value.trim()
    if (!pw) return
    authSubmit.disabled = true
    authError.style.display = 'none'

    fetch('/console/api/console/db-viewer-auth', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: pw })
    })
      .then(function (r) {
        if (r.status === 403) {
          authError.textContent = dlang === 'es' ? 'Contraseña incorrecta' : 'Invalid password'
          authError.style.display = ''
          authSubmit.disabled = false
          authPassword.value = ''
          authPassword.focus()
          return
        }
        if (!r.ok) throw new Error('fail')
        return r.json()
      })
      .then(function (data) {
        if (!data || !data.ok) return
        // Auth success — hide gate, show viewer, load tables
        dbAuthGate.style.display = 'none'
        dbContainer.style.display = ''
        loadTables()
      })
      .catch(function () {
        authError.textContent = 'Error'
        authError.style.display = ''
        authSubmit.disabled = false
      })
  }

  authSubmit.addEventListener('click', doAuth)
  authPassword.addEventListener('keydown', function (e) {
    if (e.key === 'Enter') doAuth()
  })
  // Auto-focus password field
  setTimeout(function () { authPassword.focus() }, 100)

  // === Viewer logic (runs after auth) ===
  var tableList = document.getElementById('db-table-list')
  var gridHead = document.getElementById('db-grid-head')
  var gridBody = document.getElementById('db-grid-body')
  var gridScroll = document.getElementById('db-grid-scroll')
  var emptyState = document.getElementById('db-empty-state')
  var toolbar = document.getElementById('db-toolbar')
  var tableNameEl = document.getElementById('db-current-table')
  var tableMeta = document.getElementById('db-current-meta')
  var paginationEl = document.getElementById('db-pagination')
  var pageInfo = document.getElementById('db-pagination-info')
  var pageNum = document.getElementById('db-page-num')
  var btnPrev = document.getElementById('db-prev')
  var btnNext = document.getElementById('db-next')
  var perPageSel = document.getElementById('db-per-page')

  var currentTable = ''
  var currentPage = 1
  var currentLimit = 50
  var currentTotal = 0

  function loadTables() {
    fetch('/console/api/console/db-tables')
      .then(function (r) { return r.json() })
      .then(function (data) {
        if (!data.tables || data.tables.length === 0) {
          tableList.innerHTML = '<div class="db-empty-item">' + (dlang === 'es' ? 'Sin tablas' : 'No tables') + '</div>'
          return
        }
        tableList.innerHTML = ''
        data.tables.forEach(function (t) {
          var item = document.createElement('div')
          item.className = 'db-table-item'
          item.setAttribute('data-table', t.name)
          item.innerHTML = '<span class="db-table-item-name">' + escHtml(t.name) + '</span>' +
            '<span class="db-table-item-count">' + (t.rowCount >= 0 ? t.rowCount : '?') + '</span>'
          item.addEventListener('click', function () {
            var prev = tableList.querySelector('.db-table-item.active')
            if (prev) prev.classList.remove('active')
            item.classList.add('active')
            currentTable = t.name
            currentPage = 1
            loadTableData()
          })
          tableList.appendChild(item)
        })
      })
      .catch(function () {
        tableList.innerHTML = '<div class="db-empty-item">Error</div>'
      })
  }

  function loadTableData() {
    if (!currentTable) return
    gridBody.innerHTML = '<tr><td colspan="100" style="text-align:center;padding:2rem;color:var(--on-surface-dim)">' +
      (dlang === 'es' ? 'Cargando...' : 'Loading...') + '</td></tr>'
    emptyState.style.display = 'none'
    gridScroll.style.display = ''
    toolbar.style.display = ''
    paginationEl.style.display = ''

    fetch('/console/api/console/db-table-data?table=' + encodeURIComponent(currentTable) +
      '&page=' + currentPage + '&limit=' + currentLimit)
      .then(function (r) {
        if (!r.ok) throw new Error('fail')
        return r.json()
      })
      .then(function (data) {
        currentTotal = data.total
        tableNameEl.textContent = currentTable
        tableMeta.textContent = data.total + ' ' + (dlang === 'es' ? 'filas' : 'rows') +
          ' · ' + data.columns.length + ' ' + (dlang === 'es' ? 'columnas' : 'columns')

        // Header
        gridHead.innerHTML = '<tr class="db-grid-head-row">' +
          '<th class="db-grid-th db-row-num">#</th>' +
          data.columns.map(function (c) {
            return '<th class="db-grid-th" title="' + escHtml(c.type) + '">' + escHtml(c.name) +
              '<span class="db-col-type">' + escHtml(c.type) + '</span></th>'
          }).join('') + '</tr>'

        // Body
        if (data.rows.length === 0) {
          gridBody.innerHTML = '<tr><td colspan="' + (data.columns.length + 1) +
            '" style="text-align:center;padding:2rem;color:var(--on-surface-dim)">' +
            (dlang === 'es' ? 'Sin datos' : 'No data') + '</td></tr>'
        } else {
          var startRow = (currentPage - 1) * currentLimit
          gridBody.innerHTML = data.rows.map(function (row, idx) {
            return '<tr class="db-grid-row">' +
              '<td class="db-grid-td db-row-num">' + (startRow + idx + 1) + '</td>' +
              data.columns.map(function (c) {
                var val = row[c.name]
                if (val === null || val === undefined) {
                  return '<td class="db-grid-td db-cell-null">NULL</td>'
                }
                var str = String(val)
                var isJson = (typeof val === 'string' && (val.charAt(0) === '{' || val.charAt(0) === '['))
                var cls = 'db-grid-td' + (isJson ? ' db-cell-json' : '')
                return '<td class="' + cls + '" title="' + escHtml(str) + '">' + escHtml(str) + '</td>'
              }).join('') + '</tr>'
          }).join('')
        }

        // Pagination
        var totalPages = Math.max(1, Math.ceil(currentTotal / currentLimit))
        var from = data.rows.length > 0 ? ((currentPage - 1) * currentLimit + 1) : 0
        var to = from + data.rows.length - (data.rows.length > 0 ? 1 : 0)
        pageInfo.textContent = from + '-' + to + ' / ' + currentTotal
        pageNum.textContent = currentPage + ' / ' + totalPages
        btnPrev.disabled = currentPage <= 1
        btnNext.disabled = currentPage >= totalPages
      })
      .catch(function () {
        gridBody.innerHTML = '<tr><td colspan="100" style="text-align:center;padding:2rem;color:var(--error)">Error</td></tr>'
      })
  }

  if (btnPrev) btnPrev.addEventListener('click', function () {
    if (currentPage > 1) { currentPage--; loadTableData() }
  })
  if (btnNext) btnNext.addEventListener('click', function () {
    var totalPages = Math.max(1, Math.ceil(currentTotal / currentLimit))
    if (currentPage < totalPages) { currentPage++; loadTableData() }
  })
  if (perPageSel) perPageSel.addEventListener('change', function () {
    currentLimit = parseInt(perPageSel.value, 10) || 50
    currentPage = 1
    loadTableData()
  })

  function escHtml(s) {
    if (!s) return ''
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
  }
})()

// ═══════════════════════════════════════════
// Volume Selector — live value display
// ═══════════════════════════════════════════
;(function () {
  document.querySelectorAll('.volume-selector-input').forEach(function (input) {
    var displayId = input.getAttribute('data-vol-display')
    var unit = input.getAttribute('data-vol-unit') || ''
    var display = displayId ? document.getElementById(displayId) : null
    if (!display) return
    function updateDisplay() {
      display.textContent = unit ? input.value + ' ' + unit : input.value
    }
    input.addEventListener('input', updateDisplay)
  })
})()

// ═══════════════════════════════════════════
// Code Editor — line numbers + cursor position
// ═══════════════════════════════════════════
;(function () {
  document.querySelectorAll('.code-editor-textarea').forEach(function (ta) {
    var key = ta.getAttribute('data-ce-key')
    var linesEl = document.querySelector('[data-ce-lines="' + key + '"]')
    var posEl = document.querySelector('[data-ce-pos="' + key + '"]')

    function updateLines() {
      if (!linesEl) return
      var count = (ta.value || '').split('\n').length
      var nums = ''
      for (var i = 1; i <= count; i++) nums += '<span class="code-editor-line-num">' + i + '</span>'
      linesEl.innerHTML = nums
    }

    function updatePos() {
      if (!posEl) return
      var val = ta.value.substring(0, ta.selectionStart)
      var lines = val.split('\n')
      var ln = lines.length
      var col = (lines[lines.length - 1] || '').length + 1
      posEl.textContent = 'LN ' + ln + ', COL ' + col
    }

    ta.addEventListener('input', function () { updateLines(); updatePos() })
    ta.addEventListener('click', updatePos)
    ta.addEventListener('keyup', updatePos)

    // Sync scroll between lines and textarea
    ta.addEventListener('scroll', function () {
      if (linesEl) linesEl.style.transform = 'translateY(-' + ta.scrollTop + 'px)'
    })
  })
})()

// ═══════════════════════════════════════════
// Channel Settings Tabs
// ═══════════════════════════════════════════
;(function () {
  document.querySelectorAll('.chs-tabs').forEach(function (tabBar) {
    var tabs = tabBar.querySelectorAll('.chs-tab')
    var parent = tabBar.parentElement
    tabs.forEach(function (tab) {
      tab.addEventListener('click', function () {
        var target = tab.getAttribute('data-tab')
        tabs.forEach(function (t) { t.classList.remove('active') })
        tab.classList.add('active')
        if (parent) {
          parent.querySelectorAll('.chs-tab-content').forEach(function (c) {
            c.classList.toggle('active', c.getAttribute('data-tab-content') === target)
          })
        }
      })
    })
  })
})()

// ═══════════════════════════════════════════
// Header Search — functional search across params/tabs/settings
// ═══════════════════════════════════════════
;(function () {
  var searchInput = document.getElementById('header-search')
  var searchWrap = searchInput ? searchInput.closest('.header-search') : null
  if (!searchInput || !searchWrap) return

  var resultsEl = document.createElement('div')
  resultsEl.className = 'search-results'
  searchWrap.appendChild(resultsEl)

  var debounceTimer = null
  var searchCache = null

  function fetchSearchIndex() {
    if (searchCache) return Promise.resolve(searchCache)
    return fetch('/console/api/console/search-index')
      .then(function (r) { return r.json() })
      .then(function (data) { searchCache = data; return data })
      .catch(function () { return { items: [] } })
  }

  function doSearch(query) {
    if (!query || query.length < 2) { resultsEl.classList.remove('open'); return }
    fetchSearchIndex().then(function (data) {
      var q = query.toLowerCase()
      var matches = (data.items || []).filter(function (item) {
        return (item.label || '').toLowerCase().includes(q) ||
               (item.key || '').toLowerCase().includes(q) ||
               (item.section || '').toLowerCase().includes(q)
      })
      if (matches.length === 0) {
        resultsEl.innerHTML = '<div class="search-results-empty">Sin resultados</div>'
        resultsEl.classList.add('open')
        return
      }
      // Group by section
      var groups = {}
      matches.slice(0, 20).forEach(function (m) {
        var sec = m.section || 'General'
        if (!groups[sec]) groups[sec] = []
        groups[sec].push(m)
      })
      var html = ''
      Object.keys(groups).forEach(function (sec) {
        html += '<div class="search-results-group"><div class="search-results-group-label">' + escHtmlSearch(sec) + '</div>'
        groups[sec].forEach(function (item) {
          html += '<a class="search-results-item" href="' + escHtmlSearch(item.url || '#') + '">'
          html += '<span class="search-results-item-icon"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg></span>'
          html += '<span class="search-results-item-text"><span class="search-results-item-label">' + escHtmlSearch(item.label) + '</span></span>'
          html += '</a>'
        })
        html += '</div>'
      })
      resultsEl.innerHTML = html
      resultsEl.classList.add('open')
    })
  }

  searchInput.addEventListener('input', function () {
    clearTimeout(debounceTimer)
    debounceTimer = setTimeout(function () { doSearch(searchInput.value.trim()) }, 300)
  })

  // Close on outside click
  document.addEventListener('click', function (e) {
    if (!searchWrap.contains(e.target)) resultsEl.classList.remove('open')
  })

  // Close on Escape
  searchInput.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') { resultsEl.classList.remove('open'); searchInput.blur() }
  })

  function escHtmlSearch(s) {
    if (!s) return ''
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
  }

  // ═══ Tooltip auto-positioning (prevent overflow) ═══
  // Covers both tooltip systems: .info-btn/.info-tooltip and .ch-info-btn/.ch-info-tip
  var TOOLTIP_PAIRS = [
    { btn: 'info-btn',    tip: 'info-tooltip' },
    { btn: 'ch-info-btn', tip: 'ch-info-tip'  },
  ]

  // Returns the right-edge (px from left of viewport) of the nearest ancestor
  // that clips overflow (overflow hidden/scroll/auto/clip), or viewport width.
  function getClipRight(el) {
    var node = el.parentElement
    while (node && node !== document.documentElement) {
      var ov = window.getComputedStyle(node).overflow
      if (ov === 'hidden' || ov === 'scroll' || ov === 'auto' || ov === 'clip') {
        return node.getBoundingClientRect().right
      }
      node = node.parentElement
    }
    return window.innerWidth || document.documentElement.clientWidth
  }

  document.addEventListener('mouseover', function (e) {
    var target = e.target
    var pair = null
    for (var i = 0; i < TOOLTIP_PAIRS.length; i++) {
      if (target.closest && target.closest('.' + TOOLTIP_PAIRS[i].btn)) {
        pair = TOOLTIP_PAIRS[i]
        break
      }
    }
    if (!pair) return

    var btn = target.closest('.' + pair.btn)
    var tooltip = btn.nextElementSibling
    if (!tooltip || !tooltip.classList.contains(pair.tip)) return

    // Reset first so rect reflects default left:0 position
    tooltip.classList.remove('info-flip')

    var rect = tooltip.getBoundingClientRect()
    var clipRight = getClipRight(tooltip)

    if (rect.right > clipRight - 8) {
      tooltip.classList.add('info-flip')
    }
  })
})()
