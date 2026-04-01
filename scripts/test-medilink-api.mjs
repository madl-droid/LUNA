#!/usr/bin/env node
// Test script for Medilink API — validates endpoints, fields, filters
// Usage: MEDILINK_API_TOKEN=... MEDILINK_BASE_URL=... TEST_RUT=... node scripts/test-medilink-api.mjs

const BASE_URL_ENV = (process.env.MEDILINK_BASE_URL || '').replace(/\/+$/, '')
const TOKEN = process.env.MEDILINK_API_TOKEN || ''
const TEST_RUT = process.env.TEST_RUT || ''

// Probe which prefix works: /api/v1, /, etc.
async function detectBaseUrl(envUrl) {
  for (const prefix of ['/api/v1', '', '/v1', '/api']) {
    const candidate = `${envUrl}${prefix}`
    try {
      const r = await fetch(`${candidate}/sucursales`, {
        headers: { Authorization: `Token ${TOKEN}`, Accept: 'application/json' },
        signal: AbortSignal.timeout(8000),
      })
      if (r.ok) {
        console.log(`\x1b[32m✓\x1b[0m Detected API base: ${candidate}`)
        return candidate
      }
    } catch { /* ignore */ }
  }
  console.log(`\x1b[33m?\x1b[0m Could not detect API base, using ${envUrl} as-is`)
  return envUrl
}

const BASE_URL = await detectBaseUrl(BASE_URL_ENV)

if (!BASE_URL || !TOKEN) {
  console.error('Missing MEDILINK_BASE_URL or MEDILINK_API_TOKEN')
  process.exit(1)
}

// ─── Colors ────────────────────────────────────────────────────────────────
const R = '\x1b[31m'
const G = '\x1b[32m'
const Y = '\x1b[33m'
const B = '\x1b[34m'
const C = '\x1b[36m'
const W = '\x1b[37m'
const BOLD = '\x1b[1m'
const RESET = '\x1b[0m'

const OK    = `${G}✓${RESET}`
const FAIL  = `${R}✗${RESET}`
const WARN  = `${Y}?${RESET}`
const INFO  = `${B}i${RESET}`

// ─── Results collector ─────────────────────────────────────────────────────
const results = { pass: 0, fail: 0, warn: 0 }
const issues = []
const warnings = []

function pass(msg) { results.pass++; console.log(`  ${OK} ${msg}`) }
function fail(msg) { results.fail++; issues.push(msg); console.log(`  ${FAIL} ${R}${msg}${RESET}`) }
function warn(msg) { results.warn++; warnings.push(msg); console.log(`  ${WARN} ${Y}${msg}${RESET}`) }
function info(msg) { console.log(`  ${INFO} ${W}${msg}${RESET}`) }
function section(title) { console.log(`\n${BOLD}${C}━━━ ${title} ━━━${RESET}`) }

// ─── HTTP helper ───────────────────────────────────────────────────────────
async function apiGet(path, params = {}) {
  const url = new URL(`${BASE_URL}${path}`)
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v)
  const res = await fetch(url.toString(), {
    headers: {
      Authorization: `Token ${TOKEN}`,
      Accept: 'application/json',
    },
    signal: AbortSignal.timeout(15000),
  })
  const text = await res.text()
  let body
  try { body = JSON.parse(text) } catch { body = text }
  return { status: res.status, ok: res.ok, body, headers: res.headers }
}

// ─── Field checker ─────────────────────────────────────────────────────────
function checkFields(obj, requiredFields, label) {
  if (!obj || typeof obj !== 'object') {
    fail(`${label}: response is not an object (got ${JSON.stringify(obj)?.slice(0, 80)})`)
    return
  }
  for (const field of requiredFields) {
    if (!(field in obj)) {
      fail(`${label}: missing field '${field}'`)
    } else {
      pass(`${label}: has '${field}' = ${JSON.stringify(obj[field])?.slice(0, 60)}`)
    }
  }
}

