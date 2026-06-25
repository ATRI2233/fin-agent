import { transition, type ExecutionStatus } from "./domain.js";

/**
 * ExecutionDomainService — domain/graph-layer logic that operates on execution data.
 *
 * Keeps BFS traversal (markDownstreamSkipped) out of the data-access repo,
 * respecting the Single Responsibility Principle.
 */
export interface IExecutionDomainService {
  markDownstreamSkipped(executionId: string, failedNodeId: string): string[];
}

export class ExecutionDomainService implements IExecutionDomainService {
  /**
   * @param repo - An execution repository instance (e.g. ExecutionRepo or a test fake).
   */
  constructor(private repo: {
    getExecutionNodes(executionId: string): Array<{
      id: string;
      nodeId: string;
      status: ExecutionStatus;
      input: unknown;
    }>;
    recordNodeSkipped(executionId: string, nodeId: string): void;
  }) {}

  /**
   * BFS from the failed node: finds every pending node that transitively
   * references the output of a failed/skipped node (via its `input`),
   * marks it skipped in the DB, and returns the sorted list of skipped node IDs.
   */
  markDownstreamSkipped(executionId: string, failedNodeId: string): string[] {
    const nodes = this.repo.getExecutionNodes(executionId);
    const pendingRows = nodes.filter((r) => r.status === "pending");

    const skippedIds: string[] = [];
    const processed = new Set<string>();
    const queue = [failedNodeId];

    while (queue.length > 0) {
      const current = queue.shift()!;
      if (processed.has(current)) continue;
      processed.add(current);

      for (const row of pendingRows) {
        const nid = row.nodeId;
        if (processed.has(nid)) continue;
        if (nid === failedNodeId) continue;
        if (this._inputReferences(row.input, current)) {
          try {
            transition(row.status as ExecutionStatus, "skipped");
            this.repo.recordNodeSkipped(executionId, nid);
            skippedIds.push(nid);
            queue.push(nid);
            processed.add(nid);
          } catch {
            // 转换失败（如状态机不允许 pending→skipped），跳过此节点继续处理
            // 避免因单个节点导致已写入 DB 的变更残留
            processed.add(nid);
          }
        }
      }
    }

    skippedIds.sort();
    return skippedIds;
  }

  /** Deep-check whether `input` (any shape) references `nodeId`. */
  private _inputReferences(input: unknown, nodeId: string, visited?: Set<object>): boolean {
    if (input == null) return false;
    if (typeof input === "string") return input === nodeId;
    if (typeof input === "object") {
      if (!visited) visited = new Set();
      if (visited.has(input)) return false;
      visited.add(input);
      if (Array.isArray(input)) return input.some((v) => this._inputReferences(v, nodeId, visited));
      for (const [k, v] of Object.entries(input as Record<string, unknown>)) {
        if (k === nodeId || this._inputReferences(v, nodeId, visited)) return true;
      }
    }
    return false;
  }
}
