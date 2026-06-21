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
 * not surface.
 */
export interface AgentMeta extends Pick<Agent, 'name' | 'description' | 'mode'> {
  /** Local source path; framework summary does not include this. */
  filePath?: string;
}

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

  const fetchAllWhitelistCounts = useCallback(async (list: Agent[]) => {
    const results = await Promise.all(
      list.map((agent) =>
        fetchAllowedTools(agent.name)
          .then((whitelist) => ({ name: agent.name, count: whitelist.length }))
          .catch(() => ({ name: agent.name, count: undefined as number | undefined })),
      ),
    );
    const counts: Record<string, number> = {};
    for (const r of results) {
      if (typeof r.count === 'number') counts[r.name] = r.count;
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
