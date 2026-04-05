// LUNA — Setup wizard: SSR templates
// Full-page wizard layout (no sidebar — console not loaded yet).
// 5 steps: language → admin → agent persona → API keys → system + summary

import { st, type SetupLang } from './i18n.js'

function esc(s: string): string {
  return String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;')
}

// ═══════════════════════════════════════════
// Wizard state types
// ═══════════════════════════════════════════

export interface SetupState {
  lang: SetupLang
  adminName: string
  adminEmail: string
  adminPhone: string
  adminPassword: string
  // Agent persona
  agentName: string
  agentLastName: string
  agentTitle: string
  agentLanguage: string
  agentAccent: string
  // API keys (both providers — no model/provider selection)
  anthropicApiKey: string
  googleApiKey: string
  companyName: string
}

export function emptyState(): SetupState {
  return {
    lang: 'es',
    adminName: '',
    adminEmail: '',
    adminPhone: '',
    adminPassword: '',
    agentName: 'Luna',
    agentLastName: '',
    agentTitle: '',
    agentLanguage: 'es',
    agentAccent: '',
    anthropicApiKey: '',
    googleApiKey: '',
    companyName: '',
  }
}

export const TOTAL_STEPS = 5

// ═══════════════════════════════════════════
// CSS (inline — no dependency on console module)
// ═══════════════════════════════════════════

const WIZARD_CSS = `
  :root { --primary: #FF5E0E; --primary-hover: #e85400; --primary-light: rgba(255,94,14,0.08);
    --bg: #f5f5f7; --card: #ffffff; --text: #2d2d2d; --text-muted: #6e6e73; --text-dim: #86868b;
    --border: rgba(0,0,0,0.06); --error: #E62111; --success: #34c759; --radius: 0.75rem;
    --warning: #f59e0b; --warning-bg: rgba(245,158,11,0.08); }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: 'Montserrat', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    background: var(--bg); color: var(--text); min-height: 100vh;
    display: flex; align-items: center; justify-content: center; padding: 20px;
    -webkit-font-smoothing: antialiased; font-size: 0.875rem; line-height: 1.5; }
  @import url('https://fonts.googleapis.com/css2?family=Montserrat:wght@400;500;600;700&display=swap');
  a { color: var(--primary); } a:visited { color: var(--primary-hover); }
  .wizard { background: var(--card); border-radius: var(--radius); box-shadow: 0 4px 24px rgba(0,0,0,0.08);
    max-width: 560px; width: 100%; padding: 40px; }
  .wizard-logo { text-align: center; margin-bottom: 8px; }
  .wizard-logo h1 { font-size: 28px; color: var(--primary); letter-spacing: 2px; font-weight: 700; }
  .wizard-logo p { color: var(--text-dim); font-size: 13px; }
  .steps { display: flex; justify-content: center; gap: 8px; margin: 24px 0; }
  .step-dot { width: 10px; height: 10px; border-radius: 50%; background: var(--border); transition: all 0.2s; }
  .step-dot.active { background: var(--primary); transform: scale(1.3); }
  .step-dot.done { background: var(--success); }
  .step-label { text-align: center; color: var(--text-dim); font-size: 12px; font-weight: 500;
    text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 20px; }
  h2 { font-size: 1.15rem; font-weight: 700; margin-bottom: 6px; }
  .step-desc { color: var(--text-muted); font-size: 0.85rem; margin-bottom: 24px; line-height: 1.6; }
  .field { margin-bottom: 16px; }
  .field label { display: block; font-size: 0.8rem; font-weight: 600; margin-bottom: 4px; color: var(--text); }
  .field input, .field select { width: 100%; padding: 10px 12px; border: 1.5px solid #e0e0e2;
    border-radius: 0.5rem; font-size: 0.85rem; outline: none; transition: border-color 0.15s ease;
    background: var(--card); font-family: inherit; }
  .field input:focus, .field select:focus { border-color: var(--primary); box-shadow: 0 0 0 3px var(--primary-light); }
  .field .hint { font-size: 0.7rem; color: var(--text-dim); margin-top: 2px; }
  .field-error { border-color: var(--error) !important; }
  .error-msg { color: var(--error); font-size: 0.75rem; margin-top: 2px; }
  .global-error { background: rgba(230,33,17,0.06); border: 1px solid var(--error); border-radius: 0.5rem;
    padding: 10px 14px; color: var(--error); font-size: 0.8rem; margin-bottom: 16px; }
  .warning-box { background: var(--warning-bg); border: 1px solid var(--warning); border-radius: 0.5rem;
    padding: 10px 14px; font-size: 0.78rem; margin-bottom: 16px; color: #92400e; line-height: 1.5; }
  .btn-row { display: flex; justify-content: space-between; margin-top: 28px; gap: 12px; }
  .btn { padding: 10px 24px; border-radius: 1.5rem; font-size: 0.85rem; font-weight: 500;
    cursor: pointer; border: none; transition: all 0.15s ease; font-family: inherit; text-decoration: none; display: inline-block; }
  .btn-primary { background: var(--primary); color: white; }
  .btn-primary:hover { opacity: 0.9; box-shadow: 0 2px 8px rgba(255,94,14,0.3); }
  .btn-secondary { background: #eaeaec; color: var(--text); }
  .btn-secondary:hover { background: #e0e0e2; }
  .btn-full { width: 100%; }
  .lang-select { display: flex; gap: 12px; justify-content: center; margin: 20px 0; }
  .lang-option { padding: 12px 28px; border: 1.5px solid #e0e0e2; border-radius: 0.5rem;
    cursor: pointer; font-size: 0.85rem; font-weight: 500; transition: all 0.15s ease;
    background: none; font-family: inherit; }
  .lang-option:hover, .lang-option.selected { border-color: var(--primary); color: var(--primary);
    background: var(--primary-light); }
  .half-row { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
  .summary-table { width: 100%; font-size: 0.8rem; border-collapse: collapse; margin: 12px 0; }
  .summary-table td { padding: 8px 0; border-bottom: 1px solid #e0e0e2; }
  .summary-table td:first-child { color: var(--text-muted); width: 40%; }
  .success-check { font-size: 48px; text-align: center; margin: 20px 0; color: var(--success); }
`

