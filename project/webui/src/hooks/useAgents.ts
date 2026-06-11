/**
 * React hooks wrapping `api/agents.ts` — the agent registry surface.
 * Every hook defers to the generic `useFetch` primitive (Wave 5.1) so
 * loading / error / abort semantics stay uniform across the app.
 *
 * Mount points and HTTP verbs are documented in `api/agents.ts:1-21`;
 * types come from `types/agent.ts`. Consumers should import hooks
 * from this module rather than calling `api/agents.ts` directly from
 * components.
 *
 * Conventions:
 *   - Read hooks return `{ data, loading, error, refetch }` and re-run
 *     when any of their argument dependencies change. Fetchers receive
 *     an `AbortSignal` even though the underlying `api/agents.ts`
 *     helpers do not yet forward it — the contract is preserved so we
 *     can switch to the signal-aware client without rewriting the hooks.
 *   - Read hooks that take a nullable id (`useAgent`) short-circuit when
 *     the argument is `null`: the fetcher returns a never-resolving
 *     promise so `loading` stays `true`, signalling "still waiting for
 *     input". Callers should gate on the argument before consuming
 *     `data`.
 */

import { useCallback } from 'react';

import { getAgent, getAgentStats, listAgents } from '../api/agents';
import type { AgentStatsEntry } from '../api/agents';
import type { Agent, AgentDetail } from '../types/agent';
import { useFetch } from './useFetch';

/* ─── Read hooks (3) ───────────────────────────────────────────────── */

/**
 * List every registered agent (summary view).
 * Re-runs on mount only; pair with `refetch` after registry changes to
 * keep the agents page in sync.
 */
export function useAgents() {
  const fetcher = useCallback(
    (_signal: AbortSignal) => listAgents(),
    [],
  );
  return useFetch<Agent[]>(fetcher, []);
}

/**
 * Fetch execution telemetry for all agents in a single round-trip
 * (`GET /api/v1/agents/stats`). The result is a name-keyed map — see
 * {@link AgentStatsEntry} for the per-agent payload shape.
 */
export function useAgentStats() {
  const fetcher = useCallback(
    (_signal: AbortSignal) => getAgentStats(),
    [],
  );
  return useFetch<Record<string, AgentStatsEntry>>(fetcher, []);
}

/**
 * Fetch a single agent by registry name.
 *
 * Short-circuits when `name` is `null` (e.g. nothing is selected): the
 * fetcher returns a never-resolving promise so `loading` stays `true`,
 * signalling "still waiting for input". Callers should gate on the name
 * before consuming `data`. The backend raises 404 for unknown names,
 * which surfaces as `error` on the result.
 *
 * @param name Agent registry name (e.g. `"Macro-Scout"`), or `null` to
 *   skip the request.
 */
export function useAgent(name: string | null) {
  const fetcher = useCallback(
    (_signal: AbortSignal) => {
      if (!name) {
        // Suspended — never resolves so `loading` stays true and the
        // consumer can distinguish "no selection" via the name check.
        return new Promise<AgentDetail>(() => undefined);
      }
      return getAgent(name);
    },
    [name],
  );
  return useFetch<AgentDetail>(fetcher, [name]);
}
