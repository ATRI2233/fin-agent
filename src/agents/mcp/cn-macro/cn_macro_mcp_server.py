"""
cn-macro-mcp-server — A 股宏观数据 MCP 服务器

使用 AKShare 获取中国宏观经济数据：
- 社融增量、M1/M2
- 国债收益率、LPR、MLF
- PMI、CPI/PPI、GDP
- 北向资金、汇率
"""

import sys
from datetime import datetime

from agents.mcp.common import make_handle_request, run_stdio_server

try:
    import akshare as ak
except ImportError:
    print("ERROR: akshare not installed. Run: pip install akshare", file=sys.stderr)
    sys.exit(1)

# ── 工具定义 ──────────────────────────────────────────────

TOOLS = [
    {
        "name": "cn_macro_credit",
        "description": "中国信贷数据：社融增量、新增人民币贷款、M1/M2同比、M1-M2剪刀差",
        "inputSchema": {
            "type": "object",
            "properties": {
                "indicator": {
                    "type": "string",
                    "enum": ["shrzgm", "m1", "m2", "m1_m2_spread"],
                    "description": "指标类型：shrzgm=社融增量, m1=M1同比, m2=M2同比, m1_m2_spread=M1-M2剪刀差",
                },
                "periods": {
                    "type": "number",
                    "description": "返回最近N个月的数据，默认12",
                    "default": 12,
                },
            },
            "required": ["indicator"],
        },
    },
    {
        "name": "cn_macro_rates",
        "description": "中国利率数据：10年期国债收益率、LPR、公开市场操作",
        "inputSchema": {
            "type": "object",
            "properties": {
                "indicator": {
                    "type": "string",
                    "enum": ["bond_yield_10y", "lpr", "omo"],
                    "description": "指标类型：bond_yield_10y=10年期国债, lpr=LPR, omo=公开市场操作",
                },
                "periods": {
                    "type": "number",
                    "description": "返回最近N期的数据，默认12",
                    "default": 12,
                },
            },
            "required": ["indicator"],
        },
    },
    {
        "name": "cn_macro_pmi",
        "description": "中国PMI数据：官方制造业PMI、非制造业PMI、财新制造业PMI",
        "inputSchema": {
            "type": "object",
            "properties": {
                "indicator": {
                    "type": "string",
                    "enum": ["official_mfg", "official_non_mfg", "caixin_mfg"],
                    "description": "指标类型：official_mfg=官方制造业, official_non_mfg=官方非制造业, caixin_mfg=财新制造业",
                },
                "periods": {
                    "type": "number",
                    "description": "返回最近N个月的数据，默认12",
                    "default": 12,
                },
            },
            "required": ["indicator"],
        },
    },
    {
        "name": "cn_macro_inflation",
        "description": "中国通胀数据：CPI同比、PPI同比、CPI-PPI剪刀差",
        "inputSchema": {
            "type": "object",
            "properties": {
                "indicator": {
                    "type": "string",
                    "enum": ["cpi", "ppi", "cpi_ppi_spread"],
                    "description": "指标类型：cpi=CPI同比, ppi=PPI同比, cpi_ppi_spread=CPI-PPI剪刀差",
                },
                "periods": {
                    "type": "number",
                    "description": "返回最近N个月的数据，默认12",
                    "default": 12,
                },
            },
            "required": ["indicator"],
        },
    },
    {
        "name": "cn_macro_industry",
        "description": "中国工业数据：工业增加值",
        "inputSchema": {
            "type": "object",
            "properties": {
                "indicator": {
                    "type": "string",
                    "enum": ["industrial_output"],
                    "description": "指标类型：industrial_output=工业增加值",
                },
                "periods": {
                    "type": "number",
                    "description": "返回最近N个月的数据，默认12",
                    "default": 12,
                },
            },
            "required": ["indicator"],
        },
    },
    {
        "name": "cn_macro_northbound",
        "description": "北向资金净流入/流出数据",
        "inputSchema": {
            "type": "object",
            "properties": {
                "periods": {
                    "type": "number",
                    "description": "返回最近N天的数据，默认20",
                    "default": 20,
                }
            },
        },
    },
    {
        "name": "cn_macro_fx",
        "description": "人民币汇率数据：在岸CNY、离岸CNH",
        "inputSchema": {
            "type": "object",
            "properties": {
                "indicator": {
                    "type": "string",
                    "enum": ["usd_cny", "usd_cnh"],
                    "description": "指标类型：usd_cny=在岸汇率, usd_cnh=离岸汇率",
                },
                "periods": {
                    "type": "number",
                    "description": "返回最近N天的数据，默认20",
                    "default": 20,
                },
            },
            "required": ["indicator"],
        },
    },
]