function checkOptionalFields(obj, fields, label) {
  for (const field of fields) {
    if (field in obj) {
      info(`${label}: optional field '${field}' present = ${JSON.stringify(obj[field])?.slice(0, 60)}`)
    } else {
      warn(`${label}: optional field '${field}' absent`)
    }
  }
}

// ─── Envelope checker ─────────────────────────────────────────────────────
function checkEnvelope(body, label) {
  if (!body || typeof body !== 'object') {
    fail(`${label}: response is not JSON`)
    return null
  }
  if (!('data' in body)) {
    fail(`${label}: envelope missing 'data' key`)
    return null
  }
  pass(`${label}: envelope has 'data'`)
  if ('links' in body) {
    pass(`${label}: envelope has 'links'`)
    if (body.links && typeof body.links === 'object') {
      if ('next' in body.links) pass(`${label}: links.next present (${body.links.next ?? 'null'})`)
      else warn(`${label}: links.next missing`)
    }
  } else {
    warn(`${label}: envelope missing 'links' (pagination not available)`)
  }
  return body.data
}

// ═══════════════════════════════════════════════════════════════════════════
// 1. REFERENCE DATA
// ═══════════════════════════════════════════════════════════════════════════

section('1. REFERENCE DATA — /sucursales')
{
  const { status, ok, body } = await apiGet('/sucursales')
  if (!ok) { fail(`/sucursales returned HTTP ${status}: ${JSON.stringify(body)?.slice(0, 200)}`)}
  else {
    pass(`/sucursales HTTP ${status}`)
    const data = checkEnvelope(body, 'sucursales')
    if (Array.isArray(data) && data.length > 0) {
      pass(`sucursales: got ${data.length} items`)
      const item = data[0]
      checkFields(item, ['id', 'nombre'], 'sucursal')
      checkOptionalFields(item, ['direccion', 'ciudad', 'telefono', 'email', 'links'], 'sucursal')
      // check habilitado field
      if ('habilitado' in item) pass(`sucursal: has 'habilitado'`)
      else warn(`sucursal: NO 'habilitado' field — filter por habilitado no funcionará`)
    } else {
      warn(`sucursales: data is empty or not array (${JSON.stringify(data)?.slice(0, 80)})`)
    }
  }
}

section('1. REFERENCE DATA — /profesionales')
{
  const { status, ok, body } = await apiGet('/profesionales')
  if (!ok) { fail(`/profesionales returned HTTP ${status}: ${JSON.stringify(body)?.slice(0, 200)}`)}
  else {
    pass(`/profesionales HTTP ${status}`)
    const data = checkEnvelope(body, 'profesionales')
    if (Array.isArray(data) && data.length > 0) {
      pass(`profesionales: got ${data.length} items`)
      const item = data[0]
      checkFields(item, ['id', 'nombre', 'apellidos', 'habilitado'], 'profesional')
      checkOptionalFields(item, ['rut', 'celular', 'telefono', 'email', 'id_especialidad', 'especialidad', 'agenda_online', 'intervalo', 'links'], 'profesional')
      const enabled = data.filter(p => p.habilitado === true)
      const disabled = data.filter(p => p.habilitado === false)
      info(`profesionales: ${enabled.length} habilitados, ${disabled.length} deshabilitados`)
    } else {
      warn(`profesionales: data is empty or not array`)
    }
  }
}

// filter habilitado test
section('1. REFERENCE DATA — /profesionales filter habilitado')
{
  const { status, ok, body } = await apiGet('/profesionales', { q: JSON.stringify({ habilitado: { eq: true } }) })
  if (!ok) { fail(`/profesionales?q=habilitado returned HTTP ${status}`)}
  else {
    pass(`/profesionales filter habilitado HTTP ${status}`)
    const data = checkEnvelope(body, 'profesionales[habilitado]')
    if (Array.isArray(data)) {
      const allEnabled = data.every(p => p.habilitado === true)
      if (allEnabled) pass(`profesionales filter habilitado: all results have habilitado=true`)
      else fail(`profesionales filter habilitado: some results have habilitado=false — filter not working`)
      info(`profesionales habilitado: ${data.length} results`)
    }
  }
}

