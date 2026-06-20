/**
 * `useAgentsPage` — page-level hook for AgentsPage.
 *
 * Wraps the framework-level `useAgents` hook and adds per-agent
 * whitelist count fetching.
 */

import { useCallback, useEffect, useState } from 'react';

import { useAgents as useFrameworkAgents } from '../../../hooks/useAgents';
import { fetchAllowedTools } from '../../../hooks/useMcp';
import type { Agent } from '../../../domain/agent';

/**
 * Table-row projection of an Agent — what the AgentsPage table lists.
 *
 * Mirrors the original `AgentMeta` declaration in `AgentsPage.tsx`,
 * with the additional `filePath` field that the framework summary does
 * not surface. The `as unknown as AgentMeta[]` cast at the bottom of
 * this file preserves the existing column shape without forcing a
 * refactor of the table props; a follow-up can either drop the column
 * or extend the framework summary to include the source path.
 */
export interface AgentMeta extends Pick<Agent, 'name' | 'description' | 'mode'> {
  /** Local source path; framework summary does not include this. */
  filePath?: string;
}

export interface UseAgentsResult {
  agents: AgentMeta[];
  loading: boolean;
  error: string | null;
  refetch: () => void;
  /** Map of agent name → whitelist size. Missing entries render as "...". */
  agentWhitelistCounts: Record<string, number>;
}

export function useAgentsPage(): UseAgentsResult {
  const { data, loading, error, refetch } = useFrameworkAgents();
  const [agentWhitelistCounts, setAgentWhitelistCounts] = useState<Record<string, number>>({});

  const fetchAllWhitelistCounts = useCallback(async (list: Agent[]) => {
    const counts: Record<string, number> = {};
    for (const agent of list) {
      try {
        const whitelist = await fetchAllowedTools(agent.name);
        counts[agent.name] = whitelist.length;
      } catch {
        // No whitelist configured — leave undefined for "..." placeholder.
      }
    }
    setAgentWhitelistCounts(counts);
  }, []);

  useEffect(() => {
    if (data && data.length > 0) {
      void fetchAllWhitelistCounts(data);
    }
  }, [data, fetchAllWhitelistCounts]);

  return {
    agents: (data as unknown as AgentMeta[]) ?? [],
    loading,
    error: error?.message ?? null,
    refetch,
    agentWhitelistCounts,
  };
}
