import type { NodeResult } from "../executor.js";

/**
 * ExecutionTracker -- single responsibility: track node results, failures, skips.
 *
 * Encapsulates the Maps and Sets that WorkflowRunner previously managed inline.
 */
export class ExecutionTracker {
  readonly results: Record<string, NodeResult> = {};
  readonly failedNodes = new Set<string>();
  readonly skippedNodes = new Set<string>();
  readonly completedPromises = new Map<string, Promise<void>>();

  /** Check if any predecessor failed. */
  hasFailedPredecessor(predecessorIds: string[]): boolean {
    return predecessorIds.some((pid) => this.failedNodes.has(pid));
  }

  /** Record a successful node result. */
  recordSuccess(nodeId: string, result: NodeResult): void {
    this.results[nodeId] = result;
  }

  /** Record a failed node. */
  recordFailure(nodeId: string): void {
    this.failedNodes.add(nodeId);
  }

  /** Record skipped nodes (from downstream propagation). */
  recordSkipped(nodeIds: string[]): void {
    for (const sid of nodeIds) {
      this.skippedNodes.add(sid);
    }
  }

  /** Record a single skipped node. */
  recordSkippedSingle(nodeId: string): void {
    this.skippedNodes.add(nodeId);
  }

  /** Get final summary arrays. */
  toSummary(): { failedNodes: string[]; skippedNodes: string[] } {
    return {
      failedNodes: Array.from(this.failedNodes),
      skippedNodes: Array.from(this.skippedNodes),
    };
  }
}
