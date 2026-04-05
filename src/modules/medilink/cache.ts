// LUNA — Module: medilink
// Redis + in-memory cache for reference data and availability
// Cache design: stores RAW agenda data, filters on read, mutates via webhooks

import pino from 'pino'
import type { Redis } from 'ioredis'
import { isCacheEnabled } from '../../kernel/cache-flag.js'
import type { MedilinkApiClient } from './api-client.js'
import type {
  MedilinkConfig, ReferenceData,
  MedilinkBranch, MedilinkProfessional, MedilinkTreatment,
  MedilinkAppointmentStatus, MedilinkChair,
  MedilinkAgendaItem, AvailabilitySlot,
  MedilinkPrestacion, MedilinkCategory,
  WebhookCitaData,
} from './types.js'

const logger = pino({ name: 'medilink:cache' })

const REDIS_PREFIX = 'medilink:cache:'
const REF_KEY = `${REDIS_PREFIX}reference`
/** Raw agenda: stores ALL agenda items (booked + free) per branch:date:professional */
const AGENDA_PREFIX = `${REDIS_PREFIX}agenda:`
/** Cita index: maps citaId → JSON { branchId, date, professionalId } for O(1) lookup */
const CITA_INDEX_KEY = `${REDIS_PREFIX}cita-index`
const PATIENT_PREFIX = `${REDIS_PREFIX}patient:`
const PATIENT_TTL_S = 300 // 5 min
/** Agenda TTL: 25 hours (refresh daily, extra hour as buffer) */
const AGENDA_TTL_S = 25 * 3600

