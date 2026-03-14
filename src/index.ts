// LUNA — Leads Unified Nurturing Agent
// Servidor HTTP unificado: /oficina, /health, /webhooks (futuro)

import * as http from 'node:http'
import { config } from './config.js'
import { handleOficinaRequest } from './oficina/config-server.js'

const logger = {
  info: (data: Record<string, unknown>, msg: string) =>
    console.log(JSON.stringify({ level: 'info', msg, ...data, ts: new Date().toISOString() })),
}

function main(): void {
  const server = http.createServer(async (req, res) => {
    const url = req.url ?? '/'

    // Oficina
    if (config.oficina.enabled && url.startsWith('/oficina')) {
      await handleOficinaRequest(req, res)
      return
    }

    // Health check
    if (url === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end('{"status":"ok"}')
      return
    }

    // Future: /webhooks/*

    res.writeHead(404, { 'Content-Type': 'application/json' })
    res.end('{"error":"Not found"}')
  })

  server.listen(config.port, () => {
    logger.info({ port: config.port }, 'LUNA server started')
    if (config.oficina.enabled) logger.info({ path: '/oficina' }, 'Oficina available at /oficina')
  })
}

main()
