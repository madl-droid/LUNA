// LUNA — Kernel HTTP helpers
// Utilidades compartidas para handlers de API routes en módulos.
// Evita duplicar readBody/jsonResponse/parseQuery en cada manifest.

import type { IncomingMessage, ServerResponse } from 'node:http'

/** Lee el body de un request como string UTF-8 */
// FIX: SEC-9.1 — Limitar tamaño de body para prevenir OOM
export function readBody(req: IncomingMessage, maxBytes = 10 * 1024 * 1024): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let totalSize = 0
    req.on('data', (chunk: Buffer) => {
      totalSize += chunk.length
      if (totalSize > maxBytes) {
        req.destroy()
        reject(new Error(`Body exceeds limit of ${maxBytes} bytes`))
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')))
    req.on('error', reject)
  })
}

/** Lee y parsea el body como JSON. Retorna {} si el body está vacío. */
export async function parseBody<T = Record<string, unknown>>(req: IncomingMessage): Promise<T> {
  const raw = await readBody(req)
  if (!raw || raw.trim() === '') return {} as T
  return JSON.parse(raw) as T
}

/** Envía una respuesta JSON con status code */
export function jsonResponse(res: ServerResponse, status: number, data: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify(data))
}

/** Parsea query params de un request usando la API URL estándar */
export function parseQuery(req: IncomingMessage): URLSearchParams {
  const url = new URL(req.url ?? '', 'http://localhost')
  return url.searchParams
}

/** Extrae el pathname sin query string */
export function getPathname(req: IncomingMessage): string {
  const url = new URL(req.url ?? '', 'http://localhost')
  return url.pathname
}

/** Build absolute URL from request headers (host + x-forwarded-proto) */
export function buildBaseUrl(req: IncomingMessage): string {
  const proto = (req.headers['x-forwarded-proto'] as string)?.split(',')[0]?.trim() || 'https'
  const host = (req.headers['x-forwarded-host'] as string) || req.headers.host || 'localhost'
  return `${proto}://${host}`
}

/** Render a styled OAuth callback result page (shown in popup, auto-closes) */
export function oauthCallbackPage(opts: { success: boolean; title: string; message: string; closeMs?: number }): string {
  const color = opts.success ? '#16a34a' : '#dc2626'
  const icon = opts.success
    ? '<svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#16a34a" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="16 9 10.5 14.5 8 12"/></svg>'
    : '<svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#dc2626" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>'
  const ms = opts.closeMs ?? (opts.success ? 2500 : 6000)
  return `<!DOCTYPE html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${opts.title}</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:system-ui,-apple-system,sans-serif;background:#f5f5f7;display:flex;align-items:center;justify-content:center;min-height:100vh}
.card{background:#fff;border-radius:16px;padding:48px 40px;text-align:center;max-width:380px;width:90%;box-shadow:0 4px 24px rgba(0,0,0,0.08)}
.icon{margin-bottom:16px}
h2{font-size:1.25rem;font-weight:600;color:${color};margin-bottom:8px}
p{font-size:0.88rem;color:#666;line-height:1.4}
.bar{margin-top:20px;height:3px;background:#e8e8e8;border-radius:2px;overflow:hidden}
.bar-fill{height:100%;background:${color};border-radius:2px;animation:shrink ${ms}ms linear forwards}
@keyframes shrink{from{width:100%}to{width:0%}}
</style></head><body>
<div class="card">
  <div class="icon">${icon}</div>
  <h2>${opts.title}</h2>
  <p>${opts.message}</p>
  <div class="bar"><div class="bar-fill"></div></div>
</div>
<script>setTimeout(function(){window.close()},${ms})</script>
</body></html>`
}