section('1. REFERENCE DATA — /tratamientos')
{
  const { status, ok, body } = await apiGet('/tratamientos')
  if (!ok) { fail(`/tratamientos returned HTTP ${status}: ${JSON.stringify(body)?.slice(0, 200)}`)}
  else {
    pass(`/tratamientos HTTP ${status}`)
    const data = checkEnvelope(body, 'tratamientos')
    if (Array.isArray(data) && data.length > 0) {
      pass(`tratamientos: got ${data.length} items`)
      const item = data[0]
      checkFields(item, ['id', 'nombre'], 'tratamiento')
      checkOptionalFields(item, ['duracion', 'precio', 'habilitado', 'links'], 'tratamiento')
    } else {
      warn(`tratamientos: data is empty or not array`)
    }
  }
}

section('1. REFERENCE DATA — /sillones')
{
  const { status, ok, body } = await apiGet('/sillones')
  if (!ok) { fail(`/sillones returned HTTP ${status}: ${JSON.stringify(body)?.slice(0, 200)}`)}
  else {
    pass(`/sillones HTTP ${status}`)
    const data = checkEnvelope(body, 'sillones')
    if (Array.isArray(data) && data.length > 0) {
      pass(`sillones: got ${data.length} items`)
      const item = data[0]
      checkFields(item, ['id', 'nombre', 'id_sucursal'], 'sillon')
      checkOptionalFields(item, ['nombre_sucursal', 'habilitado', 'links'], 'sillon')
    } else {
      warn(`sillones: data is empty or not array`)
    }
  }
}

