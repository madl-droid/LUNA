// LUNA — Google Apps: Calendar Console Renderer
// HTML renderer for the Google Calendar settings page at /console/herramientas/google-apps/calendar

import type { CalendarSchedulingConfig } from './types.js'

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')
}

function checked(val: boolean): string {
  return val ? 'checked' : ''
}

// ─── Section 1: General ────────────────────

function renderGeneralSection(cfg: CalendarSchedulingConfig, isEs: boolean): string {
  const namePreview = `${esc(cfg.eventNamePrefix || 'Reunión')} - Juan Pérez - Empresa S.A.`
  return `
<div class="panel" id="gcal-sec-general">
  <div class="panel-header" onclick="gcalToggleSection('general')">
    <span class="panel-title">${isEs ? 'Ajustes generales' : 'General settings'}</span>
    <span class="panel-chevron" id="gcal-chev-general">&#9660;</span>
  </div>
  <div class="panel-body" id="gcal-body-general">
    <div class="toggle-field" style="padding:14px 20px">
      <div class="field-left">
        <div class="field-label">${isEs ? 'Incluir Google Meet por defecto' : 'Include Google Meet by default'}</div>
      </div>
      <label class="toggle">
        <input type="checkbox" id="gcal-meetEnabled" ${checked(cfg.meetEnabled)} onchange="gcalMarkDirty()">
        <span class="toggle-slider"></span>
      </label>
    </div>
    <div class="field">
      <div class="field-left">
        <label class="field-label" for="gcal-duration">${isEs ? 'Duración predeterminada' : 'Default duration'}</label>
      </div>
      <div style="display:flex;align-items:center;gap:8px">
        <input type="number" id="gcal-duration" min="15" max="480" step="5" value="${cfg.defaultDurationMinutes}" style="width:90px" oninput="gcalMarkDirty()">
        <span style="font-size:13px;color:var(--on-surface-dim)">min</span>
      </div>
    </div>
    <div class="field">
      <div class="field-left">
        <label class="field-label" for="gcal-prefix">${isEs ? 'Nombre de la cita' : 'Event name'}</label>
      </div>
      <input type="text" id="gcal-prefix" value="${esc(cfg.eventNamePrefix)}" placeholder="${isEs ? 'Reunión' : 'Meeting'}" oninput="gcalUpdateNamePreview();gcalMarkDirty()">
    </div>
    <div class="field">
      <div class="field-left">
        <label class="field-label">${isEs ? 'Vista previa' : 'Preview'}</label>
      </div>
      <div id="gcal-name-preview" style="font-size:13px;color:var(--on-surface-dim);padding:8px 0">${namePreview}</div>
    </div>
    <div class="field">
      <div class="field-left">
        <label class="field-label" for="gcal-desc-instructions">${isEs ? 'Instrucciones para la descripción' : 'Description instructions'}</label>
        <div class="field-info" style="font-size:12px;color:var(--on-surface-dim);margin-top:2px">${isEs ? 'Instrucciones que guían al agente al redactar la descripción de cada cita.' : 'Instructions guiding the agent when writing the event description.'}</div>
      </div>
      <textarea id="gcal-desc-instructions" rows="4" placeholder="${isEs ? 'Ej: Incluir motivo de la reunión, datos relevantes del cliente...' : 'E.g.: Include meeting reason, relevant client data...'}" oninput="gcalMarkDirty()" style="width:100%;box-sizing:border-box;resize:vertical">${esc(cfg.descriptionInstructions)}</textarea>
    </div>
  </div>
</div>`
}

// ─── Section 2: Reminders ──────────────────

