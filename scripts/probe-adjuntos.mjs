// Probe de endpoints de adjuntos y docs clínicos — v1 y v5
const TOKEN = "RV0BjhB2WvLY35pr17780HELOVFpi9W7EBOEyAqW.MTppKpkydP7bXvzmaguFG8ghgmfyqc9EfprcJtQv"
const V1 = "https://api.medilink2.healthatom.com/api/v1"
const V5 = "https://api.medilink2.healthatom.com/api/v5"
const PATIENT_ID = 529

async function get(url, label) {
  try {
    const r = await fetch(url, {
      headers: { Authorization: `Token ${TOKEN}`, Accept: "application/json" },
      signal: AbortSignal.timeout(10000),
    })
    const t = await r.text()
    let b; try { b = JSON.parse(t) } catch { b = t }
    return { status: r.status, body: b, label }
  } catch(e) {
    return { status: 'ERR', body: e.message, label }
  }
}

function show(r) {
  const ok = r.status === 200 ? '\x1b[32m✓\x1b[0m' : r.status === 404 ? '\x1b[31m✗\x1b[0m' : '\x1b[33m?\x1b[0m'
  console.log(`${ok} [${r.status}] ${r.label}`)
  if (r.status === 200) {
    const d = r.body?.data
    if (Array.isArray(d)) {
      console.log(`   → array[${d.length}]${d[0] ? ' keys: ' + Object.keys(d[0]).join(', ') : ' (vacío)'}`)
      if (d.length > 0) console.log('   → item[0]: ' + JSON.stringify(d[0]).slice(0, 300))
    } else if (d && typeof d === 'object') {
      console.log('   → object keys: ' + Object.keys(d).join(', '))
      console.log('   → ' + JSON.stringify(d).slice(0, 300))
    } else if (d === null || d === undefined) {
      console.log('   → data: null/undefined')
    } else {
      console.log('   → ' + JSON.stringify(r.body).slice(0, 300))
    }
  } else if (r.status !== 404) {
    console.log('   → ' + JSON.stringify(r.body).slice(0, 200))
  }
}

// ── 1. Ya confirmados ─────────────────────────────────────────────
console.log('\n\x1b[1m=== CONFIRMADOS ===\x1b[0m')
show(await get(`${V5}/pacientes/${PATIENT_ID}/archivos`, `v5 /pacientes/${PATIENT_ID}/archivos`))
show(await get(`${V5}/pacientes/${PATIENT_ID}/evoluciones`, `v5 /pacientes/${PATIENT_ID}/evoluciones`))

// ── 2. documentosClinicos — variantes ────────────────────────────
console.log('\n\x1b[1m=== DOCUMENTOS CLÍNICOS ===\x1b[0m')
show(await get(`${V5}/documentosClinicos`, `v5 /documentosClinicos (global)`))
show(await get(`${V5}/documentosClinicos?q=${encodeURIComponent(JSON.stringify({id_paciente:{eq:PATIENT_ID}}))}`, `v5 /documentosClinicos?q[id_paciente]`))
show(await get(`${V5}/pacientes/${PATIENT_ID}/documentosClinicos`, `v5 /pacientes/${PATIENT_ID}/documentosClinicos`))
show(await get(`${V1}/documentosClinicos`, `v1 /documentosClinicos (global)`))
show(await get(`${V1}/documentosClinicos?q=${encodeURIComponent(JSON.stringify({id_paciente:{eq:PATIENT_ID}}))}`, `v1 /documentosClinicos?q[id_paciente]`))
show(await get(`${V1}/pacientes/${PATIENT_ID}/documentosClinicos`, `v1 /pacientes/${PATIENT_ID}/documentosClinicos`))

// ── 3. Consentimientos ────────────────────────────────────────────
console.log('\n\x1b[1m=== CONSENTIMIENTOS ===\x1b[0m')
show(await get(`${V5}/consentimientos`, `v5 /consentimientos`))
show(await get(`${V5}/pacientes/${PATIENT_ID}/consentimientos`, `v5 /pacientes/${PATIENT_ID}/consentimientos`))
show(await get(`${V1}/consentimientos`, `v1 /consentimientos`))
show(await get(`${V1}/pacientes/${PATIENT_ID}/consentimientos`, `v1 /pacientes/${PATIENT_ID}/consentimientos`))

// ── 4. Imágenes ───────────────────────────────────────────────────
console.log('\n\x1b[1m=== IMÁGENES ===\x1b[0m')
show(await get(`${V5}/pacientes/${PATIENT_ID}/imagenes`, `v5 /pacientes/${PATIENT_ID}/imagenes`))
show(await get(`${V5}/imagenes`, `v5 /imagenes`))
show(await get(`${V1}/pacientes/${PATIENT_ID}/imagenes`, `v1 /pacientes/${PATIENT_ID}/imagenes`))
show(await get(`${V1}/imagenes`, `v1 /imagenes`))

