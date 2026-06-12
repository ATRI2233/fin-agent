"""Background message processing — agent and workflow execution."""

from __future__ import annotations

import logging
from datetime import UTC, datetime
from uuid import uuid4

from main.framework.core.workflow.session_manager import ConvSessionManager
from main.framework.models.conversation import Conversation, Message
from main.framework.models.database import get_session
from main.framework.models.workflow import Workflow
from main.framework.models.workflow_execution import ExecutionNode, WorkflowExecution

logger = logging.getLogger(__name__)


def _save_workflow_status(
    db,
    conversation_id: str,
    execution_id: str,
    workflow_id: str,
    status: str,
    detail: str,
    agent: str = None,
):
    """Save workflow status message for real-time updates."""
    msg = Message(
        id=str(uuid4()),
        conversation_id=conversation_id,
        role="system",
        content=detail,
        workflow_id=workflow_id,
        execution_id=execution_id,
        agent=agent,
        extra_data={"type": "workflow_status", "status": status, "agent": agent},
    )
    db.add(msg)
    db.commit()


async def process_agent_message(
    conversation_id: str,
    message_id: str,
    content: str,
    agent: str,
    backend,
    session_manager: ConvSessionManager,
):
    """Process agent message in background."""
    from main.framework.core.infrastructure.protocols import AgentBackend

    with get_session() as db:
        try:
            conversation = db.query(Conversation).filter(Conversation.id == conversation_id).first()

            # If agent changed, cleanup old session to create fresh one
            if conversation and conversation.current_agent and conversation.current_agent != agent:
                await session_manager.cleanup_session(conversation_id, db=db)
                conversation.session_id = None
                db.commit()

            if conversation:
                conversation.current_agent = agent
                db.commit()

            # Create session with the target agent (direct routing, no @prefix)
            session_id, _ = await session_manager.get_or_create_session(conversation_id, agent=agent, db=db)

            # Send message directly — opencode --agent handles routing
            await backend.send_message(session_id, content)

            # Get response (send_message already waits for completion)
            result = await backend.wait_for_completion(session_id)

            try:
                import json

                parsed = json.loads(result)
                response_content = parsed.get("result", result)
            except Exception:
                response_content = result

            assistant_msg = Message(
                id=str(uuid4()),
                conversation_id=conversation_id,
                role="assistant",
                content=response_content,
                agent=agent,
                extra_data={"session_id": session_id, "in_reply_to": message_id},
            )
            db.add(assistant_msg)

            conversation = db.query(Conversation).filter(Conversation.id == conversation_id).first()
            if conversation:
                conversation.updated_at = datetime.now(UTC)

            db.commit()

        except Exception as e:
            logger.error(f"Agent message processing failed: {e}", exc_info=True)
            error_msg = Message(
                id=str(uuid4()),
                conversation_id=conversation_id,
                role="system",
                content=f"Agent error ({agent}): {str(e)}",
                extra_data={"type": "error", "in_reply_to": message_id, "agent": agent},
            )
            db.add(error_msg)
            db.commit()


