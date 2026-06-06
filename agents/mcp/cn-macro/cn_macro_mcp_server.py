"""
cn-macro-mcp-server — A 股宏观数据 MCP 服务器

使用 AKShare 获取中国宏观经济数据：
- 社融增量、M1/M2
- 国债收益率、LPR、MLF
- PMI、CPI/PPI、GDP
- 北向资金、汇率
"""

import json
import sys
from datetime import datetime

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
        "description": "中国利率数据：10年期国债收益率、LPR、MLF、公开市场操作",
        "inputSchema": {
            "type": "object",
            "properties": {
                "indicator": {
                    "type": "string",
                    "enum": ["bond_yield_10y", "lpr", "mlf", "omo"],
                    "description": "指标类型：bond_yield_10y=10年期国债, lpr=LPR, mlf=MLF利率, omo=公开市场操作",
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
        "description": "中国工业数据：工业增加值、粗钢产量",
        "inputSchema": {
            "type": "object",
            "properties": {
                "indicator": {
                    "type": "string",
                    "enum": ["industrial_output", "crude_steel"],
                    "description": "指标类型：industrial_output=工业增加值, crude_steel=粗钢产量",
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
            df = ak.macro_china_m2_yearly()
            df = df.tail(periods)
            return {
                "indicator": "M2同比",
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
            # 需要分别获取 M1 和 M2 数据计算剪刀差
            return {
                "indicator": "M1-M2剪刀差",
                "note": "需要分别获取M1和M2数据计算",
                "data": [],
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
            # MLF 数据可能需要其他接口
            return {"indicator": "MLF利率", "note": "MLF数据需要央行接口", "data": []}
        elif indicator == "omo":
            return {
                "indicator": "公开市场操作",
                "note": "OMO数据需要央行接口",
                "data": [],
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
            df = ak.macro_china_pmi()
            df = df.tail(periods)
            return {
                "indicator": "官方非制造业PMI",
                "data": df.to_dict(orient="records"),
            }
        elif indicator == "caixin_mfg":
            # 财新PMI可能需要其他接口
            return {
                "indicator": "财新制造业PMI",
                "note": "财新PMI需要单独接口",
                "data": [],
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
            return {
                "indicator": "CPI-PPI剪刀差",
                "note": "需要分别获取CPI和PPI数据计算",
                "data": [],
            }
        else:
            return {"error": f"Unknown indicator: {indicator}"}
    except Exception as e:
        return {"error": str(e)}


def get_cn_macro_industry(indicator, periods=12):
    """获取中国工业数据"""
    try:
        if indicator == "industrial_output":
            return {
                "indicator": "工业增加值",
                "note": "工业增加值数据需要统计局接口",
                "data": [],
            }
        elif indicator == "crude_steel":
            return {
                "indicator": "粗钢产量",
                "note": "粗钢产量数据需要行业协会接口",
                "data": [],
            }
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
            return {"indicator": "USD/CNY", "data": df.values.tolist()}
        elif indicator == "usd_cnh":
            return {"indicator": "USD/CNH", "note": "离岸汇率需要其他接口", "data": []}
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

# ── MCP 服务器 ────────────────────────────────────────────


def handle_request(req):
    """处理 JSON-RPC 请求"""
    method = req.get("method")
    params = req.get("params", {})
    req_id = req.get("id")

    if method == "initialize":
        return {
            "jsonrpc": "2.0",
            "id": req_id,
            "result": {
                "protocolVersion": "2024-11-05",
                "capabilities": {"tools": {}},
                "serverInfo": {"name": "cn-macro-mcp-server", "version": "1.0.0"},
            },
        }

    elif method == "tools/list":
        return {"jsonrpc": "2.0", "id": req_id, "result": {"tools": TOOLS}}

    elif method == "tools/call":
        tool_name = params.get("name")
        arguments = params.get("arguments", {})

        handler = TOOL_HANDLERS.get(tool_name)
        if not handler:
            return {
                "jsonrpc": "2.0",
                "id": req_id,
                "result": {
                    "content": [
                        {
                            "type": "text",
                            "text": json.dumps({"error": f"Unknown tool: {tool_name}"}),
                        }
                    ],
                    "isError": True,
                },
            }

        # 调用处理函数
        if tool_name == "cn_macro_northbound":
            result = handler(arguments.get("periods", 20))
        elif tool_name in [
            "cn_macro_credit",
            "cn_macro_rates",
            "cn_macro_pmi",
            "cn_macro_inflation",
            "cn_macro_industry",
        ]:
            result = handler(arguments.get("indicator"), arguments.get("periods", 12))
        elif tool_name == "cn_macro_fx":
            result = handler(arguments.get("indicator"), arguments.get("periods", 20))
        else:
            result = handler(**arguments)

        return {
            "jsonrpc": "2.0",
            "id": req_id,
            "result": {
                "content": [
                    {
                        "type": "text",
                        "text": json.dumps(result, ensure_ascii=False, default=str),
                    }
                ]
            },
        }

    elif method == "notifications/initialized":
        return None

    else:
        return {
            "jsonrpc": "2.0",
            "id": req_id,
            "error": {"code": -32601, "message": f"Method not found: {method}"},
        }


def main():
    """主循环：读取 stdin，处理请求，写入 stdout"""
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue

        try:
            req = json.loads(line)
            resp = handle_request(req)
            if resp:
                print(json.dumps(resp, ensure_ascii=False), flush=True)
        except json.JSONDecodeError:
            print(
                json.dumps(
                    {
                        "jsonrpc": "2.0",
                        "error": {"code": -32700, "message": "Parse error"},
                    }
                ),
                flush=True,
            )
        except Exception as e:
            print(
                json.dumps(
                    {"jsonrpc": "2.0", "error": {"code": -32603, "message": str(e)}}
                ),
                flush=True,
            )


if __name__ == "__main__":
    main()
