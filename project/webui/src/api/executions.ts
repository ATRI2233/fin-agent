/**
 * Typed wrappers for the Execution API.
 *
 * Source of truth: `project/main/framework/controllers/executions.py`
 * (FastAPI router at `/api/v1/executions`). Each function maps 1:1 to a
 * route handler and preserves the snake_case wire format — do NOT
 * auto-convert field names; the server speaks snake_case and the WebUI
 * must consume it as-is.
 *
 * The transport layer (`apiGet` / `apiPost` / `apiDelete`) is defined in
 * `./client` and is responsible for base-URL resolution, JSON encoding,
 * error normalisation, and response unwrapping.
 *
 * Exported symbols (de-facto `__all__`):
 *   - listExecutions        — GET    /api/v1/executions
 *   - getExecution          — GET    /api/v1/executions/{id}
 *   - getExecutionTimeline  — GET    /api/v1/executions/{id}/timeline
 *   - retryExecution        — POST   /api/v1/executions/{id}/retry
 *   - abortExecution        — DELETE /api/v1/executions/{id}
 */

import { API_V1_BASE } from '../config/env'
import { apiDelete, apiGet, apiPost } from './client'
import type {
  Execution,
  ExecutionListResponse,
  ExecutionStatus,
  RetryResponse,
  TimelineResponse,
} from '../types/execution'

/**
 * GET `/api/v1/executions` — list execution records with optional filters.
 *
 * All filter / pagination parameters are optional. `limit` and `offset`
 * map to the backend's `limit` / `offset` query params; the frontend
 * page state uses `skip` but the field is renamed inside the response
 * envelope (see {@link ExecutionListResponse}).
 *
 * @param params.workflow_id Optional workflow UUID to scope the list.
 * @param params.status      Optional lifecycle filter (see
 *                           {@link ExecutionStatus}).
 * @param params.limit       Page size (backend default 20).
 * @param params.offset      Rows to skip from the start of the result
 *                           set (backend default 0).
 * @returns A page of execution rows plus the total matching count.
 */
export async function listExecutions(params?: {
  workflow_id?: string
  status?: ExecutionStatus
  limit?: number
  offset?: number
}): Promise<ExecutionListResponse> {
  const search = new URLSearchParams()
  if (params?.workflow_id !== undefined) {
    search.set('workflow_id', params.workflow_id)
  }
  if (params?.status !== undefined) {
    search.set('status', params.status)
  }
  if (params?.limit !== undefined) {
    search.set('limit', String(params.limit))
  }
  if (params?.offset !== undefined) {
    search.set('offset', String(params.offset))
  }

  const query = search.toString()
  const url = query.length > 0
    ? `${API_V1_BASE}/executions?${query}`
    : `${API_V1_BASE}/executions`

  return apiGet<ExecutionListResponse>(url)
}

/**
 * GET `/api/v1/executions/{id}` — fetch a single execution by ID.
 *
 * Returns the full detail row including optional `error`, `params`, and
 * `result` payloads that the list-summary endpoint omits.
 *
 * @param id Server-assigned execution UUID.
 * @returns The execution row. Throws on 404 (not found) and 500.
 */
export async function getExecution(id: string): Promise<Execution> {
  return apiGet<Execution>(`${API_V1_BASE}/executions/${id}`)
}

/**
 * GET `/api/v1/executions/{id}/timeline` — fetch the node-level
 * execution timeline.
 *
 * The timeline carries every node in topological execution order, with
 * per-node lifecycle state, timing, retry count, and (when populated)
 * inputs / outputs / error / agent_response payloads.
 *
 * @param id Server-assigned execution UUID.
 * @returns Timeline envelope (`execution_id` + ordered `nodes`).
 *          Throws on 404 (execution not found).
 */
export async function getExecutionTimeline(id: string): Promise<TimelineResponse> {
  return apiGet<TimelineResponse>(`${API_V1_BASE}/executions/${id}/timeline`)
}

/**
 * POST `/api/v1/executions/{id}/retry` — retry a failed execution.
 *
 * The server creates a new execution row synchronously, then schedules
 * the actual workflow run out-of-band. The new `execution_id` returned
 * in the envelope should be polled via `getExecution` to observe
 * progress.
 *
 * @param id Server-assigned execution UUID to retry.
 * @returns `{ execution_id, status }` envelope for the freshly
 *          created retry execution.
 */
export async function retryExecution(id: string): Promise<RetryResponse> {
  return apiPost<RetryResponse>(`${API_V1_BASE}/executions/${id}/retry`)
}

/**
 * DELETE `/api/v1/executions/{id}` — abort a running execution and
 * clean up its HAPI sessions.
 *
 * The service marks the execution as failed synchronously and tears
 * down the sessions attached to it on the way out.
 *
 * @param id Server-assigned execution UUID to abort.
 * @returns `{ success: boolean }` envelope. Throws on 404 (not found)
 *          or 400 (e.g. execution is already in a terminal state).
 */
export async function abortExecution(id: string): Promise<{ success: boolean }> {
  return apiDelete<{ success: boolean }>(`${API_V1_BASE}/executions/${id}`)
}
