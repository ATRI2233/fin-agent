import pLimit from "p-limit";
import type { IExecutionRepo } from "../../execution/repo.js";
import type { ExecutionDomainService } from "../../execution/domain-service.js";
import type { IExecutorRegistry, NodeContext } from "../executor.js";
import { CircuitBreaker } from "./retry.js";
import { ExecutionTracker } from "./execution_tracker.js";
import { buildPredecessors, topologicalSort, type Workflow, type Node } from "../domain/dag.js";
import { settings } from "../../../infra/settings.js";

/**
 * NodeScheduler -- single responsibility: schedule and execute DAG nodes
 * respecting topology, concurrency limits, and circuit breakers.
 */
export class NodeScheduler {
  private circuitBreaker: CircuitBreaker;
  private limit: ReturnType<typeof pLimit>;

  constructor(
    private executionRepo: IExecutionRepo,
    private executionDomainService: ExecutionDomainService,
    private executorRegistry: IExecutorRegistry,
  ) {
    this.circuitBreaker = new CircuitBreaker(settings.CIRCUIT_BREAKER_THRESHOLD);
    this.limit = pLimit(settings.MAX_PARALLEL_NODES);
  }

  async executeAll(
    workflow: Workflow,
    executionId: string,
    params: Record<string, unknown>,
    traceId: string,
    tracker: ExecutionTracker,
  ): Promise<void> {
    const sortedIds = topologicalSort(workflow.nodes, workflow.edges);
    const preds = buildPredecessors(workflow.nodes, workflow.edges);

    const nodePromises: Promise<void>[] = [];

    for (const nodeId of sortedIds) {
      const node = workflow.nodes.find((n) => n.id === nodeId)!;
      const nodePromise = this.scheduleNode(
        node, workflow, executionId, params, preds, tracker, traceId
      );
      tracker.completedPromises.set(nodeId, nodePromise);
      nodePromises.push(nodePromise);
    }

    await Promise.all(nodePromises);
  }

  private async scheduleNode(
    node: Node,
    workflow: Workflow,
    executionId: string,
    params: Record<string, unknown>,
    preds: Map<string, string[]>,
    tracker: ExecutionTracker,
    traceId: string,
  ): Promise<void> {
    try {
      const predecessorIds = preds.get(node.id) ?? [];

      // Wait for predecessors
      for (const pid of predecessorIds) {
        const promise = tracker.completedPromises.get(pid);
        if (!promise) {
          this.executionRepo.recordNodeSkipped(executionId, node.id);
          tracker.recordSkippedSingle(node.id);
          return;
        }
        await promise;
      }

      // Skip if predecessor failed
      if (tracker.hasFailedPredecessor(predecessorIds)) {
        this.executionRepo.recordNodeSkipped(executionId, node.id);
        tracker.recordSkippedSingle(node.id);
        return;
      }

      // Circuit breaker check
      if (this.circuitBreaker.isOpen(executionId, node.id, traceId)) {
        this.executionRepo.recordNodeFailed(executionId, node.id, "Circuit breaker open");
        tracker.recordFailure(node.id);
        const skipped = this.executionDomainService.markDownstreamSkipped(executionId, node.id);
        tracker.recordSkipped(skipped);
        return;
      }

      // Execute
      await this.limit(async () => {
        try {
          this.executionRepo.recordNodeStarted(executionId, node.id);

          const executor = this.executorRegistry.create(node.type);
          const ctx: NodeContext = {
            node,
            executionId,
            predecessorIds,
            params,
            results: { ...tracker.results },
            edges: workflow.edges,
            traceId,
            failedNodes: new Set(tracker.failedNodes),
          };

          const result = await executor.execute(ctx);
          tracker.recordSuccess(node.id, result);

          this.executionRepo.recordNodeCompleted(
            executionId,
            node.id,
            result.output as Record<string, unknown>,
            result.sessionId ?? undefined,
          );
          this.circuitBreaker.reset(executionId, node.id, traceId);
        } catch (e) {
          const errorMsg = e instanceof Error ? e.message : String(e);
          this.executionRepo.recordNodeFailed(executionId, node.id, errorMsg);
          tracker.recordFailure(node.id);
          this.circuitBreaker.recordFailure(executionId, node.id, traceId);

          const skipped = this.executionDomainService.markDownstreamSkipped(executionId, node.id);
          tracker.recordSkipped(skipped);
        }
      });
    } catch (e) {
      const errorMsg = e instanceof Error ? e.message : String(e);
      tracker.recordFailure(node.id);
      try {
        this.executionRepo.recordNodeFailed(executionId, node.id, errorMsg);
      } catch {
        // best-effort
      }
    }
  }
}
