#!/usr/bin/env python3
"""ashare-mcp-server — A 股数据 MCP Server，使用 akshare 提供行情/技术面/基本面/新闻数据"""

import json, sys, os, re, subprocess

os.environ.pop("HTTP_PROXY", None)
os.environ.pop("HTTPS_PROXY", None)
os.environ.pop("http_proxy", None)
os.environ.pop("https_proxy", None)
os.environ.pop("ALL_PROXY", None)
os.environ.pop("all_proxy", None)

from urllib.request import Request, urlopen
from urllib.error import URLError, HTTPError

try:
    import akshare as ak
    import numpy as np
    import pandas as pd

    HAS_DEPS = True
except ImportError:
    HAS_DEPS = False


def _run_akshare(script):
    """在干净环境中运行 akshare 代码，返回 JSON 结果"""
    clean_env = dict(os.environ)
    for k in [
        "HTTP_PROXY",
        "HTTPS_PROXY",
        "http_proxy",
        "https_proxy",
        "ALL_PROXY",
        "all_proxy",
        "NO_PROXY",
    ]:
        clean_env.pop(k, None)

    code = (
        "import os\n"
        'for k in ["HTTP_PROXY", "HTTPS_PROXY", "http_proxy", "https_proxy", "ALL_PROXY", "all_proxy"]:\n'
        "    os.environ.pop(k, None)\n"
        "import json, sys\n"
        "sys.stdout.write(json.dumps(" + script + "))\n"
        "sys.stdout.flush()\n"
    )
    try:
        result = subprocess.run(
            [sys.executable, "-c", code],
            env=clean_env,
            capture_output=True,
            text=True,
            timeout=60,
        )
        if result.returncode == 0 and result.stdout.strip():
            return json.loads(result.stdout.strip())
        return {"error": result.stderr.strip()[:200] if result.stderr else "unknown"}
    except Exception as e:
        return {"error": str(e)[:200]}


def is_ashare(symbol):
    """判断是否为 A 股（含 ETF 基金）"""
    code = symbol.strip().upper()
    # 6/0/3: 股票；159xxx: 深交所 ETF；51/56/58xxx: 上交所 ETF；16xxx: 深交所 ETF；8/4xxx: 北交所
    return (
        code.startswith(("6", "0", "3"))
        or code.startswith("159")
        or code.startswith(("51", "56", "58"))
        or code.startswith("16")
        or code.startswith(("8", "4"))
    )


def normalize_symbol(symbol):
    """标准化 A 股代码：添加市场后缀"""
    symbol = symbol.strip().upper()
    if is_ashare(symbol):
        market, code = parse_ashare_code(symbol)
        if market:
            suffix = {"sh": ".SS", "sz": ".SZ", "bj": ".BJ"}.get(market, "")
            return code + suffix
    return symbol


def get_market_code(symbol):
    """从代码获取市场前缀"""
    if symbol.endswith(".SS"):
        return "sh"
    elif symbol.endswith(".SZ"):
        return "sz"
    elif symbol.endswith(".BJ"):
        return "bj"
    return None


def is_etf(symbol):
    """判断是否为 ETF（基金代码特征）"""
    code = symbol.strip().upper()
    # 159xxx: 深交所 ETF（如 159632）
    # 51xxx / 56xxx / 58xxx: 上交所 ETF（如 510050, 512000, 588000）
    # 16xxx: 深交所 ETF（如 159600）
    # 8xxxx / 4xxxx: 北交所基金（如 833171）
    return (
        code.startswith("159")
        or code.startswith("51")
        or code.startswith("56")
        or code.startswith("58")
        or code.startswith("16")
        or code.startswith("8")
        or code.startswith("4")
    )


