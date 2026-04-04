// LUNA — Working Memory
// Generic Redis-backed per-contact transient state.
// Survives across turns within a session (configurable TTL, default 6h).
// Each module instantiates with its own namespace — no cross-module coupling.
//
// Usage (any module with access to ctx.redis):
//   const wmem = new WorkingMemory(redis, 'medilink')
//   await wmem.set(contactId, 'pending_reschedule_id', 456)
//   await wmem.get<number>(contactId, 'pending_reschedule_id')  // → 456
//   await wmem.del(contactId, 'pending_reschedule_id')

import type { Redis } from 'ioredis'

const DEFAULT_TTL_S = 60 * 60 * 6  // 6 hours

export class WorkingMemory {
  private readonly ttlS: number

  constructor(
    private readonly redis: Redis,
    private readonly namespace: string,
    ttlS: number = DEFAULT_TTL_S,
  ) {
    this.ttlS = ttlS
  }

  private key(contactId: string, field: string): string {
    return `wmem:${this.namespace}:${contactId}:${field}`
  }

  async get<T>(contactId: string, field: string): Promise<T | null> {
    const raw = await this.redis.get(this.key(contactId, field))
    if (!raw) return null
    try { return JSON.parse(raw) as T } catch { return null }
  }

  async set<T>(contactId: string, field: string, value: T): Promise<void> {
    await this.redis.set(this.key(contactId, field), JSON.stringify(value), 'EX', this.ttlS)
  }

  async del(contactId: string, field: string): Promise<void> {
    await this.redis.del(this.key(contactId, field))
  }

  /** Refresh TTL on all fields for this contact (call when there's activity) */
  async touch(contactId: string, fields: string[]): Promise<void> {
    await Promise.all(fields.map(f => this.redis.expire(this.key(contactId, f), this.ttlS)))
  }
}

// ── Medilink field constants ───────────────────────────────────────────────
// Using constants avoids typo bugs across tool handlers.
export const ML = {
  PATIENT_ID: 'patient_id',
  APPOINTMENTS: 'appointments',
  PENDING_RESCHEDULE_ID: 'pending_reschedule_id',
  LAST_APPOINTMENT_ID: 'last_appointment_id',
} as const

export interface AppointmentSnapshot {
  id: number
  date: string
  time: string
  professionalId: number
  professionalName: string
  treatmentId: number
  treatmentName: string
  branchId?: number
  branchName?: string
  /** Plan de tratamiento (HealthAtom "atención") — needed for rescheduling */
  idAtencion?: number | null
}
