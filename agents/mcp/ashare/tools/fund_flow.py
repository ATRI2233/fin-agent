# Fund flow tools
from ..utils import is_ashare, normalize_symbol, get_market_code, is_etf, parse_ashare_code, http_get, get_daily_data
import json
import logging
import time

logger = logging.getLogger(__name__)

try:
    import akshare as ak
    import pandas as pd

    HAS_DEPS = True
except ImportError:
    HAS_DEPS = False

def get_fund_flow(symbol):
    """获取个股资金流向（超大单/大单/中单/小单净流入）

    数据来源：东方财富（push2his.eastmoney.com）
    """
    if not is_ashare(symbol):
        return {"error": f"{symbol} 不是 A 股代码"}

    try:
        market, code = parse_ashare_code(symbol)
        if not market:
            return {"error": f"无法识别的代码: {symbol}"}

        market_map = {"sh": 1, "sz": 0, "bj": 0}
        market_id = market_map.get(market)
        if market_id is None:
            return {"error": f"不支持的市场: {market}"}

        import time

        url = (
            f"https://push2his.eastmoney.com/api/qt/stock/fflow/daykline/get"
            f"?lmt=0&klt=101&secid={market_id}.{code}"
            f"&fields1=f1,f2,f3,f7"
            f"&fields2=f51,f52,f53,f54,f55,f56,f57,f58,f59,f60,f61,f62,f63,f64,f65"
            f"&ut=b2884a393a59ad64002292a3e90d46a5&_={int(time.time() * 1000)}"
        )
        text = http_get(
            url,
            headers={
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
                "Referer": "https://data.eastmoney.com/",
            },
            encoding="utf-8",
        )
        if not text:
            return {"error": "无法获取资金流向数据（网络问题）"}

        data = json.loads(text)
        klines = data.get("data", {}).get("klines", [])
        if not klines:
            return {"error": "资金流向数据为空"}

        columns = [
            "日期",
            "主力净流入-净额",
            "小单净流入-净额",
            "中单净流入-净额",
            "大单净流入-净额",
            "超大单净流入-净额",
            "主力净流入-净占比",
            "小单净流入-净占比",
            "中单净流入-净占比",
            "大单净流入-净占比",
            "超大单净流入-净占比",
            "收盘价",
            "涨跌幅",
        ]

        records = []
        for line in klines[-10:]:
            fields = line.split(",")
            record = {}
            for i, col in enumerate(columns):
                if i < len(fields):
                    val = fields[i]
                    try:
                        record[col] = round(float(val), 2)
                    except (ValueError, TypeError):
                        record[col] = val
                else:
                    record[col] = None
            records.append(record)

        return {
            "symbol": symbol,
            "records": records,
            "count": len(records),
            "source": "eastmoney",
        }
    except Exception as e:
        return {"error": f"资金流向获取失败: {str(e)}"}


# ═══════════════════════════════════════════════════
# Tool 7: ashare_lhb — 龙虎榜
# ═══════════════════════════════════════════════════

def get_fund_flow_real(symbol):
    """获取个股实时资金流向（主力/超大单/大单/中单/小单 净流入与净占比）

    数据来源：东方财富（push2his.eastmoney.com）
    使用 urllib 直接请求，避免 requests 库的连接问题
    """
    if not is_ashare(symbol):
        return {"error": f"{symbol} 不是 A 股代码"}

    try:
        market, code = parse_ashare_code(symbol)
        if not market:
            return {"error": f"无法识别的代码: {symbol}"}

        market_map = {"sh": 1, "sz": 0, "bj": 0}
        market_id = market_map.get(market)
        if market_id is None:
            return {"error": f"不支持的市场: {market}"}

        url = (
            f"https://push2his.eastmoney.com/api/qt/stock/fflow/daykline/get"
            f"?lmt=0&klt=101&secid={market_id}.{code}"
            f"&fields1=f1,f2,f3,f7"
            f"&fields2=f51,f52,f53,f54,f55,f56,f57,f58,f59,f60,f61,f62,f63,f64,f65"
            f"&ut=b2884a393a59ad64002292a3e90d46a5&_={int(time.time() * 1000)}"
        )
        text = http_get(
            url,
            headers={
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
                "Referer": "https://data.eastmoney.com/",
            },
            encoding="utf-8",
        )
        if not text:
            return {"error": "无法获取资金流向数据（网络问题）"}

        data = json.loads(text)
        klines = data.get("data", {}).get("klines", [])
        if not klines:
            return {"error": "资金流向数据为空"}

        columns = [
            "日期",
            "主力净流入-净额",
            "小单净流入-净额",
            "中单净流入-净额",
            "大单净流入-净额",
            "超大单净流入-净额",
            "主力净流入-净占比",
            "小单净流入-净占比",
            "中单净流入-净占比",
            "大单净流入-净占比",
            "超大单净流入-净占比",
            "收盘价",
            "涨跌幅",
        ]

        records = []
        for line in klines[-10:]:
            fields = line.split(",")
            record = {}
            for i, col in enumerate(columns):
                if i < len(fields):
                    val = fields[i]
                    try:
                        record[col] = round(float(val), 2)
                    except (ValueError, TypeError):
                        record[col] = val
                else:
                    record[col] = None
            records.append(record)

        return {
            "symbol": symbol,
            "records": records,
            "count": len(records),
            "source": "eastmoney",
        }
    except Exception as e:
        return {"error": f"资金流向获取失败: {str(e)}"}


# ═══════════════════════════════════════════════════
# Tool 10: ashare_market_breadth — 市场广度
# ═══════════════════════════════════════════════════
