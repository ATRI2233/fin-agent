import { withRetry } from "./retry.js";
import { ExecutionTracker } from "./execution_tracker.js";
import { NodeScheduler } from "./node_scheduler.js";
import { rootLogger } from "../../../infra/logging.js";
import { settings } from "../../../infra/settings.js";
import { ValidationError, WorkflowNotFoundError } from "../../../infra/errors.js";
import { AgentExecutor, type NodeResult, NodeExecutor, InputExecutor, OutputExecutor, IExecutorRegistry } from "../executor.js";
import type { ExecutionStatus } from "../../execution/domain.js";
import type { IWorkflowRepo } from "../repo.js";
import type { IExecutionRepo } from "../../execution/repo.js";
import type { ExecutionDomainService } from "../../execution/domain-service.js";
import type { AgentPort } from "../../../../agents/adapter/AgentPort.js";

export interface ExecutionSummary {
  executionId: string;
  workflowId: string;
  status: ExecutionStatus;
  results: Record<string, NodeResult>;
  failedNodes: string[];
  skippedNodes: string[];
}

export interface IWorkflowRunner {
  run(
    workflowId: string,
    params: Record<string, unknown>,
    traceId: string
  ): Promise<ExecutionSummary>;
}

export class ExecutorRegistry implements IExecutorRegistry {
  constructor(private port: AgentPort) {}

  create(nodeType: string): NodeExecutor {
    switch (nodeType) {
      case "input":
        return new InputExecutor();
      case "output":
        return new OutputExecutor();
      case "agent":
        return new AgentExecutor(this.port);
      default:
        throw new ValidationError(`Unknown node type: ${nodeType}`);
    }
  }
}

export class WorkflowRunner implements IWorkflowRunner {
  private nodeScheduler: NodeScheduler;

  constructor(
    private workflowRepo: IWorkflowRepo,
    private executionRepo: IExecutionRepo,
    private executionDomainService: ExecutionDomainService,
    executorRegistry: ExecutorRegistry,
  ) {
    this.nodeScheduler = new NodeScheduler(
      this.executionRepo,
      this.executionDomainService,
      executorRegistry,
    );
  }

  async run(
    workflowId: string,
    params: Record<string, unknown>,
    traceId: string,
  ): Promise<ExecutionSummary> {
    const workflow = this.workflowRepo.get(workflowId);
    if (!workflow) {
      throw new WorkflowNotFoundError(`Workflow ${workflowId} not found`);
    }

    const executionId = this.executionRepo.createExecution({
      workflowId,
      params,
      traceId,
    });

    const nodes = workflow.nodes.map((n) => ({
      id: n.id,
      agent: n.agent ?? n.type,
      input: n.data ?? {},
    }));
    this.executionRepo.createExecutionNodes(executionId, nodes);
    this.executionRepo.markExecution(executionId, "running");

    const tracker = new ExecutionTracker();

    await this.nodeScheduler.executeAll(
      workflow, executionId, params, traceId, tracker,
    );

    const finalStatus: ExecutionStatus = tracker.failedNodes.size > 0 ? "failed" : "completed";
    await this.markExecutionWithRetry(executionId, finalStatus);

    const { failedNodes, skippedNodes } = tracker.toSummary();

    return {
      executionId,
      workflowId,
      status: finalStatus,
      results: tracker.results,
      failedNodes,
      skippedNodes,
    };
  }

  private async markExecutionWithRetry(
    executionId: string,
    status: ExecutionStatus,
  ): Promise<void> {
    try {
      await withRetry(
        async () => {
          this.executionRepo.markExecution(executionId, status);
        },
        settings.MAX_AGENT_RETRIES,
        settings.RETRY_BASE_DELAY_SECONDS,
        settings.RETRY_BACKOFF_FACTOR,
      );
    } catch (e) {
      rootLogger.fatal(
        { executionId, status, error: e },
        "mark_execution failed after all retries",
      );
      throw e;
    }
  }
}
