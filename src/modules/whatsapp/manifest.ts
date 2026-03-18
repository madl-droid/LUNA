// LUNA — Module: whatsapp
// Canal WhatsApp vía Baileys (conexión directa).

import { z } from 'zod'
import type { ModuleManifest, ApiRoute } from '../../kernel/types.js'
import type { Registry } from '../../kernel/registry.js'
import { BaileysAdapter } from './adapter.js'
import QRCode from 'qrcode'

let adapter: BaileysAdapter | null = null
let _registry: Registry | null = null

function jsonResponse(res: import('node:http').ServerResponse, status: number, data: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify(data))
}

const apiRoutes: ApiRoute[] = [
  {
    method: 'GET',
    path: 'status',
    handler: async (_req, res) => {
      const moduleEnabled = _registry?.isActive('whatsapp') ?? false
      if (!adapter) {
        jsonResponse(res, 200, { status: 'not_initialized', qrDataUrl: null, lastDisconnectReason: null, moduleEnabled })
        return
      }
      const state = adapter.getState()
      let qrDataUrl: string | null = null
      if (state.qr) {
        try {
          qrDataUrl = await QRCode.toDataURL(state.qr, { width: 300, margin: 2, color: { dark: '#e2e8f0', light: '#0f172a' } })
        } catch { /* ignore */ }
      }
      jsonResponse(res, 200, { status: state.status, qrDataUrl, lastDisconnectReason: state.lastDisconnectReason, moduleEnabled })
    },
  },
  {
    method: 'POST',
    path: 'connect',
    handler: async (_req, res) => {
      if (!adapter) {
        jsonResponse(res, 400, { error: 'WhatsApp adapter not initialized' })
        return
      }
      try {
        await adapter.initialize()
        jsonResponse(res, 200, { ok: true, status: adapter.getState().status })
      } catch (err) {
        jsonResponse(res, 500, { error: 'Failed to connect: ' + String(err) })
      }
    },
  },
  {
    method: 'POST',
    path: 'disconnect',
    handler: async (_req, res) => {
      if (!adapter) {
        jsonResponse(res, 400, { error: 'WhatsApp adapter not initialized' })
        return
      }
      try {
        await adapter.disconnect()
        jsonResponse(res, 200, { ok: true, status: 'disconnected' })
      } catch (err) {
        jsonResponse(res, 500, { error: 'Failed to disconnect: ' + String(err) })
      }
    },
  },
]

const manifest: ModuleManifest = {
  name: 'whatsapp',
  version: '1.0.0',
  description: {
    es: 'Canal de WhatsApp usando Baileys (conexión directa)',
    en: 'WhatsApp channel using Baileys (direct connection)',
  },
  type: 'channel',
  removable: true,
  activateByDefault: true,
  depends: [],

  configSchema: z.object({
    WHATSAPP_AUTH_DIR: z.string().default('instance/wa-auth'),
    WHATSAPP_RECONNECT_INTERVAL_MS: z.string().transform(Number).pipe(z.number().int()).default('5000'),
    WHATSAPP_MAX_RECONNECT_ATTEMPTS: z.string().transform(Number).pipe(z.number().int()).default('10'),
  }),

  oficina: {
    title: { es: 'WhatsApp (Baileys)', en: 'WhatsApp (Baileys)' },
    info: {
      es: 'Conexión directa a WhatsApp. Escanea el QR para vincular.',
      en: 'Direct WhatsApp connection. Scan QR to link device.',
    },
    order: 10,
    fields: [
      { key: 'WHATSAPP_AUTH_DIR', type: 'text', label: { es: 'Directorio de autenticación', en: 'Auth directory' } },
    ],
    apiRoutes,
  },

  async init(registry: Registry) {
    _registry = registry
    const config = registry.getConfig<{
      WHATSAPP_AUTH_DIR: string
      WHATSAPP_RECONNECT_INTERVAL_MS: number
      WHATSAPP_MAX_RECONNECT_ATTEMPTS: number
    }>('whatsapp')

    adapter = new BaileysAdapter(config, async () => {
      // Auto-activate module when WhatsApp connects successfully
      if (_registry && !_registry.isActive('whatsapp')) {
        try {
          await _registry.activate('whatsapp')
        } catch { /* already active or other issue — ignore */ }
      }
    })

    // Register hook: when pipeline sends a message for whatsapp channel
    registry.addHook('whatsapp', 'message:send', async (payload) => {
      if (payload.channel !== 'whatsapp') return
      if (!adapter) return

      const result = await adapter.sendMessage(payload.to, {
        to: payload.to,
        content: { type: payload.content.type as 'text', text: payload.content.text },
      })

      await registry.runHook('message:sent', {
        channel: 'whatsapp',
        to: payload.to,
        channelMessageId: result.channelMessageId,
        success: result.success,
      })
    })

    // Register message handler: incoming messages → fire hook
    adapter.onMessage(async (msg) => {
      await registry.runHook('message:incoming', {
        id: msg.id,
        channelName: msg.channelName,
        channelMessageId: msg.channelMessageId,
        from: msg.from,
        timestamp: msg.timestamp,
        content: msg.content,
        raw: msg.raw,
      })
    })

    // Expose adapter as service for other modules
    registry.provide('whatsapp:adapter', adapter)

    // Auto-connect
    await adapter.initialize()
  },

  async stop() {
    if (adapter) {
      await adapter.shutdown()
      adapter = null
    }
    _registry = null
  },
}

export default manifest
