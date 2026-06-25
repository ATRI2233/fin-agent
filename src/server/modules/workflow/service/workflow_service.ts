import type { IWorkflowRepo } from "../repo.js";
import type { WorkflowRunner, ExecutionSummary } from "./workflow_runner.js";
import { WorkflowNotFoundError } from "../../../infra/errors.js";

export interface IWorkflowService {
  listWorkflows(): unknown[];
  getWorkflow(id: string): unknown;
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

  async triggerWorkflow(id: string, params: Record<string, unknown>, traceId: string): Promise<ExecutionSummary> {
    const wf = this.workflowRepo.get(id);
    if (!wf) {
      throw new WorkflowNotFoundError(`Workflow ${id} not found`);
    }
    return this.workflowRunner.run(id, params, traceId);
  }
}
