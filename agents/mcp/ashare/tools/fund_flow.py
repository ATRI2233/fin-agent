# Fund flow tools
from ..utils import is_ashare, normalize_symbol, get_market_code, is_etf, parse_ashare_code, http_get, get_daily_data

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

    数据来源：AKShare stock_individual_fund_flow
    """
    if not is_ashare(symbol):
        return {"error": f"{symbol} 不是 A 股代码"}

    try:
        market, code = parse_ashare_code(symbol)
        if not market:
            return {"error": f"无法识别的代码: {symbol}"}

        df = ak.stock_individual_fund_flow(stock=code, market=market)
        if df is None or df.empty:
            return {"error": f"无法获取 {symbol} 资金流向数据"}

        cols = df.columns.tolist()

        def find_col(*names):
            for n in names:
                for c in cols:
                    if n in c:
                        return c
            return None

        date_col = find_col("日期", "时间")
        main_net_col = find_col("主力净流入-净额", "主力净流入")
        main_pct_col = find_col("主力净流入-净占比", "主力净占比")
        large_net_col = find_col("超大单净流入-净额", "超大单净流入")
        large_pct_col = find_col("超大单净流入-净占比", "超大单净占比")
        big_net_col = find_col("大单净流入-净额", "大单净流入")
        big_pct_col = find_col("大单净流入-净占比", "大单净占比")
        mid_net_col = find_col("中单净流入-净额", "中单净流入")
        mid_pct_col = find_col("中单净流入-净占比", "中单净占比")
        small_net_col = find_col("小单净流入-净额", "小单净流入")
        small_pct_col = find_col("小单净流入-净占比", "小单净占比")
        close_col = find_col("收盘价")
        change_col = find_col("涨跌幅")

        def safe_float(val):
            try:
                return round(float(val), 2) if val is not None and pd.notna(val) else None
            except (ValueError, TypeError):
                return None

        records = []
        for _, row in df.tail(10).iterrows():
            record = {
                "date": str(row[date_col])[:10] if date_col and pd.notna(row.get(date_col)) else None,
                "close": safe_float(row.get(close_col)) if close_col else None,
                "change_pct": safe_float(row.get(change_col)) if change_col else None,
                "主力净流入": safe_float(row.get(main_net_col)) if main_net_col else None,
                "主力净占比": safe_float(row.get(main_pct_col)) if main_pct_col else None,
                "超大单净流入": safe_float(row.get(large_net_col)) if large_net_col else None,
                "超大单净占比": safe_float(row.get(large_pct_col)) if large_pct_col else None,
                "大单净流入": safe_float(row.get(big_net_col)) if big_net_col else None,
                "大单净占比": safe_float(row.get(big_pct_col)) if big_pct_col else None,
                "中单净流入": safe_float(row.get(mid_net_col)) if mid_net_col else None,
                "中单净占比": safe_float(row.get(mid_pct_col)) if mid_pct_col else None,
                "小单净流入": safe_float(row.get(small_net_col)) if small_net_col else None,
                "小单净占比": safe_float(row.get(small_pct_col)) if small_pct_col else None,
            }
            records.append(record)

        return {
            "symbol": symbol,
            "records": records,
            "count": len(records),
            "source": "akshare",
        }
    except Exception as e:
        return {"error": f"资金流向获取失败: {str(e)}"}


# ═══════════════════════════════════════════════════
# Tool 10: ashare_market_breadth — 市场广度
# ═══════════════════════════════════════════════════
