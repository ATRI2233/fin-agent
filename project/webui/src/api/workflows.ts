/**
 * Typed wrappers for the workflow CRUD + scheduler HTTP routes.
 *
 * Mount points (see `main/framework/controllers/workflows.py` and
 * `main/framework/controllers/scheduler.py`):
 *
 *   POST   /api/v1/workflows                  → createWorkflow
 *   GET    /api/v1/workflows                  → listWorkflows
 *   GET    /api/v1/workflows/stats            → getWorkflowStats
 *   GET    /api/v1/workflows/{id}             → getWorkflow
 *   PUT    /api/v1/workflows/{id}             → updateWorkflow
 *   DELETE /api/v1/workflows/{id}             → deleteWorkflow
 *   POST   /api/v1/workflows/{id}/trigger     → triggerWorkflow
 *   POST   /api/v1/workflows/{id}/schedule    → scheduleWorkflow
 *   DELETE /api/v1/workflows/{id}/schedule    → unscheduleWorkflow
 *   GET    /api/v1/workflows/scheduled        → listScheduled
 *
 * All functions return parsed JSON, or `void` for 204 endpoints. Errors
 * are surfaced as `Error` instances with the HTTP status + body.
 */

import { API_V1_BASE } from '../config/env'
import type {
  Workflow,
  WorkflowMeta,
  WorkflowStats,
} from '../types/workflow'

/* ─── Payload types ───────────────────────────────────────────────── */

export interface CreateWorkflowPayload {
  name: string
  description?: string
  nodes?: Workflow['nodes']
  edges?: Workflow['edges']
  trigger_type?: Workflow['trigger_type']
  config?: Workflow['config']
}

export interface UpdateWorkflowPayload {
  name?: string
  description?: string
  nodes?: Workflow['nodes']
  edges?: Workflow['edges']
  trigger_type?: Workflow['trigger_type']
  config?: Workflow['config']
}

export interface TriggerParams {
  [key: string]: unknown
}

export interface TriggerResult {
  execution_id: string
}

export interface ScheduleResult {
  workflow_id: string
  cron_expression: string
  status: string
}

export interface ScheduledJob {
  workflow_id: string
  cron_expression: string
  job_id: string
  next_run_times: string[]
}

/* ─── Fetch helper ───────────────────────────────────────────────── */

/** Internal JSON request. For 204 returns `undefined as T`; callers
 *  expecting an empty body must declare `Promise<void>`. */
async function request<T>(
  method: 'GET' | 'POST' | 'PUT' | 'DELETE',
  path: string,
  body?: unknown,
): Promise<T> {
  const hasBody = body !== undefined
  const res = await fetch(`${API_V1_BASE}${path}`, {
    method,
    headers: hasBody ? { 'Content-Type': 'application/json' } : undefined,
    body: hasBody ? JSON.stringify(body) : undefined,
  })
  if (!res.ok) {
    const detail = await res.text().catch(() => res.statusText)
    throw new Error(`API ${method} ${path} failed: ${res.status} ${res.statusText} — ${detail}`)
  }
  if (res.status === 204) return undefined as T
  return (await res.json()) as T
}

/* ─── Workflow CRUD (7) ──────────────────────────────────────────── */

/** List workflows (summary view, newest first). `GET /api/v1/workflows?skip=&limit=`. */
export function listWorkflows(
  skip: number = 0,
  limit: number = 1000,
): Promise<WorkflowMeta[]> {
  const qs = new URLSearchParams({ skip: String(skip), limit: String(limit) })
  return request<WorkflowMeta[]>('GET', `/workflows?${qs.toString()}`)
}

/** Aggregated execution statistics. `GET /api/v1/workflows/stats`. */
export function getWorkflowStats(): Promise<WorkflowStats> {
  return request<WorkflowStats>('GET', '/workflows/stats')
}

/** Get a single workflow by id (full detail). `GET /api/v1/workflows/{id}`. Throws on 404. */
export function getWorkflow(id: string): Promise<Workflow> {
  return request<Workflow>('GET', `/workflows/${encodeURIComponent(id)}`)
}

/** Create a new workflow. Backend validates the DAG (rejects cycles, > 50 nodes).
 *  `POST /api/v1/workflows` — 201 Created. */
export function createWorkflow(data: CreateWorkflowPayload): Promise<Workflow> {
  return request<Workflow>('POST', '/workflows', data)
}

/** Update a workflow; undefined fields are omitted (backend `exclude_none=True`).
 *  Re-validates the DAG when `nodes` or `edges` change. `PUT /api/v1/workflows/{id}`. */
export function updateWorkflow(
  id: string,
  data: UpdateWorkflowPayload,
): Promise<Workflow> {
  return request<Workflow>('PUT', `/workflows/${encodeURIComponent(id)}`, data)
}

/** Delete a workflow and cascade-delete its executions.
 *  `DELETE /api/v1/workflows/{id}` — 204 No Content. */
export function deleteWorkflow(id: string): Promise<void> {
  return request<void>('DELETE', `/workflows/${encodeURIComponent(id)}`)
}

/** Trigger a workflow run asynchronously. `POST /api/v1/workflows/{id}/trigger` — 202.
 *  @param params Free-form input forwarded to the engine (defaults to `{}`). */
export function triggerWorkflow(
  id: string,
  params?: TriggerParams,
): Promise<TriggerResult> {
  return request<TriggerResult>(
    'POST',
    `/workflows/${encodeURIComponent(id)}/trigger`,
    { params: params ?? {} },
  )
}

/* ─── Scheduler (3) ──────────────────────────────────────────────── */

/** Schedule a workflow with a 5-field cron expression (`min hour day month weekday`).
 *  `POST /api/v1/workflows/{id}/schedule` — 201. Throws on 400 if cron is invalid. */
export function scheduleWorkflow(
  id: string,
  cron: string,
): Promise<ScheduleResult> {
  return request<ScheduleResult>(
    'POST',
    `/workflows/${encodeURIComponent(id)}/schedule`,
    { cron_expression: cron },
  )
}

/** Remove a scheduled workflow job; resets `trigger_type` back to `"manual"`.
 *  `DELETE /api/v1/workflows/{id}/schedule` — 204. Throws on 404 if no job exists. */
export function unscheduleWorkflow(id: string): Promise<void> {
  return request<void>('DELETE', `/workflows/${encodeURIComponent(id)}/schedule`)
}

/** List all scheduled workflow jobs (in-memory APScheduler registry).
 *  `GET /api/v1/workflows/scheduled`. `next_run_times` are ISO-8601 strings. */
export function listScheduled(): Promise<ScheduledJob[]> {
  return request<ScheduledJob[]>('GET', '/workflows/scheduled')
}
