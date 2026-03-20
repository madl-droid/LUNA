// panels.js — Panel builder functions
// Depends on: i18n (t)

function panel(secKey, fieldsHtml) {
  return `<div class="panel"><div class="panel-header" onclick="togglePanel(this)">
    <span class="panel-title">${t('sec_' + secKey)}</span>
    <span class="panel-chevron">&#9660;</span>
  </div><div class="panel-body"><div class="panel-info">${t('sec_' + secKey + '_info')}</div>${fieldsHtml.join('')}</div></div>`
}

function panelRaw(secKey, innerHtml) {
  return `<div class="panel"><div class="panel-header" onclick="togglePanel(this)">
    <span class="panel-title">${t('sec_' + secKey)}</span>
    <span class="panel-chevron">&#9660;</span>
  </div><div class="panel-body"><div class="panel-info">${t('sec_' + secKey + '_info')}</div>${innerHtml}</div></div>`
}

function panelSoon(secKey) {
  return `<div class="panel collapsed"><div class="panel-header" onclick="togglePanel(this)">
    <span class="panel-title">${t('sec_' + secKey)} <span class="panel-badge badge-soon">Proximamente</span></span>
    <span class="panel-chevron">&#9660;</span>
  </div><div class="panel-body"><div class="panel-info">${t('sec_' + secKey + '_info')}</div></div></div>`
}

function panelCollapsed(secKey, fieldsHtml) {
  return `<div class="panel collapsed"><div class="panel-header" onclick="togglePanel(this)">
    <span class="panel-title">${t('sec_' + secKey)}</span>
    <span class="panel-chevron">&#9660;</span>
  </div><div class="panel-body"><div class="panel-info">${t('sec_' + secKey + '_info')}</div>${fieldsHtml.join('')}</div></div>`
}

function togglePanel(header) {
  header.closest('.panel').classList.toggle('collapsed')
}
