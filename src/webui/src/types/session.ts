/**
 * Session types — mirror Pydantic shapes in `controllers/sessions.py`.
 *
 * snake_case is intentional: matches wire format from the backend.
 */

/** A single session row, as returned by GET / list endpoints. */
export interface SessionInfo {
  /** Server-assigned session UUID. */
  session_id: string;
  /** Origin: `'workflow'` for DAG executions, `'conversation'` for chats. */
  source: string;
  /** Owning workflow execution UUID; null for conversation-originated. */
  execution_id: string | null;
  /** Owning workflow node ID; null for conversation-originated. */
  node_id: string | null;
  /** Agent name bound to the session; null when unbound. */
  agent: string | null;
  /** Lifecycle state: `'active' | 'inactive' | 'cleaned_up' | 'unknown'`. */
  status: string;
  /** ISO-8601 UTC timestamp of session creation. */
  created_at: string | null;
}

/** Envelope returned by GET /api/v1/sessions. */
export interface SessionListResponse {
  sessions: SessionInfo[];
  total: number;
  active_count: number;
}

/** Request body for POST /api/v1/sessions/cleanup. */
export interface CleanupRequest {
  /** Cleanup sessions attached to this execution UUID. */
  execution_id?: string;
  /** When true, clean up all expired sessions server-wide. */
  all_expired?: boolean;
}

/** Response body for POST /api/v1/sessions/cleanup. */
export interface CleanupResponse {
  /** Number of sessions successfully removed. */
  cleaned: number;
  /** Number of sessions that failed to remove. */
  failed: number;
  /** Per-session status map (`session_id → "ok" | "<error message>"`). */
  details: Record<string, string>;
}
