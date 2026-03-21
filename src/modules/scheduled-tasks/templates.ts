// scheduled-tasks/templates.ts — SSR HTML for oficina section

import type { ScheduledTask } from './types.js'

type Lang = 'es' | 'en'

const labels: Record<Lang, Record<string, string>> = {
  es: {
    title: 'Tareas Programadas',
    desc: 'Crea tareas que el agente ejecuta automaticamente segun un horario definido. Usa la info, herramientas y conocimiento disponibles.',
    newTask: 'Nueva tarea',
    name: 'Nombre',
    prompt: 'Instruccion',
    cron: 'Horario (cron)',
    cronHelp: 'Ej: */30 * * * * (cada 30 min), 0 9 * * 1-5 (L-V 9am), 0 0 * * * (medianoche)',
    enabled: 'Activa',
    save: 'Guardar',
    cancel: 'Cancelar',
    run: 'Ejecutar ahora',
    edit: 'Editar',
    delete: 'Eliminar',
    deleteConfirm: 'Eliminar esta tarea?',
    noTasks: 'No hay tareas programadas. Crea una para que el agente la ejecute automaticamente.',
    lastRun: 'Ultima ejecucion',
    status: 'Estado',
    never: 'Nunca',
    success: 'OK',
    error: 'Error',
    running: 'Ejecutando...',
    result: 'Resultado',
    close: 'Cerrar',
  },
  en: {
    title: 'Scheduled Tasks',
    desc: 'Create tasks the agent runs automatically on a defined schedule. Uses available info, tools, and knowledge.',
    newTask: 'New task',
    name: 'Name',
    prompt: 'Instruction',
    cron: 'Schedule (cron)',
    cronHelp: 'E.g.: */30 * * * * (every 30 min), 0 9 * * 1-5 (Mon-Fri 9am), 0 0 * * * (midnight)',
    enabled: 'Active',
    save: 'Save',
    cancel: 'Cancel',
    run: 'Run now',
    edit: 'Edit',
    delete: 'Delete',
    deleteConfirm: 'Delete this task?',
    noTasks: 'No scheduled tasks. Create one for the agent to execute automatically.',
    lastRun: 'Last run',
    status: 'Status',
    never: 'Never',
    success: 'OK',
    error: 'Error',
    running: 'Running...',
    result: 'Result',
    close: 'Close',
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

export function renderTasksSection(tasks: ScheduledTask[], lang: Lang): string {
  const taskRows = tasks.length === 0
    ? `<div style="padding:24px;text-align:center;color:var(--text-tertiary);font-size:14px">${l('noTasks', lang)}</div>`
    : tasks.map(t => `
      <div class="task-row" data-task-id="${esc(t.id)}" style="display:flex;align-items:center;justify-content:space-between;padding:12px 16px;border-bottom:1px solid var(--border-light)">
        <div style="flex:1;min-width:0">
          <div style="display:flex;align-items:center;gap:8px">
            <span style="font-weight:600;font-size:14px">${esc(t.name)}</span>
            ${statusBadge(t, lang)}
            ${!t.enabled ? '<span class="panel-badge badge-soon">OFF</span>' : ''}
          </div>
          <div style="font-size:12px;color:var(--text-tertiary);margin-top:2px">
            <code style="background:var(--bg-secondary);padding:1px 6px;border-radius:4px;font-size:11px">${esc(t.cron)}</code>
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

        <!-- Create/Edit form (hidden by default) -->
        <div id="st-form" style="display:none;padding:12px;background:var(--bg-secondary);border-radius:8px;margin:8px 0">
          <input type="hidden" id="st-edit-id" value="">
          <div class="field" style="margin-bottom:10px">
            <label style="font-size:13px;font-weight:500">${l('name', lang)}</label>
            <input type="text" id="st-name" style="width:100%;padding:8px;border:1px solid var(--border);border-radius:6px;font-size:14px" placeholder="${l('name', lang)}">
          </div>
          <div class="field" style="margin-bottom:10px">
            <label style="font-size:13px;font-weight:500">${l('prompt', lang)}</label>
            <textarea id="st-prompt" rows="3" style="width:100%;padding:8px;border:1px solid var(--border);border-radius:6px;font-size:14px;resize:vertical" placeholder="${l('prompt', lang)}"></textarea>
          </div>
          <div class="field" style="margin-bottom:10px">
            <label style="font-size:13px;font-weight:500">${l('cron', lang)}</label>
            <input type="text" id="st-cron" style="width:100%;padding:8px;border:1px solid var(--border);border-radius:6px;font-size:14px;font-family:monospace" placeholder="*/30 * * * *">
            <span style="font-size:11px;color:var(--text-tertiary)">${l('cronHelp', lang)}</span>
          </div>
          <div class="field" style="margin-bottom:10px;display:flex;align-items:center;gap:8px">
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
    <div id="st-modal" style="display:none;position:fixed;inset:0;background:rgba(0,0,0,0.5);z-index:1000;display:none;align-items:center;justify-content:center">
      <div style="background:var(--bg-primary);border-radius:12px;padding:20px;max-width:600px;width:90%;max-height:80vh;overflow-y:auto">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
          <span style="font-weight:600">${l('result', lang)}</span>
          <button type="button" onclick="stCloseModal()" style="background:none;border:none;font-size:18px;cursor:pointer">&times;</button>
        </div>
        <pre id="st-modal-content" style="white-space:pre-wrap;font-size:13px;background:var(--bg-secondary);padding:12px;border-radius:8px"></pre>
      </div>
    </div>

    ${renderScript(lang)}`
}

function renderScript(lang: Lang): string {
  return `<script>
(function() {
  const API = '/oficina/api/scheduled-tasks'
  const L = ${JSON.stringify(labels[lang])}

  window.stShowForm = function() {
    document.getElementById('st-form').style.display = 'block'
    document.getElementById('st-edit-id').value = ''
    document.getElementById('st-name').value = ''
    document.getElementById('st-prompt').value = ''
    document.getElementById('st-cron').value = ''
    document.getElementById('st-enabled').checked = true
  }

  window.stHideForm = function() {
    document.getElementById('st-form').style.display = 'none'
  }

  window.stEditTask = async function(id) {
    const res = await fetch(API + '/list')
    const data = await res.json()
    const task = data.tasks.find(t => t.id === id)
    if (!task) return
    document.getElementById('st-form').style.display = 'block'
    document.getElementById('st-edit-id').value = task.id
    document.getElementById('st-name').value = task.name
    document.getElementById('st-prompt').value = task.prompt
    document.getElementById('st-cron').value = task.cron
    document.getElementById('st-enabled').checked = task.enabled
  }

  window.stSaveTask = async function() {
    const editId = document.getElementById('st-edit-id').value
    const body = {
      name: document.getElementById('st-name').value,
      prompt: document.getElementById('st-prompt').value,
      cron: document.getElementById('st-cron').value,
      enabled: document.getElementById('st-enabled').checked,
    }
    if (!body.name || !body.prompt || !body.cron) return alert('All fields required')

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
    await fetch(API + '/delete', { method: 'DELETE', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ id }) })
    location.reload()
  }

  window.stRunTask = async function(id) {
    const btn = event.target
    btn.disabled = true
    btn.textContent = '...'
    try {
      const res = await fetch(API + '/trigger', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ id }) })
      const data = await res.json()
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
