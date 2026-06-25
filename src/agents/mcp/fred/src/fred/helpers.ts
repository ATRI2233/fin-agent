/**
 * Shared helper functions for FRED MCP tools
 *
 * Extracted from repeated patterns across browse.ts, series.ts, and search.ts
 * to reduce code duplication (R2, R7, R8).
 */
import { FREDConfigError } from "../common/request.js";

/**
 * Error response shape returned by FRED tools
 */
export interface ToolErrorResponse {
  content: Array<{ type: "text"; text: string }>;
  isError: boolean;
}

/**
 * Handle errors in FRED tool functions uniformly.
 *
 * - FREDConfigError: returns a user-facing error response (not thrown)
 * - Other Error instances: re-throws with a contextual message
 * - Non-Error throws: re-thrown as-is
 *
 * Use this to replace the repetitive 9-line FREDConfigError catch pattern.
 *
 * @example
 * try { ... } catch (error) {
 *   return handleToolError(error, "browse categories");
 * }
 */
export function handleToolError(error: unknown, context: string): ToolErrorResponse {
  if (error instanceof FREDConfigError) {
    return {
      content: [{
        type: "text" as const,
        text: JSON.stringify({
          error: "FRED API key is not configured. Please contact the administrator.",
          detail: error.message
        }, null, 2)
      }],
      isError: true
    };
  }
  if (error instanceof Error) {
    throw new Error(`Failed to ${context}: ${error.message}`);
  }
  throw error;
}

/**
 * Format pagination display string for paginated API responses.
 *
 * Example: offset=0, limit=25, count=100 -> "1-25"
 *          offset=25, limit=25, count=100 -> "26-50"
 *          offset=undefined, limit=undefined, count=10 -> "1-10"
 */
export function formatPaginationDisplay(
  offset: number | undefined,
  limit: number | undefined,
  count: number
): string {
  const off = offset ?? 0;
  const lim = limit ?? count;
  return `${off + 1}-${Math.min(off + lim, count)}`;
}

/**
 * Build query parameters from an options object, including only defined/non-null values.
 * Optionally merge extra fields that are always present.
 *
 * Consolidates the repetitive param-building pattern across browse.ts and series.ts.
 *
 * @example
 * buildQueryParams({ limit: 10, offset: undefined }, { category_id: 123 })
 * // -> { category_id: 123, limit: 10 }
 */
export function buildQueryParams(
  options: Record<string, unknown>,
  extraFields?: Record<string, string | number>
): Record<string, string | number> {
  const params: Record<string, string | number> = { ...(extraFields ?? {}) };
  for (const [key, value] of Object.entries(options)) {
    if (value !== undefined && value !== null) {
      params[key] = value as string | number;
    }
  }
  return params;
}
