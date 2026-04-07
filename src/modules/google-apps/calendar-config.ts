// LUNA — Google Apps: Calendar Config Service
// CRUD + cache for calendar scheduling configuration stored in config_store.

import type { Pool } from 'pg'
import * as configStore from '../../kernel/config-store.js'

// ─── Types ─────────────────────────────────

export interface CalendarSchedulingConfig {
  // General
  meetEnabled: boolean
  defaultReminders: Array<{ method: 'email' | 'popup'; minutes: number }>
  defaultDurationMinutes: number
  eventNamePrefix: string
  descriptionInstructions: string

  // Days off
  daysOff: Array<
    | { type: 'single'; date: string }
    | { type: 'range'; start: string; end: string }
  >

  // Roles enabled for scheduling
  schedulingRoles: Record<string, { enabled: boolean; instructions: string }>

  // Individual coworkers
  schedulingCoworkers: Record<string, { enabled: boolean; instructions: string }>

  // Post-meeting follow-up
  followUpPost: { enabled: boolean; delayMinutes: number }

  // Pre-meeting reminder
  followUpPre: { enabled: boolean; hoursBefore: number }
}

// ─── Defaults ──────────────────────────────

export const CALENDAR_CONFIG_DEFAULTS: CalendarSchedulingConfig = {
  meetEnabled: true,
  defaultReminders: [
    { method: 'popup', minutes: 5 },
    { method: 'popup', minutes: 30 },
    { method: 'email', minutes: 2880 },
  ],
  defaultDurationMinutes: 30,
  eventNamePrefix: 'Reunión',
  descriptionInstructions: '',
  daysOff: [],
  schedulingRoles: {},
  schedulingCoworkers: {},
  followUpPost: { enabled: true, delayMinutes: 60 },
  followUpPre: { enabled: true, hoursBefore: 24 },
}

const CONFIG_KEY = 'GCAL_SCHEDULING_CONFIG'

// ─── Service ───────────────────────────────

export class CalendarConfigService {
  private cache: CalendarSchedulingConfig | null = null

  constructor(private db: Pool) {}

  async load(): Promise<void> {
    const raw = await configStore.get(this.db, CONFIG_KEY)
    if (!raw) {
      this.cache = { ...CALENDAR_CONFIG_DEFAULTS }
      return
    }
    try {
      this.cache = { ...CALENDAR_CONFIG_DEFAULTS, ...JSON.parse(raw) }
    } catch {
      this.cache = { ...CALENDAR_CONFIG_DEFAULTS }
    }
  }

  get(): CalendarSchedulingConfig {
    return this.cache ?? { ...CALENDAR_CONFIG_DEFAULTS }
  }

  async save(config: CalendarSchedulingConfig): Promise<void> {
    await configStore.set(this.db, CONFIG_KEY, JSON.stringify(config))
    this.cache = config
  }

  async reload(): Promise<void> {
    await this.load()
  }
}
