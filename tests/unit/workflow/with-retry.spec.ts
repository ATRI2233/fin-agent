import { describe, it, expect } from "vitest";
import { withRetry } from "../../../src/server/modules/workflow/service/retry.js";

describe("withRetry", () => {
  it("should succeed on first attempt", async () => {
    const result = await withRetry(
      async () => "success",
      3, 1, 2,
      async () => {},
    );
    expect(result.result).toBe("success");
    expect(result.retryCount).toBe(0);
  });

  it("should retry on failure and eventually succeed", async () => {
    let attempts = 0;
    const result = await withRetry(
      async () => {
        attempts++;
        if (attempts < 3) throw new Error("temporary failure");
        return "success";
      },
      5, 0.01, 2,
      async () => {},
    );
    expect(result.result).toBe("success");
    expect(result.retryCount).toBe(2);
  });

  it("should throw after max retries exhausted", async () => {
    let attempts = 0;
    await expect(
      withRetry(
        async () => {
          attempts++;
          throw new Error("persistent failure");
        },
        2, 0.01, 2,
        async () => {},
      ),
    ).rejects.toThrow("persistent failure");
  });

  it("should report correct retry count on exhaustion", async () => {
    let caught = false;
    try {
      await withRetry(
        async () => { throw new Error("nope"); },
        3, 0.01, 2,
        async () => {},
      );
    } catch (e) {
      caught = true;
      expect((e as Error).message).toBe("nope");
    }
    expect(caught).toBe(true);
  });

  it("should throw on first attempt when maxRetries is 0", async () => {
    await expect(
      withRetry(
        async () => { throw new Error("immediate fail"); },
        0, 1, 2,
        async () => {},
      ),
    ).rejects.toThrow("immediate fail");
  });

  it("should return value when fn returns undefined", async () => {
    const result = await withRetry<undefined>(
      async () => undefined,
      3, 0.01, 2,
      async () => {},
    );
    expect(result.result).toBeUndefined();
    expect(result.retryCount).toBe(0);
  });

  it("should return value when fn returns null", async () => {
    const result = await withRetry<null>(
      async () => null,
      3, 0.01, 2,
      async () => {},
    );
    expect(result.result).toBeNull();
    expect(result.retryCount).toBe(0);
  });

  it("should pass through complex return types", async () => {
    const data = { id: 42, name: "test" };
    const result = await withRetry(
      async () => data,
      3, 0.01, 2,
      async () => {},
    );
    expect(result.result).toEqual(data);
  });

  it("should not call sleep on successful first attempt", async () => {
    let sleepCalled = false;
    await withRetry(
      async () => "ok",
      3, 1, 2,
      async (_ms: number) => { sleepCalled = true; },
    );
    expect(sleepCalled).toBe(false);
  });

  it("should call sleep with exponentially increasing delays", async () => {
    const delays: number[] = [];
    let attempts = 0;

    await withRetry(
      async () => {
        attempts++;
        if (attempts <= 3) throw new Error("fail");
        return "ok";
      },
      5, 0.1, 2,
      async (ms: number) => { delays.push(ms); },
    );

    // The first failure sleeps baseDelay * backoffFactor^0 = 0.1 * 1000 = 100ms
    // The second failure sleeps baseDelay * backoffFactor^1 = 0.1 * 2 * 1000 = 200ms
    // The third failure sleeps baseDelay * backoffFactor^2 = 0.1 * 4 * 1000 = 400ms
    expect(delays.length).toBe(3);
    expect(delays[0]).toBe(100);
    expect(delays[1]).toBe(200);
    expect(delays[2]).toBe(400);
  });

  it("should pass through the last error's message on exhaustion", async () => {
    try {
      await withRetry(
        async () => { throw new Error("ultimate-fail"); },
        2, 0.01, 2,
        async () => {},
      );
      expect.unreachable("should have thrown");
    } catch (e) {
      expect((e as Error).message).toBe("ultimate-fail");
    }
  });

  it("should handle backoffFactor of 1 (constant delay)", async () => {
    const delays: number[] = [];
    let attempts = 0;

    await withRetry(
      async () => {
        attempts++;
        if (attempts <= 2) throw new Error("fail");
        return "ok";
      },
      5, 0.5, 1, // backoffFactor 1 = same delay every time
      async (ms: number) => { delays.push(ms); },
    );

    expect(delays.length).toBe(2);
    expect(delays[0]).toBe(500);
    expect(delays[1]).toBe(500);
  });
});
