// LUNA — Module: templates — Console Section Renderer
// Renderiza la UI de gestión de plantillas en la consola (server-side HTML).

export function renderTemplatesSection(lang: 'es' | 'en'): string {
  const isEs = lang === 'es'

  // i18n strings
  const i = {
    templatesTitle:  isEs ? 'Plantillas registradas'   : 'Registered templates',
    templatesInfo:   isEs ? 'Plantillas de Google Drive disponibles para el agente. El agente las usa para crear documentos con datos del contacto.'
                          : 'Google Drive templates available to the agent. The agent uses them to create documents with contact data.',
    addBtn:          isEs ? 'Agregar plantilla'         : 'Add template',
    cancelBtn:       isEs ? 'Cancelar'                  : 'Cancel',
    saveBtn:         isEs ? 'Guardar'                   : 'Save',
    scanBtn:         isEs ? 'Escanear keys'             : 'Scan keys',
    colName:         isEs ? 'Nombre'                    : 'Name',
    colType:         isEs ? 'Tipo'                      : 'Type',
    colMime:         isEs ? 'Formato'                   : 'Format',
    colKeys:         isEs ? 'Keys'                      : 'Keys',
    colEnabled:      isEs ? 'Activa'                    : 'Enabled',
    colActions:      isEs ? 'Acciones'                  : 'Actions',
    editBtn:         isEs ? 'Editar'                    : 'Edit',
    deleteBtn:       isEs ? 'Eliminar'                  : 'Delete',
    enableBtn:       isEs ? 'Activar'                   : 'Enable',
    disableBtn:      isEs ? 'Desactivar'                : 'Disable',
    loading:         isEs ? 'Cargando...'               : 'Loading...',
    noTemplates:     isEs ? 'No hay plantillas registradas.' : 'No templates registered.',
    driveUrlLabel:   isEs ? 'URL del archivo Drive'     : 'Drive file URL',
    driveUrlInfo:    isEs ? 'Pega la URL del Doc, Sheet o Slides. El sistema detectará las keys automáticamente.' : 'Paste the URL of the Doc, Sheet, or Slides. The system will detect keys automatically.',
    nameLabel:       isEs ? 'Nombre de la plantilla'    : 'Template name',
    descLabel:       isEs ? 'Descripción'               : 'Description',
    typeLabel:       isEs ? 'Tipo de documento'         : 'Document type',
    folderLabel:     isEs ? 'Carpeta (patrón)'          : 'Folder (pattern)',
    folderInfo:      isEs ? 'Patrón de subcarpeta para organizar documentos generados. Ej: {COMPANY_NAME}' : 'Subfolder pattern for organizing generated documents. E.g.: {COMPANY_NAME}',
    sharingLabel:    isEs ? 'Modo de compartir'         : 'Sharing mode',
    keysLabel:       isEs ? 'Keys detectadas'           : 'Detected keys',
    keyNameCol:      isEs ? 'Key'                       : 'Key',
    keyDescCol:      isEs ? 'Descripción'               : 'Description',
    keyDescPlaceholder: isEs ? 'Ej: Nombre del cliente' : 'E.g.: Customer name',
    mimeDetected:    isEs ? 'Formato detectado'         : 'Detected format',
    confirmDelete:   isEs ? '¿Eliminar esta plantilla?' : 'Delete this template?',
    generatedTitle:  isEs ? 'Documentos generados'      : 'Generated documents',
    generatedInfo:   isEs ? 'Últimos 20 documentos creados desde plantillas por el agente.' : 'Last 20 documents created from templates by the agent.',
    noGenerated:     isEs ? 'No hay documentos generados.' : 'No generated documents.',
    colDocName:      isEs ? 'Documento'                 : 'Document',
    colContact:      isEs ? 'Contacto'                  : 'Contact',
    colStatus:       'Status',
    colVersion:      'Ver.',
    colDate:         isEs ? 'Fecha'                     : 'Date',
    colLink:         'Link',
    openLink:        isEs ? 'Abrir'                     : 'Open',
  }

  return `
<div class="panel">
  <div class="panel-header" onclick="togglePanel(this)">
    <span class="panel-title">${i.templatesTitle}</span>
    <span class="panel-chevron">&#9660;</span>
  </div>
  <div class="panel-body">
    <div class="panel-info">${i.templatesInfo}</div>

    <div id="tpl-list-container">
      <p class="text-muted">${i.loading}</p>
    </div>

    <button type="button" class="btn btn-sm" onclick="tplShowForm()" style="margin-top:8px" id="tpl-add-btn">${i.addBtn}</button>

    <!-- Add/Edit form (hidden by default) -->
    <div id="tpl-form-container" style="display:none;margin-top:16px;border:1px solid var(--border);border-radius:8px;padding:16px;">
      <input type="hidden" id="tpl-edit-id" value="">

      <div style="margin-bottom:12px">
        <label class="field-label">${i.driveUrlLabel}</label>
        <div class="panel-info" style="font-size:0.8rem;margin-bottom:4px">${i.driveUrlInfo}</div>
        <div style="display:flex;gap:8px;align-items:center">
          <input type="text" id="tpl-drive-url" class="field-input" placeholder="https://docs.google.com/..." style="flex:1">
          <button type="button" class="btn btn-sm" onclick="tplScanKeys()">${i.scanBtn}</button>
        </div>
        <div id="tpl-mime-detected" style="font-size:0.8rem;margin-top:4px;color:var(--on-surface-dim)"></div>
      </div>

      <div style="margin-bottom:12px">
        <label class="field-label">${i.nameLabel}</label>
        <input type="text" id="tpl-name" class="field-input" placeholder="${i.nameLabel}">
      </div>

      <div style="margin-bottom:12px">
        <label class="field-label">${i.descLabel}</label>
        <input type="text" id="tpl-description" class="field-input" placeholder="${i.descLabel}">
      </div>

      <div style="display:flex;gap:12px;margin-bottom:12px">
        <div style="flex:1">
          <label class="field-label">${i.typeLabel}</label>
          <select id="tpl-doc-type" class="field-input">
            <option value="cotizacion">${isEs ? 'Cotización' : 'Quote'}</option>
            <option value="presentacion">${isEs ? 'Presentación' : 'Presentation'}</option>
            <option value="comparativo">${isEs ? 'Comparativo' : 'Comparison'}</option>
            <option value="otro">${isEs ? 'Otro' : 'Other'}</option>
          </select>
        </div>
        <div style="flex:1">
          <label class="field-label">${i.sharingLabel}</label>
          <select id="tpl-sharing-mode" class="field-input">
            <option value="anyone_with_link">${isEs ? 'Cualquiera con el enlace' : 'Anyone with the link'}</option>
            <option value="requester_only">${isEs ? 'Solo el solicitante' : 'Requester only'}</option>
          </select>
        </div>
      </div>

      <div style="margin-bottom:12px">
        <label class="field-label">${i.folderLabel}</label>
        <div class="panel-info" style="font-size:0.8rem;margin-bottom:4px">${i.folderInfo}</div>
        <input type="text" id="tpl-folder-pattern" class="field-input" placeholder="{COMPANY_NAME}">
      </div>

      <div id="tpl-keys-section" style="display:none;margin-bottom:12px">
        <label class="field-label">${i.keysLabel}</label>
        <table class="data-table" id="tpl-keys-table">
          <thead>
            <tr>
              <th>${i.keyNameCol}</th>
              <th>${i.keyDescCol}</th>
            </tr>
          </thead>
          <tbody id="tpl-keys-tbody"></tbody>
        </table>
      </div>

      <div style="display:flex;gap:8px;margin-top:12px">
        <button type="button" class="btn btn-sm btn-primary" onclick="tplSave()">${i.saveBtn}</button>
        <button type="button" class="btn btn-sm" onclick="tplCancelForm()">${i.cancelBtn}</button>
      </div>
    </div>
  </div>
</div>

<div class="panel">
  <div class="panel-header" onclick="togglePanel(this)">
    <span class="panel-title">${i.generatedTitle}</span>
    <span class="panel-chevron">&#9660;</span>
  </div>
  <div class="panel-body">
    <div class="panel-info">${i.generatedInfo}</div>
    <div id="tpl-generated-container">
      <p class="text-muted">${i.loading}</p>
    </div>
  </div>
</div>

<script>
(function() {
  const LANG = '${lang}';
  const API = '/console/api/templates';

  // ─── Load templates list ─────────────────────────────────────────────

  async function loadTemplates() {
    try {
      const res = await fetch(API + '/list');
      const data = await res.json();
      const container = document.getElementById('tpl-list-container');
      if (!container) return;
      if (!data.ok || !data.templates.length) {
        container.innerHTML = '<p class="text-muted">${i.noTemplates}</p>';
        return;
      }
      let html = '<table class="data-table"><thead><tr>';
      html += '<th>${i.colName}</th><th>${i.colType}</th><th>${i.colMime}</th><th>${i.colKeys}</th><th>${i.colEnabled}</th><th>${i.colActions}</th>';
      html += '</tr></thead><tbody>';
      for (const t of data.templates) {
        const enabledIcon = t.enabled ? '&#9989;' : '&#10060;';
        const toggleLabel = t.enabled ? '${i.disableBtn}' : '${i.enableBtn}';
        html += '<tr>';
        html += '<td><strong>' + esc(t.name) + '</strong>' + (t.description ? '<br><small>' + esc(t.description) + '</small>' : '') + '</td>';
        html += '<td>' + esc(t.docType) + '</td>';
        html += '<td>' + esc(t.mimeType) + '</td>';
        html += '<td>' + (t.keys ? t.keys.length : 0) + '</td>';
        html += '<td>' + enabledIcon + '</td>';
        html += '<td style="white-space:nowrap">';
        html += '<button class="btn btn-xs" onclick="tplEdit(\\'' + t.id + '\\')">${i.editBtn}</button> ';
        html += '<button class="btn btn-xs" onclick="tplToggle(\\'' + t.id + '\\', ' + !t.enabled + ')">' + toggleLabel + '</button> ';
        html += '<button class="btn btn-xs btn-danger" onclick="tplDelete(\\'' + t.id + '\\')">${i.deleteBtn}</button>';
        html += '</td></tr>';
      }
      html += '</tbody></table>';
      container.innerHTML = html;
    } catch (err) { console.error('Failed to load templates', err); }
  }

  // ─── Load generated docs ─────────────────────────────────────────────

  async function loadGenerated() {
    try {
      const res = await fetch(API + '/generated');
      const data = await res.json();
      const container = document.getElementById('tpl-generated-container');
      if (!container) return;
      if (!data.ok || !data.generated.length) {
        container.innerHTML = '<p class="text-muted">${i.noGenerated}</p>';
        return;
      }
      let html = '<table class="data-table"><thead><tr>';
      html += '<th>${i.colDocName}</th><th>${i.colType}</th><th>${i.colContact}</th><th>${i.colStatus}</th><th>${i.colVersion}</th><th>${i.colDate}</th><th>${i.colLink}</th>';
      html += '</tr></thead><tbody>';
      for (const g of data.generated) {
        const date = new Date(g.createdAt).toLocaleDateString();
        html += '<tr>';
        html += '<td>' + esc(g.docName) + '</td>';
        html += '<td>' + esc(g.docType) + '</td>';
        html += '<td>' + esc(g.contactId || '-') + '</td>';
        html += '<td>' + esc(g.status) + '</td>';
        html += '<td>' + g.version + '</td>';
        html += '<td>' + date + '</td>';
        html += '<td><a href="' + esc(g.webViewLink) + '" target="_blank" class="btn btn-xs">${i.openLink}</a></td>';
        html += '</tr>';
      }
      html += '</tbody></table>';
      container.innerHTML = html;
    } catch (err) { console.error('Failed to load generated docs', err); }
  }

  // ─── Form: show / cancel ─────────────────────────────────────────────

  window.tplShowForm = function() {
    document.getElementById('tpl-edit-id').value = '';
    document.getElementById('tpl-drive-url').value = '';
    document.getElementById('tpl-name').value = '';
    document.getElementById('tpl-description').value = '';
    document.getElementById('tpl-doc-type').value = 'cotizacion';
    document.getElementById('tpl-sharing-mode').value = 'anyone_with_link';
    document.getElementById('tpl-folder-pattern').value = '';
    document.getElementById('tpl-mime-detected').textContent = '';
    document.getElementById('tpl-keys-tbody').innerHTML = '';
    document.getElementById('tpl-keys-section').style.display = 'none';
    document.getElementById('tpl-form-container').style.display = 'block';
    document.getElementById('tpl-add-btn').style.display = 'none';
  };

  window.tplCancelForm = function() {
    document.getElementById('tpl-form-container').style.display = 'none';
    document.getElementById('tpl-add-btn').style.display = '';
  };

  // ─── Scan keys from Drive ─────────────────────────────────────────────

  window.tplScanKeys = async function() {
    const urlInput = document.getElementById('tpl-drive-url').value.trim();
    if (!urlInput) return;
    const fileId = extractDriveFileId(urlInput);
    if (!fileId) { alert(LANG === 'es' ? 'No se pudo extraer el ID del archivo de Drive de esa URL.' : 'Could not extract Drive file ID from that URL.'); return; }
    try {
      const res = await fetch(API + '/scan-keys', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ driveFileId: fileId }),
      });
      const data = await res.json();
      if (!data.ok) { alert(data.error || 'Error scanning keys'); return; }
      // Show detected mime type
      document.getElementById('tpl-mime-detected').textContent =
        '${i.mimeDetected}: ' + data.mimeType;
      // Populate keys table
      const tbody = document.getElementById('tpl-keys-tbody');
      tbody.innerHTML = '';
      for (const k of (data.keys || [])) {
        const tr = document.createElement('tr');
        tr.innerHTML = '<td><code>' + esc(k.key) + '</code></td>' +
          '<td><input type="text" class="field-input" data-key="' + esc(k.key) + '" value="' + esc(k.description || '') + '" placeholder="${i.keyDescPlaceholder}" style="padding:4px 8px"></td>';
        tbody.appendChild(tr);
      }
      document.getElementById('tpl-keys-section').style.display = data.keys && data.keys.length ? '' : 'none';
      // Store detected drive file ID for save
      document.getElementById('tpl-drive-url').dataset.fileId = fileId;
      document.getElementById('tpl-drive-url').dataset.mimeType = data.mimeType;
    } catch (err) { console.error('Scan keys error', err); alert('Error scanning keys'); }
  };

  // ─── Save (create / update) ───────────────────────────────────────────

  window.tplSave = async function() {
    const editId = document.getElementById('tpl-edit-id').value;
    const isEdit = !!editId;

    const name = document.getElementById('tpl-name').value.trim();
    if (!name) { alert(LANG === 'es' ? 'El nombre es obligatorio.' : 'Name is required.'); return; }

    // Collect keys
    const keyRows = document.querySelectorAll('#tpl-keys-tbody tr');
    const keys = [];
    keyRows.forEach(function(row) {
      const input = row.querySelector('input[data-key]');
      if (input) keys.push({ key: input.dataset.key, description: input.value.trim() });
    });

    if (isEdit) {
      const body = {
        id: editId,
        name: name,
        description: document.getElementById('tpl-description').value.trim(),
        docType: document.getElementById('tpl-doc-type').value,
        keys: keys,
        folderPattern: document.getElementById('tpl-folder-pattern').value.trim(),
        sharingMode: document.getElementById('tpl-sharing-mode').value,
      };
      const res = await fetch(API + '/update', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!data.ok) { alert(data.error || 'Error updating template'); return; }
    } else {
      const driveFileId = document.getElementById('tpl-drive-url').dataset.fileId;
      const mimeType = document.getElementById('tpl-drive-url').dataset.mimeType;
      if (!driveFileId) { alert(LANG === 'es' ? 'Primero escanea las keys del archivo.' : 'First scan the file keys.'); return; }
      const body = {
        name: name,
        description: document.getElementById('tpl-description').value.trim(),
        docType: document.getElementById('tpl-doc-type').value,
        driveFileId: driveFileId,
        mimeType: mimeType,
        keys: keys,
        folderPattern: document.getElementById('tpl-folder-pattern').value.trim(),
        sharingMode: document.getElementById('tpl-sharing-mode').value,
      };
      const res = await fetch(API + '/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!data.ok) { alert(data.error || 'Error creating template'); return; }
    }

    tplCancelForm();
    loadTemplates();
  };

  // ─── Edit (pre-populate form) ─────────────────────────────────────────

  window.tplEdit = async function(id) {
    try {
      const res = await fetch(API + '/get?id=' + id);
      const data = await res.json();
      if (!data.ok) { alert('Error loading template'); return; }
      const t = data.template;
      tplShowForm();
      document.getElementById('tpl-edit-id').value = t.id;
      document.getElementById('tpl-drive-url').value = t.driveFileId;
      document.getElementById('tpl-drive-url').dataset.fileId = t.driveFileId;
      document.getElementById('tpl-drive-url').dataset.mimeType = t.mimeType;
      document.getElementById('tpl-name').value = t.name;
      document.getElementById('tpl-description').value = t.description || '';
      document.getElementById('tpl-doc-type').value = t.docType;
      document.getElementById('tpl-sharing-mode').value = t.sharingMode;
      document.getElementById('tpl-folder-pattern').value = t.folderPattern || '';
      document.getElementById('tpl-mime-detected').textContent = '${i.mimeDetected}: ' + t.mimeType;
      // Populate keys
      const tbody = document.getElementById('tpl-keys-tbody');
      tbody.innerHTML = '';
      for (const k of (t.keys || [])) {
        const tr = document.createElement('tr');
        tr.innerHTML = '<td><code>' + esc(k.key) + '</code></td>' +
          '<td><input type="text" class="field-input" data-key="' + esc(k.key) + '" value="' + esc(k.description || '') + '" placeholder="${i.keyDescPlaceholder}" style="padding:4px 8px"></td>';
        tbody.appendChild(tr);
      }
      document.getElementById('tpl-keys-section').style.display = t.keys && t.keys.length ? '' : 'none';
    } catch (err) { console.error('Edit error', err); }
  };

  // ─── Toggle enable/disable ────────────────────────────────────────────

  window.tplToggle = async function(id, enabled) {
    await fetch(API + '/update', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: id, enabled: enabled }),
    });
    loadTemplates();
  };

  // ─── Delete ───────────────────────────────────────────────────────────

  window.tplDelete = async function(id) {
    if (!confirm('${i.confirmDelete}')) return;
    await fetch(API + '/delete?id=' + id, { method: 'DELETE' });
    loadTemplates();
    loadGenerated();
  };

  // ─── Helpers ──────────────────────────────────────────────────────────

  function esc(s) {
    if (!s) return '';
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function extractDriveFileId(url) {
    var m = url.match(new RegExp('/d/([a-zA-Z0-9_-]{20,})'));
    if (m && m[1]) return m[1];
    m = url.match(/id=([a-zA-Z0-9_-]{20,})/);
    if (m && m[1]) return m[1];
    m = url.match(/^([a-zA-Z0-9_-]{20,})$/);
    if (m && m[1]) return m[1];
    return null;
  }

  // ─── Init ─────────────────────────────────────────────────────────────

  loadTemplates();
  loadGenerated();
})();
</script>`
}
