// LUNA — Module: medilink
// Types for Medilink (Dentalink/HealthAtom) API integration

// ─── Config ──────────────────────────────

export interface MedilinkConfig {
  MEDILINK_API_TOKEN: string
  MEDILINK_BASE_URL: string
  MEDILINK_RATE_LIMIT_RPM: number
  MEDILINK_API_TIMEOUT_MS: number
  MEDILINK_CACHE_TTL_MS: number
  MEDILINK_FOLLOWUP_ENABLED: boolean
  MEDILINK_FOLLOWUP_TOUCH0_ENABLED: boolean
  MEDILINK_FOLLOWUP_TOUCH1_DAYS_BEFORE: number
  MEDILINK_FOLLOWUP_TOUCH3_HOURS_BEFORE: number
  MEDILINK_FOLLOWUP_TOUCH4_HOURS_BEFORE: number
  MEDILINK_FOLLOWUP_NOSHOW_HOURS_AFTER: number
  MEDILINK_FOLLOWUP_REACTIVATION_DAYS: number
  MEDILINK_FOLLOWUP_PREFERRED_CHANNEL: string
  MEDILINK_SYNC_INTERVAL_MS: number
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
  id_dentista: number
  nombre_dentista: string
  id_sucursal: number
  nombre_sucursal: string
  id_sillon: number
  comentarios: string | null
  fecha_actualizacion: string
  links?: { self: string }
}

export interface MedilinkAppointmentCreate {
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
  videoconsulta?: boolean
}

export interface MedilinkAppointmentUpdate {
  id_estado?: number
  duracion?: number
  comentarios?: string
  fecha?: string
  hora_inicio?: string
  id_dentista?: number
  id_sillon?: number
}

// ─── Dentista (Professional) ─────────────

export interface MedilinkDentist {
  id: number
  nombre: string
  apellidos: string
  email: string | null
  especialidad: string | null
  sucursales?: Array<{ id: number; nombre: string }>
  tratamientos?: Array<{ id: number; nombre: string }>
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

// ─── Tratamiento (Treatment) ─────────────

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

// ─── Agenda / Disponibilidad ─────────────

export interface MedilinkAgendaSlot {
  hora: string
  sillones: Record<string, boolean | MedilinkAgendaBlock>
}

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

export interface MedilinkAgendaDay {
  fecha: string
  horas: MedilinkAgendaSlot[]
}

// ─── Filter system ───────────────────────

export type MedilinkFilterOperator =
  | 'eq' | 'neq'
  | 'gt' | 'gte'
  | 'lt' | 'lte'
  | 'like' | 'in'

export type MedilinkFilter = Record<string, Record<string, string | number>>

// ─── Audit log ───────────────────────────

export interface MedilinkAuditEntry {
  id: string
  contactId: string
  patientId: number
  action: 'create' | 'update' | 'view'
  field?: string
  oldValue?: string
  newValue?: string
  requestedBy: string
  approvedBy?: string | null
  status: 'pending' | 'approved' | 'rejected' | 'auto'
  reason?: string
  createdAt: Date
  resolvedAt?: Date | null
}

// ─── Follow-up ───────────────────────────

export type FollowUpTouchType =
  | 'touch0_booking'
  | 'touch1_7days_call'
  | 'touch1_fallbackA_whatsapp'
  | 'touch1_fallbackB_call'
  | 'touch3_24h_prep'
  | 'touch4_3h_reminder'
  | 'noshow_recovery_1'
  | 'noshow_recovery_2'
  | 'reactivation'

export interface MedilinkFollowUp {
  id: string
  appointmentId: number
  patientId: number
  contactId: string
  touchType: FollowUpTouchType
  scheduledAt: Date
  executedAt: Date | null
  status: 'pending' | 'sent' | 'responded' | 'skipped' | 'failed'
  channel: 'whatsapp' | 'call' | 'email'
  response?: string | null
  metadata?: Record<string, unknown>
  createdAt: Date
}

// ─── Security context ────────────────────

export interface MedilinkSecurityContext {
  contactId: string
  contactPhone: string
  medilinkPatientId: number | null
  verified: boolean
}

// ─── Patient-safe public data ────────────

export interface PatientPublicInfo {
  id: number
  nombres: string
  apellidos: string
  nombre_social: string | null
}

export interface PatientOwnInfo extends PatientPublicInfo {
  rut: string | null
  fecha_nacimiento: string | null
  celular: string | null
  email: string | null
  tratamientos_activos: Array<{ nombre: string; fecha: string }>
  deudas: Array<{ concepto: string; monto: number }> | null
  proximas_citas: MedilinkAppointment[]
}
