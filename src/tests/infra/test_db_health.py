"""Tests for ``src/main/infra/db_health.py`` — DBHealthProbe.

Verifies metric collection, severity classification, in-memory mode
handling, and overall report aggregation.

Revision T-10 / TASK-013.
"""

from __future__ import annotations

import os
from unittest.mock import patch

import pytest

from src.main.infra.db_health import (
    DBHealthProbe,
    DBHealthReport,
    MetricSeverity,
    _current_parallel_concurrency,
    _running_node_keys,
    _write_timestamps,
)
from src.main.infra.settings import Settings


# ── helpers ──


def make_settings(
    *,
    database_url: str = "sqlite:///./data/test.db",
    db_pool_size: int = 5,
    db_busy_timeout_ms: int = 30000,
    db_journal_mode: str = "WAL",
) -> Settings:
    """Build a minimal ``Settings`` for test use.

    Uses keyword-only arguments so the call site is explicit about what
    differs from defaults.
    """
    return Settings(
        DATABASE_URL=database_url,
        DB_POOL_SIZE=db_pool_size,
        DB_BUSY_TIMEOUT_MS=db_busy_timeout_ms,
        DB_JOURNAL_MODE=db_journal_mode,
    )


# ── fixtures ──


@pytest.fixture(autouse=True)
def _reset_module_state() -> None:
    """Reset module-level counters before each test.

    Ensures test isolation even if tests were to call
    ``register_running_node`` or ``record_write``.
    """
    _running_node_keys.clear()
    _write_timestamps.clear()
    # No yield needed — this fixture does not set up resources to tear
    # down; it just resets counters upfront.


# ── tests ──


class TestDBHealthCollect:
    """Tests for the ``collect()`` method."""

    @pytest.mark.asyncio
    async def test_db_health_collect(self) -> None:
        """Mock > 1 GB db → db_file_size_bytes severity is CRITICAL."""
        settings: Settings = make_settings()
        probe: DBHealthProbe = DBHealthProbe(settings)

        # Patch os.path.getsize to simulate a 2 GB database file.
        gigabyte: int = 1024 * 1024 * 1024
        with patch.object(os, "path", wraps=os.path) as mock_ospath:
            mock_ospath.getsize.return_value = 2 * gigabyte

            report: DBHealthReport = await probe.collect()

        # Locate the db_file_size_bytes metric.
        db_size_metric = [m for m in report.metrics if m.name == "db_file_size_bytes"]
        assert len(db_size_metric) == 1, "Expected exactly one db_file_size_bytes metric"
        metric = db_size_metric[0]

        assert metric.severity == MetricSeverity.CRITICAL, (
            f"Expected CRITICAL for 2 GB db, got {metric.severity}"
        )
        assert metric.value == 2 * gigabyte, (
            f"Expected value=2GB, got {metric.value}"
        )
        assert metric.threshold_critical == gigabyte, (
            f"Expected threshold_critical=1GB, got {metric.threshold_critical}"
        )

    @pytest.mark.asyncio
    async def test_db_health_memory_db(self) -> None:
        """:memory: mode → db_file_size_bytes and wal_file_count are (0, OK)."""
        settings: Settings = make_settings(database_url="sqlite:///:memory:")
        probe: DBHealthProbe = DBHealthProbe(settings)

        report: DBHealthReport = await probe.collect()

        # db_file_size_bytes
        db_size_metric = [m for m in report.metrics if m.name == "db_file_size_bytes"]
        assert len(db_size_metric) == 1
        assert db_size_metric[0].value == 0
        assert db_size_metric[0].severity == MetricSeverity.OK

        # wal_file_count
        wal_metric = [m for m in report.metrics if m.name == "wal_file_count"]
        assert len(wal_metric) == 1
        assert wal_metric[0].value == 0
        assert wal_metric[0].severity == MetricSeverity.OK

        # All metrics should be OK for an empty in-memory database
        for metric in report.metrics:
            assert metric.severity == MetricSeverity.OK, (
                f"Metric {metric.name} has severity {metric.severity}, expected OK"
            )

    @pytest.mark.asyncio
    async def test_db_health_overall_severity(self) -> None:
        """Any CRITICAL metric → overall is CRITICAL."""
        settings: Settings = make_settings()
        probe: DBHealthProbe = DBHealthProbe(settings)

        # Patch os.path.getsize to simulate > 1 GB database file.
        gigabyte: int = 1024 * 1024 * 1024
        with patch.object(os, "path", wraps=os.path) as mock_ospath:
            mock_ospath.getsize.return_value = 2 * gigabyte

            report: DBHealthReport = await probe.collect()

        assert report.overall == MetricSeverity.CRITICAL, (
            f"Expected overall=CRITICAL when a metric is CRITICAL, "
            f"got {report.overall}"
        )

    # ── structure ──

    def test_report_contains_exactly_5_metrics(self) -> None:
        """The report must contain all 5 §4.3 metrics (no TODO shortcuts)."""
        settings: Settings = make_settings()
        probe: DBHealthProbe = DBHealthProbe(settings)

        # Use a synchronous helper to avoid async in this structural test.
        report: DBHealthReport = _sync_collect(probe)

        assert len(report.metrics) == 5, (
            f"Expected exactly 5 metrics, got {len(report.metrics)}"
        )

        expected_names: set[str] = {
            "parallel_node_concurrency",
            "db_file_size_bytes",
            "wal_file_count",
            "worker_count",
            "write_qps",
        }
        actual_names: set[str] = {m.name for m in report.metrics}
        assert actual_names == expected_names, (
            f"Metric name mismatch: expected {expected_names}, got {actual_names}"
        )


# ── sync helper ──


def _sync_collect(probe: DBHealthProbe) -> DBHealthReport:
    """Synchronously collect a health report.

    Used only in structural tests that need synchronous execution.
    Production code always uses ``await probe.collect()``.
    """
    import asyncio

    loop = asyncio.new_event_loop()
    try:
        return loop.run_until_complete(probe.collect())
    finally:
        loop.close()
