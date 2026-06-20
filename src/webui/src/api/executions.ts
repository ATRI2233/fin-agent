/**
 * Typed wrappers for the Execution API.
 *
 * Source of truth: `src/main/api/v1/executions.py`
 * (FastAPI router at `/api/v1/executions`). Each function maps 1:1 to a
 * route handler and preserves the snake_case wire format — do NOT
 * auto-convert field names; the server speaks snake_case and the WebUI
 * must consume it as-is.
 *
 * The transport layer (`apiGet` / `apiPost`) is defined in `./http`
 * and is responsible for base-URL resolution, JSON encoding, error
 * normalisation, and response unwrapping.
 *
 * Exported symbols (de-facto `__all__`):
 * - listExecutions — GET /api/v1/executions
 * - getExecution — GET /api/v1/executions/{id}
 * - abortExecution — POST /api/v1/executions/{id}/abort
 * - retryNode — POST /api/v1/executions/{execId}/nodes/{nodeId}/retry
 */

import { apiGet, apiPost } from './http'
import type {
  Execution,
  ExecutionListResponse,
} from '../types/execution'
import { ROUTES } from './contract'

/**
 * GET `/api/v1/executions` — list execution records with optional filters.
 *
 * Only `workflow_id`, `limit`, and `offset` are accepted by the backend
 * (`src/main/api/v1/executions.py:125-130`). Other legacy filter keys
 * (`conversation_id`, `status`) have been removed from the contract.
 *
 * @param params.workflow_id Optional workflow UUID to scope the list.
 * @param params.limit Page size (backend default 20).
 * @param params.offset Rows to skip from the start of the result
 * set (backend default 0).
 * @returns A page of execution rows plus the total matching count.
 */
export async function listExecutions(params?: {
  workflow_id?: string
  limit?: number
  offset?: number
}): Promise<ExecutionListResponse> {
  const search = new URLSearchParams()
  if (params?.workflow_id !== undefined) {
    search.set('workflow_id', params.workflow_id)
  }
  if (params?.limit !== undefined) {
    search.set('limit', String(params.limit))
  }
  if (params?.offset !== undefined) {
    search.set('offset', String(params.offset))
  }

  const query = search.toString()
  const url = query.length > 0
    ? `${ROUTES.executions.list}?${query}`
    : ROUTES.executions.list

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
  return apiGet<Execution>(ROUTES.executions.get(id))
}

/**
 * POST `/api/v1/executions/{id}/abort` — abort a running execution and
 * clean up its sessions.
 *
 * NOTE: previously this endpoint was wired as DELETE on the frontend,
 * but the backend uses POST (see `src/main/api/v1/executions.py:172`).
 *
 * @param id Server-assigned execution UUID to abort.
 * @returns Envelope with `execution_id`, `aborted`, and the latest
 * `execution` payload.
 */
export async function abortExecution(id: string): Promise<{
  execution_id: string
  aborted: boolean
  execution: Record<string, unknown>
}> {
  return apiPost<{
    execution_id: string
    aborted: boolean
    execution: Record<string, unknown>
  }>(ROUTES.executions.abort(id))
}

/**
 * POST `/api/v1/executions/{execId}/nodes/{nodeId}/retry` — retry a
 * single failed node within an execution.
 *
 * Replaces the legacy `retryExecution(executionId)` helper, which
 * targeted a non-existent `/executions/{id}/retry` endpoint. The
 * backend supports per-node retry only
 * (`src/main/api/v1/executions.py:199`).
 *
 * @param execId Server-assigned execution UUID.
 * @param nodeId Node UUID within the execution's DAG.
 * @returns `RetryResult` dict (`success`, optional `node`, `error`).
 */
export async function retryNode(
  execId: string,
  nodeId: string,
): Promise<Record<string, unknown>> {
  return apiPost<Record<string, unknown>>(ROUTES.executions.retry(execId, nodeId))
}