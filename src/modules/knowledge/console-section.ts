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
    no_items: { es: 'Sin conocimientos aún', en: 'No knowledge yet' },
    no_items_hint: { es: 'Para que tu agente funcione bien, recomendamos agregar al menos Preguntas Frecuentes y Productos o Servicios.', en: 'For your agent to work well, we recommend adding at least FAQs and Products or Services.' },
    item_title: { es: 'Titulo', en: 'Title' },
    item_desc: { es: 'Descripcion', en: 'Description' },
    item_category: { es: 'Categoria', en: 'Category' },
    item_url: { es: 'URL (Google Sheets, Docs, Drive, PDF, YouTube)', en: 'URL (Google Sheets, Docs, Drive, PDF, YouTube)' },
    source_pdf: { es: 'PDF', en: 'PDF' },
    source_youtube: { es: 'YouTube', en: 'YouTube' },
    save: { es: 'Guardar', en: 'Save' },
    cancel: { es: 'Cancelar', en: 'Cancel' },
    next: { es: 'Siguiente', en: 'Next' },
    skip: { es: 'Omitir', en: 'Skip' },
    finish: { es: 'Finalizar', en: 'Finish' },
    refresh: { es: 'Actualizar', en: 'Refresh' },
    scan_tabs: { es: 'Escanear Tabs', en: 'Scan Tabs' },
    scan_cols: { es: 'Escanear Columnas', en: 'Scan Columns' },
    load_content: { es: 'Cargar Contenido', en: 'Load Content' },
    active: { es: 'Activo', en: 'Active' },
    inactive: { es: 'Inactivo', en: 'Inactive' },
    core: { es: 'Core', en: 'Core' },
    delete_btn: { es: 'Eliminar', en: 'Delete' },
    edit_btn: { es: 'Editar', en: 'Edit' },
    configure_btn: { es: 'Configurar', en: 'Configure' },
    tabs: { es: 'Tabs', en: 'Tabs' },
    columns: { es: 'Columnas', en: 'Columns' },
    no_tabs: { es: 'Sin tabs escaneadas', en: 'No tabs scanned' },
    no_cols: { es: 'Sin columnas escaneadas', en: 'No columns scanned' },
    tab_desc: { es: 'Descripcion del tab', en: 'Tab description' },
    col_desc: { es: 'Descripcion', en: 'Description' },
    source_sheets: { es: 'Sheets', en: 'Sheets' },
    source_docs: { es: 'Docs', en: 'Docs' },
    source_drive: { es: 'Drive', en: 'Drive' },
    status_pending: { es: 'Pendiente', en: 'Pending' },
    status_processing: { es: 'Procesando', en: 'Processing' },
    status_done: { es: 'Entrenado', en: 'Trained' },
    status_failed: { es: 'Error', en: 'Failed' },
    chunks: { es: 'chunks', en: 'chunks' },
    content_loaded: { es: 'Contenido cargado', en: 'Content loaded' },
    not_loaded: { es: 'Sin cargar', en: 'Not loaded' },
    confirm_delete: { es: '¿Eliminar este item?', en: 'Delete this item?' },
    settings_title: { es: 'Configuracion', en: 'Settings' },
    core_knowledge: { es: 'Conocimiento principal', en: 'Core knowledge' },
    step_basic: { es: 'Informacion basica', en: 'Basic info' },
    step_tabs: { es: 'Hojas / Tabs', en: 'Sheets / Tabs' },
    step_columns: { es: 'Columnas', en: 'Columns' },
    no_url_configured: { es: 'URL no configurada. Configura este recurso para comenzar.', en: 'URL not configured. Configure this resource to get started.' },
    train_agent: { es: 'Entrenar agente', en: 'Train agent' },
    categories: { es: 'Categorias', en: 'Categories' },
  }
  return map[key]?.[lang] ?? key
}

// ═══════════════════════════════════════════
// Main export
// ═══════════════════════════════════════════

export function renderKnowledgeSection(
  items: KnowledgeItem[],
  categories: KnowledgeCategory[],
  lang: Lang,
  _config?: { faqSheetUrl?: string; faqDescription?: string; productsSheetUrl?: string; productsDescription?: string },
): string {
  let html = ''

  if (items.length === 0) {
    // ── Empty state — no action bar, just the dashed panel ──
    html += `<div class="ki-empty-state">
      <div class="ki-empty-icon">
        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/></svg>
      </div>
      <p class="ki-empty-title">${t('no_items', lang)}</p>
      <p class="ki-empty-body">${t('no_items_hint', lang)}</p>
      <button type="button" class="act-btn act-btn-add ki-empty-add-btn" onclick="kiOpenWizard()">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
        ${t('add_btn', lang)}
      </button>
    </div>`
  } else {
    // ── Action bar — only when items exist ──
    html += `<div class="ki-header">
      <div></div>
      <div style="display:flex;gap:8px;align-items:center">
        <button type="button" class="act-btn act-btn-cta" onclick="kiBulkVectorize()" style="font-size:13px">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/></svg>
          ${t('train_agent', lang)}
        </button>
        <button type="button" class="act-btn act-btn-config" onclick="kiOpenCategoriesModal()" style="font-size:13px">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 013 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>
          ${t('categories', lang)}
        </button>
        <button type="button" class="act-btn act-btn-add" onclick="kiOpenWizard()">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
          ${t('add_btn', lang)}
        </button>
      </div>
    </div>`
    html += renderItemsList(items, categories, lang)
  }

  // ── Wizard Modal (3-step) ──
  html += renderWizardModal(categories, lang)

  // ── Categories Edit Modal ──
  html += renderCategoriesModal(categories, lang)

  // ── Client-side JS ──
  html += renderClientScript(lang, categories)

  // ── Styles ──
  html += renderStyles()

  return html
}

// ═══════════════════════════════════════════
// Core Knowledge Cards (FAQ + Products)
// ═══════════════════════════════════════════
// Source icon by type
// ═══════════════════════════════════════════

function sourceIcon(sourceType: string): string {
  const icons: Record<string, { bg: string; color: string; path: string }> = {
    sheets: {
      bg: 'rgba(26,158,92,0.12)', color: '#1a9e5c',
      path: '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M3 15h18M9 3v18"/>',
    },
    docs: {
      bg: 'rgba(26,110,240,0.12)', color: '#1a6ef0',
      path: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/>',
    },
    drive: {
      bg: 'rgba(245,158,11,0.12)', color: '#d97706',
      path: '<path d="M22 20H2l4-8h12l4 8z"/><path d="M12 4L6 16"/><path d="M12 4l6 12"/>',
    },
    pdf: {
      bg: 'rgba(220,38,38,0.12)', color: '#dc2626',
      path: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><path d="M9 13h2m-2 3h6"/>',
    },
    youtube: {
      bg: 'rgba(239,68,68,0.12)', color: '#ef4444',
      path: '<path d="M22.54 6.42a2.78 2.78 0 0 0-1.94-2C18.88 4 12 4 12 4s-6.88 0-8.6.46a2.78 2.78 0 0 0-1.94 2A29 29 0 0 0 1 11.75a29 29 0 0 0 .46 5.33A2.78 2.78 0 0 0 3.4 19.13c1.72.46 8.6.46 8.6.46s6.88 0 8.6-.46a2.78 2.78 0 0 0 1.94-2 29 29 0 0 0 .46-5.25 29 29 0 0 0-.46-5.46z"/><polygon points="9.75 15.02 15.5 11.75 9.75 8.48 9.75 15.02"/>',
    },
  }
  const def = icons[sourceType] ?? icons['docs']!
  return `<div class="ki-source-icon" style="background:${def.bg};color:${def.color}"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">${def.path}</svg></div>`
}

