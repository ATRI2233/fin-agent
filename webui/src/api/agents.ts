/**
 * Typed wrappers for the agent registry API.
 *
 * Mirrors the three routes declared in
 * `main/framework/controllers/agents.py`:
 *
 *   GET /api/v1/agents          → list of agent summaries
 *   GET /api/v1/agents/stats    → per-agent execution telemetry
 *   GET /api/v1/agents/{name}   → single agent summary (404 on miss)
 *
 * The backend returns snake_case fields, which line up with the
 * canonical `Agent` and `AgentDetail` shapes in `../types/agent` —
 * no transformation is needed on the client.
 *
 * Notes
 * -----
 * - `getAgentStats` returns a `Record<name, …>` so callers can index
 *   by agent name without scanning an array.
 * - `getAgent` URL-encodes the name so spaces / slashes round-trip
 *   safely through the FastAPI path matcher.
 */

import { API_V1_BASE } from '../config/env';
import type { Agent, AgentDetail } from '../types/agent';

/**
 * Per-agent execution telemetry returned by `/api/v1/agents/stats`.
 *
 * Each entry contains agent name, description, mode, and execution stats.
 */
export interface AgentStatsEntry {
  /** Agent name. */
  name: string;
  /** Agent description. */
  description: string;
  /** Agent mode (agent, fusion, orchestrator). */
  mode: string;
  /** Total number of executions. */
  executions_total: number;
  /** Number of completed executions. */
  executions_completed: number;
  /** Number of failed executions. */
  executions_failed: number;
  /** Percent of executions that completed without error (0–100). */
  success_rate: number;
}

/**
 * Fetch every registered agent.
 *
 * `GET /api/v1/agents` → `Agent[]`
 */
export async function listAgents(): Promise<Agent[]> {
  const res = await fetch(`${API_V1_BASE}/agents`);
  if (!res.ok) {
    throw new Error(
      `listAgents failed: ${res.status} ${res.statusText}`,
    );
  }
  return (await res.json()) as Agent[];
}

/**
 * Fetch execution telemetry for all agents in one round-trip.
 *
 * `GET /api/v1/agents/stats` → `AgentStatsEntry[]`
 */
export async function getAgentStats(): Promise<AgentStatsEntry[]> {
  const res = await fetch(`${API_V1_BASE}/agents/stats`);
  if (!res.ok) {
    throw new Error(
      `getAgentStats failed: ${res.status} ${res.statusText}`,
    );
  }
  return (await res.json()) as AgentStatsEntry[];
}

/**
 * Fetch a single agent by registry name.
 *
 * `GET /api/v1/agents/{name}` → `AgentDetail`
 *
 * The backend raises 404 when `name` is unknown; the resulting
 * `TypeError` is rethrown so callers can branch on the status code.
 */
export async function getAgent(name: string): Promise<AgentDetail> {
  const res = await fetch(
    `${API_V1_BASE}/agents/${encodeURIComponent(name)}`,
  );
  if (!res.ok) {
    throw new Error(
      `getAgent(${name}) failed: ${res.status} ${res.statusText}`,
    );
  }
  return (await res.json()) as AgentDetail;
}
