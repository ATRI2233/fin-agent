"""Unit tests for main.framework.services.workflow_graph."""

from __future__ import annotations

import pytest

from main.framework.services.workflow_graph import (
    build_predecessors,
    find_downstream,
    is_leaf,
    is_only_successor,
)


# ---------------------------------------------------------------------------
# build_predecessors
# ---------------------------------------------------------------------------


def test_build_predecessors_empty() -> None:
    assert build_predecessors([]) == {}


def test_build_predecessors_chain() -> None:
    edges = [
        {"source": "1", "target": "2"},
        {"source": "2", "target": "3"},
    ]
    assert build_predecessors(edges) == {"2": ["1"], "3": ["2"]}


def test_build_predecessors_multiple_preds() -> None:
    edges = [
        {"source": "1", "target": "3"},
        {"source": "2", "target": "3"},
    ]
    # Both 1 and 2 should appear as predecessors of 3
    assert build_predecessors(edges)["3"] == ["1", "2"]


# ---------------------------------------------------------------------------
# find_downstream
# ---------------------------------------------------------------------------


def test_find_downstream_branching() -> None:
    # 1 -> [2, 3], 2 -> 4, 3 -> 4  (4 is reachable via both paths)
    edges = [
        {"source": "1", "target": "2"},
        {"source": "1", "target": "3"},
        {"source": "2", "target": "4"},
        {"source": "3", "target": "4"},
    ]
    downstream = find_downstream("1", edges)
    # 2, 3, 4 each appear once despite 4 being reachable from two parents
    assert set(downstream) == {"2", "3", "4"}
    assert downstream.count("4") == 1


def test_find_downstream_handles_cycles() -> None:
    # 1 -> 2 -> 1 cycle, plus 2 -> 3
    edges = [
        {"source": "1", "target": "2"},
        {"source": "2", "target": "1"},
        {"source": "2", "target": "3"},
    ]
    # Must terminate — visited set prevents infinite DFS.
    # Each node appears at most once (DFS visited-set dedup).
    result = find_downstream("1", edges)
    assert set(result) == {"1", "2", "3"}
    assert len(result) == len(set(result))


def test_find_downstream_leaf_returns_empty() -> None:
    edges = [{"source": "1", "target": "2"}]
    assert find_downstream("2", edges) == []


# ---------------------------------------------------------------------------
# is_leaf
# ---------------------------------------------------------------------------


def test_is_leaf_true_when_no_outgoing() -> None:
    edges = [{"source": "1", "target": "2"}]
    assert is_leaf("2", edges) is True


def test_is_leaf_false_when_intermediate() -> None:
    edges = [
        {"source": "1", "target": "2"},
        {"source": "2", "target": "3"},
    ]
    assert is_leaf("2", edges) is False


# ---------------------------------------------------------------------------
# is_only_successor
# ---------------------------------------------------------------------------


def test_is_only_successor_true_single_pred() -> None:
    edges = [{"source": "1", "target": "2"}]
    assert is_only_successor("2", "1", edges) is True


def test_is_only_successor_false_multiple_succs() -> None:
    edges = [
        {"source": "1", "target": "2"},
        {"source": "1", "target": "3"},
    ]
    assert is_only_successor("2", "1", edges) is False
    assert is_only_successor("3", "1", edges) is False