function renderRemindersSection(cfg: CalendarSchedulingConfig, isEs: boolean): string {
  const rows = cfg.defaultReminders.map((r, i) => `
    <div class="gcal-reminder-row" id="gcal-rem-${i}" style="display:flex;align-items:center;gap:8px;margin-bottom:8px">
      <select class="gcal-rem-method" data-idx="${i}" onchange="gcalMarkDirty()" style="flex:0 0 120px">
        <option value="popup" ${r.method === 'popup' ? 'selected' : ''}>${isEs ? 'Emergente' : 'Popup'}</option>
        <option value="email" ${r.method === 'email' ? 'selected' : ''}>Email</option>
      </select>
      <input type="number" class="gcal-rem-minutes" data-idx="${i}" min="1" max="40320" value="${r.minutes}" style="width:80px" oninput="gcalMarkDirty()">
      <span style="font-size:13px;color:var(--on-surface-dim)">min</span>
      <button type="button" class="act-btn act-btn-remove act-btn--compact" onclick="gcalRemoveReminder(${i})">✕</button>
    </div>`).join('')

  return `
<div class="panel" id="gcal-sec-reminders">
  <div class="panel-header" onclick="gcalToggleSection('reminders')">
    <span class="panel-title">${isEs ? 'Recordatorios por defecto' : 'Default reminders'}</span>
    <span class="panel-chevron" id="gcal-chev-reminders">&#9660;</span>
  </div>
  <div class="panel-body" id="gcal-body-reminders" style="display:none">
    <div style="padding:14px 20px">
      <div id="gcal-reminders-list">${rows}</div>
      <button type="button" class="act-btn act-btn-add act-btn--sm" onclick="gcalAddReminder()">+ ${isEs ? 'Agregar recordatorio' : 'Add reminder'}</button>
    </div>
  </div>
</div>`
}

// ─── Section 3: Days off ───────────────────

function renderDaysOffSection(cfg: CalendarSchedulingConfig, isEs: boolean): string {
  const rows = cfg.daysOff.map((d, i) => {
    if (d.type === 'range') {
      return `
      <div class="gcal-dayoff-row" id="gcal-dayoff-${i}" style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:8px">
        <select class="gcal-dayoff-type" data-idx="${i}" onchange="gcalToggleDayOffType(${i},this.value);gcalMarkDirty()" style="flex:0 0 130px">
          <option value="single">${isEs ? 'Fecha única' : 'Single date'}</option>
          <option value="range" selected>${isEs ? 'Rango' : 'Range'}</option>
        </select>
        <span style="font-size:13px;color:var(--on-surface-dim)">${isEs ? 'Desde' : 'From'}</span>
        <input type="date" class="gcal-dayoff-start" data-idx="${i}" value="${esc(d.start)}" style="flex:1;min-width:140px" oninput="gcalMarkDirty()">
        <span style="font-size:13px;color:var(--on-surface-dim)">${isEs ? 'hasta' : 'to'}</span>
        <input type="date" class="gcal-dayoff-end" data-idx="${i}" value="${esc(d.end)}" style="flex:1;min-width:140px" oninput="gcalMarkDirty()">
        <button type="button" class="act-btn act-btn-remove act-btn--compact" onclick="gcalRemoveDayOff(${i})">✕</button>
      </div>`
    } else {
      return `
      <div class="gcal-dayoff-row" id="gcal-dayoff-${i}" style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:8px">
        <select class="gcal-dayoff-type" data-idx="${i}" onchange="gcalToggleDayOffType(${i},this.value);gcalMarkDirty()" style="flex:0 0 130px">
          <option value="single" selected>${isEs ? 'Fecha única' : 'Single date'}</option>
          <option value="range">${isEs ? 'Rango' : 'Range'}</option>
        </select>
        <input type="date" class="gcal-dayoff-date" data-idx="${i}" value="${esc(d.date)}" style="flex:1;min-width:140px" oninput="gcalMarkDirty()">
        <span class="gcal-dayoff-range-extra" id="gcal-dayoff-range-${i}" style="display:none;align-items:center;gap:8px">
          <span style="font-size:13px;color:var(--on-surface-dim)">${isEs ? 'hasta' : 'to'}</span>
          <input type="date" class="gcal-dayoff-end" data-idx="${i}" value="" style="min-width:140px" oninput="gcalMarkDirty()">
        </span>
        <button type="button" class="act-btn act-btn-remove act-btn--compact" onclick="gcalRemoveDayOff(${i})">✕</button>
      </div>`
    }
  }).join('')

  return `
<div class="panel" id="gcal-sec-daysoff">
  <div class="panel-header" onclick="gcalToggleSection('daysoff')">
    <span class="panel-title">${isEs ? 'Días no laborables' : 'Days off'}</span>
    <span class="panel-chevron" id="gcal-chev-daysoff">&#9660;</span>
  </div>
  <div class="panel-body" id="gcal-body-daysoff" style="display:none">
    <div style="padding:14px 20px">
      <div class="panel-info" style="margin-bottom:14px">
        ${isEs
          ? 'El horario laboral y días de la semana se configuran en <a href="/console/agente/advanced">Agente &gt; Avanzado</a>.'
          : 'Business hours and weekdays are configured in <a href="/console/agente/advanced">Agent &gt; Advanced</a>.'}
      </div>
      <div id="gcal-daysoff-list">${rows}</div>
      <button type="button" class="act-btn act-btn-add act-btn--sm" onclick="gcalAddDayOff()">+ ${isEs ? 'Agregar día libre' : 'Add day off'}</button>
    </div>
  </div>
</div>`
}

