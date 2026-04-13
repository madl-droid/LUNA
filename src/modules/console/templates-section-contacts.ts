import { esc } from './templates-fields.js'
import type { SectionData } from './templates-section-data.js'

const GEAR_SVG = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>`

const CH_SVG: Record<string, string> = {
  whatsapp: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/></svg>',
  gmail: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="20" height="16" x="2" y="4" rx="2"/><path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"/></svg>',
  'google-chat': '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m3 21 1.9-5.7a8.5 8.5 0 1 1 3.8 3.8z"/></svg>',
  'twilio-voice': '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z"/></svg>',
}

const CH_PLACEHOLDER: Record<string, string> = {
  whatsapp: '+521234567890', gmail: 'user@example.com', 'google-chat': 'spaces/XXX/members/YYY', 'twilio-voice': '+15550123',
}

// SVG icons for action buttons
const SVG_PLUS = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14"/><path d="M5 12h14"/></svg>'
const SVG_EDIT = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>'
const SVG_DEACTIVATE = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 12H5"/><path d="M12 19l-7-7 7-7"/></svg>'
const SVG_DELETE = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>'
const SVG_EYE_SMALL = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>'

export function renderUsersSection(data: SectionData): string {
  const lang = data.lang
  const ud = data.usersData
  if (!ud) return `<div class="panel"><div class="panel-body">${lang === 'es' ? 'Módulo de usuarios no disponible.' : 'Users module not available.'}</div></div>`

  const { configs, usersByType, counts, channels } = ud

  // Test mode warning
  const testMode = data.config.ENGINE_TEST_MODE === 'true'
  const adminCount = counts['admin'] ?? 0
  let warning = ''
  if (testMode && adminCount === 0) {
    warning = `<div class="flash flash-error">${lang === 'es'
      ? 'Modo de pruebas activo pero no hay admins configurados — nadie recibirá respuesta.'
      : 'Test mode active but no admins configured — nobody will receive responses.'}</div>`
  }

  const subpage = data.contactsSubpage || configs[0]?.listType || 'admin'
  const isConfigPage = subpage === 'config'

  // Channel filter options
  const svgSearch = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>'

  let html = `<div class="users-section">${warning}`

  if (!isConfigPage) {
    // Channel multi-select checkboxes
    const chCheckboxes = channels.map(ch => {
      const lbl = typeof ch.label === 'string' ? ch.label : (ch.label[lang] || ch.label['es'] || ch.id)
      return `<label class="uf-ch-option"><input type="checkbox" value="${esc(ch.id)}" checked onchange="userFilterApply()"> ${esc(lbl)}</label>`
    }).join('')

    // Filter bar
    html += `<div class="filter-bar">
      <div class="filter-group">
        <span class="filter-label">${lang === 'es' ? 'Nombre' : 'Name'}</span>
        <select class="ch-filter-select js-custom-select" id="uf-sort" onchange="userFilterApply()">
          <option value="asc">A → Z</option>
          <option value="desc">Z → A</option>
        </select>
      </div>
      <div class="filter-group">
        <span class="filter-label">${lang === 'es' ? 'Canal' : 'Channel'}</span>
        <div class="custom-select" id="uf-channel-wrap">
          <button type="button" class="custom-select-btn" onclick="event.stopPropagation();this.parentElement.classList.toggle('open')">${lang === 'es' ? 'Todos' : 'All'} <svg class="custom-select-arrow" width="10" height="6" viewBox="0 0 10 6" fill="none"><path d="M1 1L5 5L9 1" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg></button>
          <div class="custom-select-panel" style="padding:8px 12px;min-width:160px" onclick="event.stopPropagation()">
            ${chCheckboxes}
          </div>
        </div>
      </div>
      <div class="filter-group">
        <span class="filter-label">${lang === 'es' ? 'Fuente' : 'Source'}</span>
        <select class="ch-filter-select js-custom-select" id="uf-source" onchange="userFilterApply()">
          <option value="all">${lang === 'es' ? 'Todos' : 'All'}</option>
          <option value="manual">Manual</option>
          <option value="inbound">Inbound</option>
          <option value="outbound">Outbound</option>
          <option value="sync">Sync</option>
        </select>
      </div>
      <div class="filter-group">
        <span class="filter-label">${lang === 'es' ? 'Ultima interaccion' : 'Last interaction'}</span>
        <select class="ch-filter-select js-custom-select" id="uf-activity" onchange="userFilterApply()">
          <option value="all">${lang === 'es' ? 'Todos' : 'All'}</option>
          <option value="1h">1h</option><option value="12h">12h</option><option value="24h">24h</option>
          <option value="7d">7d</option><option value="30d">30d</option><option value="90d">90d</option>
        </select>
      </div>
      <div class="user-filter-search">
        ${svgSearch}
        <input type="text" id="uf-search" placeholder="${lang === 'es' ? 'Buscar contacto' : 'Search contact'}" oninput="userFilterApply()">
      </div>
    </div>`
  }

  const canEdit = (lt: string) => lt !== 'lead'
  const canDelete = (lt: string) => lt !== 'admin' && lt !== 'lead'

  // ── Show only the active subpage ──
  if (isConfigPage) {
    // Config page: permissions + unregistered behavior
    // (rendered below after the list panels block)
  } else {
    const cfg = configs.find(c => c.listType === subpage)
    if (!cfg) {
      html += `<div class="panel"><div class="panel-body">${lang === 'es' ? 'Lista no encontrada.' : 'List not found.'}</div></div>`
      return html + '</div>'
    }
    const users = usersByType[cfg.listType] ?? []
    const lt = cfg.listType

    // Single panel for this list type
    html += `<div class="panel"><div class="panel-body">`

    // (selection bar moved to footer row with add button)

    if (users.length > 0) {
      const isCoworker = lt === 'coworker'
      const isLead = lt === 'lead'

      if (isLead) {
        html += `<style>
.lead-detail-row td { padding: 0 !important; border-top: none !important; }
.lead-detail-container { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; padding: 16px 20px; background: var(--surface-container-lowest); border-top: 1px solid var(--outline-variant); }
.lead-detail-col { min-width: 0; }
.lead-detail-title { font-size: 12px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px; color: var(--on-surface-variant); margin-bottom: 8px; }
.lead-detail-content { font-size: 13px; }
.ts-score-badge { display: inline-block; padding: 2px 8px; border-radius: var(--radius-pill); font-size: 11px; font-weight: 600; background: var(--surface-container-high); }
.ts-time-ago { font-size: 12px; color: var(--on-surface-variant); }
.ts-commit-item { padding: 6px 0; border-bottom: 1px solid var(--outline-variant); }
.ts-commit-item:last-child { border-bottom: none; }
.ts-criteria-item { display: flex; justify-content: space-between; padding: 4px 0; border-bottom: 1px solid var(--outline-variant); }
.ts-criteria-item:last-child { border-bottom: none; }
.ts-criteria-key { font-weight: 500; text-transform: capitalize; }
.ts-criteria-val { color: var(--on-surface-variant); }
</style>`
      }

      html += `<div class="users-table-scroll"><table class="users-table" id="tbl-${esc(lt)}"><thead><tr class="users-table-head">
        <th><input type="checkbox" class="user-cb" id="cb-all-${esc(lt)}" title="${lang === 'es' ? 'Seleccionar todos' : 'Select all'}" onclick="userToggleAll('${esc(lt)}')"></th>
        <th>ID</th>
        <th>${lang === 'es' ? 'Nombre' : 'Name'}</th>
        ${isCoworker ? `<th>${lang === 'es' ? 'Rol' : 'Role'}</th>` : ''}
        <th>${lang === 'es' ? 'Datos de contacto' : 'Contact info'}</th>
        <th>${lang === 'es' ? 'Fuente' : 'Source'}</th>
        <th>${lang === 'es' ? 'Estado' : 'Status'}</th>
        ${isLead ? `<th>${lang === 'es' ? 'Campaña' : 'Campaign'}</th>` : ''}
        ${isLead ? `<th>${lang === 'es' ? 'Interacciones' : 'Interactions'}</th>` : ''}
        ${isLead ? `<th>${lang === 'es' ? 'Calificación' : 'Score'}</th>` : ''}
        ${isLead ? `<th>${lang === 'es' ? 'Compromisos' : 'Commitments'}</th>` : ''}
        ${isLead ? `<th>${lang === 'es' ? 'Último recibido' : 'Last received'}</th>` : ''}
        ${isLead ? `<th>${lang === 'es' ? 'Último enviado' : 'Last sent'}</th>` : ''}
        ${isLead ? `<th></th>` : ''}
      </tr></thead><tbody>`

      for (const user of users) {
        const contactBadges = user.contacts.map(c =>
          `<span class="user-contact-badge">${CH_SVG[c.channel] || ''} ${esc(c.senderId.length > 22 ? c.senderId.slice(0, 20) + '…' : c.senderId)}</span>`
        ).join(' ')

        // Status: inactive → red label; active → last interaction time (placeholder for now)
        const statusHtml = user.isActive
          ? `<span class="user-status-active">—</span>`
          : `<span class="user-status-inactive">${lang === 'es' ? 'Desactivado' : 'Deactivated'}</span>
             <form method="POST" action="/console/contacts/reactivate" style="display:inline;margin-left:4px">
               <input type="hidden" name="_section" value="users"><input type="hidden" name="_lang" value="${lang}">
               <input type="hidden" name="userId" value="${esc(user.id)}">
               <button type="submit" class="act-btn act-btn-add" style="font-size:10px;padding:3px 8px">${lang === 'es' ? 'Reactivar' : 'Reactivate'}</button>
             </form>`

        // Data attributes for edit modal + filtering
        const contactsJson = JSON.stringify(Object.fromEntries(user.contacts.map(c => [c.channel, c.senderId])))
        const channelList = user.contacts.map(c => c.channel).join(',')
        const senderIds = user.contacts.map(c => c.senderId).join(' ')
        const userRole = (user.metadata as Record<string, unknown>)?.role as string ?? ''

        // Lead-specific metadata
        const meta = (user.metadata ?? {}) as Record<string, unknown>
        const campaign = (meta.campaign as string) ?? (meta.source_campaign as string) ?? ''
        const interactions = (meta.messageCount as number) ?? (meta.interactions as number) ?? 0
        const qScore = (meta.qualificationScore as number) ?? 0
        const pendingCommits = (meta.pendingCommitments as number) ?? 0
        const lastInbound = (meta.lastInbound as string) ?? ''
        const lastOutbound = (meta.lastOutbound as string) ?? ''

        html += `<tr data-user-id="${esc(user.id)}" data-user-name="${esc(user.displayName || '')}" data-user-active="${user.isActive}" data-contacts="${esc(contactsJson)}" data-channels="${esc(channelList)}" data-source="${esc(user.source)}" data-role="${esc(userRole)}" data-search="${esc((user.displayName || '') + ' ' + senderIds)}">`

        const isSuperAdmin = user.source === 'setup_wizard'
        const superBadge = isSuperAdmin ? ` <span class="panel-badge badge-active" style="font-size:9px;padding:1px 6px">${lang === 'es' ? 'Super Admin' : 'Super Admin'}</span>` : ''
        html += `<td>${isSuperAdmin ? '<input type="checkbox" disabled title="Super admin">' : `<input type="checkbox" class="user-cb" data-list="${esc(lt)}" value="${esc(user.id)}" onclick="event.stopPropagation();userSelChanged('${esc(lt)}')">`}</td>
          <td><code>${esc(user.id)}</code></td>
          <td>${esc(user.displayName || '—')}${superBadge}</td>
          ${isCoworker ? `<td>${userRole ? `<span class="user-source-badge">${esc(userRole)}</span>` : '—'}</td>` : ''}
          <td>${contactBadges}</td>
          <td><span class="user-source-badge">${esc(user.source)}</span></td>
          <td>${statusHtml}</td>
          ${isLead ? `<td>${campaign ? `<span class="user-source-badge">${esc(campaign)}</span>` : '—'}</td>` : ''}
          ${isLead ? `<td>${interactions}</td>` : ''}
          ${isLead ? `<td>${qScore > 0 ? `<span class="ts-score-badge" style="--score:${qScore}">${qScore}</span>` : '—'}</td>` : ''}
          ${isLead ? `<td>${pendingCommits > 0 ? pendingCommits : '—'}</td>` : ''}
          ${isLead ? `<td>${lastInbound ? `<span class="ts-time-ago" data-ts="${esc(lastInbound)}">${esc(lastInbound)}</span>` : '—'}</td>` : ''}
          ${isLead ? `<td>${lastOutbound ? `<span class="ts-time-ago" data-ts="${esc(lastOutbound)}">${esc(lastOutbound)}</span>` : '—'}</td>` : ''}
          ${isLead ? `<td><button type="button" class="act-btn act-btn-config act-btn--compact" onclick="toggleLeadDetail(this, '${esc(user.id)}')">${SVG_EYE_SMALL} ${lang === 'es' ? 'Ver' : 'View'}</button></td>` : ''}
        </tr>`

        if (isLead) {
          const detailColspan = isCoworker ? 8 : 7 + 7
          html += `<tr class="lead-detail-row" id="lead-detail-${esc(user.id)}" style="display:none">
  <td colspan="${detailColspan}">
    <div class="lead-detail-container">
      <div class="lead-detail-col">
        <div class="lead-detail-title">${lang === 'es' ? 'Compromisos pendientes' : 'Pending commitments'}</div>
        <div class="lead-detail-content" id="lead-commits-${esc(user.id)}">
          <span class="ts-config-muted">${lang === 'es' ? 'Cargando...' : 'Loading...'}</span>
        </div>
      </div>
      <div class="lead-detail-col">
        <div class="lead-detail-title">${lang === 'es' ? 'Criterios de calificación' : 'Qualification criteria'}</div>
        <div class="lead-detail-content" id="lead-criteria-${esc(user.id)}">
          <span class="ts-config-muted">${lang === 'es' ? 'Cargando...' : 'Loading...'}</span>
        </div>
      </div>
    </div>
  </td>
