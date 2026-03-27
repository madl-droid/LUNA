// LUNA — Module: medilink
// Webhook handler: receives, verifies, and dispatches Medilink webhook events

import crypto from 'node:crypto'
import pino from 'pino'
import type { Pool } from 'pg'
import type { MedilinkConfig, WebhookPayload, WebhookEntity, WebhookAction } from './types.js'
import type { MedilinkCache } from './cache.js'
import * as pgStore from './pg-store.js'

const logger = pino({ name: 'medilink:webhook' })

export class WebhookHandler {
  private config: MedilinkConfig
  private db: Pool
  private cache: MedilinkCache

  // Event listeners registered by other parts of the module
  private listeners: Array<{
    entity: WebhookEntity | '*'
    action: WebhookAction | '*'
    handler: (payload: WebhookPayload) => Promise<void>
  }> = []

  constructor(config: MedilinkConfig, db: Pool, cache: MedilinkCache) {
    this.config = config
    this.db = db
    this.cache = cache
  }

  /** Register a listener for webhook events */
  on(entity: WebhookEntity | '*', action: WebhookAction | '*', handler: (payload: WebhookPayload) => Promise<void>): void {
    this.listeners.push({ entity, action, handler })
  }

  /** Main webhook processing — called fire-and-forget after 200 response */
  async handleWebhook(rawBody: string, token: string, signing: string): Promise<void> {
    let payload: WebhookPayload

    try {
      payload = JSON.parse(rawBody) as WebhookPayload
    } catch {
      logger.error('Webhook: invalid JSON body')
      return
    }

    const entity = payload.entity
    const action = payload.action
    const medilinkId = payload.data?.id ?? 0

    // Verify public key
    if (this.config.MEDILINK_WEBHOOK_PUBLIC_KEY && token !== this.config.MEDILINK_WEBHOOK_PUBLIC_KEY) {
      logger.warn({ token, entity, action }, 'Webhook: invalid public key')
      await pgStore.logWebhook(this.db, {
        entity, action, medilinkId,
        payload, signatureValid: false, processed: false,
        error: 'Invalid public key',
      })
      return
    }

    // Verify HMAC signature
    if (this.config.MEDILINK_WEBHOOK_PRIVATE_KEY && signing) {
      const valid = this.verifySignature(rawBody, signing)
      if (!valid) {
        logger.warn({ entity, action }, 'Webhook: invalid HMAC signature')
        await pgStore.logWebhook(this.db, {
          entity, action, medilinkId,
          payload, signatureValid: false, processed: false,
          error: 'Invalid HMAC signature',
        })
        return
      }
    }

    logger.info({ entity, action, medilinkId }, 'Webhook received')

    // Log to webhook_log
    await pgStore.logWebhook(this.db, {
      entity, action, medilinkId,
      payload, signatureValid: true, processed: true,
    })

    // Invalidate cache
    try {
      await this.cache.invalidateByEntity(entity, medilinkId)
    } catch (err) {
      logger.error({ err, entity, action }, 'Webhook: cache invalidation failed')
    }

    // Dispatch to listeners
    for (const listener of this.listeners) {
      const entityMatch = listener.entity === '*' || listener.entity === entity
      const actionMatch = listener.action === '*' || listener.action === action
      if (entityMatch && actionMatch) {
        try {
          await listener.handler(payload)
        } catch (err) {
          logger.error({ err, entity, action, listener: listener.entity }, 'Webhook: listener error')
        }
      }
    }
  }

  private verifySignature(body: string, signing: string): boolean {
    const privateKey = this.config.MEDILINK_WEBHOOK_PRIVATE_KEY
    // FIX: SEC-4.1 — Rechazar si no hay key configurada (antes aceptaba todo)
    if (!privateKey) {
      logger.warn('Medilink webhook rejected: no private key configured')
      return false
    }

    try {
      const expected = crypto
        .createHmac('sha256', privateKey)
        .update(body)
        .digest('hex')
      return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signing))
    } catch {
      // Length mismatch or other error
      return false
    }
  }
}
