// Probe v5 endpoints to confirm docs vs reality
const TOKEN = "RV0BjhB2WvLY35pr17780HELOVFpi9W7EBOEyAqW.MTppKpkydP7bXvzmaguFG8ghgmfyqc9EfprcJtQv"
const V1 = "https://api.medilink2.healthatom.com/api/v1"
const V5 = "https://api.medilink2.healthatom.com/api/v5"

async function get(base, path) {
  const r = await fetch(`${base}${path}`, {
    headers: { Authorization: `Token ${TOKEN}`, Accept: "application/json" },
    signal: AbortSignal.timeout(8000),
  })
  const t = await r.text()
  let b; try { b = JSON.parse(t) } catch { b = t }
  return { status: r.status, body: b }
}

async function probe(label, path) {
  const r1 = await get(V1, path)
  const r5 = await get(V5, path)
  const s1 = r1.status === 200 ? `✓ ${r1.status}` : `✗ ${r1.status}`
  const s5 = r5.status === 200 ? `✓ ${r5.status}` : `✗ ${r5.status}`
  const keys1 = r1.status === 200 && Array.isArray(r1.body?.data) && r1.body.data[0]
    ? Object.keys(r1.body.data[0]).join(', ') : ''
  const keys5 = r5.status === 200 && Array.isArray(r5.body?.data) && r5.body.data[0]
    ? Object.keys(r5.body.data[0]).join(', ') : ''
  console.log(`\n[${label}]`)
  console.log(`  v1: ${s1}  keys: ${keys1.slice(0,120)}`)
  console.log(`  v5: ${s5}  keys: ${keys5.slice(0,120)}`)
}

await probe('/sucursales', '/sucursales')
await probe('/profesionales', '/profesionales')
await probe('/sillones', '/sillones')
await probe('/tratamientos', '/tratamientos')
await probe('/prestaciones', '/prestaciones')
await probe('/citas/estados', '/citas/estados')
await probe('/estados-de-cita', '/estados-de-cita')
await probe('/documentosClinicos', '/documentosClinicos')
await probe('/camposAdicionales', '/camposAdicionales')
await probe('/pacientes/buscar', '/pacientes/buscar')

// Full v5 records for key types
console.log("\n=== v5 /profesionales[0] ===")
const { body: pb } = await get(V5, '/profesionales')
if (pb?.data?.[0]) console.log(JSON.stringify(pb.data[0], null, 2).slice(0, 800))

console.log("\n=== v5 /citas/estados ===")
const { body: eb } = await get(V5, '/citas/estados')
console.log(JSON.stringify(eb?.data?.slice?.(0,3) ?? eb, null, 2).slice(0, 600))

console.log("\n=== v5 /sillones[0] ===")
const { body: sb } = await get(V5, '/sillones')
if (sb?.data?.[0]) console.log(JSON.stringify(sb.data[0], null, 2))

console.log("\n=== v5 /pacientes/529 ===")
const { body: pat } = await get(V5, '/pacientes/529')
if (pat?.data) console.log(JSON.stringify(pat.data, null, 2).slice(0,800))

console.log("\n=== v5 /pacientes/529/adicionales ===")
const { status: as, body: ab } = await get(V5, '/pacientes/529/adicionales')
console.log(`status: ${as}`)
console.log(JSON.stringify(ab, null, 2).slice(0, 600))

console.log("\n=== v5 /agendas (mañana) ===")
const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10)
const { status: agS, body: agB } = await get(V5, `/agendas?q=${encodeURIComponent(JSON.stringify({ id_sucursal: { eq: 1 }, fecha: { eq: tomorrow } }))}`)
console.log(`status: ${agS}`)
if (Array.isArray(agB?.data)) {
  console.log(`data is array, ${agB.data.length} items`)
  if (agB.data[0]) console.log(JSON.stringify(agB.data[0], null, 2))
} else {
  console.log(JSON.stringify(agB, null, 2).slice(0,400))
}

console.log("\n=== v5 /documentosClinicos (con paciente 529) ===")
const { status: ds, body: db } = await get(V5, '/documentosClinicos?q=' + encodeURIComponent(JSON.stringify({ id_paciente: { eq: 529 } })))
console.log(`status: ${ds}`)
console.log(JSON.stringify(db, null, 2).slice(0,400))

console.log("\n=== v5 /tratamientos vs /prestaciones ===")
const { status: ts, body: tb } = await get(V5, '/tratamientos')
const { status: ps, body: prb } = await get(V5, '/prestaciones')
console.log(`/tratamientos: ${ts}`)
console.log(`/prestaciones: ${ps}`)
if (ps === 200 && prb?.data?.[0]) {
  console.log(`prestaciones[0] keys: ${Object.keys(prb.data[0]).join(', ')}`)
  console.log(JSON.stringify(prb.data[0], null, 2).slice(0,300))
}
