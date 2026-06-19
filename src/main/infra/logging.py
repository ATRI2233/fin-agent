"""Structured JSON logging via structlog.

Provides ``configure_logging()`` to initialize structlog with JSON (or console)
output, automatically merging ``trace_id`` from the tracing context variable
(see :mod:`src.main.infra.tracing`) and any key-value pairs bound via
:func:`structlog.contextvars.bind_contextvars`.
"""

from __future__ import annotations

import logging
import sys
from typing import Any

import structlog

from src.main.infra.settings import Settings
from src.main.infra.tracing import current_trace_id


# ── 自定义 processor ──


def _add_trace_id(
    logger: structlog.stdlib.BoundLogger,
    method_name: str,
    event_dict: dict[str, Any],
) -> dict[str, Any]:
    """Inject the current trace_id from :func:`current_trace_id` into every
    log event, unless a non-default value was already provided by
    ``structlog.contextvars.bind_contextvars``."""
    tid = current_trace_id()
    if tid != "tr-unbound":
        event_dict.setdefault("trace_id", tid)
    return event_dict


# ── 公开 API ──


def configure_logging(settings: Settings) -> None:
    """Initialize structlog and stdlib logging.

    Configures the root logger level from ``settings.LOG_LEVEL``, sets up
    structlog's processor chain with JSON (or console) rendering, and
    connects structlog to stdout via ``PrintLoggerFactory``.

    Processor chain (in order):

    1. ``merge_contextvars``
       — consume values bound via ``structlog.contextvars.bind_contextvars``
    2. ``_add_trace_id``
       — inject ``trace_id`` from the :mod:`tracing` module's context variable
    3. ``add_log_level``
       — add the ``level`` key
    4. ``TimeStamper(fmt="iso", utc=True)``
       — add an ISO-8601 ``timestamp`` in UTC
    5. ``StackInfoRenderer``
       — render stack info when present
    6. ``format_exc_info``
       — format exception info when present
    7. ``JSONRenderer`` (default) / ``ConsoleRenderer`` (when
       ``settings.LOG_FORMAT == "console"``)
    """
    # ── stdlib root logger ──
    log_level = getattr(logging, settings.LOG_LEVEL.upper(), logging.INFO)
    logging.basicConfig(
        format="%(message)s",
        stream=sys.stdout,
        level=log_level,
    )

    # ── structlog processor chain ──
    shared_processors: list[structlog.types.Processor] = [
        structlog.contextvars.merge_contextvars,
        _add_trace_id,
        structlog.processors.add_log_level,
        structlog.processors.TimeStamper(fmt="iso", utc=True),
    ]

    if settings.LOG_FORMAT == "console":
        renderer: structlog.types.Processor = structlog.dev.ConsoleRenderer()
    else:
        renderer = structlog.processors.JSONRenderer()

    structlog.configure(
        processors=shared_processors
        + [
            structlog.processors.StackInfoRenderer(),
            structlog.processors.format_exc_info,
            renderer,
        ],
        wrapper_class=structlog.stdlib.BoundLogger,
        context_class=dict,
        logger_factory=structlog.PrintLoggerFactory(),
        cache_logger_on_first_use=True,
    )


def get_logger(name: str) -> structlog.stdlib.BoundLogger:
    """Return a structlog logger bound with *name*.

    Usage::

        log = get_logger(__name__)
        log.info("user_action", user_id=42, action="login")
    """
    return structlog.get_logger(name)
