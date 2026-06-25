/**
 * MCP (Model Context Protocol) API.
 *
 * Source of truth: `src/main/api/v1/mcp.py` (FastAPI router at
 * `/api/v1/mcp`). Each function maps 1:1 to a route handler and
 * preserves the snake_case wire format.
 *
 * The transport layer (`apiGet` / `apiPost`) is defined in `./http`
 * and is responsible for base-URL resolution, JSON encoding, error
 * normalisation, and response unwrapping.
 *
 * Exported symbols:
 * - listTools       — GET /api/v1/mcp/tools
 * - listServers     — GET /api/v1/mcp/servers
 * - listAllowedTools — GET /api/v1/mcp/agents/{name}/allowed-tools
 */
import { apiGet } from "./http";
import { ROUTES } from "./contract";
import type { ToolItem } from "../domain/agent";

/**
 * Fetch every registered MCP tool across all enabled servers.
 *
 * `GET /api/v1/mcp/tools` → `ToolItem[]`
 */
export async function listTools(signal?: AbortSignal): Promise<ToolItem[]> {
  return apiGet<ToolItem[]>(ROUTES.mcp.tools, signal);
}

/**
 * Fetch the list of registered MCP servers.
 *
 * `GET /api/v1/mcp/servers` → `unknown[]` (server descriptors;
 * concrete shape defined by `src/main/modules/mcp/domain/`).
 */
export async function listServers(signal?: AbortSignal): Promise<unknown[]> {
  return apiGet<unknown[]>(ROUTES.mcp.servers, signal);
}

/**
 * Fetch the tools-whitelist for a specific agent.
 *
 * `GET /api/v1/mcp/agents/{name}/allowed-tools` → `string[]`
 *
 * The agent name is URL-encoded by `ROUTES.mcp.allowedTools` so
 * spaces / slashes round-trip safely through the FastAPI matcher.
 */
export async function listAllowedTools(name: string, signal?: AbortSignal): Promise<string[]> {
  return apiGet<string[]>(ROUTES.mcp.allowedTools(name), signal);
}

export type { ToolItem };