"""Workflow API schemas — request models for the workflow controller.

All Pydantic V2 models (Pydantic 2.10+ in this repo). Extracted from
``controllers/workflows.py`` in of the Phase 5 directory reorg
as part of the schema/transport separation. Class bodies are preserved
verbatim — no field renames, type changes, or new validators.

Three request models live here:

* ``WorkflowCreate`` — body for ``POST /api/v1/workflows``
* ``WorkflowUpdate`` — body for ``PUT /api/v1/workflows/{id}``
* ``WorkflowTrigger`` — body for ``POST /api/v1/workflows/{id}/trigger``

The ``str | None`` union syntax is enabled by ``from __future__ import
annotations`` so the file parses cleanly on every supported interpreter.
"""

from __future__ import annotations

from pydantic import BaseModel

# ---------------------------------------------------------------------------
# Request models
# ---------------------------------------------------------------------------


class WorkflowCreate(BaseModel):
    name: str
    description: str | None = None
    nodes: list[dict] = []
    edges: list[dict] = []
    trigger_type: str | None = "manual"
    config: dict | None = {}


class WorkflowUpdate(BaseModel):
    name: str | None = None
    description: str | None = None
    nodes: list[dict] | None = None
    edges: list[dict] | None = None
    trigger_type: str | None = None
    config: dict | None = None


class WorkflowTrigger(BaseModel):
    params: dict | None = {}
