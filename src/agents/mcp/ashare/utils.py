"""Shared utilities for ashare MCP server."""

import logging

import requests
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry

_logger = logging.getLogger(__name__)


def retry_akshare(func, *args, retries=3, **kwargs):
    """Call an akshare function with retry on transient errors.

    akshare internally uses bare ``requests.get`` against eastmoney APIs
    which aggressively rate-limit, causing frequent RemoteDisconnected,
    timeout, and chunked-encoding errors. We wrap the call here because
    we cannot patch akshare internals.
    """
    import time as _time

    for attempt in range(retries):
        try:
            return func(*args, **kwargs)
        except (
            requests.ConnectionError,
            requests.exceptions.ChunkedEncodingError,
            requests.exceptions.Timeout,
            ConnectionResetError,
            TimeoutError,
        ) as e:
            _logger.warning("akshare %s attempt %d/%d failed: %s", func.__name__, attempt + 1, retries, e)
            if attempt < retries - 1:
                _time.sleep(2 * (attempt + 1))
        except Exception:
            raise
    return None

# Module-level session with connection pooling and auto-retry.
# Eastmoney API aggressively rate-limits; bare urllib drops ~90% of requests.
# requests.Session reuses TCP connections and the Retry adapter handles
# transient RemoteDisconnected / 5xx errors with exponential backoff.
_session = requests.Session()
_retry = Retry(
    total=3,
    backoff_factor=1,
    status_forcelist=[500, 502, 503, 504],
    allowed_methods=["GET"],
)
_session.mount("https://", HTTPAdapter(max_retries=_retry, pool_connections=2, pool_maxsize=2))
_session.mount("http://", HTTPAdapter(max_retries=_retry, pool_connections=2, pool_maxsize=2))
# Strip any system proxy — matches the original ProxyHandler({}) intent.
_session.trust_env = False


def is_ashare(symbol):
    """Check if symbol is an A-share stock (including ETFs)."""
    code = symbol.strip().upper()
    return (
        code.startswith(("6", "0", "3"))
        or code.startswith("159")
        or code.startswith(("51", "56", "58"))
        or code.startswith("16")
        or code.startswith(("8", "4"))
    )


def normalize_symbol(symbol):
    """Normalize A-share symbol: add market suffix."""
    symbol = symbol.strip().upper()
    if is_ashare(symbol):
        market, code = parse_ashare_code(symbol)
        if market:
            suffix = {"sh": ".SS", "sz": ".SZ", "bj": ".BJ"}.get(market, "")
            return code + suffix
    return symbol


def get_market_code(symbol):
    """Get market prefix from symbol suffix."""
    if symbol.endswith(".SS"):
        return "sh"
    elif symbol.endswith(".SZ"):
        return "sz"
    elif symbol.endswith(".BJ"):
        return "bj"
    return None


def is_etf(symbol):
    """Check if symbol is an ETF fund."""
    code = symbol.strip().upper()
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
    """Parse A-share symbol into (market_prefix, 6-digit_code).

    Classification:
    - 159xxx -> sz (Shenzhen ETF)
    - 51/56/58xxx -> sh (Shanghai ETF)
    - 16xxx -> sz (Shenzhen ETF)
    - 8/4xxx -> bj (Beijing)
    - 6xxx -> sh (Shanghai)
    - 0/3xxx -> sz (Shenzhen)
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


def http_get(url, headers=None, timeout=15, encoding="gbk", retries=3):
    """HTTP GET request using requests.Session with connection pooling and retry."""
    if headers is None:
        headers = {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
            "Referer": "https://finance.sina.com.cn",
        }
    try:
        resp = _session.get(url, headers=headers, timeout=timeout)
        resp.raise_for_status()
        return resp.content.decode(encoding, errors="replace")
    except Exception as e:
        _logger.warning("http_get failed for %s: %s", url[:80], e)
        return None


def get_daily_data(symbol):
    """Get daily OHLCV data for A-share symbol.

    Returns dict with 'klines' list, or {'error': ...} on failure.
    """
    import json as _json

    market, code = parse_ashare_code(symbol)
    if not market:
        return {"error": f"Unrecognized A-share code: {symbol}"}

    try:
        if market == "bj":
            url = f"https://qt.gtimg.cn/q=sh{code}"
            text = http_get(url, encoding="gbk")
            if not text or "failed" in text:
                return {"error": f"Beijing exchange {symbol} data fetch failed"}
            return {"klines": [], "raw": text, "market": "bj"}

        else:
            # Unified kline parsing for ETFs and stocks — same API endpoint, same response format.
            market_prefix = "sh" if market == "sh" else "sz"
            url = (
                f"https://money.finance.sina.com.cn/quotes_service/api/json_v2.php"
                f"/CN_MarketData.getKLineData"
                f"?symbol={market_prefix}{code}&scale=240&ma=no&datalen=250"
            )
            text = http_get(url, encoding="utf-8")
            if not text:
                return {"error": f"Market data fetch failed for {symbol}"}
            klines = _json.loads(text) if text.startswith("[") else []
            market_type = "etf" if is_etf(symbol) else "stock"
            return {"klines": klines, "market": market_type, "code": code}

    except Exception as e:
        return {"error": f"Daily data fetch failed: {str(e)}"}
