"""Configuration management — single source of truth for all environment variables,
paths, ports, timeouts, and retry counts.

All business code must read configuration through this module, never via
``os.environ`` or hardcoded literals.
"""

from __future__ import annotations

from pathlib import Path
from typing import Literal

from pydantic_settings import BaseSettings, SettingsConfigDict

from src.main.infra.errors import ConfigError


class Settings(BaseSettings):
    # ── HTTP ──
    API_HOST: str = "127.0.0.1"
    API_PORT: int = 8000

    # ── Database ──
    DATABASE_URL: str = "sqlite:///./data/finagent.db"
    DB_POOL_SIZE: int = 5
    DB_BUSY_TIMEOUT_MS: int = 30000
    DB_JOURNAL_MODE: Literal["WAL", "DELETE"] = "WAL"

    # ── Opencode ──
    OPENCODE_BIN: str = ""
    OPENCODE_SERVE_HOST: str = "127.0.0.1"
    OPENCODE_SERVE_PORT: int = 4096
    OPENCODE_AGENTS_DIR: Path = Path(".opencode/agents")
    OPENCODE_MCP_CONFIG: Path = Path(".opencode/opencode.json")

    # ── Workflow ──
    NODE_TIMEOUT_SECONDS: float = 600.0
    MAX_PARALLEL_NODES: int = 5
    POLL_INTERVAL_SECONDS: float = 0.5
    PREDECESSOR_WAIT_TIMEOUT_SECONDS: float = 600.0

    # ── Retry ──
    MAX_AGENT_RETRIES: int = 3
    RETRY_BASE_DELAY_SECONDS: float = 1.0
    RETRY_BACKOFF_FACTOR: float = 2.0
    CIRCUIT_BREAKER_THRESHOLD: int = 5

    # ── Tracing ──
    TRACE_ID_HEADER: str = "X-Trace-Id"
    TRACE_ID_ENV_VAR: str = "FIN_AGENT_TRACE_ID"

    # ── Auth ──
    API_KEY: str = ""
    AUTH_SKIP_LOCALHOST: bool = False

    # ── Logging ──
    LOG_LEVEL: Literal["DEBUG", "INFO", "WARNING", "ERROR"] = "INFO"
    LOG_FORMAT: Literal["json", "console"] = "json"

    model_config = SettingsConfigDict(
        env_prefix="FIN_AGENT_",
        env_file=".env",
    )

    @property
    def opencode_serve_url(self) -> str:
        return f"http://{self.OPENCODE_SERVE_HOST}:{self.OPENCODE_SERVE_PORT}"

    def validate(self) -> None:
        """启动时一致性校验。任何错误抛 ConfigError。"""
        if self.OPENCODE_SERVE_PORT == self.API_PORT:
            raise ConfigError(
                "OPENCODE_SERVE_PORT must differ from API_PORT",
                details={
                    "OPENCODE_SERVE_PORT": self.OPENCODE_SERVE_PORT,
                    "API_PORT": self.API_PORT,
                },
            )
        if not self.OPENCODE_AGENTS_DIR.is_dir():
            raise ConfigError(
                f"OPENCODE_AGENTS_DIR not found: {self.OPENCODE_AGENTS_DIR}",
                details={"path": str(self.OPENCODE_AGENTS_DIR)},
            )
        if not self.OPENCODE_MCP_CONFIG.is_file():
            raise ConfigError(
                f"OPENCODE_MCP_CONFIG not found: {self.OPENCODE_MCP_CONFIG}",
                details={"path": str(self.OPENCODE_MCP_CONFIG)},
            )
        if self.DB_POOL_SIZE < self.MAX_PARALLEL_NODES:
            raise ConfigError(
                "DB_POOL_SIZE must be >= MAX_PARALLEL_NODES",
                details={
                    "DB_POOL_SIZE": self.DB_POOL_SIZE,
                    "MAX_PARALLEL_NODES": self.MAX_PARALLEL_NODES,
                },
            )


settings = Settings()
