from main.framework.models.database import SessionLocal, init_db
from main.framework.models.job import Job
from main.framework.core.agent_registry import registry
import uuid
from datetime import datetime
from typing import Optional


class JobManager:
    def __init__(self):
        init_db()

    def create_job(self, agent: str, prompt: str, params: Optional[dict] = None) -> Job:
        job = Job(
            id=str(uuid.uuid4()),
            agent=agent,
            prompt=prompt,
            status="pending",
            params=params or {},
            created_at=datetime.utcnow(),
            updated_at=datetime.utcnow(),
            timeout=300,
        )
        db = SessionLocal()
        try:
            db.add(job)
            db.commit()
            db.refresh(job)
        finally:
            db.close()
        return job

    def get_job(self, job_id: str) -> Optional[Job]:
        db = SessionLocal()
        try:
            return db.query(Job).filter(Job.id == job_id).first()
        finally:
            db.close()

    def list_jobs(self, status: Optional[str] = None, limit: int = 100) -> list:
        db = SessionLocal()
        try:
            query = db.query(Job).order_by(Job.created_at.desc())
            if status:
                query = query.filter(Job.status == status)
            return query.limit(limit).all()
        finally:
            db.close()

    def update_job(self, job_id: str, **kwargs):
        db = SessionLocal()
        try:
            job = db.query(Job).filter(Job.id == job_id).first()
            if job:
                for key, value in kwargs.items():
                    if hasattr(job, key):
                        setattr(job, key, value)
                job.updated_at = datetime.utcnow()
                db.commit()
        finally:
            db.close()

    def complete_job(self, job_id: str, result: dict):
        self.update_job(job_id, status="completed", result=result)

    def fail_job(self, job_id: str, error: str):
        self.update_job(job_id, status="failed", result={"error": error})

    def cancel_job(self, job_id: str):
        self.update_job(job_id, status="cancelled")
