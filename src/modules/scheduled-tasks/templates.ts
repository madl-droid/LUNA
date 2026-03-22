// scheduled-tasks/templates.ts — SSR HTML for console section

import type { ScheduledTask, UserGroupInfo } from './types.js'

type Lang = 'es' | 'en'

const labels: Record<Lang, Record<string, string>> = {
  es: {
    title: 'Tareas Programadas',
    desc: 'Crea tareas que el agente ejecuta automaticamente. Configura horarios, destinatarios y acciones.',
    newTask: 'Nueva tarea',
    name: 'Nombre',
    prompt: 'Instruccion para el agente',
    triggerType: 'Activacion',
    triggerCron: 'Horario (cron)',
    triggerEvent: 'Evento del sistema',
    triggerManual: 'Solo manual',
    cron: 'Expresion cron',
    cronHelp: 'Ej: */30 * * * * (cada 30 min), 0 9 * * 1-5 (L-V 9am), 0 0 * * * (medianoche)',
    event: 'Evento',
    eventHelp: 'Se ejecuta cada vez que ocurre el evento seleccionado',
    recipient: 'Destinatario',
    recipientNone: 'Sin destinatario',
    recipientGroup: 'Grupo completo',
    recipientUser: 'Usuario especifico',
    group: 'Grupo',
    user: 'Usuario',
    actions: 'Acciones adicionales',
    actionAdd: 'Agregar accion',
    actionTool: 'Ejecutar herramienta',
    actionMessage: 'Enviar mensaje',
    actionHook: 'Disparar hook',
    actionToolName: 'Herramienta',
    actionMsgText: 'Texto del mensaje',
    actionMsgChannel: 'Canal',
    actionHookName: 'Nombre del hook',
    actionRemove: 'Quitar',
    actionPlaceholder: 'Usa {{result}} para insertar el resultado del agente',
    enabled: 'Activa',
    save: 'Guardar',
    cancel: 'Cancelar',
    run: 'Ejecutar ahora',
    edit: 'Editar',
    delete: 'Eliminar',
    deleteConfirm: 'Eliminar esta tarea?',
    noTasks: 'No hay tareas programadas. Crea una para que el agente la ejecute automaticamente.',
    lastRun: 'Ultima ejecucion',
    never: 'Nunca',
    success: 'OK',
    error: 'Error',
    result: 'Resultado',
    close: 'Cerrar',
    allUsers: 'Todos',
    eventContactNew: 'Nuevo contacto',
    eventContactStatus: 'Cambio de estado de contacto',
    eventMessageIncoming: 'Mensaje entrante',
    eventModuleActivated: 'Modulo activado',
    eventModuleDeactivated: 'Modulo desactivado',
  },
  en: {
    title: 'Scheduled Tasks',
    desc: 'Create tasks the agent runs automatically. Configure schedules, recipients, and actions.',
    newTask: 'New task',
    name: 'Name',
    prompt: 'Instruction for the agent',
    triggerType: 'Trigger',
    triggerCron: 'Schedule (cron)',
    triggerEvent: 'System event',
    triggerManual: 'Manual only',
    cron: 'Cron expression',
    cronHelp: 'E.g.: */30 * * * * (every 30 min), 0 9 * * 1-5 (Mon-Fri 9am), 0 0 * * * (midnight)',
    event: 'Event',
    eventHelp: 'Runs every time the selected event occurs',
    recipient: 'Recipient',
    recipientNone: 'No recipient',
    recipientGroup: 'Entire group',
    recipientUser: 'Specific user',
    group: 'Group',
    user: 'User',
    actions: 'Additional actions',
    actionAdd: 'Add action',
    actionTool: 'Run tool',
    actionMessage: 'Send message',
    actionHook: 'Fire hook',
    actionToolName: 'Tool',
    actionMsgText: 'Message text',
    actionMsgChannel: 'Channel',
    actionHookName: 'Hook name',
    actionRemove: 'Remove',
    actionPlaceholder: 'Use {{result}} to insert the agent\'s result',
    enabled: 'Active',
    save: 'Save',
    cancel: 'Cancel',
    run: 'Run now',
    edit: 'Edit',
    delete: 'Delete',
    deleteConfirm: 'Delete this task?',
    noTasks: 'No scheduled tasks. Create one for the agent to execute automatically.',
    lastRun: 'Last run',
    never: 'Never',
    success: 'OK',
    error: 'Error',
    result: 'Result',
    close: 'Close',
    allUsers: 'All',
    eventContactNew: 'New contact',
    eventContactStatus: 'Contact status change',
    eventMessageIncoming: 'Incoming message',
    eventModuleActivated: 'Module activated',
    eventModuleDeactivated: 'Module deactivated',
  },
}

