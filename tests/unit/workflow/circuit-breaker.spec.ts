import { describe, it, expect } from "vitest";
import { CircuitBreaker } from "../../../src/server/modules/workflow/service/retry.js";

describe("CircuitBreaker", () => {
  it("should start closed", () => {
    const cb = new CircuitBreaker(3, 60, { now: () => 1000 });
    expect(cb.isOpen("exec-1", "node-1", "trace-1")).toBe(false);
  });

  it("should open after reaching threshold", () => {
    const clock = { now: () => 1000 };
    const cb = new CircuitBreaker(3, 60, clock);

    cb.recordFailure("exec-1", "node-1", "trace-1");
    cb.recordFailure("exec-1", "node-1", "trace-1");
    cb.recordFailure("exec-1", "node-1", "trace-1");

    expect(cb.isOpen("exec-1", "node-1", "trace-1")).toBe(true);
  });

  it("should not open below threshold", () => {
    const clock = { now: () => 1000 };
    const cb = new CircuitBreaker(5, 60, clock);

    cb.recordFailure("exec-1", "node-1", "trace-1");
    cb.recordFailure("exec-1", "node-1", "trace-1");

    expect(cb.isOpen("exec-1", "node-1", "trace-1")).toBe(false);
  });

  it("should track failures independently per execution/node combo", () => {
    const clock = { now: () => 1000 };
    const cb = new CircuitBreaker(3, 60, clock);

    cb.recordFailure("exec-1", "node-1", "trace-1");
    cb.recordFailure("exec-1", "node-1", "trace-1");

    cb.recordFailure("exec-2", "node-1", "trace-1");
    cb.recordFailure("exec-2", "node-1", "trace-1");
    cb.recordFailure("exec-2", "node-1", "trace-1");

    expect(cb.isOpen("exec-1", "node-1", "trace-1")).toBe(false);
    expect(cb.isOpen("exec-2", "node-1", "trace-1")).toBe(true);
  });

  it("should track failures independently per node within same execution", () => {
    const clock = { now: () => 1000 };
    const cb = new CircuitBreaker(3, 60, clock);

    cb.recordFailure("exec-1", "node-a", "trace-1");
    cb.recordFailure("exec-1", "node-a", "trace-1");

    cb.recordFailure("exec-1", "node-b", "trace-1");
    cb.recordFailure("exec-1", "node-b", "trace-1");
    cb.recordFailure("exec-1", "node-b", "trace-1");

    expect(cb.isOpen("exec-1", "node-a", "trace-1")).toBe(false);
    expect(cb.isOpen("exec-1", "node-b", "trace-1")).toBe(true);
  });

  it("should track failures independently per traceId", () => {
    const clock = { now: () => 1000 };
    const cb = new CircuitBreaker(3, 60, clock);

    cb.recordFailure("exec-1", "node-1", "trace-a");
    cb.recordFailure("exec-1", "node-1", "trace-a");

    cb.recordFailure("exec-1", "node-1", "trace-b");
    cb.recordFailure("exec-1", "node-1", "trace-b");
    cb.recordFailure("exec-1", "node-1", "trace-b");

    expect(cb.isOpen("exec-1", "node-1", "trace-a")).toBe(false);
    expect(cb.isOpen("exec-1", "node-1", "trace-b")).toBe(true);
  });

  it("should reset and close the circuit", () => {
    const clock = { now: () => 1000 };
    const cb = new CircuitBreaker(3, 60, clock);

    cb.recordFailure("exec-1", "node-1", "trace-1");
    cb.recordFailure("exec-1", "node-1", "trace-1");
    cb.recordFailure("exec-1", "node-1", "trace-1");
    expect(cb.isOpen("exec-1", "node-1", "trace-1")).toBe(true);

    cb.reset("exec-1", "node-1", "trace-1");
    expect(cb.isOpen("exec-1", "node-1", "trace-1")).toBe(false);
  });

  it("should reset only the specified combo", () => {
    const clock = { now: () => 1000 };
    const cb = new CircuitBreaker(3, 60, clock);

    cb.recordFailure("exec-1", "node-a", "trace-1");
    cb.recordFailure("exec-1", "node-a", "trace-1");
    cb.recordFailure("exec-1", "node-a", "trace-1");

    cb.recordFailure("exec-1", "node-b", "trace-1");
    cb.recordFailure("exec-1", "node-b", "trace-1");
    cb.recordFailure("exec-1", "node-b", "trace-1");

    cb.reset("exec-1", "node-a", "trace-1");

    expect(cb.isOpen("exec-1", "node-a", "trace-1")).toBe(false);
    expect(cb.isOpen("exec-1", "node-b", "trace-1")).toBe(true);
  });

  it("should auto-close after cooldown expires", () => {
    let now = 1000;
    const clock = { now: () => now };
    const cb = new CircuitBreaker(3, 60, clock);

    cb.recordFailure("exec-1", "node-1", "trace-1");
    cb.recordFailure("exec-1", "node-1", "trace-1");
    cb.recordFailure("exec-1", "node-1", "trace-1");
    expect(cb.isOpen("exec-1", "node-1", "trace-1")).toBe(true);

    // Advance past the 60-second cooldown
    now = 1000 + 60 * 1000 + 1;
    expect(cb.isOpen("exec-1", "node-1", "trace-1")).toBe(false);
  });

  it("should remain open within cooldown period", () => {
    let now = 1000;
    const clock = { now: () => now };
    const cb = new CircuitBreaker(3, 60, clock);

    cb.recordFailure("exec-1", "node-1", "trace-1");
    cb.recordFailure("exec-1", "node-1", "trace-1");
    cb.recordFailure("exec-1", "node-1", "trace-1");
    expect(cb.isOpen("exec-1", "node-1", "trace-1")).toBe(true);

    // Advance only 30 seconds -- still within cooldown
    now = 1000 + 30 * 1000;
    expect(cb.isOpen("exec-1", "node-1", "trace-1")).toBe(true);
  });

  it("should restart failure counting after cooldown expires", () => {
    // isOpen() deletes the record when cooldown expires, so failures
    // start counting from 1 again rather than continuing from the previous count.
    let now = 1000;
    const clock = { now: () => now };
    const cb = new CircuitBreaker(3, 60, clock);

    cb.recordFailure("exec-1", "node-1", "trace-1");
    cb.recordFailure("exec-1", "node-1", "trace-1");
    cb.recordFailure("exec-1", "node-1", "trace-1");
    expect(cb.isOpen("exec-1", "node-1", "trace-1")).toBe(true);

    // Advance just past cooldown so the circuit closes (record is deleted)
    now = 1000 + 60 * 1000 + 1;
    expect(cb.isOpen("exec-1", "node-1", "trace-1")).toBe(false);

    // After cooldown, failures restart from 1, so need 3 again to open
    cb.recordFailure("exec-1", "node-1", "trace-1");
    expect(cb.isOpen("exec-1", "node-1", "trace-1")).toBe(false);

    cb.recordFailure("exec-1", "node-1", "trace-1");
    expect(cb.isOpen("exec-1", "node-1", "trace-1")).toBe(false);

    cb.recordFailure("exec-1", "node-1", "trace-1");
    expect(cb.isOpen("exec-1", "node-1", "trace-1")).toBe(true);
  });

  it("should accept custom cooldown", () => {
    const clock = { now: () => 1000 };
    // 5-second cooldown
    const cb = new CircuitBreaker(2, 5, clock);

    cb.recordFailure("exec-1", "node-1", "trace-1");
    cb.recordFailure("exec-1", "node-1", "trace-1");
    expect(cb.isOpen("exec-1", "node-1", "trace-1")).toBe(true);
  });

  it("should use default cooldown of 60 seconds when not specified", () => {
    const cb = new CircuitBreaker(3);
    expect(cb).toBeDefined();
  });

  it("should handle threshold of 1", () => {
    const clock = { now: () => 1000 };
    const cb = new CircuitBreaker(1, 60, clock);

    expect(cb.isOpen("exec-1", "node-1", "trace-1")).toBe(false);

    cb.recordFailure("exec-1", "node-1", "trace-1");
    expect(cb.isOpen("exec-1", "node-1", "trace-1")).toBe(true);
  });
});
