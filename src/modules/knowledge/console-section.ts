// LUNA — Module: knowledge — Console section renderer
// Server-side rendered HTML for the knowledge items management UI.

import type { KnowledgeItem, KnowledgeCategory } from './types.js'

type Lang = 'es' | 'en'

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')
}

const t = (key: string, lang: Lang): string => {
  const map: Record<string, { es: string; en: string }> = {
    title: { es: 'Conocimiento adicional', en: 'Additional knowledge' },
    add_btn: { es: 'Agregar Conocimiento', en: 'Add Knowledge' },
    no_items: { es: 'No hay items de conocimiento. Agrega uno para comenzar.', en: 'No knowledge items. Add one to get started.' },
    item_title: { es: 'Título', en: 'Title' },
    item_desc: { es: 'Descripción', en: 'Description' },
    item_category: { es: 'Categoría', en: 'Category' },
    item_url: { es: 'URL de Google (Sheets, Docs o Drive)', en: 'Google URL (Sheets, Docs or Drive)' },
    save: { es: 'Guardar', en: 'Save' },
    cancel: { es: 'Cancelar', en: 'Cancel' },
    scan_tabs: { es: 'Escanear Tabs', en: 'Scan Tabs' },
    scan_cols: { es: 'Escanear Columnas', en: 'Scan Columns' },
    load_content: { es: 'Cargar Contenido', en: 'Load Content' },
    active: { es: 'Activo', en: 'Active' },
    inactive: { es: 'Inactivo', en: 'Inactive' },
    core: { es: 'Core', en: 'Core' },
    delete_btn: { es: 'Eliminar', en: 'Delete' },
    tabs: { es: 'Tabs', en: 'Tabs' },
    columns: { es: 'Columnas', en: 'Columns' },
    no_tabs: { es: 'Sin tabs escaneadas', en: 'No tabs scanned' },
    no_cols: { es: 'Sin columnas escaneadas', en: 'No columns scanned' },
    tab_desc: { es: 'Descripción del tab', en: 'Tab description' },
    col_desc: { es: 'Descripción', en: 'Description' },
    source_sheets: { es: 'Sheets', en: 'Sheets' },
    source_docs: { es: 'Docs', en: 'Docs' },
    source_drive: { es: 'Drive', en: 'Drive' },
    status_pending: { es: 'Pendiente', en: 'Pending' },
    status_processing: { es: 'Procesando', en: 'Processing' },
    status_done: { es: 'Listo', en: 'Done' },
    status_failed: { es: 'Error', en: 'Failed' },
    chunks: { es: 'chunks', en: 'chunks' },
    content_loaded: { es: 'Contenido cargado', en: 'Content loaded' },
    not_loaded: { es: 'Sin cargar', en: 'Not loaded' },
    confirm_delete: { es: '¿Eliminar este item?', en: 'Delete this item?' },
    settings_title: { es: 'Configuración', en: 'Settings' },
  }
  return map[key]?.[lang] ?? key
}

