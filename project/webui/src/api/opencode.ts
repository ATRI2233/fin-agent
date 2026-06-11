/**
 * Typed wrappers for the OpenCode CLI proxy API.
 *
 * The webui talks to two backends:
 *
 *   - the Fin-Agent framework (FastAPI, mounted at `API_V1_BASE`), and
 *   - the OpenCode CLI proxy (mounted at `OPENCODE_API_BASE`).
 *
 * Resource modules in `webui/src/api/` own the framework routes. This
 * module owns the *proxy* routes: agent registry CRUD, MCP tool
 * listing, tools-whitelist management, batch-model updates, etc.
 * None of those routes have a formal controller on the framework side
 * — they are served directly by the OpenCode proxy on `localhost:9876`
 * and shaped by the opencode.json registry.
 *
 * The helpers are intentionally thin. They:
 *
 *   1. Join the caller's relative `path` with `OPENCODE_API_BASE`
 *      via {@link buildUrl} so trailing/leading slashes are normalised.
 *   2. Delegate to the shared `apiGet/apiPost/apiPut/apiDelete`
 *      helpers in `./client` for header injection, JSON encoding,
 *      and `ApiError` normalisation. The signal parameter from
 *      `./client` is intentionally not exposed — current callers do
 *      not need cancellation and the simpler signature keeps pages
 *      free of abort-controller boilerplate.
 *
 * The response types are left generic; pages opt-in to a concrete `T`
 * (e.g. `AgentContent`, `ToolsWhitelist`, `ModelsByAgent`) and rely
 * on the proxy to honour the contract documented in
 * `.opencode/opencode.json` and `agents/opencode/`.
 *
 * @see ./client for the underlying fetch helpers.
 * @see ../config/env for the base URL configuration.
 */

import { OPENCODE_API_BASE } from '../config/env';
import { apiGet, apiPost, apiPut, apiDelete, buildUrl } from './client';

/**
 * Issue a `GET` request to the OpenCode proxy.
 *
 * @param path - Path relative to `OPENCODE_API_BASE` (e.g. `/agents`).
 *   A leading slash is added if missing; the base URL's trailing slash
 *   is stripped.
 */
export function opencodeGet<T>(path: string): Promise<T> {
  return apiGet<T>(buildUrl(OPENCODE_API_BASE, path));
}

/**
 * Issue a `POST` request to the OpenCode proxy with a JSON body.
 *
 * @param path - Path relative to `OPENCODE_API_BASE`.
 * @param body - Plain object that will be `JSON.stringify`-ed.
 */
export function opencodePost<T>(path: string, body: unknown): Promise<T> {
  return apiPost<T>(buildUrl(OPENCODE_API_BASE, path), body);
}

/**
 * Issue a `PUT` request to the OpenCode proxy with a JSON body.
 *
 * @param path - Path relative to `OPENCODE_API_BASE`.
 * @param body - Plain object that will be `JSON.stringify`-ed.
 */
export function opencodePut<T>(path: string, body: unknown): Promise<T> {
  return apiPut<T>(buildUrl(OPENCODE_API_BASE, path), body);
}

/**
 * Issue a `DELETE` request to the OpenCode proxy.
 *
 * @param path - Path relative to `OPENCODE_API_BASE`.
 */
export function opencodeDelete<T>(path: string): Promise<T> {
  return apiDelete<T>(buildUrl(OPENCODE_API_BASE, path));
}
