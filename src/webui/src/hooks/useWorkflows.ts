/**
 * React hooks wrapping `api/workflows.ts` — the workflow CRUD
 * surface. Every hook defers to `@tanstack/react-query`'s `useQuery` /
 * `useMutation` so caching, loading, and error semantics stay uniform
 * across the app.
 *
 * Mount points are documented in `api/workflows.ts`; types come from
 * `domain/workflow.ts`. Consumers should import hooks from this module
 * rather than calling `api/workflows.ts` directly from components.
 *
 * Conventions:
 * - Read hooks return `{ data, loading, error, refetch }` and re-run
 * when any of their argument dependencies change.
 * - Read hooks that take a nullable id (`useWorkflow`) short-circuit
 * via `enabled: !!id`: the query never fires and `data` is `null`.
 * - Mutation hooks return `{ mutate, loading, error }`; callers
 * `await mutate(...)` to surface the resolved value or throw. On
 * success the workflow list cache is invalidated automatically.
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';

import {
  createWorkflow,
  deleteWorkflow,
  getWorkflow,
  listWorkflows,
  triggerWorkflow,
  updateWorkflow,
} from '../api/workflows';
import type { UpdateWorkflowPayload } from '../domain/workflow';

/* ─── Query keys ─────────────────────────────────────────────────── */

export const workflowKeys = {
  all: ['workflows'] as const,
  list: (skip?: number, limit?: number) =>
    [...workflowKeys.all, 'list', skip ?? 0, limit ?? 50] as const,
  detail: (id: string | null) =>
    [...workflowKeys.all, 'detail', id] as const,
};

/* ─── Read hooks (2) ───────────────────────────────────────────────── */

/**
 * List workflows (summary view, newest first).
 * Re-fetches when `skip` or `limit` change.
 *
 * @param skip Number of rows to skip (pagination). Default 0.
 * @param limit Page size. Default 50 (matches backend default).
 */
export function useWorkflows(skip: number = 0, limit: number = 50, enabled: boolean = true) {
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: workflowKeys.list(skip, limit),
    queryFn: ({ signal }) => listWorkflows(skip, limit, signal),
    enabled,
  });
  return {
    data: data ?? null,
    loading: isLoading,
    error: (error as Error | null) ?? null,
    refetch,
  };
}

/**
 * Fetch a single workflow by id. The hook short-circuits when `id` is
 * `null` (e.g. nothing is selected), so callers may render
 * unconditionally and inspect `loading` / `error` to decide what to show.
 *
 * @param id Workflow id, or `null` to skip the request.
 */
export function useWorkflow(id: string | null) {
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: workflowKeys.detail(id),
    queryFn: ({ signal }) => getWorkflow(id!, signal),
    enabled: !!id,
  });
  return {
    data: data ?? null,
    loading: isLoading,
    error: (error as Error | null) ?? null,
    refetch,
  };
}

/* ─── Write hooks — CRUD + run (5) ──────────────────────────────────── */

/**
 * Create a new workflow. Backend validates the DAG (rejects cycles,
 * > 50 nodes) and returns 201 with the persisted row.
 */
export function useCreateWorkflow() {
  const queryClient = useQueryClient();
  const { mutateAsync, isPending, error } = useMutation({
    mutationFn: (data: Parameters<typeof createWorkflow>[0]) =>
      createWorkflow(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: workflowKeys.all });
    },
  });
  return {
    mutate: mutateAsync,
    loading: isPending,
    error: (error as Error | null) ?? null,
  };
}

/**
 * Update an existing workflow. Undefined fields are omitted by the
 * backend (`exclude_none=True`); the DAG is re-validated when
 * `nodes` or `edges` change.
 */
export function useUpdateWorkflow() {
  const queryClient = useQueryClient();
  const { mutateAsync, isPending, error } = useMutation({
    mutationFn: ({
      id,
      data,
    }: {
      id: string;
      data: UpdateWorkflowPayload;
    }) => updateWorkflow(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: workflowKeys.all });
    },
  });
  return {
    mutate: mutateAsync,
    loading: isPending,
    error: (error as Error | null) ?? null,
  };
}

/**
 * Delete a workflow (cascade-deletes its executions). Resolves to
 * `void`; backend returns 204 No Content.
 */
export function useDeleteWorkflow() {
  const queryClient = useQueryClient();
  const { mutateAsync, isPending, error } = useMutation({
    mutationFn: (id: string) => deleteWorkflow(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: workflowKeys.all });
    },
  });
  return {
    mutate: mutateAsync,
    loading: isPending,
    error: (error as Error | null) ?? null,
  };
}

/**
 * Trigger a workflow run asynchronously. Backend returns 202 with
 * `{ execution_id }`. Free-form `params` are forwarded to the engine.
 */
export function useTriggerWorkflow() {
  const queryClient = useQueryClient();
  const { mutateAsync, isPending, error } = useMutation({
    mutationFn: ({
      id,
      params,
    }: {
      id: string;
      params?: Parameters<typeof triggerWorkflow>[1];
    }) => triggerWorkflow(id, params),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: workflowKeys.all });
    },
  });
  return {
    mutate: mutateAsync,
    loading: isPending,
    error: (error as Error | null) ?? null,
  };
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
