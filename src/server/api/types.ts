/**
 * API contract types for all v1 routes.
 * Each route handler uses these instead of `as any`.
 */

import type { ExecutionStatus } from "../modules/execution/domain.js";

// ── Response Envelope ──

export interface ApiResponse<T> {
  data: T;
  trace_id: string | undefined;
}

// ── Params helper ──

export interface IdParam {
  id: string;
}

export interface NameParam {
  name: string;
}

// ── Workflow contracts ──

export interface TriggerWorkflowBody {
  params?: Record<string, unknown>;
}

export interface DagTriggerBody {
  sessionKey: string;
  workflowId: string;
  message?: string;
}

export interface TriggerWorkflowResponse {
  executionId: string;
  status: ExecutionStatus;
}

// ── Agent contracts ──

export interface DispatchAgentBody {
  input?: Record<string, unknown>;
}

export interface AgentInfo {
  name: string;
}

// ── MCP contracts ──

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

// ── Execution contracts ──

export interface ExecutionNode {
  id: string;
  nodeId: string;
  status: ExecutionStatus;
  input: unknown;
}

// ── Conversation contracts ──

import "fastify";
import type { Registry } from "../infra/registry.js";

declare module "fastify" {
  interface FastifyRequest {
    /** Unique trace id injected on every request by the onRequest hook in app.ts. */
    traceId: string | undefined;
    /** DI container — resolved once per server lifecycle, set via onRequest hook. May be null before hook runs. */
    registry: Registry | null;
  }
}
