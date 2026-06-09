"""Unit tests for ExecutionService — mock-heavy, no real database.

Verifies the business-logic layer extracted from
``core/workflow_engine.py`` ``handle_failure`` and the execution-setup path
in ``services/message_processor.py``. The service is exercised against a
``MagicMock`` SQLAlchemy session so the tests stay focused on the
service's orchestration of the repo and graph helpers, not on
SQLAlchemy plumbing.

Design note
-----------
``find_downstream`` is the only piece of graph logic the service uses,
and we verify the service delegates to it via
``unittest.mock.patch`` on the import location used by
``main.framework.services.execution_service``. This keeps the test
honest about *which* call site is wired up.
"""

from __future__ import annotations

from unittest.mock import MagicMock, Mock, patch

import pytest

from main.framework.models.workflow_execution import ExecutionNode, WorkflowExecution
from main.framework.repositories.execution_repo import ExecutionRepository
from main.framework.services.exceptions import NotFoundError
from main.framework.services.execution_service import ExecutionService
from main.framework.services.workflow_graph import find_downstream

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _make_workflow_mock(nodes: list[dict] | None = None) -> Mock:
    """Build a Mock that quacks like a Workflow ORM row for create_*.for_workflow."""
    wf = Mock()
    wf.id = "wf-1"
    wf.nodes = nodes if nodes is not None else []
    return wf


def _make_execution_mock(exec_id: str = "exec-1") -> Mock:
    """Build a Mock that quacks like a WorkflowExecution row."""
    ex = Mock(spec=WorkflowExecution)
    ex.id = exec_id
    ex.status = "pending"
    return ex


def _make_node_mock(
    exec_id: str = "exec-1",
    node_id: str = "node-1",
    agent: str = "fin-orchestrator",
) -> Mock:
    """Build a Mock that quacks like an ExecutionNode row."""
    n = Mock(spec=ExecutionNode)
    n.execution_id = exec_id
    n.node_id = node_id
    n.agent = agent
    n.status = "pending"
    n.input = {}
    n.output = {}
    n.error = None
    n.completed_at = None
    return n


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


@pytest.fixture
def exec_repo() -> MagicMock:
    """A bare MagicMock standing in for ExecutionRepository.

    The service's __init__ only stores the repo for later use; this fixture
    keeps tests decoupled from the repo's real method set.
    """
    return MagicMock(spec=ExecutionRepository)


@pytest.fixture
def db() -> MagicMock:
    """A bare MagicMock standing in for a SQLAlchemy Session."""
    return MagicMock()


@pytest.fixture
def service(exec_repo: MagicMock) -> ExecutionService:
    return ExecutionService(exec_repo=exec_repo)


# ---------------------------------------------------------------------------
# create_execution_for_workflow
# ---------------------------------------------------------------------------


def test_create_execution_for_workflow(service: ExecutionService, db: MagicMock) -> None:
    """A 3-node workflow yields 1 WorkflowExecution + 3 ExecutionNode rows."""
    workflow = _make_workflow_mock(
        nodes=[
            {"id": "n1", "agent": "macro-scout"},
            {"id": "n2", "agent": "technical"},
            {"id": "n3", "data": {"agentType": "fundamental"}},  # falls back to data.agentType
        ]
    )
    params = {"ticker": "AAPL", "lookback_days": 30}

    # db.add captures both WorkflowExecution and ExecutionNode rows; flush
    # triggers id assignment via the lambda default on the model column.
    added_entities: list[object] = []

    def _capture_add(entity: object) -> None:
        added_entities.append(entity)

    db.add.side_effect = _capture_add

    # When db.flush is called the first time (after adding the WorkflowExecution),
    # simulate the lambda default generating an id.
    def _fake_flush() -> None:
        for ent in added_entities:
            if isinstance(ent, WorkflowExecution) and getattr(ent, "id", None) is None:
                ent.id = "exec-1"

    db.flush.side_effect = _fake_flush

    result = service.create_execution_for_workflow(workflow, params, db)

    # 1 WorkflowExecution + 3 ExecutionNode = 4 db.add calls
    assert len(added_entities) == 4
    assert isinstance(added_entities[0], WorkflowExecution)
    assert added_entities[0].status == "pending"
    assert added_entities[0].workflow_id == "wf-1"

    node_rows = [e for e in added_entities if isinstance(e, ExecutionNode)]
    assert len(node_rows) == 3
    assert [n.node_id for n in node_rows] == ["n1", "n2", "n3"]
    # Agent fallback: node3 had no top-level agent — must come from data.agentType
    assert node_rows[0].agent == "macro-scout"
    assert node_rows[1].agent == "technical"
    assert node_rows[2].agent == "fundamental"
    # Input propagated to every node
    for n in node_rows:
        assert n.input == params
        assert n.status == "pending"
        assert n.execution_id == "exec-1"

    # Returned object is the WorkflowExecution instance
    assert result is added_entities[0]
    db.flush.assert_called()


# ---------------------------------------------------------------------------
# update_execution_status
# ---------------------------------------------------------------------------


def test_update_execution_status(service: ExecutionService, db: MagicMock) -> None:
    """update_execution_status sets WorkflowExecution.status and flushes."""
    execution = _make_execution_mock()
    db.get.return_value = execution

    service.update_execution_status("exec-1", "running", db)

    db.get.assert_called_once_with(WorkflowExecution, "exec-1")
    assert execution.status == "running"
    # 'running' is not in the terminal-status set, so completed_at stays None
    db.flush.assert_called_once()


