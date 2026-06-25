/**
 * React hooks wrapping `api/agents.ts` — the agent registry surface.
 * Every hook uses `useQuery` from @tanstack/react-query so
 * loading / error / cache semantics stay uniform across the app.
 *
 * Mount points and HTTP verbs are documented in `api/agents.ts:1-21`;
 * types come from `domain/agent.ts`. Consumers should import hooks
 * from this module rather than calling `api/agents.ts` directly from
 * components.
 *
 * Conventions:
 * - Read hooks return `{ data, loading, error, refetch }` and re-run
 * when any of their argument dependencies change. Fetchers receive
 * an `AbortSignal` even though the underlying `api/agents.ts`
 * helpers do not yet forward it — the contract is preserved so we
 * can switch to the signal-aware client without rewriting the hooks.
 * - Read hooks that take a nullable id (`useAgent`) short-circuit when
 * the argument is `null`: the query is disabled and `data` remains
 * `null`. Callers should gate on the argument before consuming `data`.
 */

import { useQuery } from '@tanstack/react-query';

import { getAgent, listAgents } from '../api/agents';
import type { Agent, AgentDetail } from '../domain/agent';

/* ─── Query keys ──────────────────────────────────────────────────── */

export const agentKeys = {
  all: ['agents'] as const,
  list: () => [...agentKeys.all, 'list'] as const,
  detail: (name: string) => [...agentKeys.all, 'detail', name] as const,
};

/* ─── Read hooks (2) ───────────────────────────────────────────────── */

/**
 * List every registered agent (summary view).
 * Re-runs on mount only; pair with `refetch` after registry changes to
 * keep the agents page in sync.
 */
export function useAgents() {
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: agentKeys.list(),
    queryFn: () => listAgents(),
  });
  return { data: data ?? null, loading: isLoading, error: error as Error | null, refetch };
}

/**
 * Fetch a single agent by registry name.
 *
 * Short-circuits when `name` is `null` (e.g. nothing is selected): the
 * query is disabled and `data` remains `null`. Callers should gate on the name
 * before consuming `data`. The backend raises 404 for unknown names,
 * which surfaces as `error` on the result.
 *
 * @param name Agent registry name (e.g. `"Macro-Scout"`), or `null` to
 * skip the request.
 */
export function useAgent(name: string | null) {
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: agentKeys.detail(name ?? ''),
    queryFn: () => {
      if (!name) return Promise.resolve<AgentDetail | null>(null);
      return getAgent(name);
    },
    enabled: !!name,
  });
  return { data: data ?? null, loading: isLoading, error: error as Error | null, refetch };
}
