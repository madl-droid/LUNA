// LUNA — Module: medilink
// Follow-up scheduler: delegates to scheduled-tasks module
// 9-touch system: confirmation → reminders → no-show → reactivation
//
// Each follow-up touch becomes a scheduled_task entry managed by the
// shared BullMQ queue in scheduled-tasks. Execution logic (prerequisites,
// template resolution, channel dispatch) lives here in medilink.

import pino from 'pino'
import type { Pool } from 'pg'
import type { Registry } from '../../kernel/registry.js'
import type {
  MedilinkConfig, FollowUpTouchType, FollowUpTemplate,
} from './types.js'
import * as pgStore from './pg-store.js'

const logger = pino({ name: 'medilink:followup' })

// ─── Scheduled-tasks service type ──────

interface ScheduledTasksApi {
  createTask(input: {
    name: string
    prompt: string
    cron: string
    enabled?: boolean
    trigger_type?: string
    actions?: Array<{ type: string; toolName?: string; toolInput?: Record<string, unknown> }>
  }): Promise<{ id: string; name: string }>
  deleteTask(id: string): Promise<void>
  addDelayedJob(taskId: string, taskName: string, delayMs: number): Promise<string | null>
  removeJobById(jobId: string): Promise<void>
}

// ─── Touch label for UI ────────────────

const TOUCH_LABELS: Record<FollowUpTouchType, string> = {
  touch_0: 'Confirmación inmediata',
  touch_1: 'Llamada de confirmación',
  touch_1_fallback_a: 'WhatsApp si no contestó',
  touch_1_fallback_b: '2da llamada de confirmación',
  touch_3: 'Instrucciones pre-cita',
  touch_4: 'Recordatorio corto',
  no_show_1: 'No-show: 1er contacto',
  no_show_2: 'No-show: 2do contacto',
  reactivation: 'Reactivación',
}

// ─── Scheduler class ───────────────────

export class FollowUpScheduler {
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

  private getTasksApi(): ScheduledTasksApi | null {
    return this.registry.getOptional<ScheduledTasksApi>('scheduled-tasks:api')
  }

  // ─── Schedule full sequence ─────────────

