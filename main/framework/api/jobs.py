from datetime import datetime
from typing import Optional

from fastapi import APIRouter, HTTPException, Query, status
from pydantic import BaseModel, Field

from main.framework.core.job_manager import JobManager
from main.framework.core.log_collector import get_log_collector

router = APIRouter(prefix="/api/v1/jobs", tags=["jobs"])
jm = JobManager()


class JobCreate(BaseModel):
    agent: str
    prompt: str = Field(..., max_length=10000)
    params: Optional[dict] = None


class JobResponse(BaseModel):
    id: str
    agent: str
    prompt: str
    status: str
    created_at: str
    result: Optional[dict] = None

    class Config:
        from_attributes = True


def _job_response(job) -> dict:
    return {
        "id": str(job.id),
        "agent": str(job.agent),
        "prompt": str(job.prompt),
        "status": str(job.status),
        "created_at": job.created_at.isoformat() if job.created_at else None,
        "result": job.result,
    }


@router.post("", status_code=status.HTTP_202_ACCEPTED)
async def create_job(payload: JobCreate):
    """Submit a new analysis job."""
    job = jm.create_job(payload.agent, payload.prompt, payload.params or {})
    return _job_response(job)


@router.get("")
async def list_jobs(status: Optional[str] = None):
    """List all jobs, optionally filtered by status."""
    jobs = jm.list_jobs(status=status) if status else jm.list_jobs()
    return [_job_response(j) for j in jobs]


@router.get("/stats")
async def job_stats():
    """Job statistics by status and agent."""
    try:
        from sqlalchemy import func
        from main.framework.models.database import SessionLocal
        from main.framework.models.job import Job

        db = SessionLocal()
        try:
            status_rows = db.query(Job.status, func.count(Job.id)).group_by(Job.status).all()
            by_status = {s: c for s, c in status_rows}
            agent_rows = db.query(Job.agent, func.count(Job.id)).group_by(Job.agent).all()
            by_agent = {a: c for a, c in agent_rows}
            total = sum(by_status.values())
            completed = by_status.get("completed", 0)
            failed = by_status.get("failed", 0)
            return {
                "total": total, "by_status": by_status, "by_agent": by_agent,
                "success_rate": round(completed / max(completed + failed, 1) * 100, 1),
            }
        finally:
            db.close()
    except Exception:
        return {"total": 0, "by_status": {}, "by_agent": {}, "success_rate": 0.0}


@router.get("/{job_id}")
async def get_job(job_id: str):
    """Get job status."""
    job = jm.get_job(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    return _job_response(job)


@router.get("/{job_id}/result")
async def get_job_result(job_id: str):
    """Get job result."""
    job = jm.get_job(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    if job.status not in ("completed", "failed"):
        raise HTTPException(status_code=400, detail="Job not yet completed")
    return {"status": job.status, "result": job.result}


@router.delete("/{job_id}")
async def cancel_job(job_id: str):
    """Cancel a job."""
    job = jm.get_job(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    jm.cancel_job(job_id)
    return {"message": "Job cancelled"}


def _parse_iso_dt(value: Optional[str]) -> Optional[datetime]:
    """Parse an ISO-8601 datetime string, returning None on failure."""
    if not value:
        return None
    try:
        # Handle both "Z" suffix and "+00:00"
        v = value.replace("Z", "+00:00") if value.endswith("Z") else value
        return datetime.fromisoformat(v)
    except ValueError:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid datetime format: {value}. Use ISO-8601.",
        )


@router.get("/{job_id}/logs")
async def get_job_logs(
    job_id: str,
    since: Optional[str] = Query(None, description="Start of time range (ISO-8601)"),
    until: Optional[str] = Query(None, description="End of time range (ISO-8601)"),
    level: Optional[str] = Query(
        None,
        description="Log level filter (DEBUG/INFO/WARNING/ERROR/CRITICAL)",
    ),
):
    """Get execution logs for a job."""
    job = jm.get_job(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")

    # Validate level parameter
    valid_levels = {"DEBUG", "INFO", "WARNING", "ERROR", "CRITICAL"}
    if level and level.upper() not in valid_levels:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid level: {level}. Must be one of {sorted(valid_levels)}.",
        )

    since_dt = _parse_iso_dt(since)
    until_dt = _parse_iso_dt(until)

    collector = get_log_collector()
    entries = collector.get_logs(
        job_id=job_id,
        since=since_dt,
        until=until_dt,
        level=level,
    )

    return {
        "job_id": job_id,
        "logs": [e.to_dict() for e in entries],
        "total": len(entries),
    }
