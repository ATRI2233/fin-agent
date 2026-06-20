/**
 * Local hook bundling the AgentsPage tool catalogue: every available
 * tool (builtin + MCP + custom) plus a per-agent whitelist fetcher.
 *
 * Uses the FastAPI endpoint `GET /api/v1/tools` as the single source
 * of truth for the tool catalogue (unified data source).
 */

import { useCallback, useMemo } from 'react';

import { useTools, fetchAllowedTools } from '../../../hooks/useMcp';

/**
 * Local tool descriptor used by the Edit modal's whitelist picker.
 *
 * `key` is a stable identifier — `${server}_${name}` for MCP tools,
 * `name` for builtin / custom tools — and is what the backend stores
 * in `tools_whitelist`.
 */
export interface AgentToolItem {
  key: string;
  title: string;
  description: string;
  source: 'mcp' | 'custom' | 'builtin';
  category?: string;
  mcpServer?: string;
}

export interface UseAgentToolsResult {
  availableTools: AgentToolItem[];
  loading: boolean;
  error: Error | null;
  refetch: () => void;
  /**
   * Fetch the whitelist for `agentName`. Resolves to an empty list
   * when the agent has no whitelist configured (treated as "allow all").
   */
  fetchToolsWhitelist: (agentName: string) => Promise<string[]>;
}

/**
 * Fetch the merged tool catalogue plus a per-agent whitelist fetcher.
 *
 * @returns `{ availableTools, loading, error, refetch, fetchToolsWhitelist }`.
 */
export function useAgentTools(): UseAgentToolsResult {
  const { data: rawTools, isLoading, error, refetch } = useTools();

  const availableTools = useMemo<AgentToolItem[]>(
    () =>
      (rawTools ?? []).map((t) => ({
        key: t.server ? `${t.server}_${t.name}` : t.name,
        title: t.name,
        description: t.description || '',
        source: (t.source ?? 'mcp') as 'mcp' | 'custom' | 'builtin',
        category: t.category || '其他',
        mcpServer: t.server || undefined,
      })),
    [rawTools],
  );

  const fetchToolsWhitelist = useCallback(
    async (agentName: string): Promise<string[]> => {
      try {
        return await fetchAllowedTools(agentName);
      } catch {
        // No whitelist configured for this agent — treat as "allow all".
        return [];
      }
    },
    [],
  );

  return {
    availableTools,
    loading: isLoading,
    error: error as Error | null,
    refetch,
    fetchToolsWhitelist,
  };
}
