// LUNA — Leads Unified Nurturing Agent
// Servidor HTTP unificado: /oficina, /health, /webhooks (futuro)

import * as http from 'node:http'
import { config } from './config.js'
import { handleOficinaRequest, setWhatsAppAdapter } from './oficina/config-server.js'
import { BaileysAdapter } from './channels/whatsapp/baileys-adapter.js'
import { createMessageHandler } from './engine/responder.js'

const logger = {
  info: (data: Record<string, unknown>, msg: string) =>
    console.log(JSON.stringify({ level: 'info', msg, ...data, ts: new Date().toISOString() })),
}

function main(): void {
  // Initialize WhatsApp adapter and register with oficina
  const waAdapter = new BaileysAdapter()
  setWhatsAppAdapter(waAdapter)
  waAdapter.onMessage(createMessageHandler(waAdapter))

  // Auto-connect WhatsApp if module is enabled
  if (config.modules.whatsapp) {
    waAdapter.initialize().catch(err => {
      console.error(JSON.stringify({ level: 'error', msg: 'Failed to initialize WhatsApp', error: String(err), ts: new Date().toISOString() }))
    })
  }

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
      res.end(JSON.stringify({ status: 'ok', whatsapp: waAdapter.getState().status }))
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
