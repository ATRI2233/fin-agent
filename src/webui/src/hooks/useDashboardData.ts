/**
 * Aggregated server-data hook for the Dashboard page.
 *
 * Wraps `listAgents` / `listTools` / `listServers` / skills count /
 * system health in a single `useQueries` call so Dashboard.tsx can read
 * all five datasets via a single hook and get a uniform `isLoading` /
 * `isError` / `refetch` view.
 *
 * Conventions mirror the per-domain hooks (`useMcp`, `useAgents`):
 * 10s refetch interval, `signal`-aware fetchers, snake-case query keys.
 */
import { useQueries } from "@tanstack/react-query";
import { listAgents } from "../api/agents";
import { listTools, listServers } from "../api/mcp";
import { API_V1_BASE } from "../config/env";
import { apiGet } from "../api/http";
import type { Agent, ToolItem } from "../domain/agent";

export interface DashboardData {
  agents: Agent[];
  tools: ToolItem[];
  servers: unknown[];
  skillsCount: number;
  systemOnline: boolean;
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
      {
        queryKey: ["opencode", "skills", "count"],
        queryFn: async () => {
          // Single FastAPI round-trip — `/api/v1/skills/count` resolves
          // the active scope server-side from `.scope_prefs.json`, so
          // the dashboard no longer has to chain
          // `/v1/config/scope` → `/skills?scope=...` (which used to
          // bounce through the 9876 Express proxy and return a
          // non-envelope JSON shape).
          try {
            const data = await apiGet<{ count: number; scope: string }>(
              `${API_V1_BASE}/skills/count`,
            );
            return data.count;
          } catch {
            return 0;
          }
        },
        refetchInterval: 30_000,
      },
      {
        queryKey: ["system", "health"],
        queryFn: async () => {
          try {
            await apiGet<{ status: string; version: string }>(
              `${API_V1_BASE}/health`,
            );
            return true;
          } catch {
            return false;
          }
        },
        refetchInterval: 10_000,
      },
    ],
    combine: (results) => ({
      agents: (results[0].data as Agent[] | undefined) ?? [],
      tools: (results[1].data as ToolItem[] | undefined) ?? [],
      servers: (results[2].data as unknown[] | undefined) ?? [],
      skillsCount: (results[3].data as number | undefined) ?? 0,
      systemOnline: (results[4].data as boolean | undefined) ?? false,
      isLoading: results.some((r) => r.isLoading),
      isError: results.some((r) => r.isError),
      refetch: () => results.forEach((r) => r.refetch()),
    }),
  });
  return results;
}
