import { sleep } from "./utils.js";

/** Simple in-memory circuit breaker. */
export class CircuitBreaker {
  private failures = new Map<string, { count: number; lastFailure: number }>();
  private threshold: number;
  private cooldownMs: number;

  constructor(threshold: number, cooldownSeconds: number = 60) {
    this.threshold = threshold;
    this.cooldownMs = cooldownSeconds * 1000;
  }

  private key(executionId: string, nodeId: string, traceId: string): string {
    return `${executionId}:${nodeId}:${traceId}`;
  }

  isOpen(executionId: string, nodeId: string, traceId: string): boolean {
    const k = this.key(executionId, nodeId, traceId);
    const record = this.failures.get(k);
    if (!record) return false;
    if (Date.now() - record.lastFailure > this.cooldownMs) {
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
      current.lastFailure = Date.now();
    } else {
      this.failures.set(k, { count: 1, lastFailure: Date.now() });
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
  backoffFactor: number
): Promise<{ result: T; retryCount: number }> {
  let lastError: Error | undefined;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const result = await fn();
      return { result, retryCount: attempt };
    } catch (e) {
      lastError = e as Error;
      if (attempt === maxRetries) break;
      const delay = baseDelay * Math.pow(backoffFactor, attempt);
      await sleep(delay * 1000);
    }
  }
  throw lastError;
}
