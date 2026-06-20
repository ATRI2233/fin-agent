import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { listExecutions, getExecution, abortExecution, retryNode } from "../api/executions";

export const executionKeys = {
  all: ["executions"] as const,
  list: (params?: unknown) => [...executionKeys.all, "list", params] as const,
  detail: (id: string) => [...executionKeys.all, "detail", id] as const,
};

export function useExecutions(params?: { workflow_id?: string }) {
  return useQuery({
    queryKey: executionKeys.list(params),
    queryFn: ({ signal }) => listExecutions(params, signal),
    refetchInterval: 5_000,
  });
}

export function useExecution(id: string | undefined) {
  return useQuery({
    queryKey: executionKeys.detail(id ?? ""),
    queryFn: ({ signal }) => getExecution(id!, signal),
    enabled: !!id,
    refetchInterval: 3_000,
  });
}

export function useAbortExecution() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => abortExecution(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: executionKeys.all }),
  });
}

export function useRetryNode() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ execId, nodeId }: { execId: string; nodeId: string }) =>
      retryNode(execId, nodeId),
    onSuccess: () => qc.invalidateQueries({ queryKey: executionKeys.all }),
  });
}
