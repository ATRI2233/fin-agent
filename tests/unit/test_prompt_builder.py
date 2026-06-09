"""Tests for prompt_builder.build_prompt pure function."""

from main.framework.services.prompt_builder import build_prompt


class TestBuildPrompt:
    def test_basic_param_substitution(self):
        result = build_prompt("hello {name}", {}, [], {"name": "world"}, {})
        assert result == "hello world"

    def test_upstream_results_appended(self):
        node = {"id": "b", "type": "agent"}
        edges = []
        results = {"a": {"result": "alpha output"}}
        out = build_prompt("base", node, edges, {}, results, predecessor_ids=["a"], node_id="b")
        assert "alpha output" in out
        assert "--- Upstream Outputs ---" in out

    def test_edge_prompt_included(self):
        node = {"id": "b", "type": "agent"}
        edges = [{"source": "a", "target": "b", "prompt": "use this context", "promptType": "context"}]
        out = build_prompt("base", node, edges, {}, {}, node_id="b")
        assert "use this context" in out
        assert "--- Connection (context) ---" in out

    def test_no_params_no_results(self):
        out = build_prompt("plain template", {"id": "x"}, [], {}, {})
        assert out == "plain template"

    def test_multiple_predecessors(self):
        node = {"id": "c", "type": "agent"}
        results = {
            "a": {"result": "out-a"},
            "b": {"result": "out-b"},
        }
        out = build_prompt("base", node, [], {}, results, predecessor_ids=["a", "b"], node_id="c")
        assert "out-a" in out
        assert "out-b" in out

    def test_node_string_field_substitution(self):
        node = {"id": "x", "title": "MyTitle"}
        out = build_prompt("title={title}", node, [], {}, {})
        assert out == "title=MyTitle"

    def test_upstream_placeholder_substituted(self):
        results = {"a": {"result": "alpha"}}
        out = build_prompt("prefix {upstream} suffix", {}, [], {}, results, predecessor_ids=["a"], node_id="b")
        assert out.startswith("prefix ")
        assert out.endswith(" suffix")
        assert "alpha" in out
        assert "{upstream}" not in out
        assert "--- Upstream Outputs ---" not in out
