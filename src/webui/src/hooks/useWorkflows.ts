/**
 * React hooks wrapping `api/workflows.ts` — the workflow CRUD + scheduler
 * surface. Every hook defers to the generic `useFetch` / `useMutation`
 * primitives (see ) so loading / error / abort semantics stay
 * uniform across the app.
 *
 * Mount points are documented in `api/workflows.ts:1-20`; types come from
 * `domain/workflow.ts`. Consumers should import hooks from this module
 * rather than calling `api/workflows.ts` directly from components.
 *
 * Conventions:
 * - Read hooks return `{ data, loading, error, refetch }` and re-run
 * when any of their argument dependencies change. Fetchers receive
 * an `AbortSignal` even though the underlying `api/workflows.ts`
 * helpers do not yet forward it — the contract is preserved so we
 * can switch to the signal-aware client without rewriting the
 * hooks.
 * - Read hooks that take a nullable id (`useWorkflow`) short-circuit
 * inside the fetcher: when the id is `null` the promise resolves
 * with `null` and the hook reports `loading=false` immediately.
 * - Mutation hooks return `{ mutate, loading, error }`; callers
 * `await mutate(...)` to surface the resolved value or throw.
 */

import { useCallback } from 'react';

import {
  createWorkflow,
  deleteWorkflow,
  getWorkflow,
  getWorkflowStats,
  listScheduled,
  listWorkflows,
  scheduleWorkflow,
  triggerWorkflow,
  unscheduleWorkflow,
  updateWorkflow,
} from '../api/workflows';
import type {
  Workflow,
  WorkflowMeta,
  WorkflowStats,
} from '../domain/workflow';
import { useFetch } from './useFetch';
import { useMutation } from './useMutation';

/* ─── Read hooks (3) ───────────────────────────────────────────────── */

/**
 * List workflows (summary view, newest first).
 * Re-fetches when `skip` or `limit` change.
 *
 * @param skip Number of rows to skip (pagination). Default 0.
 * @param limit Page size. Default 1000 (matches backend default).
 */
export function useWorkflows(skip: number = 0, limit: number = 1000) {
  const fetcher = useCallback(
    (_signal: AbortSignal) => listWorkflows(skip, limit),
    [skip, limit],
  );
  return useFetch<WorkflowMeta[]>(fetcher, [skip, limit]);
}

/**
 * Aggregated execution statistics for the dashboard tiles
 * (`GET /api/v1/workflows/stats`).
 */
export function useWorkflowStats() {
  const fetcher = useCallback(
    (_signal: AbortSignal) => getWorkflowStats(),
    [],
  );
  return useFetch<WorkflowStats>(fetcher, []);
}

/**
 * Fetch a single workflow by id. The hook short-circuits when `id` is
 * `null` (e.g. nothing is selected), so callers may render
 * unconditionally and inspect `loading` / `error` to decide what to show.
 *
 * @param id Workflow id, or `null` to skip the request.
 */
export function useWorkflow(id: string | null) {
  const fetcher = useCallback(
    (_signal: AbortSignal) =>
      id === null ? Promise.resolve(null) : getWorkflow(id),
    [id],
  );
  return useFetch<Workflow | null>(fetcher, [id]);
}

/* ─── Write hooks — CRUD (4) ───────────────────────────────────────── */

/**
 * Create a new workflow. Backend validates the DAG (rejects cycles,
 * > 50 nodes) and returns 201 with the persisted row.
 */
export function useCreateWorkflow() {
  return useMutation<Parameters<typeof createWorkflow>[0], Workflow>(
    (data) => createWorkflow(data),
  );
}

/**
 * Update an existing workflow. Undefined fields are omitted by the
 * backend (`exclude_none=True`); the DAG is re-validated when
 * `nodes` or `edges` change.
 */
export function useUpdateWorkflow() {
  return useMutation<
    { id: string; data: Parameters<typeof updateWorkflow>[1] },
    Workflow
  >(({ id, data }) => updateWorkflow(id, data));
}

/**
 * Delete a workflow (cascade-deletes its executions). Resolves to
 * `void`; backend returns 204 No Content.
 */
export function useDeleteWorkflow() {
  return useMutation<string, void>((id) => deleteWorkflow(id));
}

/* ─── Write hooks — run + scheduler (3) ────────────────────────────── */

/**
 * Trigger a workflow run asynchronously. Backend returns 202 with
 * `{ execution_id }`. Free-form `params` are forwarded to the engine.
 */
export function useTriggerWorkflow() {
  return useMutation<
    { id: string; params?: Parameters<typeof triggerWorkflow>[1] },
    Awaited<ReturnType<typeof triggerWorkflow>>
  >(({ id, params }) => triggerWorkflow(id, params));
}

/**
 * Schedule a workflow with a 5-field cron expression
 * (`min hour day month weekday`). Throws on 400 if the cron is invalid.
 */
export function useScheduleWorkflow() {
  return useMutation<
    { id: string; cron: string },
    Awaited<ReturnType<typeof scheduleWorkflow>>
  >(({ id, cron }) => scheduleWorkflow(id, cron));
}

/**
 * Remove a scheduled workflow job; backend resets `trigger_type` back
 * to `"manual"`. Throws on 404 if no job exists.
 */
export function useUnscheduleWorkflow() {
  return useMutation<string, void>((id) => unscheduleWorkflow(id));
}

/* ─── Read hook — scheduled jobs (1) ───────────────────────────────── */

/**
 * List all scheduled workflow jobs (in-memory APScheduler registry).
 * Useful for the "Schedules" admin panel. The hook auto-refreshes on
 * mount only — pair with a manual `refetch` after scheduling /
 * unscheduling.
 */
export function useScheduledWorkflows() {
  const fetcher = useCallback(
    (_signal: AbortSignal) => listScheduled(),
    [],
  );
  return useFetch<Awaited<ReturnType<typeof listScheduled>>>(
    fetcher,
    [],
  );
}
