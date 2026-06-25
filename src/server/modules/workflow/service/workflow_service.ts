import type { IWorkflowRepo } from "../repo.js";
import type { WorkflowRunner, ExecutionSummary } from "./workflow_runner.js";
import { WorkflowNotFoundError } from "../../../infra/errors.js";

export interface IWorkflowService {
  listWorkflows(): unknown[];
  getWorkflow(id: string): unknown;
  updateWorkflow(id: string, data: Partial<{ name: string; description: string; nodes: unknown; edges: unknown; triggerType: string; config: unknown }>): unknown;
  deleteWorkflow(id: string): void;
  triggerWorkflow(id: string, params: Record<string, unknown>, traceId: string): Promise<ExecutionSummary>;
}

export class WorkflowService implements IWorkflowService {
  constructor(
    private workflowRepo: IWorkflowRepo,
    private workflowRunner: WorkflowRunner
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

  async triggerWorkflow(id: string, params: Record<string, unknown>, traceId: string): Promise<ExecutionSummary> {
    const wf = this.workflowRepo.get(id);
    if (!wf) {
      throw new WorkflowNotFoundError(`Workflow ${id} not found`);
    }
    return this.workflowRunner.run(id, params, traceId);
  }
}
