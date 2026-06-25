import type { IExecutionRepo } from "./repo.js";
import { ExecutionNotFoundError } from "../../infra/errors.js";

export interface IExecutionService {
  getExecution(id: string): Array<{ id: string; nodeId: string; status: string; inputs: unknown; outputs: unknown }>;
  getExecutionNodes(id: string): Array<{ id: string; nodeId: string; status: string; inputs: unknown; outputs: unknown }>;
  getExecutionRecord(executionId: string): { id: string; workflowId: string; status: string; completedAt: Date | null; createdAt: Date; startedAt: Date | null } | null;
  abortExecution(id: string): { execution_id: string; aborted: boolean; execution: Record<string, unknown> };
  listExecutions(limit?: number, offset?: number): { executions: Array<{ id: string; workflowId: string; status: string; createdAt: Date; startedAt: Date | null; completedAt: Date | null; params: unknown; traceId: string }>; total: number; offset: number; limit: number };
}

export class ExecutionService implements IExecutionService {
  constructor(private repo: IExecutionRepo) {}

  getExecution(id: string): Array<{ id: string; nodeId: string; status: string; inputs: unknown; outputs: unknown }> {
    const nodes = this.repo.getExecutionNodes(id);
    if (nodes.length === 0) {
      throw new ExecutionNotFoundError(`Execution ${id} not found`);
    }
    return nodes;
  }

  getExecutionNodes(id: string): Array<{ id: string; nodeId: string; status: string; inputs: unknown; outputs: unknown }> {
    return this.repo.getExecutionNodes(id);
  }

  getExecutionRecord(executionId: string): { id: string; workflowId: string; status: string; completedAt: Date | null; createdAt: Date; startedAt: Date | null } | null {
    return this.repo.getExecutionRecord(executionId);
  }

  abortExecution(id: string): { execution_id: string; aborted: boolean; execution: Record<string, unknown> } {
    this.repo.getExecutionNodes(id); // Will throw ExecutionNotFoundError if not found
    this.repo.markExecution(id, "cleaned_up");
    return { execution_id: id, aborted: true, execution: { id, status: "cleaned_up" } };
  }

  listExecutions(limit: number = 20, offset: number = 0): { executions: Array<{ id: string; workflowId: string; status: string; createdAt: Date; startedAt: Date | null; completedAt: Date | null; params: unknown; traceId: string }>; total: number; offset: number; limit: number } {
    const executions = this.repo.listExecutions(limit, offset);
    return { executions, total: executions.length, offset, limit };
  }
}
