// LUNA — Module: medilink
// Follow-up scheduler: BullMQ-based appointment reminder sequence
// 9-touch system: confirmation → reminders → no-show → reactivation

import { Queue, Worker, type Job } from 'bullmq'
import pino from 'pino'
import type { Pool } from 'pg'
import type { Redis } from 'ioredis'
import type { Registry } from '../../kernel/registry.js'
import type {
  MedilinkConfig, FollowUpTouchType, FollowUpTemplate,
  MedilinkAppointment,
} from './types.js'
import * as pgStore from './pg-store.js'

const logger = pino({ name: 'medilink:followup' })

const QUEUE_NAME = 'luna:medilink-followups'

// ─── Job payload ────────────────────────

interface FollowUpJobData {
  followUpId: string
  touchType: FollowUpTouchType
  contactId: string
  agentId: string
  medilinkAppointmentId: string
  patientName: string
  appointmentDate: string
  appointmentTime: string
  professionalName: string
  treatmentName: string
  branchName: string
  branchAddress: string
  clinicName: string
}

// ─── Scheduler class ───────────────────

export class FollowUpScheduler {
  private queue: Queue<FollowUpJobData> | null = null
  private worker: Worker<FollowUpJobData> | null = null
  private registry: Registry
  private db: Pool
  private config: MedilinkConfig

  constructor(registry: Registry, db: Pool, config: MedilinkConfig) {
    this.registry = registry
    this.db = db
    this.config = config
  }

  updateConfig(config: MedilinkConfig): void {
    this.config = config
  }

  // ─── Lifecycle ──────────────────────────

  async start(redis: Redis): Promise<void> {
    const connection = {
      host: redis.options.host ?? 'localhost',
      port: redis.options.port ?? 6379,
      password: redis.options.password as string | undefined,
      db: redis.options.db ?? 0,
    }

    this.queue = new Queue<FollowUpJobData>(QUEUE_NAME, {
      connection,
      defaultJobOptions: {
        removeOnComplete: { count: 500 },
        removeOnFail: { count: 200 },
        attempts: 2,
        backoff: { type: 'exponential', delay: 60000 },
      },
    })

    this.worker = new Worker<FollowUpJobData>(
      QUEUE_NAME,
      async (job: Job<FollowUpJobData>) => {
        await this.processJob(job)
      },
      { connection, concurrency: 3 },
    )

    this.worker.on('failed', (job: Job<FollowUpJobData> | undefined, err: Error) => {
      logger.error({ followUpId: job?.data?.followUpId, touchType: job?.data?.touchType, err }, 'Follow-up job failed')
    })

    this.worker.on('completed', (job: Job<FollowUpJobData>) => {
      logger.debug({ followUpId: job.data.followUpId, touchType: job.data.touchType }, 'Follow-up job completed')
    })

    logger.info('Follow-up scheduler started')
  }

  async stop(): Promise<void> {
    await this.worker?.close()
    await this.queue?.close()
    this.worker = null
    this.queue = null
    logger.info('Follow-up scheduler stopped')
  }

  // ─── Schedule full sequence ─────────────

