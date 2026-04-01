const TOKEN = "RV0BjhB2WvLY35pr17780HELOVFpi9W7EBOEyAqW.MTppKpkydP7bXvzmaguFG8ghgmfyqc9EfprcJtQv"
const paths = [
  "https://api.medilink2.healthatom.com/sucursales",
  "https://api.medilink2.healthatom.com/v1/sucursales",
  "https://api.medilink2.healthatom.com/api/v1/sucursales",
  "https://api.medilink2.healthatom.com/api/sucursales",
  "https://api.medilink2.healthatom.com/",
  "https://api.medilink2.healthatom.com",
]
for (const url of paths) {
  try {
    const r = await fetch(url, { headers: { Authorization: `Token ${TOKEN}`, Accept: "application/json" }, signal: AbortSignal.timeout(8000) })
    const t = await r.text()
    console.log(`${r.status} ${url}`)
    console.log(`  → ${t.slice(0, 200)}`)
  } catch(e) {
    console.log(`ERR ${url} → ${e.message}`)
  }
}
