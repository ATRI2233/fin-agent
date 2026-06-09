"""
In-memory job log collector with custom logging handler.

Captures log entries per job_id using a context variable to track which
job is currently executing. Thread-safe; no DB writes required.
"""

import logging
import threading
from collections import deque
from contextvars import ContextVar
from dataclasses import dataclass
from datetime import datetime
from typing import Optional

# Context variable to track the current job_id during execution.
# Set by the executor before dispatching to an agent.
current_job_id: ContextVar[str | None] = ContextVar("current_job_id", default=None)


@dataclass
class LogEntry:
    """A single captured log entry."""

    timestamp: datetime
    level: str
    message: str
    job_id: str | None = None
    agent: str | None = None
    logger_name: str | None = None

    def to_dict(self) -> dict:
        return {
            "timestamp": self.timestamp.isoformat() + "Z",
            "level": self.level,
            "message": self.message,
            "agent": self.agent,
        }


class JobLogHandler(logging.Handler):
    """Custom logging handler that captures log entries tagged with a job_id."""

    def __init__(self, collector: "LogCollector"):
        super().__init__()
        self.collector = collector

    def emit(self, record: logging.LogRecord):
        job_id = current_job_id.get()
        if not job_id:
            return  # Not inside a job execution context

        try:
            entry = LogEntry(
                timestamp=datetime.utcfromtimestamp(record.created),
                level=record.levelname,
                message=self.format(record),
                job_id=job_id,
                agent=getattr(record, "agent", None),
                logger_name=record.name,
            )
            self.collector.add(entry)
        except Exception:
            self.handleError(record)


class LogCollector:
    """
    Thread-safe in-memory log storage.

    Stores log entries per job_id using bounded deques to prevent
    unbounded memory growth. Entries are evicted oldest-first.
    """

    def __init__(self, max_entries_per_job: int = 1000, max_jobs: int = 200):
        self._lock = threading.Lock()
        self._max_entries_per_job = max_entries_per_job
        self._max_jobs = max_jobs
        self._logs: dict[str, deque[LogEntry]] = {}

    def add(self, entry: LogEntry):
        """Add a log entry (called by the handler)."""
        if not entry.job_id:
            return
        with self._lock:
            if entry.job_id not in self._logs:
                # Evict oldest job if at capacity
                if len(self._logs) >= self._max_jobs:
                    oldest_key = next(iter(self._logs))
                    del self._logs[oldest_key]
                self._logs[entry.job_id] = deque(maxlen=self._max_entries_per_job)
            self._logs[entry.job_id].append(entry)

    def get_logs(
        self,
        job_id: str,
        since: datetime | None = None,
        until: datetime | None = None,
        level: str | None = None,
        limit: int = 500,
    ) -> list[LogEntry]:
        """
        Retrieve log entries for a job with optional filtering.

        Args:
            job_id: The job to query logs for.
            since: Only return entries after this timestamp (inclusive).
            until: Only return entries before this timestamp (inclusive).
            level: Filter by log level name (DEBUG/INFO/WARNING/ERROR/CRITICAL).
            limit: Max entries to return.

        Returns:
            List of LogEntry objects sorted by timestamp ascending.
        """
        with self._lock:
            entries = list(self._logs.get(job_id, []))

        # Apply filters
        if since is not None:
            entries = [e for e in entries if e.timestamp >= since]
        if until is not None:
            entries = [e for e in entries if e.timestamp <= until]
        if level is not None:
            target = level.upper()
            entries = [e for e in entries if e.level == target]

        # Sort by timestamp ascending and limit
        entries.sort(key=lambda e: e.timestamp)
        return entries[:limit]

    def has_logs(self, job_id: str) -> bool:
        """Check whether any logs exist for a given job."""
        with self._lock:
            return job_id in self._logs and len(self._logs[job_id]) > 0

    def clear_job(self, job_id: str):
        """Remove all logs for a specific job."""
        with self._lock:
            self._logs.pop(job_id, None)

    def count(self, job_id: str) -> int:
        """Return the number of log entries for a job."""
        with self._lock:
            buf = self._logs.get(job_id)
            return len(buf) if buf else 0

    def stats(self) -> dict:
        """Return summary statistics about stored logs."""
        with self._lock:
            total_entries = sum(len(buf) for buf in self._logs.values())
            return {
                "total_jobs": len(self._logs),
                "total_entries": total_entries,
                "max_jobs": self._max_jobs,
                "max_entries_per_job": self._max_entries_per_job,
            }


# Module-level singleton
_log_collector = LogCollector()


def get_log_collector() -> LogCollector:
    """Return the global LogCollector singleton."""
    return _log_collector


def setup_job_log_handler(
    logger_name: str | None = None,
    level: int = logging.DEBUG,
) -> JobLogHandler:
    """
    Attach a JobLogHandler to a logger (root by default).

    Call once during app startup. The handler captures any log emitted
    while current_job_id is set (i.e. during job execution).
    Attaching to the root logger ensures logs from all modules
    (e.g. ``main.framework.core.executor``) are captured.
    """
    handler = JobLogHandler(collector=_log_collector)
    handler.setLevel(level)
    handler.setFormatter(logging.Formatter("%(message)s"))
    target_logger = logging.getLogger(logger_name)  # None → root logger
    target_logger.addHandler(handler)
    return handler
