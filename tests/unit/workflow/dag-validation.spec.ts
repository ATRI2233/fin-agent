import { describe, it, expect } from "vitest";
import {
  buildPredecessors,
  topologicalSort,
  findDownstream,
} from "../../../src/server/modules/workflow/domain/dag.js";

describe("buildPredecessors", () => {
  it("should build empty predecessor map for nodes with no edges", () => {
    const nodes = [
      { id: "a", type: "task" },
      { id: "b", type: "task" },
      { id: "c", type: "task" },
    ];
    const edges: { source: string; target: string }[] = [];
    const result = buildPredecessors(nodes, edges);
    expect(result.size).toBe(3);
    expect(result.get("a")).toEqual([]);
    expect(result.get("b")).toEqual([]);
    expect(result.get("c")).toEqual([]);
  });

  it("should correctly map predecessors for a linear chain (a->b->c)", () => {
    const nodes = [
      { id: "a", type: "task" },
      { id: "b", type: "task" },
      { id: "c", type: "task" },
    ];
    const edges = [
      { source: "a", target: "b" },
      { source: "b", target: "c" },
    ];
    const result = buildPredecessors(nodes, edges);
    expect(result.get("a")).toEqual([]);
    expect(result.get("b")).toEqual(["a"]);
    expect(result.get("c")).toEqual(["b"]);
  });

  it("should handle multiple predecessors (diamond shape: a->b, a->c)", () => {
    const nodes = [
      { id: "a", type: "task" },
      { id: "b", type: "task" },
      { id: "c", type: "task" },
    ];
    const edges = [
      { source: "a", target: "b" },
      { source: "a", target: "c" },
    ];
    const result = buildPredecessors(nodes, edges);
    expect(result.get("a")).toEqual([]);
    expect(result.get("b")).toEqual(["a"]);
    expect(result.get("c")).toEqual(["a"]);
  });

  it("should handle nodes with no predecessors (source nodes)", () => {
    const nodes = [
      { id: "a", type: "task" },
      { id: "b", type: "task" },
      { id: "c", type: "task" },
    ];
    const edges = [{ source: "a", target: "b" }];
    const result = buildPredecessors(nodes, edges);
    expect(result.get("a")).toEqual([]);
    expect(result.get("b")).toEqual(["a"]);
    expect(result.get("c")).toEqual([]);
  });

  it("should handle node referenced in edges but not in nodes list", () => {
    const nodes = [{ id: "a", type: "task" }];
    const edges = [{ source: "a", target: "missing" }];
    const result = buildPredecessors(nodes, edges);
    expect(result.get("a")).toEqual([]);
    expect(result.get("missing")).toEqual(["a"]);
  });
});