def parse_ashare_code(symbol):
    """解析 A 股代码，返回 (市场前缀, 6位代码)

    分类规则：
    - 159xxx → sz（深交所 ETF）
    - 51/56/58xxx → sh（上交所 ETF）
    - 16xxx → sz（深交所 ETF）
    - 8/4xxx → bj（北交所）
    - 6xxx → sh（上交所）
    - 0/3xxx → sz（深交所）
    """
    code = symbol.strip().upper()
    if len(code) != 6 and not code.isdigit():
        return None, symbol

    prefix = code[:3]
    if prefix.startswith("159"):
        return "sz", code
    elif prefix.startswith(("51", "56", "58")):
        return "sh", code
    elif prefix.startswith("16"):
        return "sz", code
    elif prefix.startswith(("8", "4")):
        return "bj", code
    elif code.startswith("6"):
        return "sh", code
    elif code.startswith(("0", "3")):
        return "sz", code
    else:
        return None, code


def get_daily_data(symbol):
    """统一获取 A 股日线数据，自动处理 ETF 和不同市场

    Returns:
        dict: 包含 klines 列表，每项含 date/open/high/low/close/vol
              或 {"error": ...} 表示失败
    """
    market, code = parse_ashare_code(symbol)
    if not market:
        return {"error": f"无法识别的 A 股代码: {symbol}"}

    try:
        import json

        if market == "bj":
            # 北交所：使用腾讯接口
            url = f"https://qt.gtimg.cn/q=sh{code}"
            text = _http_get(url, encoding="gbk")
            if not text or "failed" in text:
                return {"error": f"北交所 {symbol} 数据获取失败"}
            return {"klines": [], "raw": text, "market": "bj"}  # 北交所暂不支持 K 线

        elif is_etf(symbol):
            # ETF：使用新浪基金历史数据
            url = (
                f"https://money.finance.sina.com.cn/quotes_service/api/json_v2.php"
                f"/CN_MarketData.getKLineData"
                f"?symbol=sh{code}&scale=240&ma=no&datalen=250"
            )
            text = _http_get(url, encoding="utf-8")
            if not text:
                return {"error": f"ETF {symbol} 历史数据获取失败"}
            klines = json.loads(text) if text.startswith("[") else []
            return {"klines": klines, "market": "etf", "code": code}

        else:
            # 普通股票：使用新浪 K 线接口
            market_prefix = "sh" if market == "sh" else "sz"
            url = (
                f"https://money.finance.sina.com.cn/quotes_service/api/json_v2.php"
                f"/CN_MarketData.getKLineData"
                f"?symbol={market_prefix}{code}&scale=240&ma=no&datalen=250"
            )
            text = _http_get(url, encoding="utf-8")
            if not text:
                return {"error": f"股票 {symbol} 历史数据获取失败"}
            klines = json.loads(text) if text.startswith("[") else []
            return {"klines": klines, "market": "stock", "code": code}

    except Exception as e:
        return {"error": f"获取日线数据失败: {str(e)}"}


def _http_get(url, headers=None, timeout=15, encoding="gbk"):
    """HTTP GET 请求（不使用代理）"""
    if headers is None:
        headers = {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
            "Referer": "https://finance.sina.com.cn",
        }
    try:
        from urllib.request import build_opener, ProxyHandler

        opener = build_opener(ProxyHandler({}))
        req = Request(url, headers=headers)
        with opener.open(req, timeout=timeout) as resp:
            return resp.read().decode(encoding, errors="replace")
    except Exception as e:
        return None


# ═══════════════════════════════════════════════════
# Tool 1: ashare_quote — 实时行情
# ═══════════════════════════════════════════════════


