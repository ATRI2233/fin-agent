import pLimit from "p-limit";
import { WorkflowRepo } from "../repo.js";
import { ExecutionRepo } from "../../execution/repo.js";
import { CircuitBreaker, withRetry } from "./retry.js";
import {
  buildPredecessors,
  topologicalSort,
  type Workflow,
  type Node,
} from "../domain/dag.js";
import { type NodeContext, type NodeResult, type NodeExecutor, InputExecutor, OutputExecutor } from "../executor.js";
import { ValidationError, WorkflowNotFoundError } from "../../../infra/errors.js";
import { settings } from "../../../infra/settings.js";
import type { ExecutionStatus } from "../../execution/domain.js";

export interface ExecutionSummary {
  executionId: string;
  workflowId: string;
  status: ExecutionStatus;
  results: Record<string, NodeResult>;
  failedNodes: string[];
  skippedNodes: string[];
}

export interface AgentDispatcher {
  dispatch(agentName: string, input: unknown, traceId: string): Promise<unknown>;
}

export class ExecutorRegistry {
  constructor(private dispatcher: AgentDispatcher) {}

  create(nodeType: string): NodeExecutor {
    switch (nodeType) {
      case "input":
        return new InputExecutor();
      case "output":
        return new OutputExecutor();
      case "agent":
        return new AgentExecutor(this.dispatcher);
      default:
        throw new ValidationError(`Unknown node type: ${nodeType}`);
    }
  }
}

/** Agent node executor — delegates to AgentDispatcher. */
class AgentExecutor implements NodeExecutor {
  constructor(private dispatcher: AgentDispatcher) {}

  async execute(ctx: NodeContext): Promise<NodeResult> {
    const agentName = ctx.node.agent ?? "default";
    const output = await this.dispatcher.dispatch(agentName, ctx.params, ctx.traceId);
    return {
      output: output as any,
      sessionId: null,
      extraData: {},
    };
  }
}

export class WorkflowRunner {
  private circuitBreaker: CircuitBreaker;
  private limit: ReturnType<typeof pLimit>;

  constructor(
    private workflowRepo: typeof WorkflowRepo,
    private executionRepo: typeof ExecutionRepo,
    private executorRegistry: ExecutorRegistry
  ) {
    this.circuitBreaker = new CircuitBreaker(settings.CIRCUIT_BREAKER_THRESHOLD);
    this.limit = pLimit(settings.MAX_PARALLEL_NODES);
  }

  async run(
    workflowId: string,
    params: Record<string, unknown>,
    traceId: string
  ): Promise<ExecutionSummary> {
    // 1. Load workflow
    const workflow = this.workflowRepo.get(workflowId);
    if (!workflow) {
      throw new WorkflowNotFoundError(`Workflow ${workflowId} not found`);
    }

    // 2. Create execution
    const executionId = this.executionRepo.createExecution({
      workflowId,
      params,
      traceId,
    });

    // 3. Create execution nodes
    const nodes = workflow.nodes.map((n) => ({
      id: n.id,
      agent: n.agent ?? n.type,
      input: n.data ?? {},
    }));
    this.executionRepo.createExecutionNodes(executionId, nodes);

    // 4. Mark execution running
    this.executionRepo.markExecution(executionId, "running");

    // 5. Topology sort
    const sortedIds = topologicalSort(workflow.nodes, workflow.edges);
    const preds = buildPredecessors(workflow.nodes, workflow.edges);

    // 6. Results tracking
    const results: Record<string, NodeResult> = {};
    const failedNodes = new Set<string>();
    const skippedNodes = new Set<string>();
    const completedPromises = new Map<string, Promise<void>>();

    // 7. Schedule nodes
    const nodePromises: Promise<void>[] = [];

    for (const nodeId of sortedIds) {
      const node = workflow.nodes.find((n) => n.id === nodeId)!;
      const nodePromise = this.scheduleNode(
        node,
        workflow,
        executionId,
        params,
        preds,
        results,
        failedNodes,
        skippedNodes,
        completedPromises,
        traceId
      );
      completedPromises.set(nodeId, nodePromise);
      nodePromises.push(nodePromise);
    }

    await Promise.all(nodePromises);

    // 8. Mark final status with retry (H3 fix)
    const finalStatus: ExecutionStatus = failedNodes.size > 0 ? "failed" : "completed";
    await this.markExecutionWithRetry(executionId, finalStatus, traceId);

    return {
      executionId,
      workflowId,
      status: finalStatus,
      results,
      failedNodes: Array.from(failedNodes),
      skippedNodes: Array.from(skippedNodes),
    };
  }

