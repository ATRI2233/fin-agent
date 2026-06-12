/**
 * TypeScript types for the Execution API.
 *
 * Source of truth: `project/main/framework/controllers/executions.py`
 * + `project/main/framework/services/execution_query_service.py`
 * (Pydantic V2). Field names are kept in snake_case to match the wire
 * format — FastAPI + Pydantic v2 do NOT auto-convert to camelCase, so
 * what the server emits is exactly what the client must consume.
 *
 * These types are the canonical contract for Wave 1 task 1.5; the
 * three page files (WorkflowMonitor / NodeDataPanel / ExecutionTimeline)
 * still carry local duplicates that will be migrated to import from
 * here in a later wave.
 *
 * Exported symbols (the de-facto `__all__` for this module):
 *   - NodeStatus         — per-node lifecycle union
 *   - NodeExec           — single node entry returned in a timeline
 *   - ExecutionStatus    — workflow-execution lifecycle union
 *   - Execution          — single execution row (list / detail)
 *   - ExecutionListResponse — GET /api/v1/executions response body
 *   - TimelineResponse   — GET /api/v1/executions/{id}/timeline body
 *   - RetryResponse      — POST /api/v1/executions/{id}/retry body
 */

/**
 * Per-node execution lifecycle. Note the distinction from
 * {@link ExecutionStatus}: nodes use `skipped` (DAG branch bypassed)
 * while workflow executions use `cancelled` (user abort).
 */
export type NodeStatus = 'pending' | 'running' | 'completed' | 'failed' | 'skipped' | 'cleaned_up';

/**
 * A single node entry in an execution timeline.
 *
 * Mirrors the Pydantic `TimelineNode` model. Superset of the backend
 * fields — `inputs`, `outputs`, `error`, and `agent_response` are
 * surfaced by the monitor UI even though `TimelineResponse` is the
 * primary carrier.
 */
export interface NodeExec {
  /** Server-assigned node UUID. */
  node_id: string;
  /** Agent name dispatched for this node (e.g. 'fusion-brain'). */
  agent: string;
  /** Current lifecycle state. */
  status: NodeStatus;
  /** ISO-8601 UTC timestamp when the node started executing. */
  started_at?: string;
  /** ISO-8601 UTC timestamp when the node finished (success or fail). */
  completed_at?: string;
  /** Wall-clock duration in seconds, computed server-side. */
  duration_seconds?: number;
  /** HAPI session ID bound to this node (for cleanup / debugging). */
  session_id?: string;
  /** Number of retry attempts so far (0 on first try). */
  retry_count?: number;
  /** Node input payload (free-form, matches the page UI). */
  inputs?: Record<string, unknown>;
  /** Node output payload (free-form, matches the page UI). */
  outputs?: Record<string, unknown>;
  /** Last error message when `status === 'failed'`. */
  error?: string;
  /** Raw agent text reply rendered in the side panel. */
  agent_response?: string;
}

/**
 * Workflow-execution lifecycle. Distinct from {@link NodeStatus}:
 * `cancelled` replaces `skipped` because the whole execution was
 * aborted by the user (DELETE /api/v1/executions/{id}).
 */
export type ExecutionStatus =
  | 'pending'
  | 'running'
  | 'completed'
  | 'failed'
  | 'cancelled';

/**
 * A single execution record (list row / detail body).
 *
 * Mirrors the Pydantic `ExecutionSummary` model plus a few optional
 * fields (`error`, `params`, `result`) that the detail endpoint
 * surfaces but the list summary omits.
 */
export interface Execution {
  /** Server-assigned execution UUID. */
  id: string;
  /** Owning workflow UUID. */
  workflow_id: string;
  /** Current lifecycle state. */
  status: ExecutionStatus;
  /** ISO-8601 UTC timestamp when execution started. */
  started_at: string;
  /** ISO-8601 UTC timestamp when execution ended (success or fail). */
  ended_at?: string;
  /** Wall-clock duration in milliseconds (server-computed). */
  duration_ms?: number;
  /** Top-level error message when `status === 'failed'`. */
  error?: string;
  /** Parameters passed to the workflow at trigger time. */
  params?: Record<string, unknown>;
  /** Final aggregated result payload (workflow-defined shape). */
  result?: Record<string, unknown>;
}

/**
 * Response body for `GET /api/v1/executions`.
 *
 * Mirrors the Pydantic `ExecutionListResponse` model. Pagination
 * uses `skip` / `limit` on the frontend; the backend field is
 * `offset` — the fetch layer is responsible for the rename.
 */
export interface ExecutionListResponse {
  /** Page of execution rows. */
  executions: Execution[];
  /** Total matching rows (across all pages). */
  total: number;
  /** Number of rows skipped from the start of the result set. */
  offset: number;
  /** Maximum rows returned in this page. */
  limit: number;
}

/**
 * Response body for `GET /api/v1/executions/{id}/timeline`.
 *
 * Mirrors the Pydantic `TimelineResponse` model. Carries the
 * execution scope plus the ordered node timeline.
 */
export interface TimelineResponse {
  /** Owning execution UUID. */
  execution_id: string;
  /** Node timeline in execution order (topological). */
  nodes: NodeExec[];
}

/**
 * Response body for `POST /api/v1/executions/{id}/retry`.
 *
 * Mirrors the Pydantic `RetryResponse` model. The new execution
 * runs out-of-band; clients should poll `GET /api/v1/executions/{id}`
 * with the returned `execution_id` to observe progress.
 */
export interface RetryResponse {
  /** UUID of the freshly created retry execution. */
  execution_id: string;
  /** Initial status — typically 'pending' or 'running'. */
  status: string;
}