def get_quote(symbol):
    """获取 A 股实时行情"""
    if not is_ashare(symbol):
        return {"error": f"{symbol} 不是 A 股代码"}

    market = get_market_code(normalize_symbol(symbol))
    if not market:
        return {"error": f"无法识别市场: {symbol}"}

    code = symbol if symbol.startswith(("6", "0", "3")) else symbol[:6]
    url = f"https://hq.sinajs.cn/list={market}{code}"

    text = _http_get(url)
    if not text:
        return {"error": "无法获取行情数据（可能网络问题或接口被屏蔽）"}

    try:
        parts = text.strip().split("=")
        if len(parts) < 2:
            return {"error": "行情数据解析失败"}

        data_str = parts[1].strip().strip('";').strip()
        if not data_str or data_str == "failed":
            return {"error": "行情数据为空或无效"}

        fields = data_str.split(",")
        if len(fields) < 10:
            return {"error": f"行情字段不足: {len(fields)}"}

        name = fields[0]
        open_price = float(fields[1]) if fields[1] else 0
        close_price = float(fields[2]) if fields[2] else 0
        current_price = float(fields[3]) if fields[3] else close_price
        high_price = float(fields[4]) if fields[4] else 0
        low_price = float(fields[5]) if fields[5] else 0
        volume = int(fields[8]) if fields[8] else 0
        amount = float(fields[9]) if fields[9] else 0

        change = current_price - close_price
        change_pct = (change / close_price * 100) if close_price > 0 else 0

        return {
            "symbol": symbol,
            "name": name,
            "current_price": round(current_price, 2),
            "change": round(change, 2),
            "change_pct": round(change_pct, 2),
            "open": round(open_price, 2),
            "high": round(high_price, 2),
            "low": round(low_price, 2),
            "close": round(close_price, 2),
            "volume": volume,
            "amount": round(amount, 2),
            "market": market.upper(),
        }
    except Exception as e:
        return {"error": f"解析失败: {str(e)}"}


# ═══════════════════════════════════════════════════
# Tool 2: ashare_technical_levels — 技术指标
# ═══════════════════════════════════════════════════


def calculate_rsi(close, period=14):
    """计算 RSI"""
    delta = close.diff()
    gain = delta.where(delta > 0, 0.0)
    loss = (-delta).where(delta < 0, 0.0)
    avg_gain = gain.rolling(window=period, min_periods=period).mean()
    avg_loss = loss.rolling(window=period, min_periods=period).mean()
    rs = avg_gain / avg_loss
    rsi = 100 - (100 / (1 + rs))
    return rsi


def calculate_ema(series, period):
    """计算 EMA"""
    return series.ewm(span=period, adjust=False).mean()


def calculate_bollinger_bands(close, period=20, std_dev=2):
    """计算布林带"""
    sma = close.rolling(window=period).mean()
    std = close.rolling(window=period).std()
    upper = sma + (std * std_dev)
    lower = sma - (std * std_dev)
    return upper, sma, lower


def calculate_macd(close, fast=12, slow=26, signal=9):
    """计算 MACD"""
    ema_fast = calculate_ema(close, fast)
    ema_slow = calculate_ema(close, slow)
    macd_line = ema_fast - ema_slow
    signal_line = calculate_ema(macd_line, signal)
    histogram = macd_line - signal_line
    return macd_line, signal_line, histogram


def calculate_pivot_points(high, low, close):
    """计算枢轴点"""
    pivot = (high + low + close) / 3
    r1 = 2 * pivot - low
    s1 = 2 * pivot - high
    r2 = pivot + (high - low)
    s2 = pivot - (high - low)
    r3 = high + 2 * (pivot - low)
    s3 = low - 2 * (high - pivot)
    return {
        "R1": round(r1, 2),
        "R2": round(r2, 2),
        "R3": round(r3, 2),
        "Pivot": round(pivot, 2),
        "S1": round(s1, 2),
        "S2": round(s2, 2),
        "S3": round(s3, 2),
    }


