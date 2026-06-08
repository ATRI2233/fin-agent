"""Workflow execution engine with topological sort and parallel execution."""

from __future__ import annotations

import asyncio
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


StatusCallback = Callable[[str, str, str], Awaitable[None]]


class WorkflowEngine:
    """Executes workflow DAG with topological ordering and parallel execution."""

    def __init__(
        self,
        workflow_id: str,
        params: dict[str, Any],
        dispatcher: AgentDispatcher,
        status_callback: StatusCallback | None = None,
    ):
        self.workflow_id = workflow_id
        self.params = params
        self._dispatcher = dispatcher
        self._status_callback = status_callback or self._noop_callback
        self.execution_id: str | None = None
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
        db = SessionLocal()
        try:
            from main.framework.models.workflow import Workflow

            workflow = db.query(Workflow).filter(Workflow.id == self.workflow_id).first()
            if not workflow:
                raise ValueError(f"Workflow {self.workflow_id} not found")

            self.nodes = workflow.nodes or []
            self.edges = workflow.edges or []

            self._retry_handler = WorkflowRetryHandler(
                self.workflow_id, dispatcher=self._dispatcher
            )

            execution = WorkflowExecution(
                workflow_id=self.workflow_id, status="running"
            )
            db.add(execution)
            db.commit()
            self.execution_id = execution.id

            for node in self.nodes:
                exec_node = ExecutionNode(
                    execution_id=self.execution_id,
                    node_id=node["id"],
                    agent=node.get("agent", ""),
                    status="pending",
                    input=self.params,
                )
                db.add(exec_node)
            db.commit()

            execution_order = topological_sort(self.nodes, self.edges)
            if not execution_order:
                raise ValueError("Failed to compute topological order - possible cycle")

            parallel_branches = identify_parallel_branches(self.nodes, self.edges)
            predecessors = self._build_predecessors()

            await self._execute_in_order(
                execution_order, parallel_branches, predecessors
            )

            final_status = "failed" if self._failed_nodes else "completed"
            execution.status = final_status
            db.commit()

            return self.collect_results()
        finally:
            db.close()

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

        try:
            await self.execute_node(node_id)
            self._results[node_id] = self._results.get(node_id, {})
        except Exception as e:
            has_retry = node.get("retry") is not None and not node.get(
                "no_retry", False
            )
            if has_retry and hasattr(self, "_retry_handler") and self.execution_id:
                retry_result = await self._retry_handler.retry_node(
                    node_id, self.execution_id
                )
                if retry_result.get("success"):
                    self._results[node_id] = retry_result.get("result", {})
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
                    agent=node.get("agent", ""),
                    status="pending",
                )
                db.add(exec_node)

            predecessor_ids = [
                e["source"] for e in self.edges if e.get("target") == node_id
            ]

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
            agent = node.get("agent", "")
            prompt_template = node.get("prompt", "")
            prompt = self._build_prompt(prompt_template, node, predecessor_ids, node_id)

            # Serial chain session reuse
            session_id = None
            if len(predecessor_ids) == 1:
                pred_id = predecessor_ids[0]
                if pred_id in self._chain_sessions:
                    session_id = self._chain_sessions[pred_id]

            exec_node.hapi_session_id = session_id or ""
            exec_node.status = "running"
            db.commit()

            await self._status_callback("running", f"{agent} is working...", agent)

            resp = await self._dispatcher.dispatch(
                agent,
                prompt,
                session_id=session_id,
                reuse_session=True,  # keep alive for downstream chain
            )
            result = resp["result"]
            new_session_id = resp["session_id"]

            # Track session for chain reuse
            self._chain_sessions[node_id] = new_session_id
            exec_node.hapi_session_id = new_session_id

            exec_node.status = "completed"
            exec_node.output = {"result": result}
            exec_node.completed_at = datetime.utcnow()
            db.commit()

            await self._status_callback("completed", f"{agent} completed", agent)

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

            for downstream_id in self._find_downstream(node_id):
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
