// hitl/render-section.ts — Custom console section: HITL rules management + tickets overview
// Config fields (enabled, channel, TTL, etc.) are rendered by renderModulePanels via manifest.fields
// This section adds the rules CRUD and recent tickets below the config panel.

/**
 * Render the HITL rules and tickets panel.
 * Appended below the standard config fields in the Herramientas > HITL page.
 */
export function renderHitlSection(
  _config: Record<string, string>,
  lang: 'es' | 'en',
): string {
  const title = lang === 'es' ? 'Reglas HITL' : 'HITL Rules'
  const info = lang === 'es'
    ? 'Reglas en lenguaje natural que se inyectan al evaluador del agente. Definen cuando el agente debe solicitar ayuda humana.'
    : 'Natural language rules injected into the agent evaluator. Define when the agent should request human help.'

  const addBtn = lang === 'es' ? 'Agregar regla' : 'Add rule'
  const colName = lang === 'es' ? 'Nombre' : 'Name'
  const colCondition = lang === 'es' ? 'Condicion' : 'Condition'
  const colRole = lang === 'es' ? 'Rol' : 'Role'
  const colHandoff = 'Handoff'
  const colActions = lang === 'es' ? 'Acciones' : 'Actions'
  const loading = lang === 'es' ? 'Cargando reglas...' : 'Loading rules...'

  const ticketsTitle = lang === 'es' ? 'Tickets recientes' : 'Recent tickets'
  const ticketsInfo = lang === 'es'
    ? 'Ultimos tickets de consulta humana creados por el agente.'
    : 'Recent human consultation tickets created by the agent.'

  return `
<div class="panel">
  <div class="panel-header" onclick="togglePanel(this)">
    <span class="panel-title">${title}</span>
    <span class="panel-chevron">&#9660;</span>
  </div>
  <div class="panel-body">
    <div class="panel-info">${info}</div>
    <div id="hitl-rules-container">
      <p class="text-muted">${loading}</p>
    </div>
    <button type="button" class="btn btn-sm" onclick="hitlAddRule()" style="margin-top:8px">${addBtn}</button>
  </div>
</div>

<div class="panel">
  <div class="panel-header" onclick="togglePanel(this)">
    <span class="panel-title">${ticketsTitle}</span>
    <span class="panel-chevron">&#9660;</span>
  </div>
  <div class="panel-body">
    <div class="panel-info">${ticketsInfo}</div>
    <div id="hitl-tickets-container">
      <p class="text-muted">${loading}</p>
    </div>
  </div>
</div>

<script>
(function() {
  const LANG = '${lang}';
  const API = '/console/api/hitl';

  async function loadRules() {
    try {
      const res = await fetch(API + '/rules');
      const data = await res.json();
      if (!data.ok) return;
      const container = document.getElementById('hitl-rules-container');
      if (!container) return;
      if (data.rules.length === 0) {
        container.innerHTML = '<p class="text-muted">' + (LANG === 'es' ? 'No hay reglas configuradas.' : 'No rules configured.') + '</p>';
        return;
      }
      let html = '<table class="data-table"><thead><tr>';
      html += '<th>${colName}</th><th>${colCondition}</th><th>${colRole}</th><th>${colHandoff}</th><th>${colActions}</th>';
      html += '</tr></thead><tbody>';
      for (const r of data.rules) {
        const enabledIcon = r.enabled ? '&#9989;' : '&#10060;';
        const handoffIcon = r.handoff ? '&#9989;' : '';
        html += '<tr>';
        html += '<td>' + esc(r.name) + ' ' + enabledIcon + '</td>';
        html += '<td>' + esc(r.condition) + '</td>';
        html += '<td>' + esc(r.targetRole) + '</td>';
        html += '<td>' + handoffIcon + '</td>';
        html += '<td><button class="btn btn-xs" onclick="hitlToggleRule(\\'' + r.id + '\\', ' + !r.enabled + ')">' + (r.enabled ? 'Disable' : 'Enable') + '</button> ';
        html += '<button class="btn btn-xs btn-danger" onclick="hitlDeleteRule(\\'' + r.id + '\\')">' + (LANG === 'es' ? 'Eliminar' : 'Delete') + '</button></td>';
        html += '</tr>';
      }
      html += '</tbody></table>';
      container.innerHTML = html;
    } catch (err) { console.error('Failed to load HITL rules', err); }
  }

  async function loadTickets() {
    try {
      const res = await fetch(API + '/tickets?limit=10');
      const data = await res.json();
      if (!data.ok) return;
      const container = document.getElementById('hitl-tickets-container');
      if (!container) return;
      if (data.tickets.length === 0) {
        container.innerHTML = '<p class="text-muted">' + (LANG === 'es' ? 'No hay tickets.' : 'No tickets.') + '</p>';
        return;
      }
      let html = '<table class="data-table"><thead><tr>';
      html += '<th>Status</th><th>' + (LANG === 'es' ? 'Tipo' : 'Type') + '</th><th>' + (LANG === 'es' ? 'Resumen' : 'Summary') + '</th><th>' + (LANG === 'es' ? 'Creado' : 'Created') + '</th>';
      html += '</tr></thead><tbody>';
      for (const t of data.tickets) {
        const created = new Date(t.createdAt).toLocaleString();
        html += '<tr><td>' + esc(t.status) + '</td><td>' + esc(t.requestType) + '</td><td>' + esc(t.requestSummary.substring(0, 60)) + '</td><td>' + created + '</td></tr>';
      }
      html += '</tbody></table>';
      container.innerHTML = html;
    } catch (err) { console.error('Failed to load HITL tickets', err); }
  }

  window.hitlAddRule = function() {
    const name = prompt(LANG === 'es' ? 'Nombre de la regla:' : 'Rule name:');
    if (!name) return;
    const condition = prompt(LANG === 'es' ? 'Condicion (lenguaje natural):' : 'Condition (natural language):');
    if (!condition) return;
    const role = prompt(LANG === 'es' ? 'Rol (admin o coworker):' : 'Role (admin or coworker):', 'coworker');
    if (!role) return;
    fetch(API + '/rules', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: name, condition: condition, targetRole: role })
    }).then(function() { loadRules(); });
  };

  window.hitlToggleRule = function(id, enabled) {
    fetch(API + '/rules/' + id, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: enabled })
    }).then(function() { loadRules(); });
  };

  window.hitlDeleteRule = function(id) {
    if (!confirm(LANG === 'es' ? 'Eliminar esta regla?' : 'Delete this rule?')) return;
    fetch(API + '/rules/' + id, { method: 'DELETE' }).then(function() { loadRules(); });
  };

  function esc(s) {
    if (!s) return '';
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  loadRules();
  loadTickets();
})();
</script>`
}
