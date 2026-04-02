// LUNA — Module: medilink
// PostgreSQL migrations and queries

import pino from 'pino'
import type { Pool } from 'pg'
import type {
  AuditEntry, AuditAction, VerificationLevel,
  EditRequest, EditRequestStatus,
  FollowUp, FollowUpTouchType, FollowUpStatus, FollowUpTemplate,
  ProfessionalTreatmentRule, UserTypeRule,
  ProfCategoryAssignment,
  WebhookLogEntry, WebhookEntity, WebhookAction, WebhookPayload,
} from './types.js'

const logger = pino({ name: 'medilink:pg-store' })

// ─── Migrations ──────────────────────────

export async function runMigrations(db: Pool): Promise<void> {
  await db.query(`
    CREATE TABLE IF NOT EXISTS medilink_audit_log (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      contact_id TEXT NOT NULL,
      agent_id TEXT NOT NULL DEFAULT 'default',
      medilink_patient_id TEXT,
      action TEXT NOT NULL,
      target_type TEXT NOT NULL,
      target_id TEXT,
      detail JSONB DEFAULT '{}',
      verification_level TEXT,
      result TEXT NOT NULL,
      created_at TIMESTAMPTZ DEFAULT now()
    )
  `)

  await db.query(`CREATE INDEX IF NOT EXISTS idx_medilink_audit_contact
    ON medilink_audit_log(contact_id, created_at DESC)`)
  await db.query(`CREATE INDEX IF NOT EXISTS idx_medilink_audit_patient
    ON medilink_audit_log(medilink_patient_id, created_at DESC)`)
  await db.query(`CREATE INDEX IF NOT EXISTS idx_medilink_audit_action
    ON medilink_audit_log(action, created_at DESC)`)

  await db.query(`
    CREATE TABLE IF NOT EXISTS medilink_edit_requests (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      medilink_patient_id TEXT NOT NULL,
      contact_id TEXT NOT NULL,
      agent_id TEXT NOT NULL DEFAULT 'default',
      requested_changes JSONB NOT NULL,
      reason TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      reviewed_by TEXT,
      reviewed_at TIMESTAMPTZ,
      review_notes TEXT,
      created_at TIMESTAMPTZ DEFAULT now()
    )
  `)
  await db.query(`CREATE INDEX IF NOT EXISTS idx_medilink_edits_status
    ON medilink_edit_requests(status, created_at DESC)`)

  await db.query(`
    CREATE TABLE IF NOT EXISTS medilink_follow_ups (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      medilink_appointment_id TEXT NOT NULL,
      contact_id TEXT NOT NULL,
      agent_id TEXT NOT NULL DEFAULT 'default',
      appointment_date TIMESTAMPTZ NOT NULL,
      touch_type TEXT NOT NULL,
      channel TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      scheduled_at TIMESTAMPTZ NOT NULL,
      executed_at TIMESTAMPTZ,
      response TEXT,
      bullmq_job_id TEXT,
      metadata JSONB DEFAULT '{}',
      created_at TIMESTAMPTZ DEFAULT now()
    )
  `)
  await db.query(`CREATE INDEX IF NOT EXISTS idx_medilink_followup_appt
    ON medilink_follow_ups(medilink_appointment_id)`)
  await db.query(`CREATE INDEX IF NOT EXISTS idx_medilink_followup_status
    ON medilink_follow_ups(status, scheduled_at)`)
  await db.query(`CREATE INDEX IF NOT EXISTS idx_medilink_followup_contact
    ON medilink_follow_ups(contact_id, status)`)

  await db.query(`
    CREATE TABLE IF NOT EXISTS medilink_professional_treatments (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      medilink_professional_id INTEGER NOT NULL,
      medilink_treatment_id INTEGER NOT NULL,
      professional_name TEXT NOT NULL,
      treatment_name TEXT NOT NULL,
      created_at TIMESTAMPTZ DEFAULT now(),
      UNIQUE(medilink_professional_id, medilink_treatment_id)
    )
  `)

  await db.query(`
    CREATE TABLE IF NOT EXISTS medilink_user_type_rules (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_type TEXT NOT NULL,
      medilink_treatment_id INTEGER NOT NULL,
      treatment_name TEXT NOT NULL,
      allowed BOOLEAN NOT NULL DEFAULT true,
      notes TEXT,
      created_at TIMESTAMPTZ DEFAULT now(),
      UNIQUE(user_type, medilink_treatment_id)
    )
  `)

  await db.query(`
    CREATE TABLE IF NOT EXISTS medilink_followup_templates (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      touch_type TEXT NOT NULL UNIQUE,
      template_text TEXT NOT NULL DEFAULT '',
      llm_instructions TEXT,
      use_llm BOOLEAN NOT NULL DEFAULT true,
      channel TEXT NOT NULL DEFAULT 'whatsapp',
      voice_script TEXT,
      updated_at TIMESTAMPTZ DEFAULT now()
    )
  `)

  await db.query(`
    CREATE TABLE IF NOT EXISTS medilink_webhook_log (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      entity TEXT NOT NULL,
      action TEXT NOT NULL,
      medilink_id INTEGER NOT NULL,
      payload JSONB NOT NULL,
      signature_valid BOOLEAN NOT NULL DEFAULT true,
      processed BOOLEAN NOT NULL DEFAULT false,
      error TEXT,
      received_at TIMESTAMPTZ DEFAULT now()
    )
  `)
  await db.query(`CREATE INDEX IF NOT EXISTS idx_medilink_webhook_received
    ON medilink_webhook_log(received_at DESC)`)

  // Seed default follow-up templates if empty
  const { rows } = await db.query('SELECT count(*) as c FROM medilink_followup_templates')
  if (parseInt(String(rows[0]?.c ?? '0'), 10) === 0) {
    await seedDefaultTemplates(db)
  }

  logger.info('Medilink migrations complete')
}

