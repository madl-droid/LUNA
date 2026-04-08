// LUNA — Module: medilink
// Types for Medilink (Dentalink/HealthAtom) API integration

// ─── Config ──────────────────────────────

export interface MedilinkConfig {
  MEDILINK_API_TOKEN: string
  MEDILINK_BASE_URL: string
  MEDILINK_WEBHOOK_PUBLIC_KEY: string
  MEDILINK_WEBHOOK_PRIVATE_KEY: string
  MEDILINK_RATE_LIMIT_RPM: number
  MEDILINK_API_TIMEOUT_MS: number
  MEDILINK_AVAILABILITY_CACHE_TTL_MS: number
  MEDILINK_REFERENCE_REFRESH_DAYS: number
  MEDILINK_DEFAULT_BRANCH_ID: string
  MEDILINK_DEFAULT_DURATION_MIN: number
  MEDILINK_DEFAULT_STATUS_ID: string
  MEDILINK_FOLLOWUP_ENABLED: boolean
  MEDILINK_FOLLOWUP_TOUCH1_DAYS_BEFORE: number
  MEDILINK_FOLLOWUP_FALLBACK_A_HOURS: number
  MEDILINK_FOLLOWUP_FALLBACK_B_DAYS_BEFORE: number
  MEDILINK_FOLLOWUP_TOUCH3_HOURS_BEFORE: number
  MEDILINK_FOLLOWUP_TOUCH4_HOURS_BEFORE: number
  MEDILINK_FOLLOWUP_NOSHOW_HOURS_AFTER: number
  MEDILINK_FOLLOWUP_REACTIVATION_DAYS: number
  MEDILINK_REQUIRE_DOCUMENT_FOR_DEBTS: boolean
  MEDILINK_AUTO_LINK_SINGLE_MATCH: boolean
  MEDILINK_HEALTH_CHECK_INTERVAL_MS: number
  // FIX: ML-1 — Public URL for voice call webhooks
  MEDILINK_PUBLIC_URL: string
  MEDILINK_ALLOWED_CHAIRS: string
}

// ─── API response envelope ───────────────

export interface MedilinkCursor {
  current: string
  next: string | null
  prev: string | null
}

export interface MedilinkResponse<T> {
  links: MedilinkCursor | null
  data: T
}

// ─── Paciente (Patient) ──────────────────

export interface MedilinkPatient {
  id: number
  rut: string | null
  /** API uses 'nombre' (singular), not 'nombres' */
  nombre: string
  apellidos: string
  nombre_social: string | null
  fecha_nacimiento: string | null
  /** API field: 'sexo' (string) — not 'genero' */
  sexo: string | null
  telefono: string | null
  celular: string | null
  email: string | null
  direccion: string | null
  ciudad: string | null
  comuna: string | null
  observaciones: string | null
  tipo_documento: string | null
  numero_ficha: string | null
  habilitado: boolean
  links?: { self: string }
}

export interface MedilinkPatientCreate {
  rut?: string
  /** 0 = RUT chileno (con validación), 1 = documento genérico (cédula, CE, pasaporte) */
  tipo_documento?: number
  /** API field: 'nombre' (singular) */
  nombre: string
  apellidos: string
  nombre_social?: string
  fecha_nacimiento?: string
  sexo?: string
  telefono?: string
  celular?: string
  email?: string
  direccion?: string
  ciudad?: string
  comuna?: string
  observaciones?: string
}

export interface MedilinkPatientUpdate {
  /** API field: 'nombre' (singular) */
  nombre?: string
  apellidos?: string
  nombre_social?: string
  fecha_nacimiento?: string
  sexo?: string
  telefono?: string
  celular?: string
  email?: string
  direccion?: string
  ciudad?: string
  comuna?: string
  observaciones?: string
}

// ─── Cita (Appointment) ──────────────────

