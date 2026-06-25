import { describe, it, expect, vi } from "vitest";
import { ExecutionDomainService } from "../../../src/server/modules/execution/domain-service.js";
import type { ExecutionStatus } from "../../../src/server/modules/execution/domain.js";

// ---------------------------------------------------------------------------
// Helper: build a repo fake returning the given node rows
// ---------------------------------------------------------------------------
function createMockRepo(
  nodes: Array<{
    id: string;
    nodeId: string;
    status: ExecutionStatus;
    input: unknown;
  }>,
) {
  const recordNodeSkipped = vi.fn();
  return {
    getExecutionNodes: vi.fn().mockReturnValue(nodes),
    recordNodeSkipped,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe("ExecutionDomainService", () => {
  describe("markDownstreamSkipped", () => {
    // -----------------------------------------------------------------------
    // Basic downstream skip
    // -----------------------------------------------------------------------
    it("should skip a single downstream node that references the failed node", () => {
      const mockRepo = createMockRepo([
        { id: "r1", nodeId: "node-1", status: "failed", input: {} },
        { id: "r2", nodeId: "node-2", status: "pending", input: "node-1" },
      ]);
      const service = new ExecutionDomainService(mockRepo);

      const skipped = service.markDownstreamSkipped("exec-1", "node-1");

      expect(skipped).toEqual(["node-2"]);
      expect(mockRepo.recordNodeSkipped).toHaveBeenCalledTimes(1);
      expect(mockRepo.recordNodeSkipped).toHaveBeenCalledWith("exec-1", "node-2");
    });

    it("should skip a chain of downstream nodes (transitive references)", () => {
      const mockRepo = createMockRepo([
        { id: "r1", nodeId: "node-1", status: "failed", input: {} },
        { id: "r2", nodeId: "node-2", status: "pending", input: "node-1" },
        { id: "r3", nodeId: "node-3", status: "pending", input: "node-2" },
      ]);
      const service = new ExecutionDomainService(mockRepo);

      const skipped = service.markDownstreamSkipped("exec-1", "node-1");

      expect(skipped).toEqual(["node-2", "node-3"]);
      expect(mockRepo.recordNodeSkipped).toHaveBeenCalledTimes(2);
      expect(mockRepo.recordNodeSkipped).toHaveBeenCalledWith("exec-1", "node-2");
      expect(mockRepo.recordNodeSkipped).toHaveBeenCalledWith("exec-1", "node-3");
    });

    // -----------------------------------------------------------------------
    // Input reference patterns
    // -----------------------------------------------------------------------
    it("should detect a direct string reference in input", () => {
      const mockRepo = createMockRepo([
        { id: "r1", nodeId: "node-1", status: "failed", input: {} },
        { id: "r2", nodeId: "node-2", status: "pending", input: "node-1" },
      ]);
      const service = new ExecutionDomainService(mockRepo);

      const skipped = service.markDownstreamSkipped("exec-1", "node-1");

      expect(skipped).toEqual(["node-2"]);
    });

    it("should detect an object-key reference in input", () => {
      const mockRepo = createMockRepo([
        { id: "r1", nodeId: "node-1", status: "failed", input: {} },
        {
          id: "r2",
          nodeId: "node-2",
          status: "pending",
          input: { "node-1": "someValue" },
        },
      ]);
      const service = new ExecutionDomainService(mockRepo);

      const skipped = service.markDownstreamSkipped("exec-1", "node-1");

      expect(skipped).toEqual(["node-2"]);
    });

    it("should detect a nested reference inside an array", () => {
      const mockRepo = createMockRepo([
        { id: "r1", nodeId: "node-1", status: "failed", input: {} },
        {
          id: "r2",
          nodeId: "node-2",
          status: "pending",
          input: { sources: ["node-1"] },
        },
      ]);
      const service = new ExecutionDomainService(mockRepo);

      const skipped = service.markDownstreamSkipped("exec-1", "node-1");

      expect(skipped).toEqual(["node-2"]);
    });

    it("should detect a deeply nested object reference", () => {
      const mockRepo = createMockRepo([
        { id: "r1", nodeId: "node-1", status: "failed", input: {} },
        {
          id: "r2",
          nodeId: "node-2",
          status: "pending",
          input: { data: { dependsOn: "node-1" } },
        },
      ]);
      const service = new ExecutionDomainService(mockRepo);

      const skipped = service.markDownstreamSkipped("exec-1", "node-1");

      expect(skipped).toEqual(["node-2"]);
    });

    it("should NOT skip a node whose input does NOT reference the failed node", () => {
      const mockRepo = createMockRepo([
        { id: "r1", nodeId: "node-1", status: "failed", input: {} },
        {
          id: "r2",
          nodeId: "node-2",
          status: "pending",
          input: { foo: "bar" },
        },
      ]);
      const service = new ExecutionDomainService(mockRepo);

      const skipped = service.markDownstreamSkipped("exec-1", "node-1");

      expect(skipped).toEqual([]);
      expect(mockRepo.recordNodeSkipped).not.toHaveBeenCalled();
    });

    // -----------------------------------------------------------------------
    // State protection
    // -----------------------------------------------------------------------
    it("should NOT skip a running node (only pending -> skipped is valid)", () => {
      const mockRepo = createMockRepo([
        { id: "r1", nodeId: "node-1", status: "failed", input: {} },
        { id: "r2", nodeId: "node-2", status: "running", input: "node-1" },
        {
          id: "r3",
          nodeId: "node-3",
          status: "pending",
          input: "node-1",
        },
      ]);
      const service = new ExecutionDomainService(mockRepo);

      const skipped = service.markDownstreamSkipped("exec-1", "node-1");

      // node-3 (pending) should be skipped, but node-2 (running) must not
      expect(skipped).toEqual(["node-3"]);
      expect(mockRepo.recordNodeSkipped).toHaveBeenCalledTimes(1);
      expect(mockRepo.recordNodeSkipped).toHaveBeenCalledWith("exec-1", "node-3");
    });

    it("should NOT skip a completed node (only pending -> skipped is valid)", () => {
      const mockRepo = createMockRepo([
        { id: "r1", nodeId: "node-1", status: "failed", input: {} },
        { id: "r2", nodeId: "node-2", status: "completed", input: "node-1" },
        {
          id: "r3",
          nodeId: "node-3",
          status: "pending",
          input: "node-1",
        },
      ]);
      const service = new ExecutionDomainService(mockRepo);

      const skipped = service.markDownstreamSkipped("exec-1", "node-1");

      expect(skipped).toEqual(["node-3"]);
      expect(mockRepo.recordNodeSkipped).toHaveBeenCalledTimes(1);
      expect(mockRepo.recordNodeSkipped).toHaveBeenCalledWith("exec-1", "node-3");
    });

    // -----------------------------------------------------------------------
    // Edge cases
    // -----------------------------------------------------------------------
    it("should return empty array when there are no pending nodes", () => {
      const mockRepo = createMockRepo([
        { id: "r1", nodeId: "node-1", status: "failed", input: {} },
        { id: "r2", nodeId: "node-2", status: "running", input: "node-1" },
        {
          id: "r3",
          nodeId: "node-3",
          status: "completed",
          input: "node-1",
        },
      ]);
      const service = new ExecutionDomainService(mockRepo);

      const skipped = service.markDownstreamSkipped("exec-1", "node-1");

      expect(skipped).toEqual([]);
      expect(mockRepo.recordNodeSkipped).not.toHaveBeenCalled();
    });

    it("should return empty array when the execution has no nodes", () => {
      const mockRepo = createMockRepo([]);
      const service = new ExecutionDomainService(mockRepo);

      const skipped = service.markDownstreamSkipped("exec-1", "node-1");

      expect(skipped).toEqual([]);
      expect(mockRepo.recordNodeSkipped).not.toHaveBeenCalled();
    });

    it("should only skip the branch that depends on the failed node (DAG with independent branches)", () => {
      const mockRepo = createMockRepo([
        { id: "r1", nodeId: "node-1", status: "failed", input: {} },
        // branch A — descendants of the failed node
        { id: "ra1", nodeId: "node-A1", status: "pending", input: "node-1" },
        {
          id: "ra2",
          nodeId: "node-A2",
          status: "pending",
          input: "node-A1",
        },
        // branch B — independent sub-graph
        { id: "rb1", nodeId: "node-B1", status: "pending", input: {} },
        {
          id: "rb2",
          nodeId: "node-B2",
          status: "pending",
          input: "node-B1",
        },
      ]);
      const service = new ExecutionDomainService(mockRepo);

      const skipped = service.markDownstreamSkipped("exec-1", "node-1");

      expect(skipped).toEqual(["node-A1", "node-A2"]);
      // Branch-B nodes must NOT be touched
      expect(mockRepo.recordNodeSkipped).toHaveBeenCalledTimes(2);
      expect(mockRepo.recordNodeSkipped).not.toHaveBeenCalledWith(
        "exec-1",
        "node-B1",
      );
      expect(mockRepo.recordNodeSkipped).not.toHaveBeenCalledWith(
        "exec-1",
        "node-B2",
      );
    });

    it("should handle circular references in input without infinite loop", () => {
      const circular: Record<string, unknown> = {};
      circular.self = circular;

      const mockRepo = createMockRepo([
        { id: "r1", nodeId: "node-1", status: "failed", input: {} },
        {
          id: "r2",
          nodeId: "node-2",
          status: "pending",
          input: circular,
        },
      ]);
      const service = new ExecutionDomainService(mockRepo);

      // Should return cleanly — no infinite loop, no crash
      const skipped = service.markDownstreamSkipped("exec-1", "node-1");

      // The circular input does not reference "node-1", so node-2 stays pending
      expect(skipped).toEqual([]);
      expect(mockRepo.recordNodeSkipped).not.toHaveBeenCalled();
    });

    // -----------------------------------------------------------------------
    // Verification
    // -----------------------------------------------------------------------
    it("should call recordNodeSkipped exactly once per skipped node", () => {
      const mockRepo = createMockRepo([
        { id: "r1", nodeId: "node-1", status: "failed", input: {} },
        { id: "r2", nodeId: "node-2", status: "pending", input: "node-1" },
        { id: "r3", nodeId: "node-3", status: "pending", input: "node-1" },
      ]);
      const service = new ExecutionDomainService(mockRepo);

      service.markDownstreamSkipped("exec-1", "node-1");

      expect(mockRepo.recordNodeSkipped).toHaveBeenCalledTimes(2);
      expect(mockRepo.recordNodeSkipped).toHaveBeenCalledWith("exec-1", "node-2");
      expect(mockRepo.recordNodeSkipped).toHaveBeenCalledWith("exec-1", "node-3");
    });

    it("should return node IDs sorted alphabetically", () => {
      // The BFS processes pending rows in array order.  By placing "node-3"
      // before "node-2" we ensure the raw result is ["node-3", "node-2"],
      // which the service then sorts to ["node-2", "node-3"].
      const mockRepo = createMockRepo([
        { id: "r1", nodeId: "node-1", status: "failed", input: {} },
        {
          id: "r3",
          nodeId: "node-3",
          status: "pending",
          input: "node-1",
        },
        {
          id: "r2",
          nodeId: "node-2",
          status: "pending",
          input: "node-1",
        },
      ]);
      const service = new ExecutionDomainService(mockRepo);

      const skipped = service.markDownstreamSkipped("exec-1", "node-1");

      expect(skipped).toEqual(["node-2", "node-3"]);
    });
  });
});
