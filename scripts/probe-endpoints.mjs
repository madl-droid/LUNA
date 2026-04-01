const TOKEN = "RV0BjhB2WvLY35pr17780HELOVFpi9W7EBOEyAqW.MTppKpkydP7bXvzmaguFG8ghgmfyqc9EfprcJtQv"
const BASE = "https://api.medilink2.healthatom.com/api/v1"

async function get(path) {
  const r = await fetch(`${BASE}${path}`, {
    headers: { Authorization: `Token ${TOKEN}`, Accept: "application/json" },
    signal: AbortSignal.timeout(8000),
  })
  const t = await r.text()
  let b; try { b = JSON.parse(t) } catch { b = t }
  return { status: r.status, body: b }
}

// Probe alternative names for profesionales
const profPaths = ['/profesionales', '/dentistas', '/medicos', '/especialistas', '/usuarios', '/staff', '/personal', '/proveedores']
console.log("\n=== PROFESIONALES alternatives ===")
for (const p of profPaths) {
  const { status, body } = await get(p)
  console.log(`${status} ${p}`, status === 200 ? `— keys: ${Array.isArray(body?.data) && body.data.length > 0 ? Object.keys(body.data[0]).join(', ') : JSON.stringify(body).slice(0, 80)}` : '')
}

// Probe alternative names for estados-de-cita
const statusPaths = ['/estados-de-cita', '/estados-citas', '/estadosCita', '/estados_cita', '/appointment-statuses', '/statuses', '/estadoscita', '/cita-estados', '/estados']
console.log("\n=== ESTADOS-DE-CITA alternatives ===")
for (const p of statusPaths) {
  const { status, body } = await get(p)
  console.log(`${status} ${p}`, status === 200 ? `— ${JSON.stringify(body).slice(0, 120)}` : '')
}

// Check actual sillon fields
console.log("\n=== SILLON full record ===")
const { body: sb } = await get('/sillones')
if (sb?.data?.[0]) console.log(JSON.stringify(sb.data[0], null, 2))

// Check actual patient fields
console.log("\n=== PACIENTE full record (id 529) ===")
const { body: pb } = await get('/pacientes/529')
if (pb?.data) console.log(JSON.stringify(pb.data, null, 2))

// Check actual cita fields
console.log("\n=== CITA full record ===")
const { body: cb } = await get('/pacientes/529/citas')
if (cb?.data?.[0]) console.log(JSON.stringify(cb.data[0], null, 2))

// Check actual evolucion fields
console.log("\n=== EVOLUCION full record ===")
const { body: eb } = await get('/pacientes/529/evoluciones')
if (eb?.data?.[0]) console.log(JSON.stringify(eb.data[0], null, 2))

// Check actual archivo fields
console.log("\n=== ARCHIVO full record ===")
const { body: ab } = await get('/pacientes/529/archivos')
if (ab?.data?.[0]) console.log(JSON.stringify(ab.data[0], null, 2))

// Probe /archivos/{id} direct download
if (ab?.data?.[0]) {
  const fileId = ab.data[0].id
  const { status: ds, body: db } = await get(`/archivos/${fileId}`)
  console.log(`\n=== /archivos/${fileId} direct fetch ===`)
  console.log(`status: ${ds}`)
  console.log(JSON.stringify(db)?.slice(0, 300))

  // try /pacientes/{id}/archivos/{fileId}
  const { status: ds2, body: db2 } = await get(`/pacientes/529/archivos/${fileId}`)
  console.log(`\n=== /pacientes/529/archivos/${fileId} ===`)
  console.log(`status: ${ds2}`)
  console.log(JSON.stringify(db2)?.slice(0, 300))
}

// Probe /citas directly (not sub-resource)
console.log("\n=== /citas direct ===")
const { status: cs, body: cdb } = await get('/citas')
console.log(`status: ${cs}`)
if (cdb?.data?.[0]) {
  console.log(`keys: ${Object.keys(cdb.data[0]).join(', ')}`)
  console.log(JSON.stringify(cdb.data[0], null, 2))
}

// Probe filter operators on pacientes
console.log("\n=== FILTER operators on /pacientes ===")
const filters = [
  { nombres: { like: 'Miguel' } },
  { nombres: { contains: 'Miguel' } },
  { nombre: { like: 'Miguel' } },  // maybe field is 'nombre' not 'nombres'
]
for (const f of filters) {
  const { status, body } = await get(`/pacientes?q=${encodeURIComponent(JSON.stringify(f))}`)
  const count = Array.isArray(body?.data) ? body.data.length : '?'
  console.log(`${status} q=${JSON.stringify(f)} → ${count} results`)
}
