import { describe, it, expect } from "vitest";
import { OutputExecutor } from "../../src/server/modules/workflow/executor.js";
import { ValidationError } from "../../src/server/infra/errors.js";

describe("OutputExecutor (H5)", () => {
  it("should aggregate predecessor outputs", async () => {
    const executor = new OutputExecutor();
    const result = await executor.execute({
      node: { id: "output-1", type: "output" },
      executionId: "exec-1",
      predecessorIds: ["node-1", "node-2"],
      params: {},
      results: {
        "node-1": { output: "hello", sessionId: null, extraData: {} },
        "node-2": { output: "world", sessionId: null, extraData: {} },
      },
      edges: [],
      traceId: "tr-1",
      chainSessions: {},
      failedNodes: new Set(),
    });
    expect(result.output).toEqual({ inputs: ["hello", "world"] });
  });

  it("should skip failed predecessors", async () => {
    const executor = new OutputExecutor();
    const result = await executor.execute({
      node: { id: "output-1", type: "output" },
      executionId: "exec-1",
      predecessorIds: ["node-1", "node-2"],
      params: {},
      results: {
        "node-1": { output: "hello", sessionId: null, extraData: {} },
      },
      edges: [],
      traceId: "tr-1",
      chainSessions: {},
      failedNodes: new Set(["node-2"]),
    });
    expect(result.output).toEqual({ inputs: ["hello"] });
  });

  it("should throw ValidationError for missing predecessor (H5 fix)", async () => {
    const executor = new OutputExecutor();
    await expect(
      executor.execute({
        node: { id: "output-1", type: "output" },
        executionId: "exec-1",
        predecessorIds: ["missing"],
        params: {},
        results: {},
        edges: [],
        traceId: "tr-1",
        chainSessions: {},
        failedNodes: new Set(),
      })
    ).rejects.toThrow(ValidationError);
  });
});
