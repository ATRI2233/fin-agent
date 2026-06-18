/**
 * Typed wrappers for the workflow CRUD + scheduler HTTP routes.
 *
 * Mount points (see `main/framework/controllers/workflows.py` and
 * `main/framework/controllers/scheduler.py`):
 *
 * POST /api/v1/workflows → createWorkflow
 * GET /api/v1/workflows → listWorkflows
 * GET /api/v1/workflows/stats → getWorkflowStats
 * GET /api/v1/workflows/{id} → getWorkflow
 * PUT /api/v1/workflows/{id} → updateWorkflow
 * DELETE /api/v1/workflows/{id} → deleteWorkflow
 * POST /api/v1/workflows/{id}/trigger → triggerWorkflow
 * POST /api/v1/workflows/{id}/schedule → scheduleWorkflow
 * DELETE /api/v1/workflows/{id}/schedule → unscheduleWorkflow
 * GET /api/v1/workflows/scheduled → listScheduled
 */

import { API_V1_BASE } from '../config/env'
import { apiGet, apiPost, apiPut, apiDelete } from './client'
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

/* ─── Workflow CRUD (7) ──────────────────────────────────────────── */

/** List workflows (summary view, newest first). `GET /api/v1/workflows?skip=&limit=`. */
export function listWorkflows(
  skip: number = 0,
  limit: number = 1000,
  signal?: AbortSignal,
): Promise<WorkflowMeta[]> {
  const qs = new URLSearchParams({ skip: String(skip), limit: String(limit) })
  return apiGet<WorkflowMeta[]>(`${API_V1_BASE}/workflows?${qs.toString()}`, signal)
}

/** Aggregated execution statistics. `GET /api/v1/workflows/stats`. */
export function getWorkflowStats(signal?: AbortSignal): Promise<WorkflowStats> {
  return apiGet<WorkflowStats>(`${API_V1_BASE}/workflows/stats`, signal)
}

/** Get a single workflow by id (full detail). `GET /api/v1/workflows/{id}`. Throws on 404. */
export function getWorkflow(id: string, signal?: AbortSignal): Promise<Workflow> {
  return apiGet<Workflow>(`${API_V1_BASE}/workflows/${encodeURIComponent(id)}`, signal)
}

/** Create a new workflow. Backend validates the DAG (rejects cycles, > 50 nodes).
 * `POST /api/v1/workflows` — 201 Created. */
export function createWorkflow(data: CreateWorkflowPayload, signal?: AbortSignal): Promise<Workflow> {
  return apiPost<Workflow>(`${API_V1_BASE}/workflows`, data, signal)
}

/** Update a workflow; undefined fields are omitted (backend `exclude_none=True`).
 * Re-validates the DAG when `nodes` or `edges` change. `PUT /api/v1/workflows/{id}`. */
export function updateWorkflow(
  id: string,
  data: UpdateWorkflowPayload,
  signal?: AbortSignal,
): Promise<Workflow> {
  return apiPut<Workflow>(`${API_V1_BASE}/workflows/${encodeURIComponent(id)}`, data, signal)
}

/** Delete a workflow and cascade-delete its executions.
 * `DELETE /api/v1/workflows/{id}` — 204 No Content. */
export function deleteWorkflow(id: string, signal?: AbortSignal): Promise<void> {
  return apiDelete<void>(`${API_V1_BASE}/workflows/${encodeURIComponent(id)}`, signal)
}

/** Trigger a workflow run asynchronously. `POST /api/v1/workflows/{id}/trigger` — 202.
 * @param params Free-form input forwarded to the engine (defaults to `{}`). */
export function triggerWorkflow(
  id: string,
  params?: TriggerParams,
  signal?: AbortSignal,
): Promise<TriggerResult> {
  return apiPost<TriggerResult>(
    `${API_V1_BASE}/workflows/${encodeURIComponent(id)}/trigger`,
    { params: params ?? {} },
    signal,
  )
}

/* ─── Scheduler (3) ──────────────────────────────────────────────── */

/** Schedule a workflow with a 5-field cron expression (`min hour day month weekday`).
 * `POST /api/v1/workflows/{id}/schedule` — 201. Throws on 400 if cron is invalid. */
export function scheduleWorkflow(
  id: string,
  cron: string,
  signal?: AbortSignal,
): Promise<ScheduleResult> {
  return apiPost<ScheduleResult>(
    `${API_V1_BASE}/workflows/${encodeURIComponent(id)}/schedule`,
    { cron_expression: cron },
    signal,
  )
}

/** Remove a scheduled workflow job; resets `trigger_type` back to `"manual"`.
 * `DELETE /api/v1/workflows/{id}/schedule` — 204. Throws on 404 if no job exists. */
export function unscheduleWorkflow(id: string, signal?: AbortSignal): Promise<void> {
  return apiDelete<void>(`${API_V1_BASE}/workflows/${encodeURIComponent(id)}/schedule`, signal)
}

/** List all scheduled workflow jobs (in-memory APScheduler registry).
 * `GET /api/v1/workflows/scheduled`. `next_run_times` are ISO-8601 strings. */
export function listScheduled(signal?: AbortSignal): Promise<ScheduledJob[]> {
  return apiGet<ScheduledJob[]>(`${API_V1_BASE}/workflows/scheduled`, signal)
}
