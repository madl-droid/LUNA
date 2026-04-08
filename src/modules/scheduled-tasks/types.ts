// scheduled-tasks/types.ts — Domain types

/** Recipient: who this task targets */
export interface TaskRecipient {
  type: 'none' | 'group' | 'user'
  group?: string        // user list type: 'admin', 'coworker', 'lead', or custom
  userId?: string       // specific user within the group
}

/** Action: what the task does beyond the LLM prompt */
export interface TaskAction {
  type: 'llm' | 'tool' | 'message' | 'hook'
  /** For type=tool: tool name to execute */
  toolName?: string
  /** For type=tool: tool input params */
  toolInput?: Record<string, unknown>
  /** For type=message: message text (supports {{result}} placeholder for LLM output) */
  messageText?: string
  /** For type=message: channel to send through */
  messageChannel?: string
  /** For type=hook: hook name to fire */
  hookName?: string
  /** For type=hook: hook payload */
  hookPayload?: Record<string, unknown>
}

/** Trigger condition: when the task activates */
export type TriggerType = 'cron' | 'event' | 'manual'

export interface ScheduledTask {
  id: string
  name: string
  prompt: string
  cron: string
  enabled: boolean
  trigger_type: TriggerType
  trigger_event: string | null      // for event-based: hook name (e.g. 'contact:new')
  recipient: TaskRecipient
  actions: TaskAction[]
  created_at: string
  updated_at: string
  last_run_at: string | null
  last_result: string | null
  last_status: 'success' | 'error' | null
}

export interface CreateTaskInput {
  name: string
  prompt: string
  cron?: string          // resolved from preset (or placeholder for non-cron)
  cron_preset?: string   // preset value (e.g. '5min', '1h', '1d')
  enabled?: boolean
  trigger_type?: TriggerType
  trigger_event?: string | null
  recipient?: TaskRecipient
  actions?: TaskAction[]
}

export interface UpdateTaskInput {
  name?: string
  prompt?: string
  cron?: string
  cron_preset?: string   // preset value (e.g. '5min', '1h', '1d')
  enabled?: boolean
  trigger_type?: TriggerType
  trigger_event?: string | null
  recipient?: TaskRecipient
  actions?: TaskAction[]
}

/** Cron presets — no free-text cron allowed in UI */
export interface CronPreset {
  value: string  // unique key (e.g. '5min', '1h', '1d')
  cron: string   // actual cron expression
  label: { es: string; en: string }
  group: string  // for optgroup rendering
}

export const CRON_PRESETS: CronPreset[] = [
  // Minutes
  { value: '5min',  cron: '*/5 * * * *',   label: { es: 'Cada 5 minutos', en: 'Every 5 minutes' }, group: 'minutes' },
  { value: '15min', cron: '*/15 * * * *',  label: { es: 'Cada 15 minutos', en: 'Every 15 minutes' }, group: 'minutes' },
  { value: '30min', cron: '*/30 * * * *',  label: { es: 'Cada 30 minutos', en: 'Every 30 minutes' }, group: 'minutes' },
  // Hours
  { value: '1h',  cron: '0 * * * *',     label: { es: 'Cada hora', en: 'Every hour' }, group: 'hours' },
  { value: '2h',  cron: '0 */2 * * *',   label: { es: 'Cada 2 horas', en: 'Every 2 hours' }, group: 'hours' },
  { value: '6h',  cron: '0 */6 * * *',   label: { es: 'Cada 6 horas', en: 'Every 6 hours' }, group: 'hours' },
  { value: '12h', cron: '0 */12 * * *',  label: { es: 'Cada 12 horas', en: 'Every 12 hours' }, group: 'hours' },
  // Days
  { value: '1d',  cron: '0 9 * * *',     label: { es: 'Diario (9 AM)', en: 'Daily (9 AM)' }, group: 'days' },
  { value: '3d',  cron: '0 9 */3 * *',   label: { es: 'Cada 3 dias (9 AM)', en: 'Every 3 days (9 AM)' }, group: 'days' },
  { value: '5d',  cron: '0 9 * * 1-5',   label: { es: 'Lun-Vie (9 AM)', en: 'Mon-Fri (9 AM)' }, group: 'days' },
  // Weeks
  { value: '1w',  cron: '0 9 * * 1',     label: { es: 'Semanal (Lun 9 AM)', en: 'Weekly (Mon 9 AM)' }, group: 'weeks' },
  { value: '2w',  cron: '0 9 1,15 * *',  label: { es: 'Quincenal (1 y 15, 9 AM)', en: 'Bi-weekly (1st & 15th, 9 AM)' }, group: 'weeks' },
  // Month
  { value: '1m',  cron: '0 9 1 * *',     label: { es: 'Mensual (dia 1, 9 AM)', en: 'Monthly (1st, 9 AM)' }, group: 'months' },
]

/** Resolve a cron preset value to its expression. Returns null if not found. */
export function cronPresetToCron(presetValue: string): string | null {
  return CRON_PRESETS.find(p => p.value === presetValue)?.cron ?? null
}

/** Find the preset value for a given cron expression. Returns null if custom/legacy. */
export function cronToPresetValue(cron: string): string | null {
  return CRON_PRESETS.find(p => p.cron === cron)?.value ?? null
}

export interface TaskExecution {
  id: string
  task_id: string
  started_at: string
  finished_at: string | null
  status: 'running' | 'success' | 'error'
  result: string | null
  error: string | null
}

export interface ScheduledTasksConfig {
  SCHEDULED_TASKS_ENABLED: boolean
  SCHEDULED_TASKS_MAX_CONCURRENT: number
  SCHEDULED_TASKS_EXECUTION_TIMEOUT_MS: number
  /** Max messages a scheduled task can send to a single contact per hour. 0 = unlimited. */
  SCHEDULED_TASKS_MAX_MSG_PER_CONTACT_PER_HOUR: number
}

/** Lightweight user group info for the UI dropdown */
export interface UserGroupInfo {
  listType: string
  displayName: string
  isEnabled: boolean
  users: Array<{ id: string; senderId: string; displayName: string | null; channel: string }>
}
