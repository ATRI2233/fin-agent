#!/usr/bin/env python3
"""risk-mcp-server — 本地风控计算 + 仓位管理 + 机构持仓 MCP Server"""

import json
import os
import sys

try:
    import numpy as np
    import pandas as pd
    import yfinance as yf

    HAS_DEPS = True
except ImportError:
    HAS_DEPS = False


def _close_series(data):
    """Extract Close prices as a 1D Series (yfinance returns multi-level columns)"""
    c = data["Close"]
    return c.squeeze() if isinstance(c, pd.DataFrame) else c


# ═══════════════════════════════════════════════
# Tool 1: risk_gauge — 风控指标计算
# ═══════════════════════════════════════════════


def calculate_risk(symbol):
    if not HAS_DEPS:
        return error_result(
            symbol,
            "yfinance/numpy not installed. Run: pip install yfinance numpy pandas",
        )

    try:
        data = yf.download(symbol, period="1y", progress=False, timeout=30)
        if data.empty or len(data) < 60:
            return {
                **base_result(symbol),
                "error": "Insufficient data (need >=60 trading days)",
                "risk_level": "unknown",
            }

        close = _close_series(data).dropna()
        price = float(close.iloc[-1])
        high_52w = float(close.rolling(252).max().iloc[-1])
        drawdown = (price - high_52w) / high_52w if high_52w > 0 else 0
        log_ret = np.log(close / close.shift(1)).dropna()
        vol_20d = float(log_ret.tail(20).std() * np.sqrt(252))
        vol_60d = float(log_ret.tail(60).std() * np.sqrt(252))
        var_95 = float(np.percentile(log_ret.tail(60), 5))
        vol_20d_pct = round(vol_20d * 100, 2)
        vol_60d_pct = round(vol_60d * 100, 2)
        drawdown_pct = round(drawdown * 100, 2)
        var_95_pct = round(abs(var_95) * 100, 2)

        warnings = []
        risk_level = "low"
        if vol_20d_pct > 40:
            warnings.append(f"高波动率: {vol_20d_pct}%（>40%阈值）")
            risk_level = "high"
        elif vol_20d_pct > 25:
            risk_level = "medium"
        if drawdown_pct < -20:
            warnings.append(f"深度回撤: {drawdown_pct}%（<-20%）")
            risk_level = "high"
        elif drawdown_pct < -15:
            risk_level = "medium"
        if var_95_pct > 3:
            warnings.append(f"高VaR: {var_95_pct}%（>3%单日最大预期亏损）")

        levels = {
            "high": "HIGH — 降低仓位",
            "medium": "MEDIUM — 轻仓试探",
            "low": "LOW — 正常操作范围",
        }
        warnings.append(f"风险等级: {levels[risk_level]}")

        return {
            "symbol": symbol,
            "last_price": round(price, 2),
            "volatility_20d_pct": vol_20d_pct,
            "volatility_60d_pct": vol_60d_pct,
            "drawdown_from_52w_high_pct": drawdown_pct,
            "var_95_daily_pct": var_95_pct,
            "risk_level": risk_level,
            "warnings": warnings,
        }
    except Exception as e:
        return error_result(symbol, str(e))


# ═══════════════════════════════════════════════
# Tool 2: position_sizing — 凯利公式仓位计算
# ═══════════════════════════════════════════════


