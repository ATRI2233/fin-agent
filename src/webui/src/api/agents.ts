/**
 * Typed wrappers for the agent registry API.
 *
 * Mirrors the routes declared in `src/main/api/v1/agents.py`:
 *
 * GET  /api/v1/agents                       → list of agent summaries
 * GET  /api/v1/agents/{name}                → single agent summary (404 on miss)
 * GET  /api/v1/mcp/agents/{name}/allowed-tools → tools whitelist (MCP domain)
 */

import { apiGet } from './http';
import { ROUTES } from './contract';
import type { Agent, AgentDetail } from '../domain/agent';

/**
 * Fetch every registered agent.
 */
export async function listAgents(signal?: AbortSignal): Promise<Agent[] | undefined> {
  return apiGet<Agent[]>(ROUTES.agents.list, signal);
}

/**
 * Fetch a single agent by registry name.
 */
export async function getAgent(name: string, signal?: AbortSignal): Promise<AgentDetail | undefined> {
  return apiGet<AgentDetail>(ROUTES.agents.get(name), signal);
}