// ─── Section 4: Team ───────────────────────

function renderTeamSection(
  cfg: CalendarSchedulingConfig,
  roles: string[],
  coworkersByRole: Record<string, Array<{ id: string; displayName: string; email: string; role: string }>>,
  isEs: boolean,
): string {
  const note = isEs
    ? 'Selecciona qué roles de coworkers pueden recibir citas agendadas por Luna. Los roles se gestionan en <a href="/console/contacts/coworker">Contactos &gt; Coworkers</a>.'
    : 'Select which coworker roles can receive appointments scheduled by Luna. Roles are managed in <a href="/console/contacts/coworker">Contacts &gt; Coworkers</a>.'

  if (roles.length === 0) {
    const noRoles = isEs
      ? 'No hay roles/etiquetas definidas para coworkers. Créalas primero en <a href="/console/contacts/coworker">Contactos &gt; Coworkers &gt; Etiquetas/Roles</a>.'
      : 'No roles/labels defined for coworkers. Create them first in <a href="/console/contacts/coworker">Contacts &gt; Coworkers &gt; Labels/Roles</a>.'
    return `
<div class="panel" id="gcal-sec-team">
  <div class="panel-header" onclick="gcalToggleSection('team')">
    <span class="panel-title">${isEs ? 'Asignación de equipo' : 'Team assignment'}</span>
    <span class="panel-chevron" id="gcal-chev-team">&#9660;</span>
  </div>
  <div class="panel-body" id="gcal-body-team" style="display:none">
    <div style="padding:14px 20px">
      <div class="panel-info" style="margin-bottom:14px">${note}</div>
      <div class="panel-info">${noRoles}</div>
    </div>
  </div>
</div>`
  }

  const roleCards = roles.map(roleName => {
    const roleCfg = cfg.schedulingRoles[roleName] ?? { enabled: false, instructions: '' }
    const coworkers = coworkersByRole[roleName] ?? []
    const roleBodyVisible = roleCfg.enabled ? '' : 'display:none'

    const coworkerRows = coworkers.length === 0
      ? `<div class="panel-info">${isEs ? `No hay coworkers con el rol '${esc(roleName)}'. Asigna este rol a coworkers en Contactos.` : `No coworkers with role '${esc(roleName)}'. Assign this role to coworkers in Contacts.`}</div>`
      : coworkers.map(cw => {
          const cwCfg = cfg.schedulingCoworkers[cw.id] ?? { enabled: true, instructions: '' }
          return `
          <div class="gcal-coworker-row" data-user-id="${esc(cw.id)}" style="border:1px solid var(--outline-variant);border-radius:8px;padding:10px 14px;margin-bottom:8px">
            <div style="display:flex;align-items:center;gap:10px">
              <label class="toggle" title="${isEs ? 'Habilitar para agendamiento' : 'Enable for scheduling'}">
                <input type="checkbox" class="gcal-cw-enabled" data-user-id="${esc(cw.id)}" ${checked(cwCfg.enabled)} onchange="gcalMarkDirty()">
                <span class="toggle-slider"></span>
              </label>
              <div style="flex:1">
                <div style="font-size:14px;font-weight:500">${esc(cw.displayName)}</div>
                ${cw.email ? `<div style="font-size:12px;color:var(--on-surface-dim)">${esc(cw.email)}</div>` : ''}
              </div>
              <span class="gcal-access-badge" id="gcal-access-${esc(cw.id)}" data-email="${esc(cw.email)}" style="font-size:11px;padding:3px 8px;border-radius:20px;background:var(--surface-container-high);color:var(--on-surface-dim)">${isEs ? 'Pendiente' : 'Pending'}</span>
              <button type="button" class="btn-secondary" style="font-size:12px;padding:4px 10px" onclick="gcalToggleCoworkerInstructions('${esc(cw.id)}')">${isEs ? 'Instrucciones' : 'Instructions'}</button>
            </div>
            <div class="gcal-cw-instr-wrap" id="gcal-cw-instr-${esc(cw.id)}" style="display:none;margin-top:8px">
              <textarea class="gcal-cw-instructions" data-user-id="${esc(cw.id)}" rows="2" placeholder="${isEs ? 'Ej: Clientes en Brasil' : 'E.g.: Clients in Brazil'}" oninput="gcalMarkDirty()" style="width:100%;box-sizing:border-box;resize:vertical">${esc(cwCfg.instructions)}</textarea>
            </div>
          </div>`
        }).join('')

    return `
    <div class="gcal-role-card" data-role="${esc(roleName)}" style="border:1px solid var(--outline-variant);border-radius:10px;margin-bottom:12px">
      <div style="display:flex;align-items:center;justify-content:space-between;padding:12px 16px;cursor:pointer" onclick="gcalToggleRole('${esc(roleName)}')">
        <span style="font-size:14px;font-weight:600;text-transform:capitalize">${esc(roleName)}</span>
        <label class="toggle" onclick="event.stopPropagation()">
          <input type="checkbox" class="gcal-role-enabled" data-role="${esc(roleName)}" ${checked(roleCfg.enabled)} onchange="gcalToggleRole('${esc(roleName)}');gcalMarkDirty()">
          <span class="toggle-slider"></span>
        </label>
      </div>
      <div class="gcal-role-body" id="gcal-role-body-${esc(roleName)}" style="${roleBodyVisible};padding:0 16px 16px">
        <div class="field" style="margin-bottom:12px">
          <div class="field-left">
            <label class="field-label">${isEs ? 'Instrucciones de agendamiento para este rol' : 'Scheduling instructions for this role'}</label>
          </div>
          <textarea class="gcal-role-instructions" data-role="${esc(roleName)}" rows="2" placeholder="${isEs ? 'Ej: Agendar los clientes que están fuera del país' : 'E.g.: Schedule clients outside the country'}" oninput="gcalMarkDirty()" style="width:100%;box-sizing:border-box;resize:vertical">${esc(roleCfg.instructions)}</textarea>
        </div>
        <div class="gcal-coworkers-list">
          ${coworkerRows}
        </div>
        <div style="margin-top:10px">
          <button type="button" class="btn-secondary" onclick="gcalCheckAccess('${esc(roleName)}')" style="font-size:13px">${isEs ? 'Verificar acceso a calendarios' : 'Check calendar access'}</button>
          <span id="gcal-check-status-${esc(roleName)}" style="font-size:12px;color:var(--on-surface-dim);margin-left:10px"></span>
        </div>
      </div>
    </div>`
  }).join('')

  return `
<div class="panel" id="gcal-sec-team">
  <div class="panel-header" onclick="gcalToggleSection('team')">
    <span class="panel-title">${isEs ? 'Asignación de equipo' : 'Team assignment'}</span>
    <span class="panel-chevron" id="gcal-chev-team">&#9660;</span>
  </div>
  <div class="panel-body" id="gcal-body-team" style="display:none">
    <div style="padding:14px 20px">
      <div class="panel-info" style="margin-bottom:14px">${note}</div>
      ${roleCards}
    </div>
  </div>
</div>`
}

