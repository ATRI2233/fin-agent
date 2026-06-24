/** Execution domain — status enum + transition validation. */

export type ExecutionStatus =
  | "pending"
  | "running"
  | "completed"
  | "failed"
  | "skipped"
  | "cleaned_up";

const legalTransitions: Record<ExecutionStatus, ExecutionStatus[]> = {
  pending: ["running", "skipped"],
  running: ["completed", "failed"],
  completed: ["cleaned_up"],
  failed: ["cleaned_up"],
  skipped: [],
  cleaned_up: [],
};

export function transition(from: ExecutionStatus, to: ExecutionStatus): void {
  if (!legalTransitions[from].includes(to)) {
    throw new Error(
      `Invalid state transition: ${from} -> ${to}`
    );
  }
}

export interface WorkflowExecution {
  id: string;
  workflowId: string;
  status: ExecutionStatus;
  params: Record<string, unknown>;
  traceId: string;
  createdAt: Date;
  startedAt?: Date;
  completedAt?: Date;
}

export interface ExecutionNode {
  id: string;
  executionId: string;
  nodeId: string;
  agent: string;
  status: ExecutionStatus;
  input: Record<string, unknown>;
  output?: Record<string, unknown>;
  sessionId?: string;
  error?: string;
  startedAt?: Date;
  completedAt?: Date;
  retryCount: number;
}