async def execute_workflow_async(conversation_id: str, execution_id: str, workflow_id: str, params: dict, container):
    """Execute workflow in background and save results to conversation."""
    with get_session() as db:
        try:
            from main.framework.core.workflow.workflow_engine import WorkflowEngine

            workflow = db.query(Workflow).filter(Workflow.id == workflow_id).first()
            if not workflow:
                logger.error(f"Workflow {workflow_id} not found")
                return

            execution = db.query(WorkflowExecution).filter(WorkflowExecution.id == execution_id).first()
            if not execution:
                logger.error(f"Execution {execution_id} not found")
                return
            execution.status = "running"
            db.commit()

            # Create all ExecutionNode records
            nodes = workflow.nodes or []
            for node in nodes:
                agent = node.get("agent", "")
                if not agent:
                    data = node.get("data", {})
                    if isinstance(data, dict):
                        agent = data.get("agentType", "") or data.get("label", "")
                exec_node = ExecutionNode(
                    execution_id=execution_id,
                    node_id=node["id"],
                    agent=agent,
                    status="pending",
                    input=params,
                )
                db.add(exec_node)
            db.commit()

            async def status_callback(st: str, detail: str, agent: str = ""):
                import asyncio
                for attempt in range(5):
                    try:
                        with get_session() as db2:
                            _save_workflow_status(
                                db2,
                                conversation_id,
                                execution_id,
                                workflow_id,
                                st,
                                detail,
                                agent,
                            )
                        return
                    except Exception as e:
                        if "database is locked" in str(e) and attempt < 4:
                            await asyncio.sleep(0.5 * (attempt + 1))
                        else:
                            logger.warning("status_callback failed after %d attempts: %s", attempt + 1, e)
                            return

            engine = container.create_workflow_engine(
                workflow_id, params, db=db, status_callback=status_callback, execution_id=execution_id
            )
            engine_result = await engine.execute()

            execution = db.query(WorkflowExecution).filter(WorkflowExecution.id == execution_id).first()
            if not execution:
                return

            # Update execution status based on engine result
            has_failures = bool(engine_result.get("failed_nodes"))
            execution.status = "failed" if has_failures else "completed"
            execution.completed_at = datetime.now(UTC)
            db.commit()

            nodes = db.query(ExecutionNode).filter(ExecutionNode.execution_id == execution_id).all()

            # Identify output node IDs from workflow definition
            wf_nodes = workflow.nodes or []
            output_node_ids = {n["id"] for n in wf_nodes if n.get("type") == "output"}

            # Separate output nodes (merged results) from agent nodes (individual outputs)
            output_node = None
            agent_parts = []
            error_parts = []
            for node in nodes:
                if node.status == "completed" and node.output:
                    if node.node_id in output_node_ids:
                        # Output node — its result is the merged final output
                        output_node = node
                    elif node.agent:
                        # Agent node — individual contribution
                        agent_parts.append(f"**{node.agent}**:\n{node.output.get('result', '')}")
                if node.status == "failed":
                    error_parts.append(f"  - {node.agent or node.node_id}: {node.error or 'unknown error'}")

            # Build result message: prefer output node's merged result as main content
            if output_node and output_node.output.get("result"):
                result_content = output_node.output["result"]
            elif agent_parts:
                result_content = "\n\n".join(agent_parts)
            else:
                result_content = "Workflow completed with no output."

            # Append error info for partial failures
            if has_failures:
                if error_parts:
                    result_content += "\n\n⚠️ 部分节点执行失败:\n" + "\n".join(error_parts)

            result_msg = Message(
                id=str(uuid4()),
                conversation_id=conversation_id,
                role="assistant",
                content=result_content,
                workflow_id=workflow_id,
                execution_id=execution_id,
                extra_data={"type": "workflow_result", "status": execution.status},
            )
            db.add(result_msg)

            conversation = db.query(Conversation).filter(Conversation.id == conversation_id).first()
            if conversation:
                conversation.updated_at = datetime.now(UTC)

            db.commit()

        except Exception as e:
            logger.error(f"Workflow {workflow_id} execution failed: {e}", exc_info=True)
            # Collect failed node errors if available
            error_content = f"Workflow error: {str(e)}"
            try:
                failed_nodes = db.query(ExecutionNode).filter(
                    ExecutionNode.execution_id == execution_id,
                    ExecutionNode.status == "failed",
                ).all()
                if failed_nodes:
                    error_details = []
                    for node in failed_nodes:
                        error_details.append(f"  - {node.agent or node.node_id}: {node.error or 'unknown error'}")
                    error_content += "\n\nFailed nodes:\n" + "\n".join(error_details)
            except Exception:
                pass  # best-effort; don't mask the original error
            error_msg = Message(
                id=str(uuid4()),
                conversation_id=conversation_id,
                role="system",
                content=error_content,
                extra_data={"type": "workflow_error", "execution_id": execution_id},
            )
            db.add(error_msg)
            db.commit()
