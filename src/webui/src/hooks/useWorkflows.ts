/**
 * React hooks wrapping `api/workflows.ts` — the workflow CRUD
 * surface. Every hook defers to the generic `useFetch` / `useMutation`
 * primitives so loading / error / abort semantics stay
 * uniform across the app.
 *
 * Mount points are documented in `api/workflows.ts`; types come from
 * `domain/workflow.ts`. Consumers should import hooks from this module
 * rather than calling `api/workflows.ts` directly from components.
 *
 * Conventions:
 * - Read hooks return `{ data, loading, error, refetch }` and re-run
 * when any of their argument dependencies change.
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
  listWorkflows,
  triggerWorkflow,
  updateWorkflow,
} from '../api/workflows';
import type {
  Workflow,
  WorkflowMeta,
  UpdateWorkflowPayload,
} from '../domain/workflow';
import { useFetch } from './useFetch';
import { useMutation } from './useMutation';

/* ─── Read hooks (2) ───────────────────────────────────────────────── */

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

/* ─── Write hooks — CRUD + run (5) ──────────────────────────────────── */

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
    { id: string; data: UpdateWorkflowPayload },
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

/* ─── Imperative fetcher (for callbacks) ───────────────────────────── */

/**
 * One-shot fetcher for cases where `useWorkflow` cannot be used
 * (e.g. imperative lookups inside event handlers or callbacks).
 * Mirrors the API of `getWorkflow` from `api/workflows.ts`.
 */
export async function fetchWorkflow(id: string) {
  return getWorkflow(id);
}
