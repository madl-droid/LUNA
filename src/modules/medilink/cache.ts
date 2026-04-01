// LUNA — Module: medilink
// Redis + in-memory cache for reference data and availability

import pino from 'pino'
import type { Redis } from 'ioredis'
import { isCacheEnabled } from '../../kernel/cache-flag.js'
import type { MedilinkApiClient } from './api-client.js'
import type {
  MedilinkConfig, ReferenceData,
  MedilinkBranch, MedilinkProfessional, MedilinkTreatment,
  MedilinkAppointmentStatus, MedilinkChair,
  MedilinkAgendaItem, AvailabilitySlot,
} from './types.js'

const logger = pino({ name: 'medilink:cache' })

const REDIS_PREFIX = 'medilink:cache:'
const REF_KEY = `${REDIS_PREFIX}reference`
const AVAIL_PREFIX = `${REDIS_PREFIX}avail:`
const PATIENT_PREFIX = `${REDIS_PREFIX}patient:`
const PATIENT_TTL_S = 300 // 5 min

export class MedilinkCache {
  private api: MedilinkApiClient
  private redis: Redis
  private config: MedilinkConfig

  // In-memory hot cache
  private refData: ReferenceData | null = null

  constructor(api: MedilinkApiClient, redis: Redis, config: MedilinkConfig) {
    this.api = api
    this.redis = redis
    this.config = config
  }

  updateConfig(config: MedilinkConfig): void {
    this.config = config
  }

  // ─── Reference data ────────────────────

  async refreshReferenceData(): Promise<void> {
    const [branches, professionals, treatments, statuses, chairs] = await Promise.all([
      this.api.getBranches('low'),
      this.api.getProfessionals('low'),
      this.api.getTreatments('low'),
      this.api.getAppointmentStatuses('low'),
      this.api.getChairs('low'),
    ])

    this.refData = { branches, professionals, treatments, statuses, chairs, loadedAt: new Date() }

    // Store in Redis for persistence across restarts (skip if cache disabled)
    if (await isCacheEnabled()) {
      const ttlS = this.config.MEDILINK_REFERENCE_REFRESH_DAYS * 24 * 3600
      await this.redis.set(REF_KEY, JSON.stringify(this.refData), 'EX', ttlS)
    }

    logger.info({
      branches: branches.length,
      professionals: professionals.length,
      treatments: treatments.length,
      statuses: statuses.length,
      chairs: chairs.length,
    }, 'Reference data refreshed')
  }

  async getReferenceData(): Promise<ReferenceData> {
    if (this.refData) return this.refData

    // Try Redis (skip if cache disabled)
    const cached = await isCacheEnabled() ? await this.redis.get(REF_KEY) : null
    if (cached) {
      this.refData = JSON.parse(cached) as ReferenceData
      this.refData.loadedAt = new Date(this.refData.loadedAt)
      return this.refData
    }

    // Fetch fresh
    await this.refreshReferenceData()
    return this.refData!
  }

  getBranches(): MedilinkBranch[] { return this.refData?.branches ?? [] }
  getProfessionals(): MedilinkProfessional[] { return this.refData?.professionals ?? [] }
  getTreatments(): MedilinkTreatment[] { return this.refData?.treatments ?? [] }
  getStatuses(): MedilinkAppointmentStatus[] { return this.refData?.statuses ?? [] }
  getChairs(): MedilinkChair[] { return this.refData?.chairs ?? [] }

  /** Get only active/enabled professionals */
  getActiveProfessionals(): MedilinkProfessional[] {
    return (this.refData?.professionals ?? []).filter((p) => p.habilitado)
  }

  findProfessionalByName(name: string): MedilinkProfessional | undefined {
    const lower = name.toLowerCase()
    return this.getActiveProfessionals().find((p) =>
      `${p.nombre} ${p.apellidos}`.toLowerCase().includes(lower) ||
      p.nombre.toLowerCase().includes(lower) ||
      p.apellidos.toLowerCase().includes(lower),
    )
  }

  findTreatmentByName(name: string): MedilinkTreatment | undefined {
    const lower = name.toLowerCase()
    return (this.refData?.treatments ?? []).find((t) =>
      t.nombre.toLowerCase().includes(lower),
    )
  }

  findBranchByName(name: string): MedilinkBranch | undefined {
    const lower = name.toLowerCase()
    return (this.refData?.branches ?? []).find((b) =>
      b.nombre.toLowerCase().includes(lower),
    )
  }

  getDefaultBranch(): MedilinkBranch | undefined {
    if (this.config.MEDILINK_DEFAULT_BRANCH_ID) {
      const id = parseInt(this.config.MEDILINK_DEFAULT_BRANCH_ID, 10)
      return (this.refData?.branches ?? []).find((b) => b.id === id)
    }
    return this.refData?.branches?.[0]
  }

  // ─── Availability ──────────────────────

