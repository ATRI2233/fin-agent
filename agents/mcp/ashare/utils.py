"""Shared utilities for ashare MCP server."""

import json
import os
import subprocess
import sys

from urllib.request import Request, build_opener, ProxyHandler


def _run_akshare(script):
    """Run akshare code in a clean environment, return JSON result."""
    clean_env = dict(os.environ)
    for k in ["HTTP_PROXY", "HTTPS_PROXY", "http_proxy", "https_proxy", "ALL_PROXY", "all_proxy", "NO_PROXY"]:
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


def http_get(url, headers=None, timeout=15, encoding="gbk"):
    """HTTP GET request without proxy."""
    if headers is None:
        headers = {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
            "Referer": "https://finance.sina.com.cn",
        }
    try:
        opener = build_opener(ProxyHandler({}))
        req = Request(url, headers=headers)
        with opener.open(req, timeout=timeout) as resp:
            return resp.read().decode(encoding, errors="replace")
    except Exception:
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

        elif is_etf(symbol):
            url = (
                f"https://money.finance.sina.com.cn/quotes_service/api/json_v2.php"
                f"/CN_MarketData.getKLineData"
                f"?symbol=sh{code}&scale=240&ma=no&datalen=250"
            )
            text = http_get(url, encoding="utf-8")
            if not text:
                return {"error": f"ETF {symbol} history fetch failed"}
            klines = _json.loads(text) if text.startswith("[") else []
            return {"klines": klines, "market": "etf", "code": code}

        else:
            market_prefix = "sh" if market == "sh" else "sz"
            url = (
                f"https://money.finance.sina.com.cn/quotes_service/api/json_v2.php"
                f"/CN_MarketData.getKLineData"
                f"?symbol={market_prefix}{code}&scale=240&ma=no&datalen=250"
            )
            text = http_get(url, encoding="utf-8")
            if not text:
                return {"error": f"Stock {symbol} history fetch failed"}
            klines = _json.loads(text) if text.startswith("[") else []
            return {"klines": klines, "market": "stock", "code": code}

    except Exception as e:
        return {"error": f"Daily data fetch failed: {str(e)}"}
