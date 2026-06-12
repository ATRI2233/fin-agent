"""ashare MCP tools — individual tool implementations.

Each module exposes one or more `get_*` functions that return dicts.
"""

from .quote import get_quote
from .technical import get_technical_levels
from .fundamental import get_fundamental_scan
from .sentiment import get_news_sentiment
from .market import get_market_snapshot, get_market_breadth, get_sector_rotation
from .fund_flow import get_fund_flow, get_fund_flow_real
from .lhb import get_lhb

__all__ = [
    "get_quote",
    "get_technical_levels",
    "get_fundamental_scan",
    "get_news_sentiment",
    "get_market_snapshot",
    "get_market_breadth",
    "get_sector_rotation",
    "get_fund_flow",
    "get_fund_flow_real",
    "get_lhb",
]
