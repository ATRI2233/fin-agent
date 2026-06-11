"""Background message processing — agent and workflow execution."""

from __future__ import annotations

import logging
from datetime import UTC, datetime
from uuid import uuid4

from main.framework.core.session_manager import ConvSessionManager
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
            error_msg = Message(
                id=str(uuid4()),
                conversation_id=conversation_id,
                role="system",
                content=f"Error: {str(e)}",
                extra_data={"type": "error", "in_reply_to": message_id},
            )
            db.add(error_msg)
            db.commit()


async def execute_workflow_async(conversation_id: str, execution_id: str, workflow_id: str, params: dict, container):
    """Execute workflow in background and save results to conversation."""
    with get_session() as db:
        try:

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

            def status_callback(st: str, detail: str, agent: str = ""):
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

            engine = container.create_workflow_engine(
                workflow_id, params, db=db, status_callback=status_callback, execution_id=execution_id
            )
            await engine.execute()

            execution = db.query(WorkflowExecution).filter(WorkflowExecution.id == execution_id).first()
            if not execution:
                return

            nodes = db.query(ExecutionNode).filter(ExecutionNode.execution_id == execution_id).all()

            result_parts = []
            for node in nodes:
                if node.output:
                    result_parts.append(f"**{node.agent}**:\n{node.output.get('result', '')}")

            result_content = "\n\n".join(result_parts) if result_parts else "Workflow completed with no output."

            result_msg = Message(
                id=str(uuid4()),
                conversation_id=conversation_id,
                role="assistant",
                content=result_content,
                workflow_id=workflow_id,
                execution_id=execution_id,
                extra_data={"type": "workflow_result"},
            )
            db.add(result_msg)

            conversation = db.query(Conversation).filter(Conversation.id == conversation_id).first()
            if conversation:
                conversation.updated_at = datetime.now(UTC)

            db.commit()

        except Exception as e:
            logger.error(f"Workflow {workflow_id} execution failed: {e}", exc_info=True)
            error_msg = Message(
                id=str(uuid4()),
                conversation_id=conversation_id,
                role="system",
                content=f"Workflow error: {str(e)}",
                extra_data={"type": "workflow_error"},
            )
            db.add(error_msg)
            db.commit()
