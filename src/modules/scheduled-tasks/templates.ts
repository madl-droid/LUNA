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

function renderStyles(): string {
  return `<style>
/* Scheduled Tasks — scoped styles */
.st-header { display:flex; align-items:center; justify-content:space-between; margin-bottom:16px }
.st-header-left { display:flex; align-items:center; gap:10px }
.st-counter { font-size:13px; color:var(--on-surface-dim) }
.st-btn-new { font-size:13px; padding:7px 16px; border-radius:0.5rem }

.st-form-wrap { display:none; margin-bottom:16px }
.st-form-body { padding:20px }

.st-row-name { display:flex; align-items:flex-start; gap:16px; margin-bottom:16px }
.st-row-name-field { flex:1 }
.st-row-toggle { display:flex; align-items:center; gap:8px; padding-top:20px }
.st-label { font-size:12px; font-weight:600; text-transform:uppercase; color:var(--on-surface-dim); display:block; margin-bottom:4px }
.st-toggle-label { font-size:12px; font-weight:500; color:var(--on-surface-variant) }

.st-input { width:100%; padding:9px 12px; border:1px solid var(--outline-variant); border-radius:0.5rem; font-size:14px }
.st-textarea { width:100%; padding:9px 12px; border:1px solid var(--outline-variant); border-radius:0.5rem; font-size:14px; resize:vertical; font-family:inherit }

.st-field-group { margin-bottom:16px }

.st-grid { display:grid; grid-template-columns:1fr 1fr 1fr; gap:16px; margin-bottom:16px }
.st-section { background:var(--surface-container-low); border-radius:0.5rem; padding:14px }
.st-section-title { font-size:11px; font-weight:600; text-transform:uppercase; color:var(--on-surface-dim); margin-bottom:8px }
.st-select { width:100%; padding:8px 10px; border:1px solid var(--outline-variant); border-radius:6px; font-size:13px; background:var(--surface-container-lowest); margin-bottom:8px }
.st-select-no-mb { width:100%; padding:8px 10px; border:1px solid var(--outline-variant); border-radius:6px; font-size:13px; background:var(--surface-container-lowest) }
.st-input-sm { width:100%; padding:8px 10px; border:1px solid var(--outline-variant); border-radius:6px; font-size:13px; font-family:monospace; background:var(--surface-container-lowest) }
.st-help { font-size:10px; color:var(--on-surface-dim); margin-top:4px }

.st-actions-list { margin-bottom:6px }
.st-btn-add-action { font-size:11px; padding:4px 10px; border-radius:6px }

.st-form-footer { display:flex; gap:8px; justify-content:flex-end; padding-top:12px; border-top:1px solid var(--outline-variant) }
.st-btn-form { font-size:13px; padding:7px 16px; border-radius:0.5rem }

.st-task-list { display:flex; flex-direction:column; gap:var(--space-md) }

.st-task-card { background:var(--surface-container-lowest); border:1px solid var(--outline-variant); border-radius:0.5rem; padding:var(--section-gap); transition:box-shadow 0.2s ease }
.st-task-card:hover { box-shadow:var(--shadow-float) }
.st-task-card-disabled { opacity:0.55 }
.st-card-row { display:flex; align-items:flex-start; justify-content:space-between; gap:10px }
.st-card-body { flex:1; min-width:0 }
.st-card-title-row { display:flex; align-items:center; gap:8px; flex-wrap:wrap; margin-bottom:4px }
.st-card-name { font-weight:600; font-size:14px }
.st-card-meta { font-size:12px; color:var(--on-surface-dim); margin-bottom:6px; display:flex; align-items:center; gap:6px; flex-wrap:wrap }
.st-card-prompt { font-size:12px; color:var(--on-surface-variant); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; max-width:450px }
.st-card-lastrun { font-size:11px; color:var(--on-surface-dim); margin-top:4px }
.st-card-actions { display:flex; gap:4px; flex-shrink:0 }
.st-btn-card { font-size:12px; padding:5px 10px; border-radius:6px }
.st-btn-delete { font-size:12px; padding:5px 10px; border-radius:6px; color:var(--error) }

.st-recipient-inline { color:var(--on-surface-variant) }

.st-badge-error { background:rgba(230,33,17,0.08); color:var(--error) }
.st-badge-event { background:rgba(255,149,0,0.12); color:var(--warning) }
.st-badge-manual { background:rgba(88,86,214,0.1); color:#5856d6 }
.st-badge-cron { background:rgba(0,122,255,0.1); color:var(--info) }
.st-badge-cron code { font-size:11px }
.st-badge-actions { background:rgba(88,86,214,0.1); color:#5856d6; font-size:10px }

.st-empty { padding:40px 20px; text-align:center }
.st-empty-icon { font-size:32px; margin-bottom:8px }
.st-empty-text { color:var(--on-surface-dim); font-size:14px }

.st-modal-overlay { display:none; position:fixed; inset:0; background:rgba(0,0,0,0.5); z-index:1000; align-items:center; justify-content:center }
.st-modal-box { background:var(--surface-container-lowest); border-radius:0.75rem; padding:20px; max-width:600px; width:90%; max-height:80vh; overflow-y:auto; box-shadow:var(--shadow-float) }
.st-modal-header { display:flex; justify-content:space-between; align-items:center; margin-bottom:12px }
.st-modal-title { font-weight:600; font-size:15px }
.st-modal-close { background:none; border:none; font-size:20px; cursor:pointer; color:var(--on-surface-dim); padding:4px 8px }
.st-modal-content { white-space:pre-wrap; font-size:13px; background:var(--surface-container-low); padding:14px; border-radius:0.5rem; max-height:60vh; overflow-y:auto }

/* Action row (injected via JS) */
.st-action-row { display:flex; gap:6px; align-items:flex-start; margin-bottom:6px; padding:8px; background:var(--surface-container-lowest); border-radius:6px; border:1px solid var(--outline-variant) }
.st-action-body { flex:1 }
.st-action-select { padding:5px 8px; border:1px solid var(--outline-variant); border-radius:5px; font-size:11px; margin-bottom:4px; width:100%; background:var(--surface-container-lowest) }
.st-action-field { width:100%; padding:5px 8px; border:1px solid var(--outline-variant); border-radius:5px; font-size:11px; background:var(--surface-container-lowest) }
.st-action-field-mb { width:100%; padding:5px 8px; border:1px solid var(--outline-variant); border-radius:5px; font-size:11px; margin-bottom:4px }
.st-action-remove { background:none; border:none; color:var(--error); cursor:pointer; font-size:16px; padding:2px 4px; line-height:1 }
</style>`
}