  /**
   * Create the full follow-up sequence for an appointment.
   * Called when a new appointment is created (via tool or webhook).
   */
  async scheduleSequence(params: {
    appointmentId: string
    contactId: string
    agentId: string
    appointment: {
      fecha: string
      hora_inicio: string
      nombre_paciente: string
      nombre_profesional: string
      nombre_tratamiento: string
      nombre_sucursal: string
    }
    branchAddress?: string
    clinicName?: string
  }): Promise<void> {
    if (!this.config.MEDILINK_FOLLOWUP_ENABLED || !this.queue) {
      logger.debug('Follow-up disabled or queue not ready')
      return
    }

    const { appointmentId, contactId, agentId, appointment } = params
    const appointmentDate = new Date(`${appointment.fecha}T${appointment.hora_inicio}`)

    if (isNaN(appointmentDate.getTime())) {
      logger.warn({ appointmentId, fecha: appointment.fecha, hora: appointment.hora_inicio }, 'Invalid appointment date for follow-up')
      return
    }

    const now = new Date()
    const baseJobData: Omit<FollowUpJobData, 'followUpId' | 'touchType'> = {
      contactId,
      agentId,
      medilinkAppointmentId: appointmentId,
      patientName: appointment.nombre_paciente,
      appointmentDate: appointment.fecha,
      appointmentTime: appointment.hora_inicio,
      professionalName: appointment.nombre_profesional,
      treatmentName: appointment.nombre_tratamiento,
      branchName: appointment.nombre_sucursal,
      branchAddress: params.branchAddress ?? '',
      clinicName: params.clinicName ?? '',
    }

    // Define the touch schedule
    const touches: Array<{
      type: FollowUpTouchType
      channel: 'whatsapp' | 'voice'
      scheduledAt: Date
    }> = [
      // Touch 0: immediate confirmation
      {
        type: 'touch_0',
        channel: 'whatsapp',
        scheduledAt: new Date(now.getTime() + 5000), // 5 seconds from now
      },
      // Touch 1: call X days before
      {
        type: 'touch_1',
        channel: 'voice',
        scheduledAt: new Date(appointmentDate.getTime() - this.config.MEDILINK_FOLLOWUP_TOUCH1_DAYS_BEFORE * 24 * 3600_000),
      },
      // Fallback A: WhatsApp X hours after Touch 1
      {
        type: 'touch_1_fallback_a',
        channel: 'whatsapp',
        scheduledAt: new Date(
          appointmentDate.getTime()
          - this.config.MEDILINK_FOLLOWUP_TOUCH1_DAYS_BEFORE * 24 * 3600_000
          + this.config.MEDILINK_FOLLOWUP_FALLBACK_A_HOURS * 3600_000,
        ),
      },
      // Fallback B: 2nd call X days before
      {
        type: 'touch_1_fallback_b',
        channel: 'voice',
        scheduledAt: new Date(appointmentDate.getTime() - this.config.MEDILINK_FOLLOWUP_FALLBACK_B_DAYS_BEFORE * 24 * 3600_000),
      },
      // Touch 3: prep instructions 24h before
      {
        type: 'touch_3',
        channel: 'whatsapp',
        scheduledAt: new Date(appointmentDate.getTime() - this.config.MEDILINK_FOLLOWUP_TOUCH3_HOURS_BEFORE * 3600_000),
      },
      // Touch 4: short reminder 3h before
      {
        type: 'touch_4',
        channel: 'whatsapp',
        scheduledAt: new Date(appointmentDate.getTime() - this.config.MEDILINK_FOLLOWUP_TOUCH4_HOURS_BEFORE * 3600_000),
      },
      // No-show 1: X hours after appointment
      {
        type: 'no_show_1',
        channel: 'whatsapp',
        scheduledAt: new Date(appointmentDate.getTime() + this.config.MEDILINK_FOLLOWUP_NOSHOW_HOURS_AFTER * 3600_000),
      },
      // No-show 2: 24h after no-show 1
      {
        type: 'no_show_2',
        channel: 'whatsapp',
        scheduledAt: new Date(appointmentDate.getTime() + (this.config.MEDILINK_FOLLOWUP_NOSHOW_HOURS_AFTER + 24) * 3600_000),
      },
      // Reactivation: X days after archiving (ns2 + 15 days)
      {
        type: 'reactivation',
        channel: 'whatsapp',
        scheduledAt: new Date(
          appointmentDate.getTime()
          + (this.config.MEDILINK_FOLLOWUP_NOSHOW_HOURS_AFTER + 24) * 3600_000
          + this.config.MEDILINK_FOLLOWUP_REACTIVATION_DAYS * 24 * 3600_000,
        ),
      },
    ]

    for (const touch of touches) {
      // Skip touches already in the past (except touch_0 which is always immediate)
      if (touch.type !== 'touch_0' && touch.scheduledAt.getTime() <= now.getTime()) {
        logger.debug({ touchType: touch.type, scheduledAt: touch.scheduledAt }, 'Skipping past touch')
        continue
      }

      const delay = Math.max(0, touch.scheduledAt.getTime() - now.getTime())

      // Create DB record first
      const followUpId = await pgStore.createFollowUp(this.db, {
        medilinkAppointmentId: appointmentId,
        contactId,
        agentId,
        appointmentDate,
        touchType: touch.type,
        channel: touch.channel,
        scheduledAt: touch.scheduledAt,
      })

      // Create BullMQ delayed job
      const jobData: FollowUpJobData = { ...baseJobData, followUpId, touchType: touch.type }
      const job = await this.queue.add(`followup:${touch.type}`, jobData, {
        delay,
        jobId: `medilink-fu-${appointmentId}-${touch.type}`,
      })

      // Update DB with BullMQ job ID
      if (job.id) {
        await this.db.query(
          'UPDATE medilink_follow_ups SET bullmq_job_id = $1 WHERE id = $2',
          [job.id, followUpId],
        )
      }

      logger.debug({
        touchType: touch.type,
        channel: touch.channel,
        scheduledAt: touch.scheduledAt,
        delayMs: delay,
      }, 'Follow-up scheduled')
    }

    logger.info({ appointmentId, contactId, touchCount: touches.length }, 'Follow-up sequence created')
  }

