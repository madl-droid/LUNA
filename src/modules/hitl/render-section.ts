// hitl/render-section.ts — Console HTML for HITL panel in Agente > Advanced

/**
 * Render the HITL configuration panel for Agente > Advanced page.
 * Called from templates-sections.ts:renderAdvancedAgentSection().
 *
 * @param config - Current config values
 * @param lang - 'es' or 'en'
 */
export function renderHitlSection(
  config: Record<string, string>,
  lang: 'es' | 'en',
): string {
  const cv = (key: string): string => config[key] ?? ''

  const title = lang === 'es' ? 'Human-in-the-Loop (HITL)' : 'Human-in-the-Loop (HITL)'
  const info = lang === 'es'
    ? 'Sistema de consulta humana y escalamiento. El agente solicita ayuda a Admins o Coworkers cuando necesita autorizacion o conocimiento especializado.'
    : 'Human consultation and escalation system. The agent requests help from Admins or Coworkers when it needs authorization or specialized knowledge.'

  const enabledChecked = cv('HITL_ENABLED') !== 'false' ? 'checked' : ''
  const enabledVal = cv('HITL_ENABLED') !== 'false' ? 'true' : 'false'

  const channelOptions = [
    { value: 'auto', label: lang === 'es' ? 'Automatico' : 'Automatic' },
    { value: 'whatsapp', label: 'WhatsApp' },
    { value: 'email', label: 'Email' },
    { value: 'google-chat', label: 'Google Chat' },
  ]
  const channelVal = cv('HITL_DEFAULT_CHANNEL') || 'auto'
  const channelOpts = channelOptions.map(o =>
    `<option value="${esc(o.value)}" ${o.value === channelVal ? 'selected' : ''}>${esc(o.label)}</option>`,
  ).join('')

  const expireChecked = cv('HITL_AUTO_EXPIRE_NOTIFY') !== 'false' ? 'checked' : ''
  const expireVal = cv('HITL_AUTO_EXPIRE_NOTIFY') !== 'false' ? 'true' : 'false'

  return `<div class="panel">
    <div class="panel-header" onclick="togglePanel(this)">
      <span class="panel-title">${title}</span>
      <span class="panel-chevron">&#9660;</span>
    </div>
    <div class="panel-body">
      <div class="panel-info">${info}</div>

      <div class="toggle-field">
        <span class="field-label">${lang === 'es' ? 'HITL habilitado' : 'HITL enabled'}</span>
        <label class="toggle"><input type="checkbox" name="HITL_ENABLED" value="true" ${enabledChecked} data-original="${esc(enabledVal)}"><span class="toggle-slider"></span></label>
        <input type="hidden" name="HITL_ENABLED" value="${esc(enabledVal)}" data-original="${esc(enabledVal)}">
      </div>

      <div class="field">
        <div class="field-left"><span class="field-label">${lang === 'es' ? 'Canal preferido' : 'Preferred channel'}</span></div>
        <select class="js-custom-select" name="HITL_DEFAULT_CHANNEL" data-original="${esc(channelVal)}">${channelOpts}</select>
      </div>

      <div class="field">
        <div class="field-left"><span class="field-label">${lang === 'es' ? 'TTL ticket (horas)' : 'Ticket TTL (hours)'}</span></div>
        <input type="text" inputmode="numeric" name="HITL_TICKET_TTL_HOURS" value="${esc(cv('HITL_TICKET_TTL_HOURS') || '24')}" data-original="${esc(cv('HITL_TICKET_TTL_HOURS') || '24')}">
      </div>

      <div class="field">
        <div class="field-left"><span class="field-label">${lang === 'es' ? 'Intervalo follow-up (min)' : 'Follow-up interval (min)'}</span></div>
        <input type="text" inputmode="numeric" name="HITL_FOLLOWUP_INTERVAL_MIN" value="${esc(cv('HITL_FOLLOWUP_INTERVAL_MIN') || '30')}" data-original="${esc(cv('HITL_FOLLOWUP_INTERVAL_MIN') || '30')}">
      </div>

      <div class="field">
        <div class="field-left"><span class="field-label">${lang === 'es' ? 'Max follow-ups' : 'Max follow-ups'}</span></div>
        <input type="text" inputmode="numeric" name="HITL_MAX_FOLLOWUPS" value="${esc(cv('HITL_MAX_FOLLOWUPS') || '3')}" data-original="${esc(cv('HITL_MAX_FOLLOWUPS') || '3')}">
      </div>

      <div class="toggle-field">
        <span class="field-label">${lang === 'es' ? 'Notificar al expirar' : 'Notify on expiry'}</span>
        <label class="toggle"><input type="checkbox" name="HITL_AUTO_EXPIRE_NOTIFY" value="true" ${expireChecked} data-original="${esc(expireVal)}"><span class="toggle-slider"></span></label>
        <input type="hidden" name="HITL_AUTO_EXPIRE_NOTIFY" value="${esc(expireVal)}" data-original="${esc(expireVal)}">
      </div>
    </div>
  </div>`
}

function esc(s: string): string {
  return String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;')
}