export function renderKnowledgeSection(
  items: KnowledgeItem[],
  categories: KnowledgeCategory[],
  lang: Lang,
  config?: { faqSheetUrl?: string; faqDescription?: string; productsSheetUrl?: string; productsDescription?: string },
): string {
  let html = ''

  // ── Core knowledge (FAQ + Productos y servicios) ──
  const faqUrl = config?.faqSheetUrl ?? ''
  const faqDesc = config?.faqDescription ?? ''
  const productsUrl = config?.productsSheetUrl ?? ''
  const productsDesc = config?.productsDescription ?? ''
  const descPlaceholder = lang === 'es'
    ? 'Describe el contenido de esta fuente. Esta descripcion se usa como contexto para el agente.'
    : 'Describe this source content. This description is used as context for the agent.'
  html += `<div class="panel" style="margin:0 0 24px 0;padding:0"><div class="panel-body" style="padding:20px">
    <div style="font-size:1rem;font-weight:700;color:var(--on-surface);margin-bottom:12px">${lang === 'es' ? 'Conocimiento principal' : 'Core knowledge'}</div>
    <div style="display:flex;flex-direction:column;gap:14px">
      <div>
        <label style="font-size:12px;font-weight:600;display:block;margin-bottom:4px">FAQ — Google Sheet</label>
        <input type="text" class="wizard-input" name="KNOWLEDGE_FAQ_SHEET_URL" value="${esc(faqUrl)}" data-original="${esc(faqUrl)}" placeholder="https://docs.google.com/spreadsheets/d/..." style="font-size:13px">
        <textarea class="wizard-input" name="KNOWLEDGE_FAQ_DESCRIPTION" data-original="${esc(faqDesc)}" placeholder="${descPlaceholder}" rows="2" style="font-size:13px;margin-top:6px;resize:vertical">${esc(faqDesc)}</textarea>
      </div>
      <div>
        <label style="font-size:12px;font-weight:600;display:block;margin-bottom:4px">${lang === 'es' ? 'Productos y servicios' : 'Products & services'} — Google Sheet</label>
        <input type="text" class="wizard-input" name="KNOWLEDGE_PRODUCTS_SHEET_URL" value="${esc(productsUrl)}" data-original="${esc(productsUrl)}" placeholder="https://docs.google.com/spreadsheets/d/..." style="font-size:13px">
        <textarea class="wizard-input" name="KNOWLEDGE_PRODUCTS_DESCRIPTION" data-original="${esc(productsDesc)}" placeholder="${descPlaceholder}" rows="2" style="font-size:13px;margin-top:6px;resize:vertical">${esc(productsDesc)}</textarea>
      </div>
    </div>
  </div></div>`

  // ── Header with Add + Edit Categories buttons ──
  html += `<div class="ki-header">
    <h2 class="ki-title">${t('title', lang)}</h2>
    <div style="display:flex;gap:8px;align-items:center">
      <button type="button" class="act-btn" onclick="kiOpenCategoriesModal()" style="font-size:13px">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 013 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>
        ${lang === 'es' ? 'Categorias' : 'Categories'}
      </button>
      <button type="button" class="act-btn act-btn-cta" onclick="kiOpenAddModal()">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
        ${t('add_btn', lang)}
      </button>
    </div>
  </div>`

  // ── Items list ──
  if (items.length === 0) {
    html += `<div class="panel"><div class="panel-body panel-body-flat panel-body-empty">
      <p style="color:var(--on-surface-dim)">${t('no_items', lang)}</p>
    </div></div>`
  } else {
    for (const item of items) {
      html += renderItemCard(item, categories, lang)
    }
  }

  // ── Add/Edit Modal ──
  html += renderAddModal(categories, lang)

  // ── Categories Edit Modal ──
  html += renderCategoriesModal(categories, lang)

  // ── Client-side JS ──
  html += renderClientScript(lang)

  // ── Styles ──
  html += renderStyles()

  return html
}