  // ─── Cancel sequence ──────────────────

  /**
   * Cancel all pending follow-ups for an appointment.
   * Called on cancel/reschedule.
   */
  async cancelSequence(appointmentId: string): Promise<void> {
    const jobIds = await pgStore.cancelFollowUpsForAppointment(this.db, appointmentId)

    // Remove BullMQ jobs
    if (this.queue) {
      for (const jobId of jobIds) {
        try {
          const job = await this.queue.getJob(jobId)
          if (job) {
            await job.remove()
          }
        } catch (err) {
          logger.warn({ err, jobId }, 'Failed to remove BullMQ job')
        }
      }
    }

    logger.info({ appointmentId, cancelled: jobIds.length }, 'Follow-up sequence cancelled')
  }

  // ─── Job processor ────────────────────

  private async processJob(job: Job<FollowUpJobData>): Promise<void> {
    const { followUpId, touchType, contactId, medilinkAppointmentId } = job.data

    // Check if follow-up is still pending (may have been cancelled)
    const followUps = await pgStore.getFollowUpsForAppointment(this.db, medilinkAppointmentId)
    const thisFollowUp = followUps.find((f) => f.id === followUpId)

    if (!thisFollowUp || thisFollowUp.status !== 'pending') {
      logger.debug({ followUpId, touchType, status: thisFollowUp?.status }, 'Follow-up no longer pending, skipping')
      return
    }

    // Conditional touches: check prerequisites
    const shouldExecute = await this.checkPrerequisites(touchType, medilinkAppointmentId, followUps)
    if (!shouldExecute) {
      await pgStore.updateFollowUpStatus(this.db, followUpId, 'skipped', 'Prerequisites not met')
      logger.info({ followUpId, touchType }, 'Follow-up skipped — prerequisites not met')
      return
    }

    // Get template
    const template = await pgStore.getTemplate(this.db, touchType)
    if (!template) {
      await pgStore.updateFollowUpStatus(this.db, followUpId, 'failed', 'No template found')
      logger.warn({ touchType }, 'No template found for touch type')
      return
    }

    try {
      // Resolve message text
      const messageText = await this.resolveMessage(template, job.data)

      // Send via appropriate channel
      if (template.channel === 'voice') {
        await this.sendVoiceCall(job.data, template, messageText)
      } else {
        await this.sendWhatsApp(contactId, messageText)
      }

      await pgStore.updateFollowUpStatus(this.db, followUpId, 'sent')
      logger.info({ followUpId, touchType, channel: template.channel }, 'Follow-up sent')
    } catch (err) {
      await pgStore.updateFollowUpStatus(this.db, followUpId, 'failed', String(err))
      throw err // Let BullMQ retry
    }
  }

  // ─── Prerequisites ────────────────────

