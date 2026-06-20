/**
 * Typed wrappers for the agent registry API.
 *
 * Mirrors the routes declared in `main/framework/controllers/agents.py`:
 *
 * GET /api/v1/agents → list of agent summaries
 * GET /api/v1/agents/stats → per-agent execution telemetry
 * GET /api/v1/agents/{name} → single agent summary (404 on miss)
 * GET /api/v1/agents/{name}/content → agent markdown content
 * PUT /api/v1/agents/{name} → create/update agent
 * DELETE /api/v1/agents/{name} → delete agent
 * GET /api/v1/agents/{name}/tools-whitelist → tools whitelist
 * PUT /api/v1/agents/{name}/tools-whitelist → update tools whitelist
 */

import { API_V1_BASE } from '../config/env';
import { apiGet, apiPut, apiDelete, apiGetText, apiPutText, buildUrl } from './http';
import type { Agent, AgentDetail } from '../types/agent';

/**
 * Per-agent execution telemetry returned by `/api/v1/agents/stats`.
 */
export interface AgentStatsEntry {
  name: string;
  description: string;
  mode: string;
  executions_total: number;
  executions_completed: number;
  executions_failed: number;
  success_rate: number;
}

/**
 * Fetch every registered agent.
 */
export async function listAgents(): Promise<Agent[]> {
  return apiGet<Agent[]>(buildUrl(API_V1_BASE, '/agents'));
}

/**
 * Fetch execution telemetry for all agents.
 */
export async function getAgentStats(): Promise<AgentStatsEntry[]> {
  return apiGet<AgentStatsEntry[]>(buildUrl(API_V1_BASE, '/agents/stats'));
}

/**
 * Fetch a single agent by registry name.
 */
export async function getAgent(name: string): Promise<AgentDetail> {
  return apiGet<AgentDetail>(
    buildUrl(API_V1_BASE, `/agents/${encodeURIComponent(name)}`),
  );
}

/**
 * Fetch agent markdown content.
 */
export async function getAgentContent(name: string): Promise<string> {
  return apiGetText(buildUrl(API_V1_BASE, `/agents/${encodeURIComponent(name)}/content`));
}

/**
 * Create or update an agent (writes .md file).
 */
export async function updateAgent(name: string, content: string): Promise<void> {
  return apiPutText(buildUrl(API_V1_BASE, `/agents/${encodeURIComponent(name)}`), content);
}

/**
 * Delete an agent (.md file + config entry).
 */
export async function deleteAgent(name: string): Promise<void> {
  return apiDelete<void>(
    buildUrl(API_V1_BASE, `/agents/${encodeURIComponent(name)}`),
  );
}

/**
 * Fetch the tools whitelist for an agent.
 */
export async function getAgentToolsWhitelist(name: string): Promise<string[]> {
  try {
    const res = await apiGet<{ tools_whitelist: string[] }>(
      buildUrl(API_V1_BASE, `/agents/${encodeURIComponent(name)}/tools-whitelist`),
    );
    return res.tools_whitelist || [];
  } catch {
    return [];
  }
}

/**
 * Update the tools whitelist for an agent.
 */
export async function updateAgentToolsWhitelist(
  name: string,
  whitelist: string[],
): Promise<void> {
  await apiPut(
    buildUrl(API_V1_BASE, `/agents/${encodeURIComponent(name)}/tools-whitelist`),
    { tools_whitelist: whitelist },
  );
}