describe("topologicalSort", () => {
  it("should return correct order for a linear DAG (a->b->c = [a, b, c])", () => {
    const nodes = [
      { id: "a", type: "task" },
      { id: "b", type: "task" },
      { id: "c", type: "task" },
    ];
    const edges = [
      { source: "a", target: "b" },
      { source: "b", target: "c" },
    ];
    expect(topologicalSort(nodes, edges)).toEqual(["a", "b", "c"]);
  });

  it("should handle multiple source nodes (independent parallel branches)", () => {
    const nodes = [
      { id: "a", type: "task" },
      { id: "b", type: "task" },
      { id: "c", type: "task" },
    ];
    const edges = [
      { source: "a", target: "c" },
      { source: "b", target: "c" },
    ];
    const result = topologicalSort(nodes, edges);
    expect(result.indexOf("a")).toBeLessThan(result.indexOf("c"));
    expect(result.indexOf("b")).toBeLessThan(result.indexOf("c"));
    expect(result).toContain("a");
    expect(result).toContain("b");
    expect(result).toContain("c");
  });

  it("should handle diamond DAG (a->b, a->c, b->d, c->d) with b,c order undefined", () => {
    const nodes = [
      { id: "a", type: "task" },
      { id: "b", type: "task" },
      { id: "c", type: "task" },
      { id: "d", type: "task" },
    ];
    const edges = [
      { source: "a", target: "b" },
      { source: "a", target: "c" },
      { source: "b", target: "d" },
      { source: "c", target: "d" },
    ];
    const result = topologicalSort(nodes, edges);
    expect(result.indexOf("a")).toBe(0);
    expect(result.indexOf("d")).toBe(3);
    expect(result.indexOf("b")).toBeLessThan(result.indexOf("d"));
    expect(result.indexOf("c")).toBeLessThan(result.indexOf("d"));
  });

  it('should throw "DAG contains a cycle" for a direct cycle (a->b, b->a)', () => {
    const nodes = [
      { id: "a", type: "task" },
      { id: "b", type: "task" },
    ];
    const edges = [
      { source: "a", target: "b" },
      { source: "b", target: "a" },
    ];
    expect(() => topologicalSort(nodes, edges)).toThrow("DAG contains a cycle");
  });

  it('should throw for a longer cycle (a->b, b->c, c->a)', () => {
    const nodes = [
      { id: "a", type: "task" },
      { id: "b", type: "task" },
      { id: "c", type: "task" },
    ];
    const edges = [
      { source: "a", target: "b" },
      { source: "b", target: "c" },
      { source: "c", target: "a" },
    ];
    expect(() => topologicalSort(nodes, edges)).toThrow("DAG contains a cycle");
  });

  it("should handle single node with no edges", () => {
    const nodes = [{ id: "a", type: "task" }];
    const edges: { source: string; target: string }[] = [];
    expect(topologicalSort(nodes, edges)).toEqual(["a"]);
  });

  it("should handle empty node list", () => {
    const nodes: { id: string; type: string }[] = [];
    const edges: { source: string; target: string }[] = [];
    expect(topologicalSort(nodes, edges)).toEqual([]);
  });

  it("should handle node not present in edges list (isolated node alongside chain)", () => {
    const nodes = [
      { id: "a", type: "task" },
      { id: "b", type: "task" },
      { id: "c", type: "task" },
    ];
    const edges = [{ source: "a", target: "b" }];
    const result = topologicalSort(nodes, edges);
    expect(result).toHaveLength(3);
    expect(result).toContain("a");
    expect(result).toContain("b");
    expect(result).toContain("c");
    expect(result.indexOf("a")).toBeLessThan(result.indexOf("b"));
  });

  it("should throw for self-loop edge", () => {
    const nodes = [{ id: "a", type: "task" }];
    const edges = [{ source: "a", target: "a" }];
    expect(() => topologicalSort(nodes, edges)).toThrow("DAG contains a cycle");
  });
});

describe("findDownstream", () => {
  it("should find all downstream nodes in a chain", () => {
    const edges = [
      { source: "a", target: "b" },
      { source: "b", target: "c" },
    ];
    const result = findDownstream(edges, "a");
    expect(result).toEqual(new Set(["b", "c"]));
  });

  it("should find all downstream nodes in a diamond", () => {
    const edges = [
      { source: "a", target: "b" },
      { source: "a", target: "c" },
      { source: "b", target: "d" },
      { source: "c", target: "d" },
    ];
    const result = findDownstream(edges, "a");
    expect(result).toEqual(new Set(["b", "c", "d"]));
  });

  it("should return empty set for a leaf node", () => {
    const edges = [
      { source: "a", target: "b" },
      { source: "b", target: "c" },
    ];
    const result = findDownstream(edges, "c");
    expect(result).toEqual(new Set());
  });

  it("should return empty set for isolated node", () => {
    const edges: { source: string; target: string }[] = [];
    const result = findDownstream(edges, "a");
    expect(result).toEqual(new Set());
  });

  it("should handle branching downstream (a->b, a->c, b->d)", () => {
    const edges = [
      { source: "a", target: "b" },
      { source: "a", target: "c" },
      { source: "b", target: "d" },
    ];
    const result = findDownstream(edges, "a");
    expect(result).toEqual(new Set(["b", "c", "d"]));
  });

  it("should handle startNodeId not present in any edge", () => {
    const edges = [
      { source: "b", target: "c" },
    ];
    const result = findDownstream(edges, "a");
    expect(result).toEqual(new Set());
  });

  it("should not include the start node itself", () => {
    const edges = [
      { source: "a", target: "b" },
      { source: "b", target: "c" },
      { source: "c", target: "a" }, // cycle back to a
    ];
    const result = findDownstream(edges, "a");
    expect(result).toEqual(new Set(["b", "c"]));
  });
});
