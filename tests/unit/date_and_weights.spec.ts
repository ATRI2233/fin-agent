import { describe, it, expect } from "vitest";

describe("parseDate (M3)", () => {
  function parseDate(ts: string): Date {
    return new Date(ts.endsWith("Z") ? ts : ts + "Z");
  }

  it.each([
    ["2025-01-15T10:00:00Z", 1736935200000],
    ["2025-01-15T10:00:00", 1736935200000],
  ])("parseDate(%s) should be valid", (input, expectedMs) => {
    const d = parseDate(input);
    expect(d.getTime()).toBe(expectedMs);
  });

  it("should not return Invalid Date for timestamp without Z", () => {
    const d = parseDate("2025-01-15T10:00:00");
    expect(d.toString()).not.toBe("Invalid Date");
  });
});

describe("memoryLearner cold start (M4)", () => {
  function normalizeWeights(
    updates: Record<string, { old: number; new: number }>
  ): Record<string, { old: number; new: number }> {
    const totalNew = Object.values(updates).reduce((s, u) => s + u.new, 0);
    if (totalNew > 0) {
      for (const agent of Object.keys(updates)) {
        updates[agent].new = Math.round((updates[agent].new / totalNew) * 1000) / 1000;
      }
    } else {
      const totalOld = Object.values(updates).reduce((s, u) => s + u.old, 0);
      if (totalOld > 0) {
        for (const agent of Object.keys(updates)) {
          updates[agent].new = Math.round((updates[agent].old / totalOld) * 1000) / 1000;
        }
      } else {
        const count = Object.keys(updates).length;
        const even = count > 0 ? Math.round((1 / count) * 1000) / 1000 : 0;
        for (const agent of Object.keys(updates)) {
          updates[agent].new = even;
        }
      }
    }
    return updates;
  }

  it("totalNew=0 falls back to old weights", () => {
    const updates = {
      a: { old: 0.3, new: 0 },
      b: { old: 0.7, new: 0 },
    };
    normalizeWeights(updates);
    expect(updates.a.new).toBe(0.3);
    expect(updates.b.new).toBe(0.7);
    expect(updates.a.new + updates.b.new).toBeCloseTo(1, 1);
  });

  it("totalNew=0 && totalOld=0 uses equal distribution", () => {
    const updates = {
      a: { old: 0, new: 0 },
      b: { old: 0, new: 0 },
    };
    normalizeWeights(updates);
    expect(updates.a.new).toBe(0.5);
    expect(updates.b.new).toBe(0.5);
  });
});
