"""Database health probe — PG migration trigger condition monitoring.

Provides 5 observable metrics that map to the threshold table in
§4.3 of the target architecture document. Each metric carries a
severity label (ok / warn / critical) so operations can decide when
to migrate from SQLite to PostgreSQL.

Revision T-10: all 5 thresholds defined in §4.3 are exposed.
"""

from __future__ import annotations

import glob
import os
import time
from collections import deque
from dataclasses import dataclass, field
from datetime import datetime, timezone
from enum import Enum
from pathlib import Path
from typing import ClassVar

from src.main.infra.settings import Settings


# ── Threshold constants ──

_PARALLEL_CONCURRENCY_WARN = 5
_PARALLEL_CONCURRENCY_CRITICAL = 10

_DB_FILE_SIZE_WARN = 500 * 1024 * 1024  # 500 MB
_DB_FILE_SIZE_CRITICAL = 1 * 1024 * 1024 * 1024  # 1 GB

_WAL_FILE_COUNT_WARN = 1
_WAL_FILE_COUNT_CRITICAL = 5

_WORKER_COUNT_WARN = 1
_WORKER_COUNT_CRITICAL = 4

_WRITE_QPS_WARN = 100
_WRITE_QPS_CRITICAL = 200

_WRITE_QPS_WINDOW_SECONDS = 60

# ── In-memory parallel node concurrency tracking ──

_running_node_keys: set[str] = set()
"""Set of node execution keys currently in-flight.

Workflow runners call ``register_running_node(key)`` before starting a
node and ``unregister_running_node(key)`` after it completes or fails.
The probe reads ``len(_running_node_keys)`` as the concurrency metric.
"""


def register_running_node(key: str) -> None:
    """Register a node as currently executing.

    Parameters
    ----------
    key : str
        Unique identifier for the running node, typically
        ``f"{execution_id}:{node_id}"``.
    """
    _running_node_keys.add(key)


def unregister_running_node(key: str) -> None:
    """Mark a node as no longer executing.

    Parameters
    ----------
    key : str
        The same key passed to ``register_running_node``.
    """
    _running_node_keys.discard(key)


def _current_parallel_concurrency() -> int:
    """Return the number of nodes currently executing in parallel."""
    return len(_running_node_keys)


# ── In-memory write QPS tracking ──

_write_timestamps: deque[float] = deque(maxlen=100_000)
"""Monotonic timestamps of write operations within the sliding window."""


def record_write() -> None:
    """Record a database write operation.

    Called by the UoW or execution recorder after each successful commit.
    Timestamps are consumed by ``_current_write_qps()``.
    """
    _write_timestamps.append(time.monotonic())


def _current_write_qps(window_seconds: int = _WRITE_QPS_WINDOW_SECONDS) -> float:
    """Estimate current write QPS over the last *window_seconds*.

    Parameters
    ----------
    window_seconds : int
        Sliding window width in seconds (default 60).

    Returns
    -------
    float
        Writes per second averaged over the window. Returns 0.0 when
        there are no recorded writes or *window_seconds* is <= 0.
    """
    if window_seconds <= 0:
        return 0.0
    now = time.monotonic()
    cutoff = now - window_seconds
    while _write_timestamps and _write_timestamps[0] < cutoff:
        _write_timestamps.popleft()
    return len(_write_timestamps) / window_seconds


# ── Types ──


class MetricSeverity(str, Enum):
    """Severity label for a single health metric.

    - OK:       within acceptable range, no action needed.
    - WARN:     approaching a critical threshold, evaluation recommended.
    - CRITICAL: threshold exceeded, migration or intervention required.
    """

    OK = "ok"
    WARN = "warn"
    CRITICAL = "critical"


@dataclass
class DBHealthMetric:
    """A single observable health metric.

    Attributes
    ----------
    name : str
        Machine-readable metric identifier (e.g. ``"db_file_size_bytes"``).
    value : float | int | str
        Current observed value.
    severity : MetricSeverity
        Severity label derived from threshold comparison.
    threshold_warn : float | int | str | None
        The WARN threshold value (if applicable).
    threshold_critical : float | int | str | None
        The CRITICAL threshold value (if applicable).
    recommendation : str
        Human-readable recommendation when severity is not OK.
    """

    name: str
    value: float | int | str
    severity: MetricSeverity
    threshold_warn: float | int | str | None = None
    threshold_critical: float | int | str | None = None
    recommendation: str = ""

    def to_dict(self) -> dict:
        """Serialize to a plain dictionary for JSON encoding."""
        return {
            "name": self.name,
            "value": self.value,
            "severity": self.severity.value,
            "threshold_warn": self.threshold_warn,
            "threshold_critical": self.threshold_critical,
            "recommendation": self.recommendation,
        }


@dataclass
class DBHealthReport:
    """Aggregate health report containing all metrics and overall status.

    Attributes
    ----------
    metrics : list[DBHealthMetric]
        All collected metrics (exactly 5 entries).
    overall : MetricSeverity
        Worst severity across all metrics (any CRITICAL → CRITICAL).
    collected_at : str
        ISO 8601 UTC timestamp of the collection moment.
    """

    metrics: list[DBHealthMetric]
    overall: MetricSeverity
    collected_at: str

    def to_dict(self) -> dict:
        """Serialize to a plain dictionary for JSON encoding."""
        return {
            "metrics": [m.to_dict() for m in self.metrics],
            "overall": self.overall.value,
            "collected_at": self.collected_at,
        }