async function seedDefaultTemplates(db: Pool): Promise<void> {
  const defaults: Array<{ type: FollowUpTouchType; text: string; channel: string; voice?: string }> = [
    {
      type: 'touch_0',
      text: 'Hola {nombre}, tu cita de {tratamiento} ha sido agendada para el {fecha} a las {hora} con {profesional} en {clinica} ({direccion}). Responde CONFIRMADO para confirmar tu asistencia.',
      channel: 'whatsapp',
    },
    {
      type: 'touch_1',
      text: '',
      channel: 'voice',
      voice: 'Llamar al paciente para confirmar cita de {tratamiento} el {fecha} a las {hora}. Si es paciente nuevo: explicar que esperar, duracion, si necesita acompanante. Si es recurrente: confirmar brevemente.',
    },
    {
      type: 'touch_1_fallback_a',
      text: 'Hola {nombre}, te intentamos llamar para confirmar tu cita de {tratamiento} el {fecha} a las {hora}. ¿Todo bien para ese dia? Responde SI o escribenos para cambiarla.',
      channel: 'whatsapp',
    },
    {
      type: 'touch_1_fallback_b',
      text: '',
      channel: 'voice',
      voice: 'Segundo intento de llamada para confirmar cita de {tratamiento} el {fecha}. Si no contesta, dejar nota de voz corta.',
    },
    {
      type: 'touch_3',
      text: 'Hola {nombre}, te recordamos tu cita manana {fecha} a las {hora} con {profesional}. Llega 10 minutos antes. {instrucciones_tratamiento}',
      channel: 'whatsapp',
    },
    {
      type: 'touch_4',
      text: '{nombre}, te esperamos a las {hora}. ¡Nos vemos pronto!',
      channel: 'whatsapp',
    },
    {
      type: 'no_show_1',
      text: 'Hola {nombre}, hoy te esperamos y no pudimos verte. Esperamos que todo este bien. Si quieres reagendar tu {tratamiento}, estamos aca para ti.',
      channel: 'whatsapp',
    },
    {
      type: 'no_show_2',
      text: '{nombre}, queriamos saber si te gustaria reagendar. Tenemos disponibilidad esta semana. ¿Te acomoda algun dia?',
      channel: 'whatsapp',
    },
    {
      type: 'reactivation',
      text: 'Hola {nombre}, hace un tiempo no te vemos por {clinica}. Nos encantaria atenderte de nuevo. ¿Te gustaria agendar una cita?',
      channel: 'whatsapp',
    },
  ]

  for (const d of defaults) {
    await db.query(
      `INSERT INTO medilink_followup_templates (touch_type, template_text, use_llm, channel, voice_script)
       VALUES ($1, $2, true, $3, $4)
       ON CONFLICT (touch_type) DO NOTHING`,
      [d.type, d.text, d.channel, d.voice ?? null],
    )
  }
  logger.info('Seeded default follow-up templates')
}