function l(key: string, lang: Lang): string {
  return labels[lang]?.[key] ?? labels.es[key] ?? key
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

function statusBadge(task: ScheduledTask, lang: Lang): string {
  if (!task.last_status) return `<span class="panel-badge badge-soon">${l('never', lang)}</span>`
  if (task.last_status === 'success') return `<span class="panel-badge badge-active">${l('success', lang)}</span>`
  return `<span class="panel-badge" style="background:rgba(255,59,48,0.12);color:var(--error)">${l('error', lang)}</span>`
}

function formatDate(iso: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso)
  return d.toLocaleString('es-CL', { dateStyle: 'short', timeStyle: 'short' })
}

function triggerLabel(task: ScheduledTask, lang: Lang): string {
  if (task.trigger_type === 'event') return `&#9889; ${task.trigger_event ?? ''}`
  if (task.trigger_type === 'manual') return `&#9998; ${l('triggerManual', lang)}`
  return `<code style="background:var(--bg-secondary);padding:1px 6px;border-radius:4px;font-size:11px">${esc(task.cron)}</code>`
}

function recipientLabel(task: ScheduledTask, lang: Lang): string {
  const r = task.recipient
  if (!r || r.type === 'none') return ''
  if (r.type === 'group') return `<span style="margin-left:8px">&#128101; ${esc(r.group ?? '')}</span>`
  if (r.type === 'user') return `<span style="margin-left:8px">&#128100; ${esc(r.group ?? '')}/${esc(r.userId ?? '')}</span>`
  return ''
}

