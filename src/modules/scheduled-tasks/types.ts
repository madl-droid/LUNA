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
  cron: string
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
  enabled?: boolean
  trigger_type?: TriggerType
  trigger_event?: string | null
  recipient?: TaskRecipient
  actions?: TaskAction[]
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
}

/** Lightweight user group info for the UI dropdown */
export interface UserGroupInfo {
  listType: string
  displayName: string
  isEnabled: boolean
  users: Array<{ id: string; senderId: string; displayName: string | null; channel: string }>
}
