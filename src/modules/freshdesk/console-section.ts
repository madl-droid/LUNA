// LUNA — Module: freshdesk — Console section renderer
// Renders the tabs below module settings: synced articles + cached articles.

type Lang = 'es' | 'en'

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')
}

export function renderFreshdeskSection(lang: Lang): string {
  const isEs = lang === 'es'

  const tabSynced = isEs ? 'Artículos sincronizados' : 'Synced articles'
  const tabCached = isEs ? 'Artículos en cache' : 'Cached articles'
  const noArticles = isEs ? 'No hay artículos sincronizados. Ejecuta un sync primero.' : 'No synced articles. Run a sync first.'
  const noCached = isEs ? 'No hay artículos en cache.' : 'No cached articles.'
  const colTitle = isEs ? 'Título' : 'Title'
  const colCategory = isEs ? 'Categoría' : 'Category'
  const colFolder = isEs ? 'Carpeta' : 'Folder'
  const colRemaining = isEs ? 'Tiempo restante' : 'Time remaining'
  const colCachedAt = isEs ? 'Cacheado' : 'Cached'
  const loading = isEs ? 'Cargando...' : 'Loading...'
  const lastSync = isEs ? 'Último sync' : 'Last sync'
  const totalLabel = isEs ? 'artículos' : 'articles'

  return `
<div class="panel" style="margin-top:20px">
  <div class="panel-body" style="padding:0">
    <div class="chs-tabs" style="padding:0 16px">
      <button class="chs-tab active" data-tab="fd-synced">${esc(tabSynced)}</button>
      <button class="chs-tab" data-tab="fd-cached">${esc(tabCached)}</button>
    </div>

    <div class="chs-tab-content active" data-tab-content="fd-synced" style="padding:16px">
      <div id="fd-synced-status" style="font-size:12px;color:var(--on-surface-variant);margin-bottom:10px">${esc(loading)}</div>
      <div id="fd-synced-list"></div>
    </div>

    <div class="chs-tab-content" data-tab-content="fd-cached" style="padding:16px">
      <div id="fd-cached-status" style="font-size:12px;color:var(--on-surface-variant);margin-bottom:10px">${esc(loading)}</div>
      <div id="fd-cached-list"></div>
    </div>
  </div>
</div>

<script>
(function() {
  var lang = '${lang}';
  var isEs = lang === 'es';

  // Tab switching
  var tabBar = document.querySelector('.panel .chs-tabs');
  if (tabBar) {
    var tabs = tabBar.querySelectorAll('.chs-tab');
    var parent = tabBar.closest('.panel-body');
    tabs.forEach(function(tab) {
      tab.addEventListener('click', function() {
        var target = tab.getAttribute('data-tab');
        tabs.forEach(function(t) { t.classList.remove('active'); });
        tab.classList.add('active');
        if (parent) {
          parent.querySelectorAll('.chs-tab-content').forEach(function(c) {
            c.classList.toggle('active', c.getAttribute('data-tab-content') === target);
          });
        }
        // Lazy-load cached tab on first click
        if (target === 'fd-cached' && !window._fdCachedLoaded) {
          window._fdCachedLoaded = true;
          loadCached();
        }
      });
    });
  }

  function formatTime(isoStr) {
    if (!isoStr) return '—';
    var d = new Date(isoStr);
    return d.toLocaleDateString(isEs ? 'es' : 'en', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  }

  function formatDuration(seconds) {
    if (seconds <= 0) return isEs ? 'Expirado' : 'Expired';
    var h = Math.floor(seconds / 3600);
    var m = Math.floor((seconds % 3600) / 60);
    if (h > 0) return h + 'h ' + m + 'm';
    return m + 'm';
  }

  function escHtml(s) { var d = document.createElement('div'); d.textContent = s; return d.innerHTML; }

  // Load synced articles
  fetch('/console/api/freshdesk/articles')
    .then(function(r) { return r.json(); })
    .then(function(data) {
      var statusEl = document.getElementById('fd-synced-status');
      var listEl = document.getElementById('fd-synced-list');
      if (!data.articles || data.articles.length === 0) {
        statusEl.textContent = '';
        listEl.innerHTML = '<div style="color:var(--on-surface-variant);font-size:13px;padding:12px 0">${esc(noArticles)}</div>';
        return;
      }
      var syncInfo = data.lastSyncAt ? '${esc(lastSync)}: ' + formatTime(data.lastSyncAt) + ' · ' : '';
      statusEl.innerHTML = syncInfo + data.total + ' ${esc(totalLabel)}';
      var html = '<table class="fd-table"><thead><tr><th>${esc(colTitle)}</th><th>${esc(colCategory)}</th><th>${esc(colFolder)}</th></tr></thead><tbody>';
      data.articles.forEach(function(a) {
        html += '<tr><td>' + escHtml(a.title) + '</td><td>' + escHtml(a.category_name) + '</td><td>' + escHtml(a.folder_name) + '</td></tr>';
      });
      html += '</tbody></table>';
      listEl.innerHTML = html;
    })
    .catch(function() {
      document.getElementById('fd-synced-status').textContent = 'Error';
    });

  // Load cached articles (lazy, on tab click)
  function loadCached() {
    fetch('/console/api/freshdesk/cached-articles')
      .then(function(r) { return r.json(); })
      .then(function(data) {
        var statusEl = document.getElementById('fd-cached-status');
        var listEl = document.getElementById('fd-cached-list');
        if (!data.articles || data.articles.length === 0) {
          statusEl.textContent = '';
          listEl.innerHTML = '<div style="color:var(--on-surface-variant);font-size:13px;padding:12px 0">${esc(noCached)}</div>';
          return;
        }
        statusEl.textContent = data.total + ' ${esc(totalLabel)}';
        var html = '<table class="fd-table"><thead><tr><th>${esc(colTitle)}</th><th>${esc(colCachedAt)}</th><th>${esc(colRemaining)}</th></tr></thead><tbody>';
        data.articles.forEach(function(a) {
          var remaining = formatDuration(a.ttl_remaining_s);
          var color = a.ttl_remaining_s < 3600 ? 'var(--error)' : 'inherit';
          html += '<tr><td>' + escHtml(a.title) + '</td><td>' + formatTime(a.cached_at) + '</td><td style="color:' + color + '">' + remaining + '</td></tr>';
        });
        html += '</tbody></table>';
        listEl.innerHTML = html;
      })
      .catch(function() {
        document.getElementById('fd-cached-status').textContent = 'Error';
      });
  }
})();
</script>

<style>
.fd-table { width: 100%; border-collapse: collapse; font-size: 13px; }
.fd-table th { text-align: left; font-weight: 600; font-size: 11px; text-transform: uppercase; letter-spacing: 0.05em; color: var(--on-surface-variant); padding: 8px 10px; border-bottom: 1px solid var(--outline-variant); }
.fd-table td { padding: 7px 10px; border-bottom: 1px solid var(--surface-container-high); color: var(--on-surface); }
.fd-table tr:last-child td { border-bottom: none; }
.fd-table tr:hover td { background: var(--surface-container-low); }
.fd-table td:first-child { font-weight: 500; max-width: 350px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
</style>`
}