  private async checkPrerequisites(
    touchType: FollowUpTouchType,
    appointmentId: string,
    followUps: Array<{ touchType: string; status: string }>,
  ): Promise<boolean> {
    const getStatus = (type: string) => followUps.find((f) => f.touchType === type)?.status

    switch (touchType) {
      case 'touch_0':
      case 'touch_1':
      case 'touch_4':
        // Always execute
        return true

      case 'touch_1_fallback_a': {
        // Only if Touch 1 failed (call not answered)
        const t1 = getStatus('touch_1')
        return t1 === 'failed'
      }

      case 'touch_1_fallback_b': {
        // Only if no confirmation after Touch 1 + Fallback A
        const t1 = getStatus('touch_1')
        const fa = getStatus('touch_1_fallback_a')
        return t1 !== 'confirmed' && fa !== 'confirmed'
      }

      case 'touch_3': {
        // Only if patient confirmed
        const anyConfirmed = followUps.some((f) => f.status === 'confirmed')
        return anyConfirmed
      }

      case 'no_show_1': {
        // Only if patient didn't attend — check appointment status
        // We check if the appointment was NOT marked as attended
        const confirmed = followUps.some((f) => f.status === 'confirmed')
        return confirmed // Only follow up no-show if they had confirmed
      }

      case 'no_show_2': {
        // Only if no response to no-show 1
        const ns1 = getStatus('no_show_1')
        return ns1 === 'sent' // Sent but no response
      }

      case 'reactivation': {
        // Only if no response to no-show 2
        const ns2 = getStatus('no_show_2')
        return ns2 === 'sent' // Sent but no response
      }

      default:
        return true
    }
  }

  // ─── Message resolution ───────────────

  private async resolveMessage(template: FollowUpTemplate, data: FollowUpJobData): Promise<string> {
    // Replace placeholders in template
    let text = template.templateText
      .replace(/\{nombre\}/g, data.patientName)
      .replace(/\{fecha\}/g, this.formatDate(data.appointmentDate))
      .replace(/\{hora\}/g, data.appointmentTime)
      .replace(/\{tratamiento\}/g, data.treatmentName)
      .replace(/\{profesional\}/g, data.professionalName)
      .replace(/\{direccion\}/g, data.branchAddress)
      .replace(/\{sucursal\}/g, data.branchName)
      .replace(/\{clinica\}/g, data.clinicName)

    // If LLM personalization is enabled, use LLM to polish the message
    if (template.useLlm && template.llmInstructions) {
      try {
        const result = await this.registry.callHook('llm:chat', {
          task: 'medilink-followup-personalize',
          system: `Eres un asistente de la clínica. Tu tarea es personalizar un mensaje de seguimiento de cita.

Instrucciones: ${template.llmInstructions}

REGLAS:
- Mantén el mensaje corto y profesional
- No cambies la información factual (fechas, horas, nombres)
- Devuelve SOLO el mensaje final, sin explicaciones
- El mensaje debe ser en español`,
          messages: [
            {
              role: 'user',
              content: `Personaliza este mensaje de seguimiento:\n\n${text}\n\nDatos:\n- Paciente: ${data.patientName}\n- Fecha: ${this.formatDate(data.appointmentDate)}\n- Hora: ${data.appointmentTime}\n- Profesional: ${data.professionalName}\n- Tratamiento: ${data.treatmentName}`,
            },
          ],
          model: 'fast',
          maxTokens: 300,
        })

        if (result?.text) {
          text = result.text.trim()
        }
      } catch (err) {
        logger.warn({ err, touchType: data.touchType }, 'LLM personalization failed, using template text')
        // Fall through to use template text
      }
    }

    return text
  }

  // ─── Channel dispatch ─────────────────

  private async sendWhatsApp(contactId: string, message: string): Promise<void> {
    await this.registry.runHook('message:send', {
      channel: 'whatsapp',
      to: contactId,
      content: { type: 'text', text: message },
    })
  }

