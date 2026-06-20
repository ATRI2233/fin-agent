/**
 * Typed wrappers for the workflow CRUD HTTP routes.
 *
 * Mount points (see `src/main/api/v1/workflows.py`):
 *
 * GET    /api/v1/workflows               → listWorkflows
 * POST   /api/v1/workflows               → createWorkflow
 * GET    /api/v1/workflows/{id}          → getWorkflow
 * PUT    /api/v1/workflows/{id}          → updateWorkflow
 * DELETE /api/v1/workflows/{id}          → deleteWorkflow
 * POST   /api/v1/workflows/{id}/trigger  → triggerWorkflow
 */

import { ROUTES } from './contract'
import { apiGet, apiPost, apiPut, apiDelete } from './http'
import type {
  Workflow,
  WorkflowMeta,
} from '../domain/workflow'

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

/* ─── Workflow CRUD ───────────────────────────────────────────────── */

/** List workflows (summary view, newest first). `GET /api/v1/workflows?offset=&limit=`. */
export function listWorkflows(
  offset: number = 0,
  limit: number = 1000,
  signal?: AbortSignal,
): Promise<WorkflowMeta[]> {
  const qs = new URLSearchParams({ offset: String(offset), limit: String(limit) })
  return apiGet<WorkflowMeta[]>(`${ROUTES.workflows.list}?${qs.toString()}`, signal)
}

/** Get a single workflow by id (full detail). `GET /api/v1/workflows/{id}`. Throws on 404. */
export function getWorkflow(id: string, signal?: AbortSignal): Promise<Workflow> {
  return apiGet<Workflow>(ROUTES.workflows.get(id), signal)
}

/** Create a new workflow. Backend validates the DAG (rejects cycles, > 50 nodes).
 * `POST /api/v1/workflows` — 201 Created. */
export function createWorkflow(data: CreateWorkflowPayload, signal?: AbortSignal): Promise<Workflow> {
  return apiPost<Workflow>(ROUTES.workflows.create, data, signal)
}

/** Update a workflow; undefined fields are omitted (backend `exclude_none=True`).
 * Re-validates the DAG when `nodes` or `edges` change. `PUT /api/v1/workflows/{id}`. */
export function updateWorkflow(
  id: string,
  data: UpdateWorkflowPayload,
  signal?: AbortSignal,
): Promise<Workflow> {
  return apiPut<Workflow>(ROUTES.workflows.update(id), data, signal)
}

/** Delete a workflow and cascade-delete its executions.
 * `DELETE /api/v1/workflows/{id}` — 204 No Content. */
export function deleteWorkflow(id: string, signal?: AbortSignal): Promise<void> {
  return apiDelete<void>(ROUTES.workflows.delete(id), signal)
}

/** Trigger a workflow run asynchronously. `POST /api/v1/workflows/{id}/trigger` — 202.
 * @param params Free-form input forwarded to the engine (defaults to `{}`). */
export function triggerWorkflow(
  id: string,
  params?: TriggerParams,
  signal?: AbortSignal,
): Promise<TriggerResult> {
  return apiPost<TriggerResult>(
    ROUTES.workflows.trigger(id),
    { params: params ?? {} },
    signal,
  )
}
