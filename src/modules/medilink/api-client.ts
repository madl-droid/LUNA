// LUNA — Module: medilink
// HTTP client for Medilink (HealthAtom) API with rate limiting, pagination, retry

import pino from 'pino'
import type {
  MedilinkConfig, MedilinkResponse, MedilinkFilter, RequestPriority,
  MedilinkPatient, MedilinkPatientCreate, MedilinkPatientUpdate,
  MedilinkAppointment, MedilinkAppointmentCreate, MedilinkAppointmentUpdate,
  MedilinkProfessional, MedilinkBranch, MedilinkChair,
  MedilinkTreatment, MedilinkAppointmentStatus,
  MedilinkAgendaItem, MedilinkPatientArchive, MedilinkEvolution,
  MedilinkTreatmentPlan, MedilinkAdditionalField, MedilinkPrestacion,
} from './types.js'
import { RateLimiter } from './rate-limiter.js'

const logger = pino({ name: 'medilink:api-client' })

const MAX_RETRIES = 3
const MAX_PAGES = 10
const RETRY_BACKOFF_BASE_MS = 2000

export class MedilinkApiClient {
  private baseUrl: string
  private token: string
  private timeoutMs: number
  private rateLimiter: RateLimiter

  constructor(config: MedilinkConfig, rateLimiter: RateLimiter) {
    // Append /api/v1 only if not already present
    const base = config.MEDILINK_BASE_URL.replace(/\/+$/, '')
    this.baseUrl = base.endsWith('/api/v1') ? base : `${base}/api/v1`
    this.token = config.MEDILINK_API_TOKEN
    this.timeoutMs = config.MEDILINK_API_TIMEOUT_MS
    this.rateLimiter = rateLimiter
  }

  updateConfig(config: MedilinkConfig): void {
    const base = config.MEDILINK_BASE_URL.replace(/\/+$/, '')
    this.baseUrl = base.endsWith('/api/v1') ? base : `${base}/api/v1`
    this.token = config.MEDILINK_API_TOKEN
    this.timeoutMs = config.MEDILINK_API_TIMEOUT_MS
  }

  // ─── Generic request ──────────────────

