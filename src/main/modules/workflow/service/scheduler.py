"""工作流调度器(Phase 3 TASK-310)。

本模块实现 ``WorkflowScheduler``,基于 APScheduler 的 ``AsyncIOScheduler``
对工作流执行做定时触发。

**设计要点**:

1. **AsyncIOScheduler**:基于 asyncio 事件循环的调度器,适配 FastAPI
   异步生态;与 ``WorkflowRunner.run()`` 的 async 契约一致。

2. **Cron 触发**:支持标准 cron 表达式调度工作流;``params`` 透传给
   ``WorkflowRunner.run()``。

3. **trace_id 贯穿**:每次 fire 携带原始 trace_id(用于审计/追踪)。

4. **生命周期管理**:``start()`` / ``stop()`` 控制调度器启停。

Do Not:
    - Do Not #1: 禁止跨模块 ``from X import _xxx``。
    - Do Not #3: 不吞异常;调度失败必须向上抛或转 ``FinAgentError``。
    - Do Not #12: 不在 FastAPI app.state 持有调度器;由 DI Registry 管理。
"""

from __future__ import annotations

import logging
from typing import Any

from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.cron import CronTrigger

from src.main.infra.domain import TraceId, WorkflowId
from src.main.infra.settings import Settings
from src.main.modules.workflow.protocol import WorkflowRunner

logger = logging.getLogger(__name__)


class WorkflowScheduler:
    """工作流调度器(APScheduler ``AsyncIOScheduler`` 包装)。

    Args:
        runner: 工作流执行入口(``WorkflowRunner``);``_fire`` 回调通过
            ``runner.run(workflow_id, params, trace_id)`` 触发执行。
        settings: 全局配置。
    """

    def __init__(self, runner: WorkflowRunner, settings: Settings) -> None:
        self._runner = runner
        self._settings = settings
        self._scheduler: AsyncIOScheduler = AsyncIOScheduler()

    def schedule_workflow(
        self,
        workflow_id: WorkflowId,
        cron: str,
        params: dict[str, Any],
        trace_id: TraceId,
    ) -> None:
        """按 cron 表达式调度工作流。

        Args:
            workflow_id: 工作流 ID。
            cron: 标准 5/6 字段 cron 表达式(``"*/5 * * * *"`` = 每 5 分钟)。
            params: 触发参数(payload),透传给 ``WorkflowRunner.run()``。
            trace_id: 审计/追踪 ID,贯穿每次 fire。
        """
        trigger = CronTrigger.from_crontab(cron)
        self._scheduler.add_job(
            self._fire,
            trigger=trigger,
            args=[workflow_id, params, trace_id],
            id=f"workflow-{workflow_id}",
            replace_existing=True,
        )
        logger.info(
            "Scheduled workflow_id=%s cron=%s trace_id=%s",
            workflow_id,
            cron,
            trace_id,
        )

    async def _fire(
        self,
        workflow_id: WorkflowId,
        params: dict[str, Any],
        trace_id: TraceId,
    ) -> None:
        """调度器回调:触发 ``WorkflowRunner.run()``。

        Args:
            workflow_id: 工作流 ID。
            params: 触发参数(payload)。
            trace_id: 审计/追踪 ID。
        """
        logger.info(
            "Firing scheduled workflow_id=%s trace_id=%s",
            workflow_id,
            trace_id,
        )
        await self._runner.run(workflow_id, params, trace_id=trace_id)

    def start(self) -> None:
        """启动调度器。"""
        if not self._scheduler.running:
            self._scheduler.start()
            logger.info("WorkflowScheduler started")

    def stop(self) -> None:
        """停止调度器。"""
        if self._scheduler.running:
            self._scheduler.shutdown(wait=False)
            logger.info("WorkflowScheduler stopped")
