from fastapi import APIRouter, HTTPException

router = APIRouter(prefix="/api/v1/tools", tags=["tools"])

TOOLS = [
    {
        "name": "market-snapshot",
        "description": "Get current market snapshot",
        "server": "fin-agent-mcp-server",
    },
    {
        "name": "fred-search",
        "description": "Search FRED economic data",
        "server": "fred",
    },
    {
        "name": "fred-series",
        "description": "Get FRED time series data",
        "server": "fred",
    },
    {
        "name": "fred-browse",
        "description": "Browse FRED economic data",
        "server": "fred",
    },
    {
        "name": "sector-rotation",
        "description": "Analyze sector rotation",
        "server": "fin-agent-mcp-server",
    },
    {
        "name": "news-sentiment",
        "description": "News sentiment analysis",
        "server": "fin-agent-mcp-server",
    },
    {
        "name": "technical-levels",
        "description": "Technical analysis levels",
        "server": "fin-agent-mcp-server",
    },
    {
        "name": "fundamental-scan",
        "description": "Fundamental analysis scan",
        "server": "fin-agent-mcp-server",
    },
    {
        "name": "analyst-ratings",
        "description": "Analyst ratings",
        "server": "fin-agent-mcp-server",
    },
    {"name": "risk-gauge", "description": "Risk assessment gauge", "server": "risk"},
    {"name": "position-sizing", "description": "Position sizing", "server": "risk"},
    {
        "name": "institutional-flow",
        "description": "Institutional flow analysis",
        "server": "risk",
    },
    {
        "name": "insider-trading",
        "description": "Insider trading tracking",
        "server": "fin-agent-mcp-server",
    },
    {
        "name": "options-greeks",
        "description": "Options Greeks calculation",
        "server": "fin-agent-mcp-server",
    },
    {
        "name": "earnings-calendar",
        "description": "Earnings calendar",
        "server": "fin-agent-mcp-server",
    },
    {"name": "sec-filings", "description": "SEC filings", "server": "sec-edgar"},
    {
        "name": "signal-fusion",
        "description": "Multi-signal fusion",
        "server": "fin-agent-mcp-server",
    },
    {
        "name": "consistency-check",
        "description": "Signal consistency check",
        "server": "fin-agent-mcp-server",
    },
    {
        "name": "fear-greed-index",
        "description": "Fear and greed index",
        "server": "fin-agent-mcp-server",
    },
    {
        "name": "commodity-prices",
        "description": "Commodity prices",
        "server": "fin-agent-mcp-server",
    },
]


@router.get("")
async def list_tools():
    return TOOLS


@router.get("/{name}/invoke")
async def invoke_tool(name: str, **kwargs):
    return {"error": "Direct tool invocation not implemented in v1", "name": name}


@router.get("/{name}")
async def get_tool(name: str):
    for t in TOOLS:
        if t["name"] == name:
            return t
    raise HTTPException(status_code=404, detail="Tool not found")