function renderItemCard(item: KnowledgeItem, categories: KnowledgeCategory[], lang: Lang): string {
  const sourceLabel = t(`source_${item.sourceType}`, lang)
  const statusLabel = t(`status_${item.embeddingStatus}`, lang)
  const statusClass = `ki-status-${item.embeddingStatus}`
  const category = categories.find(c => c.id === item.categoryId)
  const isInactive = !item.active

  let html = `<div class="panel ki-item ${isInactive ? 'ki-item-inactive' : ''}" data-item-id="${esc(item.id)}">
    <div class="ki-item-header">
      <div class="ki-item-info">
        <div class="ki-item-title-row">
          <span class="ki-item-name">${esc(item.title)}</span>
          <span class="ki-badge ki-badge-source">${esc(sourceLabel)}</span>
          ${item.isCore ? `<span class="ki-badge ki-badge-core">${t('core', lang)}</span>` : ''}
          <span class="ki-badge ${statusClass}">${esc(statusLabel)}</span>
          ${item.contentLoaded ? `<span class="ki-badge ki-badge-loaded">${item.chunkCount} ${t('chunks', lang)}</span>` : ''}
        </div>
        ${item.description ? `<p class="ki-item-desc">${esc(item.description)}</p>` : ''}
        ${category ? `<span class="ki-tag">${esc(category.title)}</span>` : ''}
      </div>
      <div class="ki-item-actions">`

  // Core checkbox
  html += `<label class="ki-core-label" title="${t('core', lang)}">
    <input type="checkbox" ${item.isCore ? 'checked' : ''} onchange="kiToggleCore('${esc(item.id)}', this.checked)" />
    <span class="ki-core-text">${t('core', lang)}</span>
  </label>`

  // Edit button
  html += `<button type="button" class="act-btn" onclick="kiOpenEditModal('${esc(item.id)}', ${JSON.stringify(esc(item.title)).replace(/'/g, '\\\'')}, ${JSON.stringify(esc(item.description)).replace(/'/g, '\\\'')}, '${esc(item.categoryId ?? '')}', ${JSON.stringify(esc(item.sourceUrl)).replace(/'/g, '\\\'')})" style="font-size:11px;padding:4px 10px">
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 013 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>
  </button>`

  // Active toggle
  html += `<label class="ki-toggle-label">
    <input type="checkbox" class="ki-toggle-input" ${item.active ? 'checked' : ''}
      onchange="kiToggleActive('${esc(item.id)}', this.checked)" />
    <span class="toggle-slider"></span>
  </label>`

  // Delete (only if inactive)
  if (isInactive) {
    html += `<button type="button" class="btn btn-sm btn-danger ki-delete-btn"
      onclick="kiDeleteItem('${esc(item.id)}')">${t('delete_btn', lang)}</button>`
  }

  html += `</div></div>` // close actions + header

  // ── Tabs section ──
  html += `<div class="ki-tabs-section">
    <div class="ki-tabs-header">
      <span class="ki-section-label">${t('tabs', lang)}</span>
      <button type="button" class="btn btn-sm btn-outline ki-scan-btn"
        onclick="kiScanTabs('${esc(item.id)}')">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/><path d="M9 12l2 2 4-4"/></svg>
        ${t('scan_tabs', lang)}
      </button>
    </div>`

  if (item.tabs && item.tabs.length > 0) {
    html += `<div class="ki-tabs-list">`
    for (const tab of item.tabs) {
      html += `<div class="ki-tab-row" data-tab-id="${esc(tab.id)}">
        <div class="ki-tab-name">${esc(tab.tabName)}</div>
        <input type="text" class="ki-tab-desc-input" placeholder="${t('tab_desc', lang)}"
          value="${esc(tab.description)}" onblur="kiSaveTabDesc('${esc(tab.id)}', this.value)" />
        <button type="button" class="btn btn-sm btn-outline ki-scan-cols-btn"
          onclick="kiScanColumns('${esc(tab.id)}', '${esc(item.id)}')">
          ${t('scan_cols', lang)}
        </button>`

      // Columns
      if (tab.columns && tab.columns.length > 0) {
        html += `<div class="ki-columns-list">`
        for (const col of tab.columns) {
          html += `<div class="ki-col-row" data-col-id="${esc(col.id)}">
            <span class="ki-col-name">${esc(col.columnName)}</span>
            <input type="text" class="ki-col-desc-input" placeholder="${t('col_desc', lang)}"
              value="${esc(col.description)}" onblur="kiSaveColDesc('${esc(col.id)}', this.value)" />
          </div>`
        }
        html += `</div>`
      }

      html += `</div>` // close tab-row
    }
    html += `</div>`
  } else {
    html += `<p class="ki-empty-note">${t('no_tabs', lang)}</p>`
  }

  html += `</div>` // close tabs-section

  // ── Load Content button ──
  html += `<div class="ki-load-section">
    <button type="button" class="btn btn-primary ki-load-btn"
      onclick="kiLoadContent('${esc(item.id)}')"
      ${!item.active ? 'disabled' : ''}>
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
      ${t('load_content', lang)}
    </button>
    <span class="ki-load-status">
      ${item.contentLoaded
        ? `<span class="ki-badge ki-badge-loaded">${t('content_loaded', lang)} — ${item.chunkCount} ${t('chunks', lang)}</span>`
        : `<span class="ki-badge ki-badge-pending">${t('not_loaded', lang)}</span>`
      }
    </span>
  </div>`

  html += `</div>` // close panel

  return html
}

