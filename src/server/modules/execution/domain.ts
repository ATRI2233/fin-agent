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

