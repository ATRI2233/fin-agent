/**
 * Local hook bundling the AgentsPage model state: a name → model map
 * for the table column, plus a batch-apply helper.
 *
 * The data is loaded via `useOpencodeAgentModels` (React Query) so the
 * fetch is shared with other consumers of the same endpoint. The
 * batch apply goes through `useBatchSetOpencodeAgentModel`, which
 * invalidates the `opencodeKeys.all` tree on success — the read
 * hook above will refetch automatically, so the UI updates without
 * an explicit `refetch()` call from the caller.
 *
 * The mutation returns the updated name → model map; we surface the
 * count of bound agents as a `Promise<number>` to keep the historic
 * public contract of `applyBatchModel`.
 */

import { useCallback } from 'react';

import {
  useOpencodeAgentModels,
  useBatchSetOpencodeAgentModel,
} from '../../../hooks/useOpencode';

export interface UseAgentModelsResult {
  /** Name → currently-bound model id. Missing entries render as "—". */
  agentModels: Record<string, string>;
  loading: boolean;
  error: Error | null;
  refetch: () => void;
  /** Apply a model to every agent; resolves to the number of agents bound. */
  applyBatchModel: (model: string) => Promise<number>;
  /** True while the batch mutation is in-flight. */
  batchLoading: boolean;
}

/**
 * Fetch per-agent model assignments and provide a batch-apply helper.
 *
 * @returns `{ agentModels, loading, error, refetch, applyBatchModel, batchLoading }`.
 */
export function useAgentModels(): UseAgentModelsResult {
  const { data, isLoading, error, refetch } = useOpencodeAgentModels();
  const batchMutation = useBatchSetOpencodeAgentModel();

  const applyBatchModel = useCallback(
    async (model: string): Promise<number> => {
      const result = await batchMutation.mutateAsync(model);
      return Object.keys(result ?? {}).length;
    },
    [batchMutation],
  );

  return {
    agentModels: data?.models ?? {},
    loading: isLoading,
    error: error as Error | null,
    refetch: () => {
      void refetch();
    },
    applyBatchModel,
    batchLoading: batchMutation.isPending,
  };
}
