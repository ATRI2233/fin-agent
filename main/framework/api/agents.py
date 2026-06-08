from fastapi import APIRouter, HTTPException, status

router = APIRouter(prefix="/api/v1/agents", tags=["agents"])


@router.get("")
async def list_agents():
    """List all registered agents."""
    from main.framework.core.agent_registry import registry

    agents = registry.list_agents()
    return [
        {
            "name": a.name,
            "description": a.description,
            "capabilities": a.capabilities,
            "tools": a.tools,
            "mode": a.mode,
        }
        for a in agents
    ]


@router.get("/stats")
async def agent_stats():
    """Agent usage stats from workflow execution nodes."""
    try:
        from sqlalchemy import func
        from main.framework.models.database import SessionLocal
        from main.framework.models.workflow_execution import ExecutionNode
        from main.framework.core.agent_registry import registry

        db = SessionLocal()
        try:
            rows = db.query(
                ExecutionNode.agent, ExecutionNode.status, func.count(ExecutionNode.id)
            ).group_by(ExecutionNode.agent, ExecutionNode.status).all()
            stats: dict = {}
            for agent, s, count in rows:
                if agent not in stats:
                    stats[agent] = {"total": 0, "completed": 0, "failed": 0}
                stats[agent][s] = stats[agent].get(s, 0) + count
                stats[agent]["total"] += count
        finally:
            db.close()

        result = []
        for a in registry.list_agents():
            s = stats.get(a.name, {"total": 0, "completed": 0, "failed": 0})
            total_terminal = s["completed"] + s["failed"]
            result.append({
                "name": a.name, "description": a.description, "mode": a.mode,
                "executions_total": s["total"], "executions_completed": s["completed"],
                "executions_failed": s["failed"],
                "success_rate": round(s["completed"] / max(total_terminal, 1) * 100, 1),
            })
        return result
    except Exception:
        return []


@router.get("/{name}")
async def get_agent(name: str):
    """Get agent details by name."""
    from main.framework.core.agent_registry import registry

    agent = registry.get_agent(name)
    if not agent:
        raise HTTPException(status_code=404, detail="Agent not found")
    return {
        "name": agent.name,
        "description": agent.description,
        "capabilities": agent.capabilities,
        "tools": agent.tools,
        "mode": agent.mode,
    }
