/**
 * Typed wrappers for the Data Maintenance API.
 *
 * Source of truth:
 * `project/main/data_maintenance/controllers/data_maintenance.py`
 * (FastAPI router at `/api/v1/data-maintenance`, served by a separate
 * FastAPI app from the main framework). Each function maps 1:1 to a
 * route handler and preserves the snake_case wire format — do NOT
 * auto-convert field names; the server speaks snake_case and the
 * WebUI must consume it as-is.
 *
 * Transport layer (`apiGet` / `apiPost` / `apiPut` / `apiDelete`) is
 * defined in `./client` and is responsible for base-URL resolution,
 * JSON encoding, error normalisation, and response unwrapping.
 *
 * Exported symbols (de-facto `__all__`):
 *   - getStatus    — GET    /api/v1/data-maintenance/status
 *   - listTasks    — GET    /api/v1/data-maintenance/tasks
 *   - getTaskData  — GET    /api/v1/data-maintenance/tasks/{id}/data
 *   - getTaskLogs  — GET    /api/v1/data-maintenance/tasks/{id}/logs
 *   - runTask      — POST   /api/v1/data-maintenance/tasks/{id}/run
 *   - createTask   — POST   /api/v1/data-maintenance/tasks
 *   - updateTask   — PUT    /api/v1/data-maintenance/tasks/{id}
 *   - deleteTask   — DELETE /api/v1/data-maintenance/tasks/{id}
 */

import { MAINTENANCE_API_BASE } from '../config/env'
import { apiDelete, apiGet, apiPost, apiPut } from './client'
import type {
  Task,
  TaskCreate,
  TaskUpdate,
  DataRecord,
  Log,
  StatusOverview,
  TaskStatus,
  TaskTriggerType,
} from '../types/maintenance'

export type { Task, TaskCreate, TaskUpdate, DataRecord, Log, StatusOverview, TaskStatus, TaskTriggerType }

/**
 * GET `/api/v1/data-maintenance/status` — overview snapshot.
 *
 * The endpoint is exception-safe on the server and always returns 200;
 * when no tasks are configured, all counters are `0` and `tasks` is `[]`.
 *
 * @returns A {@link StatusOverview} with aggregate counts plus the
 *          full task list.
 */
export async function getStatus(): Promise<StatusOverview> {
  return apiGet<StatusOverview>(`${MAINTENANCE_API_BASE}/status`)
}

/**
 * GET `/api/v1/data-maintenance/tasks` — list all maintenance tasks.
 *
 * @returns Envelope with the `tasks` array, ordered by name server-side.
 */
export async function listTasks(): Promise<{ tasks: Task[] }> {
  return apiGet<{ tasks: Task[] }>(`${MAINTENANCE_API_BASE}/tasks`)
}

/**
 * GET `/api/v1/data-maintenance/tasks/{id}/data` — fetch stored data
 * records for a task, ordered by `fetched_at` descending.
 *
 * @param id Server-assigned task UUID.
 * @param limit Maximum number of records to return (backend default 50).
 * @returns Envelope containing the `data` array of {@link DataRecord}s.
 */
export async function getTaskData(
  id: string,
  limit?: number,
): Promise<{ data: DataRecord[] }> {
  const search = new URLSearchParams()
  if (limit !== undefined) {
    search.set('limit', String(limit))
  }
  const query = search.toString()
  const url = query.length > 0
    ? `${MAINTENANCE_API_BASE}/tasks/${id}/data?${query}`
    : `${MAINTENANCE_API_BASE}/tasks/${id}/data`
  return apiGet<{ data: DataRecord[] }>(url)
}

/**
 * GET `/api/v1/data-maintenance/tasks/{id}/logs` — fetch execution
 * logs for a task, ordered by `completed_at` descending.
 *
 * @param id Server-assigned task UUID.
 * @param limit Maximum number of log rows to return (backend default 20).
 * @returns Envelope containing the `logs` array of {@link Log}s.
 */
export async function getTaskLogs(
  id: string,
  limit?: number,
): Promise<{ logs: Log[] }> {
  const search = new URLSearchParams()
  if (limit !== undefined) {
    search.set('limit', String(limit))
  }
  const query = search.toString()
  const url = query.length > 0
    ? `${MAINTENANCE_API_BASE}/tasks/${id}/logs?${query}`
    : `${MAINTENANCE_API_BASE}/tasks/${id}/logs`
  return apiGet<{ logs: Log[] }>(url)
}

/**
 * POST `/api/v1/data-maintenance/tasks/{id}/run` — manually trigger a
 * task and wait for the synchronous result.
 *
 * The server-side handler is async and may take up to the dispatcher's
 * per-call timeout (currently 120s) before resolving.
 *
 * @param id Server-assigned task UUID.
 * @returns Envelope with `success` flag, `records_updated` count on
 *          success, and an optional `error` string on failure.
 */
export async function runTask(
  id: string,
): Promise<{ success: boolean; records_updated: number; error?: string }> {
  return apiPost<{ success: boolean; records_updated: number; error?: string }>(
    `${MAINTENANCE_API_BASE}/tasks/${id}/run`,
  )
}

/**
 * POST `/api/v1/data-maintenance/tasks` — create a new maintenance task.
 *
 * The server re-syncs the scheduler before returning, so a freshly
 * created cron task will be picked up on the next scheduler tick.
 *
 * @param data Task configuration (see {@link TaskCreate}).
 * @returns The created {@link Task} with server-assigned `id` and timestamps.
 */
export async function createTask(data: TaskCreate): Promise<Task> {
  return apiPost<Task>(`${MAINTENANCE_API_BASE}/tasks`, data)
}

/**
 * PUT `/api/v1/data-maintenance/tasks/{id}` — update mutable task fields.
 *
 * The server uses `model_dump(exclude_none=True)` and returns 400 if
 * no fields remain after filtering, so callers must supply at least
 * one mutable property. The scheduler is re-synced on success.
 *
 * @param id Server-assigned task UUID.
 * @param data Partial task patch (see {@link TaskUpdate}).
 * @returns The updated {@link Task} row.
 */
export async function updateTask(id: string, data: TaskUpdate): Promise<Task> {
  return apiPut<Task>(`${MAINTENANCE_API_BASE}/tasks/${id}`, data)
}

/**
 * DELETE `/api/v1/data-maintenance/tasks/{id}` — delete a task and
 * cascade its associated data and logs.
 *
 * The server returns 204 No Content on success; the client normalises
 * the empty body to `undefined`, hence the `Promise<void>` signature.
 *
 * @param id Server-assigned task UUID.
 */
export async function deleteTask(id: string): Promise<void> {
  return apiDelete<void>(`${MAINTENANCE_API_BASE}/tasks/${id}`)
}
