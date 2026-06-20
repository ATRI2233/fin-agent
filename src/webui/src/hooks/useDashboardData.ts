/**
 * Aggregated server-data hook for the Dashboard page.
 *
 * Wraps `listAgents` / `listTools` / `listServers` in a single `useQueries`
 * call so Dashboard.tsx can read all three datasets via a single hook and
 * get a uniform `isLoading` / `isError` / `refetch` view.
 *
 * Conventions mirror the per-domain hooks (`useMcp`, `useAgents`):
 * 10s refetch interval, `signal`-aware fetchers, snake-case query keys.
 *
 * Note: `listAgents` from `../api/agents` does not accept an `AbortSignal`
 * in its current signature, so we call it without forwarding the signal.
 * The underlying `apiGet` still handles component-unmount lifecycle.
 */
import { useQueries } from "@tanstack/react-query";
import { listAgents } from "../api/agents";
import { listTools, listServers } from "../api/mcp";
import type { Agent, ToolItem } from "../types/agent";

export interface DashboardData {
  agents: Agent[];
  tools: ToolItem[];
  servers: unknown[];
  isLoading: boolean;
  isError: boolean;
  refetch: () => void;
}

export function useDashboardData(): DashboardData {
  const results = useQueries({
    queries: [
      {
        queryKey: ["agents", "list"],
        queryFn: () => listAgents(),
        refetchInterval: 10_000,
      },
      {
        queryKey: ["mcp", "tools"],
        queryFn: ({ signal }: { signal: AbortSignal }) => listTools(signal),
        refetchInterval: 10_000,
      },
      {
        queryKey: ["mcp", "servers"],
        queryFn: ({ signal }: { signal: AbortSignal }) => listServers(signal),
        refetchInterval: 30_000,
      },
    ],
    combine: (results) => ({
      agents: (results[0].data as Agent[] | undefined) ?? [],
      tools: (results[1].data as ToolItem[] | undefined) ?? [],
      servers: (results[2].data as unknown[] | undefined) ?? [],
      isLoading: results.some((r) => r.isLoading),
      isError: results.some((r) => r.isError),
      refetch: () => results.forEach((r) => r.refetch()),
    }),
  });
  return results;
}
