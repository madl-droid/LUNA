// LUNA — Module: twilio-voice — Twilio Adapter
// REST API client para Twilio: hacer/recibir llamadas, generar TwiML, validar signatures.

import * as crypto from 'node:crypto'
import pino from 'pino'
import type { TwilioVoiceConfig } from './types.js'

const logger = pino({ name: 'twilio-voice:adapter' })

export class TwilioAdapter {
  private accountSid: string
  private authToken: string
  private phoneNumber: string
  private baseUrl: string

  constructor(config: TwilioVoiceConfig) {
    this.accountSid = config.TWILIO_ACCOUNT_SID
    this.authToken = config.TWILIO_AUTH_TOKEN
    this.phoneNumber = config.TWILIO_PHONE_NUMBER
    this.baseUrl = `https://api.twilio.com/2010-04-01/Accounts/${this.accountSid}`
  }

  /**
   * Generate TwiML for answering an inbound call.
   * Includes pause for natural ring delay, then connects to media stream.
   */
  generateInboundTwiML(
    mediaStreamUrl: string,
    answerDelayRings: number,
    customParams?: Record<string, string>,
  ): string {
    const pauseSeconds = Math.max(0, (answerDelayRings - 1) * 2.5)
    const paramTags = customParams
      ? Object.entries(customParams)
          .map(([name, value]) => `<Parameter name="${escapeXml(name)}" value="${escapeXml(value)}" />`)
          .join('\n          ')
      : ''

    return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  ${pauseSeconds > 0 ? `<Pause length="${Math.round(pauseSeconds)}" />` : ''}
  <Connect>
    <Stream url="${escapeXml(mediaStreamUrl)}">
      ${paramTags}
    </Stream>
  </Connect>
</Response>`
  }

  /**
   * Generate TwiML for outbound call (no pause needed).
   */
  generateOutboundTwiML(
    mediaStreamUrl: string,
    customParams?: Record<string, string>,
  ): string {
    const paramTags = customParams
      ? Object.entries(customParams)
          .map(([name, value]) => `<Parameter name="${escapeXml(name)}" value="${escapeXml(value)}" />`)
          .join('\n          ')
      : ''

    return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Connect>
    <Stream url="${escapeXml(mediaStreamUrl)}">
      ${paramTags}
    </Stream>
  </Connect>
</Response>`
  }

  /**
   * Initiate an outbound call via Twilio REST API.
   */
  async makeCall(
    to: string,
    twimlUrl: string,
    statusCallbackUrl?: string,
  ): Promise<{ callSid: string; status: string }> {
    const params = new URLSearchParams({
      To: to,
      From: this.phoneNumber,
      Url: twimlUrl,
      ...(statusCallbackUrl ? {
        StatusCallback: statusCallbackUrl,
        StatusCallbackEvent: 'initiated ringing answered completed',
      } : {}),
    })

    const response = await fetch(`${this.baseUrl}/Calls.json`, {
      method: 'POST',
      headers: {
        'Authorization': 'Basic ' + Buffer.from(`${this.accountSid}:${this.authToken}`).toString('base64'),
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: params.toString(),
    })

    if (!response.ok) {
      const errorBody = await response.text()
      logger.error({ status: response.status, body: errorBody }, 'Twilio API error making call')
      throw new Error(`Twilio API error: ${response.status} - ${errorBody}`)
    }

    const data = await response.json() as { sid: string; status: string }
    logger.info({ callSid: data.sid, to }, 'Outbound call initiated')
    return { callSid: data.sid, status: data.status }
  }

  /**
   * Hang up an active call via Twilio REST API.
   */
  async hangupCall(callSid: string): Promise<void> {
    const response = await fetch(`${this.baseUrl}/Calls/${callSid}.json`, {
      method: 'POST',
      headers: {
        'Authorization': 'Basic ' + Buffer.from(`${this.accountSid}:${this.authToken}`).toString('base64'),
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: 'Status=completed',
    })

    if (!response.ok) {
      const errorBody = await response.text()
      logger.error({ status: response.status, callSid, body: errorBody }, 'Failed to hang up call')
      throw new Error(`Twilio hangup error: ${response.status}`)
    }

    logger.info({ callSid }, 'Call hung up via API')
  }

  /**
   * Validate Twilio webhook signature to prevent spoofing.
   */
  validateSignature(
    url: string,
    params: Record<string, string>,
    signature: string,
  ): boolean {
    // Sort params and build validation string
    const sortedKeys = Object.keys(params).sort()
    let dataString = url
    for (const key of sortedKeys) {
      dataString += key + params[key]
    }

    const computed = crypto
      .createHmac('sha1', this.authToken)
      .update(dataString)
      .digest('base64')

    return crypto.timingSafeEqual(
      Buffer.from(computed),
      Buffer.from(signature),
    )
  }

  /**
   * Parse form-urlencoded body from Twilio webhook POST.
   */
  static parseWebhookBody(body: string): Record<string, string> {
    const params: Record<string, string> = {}
    const searchParams = new URLSearchParams(body)
    for (const [key, value] of searchParams) {
      params[key] = value
    }
    return params
  }

  isConfigured(): boolean {
    return !!(this.accountSid && this.authToken && this.phoneNumber)
  }
}

function escapeXml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}
