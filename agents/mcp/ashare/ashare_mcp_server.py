#!/usr/bin/env python3
"""ashare-mcp-server — A 股数据 MCP Server，使用 akshare 提供行情/技术面/基本面/新闻数据"""

import json
import logging
import os
import re
import subprocess
import sys
from datetime import datetime, timedelta

logger = logging.getLogger(__name__)

os.environ.pop("HTTP_PROXY", None)
os.environ.pop("HTTPS_PROXY", None)
os.environ.pop("http_proxy", None)
os.environ.pop("https_proxy", None)
os.environ.pop("ALL_PROXY", None)
os.environ.pop("all_proxy", None)

from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

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
        from urllib.request import ProxyHandler, build_opener

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
            std = np.array([np.std(arr[i : i + period]) for i in range(len(arr) - period + 1)])
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
                "ema_120": round(float(ema_120[-1]), 2) if ema_120 is not None and len(ema_120) > 0 else None,
                "ema_250": round(float(ema_250[-1]), 2) if ema_250 is not None and len(ema_250) > 0 else None,
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
            except Exception as e:
                logger.debug("safe_float parsing error: %s", e, exc_info=True)
                return None

        base_result = {
            "symbol": symbol,
            "name": parts[1] if len(parts) > 1 else "",
            "pe_ttm": safe_float(parts[52]) if len(parts) > 52 else None,
            "pb": safe_float(parts[46]) if len(parts) > 46 else None,
            "roe": safe_float(parts[49]) if len(parts) > 49 else None,
            "market_cap_total": safe_float(parts[44]) if len(parts) > 44 else None,
        }

        # ── 使用 AKShare 补充财务数据 ──
        extra = {}
        if HAS_DEPS:
            try:
                # 个股信息（含 EPS、每股净资产、总市值、流通市值等）
                df_info = ak.stock_individual_info_em(symbol=code)
                if df_info is not None and not df_info.empty:
                    info_dict = {}
                    for _, row in df_info.iterrows():
                        key = str(row.iloc[0]).strip() if len(row) > 0 else ""
                        val = row.iloc[1] if len(row) > 1 else None
                        info_dict[key] = val

                    def safe_info_float(d, *keys):
                        for k in keys:
                            if k in d and d[k] is not None:
                                try:
                                    return float(d[k])
                                except (ValueError, TypeError):
                                    continue
                        return None

                    extra["eps"] = safe_info_float(info_dict, "每股收益", "每股收益(元)")
                    extra["bvps"] = safe_info_float(info_dict, "每股净资产", "每股净资产(元)")
                    extra["total_shares"] = safe_info_float(info_dict, "总股本", "总股本(股)")
                    extra["float_shares"] = safe_info_float(info_dict, "流通股", "流通股(股)")
            except Exception as e:
                logger.debug("stock_individual_info_em failed: %s", e)

            try:
                # 财务摘要（含营收、净利润、毛利率等）
                df_fin = ak.stock_financial_abstract_ths(symbol=code, indicator="按年度")
                if df_fin is not None and not df_fin.empty:
                    latest = df_fin.iloc[0]
                    cols = df_fin.columns.tolist()

                    def find_col(*names):
                        for n in names:
                            for c in cols:
                                if n in c:
                                    return c
                        return None

                    rev_col = find_col("营业总收入", "营业收入")
                    ni_col = find_col("净利润", "归母净利润")
                    gm_col = find_col("毛利率", "销售毛利率")
                    om_col = find_col("营业利润率", "营业利润")
                    debt_col = find_col("资产负债率")
                    cur_col = find_col("流动比率")
                    eps_col = find_col("基本每股收益", "每股收益")

                    def safe_series_float(col_name):
                        if col_name and col_name in cols:
                            val = latest.get(col_name)
                            if val is not None:
                                try:
                                    return float(val)
                                except (ValueError, TypeError):
                                    pass
                        return None

                    rev = safe_series_float(rev_col)
                    ni = safe_series_float(ni_col)
                    gm = safe_series_float(gm_col)
                    om = safe_series_float(om_col)
                    dr = safe_series_float(debt_col)
                    cr = safe_series_float(cur_col)
                    eps_from_fin = safe_series_float(eps_col)

                    if rev is not None:
                        extra["revenue"] = rev
                    if ni is not None:
                        extra["net_income"] = ni
                    if gm is not None:
                        extra["gross_margin_pct"] = gm
                    if om is not None:
                        extra["operating_margin_pct"] = om
                    if dr is not None:
                        extra["debt_ratio_pct"] = dr
                    if cr is not None:
                        extra["current_ratio"] = cr
                    if eps_from_fin is not None and "eps" not in extra:
                        extra["eps"] = eps_from_fin

                    # YoY growth
                    if len(df_fin) >= 2:
                        prev = df_fin.iloc[1]
                        if rev_col and rev is not None:
                            try:
                                prev_rev = float(prev.get(rev_col, 0))
                                if prev_rev and prev_rev != 0:
                                    extra["revenue_yoy_pct"] = round((rev - prev_rev) / abs(prev_rev) * 100, 2)
                            except (ValueError, TypeError):
                                pass
                        if ni_col and ni is not None:
                            try:
                                prev_ni = float(prev.get(ni_col, 0))
                                if prev_ni and prev_ni != 0:
                                    extra["net_income_yoy_pct"] = round((ni - prev_ni) / abs(prev_ni) * 100, 2)
                            except (ValueError, TypeError):
                                pass
            except Exception as e:
                logger.debug("stock_financial_abstract_ths failed: %s", e)

            try:
                # 股息率
                df_div = ak.stock_fhps_em(symbol=code)
                if df_div is not None and not df_div.empty:
                    for _, row in df_div.head(3).iterrows():
                        div_cols = df_div.columns.tolist()
                        div_col = None
                        for c in div_cols:
                            if "股息" in c or "每股派" in c:
                                div_col = c
                                break
                        if div_col:
                            div_val = row.get(div_col)
                            if div_val is not None:
                                try:
                                    dv = float(div_val)
                                    if dv > 0:
                                        extra["dividend_per_share"] = dv
                                        # 计算股息率
                                        cur_price = safe_float(parts[3]) if len(parts) > 3 else None
                                        if cur_price and cur_price > 0:
                                            extra["dividend_yield_pct"] = round(dv / cur_price * 100, 2)
                                        break
                                except (ValueError, TypeError):
                                    continue
            except Exception as e:
                logger.debug("stock_fhps_em failed: %s", e)

        # 标记未能获取的字段为 N/A
        for field in [
            "revenue",
            "net_income",
            "eps",
            "dividend_yield_pct",
            "debt_ratio_pct",
            "current_ratio",
            "gross_margin_pct",
            "operating_margin_pct",
            "revenue_yoy_pct",
            "net_income_yoy_pct",
        ]:
            if field not in extra:
                extra[field] = "N/A"

        base_result.update(extra)
        return base_result

    except Exception as e:
        return {"error": f"基本面获取失败: {str(e)}"}