def get_technical_levels(symbol):
    """获取技术指标"""
    if not is_ashare(symbol):
        return {"error": f"{symbol} 不是 A 股代码"}

    try:
        data = get_daily_data(symbol)
        if "error" in data:
            return data

        klines = data.get("klines", [])
        if not klines or not isinstance(klines, list):
            return {"error": "K线数据为空或格式错误"}

        closes = []
        highs = []
        lows = []
        vols = []

        for k in klines[-250:]:
            closes.append(float(k["close"]))
            highs.append(float(k["high"]))
            lows.append(float(k["low"]))
            vols.append(int(k.get("volume", 0)))

        close = np.array(closes)
        high = np.array(highs)
        low = np.array(lows)

        def calc_rsi(arr, period=14):
            delta = np.diff(arr)
            gain = np.where(delta > 0, delta, 0)
            loss = np.where(delta < 0, -delta, 0)
            avg_gain = np.convolve(gain, np.ones(period) / period, mode="valid")
            avg_loss = np.convolve(loss, np.ones(period) / period, mode="valid")
            rs = avg_gain / (avg_loss + 1e-10)
            return 100 - (100 / (1 + rs))

        def calc_ema(arr, period):
            alpha = 2.0 / (period + 1)
            ema = [arr[0]]
            for v in arr[1:]:
                ema.append(alpha * v + (1 - alpha) * ema[-1])
            return np.array(ema)

        def calc_bb(arr, period=20, std_dev=2):
            sma = np.convolve(arr, np.ones(period) / period, mode="valid")
            std = np.array(
                [np.std(arr[i : i + period]) for i in range(len(arr) - period + 1)]
            )
            upper = sma + std_dev * std
            lower = sma - std_dev * std
            return upper, sma, lower

        def calc_macd(arr, fast=12, slow=26, signal=9):
            ema_fast = calc_ema(arr, fast)
            ema_slow = calc_ema(arr, slow)
            macd_line = ema_fast - ema_slow
            signal_line = calc_ema(macd_line, signal)
            histogram = macd_line - signal_line
            return macd_line, signal_line, histogram

        rsi_14 = calc_rsi(close, 14)
        rsi_28 = calc_rsi(close, 28)

        ema_5 = calc_ema(close, 5)
        ema_10 = calc_ema(close, 10)
        ema_20 = calc_ema(close, 20)
        ema_60 = calc_ema(close, 60)
        ema_120 = calc_ema(close, 120) if len(close) >= 120 else None
        ema_250 = calc_ema(close, 250) if len(close) >= 250 else None

        bb_upper, bb_middle, bb_lower = calc_bb(close)
        macd_line, macd_signal, macd_hist = calc_macd(close)

        latest_close = close[-1]
        latest_high = high[-1]
        latest_low = low[-1]
        pivot = (latest_high + latest_low + latest_close) / 3
        r1 = 2 * pivot - latest_low
        s1 = 2 * pivot - latest_high
        r2 = pivot + (latest_high - latest_low)
        s2 = pivot - (latest_high - latest_low)
        r3 = latest_high + 2 * (pivot - latest_low)
        s3 = latest_low - 2 * (latest_high - pivot)

        log_ret = np.log(close[1:] / close[:-1])
        vol_20d = np.std(log_ret[-20:]) * np.sqrt(252) if len(log_ret) >= 20 else 0

        return {
            "symbol": symbol,
            "current_price": round(latest_close, 2),
            "rsi": {
                "rsi_14": round(float(rsi_14[-1]), 2),
                "rsi_28": round(float(rsi_28[-1]), 2),
            },
            "ema": {
                "ema_5": round(float(ema_5[-1]), 2),
                "ema_10": round(float(ema_10[-1]), 2),
                "ema_20": round(float(ema_20[-1]), 2),
                "ema_60": round(float(ema_60[-1]), 2),
                "ema_120": round(float(ema_120[-1]), 2)
                if ema_120 is not None and len(ema_120) > 0
                else None,
                "ema_250": round(float(ema_250[-1]), 2)
                if ema_250 is not None and len(ema_250) > 0
                else None,
            },
            "bollinger_bands": {
                "upper": round(float(bb_upper[-1]), 2),
                "middle": round(float(bb_middle[-1]), 2),
                "lower": round(float(bb_lower[-1]), 2),
            },
            "macd": {
                "macd": round(float(macd_line[-1]), 4),
                "signal": round(float(macd_signal[-1]), 4),
                "histogram": round(float(macd_hist[-1]), 4),
            },
            "pivot_points": {
                "R1": round(r1, 2),
                "R2": round(r2, 2),
                "R3": round(r3, 2),
                "Pivot": round(pivot, 2),
                "S1": round(s1, 2),
                "S2": round(s2, 2),
                "S3": round(s3, 2),
            },
            "volatility_20d_annualized_pct": round(float(vol_20d) * 100, 2),
        }
    except Exception as e:
        return {"error": f"技术指标计算失败: {str(e)}"}


# ═══════════════════════════════════════════════════
# Tool 3: ashare_fundamental_scan — 基本面
# ═══════════════════════════════════════════════════