export interface MedilinkAppointment {
  id: number
  id_paciente: number
  nombre_paciente: string
  nombre_social_paciente: string | null
  id_estado: number
  estado_cita: string
  /** Plan de tratamiento al que pertenece la cita (HealthAtom lo llama "atención") */
  id_atencion: number | null
  id_tratamiento: number
  nombre_tratamiento: string
  fecha: string
  hora_inicio: string
  hora_fin: string
  duracion: number
  /** API uses 'id_dentista', not 'id_profesional' */
  id_dentista: number
  nombre_dentista: string
  id_sucursal: number
  nombre_sucursal: string
  id_sillon: number
  nombre_sillon: string | null
  comentarios: string | null
  motivo_atencion: string | null
  links?: { self: string }
}

export interface MedilinkAppointmentCreate {
  /** API uses 'id_dentista', not 'id_profesional' */
  id_dentista: number
  id_sucursal: number
  id_estado: number
  id_sillon: number
  id_paciente: number
  id_tratamiento: number
  fecha: string
  hora_inicio: string
  duracion: number
  comentario?: string
  /** Vincula con atención/plan de tratamiento existente (obligatorio si se conoce) */
  id_atencion?: number
}

export interface MedilinkAppointmentUpdate {
  id_estado?: number
  duracion?: number
  /** API PUT accepts 'comentario' (singular) — GET returns 'comentarios' (plural) */
  comentario?: string
  fecha?: string
  hora_inicio?: string
  /** API uses 'id_dentista', not 'id_profesional' */
  id_dentista?: number
  id_sillon?: number
}

// ─── Profesional (Professional) ──────────

export interface MedilinkProfessional {
  id: number
  rut: string | null
  nombre: string
  apellidos: string
  celular: string | null
  telefono: string | null
  email: string | null
  id_especialidad: number | null
  especialidad: string | null
  agenda_online: boolean
  intervalo: number | null
  habilitado: boolean
  links?: { self: string }
}

// ─── Sucursal (Branch) ───────────────────

export interface MedilinkBranch {
  id: number
  nombre: string
  direccion: string | null
  ciudad: string | null
  telefono: string | null
  email: string | null
  links?: { self: string }
}

// ─── Sillon (Chair) ──────────────────────

export interface MedilinkChair {
  id: number
  nombre: string
  /** Note: /sillones API does NOT return id_sucursal or nombre_sucursal */
  links?: { self: string }
}

// ─── Tratamiento / Atencion (Treatment) ──

export interface MedilinkTreatment {
  id: number
  nombre: string
  /** Note: /tratamientos API does NOT return duracion or precio in list response */
  links?: { self: string }
}

// ─── Prestacion (Service catalog from /prestaciones) ─
export interface MedilinkPrestacion {
  id: number
  nombre: string
  id_categoria: number
  nombre_categoria: string
  habilitado: boolean
  codigo: string | null
}

/** Unique category derived from /prestaciones */
export interface MedilinkCategory {
  id: number
  nombre: string
}

// ─── Archivo de paciente ─────────────────

export interface MedilinkPatientArchive {
  id: number
  nombre: string
  titulo: string | null
  observaciones: string | null
  fecha_creacion: string
  id_paciente: number
  id_tratamiento: number
  estado: number
  fecha_eliminacion: string | null
  /** Signed S3 URLs — expire after ~1 hour. Use urls.original to download. */
  urls: {
    original: string
    med?: string
    tmb?: string
  }
}

// ─── Campos adicionales (solo /api/v1) ──

export interface MedilinkAdditionalField {
  nombre: string
  codigo: string
  tipo: string
  tipo_interno: string
  valor: unknown
  fecha_asociado: string | null
  id_usuario_asociador: number | null
}

// ─── Estado de Cita (Appointment Status) ─

export interface MedilinkAppointmentStatus {
  id: number
  nombre: string
  color: string | null
  /** 1 = cancellation/annulment state, 0 = active state */
  anulacion: number
  reservado: number | null
  links?: { self: string }
}

// ─── Atencion / Plan de tratamiento ─────

export interface MedilinkTreatmentPlan {
  id: number
  nombre: string
  id_tipo: number
  nombre_tipo: string
  fecha: string
  finalizado: boolean
  bloqueado: boolean
  id_paciente: number
  id_profesional: number
  id_sucursal: number
  total: number
  abonado: number
  abono_libre: number
  deuda: number
  asignado_realizado: number
  asignado_sin_realizar: number
  total_realizado: number
  links?: { self: string }
}

