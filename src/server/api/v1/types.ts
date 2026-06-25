/* eslint-disable @typescript-eslint/no-unused-vars */
/**
 * Typed contracts for v1 route handlers.
 *
 * Each type replaces a previous `as any` or `as { ... }` cast, giving the
 * compiler enough information to catch mismatches without runtime cost.
 */

// ---------------------------------------------------------------------------
// MCP types
// ---------------------------------------------------------------------------

export interface McpToolItem {
  name: string;
  description?: string;
  server: string;
}

export interface McpServerItem {
  name: string;
  description?: string;
  toolCount: number;
}

export interface CallMcpToolBody {
  tool: string;
  args?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Shared param types
// ---------------------------------------------------------------------------

export interface NameParam {
  name: string;
}

export interface IdParam {
  id: string;
}
