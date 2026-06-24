import { describe, it, expect } from "vitest";
import {
  transition,
  type ExecutionStatus,
} from "../../src/server/modules/execution/domain.js";

describe("state machine transitions", () => {
  const valid: Array<[ExecutionStatus, ExecutionStatus]> = [
    ["pending", "running"],
    ["pending", "skipped"],
    ["running", "completed"],
    ["running", "failed"],
    ["completed", "cleaned_up"],
    ["failed", "cleaned_up"],
  ];

  const invalid: Array<[ExecutionStatus, ExecutionStatus]> = [
    ["pending", "completed"],
    ["completed", "running"],
    ["failed", "failed"],
    ["skipped", "running"],
    ["cleaned_up", "running"],
  ];

  it.each(valid)("%s -> %s should pass", (from, to) => {
    expect(() => transition(from, to)).not.toThrow();
  });

  it.each(invalid)("%s -> %s should throw", (from, to) => {
    expect(() => transition(from, to)).toThrow("Invalid state transition");
  });
});