  private async scheduleNode(
    node: Node,
    workflow: Workflow,
    executionId: string,
    params: Record<string, unknown>,
    preds: Map<string, string[]>,
    results: Record<string, NodeResult>,
    failedNodes: Set<string>,
    skippedNodes: Set<string>,
    completedPromises: Map<string, Promise<void>>,
    traceId: string
  ): Promise<void> {
    try {
      // Wait for all predecessors to complete
      const predecessorIds = preds.get(node.id) ?? [];
      for (const pid of predecessorIds) {
        const promise = completedPromises.get(pid);
        if (!promise) {
          // Predecessor not in execution plan — DAG data inconsistency
          this.executionRepo.recordNodeSkipped(executionId, node.id);
          skippedNodes.add(node.id);
          return;
        }
        await promise;
      }

      // If any predecessor failed, skip this node
      if (predecessorIds.some((pid) => failedNodes.has(pid))) {
        this.executionRepo.recordNodeSkipped(executionId, node.id);
        skippedNodes.add(node.id);
        return;
      }

      // Check circuit breaker
      if (this.circuitBreaker.isOpen(executionId, node.id, traceId)) {
        this.executionRepo.recordNodeFailed(executionId, node.id, "Circuit breaker open");
        failedNodes.add(node.id);
        // Mark downstream skipped
        const skipped = this.executionRepo.markDownstreamSkipped(executionId, node.id);
        skipped.forEach((sid) => skippedNodes.add(sid));
        return;
      }

      // Execute with concurrency limit
      await this.limit(async () => {
        try {
          this.executionRepo.recordNodeStarted(executionId, node.id);

          const executor = this.executorRegistry.create(node.type);
          const ctx: NodeContext = {
            node,
            executionId,
            predecessorIds,
            params,
            results: { ...results },
            edges: workflow.edges,
            traceId,
            chainSessions: {},
            failedNodes: new Set(failedNodes),
          };

          const result = await executor.execute(ctx);
          results[node.id] = result;

          this.executionRepo.recordNodeCompleted(
            executionId,
            node.id,
            result.output as Record<string, unknown>,
            result.sessionId ?? undefined
          );
          this.circuitBreaker.reset(executionId, node.id, traceId);
        } catch (e) {
          const errorMsg = e instanceof Error ? e.message : String(e);
          this.executionRepo.recordNodeFailed(executionId, node.id, errorMsg);
          failedNodes.add(node.id);
          this.circuitBreaker.recordFailure(executionId, node.id, traceId);

          // Mark downstream skipped
          const skipped = this.executionRepo.markDownstreamSkipped(executionId, node.id);
          skipped.forEach((sid) => skippedNodes.add(sid));
        }
      });
    } catch (e) {
      // Any DB error (recordNodeStarted, recordNodeSkipped, etc.) outside the
      // p-limit callback should not crash the entire workflow.
      const errorMsg = e instanceof Error ? e.message : String(e);
      failedNodes.add(node.id);
      try {
        this.executionRepo.recordNodeFailed(executionId, node.id, errorMsg);
      } catch {
        // Best-effort: if even recordNodeFailed fails, at least track in memory.
      }
    }
  }

  /** Mark execution with 3 retries (H3 fix). */
  private async markExecutionWithRetry(
    executionId: string,
    status: ExecutionStatus,
    _traceId: string
  ): Promise<void> {
    try {
      await withRetry(
        async () => {
          this.executionRepo.markExecution(executionId, status);
        },
        settings.MAX_AGENT_RETRIES,
        settings.RETRY_BASE_DELAY_SECONDS,
        settings.RETRY_BACKOFF_FACTOR
      );
    } catch (e) {
      const logger = (await import("../../../infra/logging.js")).rootLogger;
      logger.fatal(
        { executionId, status, error: e },
        "mark_execution failed after all retries"
      );
      throw e;
    }
  }
}