// ═══════════════════════════════════════════
// Layout wrapper
// ═══════════════════════════════════════════

export function setupLayout(step: number, totalSteps: number, content: string, lang: SetupLang): string {
  const dots = Array.from({ length: totalSteps }, (_, i) => {
    const cls = i + 1 === step ? 'active' : i + 1 < step ? 'done' : ''
    return `<div class="step-dot ${cls}"></div>`
  }).join('')

  return `<!DOCTYPE html>
<html lang="${lang}">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>LUNA — Setup</title>
  <style>${WIZARD_CSS}</style>
</head>
<body>
  <div class="wizard">
    <div class="wizard-logo">
      <h1>LUNA</h1>
      <p>${esc(st('app_subtitle', lang))}</p>
    </div>
    <div class="steps">${dots}</div>
    <div class="step-label">${esc(st('step_of', lang, { n: step, total: totalSteps }))}</div>
    ${content}
  </div>
</body>
</html>`
}

// ═══════════════════════════════════════════
// Step 1: Welcome + Language
// ═══════════════════════════════════════════

export function stepWelcome(lang: SetupLang, state: SetupState): string {
  const content = `
    <h2>${esc(st('welcome_title', lang))}</h2>
    <p class="step-desc">${esc(st('welcome_text', lang))}</p>
    <form method="POST" action="/setup/step/1">
      <div class="field">
        <label>${esc(st('select_language', lang))}</label>
      </div>
      <div class="lang-select">
        <button type="submit" name="lang" value="es" class="lang-option ${state.lang === 'es' ? 'selected' : ''}">
          ${esc(st('lang_es', lang))}
        </button>
        <button type="submit" name="lang" value="en" class="lang-option ${state.lang === 'en' ? 'selected' : ''}">
          ${esc(st('lang_en', lang))}
        </button>
      </div>
    </form>`
  return setupLayout(1, TOTAL_STEPS, content, lang)
}

// ═══════════════════════════════════════════
// Step 2: Admin Account
// ═══════════════════════════════════════════