// ─── Evolucion (Evolution/Procedure) ─────

export interface MedilinkEvolution {
  id: number
  id_atencion: number
  nombre_atencion: string
  id_tratamiento: number
  nombre_tratamiento: string
  id_paciente: number
  nombre_paciente: string
  /** v1 uses 'id_dentista'; v5 uses 'id_profesional' */
  id_dentista: number
  nombre_dentista: string
  id_sucursal: number
  nombre_sucursal: string
  fecha: string
  fecha_registro: string | null
  /** SECURITY: clinical notes — NEVER expose to agent or patient */
  datos: string | null
  habilitado: boolean
}

// ─── Agenda / Disponibilidad ─────────────

/**
 * Single agenda item from /agendas.
 * Free slots have id_paciente === null.
 * Booked slots have id_paciente set.
 */
export interface MedilinkAgendaItem {
  id_paciente: number | null
  nombre_paciente: string | null
  hora_inicio: string
  hora_fin: string
  duracion: number
  /** API uses 'id_dentista', not 'id_profesional' */
  id_dentista: number
  nombre_dentista: string
  fecha: string
  id_recurso: number
  /** Only present for booked slots from v5 agenda */
  id_cita?: number
}

/** Raw agenda response is an array of MedilinkAgendaItem */
export type MedilinkAgendaRaw = MedilinkAgendaItem[]

// ─── V5 Agenda types ────────────────────

/** Detail for a booked slot in v5 hierarchical agenda response */
export interface V5AgendaSlotDetail {
  id_cita: number
  id_paciente: number
  nombre_paciente?: string
  apellidos_paciente?: string
  duracion_total: number
  fin?: string
}

/** V5 agenda response: data.fechas[date].horas[time].sillones[id] = true | detail */
export interface V5AgendaResponse {
  data: {
    fechas: Record<string, {
      horas: Record<string, {
        sillones: Record<string, true | V5AgendaSlotDetail>
      }>
    }>
  }
}

/** Cleaned/processed availability slot for agent consumption */
export interface AvailabilitySlot {
  date: string
  time: string
  professionalId: number
  professionalName: string
  branchId: number
  branchName: string
  chairId: string
  chairName: string
  durationMinutes: number
}

// ─── Filter system ───────────────────────

export type MedilinkFilter = Record<string, Record<string, string | number> | Array<Record<string, string | number>>>

// ─── Webhook ─────────────────────────────

export type WebhookAction = 'created' | 'modified' | 'deleted'

export type WebhookEntity =
  | 'cita' | 'paciente' | 'profesional' | 'contrato'
  | 'horario' | 'horario_bloqueado' | 'horario_especial'

export interface WebhookPayload {
  action: WebhookAction
  entity: WebhookEntity
  data: { id: number } & Record<string, unknown>
}

export interface WebhookLogEntry {
  id: string
  entity: WebhookEntity
  action: WebhookAction
  medilinkId: number
  payload: WebhookPayload
  signatureValid: boolean
  processed: boolean
  error: string | null
  receivedAt: Date
}

// ─── Audit log ───────────────────────────

export type AuditAction =
  | 'view_patient' | 'view_appointments' | 'view_payments'
  | 'view_evolutions' | 'view_treatment_plans' | 'search_patient'
  | 'create_patient' | 'create_appointment'
  | 'reschedule_appointment' | 'mark_pending_reschedule' | 'edit_request'
  | 'edit_approved' | 'edit_rejected'
  | 'identity_check' | 'access_denied'

export interface AuditEntry {
  id: string
  contactId: string
  medilinkPatientId: string | null
  action: AuditAction
  targetType: string
  targetId: string | null
  detail: Record<string, unknown>
  verificationLevel: VerificationLevel | null
  result: 'success' | 'denied' | 'pending' | 'error'
  createdAt: Date
}

// ─── Edit requests ───────────────────────