def get_fundamental_scan(symbol):
    """获取基本面数据"""
    if not is_ashare(symbol):
        return {"error": f"{symbol} 不是 A 股代码"}

    if is_etf(symbol):
        return {
            "error": f"{symbol} 是 ETF 基金，无传统基本面数据（PE/PB/ROE 不适用）",
            "symbol": symbol,
        }

    try:
        market, code = parse_ashare_code(symbol)
        if not market:
            return {"error": f"无法识别的代码: {symbol}"}

        url = f"https://qt.gtimg.cn/q={market}{code}"
        text = _http_get(
            url,
            headers={
                "User-Agent": "Mozilla/5.0",
                "Referer": "https://finance.qq.com/",
            },
            encoding="gbk",
        )
        if not text:
            return {"error": "无法获取基本面数据（网络问题）"}

        parts = text.split("~")
        if len(parts) < 55:
            return {"error": f"数据字段不足: {len(parts)}"}

        def safe_float(v):
            try:
                return float(v) if v and v.strip() and v != "-" else None
            except:
                return None

        return {
            "symbol": symbol,
            "name": parts[1] if len(parts) > 1 else "",
            "pe_ttm": safe_float(parts[52]) if len(parts) > 52 else None,
            "pb": safe_float(parts[46]) if len(parts) > 46 else None,
            "roe": safe_float(parts[49]) if len(parts) > 49 else None,
            "market_cap_total": safe_float(parts[44]) if len(parts) > 44 else None,
        }
    except Exception as e:
        return {"error": f"基本面获取失败: {str(e)}"}


# ═══════════════════════════════════════════════════
# Tool 4: ashare_news_sentiment — 新闻与情绪
# ═══════════════════════════════════════════════════


def get_news_sentiment(symbol):
    """获取个股公告/新闻及情绪评分"""
    if not is_ashare(symbol):
        return {"error": f"{symbol} 不是 A 股代码"}

    try:
        stock_code = symbol[:6]
        market = (
            "SHA"
            if symbol.startswith("6")
            else ("SZ" if symbol.startswith(("0", "3")) else "SH")
        )

        url = (
            f"https://np-anotice-stock.eastmoney.com/api/security/ann"
            f"?sr=-1&page_size=10&page_index=1"
            f"&ann_type={market}"
            f"&stock_list={stock_code}"
        )
        text = _http_get(
            url,
            headers={
                "User-Agent": "Mozilla/5.0",
                "Referer": "https://data.eastmoney.com/",
            },
            encoding="utf-8",
        )
        if not text:
            return {"error": "无法获取新闻（网络问题）"}

        import json

        data = json.loads(text)
        if data.get("data", {}).get("list") is None:
            return {"error": "新闻接口返回错误"}

        news_list = []
        for item in data["data"]["list"][:10]:
            news_list.append(
                {
                    "title": item.get("title_ch", ""),
                    "datetime": item.get("notice_date", "")[:19]
                    if item.get("notice_date")
                    else None,
                }
            )

        sentiment_score = 50
        if news_list:
            pos_keywords = [
                "涨",
                "增长",
                "突破",
                "利好",
                "盈利",
                "超预期",
                "买入",
                "增持",
                "提升",
                "分红",
                "送股",
            ]
            neg_keywords = [
                "跌",
                "下降",
                "风险",
                "利空",
                "亏损",
                "不及预期",
                "减持",
                "下调",
                "警告",
                "处罚",
            ]
            title_text = " ".join([n["title"] for n in news_list])
            pos_count = sum(1 for kw in pos_keywords if kw in title_text)
            neg_count = sum(1 for kw in neg_keywords if kw in title_text)
            total = pos_count + neg_count
            if total > 0:
                sentiment_score = min(100, max(0, 50 + (pos_count - neg_count) * 10))

        return {
            "symbol": symbol,
            "news_count": len(news_list),
            "news": news_list,
            "sentiment_score": sentiment_score,
            "sentiment_label": "正面"
            if sentiment_score > 60
            else "负面"
            if sentiment_score < 40
            else "中性",
        }
    except Exception as e:
        return {"error": f"新闻获取失败: {str(e)}", "symbol": symbol}


# ═══════════════════════════════════════════════════
# Tool 5: ashare_market_snapshot — A 股大盘指数
# ═══════════════════════════════════════════════════

