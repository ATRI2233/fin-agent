/**
 * Typed wrappers for the Session API.
 *
 * Source of truth: `project/main/framework/controllers/sessions.py`
 * (FastAPI router at `/api/v1/sessions`). Each function maps 1:1 to a
 * route handler and preserves the snake_case wire format — do NOT
 * auto-convert field names; the server speaks snake_case and the WebUI
 * must consume it as-is.
 *
 * The transport layer (`apiGet` / `apiPost` / `apiDelete`) is defined
 * in `./client` and is responsible for base-URL resolution, JSON
 * encoding, error normalisation, and response unwrapping.
 *
 * Exported symbols (de-facto `__all__`):
 * - listSessions — GET /api/v1/sessions
 * - getSession — GET /api/v1/sessions/{id}
 * - deleteSession — DELETE /api/v1/sessions/{id}
 * - cleanupSessions — POST /api/v1/sessions/cleanup
 */

import { API_V1_BASE } from '../config/env'
import { apiDelete, apiGet, apiPost } from './http'
import type {
  SessionInfo,
  SessionListResponse,
  CleanupRequest,
  CleanupResponse,
} from '../types/session'

export type { SessionInfo, SessionListResponse, CleanupRequest, CleanupResponse }

// ---------------------------------------------------------------------------
// Endpoints
// ---------------------------------------------------------------------------

/**
 * GET `/api/v1/sessions` — list all known sessions.
 *
 * Aggregates sessions from workflow executions and conversations into a
 * single paginated envelope with `total` and `active_count` counters.
 *
 * @param params.conversation_id Optional conversation UUID to scope sessions.
 * @returns Envelope of session rows.
 */
export async function listSessions(params?: {
  conversation_id?: string
}): Promise<SessionListResponse> {
  const search = new URLSearchParams()
  if (params?.conversation_id) {
    search.set('conversation_id', params.conversation_id)
  }
  const query = search.toString()
  const url = query.length > 0
    ? `${API_V1_BASE}/sessions?${query}`
    : `${API_V1_BASE}/sessions`
  return apiGet<SessionListResponse>(url)
}

/**
 * GET `/api/v1/sessions/{id}` — fetch a single session by ID.
 *
 * @param id Server-assigned session UUID.
 * @returns The session row. Throws on 404 (not found) and 500.
 */
export async function getSession(id: string): Promise<SessionInfo> {
  return apiGet<SessionInfo>(`${API_V1_BASE}/sessions/${id}`)
}

/**
 * DELETE `/api/v1/sessions/{id}` — tear down a specific session.
 *
 * The backend has no typed response model for this route; the resolved
 * Promise is `void`. Associated workflow / conversation references are
 * cleaned up server-side.
 *
 * @param id Server-assigned session UUID to remove.
 */
export async function deleteSession(id: string): Promise<void> {
  await apiDelete<void>(`${API_V1_BASE}/sessions/${id}`)
}

/**
 * POST `/api/v1/sessions/cleanup` — bulk cleanup sessions.
 *
 * Provide either `execution_id` (clean sessions for that execution) or
 * `all_expired: true` (clean all expired sessions server-wide). The
 * response carries per-session status in `details` so callers can show
 * a partial-failure UI.
 *
 * @param data Cleanup selector. At least one of `execution_id` or
 * `all_expired` should be set; the backend returns 400
 * otherwise.
 * @returns Counts of cleaned / failed sessions plus a per-session
 * status map.
 */
export async function cleanupSessions(
  data: CleanupRequest,
): Promise<CleanupResponse> {
  return apiPost<CleanupResponse>(`${API_V1_BASE}/sessions/cleanup`, data)
}