export function renderTasksSection(
  tasks: ScheduledTask[],
  lang: Lang,
  userGroups: UserGroupInfo[] = [],
  availableTools: Array<{ name: string; displayName: string }> = [],
): string {
  const taskRows = tasks.length === 0
    ? `<div style="padding:24px;text-align:center;color:var(--text-tertiary);font-size:14px">${l('noTasks', lang)}</div>`
    : tasks.map(t => `
      <div class="task-row" data-task-id="${esc(t.id)}" style="display:flex;align-items:center;justify-content:space-between;padding:12px 16px;border-bottom:1px solid var(--border-light)">
        <div style="flex:1;min-width:0">
          <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
            <span style="font-weight:600;font-size:14px">${esc(t.name)}</span>
            ${statusBadge(t, lang)}
            ${!t.enabled ? '<span class="panel-badge badge-soon">OFF</span>' : ''}
            ${t.actions.length > 0 ? `<span class="panel-badge" style="background:rgba(88,86,214,0.1);color:#5856d6;font-size:10px">${t.actions.length} action${t.actions.length > 1 ? 's' : ''}</span>` : ''}
          </div>
          <div style="font-size:12px;color:var(--text-tertiary);margin-top:2px;display:flex;align-items:center;gap:4px;flex-wrap:wrap">
            ${triggerLabel(t, lang)}
            ${recipientLabel(t, lang)}
            <span style="margin-left:8px">${l('lastRun', lang)}: ${formatDate(t.last_run_at)}</span>
          </div>
          <div style="font-size:12px;color:var(--text-secondary);margin-top:4px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:500px" title="${esc(t.prompt)}">${esc(t.prompt)}</div>
        </div>
        <div style="display:flex;gap:6px;margin-left:12px;flex-shrink:0">
          <button type="button" class="wa-btn" onclick="stRunTask('${esc(t.id)}')" style="font-size:12px;padding:4px 10px" title="${l('run', lang)}">&#9654;</button>
          <button type="button" class="wa-btn" onclick="stEditTask('${esc(t.id)}')" style="font-size:12px;padding:4px 10px">${l('edit', lang)}</button>
          <button type="button" class="wa-btn" onclick="stDeleteTask('${esc(t.id)}')" style="font-size:12px;padding:4px 10px;color:var(--error)">${l('delete', lang)}</button>
        </div>
      </div>`).join('')

  // Build event options
  const eventOptions = [
    { value: 'contact:new', label: l('eventContactNew', lang) },
    { value: 'contact:status_changed', label: l('eventContactStatus', lang) },
    { value: 'message:incoming', label: l('eventMessageIncoming', lang) },
    { value: 'module:activated', label: l('eventModuleActivated', lang) },
    { value: 'module:deactivated', label: l('eventModuleDeactivated', lang) },
  ]
  const eventOptionsHtml = eventOptions.map(e => `<option value="${esc(e.value)}">${esc(e.label)}</option>`).join('')

  // Build group options
  const groupOptionsHtml = userGroups.map(g => `<option value="${esc(g.listType)}">${esc(g.displayName || g.listType)}</option>`).join('')

  // Build tool options
  const toolOptionsHtml = availableTools.map(t => `<option value="${esc(t.name)}">${esc(t.displayName || t.name)}</option>`).join('')

  const fieldStyle = 'margin-bottom:10px'
  const labelStyle = 'font-size:13px;font-weight:500;display:block;margin-bottom:4px'
  const inputStyle = 'width:100%;padding:8px;border:1px solid var(--border);border-radius:6px;font-size:14px'
  const selectStyle = `${inputStyle};background:var(--bg-primary)`

  return `
    <div class="panel">
      <div class="panel-header" onclick="togglePanel(this)">
        <span class="panel-title">${l('title', lang)}</span>
        <span class="panel-chevron">&#9660;</span>
      </div>
      <div class="panel-body">
        <div class="panel-info">${l('desc', lang)}</div>

        <div style="padding:8px 0">
          <button type="button" class="wa-btn wa-btn-connect" onclick="stShowForm()" style="font-size:13px;padding:6px 14px">+ ${l('newTask', lang)}</button>
        </div>

        <!-- Create/Edit form -->
        <div id="st-form" style="display:none;padding:16px;background:var(--bg-secondary);border-radius:8px;margin:8px 0">
          <input type="hidden" id="st-edit-id" value="">

          <!-- Name -->
          <div class="field" style="${fieldStyle}">
            <label style="${labelStyle}">${l('name', lang)}</label>
            <input type="text" id="st-name" style="${inputStyle}" placeholder="${l('name', lang)}">
          </div>

          <!-- Prompt -->
          <div class="field" style="${fieldStyle}">
            <label style="${labelStyle}">${l('prompt', lang)}</label>
            <textarea id="st-prompt" rows="3" style="${inputStyle};resize:vertical" placeholder="${l('prompt', lang)}"></textarea>
          </div>

          <!-- Trigger type -->
          <div class="field" style="${fieldStyle}">
            <label style="${labelStyle}">${l('triggerType', lang)}</label>
            <select id="st-trigger-type" style="${selectStyle}" onchange="stTriggerChanged()">
              <option value="cron">${l('triggerCron', lang)}</option>
              <option value="event">${l('triggerEvent', lang)}</option>
              <option value="manual">${l('triggerManual', lang)}</option>
            </select>
          </div>

          <!-- Cron (shown when trigger=cron) -->
          <div id="st-cron-row" class="field" style="${fieldStyle}">
            <label style="${labelStyle}">${l('cron', lang)}</label>
            <input type="text" id="st-cron" style="${inputStyle};font-family:monospace" placeholder="*/30 * * * *">
            <span style="font-size:11px;color:var(--text-tertiary)">${l('cronHelp', lang)}</span>
          </div>

          <!-- Event (shown when trigger=event) -->
          <div id="st-event-row" class="field" style="${fieldStyle};display:none">
            <label style="${labelStyle}">${l('event', lang)}</label>
            <select id="st-trigger-event" style="${selectStyle}">
              ${eventOptionsHtml}
            </select>
            <span style="font-size:11px;color:var(--text-tertiary)">${l('eventHelp', lang)}</span>
          </div>

          <!-- Recipient -->
          <div class="field" style="${fieldStyle}">
            <label style="${labelStyle}">${l('recipient', lang)}</label>
            <select id="st-recipient-type" style="${selectStyle}" onchange="stRecipientChanged()">
              <option value="none">${l('recipientNone', lang)}</option>
              <option value="group">${l('recipientGroup', lang)}</option>
              ${userGroups.some(g => g.users.length > 0) ? `<option value="user">${l('recipientUser', lang)}</option>` : ''}
            </select>
          </div>

          <!-- Group selector (shown when recipient=group or user) -->
          <div id="st-group-row" class="field" style="${fieldStyle};display:none">
            <label style="${labelStyle}">${l('group', lang)}</label>
            <select id="st-recipient-group" style="${selectStyle}" onchange="stGroupChanged()">
              ${groupOptionsHtml}
            </select>
          </div>

          <!-- User selector (shown when recipient=user) -->
          <div id="st-user-row" class="field" style="${fieldStyle};display:none">
            <label style="${labelStyle}">${l('user', lang)}</label>
            <select id="st-recipient-user" style="${selectStyle}">
            </select>
          </div>

          <!-- Actions -->
          <div class="field" style="${fieldStyle}">
            <label style="${labelStyle}">${l('actions', lang)}</label>
            <div id="st-actions-list"></div>
            <button type="button" class="wa-btn" onclick="stAddAction()" style="font-size:12px;padding:4px 10px;margin-top:4px">+ ${l('actionAdd', lang)}</button>
            <span style="font-size:11px;color:var(--text-tertiary);margin-left:8px">${l('actionPlaceholder', lang)}</span>
          </div>

          <!-- Enabled -->
          <div class="field" style="${fieldStyle};display:flex;align-items:center;gap:8px">
            <input type="checkbox" id="st-enabled" checked>
            <label for="st-enabled" style="font-size:13px;font-weight:500">${l('enabled', lang)}</label>
          </div>

          <div style="display:flex;gap:8px">
            <button type="button" class="wa-btn wa-btn-connect" onclick="stSaveTask()" style="font-size:13px;padding:6px 14px">${l('save', lang)}</button>
            <button type="button" class="wa-btn" onclick="stHideForm()" style="font-size:13px;padding:6px 14px">${l('cancel', lang)}</button>
          </div>
        </div>

        <!-- Task list -->
        <div id="st-task-list">${taskRows}</div>
      </div>
    </div>

    <!-- Result modal -->
    <div id="st-modal" style="display:none;position:fixed;inset:0;background:rgba(0,0,0,0.5);z-index:1000;align-items:center;justify-content:center">
      <div style="background:var(--bg-primary);border-radius:12px;padding:20px;max-width:600px;width:90%;max-height:80vh;overflow-y:auto">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
          <span style="font-weight:600">${l('result', lang)}</span>
          <button type="button" onclick="stCloseModal()" style="background:none;border:none;font-size:18px;cursor:pointer">&times;</button>
        </div>
        <pre id="st-modal-content" style="white-space:pre-wrap;font-size:13px;background:var(--bg-secondary);padding:12px;border-radius:8px"></pre>
      </div>
    </div>

    ${renderScript(lang, userGroups, availableTools)}`
}

