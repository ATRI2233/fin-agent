/**
 * Agent dispatcher module — provides createAgentDispatcher factory for
 * constructing AgentPort-based dispatch services.
 *
 * This module exists to satisfy the integration test imports. The actual
 * agent invocation logic lives in the OpenClawAdapter.
 */

import type { AgentPort } from "../../../agents/adapter/AgentPort.js";

export interface AgentDispatcher {
  dispatch(agentName: string, payload: Record<string, unknown>, traceId: string): Promise<unknown>;
}

/**
 * Factory function for creating an AgentDispatcher instance.
 * Used by integration tests to inject a mock or real AgentPort.
 */
export function createAgentDispatcher(port?: AgentPort): AgentDispatcher {
  if (port) {
    return {
      async dispatch(agentName: string, payload: Record<string, unknown>, traceId: string): Promise<unknown> {
        const result = await port.invoke({ agentName, payload, traceId });
        return result.content;
      },
    };
  }
  // No-port fallback: returns a no-op dispatcher (for tests that don't need real dispatch)
  return {
    async dispatch(_agentName: string, _payload: Record<string, unknown>, _traceId: string): Promise<unknown> {
      return { status: "skipped", message: "No AgentPort provided — dispatch not available" };
    },
  };
}
