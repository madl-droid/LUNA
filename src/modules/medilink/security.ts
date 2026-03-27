// LUNA — Module: medilink
// Security layer: identity verification, data access control, audit enforcement
// THIS IS THE MOST CRITICAL FILE — patient data isolation depends on it

import pino from 'pino'
import type { Pool } from 'pg'
import type { MedilinkApiClient } from './api-client.js'
import type {
  MedilinkConfig, VerificationLevel, SecurityContext,
  MedilinkAppointment, MedilinkEvolution,
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
  async resolveContext(contactId: string, agentId: string): Promise<SecurityContext> {
    // Get contact's phone and stored medilink data from agent_contacts
    const result = await this.db.query(
      `SELECT contact_id, agent_data
       FROM agent_contacts
       WHERE contact_id = $1 AND agent_id = $2`,
      [contactId, agentId],
    )

    const row = result.rows[0]
    const agentData = (row?.agent_data ?? {}) as Record<string, unknown>
    const phone = this.extractPhoneFromContactId(contactId)

    return {
      contactId,
      contactPhone: phone,
      agentId,
      medilinkPatientId: agentData.medilink_patient_id ? Number(agentData.medilink_patient_id) : null,
      verificationLevel: (agentData.medilink_verified as VerificationLevel) ?? 'unverified',
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
        await this.linkContactToPatient(ctx.contactId, ctx.agentId, patient.id, 'phone_matched')

        await pgStore.logAudit(this.db, {
          contactId: ctx.contactId,
          agentId: ctx.agentId,
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
  ): Promise<{ success: boolean; patientId?: number; error?: string }> {
    try {
      const patients = await this.api.findPatientByDocument(documentNumber)

      if (patients.length === 0) {
        await pgStore.logAudit(this.db, {
          contactId: ctx.contactId,
          agentId: ctx.agentId,
          action: 'identity_check',
          targetType: 'identity',
          detail: { method: 'document', documentNumber, result: 'not_found' },
          result: 'denied',
        })
        return { success: false, error: 'No se encontró un paciente con ese documento' }
      }

      const patient = patients[0]!

      // If already linked to a different patient, reject
      if (ctx.medilinkPatientId && ctx.medilinkPatientId !== patient.id) {
        await pgStore.logAudit(this.db, {
          contactId: ctx.contactId,
          agentId: ctx.agentId,
          medilinkPatientId: String(ctx.medilinkPatientId),
          action: 'identity_check',
          targetType: 'identity',
          detail: { method: 'document', documentNumber, result: 'mismatch', existingPatientId: ctx.medilinkPatientId },
          result: 'denied',
        })
        return { success: false, error: 'Este número ya está vinculado a otro paciente. Contacte la clínica.' }
      }

      // If not yet linked, verify phone matches or link anyway with document verification
      if (!ctx.medilinkPatientId) {
        // Check if patient is already claimed by another contact
        const existing = await this.db.query(
          `SELECT contact_id FROM agent_contacts
           WHERE agent_id = $1 AND agent_data->>'medilink_patient_id' = $2
           AND contact_id != $3`,
          [ctx.agentId, String(patient.id), ctx.contactId],
        )
        if (existing.rows.length > 0) {
          await pgStore.logAudit(this.db, {
            contactId: ctx.contactId,
            agentId: ctx.agentId,
            action: 'identity_check',
            targetType: 'identity',
            detail: { method: 'document', documentNumber, result: 'already_claimed' },
            result: 'denied',
          })
          return { success: false, error: 'Este paciente ya está registrado desde otro número. Contacte la clínica.' }
        }
      }

      await this.linkContactToPatient(ctx.contactId, ctx.agentId, patient.id, 'document_verified')

      await pgStore.logAudit(this.db, {
        contactId: ctx.contactId,
        agentId: ctx.agentId,
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
      return { success: false, error: 'Error al verificar el documento' }
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
        fecha: apt.fecha,
        hora_inicio: apt.hora_inicio,
        hora_fin: apt.hora_fin,
        duracion: apt.duracion,
        profesional: apt.nombre_profesional,
        tratamiento: apt.nombre_tratamiento,
        sucursal: apt.nombre_sucursal,
        estado: apt.estado_cita,
        comentarios: apt.comentarios,
      }
    }

    // PHONE_MATCHED: minimal info
    return {
      id: apt.id,
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
      profesional: evo.nombre_profesional,
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

  // ─── Patient linking ───────────────────

  private async linkContactToPatient(
    contactId: string,
    agentId: string,
    patientId: number,
    level: VerificationLevel,
  ): Promise<void> {
    await this.db.query(
      `UPDATE agent_contacts
       SET agent_data = agent_data || $1::jsonb
       WHERE contact_id = $2 AND agent_id = $3`,
      [
        JSON.stringify({
          medilink_patient_id: String(patientId),
          medilink_verified: level,
          medilink_verified_at: new Date().toISOString(),
        }),
        contactId,
        agentId,
      ],
    )
    logger.info({ contactId, patientId, level }, 'Contact linked to Medilink patient')
  }

  // ─── Helpers ───────────────────────────

  private extractPhoneFromContactId(contactId: string): string {
    // contactId format is typically "phone@s.whatsapp.net" or just phone
    return contactId.replace(/@.*$/, '').replace(/[^0-9+]/g, '')
  }
}
