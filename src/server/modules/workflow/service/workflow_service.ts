import type { IWorkflowRepo } from "../repo.js";
import type { WorkflowRunner, ExecutionSummary } from "./workflow_runner.js";
import { WorkflowNotFoundError } from "../../../infra/errors.js";
import { GatewayWorkflowMessageServiceImpl } from "../../conversation/workflow_message_service.js";
import { SessionAwareExecutionObserver, type IExecutionObserver } from "./execution_observer.js";
import type { GatewayClient } from "../../../infra/gateway-client.js";

export interface IWorkflowService {
  listWorkflows(): unknown[];
  getWorkflow(id: string): unknown;
  updateWorkflow(id: string, data: Partial<{ name: string; description: string; nodes: unknown; edges: unknown; triggerType: string; config: unknown }>): unknown;
  deleteWorkflow(id: string): void;
  triggerWorkflow(id: string, params: Record<string, unknown>, traceId: string, conversationId?: string): Promise<ExecutionSummary>;
  triggerWorkflowBySession(sessionKey: string, workflowId: string, params: Record<string, unknown>, traceId: string): Promise<string>;
}

export class WorkflowService implements IWorkflowService {
  constructor(
    private workflowRepo: IWorkflowRepo,
    private workflowRunner: WorkflowRunner,
    private gatewayClient: GatewayClient,
  ) {}

  listWorkflows(): unknown[] {
    return this.workflowRepo.list(50, 0);
  }

  getWorkflow(id: string): unknown {
    const wf = this.workflowRepo.get(id);
    if (!wf) {
      throw new WorkflowNotFoundError(`Workflow ${id} not found`);
    }
    return wf;
  }

  updateWorkflow(id: string, data: Partial<{ name: string; description: string; nodes: unknown; edges: unknown; triggerType: string; config: unknown }>): unknown {
    const wf = this.workflowRepo.get(id);
    if (!wf) {
      throw new WorkflowNotFoundError(`Workflow ${id} not found`);
    }
    this.workflowRepo.update(id, data);
    return this.workflowRepo.get(id);
  }

  deleteWorkflow(id: string): void {
    const wf = this.workflowRepo.get(id);
    if (!wf) {
      throw new WorkflowNotFoundError(`Workflow ${id} not found`);
    }
    this.workflowRepo.delete(id);
  }

  async triggerWorkflow(
    id: string,
    params: Record<string, unknown>,
    traceId: string,
    conversationId?: string,
  ): Promise<ExecutionSummary> {
    const wf = this.workflowRepo.get(id);
    if (!wf) {
      throw new WorkflowNotFoundError(`Workflow ${id} not found`);
    }

    const options = undefined;

    return this.workflowRunner.run(id, params, traceId, options);
  }

  async triggerWorkflowBySession(
    sessionKey: string,
    workflowId: string,
    params: Record<string, unknown>,
    traceId: string,
  ): Promise<string> {
    const wf = this.workflowRepo.get(workflowId);
    if (!wf) {
      throw new WorkflowNotFoundError(`Workflow ${workflowId} not found`);
    }

    // Session TTL: 7 days — tracked locally for periodic cleanup
    const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
    const childSessionKey = await gatewayClient.createSession(
      "fin-agent-execution-" + Date.now(),
      sessionKey,
    );
    gatewayClient.trackSession(childSessionKey, SEVEN_DAYS_MS);
    const msgSvc = new GatewayWorkflowMessageServiceImpl(sessionKey, childSessionKey);
    const observer = new SessionAwareExecutionObserver(msgSvc);

    const result = await this.workflowRunner.run(workflowId, params, traceId, {
      sessionKey,
      observer,
    });

    return result.executionId;
  }
}