// ─── Audit log ───────────────────────────

export async function logAudit(
  db: Pool,
  entry: {
    contactId: string
    agentId: string
    medilinkPatientId?: string | null
    action: AuditAction
    targetType: string
    targetId?: string | null
    detail?: Record<string, unknown>
    verificationLevel?: VerificationLevel | null
    result: 'success' | 'denied' | 'pending' | 'error'
  },
): Promise<void> {
  try {
    await db.query(
      `INSERT INTO medilink_audit_log
        (contact_id, agent_id, medilink_patient_id, action, target_type, target_id, detail, verification_level, result)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        entry.contactId, entry.agentId, entry.medilinkPatientId ?? null,
        entry.action, entry.targetType, entry.targetId ?? null,
        JSON.stringify(entry.detail ?? {}), entry.verificationLevel ?? null, entry.result,
      ],
    )
  } catch (err) {
    logger.error({ err, entry }, 'Failed to write audit log')
  }
}

export async function getAuditLog(
  db: Pool,
  options: {
    contactId?: string
    medilinkPatientId?: string
    action?: AuditAction
    limit?: number
    offset?: number
  },
): Promise<{ entries: AuditEntry[]; total: number }> {
  const conditions: string[] = []
  const params: unknown[] = []
  let idx = 1

  if (options.contactId) {
    conditions.push(`contact_id = $${idx++}`)
    params.push(options.contactId)
  }
  if (options.medilinkPatientId) {
    conditions.push(`medilink_patient_id = $${idx++}`)
    params.push(options.medilinkPatientId)
  }
  if (options.action) {
    conditions.push(`action = $${idx++}`)
    params.push(options.action)
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''
  const limit = options.limit ?? 50
  const offset = options.offset ?? 0

  const countResult = await db.query(`SELECT count(*) as c FROM medilink_audit_log ${where}`, params)
  const total = parseInt(String(countResult.rows[0]?.c ?? '0'), 10)

  const result = await db.query(
    `SELECT * FROM medilink_audit_log ${where} ORDER BY created_at DESC LIMIT $${idx++} OFFSET $${idx++}`,
    [...params, limit, offset],
  )

  return {
    total,
    entries: result.rows.map(mapAuditRow),
  }
}

function mapAuditRow(row: Record<string, unknown>): AuditEntry {
  return {
    id: row.id as string,
    contactId: row.contact_id as string,
    agentId: row.agent_id as string,
    medilinkPatientId: row.medilink_patient_id as string | null,
    action: row.action as AuditAction,
    targetType: row.target_type as string,
    targetId: row.target_id as string | null,
    detail: (row.detail ?? {}) as Record<string, unknown>,
    verificationLevel: row.verification_level as VerificationLevel | null,
    result: row.result as 'success' | 'denied' | 'pending' | 'error',
    createdAt: new Date(row.created_at as string),
  }
}

// ─── Edit requests ───────────────────────

export async function createEditRequest(
  db: Pool,
  req: {
    medilinkPatientId: string
    contactId: string
    agentId: string
    requestedChanges: Record<string, { old: string | null; new: string }>
    reason?: string
  },
): Promise<string> {
  const result = await db.query(
    `INSERT INTO medilink_edit_requests
      (medilink_patient_id, contact_id, agent_id, requested_changes, reason)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id`,
    [req.medilinkPatientId, req.contactId, req.agentId, JSON.stringify(req.requestedChanges), req.reason ?? null],
  )
  return result.rows[0]!.id as string
}

export async function getEditRequests(
  db: Pool,
  options?: { status?: EditRequestStatus; limit?: number; offset?: number },
): Promise<{ requests: EditRequest[]; total: number }> {
  const conditions: string[] = []
  const params: unknown[] = []
  let idx = 1

  if (options?.status) {
    conditions.push(`status = $${idx++}`)
    params.push(options.status)
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''
  const limit = options?.limit ?? 50
  const offset = options?.offset ?? 0

  const countResult = await db.query(`SELECT count(*) as c FROM medilink_edit_requests ${where}`, params)
  const total = parseInt(String(countResult.rows[0]?.c ?? '0'), 10)

  const result = await db.query(
    `SELECT * FROM medilink_edit_requests ${where} ORDER BY created_at DESC LIMIT $${idx++} OFFSET $${idx++}`,
    [...params, limit, offset],
  )

  return { total, requests: result.rows.map(mapEditRequestRow) }
}

export async function resolveEditRequest(
  db: Pool,
  id: string,
  status: 'approved' | 'rejected',
  reviewedBy: string,
  reviewNotes?: string,
): Promise<EditRequest | null> {
  const result = await db.query(
    `UPDATE medilink_edit_requests
     SET status = $1, reviewed_by = $2, reviewed_at = now(), review_notes = $3
     WHERE id = $4 AND status = 'pending'
     RETURNING *`,
    [status, reviewedBy, reviewNotes ?? null, id],
  )
  if (result.rows.length === 0) return null
  return mapEditRequestRow(result.rows[0]!)
}

function mapEditRequestRow(row: Record<string, unknown>): EditRequest {
  return {
    id: row.id as string,
    medilinkPatientId: row.medilink_patient_id as string,
    contactId: row.contact_id as string,
    agentId: row.agent_id as string,
    requestedChanges: (row.requested_changes ?? {}) as Record<string, { old: string | null; new: string }>,
    reason: row.reason as string | null,
    status: row.status as EditRequestStatus,
    reviewedBy: row.reviewed_by as string | null,
    reviewedAt: row.reviewed_at ? new Date(row.reviewed_at as string) : null,
    reviewNotes: row.review_notes as string | null,
    createdAt: new Date(row.created_at as string),
  }
}

// ─── Follow-ups ──────────────────────────

export async function createFollowUp(
  db: Pool,
  fu: {
    medilinkAppointmentId: string
    contactId: string
    agentId: string
    appointmentDate: Date
    touchType: FollowUpTouchType
    channel: 'whatsapp' | 'voice'
    scheduledAt: Date
    bullmqJobId?: string
    metadata?: Record<string, unknown>
  },
): Promise<string> {
  const result = await db.query(
    `INSERT INTO medilink_follow_ups
      (medilink_appointment_id, contact_id, agent_id, appointment_date, touch_type, channel, scheduled_at, bullmq_job_id, metadata)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     RETURNING id`,
    [
      fu.medilinkAppointmentId, fu.contactId, fu.agentId,
      fu.appointmentDate.toISOString(), fu.touchType, fu.channel,
      fu.scheduledAt.toISOString(), fu.bullmqJobId ?? null,
      JSON.stringify(fu.metadata ?? {}),
    ],
  )
  return result.rows[0]!.id as string
}

export async function updateFollowUpStatus(
  db: Pool,
  id: string,
  status: FollowUpStatus,
  response?: string,
): Promise<void> {
  const executedAt = (status === 'sent' || status === 'confirmed' || status === 'failed') ? 'now()' : 'executed_at'
  await db.query(
    `UPDATE medilink_follow_ups SET status = $1, response = $2, executed_at = ${executedAt} WHERE id = $3`,
    [status, response ?? null, id],
  )
}

export async function cancelFollowUpsForAppointment(db: Pool, appointmentId: string): Promise<string[]> {
  const result = await db.query(
    `UPDATE medilink_follow_ups SET status = 'skipped'
     WHERE medilink_appointment_id = $1 AND status = 'pending'
     RETURNING bullmq_job_id`,
    [appointmentId],
  )
  return result.rows.map((r: Record<string, unknown>) => r.bullmq_job_id as string).filter(Boolean)
}

export async function getPendingFollowUpsForContact(db: Pool, contactId: string): Promise<FollowUp[]> {
  const result = await db.query(
    `SELECT * FROM medilink_follow_ups
     WHERE contact_id = $1 AND status = 'pending'
     ORDER BY scheduled_at ASC`,
    [contactId],
  )
  return result.rows.map(mapFollowUpRow)
}

export async function getFollowUpsForAppointment(db: Pool, appointmentId: string): Promise<FollowUp[]> {
  const result = await db.query(
    `SELECT * FROM medilink_follow_ups WHERE medilink_appointment_id = $1 ORDER BY scheduled_at ASC`,
    [appointmentId],
  )
  return result.rows.map(mapFollowUpRow)
}

function mapFollowUpRow(row: Record<string, unknown>): FollowUp {
  return {
    id: row.id as string,
    medilinkAppointmentId: row.medilink_appointment_id as string,
    contactId: row.contact_id as string,
    agentId: row.agent_id as string,
    appointmentDate: new Date(row.appointment_date as string),
    touchType: row.touch_type as FollowUpTouchType,
    channel: row.channel as 'whatsapp' | 'voice',
    status: row.status as FollowUpStatus,
    scheduledAt: new Date(row.scheduled_at as string),
    executedAt: row.executed_at ? new Date(row.executed_at as string) : null,
    response: row.response as string | null,
    bullmqJobId: row.bullmq_job_id as string | null,
    metadata: (row.metadata ?? {}) as Record<string, unknown>,
    createdAt: new Date(row.created_at as string),
  }
}

// ─── Follow-up templates ─────────────────

export async function getTemplates(db: Pool): Promise<FollowUpTemplate[]> {
  const result = await db.query('SELECT * FROM medilink_followup_templates ORDER BY touch_type')
  return result.rows.map(mapTemplateRow)
}

export async function getTemplate(db: Pool, touchType: FollowUpTouchType): Promise<FollowUpTemplate | null> {
  const result = await db.query('SELECT * FROM medilink_followup_templates WHERE touch_type = $1', [touchType])
  if (result.rows.length === 0) return null
  return mapTemplateRow(result.rows[0]!)
}

export async function upsertTemplate(
  db: Pool,
  touchType: FollowUpTouchType,
  data: { templateText?: string; llmInstructions?: string | null; useLlm?: boolean; channel?: string; voiceScript?: string | null },
): Promise<void> {
  await db.query(
    `INSERT INTO medilink_followup_templates (touch_type, template_text, llm_instructions, use_llm, channel, voice_script, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, now())
     ON CONFLICT (touch_type) DO UPDATE SET
       template_text = COALESCE($2, medilink_followup_templates.template_text),
       llm_instructions = COALESCE($3, medilink_followup_templates.llm_instructions),
       use_llm = COALESCE($4, medilink_followup_templates.use_llm),
       channel = COALESCE($5, medilink_followup_templates.channel),
       voice_script = COALESCE($6, medilink_followup_templates.voice_script),
       updated_at = now()`,
    [touchType, data.templateText ?? '', data.llmInstructions ?? null, data.useLlm ?? true, data.channel ?? 'whatsapp', data.voiceScript ?? null],
  )
}

function mapTemplateRow(row: Record<string, unknown>): FollowUpTemplate {
  return {
    id: row.id as string,
    touchType: row.touch_type as FollowUpTouchType,
    templateText: row.template_text as string,
    llmInstructions: row.llm_instructions as string | null,
    useLlm: row.use_llm as boolean,
    channel: row.channel as 'whatsapp' | 'voice',
    voiceScript: row.voice_script as string | null,
    updatedAt: new Date(row.updated_at as string),
  }
}

// ─── Scheduling rules ────────────────────

export async function getProfessionalTreatments(db: Pool): Promise<ProfessionalTreatmentRule[]> {
  const result = await db.query('SELECT * FROM medilink_professional_treatments ORDER BY professional_name')
  return result.rows.map((r: Record<string, unknown>) => ({
    id: r.id as string,
    medilinkProfessionalId: r.medilink_professional_id as number,
    medilinkTreatmentId: r.medilink_treatment_id as number,
    professionalName: r.professional_name as string,
    treatmentName: r.treatment_name as string,
    createdAt: new Date(r.created_at as string),
  }))
}

export async function setProfessionalTreatments(
  db: Pool,
  rules: Array<{ professionalId: number; treatmentId: number; professionalName: string; treatmentName: string }>,
): Promise<void> {
  await db.query('DELETE FROM medilink_professional_treatments')
  for (const r of rules) {
    await db.query(
      `INSERT INTO medilink_professional_treatments (medilink_professional_id, medilink_treatment_id, professional_name, treatment_name)
       VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING`,
      [r.professionalId, r.treatmentId, r.professionalName, r.treatmentName],
    )
  }
}

export async function getUserTypeRules(db: Pool): Promise<UserTypeRule[]> {
  const result = await db.query('SELECT * FROM medilink_user_type_rules ORDER BY user_type, treatment_name')
  return result.rows.map((r: Record<string, unknown>) => ({
    id: r.id as string,
    userType: r.user_type as string,
    medilinkTreatmentId: r.medilink_treatment_id as number,
    treatmentName: r.treatment_name as string,
    allowed: r.allowed as boolean,
    notes: r.notes as string | null,
    createdAt: new Date(r.created_at as string),
  }))
}

export async function setUserTypeRules(
  db: Pool,
  rules: Array<{ userType: string; treatmentId: number; treatmentName: string; allowed: boolean; notes?: string }>,
): Promise<void> {
  await db.query('DELETE FROM medilink_user_type_rules')
  for (const r of rules) {
    await db.query(
      `INSERT INTO medilink_user_type_rules (user_type, medilink_treatment_id, treatment_name, allowed, notes)
       VALUES ($1, $2, $3, $4, $5) ON CONFLICT DO NOTHING`,
      [r.userType, r.treatmentId, r.treatmentName, r.allowed, r.notes ?? null],
    )
  }
}

// ─── Webhook log ─────────────────────────

export async function logWebhook(
  db: Pool,
  entry: {
    entity: WebhookEntity
    action: WebhookAction
    medilinkId: number
    payload: WebhookPayload
    signatureValid: boolean
    processed: boolean
    error?: string
  },
): Promise<void> {
  try {
    await db.query(
      `INSERT INTO medilink_webhook_log (entity, action, medilink_id, payload, signature_valid, processed, error)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [entry.entity, entry.action, entry.medilinkId, JSON.stringify(entry.payload), entry.signatureValid, entry.processed, entry.error ?? null],
    )
  } catch (err) {
    logger.error({ err }, 'Failed to log webhook')
  }
}