// ═══════════════════════════════════════════
// Status dot
// ═══════════════════════════════════════════

function statusCell(item: KnowledgeItem, lang: Lang): string {
  const dotClass = `ki-dot-${item.embeddingStatus}`
  const label = t(`status_${item.embeddingStatus}`, lang)
  const chunks = item.embeddingStatus === 'done' && item.chunkCount
    ? `<span class="ki-chunks">${item.chunkCount} ${t('chunks', lang)}</span>`
    : ''
  return `<span class="ki-status-row"><span class="ki-dot ${dotClass}"></span>${esc(label)}${chunks}</span>`
}

// ═══════════════════════════════════════════
// Items list with header
// ═══════════════════════════════════════════

function renderItemsList(items: KnowledgeItem[], categories: KnowledgeCategory[], lang: Lang): string {
  const coreCount = items.filter(i => i.isCore).length
  let html = `<div class="ki-list">`
  for (const item of items) {
    html += renderItemCard(item, categories, lang, coreCount)
  }
  html += `</div>`
  return html
}

// ═══════════════════════════════════════════
// Item Card (table row)
// ═══════════════════════════════════════════

function renderItemCard(item: KnowledgeItem, categories: KnowledgeCategory[], lang: Lang, coreCount: number): string {
  const isEs = lang === 'es'
  const sourceLabel = t(`source_${item.sourceType}`, lang)
  const category = categories.find(c => c.id === item.categoryId)
  const isInactive = !item.active
  const maxCore = 3

  const itemData = JSON.stringify({
    id: item.id, title: item.title, description: item.description,
    categoryId: item.categoryId ?? '', sourceUrl: item.sourceUrl,
  }).replace(/'/g, '&#39;').replace(/</g, '\\u003c')

  const coreLabel = item.isCore
    ? `${isEs ? 'Principal' : 'Main'} (${coreCount}/${maxCore})`
    : (isEs ? 'Principal' : 'Main')
  const coreTip = isEs ? 'Marca este conocimiento como principal para que el agente lo consulte con prioridad (max 3)' : 'Mark this knowledge as main so the agent queries it with priority (max 3)'
  const shareTip = isEs ? 'Permite al agente compartir el enlace de este archivo con el usuario cuando sea relevante' : 'Allows the agent to share the link to this file with the user when relevant'

  return `<div class="panel ki-row${isInactive ? ' ki-row-inactive' : ''}" data-item-id="${esc(item.id)}">
    <div class="ki-col-nombre">
      ${sourceIcon(item.sourceType)}
      <div class="ki-nombre-info">
        <span class="ki-item-name">${esc(item.title)}</span>
        ${item.description ? `<p class="ki-item-desc">${esc(item.description)}</p>` : ''}
        ${category ? `<span class="ki-tag">${esc(category.title)}</span>` : ''}
      </div>
    </div>
    <div class="ki-col-tipo"><span class="ki-badge ki-badge-source">${esc(sourceLabel)}</span></div>
    <div class="ki-col-estado">${statusCell(item, lang)}</div>
    <div class="ki-col-activo">
      <label class="toggle toggle-sm">
        <input type="checkbox" ${item.active ? 'checked' : ''} onchange="kiToggleActive('${esc(item.id)}', this.checked)" />
        <span class="toggle-slider"></span>
      </label>
    </div>
    <div class="ki-col-acciones">
      <button type="button" class="act-btn act-btn-config act-btn--compact" onclick='kiOpenWizardEdit(${itemData})'>
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 013 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>
        ${t('edit_btn', lang)}
      </button>
      <button type="button" class="act-btn act-btn--compact ${item.isCore ? 'ki-btn-core-on' : 'act-btn-config'}"
        onclick="kiToggleCore('${esc(item.id)}', ${item.isCore ? 'false' : 'true'})"
        title="${esc(coreTip)}">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>
        ${esc(coreLabel)}<span class="ki-info-dot" title="${esc(coreTip)}">i</span>
      </button>
      <button type="button" class="act-btn act-btn--compact ${item.shareable ? 'ki-btn-share-on' : 'act-btn-config'}"
        onclick="kiToggleShareable('${esc(item.id)}', ${item.shareable ? 'false' : 'true'})"
        title="${esc(shareTip)}">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/></svg>
        ${isEs ? 'Compartir' : 'Share'}<span class="ki-info-dot" title="${esc(shareTip)}">i</span>
      </button>
      <button type="button" class="act-btn act-btn-cta act-btn--compact"
        onclick="kiLoadContent('${esc(item.id)}')" ${!item.active ? 'disabled' : ''}>
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/></svg>
        ${isEs ? 'Entrenar' : 'Train'}
      </button>
      ${isInactive ? `<button type="button" class="act-btn act-btn-remove act-btn--compact" onclick="kiDeleteItem('${esc(item.id)}')">${t('delete_btn', lang)}</button>` : ''}
    </div>
  </div>`
}

// ═══════════════════════════════════════════
// Wizard Modal (3-step)
// ═══════════════════════════════════════════

function renderWizardModal(_categories: KnowledgeCategory[], lang: Lang): string {
  const isEs = lang === 'es'

  return `<div class="wizard-overlay" id="ki-wizard" style="display:none" onclick="if(event.target===this)kiCloseWizard()">
  <div class="wizard-modal">
    <button class="wizard-close" onclick="kiCloseWizard()">&times;</button>
    <div class="wizard-steps">
      <!-- Title -->
      <div class="wizard-title" id="ki-wiz-title-text">${isEs ? 'Agregar Conocimiento' : 'Add Knowledge'}</div>

      <!-- Step count + dots -->
      <div class="wizard-step-count">3 ${isEs ? 'pasos' : 'steps'}</div>
      <div class="wizard-step-indicator" id="ki-wiz-dots">
        <div class="wizard-dot active" data-dot="0">1</div>
        <div class="wizard-dot-line"></div>
        <div class="wizard-dot" data-dot="1">2</div>
        <div class="wizard-dot-line"></div>
        <div class="wizard-dot" data-dot="2">3</div>
      </div>

      <!-- Page 1: Basic Info -->
      <div class="wizard-page active" data-page="0">
        <div class="wizard-page-title">${t('step_basic', lang)}</div>

        <label class="wizard-label">${t('item_title', lang)} *</label>
        <input type="text" id="ki-wiz-title" class="wizard-input" maxlength="120" placeholder="${isEs ? 'Nombre del recurso' : 'Resource name'}" onfocus="kiWizClearErr('title')">
        <div class="wizard-field-error" id="ki-wiz-err-title"></div>

        <label class="wizard-label">${t('item_desc', lang)} *</label>
        <textarea id="ki-wiz-desc" class="wizard-input" rows="3" maxlength="200" style="resize:vertical"
          placeholder="${isEs ? 'Min. 20 caracteres. Describe el contenido para que el agente lo use como contexto.' : 'Min. 20 chars. Describe the content so the agent uses it as context.'}" onfocus="kiWizClearErr('desc')"></textarea>
        <div class="wizard-field-error" id="ki-wiz-err-desc"></div>

        <label class="wizard-label">${t('item_category', lang)}</label>
        <div class="ki-category-field">
          <input type="text" id="ki-wiz-cat-input" class="wizard-input" placeholder="${isEs ? 'Buscar o crear categoria...' : 'Search or create category...'}" oninput="kiWizFilterCats()" onfocus="kiWizShowCatDropdown()">
          <input type="hidden" id="ki-wiz-category">
          <div class="ki-cat-dropdown" id="ki-wiz-cat-dropdown" style="display:none"></div>
          <div class="ki-cat-tags" id="ki-wiz-cat-selected"></div>
        </div>

        <label class="wizard-label">${t('item_url', lang)} *</label>
        <input type="url" id="ki-wiz-url" class="wizard-input" placeholder="https://docs.google.com/spreadsheets/d/..." onfocus="kiWizClearErr('url')" oninput="kiWizCheckYoutube(this.value)">
        <div class="wizard-field-error" id="ki-wiz-err-url"></div>
        <div id="ki-wiz-yt-hint" class="ki-yt-hint" style="display:none">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>
          ${isEs ? 'Para mayor efectividad recomendamos habilitar los subtítulos automáticos en los videos de este canal/playlist.' : 'For best results we recommend enabling automatic subtitles on videos in this channel/playlist.'}
        </div>

        <div class="wizard-error" id="ki-wiz-general-error" style="display:none"></div>

        <div class="wizard-actions">
          <button type="button" class="wizard-btn wizard-btn-secondary" onclick="kiCloseWizard()">${t('cancel', lang)}</button>
          <button type="button" class="wizard-btn ki-wiz-btn-green" id="ki-wiz-next1" onclick="kiWizStep1Next()">${t('next', lang)}</button>
        </div>
      </div>

      <!-- Page 2: Tabs/Sheets -->
      <div class="wizard-page" data-page="1">
        <div class="wizard-page-title">${t('step_tabs', lang)}</div>
        <p class="wizard-instructions">${isEs ? 'Describe cada hoja para que el agente sepa que informacion contiene.' : 'Describe each sheet so the agent knows what information it contains.'}</p>
        <div id="ki-wiz-tabs-list"></div>
        <div class="wizard-actions">
          <button type="button" class="wizard-btn wizard-btn-secondary" onclick="showWizPage(0)">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="15 18 9 12 15 6"/></svg>
            ${isEs ? 'Atrás' : 'Back'}
          </button>
          <button type="button" class="wizard-btn wizard-btn-secondary" onclick="kiWizRefreshTabs()">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 11-2.12-9.36L23 10"/></svg>
            ${t('refresh', lang)}
          </button>
          <button type="button" class="wizard-btn ki-wiz-btn-green" id="ki-wiz-next2" onclick="kiWizStep2Next()">${t('next', lang)}</button>
        </div>
      </div>

      <!-- Page 3: Columns -->
      <div class="wizard-page" data-page="2">
        <div class="wizard-page-title">${t('step_columns', lang)}</div>
        <p class="wizard-instructions">${isEs ? 'Describe cada columna para mejorar la precision de busqueda.' : 'Describe each column to improve search accuracy.'}</p>
        <div id="ki-wiz-col-tab-nav" style="display:flex;gap:4px;margin-bottom:12px;flex-wrap:wrap"></div>
        <div id="ki-wiz-cols-list"></div>
        <div class="wizard-actions">
          <button type="button" class="wizard-btn wizard-btn-secondary" onclick="showWizPage(1)">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="15 18 9 12 15 6"/></svg>
            ${isEs ? 'Atrás' : 'Back'}
          </button>
          <button type="button" class="wizard-btn wizard-btn-secondary" onclick="kiWizRefreshCols()">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 11-2.12-9.36L23 10"/></svg>
            ${t('refresh', lang)}
          </button>
          <button type="button" class="wizard-btn ki-wiz-btn-green" onclick="kiWizFinish()">${t('finish', lang)}</button>
        </div>
      </div>

      <!-- Loading overlay -->
      <div class="wizard-page" data-page="loading" style="text-align:center;padding:48px 24px">
        <div class="ki-wiz-loading-spinner"></div>
        <div id="ki-wiz-loading-text" style="margin-top:16px;color:var(--on-surface-dim)">${isEs ? 'Procesando...' : 'Processing...'}</div>
      </div>
    </div>
  </div>
</div>`
}

// ═══════════════════════════════════════════
// Categories Modal
// ═══════════════════════════════════════════

function renderCategoriesModal(categories: KnowledgeCategory[], lang: Lang): string {
  const isEs = lang === 'es'
  const rows = categories.map(c => `<div class="ki-cat-row" data-cat-id="${esc(c.id)}">
    <div class="ki-cat-row-fields">
      <input type="text" class="ki-cat-name-input" value="${esc(c.title)}" maxlength="60" placeholder="${isEs ? 'Nombre de categoría' : 'Category name'}" />
      <input type="text" class="ki-cat-desc-input" value="${esc(c.description)}" maxlength="140" placeholder="${isEs ? 'Descripción corta (ej: productos con precio y disponibilidad)' : 'Short description (e.g. products with price and availability)'}" />
    </div>
    <div class="ki-cat-row-actions">
      <button type="button" class="act-btn act-btn-config act-btn--compact" onclick="kiRenameCategory('${esc(c.id)}', this)">${isEs ? 'Guardar' : 'Save'}</button>
      <button type="button" class="act-btn act-btn-remove act-btn--compact" onclick="kiDeleteCategory('${esc(c.id)}', this)">${isEs ? 'Eliminar' : 'Delete'}</button>
    </div>
  </div>`).join('')

  return `<div id="ki-cat-modal" class="wizard-overlay" style="display:none">
    <div class="wizard-modal" style="position:relative">
      <button type="button" class="wizard-close" onclick="kiCloseCategoriesModal()">&times;</button>
      <div class="wizard-steps">
        <div class="wizard-title">${isEs ? 'Editar categorias' : 'Edit categories'}</div>
        <p style="font-size:12px;color:var(--on-surface-dim);margin:0 0 12px">${isEs ? 'La descripción le indica al agente qué tipo de información hay en cada categoría.' : 'The description tells the agent what information is in each category.'}</p>
        <div id="ki-cat-list">${rows || `<p style="color:var(--on-surface-dim);font-size:13px">${isEs ? 'No hay categorias.' : 'No categories.'}</p>`}</div>
        <div style="margin-top:16px;display:flex;gap:8px">
          <input type="text" id="ki-cat-new-name" class="wizard-input" placeholder="${isEs ? 'Nueva categoria...' : 'New category...'}" maxlength="60" />
          <button type="button" class="act-btn act-btn-cta" onclick="kiAddCategory()" style="font-size:13px">${isEs ? 'Agregar' : 'Add'}</button>
        </div>
      </div>
    </div>
  </div>`
}

// ═══════════════════════════════════════════
// Client Script
// ═══════════════════════════════════════════

function renderClientScript(lang: Lang, categories: KnowledgeCategory[]): string {
  const isEs = lang === 'es'
  return `<script>(function(){
  var API = '/console/api/knowledge/items';

  function toast(msg, type) {
    if (window.showToast) window.showToast(msg, type || 'success');
  }

  function api(path, method, body) {
    var opts = { method: method || 'GET', headers: {} };
    if (body) {
      opts.headers['Content-Type'] = 'application/json';
      opts.body = JSON.stringify(body);
    }
    return fetch(API + (path || ''), opts).then(function(r) { return r.json(); });
  }

  function esc(s) { return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;'); }

  // ── Wizard state ──
  var wizState = {
    itemId: null,
    editing: false,
    coreKey: null,
    tabs: [],
    activeTabIdx: 0,
  };

  // ── Page navigation (global wizard pattern) ──
  function showWizPage(pageIdx) {
    var modal = document.getElementById('ki-wizard');
    var pages = modal.querySelectorAll('.wizard-page');
    var dots = modal.querySelectorAll('.wizard-dot');
    var lines = modal.querySelectorAll('.wizard-dot-line');
    for (var i = 0; i < pages.length; i++) {
      var pIdx = pages[i].getAttribute('data-page');
      pages[i].classList.toggle('active', pIdx === String(pageIdx));
    }
    if (typeof pageIdx === 'number') {
      for (var j = 0; j < dots.length; j++) dots[j].classList.toggle('active', j <= pageIdx);
      for (var k = 0; k < lines.length; k++) lines[k].classList.toggle('active', k < pageIdx);
    }
  }

  function showLoading(msg) {
    document.getElementById('ki-wiz-loading-text').textContent = msg || '';
    showWizPage('loading');
  }

  // ── Error helpers ──
  function wizShowErr(field, msg) {
    var el = document.getElementById('ki-wiz-err-' + field);
    var input = document.getElementById('ki-wiz-' + field);
    if (el) { el.textContent = msg; el.style.display = 'block'; }
    if (input) input.classList.add('invalid');
  }

  window.kiWizClearErr = function(field) {
    var el = document.getElementById('ki-wiz-err-' + field);
    var input = document.getElementById('ki-wiz-' + field);
    if (el) { el.textContent = ''; el.style.display = 'none'; }
    if (input) input.classList.remove('invalid');
  };

  function wizClearAllErr() {
    ['title', 'desc', 'url'].forEach(function(f) { window.kiWizClearErr(f); });
  }

  // ── Category searchable dropdown ──
  var allCategories = ${JSON.stringify(categories.map(c => ({ id: c.id, title: c.title })))};

  window.kiWizFilterCats = function() {
    var input = document.getElementById('ki-wiz-cat-input');
    var dropdown = document.getElementById('ki-wiz-cat-dropdown');
    var q = input.value.toLowerCase().trim();
    if (!q) { dropdown.style.display = 'none'; return; }

    var matches = allCategories.filter(function(c) { return c.title.toLowerCase().indexOf(q) !== -1; });
    var html = '';
    matches.forEach(function(c) {
      html += '<div class="ki-cat-dropdown-item" onclick="kiWizSelectCat(\\'' + c.id + '\\', \\'' + esc(c.title) + '\\')">' + esc(c.title) + '</div>';
    });
    // Option to create new
    var exact = allCategories.some(function(c) { return c.title.toLowerCase() === q; });
    if (!exact && q.length > 0) {
      html += '<div class="ki-cat-dropdown-item ki-cat-create" onclick="kiWizCreateCat(\\'' + esc(input.value.trim()) + '\\')">+ ${isEs ? 'Crear' : 'Create'} &quot;' + esc(input.value.trim()) + '&quot;</div>';
    }
    dropdown.innerHTML = html;
    dropdown.style.display = html ? '' : 'none';
  };

  window.kiWizSelectCat = function(id, title) {
    document.getElementById('ki-wiz-category').value = id;
    document.getElementById('ki-wiz-cat-input').value = '';
    document.getElementById('ki-wiz-cat-dropdown').style.display = 'none';
    document.getElementById('ki-wiz-cat-selected').innerHTML = '<span class="ki-cat-chip">' + esc(title) + ' <button type="button" onclick="kiWizClearCat()">&times;</button></span>';
  };

  window.kiWizClearCat = function() {
    document.getElementById('ki-wiz-category').value = '';
    document.getElementById('ki-wiz-cat-selected').innerHTML = '';
  };

  window.kiWizCreateCat = function(name) {
    fetch('/console/api/knowledge/categories', {
      method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({title: name})
    }).then(function(r){return r.json();}).then(function(r) {
      if (r.id) {
        allCategories.push({id: r.id, title: name});
        kiWizSelectCat(r.id, name);
      }
    });
  };

  window.kiWizShowCatDropdown = function() { kiWizFilterCats(); };

  // ── Wizard open/close ──
  function resetCategoryField() {
    document.getElementById('ki-wiz-category').value = '';
    document.getElementById('ki-wiz-cat-input').value = '';
    document.getElementById('ki-wiz-cat-dropdown').style.display = 'none';
    document.getElementById('ki-wiz-cat-selected').innerHTML = '';
  }

  function setCategorySelection(catId) {
    if (!catId) { resetCategoryField(); return; }
    var cat = allCategories.find(function(c) { return c.id === catId; });
    if (cat) { kiWizSelectCat(cat.id, cat.title); }
  }

  window.kiOpenWizard = function() {
    wizState = { itemId: null, editing: false, coreKey: null, tabs: [], activeTabIdx: 0 };
    document.getElementById('ki-wizard').style.display = '';
    document.getElementById('ki-wiz-title').value = '';
    document.getElementById('ki-wiz-desc').value = '';
    var urlInput = document.getElementById('ki-wiz-url');
    urlInput.value = '';
    urlInput.disabled = false;
    resetCategoryField();
    wizClearAllErr();
    showWizPage(0);
    setTimeout(function() { document.getElementById('ki-wiz-title').focus(); }, 100);
  };

  window.kiOpenWizardEdit = function(data) {
    wizState = { itemId: data.id, editing: true, coreKey: null, tabs: [], activeTabIdx: 0 };
    document.getElementById('ki-wizard').style.display = '';
    document.getElementById('ki-wiz-title').value = data.title;
    document.getElementById('ki-wiz-desc').value = data.description;
    var urlInput = document.getElementById('ki-wiz-url');
    urlInput.value = data.sourceUrl;
    urlInput.disabled = true;
    setCategorySelection(data.categoryId || '');
    wizClearAllErr();
    showWizPage(0);
    setTimeout(function() { document.getElementById('ki-wiz-title').focus(); }, 100);
  };

  window.kiOpenWizardForCore = function(key, title, desc, url, existingItemId) {
    var hasExisting = !!(existingItemId && existingItemId.length > 5);
    wizState = { itemId: hasExisting ? existingItemId : null, editing: hasExisting, coreKey: key, tabs: [], activeTabIdx: 0 };
    document.getElementById('ki-wizard').style.display = '';
    document.getElementById('ki-wiz-title').value = title;
    document.getElementById('ki-wiz-desc').value = desc;
    var urlInput = document.getElementById('ki-wiz-url');
    urlInput.value = url;
    urlInput.disabled = hasExisting;
    resetCategoryField();
    wizClearAllErr();
    showWizPage(0);
    setTimeout(function() { (hasExisting ? document.getElementById('ki-wiz-desc') : document.getElementById('ki-wiz-url')).focus(); }, 100);
  };

  window.kiOpenWizardFromBtn = function(btn) {
    var key = btn.getAttribute('data-core-key');
    var title = btn.getAttribute('data-title');
    var desc = btn.getAttribute('data-desc');
    var url = btn.getAttribute('data-url');
    var itemId = btn.getAttribute('data-item-id');
    kiOpenWizardForCore(key, title, desc, url, itemId);
  };

  window.kiCloseWizard = function() {
    document.getElementById('ki-wizard').style.display = 'none';
  };

  // ── Step 1: Next ──
  window.kiWizStep1Next = function() {
    wizClearAllErr();
    var title = document.getElementById('ki-wiz-title').value.trim();
    var desc = document.getElementById('ki-wiz-desc').value.trim();
    var cat = document.getElementById('ki-wiz-category').value;
    var url = document.getElementById('ki-wiz-url').value.trim();
    var hasErr = false;
    if (!title) { wizShowErr('title', '${isEs ? 'El titulo es requerido' : 'Title is required'}'); hasErr = true; }
    if (!desc || desc.length < 20) { wizShowErr('desc', '${isEs ? 'La descripcion es requerida (min. 20 caracteres)' : 'Description is required (min. 20 characters)'}'); hasErr = true; }
    if (!url) { wizShowErr('url', '${isEs ? 'La URL es requerida' : 'URL is required'}'); hasErr = true; }
    if (hasErr) return;

    var btn = document.getElementById('ki-wiz-next1');
    if (btn) { btn.disabled = true; btn.textContent = '${isEs ? 'Procesando...' : 'Processing...'}'; }

    if (wizState.editing && wizState.itemId) {
      // Update existing item then scan tabs
      showLoading('${isEs ? 'Actualizando y escaneando hojas...' : 'Updating and scanning sheets...'}');
      api('', 'PUT', { id: wizState.itemId, title: title, description: desc, categoryId: cat || undefined })
        .then(function(r) {
          if (r.error) { showWizPage(0); wizShowErr('title', r.error); if (btn) { btn.disabled = false; btn.textContent = '${t('next', lang)}'; } return; }
          toast('${isEs ? 'Actualizado' : 'Updated'}');
          return api('/scan-tabs', 'POST', { id: wizState.itemId });
        })
        .then(function(r) {
          if (btn) { btn.disabled = false; btn.textContent = '${t('next', lang)}'; }
          if (!r) return;
          if (r.tabs) wizState.tabs = r.tabs;
          else if (r.error) { toast(r.error, 'error'); }
          renderWizTabs();
          showWizPage(1);
        })
        .catch(function(err) {
          showWizPage(0);
          if (btn) { btn.disabled = false; btn.textContent = '${t('next', lang)}'; }
          toast(String(err), 'error');
        });
      return;
    }

    // Core items with existing URL but no itemId — need to create as new item
    if (wizState.coreKey && wizState.editing && !wizState.itemId) {
      wizState.editing = false;
    }

    // Creating new item: verify URL, create item, scan tabs
    showLoading('${isEs ? 'Verificando URL y escaneando hojas...' : 'Verifying URL and scanning sheets...'}');
    api('/verify-url', 'POST', { sourceUrl: url })
      .then(function(v) {
        if (v.accessible === false) {
          showWizPage(0);
          wizShowErr('url', v.error || '${isEs ? 'No se puede acceder al recurso' : 'Cannot access the resource'}');
          if (btn) { btn.disabled = false; btn.textContent = '${t('next', lang)}'; }
          return null;
        }
        return api('', 'POST', { title: title, description: desc, categoryId: cat || undefined, sourceUrl: url });
      })
      .then(function(r) {
        console.log('CREATE response:', JSON.stringify(r));
        if (!r) { console.log('CREATE returned null/undefined'); return; }
        if (r.error) {
          showWizPage(0);
          wizShowErr('url', r.error);
          if (btn) { btn.disabled = false; btn.textContent = '${t('next', lang)}'; }
          return;
        }
        wizState.itemId = r.item?.id || r.item?.item?.id || r.id;
        if (!wizState.itemId) {
          console.error('Knowledge create response missing id:', JSON.stringify(r));
          showWizPage(0);
          wizShowErr('url', '${isEs ? 'Error: no se recibio ID del item creado' : 'Error: no item ID received'}');
          if (btn) { btn.disabled = false; btn.textContent = '${t('next', lang)}'; }
          return null;
        }
        wizState.editing = true;
        toast('${isEs ? 'Conocimiento creado — escaneando hojas...' : 'Knowledge created — scanning sheets...'}');
        // Auto-scan tabs
        return api('/scan-tabs', 'POST', { id: wizState.itemId });
      })
      .then(function(r) {
        if (!r) return;
        if (btn) { btn.disabled = false; btn.textContent = '${t('next', lang)}'; }
        console.log('scan-tabs response:', JSON.stringify(r));
        if (r.error) {
          toast('${isEs ? 'Error escaneando hojas: ' : 'Error scanning sheets: '}' + r.error, 'error');
          // Still go to step 2 so user can retry
        }
        if (r.tabs) wizState.tabs = r.tabs;
        else if (r.item?.tabs) wizState.tabs = r.item.tabs;
        renderWizTabs();
        showWizPage(1);
      })
      .catch(function(err) {
        console.error('scan-tabs error:', err);
        showWizPage(0);
        if (btn) { btn.disabled = false; btn.textContent = '${t('next', lang)}'; }
        toast(String(err), 'error');
      });
  };

  // ── Step 2: Tabs rendering ──
  function renderWizTabs() {
    var container = document.getElementById('ki-wiz-tabs-list');
    if (!container) return;
    if (!wizState.tabs || wizState.tabs.length === 0) {
      container.innerHTML = '<p class="ki-empty-note">${t('no_tabs', lang)}</p>';
      return;
    }
    var html = '';
    for (var i = 0; i < wizState.tabs.length; i++) {
      var tab = wizState.tabs[i];
      var tabIgnored = !!(tab.ignored);
      html += '<div class="ki-wiz-tab-row' + (tabIgnored ? ' ki-wiz-row-ignored' : '') + '" data-tab-id="' + esc(tab.id) + '">'
        + '<div class="ki-wiz-tab-header">'
        + '<div class="ki-wiz-tab-name">' + esc(tab.tabName || tab.tab_name || '') + '</div>'
        + '<label class="toggle toggle-sm ki-ignore-toggle" title="${isEs ? 'Ignorar esta hoja' : 'Ignore this sheet'}">'
        + '<input type="checkbox" ' + (tabIgnored ? 'checked' : '') + ' onchange="kiToggleTabIgnore(\\'' + esc(tab.id) + '\\', this.checked)" />'
        + '<span class="toggle-slider"></span>'
        + '</label>'
        + '<span class="ki-ignore-label">${isEs ? 'Ignorar' : 'Ignore'}</span>'
        + '</div>'
        + '<textarea class="wizard-input ki-wiz-tab-desc" rows="2" placeholder="${t('tab_desc', lang)}"'
        + ' onblur="kiWizSaveTabDesc(\\'' + esc(tab.id) + '\\', this.value)"'
        + ' style="resize:vertical;font-size:13px;margin-top:4px"' + (tabIgnored ? ' disabled' : '') + '>' + esc(tab.description || '') + '</textarea>'
        + '</div>';
    }
    container.innerHTML = html;
  }

  window.kiWizSaveTabDesc = function(tabId, desc) {
    api('/tab-description', 'PUT', { tabId: tabId, description: desc }).catch(function() {});
  };

  window.kiWizRefreshTabs = function() {
    if (!wizState.itemId) return;
    toast('${isEs ? 'Escaneando tabs...' : 'Scanning tabs...'}', 'info');
    api('/scan-tabs', 'POST', { id: wizState.itemId })
      .then(function(r) {
        if (r.error) { toast(r.error, 'error'); return; }
        if (r.tabs) wizState.tabs = r.tabs;
        renderWizTabs();
        toast('${isEs ? 'Tabs actualizadas' : 'Tabs refreshed'}');
      })
      .catch(function(err) { toast(String(err), 'error'); });
  };

  // ── Step 2: Next (scan columns, go to step 3) ──
  window.kiWizStep2Next = function() {
    if (!wizState.tabs || wizState.tabs.length === 0) {
      toast('${isEs ? 'No hay tabs para escanear columnas' : 'No tabs to scan columns for'}', 'error');
      return;
    }
    var btn = document.getElementById('ki-wiz-next2');
    if (btn) { btn.disabled = true; btn.textContent = '${isEs ? 'Escaneando...' : 'Scanning...'}'; }

    // Scan columns for all tabs sequentially
    var chain = Promise.resolve();
    wizState.tabs.forEach(function(tab) {
      chain = chain.then(function() {
        return api('/scan-columns', 'POST', { tabId: tab.id }).then(function(r) {
          if (r.columns) tab.columns = r.columns;
        });
      });
    });
    chain.then(function() {
      if (btn) { btn.disabled = false; btn.textContent = '${t('next', lang)}'; }
      renderWizCols();
      showWizPage(2);
    }).catch(function(err) {
      if (btn) { btn.disabled = false; btn.textContent = '${t('next', lang)}'; }
      toast(String(err), 'error');
    });
  };

  window.kiWizSkipToFinish = function() {
    toast('${isEs ? 'Listo' : 'Done'}');
    window.kiCloseWizard();
    location.reload();
  };

  // ── Step 3: Columns rendering ──
  function renderWizCols() {
    var navEl = document.getElementById('ki-wiz-col-tab-nav');
    var listEl = document.getElementById('ki-wiz-cols-list');
    if (!navEl || !listEl) return;

    if (!wizState.tabs || wizState.tabs.length === 0) {
      navEl.innerHTML = '';
      listEl.innerHTML = '<p class="ki-empty-note">${t('no_cols', lang)}</p>';
      return;
    }

    // Tab navigation
    var navHtml = '';
    for (var i = 0; i < wizState.tabs.length; i++) {
      var active = i === wizState.activeTabIdx ? ' ki-wiz-col-tab-active' : '';
      navHtml += '<button type="button" class="act-btn act-btn-config act-btn--compact ki-wiz-col-tab-btn' + active + '" onclick="kiWizSelectColTab(' + i + ')">'
        + esc(wizState.tabs[i].tabName || wizState.tabs[i].tab_name || 'Tab ' + (i + 1)) + '</button>';
    }
    navEl.innerHTML = navHtml;

    renderColsForActiveTab(listEl);
  }

  function renderColsForActiveTab(listEl) {
    if (!listEl) listEl = document.getElementById('ki-wiz-cols-list');
    if (!listEl) return;
    var tab = wizState.tabs[wizState.activeTabIdx];
    if (!tab || !tab.columns || tab.columns.length === 0) {
      listEl.innerHTML = '<p class="ki-empty-note">${t('no_cols', lang)}</p>';
      return;
    }
    var html = '';
    for (var j = 0; j < tab.columns.length; j++) {
      var col = tab.columns[j];
      var colIgnored = !!(col.ignored);
      html += '<div class="ki-wiz-col-row' + (colIgnored ? ' ki-wiz-row-ignored' : '') + '">'
        + '<span class="ki-wiz-col-name">' + esc(col.columnName || col.column_name || '') + '</span>'
        + '<input type="text" class="wizard-input ki-wiz-col-desc" placeholder="${t('col_desc', lang)}"'
        + ' value="' + esc(col.description || '') + '"'
        + ' onblur="kiWizSaveColDesc(\\'' + esc(col.id) + '\\', this.value)"'
        + (colIgnored ? ' disabled' : '') + ' />'
        + '<label class="toggle toggle-sm ki-ignore-toggle" title="${isEs ? 'Ignorar esta columna' : 'Ignore this column'}">'
        + '<input type="checkbox" ' + (colIgnored ? 'checked' : '') + ' onchange="kiToggleColumnIgnore(\\'' + esc(col.id) + '\\', this.checked)" />'
        + '<span class="toggle-slider"></span>'
        + '</label>'
        + '<span class="ki-ignore-label">${isEs ? 'Ignorar' : 'Ignore'}</span>'
        + '</div>';
    }
    listEl.innerHTML = html;
  }

  window.kiWizSelectColTab = function(idx) {
    wizState.activeTabIdx = idx;
    renderWizCols();
  };

  window.kiWizSaveColDesc = function(colId, desc) {
    api('/column-description', 'PUT', { columnId: colId, description: desc }).catch(function() {});
  };

  window.kiWizRefreshCols = function() {
    if (!wizState.tabs || wizState.tabs.length === 0) return;
    var tab = wizState.tabs[wizState.activeTabIdx];
    if (!tab) return;
    toast('${isEs ? 'Escaneando columnas...' : 'Scanning columns...'}', 'info');
    api('/scan-columns', 'POST', { tabId: tab.id })
      .then(function(r) {
        if (r.error) { toast(r.error, 'error'); return; }
        if (r.columns) tab.columns = r.columns;
        renderColsForActiveTab(null);
        toast('${isEs ? 'Columnas actualizadas' : 'Columns refreshed'}');
      })
      .catch(function(err) { toast(String(err), 'error'); });
  };

  window.kiWizFinish = function() {
    toast('${isEs ? 'Listo' : 'Done'}');
    window.kiCloseWizard();
    location.reload();
  };

  // ── Item actions (outside wizard) ──
  window.kiToggleActive = function(id, active) {
    api('/active', 'PUT', { id: id, active: active })
      .then(function(r) {
        if (r.error) { toast(r.error, 'error'); return; }
        toast(active ? '${isEs ? 'Activado' : 'Activated'}' : '${isEs ? 'Desactivado' : 'Deactivated'}');
        location.reload();
      })
      .catch(function(err) { toast(String(err), 'error'); });
  };

  window.kiToggleCore = function(id, isCore) {
    api('/core', 'PUT', { id: id, isCore: isCore })
      .then(function(r) {
        if (r.error) { toast(r.error, 'error'); location.reload(); return; }
        toast(isCore
          ? '${isEs ? 'Marcado como principal' : 'Marked as main'}'
          : '${isEs ? 'Quitado de principales' : 'Removed from main'}');
        location.reload();
      })
      .catch(function(err) { toast(String(err), 'error'); });
  };

  window.kiDeleteItem = function(id) {
    if (!confirm('${t('confirm_delete', lang)}')) return;
    // Deactivate first (required by API), then delete
    api('/active', 'PUT', { id: id, active: false })
      .then(function() {
        return api('/delete', 'POST', { id: id });
      })
      .then(function(r) {
        if (r.error) { toast(r.error, 'error'); return; }
        toast('${isEs ? 'Eliminado' : 'Deleted'}');
        location.reload();
      })
      .catch(function(err) { toast(String(err), 'error'); });
  };

  window.kiLoadContent = function(id) {
    if (!confirm('${isEs ? '¿Cargar contenido y generar embeddings?' : 'Load content and generate embeddings?'}')) return;
    toast('${isEs ? 'Cargando contenido...' : 'Loading content...'}', 'info');
    api('/load-content', 'POST', { id: id })
      .then(function(r) {
        if (r.error) { toast(r.error, 'error'); return; }
        toast('${isEs ? 'Contenido cargado: ' : 'Content loaded: '}' + r.chunks + ' chunks');
        location.reload();
      })
      .catch(function(err) { toast(String(err), 'error'); });
  };

  window.kiBulkVectorize = function() {
    if (!confirm('${isEs ? '¿Generar embeddings para todo el contenido pendiente?' : 'Generate embeddings for all pending content?'}')) return;
    toast('${isEs ? 'Generando embeddings...' : 'Generating embeddings...'}', 'info');
    fetch('/console/api/knowledge/vectorize', { method: 'POST' })
      .then(function(r) { return r.json(); })
      .then(function(r) {
        if (r.error) { toast(r.error, 'error'); return; }
        toast('${isEs ? 'Embeddings en proceso' : 'Embeddings in progress'}');
      })
      .catch(function(err) { toast(String(err), 'error'); });
  };

  // ── Close cat dropdown on outside click ──
  document.addEventListener('click', function(e) {
    var field = document.querySelector('.ki-category-field');
    if (field && !field.contains(e.target)) {
      document.getElementById('ki-wiz-cat-dropdown').style.display = 'none';
    }
  });

  // ── Close modals on overlay click ──
  var catModal = document.getElementById('ki-cat-modal');
  if (catModal) catModal.addEventListener('click', function(e) {
    if (e.target === this) window.kiCloseCategoriesModal();
  });

  // ── Categories CRUD ──
  var CAT_API = '/console/api/knowledge/categories';

  window.kiOpenCategoriesModal = function() {
    document.getElementById('ki-cat-modal').style.display = '';
  };
  window.kiCloseCategoriesModal = function() {
    document.getElementById('ki-cat-modal').style.display = 'none';
  };

  window.kiAddCategory = function() {
    var inp = document.getElementById('ki-cat-new-name');
    var name = inp.value.trim();
    if (!name) return;
    fetch(CAT_API, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: name }) })
      .then(function(r) { return r.json(); })
      .then(function(r) {
        if (r.error) { toast(r.error, 'error'); return; }
        toast('${isEs ? 'Categoria agregada' : 'Category added'}');
        location.reload();
      })
      .catch(function(err) { toast(String(err), 'error'); });
  };

  window.kiRenameCategory = function(id, btn) {
    var row = btn.closest('.ki-cat-row');
    var name = row.querySelector('.ki-cat-name-input').value.trim();
    var desc = (row.querySelector('.ki-cat-desc-input') || {}).value || '';
    if (!name) return;
    fetch(CAT_API, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: id, title: name, description: desc.trim() }) })
      .then(function(r) { return r.json(); })
      .then(function(r) {
        if (r.error) { toast(r.error, 'error'); return; }
        toast('${isEs ? 'Categoria actualizada' : 'Category updated'}');
        row.style.background = 'var(--success-container)'; setTimeout(function() { row.style.background = ''; }, 600);
      })
      .catch(function(err) { toast(String(err), 'error'); });
  };

  window.kiDeleteCategory = function(id, btn) {
    if (!confirm('${isEs ? '¿Eliminar esta categoria?' : 'Delete this category?'}')) return;
    fetch(CAT_API + '/delete', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: id }) })
      .then(function(r) { return r.json(); })
      .then(function(r) {
        if (r.error) { toast(r.error, 'error'); return; }
        toast('${isEs ? 'Categoria eliminada' : 'Category deleted'}');
        location.reload();
      })
      .catch(function(err) { toast(String(err), 'error'); });
  };


  // ── YouTube URL hint ──
  window.kiWizCheckYoutube = function(url) {
    var hint = document.getElementById('ki-wiz-yt-hint');
    if (hint) hint.style.display = (url && url.indexOf('youtube.com') !== -1) ? '' : 'none';
  };

  // ── Shareable toggle ──
  window.kiToggleShareable = function(id, shareable) {
    api('/shareable', 'PUT', { id: id, shareable: shareable })
      .then(function(r) {
        if (r.error) { toast(r.error, 'error'); return; }
        toast(shareable
          ? '${isEs ? 'Compartible activado' : 'Sharing enabled'}'
          : '${isEs ? 'Compartible desactivado' : 'Sharing disabled'}');
        location.reload();
      })
      .catch(function(err) { toast(String(err), 'error'); });
  };

  // ── Ignore tab toggle ──
  window.kiToggleTabIgnore = function(tabId, ignored) {
    api('/tab-ignore', 'PUT', { tabId: tabId, ignored: ignored })
      .then(function(r) {
        if (r.error) { toast(r.error, 'error'); return; }
        // Update local wizState
        for (var i = 0; i < wizState.tabs.length; i++) {
          if (wizState.tabs[i].id === tabId) { wizState.tabs[i].ignored = ignored; break; }
        }
        toast(ignored ? '${isEs ? 'Hoja ignorada' : 'Sheet ignored'}' : '${isEs ? 'Hoja incluida' : 'Sheet included'}');
        renderWizTabs();
      })
      .catch(function(err) { toast(String(err), 'error'); });
  };

  // ── Ignore column toggle ──
  window.kiToggleColumnIgnore = function(colId, ignored) {
    api('/column-ignore', 'PUT', { columnId: colId, ignored: ignored })
      .then(function(r) {
        if (r.error) { toast(r.error, 'error'); return; }
        // Update local wizState
        var tab = wizState.tabs[wizState.activeTabIdx];
        if (tab && tab.columns) {
          for (var j = 0; j < tab.columns.length; j++) {
            if (tab.columns[j].id === colId) { tab.columns[j].ignored = ignored; break; }
          }
        }
        toast(ignored ? '${isEs ? 'Columna ignorada' : 'Column ignored'}' : '${isEs ? 'Columna incluida' : 'Column included'}');
        renderColsForActiveTab(null);
      })
      .catch(function(err) { toast(String(err), 'error'); });
  };

})()</script>`
}

// ═══════════════════════════════════════════
// Styles
// ═══════════════════════════════════════════

function renderStyles(): string {
  return `<style>
.ki-header { display:flex; justify-content:space-between; align-items:center; margin-bottom:16px; }

/* List table layout */
.ki-list { display:flex; flex-direction:column; gap:8px; }
.ki-row { display:grid !important; grid-template-columns:1fr 90px 150px 70px auto; gap:12px; align-items:center; padding:14px 16px !important; }
.ki-row-inactive { opacity:0.55; }

/* Nombre column */
.ki-col-nombre { display:flex; align-items:center; gap:12px; min-width:0; overflow:hidden; }
.ki-col-acciones { display:flex; align-items:center; gap:6px; flex-wrap:wrap; }

/* Source icon */
.ki-source-icon { width:36px; height:36px; border-radius:0.6rem; display:flex; align-items:center; justify-content:center; flex-shrink:0; }

/* Nombre info */
.ki-nombre-info { min-width:0; overflow:hidden; }
.ki-item-name { font-weight:600; font-size:14px; color:var(--on-surface); display:block; }
.ki-item-desc { margin:2px 0 0; font-size:12px; color:var(--on-surface-dim); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.ki-tag { display:inline-block; margin-top:4px; padding:1px 8px; border-radius:0.5rem; font-size:11px; background:var(--surface-container-low); color:var(--on-surface-dim); }

/* Badges */
.ki-badge { display:inline-block; padding:2px 8px; border-radius:0.5rem; font-size:11px; font-weight:500; }
.ki-badge-source { background:var(--surface-container-low); color:var(--on-surface-dim); }

/* Status dots */
.ki-status-row { display:flex; align-items:center; gap:6px; font-size:13px; color:var(--on-surface); }
.ki-dot { width:8px; height:8px; border-radius:50%; flex-shrink:0; display:inline-block; }
.ki-dot-pending { background:var(--warning, #f59e0b); }
.ki-dot-processing { background:var(--info, #3b82f6); }
.ki-dot-done { background:var(--success, #22c55e); }
.ki-dot-failed { background:var(--error, #ef4444); }
.ki-chunks { font-size:11px; color:var(--on-surface-dim); margin-left:2px; }

/* Core active button */
.ki-btn-core-on { background:rgba(255,149,0,0.12) !important; color:var(--warning) !important; border-color:rgba(255,149,0,0.3) !important; }
.ki-btn-share-on { background:rgba(59,130,246,0.12) !important; color:var(--info, #3b82f6) !important; border-color:rgba(59,130,246,0.3) !important; }
.ki-info-dot { display:inline-flex; align-items:center; justify-content:center; width:14px; height:14px; border-radius:50%; background:var(--outline-variant); color:var(--on-surface); font-size:9px; font-weight:700; font-style:italic; margin-left:4px; cursor:help; line-height:1; }
.ki-yt-hint { display:flex; align-items:flex-start; gap:8px; margin-top:8px; padding:10px 12px; background:rgba(239,68,68,0.06); border:1px solid rgba(239,68,68,0.15); border-radius:0.5rem; font-size:12px; color:var(--on-surface-dim); line-height:1.4; }
.ki-yt-hint svg { flex-shrink:0; margin-top:1px; color:#ef4444; }

.ki-empty-note { font-size:12px; color:var(--on-surface-dim); margin:4px 0; }

/* Wizard font fix (global has monospace — override to inherit) */
#ki-wizard .wizard-input, #ki-wizard .wizard-btn, #ki-wizard .wizard-label,
#ki-wizard .wizard-page-title, #ki-wizard .wizard-title, #ki-wizard .wizard-instructions,
#ki-cat-modal .wizard-input, #ki-cat-modal .ki-cat-name-input, #ki-cat-modal .ki-cat-desc-input { font-family:inherit; }

/* Wizard green primary button */
.ki-wiz-btn-green { padding:10px 20px; border-radius:0.5rem; border:none; cursor:pointer; font-size:0.85rem; font-weight:600; font-family:inherit; transition:all 0.15s; background:var(--success, #22c55e); color:#fff; }
.ki-wiz-btn-green:hover:not(:disabled) { opacity:0.88; box-shadow:0 2px 8px rgba(34,197,94,0.35); }
.ki-wiz-btn-green:disabled { opacity:0.5; cursor:not-allowed; }

/* Wizard field error */
.wizard-field-error { display:none; color:var(--error, #d32f2f); font-size:12px; margin-top:4px; padding:4px 8px; background:rgba(211,47,47,0.08); border-radius:0.5rem; }

/* Wizard loading spinner */
.ki-wiz-loading-spinner { width:36px; height:36px; border:3px solid var(--outline-variant); border-top-color:var(--primary); border-radius:50%; animation:ki-spin 0.8s linear infinite; margin:0 auto; }
@keyframes ki-spin { to { transform:rotate(360deg); } }

/* Wizard tabs (step 2) */
.ki-wiz-tab-row { padding:10px; background:var(--surface-container-low); border-radius:0.5rem; margin-bottom:8px; }
.ki-wiz-tab-header { display:flex; align-items:center; gap:8px; }
.ki-wiz-tab-name { font-weight:600; font-size:13px; color:var(--on-surface); flex:1; }
.ki-wiz-row-ignored { opacity:0.5; }

/* Wizard columns (step 3) */
.ki-wiz-col-tab-btn.ki-wiz-col-tab-active { background:var(--primary); color:#fff; border-color:var(--primary); }
.ki-wiz-col-row { display:flex; align-items:center; gap:10px; margin-bottom:8px; }
.ki-wiz-col-name { font-size:13px; font-weight:500; color:var(--on-surface); min-width:120px; flex-shrink:0; }
.ki-wiz-col-desc { flex:1; }

/* Ignore toggle */
.ki-ignore-toggle { margin:0; }
.ki-ignore-label { font-size:11px; color:var(--on-surface-dim); white-space:nowrap; }


/* Category searchable dropdown */
.ki-category-field { position:relative; }
.ki-cat-dropdown { position:absolute; top:100%; left:0; right:0; background:var(--surface-container-lowest); border:1px solid var(--outline-variant); border-radius:0.5rem; max-height:200px; overflow-y:auto; z-index:10; box-shadow:0 4px 12px rgba(0,0,0,0.1); }
.ki-cat-dropdown-item { padding:8px 12px; cursor:pointer; font-size:13px; }
.ki-cat-dropdown-item:hover { background:var(--surface-container-low); }
.ki-cat-dropdown-item.ki-cat-create { color:var(--primary); font-weight:500; }
.ki-cat-chip { display:inline-flex; align-items:center; gap:4px; padding:4px 10px; margin-top:6px; background:var(--primary); color:#fff; border-radius:1rem; font-size:12px; }
.ki-cat-chip button { background:none; border:none; color:#fff; cursor:pointer; font-size:14px; padding:0 2px; }

/* Categories modal */
.ki-cat-row { display:flex; align-items:flex-start; gap:8px; padding:10px 0; border-bottom:1px solid var(--outline-variant); }
.ki-cat-row-fields { flex:1; display:flex; flex-direction:column; gap:6px; min-width:0; }
.ki-cat-row-actions { display:flex; flex-direction:column; gap:4px; flex-shrink:0; }
.ki-cat-name-input { width:100%; padding:6px 10px; border:1px solid var(--outline-variant); border-radius:0.5rem; font-size:14px; background:var(--surface-container-lowest); color:var(--on-surface); box-sizing:border-box; }
.ki-cat-desc-input { width:100%; padding:5px 10px; border:1px solid var(--outline-variant); border-radius:0.5rem; font-size:12px; background:var(--surface-container-lowest); color:var(--on-surface-dim); box-sizing:border-box; }

/* Empty state */
.ki-empty-state { padding:40px 24px; text-align:center; border:1.5px dashed var(--outline-variant); border-radius:1rem; background:var(--surface-container-lowest); }
.ki-empty-icon { margin-bottom:14px; display:flex; justify-content:center; color:var(--on-surface-dim); opacity:0.5; }
.ki-empty-title { font-size:15px; font-weight:600; color:var(--on-surface); margin:0 0 6px; }
.ki-empty-body { font-size:13px; color:var(--on-surface-dim); margin:0 0 20px; max-width:360px; margin-left:auto; margin-right:auto; line-height:1.55; }
.ki-empty-add-btn { font-size:14px; padding:10px 20px; }
</style>`
}
