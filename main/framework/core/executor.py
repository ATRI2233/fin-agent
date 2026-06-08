"""Background job executor — polls for pending jobs and dispatches to agents."""

from __future__ import annotations

import asyncio
import logging
import threading
import time
from typing import Optional

from main.framework.core.agent_dispatcher import AgentDispatcher
from main.framework.core.job_manager import JobManager
from main.framework.core.log_collector import current_job_id
from main.framework.core.protocols import AgentBackend, JobStore

logger = logging.getLogger(__name__)


class JobExecutor:
    """Polls the job queue and dispatches work via AgentDispatcher."""

    def __init__(
        self,
        dispatcher: AgentDispatcher,
        job_store: JobStore | None = None,
    ):
        self._dispatcher = dispatcher
        self._job_store: JobStore = job_store or JobManager()
        self._running = False
        self._thread: Optional[threading.Thread] = None

    # ------------------------------------------------------------------
    # Lifecycle
    # ------------------------------------------------------------------

    def start(self):
        if self._running:
            return
        self._running = True
        self._thread = threading.Thread(target=self._worker_loop, daemon=True)
        self._thread.start()
        logger.info("JobExecutor started")

    def stop(self):
        self._running = False
        if self._thread:
            self._thread.join(timeout=5)
        logger.info("JobExecutor stopped")

    # ------------------------------------------------------------------
    # Worker
    # ------------------------------------------------------------------

    def _worker_loop(self):
        while self._running:
            try:
                jobs = self._job_store.list_jobs(status="pending", limit=10)
                for job in jobs:
                    if not self._running:
                        break
                    self._execute_job_sync(job)
                time.sleep(2)
            except Exception as e:
                logger.error(f"Worker loop error: {e}")
                time.sleep(5)

    def _execute_job_sync(self, job):
        token = current_job_id.set(job.id)
        try:
            self._job_store.update_job(job.id, status="running")
            logger.info(f"Executing job {job.id} with agent {job.agent}")
            timeout = getattr(job, "timeout", None) or 300

            loop = asyncio.new_event_loop()
            try:
                result = loop.run_until_complete(
                    self._dispatcher.dispatch(
                        job.agent, job.prompt, timeout=timeout
                    )
                )
            finally:
                loop.close()

            self._job_store.complete_job(job.id, result)
            logger.info(f"Job {job.id} completed")
        except Exception as e:
            logger.error(f"Job {job.id} failed: {e}")
            self._job_store.fail_job(job.id, str(e))
        finally:
            current_job_id.reset(token)
