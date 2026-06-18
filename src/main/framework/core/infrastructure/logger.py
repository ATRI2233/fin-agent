"""Structured JSON logging — single entry point for the framework.

Every module in ``main.framework`` should obtain its logger via
:func:`get_logger` so the JSON formatter, stdout handler, and request-scoped
``request_id`` are wired up automatically.

Usage::

    from main.framework.core.infrastructure.logger import get_logger
    log = get_logger(__name__)
    log.info("hello")
    # -> {"timestamp": "...Z", "level": "INFO", "logger": "...", ...}
"""

from __future__ import annotations

import json
import logging
import sys
from collections.abc import MutableMapping
from datetime import UTC, datetime, timezone
from typing import Any

from main.framework.core.infrastructure.request_context import get_request_id

__all__ = ["JsonLogFormatter", "setup_logger", "get_logger"]


class JsonLogFormatter(logging.Formatter):
    """Emit one JSON object per record: timestamp, level, logger, message,
    request_id, module, line — plus ``exc_info`` only when present."""

    def format(self, record: logging.LogRecord) -> str:
        ts = datetime.now(UTC).isoformat()
        if ts.endswith("+00:00"):
            ts = ts[:-6] + "Z"
        payload: dict[str, Any] = {
            "timestamp": ts,
            "level": record.levelname,
            "logger": record.name,
            "message": record.getMessage(),
            "request_id": get_request_id(),
            "module": record.module,
            "line": record.lineno,
        }
        if record.exc_info:
            payload["exc_info"] = self.formatException(record.exc_info)
        return json.dumps(payload, ensure_ascii=False)


def setup_logger(name: str = "fin-agent-framework", level: int = logging.INFO) -> logging.Logger:
    """Configure ``name`` with the JSON formatter on stdout.

    Idempotent: existing handlers are dropped first so repeated calls do not
    duplicate output. ``propagate=False`` blocks the root logger from
    re-emitting the same records.
    """
    logger = logging.getLogger(name)
    logger.setLevel(level)
    logger.propagate = False
    for h in list(logger.handlers):
        logger.removeHandler(h)
    handler = logging.StreamHandler(sys.stdout)
    handler.setLevel(level)
    handler.setFormatter(JsonLogFormatter())
    logger.addHandler(handler)
    return logger


class _RequestIdAdapter(logging.LoggerAdapter):
    """LoggerAdapter that injects ``request_id`` from the request context."""

    def process(self, msg: Any, kwargs: MutableMapping[str, Any]) -> tuple[Any, MutableMapping[str, Any]]:
        # Honor an explicit caller-supplied request_id if any.
        extra = kwargs.setdefault("extra", {})
        extra.setdefault("request_id", get_request_id())
        return msg, kwargs


def get_logger(name: str) -> logging.LoggerAdapter:
    """Return a request-id-injecting adapter for ``name``.

    Ensures ``name`` is configured via :func:`setup_logger` (idempotent),
    then wraps it in :class:`_RequestIdAdapter`. Canonical entry point for
    framework modules::

        from main.framework.core.infrastructure.logger import get_logger
        log = get_logger(__name__)
    """
    setup_logger(name)
    return _RequestIdAdapter(logging.getLogger(name), {})