def test_update_execution_status_terminal_sets_completed_at(service: ExecutionService, db: MagicMock) -> None:
    """Terminal statuses ('completed', 'failed', 'cancelled') stamp completed_at."""
    execution = _make_execution_mock()
    db.get.return_value = execution

    service.update_execution_status("exec-1", "failed", db)

    assert execution.status == "failed"
    assert execution.completed_at is not None


def test_update_execution_status_missing_raises(service: ExecutionService, db: MagicMock) -> None:
    db.get.return_value = None
    with pytest.raises(NotFoundError):
        service.update_execution_status("missing", "running", db)


# ---------------------------------------------------------------------------
# update_node_status
# ---------------------------------------------------------------------------


def test_update_node_status_with_output(service: ExecutionService, db: MagicMock) -> None:
    """update_node_status stores the provided output dict on the node row."""
    node = _make_node_mock()
    db.query.return_value.filter.return_value.first.return_value = node

    output = {"result": "ok", "score": 0.92}
    service.update_node_status("exec-1", "n1", "completed", output=output, db=db)

    assert node.status == "completed"
    assert node.output == output
    assert node.completed_at is not None
    db.flush.assert_called_once()


def test_update_node_status_with_error(service: ExecutionService, db: MagicMock) -> None:
    """update_node_status stores the error string on the node row."""
    node = _make_node_mock()
    db.query.return_value.filter.return_value.first.return_value = node

    service.update_node_status("exec-1", "n1", "failed", error="boom", db=db)

    assert node.status == "failed"
    assert node.error == "boom"
    assert node.completed_at is not None


def test_update_node_status_missing_raises(service: ExecutionService, db: MagicMock) -> None:
    db.query.return_value.filter.return_value.first.return_value = None
    with pytest.raises(NotFoundError):
        service.update_node_status("exec-1", "missing", "completed", db=db)


# ---------------------------------------------------------------------------
# mark_downstream_skipped
# ---------------------------------------------------------------------------


def test_mark_downstream_skipped(service: ExecutionService, db: MagicMock) -> None:
    """Both downstream rows are marked 'skipped' and the list is returned."""
    edges = [
        {"source": "n1", "target": "n2"},
        {"source": "n1", "target": "n3"},
    ]

    # Build mock node rows for n2 and n3 (these are the rows db.query(...).all() returns)
    n2 = _make_node_mock(node_id="n2")
    n3 = _make_node_mock(node_id="n3")
    db.query.return_value.filter.return_value.all.return_value = [n2, n3]

    result = service.mark_downstream_skipped("n1", edges, db)

    # find_downstream returns ['n2', 'n3'] (DFS discovery order)
    assert result == ["n2", "n3"]
    assert n2.status == "skipped"
    assert n3.status == "skipped"
    assert n2.completed_at is not None
    assert n3.completed_at is not None
    db.flush.assert_called_once()


def test_mark_downstream_skipped_uses_workflow_graph(service: ExecutionService, db: MagicMock) -> None:
    """mark_downstream_skipped delegates to find_downstream (not reimplemented)."""
    edges = [{"source": "n1", "target": "n2"}]
    db.query.return_value.filter.return_value.all.return_value = []

    with patch(
        "main.framework.services.execution_service.find_downstream",
        wraps=find_downstream,
    ) as mocked:
        result = service.mark_downstream_skipped("n1", edges, db)

    # Delegation: find_downstream was called with our exact (start, edges) args
    mocked.assert_called_once_with("n1", edges)
    assert result == ["n2"]


def test_mark_downstream_skipped_no_downstream(service: ExecutionService, db: MagicMock) -> None:
    """When the node has no downstream, returns [] and skips the query."""
    edges = [{"source": "other", "target": "n1"}]
    result = service.mark_downstream_skipped("n1", edges, db)

    assert result == []
    db.query.assert_not_called()


# ---------------------------------------------------------------------------
# record_node_execution
# ---------------------------------------------------------------------------


def test_record_node_execution_creates_row(service: ExecutionService, db: MagicMock) -> None:
    """When no row exists, a new 'pending' ExecutionNode is added."""
    db.query.return_value.filter.return_value.first.return_value = None
    added: list[object] = []
    db.add.side_effect = added.append

    captured_input = {"ticker": "TSLA"}

    node = service.record_node_execution("exec-1", "n1", "macro-scout", captured_input, db)

    assert len(added) == 1
    assert isinstance(added[0], ExecutionNode)
    assert added[0].execution_id == "exec-1"
    assert added[0].node_id == "n1"
    assert added[0].agent == "macro-scout"
    assert added[0].status == "pending"
    assert added[0].input == captured_input
    db.flush.assert_called_once()
    assert node is added[0]


def test_record_node_execution_returns_row(service: ExecutionService, db: MagicMock) -> None:
    """The returned object is an ExecutionNode (model type)."""
    db.query.return_value.filter.return_value.first.return_value = None
    added: list[object] = []
    db.add.side_effect = added.append

    node = service.record_node_execution("exec-1", "n1", "macro-scout", {}, db)

    assert isinstance(node, ExecutionNode)
