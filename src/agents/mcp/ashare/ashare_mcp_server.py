#!/usr/bin/env python3
"""ashare-mcp-server — A 股数据 MCP Server，使用 akshare 提供行情/技术面/基本面/新闻数据.

This is the MCP protocol entry point. Tool implementations live in tools/.
"""

import json
import logging
import os
import sys

# Ensure project root is on sys.path for absolute imports
_PROJECT_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", ".."))
if _PROJECT_ROOT not in sys.path:
    sys.path.insert(0, _PROJECT_ROOT)

logger = logging.getLogger(__name__)

# Tool implementations
from agents.mcp.ashare.tools import (
    get_quote,
    get_technical_levels,
    get_fundamental_scan,
    get_news_sentiment,
    get_market_snapshot,
    get_fund_flow,
    get_lhb,
    get_sector_rotation,
    get_fund_flow_real,
    get_market_breadth,
    stock_lookup,
)

# ─── MCP Tool Definitions ────────────────────────────────────────────

TOOLS = [
    {
        "name": "ashare_stock_lookup",
        "description": "根据股票名称查询A股代码（必须在调用其他ashare工具前使用，确保代码正确）",
        "inputSchema": {
            "type": "object",
            "properties": {"name": {"type": "string", "description": "股票名称，如 招商南油、贵州茅台"}},
            "required": ["name"],
        },
    },
    {
        "name": "ashare_quote",
        "description": "获取 A 股实时行情：价格/涨跌幅/成交量/涨跌额等",
        "inputSchema": {
            "type": "object",
            "properties": {"symbol": {"type": "string", "description": "A 股代码，如 600318 或 603318"}},
            "required": ["symbol"],
        },
    },
    {
        "name": "ashare_technical_levels",
        "description": "获取 A 股技术指标：RSI/EMA/布林带/MACD/枢轴点/波动率",
        "inputSchema": {
            "type": "object",
            "properties": {"symbol": {"type": "string", "description": "A 股代码，如 600318 或 603318"}},
            "required": ["symbol"],
        },
    },
    {
        "name": "ashare_fundamental_scan",
        "description": "获取 A 股基本面：ROE/净利润/营收/PE/PB/每股收益/股息率/资产负债率/流动比率/毛利率/营业利润率/同比增速",
        "inputSchema": {
            "type": "object",
            "properties": {"symbol": {"type": "string", "description": "A 股代码，如 600318 或 603318"}},
            "required": ["symbol"],
        },
    },
    {
        "name": "ashare_news_sentiment",
        "description": "获取 A 股新闻及情绪评分",
        "inputSchema": {
            "type": "object",
            "properties": {"symbol": {"type": "string", "description": "A 股代码，如 600318 或 603318"}},
            "required": ["symbol"],
        },
    },
    {
        "name": "ashare_market_snapshot",
        "description": "获取 A 股大盘指数（上证/深证/创业板/沪深300/科创50等）",
        "inputSchema": {"type": "object", "properties": {}},
    },
    {
        "name": "ashare_fund_flow",
        "description": "获取 A 股个股资金流向（超大单/大单/中单/小单净流入）",
        "inputSchema": {
            "type": "object",
            "properties": {"symbol": {"type": "string", "description": "A 股代码，如 600318 或 603318"}},
            "required": ["symbol"],
        },
    },
    {
        "name": "ashare_lhb",
        "description": "获取龙虎榜数据（最近上榜股票）",
        "inputSchema": {
            "type": "object",
            "properties": {"date": {"type": "string", "description": "日期，格式 YYYYMMDD，如 20250125"}},
        },
    },
    {
        "name": "ashare_sector_rotation",
        "description": "获取 A 股板块轮动分析：行业板块涨跌幅排名、动量信号、轮入/轮出板块",
        "inputSchema": {
            "type": "object",
            "properties": {
                "period": {
                    "type": "string",
                    "description": "分析周期：近1日/近5日/近10日/近20日",
                    "enum": ["近1日", "近5日", "近10日", "近20日"],
                    "default": "近5日",
                },
            },
        },
    },
    {
        "name": "ashare_fund_flow_real",
        "description": "获取 A 股个股实时资金流向：主力/超大单/大单/中单/小单 净流入与净占比",
        "inputSchema": {
            "type": "object",
            "properties": {"symbol": {"type": "string", "description": "A 股代码，如 600318 或 603318"}},
            "required": ["symbol"],
        },
    },
    {
        "name": "ashare_market_breadth",
        "description": "获取 A 股市场广度：涨跌家数、涨停/跌停家数、涨跌家数比、市场情绪",
        "inputSchema": {"type": "object", "properties": {}},
    },
]