</tr>`
        }

        // (contacts editing moved to modal)
      }
      html += `</tbody></table></div>`
    } else {
      html += `<p class="panel-description">${lang === 'es' ? 'Sin usuarios en esta lista.' : 'No users in this list.'}</p>`
    }

    // Footer row: add (left) + selection actions (right) — same template for all list types
    html += `<div class="ch-card-footer">`
    if (canEdit(lt)) {
      html += `<button type="button" class="act-btn act-btn-add" onclick="openAddUserModal('${esc(lt)}', '${lang}')">${SVG_PLUS} ${lang === 'es' ? 'Agregar usuario' : 'Add user'}</button>`
    }
    html += `<span class="ch-footer-spacer"></span>
      <div class="user-selection-bar" id="sel-bar-${esc(lt)}">
        ${canEdit(lt) ? `<button type="button" class="act-btn act-btn-config" onclick="userEditSelected('${esc(lt)}')">${SVG_EDIT} ${lang === 'es' ? 'Editar' : 'Edit'}</button>` : ''}
        <button type="button" class="act-btn act-btn-remove" onclick="userDeactivateSelected('${esc(lt)}')">${SVG_DEACTIVATE} ${lang === 'es' ? 'Desactivar' : 'Deactivate'}</button>`
    if (canDelete(lt)) {
      html += `<button type="button" class="act-btn act-btn-remove" onclick="userDeleteSelected('${esc(lt)}')">${SVG_DELETE} ${lang === 'es' ? 'Eliminar' : 'Delete'}</button>`
    }
    html += `</div></div>`

    html += `</div></div>
    <div class="user-pager" id="pager-${esc(subpage)}">
      <span class="user-pager-info" id="pager-info-${esc(subpage)}"></span>
      <span class="ch-footer-spacer"></span>
      <div class="filter-group">
        <select class="ch-filter-select js-custom-select" id="uf-perpage" onchange="userFilterApply()">
          <option value="10" selected>10</option>
          <option value="50">50</option>
          <option value="100">100</option>
          <option value="500">500</option>
        </select>
      </div>
      <button type="button" class="act-btn act-btn-config" onclick="userPage('${esc(subpage)}',-1)">&lsaquo; ${lang === 'es' ? 'Anterior' : 'Previous'}</button>
      <button type="button" class="act-btn act-btn-config" onclick="userPage('${esc(subpage)}',1)">${lang === 'es' ? 'Siguiente' : 'Next'} &rsaquo;</button>
    </div>`
  } // end of list type subpage

  // Build list type options for move-list dropdown
  const listTypeOpts = configs.map(c =>
    `<option value="${esc(c.listType)}">${esc(c.displayName)}</option>`
  ).join('')

  // Validation messages per channel
  const chValidMsg: Record<string, Record<string, string>> = {
    whatsapp: { es: 'Formato: +codigo pais seguido de numero (ej: +521234567890)', en: 'Format: +country code followed by number (e.g. +521234567890)' },
    gmail: { es: 'Formato: email valido (ej: user@example.com)', en: 'Format: valid email (e.g. user@example.com)' },
    'twilio-voice': { es: 'Formato E.164: +codigo pais seguido de numero (ej: +15550123)', en: 'E.164 format: +country code followed by number (e.g. +15550123)' },
  }

  // User modal (wizard style — used for add/edit + import)
  html += `<div class="wizard-overlay" id="user-modal" style="display:none" onclick="if(event.target===this)closeUserModal()">
    <div class="wizard-modal" style="max-width:520px">
      <button class="wizard-close" onclick="closeUserModal()">&times;</button>
      <div class="wizard-steps">
        <div class="wizard-title" id="user-modal-title">${lang === 'es' ? 'Agregar contacto' : 'Add contact'}</div>
        <div class="wizard-error" id="user-modal-error" style="display:none"></div>

        <!-- Step 0: Mode selector (only for add, not edit) -->
        <div id="import-step-0">
          <div class="ts-import-modes-grid">
            <button type="button" class="import-mode-card" onclick="showImportStep('manual')">
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><line x1="19" y1="8" x2="19" y2="14"/><line x1="16" y1="11" x2="22" y2="11"/></svg>
              <span>${lang === 'es' ? 'Agregar manual' : 'Add manually'}</span>
            </button>
            <button type="button" class="import-mode-card" onclick="showImportStep('file')">
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>
              <span>${lang === 'es' ? 'Importar CSV' : 'Import CSV'}</span>
            </button>
            <button type="button" class="import-mode-card" onclick="showImportStep('drive')">
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="3" y1="9" x2="21" y2="9"/><line x1="3" y1="15" x2="21" y2="15"/><line x1="9" y1="3" x2="9" y2="21"/></svg>
              <span>Google Sheets</span>
            </button>
          </div>
        </div>

        <!-- Step 1a: Manual form -->
        <div id="import-step-manual" style="display:none">
          <form method="POST" id="user-modal-form" action="/console/contacts/update" onsubmit="return validateUserModal()">
            <input type="hidden" name="_section" value="users"><input type="hidden" name="_lang" value="${lang}">
            <input type="hidden" name="userId" id="user-modal-userId">
            <input type="hidden" name="listType" id="user-modal-listType">

            <label class="wizard-label">${lang === 'es' ? 'Nombre' : 'Name'}</label>
            <input type="text" class="wizard-input" name="displayName" id="user-modal-name" placeholder="${lang === 'es' ? 'Nombre del usuario' : 'User name'}">

            <label class="wizard-label" id="user-modal-list-label" style="display:none">${lang === 'es' ? 'Mover a lista' : 'Move to list'}</label>
            <select class="wizard-input" name="listType" id="user-modal-listSelect" style="display:none" onchange="userModalListChange(this)">
              ${listTypeOpts}
            </select>

            <div id="user-modal-role-wrap" style="display:none">
              <label class="wizard-label">${lang === 'es' ? 'Rol' : 'Role'}</label>
              <select class="wizard-input" name="userRole" id="user-modal-role">
                <option value="">${lang === 'es' ? '— Sin rol —' : '— No role —'}</option>
              </select>
            </div>`

  for (let i = 0; i < channels.length; i++) {
    const ch = channels[i]!
    const lbl = typeof ch.label === 'string' ? ch.label : (ch.label[lang] || ch.label['es'] || ch.id)
    const errMsg = chValidMsg[ch.id] ? esc(chValidMsg[ch.id]![lang] || chValidMsg[ch.id]!['es'] || '') : ''
    html += `<label class="wizard-label">${CH_SVG[ch.id] || ''} ${esc(lbl)}</label>
        <input type="hidden" name="contact_channel_${i}" value="${esc(ch.id)}">
        <input type="text" class="wizard-input" name="contact_senderid_${i}" id="user-modal-ch-${esc(ch.id)}" placeholder="${esc(CH_PLACEHOLDER[ch.id] || 'ID')}" data-channel="${esc(ch.id)}">
        <div class="wizard-field-error" id="user-modal-err-${esc(ch.id)}">${errMsg}</div>`
  }

  html += `<div class="wizard-actions">
            <button type="button" class="act-btn act-btn-config" id="manual-back-btn" onclick="showImportStep('select')" style="display:none">${lang === 'es' ? 'Atras' : 'Back'}</button>
            <button type="button" class="act-btn act-btn-config" onclick="closeUserModal()">${lang === 'es' ? 'Cancelar' : 'Cancel'}</button>
            <button type="submit" class="act-btn act-btn-cta" id="user-modal-submit">${lang === 'es' ? 'Guardar' : 'Save'}</button>
          </div>
        </form>
      </div>

      <!-- Step 1b: File import (CSV) -->
      <div id="import-step-file" style="display:none">
        <div class="import-dropzone" id="csv-dropzone" onclick="document.getElementById('csv-file-input').click()"
          ondragover="event.preventDefault();this.classList.add('dragover')" ondragleave="this.classList.remove('dragover')"
          ondrop="event.preventDefault();this.classList.remove('dragover');handleCsvFile(event.dataTransfer.files[0])">
          <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="var(--on-surface-dim)" stroke-width="1.5"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
          <div class="ts-import-dropzone-title">${lang === 'es' ? 'Arrastra un archivo CSV o haz clic para seleccionar' : 'Drag a CSV file or click to select'}</div>
          <div class="ts-import-hint">${lang === 'es' ? 'Columnas requeridas: sender_id, channel. Opcionales: display_name, [metadata]' : 'Required columns: sender_id, channel. Optional: display_name, [metadata]'}</div>
          <input type="file" id="csv-file-input" accept=".csv" style="display:none" onchange="handleCsvFile(this.files[0])">
        </div>
        <div id="csv-preview" style="display:none;margin-top:12px">
          <div class="ts-import-preview-label" id="csv-preview-label"></div>
          <div style="overflow-x:auto;max-height:200px"><table class="users-table" id="csv-preview-table"></table></div>
        </div>
        <div id="csv-result" class="ts-import-result"></div>
        <div class="wizard-actions">
          <button type="button" class="act-btn act-btn-config" onclick="showImportStep('select')">${lang === 'es' ? 'Atras' : 'Back'}</button>
          <button type="button" class="act-btn act-btn-cta" id="csv-import-btn" style="display:none" onclick="submitCsvImport()">${lang === 'es' ? 'Importar' : 'Import'}</button>
        </div>
      </div>

      <!-- Step 1c: Google Drive import -->
      <div id="import-step-drive" style="display:none">
        <label class="wizard-label">Google Sheets URL</label>
        <input type="text" class="wizard-input" id="drive-sheet-url" placeholder="https://docs.google.com/spreadsheets/d/...">
        <div class="ts-import-hint" style="margin-bottom:12px" id="drive-hint">${lang === 'es' ? 'Pega la URL de una Google Sheet. Debe estar compartida publicamente o con enlace.' : 'Paste a Google Sheet URL. Must be shared publicly or via link.'}</div>
        <button type="button" class="act-btn act-btn-config" onclick="previewDriveSheet()" id="drive-preview-btn">${lang === 'es' ? 'Previsualizar' : 'Preview'}</button>
        <div id="drive-preview" style="display:none;margin-top:12px">
          <div class="ts-import-preview-label" id="drive-preview-label"></div>
          <div style="overflow-x:auto;max-height:200px"><table class="users-table" id="drive-preview-table"></table></div>
        </div>
        <div id="drive-result" class="ts-import-result"></div>
        <div class="wizard-actions">
          <button type="button" class="act-btn act-btn-config" onclick="showImportStep('select')">${lang === 'es' ? 'Atras' : 'Back'}</button>
          <button type="button" class="act-btn act-btn-cta" id="drive-import-btn" style="display:none" onclick="submitDriveImport()">${lang === 'es' ? 'Importar' : 'Import'}</button>
        </div>
      </div>

    </div>
  </div>
