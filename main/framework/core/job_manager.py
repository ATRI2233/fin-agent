"""Job manager — thin wrapper over JobRepository for backward compatibility."""

from __future__ import annotations

from typing import Optional

from main.framework.models.database import init_db
from main.framework.models.job import Job
from main.framework.repositories.job_repo import JobRepository


class JobManager:
    """Backward-compatible facade over JobRepository."""

    def __init__(self):
        init_db()
        self._repo = JobRepository()

    def create_job(self, agent: str, prompt: str, params: Optional[dict] = None) -> Job:
        return self._repo.create_job(
            agent, prompt, params=params or {}, timeout=300
        )

    def get_job(self, job_id: str) -> Optional[Job]:
        return self._repo.get_job(job_id)

    def list_jobs(self, status: Optional[str] = None, limit: int = 100) -> list:
        return self._repo.list_jobs(status=status, limit=limit)

    def update_job(self, job_id: str, **kwargs):
        self._repo.update_job(job_id, **kwargs)

    def complete_job(self, job_id: str, result: dict):
        self._repo.complete_job(job_id, result)

    def fail_job(self, job_id: str, error: str):
        self._repo.fail_job(job_id, error)

    def cancel_job(self, job_id: str):
        self._repo.cancel_job(job_id)
