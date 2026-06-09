# DEPRECATED: Use main.framework.config.settings instead. Kept for backward compat.
import os
from pathlib import Path

from pydantic_settings import BaseSettings

from main.framework.config.settings import Settings, _find_opencode_bin, settings  # noqa: F401


def _find_opencode_bin() -> str:
    """Auto-detect opencode binary path."""
    candidates = [
        os.path.join("agents", "opencode", "node_modules", "opencode-ai", "bin", "opencode.exe"),
        os.path.join("agents", "opencode", "node_modules", "opencode-ai", "bin", "opencode"),
        os.path.join("agents", "opencode", "node_modules", ".bin", "opencode.exe"),
        os.path.join("agents", "opencode", "node_modules", ".bin", "opencode"),
    ]
    for c in candidates:
        if os.path.isfile(c):
            return os.path.abspath(c)
    return "opencode"


class Settings(BaseSettings):
    """Framework settings."""

    OPENCODE_BIN: str = ""
    DATABASE_URL: str = "sqlite:///./data/finagent.db"
    API_PORT: int = 8000
    JOB_TIMEOUT: int = 300
    MAX_CONCURRENT_JOBS: int = 10
    MAX_CONCURRENT_SESSIONS: int = 10
    MAX_CONCURRENT_NODES: int = 5
    NODE_TIMEOUT_SECONDS: int = 300
    API_KEY: str = ""

    class Config:
        env_prefix = "FIN_AGENT_"


settings = Settings()

# Auto-detect opencode binary if not set
if not settings.OPENCODE_BIN:
    settings.OPENCODE_BIN = _find_opencode_bin()
