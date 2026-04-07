// LUNA — Google Apps: Calendar Config Service
// CRUD + cache for calendar scheduling configuration stored in config_store.

import type { Pool } from 'pg'
import { z } from 'zod'
import * as configStore from '../../kernel/config-store.js'
import type { CalendarSchedulingConfig } from './types.js'

// ─── Zod schema ────────────────────────────

const dayOffSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('single'), date: z.string() }),
  z.object({ type: z.literal('range'), start: z.string(), end: z.string() }),
])

const reminderSchema = z.object({
  method: z.enum(['email', 'popup']),
  minutes: z.number().int().min(0).max(40320),
})

const calendarConfigSchema = z.object({
  meetEnabled: z.boolean().default(true),
  defaultReminders: z.array(reminderSchema).default([]),
  defaultDurationMinutes: z.number().int().min(15).max(480).default(30),
  eventNamePrefix: z.string().default('Reunión'),
  descriptionInstructions: z.string().default(''),
  daysOff: z.array(dayOffSchema).default([]),
  schedulingRoles: z.record(z.object({
    enabled: z.boolean(),
    instructions: z.string().default(''),
  })).default({}),
  schedulingCoworkers: z.record(z.object({
    enabled: z.boolean(),
    instructions: z.string().default(''),
  })).default({}),
  followUpPost: z.object({
    enabled: z.boolean().default(true),
    delayMinutes: z.number().int().min(30).max(360).default(60),
  }).default({}),
  followUpPre: z.object({
    enabled: z.boolean().default(true),
    hoursBefore: z.number().int().min(3).max(24).default(24),
  }).default({}),
})

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
      const parsed = calendarConfigSchema.safeParse(JSON.parse(raw))
      this.cache = parsed.success ? parsed.data : { ...CALENDAR_CONFIG_DEFAULTS }
    } catch {
      this.cache = { ...CALENDAR_CONFIG_DEFAULTS }
    }
  }

  get(): CalendarSchedulingConfig {
    return this.cache ?? { ...CALENDAR_CONFIG_DEFAULTS }
  }

  async save(input: unknown): Promise<void> {
    const config = calendarConfigSchema.parse(input)
    await configStore.set(this.db, CONFIG_KEY, JSON.stringify(config))
    this.cache = config
  }

  async reload(): Promise<void> {
    await this.load()
  }
}
