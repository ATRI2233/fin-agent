"""Shim: re-export for backward compatibility. Canonical location: main.framework.services.core.message_processor"""

from main.framework.services.core.message_processor import (  # noqa: F401
    execute_workflow_async,
    process_agent_message,
)
