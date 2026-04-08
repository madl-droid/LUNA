// LUNA — Module: medilink
// Security layer: identity verification, data access control, audit enforcement
// THIS IS THE MOST CRITICAL FILE — patient data isolation depends on it

import pino from 'pino'
import type { Pool } from 'pg'
import type { MedilinkApiClient } from './api-client.js'
import type {
  MedilinkConfig, VerificationLevel, SecurityContext,
  MedilinkAppointment, MedilinkEvolution, MedilinkDependent,
} from './types.js'
import * as pgStore from './pg-store.js'

const logger = pino({ name: 'medilink:security' })

export class SecurityService {
  private api: MedilinkApiClient
  private db: Pool
  private config: MedilinkConfig

  constructor(api: MedilinkApiClient, db: Pool, config: MedilinkConfig) {
    this.api = api
    this.db = db
    this.config = config
  }

  // ─── Identity resolution ───────────────

  /**
   * Resolve a contact's security context: who they are in Medilink, verification level.
   * This is called at the start of every tool that accesses patient data.
   */
  async resolveContext(contactId: string): Promise<SecurityContext> {
    // Get medilink data + phone from contacts.phone (preferred) or contact_channels fallback
    const result = await this.db.query(
      `SELECT
         ac.agent_data,
         COALESCE(
           NULLIF((SELECT phone FROM contacts WHERE id = $1), ''),
           (SELECT channel_identifier FROM contact_channels
            WHERE contact_id = $1
            ORDER BY is_primary DESC NULLS LAST, last_used_at DESC NULLS LAST
            LIMIT 1)
         ) AS phone_or_identifier
       FROM agent_contacts ac
       WHERE ac.contact_id = $1`,
      [contactId],
    )

    const row = result.rows[0]
    const agentData = (row?.agent_data ?? {}) as Record<string, unknown>
    // phone_or_identifier is e.g. "573155524620", "573155524620@s.whatsapp.net", or a LID
    const rawIdentifier = (row?.phone_or_identifier ?? '') as string
    const phone = rawIdentifier.replace(/@.*$/, '').replace(/[^0-9+]/g, '')

    const dependents: MedilinkDependent[] = (agentData.medilink_dependents as MedilinkDependent[] | undefined) ?? []

    return {
      contactId,
      contactPhone: phone,
      medilinkPatientId: agentData.medilink_patient_id ? Number(agentData.medilink_patient_id) : null,
      verificationLevel: (agentData.medilink_verified as VerificationLevel) ?? 'unverified',
      dependents,
      activeTargetPatientId: null,
      activeTargetName: null,
      activeTargetRelationship: null,
    }
  }

  /**
   * Attempt to auto-link contact to a Medilink patient by phone number.
   * Only links if exactly ONE patient matches (config: MEDILINK_AUTO_LINK_SINGLE_MATCH).
   * Returns the updated security context.
   */
  async tryAutoLink(ctx: SecurityContext): Promise<SecurityContext> {
    if (ctx.medilinkPatientId) return ctx // Already linked
    if (!ctx.contactPhone) return ctx

    try {
      const patients = await this.api.findPatientByPhone(ctx.contactPhone)

      if (patients.length === 1 && this.config.MEDILINK_AUTO_LINK_SINGLE_MATCH) {
        const patient = patients[0]!
        await this.linkContactToPatient(ctx.contactId, patient.id, 'phone_matched')

        await pgStore.logAudit(this.db, {
          contactId: ctx.contactId,
          medilinkPatientId: String(patient.id),
          action: 'identity_check',
          targetType: 'patient',
          targetId: String(patient.id),
          detail: { method: 'auto_link_phone', phone: ctx.contactPhone },
          verificationLevel: 'phone_matched',
          result: 'success',
        })

        return { ...ctx, medilinkPatientId: patient.id, verificationLevel: 'phone_matched' }
      }

      if (patients.length > 1) {
        // FIX: SEC-12.1 — No loguear teléfono completo (PII)
        logger.info({ phoneLast4: ctx.contactPhone?.slice(-4), count: patients.length }, 'Multiple patients with same phone — requires document verification')
      }
    } catch (err) {
      logger.warn({ err, contactId: ctx.contactId }, 'Auto-link by phone failed')
    }

    return ctx
  }