# ─── Tool dispatch map ───────────────────────────────────────────────

TOOL_DISPATCH = {
    "ashare_stock_lookup": lambda args: stock_lookup(args.get("name", "")),
    "ashare_quote": lambda args: get_quote(args.get("symbol", "")),
    "ashare_technical_levels": lambda args: get_technical_levels(args.get("symbol", "")),
    "ashare_fundamental_scan": lambda args: get_fundamental_scan(args.get("symbol", "")),
    "ashare_news_sentiment": lambda args: get_news_sentiment(args.get("symbol", "")),
    "ashare_market_snapshot": lambda args: get_market_snapshot(),
    "ashare_fund_flow": lambda args: get_fund_flow(args.get("symbol", "")),
    "ashare_lhb": lambda args: get_lhb(args.get("date")),
    "ashare_sector_rotation": lambda args: get_sector_rotation(args.get("period", "近5日")),
    "ashare_fund_flow_real": lambda args: get_fund_flow_real(args.get("symbol", "")),
    "ashare_market_breadth": lambda args: get_market_breadth(),
}

TOOLS_REQUIRING_SYMBOL = {
    "ashare_quote", "ashare_technical_levels", "ashare_fundamental_scan",
    "ashare_news_sentiment", "ashare_fund_flow", "ashare_fund_flow_real",
}

# ─── MCP Protocol Handler ────────────────────────────────────────────


def handle_request(req):
    method = req.get("method", "")
    params = req.get("params", {})
    req_id = req.get("id")

    if method == "initialize":
        return {
            "jsonrpc": "2.0",
            "result": {
                "protocolVersion": "2024-11-05",
                "capabilities": {"tools": {}},
                "serverInfo": {"name": "ashare-mcp-server", "version": "1.0.0"},
            },
            "id": req_id,
        }

    if method == "notifications/initialized":
        return None

    if method == "tools/list":
        return {"jsonrpc": "2.0", "result": {"tools": TOOLS}, "id": req_id}

    if method == "tools/call":
        name = params.get("name", "")
        args = params.get("arguments", {})
        symbol = args.get("symbol", "").strip()

        if name in TOOLS_REQUIRING_SYMBOL and not symbol:
            return {"jsonrpc": "2.0", "error": {"code": -32603, "message": "缺少 symbol"}, "id": req_id}

        handler = TOOL_DISPATCH.get(name)
        if not handler:
            return {"jsonrpc": "2.0", "error": {"code": -32603, "message": f"Unknown tool: {name}"}, "id": req_id}

        result = handler(args)
        return {
            "jsonrpc": "2.0",
            "result": {"content": [{"type": "text", "text": json.dumps(result, ensure_ascii=False, default=str)}]},
            "id": req_id,
        }

    return {"jsonrpc": "2.0", "error": {"code": -32603, "message": f"Unknown method: {method}"}, "id": req_id}


if __name__ == "__main__":
    # 启动时清除代理环境变量，避免 akshare HTTP 请求被代理拦截
    for var in ("HTTP_PROXY", "HTTPS_PROXY", "http_proxy", "https_proxy", "ALL_PROXY", "all_proxy"):
        if os.environ.pop(var, None) is not None:
            logger.info("Removed proxy env var: %s", var)

    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            resp = handle_request(json.loads(line))
            if resp is not None:
                print(json.dumps(resp, ensure_ascii=False))
                sys.stdout.flush()
        except Exception as e:
            req_id = None
            try:
                req_id = json.loads(line).get("id")
            except Exception:
                pass
            print(json.dumps({"jsonrpc": "2.0", "id": req_id, "error": {"code": -32603, "message": str(e)}}))
            sys.stdout.flush()
