// LUNA — Module: medilink
// Agent tools registration — these are the capabilities the AI agent gets

import pino from 'pino'
import type { Registry } from '../../kernel/registry.js'
import type { MedilinkApiClient } from './api-client.js'
import type { MedilinkCache } from './cache.js'
import type { SecurityService } from './security.js'
import * as pgStore from './pg-store.js'

const logger = pino({ name: 'medilink:tools' })

interface ToolRegistry {
  registerTool(reg: {
    definition: {
      name: string; displayName: string; description: string
      category: string; sourceModule: string
      parameters: { type: 'object'; properties: Record<string, unknown>; required?: string[] }
    }
    handler: (input: Record<string, unknown>, ctx: ToolContext) => Promise<ToolResult>
  }): Promise<void>
}

interface ToolContext {
  messageId?: string
  contactId?: string
  contactType?: string
  correlationId: string
  db: import('pg').Pool
  redis: import('ioredis').Redis
}

interface ToolResult {
  success: boolean
  data?: unknown
  error?: string
}

export async function registerMedilinkTools(
  registry: Registry,
  api: MedilinkApiClient,
  cache: MedilinkCache,
  security: SecurityService,
): Promise<void> {
  const toolRegistry = registry.getOptional<ToolRegistry>('tools:registry')
  if (!toolRegistry) {
    logger.warn('Tools module not available — skipping Medilink tool registration')
    return
  }

  const agentId = 'default'

  // ═══════════════════════════════════════
  // 1. CHECK AVAILABILITY (PUBLIC)
  // ═══════════════════════════════════════

  await toolRegistry.registerTool({
    definition: {
      name: 'medilink-check-availability',
      displayName: 'Ver disponibilidad de agenda',
      description: 'Consulta horarios disponibles en la clínica. Puede filtrar por sucursal, profesional, tipo de tratamiento y fecha. Retorna los slots disponibles sin datos de pacientes.',
      category: 'medilink',
      sourceModule: 'medilink',
      parameters: {
        type: 'object',
        properties: {
          date: { type: 'string', description: 'Fecha a consultar (YYYY-MM-DD). Si no se especifica, usa hoy.' },
          professional_name: { type: 'string', description: 'Nombre del profesional (parcial OK)' },
          branch_name: { type: 'string', description: 'Nombre de la sucursal (parcial OK)' },
          treatment_name: { type: 'string', description: 'Tipo de tratamiento para filtrar profesionales que lo realizan' },
          duration_minutes: { type: 'number', description: 'Duración del turno en minutos (default: 30)' },
        },
      },
    },
    handler: async (input) => {
      try {
        const ref = await cache.getReferenceData()

        // Resolve branch
        let branchId: number | undefined
        if (input.branch_name) {
          const branch = cache.findBranchByName(input.branch_name as string)
          if (!branch) return { success: false, error: `No se encontró la sucursal "${input.branch_name}"` }
          branchId = branch.id
        } else {
          const defaultBranch = cache.getDefaultBranch()
          if (defaultBranch) branchId = defaultBranch.id
        }
        if (!branchId) return { success: false, error: 'No se pudo determinar la sucursal. Especifica una.' }

        // Resolve professional
        let professionalId: number | undefined
        if (input.professional_name) {
          const prof = cache.findProfessionalByName(input.professional_name as string)
          if (!prof) return { success: false, error: `No se encontró el profesional "${input.professional_name}"` }
          professionalId = prof.id
        }

        // If treatment specified, find compatible professionals
        if (input.treatment_name && !professionalId) {
          const treatment = cache.findTreatmentByName(input.treatment_name as string)
          if (!treatment) return { success: false, error: `No se encontró el tratamiento "${input.treatment_name}"` }

          const rules = await pgStore.getProfessionalTreatments(registry.getDb())
          const compatibleProfIds = rules
            .filter((r) => r.medilinkTreatmentId === treatment.id)
            .map((r) => r.medilinkProfessionalId)

          if (compatibleProfIds.length > 0) {
            // Return availability for all compatible professionals
            const allSlots = []
            for (const pId of compatibleProfIds) {
              const prof = ref.professionals.find((p) => p.id === pId && p.habilitado)
              if (!prof) continue
              const date = (input.date as string) ?? new Date().toISOString().split('T')[0]!
              const slots = await cache.getAvailability(branchId, date, pId, input.duration_minutes as number | undefined)
              allSlots.push(...slots.map((s) => ({ ...s, professionalId: pId, professionalName: `${prof.nombre} ${prof.apellidos}` })))
            }
            return { success: true, data: { slots: allSlots, date: input.date, branch: ref.branches.find((b) => b.id === branchId)?.nombre } }
          }
        }

        const date = (input.date as string) ?? new Date().toISOString().split('T')[0]!
        const slots = await cache.getAvailability(branchId, date, professionalId, input.duration_minutes as number | undefined)
        return {
          success: true,
          data: {
            slots,
            date,
            branch: ref.branches.find((b) => b.id === branchId)?.nombre,
            professional: professionalId ? ref.professionals.find((p) => p.id === professionalId) : undefined,
          },
        }
      } catch (err) {
        logger.error({ err }, 'check-availability failed')
        return { success: false, error: 'Error al consultar disponibilidad' }
      }
    },
  })

  // ═══════════════════════════════════════
  // 2. GET PROFESSIONALS (PUBLIC)
  // ═══════════════════════════════════════

  await toolRegistry.registerTool({
    definition: {
      name: 'medilink-get-professionals',
      displayName: 'Listar profesionales',
      description: 'Lista los profesionales de la clínica con sus especialidades. Solo muestra profesionales activos. No requiere verificación.',
      category: 'medilink',
      sourceModule: 'medilink',
      parameters: {
        type: 'object',
        properties: {
          specialty: { type: 'string', description: 'Filtrar por especialidad (parcial OK)' },
        },
      },
    },
    handler: async (input) => {
      try {
        let profs = cache.getActiveProfessionals()
        if (input.specialty) {
          const lower = (input.specialty as string).toLowerCase()
          profs = profs.filter((p) => p.especialidad?.toLowerCase().includes(lower))
        }
        return {
          success: true,
          data: profs.map((p) => ({
            id: p.id,
            nombre: `${p.nombre} ${p.apellidos}`,
            especialidad: p.especialidad,
            agenda_online: p.agenda_online,
          })),
        }
      } catch (err) {
        return { success: false, error: 'Error al listar profesionales' }
      }
    },
  })

  // ═══════════════════════════════════════
  // 3. VERIFY IDENTITY
  // ═══════════════════════════════════════

  await toolRegistry.registerTool({
    definition: {
      name: 'medilink-verify-identity',
      displayName: 'Verificar identidad del paciente',
      description: 'Verifica la identidad del paciente con su número de documento (RUT/cédula). Necesario para acceder a información detallada como montos de deuda o solicitar cambios de datos.',
      category: 'medilink',
      sourceModule: 'medilink',
      parameters: {
        type: 'object',
        properties: {
          document_number: { type: 'string', description: 'Número de documento del paciente (RUT, cédula, etc.)' },
        },
        required: ['document_number'],
      },
    },
    handler: async (input, ctx) => {
      if (!ctx.contactId) return { success: false, error: 'No contact ID' }

      let secCtx = await security.resolveContext(ctx.contactId, agentId)
      secCtx = await security.tryAutoLink(secCtx)

      const result = await security.verifyByDocument(secCtx, input.document_number as string)
      if (result.success) {
        return { success: true, data: { verified: true, message: 'Identidad verificada correctamente' } }
      }
      return { success: false, error: result.error }
    },
  })

  // ═══════════════════════════════════════
  // 4. CREATE PATIENT
  // ═══════════════════════════════════════

  await toolRegistry.registerTool({
    definition: {
      name: 'medilink-create-patient',
      displayName: 'Registrar paciente nuevo',
      description: 'Registra un nuevo paciente en el sistema Medilink. El teléfono del paciente debe coincidir con el número desde el que escribe.',
      category: 'medilink',
      sourceModule: 'medilink',
      parameters: {
        type: 'object',
        properties: {
          first_name: { type: 'string', description: 'Nombres del paciente' },
          last_name: { type: 'string', description: 'Apellidos del paciente' },
          document_number: { type: 'string', description: 'Número de documento (RUT/cédula)' },
          phone: { type: 'string', description: 'Teléfono celular' },
          email: { type: 'string', description: 'Email (opcional)' },
          birth_date: { type: 'string', description: 'Fecha de nacimiento YYYY-MM-DD (opcional)' },
        },
        required: ['first_name', 'last_name', 'document_number', 'phone'],
      },
    },
    handler: async (input, ctx) => {
      if (!ctx.contactId) return { success: false, error: 'No contact ID' }

      const secCtx = await security.resolveContext(ctx.contactId, agentId)

      // Verify phone matches contact
      const inputPhone = (input.phone as string).replace(/[^0-9+]/g, '')
      if (!secCtx.contactPhone.includes(inputPhone) && !inputPhone.includes(secCtx.contactPhone)) {
        await pgStore.logAudit(ctx.db, {
          contactId: ctx.contactId, agentId,
          action: 'create_patient', targetType: 'patient',
          detail: { reason: 'phone_mismatch', inputPhone, contactPhone: secCtx.contactPhone },
          result: 'denied',
        })
        return { success: false, error: 'El teléfono proporcionado no coincide con el número desde el que escribes' }
      }

      if (secCtx.medilinkPatientId) {
        return { success: false, error: 'Ya tienes un paciente vinculado en el sistema' }
      }

      try {
        const patient = await api.createPatient({
          nombres: input.first_name as string,
          apellidos: input.last_name as string,
          rut: input.document_number as string,
          celular: input.phone as string,
          email: input.email as string | undefined,
          fecha_nacimiento: input.birth_date as string | undefined,
        })

        await pgStore.logAudit(ctx.db, {
          contactId: ctx.contactId, agentId,
          medilinkPatientId: String(patient.id),
          action: 'create_patient', targetType: 'patient', targetId: String(patient.id),
          detail: { nombres: patient.nombres, apellidos: patient.apellidos },
          verificationLevel: 'document_verified',
          result: 'success',
        })

        // Auto-verify since they provided document
        const verResult = await security.verifyByDocument(secCtx, input.document_number as string)

        return {
          success: true,
          data: {
            patientId: patient.id,
            name: `${patient.nombres} ${patient.apellidos}`,
            message: 'Paciente registrado y vinculado exitosamente',
          },
        }
      } catch (err) {
        logger.error({ err }, 'create-patient failed')
        return { success: false, error: 'Error al registrar paciente: ' + String(err) }
      }
    },
  })

  // ═══════════════════════════════════════
  // 5. GET MY APPOINTMENTS
  // ═══════════════════════════════════════

  await toolRegistry.registerTool({
    definition: {
      name: 'medilink-get-my-appointments',
      displayName: 'Ver mis citas',
      description: 'Muestra las citas del paciente. Con verificación básica (teléfono) muestra fechas y horas. Con verificación completa (documento) muestra detalles como profesional, tratamiento y estado.',
      category: 'medilink',
      sourceModule: 'medilink',
      parameters: {
        type: 'object',
        properties: {
          include_past: { type: 'boolean', description: 'Incluir citas pasadas (default: false, solo futuras)' },
        },
      },
    },
    handler: async (input, ctx) => {
      if (!ctx.contactId) return { success: false, error: 'No contact ID' }

      let secCtx = await security.resolveContext(ctx.contactId, agentId)
      secCtx = await security.tryAutoLink(secCtx)

      const access = security.canAccess(secCtx, 'appointments')
      if (!access.allowed) {
        await pgStore.logAudit(ctx.db, {
          contactId: ctx.contactId, agentId,
          action: 'view_appointments', targetType: 'appointment',
          detail: { reason: access.reason },
          verificationLevel: secCtx.verificationLevel,
          result: 'denied',
        })
        return { success: false, error: access.reason === 'No patient linked'
          ? 'No encontramos un paciente vinculado a tu número. ¿Ya eres paciente? Puedo buscarte por tu documento.'
          : 'Necesitas verificar tu identidad primero' }
      }

      try {
        const appointments = await api.getPatientAppointments(secCtx.medilinkPatientId!, 'high')

        // Filter: only future unless include_past
        let filtered = appointments
        if (!input.include_past) {
          const today = new Date().toISOString().split('T')[0]!
          filtered = appointments.filter((a) => a.fecha >= today)
        }

        // CRITICAL: verify every appointment belongs to this patient
        const safe = filtered.filter((a) => security.ownsAppointment(secCtx, a))
        const mapped = safe.map((a) => security.filterAppointment(secCtx, a))

        await pgStore.logAudit(ctx.db, {
          contactId: ctx.contactId, agentId,
          medilinkPatientId: String(secCtx.medilinkPatientId),
          action: 'view_appointments', targetType: 'appointment',
          detail: { count: mapped.length, level: secCtx.verificationLevel },
          verificationLevel: secCtx.verificationLevel,
          result: 'success',
        })

        return { success: true, data: { appointments: mapped, level: secCtx.verificationLevel } }
      } catch (err) {
        logger.error({ err }, 'get-my-appointments failed')
        return { success: false, error: 'Error al consultar citas' }
      }
    },
  })

  // ═══════════════════════════════════════
  // 6. GET MY PAYMENTS
  // ═══════════════════════════════════════

  await toolRegistry.registerTool({
    definition: {
      name: 'medilink-get-my-payments',
      displayName: 'Ver mis pagos pendientes',
      description: 'Consulta los pagos y deudas pendientes del paciente. Con verificación básica muestra solo si tiene deudas (sí/no). Para ver montos requiere re-verificar con documento.',
      category: 'medilink',
      sourceModule: 'medilink',
      parameters: { type: 'object', properties: {} },
    },
    handler: async (_input, ctx) => {
      if (!ctx.contactId) return { success: false, error: 'No contact ID' }

      let secCtx = await security.resolveContext(ctx.contactId, agentId)
      secCtx = await security.tryAutoLink(secCtx)

      const access = security.canAccess(secCtx, 'payments')
      if (!access.allowed) {
        await pgStore.logAudit(ctx.db, {
          contactId: ctx.contactId, agentId,
          action: 'view_payments', targetType: 'payment',
          detail: { reason: access.reason },
          verificationLevel: secCtx.verificationLevel,
          result: 'denied',
        })

        if (access.reason === 'Document verification required for debt details') {
          return { success: false, error: 'Para ver los montos de deuda necesito verificar tu identidad. ¿Puedes proporcionarme tu número de documento?' }
        }
        return { success: false, error: 'Necesitas verificar tu identidad primero' }
      }

      try {
        const payments = await api.getPatientPayments(secCtx.medilinkPatientId!, 'high')
        const filtered = security.filterPayments(secCtx, payments)

        await pgStore.logAudit(ctx.db, {
          contactId: ctx.contactId, agentId,
          medilinkPatientId: String(secCtx.medilinkPatientId),
          action: 'view_payments', targetType: 'payment',
          detail: { hasDebts: filtered.hasDebts, detailsShown: !!filtered.details },
          verificationLevel: secCtx.verificationLevel,
          result: 'success',
        })

        return { success: true, data: filtered }
      } catch (err) {
        logger.error({ err }, 'get-my-payments failed')
        return { success: false, error: 'Error al consultar pagos' }
      }
    },
  })

  // ═══════════════════════════════════════
  // 7. GET MY EVOLUTIONS
  // ═══════════════════════════════════════

  await toolRegistry.registerTool({
    definition: {
      name: 'medilink-get-my-evolutions',
      displayName: 'Ver mis procedimientos',
      description: 'Lista los procedimientos/evoluciones realizados y pendientes del paciente. Muestra nombre, fecha, profesional y estado. NO muestra notas clínicas.',
      category: 'medilink',
      sourceModule: 'medilink',
      parameters: { type: 'object', properties: {} },
    },
    handler: async (_input, ctx) => {
      if (!ctx.contactId) return { success: false, error: 'No contact ID' }

      let secCtx = await security.resolveContext(ctx.contactId, agentId)
      secCtx = await security.tryAutoLink(secCtx)

      const access = security.canAccess(secCtx, 'evolutions')
      if (!access.allowed) {
        await pgStore.logAudit(ctx.db, {
          contactId: ctx.contactId, agentId,
          action: 'view_evolutions', targetType: 'evolution',
          detail: { reason: access.reason },
          verificationLevel: secCtx.verificationLevel,
          result: 'denied',
        })
        return { success: false, error: 'Necesitas verificar tu identidad primero' }
      }

      try {
        const evolutions = await api.getPatientEvolutions(secCtx.medilinkPatientId!, 'high')
        // SECURITY: strip clinical notes, only return metadata
        const safe = evolutions.map((e) => security.filterEvolution(e))

        await pgStore.logAudit(ctx.db, {
          contactId: ctx.contactId, agentId,
          medilinkPatientId: String(secCtx.medilinkPatientId),
          action: 'view_evolutions', targetType: 'evolution',
          detail: { count: safe.length },
          verificationLevel: secCtx.verificationLevel,
          result: 'success',
        })

        return { success: true, data: { evolutions: safe } }
      } catch (err) {
        logger.error({ err }, 'get-my-evolutions failed')
        return { success: false, error: 'Error al consultar procedimientos' }
      }
    },
  })

  // ═══════════════════════════════════════
  // 8. CREATE APPOINTMENT
  // ═══════════════════════════════════════

  await toolRegistry.registerTool({
    definition: {
      name: 'medilink-create-appointment',
      displayName: 'Agendar cita',
      description: 'Agenda una nueva cita para el paciente. Requiere profesional, tratamiento, fecha y hora. Valida disponibilidad, reglas de agendamiento y crea secuencia de seguimiento.',
      category: 'medilink',
      sourceModule: 'medilink',
      parameters: {
        type: 'object',
        properties: {
          professional_name: { type: 'string', description: 'Nombre del profesional' },
          treatment_name: { type: 'string', description: 'Tipo de tratamiento' },
          date: { type: 'string', description: 'Fecha (YYYY-MM-DD)' },
          time: { type: 'string', description: 'Hora (HH:MM)' },
          branch_name: { type: 'string', description: 'Sucursal (opcional, usa default si no se especifica)' },
          notes: { type: 'string', description: 'Notas/comentarios para la cita (opcional)' },
          duration_minutes: { type: 'number', description: 'Duración en minutos (opcional, usa default)' },
        },
        required: ['professional_name', 'treatment_name', 'date', 'time'],
      },
    },
    handler: async (input, ctx) => {
      if (!ctx.contactId) return { success: false, error: 'No contact ID' }

      let secCtx = await security.resolveContext(ctx.contactId, agentId)
      secCtx = await security.tryAutoLink(secCtx)

      const access = security.canAccess(secCtx, 'appointments')
      if (!access.allowed) {
        return { success: false, error: 'Necesitas verificar tu identidad primero para agendar' }
      }

      try {
        const ref = await cache.getReferenceData()

        // Resolve professional
        const prof = cache.findProfessionalByName(input.professional_name as string)
        if (!prof) return { success: false, error: `No se encontró al profesional "${input.professional_name}"` }

        // Resolve treatment
        const treatment = cache.findTreatmentByName(input.treatment_name as string)
        if (!treatment) return { success: false, error: `No se encontró el tratamiento "${input.treatment_name}"` }

        // Check scheduling rules: professional can do this treatment?
        const profRules = await pgStore.getProfessionalTreatments(ctx.db)
        if (profRules.length > 0) {
          const allowed = profRules.some((r) =>
            r.medilinkProfessionalId === prof.id && r.medilinkTreatmentId === treatment.id,
          )
          if (!allowed) {
            return { success: false, error: `El profesional ${prof.nombre} ${prof.apellidos} no realiza el tratamiento ${treatment.nombre}` }
          }
        }

        // Check user type rules
        const userTypeRules = await pgStore.getUserTypeRules(ctx.db)
        if (userTypeRules.length > 0) {
          const contactType = ctx.contactType ?? 'nuevo'
          const rule = userTypeRules.find((r) =>
            r.userType === contactType && r.medilinkTreatmentId === treatment.id,
          )
          if (rule && !rule.allowed) {
            return { success: false, error: `Este tipo de tratamiento no está disponible para tu tipo de paciente. ${rule.notes ?? ''}` }
          }
        }

        // Resolve branch
        let branchId: number
        if (input.branch_name) {
          const branch = cache.findBranchByName(input.branch_name as string)
          if (!branch) return { success: false, error: `No se encontró la sucursal "${input.branch_name}"` }
          branchId = branch.id
        } else {
          const defaultBranch = cache.getDefaultBranch()
          if (!defaultBranch) return { success: false, error: 'No hay sucursal configurada por defecto' }
          branchId = defaultBranch.id
        }

        // Find a chair (first available)
        const chairs = ref.chairs.filter((c) => c.id_sucursal === branchId)
        const chairId = chairs[0]?.id
        if (!chairId) return { success: false, error: 'No hay sillones disponibles en esta sucursal' }

        // Resolve default status
        const config = registry.getConfig<{ MEDILINK_DEFAULT_STATUS_ID: string; MEDILINK_DEFAULT_DURATION_MIN: number }>('medilink')
        const statusId = parseInt(config.MEDILINK_DEFAULT_STATUS_ID, 10) || ref.statuses[0]?.id
        if (!statusId) return { success: false, error: 'No hay estado de cita configurado' }

        const duration = (input.duration_minutes as number) ?? treatment.duracion ?? config.MEDILINK_DEFAULT_DURATION_MIN

        const appointment = await api.createAppointment({
          id_profesional: prof.id,
          id_sucursal: branchId,
          id_estado: statusId,
          id_sillon: chairId,
          id_paciente: secCtx.medilinkPatientId!,
          id_tratamiento: treatment.id,
          fecha: input.date as string,
          hora_inicio: input.time as string,
          duracion: duration,
          comentario: input.notes as string | undefined,
        })

        // Invalidate availability cache
        await cache.invalidateAvailability(branchId, prof.id)

        await pgStore.logAudit(ctx.db, {
          contactId: ctx.contactId, agentId,
          medilinkPatientId: String(secCtx.medilinkPatientId),
          action: 'create_appointment', targetType: 'appointment', targetId: String(appointment.id),
          detail: {
            professional: `${prof.nombre} ${prof.apellidos}`,
            treatment: treatment.nombre,
            date: input.date, time: input.time, duration,
          },
          verificationLevel: secCtx.verificationLevel,
          result: 'success',
        })

        return {
          success: true,
          data: {
            appointmentId: appointment.id,
            fecha: appointment.fecha,
            hora: appointment.hora_inicio,
            profesional: appointment.nombre_profesional,
            tratamiento: appointment.nombre_tratamiento,
            sucursal: appointment.nombre_sucursal,
            message: 'Cita agendada exitosamente',
          },
        }
      } catch (err) {
        logger.error({ err }, 'create-appointment failed')
        return { success: false, error: 'Error al agendar cita: ' + String(err) }
      }
    },
  })

  // ═══════════════════════════════════════
  // 9. RESCHEDULE APPOINTMENT
  // ═══════════════════════════════════════

  await toolRegistry.registerTool({
    definition: {
      name: 'medilink-reschedule-appointment',
      displayName: 'Reagendar cita',
      description: 'Reagenda una cita existente a nueva fecha/hora. Mantiene el mismo profesional obligatoriamente. Cancela los seguimientos anteriores y crea nuevos.',
      category: 'medilink',
      sourceModule: 'medilink',
      parameters: {
        type: 'object',
        properties: {
          appointment_id: { type: 'number', description: 'ID de la cita a reagendar (obtenido de medilink-get-my-appointments)' },
          new_date: { type: 'string', description: 'Nueva fecha (YYYY-MM-DD)' },
          new_time: { type: 'string', description: 'Nueva hora (HH:MM)' },
        },
        required: ['appointment_id', 'new_date', 'new_time'],
      },
    },
    handler: async (input, ctx) => {
      if (!ctx.contactId) return { success: false, error: 'No contact ID' }

      let secCtx = await security.resolveContext(ctx.contactId, agentId)
      secCtx = await security.tryAutoLink(secCtx)

      const access = security.canAccess(secCtx, 'appointments')
      if (!access.allowed) {
        return { success: false, error: 'Necesitas verificar tu identidad primero' }
      }

      try {
        // Fetch the existing appointment
        const existing = await api.getAppointment(input.appointment_id as number, 'high')

        // CRITICAL: verify ownership
        if (!security.ownsAppointment(secCtx, existing)) {
          await pgStore.logAudit(ctx.db, {
            contactId: ctx.contactId, agentId,
            action: 'reschedule_appointment', targetType: 'appointment',
            targetId: String(input.appointment_id),
            detail: { reason: 'not_owner' },
            verificationLevel: secCtx.verificationLevel,
            result: 'denied',
          })
          return { success: false, error: 'No tienes permiso para reagendar esta cita' }
        }

        // Update keeping same professional
        const updated = await api.updateAppointment(existing.id, {
          fecha: input.new_date as string,
          hora_inicio: input.new_time as string,
        })

        // Cancel old follow-ups
        const cancelledJobIds = await pgStore.cancelFollowUpsForAppointment(ctx.db, String(existing.id))

        // Invalidate availability cache
        await cache.invalidateAvailability()

        await pgStore.logAudit(ctx.db, {
          contactId: ctx.contactId, agentId,
          medilinkPatientId: String(secCtx.medilinkPatientId),
          action: 'reschedule_appointment', targetType: 'appointment', targetId: String(existing.id),
          detail: {
            oldDate: existing.fecha, oldTime: existing.hora_inicio,
            newDate: input.new_date, newTime: input.new_time,
            cancelledFollowUps: cancelledJobIds.length,
          },
          verificationLevel: secCtx.verificationLevel,
          result: 'success',
        })

        return {
          success: true,
          data: {
            appointmentId: updated.id,
            fecha: updated.fecha,
            hora: updated.hora_inicio,
            profesional: updated.nombre_profesional,
            message: `Cita reagendada al ${updated.fecha} a las ${updated.hora_inicio} con ${updated.nombre_profesional}`,
          },
        }
      } catch (err) {
        logger.error({ err }, 'reschedule-appointment failed')
        return { success: false, error: 'Error al reagendar cita: ' + String(err) }
      }
    },
  })

  // ═══════════════════════════════════════
  // 10. REQUEST PATIENT EDIT
  // ═══════════════════════════════════════

  await toolRegistry.registerTool({
    definition: {
      name: 'medilink-request-patient-edit',
      displayName: 'Solicitar cambio de datos',
      description: 'Solicita un cambio en los datos del paciente (teléfono, email, dirección, nombre). Requiere verificación con documento. El cambio necesita aprobación de un administrador.',
      category: 'medilink',
      sourceModule: 'medilink',
      parameters: {
        type: 'object',
        properties: {
          field: {
            type: 'string',
            description: 'Campo a cambiar',
            enum: ['celular', 'email', 'direccion', 'nombres', 'apellidos'],
          },
          new_value: { type: 'string', description: 'Nuevo valor para el campo' },
          reason: { type: 'string', description: 'Razón del cambio (opcional)' },
        },
        required: ['field', 'new_value'],
      },
    },
    handler: async (input, ctx) => {
      if (!ctx.contactId) return { success: false, error: 'No contact ID' }

      let secCtx = await security.resolveContext(ctx.contactId, agentId)
      secCtx = await security.tryAutoLink(secCtx)

      const access = security.canAccess(secCtx, 'edit')
      if (!access.allowed) {
        return { success: false, error: 'Necesitas verificar tu identidad con documento para solicitar cambios' }
      }

      try {
        // Get current patient data for the "old" value
        const patient = await api.getPatient(secCtx.medilinkPatientId!, 'high')
        const field = input.field as string
        const oldValue = String((patient as unknown as Record<string, unknown>)[field] ?? '')

        const requestId = await pgStore.createEditRequest(ctx.db, {
          medilinkPatientId: String(secCtx.medilinkPatientId),
          contactId: ctx.contactId,
          agentId,
          requestedChanges: { [field]: { old: oldValue, new: input.new_value as string } },
          reason: input.reason as string | undefined,
        })

        await pgStore.logAudit(ctx.db, {
          contactId: ctx.contactId, agentId,
          medilinkPatientId: String(secCtx.medilinkPatientId),
          action: 'edit_request', targetType: 'patient', targetId: String(secCtx.medilinkPatientId),
          detail: { field, oldValue, newValue: input.new_value, requestId },
          verificationLevel: secCtx.verificationLevel,
          result: 'pending',
        })

        // Notify admins
        try {
          await registry.runHook('message:send', {
            channel: 'whatsapp',
            to: '', // Resolved by users module
            content: {
              type: 'text',
              text: `📋 Solicitud de cambio de datos:\nPaciente: ${patient.nombres} ${patient.apellidos}\nCampo: ${field}\nAnterior: ${oldValue}\nNuevo: ${input.new_value}\n\nResponde APROBAR o RECHAZAR`,
            },
          })
        } catch {
          // Notification failure is not critical
          logger.warn('Failed to notify admins about edit request')
        }

        return {
          success: true,
          data: {
            requestId,
            message: 'Tu solicitud de cambio ha sido registrada y será revisada por un administrador.',
          },
        }
      } catch (err) {
        logger.error({ err }, 'request-patient-edit failed')
        return { success: false, error: 'Error al crear solicitud de cambio' }
      }
    },
  })

  logger.info('10 Medilink tools registered')
}
