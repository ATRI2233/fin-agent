"""Background message processing — agent and workflow execution."""

from __future__ import annotations

import asyncio
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
    _publish_event(conversation_id, {
        "type": "workflow_status",
        "execution_id": execution_id,
        "status": status,
        "agent": agent,
        "content": detail,
    })


def _publish_event(conversation_id: str, event: dict) -> None:
    """Fire-and-forget publish to SSE subscribers. Logs and swallows all errors."""
    try:
        from main.framework.core.infrastructure.container import get_container
        asyncio.create_task(get_container().event_bus.publish(conversation_id, event))
    except Exception as e:
        logger.warning("event_bus.publish failed: %s", e)


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

            # Capture the old session_id BEFORE get_or_create_session potentially replaces it
            old_session_id = conversation.session_id if conversation else None

            if conversation:
                conversation.current_agent = agent
                db.commit()

            # Create session with the target agent (reuse existing if present)
            session_id, _, _ = await session_manager.get_or_create_session(conversation_id, agent=agent, db=db)

            # Restore session history from DB when the conversation had a prior session
            # but backend has lost it (e.g. backend restarted, clearing in-memory history).
            if old_session_id and not backend.has_history(session_id):
                try:
                    past_messages = (
                        db.query(Message)
                        .filter(Message.conversation_id == conversation_id)
                        .order_by(Message.created_at)
                        .all()
                    )
                    # Build a list of send coroutines and run them concurrently
                    tasks = []
                    for msg in past_messages:
                        if msg.role == "user":
                            tasks.append(backend.send_message_no_wait(session_id, msg.content))
                        elif msg.role == "assistant" and msg.content:
                            tasks.append(backend.send_message_no_wait(
                                session_id,
                                f"[assistant: {msg.agent or 'agent'}] {msg.content}",
                            ))
                        elif msg.role == "system" and msg.extra_data and msg.extra_data.get("type") == "workflow_result":
                            tasks.append(backend.send_message_no_wait(
                                session_id,
                                f"[工作流输出]\n{msg.content}",
                            ))
                    if tasks:
                        await asyncio.gather(*tasks)
                    logger.info("Restored %d messages to session %s", len(past_messages), session_id)
                except Exception as restore_err:
                    logger.warning("Failed to restore session history: %s", restore_err)

            # Send message with agent parameter so opencode switches agent in the same session
            # (Tab-switch style — same session ID, different agent per message)
            try:
                await backend.send_message(session_id, content, agent=agent)
            except Exception as send_err:
                # If send fails the session is dead — don't keep returning it.
                session_manager.mark_bad(session_id)
                raise send_err from send_err

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
            _publish_event(conversation_id, {
                "type": "message",
                "message": {
                    "id": assistant_msg.id,
                    "conversation_id": assistant_msg.conversation_id,
                    "role": assistant_msg.role,
                    "content": assistant_msg.content,
                    "agent": assistant_msg.agent,
                    "extra_data": assistant_msg.extra_data,
                    "created_at": assistant_msg.created_at.isoformat(),
                },
            })

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
                        if attempt < 4:
                            await asyncio.sleep(0.5 * (attempt + 1))
                        else:
                            logger.warning(
                                "status_callback failed after %d attempts: %s",
                                attempt + 1, e,
                            )
                            # Last resort: try once more with a fresh session
                            try:
                                with get_session() as db3:
                                    _save_workflow_status(
                                        db3,
                                        conversation_id,
                                        execution_id,
                                        workflow_id,
                                        st,
                                        detail,
                                        agent,
                                    )
                                return
                            except Exception as e2:
                                logger.error(
                                    "status_callback final attempt also failed: %s", e2,
                                )
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
            final_status = "failed" if has_failures else "completed"
            execution.status = final_status
            execution.completed_at = datetime.now(UTC)
            db.commit()

            # Ensure a terminal workflow_status message exists (the status_callback
            # inside the engine may have failed to persist its message). This is a
            # fallback — if the callback succeeded there will be a duplicate, but
            # the frontend handles that gracefully via strike-through logic.
            if final_status in ("completed", "failed"):
                terminal_content = (
                    f"Workflow {final_status}: {len(engine_result.get('failed_nodes', []))} node(s) failed"
                    if has_failures else f"Workflow {final_status}"
                )
                try:
                    status_msg = Message(
                        id=str(uuid4()),
                        conversation_id=conversation_id,
                        role="system",
                        content=terminal_content,
                        workflow_id=workflow_id,
                        execution_id=execution_id,
                        extra_data={"type": "workflow_status", "status": final_status},
                    )
                    db.add(status_msg)
                    db.commit()
                except Exception as status_err:
                    logger.warning("Failed to save terminal workflow_status message: %s", status_err)
                    db.rollback()
                # Publish terminal event — this is a fallback when the engine's
                # status_callback failed to persist; the event mirrors the msg.
                _publish_event(conversation_id, {
                    "type": "workflow_result" if final_status == "completed" else "workflow_error",
                    "execution_id": execution_id,
                    "status": final_status,
                    "content": terminal_content,
                })

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

            # Build nodes summary for frontend display
            nodes_summary = []
            for node in nodes:
                if node.agent:
                    nodes_summary.append({
                        "agent": node.agent,
                        "status": node.status,
                    })

            result_msg = Message(
                id=str(uuid4()),
                conversation_id=conversation_id,
                role="assistant",
                content=result_content,
                workflow_id=workflow_id,
                execution_id=execution_id,
                extra_data={
                    "type": "workflow_result",
                    "status": execution.status,
                    "nodes": nodes_summary,
                },
            )
            db.add(result_msg)

            conversation = db.query(Conversation).filter(Conversation.id == conversation_id).first()
            if conversation:
                conversation.updated_at = datetime.now(UTC)

            db.commit()
            _publish_event(conversation_id, {
                "type": "workflow_result",
                "execution_id": execution_id,
                "status": execution.status,
                "nodes": nodes_summary,
                "content": result_content,
            })

            # Inject workflow result into opencode session so session history and DB stay in sync
            if conversation and conversation.session_id:
                try:
                    result_injection = f"[工作流输出]\n{result_content}"
                    await container.backend.send_message(conversation.session_id, result_injection)
                except Exception as inj_err:
                    logger.warning(
                        "Failed to inject workflow result to session %s: %s",
                        conversation.session_id, inj_err,
                    )

        except Exception as e:
            logger.error(f"Workflow {workflow_id} execution failed: {e}", exc_info=True)
            # If the workflow_status/failed callback message wasn't saved
            # (e.g. due to a DB write error), save it here as a fallback so
            # the frontend receives the terminal status update.
            try:
                status_msg = Message(
                    id=str(uuid4()),
                    conversation_id=conversation_id,
                    role="system",
                    content=f"Workflow failed: {str(e)}",
                    workflow_id=workflow_id,
                    execution_id=execution_id,
                    extra_data={"type": "workflow_status", "status": "failed"},
                )
                db.add(status_msg)
            except Exception:
                pass  # best-effort; don't mask the original error
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
