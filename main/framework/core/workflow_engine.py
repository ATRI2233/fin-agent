"""Workflow execution engine with topological sort and parallel execution."""

import asyncio
from datetime import datetime
from typing import Any

from main.framework.core.hapi_bridge import HAPIBridge
from main.framework.core.debate_executor import DebateExecutor
from main.framework.core.retry_handler import WorkflowRetryHandler
from main.framework.core.workflow_parser import (
    topological_sort,
    identify_parallel_branches,
)
from main.framework.models.database import SessionLocal
from main.framework.models.workflow_execution import ExecutionNode, WorkflowExecution
from main.framework.config import settings


class WorkflowEngine:
    """Executes workflow DAG with topological ordering and parallel execution."""

    def __init__(self, workflow_id: str, params: dict[str, Any]):
        self.workflow_id = workflow_id
        self.params = params
        self.execution_id: str | None = None
        self.nodes: list[dict] = []
        self.edges: list[dict] = []
        self._results: dict[str, Any] = {}
        self._failed_nodes: set[str] = set()
        self._skipped_nodes: set[str] = set()
        self._chain_sessions: dict[str, str] = {}  # node_id â†?session_id
        self._chain_hapi: dict[str, HAPIBridge] = {}  # session_id â†?HAPIBridge instance

    async def execute(self) -> dict[str, Any]:
        """Main execution method using asyncio with parallel execution of independent nodes."""
        db = SessionLocal()
        try:
            # Load workflow from database
            from main.framework.models.workflow import Workflow

            workflow = (
                db.query(Workflow).filter(Workflow.id == self.workflow_id).first()
            )
            if not workflow:
                raise ValueError(f"Workflow {self.workflow_id} not found")

            self.nodes = workflow.nodes or []
            self.edges = workflow.edges or []

            # Initialize retry handler
            self._retry_handler = WorkflowRetryHandler(self.workflow_id)

            # Create execution record
            execution = WorkflowExecution(
                workflow_id=self.workflow_id,
                status="running",
            )
            db.add(execution)
            db.commit()
            self.execution_id = execution.id

            # Initialize execution nodes in database
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

            # Get topological order
            execution_order = topological_sort(self.nodes, self.edges)
            if not execution_order:
                raise ValueError("Failed to compute topological order - possible cycle")

            # Identify parallel branches
            parallel_branches = identify_parallel_branches(self.nodes, self.edges)

            # Build dependency map: node_id -> list of predecessor node_ids
            predecessors = self._build_predecessors()

            # Execute in topological order with parallelism
            await self._execute_in_order(
                execution_order, parallel_branches, predecessors
            )

            # Collect final results
            final_status = "failed" if self._failed_nodes else "completed"
            execution.status = final_status
            db.commit()

            return self.collect_results()

        finally:
            db.close()

    async def _execute_in_order(
        self,
        execution_order: list[str],
        parallel_branches: dict[str, list[str]],
        predecessors: dict[str, list[str]],
    ) -> None:
        """Execute nodes in topological order, parallelizing where possible."""
        # Group nodes by "level" - nodes at the same dependency level can run in parallel
        levels: dict[int, list[str]] = {}
        node_to_level: dict[str, int] = {}

        for node_id in execution_order:
            level = self._compute_level(node_id, predecessors)
            node_to_level[node_id] = level
            if level not in levels:
                levels[level] = []
            levels[level].append(node_id)

        # Execute level by level
        for level in sorted(levels.keys()):
            nodes_at_level = levels[level]
            # Filter out skipped nodes
            nodes_to_run = [n for n in nodes_at_level if n not in self._skipped_nodes]

            if not nodes_to_run:
                continue

            # Check if these nodes can run in parallel (no dependencies between them)
            can_run_parallel = all(
                pred not in self._failed_nodes and pred not in self._skipped_nodes
                for node in nodes_to_run
                for pred in predecessors.get(node, [])
            )

            if can_run_parallel and len(nodes_to_run) > 1:
                # Execute parallel nodes together
                await asyncio.gather(
                    *[self._execute_single_node(node_id) for node_id in nodes_to_run]
                )
            else:
                # Serial execution (some dependencies not met or single node)
                for node_id in nodes_to_run:
                    preds = predecessors.get(node_id, [])
                    # Wait for all predecessors to complete
                    if preds:
                        # Check if all predecessors are done
                        await self._wait_for_predecessors(preds)
                    await self._execute_single_node(node_id)

    async def _wait_for_predecessors(self, pred_ids: list[str]) -> None:
        """Wait for predecessor nodes to complete."""
        for pred_id in pred_ids:
            while (
                pred_id not in self._results
                and pred_id not in self._failed_nodes
                and pred_id not in self._skipped_nodes
            ):
                await asyncio.sleep(0.1)

    def _compute_level(self, node_id: str, predecessors: dict[str, list[str]]) -> int:
        """Compute the dependency level of a node (for parallel execution grouping)."""
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

    def _get_node_level(self, node_id: str) -> int:
        """Get cached level for a node."""
        return getattr(self, "_node_levels", {}).get(node_id, 0)

    async def _execute_single_node(self, node_id: str) -> None:
        """Execute a single node via HAPI."""
        if node_id in self._failed_nodes or node_id in self._skipped_nodes:
            return

        node = self._find_node(node_id)
        if not node:
            await self.handle_failure(node_id, ValueError(f"Node {node_id} not found"))
            return

        try:
            await self.execute_node(node_id)
            # Mark as completed - success
            self._results[node_id] = self._results.get(node_id, {})
        except Exception as e:
            # Check if retry is configured for this node
            has_retry_config = node.get("retry") is not None and not node.get(
                "no_retry", False
            )
            if (
                has_retry_config
                and hasattr(self, "_retry_handler")
                and self.execution_id
            ):
                retry_result = await self._retry_handler.retry_node(
                    node_id, self.execution_id
                )
                if retry_result.get("success"):
                    self._results[node_id] = retry_result.get("result", {})
                    return
            await self.handle_failure(node_id, e)

    async def execute_node(self, node_id: str) -> dict[str, Any]:
        """Execute single node via HAPI bridge."""
        db = SessionLocal()
        exec_node = None
        try:
            node = self._find_node(node_id)
            if not node:
                raise ValueError(f"Node {node_id} not found")

            # Get or create execution node record
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

            # Get predecessor node IDs for this node
            predecessor_ids = [
                e["source"] for e in self.edges if e.get("target") == node_id
            ]

            # Handle debate nodes via DebateExecutor
            if node.get("type") == "debate":
                enriched_prompt = self._build_prompt(
                    node.get("prompt", ""), node, predecessor_ids, node_id
                )
                node_with_prompt = {**node, "prompt": enriched_prompt}
                executor = DebateExecutor()
                result = await executor.execute_debate(node_with_prompt)
                self._results[node_id] = result
                exec_node.status = "completed"
                exec_node.output = result
                exec_node.completed_at = datetime.utcnow()
                db.commit()
                return result

            # Build prompt from node config, params, and upstream context
            agent = node.get("agent", "")
            prompt_template = node.get("prompt", "")
            prompt = self._build_prompt(prompt_template, node, predecessor_ids, node_id)

            # Serial chain session sharing: reuse session if single predecessor has one
            is_serial = len(predecessor_ids) == 1
            parent_session = None
            if is_serial:
                pred_id = predecessor_ids[0]
                if pred_id in self._chain_sessions:
                    parent_session = self._chain_sessions[pred_id]

            if parent_session and parent_session in self._chain_hapi:
                # Reuse existing session
                hapi = self._chain_hapi[parent_session]
                session_id = parent_session
                await hapi.send_message(session_id, prompt)
            else:
                # Create new session
                hapi = HAPIBridge(hub_url=settings.HAPI_HUB_URL, api_token=settings.HAPI_API_TOKEN)
                session_id = await hapi.create_session_for_node(node_id, agent, prompt)
                self._chain_hapi[session_id] = hapi

            self._chain_sessions[node_id] = session_id

            # Update execution node with session
            exec_node.hapi_session_id = session_id
            exec_node.status = "running"
            db.commit()

            # Report status callback
            if self._status_callback:
                await self._status_callback("running", f"{agent} is working...", agent)

            # Send message to start execution
            await hapi.send_message(session_id, prompt)

            # Wait for completion
            result = await hapi.wait_for_completion(session_id)

            # Store result
            exec_node.status = "completed"
            exec_node.output = {"result": result}
            exec_node.completed_at = datetime.utcnow()
            db.commit()

            # Report status callback
            if self._status_callback:
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

    async def handle_failure(self, node_id: str, error: Exception) -> None:
        """Mark node as failed and skip all downstream nodes."""
        db = SessionLocal()
        try:
            # Mark this node as failed
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

            # Find and mark all downstream nodes as skipped
            downstream = self._find_downstream(node_id)
            for downstream_id in downstream:
                if downstream_id not in self._failed_nodes:
                    self._skipped_nodes.add(downstream_id)

                    # Update in database
                    exec_node = (
                        db.query(ExecutionNode)
                        .filter(
                            ExecutionNode.execution_id == self.execution_id,
                            ExecutionNode.node_id == downstream_id,
                        )
                        .first()
                    )
                    if exec_node:
                        exec_node.status = "skipped"
                        db.commit()

        finally:
            db.close()

    def collect_results(self) -> dict[str, Any]:
        """Collect all node outputs from execution."""
        return {
            "execution_id": self.execution_id,
            "workflow_id": self.workflow_id,
            "status": "failed" if self._failed_nodes else "completed",
            "results": self._results,
            "failed_nodes": list(self._failed_nodes),
            "skipped_nodes": list(self._skipped_nodes),
        }

    def _find_node(self, node_id: str) -> dict | None:
        """Find node config by ID."""
        for node in self.nodes:
            if node.get("id") == node_id:
                return node
        return None

    def _build_predecessors(self) -> dict[str, list[str]]:
        """Build a map of node_id -> list of predecessor node_ids."""
        preds: dict[str, list[str]] = {}
        for edge in self.edges:
            source, target = edge.get("source"), edge.get("target")
            if source and target:
                if target not in preds:
                    preds[target] = []
                preds[target].append(source)
        return preds

    def _find_downstream(self, node_id: str) -> list[str]:
        """Find all nodes downstream of given node (following edges)."""
        downstream = []
        visited = set()

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
        """Build prompt from template, params, upstream node outputs, and edge connections."""
        prompt = template

        # Substitute workflow-level params
        for key, value in self.params.items():
            prompt = prompt.replace(f"{{{key}}}", str(value))

        # Substitute node config values
        for key, value in node.items():
            if isinstance(value, str):
                prompt = prompt.replace(f"{{{key}}}", value)

        # Inject edge connection prompts
        if node_id:
            for edge in self.edges:
                if edge.get("target") == node_id:
                    edge_prompt = edge.get("prompt", "")
                    edge_type = edge.get("promptType", "context")
                    if edge_prompt:
                        prompt = f"{prompt}\n\n--- Connection ({edge_type}) ---\n{edge_prompt}"

        # Inject upstream outputs
        if predecessor_ids:
            upstream_outputs = []
            for pred_id in predecessor_ids:
                if pred_id in self._results:
                    pred_result = self._results[pred_id]
                    # Extract the actual output string
                    if isinstance(pred_result, dict):
                        output = pred_result.get("result", str(pred_result))
                    else:
                        output = str(pred_result)
                    upstream_outputs.append({"agent_name": pred_id, "output": output})

            if upstream_outputs:
                from main.framework.core.input_merger import merge_inputs

                merged = merge_inputs(upstream_outputs)
                # Replace {upstream} placeholder or append to end
                if "{upstream}" in prompt:
                    prompt = prompt.replace("{upstream}", merged)
                else:
                    prompt = f"{prompt}\n\n--- Upstream Outputs ---\n{merged}"

        return prompt