function renderAddModal(categories: KnowledgeCategory[], lang: Lang): string {
  return `<div id="ki-modal" class="wizard-overlay" style="display:none">
    <div class="wizard-modal" style="position:relative">
      <button type="button" class="wizard-close" onclick="kiCloseModal()">&times;</button>
      <div class="wizard-steps">
        <div class="wizard-title">${t('add_btn', lang)}</div>
        <form id="ki-form" onsubmit="kiSubmitForm(event)">
          <div class="wizard-form">
            <label class="wizard-label">${t('item_title', lang)} *</label>
            <input type="text" id="ki-f-title" class="wizard-input" required maxlength="120" onfocus="kiClearError('title')" />
            <div class="wizard-field-error" id="ki-err-title"></div>
          </div>
          <div class="wizard-form">
            <label class="wizard-label">${t('item_desc', lang)} *</label>
            <textarea id="ki-f-desc" class="wizard-input" rows="2" required minlength="20" maxlength="200" onfocus="kiClearError('desc')" style="resize:vertical"
              placeholder="${lang === 'es' ? 'Min. 20 caracteres. Describe el contenido para que el agente lo use como contexto.' : 'Min. 20 chars. Describe the content so the agent can use it as context.'}"></textarea>
            <div class="wizard-field-error" id="ki-err-desc"></div>
          </div>
          <div class="wizard-form">
            <label class="wizard-label">${t('item_category', lang)}</label>
            <div class="ki-tags-picker" id="ki-f-category-tags">
              ${categories.map(c => `<span class="ki-tag-option" data-cat-id="${esc(c.id)}" onclick="kiToggleCatTag(this)">${esc(c.title)}</span>`).join('')}
            </div>
            <input type="hidden" id="ki-f-category" />
          </div>
          <div class="wizard-form">
            <label class="wizard-label">${t('item_url', lang)} *</label>
            <input type="url" id="ki-f-url" class="wizard-input" required placeholder="https://docs.google.com/spreadsheets/d/..." onfocus="kiClearError('url')" />
            <div class="wizard-field-error" id="ki-err-url"></div>
          </div>
          <div class="wizard-actions">
            <button type="button" class="wizard-btn wizard-btn-secondary" onclick="kiCloseModal()">${t('cancel', lang)}</button>
            <button type="submit" class="wizard-btn wizard-btn-primary">${t('save', lang)}</button>
          </div>
        </form>
      </div>
    </div>
  </div>`
}

function renderCategoriesModal(categories: KnowledgeCategory[], lang: Lang): string {
  const isEs = lang === 'es'
  const rows = categories.map(c => `<div class="ki-cat-row" data-cat-id="${esc(c.id)}">
    <input type="text" class="ki-cat-name-input" value="${esc(c.title)}" maxlength="60" />
    <button type="button" class="act-btn act-btn-danger" onclick="kiDeleteCategory('${esc(c.id)}', this)" style="font-size:11px;padding:4px 10px">${isEs ? 'Eliminar' : 'Delete'}</button>
    <button type="button" class="act-btn" onclick="kiRenameCategory('${esc(c.id)}', this)" style="font-size:11px;padding:4px 10px">${isEs ? 'Guardar' : 'Save'}</button>
  </div>`).join('')

  return `<div id="ki-cat-modal" class="wizard-overlay" style="display:none">
    <div class="wizard-modal" style="position:relative">
      <button type="button" class="wizard-close" onclick="kiCloseCategoriesModal()">&times;</button>
      <div class="wizard-steps">
        <div class="wizard-title">${isEs ? 'Editar categorias' : 'Edit categories'}</div>
        <div id="ki-cat-list">${rows || `<p style="color:var(--on-surface-dim);font-size:13px">${isEs ? 'No hay categorias.' : 'No categories.'}</p>`}</div>
        <div style="margin-top:16px;display:flex;gap:8px">
          <input type="text" id="ki-cat-new-name" class="wizard-input" placeholder="${isEs ? 'Nueva categoria...' : 'New category...'}" maxlength="60" />
          <button type="button" class="wizard-btn wizard-btn-primary" onclick="kiAddCategory()" style="font-size:13px">${isEs ? 'Agregar' : 'Add'}</button>
        </div>
      </div>
    </div>
  </div>`
}