# ── Probe ──


class DBHealthProbe:
    """Collects database health metrics.

    Parameters
    ----------
    settings : Settings
        Application settings (used to resolve ``DATABASE_URL``, read
        env vars, etc.).
    """

    def __init__(self, settings: Settings) -> None:
        self._settings = settings
        self._db_path: Path | None = self._resolve_db_path()

    # ── path resolution ──

    def _resolve_db_path(self) -> Path | None:
        """Resolve the local filesystem path from ``DATABASE_URL``.

        Returns
        -------
        Path | None
            The resolved Path for file-based SQLite databases,
            ``None`` for ``:memory:`` databases or non-SQLite URLs.
        """
        url: str = self._settings.DATABASE_URL

        # In-memory database — no filesystem path.
        if "///:memory:" in url:
            return None

        # SQLite URI — extract the file portion.
        if ":///" in url:
            file_part: str = url.split(":///", 1)[1]
            if file_part.startswith("./"):
                file_part = file_part[2:]
            if not file_part:
                return None
            return Path(file_part).resolve()

        # Non-SQLite URL (e.g. PostgreSQL) — cannot resolve locally.
        return None

    # ── metric helpers ──

    @staticmethod
    def _severity_and_rec(
        value: float | int,
        warn: float | int,
        critical: float | int,
        warn_msg: str,
        crit_msg: str,
    ) -> tuple[MetricSeverity, str]:
        """Compare *value* against thresholds and return (severity, recommendation)."""
        if value > critical:
            return MetricSeverity.CRITICAL, crit_msg
        if value > warn:
            return MetricSeverity.WARN, warn_msg
        return MetricSeverity.OK, ""

    # ── individual metrics ──

    def _metric_parallel_concurrency(self) -> DBHealthMetric:
        """1. Parallel node concurrency (in-memory counter)."""
        value: int = _current_parallel_concurrency()
        severity, recommendation = self._severity_and_rec(
            value=value,
            warn=_PARALLEL_CONCURRENCY_WARN,
            critical=_PARALLEL_CONCURRENCY_CRITICAL,
            warn_msg=(
                f"Parallel node concurrency ({value}) exceeds WARN threshold "
                f"({_PARALLEL_CONCURRENCY_WARN}); evaluate PG migration readiness."
            ),
            crit_msg=(
                f"Parallel node concurrency ({value}) exceeds CRITICAL threshold "
                f"({_PARALLEL_CONCURRENCY_CRITICAL}); PG migration is required."
            ),
        )
        return DBHealthMetric(
            name="parallel_node_concurrency",
            value=value,
            severity=severity,
            threshold_warn=_PARALLEL_CONCURRENCY_WARN,
            threshold_critical=_PARALLEL_CONCURRENCY_CRITICAL,
            recommendation=recommendation,
        )

    def _metric_db_file_size(self, is_memory: bool) -> DBHealthMetric:
        """2. Main database file size on disk."""
        if is_memory or self._db_path is None:
            return DBHealthMetric(
                name="db_file_size_bytes",
                value=0,
                severity=MetricSeverity.OK,
                threshold_warn=_DB_FILE_SIZE_WARN,
                threshold_critical=_DB_FILE_SIZE_CRITICAL,
            )

        try:
            value: int = os.path.getsize(self._db_path)
        except (FileNotFoundError, PermissionError, OSError):
            # Collect failure — must record severity per Do Not #3.
            return DBHealthMetric(
                name="db_file_size_bytes",
                value=-1,
                severity=MetricSeverity.CRITICAL,
                threshold_warn=_DB_FILE_SIZE_WARN,
                threshold_critical=_DB_FILE_SIZE_CRITICAL,
                recommendation=(
                    f"Failed to stat database file at {self._db_path}; "
                    f"check filesystem permissions."
                ),
            )

        severity, recommendation = self._severity_and_rec(
            value=value,
            warn=_DB_FILE_SIZE_WARN,
            critical=_DB_FILE_SIZE_CRITICAL,
            warn_msg=(
                f"Database file size ({value / 1024 / 1024:.1f} MB) exceeds WARN "
                f"threshold ({_DB_FILE_SIZE_WARN / 1024 / 1024:.0f} MB); "
                f"evaluate PG migration readiness."
            ),
            crit_msg=(
                f"Database file size ({value / 1024 / 1024:.1f} MB) exceeds CRITICAL "
                f"threshold ({_DB_FILE_SIZE_CRITICAL / 1024 / 1024:.0f} MB); "
                f"PG migration is required."
            ),
        )
        return DBHealthMetric(
            name="db_file_size_bytes",
            value=value,
            severity=severity,
            threshold_warn=_DB_FILE_SIZE_WARN,
            threshold_critical=_DB_FILE_SIZE_CRITICAL,
            recommendation=recommendation,
        )

    def _metric_wal_file_count(self, is_memory: bool) -> DBHealthMetric:
        """3. WAL journal file count.

        For ``:memory:`` databases, always returns (0, OK).
        """
        if is_memory or self._db_path is None:
            return DBHealthMetric(
                name="wal_file_count",
                value=0,
                severity=MetricSeverity.OK,
                threshold_warn=_WAL_FILE_COUNT_WARN,
                threshold_critical=_WAL_FILE_COUNT_CRITICAL,
            )

        pattern: str = f"{self._db_path}-wal*"
        try:
            files: list[str] = glob.glob(pattern)
            value: int = len(files)
        except OSError:
            return DBHealthMetric(
                name="wal_file_count",
                value=-1,
                severity=MetricSeverity.CRITICAL,
                threshold_warn=_WAL_FILE_COUNT_WARN,
                threshold_critical=_WAL_FILE_COUNT_CRITICAL,
                recommendation=f"Failed to glob WAL files with pattern {pattern}.",
            )

        severity, recommendation = self._severity_and_rec(
            value=value,
            warn=_WAL_FILE_COUNT_WARN,
            critical=_WAL_FILE_COUNT_CRITICAL,
            warn_msg=(
                f"WAL file count ({value}) exceeds WARN threshold "
                f"({_WAL_FILE_COUNT_WARN}); monitor WAL accumulation."
            ),
            crit_msg=(
                f"WAL file count ({value}) exceeds CRITICAL threshold "
                f"({_WAL_FILE_COUNT_CRITICAL}); checkpoint or investigate "
                f"WAL accumulation."
            ),
        )
        return DBHealthMetric(
            name="wal_file_count",
            value=value,
            severity=severity,
            threshold_warn=_WAL_FILE_COUNT_WARN,
            threshold_critical=_WAL_FILE_COUNT_CRITICAL,
            recommendation=recommendation,
        )

    def _metric_worker_count(self) -> DBHealthMetric:
        """4. Uvicorn worker count from environment."""
        raw: str = os.environ.get("UVICORN_WORKERS", "1")
        try:
            value: int = int(raw)
        except (ValueError, TypeError):
            value = 1

        severity, recommendation = self._severity_and_rec(
            value=value,
            warn=_WORKER_COUNT_WARN,
            critical=_WORKER_COUNT_CRITICAL,
            warn_msg=(
                f"Uvicorn workers ({value}) exceeds WARN threshold "
                f"({_WORKER_COUNT_WARN}); multi-worker SQLite can cause "
                f"serialisation contention."
            ),
            crit_msg=(
                f"Uvicorn workers ({value}) exceeds CRITICAL threshold "
                f"({_WORKER_COUNT_CRITICAL}); PG migration is strongly "
                f"recommended for multi-worker deployments."
            ),
        )
        return DBHealthMetric(
            name="worker_count",
            value=value,
            severity=severity,
            threshold_warn=_WORKER_COUNT_WARN,
            threshold_critical=_WORKER_COUNT_CRITICAL,
            recommendation=recommendation,
        )

    def _metric_write_qps(self) -> DBHealthMetric:
        """5. Write QPS (60 s sliding window inflight counter)."""
        value: float = round(_current_write_qps(), 1)

        severity, recommendation = self._severity_and_rec(
            value=value,
            warn=_WRITE_QPS_WARN,
            critical=_WRITE_QPS_CRITICAL,
            warn_msg=(
                f"Write QPS ({value}) exceeds WARN threshold "
                f"({_WRITE_QPS_WARN}); evaluate PG migration readiness."
            ),
            crit_msg=(
                f"Write QPS ({value}) exceeds CRITICAL threshold "
                f"({_WRITE_QPS_CRITICAL}); PG migration should be scheduled."
            ),
        )
        return DBHealthMetric(
            name="write_qps",
            value=value,
            severity=severity,
            threshold_warn=_WRITE_QPS_WARN,
            threshold_critical=_WRITE_QPS_CRITICAL,
            recommendation=recommendation,
        )

    # ── collection ──

    async def collect(self) -> DBHealthReport:
        """Collect all 5 health metrics and produce an aggregate report.

        Returns
        -------
        DBHealthReport
            Report containing all metrics, overall severity, and
            collection timestamp.
        """
        is_memory: bool = self._db_path is None and "///:memory:" in self._settings.DATABASE_URL

        metrics: list[DBHealthMetric] = [
            self._metric_parallel_concurrency(),
            self._metric_db_file_size(is_memory),
            self._metric_wal_file_count(is_memory),
            self._metric_worker_count(),
            self._metric_write_qps(),
        ]

        severities: list[MetricSeverity] = [m.severity for m in metrics]

        if MetricSeverity.CRITICAL in severities:
            overall: MetricSeverity = MetricSeverity.CRITICAL
        elif MetricSeverity.WARN in severities:
            overall = MetricSeverity.WARN
        else:
            overall = MetricSeverity.OK

        return DBHealthReport(
            metrics=metrics,
            overall=overall,
            collected_at=datetime.now(timezone.utc).isoformat(),
        )