// Keep old prefix for cleanup of legacy keys
const OLD_AVAIL_PREFIX = `${REDIS_PREFIX}avail:`

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
    const [branches, professionals, prestaciones, statuses, chairs] = await Promise.all([
      this.api.getBranches('low'),
      this.api.getProfessionals('low'),
      this.api.getPrestaciones('low'),
      this.api.getAppointmentStatuses('low'),
      this.api.getChairs('low'),
    ])

    // Derive treatments list (backward compat) from enabled prestaciones
    const treatments = prestaciones
      .filter(p => p.habilitado)
      .map(p => ({ id: p.id, nombre: p.nombre }))

    // Derive unique categories from prestaciones
    const catMap = new Map<number, string>()
    for (const p of prestaciones) {
      if (!catMap.has(p.id_categoria)) catMap.set(p.id_categoria, p.nombre_categoria)
    }
    const categories: MedilinkCategory[] = Array.from(catMap.entries())
      .map(([id, nombre]) => ({ id, nombre }))
      .sort((a, b) => a.id - b.id)

    this.refData = { branches, professionals, treatments, prestaciones, categories, statuses, chairs, loadedAt: new Date() }

    // Store in Redis for persistence across restarts (skip if cache disabled)
    if (await isCacheEnabled()) {
      const ttlS = this.config.MEDILINK_REFERENCE_REFRESH_DAYS * 24 * 3600
      await this.redis.set(REF_KEY, JSON.stringify(this.refData), 'EX', ttlS)
    }

    logger.info({
      branches: branches.length,
      professionals: professionals.length,
      prestaciones: prestaciones.length,
      categories: categories.length,
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
  getPrestaciones(): MedilinkPrestacion[] { return this.refData?.prestaciones ?? [] }
  getCategories(): MedilinkCategory[] { return this.refData?.categories ?? [] }
  findPrestacionById(id: number): MedilinkPrestacion | undefined {
    return (this.refData?.prestaciones ?? []).find(p => p.id === id)
  }

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

  // ─── Agenda helpers (private) ──────────

  private agendaKey(branchId: number, date: string, professionalId: number): string {
    return `${AGENDA_PREFIX}${branchId}:${date}:${professionalId}`
  }

  private parseAllowedChairs(): number[] {
    return this.config.MEDILINK_ALLOWED_CHAIRS
      ? this.config.MEDILINK_ALLOWED_CHAIRS.split(',').map(s => parseInt(s.trim(), 10)).filter(n => !isNaN(n))
      : []
  }

  /**
   * Filter raw agenda items into clean availability slots.
   * Free slots = id_paciente is null/0, and chair is in allowed list.
   */
  private filterToAvailableSlots(items: MedilinkAgendaItem[], branchId: number): AvailabilitySlot[] {
    const slots: AvailabilitySlot[] = []
    const branch = (this.refData?.branches ?? []).find((b) => b.id === branchId)
    const allowedChairs = this.parseAllowedChairs()

    for (const item of items) {
      // Only include free slots — API returns 0 (or null) when no patient is booked
      if (item.id_paciente != null && item.id_paciente !== 0) continue

      // Filter by allowed chairs (skip sobreagendamiento)
      if (allowedChairs.length > 0 && !allowedChairs.includes(item.id_recurso)) continue

      // Resolve chair name from reference data
      const chair = (this.refData?.chairs ?? []).find(c => c.id === item.id_recurso)

      slots.push({
        date: item.fecha,
        time: item.hora_inicio,
        professionalId: item.id_dentista,
        professionalName: item.nombre_dentista,
        branchId,
        branchName: branch?.nombre ?? '',
        chairId: String(item.id_recurso),
        chairName: chair?.nombre ?? String(item.id_recurso),
        durationMinutes: item.duracion,
      })
    }

    if (items.length > 0 && slots.length === 0 && allowedChairs.length > 0) {
      logger.warn({ branchId, allowedChairs, totalItems: items.length }, 'Chair filter removed ALL slots — check MEDILINK_ALLOWED_CHAIRS config')
    }

    return slots
  }

  // ─── Availability (read path) ──────────

  /**
   * Get available slots for a branch/date/professional.
   * Reads from raw agenda cache, filters on the fly.
   * Falls back to v5 API if cache miss (single-day fetch).
   */
  async getAvailability(
    branchId: number,
    date: string,
    professionalId: number,
  ): Promise<AvailabilitySlot[]> {
    const key = this.agendaKey(branchId, date, professionalId)

    // Try cached raw agenda
    const cacheOn = await isCacheEnabled()
    if (cacheOn) {
      const cached = await this.redis.get(key)
      if (cached) {
        const items = JSON.parse(cached) as MedilinkAgendaItem[]
        return this.filterToAvailableSlots(items, branchId)
      }
    }

    // Cache miss — fetch single day from v5 API
    this.ensureProfessionalNames()
    const dateMap = await this.api.getProfessionalAgenda(branchId, professionalId, date, date)
    const items = dateMap[date] ?? []
    const slots = this.filterToAvailableSlots(items, branchId)

    // Cache the raw items (not filtered) for future reads and webhook mutations
    if (cacheOn && items.length > 0) {
      await this.redis.set(key, JSON.stringify(items), 'EX', AGENDA_TTL_S)
      await this.indexCitasFromAgenda(items, branchId, date, professionalId)
    }

    return slots
  }

  /** Push professional names to api-client for v5 flatten */
  private ensureProfessionalNames(): void {
    for (const prof of this.getActiveProfessionals()) {
      this.api.setProfessionalName(prof.id, `${prof.nombre} ${prof.apellidos}`.trim())
    }
  }

  // ─── Cita index ────────────────────────

  /**
   * Index booked citas from a v5 agenda fetch.
   * v5 with mostrar_detalles=1 returns id_cita for booked slots.
   */
  private async indexCitasFromAgenda(
    items: MedilinkAgendaItem[],
    branchId: number,
    date: string,
    professionalId: number,
  ): Promise<void> {
    const entries: [string, string][] = []
    for (const item of items) {
      if (item.id_cita && item.id_paciente) {
        entries.push([String(item.id_cita), JSON.stringify({ branchId, date, professionalId })])
      }
    }
    if (entries.length > 0) {
      await this.redis.hset(CITA_INDEX_KEY, ...entries.flat())
    }
  }

  /** Store cita location in the index (called from webhook handlers) */
  async indexCita(citaId: number, branchId: number, date: string, professionalId: number): Promise<void> {
    await this.redis.hset(CITA_INDEX_KEY, String(citaId), JSON.stringify({ branchId, date, professionalId }))
  }

  /** Look up where a cita lives in the cache */
  async lookupCita(citaId: number): Promise<{ branchId: number; date: string; professionalId: number } | null> {
    const raw = await this.redis.hget(CITA_INDEX_KEY, String(citaId))
    return raw ? JSON.parse(raw) as { branchId: number; date: string; professionalId: number } : null
  }

  /** Remove cita from index */
  async removeCitaIndex(citaId: number): Promise<void> {
    await this.redis.hdel(CITA_INDEX_KEY, String(citaId))
  }

  // ─── Webhook-driven cache mutation ─────

  /** Normalize time to HH:mm (strip seconds if present) */
  private normalizeTime(time: string): string {
    return time.length > 5 ? time.slice(0, 5) : time
  }

  /**
   * Handle cita:created — mark the slot as booked in the raw agenda cache.
   * The webhook data contains all the info needed.
   */
  async applyCitaCreated(data: WebhookCitaData): Promise<void> {
    const { id, id_sucursal, fecha, id_profesional, id_sillon } = data
    const horaInicio = this.normalizeTime(data.hora_inicio)
    const key = this.agendaKey(id_sucursal, fecha, id_profesional)

    // Index this cita for future lookups
    await this.indexCita(id, id_sucursal, fecha, id_profesional)

    const cacheOn = await isCacheEnabled()
    if (!cacheOn) return

    const cached = await this.redis.get(key)
    if (!cached) return // no cached agenda for this date/professional — nothing to mutate

    const items = JSON.parse(cached) as MedilinkAgendaItem[]

    // Find the matching free slot and mark it as booked
    const slotIdx = items.findIndex(item =>
      (item.id_paciente == null || item.id_paciente === 0) &&
      this.normalizeTime(item.hora_inicio) === horaInicio &&
      item.id_recurso === id_sillon,
    )

    if (slotIdx >= 0) {
      items[slotIdx] = {
        ...items[slotIdx]!,
        id_paciente: data.id_paciente,
        nombre_paciente: data.nombre_paciente,
        id_cita: id,
      }
      await this.redis.set(key, JSON.stringify(items), 'KEEPTTL')
      logger.debug({ citaId: id, fecha, professionalId: id_profesional }, 'Cache: slot marked as booked')
    } else {
      logger.debug({ citaId: id, fecha, hora: data.hora_inicio, sillon: id_sillon }, 'Cache: no matching free slot found — will resolve on next warm')
    }
  }

  /**
   * Handle cita:modified — update the slot in cache.
   * For rescheduling: old slot freed (by ID lookup), new slot booked.
   * For status changes: update in-place.
   */
  async applyCitaModified(data: WebhookCitaData): Promise<void> {
    const { id, id_sucursal, fecha, id_profesional, id_sillon } = data
    const horaInicio = this.normalizeTime(data.hora_inicio)
    const cacheOn = await isCacheEnabled()

    // Look up where this cita WAS in the cache
    const oldLocation = await this.lookupCita(id)

    if (oldLocation && cacheOn) {
      const oldKey = this.agendaKey(oldLocation.branchId, oldLocation.date, oldLocation.professionalId)
      const oldCached = await this.redis.get(oldKey)
      if (oldCached) {
        const oldItems = JSON.parse(oldCached) as MedilinkAgendaItem[]
        // Find the booked slot — prefer id_cita match (populated by v5 warm), fall back to patient+time
        const oldIdx = oldItems.findIndex(item => item.id_cita === id) >= 0
          ? oldItems.findIndex(item => item.id_cita === id)
          : oldItems.findIndex(item => item.id_paciente === data.id_paciente && this.normalizeTime(item.hora_inicio) === horaInicio)

        const moved = oldLocation.date !== fecha || oldLocation.professionalId !== id_profesional
        if (moved && oldIdx >= 0) {
          oldItems[oldIdx] = {
            ...oldItems[oldIdx]!,
            id_paciente: null,
            nombre_paciente: null,
            id_cita: undefined,
          }
          await this.redis.set(oldKey, JSON.stringify(oldItems), 'KEEPTTL')
          logger.debug({ citaId: id, oldDate: oldLocation.date, newDate: fecha }, 'Cache: freed old slot after reschedule')
        } else if (!moved && oldIdx >= 0) {
          // Status change only (same date/prof) — update in place
          oldItems[oldIdx] = {
            ...oldItems[oldIdx]!,
            id_paciente: data.id_paciente,
            nombre_paciente: data.nombre_paciente,
            id_cita: id,
          }
          await this.redis.set(oldKey, JSON.stringify(oldItems), 'KEEPTTL')
        }
      }
    }

    // If the cita moved, book the new slot
    if (!oldLocation || oldLocation.date !== fecha || oldLocation.professionalId !== id_profesional) {
      const newKey = this.agendaKey(id_sucursal, fecha, id_profesional)
      if (cacheOn) {
        const newCached = await this.redis.get(newKey)
        if (newCached) {
          const newItems = JSON.parse(newCached) as MedilinkAgendaItem[]
          const freeIdx = newItems.findIndex(item =>
            (item.id_paciente == null || item.id_paciente === 0) &&
            this.normalizeTime(item.hora_inicio) === horaInicio &&
            item.id_recurso === id_sillon,
          )
          if (freeIdx >= 0) {
            newItems[freeIdx] = {
              ...newItems[freeIdx]!,
              id_paciente: data.id_paciente,
              nombre_paciente: data.nombre_paciente,
              id_cita: id,
            }
            await this.redis.set(newKey, JSON.stringify(newItems), 'KEEPTTL')
            logger.debug({ citaId: id, fecha, professionalId: id_profesional }, 'Cache: booked new slot after reschedule')
          }
        }
      }
    }

    // Update the cita index to new location
    await this.indexCita(id, id_sucursal, fecha, id_profesional)
  }

  /**
   * Handle cita:deleted — free the slot in cache.
   */
  async applyCitaDeleted(data: WebhookCitaData): Promise<void> {
    const { id } = data
    const horaInicio = this.normalizeTime(data.hora_inicio)
    const cacheOn = await isCacheEnabled()

    // Look up where this cita was
    const location = await this.lookupCita(id)
    if (location && cacheOn) {
      const key = this.agendaKey(location.branchId, location.date, location.professionalId)
      const cached = await this.redis.get(key)
      if (cached) {
        const items = JSON.parse(cached) as MedilinkAgendaItem[]
        // Prefer id_cita match, fall back to patient+time
        const idx = items.findIndex(item => item.id_cita === id) >= 0
          ? items.findIndex(item => item.id_cita === id)
          : items.findIndex(item => item.id_paciente === data.id_paciente && this.normalizeTime(item.hora_inicio) === horaInicio)
        if (idx >= 0) {
          items[idx] = {
            ...items[idx]!,
            id_paciente: null,
            nombre_paciente: null,
            id_cita: undefined,
          }
          await this.redis.set(key, JSON.stringify(items), 'KEEPTTL')
          logger.debug({ citaId: id }, 'Cache: freed slot after deletion')
        }
      }
    }

    // If no index entry, try using webhook data directly
    if (!location && cacheOn) {
      const key = this.agendaKey(data.id_sucursal, data.fecha, data.id_profesional)
      const cached = await this.redis.get(key)
      if (cached) {
        const items = JSON.parse(cached) as MedilinkAgendaItem[]
        const idx = items.findIndex(item =>
          item.id_paciente === data.id_paciente &&
          this.normalizeTime(item.hora_inicio) === horaInicio &&
          item.id_recurso === data.id_sillon,
        )
        if (idx >= 0) {
          items[idx] = { ...items[idx]!, id_paciente: null, nombre_paciente: null }
          await this.redis.set(key, JSON.stringify(items), 'KEEPTTL')
          logger.debug({ citaId: id }, 'Cache: freed slot after deletion (via webhook data)')
        }
      }
    }

    await this.removeCitaIndex(id)
  }

  // ─── Weekly agenda warm ─────��──────────

  /**
   * Fetch and cache the complete agenda for all active professionals
   * for the next N days. Called at startup and daily.
   * Uses v5 endpoint: 1 API call per professional covers all days.
   */
  async warmWeeklyAgenda(): Promise<void> {
    const branch = this.getDefaultBranch()
    if (!branch) {
      logger.warn('Cannot warm agenda — no default branch configured')
      return
    }

    const professionals = this.getActiveProfessionals()
    if (professionals.length === 0) {
      logger.warn('Cannot warm agenda — no active professionals found')
      return
    }

    // Push professional names to api-client for v5 flatten
    this.ensureProfessionalNames()

    const days = this.config.MEDILINK_AGENDA_WARM_DAYS
    const now = new Date()
    const fechaInicio = now.toISOString().split('T')[0]!
    const endDate = new Date(now)
    endDate.setDate(endDate.getDate() + days - 1)
    const fechaFin = endDate.toISOString().split('T')[0]!

    let warmed = 0
    let citasIndexed = 0
    let errors = 0

    for (const prof of professionals) {
      try {
        // Single v5 call returns all days for this professional
        const dateMap = await this.api.getProfessionalAgenda(branch.id, prof.id, fechaInicio, fechaFin, 'low')

        for (const [date, items] of Object.entries(dateMap)) {
          const key = this.agendaKey(branch.id, date, prof.id)
          await this.redis.set(key, JSON.stringify(items), 'EX', AGENDA_TTL_S)

          // Index booked citas (v5 provides id_cita)
          for (const item of items) {
            if (item.id_cita && item.id_paciente) {
              await this.indexCita(item.id_cita, branch.id, date, prof.id)
              citasIndexed++
            }
          }
          warmed++
        }
      } catch (err) {
        errors++
        logger.warn({ err: (err as Error).message, professionalId: prof.id }, 'Failed to warm agenda for professional')
      }
    }

    // Clean up legacy availability keys from old cache format
    try {
      const oldKeys = await this.redis.keys(`${OLD_AVAIL_PREFIX}*`)
      if (oldKeys.length > 0) await this.redis.del(...oldKeys)
    } catch { /* best effort */ }

    logger.info({ warmed, citasIndexed, errors, professionals: professionals.length, days, apiCalls: professionals.length }, 'Weekly agenda warm complete')
  }

  // ─── Legacy invalidation (for non-cita entities) ──

  /** Invalidate all agenda cache (used for schedule/professional changes) */
  async invalidateAllAgenda(): Promise<void> {
    const keys = await this.redis.keys(`${AGENDA_PREFIX}*`)
    if (keys.length > 0) await this.redis.del(...keys)
    // Also clear cita index
    await this.redis.del(CITA_INDEX_KEY)
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

  /**
   * Smart cache invalidation by webhook entity type.
   * For cita events: handled by applyCitaCreated/Modified/Deleted instead.
   * This method handles non-cita entities only.
   */
  async invalidateByEntity(entity: string, id?: number): Promise<void> {
    switch (entity) {
      case 'cita':
        // Cita events are now handled by applyCita* methods with surgical cache mutation.
        // No blanket invalidation needed.
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
        await this.invalidateAllAgenda()
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
    prestaciones: number
    categories: number
    statuses: number
    chairs: number
  } {
    return {
      referenceLoaded: !!this.refData,
      referenceLoadedAt: this.refData?.loadedAt.toISOString() ?? null,
      branches: this.refData?.branches.length ?? 0,
      professionals: this.refData?.professionals.length ?? 0,
      treatments: this.refData?.treatments.length ?? 0,
      prestaciones: this.refData?.prestaciones.length ?? 0,
      categories: this.refData?.categories.length ?? 0,
      statuses: this.refData?.statuses.length ?? 0,
      chairs: this.refData?.chairs.length ?? 0,
    }
  }
}
