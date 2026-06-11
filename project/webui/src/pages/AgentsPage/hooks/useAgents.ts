/**
 * Local hook bundling the AgentsPage table data: the agent list plus
 * a per-agent whitelist count map (used by the "Tools 白名单" column).
 *
 * Wraps the framework-level `useAgents` hook (Wave 5 — `hooks/useAgents.ts`)
 * for the registry list so the page benefits from the same loading /
 * error / abort semantics as the dashboard. The per-agent whitelist
 * counts are an agents-page concern only — the framework list does not
 * surface them — so this module owns the second fetch.
 *
 * Both fetches delegate to the typed `opencodeGet` helper, so no raw
 * `fetch(` calls live in this module.
 *
 * @see ../../../hooks/useAgents for the framework-level list hook.
 * @see ../../../api/opencode for the proxy wrappers.
 */

import { useCallback, useEffect, useState } from 'react';

import { useAgents as useFrameworkAgents } from '../../../hooks/useAgents';
import { opencodeGet } from '../../../api/opencode';
import type { Agent } from '../../../types/agent';

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
  filePath: string;
}

export interface UseAgentsResult {
  agents: AgentMeta[];
  loading: boolean;
  error: string | null;
  refetch: () => void;
  /** Map of agent name → whitelist size. Missing entries render as "...". */
  agentWhitelistCounts: Record<string, number>;
}

export function useAgents(): UseAgentsResult {
  const { data, loading, error, refetch } = useFrameworkAgents();
  const [agentWhitelistCounts, setAgentWhitelistCounts] = useState<Record<string, number>>({});

  const fetchAllWhitelistCounts = useCallback(async (list: Agent[]) => {
    const counts: Record<string, number> = {};
    for (const agent of list) {
      try {
        const res = await opencodeGet<{ tools_whitelist?: string[] }>(
          `/agents/${encodeURIComponent(agent.name)}/tools-whitelist`,
        );
        counts[agent.name] = res.tools_whitelist?.length || 0;
      } catch {
        // No whitelist configured for this agent — leave the count
        // undefined so the table renders the "..." placeholder.
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