// ─── Section 5: Follow-ups ─────────────────

function renderFollowupsSection(cfg: CalendarSchedulingConfig, isEs: boolean): string {
  return `
<div class="panel" id="gcal-sec-followups">
  <div class="panel-header" onclick="gcalToggleSection('followups')">
    <span class="panel-title">${isEs ? 'Seguimiento automático' : 'Automatic follow-up'}</span>
    <span class="panel-chevron" id="gcal-chev-followups">&#9660;</span>
  </div>
  <div class="panel-body" id="gcal-body-followups" style="display:none">
    <div style="padding:14px 20px">
      <div style="margin-bottom:24px">
        <div style="font-size:14px;font-weight:600;margin-bottom:10px">${isEs ? 'Seguimiento post-reunión' : 'Post-meeting follow-up'}</div>
        <div class="toggle-field" style="padding:0;margin-bottom:10px">
          <div class="field-left">
            <div class="field-label">${isEs ? 'Activar seguimiento post-reunión' : 'Enable post-meeting follow-up'}</div>
          </div>
          <label class="toggle">
            <input type="checkbox" id="gcal-followup-post-enabled" ${checked(cfg.followUpPost.enabled)} onchange="gcalMarkDirty()">
            <span class="toggle-slider"></span>
          </label>
        </div>
        <div class="field" style="margin-bottom:8px">
          <div class="field-left">
            <label class="field-label" for="gcal-followup-post-delay">${isEs ? 'Minutos después de la reunión' : 'Minutes after meeting'}</label>
          </div>
          <div style="display:flex;align-items:center;gap:8px">
            <input type="number" id="gcal-followup-post-delay" min="30" max="360" step="15" value="${cfg.followUpPost.delayMinutes}" style="width:90px" oninput="gcalMarkDirty()">
            <span style="font-size:13px;color:var(--on-surface-dim)">min</span>
          </div>
        </div>
        <div class="panel-info">${isEs ? 'Luna enviará un mensaje al cliente y al coworker asignado después de la reunión preguntando cómo les fue.' : 'Luna will send a message to the client and assigned coworker after the meeting asking how it went.'}</div>
      </div>
      <div>
        <div style="font-size:14px;font-weight:600;margin-bottom:10px">${isEs ? 'Recordatorio pre-reunión' : 'Pre-meeting reminder'}</div>
        <div class="toggle-field" style="padding:0;margin-bottom:10px">
          <div class="field-left">
            <div class="field-label">${isEs ? 'Activar recordatorio pre-reunión' : 'Enable pre-meeting reminder'}</div>
          </div>
          <label class="toggle">
            <input type="checkbox" id="gcal-followup-pre-enabled" ${checked(cfg.followUpPre.enabled)} onchange="gcalMarkDirty()">
            <span class="toggle-slider"></span>
          </label>
        </div>
        <div class="field" style="margin-bottom:8px">
          <div class="field-left">
            <label class="field-label" for="gcal-followup-pre-hours">${isEs ? 'Horas antes de la reunión' : 'Hours before meeting'}</label>
          </div>
          <div style="display:flex;align-items:center;gap:8px">
            <input type="number" id="gcal-followup-pre-hours" min="3" max="24" step="1" value="${cfg.followUpPre.hoursBefore}" style="width:90px" oninput="gcalMarkDirty()">
            <span style="font-size:13px;color:var(--on-surface-dim)">${isEs ? 'h' : 'h'}</span>
          </div>
        </div>
        <div class="panel-info">${isEs ? 'Luna enviará un recordatorio al cliente antes de la reunión.' : 'Luna will send a reminder to the client before the meeting.'}</div>
      </div>
    </div>
  </div>
</div>`
}

