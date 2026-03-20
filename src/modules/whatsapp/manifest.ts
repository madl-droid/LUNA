// LUNA — Module: whatsapp
// Canal WhatsApp vía Baileys (conexión directa).
// Auth state stored in PostgreSQL — no filesystem credentials.

import { z } from 'zod'
import type { ModuleManifest, ApiRoute } from '../../kernel/types.js'
import type { Registry } from '../../kernel/registry.js'
import { BaileysAdapter } from './adapter.js'
import * as configStore from '../../kernel/config-store.js'
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
        jsonResponse(res, 200, { status: 'not_initialized', qrDataUrl: null, lastDisconnectReason: null, connectedNumber: null, moduleEnabled })
        return
      }
      const state = adapter.getState()
      let qrDataUrl: string | null = null
      if (state.qr) {
        try {
          qrDataUrl = await QRCode.toDataURL(state.qr, { width: 300, margin: 2, color: { dark: '#e2e8f0', light: '#0f172a' } })
        } catch { /* ignore */ }
      }
      jsonResponse(res, 200, { status: state.status, qrDataUrl, lastDisconnectReason: state.lastDisconnectReason, connectedNumber: state.connectedNumber, moduleEnabled })
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
  version: '1.1.0',
  description: {
    es: 'Canal de WhatsApp usando Baileys (conexión directa, auth en DB)',
    en: 'WhatsApp channel using Baileys (direct connection, DB auth)',
  },
  type: 'channel',
  removable: true,
  activateByDefault: true,
  depends: [],

  configSchema: z.object({
    WHATSAPP_RECONNECT_INTERVAL_MS: z.string().transform(Number).pipe(z.number().int()).default('5000'),
    WHATSAPP_MAX_RECONNECT_ATTEMPTS: z.string().transform(Number).pipe(z.number().int()).default('10'),
  }),

  oficina: {
    title: { es: 'WhatsApp (Baileys)', en: 'WhatsApp (Baileys)' },
    info: {
      es: 'Conexión directa a WhatsApp. Credenciales almacenadas en la base de datos, no en el filesystem.',
      en: 'Direct WhatsApp connection. Credentials stored in database, not filesystem.',
    },
    order: 10,
    fields: [
      {
        key: 'WHATSAPP_CONNECTED_NUMBER',
        type: 'text',
        label: { es: 'Numero conectado', en: 'Connected number' },
        info: { es: 'Numero de WhatsApp vinculado actualmente (solo lectura)', en: 'Currently linked WhatsApp number (read-only)' },
      },
      {
        key: 'WHATSAPP_CONNECTION_STATUS',
        type: 'text',
        label: { es: 'Estado de conexion', en: 'Connection status' },
        info: { es: 'Estado actual de la conexion WhatsApp (solo lectura)', en: 'Current WhatsApp connection status (read-only)' },
      },
    ],
    apiRoutes,
  },

  async init(registry: Registry) {
    _registry = registry
    const config = registry.getConfig<{
      WHATSAPP_RECONNECT_INTERVAL_MS: number
      WHATSAPP_MAX_RECONNECT_ATTEMPTS: number
    }>('whatsapp')

    const db = registry.getDb()
    // Stable instance ID: survives container recreation across deploys.
    // Falls back to hostname only for local dev without INSTANCE_ID set.
    const instanceId = process.env.INSTANCE_ID || 'luna-default'

    adapter = new BaileysAdapter(config, db, instanceId, {
      onConnected: async () => {
        if (_registry && !_registry.isActive('whatsapp')) {
          try {
            await _registry.activate('whatsapp')
          } catch { /* already active or other issue */ }
        }
      },
      onStatusChange: async (status, connectedNumber) => {
        try {
          await configStore.set(db, 'WHATSAPP_CONNECTION_STATUS', status, false)
          await configStore.set(db, 'WHATSAPP_CONNECTED_NUMBER', connectedNumber ?? '', false)
        } catch (err) {
          // Non-critical — log and continue
          const pino = await import('pino')
          pino.default({ name: 'whatsapp:manifest' }).warn({ err }, 'Failed to persist connection metadata')
        }
      },
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
