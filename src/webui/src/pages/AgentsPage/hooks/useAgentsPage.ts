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
 */
export interface AgentMeta extends Pick<Agent, 'name' | 'description' | 'mode'> {}

/**
 * Adapter: canonical `Agent` → page-level `AgentMeta`.
 * Drops the optional registry-only fields the table does not display.
 */
function toAgentMeta(agent: Agent): AgentMeta {
  return {
    name: agent.name,
    description: agent.description,
    mode: agent.mode,
  };
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

  const CHUNK_SIZE = 4;

  const fetchAllWhitelistCounts = useCallback(async (list: Agent[]) => {
    const counts: Record<string, number> = {};
    for (let i = 0; i < list.length; i += CHUNK_SIZE) {
      const chunk = list.slice(i, i + CHUNK_SIZE);
      const results = await Promise.all(
        chunk.map((agent) =>
          fetchAllowedTools(agent.name)
            .then((whitelist) => ({ name: agent.name, count: whitelist.length }))
            .catch(() => ({ name: agent.name, count: undefined as number | undefined })),
        ),
      );
      for (const r of results) {
        if (typeof r.count === 'number') counts[r.name] = r.count;
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
    agents: (data ?? []).map(toAgentMeta),
    loading,
    error: error?.message ?? null,
    refetch,
    agentWhitelistCounts,
  };
}