# ── 数据获取函数 ──────────────────────────────────────────


def get_cn_macro_credit(indicator, periods=12):
    """获取中国信贷数据"""
    try:
        if indicator == "shrzgm":
            df = ak.macro_china_shrzgm()
            df = df.tail(periods)
            return {
                "indicator": "社融增量",
                "unit": "亿元",
                "data": df.to_dict(orient="records"),
            }
        elif indicator == "m1":
            df = ak.macro_china_supply_of_money()
            df = df.tail(periods)
            return {
                "indicator": "M1同比",
                "unit": "%",
                "data": df.to_dict(orient="records"),
            }
        elif indicator == "m2":
            df = ak.macro_china_m2_yearly()
            df = df.tail(periods)
            return {
                "indicator": "M2同比",
                "unit": "%",
                "data": df.to_dict(orient="records"),
            }
        elif indicator == "m1_m2_spread":
            df = ak.macro_china_supply_of_money()
            df = df.tail(periods)
            return {
                "indicator": "M1-M2剪刀差",
                "unit": "%",
                "note": "使用货币供应量数据计算M1-M2差值",
                "data": df.to_dict(orient="records"),
            }
        else:
            return {"error": f"Unknown indicator: {indicator}"}
    except Exception as e:
        return {"error": str(e)}


def get_cn_macro_rates(indicator, periods=12):
    """获取中国利率数据"""
    try:
        if indicator == "bond_yield_10y":
            df = ak.bond_china_yield(
                start_date="20200101", end_date=datetime.now().strftime("%Y%m%d")
            )
            df = df.tail(periods)
            return {
                "indicator": "中国国债收益率",
                "unit": "%",
                "data": df.to_dict(orient="records"),
            }
        elif indicator == "lpr":
            df = ak.macro_china_lpr()
            df = df.tail(periods)
            return {
                "indicator": "LPR",
                "unit": "%",
                "data": df.to_dict(orient="records"),
            }
        elif indicator == "mlf":
            raise ValueError("MLF 数据源不可用，已从工具列表中移除")
        elif indicator == "omo":
            df = ak.macro_china_shibor_all()
            df = df.tail(periods)
            return {
                "indicator": "公开市场操作",
                "unit": "%",
                "note": "使用SHIBOR数据作为公开市场操作代理指标",
                "data": df.to_dict(orient="records"),
            }
        else:
            return {"error": f"Unknown indicator: {indicator}"}
    except Exception as e:
        return {"error": str(e)}


def get_cn_macro_pmi(indicator, periods=12):
    """获取中国PMI数据"""
    try:
        if indicator == "official_mfg":
            df = ak.macro_china_pmi()
            df = df.tail(periods)
            return {"indicator": "官方制造业PMI", "data": df.to_dict(orient="records")}
        elif indicator == "official_non_mfg":
            df = ak.macro_china_non_man_pmi()
            df = df.tail(periods)
            return {
                "indicator": "官方非制造业PMI",
                "data": df.to_dict(orient="records"),
            }
        elif indicator == "caixin_mfg":
            df = ak.macro_china_cx_pmi_yearly()
            df = df.tail(periods)
            return {
                "indicator": "财新制造业PMI",
                "data": df.to_dict(orient="records"),
            }
        else:
            return {"error": f"Unknown indicator: {indicator}"}
    except Exception as e:
        return {"error": str(e)}


def get_cn_macro_inflation(indicator, periods=12):
    """获取中国通胀数据"""
    try:
        if indicator == "cpi":
            df = ak.macro_china_cpi_monthly()
            df = df.tail(periods)
            return {"indicator": "CPI同比", "unit": "%", "data": df.values.tolist()}
        elif indicator == "ppi":
            df = ak.macro_china_ppi()
            df = df.tail(periods)
            return {"indicator": "PPI同比", "unit": "%", "data": df.values.tolist()}
        elif indicator == "cpi_ppi_spread":
            cpi_df = ak.macro_china_cpi_yearly()
            ppi_df = ak.macro_china_ppi_yearly()
            cpi_recent = cpi_df.tail(periods)
            ppi_recent = ppi_df.tail(periods)
            return {
                "indicator": "CPI-PPI剪刀差",
                "unit": "%",
                "cpi_data": cpi_recent.to_dict(orient="records"),
                "ppi_data": ppi_recent.to_dict(orient="records"),
            }
        else:
            return {"error": f"Unknown indicator: {indicator}"}
    except Exception as e:
        return {"error": str(e)}


