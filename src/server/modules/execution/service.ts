import type { IExecutionRepo } from "./repo.js";
import { ExecutionNotFoundError } from "../../infra/errors.js";

export interface IExecutionService {
  getExecution(id: string): Array<{ id: string; nodeId: string; status: string; input: unknown }>;
  getExecutionNodes(id: string): Array<{ id: string; nodeId: string; status: string; input: unknown }>;
}

export class ExecutionService implements IExecutionService {
  constructor(private repo: IExecutionRepo) {}

  getExecution(id: string): Array<{ id: string; nodeId: string; status: string; input: unknown }> {
    const nodes = this.repo.getExecutionNodes(id);
    if (nodes.length === 0) {
      throw new ExecutionNotFoundError(`Execution ${id} not found`);
    }
    return nodes;
  }

  getExecutionNodes(id: string): Array<{ id: string; nodeId: string; status: string; input: unknown }> {
    return this.repo.getExecutionNodes(id);
  }
}