export type EditRequestStatus = 'pending' | 'approved' | 'rejected'

export interface EditRequest {
  id: string
  medilinkPatientId: string
  contactId: string
  requestedChanges: Record<string, { old: string | null; new: string }>
  reason: string | null
  status: EditRequestStatus
  reviewedBy: string | null
  reviewedAt: Date | null
  reviewNotes: string | null
  createdAt: Date
}

// ─── Follow-up ───────────────────────────

export type FollowUpTouchType =
  | 'touch_0' | 'touch_1'
  | 'touch_1_fallback_a' | 'touch_1_fallback_b'
  | 'touch_3' | 'touch_4'
  | 'no_show_1' | 'no_show_2'
  | 'reactivation'

export type FollowUpStatus = 'pending' | 'sent' | 'confirmed' | 'failed' | 'skipped'

export interface FollowUp {
  id: string
  medilinkAppointmentId: string
  contactId: string
  appointmentDate: Date
  touchType: FollowUpTouchType
  channel: 'whatsapp' | 'voice'
  status: FollowUpStatus
  scheduledAt: Date
  executedAt: Date | null
  response: string | null
  bullmqJobId: string | null
  metadata: Record<string, unknown>
  createdAt: Date
}

export interface FollowUpTemplate {
  id: string
  touchType: FollowUpTouchType
  templateText: string
  llmInstructions: string | null
  useLlm: boolean
  channel: 'whatsapp' | 'voice'
  voiceScript: string | null
  updatedAt: Date
}

// ─── Security ────────────────────────────

export type VerificationLevel = 'unverified' | 'phone_matched' | 'document_verified'

/** A third-party/dependent registered under a contact for scheduling purposes */
export interface MedilinkDependent {
  /** ID del paciente en Medilink */
  medilinkPatientId: number
  /** Nombre del tercero como lo conoce el contacto */
  displayName: string
  /** Relacion: hijo, hija, mama, papa, esposo/a, hermano/a, abuelo/a, otro */
  relationship: string
  /** Numero de documento del tercero (RUT, CI, etc.) */
  documentNumber?: string
  /** Tipo de documento */
  documentType?: string
  /** Fecha de registro */
  registeredAt: string
}

export interface SecurityContext {
  contactId: string
  contactPhone: string
  medilinkPatientId: number | null
  verificationLevel: VerificationLevel
  /** Dependientes/terceros registrados para este contacto */
  dependents: MedilinkDependent[]
  /** Si estamos agendando para un tercero, su patient ID */
  activeTargetPatientId: number | null
  /** Nombre del tercero activo */
  activeTargetName: string | null
  /** Relacion del tercero activo */
  activeTargetRelationship: string | null
}

// ─── Scheduling rules ────────────────────

export interface ProfessionalTreatmentRule {
  id: string
  medilinkProfessionalId: number
  medilinkTreatmentId: number
  professionalName: string
  treatmentName: string
  createdAt: Date
}

export interface UserTypeRule {
  id: string
  userType: string
  medilinkTreatmentId: number
  treatmentName: string
  allowed: boolean
  notes: string | null
  createdAt: Date
}

// ─── Professional categories (using Medilink native categories) ──

/** Many-to-many: which Medilink categories a professional is assigned to */
export interface ProfCategoryAssignment {
  medilinkProfessionalId: number
  medilinkCategoryId: number
  categoryName: string
}

// ─── Rate limiter ────────────────────────

export type RequestPriority = 'high' | 'medium' | 'low'

// ─── Reference data cache ────────────────

export interface ReferenceData {
  branches: MedilinkBranch[]
  professionals: MedilinkProfessional[]
  treatments: MedilinkTreatment[]
  /** Full service catalog from /prestaciones */
  prestaciones: MedilinkPrestacion[]
  /** Unique categories derived from prestaciones */
  categories: MedilinkCategory[]
  /** From /citas/estados — includes 'anulacion' flag for cancellation states */
  statuses: MedilinkAppointmentStatus[]
  chairs: MedilinkChair[]
  loadedAt: Date
}