def get_cn_macro_industry(indicator, periods=12):
    """获取中国工业数据"""
    try:
        if indicator == "industrial_output":
            df = ak.macro_china_industrial_production_yoy()
            df = df.tail(periods)
            return {
                "indicator": "工业增加值",
                "unit": "%",
                "data": df.to_dict(orient="records"),
            }
        elif indicator == "crude_steel":
            raise ValueError("粗钢产量数据源已下线")
        else:
            return {"error": f"Unknown indicator: {indicator}"}
    except Exception as e:
        return {"error": str(e)}


def get_cn_macro_northbound(periods=20):
    """获取北向资金数据"""
    try:
        # AKShare 北向资金接口 - 使用东方财富历史数据
        df = ak.stock_hsgt_hist_em(symbol="北向资金")
        df = df.tail(periods)
        return {
            "indicator": "北向资金净流入",
            "unit": "亿元",
            "data": df.values.tolist(),
        }
    except Exception as e:
        # 如果接口不可用，返回错误信息
        return {"error": f"北向资金数据获取失败: {str(e)}"}


def get_cn_macro_fx(indicator, periods=20):
    """获取人民币汇率数据"""
    try:
        if indicator == "usd_cny":
            df = ak.fx_spot_quote()
            df = df[df["货币对"] == "美元/人民币"]
            df = df.tail(periods)
            return {"indicator": "USD/CNY", "data": df.to_dict(orient="records")}
        elif indicator == "usd_cnh":
            df = ak.fx_spot_quote()
            df = df[df["货币对"] == "美元/离岸人民币"]
            df = df.tail(periods)
            return {"indicator": "USD/CNH", "data": df.to_dict(orient="records")}
        else:
            return {"error": f"Unknown indicator: {indicator}"}
    except Exception as e:
        return {"error": str(e)}


# ── 工具路由 ──────────────────────────────────────────────

TOOL_HANDLERS = {
    "cn_macro_credit": get_cn_macro_credit,
    "cn_macro_rates": get_cn_macro_rates,
    "cn_macro_pmi": get_cn_macro_pmi,
    "cn_macro_inflation": get_cn_macro_inflation,
    "cn_macro_industry": get_cn_macro_industry,
    "cn_macro_northbound": get_cn_macro_northbound,
    "cn_macro_fx": get_cn_macro_fx,
}

TOOL_DISPATCH = {
    "cn_macro_credit": lambda args: get_cn_macro_credit(args.get("indicator", ""), args.get("periods", 12)),
    "cn_macro_rates": lambda args: get_cn_macro_rates(args.get("indicator", ""), args.get("periods", 12)),
    "cn_macro_pmi": lambda args: get_cn_macro_pmi(args.get("indicator", ""), args.get("periods", 12)),
    "cn_macro_inflation": lambda args: get_cn_macro_inflation(args.get("indicator", ""), args.get("periods", 12)),
    "cn_macro_industry": lambda args: get_cn_macro_industry(args.get("indicator", ""), args.get("periods", 12)),
    "cn_macro_northbound": lambda args: get_cn_macro_northbound(args.get("periods", 20)),
    "cn_macro_fx": lambda args: get_cn_macro_fx(args.get("indicator", ""), args.get("periods", 20)),
}

# ── MCP 服务器 ────────────────────────────────────────────


def _validate_cn_macro_call(name, args, req_id):
    """Validate that 'indicator' is provided for tools that require it."""
    indicator_required = {
        "cn_macro_credit", "cn_macro_rates", "cn_macro_pmi",
        "cn_macro_inflation", "cn_macro_industry", "cn_macro_fx",
    }
    if name in indicator_required and not args.get("indicator"):
        return {
            "jsonrpc": "2.0",
            "error": {"code": -32603, "message": "缺少必需参数 'indicator'"},
            "id": req_id,
        }
    return None


handle_request = make_handle_request(
    TOOLS,
    TOOL_DISPATCH,
    {"name": "cn-macro-mcp-server", "version": "1.0.0"},
    validate_call=_validate_cn_macro_call,
)

if __name__ == "__main__":
    run_stdio_server(handle_request, server_name="cn-macro-mcp-server")