</div>`

  // Embed coworker roles data for JS
  const coworkerCfg = configs.find(c => c.listType === 'coworker')
  const coworkerRoles: string[] = (coworkerCfg?.syncConfig as Record<string, unknown>)?.roles as string[] ?? []

  // Users JS
  html += `<script>(function(){
    var modal=document.getElementById('user-modal');
    var form=document.getElementById('user-modal-form');
    var errorBox=document.getElementById('user-modal-error');
    var coworkerRoles=${JSON.stringify(coworkerRoles)};
    var listLabel=document.getElementById('user-modal-list-label');
    var listSelect=document.getElementById('user-modal-listSelect');
    var lang=document.documentElement.lang||'es';

    // ── Validation patterns ──
    var patterns={whatsapp:/^\\+[0-9]{7,15}$/,'twilio-voice':/^\\+[0-9]{7,15}$/,gmail:/^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/};

    window.validateUserModal=function(){
      var valid=true;
      var errors=[];
      errorBox.style.display='none';
      form.querySelectorAll('.wizard-input').forEach(function(inp){inp.classList.remove('invalid')});
      form.querySelectorAll('.wizard-field-error').forEach(function(e){e.style.display='none'});

      // Name required
      var nameInp=document.getElementById('user-modal-name');
      if(!nameInp.value.trim()){
        nameInp.classList.add('invalid');
        errors.push(lang==='es'?'El nombre es obligatorio.':'Name is required.');
        valid=false;
      }

      // At least 1 contact on create
      var isCreate=form.action.indexOf('/users/add')!==-1;
      var hasContact=false;

      form.querySelectorAll('[data-channel]').forEach(function(inp){
        var ch=inp.getAttribute('data-channel');
        var val=inp.value.trim();
        if(!val)return;
        hasContact=true;
        var pat=patterns[ch];
        if(pat&&!pat.test(val)){
          inp.classList.add('invalid');
          var errEl=document.getElementById('user-modal-err-'+ch);
          if(errEl)errEl.style.display='block';
          valid=false;
        }
      });

      if(isCreate&&!hasContact){
        errors.push(lang==='es'?'Agrega al menos un dato de contacto.':'Add at least one contact.');
        valid=false;
      }

      if(!valid){
        errorBox.textContent=errors.length>0?errors.join(' '):(lang==='es'?'Corrige los campos marcados en rojo.':'Fix the fields marked in red.');
        errorBox.style.display='block';
      }
      return valid;
    };

    // ── Clear errors on input ──
    form.addEventListener('input',function(e){
      var inp=e.target;
      if(inp.classList.contains('invalid')){
        inp.classList.remove('invalid');
        var ch=inp.getAttribute('data-channel');
        if(ch){var err=document.getElementById('user-modal-err-'+ch);if(err)err.style.display='none'}
      }
    });

    // ── Import step navigation ──
    var _currentListType='';
    var _csvData='';
    var _isEditMode=false;

    window.showImportStep=function(step){
      document.getElementById('import-step-0').style.display='none';
      document.getElementById('import-step-manual').style.display='none';
      document.getElementById('import-step-file').style.display='none';
      document.getElementById('import-step-drive').style.display='none';
      errorBox.style.display='none';
      if(step==='select'){
        document.getElementById('import-step-0').style.display='block';
        document.getElementById('user-modal-title').textContent=lang==='es'?'Agregar contacto':'Add contact';
      }else if(step==='manual'){
        document.getElementById('import-step-manual').style.display='block';
        document.getElementById('user-modal-title').textContent=lang==='es'?'Agregar manual':'Add manually';
        document.getElementById('manual-back-btn').style.display='inline-flex';
      }else if(step==='file'){
        document.getElementById('import-step-file').style.display='block';
        document.getElementById('user-modal-title').textContent=lang==='es'?'Importar CSV':'Import CSV';
        // Reset file state
        document.getElementById('csv-preview').style.display='none';
        document.getElementById('csv-result').style.display='none';
        document.getElementById('csv-import-btn').style.display='none';
        document.getElementById('csv-file-input').value='';
        _csvData='';
      }else if(step==='drive'){
        document.getElementById('import-step-drive').style.display='block';
        document.getElementById('user-modal-title').textContent=lang==='es'?'Importar Google Sheets':'Import Google Sheets';
        document.getElementById('drive-preview').style.display='none';
        document.getElementById('drive-result').style.display='none';
        document.getElementById('drive-import-btn').style.display='none';
      }
    };

    // ── CSV file handling ──
    window.handleCsvFile=function(file){
      if(!file)return;
      var reader=new FileReader();
      reader.onload=function(e){
        _csvData=e.target.result;
        // Simple CSV preview
        var lines=_csvData.split('\\n').filter(function(l){return l.trim()});
        if(lines.length<2){
          errorBox.textContent=lang==='es'?'El archivo CSV esta vacio o no tiene datos.':'The CSV file is empty or has no data.';
          errorBox.style.display='block';
          return;
        }
        var headers=lines[0].split(',').map(function(h){return h.replace(/^"|"$/g,'').trim()});
        var previewRows=lines.slice(1,6);
        var tbl='<thead><tr>'+headers.map(function(h){return '<th>'+h+'</th>'}).join('')+'</tr></thead><tbody>';
        previewRows.forEach(function(row){
          var cols=row.split(',').map(function(c){return c.replace(/^"|"$/g,'').trim()});
          tbl+='<tr>'+cols.map(function(c){return '<td>'+c+'</td>'}).join('')+'</tr>';
        });
        tbl+='</tbody>';
        document.getElementById('csv-preview-table').innerHTML=tbl;
        document.getElementById('csv-preview-label').textContent=(lang==='es'?'Vista previa':'Preview')+' ('+lines.length+' '+(lang==='es'?'filas':'rows')+')';
        document.getElementById('csv-preview').style.display='block';
        document.getElementById('csv-import-btn').style.display='inline-flex';
        errorBox.style.display='none';
      };
      reader.readAsText(file);
    };

    window.submitCsvImport=function(){
      if(!_csvData||!_currentListType)return;
      var btn=document.getElementById('csv-import-btn');
      btn.disabled=true;btn.textContent=lang==='es'?'Importando...':'Importing...';
      fetch('/console/api/users/bulk-import',{
        method:'POST',
        headers:{'Content-Type':'application/json'},
        body:JSON.stringify({listType:_currentListType,format:'csv',data:_csvData,source:'manual'})
      }).then(function(r){return r.json()}).then(function(data){
        btn.disabled=false;btn.textContent=lang==='es'?'Importar':'Import';
        var res=document.getElementById('csv-result');
        if(data.ok){
          var r=data.result;
          var errTxt=r.errors&&r.errors.length>0?' | '+(lang==='es'?'Errores':'Errors')+': '+r.errors.length:'';
          res.innerHTML='<div class="ts-import-success">'+(lang==='es'?'Importacion completada':'Import completed')+'</div><div class="ts-import-detail">'+(lang==='es'?'Creados':'Created')+': '+r.created+' / '+r.total+errTxt+'</div>';
          res.style.display='block';
          document.getElementById('csv-import-btn').style.display='none';
          setTimeout(function(){location.reload()},2000);
        }else{
          res.innerHTML='<div style="color:var(--error,red)">'+(data.error||'Error')+'</div>';
          res.style.display='block';
        }
      }).catch(function(err){
        btn.disabled=false;btn.textContent=lang==='es'?'Importar':'Import';
        errorBox.textContent=err.message||'Error';errorBox.style.display='block';
      });
    };

    // ── Google Drive import ──
    window.previewDriveSheet=function(){
      var url=document.getElementById('drive-sheet-url').value.trim();
      if(!url){errorBox.textContent=lang==='es'?'Ingresa una URL de Google Sheets.':'Enter a Google Sheets URL.';errorBox.style.display='block';return}
      var btn=document.getElementById('drive-preview-btn');
      btn.disabled=true;btn.textContent=lang==='es'?'Cargando...':'Loading...';
      errorBox.style.display='none';
      fetch('/console/api/users/drive-preview',{
        method:'POST',
        headers:{'Content-Type':'application/json'},
        body:JSON.stringify({sheetUrl:url})
      }).then(function(r){return r.json()}).then(function(data){
        btn.disabled=false;btn.textContent=lang==='es'?'Previsualizar':'Preview';
        if(data.ok&&data.rows&&data.rows.length>0){
          var headers=data.rows[0];
          var tbl='<thead><tr>'+headers.map(function(h){return '<th>'+h+'</th>'}).join('')+'</tr></thead><tbody>';
          data.rows.slice(1).forEach(function(row){
            tbl+='<tr>'+row.map(function(c){return '<td>'+(c||'')+'</td>'}).join('')+'</tr>';
          });
          tbl+='</tbody>';
          document.getElementById('drive-preview-table').innerHTML=tbl;
          document.getElementById('drive-preview-label').textContent=(lang==='es'?'Vista previa':'Preview')+' ('+data.rows.length+' '+(lang==='es'?'filas':'rows')+')';
          document.getElementById('drive-preview').style.display='block';
          document.getElementById('drive-import-btn').style.display='inline-flex';
        }else{
          errorBox.textContent=data.error||(lang==='es'?'No se pudo leer la hoja.':'Could not read the sheet.');
          errorBox.style.display='block';
        }
      }).catch(function(err){
        btn.disabled=false;btn.textContent=lang==='es'?'Previsualizar':'Preview';
        errorBox.textContent=err.message||'Error';errorBox.style.display='block';
      });
    };

    window.submitDriveImport=function(){
      var url=document.getElementById('drive-sheet-url').value.trim();
      if(!url||!_currentListType)return;
      var btn=document.getElementById('drive-import-btn');
      btn.disabled=true;btn.textContent=lang==='es'?'Importando...':'Importing...';
      fetch('/console/api/users/drive-import',{
        method:'POST',
        headers:{'Content-Type':'application/json'},
        body:JSON.stringify({listType:_currentListType,sheetUrl:url})
      }).then(function(r){return r.json()}).then(function(data){
        btn.disabled=false;btn.textContent=lang==='es'?'Importar':'Import';
        var res=document.getElementById('drive-result');
        if(data.ok){
          var r=data.result;
          var errTxt=r.errors&&r.errors.length>0?' | '+(lang==='es'?'Errores':'Errors')+': '+r.errors.length:'';
          res.innerHTML='<div class="ts-import-success">'+(lang==='es'?'Importacion completada':'Import completed')+'</div><div class="ts-import-detail">'+(lang==='es'?'Creados':'Created')+': '+r.created+' / '+r.total+errTxt+'</div>';
          res.style.display='block';
          document.getElementById('drive-import-btn').style.display='none';
          setTimeout(function(){location.reload()},2000);
        }else{
          res.innerHTML='<div style="color:var(--error,red)">'+(data.error||'Error')+'</div>';
          res.style.display='block';
        }
      }).catch(function(err){
        btn.disabled=false;btn.textContent=lang==='es'?'Importar':'Import';
        errorBox.textContent=err.message||'Error';errorBox.style.display='block';
      });
    };

    // ── Role dropdown helper ──
    function setupRoleDropdown(lt,selectedRole){
      var wrap=document.getElementById('user-modal-role-wrap');
      var sel=document.getElementById('user-modal-role');
      if(lt==='coworker'&&coworkerRoles.length>0){
        wrap.style.display='block';
        sel.innerHTML='<option value="">'+(lang==='es'?'— Sin rol —':'— No role —')+'</option>';
        coworkerRoles.forEach(function(r){
          var opt=document.createElement('option');opt.value=r;opt.textContent=r;
          if(r===selectedRole)opt.selected=true;
          sel.appendChild(opt);
        });
      }else{
        wrap.style.display='none';sel.value='';
      }
    }

    // ── Modal open: add ──
    window.openAddUserModal=function(lt){
      _currentListType=lt;
      _isEditMode=false;
      // Reset manual form
      document.getElementById('user-modal-submit').textContent=lang==='es'?'Crear':'Create';
      form.action='/console/contacts/add';
      document.getElementById('user-modal-userId').value='';
      document.getElementById('user-modal-listType').value=lt;
      document.getElementById('user-modal-name').value='';
      form.querySelectorAll('[data-channel]').forEach(function(inp){inp.value='';inp.classList.remove('invalid')});
      form.querySelectorAll('.wizard-field-error').forEach(function(e){e.style.display='none'});
      errorBox.style.display='none';
      listLabel.style.display='none';listSelect.style.display='none';listSelect.disabled=true;
      setupRoleDropdown(lt,'');
      // Show step 0 (mode selector)
      showImportStep('select');
      modal.style.display='flex';
    };

    // ── Modal open: edit ──
    window.userEditSelected=function(lt){
      _currentListType=lt;
      _isEditMode=true;
      var cbs=document.querySelectorAll('.user-cb[data-list="'+lt+'"]:checked');
      if(cbs.length!==1){alert(lang==='es'?'Selecciona exactamente 1 usuario.':'Select exactly 1 user.');return}
      var tr=cbs[0].closest('tr');
      var uid=tr.getAttribute('data-user-id');
      var name=tr.getAttribute('data-user-name')||'';
      var currentRole=tr.getAttribute('data-role')||'';
      var contacts={};try{contacts=JSON.parse(tr.getAttribute('data-contacts')||'{}')}catch(e){}
      document.getElementById('user-modal-title').textContent=lang==='es'?'Editar usuario':'Edit user';
      document.getElementById('user-modal-submit').textContent=lang==='es'?'Guardar':'Save';
      form.action='/console/contacts/update';
      document.getElementById('user-modal-userId').value=uid;
      document.getElementById('user-modal-listType').value=lt;
      document.getElementById('user-modal-name').value=name;
      setupRoleDropdown(lt,currentRole);
      form.querySelectorAll('[data-channel]').forEach(function(inp){
        var chId=inp.getAttribute('data-channel');
        inp.value=contacts[chId]||'';
        inp.classList.remove('invalid');
      });
      form.querySelectorAll('.wizard-field-error').forEach(function(e){e.style.display='none'});
      errorBox.style.display='none';
      // Show list change dropdown
      listLabel.style.display='block';listSelect.style.display='block';listSelect.disabled=false;
      listSelect.value=lt;
      // Skip step 0, go directly to manual form (no back button for edit)
      document.getElementById('import-step-0').style.display='none';
      document.getElementById('import-step-manual').style.display='block';
      document.getElementById('import-step-file').style.display='none';
      document.getElementById('import-step-drive').style.display='none';
      document.getElementById('manual-back-btn').style.display='none';
      modal.style.display='flex';
    };

    // ── List change confirm ──
    var _origList='';
    window.userModalListChange=function(sel){
      if(!_origList)_origList=sel.getAttribute('data-orig')||sel.value;
      if(sel.value!==_origList){
        var msg=lang==='es'?'¿Mover este usuario a la lista "'+sel.options[sel.selectedIndex].text+'"?':'Move this user to the "'+sel.options[sel.selectedIndex].text+'" list?';
        if(!confirm(msg)){sel.value=_origList}
      }
    };

    window.closeUserModal=function(){modal.style.display='none';_origList=''};

    // ── Checkbox selection ──
    window.userSelChanged=function(lt){
      var bar=document.getElementById('sel-bar-'+lt);
      var cbs=document.querySelectorAll('.user-cb[data-list="'+lt+'"]:checked');
      if(bar){
        bar.classList.toggle('visible',cbs.length>0);
        // Hide edit button when multiple selected (edit = single only)
        var editBtn=bar.querySelector('[onclick*="userEditSelected"]');
        if(editBtn)editBtn.style.display=cbs.length===1?'':'none';
      }
    };

    // ── Deactivate/delete ──
    window.userDeactivateSelected=function(lt){
      var cbs=document.querySelectorAll('.user-cb[data-list="'+lt+'"]:checked');
      if(!cbs.length)return;
      if(!confirm(lang==='es'?'¿Desactivar '+cbs.length+' usuario(s)?':'Deactivate '+cbs.length+' user(s)?'))return;
      cbs.forEach(function(cb){
        var f=document.createElement('form');f.method='POST';f.action='/console/contacts/deactivate';
        f.innerHTML='<input name="_section" value="users"><input name="_lang" value="'+lang+'"><input name="userId" value="'+cb.value+'"><input name="_redirect" value="'+location.pathname+location.search+'">';
        document.body.appendChild(f);f.submit();
      });
    };
    window.userDeleteSelected=function(lt){
      var cbs=document.querySelectorAll('.user-cb[data-list="'+lt+'"]:checked');
      var allInactive=true;
      cbs.forEach(function(cb){var tr=cb.closest('tr');if(tr&&tr.getAttribute('data-user-active')==='true')allInactive=false});
      if(!allInactive){alert(lang==='es'?'Solo se pueden eliminar usuarios desactivados.':'Can only delete deactivated users.');return}
      if(!confirm(lang==='es'?'¿Eliminar permanentemente?':'Delete permanently?'))return;
      alert(lang==='es'?'Eliminacion permanente aun no implementada.':'Permanent deletion not yet implemented.');
    };

    // ── Select all ──
    window.userToggleAll=function(lt){
      var cbAll=document.getElementById('cb-all-'+lt);
      var checked=cbAll?cbAll.checked:false;
      document.querySelectorAll('.user-cb[data-list="'+lt+'"]').forEach(function(cb){
        if(cb.closest('tr').style.display!=='none')cb.checked=checked;
      });
      userSelChanged(lt);
    };

    // ── Pagination state ──
    var _page={};
    window.userPage=function(lt,dir){
      if(!_page[lt])_page[lt]=0;
      _page[lt]=Math.max(0,_page[lt]+dir);
      userFilterApply();
    };

    // ── Filtering + pagination ──
    window.userFilterApply=function(){
      var sortEl=document.getElementById('uf-sort');
      var sourceEl=document.getElementById('uf-source');
      var activityEl=document.getElementById('uf-activity');
      var perpageEl=document.getElementById('uf-perpage');
      var sort=sortEl?sortEl.value:'asc';
      var source=sourceEl?sourceEl.value:'all';
      var activity=activityEl?activityEl.value:'all';
      var perpage=perpageEl?parseInt(perpageEl.value,10):50;
      // Multi-select channels
      var channelCbs=document.querySelectorAll('.uf-ch-option input[type="checkbox"]');
      var selectedChannels=[];
      channelCbs.forEach(function(cb){if(cb.checked)selectedChannels.push(cb.value)});
      var allChannels=channelCbs.length===selectedChannels.length;
      // Update channel button label
      var chBtn=document.querySelector('#uf-channel-wrap .custom-select-btn');
      if(chBtn){
        var arrow=' <svg class="custom-select-arrow" width="10" height="6" viewBox="0 0 10 6" fill="none"><path d="M1 1L5 5L9 1" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>';
        chBtn.innerHTML=(allChannels?(lang==='es'?'Todos':'All'):selectedChannels.length+' '+(lang==='es'?'canales':'channels'))+arrow;
      }
      var search=(document.getElementById('uf-search')||{}).value||'';
      search=search.toLowerCase();

      // Collect all rows, filter, then paginate
      var tables=document.querySelectorAll('.users-table');
      tables.forEach(function(tbl){
        var lt=tbl.id.replace('tbl-','');
        var rows=Array.prototype.slice.call(tbl.querySelectorAll('tbody tr[data-user-id]'));

        // Filter
        var visible=rows.filter(function(tr){
          if(!allChannels){
            var chs=(tr.getAttribute('data-channels')||'').split(',');
            var hasMatch=false;
            for(var ci=0;ci<selectedChannels.length;ci++){if(chs.indexOf(selectedChannels[ci])!==-1){hasMatch=true;break}}
            if(!hasMatch)return false;
          }
          if(source!=='all'){
            var s=tr.getAttribute('data-source')||'';
            if(source==='manual'&&s!=='manual')return false;
            if(source==='inbound'&&s!=='inbound')return false;
            if(source==='outbound'&&s!=='outbound')return false;
            if(source==='sync'&&s!=='csv_import'&&s!=='sheet_sync')return false;
          }
          if(activity!=='all'){
            // Time-based filters: show only active users (timestamps not available yet)
            if(tr.getAttribute('data-user-active')!=='true')return false;
          }
          if(search){
            var h=(tr.getAttribute('data-search')||'').toLowerCase();
            if(h.indexOf(search)===-1)return false;
          }
          return true;
        });

        // Sort by name
        visible.sort(function(a,b){
          var na=(a.getAttribute('data-user-name')||'').toLowerCase();
          var nb=(b.getAttribute('data-user-name')||'').toLowerCase();
          return sort==='desc'?nb.localeCompare(na):na.localeCompare(nb);
        });

        // Paginate
        if(!_page[lt])_page[lt]=0;
        var totalPages=Math.max(1,Math.ceil(visible.length/perpage));
        if(_page[lt]>=totalPages)_page[lt]=totalPages-1;
        var start=_page[lt]*perpage;
        var end=start+perpage;

        // Reorder DOM to match sort, then hide/show for pagination
        var tbody=tbl.querySelector('tbody');
        if(tbody){
          visible.forEach(function(tr){tbody.appendChild(tr)});
          // Also append filtered-out rows at end (hidden)
          rows.forEach(function(tr){if(visible.indexOf(tr)===-1)tbody.appendChild(tr)});
        }
        rows.forEach(function(tr){tr.style.display='none'});
        for(var i=start;i<Math.min(end,visible.length);i++){visible[i].style.display=''}

        // Update pager info
        var info=document.getElementById('pager-info-'+lt);
        if(info)info.textContent=(start+1)+'-'+Math.min(end,visible.length)+' / '+visible.length;
      });
    };
    // Initial filter
    setTimeout(userFilterApply,100);

    // ── Module toggle: select/deselect all tools in a module ──
    window.toggleModuleTools=function(lt,mod,checked){
      document.querySelectorAll('.tool-cb-'+lt+'-'+mod).forEach(function(cb){
        cb.checked=checked;
        var h=document.querySelector('input[name="'+cb.getAttribute('data-hidden')+'"]');
        if(h){h.value=checked?'on':'';h.dispatchEvent(new Event('input',{bubbles:true}))}
      });
    };

    // ── Perm sync (all checkboxes with data-hidden) ──
    document.querySelectorAll('.perm-cb').forEach(function(cb){
      cb.addEventListener('change',function(){
        var h=document.querySelector('input[name="'+cb.getAttribute('data-hidden')+'"]');
        if(h){h.value=cb.checked?'on':'';h.dispatchEvent(new Event('input',{bubbles:true}))}
      })
    });

    // ── Toggle lead detail row ──
    window.toggleLeadDetail=function(btn,userId){
      var row=document.getElementById('lead-detail-'+userId);
      if(!row)return;
      var isOpen=row.style.display!=='none';
      row.style.display=isOpen?'none':'';
      if(!isOpen&&!row.getAttribute('data-loaded')){
        row.setAttribute('data-loaded','1');
        fetch('/console/api/users/lead-detail?userId='+encodeURIComponent(userId))
          .then(function(r){return r.json()})
          .then(function(d){
            var commitsEl=document.getElementById('lead-commits-'+userId);
            var criteriaEl=document.getElementById('lead-criteria-'+userId);
            if(commitsEl){
              if(d.commitments&&d.commitments.length>0){
                commitsEl.innerHTML=d.commitments.map(function(c){
                  return '<div class="ts-commit-item"><strong>'+(c.description||c.type||'—')+'</strong>'+
                    (c.dueDate?'<br><span class="ts-time-ago">'+c.dueDate+'</span>':'')+
                    (c.status?' <span class="user-source-badge">'+c.status+'</span>':'')+'</div>';
                }).join('');
              }else{
                commitsEl.innerHTML='<span class="ts-config-muted">'+(lang==='es'?'Sin compromisos pendientes':'No pending commitments')+'</span>';
              }
            }
            if(criteriaEl){
              if(d.criteria&&Object.keys(d.criteria).length>0){
                var items='';
                for(var key in d.criteria){
                  if(d.criteria.hasOwnProperty(key)){
                    var val=d.criteria[key];
                    items+='<div class="ts-criteria-item"><span class="ts-criteria-key">'+key+'</span><span class="ts-criteria-val">'+(val!=null?val:'—')+'</span></div>';
                  }
                }
                criteriaEl.innerHTML=items;
              }else{
                criteriaEl.innerHTML='<span class="ts-config-muted">'+(lang==='es'?'Sin datos de calificación':'No qualification data')+'</span>';
              }
            }
          })
          .catch(function(){
            var commitsEl=document.getElementById('lead-commits-'+userId);
            if(commitsEl)commitsEl.innerHTML='<span style="color:var(--error)">Error</span>';
          });
      }
    };

    // ── Format timestamps as relative time ──
    document.querySelectorAll('.ts-time-ago[data-ts]').forEach(function(el){
      var ts=el.getAttribute('data-ts');
      if(!ts)return;
      var date=new Date(ts);
      if(isNaN(date.getTime()))return;
      var now=new Date();
      var diff=Math.floor((now.getTime()-date.getTime())/1000);
      var text='';
      if(diff<60)text=(lang==='es'?'hace ':'')+diff+'s'+(lang!=='es'?' ago':'');
      else if(diff<3600)text=(lang==='es'?'hace ':'')+Math.floor(diff/60)+'m'+(lang!=='es'?' ago':'');
      else if(diff<86400)text=(lang==='es'?'hace ':'')+Math.floor(diff/3600)+'h'+(lang!=='es'?' ago':'');
      else text=(lang==='es'?'hace ':'')+Math.floor(diff/86400)+'d'+(lang!=='es'?' ago':'');
      el.textContent=text;
      el.title=date.toLocaleString();
    });

    // Re-init custom selects for filter bar (loaded after initial init)
    if(typeof initCustomSelects==='function')initCustomSelects();
  })()</script>`

  // ── Config page ──
  if (isConfigPage) {
  const { activeModules = [], knowledgeCategories: kCats = [], subagentTypes: saTypesAll = [] } = ud
  const SYSTEM_TYPES = ['admin', 'lead', 'coworker', 'partners']
  // Section A: Base Cards Grid
  const SVG_CONTACTS_ICON = '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>'
  const SVG_EYE = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>'

  // Sort cards: admin first, then active alphabetically, then inactive alphabetically
  const sortedConfigs = [...configs].sort((a, b) => {
    if (a.listType === 'admin') return -1
    if (b.listType === 'admin') return 1
    if (a.isEnabled !== b.isEnabled) return a.isEnabled ? -1 : 1
    return a.displayName.localeCompare(b.displayName)
  })

  html += `<div class="cb-grid">`
  for (const cfg of sortedConfigs) {
    const lt = cfg.listType
    const isSys = cfg.isSystem || SYSTEM_TYPES.includes(lt)
    const count = counts[lt] ?? 0
    const isPartners = lt === 'partners'
    const inactiveClass = !cfg.isEnabled ? ' ch-card-inactive' : ''
    const typeLabel = isSys ? (lang === 'es' ? 'Sistema' : 'System') : (lang === 'es' ? 'Custom' : 'Custom')
    const countLabel = lang === 'es' ? 'contactos' : 'contacts'

    html += `<div class="ch-card cb-card${inactiveClass}" data-base-id="${esc(lt)}" data-enabled="${cfg.isEnabled}" ${!isPartners ? `onclick="if(!event.target.closest('.toggle,.act-btn,.ch-btn-action,a'))toggleBaseConfigClick('${esc(lt)}')" style="cursor:pointer"` : ''}>
      <div class="ch-card-top">
        <div class="ch-card-icon ts-cb-icon-primary">
          ${SVG_CONTACTS_ICON}
        </div>
        <div class="ch-card-title-area">
          <div class="ch-card-name">${esc(cfg.displayName)}</div>
          <div class="ch-card-type">${typeLabel}</div>
        </div>
        ${lt === 'admin' ? '' : `<label class="toggle toggle-sm" onclick="event.stopPropagation()">
          <input type="checkbox" ${cfg.isEnabled ? 'checked' : ''} ${isPartners ? 'disabled' : ''}
            data-list-toggle="${esc(lt)}" data-list-name="${esc(cfg.displayName)}"
            onchange="toggleBaseList(this)">
          <span class="toggle-slider"></span>
        </label>`}
      </div>
      <div class="ch-card-metrics ch-metrics-1">
        <div class="ch-metric ts-metric-no-border">
          <span class="ch-metric-label">${countLabel}</span>
          <span class="ch-metric-value">${count}</span>
        </div>
      </div>
      <div class="ch-card-footer">${isPartners
        ? `<span class="panel-badge badge-soon">${lang === 'es' ? 'Proximamente' : 'Coming soon'}</span>`
        : `<button type="button" class="act-btn act-btn-config" onclick="event.stopPropagation();toggleBaseConfigClick('${esc(lt)}')">${GEAR_SVG} ${lang === 'es' ? 'Configurar' : 'Configure'}</button>
           <span class="ch-footer-spacer"></span>
           <a href="/console/contacts/${esc(lt)}?lang=${lang}" class="act-btn act-btn-add" onclick="event.stopPropagation()">${SVG_EYE} ${lang === 'es' ? 'Ver' : 'View'}</a>`
      }</div>
    </div>`
  }
  html += `</div>`

  // ── Tip box: shown when no base is selected for config ──
  const SVG_CONFIG_TIP = '<svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>'

  html += `<div class="cb-config-tip" id="cb-config-tip">
    ${SVG_CONFIG_TIP}
    <div class="ts-create-box-desc" style="margin-top:8px;font-size:0.95rem">${lang === 'es' ? 'Selecciona una base para configurar' : 'Select a base to configure'}</div>
  </div>`

  // ── System base explanations ──
  const BASE_EXPLANATIONS: Record<string, Record<string, string>> = {
    lead: {
      es: 'Todos los contactos no registrados cuando la atencion al publico esta abierta. Se registran automaticamente como leads y se califican segun las reglas configuradas.',
      en: 'All unregistered contacts when public attention is open. They are automatically registered as leads and scored according to configured rules.',
    },
    coworker: {
      es: 'Empleados de la empresa. Se asignan por dominio de correo electronico o manualmente. Los contactos cuyo email coincida con los dominios configurados se asignan automaticamente a esta base.',
      en: 'Company employees. Assigned by email domain or manually. Contacts whose email matches configured domains are automatically assigned to this base.',
    },
  }

  // ── Per-base config panels (2-column layout, hidden by default) ──
  // Layout: LEFT = info/rules (narrow, ~1 card), RIGHT = collapsible tabs (wide, ~3 cards)
  for (const cfg of configs) {
    const lt = cfg.listType
    if (lt === 'partners') continue // Partners = "proximamente"
    const isSys = cfg.isSystem || SYSTEM_TYPES.includes(lt)
    const perms = cfg.permissions
    const isAllTools = perms.tools.includes('*')

    html += `<div class="cb-config-panel" id="cb-config-${esc(lt)}">
      <div class="cb-config-layout">`

    // ══ Column 1 (LEFT, narrow): name, description, assignment rules ══
    html += `<div><div class="panel"><div class="panel-body">
      <div class="ts-config-title">${esc(cfg.displayName)}</div>
      ${cfg.description ? `<div class="ts-config-desc">${esc(cfg.description)}</div>` : ''}`

    // System-specific explanations
    const explanation = BASE_EXPLANATIONS[lt]
    if (explanation) {
      html += `<div class="field-divider"><span class="field-divider-label">${lang === 'es' ? 'Reglas de asignacion' : 'Assignment rules'}</span></div>
        <div class="ts-config-explanation">
        ${esc(explanation[lang] || explanation['es']!)}</div>`
    }

    // Coworker: email domain tags input
    if (lt === 'coworker') {
      const domains: string[] = (cfg.syncConfig as Record<string, unknown>)?.domains as string[] ?? []
      const domainsOrig = domains.join(',')
      const domainChips = domains.map(d => `<span class="tag-chip">${esc(d)} <button type="button" onclick="removeDomainTag(this)">×</button></span>`).join('')
      html += `<div class="field-divider"><span class="field-divider-label">${lang === 'es' ? 'Dominios de correo' : 'Email domains'}</span></div>
        <div style="margin-bottom:12px">
          <div class="tags-container" id="coworker-domains-tags">
            ${domainChips}
            <input type="text" class="tags-input" id="coworker-domain-input" placeholder="${lang === 'es' ? 'Ej: @miempresa.com + Enter' : 'E.g. @company.com + Enter'}" onkeydown="if(event.key==='Enter'){event.preventDefault();addDomainTag()}">
          </div>
          <input type="hidden" name="coworker_domains" value="${esc(domainsOrig)}" data-original="${esc(domainsOrig)}" id="coworker-domains-hidden">
        </div>`

    }

    // Lead: webhook toggle in column 1
    if (lt === 'lead') {
      const whEnabledCol1 = (cfg.syncConfig as Record<string, unknown>)?.webhookEnabled === true
      const whEnabledOrigCol1 = whEnabledCol1 ? 'on' : ''
      html += `<div class="field-divider"><span class="field-divider-label">Webhook</span></div>
        <div class="chs-toggle-row chs-toggle-row--compact">
          <span style="font-size:13px">${lang === 'es' ? 'Recibir leads desde webhook' : 'Receive leads from webhook'}</span>
          <span class="ch-footer-spacer"></span>
          <label class="toggle toggle-sm" onclick="event.stopPropagation()">
            <input type="checkbox" ${whEnabledCol1 ? 'checked' : ''} data-hidden="webhook_enabled_lead"
              onchange="var h=document.querySelector('[name=webhook_enabled_lead]');if(h){h.value=this.checked?'on':'';h.dispatchEvent(new Event('input',{bubbles:true}))}var p=document.getElementById('webhook-panel-lead');if(p){if(this.checked){p.style.display='';p.classList.remove('collapsed')}else{p.style.display='none'}}">
            <span class="toggle-slider"></span>
          </label>
          <input type="hidden" name="webhook_enabled_lead" value="${whEnabledOrigCol1}" data-original="${whEnabledOrigCol1}">
        </div>
        <div class="ts-contact-ignored-wrap">
          <button class="act-btn act-btn-cta ts-contact-ignored-btn" onclick="contactIgnored('${lang}')">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 2L11 13"/><path d="M22 2L15 22 11 13 2 9l20-7z"/></svg>
            ${lang === 'es' ? 'Contactar ignorados' : 'Contact ignored leads'}
          </button>
        </div>
        <script>
        function contactIgnored(lang) {
          if (!confirm(lang === 'es' ? '¿Iniciar contacto proactivo con leads ignorados (fuente: engine)? Se actualizará su fuente a outbound.' : 'Start proactive contact with ignored leads (source: engine)? Their source will be updated to outbound.')) return;
          fetch('/console/api/lead-scoring/contact-ignored', { method: 'POST', headers: { 'Content-Type': 'application/json' } })
            .then(function(r) { return r.json() })
            .then(function(d) {
              var msg = lang === 'es'
                ? (d.count || 0) + ' contactos programados para contacto'
                : (d.count || 0) + ' contacts scheduled for outreach';
              window.lunaNotifications ? window.lunaNotifications.add({ title: 'OK', text: msg, type: 'success' }) : alert(msg);
            })
            .catch(function() { alert('Error'); });
        }
        </script>`
    }

    // Assignment rules (custom lists only — not system)
    if (!['admin', 'lead', 'coworker'].includes(lt)) {
      const aEnabled = cfg.assignmentEnabled
      const aPrompt = cfg.assignmentPrompt || ''
      const aOrig = aEnabled ? 'on' : ''
      html += `<div class="field-divider"><span class="field-divider-label">${lang === 'es' ? 'Reglas de asignacion' : 'Assignment rules'}</span></div>
        <div class="chs-toggle-row chs-toggle-row--compact">
          <span style="font-size:13px">${lang === 'es' ? 'Asignacion automatica por LLM' : 'LLM auto-assignment'}</span>
          <span class="ch-footer-spacer"></span>
          <input type="checkbox" class="perm-cb" class="ts-perm-cb"
            ${aEnabled ? 'checked' : ''} data-hidden="assignment_enabled_${esc(lt)}"
            onchange="document.getElementById('assignment-prompt-${esc(lt)}').style.display=this.checked?'block':'none'">
          <input type="hidden" name="assignment_enabled_${esc(lt)}" value="${aOrig}" data-original="${aOrig}">
        </div>
        <div id="assignment-prompt-${esc(lt)}" style="display:${aEnabled ? 'block' : 'none'};margin-top:8px">
          <label class="wizard-label">${lang === 'es' ? 'Instrucciones para el modelo' : 'Instructions for the model'}</label>
          <textarea class="wizard-input" name="assignment_prompt_${esc(lt)}" rows="3" data-original="${esc(aPrompt)}"
            placeholder="${lang === 'es' ? 'Ej: Si el contacto menciona que es proveedor o viene referido por un partner, asignalo a esta lista.' : 'E.g. If the contact mentions they are a vendor or referred by a partner, assign them to this list.'}">${esc(aPrompt)}</textarea>
        </div>`
    }

    // Delete button for custom lists
    if (!isSys) {
      html += `<div class="ts-config-delete-area">
        <form method="POST" action="/console/contacts/delete-list" style="display:inline" onclick="return confirm('${lang === 'es' ? '¿Eliminar esta lista? Los contactos se moveran.' : 'Delete this list? Contacts will be moved.'}')">
          <input type="hidden" name="_section" value="contacts"><input type="hidden" name="_lang" value="${lang}">
          <input type="hidden" name="listType" value="${esc(lt)}">
          <button type="submit" class="act-btn act-btn-remove">${SVG_DELETE} ${lang === 'es' ? 'Eliminar lista' : 'Delete list'}</button>
        </form>
      </div>`
    }

    html += `</div></div></div>` // end left column

    // ══ Column 2 (RIGHT, wide): collapsible tabs — Modules, Subagents, Knowledge ══
    html += `<div>`

    // Admin = read-only (all access, informational only)
    const isAdmin = lt === 'admin'
    const disabledAttr = isAdmin ? ' disabled' : ''

    // Tab 1: Modules
    html += `<div class="panel collapsed"><div class="panel-header" onclick="togglePanel(this)">
      <span class="panel-title">${lang === 'es' ? 'Modulos' : 'Modules'}</span>
      <span class="panel-chevron">&#9660;</span></div><div class="panel-body">`

    for (const mod of activeModules) {
      const modLabel = typeof mod.displayName === 'string' ? mod.displayName : (mod.displayName[lang] || mod.displayName['es'] || mod.name)
      const modToolNames = mod.tools.map(t => t.name)
      const allModToolsOn = isAdmin || isAllTools || modToolNames.every(tn => perms.tools.includes(tn))
      const someModToolsOn = !allModToolsOn && modToolNames.some(tn => perms.tools.includes(tn))

      const modOrig = allModToolsOn ? 'on' : ''
      html += `<div class="chs-toggle-row" style="margin-bottom:4px;padding:10px 14px">
        <span style="font-size:13px;font-weight:600">${esc(modLabel)}</span>
        <span class="ch-footer-spacer"></span>
        <input type="checkbox" class="perm-cb" class="ts-perm-cb"
          ${allModToolsOn ? 'checked' : ''} ${someModToolsOn ? 'indeterminate' : ''}${disabledAttr}
          data-hidden="mod_${esc(lt)}_${esc(mod.name)}"
          onchange="toggleModuleTools('${esc(lt)}','${esc(mod.name)}',this.checked)">
        <input type="hidden" name="mod_${esc(lt)}_${esc(mod.name)}" value="${modOrig}" data-original="${modOrig}">
      </div>`

      html += `<div class="perm-grid u-mb-sm" style="padding-left:28px" id="mod-tools-${esc(lt)}-${esc(mod.name)}">`
      for (const tool of mod.tools) {
        const checked = isAdmin || isAllTools || perms.tools.includes(tool.name)
        const origVal = checked ? 'on' : ''
        const toolDesc = tool.description || ''
        const infoHtml = toolDesc ? `<span class="info-wrap"><span class="info-btn" tabindex="0">i</span><span class="info-tooltip">${esc(toolDesc)}</span></span>` : ''
        html += `<label>
          <input type="checkbox" class="perm-cb tool-cb-${esc(lt)}-${esc(mod.name)}" ${checked ? 'checked' : ''}${disabledAttr}
            data-hidden="tool_${esc(lt)}_${esc(tool.name)}">
          <input type="hidden" name="tool_${esc(lt)}_${esc(tool.name)}" value="${origVal}" data-original="${origVal}">
          ${esc(tool.displayName || tool.name)}${infoHtml}</label>`
      }
      html += `</div>`
    }
    html += `</div></div>` // end Modules panel

    // Tab 2: Subagents (toggle + per-subagent selection)
    const subOrig = (isAdmin || perms.subagents) ? 'on' : ''
    const saTypes = saTypesAll
    const allowedSa = perms.allowedSubagents ?? []
    const allSaAccess = isAdmin || allowedSa.length === 0
    html += `<div class="panel collapsed"><div class="panel-header" onclick="togglePanel(this)">
      <span class="panel-title">${lang === 'es' ? 'Subagentes' : 'Subagents'}</span>
      <span class="panel-chevron">&#9660;</span></div><div class="panel-body">
      <div class="chs-toggle-row chs-toggle-row--compact">
        <span style="font-size:13px">${lang === 'es' ? 'Permitir subagentes' : 'Allow subagents'}</span>
        <span class="ch-footer-spacer"></span>
        <input type="checkbox" class="perm-cb" class="ts-perm-cb"
          ${isAdmin || perms.subagents ? 'checked' : ''}${disabledAttr} data-hidden="sub_${esc(lt)}">
        <input type="hidden" name="sub_${esc(lt)}" value="${subOrig}" data-original="${subOrig}">
      </div>`
    if (saTypes.length > 0) {
      html += `<p class="panel-description ts-config-muted" style="margin:8px 0 4px">${lang === 'es' ? 'Sin seleccion = acceso a todos. Selecciona para restringir.' : 'No selection = access to all. Select to restrict.'}</p>`
      html += `<div class="perm-grid">`
      for (const sa of saTypes) {
        const checked = allSaAccess || allowedSa.includes(sa.slug)
        const origVal = checked && !allSaAccess ? 'on' : ''
        html += `<label title="${esc(sa.description)}">
          <input type="checkbox" class="perm-cb" ${checked ? 'checked' : ''}${disabledAttr} data-hidden="sa_${esc(lt)}_${esc(sa.slug)}">
          <input type="hidden" name="sa_${esc(lt)}_${esc(sa.slug)}" value="${origVal}" data-original="${origVal}">
          ${esc(sa.name)}</label>`
      }
      html += `</div>`
    }
    html += `</div></div>` // end Subagents panel

    // Tab 3: Knowledge Categories (always show, even if empty)
    const allowedCats = cfg.knowledgeCategories ?? []
    const allCats = isAdmin || allowedCats.length === 0
    html += `<div class="panel collapsed"><div class="panel-header" onclick="togglePanel(this)">
      <span class="panel-title">${lang === 'es' ? 'Categorias de conocimiento' : 'Knowledge categories'}</span>
      <span class="panel-chevron">&#9660;</span></div><div class="panel-body">`
    if (kCats.length > 0) {
      html += `<div class="perm-grid">`
      for (const cat of kCats) {
        const checked = allCats || allowedCats.includes(cat.id)
        const origVal = checked ? 'on' : ''
        html += `<label title="${esc(cat.description)}">
          <input type="checkbox" class="perm-cb" ${checked ? 'checked' : ''}${disabledAttr} data-hidden="kcat_${esc(lt)}_${esc(cat.id)}">
          <input type="hidden" name="kcat_${esc(lt)}_${esc(cat.id)}" value="${origVal}" data-original="${origVal}">
          ${esc(cat.title)}</label>`
      }
      html += `</div>`
    } else {
      html += `<p class="panel-description ts-config-muted">${lang === 'es' ? 'No hay categorias de conocimiento configuradas. Activa el modulo de Knowledge para gestionar categorias.' : 'No knowledge categories configured. Activate the Knowledge module to manage categories.'}</p>`
    }
    html += `</div></div>` // end Knowledge panel

    // Tab 4: Roles (coworker only — column 2)
    if (lt === 'coworker') {
      const roles: string[] = (cfg.syncConfig as Record<string, unknown>)?.roles as string[] ?? []
      const rolesOrig = roles.join(',')
      const roleList = roles.length > 0
        ? roles.map(r => `<div class="ts-role-row">
            <span class="ts-role-name">${esc(r)}</span>
          </div>`).join('')
        : `<div class="ts-roles-empty">${lang === 'es' ? 'No hay etiquetas definidas.' : 'No labels defined.'}</div>`
      html += `<div class="panel collapsed"><div class="panel-header" onclick="togglePanel(this)">
        <span class="panel-title">${lang === 'es' ? 'Etiquetas / Roles' : 'Labels / Roles'}</span>
        <span class="panel-chevron">&#9660;</span></div><div class="panel-body">
        <div class="ts-roles-desc">${lang === 'es' ? 'Define etiquetas para clasificar coworkers. Se usan para escalamientos y human-in-the-loop.' : 'Define labels to classify coworkers. Used for escalations and human-in-the-loop.'}</div>
        <div id="coworker-roles-list">${roleList}</div>
        <input type="hidden" name="coworker_roles" value="${esc(rolesOrig)}" data-original="${esc(rolesOrig)}" id="coworker-roles-hidden">
        <button type="button" class="act-btn act-btn-config u-mt-md" onclick="openRolesModal()">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
          ${lang === 'es' ? 'Editar etiquetas' : 'Edit labels'}
        </button>
      </div></div>`
    }

    // Tab 5: Webhook de registro (leads only — column 2, hidden when webhook disabled)
    if (lt === 'lead') {
      const whEnabled = (cfg.syncConfig as Record<string, unknown>)?.webhookEnabled === true
      const whToken = ((cfg.syncConfig as Record<string, unknown>)?.webhookToken as string) ?? ''
      const whChannel = ((cfg.syncConfig as Record<string, unknown>)?.webhookPreferredChannel as string) || 'auto'
      const SVG_COPY = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg>'
      const SVG_REFRESH = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 11-2.12-9.36L23 10"/></svg>'
      html += `<div id="webhook-panel-lead" class="panel" style="${whEnabled ? '' : 'display:none'}"><div class="panel-header" onclick="togglePanel(this)">
        <span class="panel-title">${lang === 'es' ? 'Webhook de registro' : 'Registration webhook'}</span>
        <span class="panel-chevron">&#9660;</span></div><div class="panel-body">
        <div class="ts-webhook-desc">${lang === 'es'
          ? 'Registra leads desde sistemas externos (CRM, ads, formularios) via HTTP POST.'
          : 'Register leads from external systems (CRM, ads, forms) via HTTP POST.'}</div>
        <div id="webhook-settings-lead">
          <label class="ts-webhook-label">Endpoint <span class="ts-webhook-label-sub">(POST)</span></label>
          <div class="wizard-uri-box" style="margin-bottom:14px">
            <code class="wizard-uri" id="webhook-endpoint-display">{BASE_URL}/console/api/users/webhook/register</code>
            <button type="button" class="wizard-copy-icon" onclick="copyWizardUri(this)" title="${lang === 'es' ? 'Copiar' : 'Copy'}">${SVG_COPY}</button>
          </div>
          <label class="ts-webhook-label">${lang === 'es' ? 'Token de autorizacion' : 'Authorization token'}</label>
          <div class="wizard-uri-box" style="margin-bottom:14px">
            <code class="wizard-uri" id="webhook-token-display" style="font-size:12px">${esc(whToken)}</code>
            <button type="button" class="wizard-copy-icon" onclick="copyWizardUri(this)" title="${lang === 'es' ? 'Copiar' : 'Copy'}">${SVG_COPY}</button>
            <button type="button" class="wizard-copy-icon" onclick="regenerateWebhookToken()" title="${lang === 'es' ? 'Regenerar' : 'Regenerate'}">${SVG_REFRESH}</button>
          </div>
          <input type="hidden" name="webhook_token_lead" value="${esc(whToken)}" data-original="${esc(whToken)}">
          <label class="ts-webhook-label">${lang === 'es' ? 'Canal preferido de contacto' : 'Preferred contact channel'}</label>
          <select class="wizard-input js-custom-select" name="webhook_channel_lead" data-original="${esc(whChannel)}" style="margin-bottom:14px">
            <option value="auto" ${whChannel === 'auto' ? 'selected' : ''}>Auto</option>
            <option value="whatsapp" ${whChannel === 'whatsapp' ? 'selected' : ''}>WhatsApp</option>
            <option value="email" ${whChannel === 'email' ? 'selected' : ''}>Email (Gmail)</option>
            <option value="google-chat" ${whChannel === 'google-chat' ? 'selected' : ''}>Google Chat</option>
          </select>
          <div class="field-divider" style="margin:8px 0"><span class="field-divider-label">${lang === 'es' ? 'Instrucciones de uso' : 'Usage instructions'}</span></div>
          <div class="ts-webhook-instructions">
            <p style="margin:0 0 8px"><strong>Headers:</strong> <code class="ts-webhook-code">Authorization: Bearer {token}</code></p>
            <p style="margin:0 0 4px"><strong>Body (JSON):</strong></p>
            <div style="position:relative">
              <pre id="webhook-json-example" class="ts-webhook-pre">{
  "phone": "573001234567",
  "email": "contacto@ejemplo.com",
  "name": "Nombre del contacto",
  "campaign": "keyword-o-id"
}</pre>
              <button type="button" class="wizard-copy-icon ts-webhook-copy-abs" onclick="navigator.clipboard.writeText(document.getElementById('webhook-json-example').textContent);this.classList.add('copied');setTimeout(()=>this.classList.remove('copied'),1500)" title="${lang === 'es' ? 'Copiar' : 'Copy'}">${SVG_COPY}</button>
            </div>
            <p style="margin:0 0 4px"><strong>${lang === 'es' ? 'Parametros' : 'Parameters'}:</strong></p>
            <ul style="margin:0 0 8px;padding-left:16px">
              <li><code>phone</code> ${lang === 'es' ? 'o' : 'or'} <code>email</code> — ${lang === 'es' ? 'al menos uno requerido' : 'at least one required'}</li>
              <li><code>name</code> — ${lang === 'es' ? 'nombre del contacto (opcional)' : 'contact name (optional)'}</li>
              <li><code>campaign</code> — ${lang === 'es' ? 'keyword o ID de la campaña (opcional). Consulta el ID en' : 'campaign keyword or ID (optional). Check the ID in'} <a href="/console/lead-scoring?lang=${lang}" style="color:var(--primary)">${lang === 'es' ? 'Campañas' : 'Campaigns'}</a></li>
            </ul>
          </div>
        </div>
      </div></div>`
    }

    html += `</div>` // end right column
    html += `</div></div>` // end cb-config-layout + cb-config-panel
  }

  // ── Create base box + Unregistered contacts (global config) ──
  html += `<div class="cb-create-box">
    <div class="cb-create-box-header">
      <div>
        <div class="ts-create-box-title">${lang === 'es' ? 'Organiza tus usuarios' : 'Organize your users'}</div>
        <div class="ts-create-box-desc">${lang === 'es' ? 'Crea tus bases de contactos aqui para segmentar y organizar tu audiencia.' : 'Create your contact bases here to segment and organize your audience.'}</div>
      </div>
      <span class="panel-badge badge-soon" style="font-size:0.8rem;padding:6px 14px">${lang === 'es' ? 'Proximamente' : 'Coming soon'}</span>
    </div>
  </div>`

  // ── Contactos no registrados (global config) ──
  const leadCfg = configs.find(c => c.listType === 'lead')
  if (leadCfg) {
    const behavior = leadCfg.unregisteredBehavior || 'ignore'
    const savedMsg = leadCfg.unregisteredMessage || ''
    const hasSavedMsg = behavior === 'message' && savedMsg.length > 0
    html += `<div class="cb-create-box" style="margin-top:16px">
      <div class="cb-create-box-header">
        <div>
          <div class="ts-create-box-title">${lang === 'es' ? 'Contactos no registrados' : 'Unregistered contacts'}</div>
          <div class="ts-create-box-desc">${lang === 'es' ? 'Configura que sucede cuando un contacto desconocido escribe por primera vez.' : 'Configure what happens when an unknown contact writes for the first time.'}</div>
        </div>
        <select class="wizard-input js-custom-select" name="unregisteredBehavior" data-original="${esc(behavior)}" style="max-width:280px;width:280px" onchange="onUnregBehaviorChange(this.value)">
          <option value="ignore" ${behavior === 'ignore' ? 'selected' : ''}>${lang === 'es' ? 'Ignorar — Luna no se activa' : 'Ignore — Luna does not activate'}</option>
          <option value="silence" ${behavior === 'silence' ? 'selected' : ''}>${lang === 'es' ? 'Silencio — registra pero no responde' : 'Silence — registers but does not respond'}</option>
          <option value="message" ${behavior === 'message' ? 'selected' : ''}>${lang === 'es' ? 'Mensaje — registra y envia mensaje automatico' : 'Message — registers and sends auto-message'}</option>
          <option value="attend" ${behavior === 'attend' ? 'selected' : ''}>${lang === 'es' ? 'Atender — registra y responde' : 'Attend — registers and responds'}</option>
        </select>
      </div>
      <div id="unregistered-msg-field" style="display:${behavior === 'message' ? 'block' : 'none'};margin-top:12px">
        <div class="ts-unreg-msg-header">
          <label class="wizard-label" style="margin:0">${lang === 'es' ? 'Mensaje automatico' : 'Auto-message'}</label>
          <button type="button" id="unregistered-msg-edit-btn" class="act-btn act-btn-config act-btn--compact" style="display:${hasSavedMsg ? 'inline-flex' : 'none'}" onclick="enableUnregMsgEdit()">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
            ${lang === 'es' ? 'Editar' : 'Edit'}
          </button>
        </div>
        <textarea class="wizard-input" id="unregistered-msg-textarea" name="unregisteredMessage" data-original="${esc(savedMsg)}" rows="2" ${hasSavedMsg ? 'readonly style="background:var(--surface-container-low);cursor:default"' : ''} placeholder="${lang === 'es' ? 'Gracias por tu mensaje. Te contactaremos pronto.' : 'Thank you for your message. We will get back to you soon.'}">${esc(savedMsg)}</textarea>
      </div>
    </div>`
  }

  // ── Deactivation modal (2-step confirmation) ──
  html += `<div class="cb-deact-overlay" id="cb-deact-overlay" onclick="if(event.target===this)closeDeactModal()">
    <div class="cb-deact-modal">
      <div class="cb-deact-step active" id="cb-deact-step1">
        <h3>${lang === 'es' ? 'Desactivar base' : 'Deactivate base'}</h3>
        <p id="cb-deact-desc">${lang === 'es' ? '¿Que deseas hacer con los contactos de esta base?' : 'What do you want to do with the contacts in this base?'}</p>
        <label class="ts-webhook-label">${lang === 'es' ? 'Accion' : 'Action'}</label>
        <select class="wizard-input js-custom-select" id="cb-deact-action" required style="margin-bottom:12px">
          <option value="" disabled selected>${lang === 'es' ? 'Selecciona una opcion...' : 'Select an option...'}</option>
          <option value="silence">${lang === 'es' ? 'Silencio — solo registrar, sin respuesta' : 'Silence — register only, no response'}</option>
          <option value="leads">${lang === 'es' ? 'Mover a Leads' : 'Move to Leads'}</option>
          <option value="unregistered">${lang === 'es' ? 'Contacto no registrado — tratar como nuevo' : 'Unregistered — treat as new contact'}</option>
        </select>
        <div class="ts-modal-actions">
          <button type="button" class="act-btn act-btn-config" onclick="closeDeactModal()">${lang === 'es' ? 'Cancelar' : 'Cancel'}</button>
          <button type="button" class="act-btn act-btn-remove" id="cb-deact-next" onclick="deactNextStep()">${lang === 'es' ? 'Continuar' : 'Continue'}</button>
        </div>
      </div>
      <div class="cb-deact-step" id="cb-deact-step2">
        <h3>${lang === 'es' ? 'Confirmar desactivacion' : 'Confirm deactivation'}</h3>
        <p id="cb-deact-confirm-msg"></p>
        <div class="ts-modal-actions-compact">
          <button type="button" class="act-btn act-btn-config" onclick="deactBackStep()">${lang === 'es' ? 'Atras' : 'Back'}</button>
          <button type="button" class="act-btn act-btn-remove" onclick="confirmDeactivation()">${lang === 'es' ? 'Desactivar' : 'Deactivate'}</button>
        </div>
      </div>
    </div>
  </div>`

  // ── Config page JavaScript ──
  html += `<script>(function(){
    var _deactLt='';
    var _deactName='';
    var lang=document.documentElement.lang||'es';

    // Submit toggle form (instant apply, like channels)
    function submitListToggle(lt,enabled,behavior,target){
      var form=document.createElement('form');
      form.method='POST';form.action='/console/contacts/toggle-list';form.style.display='none';
      var fields={listType:lt,enabled:enabled?'true':'false',_redirect:'/console/contacts?page=config&lang='+lang};
      if(behavior)fields.disableBehavior=behavior;
      if(target)fields.disableTarget=target;
      for(var k in fields){var inp=document.createElement('input');inp.type='hidden';inp.name=k;inp.value=fields[k];form.appendChild(inp)}
      document.body.appendChild(form);form.submit();
    }

    // Toggle handler: activate = instant, deactivate = modal
    window.toggleBaseList=function(cb){
      var lt=cb.getAttribute('data-list-toggle');
      var name=cb.getAttribute('data-list-name');
      if(cb.checked){
        // Activating — instant apply
        submitListToggle(lt,true);
      } else {
        // Deactivating — revert and open modal
        cb.checked=true;
        openDeactModal(lt,name);
      }
    };

    // Click on card: only open config if enabled
    window.toggleBaseConfigClick=function(lt){
      var card=document.querySelector('.ch-card[data-base-id="'+lt+'"]');
      if(card&&card.getAttribute('data-enabled')!=='true')return;
      openBaseConfig(lt);
    };

    window.openBaseConfig=function(lt){
      var tip=document.getElementById('cb-config-tip');
      if(tip)tip.style.display='none';
      document.querySelectorAll('.cb-config-panel').forEach(function(p){p.classList.remove('active')});
      var panel=document.getElementById('cb-config-'+lt);
      if(panel){panel.classList.add('active');panel.scrollIntoView({behavior:'smooth',block:'start'})}
      document.querySelectorAll('.ch-card[data-base-id]').forEach(function(c){c.classList.remove('cb-active')});
      var card=document.querySelector('.ch-card[data-base-id="'+lt+'"]');
      if(card)card.classList.add('cb-active');
    };
    // toggleCreateBase removed — button replaced by "Proximamente" badge
    window.addDomainTag=function(){
      var inp=document.getElementById('coworker-domain-input');
      if(!inp)return;
      var val=inp.value.trim();
      if(!val)return;
      if(val.indexOf('@')!==0)val='@'+val;
      var container=document.getElementById('coworker-domains-tags');
      var tag=document.createElement('span');
      tag.className='tag-chip';
      tag.innerHTML=val+' <button type="button" onclick="this.parentElement.remove();updateDomainHidden()">&times;<'+'/button>';
      container.insertBefore(tag,inp);
      inp.value='';
      updateDomainHidden();
    };
    window.updateDomainHidden=function(){
      var chips=document.querySelectorAll('#coworker-domains-tags .tag-chip');
      var vals=[];
      chips.forEach(function(c){vals.push(c.textContent.replace('\\u00d7','').replace('\u00d7','').trim())});
      var hidden=document.getElementById('coworker-domains-hidden');
      if(hidden){hidden.value=vals.join(',');hidden.dispatchEvent(new Event('input',{bubbles:true}))}
    };
    window.removeDomainTag=function(btn){
      btn.parentElement.remove();updateDomainHidden();
    };

    // ── Unregistered behavior change ──
    window.onUnregBehaviorChange=function(val){
      var msgField=document.getElementById('unregistered-msg-field');
      if(msgField)msgField.style.display=val==='message'?'block':'none';
      if(val==='message'){
        var ta=document.getElementById('unregistered-msg-textarea');
        if(ta&&!ta.value.trim()){ta.removeAttribute('readonly');ta.style.background='';ta.style.cursor='';
          var btn=document.getElementById('unregistered-msg-edit-btn');if(btn)btn.style.display='none'}
      }
      // Trigger dirty tracking — the hidden select has data-original
      var sel=document.querySelector('select[name="unregisteredBehavior"]');
      if(sel)sel.dispatchEvent(new Event('input',{bubbles:true}));
    };
    window.enableUnregMsgEdit=function(){
      var ta=document.getElementById('unregistered-msg-textarea');
      if(ta){ta.removeAttribute('readonly');ta.style.background='';ta.style.cursor='';ta.focus()}
      var btn=document.getElementById('unregistered-msg-edit-btn');
      if(btn)btn.style.display='none';
    };

    // ── Roles modal (coworker) ──
    // NOTE: All closing tags in innerHTML strings MUST use '<'+'/' to avoid breaking the HTML parser
    var CL='<'+'/'; // closing tag helper — avoids </ which breaks inline script
    window.openRolesModal=function(){
      var hidden=document.getElementById('coworker-roles-hidden');
      var roles=(hidden&&hidden.value)?hidden.value.split(',').filter(Boolean):[];
      var overlay=document.getElementById('roles-modal-overlay');
      if(!overlay){
        overlay=document.createElement('div');overlay.id='roles-modal-overlay';
        overlay.className='cb-deact-overlay open';
        overlay.onclick=function(e){if(e.target===overlay)closeRolesModal()};
        overlay.innerHTML='<div class="cb-deact-modal" style="max-width:420px"><h3>'+(lang==='es'?'Editar etiquetas':'Edit labels')+CL+'h3>'
          +'<div id="roles-modal-list" class="ts-roles-modal-list">'+CL+'div>'
          +'<div style="display:flex;gap:6px;margin:12px 0"><input type="text" class="wizard-input" id="roles-modal-input" placeholder="'+(lang==='es'?'Nueva etiqueta + Enter':'New label + Enter')+'" onkeydown="if(event.keyCode===13){event.preventDefault();addRoleFromModal()}" style="flex:1"><button type="button" class="wizard-btn wizard-btn-primary" onclick="addRoleFromModal()" style="padding:8px 16px">'+(lang==='es'?'Agregar':'Add')+CL+'button>'+CL+'div>'
          +'<div class="ts-modal-actions"><button type="button" class="act-btn act-btn-config" onclick="closeRolesModal()">'+(lang==='es'?'Cerrar':'Close')+CL+'button>'+CL+'div>'
          +CL+'div>';
        document.body.appendChild(overlay);
      } else {overlay.classList.add('open')}
      renderRolesModalList(roles);
    };
    function renderRolesModalList(roles){
      var list=document.getElementById('roles-modal-list');
      if(!list)return;
      if(roles.length===0){list.innerHTML='<div class="ts-roles-empty">'+(lang==='es'?'No hay etiquetas':'No labels')+CL+'div>';return}
      list.innerHTML=roles.map(function(r,i){
        return '<div class="ts-role-row-edit">'
          +'<input type="text" class="wizard-input" value="'+r.replace(/"/g,'&quot;')+'" data-role-idx="'+i+'" style="flex:1;font-size:13px;padding:6px 10px" onchange="renameRole('+i+',this.value)">'
          +'<button type="button" class="ts-role-delete-btn" onclick="deleteRole('+i+')" title="'+(lang==='es'?'Eliminar':'Delete')+'">&times;'+CL+'button>'
          +CL+'div>'
      }).join('');
    }
    function getCurrentRoles(){
      var hidden=document.getElementById('coworker-roles-hidden');
      return (hidden&&hidden.value)?hidden.value.split(',').filter(Boolean):[];
    }
    function saveRolesToHidden(roles){
      var hidden=document.getElementById('coworker-roles-hidden');
      if(hidden){hidden.value=roles.join(',');hidden.dispatchEvent(new Event('input',{bubbles:true}))}
      var listEl=document.getElementById('coworker-roles-list');
      if(listEl){
        listEl.innerHTML=roles.length>0?roles.map(function(r){
          return '<div class="ts-role-row"><span class="ts-role-name">'+r.split('<').join('&lt;')+CL+'span>'+CL+'div>'
        }).join(''):'<div class="ts-roles-empty">'+(lang==='es'?'No hay etiquetas definidas.':'No labels defined.')+CL+'div>';
      }
    }
    window.addRoleFromModal=function(){
      var inp=document.getElementById('roles-modal-input');
      if(!inp)return;var val=inp.value.trim();if(!val)return;
      var roles=getCurrentRoles();roles.push(val);
      saveRolesToHidden(roles);renderRolesModalList(roles);inp.value='';inp.focus();
    };
    window.renameRole=function(idx,newName){
      var roles=getCurrentRoles();
      if(idx>=0&&idx<roles.length&&newName.trim()){roles[idx]=newName.trim();saveRolesToHidden(roles)}
    };
    window.deleteRole=function(idx){
      var roles=getCurrentRoles();
      if(idx>=0&&idx<roles.length){roles.splice(idx,1);saveRolesToHidden(roles);renderRolesModalList(roles)}
    };
    window.closeRolesModal=function(){
      var overlay=document.getElementById('roles-modal-overlay');
      if(overlay)overlay.classList.remove('open');
    };

    // ── Webhook helpers ──
    window.regenerateWebhookToken=function(){
      fetch('/console/api/users/webhook/regenerate-token',{method:'POST'}).then(function(r){return r.json()}).then(function(d){
        if(d.token){
          var display=document.getElementById('webhook-token-display');
          if(display)display.textContent=d.token;
          var hidden=document.querySelector('[name=webhook_token_lead]');
          if(hidden){hidden.value=d.token;hidden.dispatchEvent(new Event('input',{bubbles:true}))}
          showToast(lang==='es'?'Token regenerado':'Token regenerated');
        }
      });
    };
    // copyWizardUri fallback (if console-minimal.js hasn't loaded yet)
    if(!window.copyWizardUri){
      window.copyWizardUri=function(btn){
        var box=btn.closest('.wizard-uri-box');
        var code=box?box.querySelector('.wizard-uri'):null;
        if(!code)return;
        navigator.clipboard.writeText(code.textContent).then(function(){
          btn.classList.add('copied');setTimeout(function(){btn.classList.remove('copied')},1500);
        });
      };
    }

    // ── Deactivation modal ──
    window.openDeactModal=function(lt,name){
      _deactLt=lt;_deactName=name;
      document.getElementById('cb-deact-action').selectedIndex=0;
      document.getElementById('cb-deact-step1').classList.add('active');
      document.getElementById('cb-deact-step2').classList.remove('active');
      document.getElementById('cb-deact-overlay').classList.add('open');
      if(typeof initCustomSelects==='function')initCustomSelects();
    };
    window.closeDeactModal=function(){
      document.getElementById('cb-deact-overlay').classList.remove('open');
    };
    window.deactNextStep=function(){
      var action=document.getElementById('cb-deact-action').value;
      if(!action){alert(lang==='es'?'Selecciona una opcion.':'Select an option.');return}
      var actionText={silence:lang==='es'?'registrar sin respuesta':'register without response',leads:lang==='es'?'mover a Leads':'move to Leads',unregistered:lang==='es'?'tratar como contacto nuevo en la proxima interaccion':'treat as new contact on next interaction'};
      var msg=lang==='es'
        ?'Estas a punto de desactivar la base "'+_deactName+'". Accion: '+actionText[action]+'. Esta accion se puede revertir reactivando la base.'
        :'You are about to deactivate the base "'+_deactName+'". Action: '+actionText[action]+'. This action can be reversed by reactivating the base.';
      document.getElementById('cb-deact-confirm-msg').textContent=msg;
      document.getElementById('cb-deact-step1').classList.remove('active');
      document.getElementById('cb-deact-step2').classList.add('active');
    };
    window.deactBackStep=function(){
      document.getElementById('cb-deact-step2').classList.remove('active');
      document.getElementById('cb-deact-step1').classList.add('active');
    };
    window.confirmDeactivation=function(){
      var action=document.getElementById('cb-deact-action').value;
      submitListToggle(_deactLt,false,action,'');
    };

    // ── Perm sync: checkbox → hidden field → dirty tracking ──
    document.querySelectorAll('.cb-config-panel .perm-cb').forEach(function(cb){
      cb.addEventListener('change',function(){
        var hName=cb.getAttribute('data-hidden');
        if(!hName)return;
        var h=document.querySelector('input[name="'+hName+'"]');
        if(h){h.value=cb.checked?'on':'';h.dispatchEvent(new Event('input',{bubbles:true}))}
      });
    });

    // ── Admin: force all checkboxes disabled (belt + suspenders) ──
    document.querySelectorAll('#cb-config-admin input[type="checkbox"]').forEach(function(cb){
      cb.disabled=true;
      cb.checked=true;
    });

    // Replace {BASE_URL} placeholders in wizard-uri elements
    document.querySelectorAll('.wizard-uri').forEach(function(el){
      if(el.textContent.indexOf('{BASE_URL}')!==-1){
        el.textContent=el.textContent.replace(/\{BASE_URL\}/g,location.origin);
      }
    });

    if(typeof initCustomSelects==='function')initCustomSelects();
  })()</script>`

  } // end isConfigPage

  return html + '</div>'
}
