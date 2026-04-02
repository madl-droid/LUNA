// medilink/templates.ts — SSR HTML for console section
// Renders: professional-treatment mapping, follow-up templates management

type Lang = 'es' | 'en'

const t = (key: string, lang: Lang): string => labels[lang]?.[key] ?? labels.es[key] ?? key

const labels: Record<Lang, Record<string, string>> = {
  es: {
    sec_webhook: 'URL del Webhook',
    sec_webhook_info: 'Copia esta URL y pégala en Medilink (Configuración → Webhooks). También configura las claves pública y privada en los campos de arriba.',
    webhook_step1: 'En Medilink, ir a <strong>Configuración → Integraciones → Webhooks</strong>',
    webhook_step2: 'Crear un nuevo webhook con esta URL:',
    webhook_step3: 'En el campo <strong>Token público</strong>, pegar el valor de <strong>Webhook clave pública</strong> de arriba.',
    webhook_step4: 'En el campo <strong>Clave privada / Secret</strong>, pegar el valor de <strong>Webhook clave privada</strong> de arriba.',
    webhook_step5: 'Activar los eventos: <strong>cita:creada</strong>, <strong>cita:modificada</strong>, <strong>cita:eliminada</strong>.',
    sec_professionals: 'Profesionales y Prestaciones',
    sec_professionals_info: 'Marca qué profesionales atienden valoraciones (pacientes nuevos) y qué prestaciones realiza cada uno. Esto se usa para filtrar disponibilidad al agendar por WhatsApp.',
    col_professional: 'Profesional',
    col_specialty: 'Especialidad',
    col_valoraciones: 'Valoraciones',
    col_treatments: 'Prestaciones habilitadas',
    btn_save_rules: 'Guardar reglas',
    no_professionals: 'No hay profesionales cargados. Verifica la conexión con Medilink y recarga los datos de referencia.',
    no_treatments: 'No hay tratamientos cargados.',
    saving: 'Guardando...',
    saved: 'Reglas guardadas',
    error_saving: 'Error al guardar',
    sec_followup: 'Plantillas de seguimiento',
    sec_followup_info: 'Edita el mensaje de cada toque de seguimiento. Los toques se ejecutan automáticamente según los tiempos configurados arriba.',
    touch_0: 'Confirmación inmediata',
    touch_1: 'Llamada (7 días antes)',
    touch_1_fallback_a: 'Fallback WhatsApp',
    touch_1_fallback_b: '2da llamada',
    touch_3: 'Instrucciones (24h)',
    touch_4: 'Recordatorio (3h)',
    no_show_1: 'No asistió (1er aviso)',
    no_show_2: 'No asistió (2do aviso)',
    reactivation: 'Reactivación',
    btn_save_templates: 'Guardar plantillas',
    col_touch: 'Toque',
    col_channel: 'Canal',
    col_template: 'Mensaje',
    col_use_llm: 'Personalizar con IA',
  },
  en: {
    sec_webhook: 'Webhook URL',
    sec_webhook_info: 'Copy this URL and paste it in Medilink (Settings → Webhooks). Also configure the public and private keys in the fields above.',
    webhook_step1: 'In Medilink, go to <strong>Settings → Integrations → Webhooks</strong>',
    webhook_step2: 'Create a new webhook with this URL:',
    webhook_step3: 'In the <strong>Public token</strong> field, paste the value from <strong>Webhook public key</strong> above.',
    webhook_step4: 'In the <strong>Private key / Secret</strong> field, paste the value from <strong>Webhook private key</strong> above.',
    webhook_step5: 'Enable events: <strong>cita:creada</strong>, <strong>cita:modificada</strong>, <strong>cita:eliminada</strong>.',
    sec_professionals: 'Professionals & Treatments',
    sec_professionals_info: 'Mark which professionals handle evaluations (new patients) and which treatments each one performs. This filters availability when scheduling via WhatsApp.',
    col_professional: 'Professional',
    col_specialty: 'Specialty',
    col_valoraciones: 'Evaluations',
    col_treatments: 'Enabled treatments',
    btn_save_rules: 'Save rules',
    no_professionals: 'No professionals loaded. Check the Medilink connection and refresh reference data.',
    no_treatments: 'No treatments loaded.',
    saving: 'Saving...',
    saved: 'Rules saved',
    error_saving: 'Error saving',
    sec_followup: 'Follow-up Templates',
    sec_followup_info: 'Edit the message for each follow-up touch. Touches execute automatically based on the timing configured above.',
    touch_0: 'Immediate confirmation',
    touch_1: 'Call (7 days before)',
    touch_1_fallback_a: 'WhatsApp fallback',
    touch_1_fallback_b: '2nd call',
    touch_3: 'Instructions (24h)',
    touch_4: 'Reminder (3h)',
    no_show_1: 'No-show (1st notice)',
    no_show_2: 'No-show (2nd notice)',
    reactivation: 'Reactivation',
    btn_save_templates: 'Save templates',
    col_touch: 'Touch',
    col_channel: 'Channel',
    col_template: 'Message',
    col_use_llm: 'Personalize with AI',
  },
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

interface Professional { id: number; nombre: string; apellidos: string; especialidad: string | null; habilitado: boolean }
interface Treatment { id: number; nombre: string }
interface ProfTreatmentRule { medilinkProfessionalId: number; medilinkTreatmentId: number }
interface UserTypeRule { userType: string; medilinkTreatmentId: number; allowed: boolean }
interface FollowUpTemplate { touchType: string; templateText: string; useLlm: boolean; channel: string }

export interface MedilinkConsoleData {
  professionals: Professional[]
  treatments: Treatment[]
  profRules: ProfTreatmentRule[]
  userTypeRules: UserTypeRule[]
  templates: FollowUpTemplate[]
}

export function renderMedilinkConsole(data: MedilinkConsoleData, lang: Lang): string {
  return renderWebhookPanel(lang) + renderProfessionalSection(data, lang) + renderFollowUpSection(data, lang)
}

// ─── Webhook URL panel ───────────────────

function renderWebhookPanel(lang: Lang): string {
  const COPY_ICON = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>`
  const webhookPath = '/console/api/medilink/webhook'
  return `
<div class="panel">
  <div class="panel-header">${esc(t('sec_webhook', lang))}</div>
  <div class="panel-body">
    <p style="margin:0 0 14px">${t('sec_webhook_info', lang)}</p>
    <ol class="wizard-steps" style="margin:0 0 4px;padding-left:20px;line-height:2">
      <li>${t('webhook_step1', lang)}</li>
      <li>${t('webhook_step2', lang)}
        <div class="wizard-uri-box" style="margin:6px 0">
          <code class="wizard-uri" id="ml-webhook-url">${esc(webhookPath)}</code>
          <button type="button" class="wizard-copy-icon" onclick="copyWizardUri(this)" title="${lang === 'es' ? 'Copiar' : 'Copy'}">${COPY_ICON}</button>
        </div>
        <script>
          (function(){
            var el = document.getElementById('ml-webhook-url');
            if (el) el.textContent = location.origin + '${webhookPath}';
          })();
        </script>
      </li>
      <li>${t('webhook_step3', lang)}</li>
      <li>${t('webhook_step4', lang)}</li>
      <li>${t('webhook_step5', lang)}</li>
    </ol>
  </div>
</div>`
}

// ─── Professional-Treatment mapping ─────

function renderProfessionalSection(data: MedilinkConsoleData, lang: Lang): string {
  const activeProfessionals = data.professionals.filter(p => p.habilitado)

  if (activeProfessionals.length === 0) {
    return `<div class="panel" style="margin-top:1.5rem">
      <div class="panel-header"><h3>${t('sec_professionals', lang)}</h3></div>
      <div class="panel-body"><p class="panel-info">${t('no_professionals', lang)}</p></div>
    </div>`
  }

  // Build set of currently enabled rules
  const ruleSet = new Set(data.profRules.map(r => `${r.medilinkProfessionalId}:${r.medilinkTreatmentId}`))

  let h = `
  <div class="panel" style="margin-top:1.5rem">
    <div class="panel-header"><h3>${t('sec_professionals', lang)}</h3></div>
    <div class="panel-body">
      <p class="panel-info">${t('sec_professionals_info', lang)}</p>
      <div id="medilink-prof-rules" style="overflow-x:auto">
        <table class="data-table" style="width:100%;font-size:0.85rem">
          <thead>
            <tr>
              <th style="min-width:160px">${t('col_professional', lang)}</th>
              <th style="min-width:100px">${t('col_specialty', lang)}</th>
              <th style="min-width:80px;text-align:center">${t('col_valoraciones', lang)}</th>`

  // One column per treatment
  for (const tr of data.treatments) {
    h += `<th style="min-width:60px;text-align:center;font-size:0.75rem;writing-mode:vertical-lr;transform:rotate(180deg);height:100px">${esc(tr.nombre)}</th>`
  }

  h += `</tr></thead><tbody>`

  for (const prof of activeProfessionals) {
    const profName = `${prof.nombre} ${prof.apellidos}`
    // Check if this prof attends valoraciones (new patients): look for userTypeRule with userType='nuevo'
    const attendsNew = data.userTypeRules.some(r =>
      r.userType === 'nuevo' && r.allowed && data.profRules.some(pr =>
        pr.medilinkProfessionalId === prof.id && pr.medilinkTreatmentId === r.medilinkTreatmentId,
      ),
    )

    h += `<tr>
      <td><strong>${esc(profName)}</strong></td>
      <td>${esc(prof.especialidad ?? '-')}</td>
      <td style="text-align:center">
        <input type="checkbox" class="medilink-valoracion" data-prof-id="${prof.id}" ${attendsNew ? 'checked' : ''}>
      </td>`

    for (const tr of data.treatments) {
      const key = `${prof.id}:${tr.id}`
      const checked = ruleSet.has(key) ? 'checked' : ''
      h += `<td style="text-align:center">
        <input type="checkbox" class="medilink-rule" data-prof-id="${prof.id}" data-treat-id="${tr.id}" ${checked}>
      </td>`
    }
    h += '</tr>'
  }

  h += `</tbody></table></div>
      <div style="margin-top:1rem;text-align:right">
        <button class="btn btn-primary" id="medilink-save-rules" onclick="saveMedilinkRules()">${t('btn_save_rules', lang)}</button>
      </div>
    </div>
  </div>
  <script>
  function saveMedilinkRules() {
    var btn = document.getElementById('medilink-save-rules');
    btn.disabled = true; btn.textContent = '${t('saving', lang)}';

    var rules = [];
    document.querySelectorAll('.medilink-rule:checked').forEach(function(el) {
      rules.push({ medilinkProfessionalId: parseInt(el.dataset.profId), medilinkTreatmentId: parseInt(el.dataset.treatId) });
    });

    var valoraciones = [];
    document.querySelectorAll('.medilink-valoracion:checked').forEach(function(el) {
      valoraciones.push(parseInt(el.dataset.profId));
    });

    fetch('/console/api/medilink/scheduling-rules', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ profRules: rules, valoracionProfIds: valoraciones })
    }).then(function(r) {
      if (r.ok) {
        btn.textContent = '${t('saved', lang)}';
        setTimeout(function() { btn.textContent = '${t('btn_save_rules', lang)}'; btn.disabled = false; }, 2000);
      } else {
        btn.textContent = '${t('error_saving', lang)}';
        btn.disabled = false;
      }
    }).catch(function() {
      btn.textContent = '${t('error_saving', lang)}';
      btn.disabled = false;
    });
  }
  </script>`

  return h
}

// ─── Follow-up templates ────────────────

const TOUCH_ORDER = [
  'touch_0', 'touch_1', 'touch_1_fallback_a', 'touch_1_fallback_b',
  'touch_3', 'touch_4', 'no_show_1', 'no_show_2', 'reactivation',
]

function renderFollowUpSection(data: MedilinkConsoleData, lang: Lang): string {
  const templateMap = new Map(data.templates.map(t => [t.touchType, t]))

  let h = `
  <div class="panel" style="margin-top:1.5rem">
    <div class="panel-header"><h3>${t('sec_followup', lang)}</h3></div>
    <div class="panel-body">
      <p class="panel-info">${t('sec_followup_info', lang)}</p>
      <div style="overflow-x:auto">
        <table class="data-table" style="width:100%;font-size:0.85rem">
          <thead>
            <tr>
              <th style="min-width:140px">${t('col_touch', lang)}</th>
              <th style="min-width:70px">${t('col_channel', lang)}</th>
              <th style="min-width:300px">${t('col_template', lang)}</th>
              <th style="min-width:60px;text-align:center">${t('col_use_llm', lang)}</th>
            </tr>
          </thead>
          <tbody>`

  for (const touchType of TOUCH_ORDER) {
    const tmpl = templateMap.get(touchType)
    const text = tmpl?.templateText ?? ''
    const channel = tmpl?.channel ?? (touchType === 'touch_1' || touchType === 'touch_1_fallback_b' ? 'voice' : 'whatsapp')
    const useLlm = tmpl?.useLlm ?? false
    const touchLabel = t(touchType, lang) || touchType

    h += `<tr>
      <td><strong>${esc(touchLabel)}</strong></td>
      <td>
        <select class="medilink-tmpl-channel" data-touch="${esc(touchType)}" style="font-size:0.8rem;padding:2px 4px">
          <option value="whatsapp" ${channel === 'whatsapp' ? 'selected' : ''}>WhatsApp</option>
          <option value="voice" ${channel === 'voice' ? 'selected' : ''}>Voz</option>
        </select>
      </td>
      <td>
        <textarea class="medilink-tmpl-text" data-touch="${esc(touchType)}" rows="2" style="width:100%;font-size:0.8rem;resize:vertical">${esc(text)}</textarea>
      </td>
      <td style="text-align:center">
        <input type="checkbox" class="medilink-tmpl-llm" data-touch="${esc(touchType)}" ${useLlm ? 'checked' : ''}>
      </td>
    </tr>`
  }

  h += `</tbody></table></div>
      <div style="margin-top:1rem;text-align:right">
        <button class="btn btn-primary" id="medilink-save-templates" onclick="saveMedilinkTemplates()">${t('btn_save_templates', lang)}</button>
      </div>
    </div>
  </div>
  <script>
  function saveMedilinkTemplates() {
    var btn = document.getElementById('medilink-save-templates');
    btn.disabled = true; btn.textContent = '${t('saving', lang)}';

    var templates = [];
    document.querySelectorAll('.medilink-tmpl-text').forEach(function(el) {
      var touch = el.dataset.touch;
      var channel = document.querySelector('.medilink-tmpl-channel[data-touch="' + touch + '"]').value;
      var useLlm = document.querySelector('.medilink-tmpl-llm[data-touch="' + touch + '"]').checked;
      templates.push({ touchType: touch, templateText: el.value, channel: channel, useLlm: useLlm });
    });

    fetch('/console/api/medilink/templates', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ templates: templates })
    }).then(function(r) {
      if (r.ok) {
        btn.textContent = '${t('saved', lang)}';
        setTimeout(function() { btn.textContent = '${t('btn_save_templates', lang)}'; btn.disabled = false; }, 2000);
      } else {
        btn.textContent = '${t('error_saving', lang)}';
        btn.disabled = false;
      }
    }).catch(function() {
      btn.textContent = '${t('error_saving', lang)}';
      btn.disabled = false;
    });
  }
  </script>`

  return h
}
