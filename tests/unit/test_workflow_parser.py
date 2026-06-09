"""Tests for workflow_parser.validate_dag cycle detection."""

import pytest

from main.framework.core.workflow_parser import validate_dag


def _nodes(*ids):
    return [{"id": nid, "type": "agent"} for nid in ids]


def _edges(*pairs):
    return [{"source": s, "target": t} for s, t in pairs]


class TestValidateDag:
    def test_empty_graph(self):
        assert validate_dag([], []) is True

    def test_no_edges(self):
        assert validate_dag(_nodes("a", "b"), []) is True

    def test_linear_dag(self):
        assert validate_dag(_nodes("a", "b", "c"), _edges(("a", "b"), ("b", "c"))) is True

    def test_diamond_dag(self):
        nodes = _nodes("a", "b", "c", "d")
        edges = _edges(("a", "b"), ("a", "c"), ("b", "d"), ("c", "d"))
        assert validate_dag(nodes, edges) is True

    def test_simple_cycle_detected(self):
        """A→B→A is a cycle."""
        assert validate_dag(_nodes("a", "b"), _edges(("a", "b"), ("b", "a"))) is False

    def test_three_node_cycle_detected(self):
        """A→B→C→A is a cycle."""
        nodes = _nodes("a", "b", "c")
        edges = _edges(("a", "b"), ("b", "c"), ("c", "a"))
        assert validate_dag(nodes, edges) is False

    def test_cycle_with_extra_nodes(self):
        """D→A→B→C→A — cycle among A,B,C plus dangling D."""
        nodes = _nodes("a", "b", "c", "d")
        edges = _edges(("d", "a"), ("a", "b"), ("b", "c"), ("c", "a"))
        assert validate_dag(nodes, edges) is False

    def test_disconnected_components_valid(self):
        nodes = _nodes("a", "b", "x", "y")
        edges = _edges(("a", "b"), ("x", "y"))
        assert validate_dag(nodes, edges) is True

    def test_disconnected_component_with_cycle(self):
        nodes = _nodes("a", "b", "x", "y")
        edges = _edges(("a", "b"), ("x", "y"), ("y", "x"))
        assert validate_dag(nodes, edges) is False

    def test_self_loop(self):
        assert validate_dag(_nodes("a"), _edges(("a", "a"))) is False

    def test_input_node_with_incoming_edge_raises(self):
        nodes = [{"id": "in", "type": "input"}, {"id": "a", "type": "agent"}]
        edges = _edges(("a", "in"))
        with pytest.raises(ValueError, match="Input node"):
            validate_dag(nodes, edges)

    def test_output_node_with_outgoing_edge_raises(self):
        nodes = [{"id": "out", "type": "output"}, {"id": "a", "type": "agent"}]
        edges = _edges(("out", "a"))
        with pytest.raises(ValueError, match="Output node"):
            validate_dag(nodes, edges)

    def test_max_nodes_exceeded(self):
        nodes = [{"id": f"n{i}", "type": "agent"} for i in range(51)]
        with pytest.raises(ValueError, match="50"):
            validate_dag(nodes, [])
