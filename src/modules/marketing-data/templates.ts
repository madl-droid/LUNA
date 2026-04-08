// LUNA — Module: marketing-data — SSR HTML for console section
// Renders campaign management UI: list, create/edit, tags, stats.

type Lang = 'es' | 'en'

const labels: Record<Lang, Record<string, string>> = {
  es: {
    title: 'Campanas',
    subtitle: 'Gestiona campanas de marketing, tags y estadisticas de conversion.',
    tab_campaigns: 'Campanas',
    tab_tags: 'Tags',
    tab_stats: 'Estadisticas',
    btn_new: 'Nueva campana',
    btn_edit: 'Editar',
    btn_delete: 'Eliminar',
    btn_save: 'Guardar',
    btn_cancel: 'Cancelar',
    btn_create_tag: 'Crear tag',
    col_id: 'ID',
    col_name: 'Nombre',
    col_keyword: 'Keyword',
    col_threshold: 'Umbral',
    col_rounds: 'Rondas',
    col_channels: 'Canales',
    col_status: 'Estado',
    col_tags: 'Tags',
    col_created: 'Creado',
    col_entries: 'Entradas',
    col_conversions: 'Conversiones',
    col_rate: 'Tasa',
    status_active: 'Activa',
    status_inactive: 'Inactiva',
    all_channels: 'Todos',
    no_campaigns: 'No hay campanas registradas.',
    no_tags: 'No hay tags registrados.',
    form_name: 'Nombre',
    form_keyword: 'Keyword de matching',
    form_threshold: 'Umbral de matching (0-1)',
    form_max_rounds: 'Rondas maximas (1-3)',
    form_channels: 'Canales permitidos (vacio = todos)',
    form_prompt_context: 'Contexto para prompt (max 200)',
    form_utm: 'Datos UTM (JSON)',
    form_tags: 'Tags',
    tag_platform: 'Plataforma',
    tag_source: 'Fuente',
    tag_name: 'Nombre del tag',
    tag_color: 'Color',
    tag_type: 'Tipo',
    stats_campaign: 'Campana',
    stats_no_campaign: 'Sin campana',
    stats_total: 'Total',
    confirm_delete: 'Seguro que deseas eliminar esta campana?',
    confirm_delete_tag: 'Seguro que deseas eliminar este tag?',
    loading: 'Cargando...',
    error_load: 'Error al cargar datos',
    success_saved: 'Guardado correctamente',
    success_deleted: 'Eliminado correctamente',
    col_origin: 'Origen',
    origin_manual: 'Manual',
    origin_auto: 'Auto UTM',
    col_utm_keys: 'UTM Keys',
    form_utm_keys: 'UTM Campaign Keys (separados por coma)',
    col_match_source: 'Fuente',
    settings_title: 'Configuracion de deteccion',
    settings_utm_enabled: 'Deteccion UTM habilitada',
    settings_keyword_enabled: 'Deteccion Keyword habilitada',
    stats_by_source: 'Por fuente de deteccion',
    stats_by_utm: 'Por fuente UTM',
    stats_first_touch: 'First-touch',
    stats_last_touch: 'Last-touch (conversion)',
  },
  en: {
    title: 'Campaigns',
    subtitle: 'Manage marketing campaigns, tags and conversion stats.',
    tab_campaigns: 'Campaigns',
    tab_tags: 'Tags',
    tab_stats: 'Statistics',
    btn_new: 'New campaign',
    btn_edit: 'Edit',
    btn_delete: 'Delete',
    btn_save: 'Save',
    btn_cancel: 'Cancel',
    btn_create_tag: 'Create tag',
    col_id: 'ID',
    col_name: 'Name',
    col_keyword: 'Keyword',
    col_threshold: 'Threshold',
    col_rounds: 'Rounds',
    col_channels: 'Channels',
    col_status: 'Status',
    col_tags: 'Tags',
    col_created: 'Created',
    col_entries: 'Entries',
    col_conversions: 'Conversions',
    col_rate: 'Rate',
    status_active: 'Active',
    status_inactive: 'Inactive',
    all_channels: 'All',
    no_campaigns: 'No campaigns registered.',
    no_tags: 'No tags registered.',
    form_name: 'Name',
    form_keyword: 'Matching keyword',
    form_threshold: 'Match threshold (0-1)',
    form_max_rounds: 'Max rounds (1-3)',
    form_channels: 'Allowed channels (empty = all)',
    form_prompt_context: 'Prompt context (max 200)',
    form_utm: 'UTM data (JSON)',
    form_tags: 'Tags',
    tag_platform: 'Platform',
    tag_source: 'Source',
    tag_name: 'Tag name',
    tag_color: 'Color',
    tag_type: 'Type',
    stats_campaign: 'Campaign',
    stats_no_campaign: 'No campaign',
    stats_total: 'Total',
    confirm_delete: 'Are you sure you want to delete this campaign?',
    confirm_delete_tag: 'Are you sure you want to delete this tag?',
    loading: 'Loading...',
    error_load: 'Error loading data',
    success_saved: 'Saved successfully',
    success_deleted: 'Deleted successfully',
    col_origin: 'Origin',
    origin_manual: 'Manual',
    origin_auto: 'Auto UTM',
    col_utm_keys: 'UTM Keys',
    form_utm_keys: 'UTM Campaign Keys (comma separated)',
    col_match_source: 'Source',
    settings_title: 'Detection settings',
    settings_utm_enabled: 'UTM detection enabled',
    settings_keyword_enabled: 'Keyword detection enabled',
    stats_by_source: 'By detection source',
    stats_by_utm: 'By UTM source',
    stats_first_touch: 'First-touch',
    stats_last_touch: 'Last-touch (conversion)',
  },
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

/**
 * Render the marketing-data console section (campaign management).
 * Returns SSR HTML string for embedding in the herramientas page.
 */
export function renderMarketingDataConsole(lang: Lang): string {
  const l = labels[lang] ?? labels.es

  return `
<div id="marketing-data-root" data-lang="${lang}" data-api-base="/console/api/marketing-data">
  <!-- Tabs -->
  <div class="md-tabs" style="display:flex;gap:0;margin-bottom:20px;border-bottom:1px solid var(--border-color);">
    <button class="md-tab active" data-tab="campaigns" style="padding:10px 20px;background:none;border:none;border-bottom:2px solid var(--primary);color:var(--primary);cursor:pointer;font-size:14px;font-weight:500;">${esc(l.tab_campaigns!)}</button>
    <button class="md-tab" data-tab="tags" style="padding:10px 20px;background:none;border:none;border-bottom:2px solid transparent;color:var(--on-surface-dim);cursor:pointer;font-size:14px;">${esc(l.tab_tags!)}</button>
    <button class="md-tab" data-tab="stats" style="padding:10px 20px;background:none;border:none;border-bottom:2px solid transparent;color:var(--on-surface-dim);cursor:pointer;font-size:14px;">${esc(l.tab_stats!)}</button>
  </div>

  <!-- Campaigns tab -->
  <div class="md-tab-content" id="md-tab-campaigns">
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;">
      <div style="font-size:13px;color:var(--on-surface-dim);" id="md-campaigns-count"></div>
      <button class="btn btn-primary btn-sm" id="md-btn-new-campaign" style="padding:6px 16px;font-size:13px;border-radius:6px;background:var(--primary);color:#fff;border:none;cursor:pointer;">
        + ${esc(l.btn_new!)}
      </button>
    </div>
    <!-- Detection settings panel -->
    <div style="margin-bottom:16px;padding:12px 16px;border-radius:8px;border:1px solid var(--border-color);background:var(--surface-variant);">
      <div style="font-size:13px;font-weight:500;color:var(--on-surface);margin-bottom:8px;">${esc(l.settings_title!)}</div>
      <div style="display:flex;gap:24px;flex-wrap:wrap;">
        <label style="display:flex;align-items:center;gap:8px;font-size:13px;color:var(--on-surface);cursor:pointer;">
          <input type="checkbox" id="md-toggle-utm" checked style="width:16px;height:16px;">
          ${esc(l.settings_utm_enabled!)}
        </label>
        <label style="display:flex;align-items:center;gap:8px;font-size:13px;color:var(--on-surface);cursor:pointer;">
          <input type="checkbox" id="md-toggle-keyword" checked style="width:16px;height:16px;">
          ${esc(l.settings_keyword_enabled!)}
        </label>
      </div>
    </div>
    <div id="md-campaigns-list" style="display:grid;gap:12px;">
      <div class="md-loading" style="text-align:center;padding:40px;color:var(--on-surface-dim);">${esc(l.loading!)}</div>
    </div>
  </div>

  <!-- Tags tab -->
  <div class="md-tab-content" id="md-tab-tags" style="display:none;">
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;">
      <div style="font-size:13px;color:var(--on-surface-dim);" id="md-tags-count"></div>
      <button class="btn btn-primary btn-sm" id="md-btn-new-tag" style="padding:6px 16px;font-size:13px;border-radius:6px;background:var(--primary);color:#fff;border:none;cursor:pointer;">
        + ${esc(l.btn_create_tag!)}
      </button>
    </div>
    <div id="md-tags-list" style="display:grid;gap:8px;">
      <div class="md-loading" style="text-align:center;padding:40px;color:var(--on-surface-dim);">${esc(l.loading!)}</div>
    </div>
  </div>

  <!-- Stats tab -->
  <div class="md-tab-content" id="md-tab-stats" style="display:none;">
    <div id="md-stats-container">
      <div class="md-loading" style="text-align:center;padding:40px;color:var(--on-surface-dim);">${esc(l.loading!)}</div>
    </div>
  </div>

  <!-- Campaign form modal (hidden) -->
  <div id="md-campaign-modal" style="display:none;position:fixed;top:0;left:0;right:0;bottom:0;z-index:1000;background:rgba(0,0,0,0.6);justify-content:center;align-items:center;">
    <div style="background:var(--surface);border-radius:12px;padding:24px;max-width:560px;width:90%;max-height:80vh;overflow-y:auto;box-shadow:0 8px 32px rgba(0,0,0,0.3);">
      <h3 id="md-modal-title" style="margin:0 0 16px;font-size:16px;color:var(--on-surface);"></h3>
      <form id="md-campaign-form" style="display:grid;gap:12px;">
        <input type="hidden" id="md-form-id">
        <div>
          <label style="font-size:12px;color:var(--on-surface-dim);display:block;margin-bottom:4px;">${esc(l.form_name!)}</label>
          <input type="text" id="md-form-name" required style="width:100%;padding:8px 12px;border-radius:6px;border:1px solid var(--border-color);background:var(--surface-variant);color:var(--on-surface);font-size:14px;box-sizing:border-box;">
        </div>
        <div>
          <label style="font-size:12px;color:var(--on-surface-dim);display:block;margin-bottom:4px;">${esc(l.form_keyword!)}</label>
          <input type="text" id="md-form-keyword" style="width:100%;padding:8px 12px;border-radius:6px;border:1px solid var(--border-color);background:var(--surface-variant);color:var(--on-surface);font-size:14px;box-sizing:border-box;">
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
          <div>
            <label style="font-size:12px;color:var(--on-surface-dim);display:block;margin-bottom:4px;">${esc(l.form_threshold!)}</label>
            <input type="number" id="md-form-threshold" min="0" max="1" step="0.05" value="0.95" style="width:100%;padding:8px 12px;border-radius:6px;border:1px solid var(--border-color);background:var(--surface-variant);color:var(--on-surface);font-size:14px;box-sizing:border-box;">
          </div>
          <div>
            <label style="font-size:12px;color:var(--on-surface-dim);display:block;margin-bottom:4px;">${esc(l.form_max_rounds!)}</label>
            <input type="number" id="md-form-rounds" min="1" max="3" value="1" style="width:100%;padding:8px 12px;border-radius:6px;border:1px solid var(--border-color);background:var(--surface-variant);color:var(--on-surface);font-size:14px;box-sizing:border-box;">
          </div>
        </div>
        <div>
          <label style="font-size:12px;color:var(--on-surface-dim);display:block;margin-bottom:4px;">${esc(l.form_channels!)}</label>
          <input type="text" id="md-form-channels" placeholder="whatsapp,email" style="width:100%;padding:8px 12px;border-radius:6px;border:1px solid var(--border-color);background:var(--surface-variant);color:var(--on-surface);font-size:14px;box-sizing:border-box;">
        </div>
        <div>
          <label style="font-size:12px;color:var(--on-surface-dim);display:block;margin-bottom:4px;">${esc(l.form_prompt_context!)}</label>
          <textarea id="md-form-context" maxlength="200" rows="2" style="width:100%;padding:8px 12px;border-radius:6px;border:1px solid var(--border-color);background:var(--surface-variant);color:var(--on-surface);font-size:14px;resize:vertical;box-sizing:border-box;"></textarea>
        </div>
        <div>
          <label style="font-size:12px;color:var(--on-surface-dim);display:block;margin-bottom:4px;">${esc(l.form_utm_keys!)}</label>
          <input type="text" id="md-form-utm-keys" placeholder="black-friday,bf-2024,summer-sale" style="width:100%;padding:8px 12px;border-radius:6px;border:1px solid var(--border-color);background:var(--surface-variant);color:var(--on-surface);font-size:14px;box-sizing:border-box;">
        </div>
        <div>
          <label style="font-size:12px;color:var(--on-surface-dim);display:block;margin-bottom:4px;">${esc(l.form_tags!)}</label>
          <div id="md-form-tags" style="display:flex;flex-wrap:wrap;gap:6px;min-height:32px;padding:4px;border:1px solid var(--border-color);border-radius:6px;background:var(--surface-variant);"></div>
        </div>
        <div style="display:flex;justify-content:flex-end;gap:8px;margin-top:8px;">
          <button type="button" id="md-btn-cancel" style="padding:8px 16px;font-size:13px;border-radius:6px;background:var(--surface-variant);color:var(--on-surface);border:1px solid var(--border-color);cursor:pointer;">${esc(l.btn_cancel!)}</button>
          <button type="submit" style="padding:8px 16px;font-size:13px;border-radius:6px;background:var(--primary);color:#fff;border:none;cursor:pointer;">${esc(l.btn_save!)}</button>
        </div>
      </form>
    </div>
  </div>

  <!-- Tag form modal (hidden) -->
  <div id="md-tag-modal" style="display:none;position:fixed;top:0;left:0;right:0;bottom:0;z-index:1000;background:rgba(0,0,0,0.6);justify-content:center;align-items:center;">
    <div style="background:var(--surface);border-radius:12px;padding:24px;max-width:400px;width:90%;box-shadow:0 8px 32px rgba(0,0,0,0.3);">
      <h3 style="margin:0 0 16px;font-size:16px;color:var(--on-surface);">${esc(l.btn_create_tag!)}</h3>
      <form id="md-tag-form" style="display:grid;gap:12px;">
        <div>
          <label style="font-size:12px;color:var(--on-surface-dim);display:block;margin-bottom:4px;">${esc(l.tag_name!)}</label>
          <input type="text" id="md-tag-name" required style="width:100%;padding:8px 12px;border-radius:6px;border:1px solid var(--border-color);background:var(--surface-variant);color:var(--on-surface);font-size:14px;box-sizing:border-box;">
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
          <div>
            <label style="font-size:12px;color:var(--on-surface-dim);display:block;margin-bottom:4px;">${esc(l.tag_type!)}</label>
            <select id="md-tag-type" style="width:100%;padding:8px 12px;border-radius:6px;border:1px solid var(--border-color);background:var(--surface-variant);color:var(--on-surface);font-size:14px;">
              <option value="platform">${esc(l.tag_platform!)}</option>
              <option value="source">${esc(l.tag_source!)}</option>
            </select>
          </div>
          <div>
            <label style="font-size:12px;color:var(--on-surface-dim);display:block;margin-bottom:4px;">${esc(l.tag_color!)}</label>
            <input type="color" id="md-tag-color" value="#93c5fd" style="width:100%;height:38px;border-radius:6px;border:1px solid var(--border-color);background:var(--surface-variant);cursor:pointer;">
          </div>
        </div>
        <div style="display:flex;justify-content:flex-end;gap:8px;margin-top:8px;">
          <button type="button" id="md-btn-cancel-tag" style="padding:8px 16px;font-size:13px;border-radius:6px;background:var(--surface-variant);color:var(--on-surface);border:1px solid var(--border-color);cursor:pointer;">${esc(l.btn_cancel!)}</button>
          <button type="submit" style="padding:8px 16px;font-size:13px;border-radius:6px;background:var(--primary);color:#fff;border:none;cursor:pointer;">${esc(l.btn_save!)}</button>
        </div>
      </form>
    </div>
  </div>
</div>

<script>
(function() {
  const root = document.getElementById('marketing-data-root');
  if (!root) return;
  const lang = root.dataset.lang || 'es';
  const apiBase = root.dataset.apiBase || '/console/api/marketing-data';
  const labels = ${JSON.stringify(labels)};
  const l = labels[lang] || labels.es;

  let allTags = [];
  let allCampaigns = [];

  // ─── Tabs ───
  root.querySelectorAll('.md-tab').forEach(btn => {
    btn.addEventListener('click', () => {
      root.querySelectorAll('.md-tab').forEach(b => {
        b.classList.remove('active');
        b.style.borderBottomColor = 'transparent';
        b.style.color = 'var(--on-surface-dim)';
      });
      btn.classList.add('active');
      btn.style.borderBottomColor = 'var(--primary)';
      btn.style.color = 'var(--primary)';
      root.querySelectorAll('.md-tab-content').forEach(c => c.style.display = 'none');
      const tab = btn.dataset.tab;
      const el = document.getElementById('md-tab-' + tab);
      if (el) el.style.display = 'block';
      if (tab === 'campaigns') loadCampaigns();
      if (tab === 'tags') loadTags();
      if (tab === 'stats') loadStats();
    });
  });

  // ─── API helpers ───
  async function api(path, opts) {
    const res = await fetch(apiBase + '/' + path, opts);
    return res.json();
  }

  function showToast(msg, type) {
    if (window.showToast) { window.showToast(msg, type); return; }
    console.log('[toast]', type, msg);
  }

  function escHtml(s) {
    if (!s) return '';
    return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  // ─── Campaigns ───
  async function loadCampaigns() {
    const data = await api('campaigns');
    allCampaigns = data.campaigns || [];
    renderCampaigns(allCampaigns);
  }

  function renderCampaigns(campaigns) {
    const container = document.getElementById('md-campaigns-list');
    const counter = document.getElementById('md-campaigns-count');
    if (counter) counter.textContent = campaigns.length + ' ' + l.tab_campaigns.toLowerCase();
    if (!campaigns.length) {
      container.innerHTML = '<div style="text-align:center;padding:40px;color:var(--on-surface-dim);">' + l.no_campaigns + '</div>';
      return;
    }
    container.innerHTML = campaigns.map(c => {
      const statusColor = c.active ? 'var(--success)' : 'var(--on-surface-dim)';
      const statusText = c.active ? l.status_active : l.status_inactive;
      const tags = [...(c.platformTags||[]), ...(c.sourceTags||[])].map(t =>
        '<span style="display:inline-block;padding:2px 8px;border-radius:10px;font-size:11px;background:' + t.color + '22;color:' + t.color + ';border:1px solid ' + t.color + '44;">' + escHtml(t.name) + '</span>'
      ).join(' ');
      const channels = c.allowedChannels && c.allowedChannels.length > 0
        ? c.allowedChannels.join(', ')
        : l.all_channels;
      return '<div class="panel" style="padding:16px;border-radius:8px;border:1px solid var(--border-color);background:var(--surface);">' +
        '<div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:8px;">' +
          '<div>' +
            '<div style="font-size:15px;font-weight:500;color:var(--on-surface);">#' + c.visibleId + ' ' + escHtml(c.name) + (c.origin === 'auto_utm' ? '<span style="display:inline-block;margin-left:6px;padding:1px 6px;border-radius:8px;font-size:10px;background:#fef3c7;color:#d97706;border:1px solid rgba(217,119,6,0.2);">Auto UTM</span>' : '') + '</div>' +
            '<div style="font-size:12px;color:var(--on-surface-dim);margin-top:2px;">Keyword: <code style="background:var(--surface-variant);padding:1px 6px;border-radius:3px;">' + escHtml(c.keyword || '-') + '</code></div>' +
            (c.utmKeys && c.utmKeys.length > 0 ? '<div style="font-size:12px;color:var(--on-surface-dim);margin-top:2px;">UTM Keys: ' + c.utmKeys.map(function(k) { return '<code style="background:var(--surface-variant);padding:1px 6px;border-radius:3px;">' + escHtml(k) + '</code>'; }).join(' ') + '</div>' : '') +
          '</div>' +
          '<div style="display:flex;gap:6px;align-items:center;">' +
            '<span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:' + statusColor + ';"></span>' +
            '<span style="font-size:12px;color:' + statusColor + ';">' + statusText + '</span>' +
          '</div>' +
        '</div>' +
        '<div style="display:flex;gap:16px;flex-wrap:wrap;font-size:12px;color:var(--on-surface-dim);margin-bottom:8px;">' +
          '<span>' + l.col_threshold + ': ' + c.matchThreshold + '</span>' +
          '<span>' + l.col_rounds + ': ' + c.matchMaxRounds + '</span>' +
          '<span>' + l.col_channels + ': ' + channels + '</span>' +
        '</div>' +
        (tags ? '<div style="display:flex;flex-wrap:wrap;gap:4px;margin-bottom:8px;">' + tags + '</div>' : '') +
        '<div style="display:flex;gap:8px;justify-content:flex-end;">' +
          '<button class="md-edit-campaign" data-id="' + c.id + '" style="padding:4px 12px;font-size:12px;border-radius:4px;background:var(--surface-variant);color:var(--on-surface);border:1px solid var(--border-color);cursor:pointer;">' + l.btn_edit + '</button>' +
          '<button class="md-delete-campaign" data-id="' + c.id + '" style="padding:4px 12px;font-size:12px;border-radius:4px;background:transparent;color:var(--error);border:1px solid var(--error);cursor:pointer;">' + l.btn_delete + '</button>' +
        '</div>' +
      '</div>';
    }).join('');

    container.querySelectorAll('.md-edit-campaign').forEach(btn => {
      btn.addEventListener('click', () => openEditCampaign(btn.dataset.id));
    });
    container.querySelectorAll('.md-delete-campaign').forEach(btn => {
      btn.addEventListener('click', () => deleteCampaign(btn.dataset.id));
    });
  }

  async function deleteCampaign(id) {
    if (!confirm(l.confirm_delete)) return;
    await api('campaign?id=' + id, { method: 'DELETE' });
    showToast(l.success_deleted, 'success');
    loadCampaigns();
  }

  function openNewCampaign() {
    document.getElementById('md-modal-title').textContent = l.btn_new;
    document.getElementById('md-form-id').value = '';
    document.getElementById('md-form-name').value = '';
    document.getElementById('md-form-keyword').value = '';
    document.getElementById('md-form-threshold').value = '0.95';
    document.getElementById('md-form-rounds').value = '1';
    document.getElementById('md-form-channels').value = '';
    document.getElementById('md-form-context').value = '';
    document.getElementById('md-form-utm-keys').value = '';
    renderFormTags([]);
    const modal = document.getElementById('md-campaign-modal');
    modal.style.display = 'flex';
  }

  async function openEditCampaign(id) {
    const data = await api('campaign?id=' + id);
    const c = data.campaign;
    if (!c) return;
    document.getElementById('md-modal-title').textContent = l.btn_edit + ': ' + c.name;
    document.getElementById('md-form-id').value = c.id;
    document.getElementById('md-form-name').value = c.name;
    document.getElementById('md-form-keyword').value = c.keyword || '';
    document.getElementById('md-form-threshold').value = String(c.matchThreshold);
    document.getElementById('md-form-rounds').value = String(c.matchMaxRounds);
    document.getElementById('md-form-channels').value = (c.allowedChannels || []).join(',');
    document.getElementById('md-form-context').value = c.promptContext || '';
    document.getElementById('md-form-utm-keys').value = (c.utmKeys || []).join(', ');
    const selectedIds = [...(c.platformTags||[]), ...(c.sourceTags||[])].map(t => t.id);
    renderFormTags(selectedIds);
    const modal = document.getElementById('md-campaign-modal');
    modal.style.display = 'flex';
  }

  function renderFormTags(selectedIds) {
    const container = document.getElementById('md-form-tags');
    if (!allTags.length) {
      api('tags').then(d => { allTags = d.tags || []; renderFormTagsInner(container, selectedIds); });
    } else {
      renderFormTagsInner(container, selectedIds);
    }
  }

  function renderFormTagsInner(container, selectedIds) {
    container.innerHTML = allTags.map(t => {
      const checked = selectedIds.includes(t.id);
      return '<label style="display:inline-flex;align-items:center;gap:4px;padding:3px 8px;border-radius:10px;font-size:11px;cursor:pointer;' +
        'background:' + (checked ? t.color + '33' : 'transparent') + ';border:1px solid ' + t.color + '44;">' +
        '<input type="checkbox" value="' + t.id + '"' + (checked ? ' checked' : '') + ' style="width:12px;height:12px;">' +
        '<span style="color:' + t.color + ';">' + t.name + '</span>' +
      '</label>';
    }).join(' ');
  }

  document.getElementById('md-campaign-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const id = document.getElementById('md-form-id').value;
    const channelsRaw = document.getElementById('md-form-channels').value;
    const tagCheckboxes = document.querySelectorAll('#md-form-tags input[type=checkbox]:checked');
    const tagIds = Array.from(tagCheckboxes).map(cb => cb.value);
    const utmKeysRaw = document.getElementById('md-form-utm-keys').value;
    const body = {
      name: document.getElementById('md-form-name').value,
      keyword: document.getElementById('md-form-keyword').value,
      matchThreshold: parseFloat(document.getElementById('md-form-threshold').value),
      matchMaxRounds: parseInt(document.getElementById('md-form-rounds').value, 10),
      allowedChannels: channelsRaw ? channelsRaw.split(',').map(s => s.trim()).filter(Boolean) : [],
      promptContext: document.getElementById('md-form-context').value,
      utmKeys: utmKeysRaw ? utmKeysRaw.split(',').map(s => s.trim()).filter(Boolean) : [],
      tagIds: tagIds,
    };
    if (id) body.id = id;
    await api('campaign', {
      method: id ? 'PUT' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    document.getElementById('md-campaign-modal').style.display = 'none';
    showToast(l.success_saved, 'success');
    loadCampaigns();
  });

  document.getElementById('md-btn-new-campaign').addEventListener('click', openNewCampaign);
  document.getElementById('md-btn-cancel').addEventListener('click', () => {
    document.getElementById('md-campaign-modal').style.display = 'none';
  });

  // ─── Tags ───
  async function loadTags() {
    const data = await api('tags');
    allTags = data.tags || [];
    renderTags(allTags);
  }

  function renderTags(tags) {
    const container = document.getElementById('md-tags-list');
    const counter = document.getElementById('md-tags-count');
    if (counter) counter.textContent = tags.length + ' tags';
    if (!tags.length) {
      container.innerHTML = '<div style="text-align:center;padding:40px;color:var(--on-surface-dim);">' + l.no_tags + '</div>';
      return;
    }
    container.innerHTML = tags.map(t => {
      const typeLabel = t.tagType === 'platform' ? l.tag_platform : l.tag_source;
      return '<div style="display:flex;align-items:center;justify-content:space-between;padding:8px 12px;border-radius:6px;border:1px solid var(--border-color);background:var(--surface);">' +
        '<div style="display:flex;align-items:center;gap:10px;">' +
          '<span style="width:16px;height:16px;border-radius:50%;background:' + t.color + ';display:inline-block;"></span>' +
          '<span style="font-size:14px;color:var(--on-surface);">' + escHtml(t.name) + '</span>' +
          '<span style="font-size:11px;padding:2px 8px;border-radius:8px;background:var(--surface-variant);color:var(--on-surface-dim);">' + typeLabel + '</span>' +
        '</div>' +
        '<button class="md-delete-tag" data-id="' + t.id + '" style="padding:4px 10px;font-size:11px;border-radius:4px;background:transparent;color:var(--error);border:1px solid var(--error);cursor:pointer;">' + l.btn_delete + '</button>' +
      '</div>';
    }).join('');

    container.querySelectorAll('.md-delete-tag').forEach(btn => {
      btn.addEventListener('click', async () => {
        if (!confirm(l.confirm_delete_tag)) return;
        await api('tag?id=' + btn.dataset.id, { method: 'DELETE' });
        showToast(l.success_deleted, 'success');
        loadTags();
      });
    });
  }

  document.getElementById('md-btn-new-tag').addEventListener('click', () => {
    document.getElementById('md-tag-modal').style.display = 'flex';
  });
  document.getElementById('md-btn-cancel-tag').addEventListener('click', () => {
    document.getElementById('md-tag-modal').style.display = 'none';
  });
  document.getElementById('md-tag-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    await api('tag', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: document.getElementById('md-tag-name').value,
        tagType: document.getElementById('md-tag-type').value,
        color: document.getElementById('md-tag-color').value,
      }),
    });
    document.getElementById('md-tag-modal').style.display = 'none';
    document.getElementById('md-tag-name').value = '';
    showToast(l.success_saved, 'success');
    loadTags();
  });

  // ─── Stats ───
  async function loadStats() {
    const [statsData, utmData] = await Promise.all([
      api('campaign-detailed-stats'),
      api('utm-breakdown'),
    ]);
    renderStats(statsData.stats || [], utmData.breakdown || []);
  }

  function renderStats(stats, utmBreakdown) {
    const container = document.getElementById('md-stats-container');
    if (!stats.length) {
      container.innerHTML = '<div style="text-align:center;padding:40px;color:var(--on-surface-dim);">-</div>';
      return;
    }
    let totalEntries = 0, totalConversions = 0;
    stats.forEach(s => { totalEntries += s.entries; totalConversions += s.conversions; });
    const globalRate = totalEntries > 0 ? ((totalConversions / totalEntries) * 100).toFixed(1) : '0.0';

    let html = '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:12px;margin-bottom:20px;">';
    html += '<div style="padding:16px;border-radius:8px;background:var(--surface);border:1px solid var(--border-color);text-align:center;">' +
      '<div style="font-size:24px;font-weight:600;color:var(--primary);">' + totalEntries + '</div>' +
      '<div style="font-size:12px;color:var(--on-surface-dim);">' + l.col_entries + '</div></div>';
    html += '<div style="padding:16px;border-radius:8px;background:var(--surface);border:1px solid var(--border-color);text-align:center;">' +
      '<div style="font-size:24px;font-weight:600;color:var(--success);">' + totalConversions + '</div>' +
      '<div style="font-size:12px;color:var(--on-surface-dim);">' + l.col_conversions + '</div></div>';
    html += '<div style="padding:16px;border-radius:8px;background:var(--surface);border:1px solid var(--border-color);text-align:center;">' +
      '<div style="font-size:24px;font-weight:600;color:var(--on-surface);">' + globalRate + '%</div>' +
      '<div style="font-size:12px;color:var(--on-surface-dim);">' + l.col_rate + '</div></div>';
    html += '</div>';

    // Main table with first-touch column
    html += '<div class="panel" style="border-radius:8px;border:1px solid var(--border-color);overflow:hidden;">';
    html += '<table style="width:100%;border-collapse:collapse;font-size:13px;">';
    html += '<thead><tr style="background:var(--surface-variant);">' +
      '<th style="padding:10px 12px;text-align:left;color:var(--on-surface-dim);font-weight:500;">' + l.stats_campaign + '</th>' +
      '<th style="padding:10px 12px;text-align:right;color:var(--on-surface-dim);font-weight:500;">' + l.col_entries + '</th>' +
      '<th style="padding:10px 12px;text-align:right;color:var(--on-surface-dim);font-weight:500;">' + l.stats_first_touch + '</th>' +
      '<th style="padding:10px 12px;text-align:right;color:var(--on-surface-dim);font-weight:500;">' + l.col_conversions + '</th>' +
      '<th style="padding:10px 12px;text-align:right;color:var(--on-surface-dim);font-weight:500;">' + l.col_rate + '</th>' +
    '</tr></thead><tbody>';
    stats.forEach(s => {
      const name = s.campaignId ? ('#' + (s.visibleId||'') + ' ' + escHtml(s.name)) : l.stats_no_campaign;
      const rate = s.entries > 0 ? ((s.conversions / s.entries) * 100).toFixed(1) : '0.0';
      html += '<tr style="border-top:1px solid var(--border-color);">' +
        '<td style="padding:8px 12px;color:var(--on-surface);">' + name + '</td>' +
        '<td style="padding:8px 12px;text-align:right;color:var(--on-surface);">' + s.entries + '</td>' +
        '<td style="padding:8px 12px;text-align:right;color:var(--on-surface-dim);">' + (s.firstTouchEntries || 0) + '</td>' +
        '<td style="padding:8px 12px;text-align:right;color:var(--success);">' + s.conversions + '</td>' +
        '<td style="padding:8px 12px;text-align:right;color:var(--on-surface-dim);">' + rate + '%</td>' +
      '</tr>';
    });
    html += '</tbody></table></div>';

    // Source breakdown table
    const campaignsWithSource = stats.filter(s => s.campaignId && s.sourceBreakdown && s.sourceBreakdown.length > 0);
    if (campaignsWithSource.length > 0) {
      html += '<h4 style="margin:20px 0 12px;font-size:14px;color:var(--on-surface);">' + l.stats_by_source + '</h4>';
      html += '<div class="panel" style="border-radius:8px;border:1px solid var(--border-color);overflow:hidden;">';
      html += '<table style="width:100%;border-collapse:collapse;font-size:13px;">';
      html += '<thead><tr style="background:var(--surface-variant);">' +
        '<th style="padding:10px 12px;text-align:left;color:var(--on-surface-dim);font-weight:500;">Campana</th>' +
        '<th style="padding:10px 12px;text-align:right;color:var(--on-surface-dim);font-weight:500;">Keyword</th>' +
        '<th style="padding:10px 12px;text-align:right;color:var(--on-surface-dim);font-weight:500;">URL UTM</th>' +
        '<th style="padding:10px 12px;text-align:right;color:var(--on-surface-dim);font-weight:500;">Webhook</th>' +
        '<th style="padding:10px 12px;text-align:right;color:var(--on-surface-dim);font-weight:500;">Webhook UTM</th>' +
      '</tr></thead><tbody>';
      stats.forEach(function(s) {
        if (!s.campaignId) return;
        var getCount = function(source) {
          var found = (s.sourceBreakdown || []).find(function(b) { return b.matchSource === source; });
          return found ? found.entries : 0;
        };
        html += '<tr style="border-top:1px solid var(--border-color);">' +
          '<td style="padding:8px 12px;color:var(--on-surface);">#' + (s.visibleId||'') + ' ' + escHtml(s.name) + '</td>' +
          '<td style="padding:8px 12px;text-align:right;color:var(--on-surface);">' + getCount('keyword') + '</td>' +
          '<td style="padding:8px 12px;text-align:right;color:var(--on-surface);">' + getCount('url_utm') + '</td>' +
          '<td style="padding:8px 12px;text-align:right;color:var(--on-surface);">' + getCount('webhook') + '</td>' +
          '<td style="padding:8px 12px;text-align:right;color:var(--on-surface);">' + getCount('webhook_utm') + '</td>' +
        '</tr>';
      });
      html += '</tbody></table></div>';
    }

    // Global UTM breakdown table
    if (utmBreakdown && utmBreakdown.length > 0) {
      html += '<h4 style="margin:20px 0 12px;font-size:14px;color:var(--on-surface);">' + l.stats_by_utm + '</h4>';
      html += '<div class="panel" style="border-radius:8px;border:1px solid var(--border-color);overflow:hidden;">';
      html += '<table style="width:100%;border-collapse:collapse;font-size:13px;">';
      html += '<thead><tr style="background:var(--surface-variant);">' +
        '<th style="padding:10px 12px;text-align:left;color:var(--on-surface-dim);font-weight:500;">utm_source</th>' +
        '<th style="padding:10px 12px;text-align:left;color:var(--on-surface-dim);font-weight:500;">utm_medium</th>' +
        '<th style="padding:10px 12px;text-align:right;color:var(--on-surface-dim);font-weight:500;">' + l.col_entries + '</th>' +
        '<th style="padding:10px 12px;text-align:right;color:var(--on-surface-dim);font-weight:500;">' + l.col_conversions + '</th>' +
        '<th style="padding:10px 12px;text-align:right;color:var(--on-surface-dim);font-weight:500;">' + l.col_rate + '</th>' +
      '</tr></thead><tbody>';
      utmBreakdown.forEach(function(u) {
        var rate = u.entries > 0 ? ((u.conversions / u.entries) * 100).toFixed(1) : '0.0';
        html += '<tr style="border-top:1px solid var(--border-color);">' +
          '<td style="padding:8px 12px;color:var(--on-surface);">' + escHtml(u.utmSource || 'unknown') + '</td>' +
          '<td style="padding:8px 12px;color:var(--on-surface);">' + escHtml(u.utmMedium || 'unknown') + '</td>' +
          '<td style="padding:8px 12px;text-align:right;color:var(--on-surface);">' + u.entries + '</td>' +
          '<td style="padding:8px 12px;text-align:right;color:var(--success);">' + u.conversions + '</td>' +
          '<td style="padding:8px 12px;text-align:right;color:var(--on-surface-dim);">' + rate + '%</td>' +
        '</tr>';
      });
      html += '</tbody></table></div>';
    }

    container.innerHTML = html;
  }

  // ─── Config / toggles ───
  async function loadConfig() {
    try {
      const data = await api('config');
      const utmToggle = document.getElementById('md-toggle-utm');
      const kwToggle = document.getElementById('md-toggle-keyword');
      if (utmToggle) {
        utmToggle.checked = data.utmMatchEnabled !== false;
        utmToggle.disabled = true;
        utmToggle.title = 'Configurable via CAMPAIGN_UTM_MATCH_ENABLED';
      }
      if (kwToggle) {
        kwToggle.checked = data.keywordMatchEnabled !== false;
        kwToggle.disabled = true;
        kwToggle.title = 'Configurable via CAMPAIGN_KEYWORD_MATCH_ENABLED';
      }
    } catch (_e) {
      // Config endpoint unavailable — defaults apply
    }
  }

  // Initial load
  loadCampaigns();
  loadConfig();
})();
</script>`;
}