# ═══════════════════════════════════════════════════
# Tool 4: ashare_news_sentiment — 新闻与情绪
# ═══════════════════════════════════════════════════


def _calc_sentiment_score(text):
    """基于关键词匹配计算情绪评分 (0-100)，50 为中性"""
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
        "大涨",
        "涨停",
        "创新高",
        "强势",
        "回暖",
        "复苏",
        "翻倍",
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
        "大跌",
        "跌停",
        "爆雷",
        "退市",
        "违规",
        "暴跌",
        "崩盘",
        "清仓",
    ]
    pos_count = sum(1 for kw in pos_keywords if kw in text)
    neg_count = sum(1 for kw in neg_keywords if kw in text)
    total = pos_count + neg_count
    if total == 0:
        return 50
    return min(100, max(0, 50 + (pos_count - neg_count) * 10))


def get_news_sentiment(symbol):
    """获取个股新闻及情绪评分（含市场整体情绪加权）"""
    if not is_ashare(symbol):
        return {"error": f"{symbol} 不是 A 股代码"}

    try:
        stock_code = symbol[:6]

        # ── 个股新闻: ak.stock_news_em ──
        try:
            df_news = ak.stock_news_em(symbol=stock_code)
        except Exception:
            df_news = pd.DataFrame()

        news_list = []
        if not df_news.empty:
            cols = df_news.columns.tolist()
            title_col = "新闻标题" if "新闻标题" in cols else cols[1] if len(cols) > 1 else cols[0]
            time_col = "发布时间" if "发布时间" in cols else cols[2] if len(cols) > 2 else None
            source_col = "文章来源" if "文章来源" in cols else cols[3] if len(cols) > 3 else None
            content_col = "新闻内容" if "新闻内容" in cols else cols[4] if len(cols) > 4 else None

            for _, row in df_news.head(20).iterrows():
                item = {
                    "title": str(row.get(title_col, "")),
                    "datetime": str(row[time_col])[:19] if time_col and pd.notna(row.get(time_col)) else None,
                    "source": str(row[source_col]) if source_col and pd.notna(row.get(source_col)) else None,
                }
                if content_col and pd.notna(row.get(content_col)):
                    item["summary"] = str(row[content_col])[:200]
                news_list.append(item)

        # ── 个股情绪 ──
        stock_title_text = " ".join([n["title"] for n in news_list])
        stock_sentiment = _calc_sentiment_score(stock_title_text)

        # ── 市场全局新闻: ak.stock_info_global_em ──
        market_sentiment = 50
        market_news_count = 0
        try:
            df_global = ak.stock_info_global_em()
            if not df_global.empty:
                gcols = df_global.columns.tolist()
                g_title_col = "标题" if "标题" in gcols else gcols[1] if len(gcols) > 1 else gcols[0]
                g_summary_col = "摘要" if "摘要" in gcols else gcols[2] if len(gcols) > 2 else None
                g_time_col = "发布时间" if "发布时间" in gcols else gcols[3] if len(gcols) > 3 else None

                market_headlines = []
                for _, row in df_global.head(30).iterrows():
                    headline = str(row.get(g_title_col, ""))
                    if g_summary_col and pd.notna(row.get(g_summary_col)):
                        headline += " " + str(row[g_summary_col])[:100]
                    market_headlines.append(headline)

                market_news_count = len(market_headlines)
                market_text = " ".join(market_headlines)
                market_sentiment = _calc_sentiment_score(market_text)
        except Exception as e:
            logger.debug(f"市场全局新闻获取失败: {e}")

        # ── 加权情绪 ──
        final_sentiment = round(0.7 * stock_sentiment + 0.3 * market_sentiment, 1)

        return {
            "symbol": symbol,
            "news_count": len(news_list),
            "news": news_list,
            "stock_sentiment": stock_sentiment,
            "market_sentiment": market_sentiment,
            "market_news_count": market_news_count,
            "sentiment_score": final_sentiment,
            "sentiment_label": "正面" if final_sentiment > 60 else "负面" if final_sentiment < 40 else "中性",
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
                market = "sz" if code.startswith("0") else "sh"
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
        text = _http_get(
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


def get_lhb(date=None):
    """获取龙虎榜数据（指定日期或最新）"""
    if not HAS_DEPS:
        return {"error": "akshare 未安装"}

    try:
        if date:
            df = ak.stock_lhb_detail_em(start_date=date, end_date=date)
        else:
            end_date = datetime.now().strftime("%Y%m%d")
            start_date = (datetime.now() - timedelta(days=30)).strftime("%Y%m%d")
            df = ak.stock_lhb_detail_em(start_date=start_date, end_date=end_date)

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
                    "date": str(row.get("发布日期", ""))[:10] if row.get("发布日期") else None,
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
# Tool 8: ashare_sector_rotation — 板块轮动分析
# ═══════════════════════════════════════════════════


def get_sector_rotation(period="近5日"):
    """获取 A 股板块轮动分析（行业板块涨跌幅排名 + 轮动信号）

    Args:
        period: 分析周期，可选 "近1日"/"近5日"/"近10日"/"近20日"
    """
    if not HAS_DEPS:
        return {"error": "akshare 未安装"}

    try:
        # 获取行业板块列表
        df_industries = ak.stock_board_industry_name_em()
        if df_industries is None or df_industries.empty:
            return {"error": "无法获取行业板块列表"}

        cols = df_industries.columns.tolist()
        name_col = None
        for c in cols:
            if "板块名称" in c or "名称" in c:
                name_col = c
                break
        if not name_col:
            name_col = cols[0]

        # 收集各板块近期涨跌幅
        sector_data = []
        for _, row in df_industries.head(30).iterrows():
            sector_name = str(row[name_col])
            try:
                df_hist = ak.stock_board_industry_hist_em(
                    symbol=sector_name,
                    period="日k",
                    start_date="20200101",
                    end_date="20991231",
                )
                if df_hist is None or df_hist.empty:
                    continue

                hcols = df_hist.columns.tolist()
                pct_col = None
                for c in hcols:
                    if "涨跌幅" in c or "涨幅" in c:
                        pct_col = c
                        break
                if not pct_col:
                    continue

                # 计算不同周期涨跌幅
                pcts = df_hist[pct_col].dropna()
                if len(pcts) < 1:
                    continue

                pct_1d = float(pcts.iloc[-1])
                pct_5d = float(pcts.tail(5).sum()) if len(pcts) >= 5 else pct_1d
                pct_10d = float(pcts.tail(10).sum()) if len(pcts) >= 10 else pct_5d
                pct_20d = float(pcts.tail(20).sum()) if len(pcts) >= 20 else pct_10d

                # 动量信号：近期加速 vs 减速
                recent_5 = float(pcts.tail(5).sum()) if len(pcts) >= 5 else 0
                prev_5 = float(pcts.iloc[-10:-5].sum()) if len(pcts) >= 10 else 0
                momentum = recent_5 - prev_5

                sector_data.append(
                    {
                        "name": sector_name,
                        "pct_1d": round(pct_1d, 2),
                        "pct_5d": round(pct_5d, 2),
                        "pct_10d": round(pct_10d, 2),
                        "pct_20d": round(pct_20d, 2),
                        "momentum": round(momentum, 2),
                    }
                )
            except Exception:
                continue

        if not sector_data:
            return {"error": "无法获取板块数据"}

        # 按指定周期排序
        period_key = {
            "近1日": "pct_1d",
            "近5日": "pct_5d",
            "近10日": "pct_10d",
            "近20日": "pct_20d",
        }.get(period, "pct_5d")

        sector_data.sort(key=lambda x: x[period_key], reverse=True)

        top_sectors = sector_data[:5]
        bottom_sectors = sector_data[-5:]

        # 轮动信号：按动量排序
        sector_data.sort(key=lambda x: x["momentum"], reverse=True)
        gaining_momentum = [s for s in sector_data[:5]]
        losing_momentum = [s for s in sector_data[-5:]]

        return {
            "period": period,
            "top_sectors": top_sectors,
            "bottom_sectors": bottom_sectors,
            "rotation_signal": {
                "gaining_momentum": gaining_momentum,
                "losing_momentum": losing_momentum,
            },
            "total_sectors_analyzed": len(sector_data),
        }
    except Exception as e:
        return {"error": f"板块轮动分析失败: {str(e)}"}


# ═══════════════════════════════════════════════════
# Tool 9: ashare_fund_flow_real — 实时资金流向
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


def get_market_breadth():
    """获取 A 股市场广度：涨跌家数、涨停跌停、市场情绪

    使用 AKShare:
    - stock_market_activity_legu: 涨跌家数
    - stock_zt_pool_em: 涨停池
    - stock_dt_pool_em: 跌停池
    """
    if not HAS_DEPS:
        return {"error": "akshare 未安装"}

    try:
        today = datetime.now().strftime("%Y%m%d")

        # 涨跌家数
        advance_count = 0
        decline_count = 0
        flat_count = 0
        try:
            df_activity = ak.stock_market_activity_legu()
            if df_activity is not None and not df_activity.empty:
                acols = df_activity.columns.tolist()
                for c in acols:
                    if "上涨" in c and "家" in c:
                        vals = df_activity[c].dropna()
                        if len(vals) > 0:
                            advance_count = int(float(vals.iloc[-1]))
                    elif "下跌" in c and "家" in c:
                        vals = df_activity[c].dropna()
                        if len(vals) > 0:
                            decline_count = int(float(vals.iloc[-1]))
                    elif "平盘" in c:
                        vals = df_activity[c].dropna()
                        if len(vals) > 0:
                            flat_count = int(float(vals.iloc[-1]))
        except Exception:
            pass

        # 涨停家数
        limit_up_count = 0
        limit_up_list = []
        try:
            df_zt = ak.stock_zt_pool_em(date=today)
            if df_zt is not None and not df_zt.empty:
                limit_up_count = len(df_zt)
                zcols = df_zt.columns.tolist()
                name_col = "名称" if "名称" in zcols else (zcols[1] if len(zcols) > 1 else zcols[0])
                code_col = "代码" if "代码" in zcols else (zcols[0] if len(zcols) > 0 else None)
                for _, row in df_zt.head(10).iterrows():
                    item = {"name": str(row.get(name_col, ""))}
                    if code_col:
                        item["code"] = str(row.get(code_col, ""))
                    limit_up_list.append(item)
        except Exception:
            pass

        # 跌停家数
        limit_down_count = 0
        limit_down_list = []
        try:
            df_dt = ak.stock_dt_pool_em(date=today)
            if df_dt is not None and not df_dt.empty:
                limit_down_count = len(df_dt)
                dcols = df_dt.columns.tolist()
                name_col = "名称" if "名称" in dcols else (dcols[1] if len(dcols) > 1 else dcols[0])
                code_col = "代码" if "代码" in dcols else (dcols[0] if len(dcols) > 0 else None)
                for _, row in df_dt.head(10).iterrows():
                    item = {"name": str(row.get(name_col, ""))}
                    if code_col:
                        item["code"] = str(row.get(code_col, ""))
                    limit_down_list.append(item)
        except Exception:
            pass

        # 计算指标
        total = advance_count + decline_count + flat_count
        ad_ratio = round(advance_count / decline_count, 2) if decline_count > 0 else None

        # 市场情绪判定
        if ad_ratio is not None:
            if ad_ratio > 2:
                sentiment = "强势"
            elif ad_ratio > 1.2:
                sentiment = "偏多"
            elif ad_ratio > 0.8:
                sentiment = "中性"
            elif ad_ratio > 0.5:
                sentiment = "偏空"
            else:
                sentiment = "弱势"
        else:
            sentiment = "未知"

        return {
            "advance_count": advance_count,
            "decline_count": decline_count,
            "flat_count": flat_count,
            "total": total,
            "advance_decline_ratio": ad_ratio,
            "limit_up_count": limit_up_count,
            "limit_up_list": limit_up_list,
            "limit_down_count": limit_down_count,
            "limit_down_list": limit_down_list,
            "market_sentiment": sentiment,
            "date": today,
        }
    except Exception as e:
        return {"error": f"市场广度获取失败: {str(e)}"}


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
        "description": "获取 A 股基本面：ROE/净利润/营收/PE/PB/每股收益/股息率/资产负债率/流动比率/毛利率/营业利润率/同比增速",
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
        "name": "ashare_market_breadth",
        "description": "获取 A 股市场广度：涨跌家数、涨停/跌停家数、涨跌家数比、市场情绪",
        "inputSchema": {
            "type": "object",
            "properties": {},
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

        if (
            name
            in (
                "ashare_quote",
                "ashare_technical_levels",
                "ashare_fundamental_scan",
                "ashare_news_sentiment",
                "ashare_fund_flow",
                "ashare_fund_flow_real",
            )
            and not symbol
        ):
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
        elif name == "ashare_sector_rotation":
            result = get_sector_rotation(args.get("period", "近5日"))
        elif name == "ashare_fund_flow_real":
            result = get_fund_flow_real(symbol)
        elif name == "ashare_market_breadth":
            result = get_market_breadth()
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