  private async sendVoiceCall(data: FollowUpJobData, template: FollowUpTemplate, _messageText: string): Promise<void> {
    // Try to use twilio-voice module for outbound call
    const callManager = this.registry.getOptional<{
      initiateOutboundCall: (to: string, twimlUrl: string, statusCallbackUrl: string | undefined, mediaStreamUrl: string) => Promise<{ callSid: string; callId: string }>
    }>('twilio-voice:callManager')

    if (!callManager) {
      // Fallback: send WhatsApp message instead of call
      logger.warn({ touchType: data.touchType }, 'twilio-voice not available, falling back to WhatsApp')
      await this.sendWhatsApp(data.contactId, _messageText)
      return
    }

    // For voice calls, we need the server's base URL to construct webhook URLs
    // The call manager handles TwiML generation and media streaming
    // We provide context via the voice script in the template
    try {
      // Store call context for the voice engine to pick up
      const redis = this.registry.getRedis()
      const callContext = {
        type: 'medilink_followup',
        touchType: data.touchType,
        patientName: data.patientName,
        appointmentDate: data.appointmentDate,
        appointmentTime: data.appointmentTime,
        professionalName: data.professionalName,
        treatmentName: data.treatmentName,
        branchName: data.branchName,
        voiceScript: template.voiceScript ?? _messageText,
      }
      // Store context keyed by phone number for voice engine to retrieve
      const phone = data.contactId.replace(/@.*$/, '')
      await redis.set(
        `medilink:followup:voice-context:${phone}`,
        JSON.stringify(callContext),
        'EX', 600, // 10 min TTL
      )

      // Initiate the call via the twilio-voice call manager
      // Build URLs from the kernel server address
      const server = this.registry.getOptional<{ address: () => { port: number } }>('kernel:server')
      const port = server?.address()?.port ?? 3000
      const baseUrl = `https://localhost:${port}`
      const twimlUrl = `${baseUrl}/console/api/twilio-voice/webhook/outbound-twiml`
      const statusUrl = `${baseUrl}/console/api/twilio-voice/webhook/status`
      const mediaStreamUrl = `wss://localhost:${port}/twilio/media-stream`
      await callManager.initiateOutboundCall(phone, twimlUrl, statusUrl, mediaStreamUrl)

      logger.info({ phone, touchType: data.touchType }, 'Voice call initiated')
    } catch (err) {
      logger.error({ err, touchType: data.touchType }, 'Voice call failed, falling back to WhatsApp')
      // Fallback to WhatsApp
      await this.sendWhatsApp(data.contactId, _messageText)
    }
  }

  // ─── Confirmation detection ───────────

  /**
   * Check incoming message for confirmation keywords.
   * Called from message:incoming hook.
   */
  async checkForConfirmation(contactId: string, messageText: string): Promise<boolean> {
    const confirmKeywords = [
      'confirmo', 'confirmado', 'confirmar',
      'si', 'sí', 'ok', 'dale', 'listo',
      'ahí estaré', 'ahi estare', 'voy', 'asisto',
      'perfecto', 'genial', 'de acuerdo',
    ]

    const lower = messageText.toLowerCase().trim()
    const isConfirmation = confirmKeywords.some((kw) => lower.includes(kw))

    if (!isConfirmation) return false

    // Find the nearest pending follow-up for this contact
    const pending = await pgStore.getPendingFollowUpsForContact(this.db, contactId)
    if (pending.length === 0) return false

    // Find the closest upcoming appointment follow-up
    const now = new Date()
    const closest = pending
      .filter((f) => f.appointmentDate.getTime() > now.getTime())
      .sort((a, b) => a.appointmentDate.getTime() - b.appointmentDate.getTime())[0]

    if (!closest) return false

    // Mark this follow-up chain as confirmed
    await pgStore.updateFollowUpStatus(this.db, closest.id, 'confirmed', `Patient confirmed: "${lower}"`)

    // Mark all other pending follow-ups for this appointment that are
    // conditional on non-confirmation as skipped (fallbacks)
    const appointmentFollowUps = await pgStore.getFollowUpsForAppointment(this.db, closest.medilinkAppointmentId)
    for (const fu of appointmentFollowUps) {
      if (fu.status !== 'pending') continue
      // Skip fallback touches since patient confirmed
      if (fu.touchType === 'touch_1_fallback_a' || fu.touchType === 'touch_1_fallback_b') {
        await pgStore.updateFollowUpStatus(this.db, fu.id, 'skipped', 'Patient confirmed')
        // Remove BullMQ job
        if (fu.bullmqJobId && this.queue) {
          try {
            const job = await this.queue.getJob(fu.bullmqJobId)
            if (job) await job.remove()
          } catch { /* ignore */ }
        }
      }
    }

    logger.info({ contactId, appointmentId: closest.medilinkAppointmentId }, 'Patient confirmed appointment')
    return true
  }

  // ─── Helpers ──────────────────────────

  private formatDate(dateStr: string): string {
    try {
      const date = new Date(dateStr)
      return date.toLocaleDateString('es-CL', {
        weekday: 'long',
        day: 'numeric',
        month: 'long',
      })
    } catch {
      return dateStr
    }
  }
}