// ─── JavaScript ────────────────────────────

function renderScript(lang: 'es' | 'en'): string {
  const isEs = lang === 'es'
  return `<script>
(function(){
  var _gcalDirty = false;

  window.gcalMarkDirty = function() { _gcalDirty = true; };

  window.gcalToggleSection = function(id) {
    var body = document.getElementById('gcal-body-' + id);
    var chev = document.getElementById('gcal-chev-' + id);
    if (!body) return;
    var open = body.style.display !== 'none';
    body.style.display = open ? 'none' : '';
    if (chev) chev.style.transform = open ? 'rotate(-90deg)' : '';
  };

  window.gcalUpdateNamePreview = function() {
    var prefix = document.getElementById('gcal-prefix');
    var preview = document.getElementById('gcal-name-preview');
    if (!prefix || !preview) return;
    var val = prefix.value.trim() || '${isEs ? 'Reunión' : 'Meeting'}';
    preview.textContent = val + ' - Juan Pérez - Empresa S.A.';
  };

  // ── Reminders ──
  window.gcalAddReminder = function() {
    var list = document.getElementById('gcal-reminders-list');
    if (!list) return;
    var idx = list.querySelectorAll('.gcal-reminder-row').length;
    var row = document.createElement('div');
    row.className = 'gcal-reminder-row';
    row.id = 'gcal-rem-' + idx;
    row.style.cssText = 'display:flex;align-items:center;gap:8px;margin-bottom:8px';
    row.innerHTML = '<select class="gcal-rem-method" data-idx="' + idx + '" onchange="gcalMarkDirty()" style="flex:0 0 120px">'
      + '<option value="popup">${isEs ? 'Emergente' : 'Popup'}</option>'
      + '<option value="email">Email</option>'
      + '</select>'
      + '<input type="number" class="gcal-rem-minutes" data-idx="' + idx + '" min="1" max="40320" value="30" style="width:80px" oninput="gcalMarkDirty()">'
      + '<span style="font-size:13px;color:var(--on-surface-dim)">min</span>'
      + '<button type="button" class="act-btn act-btn-remove act-btn--compact" onclick="gcalRemoveReminder(' + idx + ')">✕</button>';
    list.appendChild(row);
    gcalMarkDirty();
  };

  window.gcalRemoveReminder = function(idx) {
    var row = document.getElementById('gcal-rem-' + idx);
    if (row) { row.remove(); gcalMarkDirty(); }
  };

  // ── Days off ──
  window.gcalAddDayOff = function() {
    var list = document.getElementById('gcal-daysoff-list');
    if (!list) return;
    var idx = list.querySelectorAll('.gcal-dayoff-row').length;
    var row = document.createElement('div');
    row.className = 'gcal-dayoff-row';
    row.id = 'gcal-dayoff-' + idx;
    row.style.cssText = 'display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:8px';
    row.innerHTML = '<select class="gcal-dayoff-type" data-idx="' + idx + '" onchange="gcalToggleDayOffType(' + idx + ',this.value);gcalMarkDirty()" style="flex:0 0 130px">'
      + '<option value="single">${isEs ? 'Fecha única' : 'Single date'}</option>'
      + '<option value="range">${isEs ? 'Rango' : 'Range'}</option>'
      + '</select>'
      + '<input type="date" class="gcal-dayoff-date" data-idx="' + idx + '" value="" style="flex:1;min-width:140px" oninput="gcalMarkDirty()">'
      + '<span class="gcal-dayoff-range-extra" id="gcal-dayoff-range-' + idx + '" style="display:none;align-items:center;gap:8px">'
      + '<span style="font-size:13px;color:var(--on-surface-dim)">${isEs ? 'hasta' : 'to'}</span>'
      + '<input type="date" class="gcal-dayoff-end" data-idx="' + idx + '" value="" style="min-width:140px" oninput="gcalMarkDirty()">'
      + '</span>'
      + '<button type="button" class="act-btn act-btn-remove act-btn--compact" onclick="gcalRemoveDayOff(' + idx + ')">✕</button>';
    list.appendChild(row);
    gcalMarkDirty();
  };

  window.gcalRemoveDayOff = function(idx) {
    var row = document.getElementById('gcal-dayoff-' + idx);
    if (row) { row.remove(); gcalMarkDirty(); }
  };

  window.gcalToggleDayOffType = function(idx, type) {
    var row = document.getElementById('gcal-dayoff-' + idx);
    if (!row) return;
    var dateInput = row.querySelector('.gcal-dayoff-date');
    var rangeExtra = document.getElementById('gcal-dayoff-range-' + idx);
    if (type === 'range') {
      if (dateInput) dateInput.style.display = 'none';
      if (rangeExtra) rangeExtra.style.display = 'flex';
    } else {
      if (dateInput) dateInput.style.display = '';
      if (rangeExtra) rangeExtra.style.display = 'none';
    }
    gcalMarkDirty();
  };

  // ── Team ──
  window.gcalToggleRole = function(roleName) {
    var body = document.getElementById('gcal-role-body-' + roleName);
    var checkbox = document.querySelector('.gcal-role-enabled[data-role="' + roleName + '"]');
    if (!body || !checkbox) return;
    body.style.display = checkbox.checked ? '' : 'none';
  };

  window.gcalToggleCoworkerInstructions = function(userId) {
    var wrap = document.getElementById('gcal-cw-instr-' + userId);
    if (!wrap) return;
    wrap.style.display = wrap.style.display === 'none' ? '' : 'none';
  };

  window.gcalCheckAccess = function(roleName) {
    var statusEl = document.getElementById('gcal-check-status-' + roleName);
    if (statusEl) statusEl.textContent = '${isEs ? 'Verificando...' : 'Checking...'}';

    var roleBody = document.getElementById('gcal-role-body-' + roleName);
    if (!roleBody) return;
    var badges = roleBody.querySelectorAll('.gcal-access-badge');
    var emails = [];
    badges.forEach(function(b) {
      var email = b.dataset.email;
      if (email) emails.push(email);
    });

    if (emails.length === 0) {
      if (statusEl) statusEl.textContent = '${isEs ? 'Sin coworkers con email' : 'No coworkers with email'}';
      return;
    }

    fetch('/console/api/google-apps/calendar-check-access', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ emails: emails })
    })
    .then(function(r) { return r.json(); })
    .then(function(results) {
      badges.forEach(function(badge) {
        var email = badge.dataset.email;
        if (!email || !results[email]) return;
        var ok = results[email].hasAccess;
        badge.textContent = ok ? '${isEs ? 'Acceso OK' : 'Access OK'}' : '${isEs ? 'Sin acceso' : 'No access'}';
        badge.style.background = ok ? 'rgba(52,199,89,0.15)' : 'rgba(230,33,17,0.1)';
        badge.style.color = ok ? '#1a8f3a' : 'var(--error)';
      });
      if (statusEl) statusEl.textContent = '${isEs ? 'Verificación completada' : 'Check complete'}';
    })
    .catch(function() {
      if (statusEl) statusEl.textContent = '${isEs ? 'Error al verificar' : 'Verification error'}';
    });
  };

  // ── Collect + Save ──
  function gcalCollect() {
    // Reminders
    var reminders = [];
    document.querySelectorAll('.gcal-reminder-row').forEach(function(row) {
      var method = row.querySelector('.gcal-rem-method');
      var minutes = row.querySelector('.gcal-rem-minutes');
      if (method && minutes) {
        reminders.push({ method: method.value, minutes: parseInt(minutes.value, 10) || 30 });
      }
    });

    // Days off
    var daysOff = [];
    document.querySelectorAll('.gcal-dayoff-row').forEach(function(row) {
      var typeEl = row.querySelector('.gcal-dayoff-type');
      var type = typeEl ? typeEl.value : 'single';
      if (type === 'range') {
        var startEl = row.querySelector('.gcal-dayoff-start');
        var endEl = row.querySelector('.gcal-dayoff-end');
        var start = startEl ? startEl.value : '';
        var end = endEl ? endEl.value : '';
        if (start && end) daysOff.push({ type: 'range', start: start, end: end });
      } else {
        var dateEl = row.querySelector('.gcal-dayoff-date');
        var date = dateEl ? dateEl.value : '';
        if (date) daysOff.push({ type: 'single', date: date });
      }
    });

    // Roles
    var schedulingRoles = {};
    document.querySelectorAll('.gcal-role-enabled').forEach(function(cb) {
      var role = cb.dataset.role;
      if (!role) return;
      var instrEl = document.querySelector('.gcal-role-instructions[data-role="' + role + '"]');
      schedulingRoles[role] = {
        enabled: cb.checked,
        instructions: instrEl ? instrEl.value : ''
      };
    });

    // Coworkers
    var schedulingCoworkers = {};
    document.querySelectorAll('.gcal-cw-enabled').forEach(function(cb) {
      var userId = cb.dataset.userId;
      if (!userId) return;
      var instrEl = document.querySelector('.gcal-cw-instructions[data-user-id="' + userId + '"]');
      schedulingCoworkers[userId] = {
        enabled: cb.checked,
        instructions: instrEl ? instrEl.value : ''
      };
    });

    var meetEl = document.getElementById('gcal-meetEnabled');
    var durationEl = document.getElementById('gcal-duration');
    var prefixEl = document.getElementById('gcal-prefix');
    var descEl = document.getElementById('gcal-desc-instructions');
    var postEnabledEl = document.getElementById('gcal-followup-post-enabled');
    var postDelayEl = document.getElementById('gcal-followup-post-delay');
    var preEnabledEl = document.getElementById('gcal-followup-pre-enabled');
    var preHoursEl = document.getElementById('gcal-followup-pre-hours');

    return {
      meetEnabled: meetEl ? meetEl.checked : true,
      defaultReminders: reminders,
      defaultDurationMinutes: durationEl ? (parseInt(durationEl.value, 10) || 30) : 30,
      eventNamePrefix: prefixEl ? prefixEl.value : '${isEs ? 'Reunión' : 'Meeting'}',
      descriptionInstructions: descEl ? descEl.value : '',
      daysOff: daysOff,
      schedulingRoles: schedulingRoles,
      schedulingCoworkers: schedulingCoworkers,
      followUpPost: {
        enabled: postEnabledEl ? postEnabledEl.checked : true,
        delayMinutes: postDelayEl ? (parseInt(postDelayEl.value, 10) || 60) : 60
      },
      followUpPre: {
        enabled: preEnabledEl ? preEnabledEl.checked : true,
        hoursBefore: preHoursEl ? (parseInt(preHoursEl.value, 10) || 24) : 24
      }
    };
  }

  window.gcalSave = async function() {
    var saveBtn = document.getElementById('gcal-save-btn');
    if (saveBtn) { saveBtn.disabled = true; saveBtn.textContent = '${isEs ? 'Guardando...' : 'Saving...'}'; }
    try {
      var config = gcalCollect();
      var r = await fetch('/console/api/google-apps/calendar-config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(config)
      });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      await fetch('/console/apply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: '_section=google-apps'
      });
      _gcalDirty = false;
      if (window.showToast) window.showToast('${isEs ? 'Guardado' : 'Saved'}', 'success');
    } catch(e) {
      if (window.showToast) window.showToast('${isEs ? 'Error al guardar' : 'Save error'}', 'error');
    } finally {
      if (saveBtn) { saveBtn.disabled = false; saveBtn.textContent = '${isEs ? 'Guardar' : 'Save'}'; }
    }
  };
})();
</script>`
}

