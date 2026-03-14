// LUNA — Admin config server
// Server HTTP nativo para editar instance/config.json desde UI web.
// Sin Express ni Fastify — usa http nativo de Node.js.

import * as http from 'node:http'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { z } from 'zod'
import pino from 'pino'
import { config, instanceConfigSchema, reloadInstanceConfig } from '../config.js'

const logger = pino({ name: 'admin-server', level: config.logLevel })

const INSTANCE_CONFIG_PATH = path.resolve('instance/config.json')
const INSTANCE_SCHEMA_PATH = path.resolve('instance/config.schema.json')
const UI_HTML_PATH = path.resolve(path.dirname(new URL(import.meta.url).pathname), 'config-ui.html')
// Also check for HTML in dist/admin/ (compiled output) and src/admin/ (dev)
const UI_HTML_PATHS = [
  UI_HTML_PATH,
  path.resolve('src/admin/config-ui.html'),
  path.resolve('dist/admin/config-ui.html'),
]

function findHtmlFile(): string | null {
  for (const p of UI_HTML_PATHS) {
    if (fs.existsSync(p)) return p
  }
  return null
}

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    req.on('data', (chunk: Buffer) => chunks.push(chunk))
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')))
    req.on('error', reject)
  })
}

function sendJson(res: http.ServerResponse, status: number, data: unknown): void {
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
  })
  res.end(JSON.stringify(data))
}

function sendHtml(res: http.ServerResponse, html: string): void {
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
  res.end(html)
}

function handleGetConfig(_req: http.IncomingMessage, res: http.ServerResponse): void {
  try {
    const raw = fs.readFileSync(INSTANCE_CONFIG_PATH, 'utf-8')
    const data = JSON.parse(raw)
    sendJson(res, 200, data)
  } catch (err) {
    logger.error({ err }, 'Failed to read config')
    sendJson(res, 500, { error: 'Failed to read config' })
  }
}

function handleGetSchema(_req: http.IncomingMessage, res: http.ServerResponse): void {
  try {
    const raw = fs.readFileSync(INSTANCE_SCHEMA_PATH, 'utf-8')
    const data = JSON.parse(raw)
    sendJson(res, 200, data)
  } catch (err) {
    logger.error({ err }, 'Failed to read schema')
    sendJson(res, 500, { error: 'Failed to read schema' })
  }
}

async function handlePutConfig(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  try {
    const body = await readBody(req)
    const parsed = JSON.parse(body)

    // Validate with Zod
    const validated = instanceConfigSchema.parse(parsed)

    // Write atomically (write to temp, then rename)
    const tmpPath = INSTANCE_CONFIG_PATH + '.tmp'
    fs.writeFileSync(tmpPath, JSON.stringify(validated, null, 2) + '\n', 'utf-8')
    fs.renameSync(tmpPath, INSTANCE_CONFIG_PATH)

    // Reload in-memory config
    reloadInstanceConfig()

    logger.info('Instance config updated via admin UI')
    sendJson(res, 200, { success: true, config: validated })
  } catch (err) {
    if (err instanceof z.ZodError) {
      logger.warn({ issues: err.issues }, 'Config validation failed')
      sendJson(res, 400, { error: 'Validation failed', issues: err.issues })
    } else {
      logger.error({ err }, 'Failed to save config')
      sendJson(res, 500, { error: 'Failed to save config' })
    }
  }
}

function handleUI(_req: http.IncomingMessage, res: http.ServerResponse): void {
  const htmlPath = findHtmlFile()
  if (!htmlPath) {
    res.writeHead(404, { 'Content-Type': 'text/plain' })
    res.end('Admin UI HTML not found')
    return
  }
  const html = fs.readFileSync(htmlPath, 'utf-8')
  sendHtml(res, html)
}

export function startAdminServer(): http.Server {
  const port = config.admin.port

  const server = http.createServer(async (req, res) => {
    const url = req.url ?? '/'
    const method = req.method ?? 'GET'

    // CORS preflight
    if (method === 'OPTIONS') {
      res.writeHead(204, {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, PUT, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
      })
      res.end()
      return
    }

    try {
      if (url === '/' && method === 'GET') {
        handleUI(req, res)
      } else if (url === '/api/config' && method === 'GET') {
        handleGetConfig(req, res)
      } else if (url === '/api/config' && method === 'PUT') {
        await handlePutConfig(req, res)
      } else if (url === '/api/schema' && method === 'GET') {
        handleGetSchema(req, res)
      } else {
        sendJson(res, 404, { error: 'Not found' })
      }
    } catch (err) {
      logger.error({ err, url, method }, 'Unhandled admin server error')
      sendJson(res, 500, { error: 'Internal server error' })
    }
  })

  server.listen(port, () => {
    logger.info({ port }, 'Admin UI server started')
  })

  return server
}