// ── 5. Fichas clínicas ────────────────────────────────────────────
console.log('\n\x1b[1m=== FICHAS ===\x1b[0m')
show(await get(`${V5}/pacientes/${PATIENT_ID}/fichas`, `v5 /pacientes/${PATIENT_ID}/fichas`))
show(await get(`${V5}/fichas`, `v5 /fichas`))
show(await get(`${V1}/pacientes/${PATIENT_ID}/fichas`, `v1 /pacientes/${PATIENT_ID}/fichas`))
show(await get(`${V1}/fichas`, `v1 /fichas`))
// Fichas vía atenciones (docs muestran /atenciones/{id}/fichas)
show(await get(`${V5}/pacientes/${PATIENT_ID}/atenciones`, `v5 /pacientes/${PATIENT_ID}/atenciones`))

// ── 6. Archivos — explorar todos los items para detectar tipos ────
console.log('\n\x1b[1m=== ARCHIVOS — TODOS LOS ITEMS DEL PACIENTE ===\x1b[0m')
{
  const r = await get(`${V5}/pacientes/${PATIENT_ID}/archivos`, 'archivos completo')
  const items = r.body?.data ?? []
  console.log(`Total archivos: ${items.length}`)
  for (const f of items) {
    console.log(`\n  id=${f.id} nombre="${f.nombre}" titulo="${f.titulo}"`)
    console.log(`  estado=${f.estado} fecha_creacion="${f.fecha_creacion}"`)
    console.log(`  observaciones="${f.observaciones}"`)
    if (f.urls) console.log(`  urls.original: ${f.urls.original?.slice(0,80)}...`)
    else console.log(`  (sin urls)`)
  }
}

// v1 archivos — ¿devuelve más campos o ítems?
console.log('\n\x1b[1m=== ARCHIVOS v1 ===\x1b[0m')
{
  const r = await get(`${V1}/pacientes/${PATIENT_ID}/archivos`, 'v1 archivos')
  show(r)
  const items = r.body?.data ?? []
  for (const f of items) {
    console.log(`  id=${f.id} nombre="${f.nombre}" titulo="${f.titulo}" tipo="${f.tipo ?? '(sin tipo)'}"`)
  }
}

// ── 7. Atenciones → fichas (ruta doc oficial) ─────────────────────
console.log('\n\x1b[1m=== ATENCIONES → FICHAS (ruta doc) ===\x1b[0m')
{
  const r5 = await get(`${V5}/pacientes/${PATIENT_ID}/atenciones`, 'v5 atenciones del paciente')
  show(r5)
  const atenciones = Array.isArray(r5.body?.data) ? r5.body.data : []
  if (atenciones.length > 0) {
    const id = atenciones[0].id
    console.log(`  Primera atencion id=${id}`)
    show(await get(`${V5}/atenciones/${id}`, `v5 /atenciones/${id}`))
    show(await get(`${V5}/atenciones/${id}/fichas`, `v5 /atenciones/${id}/fichas`))
    show(await get(`${V5}/atenciones/${id}/evoluciones`, `v5 /atenciones/${id}/evoluciones`))
    show(await get(`${V5}/atenciones/${id}/detalles`, `v5 /atenciones/${id}/detalles`))
  }
}

// ── 8. Recetas ────────────────────────────────────────────────────
console.log('\n\x1b[1m=== RECETAS ===\x1b[0m')
show(await get(`${V5}/pacientes/${PATIENT_ID}/recetas`, `v5 /pacientes/${PATIENT_ID}/recetas`))
show(await get(`${V1}/pacientes/${PATIENT_ID}/recetas`, `v1 /pacientes/${PATIENT_ID}/recetas`))

// ── 9. Adicionales / campos adicionales ──────────────────────────
console.log('\n\x1b[1m=== ADICIONALES / CAMPOS ADICIONALES ===\x1b[0m')
show(await get(`${V5}/pacientes/${PATIENT_ID}/adicionales`, `v5 /pacientes/${PATIENT_ID}/adicionales`))
show(await get(`${V1}/pacientes/${PATIENT_ID}/adicionales`, `v1 /pacientes/${PATIENT_ID}/adicionales`))
show(await get(`${V5}/camposAdicionales`, `v5 /camposAdicionales`))
show(await get(`${V1}/camposAdicionales`, `v1 /camposAdicionales`))

// ── 10. Estados de cita (cotejo versiones) ────────────────────────
console.log('\n\x1b[1m=== ESTADOS DE CITA ===\x1b[0m')
{
  const r1 = await get(`${V1}/citas/estados`, 'v1 /citas/estados')
  const r5 = await get(`${V5}/citas/estados`, 'v5 /citas/estados')
  show(r1)
  show(r5)
  // mostrar todos los estados
  const estados = r5.body?.data ?? r1.body?.data ?? []
  if (Array.isArray(estados)) {
    console.log(`  Total estados: ${estados.length}`)
    for (const e of estados) {
      console.log(`  id=${e.id} nombre="${e.nombre}" anulacion=${e.anulacion} habilitado=${e.habilitado}`)
    }
  }
}