section('1. REFERENCE DATA — /estados-de-cita')
{
  const { status, ok, body } = await apiGet('/estados-de-cita')
  if (!ok) { fail(`/estados-de-cita returned HTTP ${status}: ${JSON.stringify(body)?.slice(0, 200)}`)}
  else {
    pass(`/estados-de-cita HTTP ${status}`)
    const data = checkEnvelope(body, 'estados-de-cita')
    if (Array.isArray(data) && data.length > 0) {
      pass(`estados-de-cita: got ${data.length} items`)
      const item = data[0]
      checkFields(item, ['id', 'nombre'], 'estado-de-cita')
      checkOptionalFields(item, ['color', 'habilitado', 'links'], 'estado-de-cita')
    } else {
      warn(`estados-de-cita: data is empty or not array`)
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// 2. PATIENT — search by RUT
// ═══════════════════════════════════════════════════════════════════════════

section('2. PACIENTE — búsqueda por RUT')
let testPatientId = null

{
  if (!TEST_RUT) {
    warn('TEST_RUT not set — skipping patient search')
  } else {
    const { status, ok, body } = await apiGet('/pacientes', { q: JSON.stringify({ rut: { eq: TEST_RUT } }) })
    if (!ok) {
      fail(`/pacientes?q[rut][eq] returned HTTP ${status}: ${JSON.stringify(body)?.slice(0, 200)}`)
    } else {
      pass(`/pacientes search by RUT HTTP ${status}`)
      const data = checkEnvelope(body, 'pacientes[rut]')
      if (Array.isArray(data)) {
        if (data.length === 0) {
          warn(`pacientes: RUT ${TEST_RUT} not found — sub-resource tests will be skipped`)
        } else {
          pass(`pacientes: found ${data.length} patient(s) with RUT ${TEST_RUT}`)
          const p = data[0]
          testPatientId = p.id
          info(`Patient ID: ${p.id}`)

          // Required fields per MedilinkPatient type
          checkFields(p, [
            'id', 'nombres', 'apellidos', 'fecha_creacion', 'fecha_actualizacion'
          ], 'paciente')

          // Nullable expected fields
          checkOptionalFields(p, [
            'rut', 'nombre_social', 'fecha_nacimiento', 'genero',
            'telefono', 'celular', 'email',
            'direccion', 'ciudad', 'comuna', 'pais',
            'prevision', 'observaciones', 'links'
          ], 'paciente')

          // campos_adicionales
          if ('campos_adicionales' in p) {
            pass(`paciente: has 'campos_adicionales'`)
            info(`campos_adicionales keys: ${Object.keys(p.campos_adicionales || {}).join(', ') || '(empty)'}`)
          } else {
            warn(`paciente: no 'campos_adicionales' field — LUNA won't access custom fields`)
          }

          // Check RUT matches
          if (p.rut === TEST_RUT) pass(`paciente: rut matches TEST_RUT`)
          else warn(`paciente: rut field '${p.rut}' != TEST_RUT '${TEST_RUT}'`)
        }
      }
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// 3. SUB-RECURSOS — /citas, /pagos, /evoluciones
// ═══════════════════════════════════════════════════════════════════════════

section('3. SUB-RECURSOS')

if (!testPatientId) {
  warn('No patient ID available — skipping sub-resource tests')
} else {
  // /pacientes/{id}/citas
  {
    const { status, ok, body } = await apiGet(`/pacientes/${testPatientId}/citas`)
    if (!ok) {
      fail(`/pacientes/${testPatientId}/citas HTTP ${status}: ${JSON.stringify(body)?.slice(0, 200)}`)
    } else {
      pass(`/pacientes/${testPatientId}/citas HTTP ${status}`)
      const data = checkEnvelope(body, 'citas')
      if (Array.isArray(data)) {
        info(`citas: ${data.length} appointments found`)
        if (data.length > 0) {
          const c = data[0]
          checkFields(c, [
            'id', 'id_paciente', 'id_estado', 'id_tratamiento',
            'fecha', 'hora_inicio', 'hora_fin', 'duracion',
            'id_profesional', 'id_sucursal'
          ], 'cita')
          checkOptionalFields(c, [
            'nombre_paciente', 'nombre_social_paciente', 'estado_cita',
            'nombre_tratamiento', 'nombre_profesional', 'nombre_sucursal',
            'id_sillon', 'comentarios', 'fecha_actualizacion', 'links'
          ], 'cita')
        }
      } else {
        warn(`citas: data is not array — ${JSON.stringify(data)?.slice(0, 80)}`)
      }
    }
  }

  // /pacientes/{id}/pagos
  {
    const { status, ok, body } = await apiGet(`/pacientes/${testPatientId}/pagos`)
    if (!ok) {
      fail(`/pacientes/${testPatientId}/pagos HTTP ${status}: ${JSON.stringify(body)?.slice(0, 200)}`)
    } else {
      pass(`/pacientes/${testPatientId}/pagos HTTP ${status}`)
      const data = checkEnvelope(body, 'pagos')
      if (Array.isArray(data)) {
        info(`pagos: ${data.length} payments found`)
        if (data.length > 0) {
          const p = data[0]
          info(`pagos[0] keys: ${Object.keys(p).join(', ')}`)
          checkOptionalFields(p, ['id', 'monto', 'fecha', 'tipo', 'estado', 'id_cita'], 'pago')
        }
      } else {
        warn(`pagos: data is not array — ${JSON.stringify(data)?.slice(0, 80)}`)
      }
    }
  }

  // /pacientes/{id}/evoluciones
  {
    const { status, ok, body } = await apiGet(`/pacientes/${testPatientId}/evoluciones`)
    if (!ok) {
      fail(`/pacientes/${testPatientId}/evoluciones HTTP ${status}: ${JSON.stringify(body)?.slice(0, 200)}`)
    } else {
      pass(`/pacientes/${testPatientId}/evoluciones HTTP ${status}`)
      const data = checkEnvelope(body, 'evoluciones')
      if (Array.isArray(data)) {
        info(`evoluciones: ${data.length} found`)
        if (data.length > 0) {
          const e = data[0]
          checkFields(e, ['id', 'id_paciente', 'id_profesional', 'fecha'], 'evolucion')
          checkOptionalFields(e, [
            'id_atencion', 'nombre_atencion', 'nombre_paciente',
            'nombre_profesional', 'habilitado'
          ], 'evolucion')
          if ('datos' in e) {
            if (e.datos !== null && e.datos !== undefined) {
              pass(`evolucion: 'datos' field present with content — notas clínicas AVAILABLE`)
              info(`datos sample (first 100 chars): ${String(e.datos).slice(0, 100)}`)
            } else {
              pass(`evolucion: 'datos' field present but null`)
            }
          } else {
            warn(`evolucion: NO 'datos' field — notas clínicas NOT available in evoluciones`)
          }
        }
      } else {
        warn(`evoluciones: data is not array — ${JSON.stringify(data)?.slice(0, 80)}`)
      }
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// 4. AGENDA — today and tomorrow
// ═══════════════════════════════════════════════════════════════════════════

section('4. AGENDA — /agendas')

// Get a branch ID first
let branchId = null
{
  const { ok, body } = await apiGet('/sucursales')
  if (ok && body?.data && Array.isArray(body.data) && body.data.length > 0) {
    branchId = body.data[0].id
    info(`Using branchId=${branchId} for agenda tests`)
  }
}

if (!branchId) {
  warn('No branch available — skipping agenda tests')
} else {
  const today = new Date().toISOString().slice(0, 10)
  const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10)

  for (const [label, date] of [['hoy', today], ['mañana', tomorrow]]) {
    const { status, ok, body } = await apiGet('/agendas', {
      q: JSON.stringify({ id_sucursal: { eq: branchId }, fecha: { eq: date } })
    })
    if (!ok) {
      fail(`/agendas [${label}] HTTP ${status}: ${JSON.stringify(body)?.slice(0, 200)}`)
    } else {
      pass(`/agendas [${label}] HTTP ${status}`)
      // Agenda may return data directly (not always paginated)
      if (body && typeof body === 'object') {
        if ('data' in body) {
          pass(`/agendas [${label}]: has 'data' envelope`)
          const d = body.data
          if (Array.isArray(d)) {
            info(`/agendas [${label}]: data is ARRAY with ${d.length} items`)
            if (d.length > 0) info(`/agendas [${label}]: sample item keys: ${Object.keys(d[0]).join(', ')}`)
          } else if (d && typeof d === 'object') {
            const topKeys = Object.keys(d)
            info(`/agendas [${label}]: data is OBJECT with ${topKeys.length} keys (dates/professionals)`)
            if (topKeys.length > 0) {
              info(`/agendas [${label}]: top-level keys sample: ${topKeys.slice(0, 3).join(', ')}`)
              const firstVal = d[topKeys[0]]
              if (firstVal && typeof firstVal === 'object') {
                const secondKeys = Object.keys(firstVal)
                info(`/agendas [${label}]: second-level keys (times): ${secondKeys.slice(0, 5).join(', ')}`)
                if (secondKeys.length > 0) {
                  const firstSlot = firstVal[secondKeys[0]]
                  if (firstSlot && typeof firstSlot === 'object') {
                    const thirdKeys = Object.keys(firstSlot)
                    info(`/agendas [${label}]: third-level keys (chairs): ${thirdKeys.slice(0, 5).join(', ')}`)
                    const slotVal = firstSlot[thirdKeys[0]]
                    if (typeof slotVal === 'boolean') {
                      info(`/agendas [${label}]: leaf value is boolean (available/blocked) — simple format`)
                    } else if (slotVal && typeof slotVal === 'object') {
                      info(`/agendas [${label}]: leaf value is object — keys: ${Object.keys(slotVal).join(', ')}`)
                      checkOptionalFields(slotVal, ['tipo', 'comentario', 'bloque', 'duracion_total', 'inicio', 'fin', 'id_cita', 'id_paciente', 'nombre_paciente'], 'agenda block')
                    }
                  }
                }
              }
            }
          } else if (d === null) {
            warn(`/agendas [${label}]: data is null — no agenda for this date/branch`)
          }
        } else {
          warn(`/agendas [${label}]: response has no 'data' key — raw response keys: ${Object.keys(body).join(', ')}`)
          info(`Raw body sample: ${JSON.stringify(body).slice(0, 200)}`)
        }
      }
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// 5. ARCHIVOS Y DOCUMENTOS CLÍNICOS
// ═══════════════════════════════════════════════════════════════════════════

section('5. ARCHIVOS Y DOCUMENTOS CLÍNICOS')

if (!testPatientId) {
  warn('No patient ID — skipping archivos/documentos tests')
} else {
  // /pacientes/{id}/archivos
  {
    const { status, ok, body } = await apiGet(`/pacientes/${testPatientId}/archivos`)
    if (status === 404) {
      warn(`/pacientes/${testPatientId}/archivos → 404 — endpoint may not exist or patient has no files`)
    } else if (!ok) {
      fail(`/pacientes/${testPatientId}/archivos HTTP ${status}: ${JSON.stringify(body)?.slice(0, 200)}`)
    } else {
      pass(`/pacientes/${testPatientId}/archivos HTTP ${status}`)
      const data = checkEnvelope(body, 'archivos')
      if (Array.isArray(data)) {
        info(`archivos: ${data.length} files found`)
        if (data.length > 0) {
          const f = data[0]
          info(`archivo[0] keys: ${Object.keys(f).join(', ')}`)
          checkOptionalFields(f, ['id', 'nombre', 'tipo', 'url', 'content_type', 'fecha'], 'archivo')

          // Try to download first file
          const fileUrl = f.url || f.archivo || f.path
          if (fileUrl) {
            const isAbsolute = /^https?:\/\//.test(fileUrl)
            const downloadPath = isAbsolute ? fileUrl : `/pacientes/${testPatientId}/archivos/${f.id}`
            try {
              const { status: ds, headers } = await apiGet(
                isAbsolute ? '' : downloadPath,
                isAbsolute ? {} : {}
              )
              const ct = headers.get('content-type') || 'unknown'
              if (ds === 200 || ds === 302) {
                pass(`archivo download: HTTP ${ds}, content-type: ${ct}`)
                if (ct.includes('application/json')) warn(`archivo download: content-type is JSON — may be signed URL response`)
                else if (ct.includes('text/html')) warn(`archivo download: content-type is HTML — may be redirect page`)
                else pass(`archivo download: binary content-type ${ct}`)
              } else {
                warn(`archivo download: HTTP ${ds}`)
              }
            } catch (e) {
              warn(`archivo download failed: ${e.message}`)
            }
          } else {
            warn(`archivo: no url/path field found — cannot test download`)
          }
        }
      } else if (data === null || data === undefined) {
        warn(`archivos: data is null/undefined`)
      } else {
        warn(`archivos: unexpected data type ${typeof data} — ${JSON.stringify(data)?.slice(0, 80)}`)
      }
    }
  }

  // /documentosClinicos/{id}
  {
    const { status, ok, body } = await apiGet(`/documentosClinicos/${testPatientId}`)
    if (status === 404) {
      warn(`/documentosClinicos/${testPatientId} → 404 — try /pacientes/{id}/documentosClinicos`)
      // try alternate path
      const { status: s2, ok: ok2, body: b2 } = await apiGet(`/pacientes/${testPatientId}/documentosClinicos`)
      if (s2 === 404) {
        warn(`/pacientes/${testPatientId}/documentosClinicos → 404 — documentosClinicos endpoint not found`)
      } else if (!ok2) {
        fail(`/pacientes/${testPatientId}/documentosClinicos HTTP ${s2}`)
      } else {
        pass(`/pacientes/${testPatientId}/documentosClinicos HTTP ${s2}`)
        const d2 = checkEnvelope(b2, 'documentosClinicos')
        if (Array.isArray(d2)) {
          info(`documentosClinicos: ${d2.length} found`)
          if (d2.length > 0) info(`documentosClinicos[0] keys: ${Object.keys(d2[0]).join(', ')}`)
        }
      }
    } else if (!ok) {
      fail(`/documentosClinicos/${testPatientId} HTTP ${status}: ${JSON.stringify(body)?.slice(0, 200)}`)
    } else {
      pass(`/documentosClinicos/${testPatientId} HTTP ${status}`)
      const data = checkEnvelope(body, 'documentosClinicos')
      if (Array.isArray(data)) {
        info(`documentosClinicos: ${data.length} found`)
        if (data.length > 0) {
          const d = data[0]
          info(`documentosClinicos[0] keys: ${Object.keys(d).join(', ')}`)
          checkOptionalFields(d, ['id', 'nombre', 'url', 'content_type', 'fecha', 'tipo'], 'documentoClinicos')
        }
      }
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// 6. FILTROS — operadores eq, like, contains
// ═══════════════════════════════════════════════════════════════════════════

section('6. FILTROS — operadores')

// eq (already tested above, but explicit)
{
  const { status, ok } = await apiGet('/profesionales', { q: JSON.stringify({ habilitado: { eq: true } }) })
  if (ok) pass(`filtro 'eq' soportado en /profesionales`)
  else fail(`filtro 'eq' falló en /profesionales — HTTP ${status}`)
}

// like
{
  const { status, ok, body } = await apiGet('/profesionales', { q: JSON.stringify({ nombre: { like: 'a' } }) })
  if (ok) {
    pass(`filtro 'like' soportado en /profesionales (HTTP ${status})`)
    const data = body?.data
    if (Array.isArray(data)) info(`like 'a': ${data.length} results`)
  } else if (status === 400) {
    warn(`filtro 'like' → HTTP 400 — operator NOT supported (body: ${JSON.stringify(body)?.slice(0, 120)})`)
  } else {
    fail(`filtro 'like' → HTTP ${status}: ${JSON.stringify(body)?.slice(0, 120)}`)
  }
}

// contains
{
  const { status, ok, body } = await apiGet('/profesionales', { q: JSON.stringify({ nombre: { contains: 'a' } }) })
  if (ok) {
    pass(`filtro 'contains' soportado en /profesionales (HTTP ${status})`)
    const data = body?.data
    if (Array.isArray(data)) info(`contains 'a': ${data.length} results`)
  } else if (status === 400) {
    warn(`filtro 'contains' → HTTP 400 — operator NOT supported (body: ${JSON.stringify(body)?.slice(0, 120)})`)
  } else {
    fail(`filtro 'contains' → HTTP ${status}: ${JSON.stringify(body)?.slice(0, 120)}`)
  }
}

// ilike (case-insensitive like — common in some APIs)
{
  const { status, ok, body } = await apiGet('/pacientes', { q: JSON.stringify({ nombres: { ilike: 'mar' } }) })
  if (ok) {
    pass(`filtro 'ilike' soportado en /pacientes`)
    const data = body?.data
    if (Array.isArray(data)) info(`ilike 'mar': ${data.length} results`)
  } else {
    warn(`filtro 'ilike' → HTTP ${status} — not supported`)
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// FINAL SUMMARY
// ═══════════════════════════════════════════════════════════════════════════

console.log(`\n${BOLD}${'═'.repeat(60)}${RESET}`)
console.log(`${BOLD}RESUMEN FINAL${RESET}`)
console.log(`${'═'.repeat(60)}`)
console.log(`  ${OK} Passed: ${G}${BOLD}${results.pass}${RESET}`)
console.log(`  ${FAIL} Failed: ${R}${BOLD}${results.fail}${RESET}`)
console.log(`  ${WARN} Warnings: ${Y}${BOLD}${results.warn}${RESET}`)

if (issues.length > 0) {
  console.log(`\n${BOLD}${R}FALLOS (${issues.length}):${RESET}`)
  issues.forEach((i, n) => console.log(`  ${n + 1}. ${R}${i}${RESET}`))
}

if (warnings.length > 0) {
  console.log(`\n${BOLD}${Y}ADVERTENCIAS (${warnings.length}):${RESET}`)
  warnings.forEach((w, n) => console.log(`  ${n + 1}. ${Y}${w}${RESET}`))
}

console.log('')
