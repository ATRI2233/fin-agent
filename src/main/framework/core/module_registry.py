"""Lightweight module registry for plug-and-play information modules.

Each module lives under ``main.modules.<name>`` and is a self-contained package
with its own database, ORM models, repository, service, schema, and API router.

Adding a new module (e.g. ``market_news``):
  1. Create ``main.modules.market_news`` package (copy portfolio as template).
  2. Call ``ModuleRegistry.register_module(app, container, market_news)`` in main.py.
  3. Add frontend routes in App.tsx.

No subclassing, no decorators, no filesystem scanning — explicit registration
keeps the framework predictable and easy to debug.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import TYPE_CHECKING, Callable

if TYPE_CHECKING:
    from fastapi import FastAPI

    # Avoid circular import — container only needed at type-check time
    from main.framework.core.infrastructure.container import Container


@dataclass
class ModuleInfo:
    """Metadata for one information module."""

    name: str # e.g. "portfolio"
    db_path: str # e.g. "data/portfolio.db"
    router_prefix: str # e.g. "/api/v1/modules/portfolio"
    page_path: str # e.g. "/modules/portfolio"
    # Callable that returns the FastAPI router for this module.
    # Signature: () -> APIRouter
    get_router: Callable = field(default=None)
    # Optional db-session dependency for the router (FastAPI Depends).
    get_db: Callable = field(default=None)


class ModuleRegistry:
    """Central registry for information modules."""

    _modules: dict[str, ModuleInfo] = {}

    @classmethod
    def register(cls, info: ModuleInfo) -> None:
        cls._modules[info.name] = info

    @classmethod
    def get(cls, name: str) -> ModuleInfo | None:
        return cls._modules.get(name)

    @classmethod
    def list(cls) -> list[ModuleInfo]:
        return list(cls._modules.values())

    @classmethod
    def register_module(cls, app: "FastAPI", container: "Container", *, name: str) -> None:
        """Load a registered module's router and mount it on the FastAPI app.

        Called once at startup for each module.
        """
        info = cls._modules.get(name)
        if info is None:
            raise ValueError(f"Module '{name}' is not registered in ModuleRegistry")

        router = info.get_router()
        if router is None:
            raise ValueError(f"Module '{name}' has no router (get_router returned None)")

        dependencies = []
        if info.get_db:
            from fastapi import Depends

            dependencies = [Depends(info.get_db)]

        app.include_router(router, prefix=info.router_prefix, dependencies=dependencies)