  /**
   * Verify identity with document number (RUT).
   * Upgrades verification to 'document_verified'.
   */
  async verifyByDocument(
    ctx: SecurityContext,
    documentNumber: string,
  ): Promise<{ success: boolean; patientId?: number; error?: string; hitl_required?: boolean; hitl_summary?: string }> {
    try {
      const patients = await this.api.findPatientByDocument(documentNumber)

      if (patients.length === 0) {
        await pgStore.logAudit(this.db, {
          contactId: ctx.contactId,
          action: 'identity_check',
          targetType: 'identity',
          detail: { method: 'document', documentNumber, result: 'not_found' },
          result: 'denied',
        })
        return { success: false, error: 'No te encontré en el sistema con ese documento' }
      }

      const patient = patients[0]!

      // If already linked to a different patient, escalate
      if (ctx.medilinkPatientId && ctx.medilinkPatientId !== patient.id) {
        await pgStore.logAudit(this.db, {
          contactId: ctx.contactId,
          medilinkPatientId: String(ctx.medilinkPatientId),
          action: 'identity_check',
          targetType: 'identity',
          detail: { method: 'document', documentNumber, result: 'mismatch', existingPatientId: ctx.medilinkPatientId },
          result: 'denied',
        })
        return {
          success: false,
          error: 'El teléfono que tienes registrado en el sistema es diferente a este, por seguridad no puedo dar datos de pacientes cuando no coincide el número',
          hitl_required: true,
          hitl_summary: 'Conflicto de identidad: número de WhatsApp no coincide con el registrado para el paciente',
        }
      }

      // If not yet linked, check if another contact already has this patient
      if (!ctx.medilinkPatientId) {
        const existing = await this.db.query(
          `SELECT ac.contact_id,
             (SELECT channel_identifier FROM contact_channels
              WHERE contact_id = ac.contact_id
              ORDER BY is_primary DESC NULLS LAST LIMIT 1) AS existing_phone
           FROM agent_contacts ac
           WHERE ac.agent_data->>'medilink_patient_id' = $1
           AND ac.contact_id != $2`,
          [String(patient.id), ctx.contactId],
        )
        if (existing.rows.length > 0) {
          const existingRaw = (existing.rows[0]?.existing_phone ?? '') as string
          const existingPhone = existingRaw.replace(/@.*$/, '').replace(/[^0-9+]/g, '')
          const currentPhone = ctx.contactPhone.replace(/[^0-9+]/g, '')

          if (existingPhone && existingPhone !== currentPhone) {
            // Truly different person — escalate
            await pgStore.logAudit(this.db, {
              contactId: ctx.contactId,
              action: 'identity_check',
              targetType: 'identity',
              detail: { method: 'document', documentNumber, result: 'already_claimed_different_phone' },
              result: 'denied',
            })
            return {
              success: false,
              error: 'Hay un inconveniente con tu registro, déjame un momento',
              hitl_required: true,
              hitl_summary: 'Paciente ya está vinculado a otro número de WhatsApp diferente — posible duplicado de contacto',
            }
          }
          // Same phone on a different contact entry — just link silently (duplicate contact)
        }
      }

      await this.linkContactToPatient(ctx.contactId, patient.id, 'document_verified')

      await pgStore.logAudit(this.db, {
        contactId: ctx.contactId,
        medilinkPatientId: String(patient.id),
        action: 'identity_check',
        targetType: 'patient',
        targetId: String(patient.id),
        detail: { method: 'document', documentNumber },
        verificationLevel: 'document_verified',
        result: 'success',
      })

      return { success: true, patientId: patient.id }
    } catch (err) {
      logger.error({ err, contactId: ctx.contactId }, 'Document verification failed')
      return {
        success: false,
        error: 'Hay un error cuando busco tu documento en el sistema, dame un momento',
        hitl_required: true,
        hitl_summary: 'Error técnico al verificar documento del paciente',
      }
    }
  }

  // ─── Access control ────────────────────

