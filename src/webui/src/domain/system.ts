/**
 * TypeScript types for the `/api/v1/system/*` endpoints.
 *
 * Source of truth (backend): `project/main/framework/services/system_query_service.py`.
 *
 * Three endpoints live behind this facade:
 * - `GET /api/v1/system/status` — opencode / scheduler / sessions
 * - `GET /api/v1/system/logs` — per-job log counts (top-N)
 * - `GET /api/v1/system/cache` — workflow cache + concurrency limiter
 *
 * Field names use snake_case to match the Pydantic v2 wire format
 * (FastAPI does NOT auto-convert to camelCase).
 *
 * Exported symbols (the de-facto `__all__` for this module):
 * - SystemStatus — dashboard / sessions subsystem snapshot
 * - LogStats — per-job log-collector counts
 * - CacheState — workflow cache + concurrency limiter snapshot
 * - WorkflowStats — re-exported from `./workflow`
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
    online: boolean;
    /** Path to the OpenCode binary. */
    binary?: string;
  };
  /** Job executor status. */
  jobExecutor: {
    /** Whether the executor is running. */
    running: boolean;
    /** Worker thread status. */
    workerThread: string;
  };
  /** Concurrency limiter status. */
  concurrency: {
    /** Current active executions. */
    current: number;
    /** Maximum concurrent executions. */
    max: number;
    /** Available execution slots. */
    available: number;
  };
  /** APScheduler liveness + registered job count. */
  scheduler: {
    /** Whether the scheduler is currently running. */
    running: boolean;
    /** Number of registered cron jobs. */
    scheduledJobs: number;
    /** Next scheduled run time. */
    nextRun: string | null;
  };
  /** Session subsystem counters. */
  sessions: {
    /** List of active sessions. */
    active: Array<{
      sessionId: string;
      status: string;
      agent: string;
      startedAt: string | null;
      updatedAt: string | null;
    }>;
    /** Number of active sessions. */
    count: number;
    /** Total sessions known to the system (DB-backed historical count). */
    total: number;
  };
  /** ISO-8601 UTC timestamp. */
  timestamp: string;
}

/** Per-job log-collector counts returned by `GET /api/v1/system/logs/stats`. */
export interface LogStats {
  /** Number of jobs that have log entries. */
  active_jobs_with_logs: number;
  /** Total log entries across all levels and jobs. */
  total_log_entries: number;
  /** Maximum number of jobs the collector can track. */
  max_jobs: number;
  /** Maximum entries per job buffer. */
  max_entries_per_job: number;
  /** Top jobs by log count. */
  top_jobs: Record<string, number>;
  /** Currently active job ID. */
  current_job_id: string | null;
}

/** Workflow cache snapshot returned by `GET /api/v1/system/cache`. */
export interface CacheState {
  /** Workflow cache info. */
  workflow_cache: {
    /** Number of entries currently in the cache. */
    size: number;
    /** Maximum cache size. */
    max_size: number;
    /** Cache usage percentage. */
    usage_pct: number;
  };
  /** Concurrency limiter info. */
  concurrency: {
    /** Currently active executions. */
    active: number;
    /** Maximum concurrent executions. */
    max: number;
    /** Available execution slots. */
    available: number;
    /** Usage percentage. */
    usage_pct: number;
  };
}
