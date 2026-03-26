// LUNA — Module: medilink
// HTTP client for Medilink (HealthAtom) API with rate limiting, pagination, retry

import pino from 'pino'
import type {
  MedilinkConfig, MedilinkResponse, MedilinkFilter, RequestPriority,
  MedilinkPatient, MedilinkPatientCreate, MedilinkPatientUpdate,
  MedilinkAppointment, MedilinkAppointmentCreate, MedilinkAppointmentUpdate,
  MedilinkProfessional, MedilinkBranch, MedilinkChair,
  MedilinkTreatment, MedilinkAppointmentStatus,
  MedilinkAgendaRaw, MedilinkEvolution,
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
    this.baseUrl = config.MEDILINK_BASE_URL.replace(/\/+$/, '')
    this.token = config.MEDILINK_API_TOKEN
    this.timeoutMs = config.MEDILINK_API_TIMEOUT_MS
    this.rateLimiter = rateLimiter
  }

  updateConfig(config: MedilinkConfig): void {
    this.baseUrl = config.MEDILINK_BASE_URL.replace(/\/+$/, '')
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
    const res = await this.request<MedilinkAppointment>('POST', '/citas', {
      body: data as unknown as Record<string, unknown>,
      priority: 'medium',
    })
    return res.data
  }

  async updateAppointment(id: number, data: MedilinkAppointmentUpdate): Promise<MedilinkAppointment> {
    const res = await this.request<MedilinkAppointment>('PUT', `/citas/${id}`, {
      body: data as unknown as Record<string, unknown>,
      priority: 'medium',
    })
    return res.data
  }

  // ─── Reference data ────────────────────

  async getProfessionals(priority?: RequestPriority): Promise<MedilinkProfessional[]> {
    return this.fetchAll<MedilinkProfessional>('/profesionales', { priority: priority ?? 'low' })
  }

  async getBranches(priority?: RequestPriority): Promise<MedilinkBranch[]> {
    return this.fetchAll<MedilinkBranch>('/sucursales', { priority: priority ?? 'low' })
  }

  async getChairs(priority?: RequestPriority): Promise<MedilinkChair[]> {
    return this.fetchAll<MedilinkChair>('/sillones', { priority: priority ?? 'low' })
  }

  async getTreatments(priority?: RequestPriority): Promise<MedilinkTreatment[]> {
    return this.fetchAll<MedilinkTreatment>('/tratamientos', { priority: priority ?? 'low' })
  }

  async getAppointmentStatuses(priority?: RequestPriority): Promise<MedilinkAppointmentStatus[]> {
    return this.fetchAll<MedilinkAppointmentStatus>('/estados-de-cita', { priority: priority ?? 'low' })
  }

  // ─── Agenda / Availability ─────────────

  async getAgenda(
    branchId: number,
    date: string,
    professionalId?: number,
    durationMinutes?: number,
  ): Promise<MedilinkAgendaRaw> {
    const filter: MedilinkFilter = {
      id_sucursal: { eq: branchId },
      fecha: { eq: date },
    }
    if (professionalId) filter['id_profesional'] = { eq: professionalId }
    if (durationMinutes) filter['duracion'] = { eq: durationMinutes }

    const res = await this.request<MedilinkAgendaRaw>('GET', '/agendas', {
      filter,
      priority: 'high',
    })
    return res.data
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
}

// ─── Phone normalization ─────────────────

function normalizePhone(phone: string): string {
  return phone.replace(/[^0-9+]/g, '')
}