function statusBadge(task: ScheduledTask, lang: Lang): string {
  if (!task.last_status) return `<span class="panel-badge badge-soon">${l('never', lang)}</span>`
  if (task.last_status === 'success') return `<span class="panel-badge badge-active">${l('success', lang)}</span>`
  return `<span class="panel-badge st-badge-error">${l('error', lang)}</span>`
}

function formatDate(iso: string | null, lang: Lang): string {
  if (!iso) return '—'
  const d = new Date(iso)
  return d.toLocaleString(lang === 'es' ? 'es-CL' : 'en-US', { dateStyle: 'short', timeStyle: 'short' })
}

function triggerBadge(task: ScheduledTask, lang: Lang): string {
  if (task.trigger_type === 'event') return `<span class="panel-badge st-badge-event">&#9889; ${esc(task.trigger_event ?? '')}</span>`
  if (task.trigger_type === 'manual') return `<span class="panel-badge st-badge-manual">${l('triggerManual', lang)}</span>`
  return `<span class="panel-badge st-badge-cron"><code>${esc(task.cron)}</code></span>`
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
    ? `<div class="st-empty">
        <div class="st-empty-icon">&#128197;</div>
        <div class="st-empty-text">${l('noTasks', lang)}</div>
      </div>`
    : tasks.map(t => `
      <div class="st-task-card${!t.enabled ? ' st-task-card-disabled' : ''}" data-task-id="${esc(t.id)}">
        <div class="st-card-row">
          <div class="st-card-body">
            <div class="st-card-title-row">
              <span class="st-card-name">${esc(t.name)}</span>
              ${statusBadge(t, lang)}
              ${!t.enabled ? '<span class="panel-badge badge-soon">OFF</span>' : ''}
            </div>
            <div class="st-card-meta">
              ${triggerBadge(t, lang)}
              ${t.recipient?.type === 'group' ? `<span class="st-recipient-inline">&#128101; ${esc(t.recipient.group ?? '')}</span>` : ''}
              ${t.recipient?.type === 'user' ? `<span class="st-recipient-inline">&#128100; ${esc(t.recipient.userId ?? '')}</span>` : ''}
              ${t.actions.length > 0 ? `<span class="panel-badge st-badge-actions">${t.actions.length} action${t.actions.length > 1 ? 's' : ''}</span>` : ''}
            </div>
            <div class="st-card-prompt" title="${esc(t.prompt)}">${esc(t.prompt)}</div>
            <div class="st-card-lastrun">${l('lastRun', lang)}: ${formatDate(t.last_run_at, lang)}</div>
          </div>
          <div class="st-card-actions">
            <button type="button" class="wa-btn st-btn-card" onclick="stRunTask('${esc(t.id)}')" title="${l('run', lang)}">&#9654;</button>
            <button type="button" class="wa-btn st-btn-card" onclick="stEditTask('${esc(t.id)}')">${l('edit', lang)}</button>
            <button type="button" class="wa-btn st-btn-delete" onclick="stDeleteTask('${esc(t.id)}')">${l('delete', lang)}</button>
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
    ${renderStyles()}

    <!-- Header with counter and new task button -->
    <div class="st-header">
      <div class="st-header-left">
        <span class="st-counter">${tasks.length} ${l('taskCount', lang)} · ${activeTasks} ${l('activeCount', lang)}</span>
      </div>
      <button type="button" class="wa-btn wa-btn-connect st-btn-new" onclick="stShowForm()">+ ${l('newTask', lang)}</button>
    </div>

    <!-- Create/Edit form -->
    <div id="st-form" class="st-form-wrap">
      <div class="panel">
        <div class="panel-body st-form-body">
          <input type="hidden" id="st-edit-id" value="">

          <!-- Row 1: Name + Enabled toggle -->
          <div class="st-row-name">
            <div class="st-row-name-field">
              <label class="st-label">${l('name', lang)}</label>
              <input type="text" id="st-name" placeholder="${l('namePlaceholder', lang)}" class="st-input">
            </div>
            <div class="st-row-toggle">
              <label class="toggle"><input type="checkbox" id="st-enabled" checked><span class="toggle-slider"></span></label>
              <span class="st-toggle-label">${l('enabled', lang)}</span>
            </div>
          </div>

          <!-- Prompt -->
          <div class="st-field-group">
            <label class="st-label">${l('prompt', lang)}</label>
            <textarea id="st-prompt" rows="3" placeholder="${l('promptPlaceholder', lang)}" class="st-textarea"></textarea>
          </div>

          <!-- 3-column grid: Trigger | Recipient | Actions -->
          <div class="st-grid">

            <!-- Trigger -->
            <div class="st-section">
              <div class="st-section-title">${l('sectionTrigger', lang)}</div>
              <select id="st-trigger-type" onchange="stTriggerChanged()" class="st-select">
                <option value="cron">${l('triggerCron', lang)}</option>
                <option value="event">${l('triggerEvent', lang)}</option>
                <option value="manual">${l('triggerManual', lang)}</option>
              </select>
              <div id="st-cron-row">
                <input type="text" id="st-cron" placeholder="*/30 * * * *" class="st-input-sm">
                <div class="st-help">${l('cronHelp', lang)}</div>
              </div>
              <div id="st-event-row" style="display:none">
                <select id="st-trigger-event" class="st-select-no-mb">
                  ${eventOptionsHtml}
                </select>
                <div class="st-help">${l('eventHelp', lang)}</div>
              </div>
            </div>

            <!-- Recipient -->
            <div class="st-section">
              <div class="st-section-title">${l('sectionRecipient', lang)}</div>
              <select id="st-recipient-type" onchange="stRecipientChanged()" class="st-select">
                <option value="none">${l('recipientNone', lang)}</option>
                <option value="group">${l('recipientGroup', lang)}</option>
                ${hasUsersInGroups ? `<option value="user">${l('recipientUser', lang)}</option>` : ''}
              </select>
              <div id="st-group-row" style="display:none">
                <select id="st-recipient-group" onchange="stGroupChanged()" class="st-select">
                  ${groupOptionsHtml}
                </select>
              </div>
              <div id="st-user-row" style="display:none">
                <select id="st-recipient-user" class="st-select-no-mb">
                </select>
              </div>
            </div>

            <!-- Actions -->
            <div class="st-section">
              <div class="st-section-title">${l('sectionActions', lang)}</div>
              <div id="st-actions-list" class="st-actions-list"></div>
              <button type="button" class="wa-btn st-btn-add-action" onclick="stAddAction()">+ ${l('actionAdd', lang)}</button>
              <div class="st-help">${l('actionPlaceholder', lang)}</div>
            </div>
          </div>

          <!-- Form buttons -->
          <div class="st-form-footer">
            <button type="button" class="wa-btn st-btn-form" onclick="stHideForm()">${l('cancel', lang)}</button>
            <button type="button" class="wa-btn wa-btn-connect st-btn-form" onclick="stSaveTask()">${l('save', lang)}</button>
          </div>
        </div>
      </div>
    </div>

    <!-- Task list -->
    <div id="st-task-list" class="st-task-list">${taskCards}</div>

    <!-- Result modal -->
    <div id="st-modal" class="st-modal-overlay">
      <div class="st-modal-box">
        <div class="st-modal-header">
          <span class="st-modal-title">${l('result', lang)}</span>
          <button type="button" onclick="stCloseModal()" class="st-modal-close">&times;</button>
        </div>
        <pre id="st-modal-content" class="st-modal-content"></pre>
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
    div.className = 'st-action-row'

    const type = action ? action.type : 'tool'
    const toolOpts = TOOLS.map(t => '<option value="' + t.name + '"' + (action && action.toolName === t.name ? ' selected' : '') + '>' + (t.displayName || t.name) + '</option>').join('')

    div.innerHTML = '<div class="st-action-body">' +
      '<select data-field="type" class="st-action-select" onchange="stActionTypeChanged(' + idx + ')">' +
        '<option value="tool"' + (type === 'tool' ? ' selected' : '') + '>' + L.actionTool + '</option>' +
        '<option value="message"' + (type === 'message' ? ' selected' : '') + '>' + L.actionMessage + '</option>' +
        '<option value="hook"' + (type === 'hook' ? ' selected' : '') + '>' + L.actionHook + '</option>' +
      '</select>' +
      '<div data-panel="tool" style="' + (type === 'tool' ? '' : 'display:none') + '">' +
        '<select data-field="toolName" class="st-action-field">' + toolOpts + '</select>' +
      '</div>' +
      '<div data-panel="message" style="' + (type === 'message' ? '' : 'display:none') + '">' +
        '<input data-field="messageText" type="text" class="st-action-field-mb" placeholder="' + L.actionMsgText + '" value="' + (action && action.messageText ? action.messageText.replace(/"/g, '&quot;') : '') + '">' +
        '<select data-field="messageChannel" class="st-action-field">' +
          '<option value="whatsapp">WhatsApp</option>' +
          '<option value="email"' + (action && action.messageChannel === 'email' ? ' selected' : '') + '>Email</option>' +
          '<option value="google-chat"' + (action && action.messageChannel === 'google-chat' ? ' selected' : '') + '>Google Chat</option>' +
        '</select>' +
      '</div>' +
      '<div data-panel="hook" style="' + (type === 'hook' ? '' : 'display:none') + '">' +
        '<input data-field="hookName" type="text" class="st-action-field" placeholder="hook:name" value="' + (action && action.hookName ? action.hookName : '') + '">' +
      '</div>' +
    '</div>' +
    '<button type="button" onclick="stRemoveAction(' + idx + ')" class="st-action-remove">&times;</button>'

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