export function stepAdmin(lang: SetupLang, state: SetupState, errors?: Record<string, string>): string {
  const e = errors ?? {}
  const content = `
    <h2>${esc(st('admin_title', lang))}</h2>
    <p class="step-desc">${esc(st('admin_text', lang))}</p>
    <form method="POST" action="/setup/step/2">
      <div class="field">
        <label>${esc(st('admin_name', lang))} *</label>
        <input type="text" name="admin_name" value="${esc(state.adminName)}" required
          class="${e['admin_name'] ? 'field-error' : ''}">
        ${e['admin_name'] ? `<div class="error-msg">${esc(e['admin_name'])}</div>` : ''}
      </div>
      <div class="field">
        <label>${esc(st('admin_email', lang))} *</label>
        <input type="email" name="admin_email" value="${esc(state.adminEmail)}" required
          class="${e['admin_email'] ? 'field-error' : ''}">
        ${e['admin_email'] ? `<div class="error-msg">${esc(e['admin_email'])}</div>` : ''}
      </div>
      <div class="field">
        <label>${esc(st('admin_phone', lang))}</label>
        <input type="tel" name="admin_phone" value="${esc(state.adminPhone)}"
          placeholder="+1234567890"
          class="${e['admin_phone'] ? 'field-error' : ''}">
        ${e['admin_phone'] ? `<div class="error-msg">${esc(e['admin_phone'])}</div>` : ''}
      </div>
      <div class="field">
        <label>${esc(st('admin_password', lang))} *</label>
        <input type="password" name="admin_password" required minlength="8"
          class="${e['admin_password'] ? 'field-error' : ''}">
        ${e['admin_password'] ? `<div class="error-msg">${esc(e['admin_password'])}</div>` : ''}
      </div>
      <div class="field">
        <label>${esc(st('admin_password_confirm', lang))} *</label>
        <input type="password" name="admin_password_confirm" required minlength="8"
          class="${e['admin_password_confirm'] ? 'field-error' : ''}">
        ${e['admin_password_confirm'] ? `<div class="error-msg">${esc(e['admin_password_confirm'])}</div>` : ''}
      </div>
      <div class="btn-row">
        <a href="/setup/step/1" class="btn btn-secondary">${esc(st('back', lang))}</a>
        <button type="submit" class="btn btn-primary">${esc(st('next', lang))}</button>
      </div>
    </form>`
  return setupLayout(2, TOTAL_STEPS, content, lang)
}

// ═══════════════════════════════════════════
// Step 3: Agent Persona
// ═══════════════════════════════════════════

/** Language options for agent (matches prompts module configSchema) */
const AGENT_LANGUAGES = [
  { value: 'es', label: 'Espanol / Spanish' },
  { value: 'en', label: 'English / Ingles' },
]

/** Accent options grouped by language */
const ACCENT_OPTIONS: Record<string, { value: string; label: string }[]> = {
  es: [
    { value: '', label: 'Neutro / Neutral' },
    { value: 'es-MX', label: 'Mexico' },
    { value: 'es-CO', label: 'Colombia' },
    { value: 'es-EC', label: 'Ecuador' },
    { value: 'es-PE', label: 'Peru' },
    { value: 'es-CL', label: 'Chile' },
    { value: 'es-CAR', label: 'Caribe' },
  ],
  en: [
    { value: '', label: 'Neutral' },
    { value: 'en-US', label: 'USA' },
    { value: 'en-CAR', label: 'Caribbean' },
  ],
}