function renderClientScript(lang: Lang): string {
  return `<script>(function(){
  var API = '/console/api/knowledge/items'

  function toast(msg, type) {
    if (window.showToast) window.showToast(msg, type || 'success')
  }

  function api(path, method, body) {
    var opts = { method: method || 'GET', headers: {} }
    if (body) {
      opts.headers['Content-Type'] = 'application/json'
      opts.body = JSON.stringify(body)
    }
    return fetch(API + (path || ''), opts).then(function(r) { return r.json() })
  }

  function showError(field, msg) {
    var el = document.getElementById('ki-err-' + field)
    var input = document.getElementById('ki-f-' + field)
    if (el) { el.textContent = msg; el.style.display = 'block' }
    if (input) input.classList.add('invalid')
  }

  window.kiClearError = function(field) {
    var el = document.getElementById('ki-err-' + field)
    var input = document.getElementById('ki-f-' + field)
    if (el) { el.textContent = ''; el.style.display = 'none' }
    if (input) input.classList.remove('invalid')
  }

  function clearAllErrors() {
    ['title', 'desc', 'url'].forEach(function(f) { kiClearError(f) })
  }

  var editingItemId = null

  window.kiOpenAddModal = function() {
    editingItemId = null
    document.getElementById('ki-modal').style.display = ''
    document.getElementById('ki-f-title').value = ''
    document.getElementById('ki-f-desc').value = ''
    document.getElementById('ki-f-category').value = ''
    var urlInput = document.getElementById('ki-f-url')
    urlInput.value = ''
    urlInput.disabled = false
    // Reset tags
    var tags = document.querySelectorAll('.ki-tag-option')
    for (var i = 0; i < tags.length; i++) tags[i].classList.remove('ki-tag-selected')
    clearAllErrors()
    var h3 = document.querySelector('#ki-modal .ki-modal-header h3')
    if (h3) h3.textContent = '${lang === 'es' ? 'Agregar Conocimiento' : 'Add Knowledge'}'
    setTimeout(function() { document.getElementById('ki-f-title').focus() }, 100)
  }

  window.kiOpenEditModal = function(id, title, desc, catId, url) {
    editingItemId = id
    document.getElementById('ki-modal').style.display = ''
    document.getElementById('ki-f-title').value = title
    document.getElementById('ki-f-desc').value = desc
    var urlInput = document.getElementById('ki-f-url')
    urlInput.value = url
    urlInput.disabled = true
    document.getElementById('ki-f-category').value = catId || ''
    // Set tag selection
    var tags = document.querySelectorAll('.ki-tag-option')
    for (var i = 0; i < tags.length; i++) {
      if (tags[i].getAttribute('data-cat-id') === catId) tags[i].classList.add('ki-tag-selected')
      else tags[i].classList.remove('ki-tag-selected')
    }
    clearAllErrors()
    var h3 = document.querySelector('#ki-modal .ki-modal-header h3')
    if (h3) h3.textContent = '${lang === 'es' ? 'Editar Conocimiento' : 'Edit Knowledge'}'
    setTimeout(function() { document.getElementById('ki-f-title').focus() }, 100)
  }

  window.kiCloseModal = function() {
    document.getElementById('ki-modal').style.display = 'none'
  }

  window.kiSubmitForm = function(e) {
    e.preventDefault()
    clearAllErrors()
    var title = document.getElementById('ki-f-title').value.trim()
    var desc = document.getElementById('ki-f-desc').value.trim()
    var cat = document.getElementById('ki-f-category').value
    var url = document.getElementById('ki-f-url').value.trim()
    var hasErr = false
    if (!title) { showError('title', '${lang === 'es' ? 'El titulo es requerido' : 'Title is required'}'); hasErr = true }
    if (!desc || desc.length < 20) { showError('desc', '${lang === 'es' ? 'La descripcion es requerida (min. 20 caracteres)' : 'Description is required (min. 20 characters)'}'); hasErr = true }
    if (!url) { showError('url', '${lang === 'es' ? 'La URL es requerida' : 'URL is required'}'); hasErr = true }
    if (hasErr) return

    var submitBtn = document.querySelector('#ki-form .act-btn-cta')

    // Edit mode: skip URL verification, just update
    if (editingItemId) {
      if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = '${lang === 'es' ? 'Guardando...' : 'Saving...'}' }
      api('', 'PUT', { id: editingItemId, title: title, description: desc, categoryId: cat || undefined })
        .then(function(r) {
          if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = '${t('save', lang)}' }
          if (r.error) { showError('title', r.error); return }
          toast('${lang === 'es' ? 'Conocimiento actualizado' : 'Knowledge updated'}')
          window.kiCloseModal()
          location.reload()
        })
        .catch(function(err) {
          if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = '${t('save', lang)}' }
          toast(String(err), 'error')
        })
      return
    }

    // Add mode: verify URL accessibility first
    if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = '${lang === 'es' ? 'Verificando...' : 'Verifying...'}' }
    api('/verify-url', 'POST', { sourceUrl: url })
      .then(function(v) {
        if (v.accessible === false) {
          showError('url', v.error || '${lang === 'es' ? 'No se puede acceder al recurso' : 'Cannot access the resource'}')
          if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = '${t('save', lang)}' }
          return
        }
        return api('', 'POST', { title: title, description: desc, categoryId: cat || undefined, sourceUrl: url })
      })
      .then(function(r) {
        if (!r) return
        if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = '${t('save', lang)}' }
        if (r.error) { showError('url', r.error); return }
        toast('${lang === 'es' ? 'Conocimiento agregado' : 'Knowledge added'}')
        window.kiCloseModal()
        location.reload()
      })
      .catch(function(err) {
        if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = '${t('save', lang)}' }
        toast(String(err), 'error')
      })
  }

  window.kiToggleActive = function(id, active) {
    api('/active', 'PUT', { id: id, active: active })
      .then(function(r) {
        if (r.error) { toast(r.error, 'error'); return }
        toast(active ? '${lang === 'es' ? 'Activado' : 'Activated'}' : '${lang === 'es' ? 'Desactivado' : 'Deactivated'}')
        location.reload()
      })
      .catch(function(err) { toast(String(err), 'error') })
  }

  window.kiToggleCore = function(id, isCore) {
    api('/core', 'PUT', { id: id, isCore: isCore })
      .then(function(r) {
        if (r.error) { toast(r.error, 'error'); location.reload(); return }
        toast(isCore ? 'Core ON' : 'Core OFF')
      })
      .catch(function(err) { toast(String(err), 'error') })
  }

  window.kiDeleteItem = function(id) {
    if (!confirm('${t('confirm_delete', lang)}')) return
    api('/delete', 'POST', { id: id })
      .then(function(r) {
        if (r.error) { toast(r.error, 'error'); return }
        toast('${lang === 'es' ? 'Eliminado' : 'Deleted'}')
        location.reload()
      })
      .catch(function(err) { toast(String(err), 'error') })
  }

  window.kiScanTabs = function(id) {
    toast('${lang === 'es' ? 'Escaneando tabs...' : 'Scanning tabs...'}', 'info')
    api('/scan-tabs', 'POST', { id: id })
      .then(function(r) {
        if (r.error) { toast(r.error, 'error'); return }
        toast('${lang === 'es' ? 'Tabs escaneadas' : 'Tabs scanned'}')
        location.reload()
      })
      .catch(function(err) { toast(String(err), 'error') })
  }

  window.kiScanColumns = function(tabId, itemId) {
    toast('${lang === 'es' ? 'Escaneando columnas...' : 'Scanning columns...'}', 'info')
    api('/scan-columns', 'POST', { tabId: tabId })
      .then(function(r) {
        if (r.error) { toast(r.error, 'error'); return }
        toast('${lang === 'es' ? 'Columnas escaneadas' : 'Columns scanned'}')
        location.reload()
      })
      .catch(function(err) { toast(String(err), 'error') })
  }

  window.kiSaveTabDesc = function(tabId, desc) {
    api('/tab-description', 'PUT', { tabId: tabId, description: desc })
      .catch(function() {})
  }

  window.kiSaveColDesc = function(colId, desc) {
    api('/column-description', 'PUT', { columnId: colId, description: desc })
      .catch(function() {})
  }

  window.kiLoadContent = function(id) {
    if (!confirm('${lang === 'es' ? '¿Cargar contenido y generar embeddings?' : 'Load content and generate embeddings?'}')) return
    toast('${lang === 'es' ? 'Cargando contenido...' : 'Loading content...'}', 'info')
    api('/load-content', 'POST', { id: id })
      .then(function(r) {
        if (r.error) { toast(r.error, 'error'); return }
        toast('${lang === 'es' ? 'Contenido cargado: ' : 'Content loaded: '}' + r.chunks + ' chunks')
        location.reload()
      })
      .catch(function(err) { toast(String(err), 'error') })
  }

  // Close modal on overlay click
  document.getElementById('ki-modal').addEventListener('click', function(e) {
    if (e.target === this) window.kiCloseModal()
  })
  var catModal = document.getElementById('ki-cat-modal')
  if (catModal) catModal.addEventListener('click', function(e) {
    if (e.target === this) window.kiCloseCategoriesModal()
  })

  // ── Tag picker (single select) ──
  window.kiToggleCatTag = function(el) {
    var tags = el.parentNode.querySelectorAll('.ki-tag-option')
    var wasSelected = el.classList.contains('ki-tag-selected')
    for (var i = 0; i < tags.length; i++) tags[i].classList.remove('ki-tag-selected')
    if (!wasSelected) el.classList.add('ki-tag-selected')
    document.getElementById('ki-f-category').value = wasSelected ? '' : el.getAttribute('data-cat-id')
  }

  // ── Categories CRUD ──
  var CAT_API = '/console/api/knowledge/categories'

  window.kiOpenCategoriesModal = function() {
    document.getElementById('ki-cat-modal').style.display = ''
  }
  window.kiCloseCategoriesModal = function() {
    document.getElementById('ki-cat-modal').style.display = 'none'
  }

  window.kiAddCategory = function() {
    var inp = document.getElementById('ki-cat-new-name')
    var name = inp.value.trim()
    if (!name) return
    fetch(CAT_API, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: name }) })
      .then(function(r) { return r.json() })
      .then(function(r) {
        if (r.error) { toast(r.error, 'error'); return }
        toast('${lang === 'es' ? 'Categoria agregada' : 'Category added'}')
        location.reload()
      })
      .catch(function(err) { toast(String(err), 'error') })
  }

  window.kiRenameCategory = function(id, btn) {
    var row = btn.closest('.ki-cat-row')
    var name = row.querySelector('.ki-cat-name-input').value.trim()
    if (!name) return
    fetch(CAT_API, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: id, title: name }) })
      .then(function(r) { return r.json() })
      .then(function(r) {
        if (r.error) { toast(r.error, 'error'); return }
        toast('${lang === 'es' ? 'Categoria actualizada' : 'Category updated'}')
        row.style.background = 'var(--success-container)'; setTimeout(function() { row.style.background = '' }, 600)
      })
      .catch(function(err) { toast(String(err), 'error') })
  }

  window.kiDeleteCategory = function(id, btn) {
    if (!confirm('${lang === 'es' ? '¿Eliminar esta categoria?' : 'Delete this category?'}')) return
    fetch(CAT_API + '/delete', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: id }) })
      .then(function(r) { return r.json() })
      .then(function(r) {
        if (r.error) { toast(r.error, 'error'); return }
        toast('${lang === 'es' ? 'Categoria eliminada' : 'Category deleted'}')
        location.reload()
      })
      .catch(function(err) { toast(String(err), 'error') })
  }
})()</script>`
}

