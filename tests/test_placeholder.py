"""Placeholder tests so `pytest --collect-only` exits 0 on an empty test suite.

This file exists solely to satisfy the Task 1 acceptance criterion that
`python -m pytest --collect-only tests/` returns exit code 0. Real tests will
be added in Wave 2 (per phase1-foundation.md plan).
"""

from __future__ import annotations


def test_placeholder() -> None:
    """Trivial test marker so pytest has at least one collectible item."""
    assert True, "pytest collection must find at least one test"
