/**
 * Canonical Workflow domain types — single source of truth for the WebUI.
 *
 * Field naming convention:
 * - snake_case for all fields that map 1:1 to the backend Pydantic/SQLAlchemy
 * payload (see `src/main/modules/workflow/service/workflow_query_service.py`).
 * - camelCase only for fields the backend itself returns camelCase
 * (e.g. `successRate` from `GET /api/v1/workflows/stats`).
 *
 * This module consolidates the previously-duplicated shapes that lived in:
 * - pages/ChatPage.tsx (Workflow)
 * - pages/WorkflowList.tsx (WorkflowMeta)
 * - pages/WorkflowSettings.tsx
 * - pages/FrameworkPage.tsx (WorkflowMeta, WorkflowStats)
 * - pages/Dashboard.tsx (WorkflowStats)
 * - pages/WorkflowMonitor.tsx (WorkflowExec, NodeExec #1)
 * - pages/NodeDataPanel.tsx (NodeExec #2)
 * - pages/ExecutionTimeline.tsx (NodeExec #3)
 * - pages/WorkflowEditor.tsx (EdgePromptData, WorkflowBlockNode)
 *
 * Page-level migration to import from here is tracked separately — this file
 * introduces the canonical surface without breaking existing local interfaces.
 */

/* ─── Enumerations ─────────────────────────────────────────────────────── */

/** Lifecycle state of a `Workflow` row. Mirrors backend `status` column. */
export type WorkflowStatus =
  | 'draft'
  | 'running'
  | 'completed'
  | 'failed'
  | 'paused';

/** How a workflow is invoked. Mirrors backend `trigger_type` column. */
export type WorkflowTriggerType = 'manual' | 'schedule' | 'command';

/* ─── DAG primitives ───────────────────────────────────────────────────── */

/**
 * A node inside a workflow DAG. Persisted as opaque JSON on the backend
 * (`workflow.nodes`), so additional fields are allowed via the index signature.
 */
export interface WorkflowNode {
  id: string;
  type?: string;
  data?: Record<string, unknown>;
  [key: string]: unknown;
}

/**
 * A directed edge in the workflow DAG. The optional `data` carries the
 * `EdgePrompt` (or any extension) describing how the upstream output feeds
 * the downstream node.
 */
export interface WorkflowEdge {
  id?: string;
  source: string;
  target: string;
  data?: EdgePrompt;
  [key: string]: unknown;
}

/**
 * Prompt payload attached to a `WorkflowEdge`. Used by the editor to render
 * edge labels and by the runtime to build the downstream node's input prompt.
 */
export interface EdgePrompt {
  /** The prompt text injected into the downstream node. */
  prompt: string;
  /** Optional gating expression (e.g. `"output.score > 0.7"`). */
  condition?: string;
}

/* ─── Workflow (canonical) ─────────────────────────────────────────────── */

/**
 * Canonical workflow shape returned by `GET /api/v1/workflows/{id}` and the
 * create/update endpoints. Field names match the backend 1:1.
 */
export interface Workflow {
  id: string;
  name: string;
  description?: string;
  status: WorkflowStatus;
  trigger_type: WorkflowTriggerType;
  /** Free-form per-workflow configuration (cron expression, defaults, etc.). */
  config?: Record<string, unknown>;
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
  created_at: string;
  updated_at: string;
}

/**
 * Slim view-model for list pages (`GET /api/v1/workflows`). Currently a
 * `Pick<>` of the canonical `Workflow`; extend cautiously — list responses
 * are unbounded and shape growth directly inflates payload size.
 */
export interface WorkflowMeta extends Pick<Workflow, 'id' | 'name' | 'status' | 'trigger_type'> {
  /** Number of nodes in the workflow DAG. */
  node_count?: number;
  /** ISO-8601 creation timestamp (list endpoint includes this). */
  created_at?: string;
  /** ISO-8601 timestamp of the most recent execution, or null. */
  last_run_at?: string | null;
}

/* ─── Aggregate shapes ──────────────────────────────────────────────── */

/**
 * Aggregated execution statistics returned by `GET /api/v1/workflows/stats`.
 * Note: `successRate` is camelCase because the backend returns it that way
 * (see `WorkflowQueryService.get_workflow_stats`). `total` is optional at
 * the wire level — some legacy endpoints omit it, so the type permits
 * `undefined` for backward compatibility.
 */
export interface WorkflowStats {
  total?: number;
  running: number;
  completed: number;
  failed: number;
  /** Percent (0–100), or `undefined` when no terminal runs have occurred. */
  successRate?: number;
}

/* ─── Public surface ─────────────────────────────────────────────────────
 * __all__: Workflow, WorkflowMeta, EdgePrompt, WorkflowStats,
 * WorkflowNode, WorkflowEdge,
 * WorkflowStatus, WorkflowTriggerType
 * ─────────────────────────────────────────────────────────────────────── */