  /**
   * Check if the contact can access patient data of the given type.
   * Enforces: only own data, verification level checks.
   */
  canAccess(ctx: SecurityContext, dataType: string): { allowed: boolean; reason?: string } {
    if (!ctx.medilinkPatientId) {
      return { allowed: false, reason: 'No patient linked' }
    }

    switch (dataType) {
      case 'patient_basic': // Name, appointment dates
        return ctx.verificationLevel !== 'unverified'
          ? { allowed: true }
          : { allowed: false, reason: 'Identity not verified' }

      case 'appointments':
      case 'evolutions':
        return ctx.verificationLevel !== 'unverified'
          ? { allowed: true }
          : { allowed: false, reason: 'Identity not verified' }

      case 'payments':
        // Payment amounts require document verification or re-verification
        if (ctx.verificationLevel === 'unverified') {
          return { allowed: false, reason: 'Identity not verified' }
        }
        if (this.config.MEDILINK_REQUIRE_DOCUMENT_FOR_DEBTS && ctx.verificationLevel === 'phone_matched') {
          return { allowed: false, reason: 'Document verification required for debt details' }
        }
        return { allowed: true }

      case 'patient_info':
      case 'treatment_plans':
        return ctx.verificationLevel !== 'unverified'
          ? { allowed: true }
          : { allowed: false, reason: 'Identity not verified' }

      case 'edit':
        return ctx.verificationLevel === 'document_verified'
          ? { allowed: true }
          : { allowed: false, reason: 'Document verification required for edits' }

      default:
        return { allowed: false, reason: 'Unknown data type' }
    }
  }

  /**
   * Verify that a resource belongs to the contact's linked patient.
   * CRITICAL: prevents cross-patient data access.
   */
  ownsAppointment(ctx: SecurityContext, appointment: MedilinkAppointment): boolean {
    return ctx.medilinkPatientId === appointment.id_paciente
  }

  // ─── Data filtering ────────────────────

  /**
   * Filter appointment data based on verification level.
   * PHONE_MATCHED: date/time only.
   * DOCUMENT_VERIFIED: full details.
   */
  filterAppointment(ctx: SecurityContext, apt: MedilinkAppointment): Record<string, unknown> {
    if (ctx.verificationLevel === 'document_verified') {
      return {
        id: apt.id,
        id_atencion: apt.id_atencion ?? null,
        fecha: apt.fecha,
        hora_inicio: apt.hora_inicio,
        hora_fin: apt.hora_fin,
        duracion: apt.duracion,
        profesional: apt.nombre_dentista,
        tratamiento: apt.nombre_tratamiento,
        sucursal: apt.nombre_sucursal,
        estado: apt.estado_cita,
        comentarios: apt.comentarios,
      }
    }

    // PHONE_MATCHED: minimal info (includes id_atencion for rescheduling)
    return {
      id: apt.id,
      id_atencion: apt.id_atencion ?? null,
      fecha: apt.fecha,
      hora_inicio: apt.hora_inicio,
      hora_fin: apt.hora_fin,
      estado: apt.estado_cita,
    }
  }

  /**
   * Filter evolution data: name, date, status — NEVER the clinical notes (datos).
   */
  filterEvolution(evo: MedilinkEvolution): Record<string, unknown> {
    return {
      id: evo.id,
      atencion: evo.nombre_atencion,
      tratamiento: evo.nombre_tratamiento,
      profesional: evo.nombre_dentista,
      fecha: evo.fecha,
      habilitado: evo.habilitado,
      // NEVER include evo.datos — these are clinical notes
    }
  }

  /**
   * Filter payment data based on verification level.
   */
  filterPayments(
    ctx: SecurityContext,
    payments: Array<Record<string, unknown>>,
  ): { hasDebts: boolean; details: Array<Record<string, unknown>> | null } {
    const pending = payments.filter((p) => {
      const monto = Number(p.monto_pago ?? 0)
      return monto > 0
    })

    if (ctx.verificationLevel === 'phone_matched' && this.config.MEDILINK_REQUIRE_DOCUMENT_FOR_DEBTS) {
      // Only yes/no
      return { hasDebts: pending.length > 0, details: null }
    }

    return {
      hasDebts: pending.length > 0,
      details: pending.map((p) => ({
        concepto: p.nombre_tratamiento ?? p.descripcion ?? 'Pago',
        monto: p.monto_pago,
        fecha: p.fecha_creacion ?? p.fecha_vencimiento,
      })),
    }
  }

  /**
   * Filter patient data to only basic safe fields (no clinical, no PII like document).
   * Used by get-patient-info tool.
   */
  filterPatientBasic(patient: import('./types.js').MedilinkPatient): Record<string, unknown> {
    return {
      id: patient.id,
      nombre: patient.nombre,
      apellidos: patient.apellidos,
      nombre_social: patient.nombre_social,
      celular: patient.celular,
      email: patient.email,
      // Excluded: rut, direccion, ciudad, comuna, observaciones, fecha_nacimiento, sexo, numero_ficha
    }
  }

