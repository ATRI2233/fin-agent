/**
 * Aggregated server-data hook for the Dashboard page.
 *
 * Wraps `listAgents` / `listTools` / system health in a single
 * `useQueries` call so Dashboard.tsx can read all three datasets via
 * a single hook and get a uniform `isLoading` / `isError` / `refetch`
 * view.
 *
 * Conventions mirror the per-domain hooks (`useMcp`, `useAgents`):
 * 10s refetch interval, `signal`-aware fetchers, snake-case query keys.
 */
import { useQueries } from "@tanstack/react-query";
import { listAgents } from "../api/agents";
import { listTools } from "../api/mcp";
import { API_V1_BASE } from "../config/env";
import { apiGet } from "../api/http";
import type { Agent, ToolItem } from "../domain/agent";
import { agentKeys } from "./useAgents";
import { mcpKeys } from "./useMcp";

export interface DashboardData {
  agents: Agent[];
  tools: ToolItem[];
  systemOnline: boolean;
  isLoading: boolean;
  isError: boolean;
  errors: Array<{ query: string; error: Error | null }>;
  refetch: () => void;
}

export function useDashboardData(): DashboardData {
  const results = useQueries({
    queries: [
      {
        queryKey: agentKeys.list(),
        queryFn: ({ signal }) => listAgents(signal),
        refetchInterval: 10_000,
      },
      {
        queryKey: mcpKeys.tools(),
        queryFn: ({ signal }: { signal: AbortSignal }) => listTools(signal),
        refetchInterval: 10_000,
      },
      {
        queryKey: ["system", "health"],
        queryFn: async ({ signal }: { signal: AbortSignal }) => {
          await apiGet<{ status: string; version: string }>(
            `${API_V1_BASE}/health`,
            signal,
          );
          return true;
        },
        refetchInterval: 10_000,
      },
    ],
    combine: (results) => {
      function isAgentArray(v: unknown): v is Agent[] {
        return Array.isArray(v) && v.every((item) => typeof item === 'object' && item !== null && 'name' in item);
      }
      function isToolArray(v: unknown): v is ToolItem[] {
        return Array.isArray(v);
      }
      function isBoolean(v: unknown): v is boolean {
        return typeof v === 'boolean';
      }
      const hasData = results.some((r) => r.data !== undefined);
      return {
        agents: isAgentArray(results[0].data) ? results[0].data : [],
        tools: isToolArray(results[1].data) ? results[1].data : [],
        systemOnline: isBoolean(results[2].data) ? results[2].data : false,
        isLoading: !hasData && results.some((r) => r.isLoading),
        isError: !hasData && results.every((r) => r.isError),
        errors: [
          { query: 'agents', error: results[0].error ?? null },
          { query: 'tools', error: results[1].error ?? null },
          { query: 'health', error: results[2].error ?? null },
        ],
        refetch: () => results.forEach((r) => r.refetch()),
      };
    },
  });
  return results;
}
