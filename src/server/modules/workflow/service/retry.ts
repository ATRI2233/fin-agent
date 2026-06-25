import { sleep } from "./utils.js";

/**
 * Clock abstraction — allows injecting fake time in tests.
 * The real clock uses Date.now(); tests can provide a controlled clock.
 */
export interface Clock {
  now(): number;
}

/** Real clock implementation used in production. */
export const RealClock: Clock = { now: () => Date.now() };

/** Simple in-memory circuit breaker. */
export class CircuitBreaker {
  private failures = new Map<string, { count: number; lastFailure: number }>();
  private threshold: number;
  private cooldownMs: number;
  private clock: Clock;

  constructor(threshold: number, cooldownSeconds: number = 60, clock: Clock = RealClock) {
    this.threshold = threshold;
    this.cooldownMs = cooldownSeconds * 1000;
    this.clock = clock;
  }

  private key(executionId: string, nodeId: string, traceId: string): string {
    return `${executionId}:${nodeId}:${traceId}`;
  }

  isOpen(executionId: string, nodeId: string, traceId: string): boolean {
    const k = this.key(executionId, nodeId, traceId);
    const record = this.failures.get(k);
    if (!record) return false;
    if (this.clock.now() - record.lastFailure > this.cooldownMs) {
      this.failures.delete(k);
      return false;
    }
    return record.count >= this.threshold;
  }

  recordFailure(executionId: string, nodeId: string, traceId: string): void {
    const k = this.key(executionId, nodeId, traceId);
    const current = this.failures.get(k);
    if (current) {
      current.count++;
      current.lastFailure = this.clock.now();
    } else {
      this.failures.set(k, { count: 1, lastFailure: this.clock.now() });
    }
  }

  reset(executionId: string, nodeId: string, traceId: string): void {
    this.failures.delete(this.key(executionId, nodeId, traceId));
  }
}

/** Retry service with exponential backoff. */
export interface RetryResult {
  success: boolean;
  result?: unknown;
  error?: string;
  retryCount: number;
}

export async function withRetry<T>(
  fn: () => Promise<T>,
  maxRetries: number,
  baseDelay: number,
  backoffFactor: number,
  sleepFn: (ms: number) => Promise<void> = sleep,
): Promise<{ result: T; retryCount: number }> {
  let lastError: Error | undefined;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const result = await fn();
      return { result, retryCount: attempt };
    } catch (e) {
      lastError = e instanceof Error ? e : new Error(String(e));
      if (attempt === maxRetries) break;
      const delay = baseDelay * Math.pow(backoffFactor, attempt);
      await sleepFn(delay * 1000);
    }
  }
  throw lastError;
}
