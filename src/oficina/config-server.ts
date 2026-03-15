// LUNA — Oficina server
// Panel de control del agente. Se monta en /oficina del servidor principal.

import * as fs from 'node:fs'
import * as path from 'node:path'
import type * as http from 'node:http'
import QRCode from 'qrcode'
import type { BaileysAdapter } from '../channels/whatsapp/baileys-adapter.js'

const logger = {
  info: (msg: string) => console.log(JSON.stringify({ level: 'info', module: 'oficina', msg, ts: new Date().toISOString() })),
  error: (msg: string, err?: unknown) => console.error(JSON.stringify({ level: 'error', module: 'oficina', msg, error: String(err), ts: new Date().toISOString() })),
}

// --- WhatsApp adapter reference (set from index.ts) ---
let waAdapter: BaileysAdapter | null = null

export function setWhatsAppAdapter(adapter: BaileysAdapter): void {
  waAdapter = adapter
}

function jsonResponse(res: http.ServerResponse, status: number, data: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify(data))
}

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    req.on('data', (chunk: Buffer) => chunks.push(chunk))
    req.on('end', () => resolve(Buffer.concat(chunks).toString()))
    req.on('error', reject)
  })
}

function findEnvFile(): string {
  const candidates = [
    path.resolve(process.cwd(), '.env'),
    path.resolve(process.cwd(), '..', '.env'),
  ]
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate
  }
  return candidates[0]!
}

function parseEnvFile(filePath: string): Record<string, string> {
  if (!fs.existsSync(filePath)) return {}
  const content = fs.readFileSync(filePath, 'utf-8')
  const result: Record<string, string> = {}
  for (const line of content.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eqIndex = trimmed.indexOf('=')
    if (eqIndex === -1) continue
    const key = trimmed.slice(0, eqIndex).trim()
    const value = trimmed.slice(eqIndex + 1).trim()
    result[key] = value
  }
  return result
}

function writeEnvFile(filePath: string, values: Record<string, string>): void {
  let content = ''
  if (fs.existsSync(filePath)) {
    content = fs.readFileSync(filePath, 'utf-8')
  }

  for (const [key, value] of Object.entries(values)) {
    const regex = new RegExp(`^${key}=.*$`, 'm')
    if (regex.test(content)) {
      content = content.replace(regex, `${key}=${value}`)
    } else {
      content += `\n${key}=${value}`
    }
  }

  fs.writeFileSync(filePath, content, 'utf-8')
}

