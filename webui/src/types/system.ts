/**
 * TypeScript types for the `/api/v1/system/*` endpoints.
 *
 * Source of truth (backend): `project/main/framework/services/system_query_service.py`.
 *
 * Three endpoints live behind this facade:
 *   - `GET /api/v1/system/status`  — opencode / scheduler / sessions
 *   - `GET /api/v1/system/logs`    — per-job log counts (top-N)
 *   - `GET /api/v1/system/cache`   — workflow cache + concurrency limiter
 *
 * Field names use snake_case to match the Pydantic v2 wire format
 * (FastAPI does NOT auto-convert to camelCase).
 *
 * Exported symbols (the de-facto `__all__` for this module):
 *   - SystemStatus   — dashboard / sessions subsystem snapshot
 *   - LogStats       — per-job log-collector counts
 *   - CacheState     — workflow cache + concurrency limiter snapshot
 *   - WorkflowStats  — re-exported from `./workflow`
 */

import type { WorkflowStats } from "./workflow";

export type { WorkflowStats };

/**
 * Health / liveness snapshot returned by `GET /api/v1/system/status`.
 *
 * Consolidates the two previously-duplicated shapes that lived in
 * `Dashboard.tsx` and `SessionsPage.tsx` into a single canonical type.
 */
export interface SystemStatus {
  /** OpenCode backend liveness. */
  opencode: {
    /** Whether the OpenCode binary is reachable / responding. */
    running: boolean;
    /** Reported OpenCode version, when discoverable. */
    version?: string;
    /** Port the OpenCode backend is listening on. */
    port?: number;
  };
  /** APScheduler liveness + registered job count. */
  scheduler: {
    /** Whether the scheduler is currently running. */
    running: boolean;
    /** Number of registered cron jobs. */
    jobs: number;
  };
  /** Session subsystem counters. */
  sessions: {
    /** Number of sessions currently active in-process. */
    active: number;
    /** Total sessions known to the system (DB-backed historical count). */
    total: number;
  };
  /** Seconds since the framework process started. */
  uptime_seconds: number;
  /** Framework semantic version (e.g. `0.4.0`). */
  version: string;
}

/** Per-job log-collector counts returned by `GET /api/v1/system/logs`. */
export interface LogStats {
  /** Number of `INFO`-level entries across all jobs. */
  info: number;
  /** Number of `WARN`-level entries across all jobs. */
  warn: number;
  /** Number of `ERROR`-level entries across all jobs. */
  error: number;
  /** Number of `DEBUG`-level entries across all jobs. */
  debug: number;
  /** Total log entries across all levels and jobs. */
  total: number;
}

/** Workflow cache snapshot returned by `GET /api/v1/system/cache`. */
export interface CacheState {
  /** Number of entries currently in the in-memory workflow cache. */
  entries: number;
  /** Approximate size of the workflow cache in bytes. */
  size_bytes: number;
  /** Cache hit rate in `[0, 1]`. Absent when no lookups recorded yet. */
  hit_rate?: number;
}
