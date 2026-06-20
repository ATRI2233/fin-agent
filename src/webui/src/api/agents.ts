/**
 * Typed wrappers for the agent registry API.
 *
 * Mirrors the routes declared in `src/main/api/v1/agents.py`:
 *
 * GET  /api/v1/agents                       → list of agent summaries
 * GET  /api/v1/agents/{name}                → single agent summary (404 on miss)
 * GET  /api/v1/mcp/agents/{name}/allowed-tools → tools whitelist (MCP domain)
 */

import { API_V1_BASE } from '../config/env';
import { apiGet, buildUrl } from './http';
import { ROUTES } from './contract';
import type { Agent, AgentDetail } from '../types/agent';

/**
 * Fetch every registered agent.
 */
export async function listAgents(): Promise<Agent[]> {
  return apiGet<Agent[]>(buildUrl(API_V1_BASE, ROUTES.agents.list));
}

/**
 * Fetch a single agent by registry name.
 */
export async function getAgent(name: string): Promise<AgentDetail> {
  return apiGet<AgentDetail>(ROUTES.agents.get(name));
}

/**
 * Fetch the tools whitelist for an agent.
 *
 * Backed by the MCP registry endpoint (`/api/v1/mcp/agents/{name}/allowed-tools`),
 * not the legacy `/agents/{name}/tools-whitelist` route.
 */
export async function getAgentToolsWhitelist(name: string): Promise<string[]> {
  try {
    const res = await apiGet<{ tools_whitelist: string[] }>(ROUTES.mcp.allowedTools(name));
    return res.tools_whitelist || [];
  } catch {
    return [];
  }
}