  async scheduleSequence(params: {
    appointmentId: string
    contactId: string
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
    if (!this.config.MEDILINK_FOLLOWUP_ENABLED) {
      logger.debug('Follow-up disabled')
      return
    }

    const tasksApi = this.getTasksApi()
    if (!tasksApi) {
      logger.warn('scheduled-tasks module not available — follow-ups will not be scheduled')
      return
    }

    const { appointmentId, contactId, appointment } = params
    const appointmentDate = new Date(`${appointment.fecha}T${appointment.hora_inicio}`)

    if (isNaN(appointmentDate.getTime())) {
      logger.warn({ appointmentId, fecha: appointment.fecha, hora: appointment.hora_inicio }, 'Invalid appointment date')
      return
    }

    const now = new Date()

    // Metadata stored in medilink_follow_ups for the execution tool
    const metadata = {
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
      { type: 'touch_0', channel: 'whatsapp', scheduledAt: new Date(now.getTime() + 5000) },
      { type: 'touch_1', channel: 'voice', scheduledAt: new Date(appointmentDate.getTime() - this.config.MEDILINK_FOLLOWUP_TOUCH1_DAYS_BEFORE * 24 * 3600_000) },
      { type: 'touch_1_fallback_a', channel: 'whatsapp', scheduledAt: new Date(appointmentDate.getTime() - this.config.MEDILINK_FOLLOWUP_TOUCH1_DAYS_BEFORE * 24 * 3600_000 + this.config.MEDILINK_FOLLOWUP_FALLBACK_A_HOURS * 3600_000) },
      { type: 'touch_1_fallback_b', channel: 'voice', scheduledAt: new Date(appointmentDate.getTime() - this.config.MEDILINK_FOLLOWUP_FALLBACK_B_DAYS_BEFORE * 24 * 3600_000) },
      { type: 'touch_3', channel: 'whatsapp', scheduledAt: new Date(appointmentDate.getTime() - this.config.MEDILINK_FOLLOWUP_TOUCH3_HOURS_BEFORE * 3600_000) },
      { type: 'touch_4', channel: 'whatsapp', scheduledAt: new Date(appointmentDate.getTime() - this.config.MEDILINK_FOLLOWUP_TOUCH4_HOURS_BEFORE * 3600_000) },
      { type: 'no_show_1', channel: 'whatsapp', scheduledAt: new Date(appointmentDate.getTime() + this.config.MEDILINK_FOLLOWUP_NOSHOW_HOURS_AFTER * 3600_000) },
      { type: 'no_show_2', channel: 'whatsapp', scheduledAt: new Date(appointmentDate.getTime() + (this.config.MEDILINK_FOLLOWUP_NOSHOW_HOURS_AFTER + 24) * 3600_000) },
      { type: 'reactivation', channel: 'whatsapp', scheduledAt: new Date(appointmentDate.getTime() + (this.config.MEDILINK_FOLLOWUP_NOSHOW_HOURS_AFTER + 24) * 3600_000 + this.config.MEDILINK_FOLLOWUP_REACTIVATION_DAYS * 24 * 3600_000) },
    ]

    let scheduled = 0
    for (const touch of touches) {
      if (touch.type !== 'touch_0' && touch.scheduledAt.getTime() <= now.getTime()) {
        logger.debug({ touchType: touch.type }, 'Skipping past touch')
        continue
      }

      const delay = Math.max(0, touch.scheduledAt.getTime() - now.getTime())

      // 1. Create medilink follow-up record
      const followUpId = await pgStore.createFollowUp(this.db, {
        medilinkAppointmentId: appointmentId,
        contactId,
        appointmentDate,
        touchType: touch.type,
        channel: touch.channel,
        scheduledAt: touch.scheduledAt,
        metadata,
      })

      // 2. Create a scheduled_task that will call our execution tool
      const taskName = `Medilink: ${TOUCH_LABELS[touch.type]} — Cita #${appointmentId}`
      const task = await tasksApi.createTask({
        name: taskName,
        prompt: `Ejecuta el seguimiento de cita Medilink. Follow-up ID: ${followUpId}. No generes texto adicional.`,
        cron: '0 0 31 2 *', // dummy cron (never fires — triggered by delayed job)
        trigger_type: 'manual',
        enabled: true,
        actions: [{
          type: 'tool',
          toolName: 'medilink-execute-followup',
          toolInput: { followUpId },
        }],
      })

      // 3. Schedule delayed job on the shared BullMQ queue
      const jobId = await tasksApi.addDelayedJob(task.id, taskName, delay)

      // 4. Store references for cancellation
      await this.db.query(
        'UPDATE medilink_follow_ups SET bullmq_job_id = $1, metadata = metadata || $2 WHERE id = $3',
        [jobId ?? '', JSON.stringify({ scheduledTaskId: task.id }), followUpId],
      )

      scheduled++
      logger.debug({ touchType: touch.type, scheduledAt: touch.scheduledAt, delayMs: delay }, 'Follow-up scheduled via scheduled-tasks')
    }

    logger.info({ appointmentId, contactId, scheduled }, 'Follow-up sequence created')
  }

  // ─── Cancel sequence ──────────────────

  async cancelSequence(appointmentId: string): Promise<void> {
    const tasksApi = this.getTasksApi()

    // Get all pending follow-ups and cancel them
    const jobIds = await pgStore.cancelFollowUpsForAppointment(this.db, appointmentId)

    // Also get the scheduled task IDs from metadata to delete them
    const followUps = await pgStore.getFollowUpsForAppointment(this.db, appointmentId)

    if (tasksApi) {
      for (const jobId of jobIds) {
        try { await tasksApi.removeJobById(jobId) } catch { /* ignore */ }
      }
      // Clean up the scheduled_task entries
      for (const fu of followUps) {
        const scheduledTaskId = (fu.metadata as Record<string, unknown>)?.scheduledTaskId as string | undefined
        if (scheduledTaskId) {
          try { await tasksApi.deleteTask(scheduledTaskId) } catch { /* ignore */ }
        }
      }
    }

    logger.info({ appointmentId, cancelled: jobIds.length }, 'Follow-up sequence cancelled')
  }

  // ─── Execute a follow-up touch ────────
  //
  // Called by the medilink-execute-followup tool when the scheduled task fires.

  async executeFollowUp(followUpId: string): Promise<string> {
    // Load follow-up record
    const result = await this.db.query(
      'SELECT * FROM medilink_follow_ups WHERE id = $1',
      [followUpId],
    )
    if (result.rows.length === 0) return 'Follow-up not found'

    const row = result.rows[0]!
    const status = row.status as string
    const touchType = row.touch_type as FollowUpTouchType
    const contactId = row.contact_id as string
    const appointmentId = row.medilink_appointment_id as string
    const meta = (row.metadata ?? {}) as Record<string, unknown>

    // Already processed?
    if (status !== 'pending') {
      return `Follow-up already ${status}`
    }

    // Check prerequisites
    const allFollowUps = await pgStore.getFollowUpsForAppointment(this.db, appointmentId)
    if (!this.checkPrerequisites(touchType, allFollowUps)) {
      await pgStore.updateFollowUpStatus(this.db, followUpId, 'skipped', 'Prerequisites not met')
      return 'Skipped — prerequisites not met'
    }

    // Get template
    const template = await pgStore.getTemplate(this.db, touchType)
    if (!template) {
      await pgStore.updateFollowUpStatus(this.db, followUpId, 'failed', 'No template')
      return 'No template found'
    }

    try {
      // Resolve message
      const messageText = await this.resolveMessage(template, meta)

      // Send via channel
      if (template.channel === 'voice') {
        await this.sendVoiceCall(contactId, meta, template, messageText)
      } else {
        await this.sendWhatsApp(contactId, messageText)
      }

      await pgStore.updateFollowUpStatus(this.db, followUpId, 'sent')

      // Clean up the scheduled task entry
      const scheduledTaskId = meta.scheduledTaskId as string | undefined
      if (scheduledTaskId) {
        const tasksApi = this.getTasksApi()
        if (tasksApi) {
          try { await tasksApi.deleteTask(scheduledTaskId) } catch { /* ignore */ }
        }
      }

      return `Sent via ${template.channel}`
    } catch (err) {
      await pgStore.updateFollowUpStatus(this.db, followUpId, 'failed', String(err))
      throw err
    }
  }

  // ─── Prerequisites ────────────────────

  private checkPrerequisites(
    touchType: FollowUpTouchType,
    followUps: Array<{ touchType: string; status: string }>,
  ): boolean {
    const getStatus = (type: string) => followUps.find((f) => f.touchType === type)?.status

    switch (touchType) {
      case 'touch_0':
      case 'touch_1':
      case 'touch_4':
        return true

      case 'touch_1_fallback_a':
        return getStatus('touch_1') === 'failed'

      case 'touch_1_fallback_b':
        return getStatus('touch_1') !== 'confirmed' && getStatus('touch_1_fallback_a') !== 'confirmed'

      case 'touch_3':
        return followUps.some((f) => f.status === 'confirmed')

      case 'no_show_1':
        return followUps.some((f) => f.status === 'confirmed')

      case 'no_show_2':
        return getStatus('no_show_1') === 'sent'

      case 'reactivation':
        return getStatus('no_show_2') === 'sent'

      default:
        return true
    }
  }

  // ─── Message resolution ───────────────

  private async resolveMessage(template: FollowUpTemplate, meta: Record<string, unknown>): Promise<string> {
    let text = template.templateText
      .replace(/\{nombre\}/g, String(meta.patientName ?? ''))
      .replace(/\{fecha\}/g, this.formatDate(String(meta.appointmentDate ?? '')))
      .replace(/\{hora\}/g, String(meta.appointmentTime ?? ''))
      .replace(/\{tratamiento\}/g, String(meta.treatmentName ?? ''))
      .replace(/\{profesional\}/g, String(meta.professionalName ?? ''))
      .replace(/\{direccion\}/g, String(meta.branchAddress ?? ''))
      .replace(/\{sucursal\}/g, String(meta.branchName ?? ''))
      .replace(/\{clinica\}/g, String(meta.clinicName ?? ''))

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
          messages: [{
            role: 'user',
            content: `Personaliza este mensaje de seguimiento:\n\n${text}\n\nDatos:\n- Paciente: ${meta.patientName}\n- Fecha: ${this.formatDate(String(meta.appointmentDate ?? ''))}\n- Hora: ${meta.appointmentTime}\n- Profesional: ${meta.professionalName}\n- Tratamiento: ${meta.treatmentName}`,
          }],
          model: 'fast',
          maxTokens: 300,
        })
        if (result?.text) text = result.text.trim()
      } catch (err) {
        logger.warn({ err }, 'LLM personalization failed, using template text')
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

  private async sendVoiceCall(
    contactId: string,
    meta: Record<string, unknown>,
    template: FollowUpTemplate,
    messageText: string,
  ): Promise<void> {
    const callManager = this.registry.getOptional<{
      initiateOutboundCall: (to: string, twimlUrl: string, statusCallbackUrl: string | undefined, mediaStreamUrl: string) => Promise<{ callSid: string; callId: string }>
    }>('twilio-voice:callManager')

    if (!callManager) {
      logger.warn('twilio-voice not available, falling back to WhatsApp')
      await this.sendWhatsApp(contactId, messageText)
      return
    }

    try {
      const redis = this.registry.getRedis()
      const callContext = {
        type: 'medilink_followup',
        touchType: meta.touchType,
        patientName: meta.patientName,
        appointmentDate: meta.appointmentDate,
        appointmentTime: meta.appointmentTime,
        professionalName: meta.professionalName,
        treatmentName: meta.treatmentName,
        branchName: meta.branchName,
        voiceScript: template.voiceScript ?? messageText,
      }
      const phone = contactId.replace(/@.*$/, '')
      await redis.set(`medilink:followup:voice-context:${phone}`, JSON.stringify(callContext), 'EX', 600)

      // FIX: ML-1 — Use configured public URL instead of localhost
      const publicUrl = this.config.MEDILINK_PUBLIC_URL
      if (!publicUrl) {
        throw new Error('MEDILINK_PUBLIC_URL not configured — cannot initiate voice calls')
      }
      const wsUrl = publicUrl.replace(/^https?:\/\//, 'wss://')
      await callManager.initiateOutboundCall(
        phone,
        `${publicUrl}/console/api/twilio-voice/webhook/outbound-twiml`,
        `${publicUrl}/console/api/twilio-voice/webhook/status`,
        `${wsUrl}/twilio/media-stream`,
      )
      logger.info({ phone }, 'Voice call initiated')
    } catch (err) {
      logger.error({ err }, 'Voice call failed, falling back to WhatsApp')
      await this.sendWhatsApp(contactId, messageText)
    }
  }

  // ─── Confirmation detection ───────────

  async checkForConfirmation(contactId: string, messageText: string): Promise<boolean> {
    const confirmKeywords = [
      'confirmo', 'confirmado', 'confirmar',
      'si', 'sí', 'ok', 'dale', 'listo',
      'ahí estaré', 'ahi estare', 'voy', 'asisto',
      'perfecto', 'genial', 'de acuerdo',
    ]

    const lower = messageText.toLowerCase().trim()
    if (!confirmKeywords.some((kw) => lower.includes(kw))) return false

    const pending = await pgStore.getPendingFollowUpsForContact(this.db, contactId)
    if (pending.length === 0) return false

    const now = new Date()
    const closest = pending
      .filter((f) => f.appointmentDate.getTime() > now.getTime())
      .sort((a, b) => a.appointmentDate.getTime() - b.appointmentDate.getTime())[0]
    if (!closest) return false

    await pgStore.updateFollowUpStatus(this.db, closest.id, 'confirmed', `Patient confirmed: "${lower}"`)

    // Cancel fallback touches
    const tasksApi = this.getTasksApi()
    const appointmentFollowUps = await pgStore.getFollowUpsForAppointment(this.db, closest.medilinkAppointmentId)
    for (const fu of appointmentFollowUps) {
      if (fu.status !== 'pending') continue
      if (fu.touchType === 'touch_1_fallback_a' || fu.touchType === 'touch_1_fallback_b') {
        await pgStore.updateFollowUpStatus(this.db, fu.id, 'skipped', 'Patient confirmed')
        if (fu.bullmqJobId && tasksApi) {
          try { await tasksApi.removeJobById(fu.bullmqJobId) } catch { /* ignore */ }
        }
        const scheduledTaskId = (fu.metadata as Record<string, unknown>)?.scheduledTaskId as string | undefined
        if (scheduledTaskId && tasksApi) {
          try { await tasksApi.deleteTask(scheduledTaskId) } catch { /* ignore */ }
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
      return date.toLocaleDateString('es-CL', { weekday: 'long', day: 'numeric', month: 'long' })
    } catch {
      return dateStr
    }
  }
}
