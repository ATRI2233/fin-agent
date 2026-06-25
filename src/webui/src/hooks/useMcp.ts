import { useQuery, type UseQueryOptions } from "@tanstack/react-query";
import { listTools, listServers, listAllowedTools } from "../api/mcp";
import type { ToolItem } from "../api/mcp";

export const mcpKeys = {
  all: ["mcp"] as const,
  tools: () => [...mcpKeys.all, "tools"] as const,
  servers: () => [...mcpKeys.all, "servers"] as const,
  allowedTools: (name: string) => [...mcpKeys.all, "allowed-tools", name] as const,
};

export function useTools(options?: Omit<UseQueryOptions<ToolItem[], Error, ToolItem[]>, 'queryKey' | 'queryFn'>) {
  return useQuery<ToolItem[]>({
    queryKey: mcpKeys.tools(),
    queryFn: ({ signal }) => listTools(signal),
    staleTime: 60_000,
    ...options,
  });
}

export function useServers() {
  return useQuery({
    queryKey: mcpKeys.servers(),
    queryFn: ({ signal }) => listServers(signal),
    refetchInterval: 30_000,
  });
}

export function useAllowedTools(name: string | undefined) {
  return useQuery({
    queryKey: mcpKeys.allowedTools(name ?? ""),
    queryFn: ({ signal }) => listAllowedTools(name!, signal),
    enabled: !!name,
  });
}

export { listAllowedTools as fetchAllowedTools } from "../api/mcp";
export type { ToolItem } from "../api/mcp";