// ─── Main export ───────────────────────────

export function renderCalendarSettingsPage(data: {
  config: CalendarSchedulingConfig
  roles: string[]
  coworkersByRole: Record<string, Array<{ id: string; displayName: string; email: string; role: string }>>
  calendarAccessStatus?: Record<string, { hasAccess: boolean; error?: string }>
  lang: 'es' | 'en'
}): string {
  const { config: cfg, roles, coworkersByRole, lang } = data
  const isEs = lang === 'es'

  const breadcrumb = `<div style="font-size:12px;color:var(--on-surface-dim);margin-bottom:18px">
    <a href="/console/herramientas/google-apps" style="color:var(--on-surface-dim)">${isEs ? 'Herramientas' : 'Tools'}</a>
    <span style="margin:0 6px">›</span>
    <a href="/console/herramientas/google-apps" style="color:var(--on-surface-dim)">Google Workspace</a>
    <span style="margin:0 6px">›</span>
    <span>Google Calendar</span>
  </div>`

  const title = `<h2 style="font-size:20px;font-weight:700;margin:0 0 18px">${isEs ? 'Configuración de Google Calendar' : 'Google Calendar Settings'}</h2>`

  const saveBar = `<div style="display:flex;justify-content:flex-end;margin-top:20px;padding:16px 0;border-top:1px solid var(--outline-variant)">
    <button type="button" id="gcal-save-btn" class="act-btn act-btn-cta" onclick="gcalSave()">${isEs ? 'Guardar' : 'Save'}</button>
  </div>`

  return [
    breadcrumb,
    title,
    renderGeneralSection(cfg, isEs),
    renderRemindersSection(cfg, isEs),
    renderDaysOffSection(cfg, isEs),
    renderTeamSection(cfg, roles, coworkersByRole, isEs),
    renderFollowupsSection(cfg, isEs),
    saveBar,
    renderScript(lang),
  ].join('\n')
}