function renderScript(
  lang: Lang,
  userGroups: UserGroupInfo[],
  availableTools: Array<{ name: string; displayName: string }>,
): string {
  return `<script>
(function() {
  const API = '/console/api/scheduled-tasks'
  const L = ${JSON.stringify(labels[lang])}
  const USER_GROUPS = ${JSON.stringify(userGroups)}
  const TOOLS = ${JSON.stringify(availableTools)}

  let actionCounter = 0

  // --- Trigger visibility ---
  window.stTriggerChanged = function() {
    const val = document.getElementById('st-trigger-type').value
    document.getElementById('st-cron-row').style.display = val === 'cron' ? '' : 'none'
    document.getElementById('st-event-row').style.display = val === 'event' ? '' : 'none'
  }

  // --- Recipient visibility ---
  window.stRecipientChanged = function() {
    const val = document.getElementById('st-recipient-type').value
    document.getElementById('st-group-row').style.display = (val === 'group' || val === 'user') ? '' : 'none'
    document.getElementById('st-user-row').style.display = val === 'user' ? '' : 'none'
    if (val === 'group' || val === 'user') stGroupChanged()
  }

  window.stGroupChanged = function() {
    const groupType = document.getElementById('st-recipient-group').value
    const userSelect = document.getElementById('st-recipient-user')
    userSelect.innerHTML = ''
    const grp = USER_GROUPS.find(g => g.listType === groupType)
    if (grp && grp.users.length > 0) {
      for (const u of grp.users) {
        const opt = document.createElement('option')
        opt.value = u.id
        opt.textContent = u.displayName || u.senderId
        userSelect.appendChild(opt)
      }
    }
  }

  // --- Actions management ---
  window.stAddAction = function(action) {
    const list = document.getElementById('st-actions-list')
    const idx = actionCounter++
    const div = document.createElement('div')
    div.id = 'st-action-' + idx
    div.style.cssText = 'display:flex;gap:8px;align-items:flex-start;margin-bottom:6px;padding:8px;background:var(--bg-primary);border-radius:6px;border:1px solid var(--border-light)'

    const type = action ? action.type : 'tool'
    const toolOpts = TOOLS.map(t => '<option value="' + t.name + '"' + (action && action.toolName === t.name ? ' selected' : '') + '>' + t.name + '</option>').join('')

    div.innerHTML = '<div style="flex:1">' +
      '<select data-field="type" style="padding:4px 8px;border:1px solid var(--border);border-radius:4px;font-size:12px;margin-bottom:4px" onchange="stActionTypeChanged(' + idx + ')">' +
        '<option value="tool"' + (type === 'tool' ? ' selected' : '') + '>' + L.actionTool + '</option>' +
        '<option value="message"' + (type === 'message' ? ' selected' : '') + '>' + L.actionMessage + '</option>' +
        '<option value="hook"' + (type === 'hook' ? ' selected' : '') + '>' + L.actionHook + '</option>' +
      '</select>' +
      '<div data-panel="tool" style="' + (type === 'tool' ? '' : 'display:none') + '">' +
        '<select data-field="toolName" style="width:100%;padding:4px 8px;border:1px solid var(--border);border-radius:4px;font-size:12px">' + toolOpts + '</select>' +
      '</div>' +
      '<div data-panel="message" style="' + (type === 'message' ? '' : 'display:none') + '">' +
        '<input data-field="messageText" type="text" style="width:100%;padding:4px 8px;border:1px solid var(--border);border-radius:4px;font-size:12px;margin-bottom:4px" placeholder="' + L.actionMsgText + '" value="' + (action && action.messageText ? action.messageText.replace(/"/g, '&quot;') : '') + '">' +
        '<select data-field="messageChannel" style="width:100%;padding:4px 8px;border:1px solid var(--border);border-radius:4px;font-size:12px">' +
          '<option value="whatsapp">WhatsApp</option>' +
          '<option value="email"' + (action && action.messageChannel === 'email' ? ' selected' : '') + '>Email</option>' +
          '<option value="google-chat"' + (action && action.messageChannel === 'google-chat' ? ' selected' : '') + '>Google Chat</option>' +
        '</select>' +
      '</div>' +
      '<div data-panel="hook" style="' + (type === 'hook' ? '' : 'display:none') + '">' +
        '<input data-field="hookName" type="text" style="width:100%;padding:4px 8px;border:1px solid var(--border);border-radius:4px;font-size:12px" placeholder="hook:name" value="' + (action && action.hookName ? action.hookName : '') + '">' +
      '</div>' +
    '</div>' +
    '<button type="button" onclick="stRemoveAction(' + idx + ')" style="background:none;border:none;color:var(--error);cursor:pointer;font-size:14px;padding:2px 6px">&times;</button>'

    list.appendChild(div)
  }

  window.stActionTypeChanged = function(idx) {
    const row = document.getElementById('st-action-' + idx)
    if (!row) return
    const type = row.querySelector('[data-field=type]').value
    row.querySelector('[data-panel=tool]').style.display = type === 'tool' ? '' : 'none'
    row.querySelector('[data-panel=message]').style.display = type === 'message' ? '' : 'none'
    row.querySelector('[data-panel=hook]').style.display = type === 'hook' ? '' : 'none'
  }

  window.stRemoveAction = function(idx) {
    const row = document.getElementById('st-action-' + idx)
    if (row) row.remove()
  }

  function collectActions() {
    const list = document.getElementById('st-actions-list')
    const actions = []
    for (const row of list.children) {
      const type = row.querySelector('[data-field=type]').value
      const action = { type: type }
      if (type === 'tool') {
        action.toolName = row.querySelector('[data-field=toolName]').value
      } else if (type === 'message') {
        action.messageText = row.querySelector('[data-field=messageText]').value
        action.messageChannel = row.querySelector('[data-field=messageChannel]').value
      } else if (type === 'hook') {
        action.hookName = row.querySelector('[data-field=hookName]').value
      }
      actions.push(action)
    }
    return actions
  }

  // --- Form show/hide ---
  window.stShowForm = function() {
    document.getElementById('st-form').style.display = 'block'
    document.getElementById('st-edit-id').value = ''
    document.getElementById('st-name').value = ''
    document.getElementById('st-prompt').value = ''
    document.getElementById('st-trigger-type').value = 'cron'
    document.getElementById('st-cron').value = ''
    document.getElementById('st-trigger-event').value = 'contact:new'
    document.getElementById('st-recipient-type').value = 'none'
    document.getElementById('st-enabled').checked = true
    document.getElementById('st-actions-list').innerHTML = ''
    actionCounter = 0
    stTriggerChanged()
    stRecipientChanged()
  }

  window.stHideForm = function() {
    document.getElementById('st-form').style.display = 'none'
  }

  window.stEditTask = async function(id) {
    const res = await fetch(API + '/list')
    const data = await res.json()
    const task = data.tasks.find(function(t) { return t.id === id })
    if (!task) return

    document.getElementById('st-form').style.display = 'block'
    document.getElementById('st-edit-id').value = task.id
    document.getElementById('st-name').value = task.name
    document.getElementById('st-prompt').value = task.prompt
    document.getElementById('st-trigger-type').value = task.trigger_type || 'cron'
    document.getElementById('st-cron').value = task.cron
    document.getElementById('st-trigger-event').value = task.trigger_event || 'contact:new'
    document.getElementById('st-enabled').checked = task.enabled
    stTriggerChanged()

    // Recipient
    var r = task.recipient || { type: 'none' }
    document.getElementById('st-recipient-type').value = r.type
    stRecipientChanged()
    if (r.group) {
      document.getElementById('st-recipient-group').value = r.group
      stGroupChanged()
    }
    if (r.userId) {
      document.getElementById('st-recipient-user').value = r.userId
    }

    // Actions
    document.getElementById('st-actions-list').innerHTML = ''
    actionCounter = 0
    if (task.actions && task.actions.length > 0) {
      for (var a of task.actions) stAddAction(a)
    }
  }

  window.stSaveTask = async function() {
    const editId = document.getElementById('st-edit-id').value
    const triggerType = document.getElementById('st-trigger-type').value
    const recipientType = document.getElementById('st-recipient-type').value

    const body = {
      name: document.getElementById('st-name').value,
      prompt: document.getElementById('st-prompt').value,
      trigger_type: triggerType,
      cron: triggerType === 'cron' ? document.getElementById('st-cron').value : '',
      trigger_event: triggerType === 'event' ? document.getElementById('st-trigger-event').value : null,
      enabled: document.getElementById('st-enabled').checked,
      recipient: { type: recipientType },
      actions: collectActions(),
    }

    if (recipientType === 'group' || recipientType === 'user') {
      body.recipient.group = document.getElementById('st-recipient-group').value
    }
    if (recipientType === 'user') {
      body.recipient.userId = document.getElementById('st-recipient-user').value
    }

    if (!body.name || !body.prompt) return alert('Name and prompt required')
    if (triggerType === 'cron' && !body.cron) return alert('Cron expression required')

    if (editId) {
      body.id = editId
      await fetch(API + '/update', { method: 'PUT', headers: {'Content-Type':'application/json'}, body: JSON.stringify(body) })
    } else {
      await fetch(API + '/create', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify(body) })
    }
    location.reload()
  }

  window.stDeleteTask = async function(id) {
    if (!confirm(L.deleteConfirm)) return
    await fetch(API + '/delete', { method: 'DELETE', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ id: id }) })
    location.reload()
  }

  window.stRunTask = async function(id) {
    var btn = event.target
    btn.disabled = true
    btn.textContent = '...'
    try {
      var res = await fetch(API + '/trigger', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ id: id }) })
      var data = await res.json()
      document.getElementById('st-modal-content').textContent = data.result || data.error || 'Done'
      document.getElementById('st-modal').style.display = 'flex'
    } catch(e) {
      alert('Error: ' + e.message)
    } finally {
      btn.disabled = false
      btn.textContent = '\\u25B6'
    }
  }

  window.stCloseModal = function() {
    document.getElementById('st-modal').style.display = 'none'
  }
})()
</script>`
}
