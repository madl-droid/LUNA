// LUNA — Module: knowledge — Console section renderer
// Server-side rendered HTML for the knowledge items management UI.

import type { KnowledgeItem, KnowledgeCategory } from './types.js'

type Lang = 'es' | 'en'

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')
}

const t = (key: string, lang: Lang): string => {
  const map: Record<string, { es: string; en: string }> = {
    title: { es: 'Base de Conocimiento', en: 'Knowledge Base' },
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
): string {
  let html = ''

  // ── Header with Add button ──
  html += `<div class="ki-header">
    <h2 class="ki-title">${t('title', lang)}</h2>
    <button type="button" class="btn btn-primary ki-add-btn" onclick="kiOpenAddModal()">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
      ${t('add_btn', lang)}
    </button>
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
  const catOptions = categories.map(c =>
    `<option value="${esc(c.id)}">${esc(c.title)}</option>`
  ).join('')

  return `<div id="ki-modal" class="ki-modal-overlay" style="display:none">
    <div class="ki-modal">
      <div class="ki-modal-header">
        <h3>${t('add_btn', lang)}</h3>
        <button type="button" class="ki-modal-close" onclick="kiCloseModal()">&times;</button>
      </div>
      <form id="ki-form" onsubmit="kiSubmitForm(event)">
        <div class="ki-field">
          <label>${t('item_title', lang)} *</label>
          <input type="text" id="ki-f-title" required maxlength="120" />
        </div>
        <div class="ki-field">
          <label>${t('item_desc', lang)}</label>
          <textarea id="ki-f-desc" rows="2" maxlength="200"></textarea>
        </div>
        <div class="ki-field">
          <label>${t('item_category', lang)}</label>
          <select id="ki-f-category">
            <option value="">—</option>
            ${catOptions}
          </select>
        </div>
        <div class="ki-field">
          <label>${t('item_url', lang)} *</label>
          <input type="url" id="ki-f-url" required placeholder="https://docs.google.com/spreadsheets/d/..." />
        </div>
        <div class="ki-modal-footer">
          <button type="button" class="btn btn-outline" onclick="kiCloseModal()">${t('cancel', lang)}</button>
          <button type="submit" class="btn btn-primary">${t('save', lang)}</button>
        </div>
      </form>
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

  window.kiOpenAddModal = function() {
    document.getElementById('ki-modal').style.display = ''
    document.getElementById('ki-f-title').value = ''
    document.getElementById('ki-f-desc').value = ''
    document.getElementById('ki-f-category').value = ''
    document.getElementById('ki-f-url').value = ''
    setTimeout(function() { document.getElementById('ki-f-title').focus() }, 100)
  }

  window.kiCloseModal = function() {
    document.getElementById('ki-modal').style.display = 'none'
  }

  window.kiSubmitForm = function(e) {
    e.preventDefault()
    var title = document.getElementById('ki-f-title').value.trim()
    var desc = document.getElementById('ki-f-desc').value.trim()
    var cat = document.getElementById('ki-f-category').value
    var url = document.getElementById('ki-f-url').value.trim()
    if (!title || !url) return

    api('', 'POST', { title: title, description: desc, categoryId: cat || undefined, sourceUrl: url })
      .then(function(r) {
        if (r.error) { toast(r.error, 'error'); return }
        toast('${lang === 'es' ? 'Conocimiento agregado' : 'Knowledge added'}')
        window.kiCloseModal()
        location.reload()
      })
      .catch(function(err) { toast(String(err), 'error') })
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

/* Modal */
.ki-modal-overlay { position:fixed; top:0; left:0; right:0; bottom:0; background:rgba(0,0,0,0.5); display:flex; align-items:center; justify-content:center; z-index:9999; }
.ki-modal { background:var(--surface, #fff); border-radius:12px; width:480px; max-width:90vw; max-height:90vh; overflow-y:auto; box-shadow:0 20px 60px rgba(0,0,0,0.3); }
.ki-modal-header { display:flex; justify-content:space-between; align-items:center; padding:16px 20px; border-bottom:1px solid var(--border, #e5e7eb); }
.ki-modal-header h3 { margin:0; font-size:16px; font-weight:600; color:var(--on-surface); }
.ki-modal-close { background:none; border:none; font-size:24px; cursor:pointer; color:var(--on-surface-dim); padding:0; line-height:1; }
#ki-form { padding:20px; }
.ki-field { margin-bottom:14px; }
.ki-field label { display:block; font-size:13px; font-weight:500; margin-bottom:4px; color:var(--on-surface); }
.ki-field input, .ki-field textarea, .ki-field select { width:100%; border:1px solid var(--border, #e5e7eb); border-radius:8px; padding:8px 12px; font-size:14px; background:var(--surface, #fff); color:var(--on-surface); box-sizing:border-box; }
.ki-field textarea { resize:vertical; }
.ki-modal-footer { display:flex; justify-content:flex-end; gap:8px; padding-top:8px; }
</style>`
}
