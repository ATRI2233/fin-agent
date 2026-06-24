import { describe, it, expect } from "vitest";

describe("devilAdvocate null assumptions (M5)", () => {
  it("should not throw when assumptions is null", () => {
    const signals: Record<string, { assumptions: string[] | null }> = {
      s1: { assumptions: null },
      s2: { assumptions: ["高增长预期"] },
    };

    const hasHighGrowth = Object.values(signals).some(
      (s) =>
        s.assumptions?.some((a) => a.includes("增长") || a.includes("盈利")) ??
        false
    );

    expect(hasHighGrowth).toBe(true);
  });

  it("should return false when all assumptions are null", () => {
    const signals: Record<string, { assumptions: string[] | null }> = {
      s1: { assumptions: null },
      s2: { assumptions: null },
    };

    const hasHighGrowth = Object.values(signals).some(
      (s) =>
        s.assumptions?.some((a) => a.includes("增长") || a.includes("盈利")) ??
        false
    );

    expect(hasHighGrowth).toBe(false);
  });
});
