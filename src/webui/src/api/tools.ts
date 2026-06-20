/**
 * Typed wrappers for the tool registry API.
 *
 * Mirrors the three routes declared in
 * `main/framework/controllers/tools.py`:
 *
 * GET /api/v1/tools → list of MCP tool descriptors
 * GET /api/v1/tools/{name} → single tool (404 on miss)
 * GET /api/v1/tools/{name}/invoke → invocation result (v1 stub)
 *
 * The backend returns snake_case fields, which line up with the
 * canonical `ToolItem` shape in `../types/agent` — no transformation
 * is needed on the client.
 *
 * Notes
 * -----
 * - `getTool` URL-encodes the name so spaces / slashes round-trip
 * safely through the FastAPI path matcher.
 * - `invokeTool` hits the v1 stub endpoint (GET) — direct tool
 * invocation returns `{ error: "..." }` until MCP dispatch lands.
 * The optional `args` parameter is accepted for forward-compat but
 * currently ignored by the backend.
 */

import { API_V1_BASE } from '../config/env';
import { apiGet, apiPost, buildUrl } from './http';
import type { ToolItem } from '../types/agent';

/**
 * Fetch every registered MCP tool across all enabled servers.
 *
 * `GET /api/v1/tools` → `ToolItem[]`
 */
export async function listTools(): Promise<ToolItem[]> {
  return apiGet<ToolItem[]>(buildUrl(API_V1_BASE, '/tools'));
}

/**
 * Fetch a single tool descriptor by registry name.
 *
 * `GET /api/v1/tools/{name}` → `ToolItem`
 *
 * The backend raises 404 when `name` is unknown; `apiGet` surfaces
 * the failure as an `ApiError` so callers can branch on the status.
 */
export async function getTool(name: string): Promise<ToolItem> {
  return apiGet<ToolItem>(
    buildUrl(API_V1_BASE, `/tools/${encodeURIComponent(name)}`),
  );
}

/**
 * Invoke a tool by registry name.
 *
 * `POST /api/v1/tools/{name}/invoke` → `{ result: unknown; error?: string }`
 *
 * @param name - Tool registry name.
 * @param args - Optional arguments for the tool.
 */
export async function invokeTool(
  name: string,
  args?: unknown,
): Promise<{ result: unknown; error?: string }> {
  return apiPost<{ result: unknown; error?: string }>(
    buildUrl(API_V1_BASE, `/tools/${encodeURIComponent(name)}/invoke`),
    args ?? {},
  );
}