def calculate_position(symbol, expected_return=None, risk_free_rate=0.05, kelly_fraction=0.25):
    """
    基于凯利公式优化和波动率目标计算建议仓位。

    参数:
      symbol: 股票代码
      expected_return: 预期年化收益率（小数），如不提供则基于历史数据估算
      risk_free_rate: 无风险利率（小数），默认 5%
      kelly_fraction: 凯利比例上限，默认 25%（全凯利过于激进）
    """
    if not HAS_DEPS:
        return error_result(symbol, "yfinance/numpy not installed")

    try:
        data = yf.download(symbol, period="1y", progress=False, timeout=30)
        if data.empty or len(data) < 120:
            return {
                **base_result(symbol),
                "error": "Insufficient data (need >=120 trading days)",
                "confidence": "low",
            }

        close = _close_series(data).dropna()
        price = float(close.iloc[-1])
        log_ret = np.log(close / close.shift(1)).dropna()
        annual_vol = float(log_ret.std() * np.sqrt(252))
        annual_ret = float(log_ret.mean() * 252)

        # 预期收益率：传入值优先，否则用历史
        exp_ret = expected_return if expected_return is not None else annual_ret

        # 凯利公式: f* = (R - r_f) / σ²
        # R=预期收益率, r_f=无风险利率, σ=波动率
        excess_return = exp_ret - risk_free_rate
        variance = annual_vol**2

        kelly_pct = 0 if variance <= 0 else excess_return / variance

        # 限制范围
        raw_kelly = round(kelly_pct * 100, 2)
        capped_kelly = round(min(max(kelly_pct, 0), kelly_fraction) * 100, 2)

        # 波动率目标仓位（目标波动率 20%）
        target_vol = 0.20
        vol_parity = round((target_vol / annual_vol) * 100, 2) if annual_vol > 0 else 100
        vol_parity = round(min(vol_parity, 100), 2)

        # 综合建议 = 凯利和波动率目标中较低者（保守原则）
        recommended = round(min(capped_kelly, vol_parity), 2)

        # 仓位等级
        if recommended >= 20:
            level = "重仓"
        elif recommended >= 10:
            level = "中等仓位"
        elif recommended >= 5:
            level = "轻仓"
        elif recommended > 0:
            level = "观察仓"
        else:
            level = "不参与"

        return {
            "symbol": symbol,
            "last_price": round(price, 2),
            "annualized_volatility_pct": round(annual_vol * 100, 2),
            "annualized_return_pct": round(annual_ret * 100, 2),
            "excess_return_pct": round(excess_return * 100, 2),
            "kelly_raw_pct": raw_kelly,
            "kelly_capped_pct": capped_kelly,
            "vol_target_portfolio_pct": vol_parity,
            "recommended_position_pct": recommended,
            "position_level": level,
            "params_used": {
                "expected_return_pct": round(exp_ret * 100, 2),
                "risk_free_rate_pct": round(risk_free_rate * 100, 2),
                "target_volatility_pct": round(target_vol * 100, 2),
                "kelly_fraction_limit_pct": round(kelly_fraction * 100, 2),
            },
        }
    except Exception as e:
        return error_result(symbol, str(e))


# ═══════════════════════════════════════════════
# Tool 3: institutional_flow — 机构持仓分析
# ═══════════════════════════════════════════════


def get_institutional_flow(symbol, top_n=10):
    """
    通过 yfinance 获取机构持仓数据。

    yfinance 数据来源是 13F filings，有 45 天延迟，
    仅反映季度末持仓，不包含空头和衍生品。
    """
    if not HAS_DEPS:
        return error_result(symbol, "yfinance not installed")

    try:
        ticker = yf.Ticker(symbol)

        # 机构持仓
        holders = []
        total_value = 0
        holders_raw = ticker.institutional_holders
        if holders_raw is not None and not holders_raw.empty:
            try:
                df = holders_raw.head(top_n)
                if hasattr(df, "iterrows"):
                    for _, row in df.iterrows():
                        holder = {
                            "holder": str(row.get("Holder", "")),
                            "shares": int(row["Shares"]) if pd.notna(row.get("Shares")) else 0,
                            "value": float(row["Value"]) if pd.notna(row.get("Value")) else 0,
                            "pct_held": float(row["pctHeld"]) if pd.notna(row.get("pctHeld")) else 0,
                            "pct_change": float(row["pctChange"]) if pd.notna(row.get("pctChange")) else 0,
                            "date": str(row.get("Date Reported", ""))[:10],
                        }
                        total_value += holder["value"]
                        holders.append(holder)
            except Exception:
                pass  # silently skip if data format unexpected

        # 主要持有人比例
        pct = None
        major_raw = ticker.major_holders
        if major_raw is not None and not major_raw.empty:
            try:
                if hasattr(major_raw, "iterrows"):
                    for idx_name, row in major_raw.iterrows():
                        val = str(row.iloc[0]) if hasattr(row, "iloc") else str(row)
                        if "Institution" in str(idx_name) or "institution" in str(idx_name):
                            pct = val
            except Exception:
                pass

        # 持股变化方向（季度对比）
        shares_full = ticker.get_shares_full()
        share_trend = []
        if shares_full is not None and not shares_full.empty:
            recent = shares_full.tail(4)
            if hasattr(recent, "items"):
                for date_str, val in recent.items():
                    share_trend.append(
                        {
                            "date": str(date_str)[:10],
                            "shares_outstanding": int(val),
                        }
                    )
            elif hasattr(recent, "iterrows"):
                for date_str, row in recent.iterrows():
                    share_trend.append(
                        {
                            "date": str(date_str)[:10],
                            "shares_outstanding": int(row.iloc[0]),
                        }
                    )

        result = {
            "symbol": symbol,
            "institutional_holders_count": len(holders),
            "total_institutional_value": round(total_value, 2),
            "institutional_ownership_pct": pct,
            "top_holders": holders,
            "share_trend": share_trend,
            "data_notes": [
                "数据来源: 13F filings，延迟约45天",
                "仅反映季度末持仓，不包含空头和衍生品",
            ],
        }
        return result
    except Exception as e:
        return error_result(symbol, str(e))