  /**
   * Filter patient for search results — absolute minimum (no contact info).
   */
  filterPatientSearch(patient: import('./types.js').MedilinkPatient): Record<string, unknown> {
    return {
      id: patient.id,
      nombre: patient.nombre,
      apellidos: patient.apellidos,
    }
  }

  /**
   * Filter treatment plan — only administrative/financial fields, no clinical detail.
   */
  filterTreatmentPlan(plan: import('./types.js').MedilinkTreatmentPlan): Record<string, unknown> {
    return {
      id: plan.id,
      nombre: plan.nombre,
      tipo: plan.nombre_tipo,
      fecha: plan.fecha,
      finalizado: plan.finalizado,
      deuda: plan.deuda,
      total: plan.total,
      abonado: plan.abonado,
    }
  }

  // ─── Patient linking ───────────────────

  async linkContactToPatient(
    contactId: string,
    patientId: number,
    level: VerificationLevel,
  ): Promise<void> {
    await this.db.query(
      `UPDATE agent_contacts
       SET agent_data = agent_data || $1::jsonb
       WHERE contact_id = $2`,
      [
        JSON.stringify({
          medilink_patient_id: String(patientId),
          medilink_verified: level,
          medilink_verified_at: new Date().toISOString(),
        }),
        contactId,
      ],
    )
    // Promote lead to active client now that we've confirmed they're a Medilink patient.
    // Only upgrades — won't overwrite client_former, team_internal, etc.
    await this.db.query(
      `UPDATE contacts SET contact_type = 'client_active' WHERE id = $1 AND contact_type = 'lead'`,
      [contactId],
    )
    logger.info({ contactId, patientId, level }, 'Contact linked to Medilink patient')
  }

  /**
   * Mark contact as a new lead (no Medilink record found by phone).
   * Prevents repeated auto-link attempts on every message.
   */
  async setLeadFlag(contactId: string): Promise<void> {
    await this.db.query(
      `UPDATE agent_contacts
       SET agent_data = agent_data || '{"medilink_is_lead": true}'::jsonb
       WHERE contact_id = $1`,
      [contactId],
    )
  }

  // ─── Dependientes (terceros) ───────────

  /**
   * Add or update a dependent for a contact.
   * Deduplicates by medilinkPatientId (skip if already registered).
   */
  async addDependent(contactId: string, dep: MedilinkDependent): Promise<void> {
    const { rows } = await this.db.query<{ deps: MedilinkDependent[] }>(
      `SELECT agent_data->'medilink_dependents' AS deps FROM agent_contacts WHERE contact_id = $1`,
      [contactId],
    )
    const current: MedilinkDependent[] = rows[0]?.deps ?? []

    if (current.some(d => d.medilinkPatientId === dep.medilinkPatientId)) {
      return // Already registered — skip
    }

    current.push(dep)

    await this.db.query(
      `UPDATE agent_contacts SET agent_data = agent_data || $1::jsonb WHERE contact_id = $2`,
      [JSON.stringify({ medilink_dependents: current }), contactId],
    )
    logger.info({ contactId, depPatientId: dep.medilinkPatientId, relationship: dep.relationship }, 'Dependent registered')
  }

  /**
   * Find a registered dependent by relationship or name hint (for agent resolution).
   * hint examples: "mi hijo", "sofia", "mama"
   */
  findDependent(ctx: SecurityContext, hint: string): MedilinkDependent | null {
    const lower = hint.toLowerCase()
    const byRelation = ctx.dependents.find(d => lower.includes(d.relationship.toLowerCase()))
    if (byRelation) return byRelation
    const byName = ctx.dependents.find(d => d.displayName.toLowerCase().includes(lower))
    return byName ?? null
  }

  /**
   * Check if an appointment belongs to the contact OR any of their registered dependents.
   * Use instead of ownsAppointment when dependents are involved.
   */
  ownsOrDependentAppointment(ctx: SecurityContext, appt: MedilinkAppointment): boolean {
    if (ctx.medilinkPatientId === appt.id_paciente) return true
    return ctx.dependents.some(d => d.medilinkPatientId === appt.id_paciente)
  }
}
