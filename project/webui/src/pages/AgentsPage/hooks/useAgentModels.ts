/**
 * Local hook bundling the AgentsPage model state: a name → model map
 * for the table column, plus a batch-set helper for the modal.
 *
 * The map auto-fetches on mount via the Wave 5 `useFetch` primitive
 * (the proxy may not be ready yet, so the fetcher swallows that
 * error and returns an empty map — the previous behaviour). The
 * batch-set is a one-shot `opencodePost` call wrapped to mirror the
 * same `apply` style as the framework mutation hooks.
 *
 * @see ../../../hooks/useFetch for the lifecycle primitive.
 * @see ../../../api/opencode for the proxy wrappers.
 */

import { useCallback, useState } from 'react';

import { useFetch } from '../../../hooks/useFetch';
import { opencodeGet, opencodePost } from '../../../api/opencode';

export interface BatchModelResponse {
  /** Number of agents whose model was updated by the batch call. */
  agentCount: number;
}

/**
 * Fetcher for the name → model map. The proxy may not be ready yet on
 * first call; swallow that error and return an empty map so the
 * page renders the "—" placeholder rather than blocking on retry.
 */
async function fetchModelMap(_signal: AbortSignal): Promise<Record<string, string>> {
  try {
    const data = await opencodeGet<{ models?: Record<string, string> }>(
      '/agents/models',
    );
    return data.models || {};
  } catch {
    return {};
  }
}

export interface UseAgentModelsResult {
  /** Name → currently-bound model id. Missing entries render as "—". */
  agentModels: Record<string, string>;
  loading: boolean;
  error: Error | null;
  refetch: () => void;
  /**
   * Apply `model` to every agent via `/agents/batch-model`. Resolves
   * with the number of agents updated; rejects on validation or
   * network errors (the caller is responsible for surfacing the toast).
   */
  applyBatchModel: (model: string) => Promise<number>;
  /**
   * `true` while a `applyBatchModel` call is in flight. Tracked
   * separately from the catalogue `loading` flag so the page can
   * disable the batch "Apply" button without disabling the table
   * itself.
   */
  batchLoading: boolean;
}

/**
 * Fetch and apply per-agent model assignments.
 *
 * @returns `{ agentModels, loading, error, refetch, applyBatchModel, batchLoading }`.
 */
export function useAgentModels(): UseAgentModelsResult {
  const fetcher = useCallback(fetchModelMap, []);
  const { data, loading, error, refetch } = useFetch<Record<string, string>>(
    fetcher,
    [],
  );
  const [batchLoading, setBatchLoading] = useState<boolean>(false);

  const applyBatchModel = useCallback(async (model: string): Promise<number> => {
    setBatchLoading(true);
    try {
      const res = await opencodePost<BatchModelResponse>(
        '/agents/batch-model',
        { model },
      );
      return res.agentCount;
    } finally {
      setBatchLoading(false);
    }
  }, []);

  return {
    agentModels: data ?? {},
    loading,
    error,
    refetch,
    applyBatchModel,
    batchLoading,
  };
}