# ═══════════════════════════════════════════════
# 辅助函数
# ═══════════════════════════════════════════════


def base_result(symbol):
    return {"symbol": symbol}


def error_result(symbol, msg):
    return {**base_result(symbol), "error": msg}


# ═══════════════════════════════════════════════
# MCP 协议处理
# ═══════════════════════════════════════════════

TOOLS = [
    {
        "name": "risk_gauge",
        "description": "风控指标计算：基于 yfinance 历史价格计算 20日/60日年化波动率、距52周高点回撤、95% VaR，输出风险等级和预警",
        "inputSchema": {
            "type": "object",
            "properties": {
                "symbol": {"type": "string", "description": "股票代码，如 AAPL"},
            },
            "required": ["symbol"],
        },
    },
    {
        "name": "position_sizing",
        "description": "仓位计算：基于凯利公式和波动率目标，输出建议仓位比例。支持传入预期收益率，否则使用历史收益率估算",
        "inputSchema": {
            "type": "object",
            "properties": {
                "symbol": {"type": "string", "description": "股票代码，如 AAPL"},
                "expected_return": {
                    "type": "number",
                    "description": "预期年化收益率（小数），如 0.15 表示15%，不传则用历史数据估算",
                },
                "risk_free_rate": {
                    "type": "number",
                    "description": "无风险利率（小数），默认 0.05",
                },
                "kelly_fraction": {
                    "type": "number",
                    "description": "凯利比例上限，默认 0.25（全凯利过于激进）",
                },
            },
            "required": ["symbol"],
        },
    },
    {
        "name": "institutional_flow",
        "description": "机构持仓分析：基于 yfinance/13F 数据，输出前十大机构持有人、持仓市值、持股变化趋势。注意数据有45天延迟",
        "inputSchema": {
            "type": "object",
            "properties": {
                "symbol": {"type": "string", "description": "股票代码，如 AAPL"},
                "top_n": {"type": "number", "description": "返回前N大机构，默认 10"},
            },
            "required": ["symbol"],
        },
    },
]


def handle_request(req):
    method = req.get("method", "")
    params = req.get("params", {})
    req_id = req.get("id")

    # MCP 协议握手
    if method == "initialize":
        return {
            "jsonrpc": "2.0",
            "result": {
                "protocolVersion": "2024-11-05",
                "capabilities": {"tools": {}},
                "serverInfo": {"name": "risk-mcp-server", "version": "1.0.0"},
            },
            "id": req_id,
        }

    if method == "notifications/initialized":
        # 握手完成确认，不需要回复
        return None

    if method == "tools/list":
        return {"jsonrpc": "2.0", "result": {"tools": TOOLS}, "id": req_id}

    if method == "tools/call":
        name = params.get("name", "")
        args = params.get("arguments", {})

        if name == "risk_gauge":
            symbol = args.get("symbol", "")
            if not symbol:
                return {
                    "jsonrpc": "2.0",
                    "error": {"message": "缺少 symbol"},
                    "id": req_id,
                }
            result = calculate_risk(symbol.upper())

        elif name == "position_sizing":
            symbol = args.get("symbol", "")
            if not symbol:
                return {
                    "jsonrpc": "2.0",
                    "error": {"message": "缺少 symbol"},
                    "id": req_id,
                }
            result = calculate_position(
                symbol.upper(),
                expected_return=args.get("expected_return"),
                risk_free_rate=args.get("risk_free_rate", 0.05),
                kelly_fraction=args.get("kelly_fraction", 0.25),
            )

        elif name == "institutional_flow":
            symbol = args.get("symbol", "")
            if not symbol:
                return {
                    "jsonrpc": "2.0",
                    "error": {"message": "缺少 symbol"},
                    "id": req_id,
                }
            result = get_institutional_flow(symbol.upper(), top_n=args.get("top_n", 10))

        else:
            return {
                "jsonrpc": "2.0",
                "error": {"message": f"Unknown tool: {name}"},
                "id": req_id,
            }

        return {
            "jsonrpc": "2.0",
            "result": {
                "content": [
                    {
                        "type": "text",
                        "text": json.dumps(result, ensure_ascii=False, default=str),
                    }
                ]
            },
            "id": req_id,
        }

    return {
        "jsonrpc": "2.0",
        "error": {"message": f"Unknown method: {method}"},
        "id": req_id,
    }


if __name__ == "__main__":
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
            print(json.dumps({"jsonrpc": "2.0", "error": {"message": str(e)}}))
            sys.stdout.flush()