// ─── Professional categories ──────────────

export async function getProfessionalCategoryAssignments(db: Pool): Promise<ProfCategoryAssignment[]> {
  const result = await db.query('SELECT medilink_professional_id, medilink_category_id, category_name FROM medilink_professional_category_assignments')
  return result.rows.map((r: Record<string, unknown>) => ({
    medilinkProfessionalId: r.medilink_professional_id as number,
    medilinkCategoryId: r.medilink_category_id as number,
    categoryName: r.category_name as string,
  }))
}

export async function setProfessionalCategoryAssignments(
  db: Pool,
  assignments: ProfCategoryAssignment[],
): Promise<void> {
  await db.query('DELETE FROM medilink_professional_category_assignments')
  for (const a of assignments) {
    await db.query(
      `INSERT INTO medilink_professional_category_assignments (medilink_professional_id, medilink_category_id, category_name)
       VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
      [a.medilinkProfessionalId, a.medilinkCategoryId, a.categoryName],
    )
  }
}

/**
 * For rescheduling: get the set of category IDs for a given professional.
 * Then find all professionals that have a SUPERSET of those categories.
 */
export async function getProfessionalsWithMatchingCategories(
  db: Pool,
  professionalId: number,
): Promise<number[]> {
  // Get original professional's categories
  const orig = await db.query(
    'SELECT medilink_category_id FROM medilink_professional_category_assignments WHERE medilink_professional_id=$1',
    [professionalId],
  )
  const origCats = (orig.rows as Array<Record<string, unknown>>).map(r => r.medilink_category_id as number)
  if (origCats.length === 0) return [] // no categories defined — no filter

  // Find professionals that have ALL of the original categories (superset allowed)
  const result = await db.query(
    `SELECT medilink_professional_id
     FROM medilink_professional_category_assignments
     WHERE medilink_category_id = ANY($1::int[])
     GROUP BY medilink_professional_id
     HAVING COUNT(DISTINCT medilink_category_id) = $2`,
    [origCats, origCats.length],
  )
  return (result.rows as Array<Record<string, unknown>>).map(r => r.medilink_professional_id as number)
}

// ─── Webhook log ─────────────────────────

export async function getRecentWebhooks(db: Pool, limit = 50): Promise<WebhookLogEntry[]> {
  const result = await db.query(
    'SELECT * FROM medilink_webhook_log ORDER BY received_at DESC LIMIT $1',
    [limit],
  )
  return result.rows.map((r: Record<string, unknown>) => ({
    id: r.id as string,
    entity: r.entity as WebhookEntity,
    action: r.action as WebhookAction,
    medilinkId: r.medilink_id as number,
    payload: r.payload as WebhookPayload,
    signatureValid: r.signature_valid as boolean,
    processed: r.processed as boolean,
    error: r.error as string | null,
    receivedAt: new Date(r.received_at as string),
  }))
}
