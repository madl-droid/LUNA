// LUNA — Setup wizard: SSR templates
// Full-page wizard layout (no sidebar — console not loaded yet).

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
  processingProvider: 'anthropic' | 'google'
  interactionProvider: 'anthropic' | 'google'
  anthropicApiKey: string
  googleApiKey: string
  instanceName: string
  logLevel: string
  nodeEnv: string
}

export function emptyState(): SetupState {
  return {
    lang: 'es',
    adminName: '',
    adminEmail: '',
    adminPhone: '',
    adminPassword: '',
    processingProvider: 'anthropic',
    interactionProvider: 'anthropic',
    anthropicApiKey: '',
    googleApiKey: '',
    instanceName: '',
    logLevel: 'info',
    nodeEnv: 'production',
  }
}

// ═══════════════════════════════════════════
// CSS (inline — no dependency on console module)
// ═══════════════════════════════════════════

const WIZARD_CSS = `
  :root { --primary: #FF5E0E; --primary-hover: #e85400; --primary-light: rgba(255,94,14,0.08);
    --bg: #f5f5f7; --card: #ffffff; --text: #2d2d2d; --text-muted: #6e6e73; --text-dim: #86868b;
    --border: rgba(0,0,0,0.06); --error: #E62111; --success: #34c759; --radius: 0.75rem; }
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
  .provider-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin: 8px 0 16px; }
  .provider-card { padding: 14px; border: 1.5px solid #e0e0e2; border-radius: 0.5rem; cursor: pointer;
    text-align: center; font-size: 0.8rem; font-weight: 600; transition: all 0.15s ease; }
  .provider-card:hover, .provider-card.selected { border-color: var(--primary); color: var(--primary);
    background: var(--primary-light); }
  .provider-card input[type=radio] { display: none; }
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
  return setupLayout(1, 4, content, lang)
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
  return setupLayout(2, 4, content, lang)
}

// ═══════════════════════════════════════════
// Step 3: LLM Configuration
// ═══════════════════════════════════════════

export function stepLLM(lang: SetupLang, state: SetupState, errors?: Record<string, string>): string {
  const e = errors ?? {}
  const content = `
    <h2>${esc(st('llm_title', lang))}</h2>
    <p class="step-desc">${esc(st('llm_text', lang))}</p>
    ${e['_global'] ? `<div class="global-error">${esc(e['_global'])}</div>` : ''}
    <form method="POST" action="/setup/step/3">
      <div class="field">
        <label>${esc(st('llm_processing_provider', lang))}</label>
        <div class="provider-grid">
          <label class="provider-card ${state.processingProvider === 'anthropic' ? 'selected' : ''}">
            <input type="radio" name="processing_provider" value="anthropic"
              ${state.processingProvider === 'anthropic' ? 'checked' : ''}>
            ${esc(st('llm_anthropic', lang))}
          </label>
          <label class="provider-card ${state.processingProvider === 'google' ? 'selected' : ''}">
            <input type="radio" name="processing_provider" value="google"
              ${state.processingProvider === 'google' ? 'checked' : ''}>
            ${esc(st('llm_google', lang))}
          </label>
        </div>
      </div>
      <div class="field">
        <label>${esc(st('llm_interaction_provider', lang))}</label>
        <div class="provider-grid">
          <label class="provider-card ${state.interactionProvider === 'anthropic' ? 'selected' : ''}">
            <input type="radio" name="interaction_provider" value="anthropic"
              ${state.interactionProvider === 'anthropic' ? 'checked' : ''}>
            ${esc(st('llm_anthropic', lang))}
          </label>
          <label class="provider-card ${state.interactionProvider === 'google' ? 'selected' : ''}">
            <input type="radio" name="interaction_provider" value="google"
              ${state.interactionProvider === 'google' ? 'checked' : ''}>
            ${esc(st('llm_google', lang))}
          </label>
        </div>
      </div>
      <div class="field">
        <label>${esc(st('llm_anthropic_key', lang))}</label>
        <input type="password" name="anthropic_api_key" value="${esc(state.anthropicApiKey)}"
          placeholder="sk-ant-..."
          class="${e['anthropic_api_key'] ? 'field-error' : ''}">
        ${e['anthropic_api_key'] ? `<div class="error-msg">${esc(e['anthropic_api_key'])}</div>` : ''}
      </div>
      <div class="field">
        <label>${esc(st('llm_google_key', lang))}</label>
        <input type="password" name="google_api_key" value="${esc(state.googleApiKey)}"
          placeholder="AIza..."
          class="${e['google_api_key'] ? 'field-error' : ''}">
        ${e['google_api_key'] ? `<div class="error-msg">${esc(e['google_api_key'])}</div>` : ''}
      </div>
      <div class="btn-row">
        <a href="/setup/step/2" class="btn btn-secondary">${esc(st('back', lang))}</a>
        <button type="submit" class="btn btn-primary">${esc(st('next', lang))}</button>
      </div>
    </form>
    <script>
      // Highlight selected provider cards
      document.querySelectorAll('.provider-card input[type=radio]').forEach(r => {
        r.addEventListener('change', () => {
          const grid = r.closest('.provider-grid');
          grid.querySelectorAll('.provider-card').forEach(c => c.classList.remove('selected'));
          r.closest('.provider-card').classList.add('selected');
        });
      });
    </script>`
  return setupLayout(3, 4, content, lang)
}

// ═══════════════════════════════════════════
// Step 4: System Settings + Summary
// ═══════════════════════════════════════════

export function stepSystem(lang: SetupLang, state: SetupState, errors?: Record<string, string>): string {
  const e = errors ?? {}
  const procLabel = state.processingProvider === 'anthropic' ? st('llm_anthropic', lang) : st('llm_google', lang)
  const interLabel = state.interactionProvider === 'anthropic' ? st('llm_anthropic', lang) : st('llm_google', lang)

  const content = `
    <h2>${esc(st('system_title', lang))}</h2>
    <p class="step-desc">${esc(st('system_text', lang))}</p>
    ${e['_global'] ? `<div class="global-error">${esc(e['_global'])}</div>` : ''}
    <form method="POST" action="/setup/step/4">
      <div class="field">
        <label>${esc(st('instance_name', lang))}</label>
        <input type="text" name="instance_name" value="${esc(state.instanceName)}"
          placeholder="${esc(st('instance_name_placeholder', lang))}">
      </div>
      <div class="field">
        <label>${esc(st('log_level', lang))}</label>
        <select name="log_level">
          ${['info', 'debug', 'warn', 'error'].map(l =>
            `<option value="${l}" ${state.logLevel === l ? 'selected' : ''}>${l}</option>`
          ).join('')}
        </select>
      </div>
      <div class="field">
        <label>${esc(st('node_env', lang))}</label>
        <select name="node_env">
          <option value="production" ${state.nodeEnv === 'production' ? 'selected' : ''}>${esc(st('node_env_production', lang))}</option>
          <option value="development" ${state.nodeEnv === 'development' ? 'selected' : ''}>${esc(st('node_env_development', lang))}</option>
        </select>
      </div>

      <h3 style="margin-top:24px; font-size:15px;">${esc(st('summary_title', lang))}</h3>
      <table class="summary-table">
        <tr><td>${esc(st('summary_admin', lang))}</td><td>${esc(state.adminName)} (${esc(state.adminEmail)})</td></tr>
        <tr><td>${esc(st('summary_processing', lang))}</td><td>${esc(procLabel)}</td></tr>
        <tr><td>${esc(st('summary_interaction', lang))}</td><td>${esc(interLabel)}</td></tr>
        ${state.anthropicApiKey ? `<tr><td>Anthropic API Key</td><td>${esc(st('summary_masked', lang))}</td></tr>` : ''}
        ${state.googleApiKey ? `<tr><td>Google AI API Key</td><td>${esc(st('summary_masked', lang))}</td></tr>` : ''}
      </table>

      <div class="btn-row">
        <a href="/setup/step/3" class="btn btn-secondary">${esc(st('back', lang))}</a>
        <button type="submit" class="btn btn-primary">${esc(st('finish', lang))}</button>
      </div>
    </form>`
  return setupLayout(4, 4, content, lang)
}

// ═══════════════════════════════════════════
// Setup complete page
// ═══════════════════════════════════════════

export function setupCompletePage(lang: SetupLang): string {
  const content = `
    <div class="success-check">&#10003;</div>
    <h2 style="text-align:center;">${esc(st('setup_complete_title', lang))}</h2>
    <p class="step-desc" style="text-align:center;">${esc(st('setup_complete_text', lang))}</p>
    <div class="btn-row" style="justify-content:center;">
      <a href="/console" class="btn btn-primary">${esc(st('go_to_console', lang))}</a>
    </div>
    <script>setTimeout(() => window.location.href = '/console', 3000);</script>`
  return `<!DOCTYPE html>
<html lang="${lang}">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>LUNA — Setup Complete</title>
  <style>${WIZARD_CSS}</style>
</head>
<body>
  <div class="wizard">${content}</div>
</body>
</html>`
}
