"""Shared base models and database for cross-module data (e.g. stocks).

All modules reference shared.stocks. The shared DB lives in finagent.db
(the main framework database) so it is co-located and transactionally
consistent with framework tables — no extra file or connection needed.
"""

from __future__ import annotations

from datetime import UTC, datetime

from sqlalchemy import Column, DateTime, Integer, String, create_engine
from sqlalchemy.orm import declarative_base, sessionmaker

# Re-use the framework's database connection (finagent.db) so stocks table
# is in the same DB as the rest of the framework, avoiding cross-DB joins.
# If a separate shared.db is ever needed, swap _engine here.
from main.framework.config.database import engine as _framework_engine
from main.framework.config.database import SessionLocal as _framework_session

SharedBase = declarative_base()
SharedBase.metadata.bind = _framework_engine


class Stock(SharedBase):
    """Shared stock reference table.

    All information modules (portfolio, market_news, ...) reference stocks
    through this table rather than duplicating symbol/name in each module DB.
    """

    __tablename__ = "stocks"

    id = Column(Integer, primary_key=True, autoincrement=True)
    symbol = Column(String(20), unique=True, nullable=False, index=True)
    name = Column(String(100), nullable=True)
    market = Column(String(10), nullable=True)  # A股 / 美股 / 港股 / ...
    currency = Column(String(10), default="CNY")
    created_at = Column(DateTime, default=lambda: datetime.now(UTC))

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "symbol": self.symbol,
            "name": self.name,
            "market": self.market,
            "currency": self.currency,
            "created_at": self.created_at.isoformat() if self.created_at else None,
        }


def get_shared_session():
    """Return a session for shared DB operations (just Stock)."""
    return _framework_session()


def init_shared_db():
    """Create the stocks table if it doesn't exist."""
    SharedBase.metadata.create_all(bind=_framework_engine)
