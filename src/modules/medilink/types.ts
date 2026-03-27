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
  nombres: string
  apellidos: string
  nombre_social: string | null
  fecha_nacimiento: string | null
  genero: string | null
  telefono: string | null
  celular: string | null
  email: string | null
  direccion: string | null
  ciudad: string | null
  comuna: string | null
  pais: string | null
  prevision: string | null
  observaciones: string | null
  fecha_creacion: string
  fecha_actualizacion: string
  campos_adicionales?: Record<string, unknown>
  links?: { self: string }
}

export interface MedilinkPatientCreate {
  rut?: string
  nombres: string
  apellidos: string
  nombre_social?: string
  fecha_nacimiento?: string
  genero?: string
  telefono?: string
  celular?: string
  email?: string
  direccion?: string
  ciudad?: string
  comuna?: string
  pais?: string
  prevision?: string
  observaciones?: string
}

export interface MedilinkPatientUpdate {
  nombres?: string
  apellidos?: string
  nombre_social?: string
  fecha_nacimiento?: string
  genero?: string
  telefono?: string
  celular?: string
  email?: string
  direccion?: string
  ciudad?: string
  comuna?: string
  pais?: string
  prevision?: string
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
  id_tratamiento: number
  nombre_tratamiento: string
  fecha: string
  hora_inicio: string
  hora_fin: string
  duracion: number
  id_profesional: number
  nombre_profesional: string
  id_sucursal: number
  nombre_sucursal: string
  id_sillon: number
  comentarios: string | null
  fecha_actualizacion: string
  links?: { self: string }
}

export interface MedilinkAppointmentCreate {
  id_profesional: number
  id_sucursal: number
  id_estado: number
  id_sillon: number
  id_paciente: number
  id_tratamiento: number
  fecha: string
  hora_inicio: string
  duracion: number
  comentario?: string
}

export interface MedilinkAppointmentUpdate {
  id_estado?: number
  duracion?: number
  comentarios?: string
  fecha?: string
  hora_inicio?: string
  id_profesional?: number
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
  id_sucursal: number
  nombre_sucursal: string
  links?: { self: string }
}

// ─── Tratamiento / Atencion (Treatment) ──

export interface MedilinkTreatment {
  id: number
  nombre: string
  duracion: number | null
  precio: number | null
  links?: { self: string }
}

// ─── Estado de Cita (Appointment Status) ─

export interface MedilinkAppointmentStatus {
  id: number
  nombre: string
  color: string | null
  links?: { self: string }
}

// ─── Evolucion (Evolution/Procedure) ─────

export interface MedilinkEvolution {
  id: number
  id_atencion: number
  nombre_atencion: string
  id_paciente: number
  nombre_paciente: string
  id_profesional: number
  nombre_profesional: string
  fecha: string
  datos: string | null
  habilitado: boolean
}

// ─── Agenda / Disponibilidad ─────────────

/** Raw agenda response: date → time → chair → availability */
export type MedilinkAgendaRaw = Record<string, Record<string, Record<string, boolean | MedilinkAgendaBlock>>>

export interface MedilinkAgendaBlock {
  tipo: string
  comentario: string | null
  bloque: string | null
  duracion_total: number
  inicio: string
  fin: string
  id_cita?: number
  id_paciente?: number
  nombre_paciente?: string
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
  | 'view_evolutions' | 'create_patient' | 'create_appointment'
  | 'reschedule_appointment' | 'edit_request'
  | 'edit_approved' | 'edit_rejected'
  | 'identity_check' | 'access_denied'

export interface AuditEntry {
  id: string
  contactId: string
  agentId: string
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
  agentId: string
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
  agentId: string
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

export interface SecurityContext {
  contactId: string
  contactPhone: string
  agentId: string
  medilinkPatientId: number | null
  verificationLevel: VerificationLevel
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

// ─── Rate limiter ────────────────────────

export type RequestPriority = 'high' | 'medium' | 'low'

// ─── Reference data cache ────────────────

export interface ReferenceData {
  branches: MedilinkBranch[]
  professionals: MedilinkProfessional[]
  treatments: MedilinkTreatment[]
  statuses: MedilinkAppointmentStatus[]
  chairs: MedilinkChair[]
  loadedAt: Date
}