function renderStyles(): string {
  return `<style>
.ki-header { display:flex; justify-content:space-between; align-items:center; margin-bottom:16px; }
.ki-title { font-size:18px; font-weight:600; margin:0; color:var(--on-surface); }
.ki-add-btn { display:inline-flex; align-items:center; gap:6px; }
.ki-item { margin-bottom:12px; padding:16px; }
.ki-item-inactive { opacity:0.6; }
.ki-item-header { display:flex; justify-content:space-between; align-items:flex-start; gap:12px; }
.ki-item-info { flex:1; min-width:0; }
.ki-item-title-row { display:flex; align-items:center; gap:8px; flex-wrap:wrap; }
.ki-item-name { font-weight:600; font-size:15px; color:var(--on-surface); }
.ki-item-desc { margin:4px 0 0; font-size:13px; color:var(--on-surface-dim); }
.ki-item-actions { display:flex; align-items:center; gap:10px; flex-shrink:0; }
.ki-badge { display:inline-block; padding:2px 8px; border-radius:10px; font-size:11px; font-weight:500; }
.ki-badge-source { background:var(--surface-alt, #e8eaed); color:var(--on-surface-dim); }
.ki-badge-core { background:#fef3c7; color:#92400e; }
.ki-badge-loaded { background:#d1fae5; color:#065f46; }
.ki-badge-pending { background:#fef3c7; color:#92400e; }
.ki-status-pending { background:#fef3c7; color:#92400e; }
.ki-status-processing { background:#dbeafe; color:#1e40af; }
.ki-status-done { background:#d1fae5; color:#065f46; }
.ki-status-failed { background:#fee2e2; color:#991b1b; }
.ki-tag { display:inline-block; margin-top:6px; padding:2px 10px; border-radius:10px; font-size:11px; background:var(--surface-alt, #e8eaed); color:var(--on-surface-dim); }
.ki-core-label { display:flex; align-items:center; gap:4px; cursor:pointer; font-size:12px; color:var(--on-surface-dim); }
.ki-core-text { font-size:11px; }
.ki-toggle-label { position:relative; display:inline-block; width:36px; height:20px; }
.ki-toggle-label .ki-toggle-input { opacity:0; width:0; height:0; }
.ki-toggle-label .toggle-slider { position:absolute; cursor:pointer; top:0; left:0; right:0; bottom:0; background-color:#ccc; border-radius:20px; transition:.3s; }
.ki-toggle-label .toggle-slider:before { position:absolute; content:""; height:14px; width:14px; left:3px; bottom:3px; background-color:white; border-radius:50%; transition:.3s; }
.ki-toggle-label .ki-toggle-input:checked + .toggle-slider { background-color:var(--primary, #4f46e5); }
.ki-toggle-label .ki-toggle-input:checked + .toggle-slider:before { transform:translateX(16px); }
.ki-tabs-section { margin-top:12px; padding-top:12px; border-top:1px solid var(--border, #e5e7eb); }
.ki-tabs-header { display:flex; justify-content:space-between; align-items:center; margin-bottom:8px; }
.ki-section-label { font-size:13px; font-weight:600; color:var(--on-surface-dim); text-transform:uppercase; letter-spacing:0.5px; }
.ki-tabs-list { display:flex; flex-direction:column; gap:6px; }
.ki-tab-row { padding:8px; background:var(--surface-alt, #f9fafb); border-radius:8px; }
.ki-tab-name { font-weight:500; font-size:13px; color:var(--on-surface); margin-bottom:4px; }
.ki-tab-desc-input { width:100%; border:1px solid var(--border, #e5e7eb); border-radius:6px; padding:4px 8px; font-size:12px; margin-bottom:4px; background:var(--surface, #fff); color:var(--on-surface); }
.ki-scan-cols-btn { font-size:11px; }
.ki-columns-list { margin-top:6px; padding-left:12px; display:flex; flex-direction:column; gap:4px; }
.ki-col-row { display:flex; align-items:center; gap:8px; }
.ki-col-name { font-size:12px; font-weight:500; color:var(--on-surface); min-width:100px; }
.ki-col-desc-input { flex:1; border:1px solid var(--border, #e5e7eb); border-radius:6px; padding:3px 8px; font-size:11px; background:var(--surface, #fff); color:var(--on-surface); }
.ki-empty-note { font-size:12px; color:var(--on-surface-dim); margin:4px 0; }
.ki-load-section { margin-top:12px; padding-top:12px; border-top:1px solid var(--border, #e5e7eb); display:flex; align-items:center; gap:12px; }
.ki-load-btn { display:inline-flex; align-items:center; gap:6px; font-size:13px; }
.ki-load-btn:disabled { opacity:0.5; cursor:not-allowed; }
.ki-load-status { font-size:12px; }
.ki-delete-btn { font-size:11px; }

/* Modal — uses wizard-overlay + wizard-modal from components.css */
.ki-tags-picker { display:flex; flex-wrap:wrap; gap:6px; padding:8px 0; }
.ki-tag-option { display:inline-block; padding:4px 12px; border-radius:16px; font-size:12px; cursor:pointer; border:1px solid var(--outline-variant, #e5e7eb); background:var(--surface-container-lowest, #fff); color:var(--on-surface-dim); transition:all .15s; }
.ki-tag-option:hover { border-color:var(--primary, #FF5E0E); color:var(--primary, #FF5E0E); }
.ki-tag-option.ki-tag-selected { background:var(--primary, #FF5E0E); color:#fff; border-color:var(--primary, #FF5E0E); }
.ki-cat-row { display:flex; align-items:center; gap:8px; padding:8px 0; border-bottom:1px solid var(--outline-variant, #e5e7eb); }
.ki-cat-name-input { flex:1; padding:6px 10px; border:1px solid var(--outline-variant, #e5e7eb); border-radius:6px; font-size:14px; background:var(--surface-container-lowest); color:var(--on-surface); }
</style>`
}
