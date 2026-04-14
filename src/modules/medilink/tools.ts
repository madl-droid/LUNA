// LUNA — Module: medilink
// Agent tools registration — these are the capabilities the AI agent gets
// 14 tools: check-availability, get-professionals, search-patient, get-patient-info,
//           get-my-appointments, get-my-payments, get-patient-treatments, get-prestaciones,
//           create-patient, create-appointment, reschedule-appointment, mark-pending-reschedule,
//           list-dependents, register-dependent

import pino from 'pino'
import type { Registry } from '../../kernel/registry.js'
import { MedilinkApiError, type MedilinkApiClient } from './api-client.js'
import type { MedilinkCache } from './cache.js'
import type { SecurityService } from './security.js'
import * as pgStore from './pg-store.js'
import { WorkingMemory, ML, type AppointmentSnapshot } from './working-memory.js'
import type { MedilinkDependent } from './types.js'

const logger = pino({ name: 'medilink:tools' })

/** Extract a human-readable error detail from MedilinkApiError (includes API body) or fallback to String(err) */
function medilinkErrorDetail(err: unknown): string {
  if (err instanceof MedilinkApiError) return String(err)
  return String(err)
}

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

  const redis = registry.getRedis()
  const wmem = new WorkingMemory(redis, 'medilink')

  // ═══════════════════════════════════════
  // 1. CHECK AVAILABILITY (PUBLIC)
  // ═══════════════════════════════════════

  await toolRegistry.registerTool({
    definition: {
      name: 'medilink-check-availability',
      displayName: 'Ver disponibilidad de agenda',
      description: 'Consulta horarios disponibles en la clínica para una fecha. Filtra automáticamente por profesionales habilitados para el tipo de prestación. Para reagendamiento, pasa appointment_id y el sistema filtra solo profesionales con las mismas categorías del original. Retorna solo slots libres.',
      category: 'medilink',
      sourceModule: 'medilink',
      parameters: {
        type: 'object',
        properties: {
          date: { type: 'string', description: 'Fecha a consultar (YYYY-MM-DD). Si no se especifica, usa hoy.' },
          appointment_id: { type: 'number', description: 'ID de la cita a reagendar. El sistema filtra automáticamente profesionales con categorías compatibles.' },
          professional_name: { type: 'string', description: 'Nombre del profesional (parcial OK)' },
          treatment_name: { type: 'string', description: 'Tipo de tratamiento/prestación para filtrar profesionales que lo realizan' },
        },
      },
    },
    handler: async (input, ctx) => {
      try {
        const ref = await cache.getReferenceData()

        // Resolve branch (always default — single sede)
        const defaultBranch = cache.getDefaultBranch()
        if (!defaultBranch) return { success: false, error: 'No hay sucursal configurada' }
        const branchId = defaultBranch.id

        const date = (input.date as string) ?? new Date().toISOString().split('T')[0]!

        // RESCHEDULING: resolve appointment_id from param or working memory
        let rescheduleAppointmentId = input.appointment_id as number | undefined
        if (!rescheduleAppointmentId && ctx.contactId) {
          const pending = await wmem.get<number>(ctx.contactId, ML.PENDING_RESCHEDULE_ID)
          if (pending) rescheduleAppointmentId = pending
        }

        if (rescheduleAppointmentId) {
          // Store in working memory so reschedule-appointment can read it later
          if (ctx.contactId) await wmem.set(ctx.contactId, ML.PENDING_RESCHEDULE_ID, rescheduleAppointmentId)

          const existing = await api.getAppointment(rescheduleAppointmentId, 'medium')
          const catAssignments = await pgStore.getProfessionalCategoryAssignments(registry.getDb())
          const origCats = catAssignments
            .filter(a => a.medilinkProfessionalId === existing.id_dentista)
            .map(a => a.medilinkCategoryId)

          // Find all professionals with the same categories as the original
          const compatibleProfIds = origCats.length > 0
            ? catAssignments
                .filter(a => origCats.every(c => catAssignments.some(x => x.medilinkProfessionalId === a.medilinkProfessionalId && x.medilinkCategoryId === c)))
                .map(a => a.medilinkProfessionalId)
                .filter((id, i, arr) => arr.indexOf(id) === i)  // dedupe
            : [existing.id_dentista]  // no category rules — keep same professional only

          const allSlots = []
          for (const pId of compatibleProfIds) {
            const prof = ref.professionals.find(p => p.id === pId && p.habilitado)
            if (!prof) continue
            const slots = await cache.getAvailability(branchId, date, pId)
            allSlots.push(...slots.map(s => ({
              fecha: s.date,
              hora: s.time,
              profesional: s.professionalName,
              mismo_profesional: pId === existing.id_dentista,
              duracion: s.durationMinutes,
            })))
          }
          return { success: true, data: { slots: allSlots, fecha: date, sucursal: defaultBranch.nombre } }
        }

        // Resolve professional
        let professionalId: number | undefined
        if (input.professional_name) {
          const prof = cache.findProfessionalByName(input.professional_name as string)
          if (!prof) return { success: false, error: `No se encontró el profesional "${input.professional_name}"` }
          professionalId = prof.id
        }

        // If treatment specified, find compatible professionals via category assignments
        if (input.treatment_name && !professionalId) {
          const treatment = cache.findTreatmentByName(input.treatment_name as string)
          if (!treatment) return { success: false, error: `No se encontró la prestación "${input.treatment_name}"` }

          const prestacion = (ref.prestaciones ?? []).find(p => p.id === treatment.id)
          if (prestacion) {
            const catAssignments = await pgStore.getProfessionalCategoryAssignments(registry.getDb())
            const compatibleProfIds = catAssignments
              .filter(a => a.medilinkCategoryId === prestacion.id_categoria)
              .map(a => a.medilinkProfessionalId)

            if (compatibleProfIds.length > 0) {
              const allSlots = []
              for (const pId of compatibleProfIds) {
                const prof = ref.professionals.find(p => p.id === pId && p.habilitado)
                if (!prof) continue
                const slots = await cache.getAvailability(branchId, date, pId)
                allSlots.push(...slots.map(s => ({
                  fecha: s.date,
                  hora: s.time,
                  profesional: s.professionalName,
                  duracion: s.durationMinutes,
                })))
              }
              return { success: true, data: { slots: allSlots, fecha: date, sucursal: defaultBranch.nombre } }
            }
          }
        }

        // No professional or treatment specified — use default professional (lead flow)
        if (!professionalId) {
          const defaultProfRow = await registry.getDb().query(
            `SELECT value FROM config_store WHERE key = 'MEDILINK_DEFAULT_PROFESSIONAL_ID'`,
          )
          const defaultProfId = parseInt(defaultProfRow.rows[0]?.value ?? '0', 10)
          if (defaultProfId) professionalId = defaultProfId
        }

        const slots = await cache.getAvailability(branchId, date, professionalId)
        const cleanSlots = slots.map(s => ({
          fecha: s.date,
          hora: s.time,
          profesional: s.professionalName,
          duracion: s.durationMinutes,
        }))

        return { success: true, data: { slots: cleanSlots, fecha: date, sucursal: defaultBranch.nombre } }
      } catch (err) {
        logger.error({ err }, 'check-availability failed')
        return { success: false, error: 'Error al consultar disponibilidad: ' + medilinkErrorDetail(err) }
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
      description: 'Lista los profesionales activos de la clínica con sus especialidades.',
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
          })),
        }
      } catch (err) {
        return { success: false, error: 'Error al listar profesionales: ' + medilinkErrorDetail(err) }
      }
    },
  })

  // ═══════════════════════════════════════
  // 3. SEARCH PATIENT (auto by contact phone)
  // ═══════════════════════════════════════

  await toolRegistry.registerTool({
    definition: {
      name: 'medilink-search-patient',
      displayName: 'Buscar paciente',
      description: 'Busca si el contacto ya es paciente registrado. Sin parámetros: busca automáticamente por teléfono. Con document_number: busca por número de documento/cédula. Si encuentra un match único, lo vincula automáticamente.',
      category: 'medilink',
      sourceModule: 'medilink',
      parameters: {
        type: 'object',
        properties: {
          document_number: { type: 'string', description: 'Número de documento/cédula para buscar manualmente (sin puntos ni guiones). Usar cuando el contacto dice que ya es paciente pero no se encontró por teléfono.' },
        },
      },
    },
    handler: async (input, ctx) => {
      if (!ctx.contactId) return { success: false, error: 'No contact ID' }

      try {
        const secCtx = await security.resolveContext(ctx.contactId)

        // If already linked, return the linked patient info
        if (secCtx.medilinkPatientId) {
          const patient = await api.getPatient(secCtx.medilinkPatientId, 'high')
          await wmem.set(ctx.contactId, ML.PATIENT_ID, secCtx.medilinkPatientId)
          await pgStore.logAudit(ctx.db, {
            contactId: ctx.contactId,
            medilinkPatientId: String(secCtx.medilinkPatientId),
            action: 'search_patient', targetType: 'patient', targetId: String(secCtx.medilinkPatientId),
            detail: { method: 'already_linked' },
            verificationLevel: secCtx.verificationLevel,
            result: 'success',
          })
          return {
            success: true,
            data: { found: true, already_linked: true, patient: security.filterPatientSearch(patient) },
          }
        }

        // Manual search by document number (when user provides cédula/RUT)
        const docNumber = input.document_number as string | undefined
        if (docNumber) {
          const cleanDoc = docNumber.replace(/[.\-\s]/g, '')
          const patients = await api.findPatientByDocument(cleanDoc)

          await pgStore.logAudit(ctx.db, {
            contactId: ctx.contactId,
            action: 'search_patient', targetType: 'patient',
            detail: { method: 'document', docLast4: cleanDoc.slice(-4), results: patients.length },
            result: 'success',
          })

          if (patients.length === 1) {
            const patient = patients[0]!
            await security.linkContactToPatient(ctx.contactId, patient.id, 'document_verified')
            await wmem.set(ctx.contactId, ML.PATIENT_ID, patient.id)
            return {
              success: true,
              data: { found: true, patient: security.filterPatientSearch(patient), linked: true, method: 'document' },
            }
          }
          if (patients.length > 1) {
            return { success: true, data: { found: false, reason: 'multiple_matches', count: patients.length, method: 'document' } }
          }
          return { success: true, data: { found: false, reason: 'not_found', method: 'document' } }
        }

        // Auto-search by phone (default — no params)
        const phone = secCtx.contactPhone
        if (!phone) return { success: true, data: { found: false, reason: 'no_phone' } }

        const patients = await api.findPatientByPhone(phone)

        await pgStore.logAudit(ctx.db, {
          contactId: ctx.contactId,
          action: 'search_patient', targetType: 'patient',
          detail: { method: 'phone', phoneLast4: phone.slice(-4), results: patients.length },
          result: 'success',
        })

        if (patients.length === 1) {
          // Auto-link unique match
          const patient = patients[0]!
          const updatedCtx = await security.tryAutoLink(secCtx)
          if (updatedCtx.medilinkPatientId) {
            await wmem.set(ctx.contactId, ML.PATIENT_ID, updatedCtx.medilinkPatientId)
          }
          return {
            success: true,
            data: {
              found: true,
              patient: security.filterPatientSearch(patient),
              linked: updatedCtx.medilinkPatientId === patient.id,
            },
          }
        }

        if (patients.length > 1) {
          return { success: true, data: { found: false, reason: 'multiple_matches', count: patients.length } }
        }

        return { success: true, data: { found: false, reason: 'not_found' } }
      } catch (err) {
        logger.error({ err }, 'search-patient failed')
        return { success: false, error: 'Error al buscar paciente: ' + medilinkErrorDetail(err) }
      }
    },
  })

  // ═══════════════════════════════════════
  // 4. GET PATIENT INFO (linked patient basic data)
  // ═══════════════════════════════════════

  await toolRegistry.registerTool({
    definition: {
      name: 'medilink-get-patient-info',
      displayName: 'Ver datos del paciente',
      description: 'Muestra los datos básicos del paciente vinculado: nombre, teléfono, email. No muestra datos clínicos ni documento.',
      category: 'medilink',
      sourceModule: 'medilink',
      parameters: { type: 'object', properties: {} },
    },
    handler: async (_input, ctx) => {
      if (!ctx.contactId) return { success: false, error: 'No contact ID' }

      let secCtx = await security.resolveContext(ctx.contactId)
      secCtx = await security.tryAutoLink(secCtx)

      const access = security.canAccess(secCtx, 'patient_info')
      if (!access.allowed) {
        return { success: false, error: access.reason === 'No patient linked'
          ? 'No te encontré en el sistema con tu número de teléfono'
          : 'Necesito primero verificar los datos en el sistema' }
      }

      try {
        const patient = await api.getPatient(secCtx.medilinkPatientId!, 'high')

        await pgStore.logAudit(ctx.db, {
          contactId: ctx.contactId,
          medilinkPatientId: String(secCtx.medilinkPatientId),
          action: 'view_patient', targetType: 'patient', targetId: String(secCtx.medilinkPatientId),
          detail: {},
          verificationLevel: secCtx.verificationLevel,
          result: 'success',
        })

        return { success: true, data: security.filterPatientBasic(patient) }
      } catch (err) {
        logger.error({ err }, 'get-patient-info failed')
        return { success: false, error: 'Error al consultar datos del paciente: ' + medilinkErrorDetail(err) }
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
      description: 'Muestra las citas del paciente vinculado. Retorna fecha, hora, profesional, tratamiento y estado.',
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

      let secCtx = await security.resolveContext(ctx.contactId)
      secCtx = await security.tryAutoLink(secCtx)

      const access = security.canAccess(secCtx, 'appointments')
      if (!access.allowed) {
        return { success: false, error: access.reason === 'No patient linked'
          ? 'No te encontré en el sistema con tu número de teléfono. Si ya eres paciente, dime tu número de documento y te busco'
          : 'Necesito primero verificar los datos en el sistema' }
      }

      try {
        const appointments = await api.getPatientAppointments(secCtx.medilinkPatientId!, 'high')

        let filtered = appointments
        if (!input.include_past) {
          const today = new Date().toISOString().split('T')[0]!
          filtered = appointments.filter((a) => a.fecha >= today)
        }

        // Verify ownership and filter data
        const safe = filtered.filter((a) => security.ownsAppointment(secCtx, a))
        const mapped = safe.map((a) => security.filterAppointment(secCtx, a))

        // Save to working memory — raw IDs needed for rescheduling across turns
        await wmem.set(ctx.contactId, ML.PATIENT_ID, secCtx.medilinkPatientId!)
        await wmem.set<AppointmentSnapshot[]>(ctx.contactId, ML.APPOINTMENTS, safe.map(a => ({
          id: a.id,
          date: a.fecha,
          time: a.hora_inicio,
          professionalId: a.id_dentista,
          professionalName: a.nombre_dentista ?? '',
          treatmentId: a.id_tratamiento,
          treatmentName: a.nombre_tratamiento ?? '',
          branchId: a.id_sucursal,
          branchName: a.nombre_sucursal ?? '',
          idAtencion: a.id_atencion ?? null,
        })))

        await pgStore.logAudit(ctx.db, {
          contactId: ctx.contactId,
          medilinkPatientId: String(secCtx.medilinkPatientId),
          action: 'view_appointments', targetType: 'appointment',
          detail: { count: mapped.length, level: secCtx.verificationLevel },
          verificationLevel: secCtx.verificationLevel,
          result: 'success',
        })

        return { success: true, data: { appointments: mapped } }
      } catch (err) {
        logger.error({ err }, 'get-my-appointments failed')
        return { success: false, error: 'Error al consultar citas: ' + medilinkErrorDetail(err) }
      }
    },
  })

  // ═══════════════════════════════════════
  // 6. GET MY PAYMENTS
  // ═══════════════════════════════════════

  await toolRegistry.registerTool({
    definition: {
      name: 'medilink-get-my-payments',
      displayName: 'Ver pagos pendientes',
      description: 'Consulta los pagos y deudas pendientes del paciente. Con verificación básica muestra solo si tiene deudas (sí/no). Para montos requiere verificación con documento.',
      category: 'medilink',
      sourceModule: 'medilink',
      parameters: { type: 'object', properties: {} },
    },
    handler: async (_input, ctx) => {
      if (!ctx.contactId) return { success: false, error: 'No contact ID' }

      let secCtx = await security.resolveContext(ctx.contactId)
      secCtx = await security.tryAutoLink(secCtx)

      const access = security.canAccess(secCtx, 'payments')
      if (!access.allowed) {
        if (access.reason === 'Document verification required for debt details') {
          return { success: false, error: 'No puedo compartir información de pagos sin verificar tu identidad, por seguridad' }
        }
        return { success: false, error: 'Necesito primero verificar los datos en el sistema' }
      }

      try {
        const payments = await api.getPatientPayments(secCtx.medilinkPatientId!, 'high')
        const filtered = security.filterPayments(secCtx, payments)

        await pgStore.logAudit(ctx.db, {
          contactId: ctx.contactId,
          medilinkPatientId: String(secCtx.medilinkPatientId),
          action: 'view_payments', targetType: 'payment',
          detail: { hasDebts: filtered.hasDebts, detailsShown: !!filtered.details },
          verificationLevel: secCtx.verificationLevel,
          result: 'success',
        })

        return { success: true, data: filtered }
      } catch (err) {
        logger.error({ err }, 'get-my-payments failed')
        return { success: false, error: 'Error al consultar pagos: ' + medilinkErrorDetail(err) }
      }
    },
  })

  // ═══════════════════════════════════════
  // 7. GET PATIENT TREATMENT PLANS
  // ═══════════════════════════════════════

  await toolRegistry.registerTool({
    definition: {
      name: 'medilink-get-treatment-plans',
      displayName: 'Ver planes de tratamiento',
      description: 'Muestra los planes de tratamiento (atenciones) del paciente con estado, deuda pendiente y total. Usado para saber tratamientos activos y saldos.',
      category: 'medilink',
      sourceModule: 'medilink',
      parameters: {
        type: 'object',
        properties: {
          active_only: { type: 'boolean', description: 'Solo mostrar tratamientos activos (default: true)' },
        },
      },
    },
    handler: async (input, ctx) => {
      if (!ctx.contactId) return { success: false, error: 'No contact ID' }

      let secCtx = await security.resolveContext(ctx.contactId)
      secCtx = await security.tryAutoLink(secCtx)

      const access = security.canAccess(secCtx, 'treatment_plans')
      if (!access.allowed) {
        return { success: false, error: access.reason === 'No patient linked'
          ? 'No te encontré en el sistema con tu número de teléfono'
          : 'Necesito primero verificar los datos en el sistema' }
      }

      try {
        const plans = await api.getPatientTreatmentPlans(secCtx.medilinkPatientId!, 'high')

        const activeOnly = input.active_only !== false // default true
        const filtered = activeOnly ? plans.filter(p => !p.finalizado) : plans
        const clean = filtered.map(p => security.filterTreatmentPlan(p))

        await pgStore.logAudit(ctx.db, {
          contactId: ctx.contactId,
          medilinkPatientId: String(secCtx.medilinkPatientId),
          action: 'view_treatment_plans', targetType: 'treatment_plan',
          detail: { count: clean.length, activeOnly },
          verificationLevel: secCtx.verificationLevel,
          result: 'success',
        })

        return { success: true, data: { plans: clean } }
      } catch (err) {
        logger.error({ err }, 'get-treatment-plans failed')
        return { success: false, error: 'Error al consultar planes de tratamiento: ' + medilinkErrorDetail(err) }
      }
    },
  })

  // ═══════════════════════════════════════
  // 8. GET PRESTACIONES (catalog for semantic matching)
  // ═══════════════════════════════════════

  await toolRegistry.registerTool({
    definition: {
      name: 'medilink-get-prestaciones',
      displayName: 'Ver catálogo de prestaciones',
      description: 'Retorna el catálogo de prestaciones/servicios disponibles en la clínica con su categoría. Usado para identificar qué prestación corresponde a lo que el paciente solicita.',
      category: 'medilink',
      sourceModule: 'medilink',
      parameters: {
        type: 'object',
        properties: {
          category_name: { type: 'string', description: 'Filtrar por nombre de categoría (parcial OK)' },
        },
      },
    },
    handler: async (input) => {
      try {
        await cache.getReferenceData()
        let prestaciones = cache.getPrestaciones().filter(p => p.habilitado)

        if (input.category_name) {
          const strip = (s: string) => s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
          const needle = strip(input.category_name as string)
          prestaciones = prestaciones.filter(p => strip(p.nombre_categoria ?? '').includes(needle) || strip(p.nombre ?? '').includes(needle))
        }

        return {
          success: true,
          data: {
            prestaciones: prestaciones.map(p => ({
              id: p.id,
              nombre: p.nombre,
              categoria: p.nombre_categoria,
              id_categoria: p.id_categoria,
            })),
          },
        }
      } catch (err) {
        logger.error({ err }, 'get-prestaciones failed')
        return { success: false, error: 'Error al consultar prestaciones: ' + medilinkErrorDetail(err) }
      }
    },
  })

  // ═══════════════════════════════════════
  // 9. CREATE PATIENT
  // ═══════════════════════════════════════

  await toolRegistry.registerTool({
    definition: {
      name: 'medilink-create-patient',
      displayName: 'Registrar paciente nuevo',
      description: 'Registra un nuevo paciente en el sistema. El teléfono debe coincidir con el del contacto. Si no tiene email usar sin@correo.com.',
      category: 'medilink',
      sourceModule: 'medilink',
      parameters: {
        type: 'object',
        properties: {
          first_name: { type: 'string', description: 'Nombres del paciente' },
          last_name: { type: 'string', description: 'Apellidos del paciente' },
          document_type: { type: 'string', description: 'Tipo de documento: cedula, cedula_extranjeria, pasaporte, tarjeta_identidad' },
          document_number: { type: 'string', description: 'Número de documento (sin puntos ni guiones)' },
          phone: { type: 'string', description: 'Teléfono celular' },
          email: { type: 'string', description: 'Email (si no tiene, enviar sin@correo.com)' },
        },
        required: ['first_name', 'last_name', 'document_number', 'phone'],
      },
    },
    handler: async (input, ctx) => {
      if (!ctx.contactId) return { success: false, error: 'No contact ID' }

      const secCtx = await security.resolveContext(ctx.contactId)

      // Verify phone matches contact
      const inputPhone = (input.phone as string).replace(/[^0-9+]/g, '')
      if (!secCtx.contactPhone.includes(inputPhone) && !inputPhone.includes(secCtx.contactPhone)) {
        await pgStore.logAudit(ctx.db, {
          contactId: ctx.contactId,
          action: 'create_patient', targetType: 'patient',
          detail: { reason: 'phone_mismatch' },
          result: 'denied',
        })
        return { success: false, error: 'El teléfono proporcionado no coincide con el número desde el que escribes' }
      }

      if (secCtx.medilinkPatientId) {
        return { success: false, error: 'Ya estabas registrado en el sistema' }
      }

      try {
        // Normalize document number — remove dots, hyphens, spaces
        const docNumber = (input.document_number as string).replace(/[.\-\s]/g, '')
        // Default email if not provided
        const email = (input.email as string) || 'sin@correo.com'

        const patient = await api.createPatient({
          nombre: input.first_name as string,
          apellidos: input.last_name as string,
          rut: docNumber,
          tipo_documento: 1,  // 1 = documento genérico (cédula, CE, etc.), 0 = RUT chileno con validación
          celular: input.phone as string,
          email,
        })

        await pgStore.logAudit(ctx.db, {
          contactId: ctx.contactId,
          medilinkPatientId: String(patient.id),
          action: 'create_patient', targetType: 'patient', targetId: String(patient.id),
          detail: { nombre: patient.nombre, apellidos: patient.apellidos },
          verificationLevel: 'document_verified',
          result: 'success',
        })

        // Auto-link and verify
        await security.verifyByDocument(secCtx, docNumber)
        await wmem.set(ctx.contactId, ML.PATIENT_ID, patient.id)

        return {
          success: true,
          data: {
            patientId: patient.id,
            name: `${patient.nombre} ${patient.apellidos}`,
            message: 'Registrado',
          },
        }
      } catch (err) {
        // If document already exists in Medilink, find by doc and link instead of failing
        const isDocDuplicate = err instanceof Error && (
          (err as import('./api-client.js').MedilinkApiError).status === 422 ||
          (err as import('./api-client.js').MedilinkApiError).status === 409 ||
          (err as import('./api-client.js').MedilinkApiError).status === 400
        ) && /rut|documento|duplicado|ya exist/i.test((err as import('./api-client.js').MedilinkApiError).body ?? '')

        if (isDocDuplicate && ctx.contactId) {
          try {
            const docNumber = (input.document_number as string).replace(/[.\-\s]/g, '')
            const patients = await api.findPatientByDocument(docNumber)
            if (patients.length === 1) {
              const existing = patients[0]!
              await security.linkContactToPatient(ctx.contactId, existing.id, 'document_verified')
              await wmem.set(ctx.contactId, ML.PATIENT_ID, existing.id)
              return {
                success: true,
                data: {
                  patientId: existing.id,
                  name: `${existing.nombre} ${existing.apellidos}`,
                  message: 'Ya estabas registrado en el sistema',
                },
              }
            }
          } catch (innerErr) {
            logger.warn({ innerErr }, 'create-patient doc-fallback failed')
          }
        }

        logger.error({ err }, 'create-patient failed')
        return { success: false, error: 'Error al registrar paciente: ' + medilinkErrorDetail(err) }
      }
    },
  })

  // ═══════════════════════════════════════
  // 10. CREATE APPOINTMENT
  // ═══════════════════════════════════════

  await toolRegistry.registerTool({
    definition: {
      name: 'medilink-create-appointment',
      displayName: 'Agendar cita',
      description: 'Agenda una nueva cita. Requiere profesional, prestación, fecha y hora. Re-verifica disponibilidad automáticamente si el cache tiene más de 20 minutos. Para pacientes nuevos (leads) usa la prestación por defecto.',
      category: 'medilink',
      sourceModule: 'medilink',
      parameters: {
        type: 'object',
        properties: {
          professional_name: { type: 'string', description: 'Nombre del profesional (opcional para leads — el sistema asigna el predeterminado automáticamente)' },
          treatment_name: { type: 'string', description: 'Nombre de la prestación (para leads, el sistema usa la default automáticamente)' },
          date: { type: 'string', description: 'Fecha (YYYY-MM-DD)' },
          time: { type: 'string', description: 'Hora (HH:MM)' },
          context_summary: { type: 'string', description: 'Resumen breve del contexto del paciente para el profesional: motivo de consulta, datos relevantes mencionados en la conversación (síntomas, antecedentes, expectativas). Extraer de la conversación, NO preguntar al paciente por esto.' },
          dependent_patient_id: { type: 'number', description: 'ID Medilink del dependiente/tercero. Si se especifica, la cita se agenda para ese tercero en vez del contacto principal. El tercero debe estar previamente registrado con medilink-register-dependent.' },
        },
        required: ['date', 'time'],
      },
    },
    handler: async (input, ctx) => {
      if (!ctx.contactId) return { success: false, error: 'No contact ID' }

      let secCtx = await security.resolveContext(ctx.contactId)
      secCtx = await security.tryAutoLink(secCtx)

      const access = security.canAccess(secCtx, 'appointments')
      if (!access.allowed) {
        return { success: false, error: 'Necesito buscarte en el sistema para agendar, con los datos que tengo no te encuentro' }
      }

      try {
        const ref = await cache.getReferenceData()
        const config = registry.getConfig<{
          MEDILINK_DEFAULT_STATUS_ID: string
          MEDILINK_DEFAULT_DURATION_MIN: number
          MEDILINK_DEFAULT_BRANCH_ID: string
        }>('medilink')

        // Resolve treatment — for leads/new patients, use default valoración
        let treatment = input.treatment_name ? cache.findTreatmentByName(input.treatment_name as string) : null

        // Resolve professional — for leads, fall back to MEDILINK_DEFAULT_PROFESSIONAL_ID
        let prof = input.professional_name ? cache.findProfessionalByName(input.professional_name as string) : null
        if (!prof) {
          const defaultProfRow = await registry.getDb().query(
            `SELECT value FROM config_store WHERE key = 'MEDILINK_DEFAULT_PROFESSIONAL_ID'`,
          )
          const defaultProfId = parseInt(defaultProfRow.rows[0]?.value ?? '0', 10)
          if (defaultProfId) prof = ref.professionals.find(p => p.id === defaultProfId) ?? null
        }
        if (!prof) return { success: false, error: `No se pudo determinar el profesional. Especifica el nombre o configura MEDILINK_DEFAULT_PROFESSIONAL_ID.` }

        if (!treatment) {
          // Use default valoración treatment from config_store
          const defaultValId = await registry.getDb().query(
            `SELECT value FROM config_store WHERE key = 'MEDILINK_DEFAULT_VALORACION_ID'`,
          )
          const valId = parseInt(defaultValId.rows[0]?.value ?? '13', 10)  // 13 = "Valoración - Otros" default
          treatment = (ref.treatments ?? []).find(t => t.id === valId) ?? null
        }

        if (!treatment) return { success: false, error: 'No se pudo determinar la prestación. Especifica el tipo de tratamiento.' }

        // Check category-based scheduling rules
        const prestacion = (ref.prestaciones ?? []).find(p => p.id === treatment!.id)
        if (prestacion) {
          const catAssignments = await pgStore.getProfessionalCategoryAssignments(registry.getDb())
          if (catAssignments.length > 0) {
            const allowed = catAssignments.some(a =>
              a.medilinkProfessionalId === prof.id && a.medilinkCategoryId === prestacion.id_categoria,
            )
            if (!allowed) {
              return { success: false, error: `El profesional ${prof.nombre} ${prof.apellidos} no realiza prestaciones de la categoría ${prestacion.nombre_categoria}` }
            }
          }
        }

        // Resolve branch
        const defaultBranch = cache.getDefaultBranch()
        if (!defaultBranch) return { success: false, error: 'No hay sucursal configurada' }

        // Re-verify availability (cache handles TTL — force refresh if stale)
        const freshSlots = await cache.getAvailability(defaultBranch.id, input.date as string, prof.id)
        const requestedTime = input.time as string
        const matchingSlot = freshSlots.find(s => s.time === requestedTime && s.professionalId === prof.id)
        if (!matchingSlot) {
          return { success: false, error: `El horario ${requestedTime} del ${input.date} ya no está disponible con ${prof.nombre} ${prof.apellidos}. Consulta disponibilidad de nuevo.` }
        }

        // Use the slot's id_recurso as id_sillon — comes from agenda availability data
        const chairId = parseInt(matchingSlot.chairId, 10)
        if (!chairId) return { success: false, error: 'No se pudo determinar el sillón del slot disponible' }

        const statusId = parseInt(config.MEDILINK_DEFAULT_STATUS_ID, 10) || 7  // 7 = "No confirmado" (default)

        // Resolve target patient: dependent or self
        let targetPatientId: number
        let dep: MedilinkDependent | undefined
        if (input.dependent_patient_id) {
          dep = secCtx.dependents.find(d => d.medilinkPatientId === (input.dependent_patient_id as number))
          if (!dep) {
            return { success: false, error: 'El tercero indicado no está registrado para este contacto. Regístralo primero con medilink-register-dependent.' }
          }
          targetPatientId = dep.medilinkPatientId
        } else {
          targetPatientId = secCtx.medilinkPatientId!
        }

        const baseComment = input.context_summary as string | undefined
        const comentario = dep
          ? `Para ${dep.displayName} (${dep.relationship}). ${baseComment ?? ''}`.trim()
          : baseComment

        const appointment = await api.createAppointment({
          id_dentista: prof.id,
          id_sucursal: defaultBranch.id,
          id_estado: statusId,
          id_sillon: chairId,
          id_paciente: targetPatientId,
          id_tratamiento: treatment.id,
          fecha: input.date as string,
          hora_inicio: requestedTime,
          duracion: config.MEDILINK_DEFAULT_DURATION_MIN,
          comentario,
        })

        // Invalidate availability cache
        await cache.invalidateAvailability(defaultBranch.id, prof.id)

        // Store appointment ID in working memory for potential reschedule
        if (ctx.contactId) {
          await wmem.set(ctx.contactId, ML.PENDING_RESCHEDULE_ID, appointment.id)
          await wmem.set(ctx.contactId, ML.LAST_APPOINTMENT_ID, appointment.id)
        }

        // Persist branch preference on contact for future proactive suggestions
        ctx.db.query(
          `UPDATE contacts SET custom_data = custom_data || $1::jsonb, updated_at = now() WHERE id = $2`,
          [JSON.stringify({
            medilink_preferred_branch_id: appointment.id_sucursal,
            medilink_preferred_branch_name: appointment.nombre_sucursal,
          }), ctx.contactId],
        ).catch(err => logger.warn({ err }, 'Failed to persist branch preference'))

        // Schedule follow-ups
        const followupScheduler = registry.getOptional<{
          scheduleSequence(params: {
            appointmentId: string; contactId: string
            appointment: { fecha: string; hora_inicio: string; nombre_paciente: string; nombre_profesional: string; nombre_tratamiento: string; nombre_sucursal: string }
          }): Promise<void>
        }>('medilink:followup')

        if (followupScheduler) {
          await followupScheduler.scheduleSequence({
            appointmentId: String(appointment.id),
            contactId: ctx.contactId,
            appointment: {
              fecha: appointment.fecha,
              hora_inicio: appointment.hora_inicio,
              nombre_paciente: appointment.nombre_paciente,
              nombre_profesional: appointment.nombre_dentista,
              nombre_tratamiento: appointment.nombre_tratamiento,
              nombre_sucursal: appointment.nombre_sucursal,
            },
          }).catch(err => logger.warn({ err, appointmentId: appointment.id }, 'Failed to schedule follow-ups'))
        }

        await pgStore.logAudit(ctx.db, {
          contactId: ctx.contactId,
          medilinkPatientId: String(secCtx.medilinkPatientId),
          action: 'create_appointment', targetType: 'appointment', targetId: String(appointment.id),
          detail: {
            professional: `${prof.nombre} ${prof.apellidos}`,
            treatment: treatment.nombre,
            date: input.date, time: requestedTime,
            branch: appointment.nombre_sucursal,
            ...(dep ? { dependentPatientId: dep.medilinkPatientId, dependentName: dep.displayName, relationship: dep.relationship } : {}),
          },
          verificationLevel: secCtx.verificationLevel,
          result: 'success',
        })

        return {
          success: true,
          data: {
            id: appointment.id,
            id_atencion: appointment.id_atencion ?? null,
            fecha: appointment.fecha,
            hora: appointment.hora_inicio,
            profesional: appointment.nombre_dentista,
            tratamiento: appointment.nombre_tratamiento,
            sucursal: appointment.nombre_sucursal,
            comentarios: appointment.comentarios,
            mensaje: 'Cita agendada exitosamente',
          },
        }
      } catch (err) {
        logger.error({ err }, 'create-appointment failed')
        return { success: false, error: 'Error al agendar cita: ' + medilinkErrorDetail(err) }
      }
    },
  })

  // ═══════════════════════════════════════
  // 11. RESCHEDULE APPOINTMENT
  // ═══════════════════════════════════════

  await toolRegistry.registerTool({
    definition: {
      name: 'medilink-reschedule-appointment',
      displayName: 'Reagendar cita',
      description: 'Reagenda una cita existente. Crea una cita nueva en la fecha/hora deseada y marca la vieja como "Reagendado por LUNA". Prefiere el mismo profesional pero permite otros con las mismas categorías.',
      category: 'medilink',
      sourceModule: 'medilink',
      parameters: {
        type: 'object',
        properties: {
          appointment_id: { type: 'number', description: 'ID de la cita a reagendar (opcional — el sistema lo obtiene de la memoria de trabajo si no se especifica)' },
          new_date: { type: 'string', description: 'Nueva fecha (YYYY-MM-DD)' },
          new_time: { type: 'string', description: 'Nueva hora (HH:MM)' },
          new_professional_name: { type: 'string', description: 'Nuevo profesional (opcional, mantiene el mismo si no se especifica)' },
          reschedule_reason: { type: 'string', description: 'Motivo del reagendamiento SOLO si el paciente lo mencionó voluntariamente. NO preguntar directamente por el motivo.' },
        },
        required: ['new_date', 'new_time'],
      },
    },
    handler: async (input, ctx) => {
      if (!ctx.contactId) return { success: false, error: 'No contact ID' }

      let secCtx = await security.resolveContext(ctx.contactId)
      secCtx = await security.tryAutoLink(secCtx)

      const access = security.canAccess(secCtx, 'appointments')
      if (!access.allowed) {
        return { success: false, error: 'Necesito primero verificar los datos en el sistema' }
      }

      try {
        const config = registry.getConfig<{
          MEDILINK_DEFAULT_STATUS_ID: string
          MEDILINK_DEFAULT_DURATION_MIN: number
          MEDILINK_DEFAULT_BRANCH_ID: string
        }>('medilink')

        // ── 1. Resolve the original appointment ──
        let appointmentId = input.appointment_id as number | undefined
        if (!appointmentId && ctx.contactId) {
          const pending = await wmem.get<number>(ctx.contactId, ML.PENDING_RESCHEDULE_ID)
          if (pending) appointmentId = pending
        }
        if (!appointmentId) return { success: false, error: '¿Qué cita quieres reagendar?' }

        const existing = await api.getAppointment(appointmentId, 'high')

        // Verify ownership — contact or any of their registered dependents
        if (!security.ownsOrDependentAppointment(secCtx, existing)) {
          await pgStore.logAudit(ctx.db, {
            contactId: ctx.contactId,
            action: 'reschedule_appointment', targetType: 'appointment',
            targetId: String(appointmentId),
            detail: { reason: 'not_owner' },
            verificationLevel: secCtx.verificationLevel,
            result: 'denied',
          })
          return {
            success: false,
            error: 'No puedo reagendar esta cita',
            hitl_required: true,
            hitl_summary: 'Paciente intenta reagendar una cita que no le pertenece',
          }
        }

        // ── 2. Resolve professional (allow change with category validation) ──
        let newProfId = existing.id_dentista
        if (input.new_professional_name) {
          const newProf = cache.findProfessionalByName(input.new_professional_name as string)
          if (!newProf) return { success: false, error: `No se encontró al profesional "${input.new_professional_name}"` }

          const catAssignments = await pgStore.getProfessionalCategoryAssignments(ctx.db)
          if (catAssignments.length > 0) {
            const origCats = new Set(catAssignments.filter(a => a.medilinkProfessionalId === existing.id_dentista).map(a => a.medilinkCategoryId))
            const newCats = new Set(catAssignments.filter(a => a.medilinkProfessionalId === newProf.id).map(a => a.medilinkCategoryId))
            const origHasAll = [...origCats].every(c => newCats.has(c))
            if (!origHasAll) {
              return { success: false, error: `El profesional ${newProf.nombre} ${newProf.apellidos} no tiene las mismas categorías habilitadas que el profesional original` }
            }
          }
          newProfId = newProf.id
        }

        // ── 3. Resolve id_atencion: from existing appointment or working memory snapshot ──
        let idAtencion: number | undefined
        if (existing.id_atencion) {
          idAtencion = existing.id_atencion
        } else {
          // Try working memory snapshot (v1 GET may not return id_atencion but snapshot may have it)
          const snapshots = await wmem.get<AppointmentSnapshot[]>(ctx.contactId, ML.APPOINTMENTS)
          const snap = snapshots?.find(s => s.id === existing.id)
          if (snap?.idAtencion) idAtencion = snap.idAtencion
        }

        // ── 4. Create NEW appointment with the desired date/time ──
        const reasonStr = input.reschedule_reason ? ` Motivo: ${input.reschedule_reason}` : ''
        const comment = `Reagendamiento — cita original #${existing.id}: ${existing.fecha} ${existing.hora_inicio} con ${existing.nombre_dentista}.${reasonStr}`

        const statusId = parseInt(config.MEDILINK_DEFAULT_STATUS_ID, 10) || 7
        const createData: import('./types.js').MedilinkAppointmentCreate = {
          id_dentista: newProfId,
          id_sucursal: existing.id_sucursal,
          id_estado: statusId,
          id_sillon: existing.id_sillon,
          id_paciente: existing.id_paciente,
          id_tratamiento: existing.id_tratamiento,
          fecha: input.new_date as string,
          hora_inicio: input.new_time as string,
          duracion: existing.duracion,
          comentario: comment,
        }
        // Include id_atencion to link new appointment with the treatment plan
        if (idAtencion) createData.id_atencion = idAtencion

        const newAppointment = await api.createAppointment(createData)

        // ── 5. Mark OLD appointment as "Reagendado por LUNA" (id_estado=21) ──
        const RESCHEDULE_STATUS_ID = 21
        await api.updateAppointment(existing.id, { id_estado: RESCHEDULE_STATUS_ID })

        // ── 6. Post-actions: follow-ups, cache, working memory ──
        await pgStore.cancelFollowUpsForAppointment(ctx.db, String(existing.id))

        const followupScheduler = registry.getOptional<{
          scheduleSequence(params: {
            appointmentId: string; contactId: string
            appointment: { fecha: string; hora_inicio: string; nombre_paciente: string; nombre_profesional: string; nombre_tratamiento: string; nombre_sucursal: string }
          }): Promise<void>
        }>('medilink:followup')

        if (followupScheduler) {
          await followupScheduler.scheduleSequence({
            appointmentId: String(newAppointment.id),
            contactId: ctx.contactId,
            appointment: {
              fecha: newAppointment.fecha,
              hora_inicio: newAppointment.hora_inicio,
              nombre_paciente: newAppointment.nombre_paciente,
              nombre_profesional: newAppointment.nombre_dentista,
              nombre_tratamiento: newAppointment.nombre_tratamiento,
              nombre_sucursal: newAppointment.nombre_sucursal,
            },
          }).catch(err => logger.warn({ err, appointmentId: newAppointment.id }, 'Failed to schedule follow-ups for rescheduled appointment'))
        }

        await cache.invalidateAvailability()

        if (ctx.contactId) {
          await wmem.set(ctx.contactId, ML.PENDING_RESCHEDULE_ID, newAppointment.id)
          await wmem.set(ctx.contactId, ML.LAST_APPOINTMENT_ID, newAppointment.id)
        }

        ctx.db.query(
          `UPDATE contacts SET custom_data = custom_data || $1::jsonb, updated_at = now() WHERE id = $2`,
          [JSON.stringify({
            medilink_preferred_branch_id: newAppointment.id_sucursal,
            medilink_preferred_branch_name: newAppointment.nombre_sucursal,
          }), ctx.contactId],
        ).catch(err => logger.warn({ err }, 'Failed to persist branch preference'))

        await pgStore.logAudit(ctx.db, {
          contactId: ctx.contactId,
          medilinkPatientId: String(secCtx.medilinkPatientId),
          action: 'reschedule_appointment', targetType: 'appointment', targetId: String(existing.id),
          detail: {
            oldAppointmentId: existing.id, newAppointmentId: newAppointment.id,
            oldDate: existing.fecha, oldTime: existing.hora_inicio,
            newDate: input.new_date, newTime: input.new_time,
            professionalChanged: newProfId !== existing.id_dentista,
            idAtencion: idAtencion ?? null,
            rescheduleReason: input.reschedule_reason ?? null,
            branch: newAppointment.nombre_sucursal,
          },
          verificationLevel: secCtx.verificationLevel,
          result: 'success',
        })

        return {
          success: true,
          data: {
            id: newAppointment.id,
            old_appointment_id: existing.id,
            id_atencion: newAppointment.id_atencion ?? null,
            fecha: newAppointment.fecha,
            hora: newAppointment.hora_inicio,
            profesional: newAppointment.nombre_dentista,
            tratamiento: newAppointment.nombre_tratamiento,
            sucursal: newAppointment.nombre_sucursal,
            comentarios: newAppointment.comentarios,
            mensaje: `Cita reagendada al ${newAppointment.fecha} a las ${newAppointment.hora_inicio} con ${newAppointment.nombre_dentista}. La cita anterior fue marcada como reagendada.`,
          },
        }
      } catch (err) {
        logger.error({ err }, 'reschedule-appointment failed')
        return { success: false, error: 'Error al reagendar cita: ' + medilinkErrorDetail(err) }
      }
    },
  })

  // ═══════════════════════════════════════
  // 12. MARK PENDING RESCHEDULE
  // ═══════════════════════════════════════

  await toolRegistry.registerTool({
    definition: {
      name: 'medilink-mark-pending-reschedule',
      displayName: 'Marcar cita pendiente de reagendar',
      description: 'Marca una cita como "Pendiente reagendar" cuando el paciente quiere reagendar pero no define una nueva fecha/hora. Cambia el estado de la cita y crea un compromiso automático de seguimiento en 4 días.',
      category: 'medilink',
      sourceModule: 'medilink',
      parameters: {
        type: 'object',
        properties: {
          appointment_id: { type: 'number', description: 'ID de la cita (opcional — el sistema lo obtiene de la memoria de trabajo si no se especifica)' },
          reason: { type: 'string', description: 'Motivo o contexto de por qué no se pudo definir nueva fecha. Ej: "El paciente necesita consultar su agenda", "Prefiere esperar resultados antes de reagendar"' },
        },
      },
    },
    handler: async (input, ctx) => {
      if (!ctx.contactId) return { success: false, error: 'No contact ID' }

      let secCtx = await security.resolveContext(ctx.contactId)
      secCtx = await security.tryAutoLink(secCtx)

      const access = security.canAccess(secCtx, 'appointments')
      if (!access.allowed) {
        return { success: false, error: 'Necesito primero verificar los datos en el sistema' }
      }

      try {
        // ── 1. Resolve the appointment ──
        let appointmentId = input.appointment_id as number | undefined
        if (!appointmentId && ctx.contactId) {
          const pending = await wmem.get<number>(ctx.contactId, ML.PENDING_RESCHEDULE_ID)
          if (pending) appointmentId = pending
        }
        if (!appointmentId) return { success: false, error: '¿Qué cita quieres marcar como pendiente?' }

        const existing = await api.getAppointment(appointmentId, 'high')

        // Verify ownership
        if (!security.ownsAppointment(secCtx, existing)) {
          await pgStore.logAudit(ctx.db, {
            contactId: ctx.contactId,
            action: 'mark_pending_reschedule', targetType: 'appointment',
            targetId: String(appointmentId),
            detail: { reason: 'not_owner' },
            verificationLevel: secCtx.verificationLevel,
            result: 'denied',
          })
          return { success: false, error: 'No puedo modificar esta cita' }
        }

        // ── 2. Mark as "Pendiente reagendar" (id_estado=16) ──
        const PENDING_RESCHEDULE_STATUS_ID = 16
        const reasonStr = input.reason ? String(input.reason) : 'Paciente solicitó reagendar pero no definió nueva fecha'
        const comment = `Pendiente reagendar — ${reasonStr}. Fecha original: ${existing.fecha} ${existing.hora_inicio} con ${existing.nombre_dentista}.`

        await api.updateAppointment(existing.id, {
          id_estado: PENDING_RESCHEDULE_STATUS_ID,
          comentario: comment,
        })

        // ── 3. Create follow-up commitment (4 days = 96 hours) ──
        let commitmentId: string | null = null
        const FOLLOW_UP_HOURS = 96

        const memMgr = registry.getOptional<{
          saveCommitment(c: Record<string, unknown>): Promise<string>
        }>('memory:manager')

        if (memMgr) {
          const dueAt = new Date(Date.now() + FOLLOW_UP_HOURS * 60 * 60 * 1000)
          const autoCancelAt = new Date(dueAt.getTime() + 168 * 60 * 60 * 1000) // +7 days after due
          try {
            commitmentId = await memMgr.saveCommitment({
              contactId: ctx.contactId,
              sessionId: null,
              commitmentBy: 'agent',
              description: `Seguimiento de reagendamiento — cita #${existing.id} (${existing.nombre_tratamiento} con ${existing.nombre_dentista}). Contactar al paciente para definir nueva fecha.`,
              category: 'reschedule_follow_up',
              priority: 'normal',
              commitmentType: 'follow_up',
              dueAt,
              scheduledAt: null,
              eventStartsAt: null,
              eventEndsAt: null,
              externalId: String(existing.id),
              externalProvider: 'medilink',
              assignedTo: null,
              status: 'pending',
              attemptCount: 0,
              lastAttemptAt: null,
              nextCheckAt: dueAt,
              blockedReason: null,
              waitType: null,
              actionTaken: null,
              parentId: null,
              sortOrder: 0,
              watchMetadata: null,
              reminderSent: false,
              requiresTool: null,
              autoCancelAt,
              createdVia: 'tool',
              metadata: {
                appointmentId: existing.id,
                originalDate: existing.fecha,
                originalTime: existing.hora_inicio,
                professionalName: existing.nombre_dentista,
                treatmentName: existing.nombre_tratamiento,
                reason: reasonStr,
              },
            })
            logger.info({ commitmentId, appointmentId: existing.id, contactId: ctx.contactId }, 'Reschedule follow-up commitment created')
          } catch (err) {
            logger.warn({ err, appointmentId: existing.id }, 'Failed to create reschedule follow-up commitment')
          }
        }

        // ── 4. Audit trail ──
        await pgStore.logAudit(ctx.db, {
          contactId: ctx.contactId,
          medilinkPatientId: String(secCtx.medilinkPatientId),
          action: 'mark_pending_reschedule', targetType: 'appointment', targetId: String(existing.id),
          detail: {
            appointmentId: existing.id,
            previousStatus: existing.estado_cita,
            newStatus: 'Pendiente reagendar',
            newStatusId: PENDING_RESCHEDULE_STATUS_ID,
            reason: reasonStr,
            commitmentId,
            commitmentDueHours: FOLLOW_UP_HOURS,
          },
          verificationLevel: secCtx.verificationLevel,
          result: 'success',
        })

        return {
          success: true,
          data: {
            appointment_id: existing.id,
            status: 'Pendiente reagendar',
            reason: reasonStr,
            follow_up_commitment_id: commitmentId,
            follow_up_in_days: Math.round(FOLLOW_UP_HOURS / 24),
            mensaje: `La cita del ${existing.fecha} fue marcada como pendiente de reagendar. Se creó un recordatorio automático para hacer seguimiento en ${Math.round(FOLLOW_UP_HOURS / 24)} días.`,
          },
        }
      } catch (err) {
        logger.error({ err }, 'mark-pending-reschedule failed')
        return { success: false, error: 'Error al marcar cita como pendiente: ' + medilinkErrorDetail(err) }
      }
    },
  })

  // ═══════════════════════════════════════
  // 13. LIST DEPENDENTS
  // ═══════════════════════════════════════

  await toolRegistry.registerTool({
    definition: {
      name: 'medilink-list-dependents',
      displayName: 'Listar terceros/dependientes',
      description: 'Lista los terceros (hijos, padres, pareja, etc.) registrados bajo este contacto para agendar citas. Devuelve nombre, relación e ID Medilink de cada uno.',
      category: 'medilink',
      sourceModule: 'medilink',
      parameters: {
        type: 'object',
        properties: {},
      },
    },
    handler: async (_input, ctx) => {
      if (!ctx.contactId) return { success: false, error: 'No contact ID' }

      const secCtx = await security.resolveContext(ctx.contactId)

      if (secCtx.dependents.length === 0) {
        return {
          success: true,
          data: { dependents: [], message: 'No tienes terceros registrados' },
        }
      }

      const list = secCtx.dependents.map(d => ({
        medilinkPatientId: d.medilinkPatientId,
        displayName: d.displayName,
        relationship: d.relationship,
        documentType: d.documentType,
        registeredAt: d.registeredAt,
      }))

      const summary = list.map(d => `${d.displayName} (${d.relationship}, ID: ${d.medilinkPatientId})`).join(', ')

      return {
        success: true,
        data: { dependents: list, summary },
      }
    },
  })

  // ═══════════════════════════════════════
  // 14. REGISTER DEPENDENT
  // ═══════════════════════════════════════

  await toolRegistry.registerTool({
    definition: {
      name: 'medilink-register-dependent',
      displayName: 'Registrar tercero/dependiente',
      description: 'Registra un tercero (hijo, madre, pareja, etc.) bajo el contacto para poder agendar citas en su nombre. Busca al paciente en Medilink por documento; si no existe, lo crea.',
      category: 'medilink',
      sourceModule: 'medilink',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Nombre(s) del tercero' },
          last_name: { type: 'string', description: 'Apellidos del tercero' },
          relationship: { type: 'string', description: 'Relación con el contacto: hijo, hija, mama, papa, esposo, esposa, hermano, hermana, abuelo, abuela, otro' },
          document_type: { type: 'string', description: 'Tipo de documento: RUT, CI, Pasaporte, Tarjeta de Identidad, CE' },
          document_number: { type: 'string', description: 'Número de documento (sin puntos ni guiones)' },
        },
        required: ['name', 'last_name', 'relationship', 'document_type', 'document_number'],
      },
    },
    handler: async (input, ctx) => {
      if (!ctx.contactId) return { success: false, error: 'No contact ID' }

      const secCtx = await security.resolveContext(ctx.contactId)

      // Contact must be at least phone_matched to register dependents
      if (secCtx.verificationLevel === 'unverified') {
        return { success: false, error: 'Necesito verificar tu identidad antes de registrar un familiar. Proporciona tu número de documento.' }
      }

      const docNumber = (input.document_number as string).replace(/[.\-\s]/g, '')
      const name = input.name as string
      const lastName = input.last_name as string
      const relationship = (input.relationship as string).toLowerCase()
      const documentType = input.document_type as string

      try {
        let medilinkPatientId: number

        // Search patient in Medilink by document
        const found = await api.findPatientByDocument(docNumber)

        if (found.length > 0) {
          const patient = found[0]!
          medilinkPatientId = patient.id
          logger.info({ contactId: ctx.contactId, medilinkPatientId, relationship }, 'Dependent found in Medilink')
        } else {
          // Create new patient in Medilink
          const created = await api.createPatient({
            nombre: name,
            apellidos: lastName,
            rut: documentType === 'RUT' ? docNumber : undefined,
            tipo_documento: documentType === 'RUT' ? 0 : 1,
            observaciones: `Documento: ${documentType} ${docNumber}`,
          })
          medilinkPatientId = created.id
          logger.info({ contactId: ctx.contactId, medilinkPatientId, relationship }, 'Dependent created in Medilink')
        }

        const dep: MedilinkDependent = {
          medilinkPatientId,
          displayName: name,
          relationship,
          documentNumber: docNumber,
          documentType,
          registeredAt: new Date().toISOString(),
        }

        await security.addDependent(ctx.contactId, dep)

        await pgStore.logAudit(ctx.db, {
          contactId: ctx.contactId,
          medilinkPatientId: String(secCtx.medilinkPatientId),
          action: 'create_patient',
          targetType: 'dependent',
          targetId: String(medilinkPatientId),
          detail: { relationship, dependentPatientId: medilinkPatientId, displayName: name },
          verificationLevel: secCtx.verificationLevel,
          result: 'success',
        })

        return {
          success: true,
          data: {
            medilinkPatientId,
            displayName: name,
            relationship,
            message: `${name} (${relationship}) registrado exitosamente. Ya puedes agendar citas para ${name} usando dependent_patient_id: ${medilinkPatientId}`,
          },
        }
      } catch (err) {
        logger.error({ err, contactId: ctx.contactId }, 'register-dependent failed')
        return { success: false, error: 'Error al registrar tercero: ' + medilinkErrorDetail(err) }
      }
    },
  })

  logger.info('14 Medilink tools registered')
}
