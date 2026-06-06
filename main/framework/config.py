from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    """Framework settings."""

    HAPI_HUB_URL: str = "http://localhost:3006"
    HAPI_API_TOKEN: str = ""
    DATABASE_URL: str = "sqlite:///./data/finagent.db"
    API_PORT: int = 8000
    JOB_TIMEOUT: int = 300
    MAX_CONCURRENT_JOBS: int = 10
    MAX_CONCURRENT_HAPI_SESSIONS: int = 10
    MAX_CONCURRENT_NODES: int = 5
    NODE_TIMEOUT_SECONDS: int = 300
    API_KEY: str = ""  # Empty = no auth required

    class Config:
        env_prefix = "FIN_AGENT_"


settings = Settings()
