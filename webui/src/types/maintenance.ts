/**
 * Maintenance types — mirror Pydantic shapes in
 * `data_maintenance/controllers/data_maintenance.py`.
 *
 * snake_case is intentional: matches wire format from the backend.
 */

/** Maintenance task lifecycle status reported on each task row. */
export type TaskStatus = 'running' | 'success' | 'failed' | string

/** Scheduling strategy for a maintenance task. */
export type TaskTriggerType = 'cron' | 'manual' | 'interval' | string

/** Persisted maintenance task row. */
export interface Task {
  id: string
  name: string
  description: string
  agent: string
  prompt: string
  schedule: string | null
  enabled: boolean
  trigger_type: TaskTriggerType
  interval_seconds: number | null
  data_type: string
  last_run_at: string | null
  last_status: TaskStatus | null
  last_error: string | null
  created_at: string | null
  updated_at: string | null
}

/** Request body for POST /api/v1/data-maintenance/tasks. */
export interface TaskCreate {
  name: string
  description?: string
  agent: string
  prompt: string
  schedule?: string | null
  enabled?: boolean
  trigger_type?: TaskTriggerType
  interval_seconds?: number | null
  data_type?: string
}

/** Request body for PUT /api/v1/data-maintenance/tasks/{id}. */
export interface TaskUpdate {
  name?: string
  description?: string
  agent?: string
  prompt?: string
  schedule?: string | null
  enabled?: boolean
  trigger_type?: TaskTriggerType
  interval_seconds?: number | null
  data_type?: string
}

/** Single stored data record attached to a task. */
export interface DataRecord {
  id: number
  data_key: string
  content: unknown
  fetched_at: string | null
}

/** Single execution log row for a task. */
export interface Log {
  id: number
  status: TaskStatus
  duration_seconds: number | null
  records_updated: number | null
  error: string | null
  started_at: string | null
  completed_at: string | null
}

/** Response shape of GET /api/v1/data-maintenance/status. */
export interface StatusOverview {
  total_tasks: number
  enabled_tasks: number
  healthy_tasks: number
  failed_tasks: number
  tasks: Task[]
}