  private async request<T>(
    method: 'GET' | 'POST' | 'PUT',
    path: string,
    options?: {
      body?: Record<string, unknown>
      filter?: MedilinkFilter
      sort?: string
      priority?: RequestPriority
      fullUrl?: string
    },
  ): Promise<MedilinkResponse<T>> {
    const priority = options?.priority ?? 'medium'
    await this.rateLimiter.acquire(priority)

    let url: string
    if (options?.fullUrl) {
      url = options.fullUrl
    } else {
      url = `${this.baseUrl}${path}`
      const params = new URLSearchParams()
      if (options?.filter) params.set('q', JSON.stringify(options.filter))
      if (options?.sort) params.set('sort', options.sort)
      const qs = params.toString()
      if (qs) url += `?${qs}`
    }

    let lastError: Error | null = null
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        const controller = new AbortController()
        const timeout = setTimeout(() => controller.abort(), this.timeoutMs)

        const fetchOptions: RequestInit = {
          method,
          headers: {
            'Authorization': `Token ${this.token}`,
            'Content-Type': 'application/json',
            'Accept': 'application/json',
          },
          signal: controller.signal,
        }
        if (options?.body && (method === 'POST' || method === 'PUT')) {
          fetchOptions.body = JSON.stringify(options.body)
        }

        const res = await fetch(url, fetchOptions)
        clearTimeout(timeout)

        if (res.ok) {
          const data = await res.json() as MedilinkResponse<T>
          return data
        }

        if (res.status === 429) {
          const retryAfter = res.headers.get('Retry-After')
          const waitMs = retryAfter ? parseInt(retryAfter, 10) * 1000 : 5000
          logger.warn({ attempt, waitMs, url: path }, 'Rate limited by Medilink API')
          if (attempt < MAX_RETRIES) {
            await this.sleep(waitMs)
            continue
          }
        }

        if (res.status >= 500 && attempt < MAX_RETRIES) {
          const waitMs = RETRY_BACKOFF_BASE_MS * Math.pow(2, attempt)
          logger.warn({ status: res.status, attempt, waitMs, url: path }, 'Server error, retrying')
          await this.sleep(waitMs)
          continue
        }

        const errorBody = await res.text().catch(() => '')
        const err = new MedilinkApiError(
          `Medilink API ${method} ${path} returned ${res.status}`,
          res.status,
          errorBody,
        )
        logger.error({ status: res.status, path, errorBody }, 'Medilink API error')
        throw err
      } catch (err) {
        if (err instanceof MedilinkApiError) throw err
        lastError = err as Error
        if (attempt < MAX_RETRIES) {
          const waitMs = RETRY_BACKOFF_BASE_MS * Math.pow(2, attempt)
          logger.warn({ err: (err as Error).message, attempt, waitMs, path }, 'Network error, retrying')
          await this.sleep(waitMs)
          continue
        }
      }
    }

    throw lastError ?? new Error(`Medilink API request failed after ${MAX_RETRIES} retries`)
  }

  /** Fetch all pages of a paginated resource */
  private async fetchAll<T>(
    path: string,
    options?: { filter?: MedilinkFilter; sort?: string; priority?: RequestPriority },
  ): Promise<T[]> {
    const results: T[] = []
    let nextUrl: string | null = null
    let page = 0

    while (page < MAX_PAGES) {
      const res: MedilinkResponse<T[]> = await this.request<T[]>(
        'GET',
        path,
        nextUrl ? { ...options, fullUrl: nextUrl } : options,
      )

      if (Array.isArray(res.data)) {
        results.push(...res.data)
      }

      nextUrl = res.links?.next ?? null
      if (!nextUrl) break
      page++
    }

    if (page >= MAX_PAGES) {
      logger.warn({ path, totalResults: results.length }, 'Hit max pagination limit')
    }

    return results
  }

  // ─── Patients ──────────────────────────

  async getPatients(filter?: MedilinkFilter, priority?: RequestPriority): Promise<MedilinkPatient[]> {
    return this.fetchAll<MedilinkPatient>('/pacientes', { filter, priority })
  }

  async getPatient(id: number, priority?: RequestPriority): Promise<MedilinkPatient> {
    const res = await this.request<MedilinkPatient>('GET', `/pacientes/${id}`, { priority })
    return res.data
  }

  async findPatientByPhone(phone: string): Promise<MedilinkPatient[]> {
    const normalized = normalizePhone(phone)
    return this.fetchAll<MedilinkPatient>('/pacientes', {
      filter: { celular: { eq: normalized } },
      priority: 'high',
    })
  }

  async findPatientByDocument(doc: string): Promise<MedilinkPatient[]> {
    return this.fetchAll<MedilinkPatient>('/pacientes', {
      filter: { rut: { eq: doc } },
      priority: 'high',
    })
  }

  async createPatient(data: MedilinkPatientCreate): Promise<MedilinkPatient> {
    const res = await this.request<MedilinkPatient>('POST', '/pacientes', {
      body: data as unknown as Record<string, unknown>,
      priority: 'medium',
    })
    return res.data
  }

  async updatePatient(id: number, data: MedilinkPatientUpdate): Promise<MedilinkPatient> {
    const res = await this.request<MedilinkPatient>('PUT', `/pacientes/${id}`, {
      body: data as unknown as Record<string, unknown>,
      priority: 'medium',
    })
    return res.data
  }

  // ─── Patient sub-resources ─────────────

  async getPatientAppointments(patientId: number, priority?: RequestPriority): Promise<MedilinkAppointment[]> {
    return this.fetchAll<MedilinkAppointment>(`/pacientes/${patientId}/citas`, { priority })
  }

  async getPatientPayments(patientId: number, priority?: RequestPriority): Promise<Array<Record<string, unknown>>> {
    return this.fetchAll<Record<string, unknown>>(`/pacientes/${patientId}/pagos`, { priority })
  }

  async getPatientEvolutions(patientId: number, priority?: RequestPriority): Promise<MedilinkEvolution[]> {
    return this.fetchAll<MedilinkEvolution>(`/pacientes/${patientId}/evoluciones`, { priority })
  }

  // ─── Appointments ──────────────────────

  async getAppointments(filter?: MedilinkFilter, priority?: RequestPriority): Promise<MedilinkAppointment[]> {
    return this.fetchAll<MedilinkAppointment>('/citas', { filter, priority })
  }

  async getAppointment(id: number, priority?: RequestPriority): Promise<MedilinkAppointment> {
    const res = await this.request<MedilinkAppointment>('GET', `/citas/${id}`, { priority })
    return res.data
  }

  async createAppointment(data: MedilinkAppointmentCreate): Promise<MedilinkAppointment> {
    // POST /citas requires v5 API (v1 rejects "sucursal médica" type)
    // v5 uses id_profesional instead of id_dentista
    const v5Body: Record<string, unknown> = {
      ...data as unknown as Record<string, unknown>,
      id_profesional: data.id_dentista,
    }
    delete v5Body.id_dentista
    const v5BaseUrl = this.baseUrl.replace('/api/v1', '/api/v5')
    const res = await this.request<MedilinkAppointment>('POST', '/citas', {
      body: v5Body,
      priority: 'medium',
      fullUrl: `${v5BaseUrl}/citas`,
    })
    return res.data
  }

  async updateAppointment(id: number, data: MedilinkAppointmentUpdate): Promise<MedilinkAppointment> {
    // PUT /citas requires v5 API (v1 rejects "sucursal médica" type)
    // v5 uses id_profesional instead of id_dentista
    const v5Body: Record<string, unknown> = { ...data as unknown as Record<string, unknown> }
    if (v5Body.id_dentista !== undefined) {
      v5Body.id_profesional = v5Body.id_dentista
      delete v5Body.id_dentista
    }
    const v5BaseUrl = this.baseUrl.replace('/api/v1', '/api/v5')
    const res = await this.request<MedilinkAppointment>('PUT', `/citas/${id}`, {
      body: v5Body,
      priority: 'medium',
      fullUrl: `${v5BaseUrl}/citas/${id}`,
    })
    return res.data
  }

  // ─── Reference data ────────────────────

  async getProfessionals(priority?: RequestPriority): Promise<MedilinkProfessional[]> {
    // API uses /dentistas, not /profesionales
    const raw = await this.fetchAll<Record<string, unknown>>('/dentistas', { priority: priority ?? 'low' })
    return raw.map(this.mapProfessional)
  }

  async getBranches(priority?: RequestPriority): Promise<MedilinkBranch[]> {
    const raw = await this.fetchAll<Record<string, unknown>>('/sucursales', { priority: priority ?? 'low' })
    return raw.map(this.mapBranch)
  }

  async getChairs(priority?: RequestPriority): Promise<MedilinkChair[]> {
    const raw = await this.fetchAll<Record<string, unknown>>('/sillones', { priority: priority ?? 'low' })
    return raw.map(this.mapChair)
  }

  async getTreatments(priority?: RequestPriority): Promise<MedilinkTreatment[]> {
    return this.fetchAll<MedilinkTreatment>('/tratamientos', { priority: priority ?? 'low' })
  }

  async getPrestaciones(priority?: RequestPriority): Promise<MedilinkPrestacion[]> {
    const raw = await this.fetchAll<Record<string, unknown>>('/prestaciones', { priority: priority ?? 'low' })
    return raw.map(this.mapPrestacion)
  }

  async getAppointmentStatuses(priority?: RequestPriority): Promise<MedilinkAppointmentStatus[]> {
    // Endpoint real: /citas/estados (no /estados-de-cita)
    const raw = await this.fetchAll<Record<string, unknown>>('/citas/estados', { priority: priority ?? 'low' })
    return raw.map(this.mapStatus)
  }

  // ─── Agenda / Availability ─────────────

  async getAgenda(
    branchId: number,
    date: string,
    professionalId?: number,
    durationMinutes?: number,
  ): Promise<MedilinkAgendaItem[]> {
    const filter: MedilinkFilter = {
      id_sucursal: { eq: branchId },
      fecha: { eq: date },
    }
    // API uses id_dentista, not id_profesional
    if (professionalId) filter['id_dentista'] = { eq: professionalId }
    if (durationMinutes) filter['duracion'] = { eq: durationMinutes }

    // /agendas returns an array directly, not paginated
    const res = await this.request<MedilinkAgendaItem[]>('GET', '/agendas', {
      filter,
      priority: 'high',
    })
    return Array.isArray(res.data) ? res.data : []
  }

  async getPatientFiles(patientId: number, priority?: RequestPriority): Promise<MedilinkPatientArchive[]> {
    return this.fetchAll<MedilinkPatientArchive>(`/pacientes/${patientId}/archivos`, { priority: priority ?? 'medium' })
  }

  // ─── Treatment plans (atenciones) ──────

  async getPatientTreatmentPlans(patientId: number, priority?: RequestPriority): Promise<MedilinkTreatmentPlan[]> {
    return this.fetchAll<MedilinkTreatmentPlan>(`/pacientes/${patientId}/atenciones`, { priority: priority ?? 'medium' })
  }

  // ─── Additional fields (v1 only) ──────

  async getPatientAdditionalFields(patientId: number, priority?: RequestPriority): Promise<MedilinkAdditionalField[]> {
    // /adicionales only works on /api/v1 — build v1 URL explicitly
    const v1Base = this.baseUrl.replace(/\/api\/v\d+/, '/api/v1')
    const url = `${v1Base}/pacientes/${patientId}/adicionales`
    try {
      const res = await this.request<MedilinkAdditionalField[]>('GET', '', {
        fullUrl: url,
        priority: priority ?? 'low',
      })
      return Array.isArray(res.data) ? res.data : []
    } catch (err) {
      logger.warn({ err: (err as Error).message, patientId }, 'Failed to fetch additional fields (v1 only)')
      return []
    }
  }

  // ─── Health check ──────────────────────

  async healthCheck(): Promise<boolean> {
    try {
      await this.request<MedilinkBranch[]>('GET', '/sucursales', { priority: 'low' })
      return true
    } catch {
      return false
    }
  }

  // ─── Data mappers (strip raw API fields the agent doesn't need) ──

  /** Strip PII and internal fields from /dentistas response */
  private mapProfessional(raw: Record<string, unknown>): MedilinkProfessional {
    return {
      id: raw['id'] as number,
      rut: null,           // strip — PII
      nombre: raw['nombre'] as string,
      apellidos: raw['apellidos'] as string,
      celular: null,       // strip — not needed by agent
      telefono: null,      // strip — not needed by agent
      email: null,         // strip — PII
      id_especialidad: (raw['id_especialidad'] as number | null) ?? null,
      especialidad: (raw['especialidad'] as string | null) ?? null,
      agenda_online: Boolean(raw['agenda_online']),
      intervalo: (raw['intervalo'] as number | null) ?? null,
      habilitado: Boolean(raw['habilitado']),  // API returns 1/0, normalize to boolean
    }
  }

  /** Strip pricing and internal fields from /prestaciones response */
  private mapPrestacion(raw: Record<string, unknown>): MedilinkPrestacion {
    return {
      id: raw['id'] as number,
      nombre: raw['nombre'] as string,
      codigo: (raw['codigo'] as string | null) ?? null,
      id_categoria: raw['id_categoria'] as number,
      nombre_categoria: raw['nombre_categoria'] as string,
      habilitado: Boolean(raw['habilitado']),  // API returns 1/0
    }
  }

  /** Strip color and internal flags from /citas/estados response */
  private mapStatus(raw: Record<string, unknown>): MedilinkAppointmentStatus {
    return {
      id: raw['id'] as number,
      nombre: raw['nombre'] as string,
      color: null,                             // strip — UI only
      anulacion: raw['anulacion'] as number,
      reservado: null,                         // strip — internal
    }
  }

  /** Strip internal fields from /sucursales response */
  private mapBranch(raw: Record<string, unknown>): MedilinkBranch {
    return {
      id: raw['id'] as number,
      nombre: raw['nombre'] as string,
      direccion: (raw['direccion'] as string | null) ?? null,
      ciudad: (raw['ciudad'] as string | null) ?? null,
      telefono: (raw['telefono'] as string | null) ?? null,
      email: null,  // strip
    }
  }

  /** Strip links from /sillones response */
  private mapChair(raw: Record<string, unknown>): MedilinkChair {
    return {
      id: raw['id'] as number,
      nombre: raw['nombre'] as string,
    }
  }

  // ─── Helpers ───────────────────────────

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms))
  }
}

// ─── Error class ─────────────────────────

export class MedilinkApiError extends Error {
  status: number
  body: string

  constructor(message: string, status: number, body: string) {
    super(message)
    this.name = 'MedilinkApiError'
    this.status = status
    this.body = body
  }

  override toString(): string {
    if (!this.body) return this.message
    try {
      const parsed = JSON.parse(this.body)
      const detail = parsed?.error?.message ?? parsed?.message ?? this.body
      return `${this.message} — ${detail}`
    } catch {
      return `${this.message} — ${this.body}`
    }
  }
}

// ─── Phone normalization ─────────────────

function normalizePhone(phone: string): string {
  return phone.replace(/[^0-9+]/g, '')
}
