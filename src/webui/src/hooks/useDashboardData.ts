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
import { apiGet, ApiError } from "../api/http";
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
        queryKey: ["system", "health"],
        queryFn: async () => {
          await apiGet<{ status: string; version: string }>(
            `${API_V1_BASE}/health`,
          );
          return true;
        },
        refetchInterval: 10_000,
      },
    ],
    combine: (results) => ({
      agents: (results[0].data as Agent[] | undefined) ?? [],
      tools: (results[1].data as ToolItem[] | undefined) ?? [],
      servers: (results[2].data as unknown[] | undefined) ?? [],
      skillsCount: 0, // OpenClaw Control UI 接管 Skills 管理
      systemOnline: (results[3].data as boolean | undefined) ?? false,
      isLoading: results.some((r) => r.isLoading),
      isError: results.some((r) => r.isError),
      refetch: () => results.forEach((r) => r.refetch()),
    }),
  });
  return results;
}
