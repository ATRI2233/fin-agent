"""Repository for job persistence."""

from __future__ import annotations

import uuid
from typing import Any

from datetime import datetime, timezone

from main.framework.models.database import SessionLocal
from main.framework.models.job import Job


class JobRepository:
    """Encapsulates all DB operations for Job."""

    def __init__(self, session_factory=SessionLocal):
        self._sf = session_factory

    def create_job(
        self, agent: str, prompt: str, **kwargs: Any
    ) -> Job:
        with self._sf() as db:
            job = Job(
                id=str(uuid.uuid4()),
                agent=agent,
                prompt=prompt,
                **kwargs,
            )
            db.add(job)
            db.commit()
            db.refresh(job)
            return job

    def get_job(self, job_id: str) -> Job | None:
        with self._sf() as db:
            return db.query(Job).get(job_id)

    def list_jobs(self, status: str | None = None, limit: int = 100) -> list[Job]:
        with self._sf() as db:
            q = db.query(Job)
            if status:
                q = q.filter(Job.status == status)
            return q.order_by(Job.created_at.desc()).limit(limit).all()

    def update_job(self, job_id: str, **kwargs: Any) -> None:
        with self._sf() as db:
            job = db.query(Job).get(job_id)
            if job:
                for k, v in kwargs.items():
                    setattr(job, k, v)
                db.commit()

    def complete_job(self, job_id: str, result: dict) -> None:
        self.update_job(job_id, status="completed", result=result)

    def fail_job(self, job_id: str, error: str) -> None:
        self.update_job(
            job_id, status="failed", result={"error": error}
        )

    def cancel_job(self, job_id: str) -> None:
        self.update_job(job_id, status="cancelled")
