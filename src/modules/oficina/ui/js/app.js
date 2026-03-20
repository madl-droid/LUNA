// app.js — Application init (loaded last)
// Depends on: all other JS files

async function init() {
  document.getElementById('lang-btn').textContent = lang === 'es' ? 'EN' : 'ES'
  try {
    const [configRes, versionRes, modelsRes, modulesRes] = await Promise.all([
      fetch('/oficina/api/oficina/config'),
      fetch('/oficina/api/oficina/version'),
      fetch('/oficina/api/model-scanner/models'),
      fetch('/oficina/api/oficina/modules'),
    ])
    const configData = await configRes.json()
    const versionData = await versionRes.json()
    const modelsData = await modelsRes.json()
    const modulesData = await modulesRes.json()

    const v = versionData.version ?? 'dev'
    document.getElementById('build-ver').textContent = 'v' + (v.length > 7 ? v.slice(0, 7) : v)

    originalValues = { ...configData.values }
    currentValues = { ...configData.values }
    allModels = modelsData.models || { anthropic: [], gemini: [] }
    lastScan = modelsData.scan || null
    moduleStates = modulesData.modules || []

    await pollWa()
    render()
    setStatus(t('connected'), '')
    startWaPolling()
  } catch (err) {
    setStatus(t('errorConnect'), 'error')
    document.getElementById('content').innerHTML = '<div class="loading">' + t('errorConnect') + '</div>'
  }
}

init()