INDEX_CODES = {
    "上证指数": "000001",
    "深证成指": "399001",
    "创业板指": "399006",
    "沪深300": "000300",
    "科创50": "000688",
    "上证50": "000016",
    "中证500": "000905",
    "中证1000": "000852",
}


def get_market_snapshot():
    """获取 A 股主要大盘指数行情"""
    if not HAS_DEPS:
        return {"error": "akshare 未安装"}

    try:
        indices = []
        for name, code in INDEX_CODES.items():
            try:
                if code.startswith("0"):
                    market = "sz"
                else:
                    market = "sh"
                url = f"https://hq.sinajs.cn/list={market}{code}"
                text = _http_get(url)
                if text and "failed" not in text:
                    parts = text.strip().split("=")
                    if len(parts) >= 2:
                        data_str = parts[1].strip().strip('";').strip()
                        fields = data_str.split(",")
                        if len(fields) >= 10:
                            current = float(fields[3]) if fields[3] else 0
                            close = float(fields[2]) if fields[2] else 0
                            change = current - close
                            change_pct = (change / close * 100) if close > 0 else 0
                            indices.append(
                                {
                                    "name": name,
                                    "code": code,
                                    "current": round(current, 2),
                                    "change": round(change, 2),
                                    "change_pct": round(change_pct, 2),
                                }
                            )
            except Exception:
                continue

        if not indices:
            return {"error": "无法获取大盘指数数据"}

        return {"indices": indices, "count": len(indices)}
    except Exception as e:
        return {"error": f"大盘指数获取失败: {str(e)}"}


# ═══════════════════════════════════════════════════
# Tool 6: ashare_fund_flow — 资金流向
# ═══════════════════════════════════════════════════


def get_fund_flow(symbol):
    """获取个股资金流向（超大单/大单/中单/小单）

    数据来源：腾讯证券 qt.gtimg.cn
    注意：资金流向数据在部分网络环境下可能不可用。
    """
    if not is_ashare(symbol):
        return {"error": f"{symbol} 不是 A 股代码"}

    try:
        market, code = parse_ashare_code(symbol)
        if not market:
            return {"error": f"无法识别的代码: {symbol}"}

        url = f"https://qt.gtimg.cn/q={market}{code}"
        text = _http_get(
            url,
            headers={
                "User-Agent": "Mozilla/5.0",
                "Referer": "https://finance.qq.com/",
            },
            encoding="gbk",
        )
        if not text:
            return {"error": "无法获取资金流向数据（网络问题）"}

        parts = text.split("~")
        if len(parts) < 50:
            return {"error": f"数据字段不足: {len(parts)}"}

        def safe_float(v, default=0):
            try:
                return float(v) if v and v.strip() and v != "-" else default
            except:
                return default

        return {
            "symbol": symbol,
            "note": "腾讯证券数据，该接口暂不包含详细资金流向字段",
            "price": safe_float(parts[3]) if len(parts) > 3 else None,
            "close": safe_float(parts[4]) if len(parts) > 4 else None,
            "volume": safe_float(parts[36]) if len(parts) > 36 else None,
            "turnover_rate": safe_float(parts[38]) if len(parts) > 38 else None,
        }
    except Exception as e:
        return {"error": f"资金流向获取失败: {str(e)}"}


# ═══════════════════════════════════════════════════
# Tool 7: ashare_lhb — 龙虎榜
# ═══════════════════════════════════════════════════


def get_lhb(date=None):
    """获取龙虎榜数据（指定日期或最新）"""
    if not HAS_DEPS:
        return {"error": "akshare 未安装"}

    try:
        if date:
            df = ak.stock_lhb_detail_em(start_date=date, end_date=date)
        else:
            df = ak.stock_lhb_detail_em(start_date="20250101", end_date="20250125")

        if df is None or df.empty:
            return {"error": "无法获取龙虎榜数据"}

        records = []
        for _, row in df.head(20).iterrows():
            close_val = row.get("收盘价")
            change_val = row.get("涨跌幅")
            buy_val = row.get("龙虎榜买入金额")
            sell_val = row.get("龙虎榜卖出金额")
            records.append(
                {
                    "date": str(row.get("发布日期", ""))[:10]
                    if row.get("发布日期")
                    else None,
                    "code": str(row.get("代码", "")),
                    "name": str(row.get("名称", "")),
                    "close": float(close_val) if close_val is not None else 0,
                    "change_pct": float(change_val) if change_val is not None else 0,
                    "reason": str(row.get("上榜原因", "")),
                    "buy_amount": float(buy_val) if buy_val is not None else 0,
                    "sell_amount": float(sell_val) if sell_val is not None else 0,
                }
            )

        return {"records": records, "count": len(records)}
    except Exception as e:
        return {"error": f"龙虎榜获取失败: {str(e)}"}


