import asyncio
import logging
import threading
import time
from typing import Optional

from main.framework.config import Settings

settings = Settings()
from main.framework.core.hapi_bridge import HAPIBridge
from main.framework.core.job_manager import JobManager
from main.framework.core.log_collector import current_job_id

logger = logging.getLogger(__name__)


class JobExecutor:
    def __init__(self):
        self.jm = JobManager()
        self.hapi = HAPIBridge(settings.HAPI_HUB_URL, settings.HAPI_API_TOKEN)
        self._running = False
        self._thread: Optional[threading.Thread] = None

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

    def _worker_loop(self):
        while self._running:
            try:
                jobs = self.jm.list_jobs(status="pending", limit=10)
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
            self.jm.update_job(job.id, status="running")
            logger.info(f"Executing job {job.id} with agent {job.agent}")
            timeout = job.timeout if hasattr(job, "timeout") and job.timeout else 300
            loop = asyncio.new_event_loop()
            try:
                result = loop.run_until_complete(
                    self.dispatch_to_agent(job.agent, job.prompt, job.id, timeout)
                )
            finally:
                loop.close()
            self.jm.complete_job(job.id, result)
            logger.info(f"Job {job.id} completed")
        except Exception as e:
            logger.error(f"Job {job.id} failed: {e}")
            self.jm.fail_job(job.id, str(e))
        finally:
            current_job_id.reset(token)

    async def dispatch_to_agent(self, agent, prompt, job_id, timeout=300):
        session_id = await self.hapi.create_session(agent="opencode")
        try:
            # Clear instruction to dispatch to specific agent
            agent_prompt = f"Use task(subagent_type=\"{agent}\", prompt=\"{prompt}\") to get answer. Do not answer yourself."
            await self.hapi.send_message(session_id, agent_prompt)
            raw = await self.hapi.wait_for_completion(session_id, timeout=timeout)
            return self.parse_response(raw)
        finally:
            await self.hapi.abort_session(session_id)

    def parse_response(self, raw):
        try:
            import json
            return json.loads(raw)
        except Exception:
            return {"result": raw, "parsed": False}