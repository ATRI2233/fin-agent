"""Pydantic request schemas for the scheduler HTTP routes.

These models were extracted from ``controllers/scheduler.py`` as part of the
Phase 5 directory reorganization (Wave 3, Task 12). They describe the shape
of requests accepted by:

  POST /api/v1/workflows/{workflow_id}/schedule
"""

from __future__ import annotations

from pydantic import BaseModel


class ScheduleRequest(BaseModel):
    cron_expression: str