# ═══════════════════════════════════════════════════
# MCP 协议处理
# ═══════════════════════════════════════════════════

TOOLS = [
    {
        "name": "ashare_quote",
        "description": "获取 A 股实时行情：价格/涨跌幅/成交量/涨跌额等",
        "inputSchema": {
            "type": "object",
            "properties": {
                "symbol": {
                    "type": "string",
                    "description": "A 股代码，如 600318 或 603318",
                },
            },
            "required": ["symbol"],
        },
    },
    {
        "name": "ashare_technical_levels",
        "description": "获取 A 股技术指标：RSI/EMA/布林带/MACD/枢轴点/波动率",
        "inputSchema": {
            "type": "object",
            "properties": {
                "symbol": {
                    "type": "string",
                    "description": "A 股代码，如 600318 或 603318",
                },
            },
            "required": ["symbol"],
        },
    },
    {
        "name": "ashare_fundamental_scan",
        "description": "获取 A 股基本面：ROE/净利润/营收/PE/PB/每股收益",
        "inputSchema": {
            "type": "object",
            "properties": {
                "symbol": {
                    "type": "string",
                    "description": "A 股代码，如 600318 或 603318",
                },
            },
            "required": ["symbol"],
        },
    },
    {
        "name": "ashare_news_sentiment",
        "description": "获取 A 股新闻及情绪评分",
        "inputSchema": {
            "type": "object",
            "properties": {
                "symbol": {
                    "type": "string",
                    "description": "A 股代码，如 600318 或 603318",
                },
            },
            "required": ["symbol"],
        },
    },
    {
        "name": "ashare_market_snapshot",
        "description": "获取 A 股大盘指数（上证/深证/创业板/沪深300/科创50等）",
        "inputSchema": {
            "type": "object",
            "properties": {},
        },
    },
    {
        "name": "ashare_fund_flow",
        "description": "获取 A 股个股资金流向（超大单/大单/中单/小单净流入）",
        "inputSchema": {
            "type": "object",
            "properties": {
                "symbol": {
                    "type": "string",
                    "description": "A 股代码，如 600318 或 603318",
                },
            },
            "required": ["symbol"],
        },
    },
    {
        "name": "ashare_lhb",
        "description": "获取龙虎榜数据（最近上榜股票）",
        "inputSchema": {
            "type": "object",
            "properties": {
                "date": {
                    "type": "string",
                    "description": "日期，格式 YYYYMMDD，如 20250125",
                },
            },
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
                "serverInfo": {"name": "ashare-mcp-server", "version": "1.0.0"},
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
        symbol = args.get("symbol", "").strip()

        if name in (
            "ashare_quote",
            "ashare_technical_levels",
            "ashare_fundamental_scan",
            "ashare_news_sentiment",
            "ashare_fund_flow",
        ):
            if not symbol:
                return {
                    "jsonrpc": "2.0",
                    "error": {"message": "缺少 symbol"},
                    "id": req_id,
                }

        if name == "ashare_quote":
            result = get_quote(symbol)
        elif name == "ashare_technical_levels":
            result = get_technical_levels(symbol)
        elif name == "ashare_fundamental_scan":
            result = get_fundamental_scan(symbol)
        elif name == "ashare_news_sentiment":
            result = get_news_sentiment(symbol)
        elif name == "ashare_market_snapshot":
            result = get_market_snapshot()
        elif name == "ashare_fund_flow":
            result = get_fund_flow(symbol)
        elif name == "ashare_lhb":
            result = get_lhb(args.get("date"))
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
