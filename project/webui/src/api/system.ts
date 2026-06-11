/**
 * Typed wrappers for the System API.
 *
 * Source of truth: `project/main/framework/services/system_query_service.py`
 * (FastAPI router at `/api/v1/system`). Each function maps 1:1 to a
 * route handler and preserves the snake_case wire format — do NOT
 * auto-convert field names; the server speaks snake_case and the WebUI
 * must consume it as-is.
 *
 * The transport layer (`apiGet`) is defined in `./client` and is
 * responsible for base-URL resolution, JSON encoding, error
 * normalisation, and response unwrapping.
 *
 * Exported symbols (de-facto `__all__`):
 *   - getSystemStatus  — GET  /api/v1/system/status
 *   - getLogsStats     — GET  /api/v1/system/logs/stats
 *   - getCacheState    — GET  /api/v1/system/cache
 */

import { API_V1_BASE } from '../config/env'
import { apiGet } from './client'
import type { CacheState, LogStats, SystemStatus } from '../types/system'

/**
 * GET `/api/v1/system/status` — aggregate subsystem health snapshot.
 *
 * Consolidates the opencode backend, scheduler, and session counters
 * into a single payload for the dashboard / status page. The endpoint
 * is exception-safe on the server side and always returns 200, so a
 * missing subsystem surfaces as default values rather than an error.
 *
 * @returns A {@link SystemStatus} with `opencode`, `scheduler`,
 *          `sessions`, `uptime_seconds`, and `version` fields.
 */
export async function getSystemStatus(): Promise<SystemStatus> {
  return apiGet<SystemStatus>(`${API_V1_BASE}/system/status`)
}

/**
 * GET `/api/v1/system/logs/stats` — per-job log-collector counts.
 *
 * Returns aggregate counts split by log level plus the total number
 * of captured entries, sourced from the in-memory `LogCollector`.
 * Used by the dashboard's log widget to render severity badges.
 *
 * @returns A {@link LogStats} with `info`, `warn`, `error`, `debug`,
 *          and `total` fields.
 */
export async function getLogsStats(): Promise<LogStats> {
  return apiGet<LogStats>(`${API_V1_BASE}/system/logs/stats`)
}

/**
 * GET `/api/v1/system/cache` — workflow cache snapshot.
 *
 * Reports the current size of the in-memory workflow cache plus its
 * hit rate (when the collector has recorded at least one lookup).
 * Used by the dashboard's cache panel to visualise utilisation.
 *
 * @returns A {@link CacheState} with `entries`, `size_bytes`, and an
 *          optional `hit_rate` in `[0, 1]`.
 */
export async function getCacheState(): Promise<CacheState> {
  return apiGet<CacheState>(`${API_V1_BASE}/system/cache`)
}