export function stepAgent(lang: SetupLang, state: SetupState, errors?: Record<string, string>): string {
  const e = errors ?? {}
  const langOptions = AGENT_LANGUAGES.map(o =>
    `<option value="${o.value}" ${state.agentLanguage === o.value ? 'selected' : ''}>${esc(o.label)}</option>`
  ).join('')

  // Build accent options based on selected agent language (fallback to 'es')
  const accentList = ACCENT_OPTIONS[state.agentLanguage] ?? ACCENT_OPTIONS['es']!
  const accentOptions = accentList.map(o =>
    `<option value="${o.value}" ${state.agentAccent === o.value ? 'selected' : ''}>${esc(o.label)}</option>`
  ).join('')

  const content = `
    <h2>${esc(st('agent_title', lang))}</h2>
    <p class="step-desc">${esc(st('agent_text', lang))}</p>
    ${e['_global'] ? `<div class="global-error">${esc(e['_global'])}</div>` : ''}
    <form method="POST" action="/setup/step/3">
      <div class="half-row">
        <div class="field">
          <label>${esc(st('agent_name', lang))} *</label>
          <input type="text" name="agent_name" value="${esc(state.agentName)}" required
            class="${e['agent_name'] ? 'field-error' : ''}">
          ${e['agent_name'] ? `<div class="error-msg">${esc(e['agent_name'])}</div>` : ''}
        </div>
        <div class="field">
          <label>${esc(st('agent_last_name', lang))}</label>
          <input type="text" name="agent_last_name" value="${esc(state.agentLastName)}">
        </div>
      </div>
      <div class="field">
        <label>${esc(st('agent_role', lang))}</label>
        <input type="text" name="agent_title" value="${esc(state.agentTitle)}"
          placeholder="${esc(st('agent_role_placeholder', lang))}">
        <div class="hint">${esc(st('agent_role_hint', lang))}</div>
      </div>
      <div class="half-row">
        <div class="field">
          <label>${esc(st('agent_language', lang))}</label>
          <select name="agent_language" id="agent-language-select">${langOptions}</select>
          <div class="hint">${esc(st('agent_language_hint', lang))}</div>
        </div>
        <div class="field">
          <label>${esc(st('agent_accent', lang))}</label>
          <select name="agent_accent" id="agent-accent-select">${accentOptions}</select>
        </div>
      </div>
      <div class="warning-box">${st('agent_accent_warning', lang)}</div>
      <div class="btn-row">
        <a href="/setup/step/2" class="btn btn-secondary">${esc(st('back', lang))}</a>
        <button type="submit" class="btn btn-primary">${esc(st('next', lang))}</button>
      </div>
    </form>
    <script>
      // When agent language changes, update accent options dynamically
      const accentData = ${JSON.stringify(ACCENT_OPTIONS)};
      const langSel = document.getElementById('agent-language-select');
      const accentSel = document.getElementById('agent-accent-select');
      if (langSel && accentSel) {
        langSel.addEventListener('change', () => {
          const opts = accentData[langSel.value] || [];
          accentSel.innerHTML = opts.map(o =>
            '<option value="' + o.value + '">' + o.label + '</option>'
          ).join('');
        });
      }
    </script>`
  return setupLayout(3, TOTAL_STEPS, content, lang)
}

// ═══════════════════════════════════════════
// Step 4: API Keys
// ═══════════════════════════════════════════

export function stepApiKeys(lang: SetupLang, state: SetupState, errors?: Record<string, string>): string {
  const e = errors ?? {}
  const content = `
    <h2>${esc(st('api_title', lang))}</h2>
    <p class="step-desc">${esc(st('api_text', lang))}</p>
    ${e['_global'] ? `<div class="global-error">${esc(e['_global'])}</div>` : ''}
    <form method="POST" action="/setup/step/4">
      <div class="field">
        <label>${esc(st('llm_anthropic_key', lang))}</label>
        <input type="password" name="anthropic_api_key" value="${esc(state.anthropicApiKey)}"
          placeholder="sk-ant-..."
          class="${e['anthropic_api_key'] ? 'field-error' : ''}">
        ${e['anthropic_api_key'] ? `<div class="error-msg">${esc(e['anthropic_api_key'])}</div>` : ''}
        <div class="hint">${esc(st('api_anthropic_hint', lang))}</div>
      </div>
      <div class="field">
        <label>${esc(st('llm_google_key', lang))}</label>
        <input type="password" name="google_api_key" value="${esc(state.googleApiKey)}"
          placeholder="AIza..."
          class="${e['google_api_key'] ? 'field-error' : ''}">
        ${e['google_api_key'] ? `<div class="error-msg">${esc(e['google_api_key'])}</div>` : ''}
        <div class="hint">${esc(st('api_google_hint', lang))}</div>
      </div>
      <div class="btn-row">
        <a href="/setup/step/3" class="btn btn-secondary">${esc(st('back', lang))}</a>
        <button type="submit" class="btn btn-primary">${esc(st('next', lang))}</button>
      </div>
    </form>`
  return setupLayout(4, TOTAL_STEPS, content, lang)
}