  async getAvailability(
    branchId: number,
    date: string,
    professionalId?: number,
    durationMinutes?: number,
  ): Promise<AvailabilitySlot[]> {
    const cacheKey = `${AVAIL_PREFIX}${branchId}:${date}:${professionalId ?? 'all'}:${durationMinutes ?? 'default'}`

    // Check Redis cache (skip if cache disabled)
    const cacheOn = await isCacheEnabled()
    if (cacheOn) {
      const cached = await this.redis.get(cacheKey)
      if (cached) {
        return JSON.parse(cached) as AvailabilitySlot[]
      }
    }

    // Fetch from API
    const items = await this.api.getAgenda(branchId, date, professionalId, durationMinutes)
    const slots = this.processAgendaResponse(items, branchId)

    // Cache with TTL (skip if cache disabled)
    if (cacheOn) {
      const ttlMs = this.config.MEDILINK_AVAILABILITY_CACHE_TTL_MS
      await this.redis.set(cacheKey, JSON.stringify(slots), 'PX', ttlMs)
    }

    return slots
  }

  /**
   * Process agenda items array into clean availability slots.
   * Free slots = items where id_paciente is null (no patient booked).
   */
  private processAgendaResponse(items: MedilinkAgendaItem[], branchId: number): AvailabilitySlot[] {
    const slots: AvailabilitySlot[] = []
    const branch = (this.refData?.branches ?? []).find((b) => b.id === branchId)

    for (const item of items) {
      // Only include free slots (no patient booked)
      if (item.id_paciente !== null) continue

      slots.push({
        date: item.fecha,
        time: item.hora_inicio,
        professionalId: item.id_dentista,
        professionalName: item.nombre_dentista,
        branchId,
        branchName: branch?.nombre ?? '',
        chairId: String(item.id_recurso),
        chairName: String(item.id_recurso),
        durationMinutes: item.duracion,
      })
    }

    return slots
  }

  /** Invalidate availability cache for a branch/professional */
  async invalidateAvailability(branchId?: number, professionalId?: number): Promise<void> {
    const pattern = branchId
      ? `${AVAIL_PREFIX}${branchId}:*`
      : `${AVAIL_PREFIX}*`

    const keys = await this.redis.keys(pattern)
    if (keys.length > 0) {
      if (professionalId) {
        // Only invalidate keys for specific professional
        const toDelete = keys.filter((k: string) => k.includes(`:${professionalId}:`))
        if (toDelete.length > 0) await this.redis.del(...toDelete)
      } else {
        await this.redis.del(...keys)
      }
      logger.debug({ branchId, professionalId, keysInvalidated: keys.length }, 'Availability cache invalidated')
    }
  }

  /** Invalidate all availability cache */
  async invalidateAllAvailability(): Promise<void> {
    const keys = await this.redis.keys(`${AVAIL_PREFIX}*`)
    if (keys.length > 0) {
      await this.redis.del(...keys)
    }
  }

  // ─── Patient cache (short TTL) ─────────

  async cachePatient(patientId: number, data: Record<string, unknown>): Promise<void> {
    if (!await isCacheEnabled()) return
    await this.redis.set(`${PATIENT_PREFIX}${patientId}`, JSON.stringify(data), 'EX', PATIENT_TTL_S)
  }

  async getCachedPatient(patientId: number): Promise<Record<string, unknown> | null> {
    if (!await isCacheEnabled()) return null
    const cached = await this.redis.get(`${PATIENT_PREFIX}${patientId}`)
    return cached ? JSON.parse(cached) as Record<string, unknown> : null
  }

  async invalidatePatient(patientId: number): Promise<void> {
    await this.redis.del(`${PATIENT_PREFIX}${patientId}`)
  }

  // ─── Invalidation by entity ────────────

  async invalidateByEntity(entity: string, id?: number): Promise<void> {
    switch (entity) {
      case 'cita':
        await this.invalidateAllAvailability()
        break
      case 'paciente':
        if (id) await this.invalidatePatient(id)
        break
      case 'profesional':
      case 'horario':
      case 'horario_bloqueado':
      case 'horario_especial':
        this.refData = null
        await this.redis.del(REF_KEY)
        await this.invalidateAllAvailability()
        break
    }
  }

  // ─── Stats ─────────────────────────────

  getStats(): {
    referenceLoaded: boolean
    referenceLoadedAt: string | null
    branches: number
    professionals: number
    treatments: number
    statuses: number
    chairs: number
  } {
    return {
      referenceLoaded: !!this.refData,
      referenceLoadedAt: this.refData?.loadedAt.toISOString() ?? null,
      branches: this.refData?.branches.length ?? 0,
      professionals: this.refData?.professionals.length ?? 0,
      treatments: this.refData?.treatments.length ?? 0,
      statuses: this.refData?.statuses.length ?? 0,
      chairs: this.refData?.chairs.length ?? 0,
    }
  }
}
