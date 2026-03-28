// LUNA — Module: freight — Console section renderer
// Server-side rendered HTML for the freight API cards + Sheet configuration UI.

type Lang = 'es' | 'en'

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')
}

export interface FreightConsoleConfig {
  // SeaRates
  searatesApiKey: string
  searatesPlatformId: string
  searatesBufferPercentage: number
  // DHL Express
  dhlExpressUsername: string
  dhlExpressPassword: string
  dhlExpressAccountNumber: string
  dhlExpressTestMode: boolean
  dhlExpressBufferPercentage: number
  // Parts Sheet
  partsSheetUrl: string
}

export function renderFreightSection(lang: Lang, config: FreightConsoleConfig): string {
  const isEs = lang === 'es'

  const t = (es: string, en: string) => isEs ? es : en

  // ── Styles ──
  const styles = `
<style>
.freight-cards {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 20px;
  margin-bottom: 24px;
}
@media (max-width: 768px) {
  .freight-cards { grid-template-columns: 1fr; }
}
.freight-api-card {
  background: var(--surface-container-lowest);
  border-radius: 0.75rem;
  padding: 24px;
  display: flex;
  flex-direction: column;
  gap: 16px;
  box-shadow: var(--shadow-subtle);
}
.freight-api-card:hover { box-shadow: var(--shadow-subtle, 0 2px 8px rgba(0,0,0,0.1)); }
.freight-card-header {
  display: flex;
  align-items: center;
  gap: 12px;
}
.freight-card-icon {
  width: 40px; height: 40px;
  border-radius: 10px;
  display: flex; align-items: center; justify-content: center;
  font-size: 20px;
  background: var(--primary-focus);
  border: 2px solid var(--info);
  flex-shrink: 0;
}
.freight-card-title {
  font-size: 15px;
  font-weight: 600;
  color: var(--on-surface);
}
.freight-card-subtitle {
  font-size: 12px;
  color: var(--on-surface-dim);
  margin-top: 2px;
}
.freight-card-fields {
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.freight-field {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.freight-field label {
  font-size: 12px;
  font-weight: 600;
  color: var(--on-surface-dim);
  text-transform: uppercase;
  letter-spacing: 0.03em;
}
.freight-field input[type="text"],
.freight-field input[type="password"],
.freight-field input[type="number"] {
  padding: 8px 12px;
  border: 1px solid var(--outline-variant);
  border-radius: 0.5rem;
  font-size: 13px;
  background: var(--surface-container-low);
  color: var(--on-surface);
  width: 100%;
  box-sizing: border-box;
}
.freight-field input:focus {
  outline: none;
  border-color: var(--primary);
  box-shadow: 0 0 0 3px var(--primary-focus);
}
.freight-field-row {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
}
@media (max-width: 480px) {
  .freight-field-row { grid-template-columns: 1fr; }
}
.freight-buffer-info {
  font-size: 11px;
  color: var(--on-surface-dim);
  margin-top: 2px;
}
.freight-toggle-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 4px 0;
}
.freight-toggle-label {
  font-size: 13px;
  color: var(--on-surface);
}

/* Sheet config box */
.freight-sheet-box {
  background: var(--surface-container-lowest);
  border-radius: 0.75rem;
  padding: 24px;
  box-shadow: var(--shadow-subtle);
}
.freight-sheet-header {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 16px;
}
.freight-sheet-icon {
  font-size: 20px;
}
.freight-sheet-title {
  font-size: 15px;
  font-weight: 600;
  color: var(--on-surface);
}
.freight-sheet-desc {
  font-size: 13px;
  color: var(--on-surface-dim);
  margin-bottom: 16px;
  line-height: 1.5;
}
.freight-sheet-input {
  padding: 10px 14px;
  border: 1px solid var(--outline-variant);
  border-radius: 0.5rem;
  font-size: 13px;
  background: var(--surface-container-low);
  color: var(--on-surface);
  width: 100%;
  box-sizing: border-box;
}
.freight-sheet-input:focus {
  outline: none;
  border-color: var(--primary);
  box-shadow: 0 0 0 3px var(--primary-focus);
}
.freight-sheet-columns {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 12px;
  margin-top: 14px;
  padding: 14px;
  background: var(--surface-container-low);
  border-radius: 0.5rem;
}
@media (max-width: 640px) {
  .freight-sheet-columns { grid-template-columns: 1fr; }
}
.freight-sheet-col {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
  color: var(--on-surface-dim);
}
.freight-sheet-col-icon {
  width: 6px; height: 6px;
  border-radius: 50%;
  background: var(--primary);
  flex-shrink: 0;
}
</style>`

  // ── SeaRates Card ──
  const searatesCard = `
<div class="freight-api-card">
  <div class="freight-card-header">
    <div class="freight-card-icon">&#128674;</div>
    <div>
      <div class="freight-card-title">SeaRates</div>
      <div class="freight-card-subtitle">Ocean (FCL/LCL) · Air · Ground (FTL/LTL)</div>
    </div>
  </div>
  <div class="freight-card-fields">
    <div class="freight-field">
      <label>API Key</label>
      <input type="password" name="SEARATES_API_KEY" value="${esc(config.searatesApiKey)}" data-original="${esc(config.searatesApiKey)}" placeholder="sr_...">
    </div>
    <div class="freight-field-row">
      <div class="freight-field">
        <label>Platform ID</label>
        <input type="text" name="SEARATES_PLATFORM_ID" value="${esc(config.searatesPlatformId)}" data-original="${esc(config.searatesPlatformId)}" placeholder="${t('Opcional', 'Optional')}">
      </div>
      <div class="freight-field">
        <label>${t('Buffer de precio (%)', 'Price buffer (%)')}</label>
        <input type="number" name="SEARATES_BUFFER_PERCENTAGE" value="${config.searatesBufferPercentage}" data-original="${config.searatesBufferPercentage}" min="0" max="1" step="0.01" placeholder="0.15">
        <span class="freight-buffer-info">${t('Fórmula: precio / (1 − buffer). Ej: 0.15 = 15%', 'Formula: price / (1 − buffer). E.g.: 0.15 = 15%')}</span>
      </div>
    </div>
  </div>
</div>`

  // ── DHL Express Card ──
  const dhlCard = `
<div class="freight-api-card">
  <div class="freight-card-header">
    <div class="freight-card-icon" style="background:rgba(255,204,0,0.1);border-color:#ffcc00;">&#9992;&#65039;</div>
    <div>
      <div class="freight-card-title">DHL Express</div>
      <div class="freight-card-subtitle">${t('Envío express internacional', 'International express shipping')}</div>
    </div>
  </div>
  <div class="freight-card-fields">
    <div class="freight-field-row">
      <div class="freight-field">
        <label>Username</label>
        <input type="password" name="DHL_EXPRESS_USERNAME" value="${esc(config.dhlExpressUsername)}" data-original="${esc(config.dhlExpressUsername)}">
      </div>
      <div class="freight-field">
        <label>Password</label>
        <input type="password" name="DHL_EXPRESS_PASSWORD" value="${esc(config.dhlExpressPassword)}" data-original="${esc(config.dhlExpressPassword)}">
      </div>
    </div>
    <div class="freight-field-row">
      <div class="freight-field">
        <label>${t('Número de cuenta', 'Account number')}</label>
        <input type="text" name="DHL_EXPRESS_ACCOUNT_NUMBER" value="${esc(config.dhlExpressAccountNumber)}" data-original="${esc(config.dhlExpressAccountNumber)}">
      </div>
      <div class="freight-field">
        <label>${t('Buffer de precio (%)', 'Price buffer (%)')}</label>
        <input type="number" name="DHL_EXPRESS_BUFFER_PERCENTAGE" value="${config.dhlExpressBufferPercentage}" data-original="${config.dhlExpressBufferPercentage}" min="0" max="1" step="0.01" placeholder="0.15">
        <span class="freight-buffer-info">${t('Fórmula: precio / (1 − buffer). Ej: 0.15 = 15%', 'Formula: price / (1 − buffer). E.g.: 0.15 = 15%')}</span>
      </div>
    </div>
    <div class="freight-toggle-row">
      <span class="freight-toggle-label">${t('Modo test (500 llamadas/día)', 'Test mode (500 calls/day)')}</span>
      <label class="toggle toggle-sm">
        <input type="hidden" name="DHL_EXPRESS_TEST_MODE" value="false">
        <input type="checkbox" name="DHL_EXPRESS_TEST_MODE" value="true" ${config.dhlExpressTestMode ? 'checked' : ''} data-original="${config.dhlExpressTestMode}">
        <span class="toggle-slider"></span>
      </label>
    </div>
  </div>
</div>`

  // ── Parts Sheet Box ──
  const sheetBox = `
<div class="freight-sheet-box">
  <div class="freight-sheet-header">
    <span class="freight-sheet-icon">&#128196;</span>
    <span class="freight-sheet-title">${t('Catálogo de partes — Google Sheet', 'Parts catalog — Google Sheet')}</span>
  </div>
  <div class="freight-sheet-desc">
    ${t(
      'Vincula un Google Sheet con el catálogo de partes para cotización automática. El sheet debe contener las columnas requeridas para calcular dimensiones, peso y cantidad por contenedor.',
      'Link a Google Sheet with the parts catalog for automatic quoting. The sheet must contain the required columns to calculate dimensions, weight, and quantity per container.',
    )}
  </div>
  <div class="freight-field">
    <label>${t('URL del Google Sheet', 'Google Sheet URL')}</label>
    <input type="text" class="freight-sheet-input" name="FREIGHT_PARTS_SHEET_URL" value="${esc(config.partsSheetUrl)}" data-original="${esc(config.partsSheetUrl)}" placeholder="https://docs.google.com/spreadsheets/d/...">
  </div>
  <div class="freight-sheet-columns">
    <div class="freight-sheet-col">
      <span class="freight-sheet-col-icon"></span>
      <span>${t('Número de parte', 'Part number')}</span>
    </div>
    <div class="freight-sheet-col">
      <span class="freight-sheet-col-icon"></span>
      <span>${t('Dimensiones (L×W×H cm)', 'Dimensions (L×W×H cm)')}</span>
    </div>
    <div class="freight-sheet-col">
      <span class="freight-sheet-col-icon"></span>
      <span>${t('Peso (kg)', 'Weight (kg)')}</span>
    </div>
  </div>
</div>`

  // ── Assemble ──
  return `${styles}
<div class="freight-cards">
  ${searatesCard}
  ${dhlCard}
</div>
${sheetBox}`
}