function getSchemaInfo(): Record<string, { type: string; default: string; description: string }> {
  const examplePath = path.resolve(process.cwd(), '.env.example')
  if (!fs.existsSync(examplePath)) return {}

  const content = fs.readFileSync(examplePath, 'utf-8')
  const schema: Record<string, { type: string; default: string; description: string }> = {}
  let currentSection = ''

  for (const line of content.split('\n')) {
    const trimmed = line.trim()
    if (trimmed.startsWith('# ---') && trimmed.endsWith('---')) {
      currentSection = trimmed.replace(/^# -+ /, '').replace(/ -+$/, '')
      continue
    }
    if (trimmed.startsWith('#') || !trimmed) continue
    const eqIndex = trimmed.indexOf('=')
    if (eqIndex === -1) continue
    const key = trimmed.slice(0, eqIndex).trim()
    const defaultValue = trimmed.slice(eqIndex + 1).trim()

    let type = 'string'
    if (defaultValue === 'true' || defaultValue === 'false') type = 'boolean'
    else if (/^\d+$/.test(defaultValue)) type = 'integer'
    else if (/^\d+\.\d+$/.test(defaultValue)) type = 'float'

    schema[key] = { type, default: defaultValue, description: currentSection }
  }
  return schema
}

function serveHtml(res: http.ServerResponse): void {
  // Try dist/ first (production), then src/ (development)
  const candidates = [
    path.resolve(process.cwd(), 'dist', 'oficina', 'config-ui.html'),
    path.resolve(process.cwd(), 'src', 'oficina', 'config-ui.html'),
  ]

  for (const htmlPath of candidates) {
    if (fs.existsSync(htmlPath)) {
      const html = fs.readFileSync(htmlPath, 'utf-8')
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
      res.end(html)
      return
    }
  }

  res.writeHead(404, { 'Content-Type': 'text/plain' })
  res.end('Oficina UI not found')
}

/**
 * Handles requests under /oficina.
 * Returns true if the request was handled, false if it doesn't match /oficina prefix.
 */
export async function handleOficinaRequest(req: http.IncomingMessage, res: http.ServerResponse): Promise<boolean> {
  const url = req.url ?? '/'
  if (!url.startsWith('/oficina')) return false

  const localUrl = url.slice('/oficina'.length) || '/'
  const method = req.method ?? 'GET'

  // GET /oficina or /oficina/ → serve HTML
  if ((localUrl === '/' || localUrl === '') && method === 'GET') {
    serveHtml(res)
    return true
  }

  // GET /oficina/api/version → return build version
  if (localUrl === '/api/version' && method === 'GET') {
    jsonResponse(res, 200, { version: process.env['BUILD_VERSION'] ?? 'dev' })
    return true
  }

  // GET /oficina/api/config → return current .env values
  if (localUrl === '/api/config' && method === 'GET') {
    const envFile = findEnvFile()
    const values = parseEnvFile(envFile)
    jsonResponse(res, 200, { file: envFile, values })
    return true
  }

  // GET /oficina/api/schema → return schema info from .env.example
  if (localUrl === '/api/schema' && method === 'GET') {
    const schema = getSchemaInfo()
    jsonResponse(res, 200, { schema })
    return true
  }

  // PUT /oficina/api/config → update .env values
  if (localUrl === '/api/config' && method === 'PUT') {
    try {
      const body = await readBody(req)
      const updates = JSON.parse(body) as Record<string, string>
      const envFile = findEnvFile()
      writeEnvFile(envFile, updates)
      logger.info(`Config updated: ${Object.keys(updates).join(', ')}`)
      jsonResponse(res, 200, { ok: true, updated: Object.keys(updates) })
    } catch (err) {
      logger.error('Failed to update config', err)
      jsonResponse(res, 400, { error: 'Invalid request body' })
    }
    return true
  }

  // --- WhatsApp / Baileys endpoints ---

  // GET /oficina/api/whatsapp/status
  if (localUrl === '/api/whatsapp/status' && method === 'GET') {
    if (!waAdapter) {
      jsonResponse(res, 200, { status: 'not_initialized', qrDataUrl: null, lastDisconnectReason: null })
    } else {
      const state = waAdapter.getState()
      let qrDataUrl: string | null = null
      if (state.qr) {
        try {
          qrDataUrl = await QRCode.toDataURL(state.qr, { width: 300, margin: 2, color: { dark: '#e2e8f0', light: '#0f172a' } })
        } catch { /* ignore */ }
      }
      jsonResponse(res, 200, { status: state.status, qrDataUrl, lastDisconnectReason: state.lastDisconnectReason })
    }
    return true
  }

  // POST /oficina/api/whatsapp/connect
  if (localUrl === '/api/whatsapp/connect' && method === 'POST') {
    if (!waAdapter) {
      jsonResponse(res, 400, { error: 'WhatsApp adapter not initialized' })
    } else {
      try {
        await waAdapter.initialize()
        jsonResponse(res, 200, { ok: true, status: waAdapter.getState().status })
      } catch (err) {
        logger.error('Failed to connect WhatsApp', err)
        jsonResponse(res, 500, { error: 'Failed to connect: ' + String(err) })
      }
    }
    return true
  }

  // POST /oficina/api/whatsapp/disconnect
  if (localUrl === '/api/whatsapp/disconnect' && method === 'POST') {
    if (!waAdapter) {
      jsonResponse(res, 400, { error: 'WhatsApp adapter not initialized' })
    } else {
      try {
        await waAdapter.disconnect()
        jsonResponse(res, 200, { ok: true, status: 'disconnected' })
      } catch (err) {
        logger.error('Failed to disconnect WhatsApp', err)
        jsonResponse(res, 500, { error: 'Failed to disconnect: ' + String(err) })
      }
    }
    return true
  }

  // Unknown /oficina route
  jsonResponse(res, 404, { error: 'Not found' })
  return true
}
