// scheduled-tasks/types.ts — Domain types

export interface ScheduledTask {
  id: string
  name: string
  prompt: string
  cron: string
  enabled: boolean
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
}

export interface UpdateTaskInput {
  name?: string
  prompt?: string
  cron?: string
  enabled?: boolean
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
