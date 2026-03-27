// scheduled-tasks/templates.ts — SSR HTML for console section

import type { ScheduledTask, UserGroupInfo } from './types.js'

type Lang = 'es' | 'en'

const labels: Record<Lang, Record<string, string>> = {
  es: {
    title: 'Tareas Automaticas',
    desc: 'Configura tareas que el agente ejecuta automaticamente. Define cuando se activan, a quien van dirigidas y que acciones realizar.',
    newTask: 'Nueva tarea',
    name: 'Nombre de la tarea',
    namePlaceholder: 'Ej: Seguimiento semanal, Reporte diario',
    prompt: 'Instruccion para el agente',
    promptPlaceholder: 'Describe que debe hacer el agente cuando se ejecute esta tarea...',
    triggerType: 'Tipo de activacion',
    triggerCron: 'Programada (horario)',
    triggerEvent: 'Por evento',
    triggerManual: 'Solo manual',
    cron: 'Horario (cron)',
    cronHelp: 'Ej: */30 * * * * (cada 30 min) · 0 9 * * 1-5 (L-V 9am) · 0 0 * * * (medianoche)',
    event: 'Evento del sistema',
    eventHelp: 'La tarea se ejecuta cada vez que ocurre este evento',
    recipient: 'Destinatario',
    recipientNone: 'Sin destinatario (solo ejecutar)',
    recipientGroup: 'Grupo completo',
    recipientUser: 'Usuario especifico',
    group: 'Grupo',
    selectGroup: 'Selecciona un grupo...',
    user: 'Usuario',
    selectUser: 'Selecciona un usuario...',
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
    enabled: 'Tarea activa',
    save: 'Guardar tarea',
    cancel: 'Cancelar',
    run: 'Ejecutar',
    edit: 'Editar',
    delete: 'Eliminar',
    deleteConfirm: 'Eliminar esta tarea? Esta accion no se puede deshacer.',
    noTasks: 'No hay tareas configuradas. Crea una nueva tarea para que el agente la ejecute automaticamente.',
    lastRun: 'Ultima ejecucion',
    never: 'Nunca ejecutada',
    success: 'Exitosa',
    error: 'Error',
    result: 'Resultado de ejecucion',
    close: 'Cerrar',
    allUsers: 'Todos',
    eventContactNew: 'Nuevo contacto registrado',
    eventContactStatus: 'Cambio de estado de contacto',
    eventMessageIncoming: 'Mensaje entrante recibido',
    eventModuleActivated: 'Modulo activado',
    eventModuleDeactivated: 'Modulo desactivado',
    taskCount: 'tareas',
    activeCount: 'activas',
    sectionTrigger: 'Activacion',
    sectionRecipient: 'Destinatario',
    sectionActions: 'Acciones',
    noGroups: 'No hay grupos de usuarios configurados',
  },
  en: {
    title: 'Automated Tasks',
    desc: 'Configure tasks the agent runs automatically. Define when they trigger, who they target, and what actions to perform.',
    newTask: 'New task',
    name: 'Task name',
    namePlaceholder: 'E.g.: Weekly follow-up, Daily report',
    prompt: 'Instruction for the agent',
    promptPlaceholder: 'Describe what the agent should do when this task runs...',
    triggerType: 'Trigger type',
    triggerCron: 'Scheduled (cron)',
    triggerEvent: 'Event-based',
    triggerManual: 'Manual only',
    cron: 'Schedule (cron)',
    cronHelp: 'E.g.: */30 * * * * (every 30 min) · 0 9 * * 1-5 (Mon-Fri 9am) · 0 0 * * * (midnight)',
    event: 'System event',
    eventHelp: 'The task runs every time this event occurs',
    recipient: 'Recipient',
    recipientNone: 'No recipient (execute only)',
    recipientGroup: 'Entire group',
    recipientUser: 'Specific user',
    group: 'Group',
    selectGroup: 'Select a group...',
    user: 'User',
    selectUser: 'Select a user...',
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
    enabled: 'Task active',
    save: 'Save task',
    cancel: 'Cancel',
    run: 'Run',
    edit: 'Edit',
    delete: 'Delete',
    deleteConfirm: 'Delete this task? This cannot be undone.',
    noTasks: 'No tasks configured. Create a new task for the agent to execute automatically.',
    lastRun: 'Last run',
    never: 'Never run',
    success: 'Success',
    error: 'Error',
    result: 'Execution result',
    close: 'Close',
    allUsers: 'All',
    eventContactNew: 'New contact registered',
    eventContactStatus: 'Contact status change',
    eventMessageIncoming: 'Incoming message received',
    eventModuleActivated: 'Module activated',
    eventModuleDeactivated: 'Module deactivated',
    taskCount: 'tasks',
    activeCount: 'active',
    sectionTrigger: 'Trigger',
    sectionRecipient: 'Recipient',
    sectionActions: 'Actions',
    noGroups: 'No user groups configured',
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

function formatDate(iso: string | null, lang: Lang): string {
  if (!iso) return '—'
  const d = new Date(iso)
  return d.toLocaleString(lang === 'es' ? 'es-CL' : 'en-US', { dateStyle: 'short', timeStyle: 'short' })
}

function triggerBadge(task: ScheduledTask, lang: Lang): string {
  if (task.trigger_type === 'event') return `<span class="panel-badge" style="background:rgba(255,149,0,0.12);color:#ff9500">&#9889; ${esc(task.trigger_event ?? '')}</span>`
  if (task.trigger_type === 'manual') return `<span class="panel-badge" style="background:rgba(88,86,214,0.1);color:#5856d6">${l('triggerManual', lang)}</span>`
  return `<span class="panel-badge" style="background:rgba(0,122,255,0.1);color:#007aff"><code style="font-size:11px">${esc(task.cron)}</code></span>`
}

export function renderTasksSection(
  tasks: ScheduledTask[],
  lang: Lang,
  userGroups: UserGroupInfo[] = [],
  availableTools: Array<{ name: string; displayName: string }> = [],
): string {
  const activeTasks = tasks.filter(t => t.enabled).length

  // --- Task cards ---
  const taskCards = tasks.length === 0
    ? `<div style="padding:40px 20px;text-align:center">
        <div style="font-size:32px;margin-bottom:8px">&#128197;</div>
        <div style="color:var(--text-tertiary);font-size:14px">${l('noTasks', lang)}</div>
      </div>`
    : tasks.map(t => `
      <div class="st-task-card" data-task-id="${esc(t.id)}" style="background:var(--bg-primary);border:1px solid var(--border-light);border-radius:10px;padding:14px 16px;transition:border-color 0.15s ease${!t.enabled ? ';opacity:0.55' : ''}">
        <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:10px">
          <div style="flex:1;min-width:0">
            <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:4px">
              <span style="font-weight:600;font-size:14px">${esc(t.name)}</span>
              ${statusBadge(t, lang)}
              ${!t.enabled ? '<span class="panel-badge badge-soon">OFF</span>' : ''}
            </div>
            <div style="font-size:12px;color:var(--text-tertiary);margin-bottom:6px;display:flex;align-items:center;gap:6px;flex-wrap:wrap">
              ${triggerBadge(t, lang)}
              ${t.recipient?.type === 'group' ? `<span style="color:var(--text-secondary)">&#128101; ${esc(t.recipient.group ?? '')}</span>` : ''}
              ${t.recipient?.type === 'user' ? `<span style="color:var(--text-secondary)">&#128100; ${esc(t.recipient.userId ?? '')}</span>` : ''}
              ${t.actions.length > 0 ? `<span class="panel-badge" style="background:rgba(88,86,214,0.1);color:#5856d6;font-size:10px">${t.actions.length} action${t.actions.length > 1 ? 's' : ''}</span>` : ''}
            </div>
            <div style="font-size:12px;color:var(--text-secondary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:450px" title="${esc(t.prompt)}">${esc(t.prompt)}</div>
            <div style="font-size:11px;color:var(--text-tertiary);margin-top:4px">${l('lastRun', lang)}: ${formatDate(t.last_run_at, lang)}</div>
          </div>
          <div style="display:flex;gap:4px;flex-shrink:0">
            <button type="button" class="wa-btn" onclick="stRunTask('${esc(t.id)}')" title="${l('run', lang)}"
              style="font-size:12px;padding:5px 10px;border-radius:6px">&#9654;</button>
            <button type="button" class="wa-btn" onclick="stEditTask('${esc(t.id)}')"
              style="font-size:12px;padding:5px 10px;border-radius:6px">${l('edit', lang)}</button>
            <button type="button" class="wa-btn" onclick="stDeleteTask('${esc(t.id)}')"
              style="font-size:12px;padding:5px 10px;border-radius:6px;color:var(--error)">${l('delete', lang)}</button>
          </div>
        </div>
      </div>`).join('')

  // --- Event options ---
  const eventOptions = [
    { value: 'contact:new', label: l('eventContactNew', lang) },
    { value: 'contact:status_changed', label: l('eventContactStatus', lang) },
    { value: 'message:incoming', label: l('eventMessageIncoming', lang) },
    { value: 'module:activated', label: l('eventModuleActivated', lang) },
    { value: 'module:deactivated', label: l('eventModuleDeactivated', lang) },
  ]
  const eventOptionsHtml = eventOptions.map(e => `<option value="${esc(e.value)}">${esc(e.label)}</option>`).join('')

  // --- Group options ---
  const activeGroups = userGroups.filter(g => g.isEnabled)
  const groupOptionsHtml = activeGroups.length > 0
    ? `<option value="" disabled selected>${l('selectGroup', lang)}</option>` + activeGroups.map(g => `<option value="${esc(g.listType)}">${esc(g.displayName || g.listType)} (${g.users.length})</option>`).join('')
    : `<option value="" disabled>${l('noGroups', lang)}</option>`

  const hasUsersInGroups = activeGroups.some(g => g.users.length > 0)

  return `
    <!-- Header with counter and new task button -->
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px">
      <div style="display:flex;align-items:center;gap:10px">
        <span style="font-size:13px;color:var(--text-tertiary)">${tasks.length} ${l('taskCount', lang)} · ${activeTasks} ${l('activeCount', lang)}</span>
      </div>
      <button type="button" class="wa-btn wa-btn-connect" onclick="stShowForm()" style="font-size:13px;padding:7px 16px;border-radius:8px">+ ${l('newTask', lang)}</button>
    </div>

    <!-- Create/Edit form -->
    <div id="st-form" style="display:none;margin-bottom:16px">
      <div class="panel">
        <div class="panel-body" style="padding:20px">
          <input type="hidden" id="st-edit-id" value="">

          <!-- Row 1: Name + Enabled toggle -->
          <div style="display:flex;align-items:flex-start;gap:16px;margin-bottom:16px">
            <div style="flex:1">
              <label style="font-size:12px;font-weight:600;text-transform:uppercase;color:var(--text-tertiary);display:block;margin-bottom:4px">${l('name', lang)}</label>
              <input type="text" id="st-name" placeholder="${l('namePlaceholder', lang)}"
                style="width:100%;padding:9px 12px;border:1px solid var(--border);border-radius:8px;font-size:14px">
            </div>
            <div style="display:flex;align-items:center;gap:8px;padding-top:20px">
              <label class="toggle"><input type="checkbox" id="st-enabled" checked><span class="toggle-slider"></span></label>
              <span style="font-size:12px;font-weight:500;color:var(--text-secondary)">${l('enabled', lang)}</span>
            </div>
          </div>

          <!-- Prompt -->
          <div style="margin-bottom:16px">
            <label style="font-size:12px;font-weight:600;text-transform:uppercase;color:var(--text-tertiary);display:block;margin-bottom:4px">${l('prompt', lang)}</label>
            <textarea id="st-prompt" rows="3" placeholder="${l('promptPlaceholder', lang)}"
              style="width:100%;padding:9px 12px;border:1px solid var(--border);border-radius:8px;font-size:14px;resize:vertical;font-family:inherit"></textarea>
          </div>

          <!-- 3-column grid: Trigger | Recipient | Actions -->
          <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:16px;margin-bottom:16px">

            <!-- Trigger -->
            <div style="background:var(--bg-secondary);border-radius:8px;padding:14px">
              <div style="font-size:11px;font-weight:600;text-transform:uppercase;color:var(--text-tertiary);margin-bottom:8px">${l('sectionTrigger', lang)}</div>
              <select id="st-trigger-type" onchange="stTriggerChanged()"
                style="width:100%;padding:8px 10px;border:1px solid var(--border);border-radius:6px;font-size:13px;background:var(--bg-primary);margin-bottom:8px">
                <option value="cron">${l('triggerCron', lang)}</option>
                <option value="event">${l('triggerEvent', lang)}</option>
                <option value="manual">${l('triggerManual', lang)}</option>
              </select>
              <div id="st-cron-row">
                <input type="text" id="st-cron" placeholder="*/30 * * * *"
                  style="width:100%;padding:8px 10px;border:1px solid var(--border);border-radius:6px;font-size:13px;font-family:monospace;background:var(--bg-primary)">
                <div style="font-size:10px;color:var(--text-tertiary);margin-top:4px">${l('cronHelp', lang)}</div>
              </div>
              <div id="st-event-row" style="display:none">
                <select id="st-trigger-event"
                  style="width:100%;padding:8px 10px;border:1px solid var(--border);border-radius:6px;font-size:13px;background:var(--bg-primary)">
                  ${eventOptionsHtml}
                </select>
                <div style="font-size:10px;color:var(--text-tertiary);margin-top:4px">${l('eventHelp', lang)}</div>
              </div>
            </div>

            <!-- Recipient -->
            <div style="background:var(--bg-secondary);border-radius:8px;padding:14px">
              <div style="font-size:11px;font-weight:600;text-transform:uppercase;color:var(--text-tertiary);margin-bottom:8px">${l('sectionRecipient', lang)}</div>
              <select id="st-recipient-type" onchange="stRecipientChanged()"
                style="width:100%;padding:8px 10px;border:1px solid var(--border);border-radius:6px;font-size:13px;background:var(--bg-primary);margin-bottom:8px">
                <option value="none">${l('recipientNone', lang)}</option>
                <option value="group">${l('recipientGroup', lang)}</option>
                ${hasUsersInGroups ? `<option value="user">${l('recipientUser', lang)}</option>` : ''}
              </select>
              <div id="st-group-row" style="display:none">
                <select id="st-recipient-group" onchange="stGroupChanged()"
                  style="width:100%;padding:8px 10px;border:1px solid var(--border);border-radius:6px;font-size:13px;background:var(--bg-primary);margin-bottom:8px">
                  ${groupOptionsHtml}
                </select>
              </div>
              <div id="st-user-row" style="display:none">
                <select id="st-recipient-user"
                  style="width:100%;padding:8px 10px;border:1px solid var(--border);border-radius:6px;font-size:13px;background:var(--bg-primary)">
                </select>
              </div>
            </div>

            <!-- Actions -->
            <div style="background:var(--bg-secondary);border-radius:8px;padding:14px">
              <div style="font-size:11px;font-weight:600;text-transform:uppercase;color:var(--text-tertiary);margin-bottom:8px">${l('sectionActions', lang)}</div>
              <div id="st-actions-list" style="margin-bottom:6px"></div>
              <button type="button" class="wa-btn" onclick="stAddAction()" style="font-size:11px;padding:4px 10px;border-radius:6px">+ ${l('actionAdd', lang)}</button>
              <div style="font-size:10px;color:var(--text-tertiary);margin-top:4px">${l('actionPlaceholder', lang)}</div>
            </div>
          </div>

          <!-- Form buttons -->
          <div style="display:flex;gap:8px;justify-content:flex-end;padding-top:12px;border-top:1px solid var(--border-light)">
            <button type="button" class="wa-btn" onclick="stHideForm()" style="font-size:13px;padding:7px 16px;border-radius:8px">${l('cancel', lang)}</button>
            <button type="button" class="wa-btn wa-btn-connect" onclick="stSaveTask()" style="font-size:13px;padding:7px 16px;border-radius:8px">${l('save', lang)}</button>
          </div>
        </div>
      </div>
    </div>

    <!-- Task list -->
    <div id="st-task-list" style="display:flex;flex-direction:column;gap:8px">${taskCards}</div>

    <!-- Result modal -->
    <div id="st-modal" style="display:none;position:fixed;inset:0;background:rgba(0,0,0,0.5);z-index:1000;align-items:center;justify-content:center">
      <div style="background:var(--bg-primary);border-radius:12px;padding:20px;max-width:600px;width:90%;max-height:80vh;overflow-y:auto;box-shadow:0 20px 60px rgba(0,0,0,0.3)">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
          <span style="font-weight:600;font-size:15px">${l('result', lang)}</span>
          <button type="button" onclick="stCloseModal()" style="background:none;border:none;font-size:20px;cursor:pointer;color:var(--text-tertiary);padding:4px 8px">&times;</button>
        </div>
        <pre id="st-modal-content" style="white-space:pre-wrap;font-size:13px;background:var(--bg-secondary);padding:14px;border-radius:8px;max-height:60vh;overflow-y:auto"></pre>
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
  const USER_GROUPS = ${JSON.stringify(userGroups.filter(g => g.isEnabled))}
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
        opt.textContent = (u.displayName || u.senderId) + ' (' + u.channel + ')'
        userSelect.appendChild(opt)
      }
    } else {
      var opt = document.createElement('option')
      opt.value = ''
      opt.disabled = true
      opt.textContent = L.selectUser
      userSelect.appendChild(opt)
    }
  }

  // --- Actions management ---
  window.stAddAction = function(action) {
    const list = document.getElementById('st-actions-list')
    const idx = actionCounter++
    const div = document.createElement('div')
    div.id = 'st-action-' + idx
    div.style.cssText = 'display:flex;gap:6px;align-items:flex-start;margin-bottom:6px;padding:8px;background:var(--bg-primary);border-radius:6px;border:1px solid var(--border-light)'

    const type = action ? action.type : 'tool'
    const toolOpts = TOOLS.map(t => '<option value="' + t.name + '"' + (action && action.toolName === t.name ? ' selected' : '') + '>' + (t.displayName || t.name) + '</option>').join('')

    div.innerHTML = '<div style="flex:1">' +
      '<select data-field="type" style="padding:5px 8px;border:1px solid var(--border);border-radius:5px;font-size:11px;margin-bottom:4px;width:100%;background:var(--bg-primary)" onchange="stActionTypeChanged(' + idx + ')">' +
        '<option value="tool"' + (type === 'tool' ? ' selected' : '') + '>' + L.actionTool + '</option>' +
        '<option value="message"' + (type === 'message' ? ' selected' : '') + '>' + L.actionMessage + '</option>' +
        '<option value="hook"' + (type === 'hook' ? ' selected' : '') + '>' + L.actionHook + '</option>' +
      '</select>' +
      '<div data-panel="tool" style="' + (type === 'tool' ? '' : 'display:none') + '">' +
        '<select data-field="toolName" style="width:100%;padding:5px 8px;border:1px solid var(--border);border-radius:5px;font-size:11px;background:var(--bg-primary)">' + toolOpts + '</select>' +
      '</div>' +
      '<div data-panel="message" style="' + (type === 'message' ? '' : 'display:none') + '">' +
        '<input data-field="messageText" type="text" style="width:100%;padding:5px 8px;border:1px solid var(--border);border-radius:5px;font-size:11px;margin-bottom:4px" placeholder="' + L.actionMsgText + '" value="' + (action && action.messageText ? action.messageText.replace(/"/g, '&quot;') : '') + '">' +
        '<select data-field="messageChannel" style="width:100%;padding:5px 8px;border:1px solid var(--border);border-radius:5px;font-size:11px;background:var(--bg-primary)">' +
          '<option value="whatsapp">WhatsApp</option>' +
          '<option value="email"' + (action && action.messageChannel === 'email' ? ' selected' : '') + '>Email</option>' +
          '<option value="google-chat"' + (action && action.messageChannel === 'google-chat' ? ' selected' : '') + '>Google Chat</option>' +
        '</select>' +
      '</div>' +
      '<div data-panel="hook" style="' + (type === 'hook' ? '' : 'display:none') + '">' +
        '<input data-field="hookName" type="text" style="width:100%;padding:5px 8px;border:1px solid var(--border);border-radius:5px;font-size:11px" placeholder="hook:name" value="' + (action && action.hookName ? action.hookName : '') + '">' +
      '</div>' +
    '</div>' +
    '<button type="button" onclick="stRemoveAction(' + idx + ')" style="background:none;border:none;color:var(--error);cursor:pointer;font-size:16px;padding:2px 4px;line-height:1">&times;</button>'

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
    document.getElementById('st-form').scrollIntoView({ behavior: 'smooth', block: 'start' })
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
      setTimeout(function() { document.getElementById('st-recipient-user').value = r.userId }, 50)
    }

    // Actions
    document.getElementById('st-actions-list').innerHTML = ''
    actionCounter = 0
    if (task.actions && task.actions.length > 0) {
      for (var a of task.actions) stAddAction(a)
    }

    document.getElementById('st-form').scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  window.stSaveTask = async function() {
    const editId = document.getElementById('st-edit-id').value
    const triggerType = document.getElementById('st-trigger-type').value
    const recipientType = document.getElementById('st-recipient-type').value

    const body = {
      name: document.getElementById('st-name').value.trim(),
      prompt: document.getElementById('st-prompt').value.trim(),
      trigger_type: triggerType,
      cron: triggerType === 'cron' ? document.getElementById('st-cron').value.trim() : '',
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

    if (!body.name || !body.prompt) {
      alert(${JSON.stringify(lang === 'es' ? 'Nombre e instruccion son obligatorios' : 'Name and instruction are required')})
      return
    }
    if (triggerType === 'cron' && !body.cron) {
      alert(${JSON.stringify(lang === 'es' ? 'La expresion cron es obligatoria para tareas programadas' : 'Cron expression is required for scheduled tasks')})
      return
    }

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
