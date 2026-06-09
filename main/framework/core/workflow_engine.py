"""Workflow execution engine with topological sort and parallel execution."""

from __future__ import annotations

import asyncio
import logging
from datetime import datetime
from typing import Any, Callable, Awaitable

from main.framework.core.agent_dispatcher import AgentDispatcher
from main.framework.core.debate_executor import DebateExecutor
from main.framework.core.retry_handler import WorkflowRetryHandler
from main.framework.core.workflow_parser import (
    topological_sort,
    identify_parallel_branches,
)
from main.framework.models.database import SessionLocal
from main.framework.models.workflow_execution import ExecutionNode, WorkflowExecution

logger = logging.getLogger(__name__)

StatusCallback = Callable[[str, str, str], Awaitable[None]]


class WorkflowEngine:
    """Executes workflow DAG with topological ordering and parallel execution."""

    def __init__(
        self,
        workflow_id: str,
        params: dict[str, Any],
        dispatcher: AgentDispatcher,
        status_callback: StatusCallback | None = None,
        execution_id: str | None = None,
    ):
        self.workflow_id = workflow_id
        self.params = params
        self._dispatcher = dispatcher
        self._status_callback = status_callback or self._noop_callback
        self.execution_id: str | None = execution_id
        self.nodes: list[dict] = []
        self.edges: list[dict] = []
        self._results: dict[str, Any] = {}
        self._failed_nodes: set[str] = set()
        self._skipped_nodes: set[str] = set()
        # Serial chain session reuse: node_id -> session_id
        self._chain_sessions: dict[str, str] = {}

    @staticmethod
    async def _noop_callback(_status: str, _msg: str, _agent: str) -> None:
        pass

    # ------------------------------------------------------------------
    # Public entry point
    # ------------------------------------------------------------------

    async def execute(self) -> dict[str, Any]:
        """Execute the workflow DAG.

        If execution_id is set, the caller (API) must have already created
        the WorkflowExecution and ExecutionNode rows in its own session.
        This method only UPDATES those rows, avoiding cross-session
        visibility issues with SQLite.
        """
        db = SessionLocal()
        try:
            from main.framework.models.workflow import Workflow

            # Commit any implicit transaction so subsequent queries see fresh data
            db.commit()

            workflow = db.query(Workflow).filter(Workflow.id == self.workflow_id).first()
            if not workflow:
                raise ValueError(f"Workflow {self.workflow_id} not found")

            self.nodes = workflow.nodes or []
            self.edges = workflow.edges or []

            self._retry_handler = WorkflowRetryHandler(
                self.workflow_id, dispatcher=self._dispatcher
            )

            total_nodes = len(self.nodes)
            await self._status_callback(
                "running",
                f"Workflow started with {total_nodes} node(s), executing...",
                "",
            )

            execution_order = topological_sort(self.nodes, self.edges)
            if not execution_order:
                raise ValueError("Failed to compute topological order - possible cycle")

            parallel_branches = identify_parallel_branches(self.nodes, self.edges)
            predecessors = self._build_predecessors()

            await self._execute_in_order(
                execution_order, parallel_branches, predecessors
            )

            # Update execution final status
            if self.execution_id:
                db.commit()  # end any open transaction
                execution = (
                    db.query(WorkflowExecution)
                    .filter(WorkflowExecution.id == self.execution_id)
                    .first()
                )
                if execution:
                    final_status = "failed" if self._failed_nodes else "completed"
                    execution.status = final_status
                    db.commit()

            completed_count = total_nodes - len(self._failed_nodes) - len(self._skipped_nodes)
            final_status = "failed" if self._failed_nodes else "completed"

            summary = (
                f"Workflow finished: {completed_count}/{total_nodes} nodes completed"
            )
            if self._failed_nodes:
                summary += f", {len(self._failed_nodes)} failed"
            if self._skipped_nodes:
                summary += f", {len(self._skipped_nodes)} skipped"
            await self._status_callback(final_status, summary, "")

            return self.collect_results()
        except Exception as e:
            # Update execution status on error
            if self.execution_id:
                try:
                    db.commit()  # end any open transaction
                    execution = (
                        db.query(WorkflowExecution)
                        .filter(WorkflowExecution.id == self.execution_id)
                        .first()
                    )
                    if execution:
                        execution.status = "failed"
                        db.commit()
                except Exception:
                    pass
            await self._status_callback("failed", f"Workflow error: {str(e)}", "")
            raise
        finally:
            await self._cleanup_sessions()
            db.close()

    # ------------------------------------------------------------------
    # Session cleanup
    # ------------------------------------------------------------------

    async def _cleanup_sessions(self) -> None:
        """Abort all sessions created during this execution."""
        session_ids = list(set(self._chain_sessions.values()))
        if not session_ids:
            return
        try:
            results = await self._dispatcher.backend.cleanup_sessions(session_ids)
            failed = [k for k, v in results.items() if v != "cleaned"]
            if failed:
                logger.warning(f"Some sessions failed to clean up: {failed}")
        except Exception as e:
            logger.warning(f"Session cleanup failed: {e}")

    # ------------------------------------------------------------------
    # Graph helpers
    # ------------------------------------------------------------------

    def _is_leaf(self, node_id: str) -> bool:
        """Check if a node has no successors (is a terminal node)."""
        return not any(e.get("source") == node_id for e in self.edges)

    def _is_only_successor(self, node_id: str, pred_id: str) -> bool:
        """Check if node_id is the sole successor of pred_id.

        This prevents parallel branches from sharing a session —
        if a predecessor has multiple successors, each gets its own session.
        """
        successors = [e["target"] for e in self.edges if e.get("source") == pred_id]
        return len(successors) == 1

    # ------------------------------------------------------------------
    # Execution ordering
    # ------------------------------------------------------------------

    async def _execute_in_order(
        self,
        execution_order: list[str],
        parallel_branches: dict[str, list[str]],
        predecessors: dict[str, list[str]],
    ) -> None:
        levels: dict[int, list[str]] = {}
        for node_id in execution_order:
            level = self._compute_level(node_id, predecessors)
            if level not in levels:
                levels[level] = []
            levels[level].append(node_id)

        for level in sorted(levels.keys()):
            nodes_to_run = [
                n for n in levels[level] if n not in self._skipped_nodes
            ]
            if not nodes_to_run:
                continue

            can_parallel = all(
                pred not in self._failed_nodes and pred not in self._skipped_nodes
                for node in nodes_to_run
                for pred in predecessors.get(node, [])
            )

            if can_parallel and len(nodes_to_run) > 1:
                await asyncio.gather(
                    *[self._execute_single_node(nid) for nid in nodes_to_run]
                )
            else:
                for node_id in nodes_to_run:
                    preds = predecessors.get(node_id, [])
                    if preds:
                        await self._wait_for_predecessors(preds)
                    await self._execute_single_node(node_id)

    async def _wait_for_predecessors(self, pred_ids: list[str]) -> None:
        for pred_id in pred_ids:
            while (
                pred_id not in self._results
                and pred_id not in self._failed_nodes
                and pred_id not in self._skipped_nodes
            ):
                await asyncio.sleep(0.1)

    def _compute_level(
        self, node_id: str, predecessors: dict[str, list[str]]
    ) -> int:
        preds = predecessors.get(node_id, [])
        if not preds:
            level = 0
        else:
            max_pred_level = max(
                (self._compute_level(p, predecessors) for p in preds), default=-1
            )
            level = max_pred_level + 1
        if not hasattr(self, "_node_levels"):
            self._node_levels = {}
        self._node_levels[node_id] = level
        return level

    # ------------------------------------------------------------------
    # Single node execution
    # ------------------------------------------------------------------

    async def _execute_single_node(self, node_id: str) -> None:
        if node_id in self._failed_nodes or node_id in self._skipped_nodes:
            return

        node = self._find_node(node_id)
        if not node:
            await self.handle_failure(node_id, ValueError(f"Node {node_id} not found"))
            return

        agent = self._get_agent_name(node)
        try:
            await self.execute_node(node_id)
            self._results[node_id] = self._results.get(node_id, {})
        except Exception as e:
            has_retry = node.get("retry") is not None and not node.get(
                "no_retry", False
            )
            if has_retry and hasattr(self, "_retry_handler") and self.execution_id:
                await self._status_callback(
                    "running", f"[Node] {agent} failed, retrying...", agent
                )
                retry_result = await self._retry_handler.retry_node(
                    node_id, self.execution_id
                )
                if retry_result.get("success"):
                    self._results[node_id] = retry_result.get("result", {})
                    await self._status_callback(
                        "completed", f"[Node] {agent} retry succeeded", agent
                    )
                    return
            await self.handle_failure(node_id, e)

    async def execute_node(self, node_id: str) -> dict[str, Any]:
        db = SessionLocal()
        exec_node = None
        try:
            node = self._find_node(node_id)
            if not node:
                raise ValueError(f"Node {node_id} not found")

            exec_node = (
                db.query(ExecutionNode)
                .filter(
                    ExecutionNode.execution_id == self.execution_id,
                    ExecutionNode.node_id == node_id,
                )
                .first()
            )
            if not exec_node:
                exec_node = ExecutionNode(
                    execution_id=self.execution_id,
                    node_id=node_id,
                    agent=self._get_agent_name(node),
                    status="pending",
                )
                db.add(exec_node)

            predecessor_ids = [
                e["source"] for e in self.edges if e.get("target") == node_id
            ]

            # Handle input nodes — pass through trigger params as output
            if node.get("type") == "input":
                self._results[node_id] = self.params
                exec_node.status = "completed"
                exec_node.output = self.params
                exec_node.completed_at = datetime.utcnow()
                db.commit()
                return self.params

            # Handle output nodes — collect upstream outputs as final result
            if node.get("type") == "output":
                upstream_outputs = []
                for pred_id in predecessor_ids:
                    if pred_id in self._results:
                        pred_result = self._results[pred_id]
                        output = (
                            pred_result.get("result", str(pred_result))
                            if isinstance(pred_result, dict)
                            else str(pred_result)
                        )
                        upstream_outputs.append(
                            {"agent_name": pred_id, "output": output}
                        )

                if upstream_outputs:
                    from main.framework.core.input_merger import merge_inputs
                    merged = merge_inputs(upstream_outputs)
                    result = {"result": merged}
                else:
                    result = {"result": ""}

                # If outputKey is specified, extract that key from merged upstream
                output_key = node.get("outputKey", "")
                if output_key and upstream_outputs:
                    for pred_id in predecessor_ids:
                        if pred_id in self._results:
                            pred_result = self._results[pred_id]
                            if isinstance(pred_result, dict) and output_key in pred_result:
                                result = {output_key: pred_result[output_key]}
                                break

                self._results[node_id] = result
                exec_node.status = "completed"
                exec_node.output = result
                exec_node.completed_at = datetime.utcnow()
                db.commit()
                return result

            # Handle debate nodes
            if node.get("type") == "debate":
                enriched_prompt = self._build_prompt(
                    node.get("prompt", ""), node, predecessor_ids, node_id
                )
                node_with_prompt = {**node, "prompt": enriched_prompt}
                debate_exec = DebateExecutor(self._dispatcher)
                result = await debate_exec.execute_debate(node_with_prompt)
                self._results[node_id] = result
                exec_node.status = "completed"
                exec_node.output = result
                exec_node.completed_at = datetime.utcnow()
                db.commit()
                return result

            # Regular agent node
            agent = self._get_agent_name(node)
            prompt_template = node.get("prompt", "")
            prompt = self._build_prompt(prompt_template, node, predecessor_ids, node_id)

            # Serial chain session reuse:
            #   Only reuse if:
            #   1. Node has exactly one predecessor
            #   2. That predecessor has a tracked session
            #   3. This node is the predecessor's ONLY successor (not a parallel branch)
            session_id = None
            after_count = 0
            if len(predecessor_ids) == 1:
                pred_id = predecessor_ids[0]
                if (
                    pred_id in self._chain_sessions
                    and self._is_only_successor(node_id, pred_id)
                ):
                    session_id = self._chain_sessions[pred_id]
                    # Get current message count to ignore old responses
                    after_count = await self._dispatcher.backend.get_message_count(
                        session_id
                    )

            # Leaf nodes don't need to keep sessions alive for downstream
            is_leaf = self._is_leaf(node_id)

            exec_node.session_id = session_id or ""
            exec_node.status = "running"
            db.commit()

            await self._status_callback(
                "running", f"[Node] {agent} is working on: {prompt[:100]}...", agent
            )

            resp = await self._dispatcher.dispatch(
                agent,
                prompt,
                session_id=session_id,
                reuse_session=not is_leaf,
                after_count=after_count,
            )
            result = resp["result"]
            new_session_id = resp["session_id"]

            # Track session for chain reuse
            self._chain_sessions[node_id] = new_session_id
            exec_node.session_id = new_session_id

            exec_node.status = "completed"
            exec_node.output = {"result": result}
            exec_node.completed_at = datetime.utcnow()
            db.commit()

            # Truncate result preview for status message
            result_preview = str(result)[:200] + "..." if len(str(result)) > 200 else str(result)
            await self._status_callback(
                "completed", f"[Node] {agent} completed: {result_preview}", agent
            )

            self._results[node_id] = {"result": result}
            return {"result": result}

        except Exception as e:
            if exec_node:
                exec_node.status = "failed"
                exec_node.error = str(e)
                db.commit()
            raise
        finally:
            db.close()

    # ------------------------------------------------------------------
    # Failure handling
    # ------------------------------------------------------------------

    async def handle_failure(self, node_id: str, error: Exception) -> None:
        db = SessionLocal()
        try:
            node = self._find_node(node_id)
            agent = self._get_agent_name(node) if node else node_id

            exec_node = (
                db.query(ExecutionNode)
                .filter(
                    ExecutionNode.execution_id == self.execution_id,
                    ExecutionNode.node_id == node_id,
                )
                .first()
            )
            if exec_node:
                exec_node.status = "failed"
                exec_node.error = str(error)
                db.commit()

            self._failed_nodes.add(node_id)
            await self._status_callback(
                "failed", f"[Node] {agent} failed: {str(error)}", agent
            )

            downstream_ids = self._find_downstream(node_id)
            if downstream_ids:
                await self._status_callback(
                    "running",
                    f"[Node] Skipping {len(downstream_ids)} downstream node(s) due to {agent} failure",
                    "",
                )

            for downstream_id in downstream_ids:
                if downstream_id not in self._failed_nodes:
                    self._skipped_nodes.add(downstream_id)
                    dn = (
                        db.query(ExecutionNode)
                        .filter(
                            ExecutionNode.execution_id == self.execution_id,
                            ExecutionNode.node_id == downstream_id,
                        )
                        .first()
                    )
                    if dn:
                        dn.status = "skipped"
                        db.commit()
        finally:
            db.close()

    # ------------------------------------------------------------------
    # Helpers
    # ------------------------------------------------------------------

    @staticmethod
    def _get_agent_name(node: dict) -> str:
        """Get agent name from node, with fallback to data.agentType / data.label."""
        agent = node.get("agent", "")
        if agent:
            return agent
        data = node.get("data", {})
        if isinstance(data, dict):
            return data.get("agentType", "") or data.get("label", "")
        return ""

    def collect_results(self) -> dict[str, Any]:
        return {
            "execution_id": self.execution_id,
            "workflow_id": self.workflow_id,
            "status": "failed" if self._failed_nodes else "completed",
            "results": self._results,
            "failed_nodes": list(self._failed_nodes),
            "skipped_nodes": list(self._skipped_nodes),
        }

    def _find_node(self, node_id: str) -> dict | None:
        for node in self.nodes:
            if node.get("id") == node_id:
                return node
        return None

    def _build_predecessors(self) -> dict[str, list[str]]:
        preds: dict[str, list[str]] = {}
        for edge in self.edges:
            source, target = edge.get("source"), edge.get("target")
            if source and target:
                preds.setdefault(target, []).append(source)
        return preds

    def _find_downstream(self, node_id: str) -> list[str]:
        downstream: list[str] = []
        visited: set[str] = set()

        def dfs(current: str):
            for edge in self.edges:
                if edge.get("source") == current:
                    target = edge.get("target")
                    if target and target not in visited:
                        visited.add(target)
                        downstream.append(target)
                        dfs(target)

        dfs(node_id)
        return downstream

    def _build_prompt(
        self,
        template: str,
        node: dict,
        predecessor_ids: list[str] | None = None,
        node_id: str | None = None,
    ) -> str:
        prompt = template

        for key, value in self.params.items():
            prompt = prompt.replace(f"{{{key}}}", str(value))

        for key, value in node.items():
            if isinstance(value, str):
                prompt = prompt.replace(f"{{{key}}}", value)

        if node_id:
            for edge in self.edges:
                if edge.get("target") == node_id:
                    edge_prompt = edge.get("prompt", "")
                    edge_type = edge.get("promptType", "context")
                    if edge_prompt:
                        prompt = f"{prompt}\n\n--- Connection ({edge_type}) ---\n{edge_prompt}"

        if predecessor_ids:
            upstream_outputs = []
            for pred_id in predecessor_ids:
                if pred_id in self._results:
                    pred_result = self._results[pred_id]
                    output = (
                        pred_result.get("result", str(pred_result))
                        if isinstance(pred_result, dict)
                        else str(pred_result)
                    )
                    upstream_outputs.append(
                        {"agent_name": pred_id, "output": output}
                    )

            if upstream_outputs:
                from main.framework.core.input_merger import merge_inputs

                merged = merge_inputs(upstream_outputs)
                if "{upstream}" in prompt:
                    prompt = prompt.replace("{upstream}", merged)
                else:
                    prompt = f"{prompt}\n\n--- Upstream Outputs ---\n{merged}"

        return prompt