// ═══════════════════════════════════════════
// Step 5: System Settings + Summary
// ═══════════════════════════════════════════

export function stepSystem(lang: SetupLang, state: SetupState, errors?: Record<string, string>): string {
  const e = errors ?? {}
  const agentFullName = [state.agentName, state.agentLastName].filter(Boolean).join(' ')
  const agentLangLabel = AGENT_LANGUAGES.find(o => o.value === state.agentLanguage)?.label ?? state.agentLanguage
  const accentList = ACCENT_OPTIONS[state.agentLanguage] ?? []
  const accentLabel = state.agentAccent
    ? (accentList.find(o => o.value === state.agentAccent)?.label ?? state.agentAccent)
    : st('agent_no_accent', lang)

  const content = `
    <h2>${esc(st('system_title', lang))}</h2>
    <p class="step-desc">${esc(st('system_text', lang))}</p>
    ${e['_global'] ? `<div class="global-error">${esc(e['_global'])}</div>` : ''}
    <form method="POST" action="/setup/step/5">
      <div class="field">
        <label>${esc(st('company_name', lang))} *</label>
        <input type="text" name="company_name" value="${esc(state.companyName)}" required
          placeholder="${esc(st('company_name_placeholder', lang))}"
          class="${e['company_name'] ? 'field-error' : ''}">
        ${e['company_name'] ? `<div class="error-msg">${esc(e['company_name'])}</div>` : ''}
        <div class="hint">${esc(st('company_name_hint', lang))}</div>
      </div>

      <h3 style="margin-top:24px; font-size:15px;">${esc(st('summary_title', lang))}</h3>
      <table class="summary-table">
        <tr><td>${esc(st('summary_admin', lang))}</td><td>${esc(state.adminName)} (${esc(state.adminEmail)})</td></tr>
        <tr><td>${esc(st('summary_agent', lang))}</td><td>${esc(agentFullName)}${state.agentTitle ? ` \u2014 ${esc(state.agentTitle)}` : ''}</td></tr>
        <tr><td>${esc(st('summary_agent_lang', lang))}</td><td>${esc(agentLangLabel)}</td></tr>
        <tr><td>${esc(st('summary_agent_accent', lang))}</td><td>${esc(accentLabel)}</td></tr>
        ${state.anthropicApiKey ? `<tr><td>Anthropic API Key</td><td>${esc(st('summary_masked', lang))}</td></tr>` : ''}
        ${state.googleApiKey ? `<tr><td>Google AI API Key</td><td>${esc(st('summary_masked', lang))}</td></tr>` : ''}
      </table>

      <div class="btn-row">
        <a href="/setup/step/4" class="btn btn-secondary">${esc(st('back', lang))}</a>
        <button type="submit" class="btn btn-primary">${esc(st('finish', lang))}</button>
      </div>
    </form>`
  return setupLayout(5, TOTAL_STEPS, content, lang)
}

// ═══════════════════════════════════════════
// Setup complete page
// ═══════════════════════════════════════════

export function setupCompletePage(lang: SetupLang): string {
  const content = `
    <div class="success-check">&#10003;</div>
    <h2 style="text-align:center;">${esc(st('setup_complete_title', lang))}</h2>
    <p class="step-desc" style="text-align:center;">${esc(st('setup_complete_text', lang))}</p>

    <div class="warning-box" style="margin-top:20px;">
      <strong>${esc(st('setup_defaults_title', lang))}</strong><br>
      ${esc(st('setup_defaults_messages', lang))}<br><br>
      ${esc(st('setup_defaults_change', lang))}<br>
      <a href="/console/contacts?page=config&lang=${lang}" style="font-weight:600;">${esc(st('setup_defaults_link', lang))}</a>
    </div>

    <div class="btn-row" style="justify-content:center; margin-top:20px;">
      <a href="/console" class="btn btn-primary">${esc(st('go_to_console', lang))}</a>
    </div>
    <script>setTimeout(() => window.location.href = '/console', 8000);</script>`
  return `<!DOCTYPE html>
<html lang="${lang}">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>LUNA \u2014 Setup Complete</title>
  <style>${WIZARD_CSS}</style>
</head>
<body>
  <div class="wizard">${content}</div>
</body>
</html>`
}
