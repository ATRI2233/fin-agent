#!/bin/bash
#==============================================================================
# fin-agent-astrbot-install.sh
# 将 fin-agent MCP Server 及相关外部 MCP Server 接入 AstrBot
#
# 包含：fin-agent-mcp-server, fred-mcp, risk-mcp
# 使用方式: ./fin-agent-astrbot-install.sh [--uninstall]
#==============================================================================

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
FIN_AGENT_DIR="$SCRIPT_DIR/fin-agent-mcp-server"
MCP_SERVERS_BASE="$(dirname "$SCRIPT_DIR")/mcp_servers"

FIN_AGENT_NAME="fin-agent"
FRED_MCP_NAME="fred-mcp"
RISK_MCP_NAME="risk-mcp"
ASHARE_MCP_NAME="ashare-mcp"

SKILL_NAMES=("market-briefing" "stock-deep" "fin-review" "position-watch")
SKILL_SOURCE_BASE="$SCRIPT_DIR/fin-agent-skill"

IS_WINDOWS=false
if [[ "$OSTYPE" == "msys" || "$OSTYPE" == "win32" || "$(uname -s)" == *"MINGW"* ]]; then
    IS_WINDOWS=true
fi

# ---------- 帮助 ----------
usage() {
    echo "Usage: $0 [OPTIONS]"
    echo "OPTIONS:"
    echo "  --astrbot-data PATH   AstrBot 数据目录 (默认: 自动检测)"
    echo "  --uninstall           卸载 fin-agent (停止接入)"
    echo "  --update              更新 fin-agent (git pull + 重建 + 更新 skills)"
    echo "  --help                显示帮助"
}

# ---------- 检测 AstrBot 数据目录 ----------
detect_astrbot_data() {
    if [[ -n "$ASTRBOT_ROOT" ]]; then
        echo "$ASTRBOT_ROOT/data"
        return 0
    fi

    local candidates=()
    if $IS_WINDOWS; then
        local userprofile="${USERPROFILE:-$(eval echo ~)}"
        candidates+=("$userprofile/.astrbot/data")
    else
        candidates+=("$HOME/.astrbot/data")
    fi
    candidates+=("$(pwd)/data")

    for cand in "${candidates[@]}"; do
        if [[ -d "$cand" && -f "$cand/mcp_server.json" || -d "$cand" && -f "$cand/cmd_config.json" ]]; then
            echo "$cand"
            return 0
        fi
    done

    for cand in "${candidates[@]}"; do
        if [[ -d "$cand" ]]; then
            echo "$cand"
            return 0
        fi
    done

    echo "ERROR: 无法自动检测 AstrBot 数据目录，请使用 --astrbot-data 指定" >&2
    exit 1
}

# ---------- 安装 Node.js 依赖 ----------
install_npm_deps() {
    local dir="$1"
    if [[ ! -d "$dir/node_modules" ]]; then
        echo "      安装 npm 依赖 ..."
        (cd "$dir" && npm install)
    fi
}

# ---------- 克隆 fred-mcp ----------
install_fred_mcp() {
    local target_dir="$MCP_SERVERS_BASE/fred-mcp-server"
    if [[ ! -d "$target_dir/.git" ]]; then
        echo "      克隆 fred-mcp-server ..."
        rm -rf "$target_dir"
        git clone https://github.com/stefanoamorelli/fred-mcp-server.git "$target_dir" 2>/dev/null || {
            echo "      警告: fred-mcp clone 失败，将跳过"
            return 0
        }
    else
        echo "      fred-mcp-server 已存在"
    fi

    if [[ -f "$target_dir/package.json" ]]; then
        install_npm_deps "$target_dir"
        if [[ -f "$target_dir/build/index.js" ]]; then
            echo "      fred-mcp build 已存在"
        elif [[ -f "$target_dir/tsconfig.json" ]]; then
            echo "      构建 fred-mcp ..."
            (cd "$target_dir" && npm run build 2>/dev/null) || echo "      fred-mcp 构建跳过"
        fi
    fi
    echo "      fred-mcp-server 完成"
}

# ---------- 安装 Python 依赖 (兼容 python3 -m pip) ----------
install_python_deps() {
    local pkg="$1"
    python3 -m pip install "$pkg" -q 2>/dev/null || pip install "$pkg" -q 2>/dev/null || pip install "$pkg"
}

# ---------- 创建 risk-mcp (3 tools) ----------
install_risk_mcp() {
    local target_dir="$MCP_SERVERS_BASE/risk-mcp"
    local target_file="$target_dir/risk-mcp-server.py"

    if [[ -f "$target_file" ]]; then
        echo "      risk-mcp-server.py 已存在"
        return 0
    fi

    mkdir -p "$target_dir"

    echo "      安装 Python 依赖 ..."
    install_python_deps "yfinance"
    install_python_deps "numpy"
    install_python_deps "pandas"

    echo "      创建 risk-mcp-server.py (3 tools: risk_gauge, position_sizing, institutional_flow) ..."

    cat > "$target_file" << 'RISKEOF'
#!/usr/bin/env python3
"""risk-mcp-server - 本地风控计算 + 仓位管理 + 机构持仓 MCP Server"""
import json, sys, os

try:
    import yfinance as yf
    import numpy as np
    import pandas as pd
    HAS_DEPS = True
except ImportError:
    HAS_DEPS = False


def _close_series(data):
    c = data["Close"]
    return c.squeeze() if isinstance(c, pd.DataFrame) else c


def base_result(symbol):
    return {"symbol": symbol}


def error_result(symbol, msg):
    return {**base_result(symbol), "error": msg}


# --- Tool 1: risk_gauge --------------------------

def calculate_risk(symbol):
    if not HAS_DEPS:
        return error_result(symbol, "yfinance/numpy not installed. Run: pip install yfinance numpy pandas")
    try:
        data = yf.download(symbol, period="1y", progress=False, timeout=30)
        if data.empty or len(data) < 60:
            return {**base_result(symbol), "error": "Insufficient data (need >=60 days)", "risk_level": "unknown"}
        close = _close_series(data).dropna()
        price = float(close.iloc[-1])
        high_52w = float(close.rolling(252).max().iloc[-1])
        drawdown = (price - high_52w) / high_52w if high_52w > 0 else 0
        log_ret = np.log(close / close.shift(1)).dropna()
        vol_20d = round(float(log_ret.tail(20).std() * np.sqrt(252)) * 100, 2)
        vol_60d = round(float(log_ret.tail(60).std() * np.sqrt(252)) * 100, 2)
        var_95 = round(abs(float(np.percentile(log_ret.tail(60), 5))) * 100, 2)
        drawdown_pct = round(drawdown * 100, 2)
        warnings = []
        risk_level = "low"
        if vol_20d > 40:
            warnings.append(f"高波动率: {vol_20d}% (>40%)"); risk_level = "high"
        elif vol_20d > 25:
            risk_level = "medium"
        if drawdown_pct < -20:
            warnings.append(f"深度回抽: {drawdown_pct}% (<-20%)"); risk_level = "high"
        elif drawdown_pct < -15:
            risk_level = "medium"
        if var_95 > 3:
            warnings.append(f"高VaR: {var_95}% (>3%单日最大预期亏损)")
        levels = {"high": "HIGH - 降低仓位", "medium": "MEDIUM - 轻仓试探", "low": "LOW - 正常操作范围"}
        warnings.append(f"风险等级: {levels[risk_level]}")
        return {"symbol": symbol, "last_price": round(price, 2), "volatility_20d_pct": vol_20d,
                "volatility_60d_pct": vol_60d, "drawdown_from_52w_high_pct": drawdown_pct,
                "var_95_daily_pct": var_95, "risk_level": risk_level, "warnings": warnings}
    except Exception as e:
        return error_result(symbol, str(e))


# --- Tool 2: position_sizing ---------------------

def calculate_position(symbol, expected_return=None, risk_free_rate=0.05, kelly_fraction=0.25):
    if not HAS_DEPS:
        return error_result(symbol, "yfinance/numpy not installed")
    try:
        data = yf.download(symbol, period="1y", progress=False, timeout=30)
        if data.empty or len(data) < 120:
            return {**base_result(symbol), "error": "Insufficient data (need >=120 days)", "confidence": "low"}
        close = _close_series(data).dropna()
        price = float(close.iloc[-1])
        log_ret = np.log(close / close.shift(1)).dropna()
        annual_vol = float(log_ret.std() * np.sqrt(252))
        annual_ret = float(log_ret.mean() * 252)
        exp_ret = expected_return if expected_return is not None else annual_ret
        excess = exp_ret - risk_free_rate
        variance = annual_vol ** 2
        kelly_pct = round(min(max(excess / variance, 0), kelly_fraction) * 100, 2) if variance > 0 else 0
        vol_target = round(min((0.20 / annual_vol) * 100, 100), 2) if annual_vol > 0 else 100
        recommended = round(min(kelly_pct, vol_target), 2)
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
        return {"symbol": symbol, "last_price": round(price, 2),
                "annualized_volatility_pct": round(annual_vol * 100, 2),
                "annualized_return_pct": round(annual_ret * 100, 2),
                "excess_return_pct": round(excess * 100, 2),
                "kelly_capped_pct": kelly_pct, "vol_target_portfolio_pct": vol_target,
                "recommended_position_pct": recommended, "position_level": level,
                "params_used": {"expected_return_pct": round(exp_ret * 100, 2),
                                "risk_free_rate_pct": round(risk_free_rate * 100, 2),
                                "target_volatility_pct": 20.0,
                                "kelly_fraction_limit_pct": round(kelly_fraction * 100, 2)}}
    except Exception as e:
        return error_result(symbol, str(e))


# --- Tool 3: institutional_flow ------------------

def get_institutional_flow(symbol, top_n=10):
    if not HAS_DEPS:
        return error_result(symbol, "yfinance not installed")
    try:
        ticker = yf.Ticker(symbol)
        holders = []
        total_value = 0
        raw = ticker.institutional_holders
        if raw is not None and not raw.empty:
            for _, row in raw.head(top_n).iterrows():
                h = {"holder": str(row.get("Holder", "")),
                     "shares": int(row["Shares"]) if pd.notna(row.get("Shares")) else 0,
                     "value": float(row["Value"]) if pd.notna(row.get("Value")) else 0,
                     "pct_held": round(float(row["pctHeld"]) * 100, 2) if pd.notna(row.get("pctHeld")) else 0,
                     "pct_change": round(float(row["pctChange"]) * 100, 2) if pd.notna(row.get("pctChange")) else 0,
                     "date": str(row.get("Date Reported", ""))[:10]}
                total_value += h["value"]
                holders.append(h)
        pct = None
        major = ticker.major_holders
        if major is not None and not major.empty:
            for idx, row in major.iterrows():
                if "Institution" in str(idx):
                    pct = str(row.iloc[0])
        shares = ticker.get_shares_full()
        trend = []
        if shares is not None and not shares.empty:
            items = shares.items() if hasattr(shares, 'items') else shares.iterrows()
            for dt, val in items:
                trend.append({"date": str(dt)[:10], "shares_outstanding": int(val)})
                if len(trend) >= 4:
                    break
        return {"symbol": symbol, "institutional_holders_count": len(holders),
                "total_institutional_value": round(total_value, 2),
                "institutional_ownership_pct": pct,
                "top_holders": holders, "share_trend": trend,
                "data_notes": ["数据来源: 13F filings，延迟约45天",
                               "仅反映季度末持仓，不包含空头和衍生品"]}
    except Exception as e:
        return error_result(symbol, str(e))


# --- MCP dispatch --------------------------------

TOOLS = [
    {"name": "risk_gauge",
     "description": "风控指标: 20日/60日年化波动率、距52周高点回抽、95% VaR",
     "inputSchema": {"type": "object", "properties": {"symbol": {"type": "string"}}, "required": ["symbol"]}},
    {"name": "position_sizing",
     "description": "仓位: 凯利公式+波动率目标，输出建议仓位比例",
     "inputSchema": {"type": "object", "properties": {
         "symbol": {"type": "string"},
         "expected_return": {"type": "number", "description": "预期年化收益率(小数)，默认用历史数据"},
         "risk_free_rate": {"type": "number", "description": "无风险利率(小数)，默认0.05"},
         "kelly_fraction": {"type": "number", "description": "凯利比例上限，默认0.25"}},
         "required": ["symbol"]}},
    {"name": "institutional_flow",
     "description": "机构持仓: 13F前十大持有人、持仓市值、持股变化趋势",
     "inputSchema": {"type": "object", "properties": {
         "symbol": {"type": "string"},
         "top_n": {"type": "number", "description": "前N大机构，默认10"}},
         "required": ["symbol"]}},
]

FN_MAP = {
    "risk_gauge": lambda a: calculate_risk(a["symbol"].upper()),
    "position_sizing": lambda a: calculate_position(a["symbol"].upper(), a.get("expected_return"),
                                                     a.get("risk_free_rate", 0.05),
                                                     a.get("kelly_fraction", 0.25)),
    "institutional_flow": lambda a: get_institutional_flow(a["symbol"].upper(), a.get("top_n", 10)),
}


def handle_request(req):
    method = req.get("method", "")
    params = req.get("params", {})
    rid = req.get("id")
    if method == "tools/list":
        return {"jsonrpc": "2.0", "result": {"tools": TOOLS}, "id": rid}
    if method == "tools/call":
        name = params.get("name", "")
        args = params.get("arguments", {})
        if name not in FN_MAP:
            return {"jsonrpc": "2.0", "error": {"message": f"Unknown tool: {name}"}, "id": rid}
        try:
            result = FN_MAP[name](args)
            return {"jsonrpc": "2.0",
                    "result": {"content": [{"type": "text", "text": json.dumps(result, ensure_ascii=False, default=str)}]},
                    "id": rid}
        except Exception as e:
            return {"jsonrpc": "2.0", "error": {"message": str(e)}, "id": rid}
    return {"jsonrpc": "2.0", "error": {"message": f"Unknown method: {method}"}, "id": rid}


if __name__ == "__main__":
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            resp = handle_request(json.loads(line))
            print(json.dumps(resp, ensure_ascii=False))
            sys.stdout.flush()
        except Exception as e:
            print(json.dumps({"jsonrpc": "2.0", "error": {"message": str(e)}}))
            sys.stdout.flush()
RISKEOF
    echo "      risk-mcp-server 完成"
}

# ---------- 创建 ashare-mcp (A 股数据 7 tools) ----------
install_ashare_mcp() {
    local target_dir="$MCP_SERVERS_BASE/ashare-mcp"
    local target_file="$target_dir/ashare-mcp-server.py"

    if [[ -f "$target_file" ]]; then
        echo "      ashare-mcp-server.py 已存在"
        return 0
    fi

    mkdir -p "$target_dir"

    echo "      安装 Python 依赖 (akshare, numpy, pandas) ..."
    install_python_deps "akshare"
    install_python_deps "numpy"
    install_python_deps "pandas"
    install_python_deps "requests"

    echo "      创建 ashare-mcp-server.py (7 tools: ashare_quote, ashare_technical_levels, ashare_fundamental_scan, ashare_news_sentiment, ashare_market_snapshot, ashare_fund_flow, ashare_lhb) ..."

    cat > "$target_file" << 'ASHAREEOF'
#!/usr/bin/env python3
"""ashare-mcp-server — A 股数据 MCP Server，使用 akshare 提供行情/技术面/基本面/新闻数据"""
import json, sys, os, re, subprocess

os.environ.pop("HTTP_PROXY", None); os.environ.pop("HTTPS_PROXY", None)
os.environ.pop("http_proxy", None); os.environ.pop("https_proxy", None)
os.environ.pop("ALL_PROXY", None); os.environ.pop("all_proxy", None)

from urllib.request import Request, urlopen
from urllib.error import URLError, HTTPError

try:
    import akshare as ak; import numpy as np; import pandas as pd
    HAS_DEPS = True
except ImportError:
    HAS_DEPS = False

def _http_get(url, headers=None, timeout=15, encoding="gbk"):
    if headers is None:
        headers = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36", "Referer": "https://finance.sina.com.cn"}
    try:
        from urllib.request import build_opener, ProxyHandler
        opener = build_opener(ProxyHandler({}))
        req = Request(url, headers=headers)
        with opener.open(req, timeout=timeout) as resp:
            return resp.read().decode(encoding, errors="replace")
    except:
        return None

def is_ashare(symbol): return symbol.startswith(("6", "0", "3"))
def normalize_symbol(symbol):
    symbol = symbol.strip().upper()
    if is_ashare(symbol):
        if symbol.startswith("6"): return symbol + ".SS"
        elif symbol.startswith(("0", "3")): return symbol + ".SZ"
    return symbol
def get_market_code(symbol):
    if symbol.endswith(".SS"): return "sh"
    elif symbol.endswith(".SZ"): return "sz"
    return None

def get_quote(symbol):
    if not is_ashare(symbol): return {"error": f"{symbol} 不是 A 股代码"}
    market = get_market_code(normalize_symbol(symbol))
    if not market: return {"error": f"无法识别市场: {symbol}"}
    code = symbol if symbol.startswith(("6", "0", "3")) else symbol[:6]
    url = f"https://hq.sinajs.cn/list={market}{code}"
    text = _http_get(url)
    if not text: return {"error": "无法获取行情数据"}
    try:
        parts = text.strip().split("=")
        if len(parts) < 2: return {"error": "行情数据解析失败"}
        data_str = parts[1].strip().strip('";').strip()
        if not data_str or data_str == "failed": return {"error": "行情数据为空"}
        fields = data_str.split(",")
        if len(fields) < 10: return {"error": f"行情字段不足: {len(fields)}"}
        name = fields[0]; open_p = float(fields[1]) if fields[1] else 0
        close_p = float(fields[2]) if fields[2] else 0
        curr = float(fields[3]) if fields[3] else close_p
        high = float(fields[4]) if fields[4] else 0; low = float(fields[5]) if fields[5] else 0
        vol = int(fields[8]) if fields[8] else 0; amount = float(fields[9]) if fields[9] else 0
        change = curr - close_p; change_pct = (change / close_p * 100) if close_p > 0 else 0
        return {"symbol": symbol, "name": name, "current_price": round(curr, 2), "change": round(change, 2),
                "change_pct": round(change_pct, 2), "open": round(open_p, 2), "high": round(high, 2),
                "low": round(low, 2), "close": round(close_p, 2), "volume": vol, "amount": round(amount, 2), "market": market.upper()}
    except Exception as e: return {"error": f"解析失败: {str(e)}"}

def calc_rsi(arr, period=14):
    delta = np.diff(arr)
    gain = np.where(delta > 0, delta, 0); loss = np.where(delta < 0, -delta, 0)
    avg_gain = np.convolve(gain, np.ones(period)/period, mode="valid")
    avg_loss = np.convolve(loss, np.ones(period)/period, mode="valid")
    rs = avg_gain / (avg_loss + 1e-10)
    return 100 - (100 / (1 + rs))

def calc_ema(arr, period):
    alpha = 2.0 / (period + 1); ema = [arr[0]]
    for v in arr[1:]: ema.append(alpha * v + (1 - alpha) * ema[-1])
    return np.array(ema)

def calc_bb(arr, period=20, std_dev=2):
    sma = np.convolve(arr, np.ones(period)/period, mode="valid")
    std = np.array([np.std(arr[i:i+period]) for i in range(len(arr)-period+1)])
    return sma + std_dev * std, sma, sma - std_dev * std

def calc_macd(arr, fast=12, slow=26, signal=9):
    ema_fast = calc_ema(arr, fast); ema_slow = calc_ema(arr, slow)
    macd_line = ema_fast - ema_slow; signal_line = calc_ema(macd_line, signal)
    return macd_line, signal_line, macd_line - signal_line

def get_technical_levels(symbol):
    if not is_ashare(symbol): return {"error": f"{symbol} 不是 A 股代码"}
    try:
        stock_code = symbol[:6]; market_prefix = "sh" if symbol.startswith("6") else "sz"
        url = f"https://money.finance.sina.com.cn/quotes_service/api/json_v2.php/CN_MarketData.getKLineData?symbol={market_prefix}{stock_code}&scale=240&ma=no&datalen=250"
        text = _http_get(url, encoding="utf-8")
        if not text: return {"error": "无法获取历史数据"}
        klines = json.loads(text)
        if not klines or not isinstance(klines, list): return {"error": "K线数据为空"}
        closes = []; highs = []; lows = []
        for k in klines[-250:]: closes.append(float(k["close"])); highs.append(float(k["high"])); lows.append(float(k["low"]))
        close = np.array(closes); high = np.array(highs); low = np.array(lows)
        rsi_14 = calc_rsi(close, 14); rsi_28 = calc_rsi(close, 28)
        ema_5 = calc_ema(close, 5); ema_10 = calc_ema(close, 10); ema_20 = calc_ema(close, 20)
        ema_60 = calc_ema(close, 60); ema_120 = calc_ema(close, 120) if len(close) >= 120 else None
        ema_250 = calc_ema(close, 250) if len(close) >= 250 else None
        bb_upper, bb_middle, bb_lower = calc_bb(close)
        macd_line, macd_signal, macd_hist = calc_macd(close)
        latest_close = close[-1]; latest_high = high[-1]; latest_low = low[-1]
        pivot = (latest_high + latest_low + latest_close) / 3
        r1 = 2 * pivot - latest_low; s1 = 2 * pivot - latest_high
        r2 = pivot + (latest_high - latest_low); s2 = pivot - (latest_high - latest_low)
        r3 = latest_high + 2 * (pivot - latest_low); s3 = latest_low - 2 * (latest_high - pivot)
        log_ret = np.log(close[1:] / close[:-1])
        vol_20d = np.std(log_ret[-20:]) * np.sqrt(252) if len(log_ret) >= 20 else 0
        return {"symbol": symbol, "current_price": round(latest_close, 2),
                "rsi": {"rsi_14": round(float(rsi_14[-1]), 2), "rsi_28": round(float(rsi_28[-1]), 2)},
                "ema": {"ema_5": round(float(ema_5[-1]), 2), "ema_10": round(float(ema_10[-1]), 2),
                        "ema_20": round(float(ema_20[-1]), 2), "ema_60": round(float(ema_60[-1]), 2),
                        "ema_120": round(float(ema_120[-1]), 2) if ema_120 is not None and len(ema_120) > 0 else None,
                        "ema_250": round(float(ema_250[-1]), 2) if ema_250 is not None and len(ema_250) > 0 else None},
                "bollinger_bands": {"upper": round(float(bb_upper[-1]), 2), "middle": round(float(bb_middle[-1]), 2), "lower": round(float(bb_lower[-1]), 2)},
                "macd": {"macd": round(float(macd_line[-1]), 4), "signal": round(float(macd_signal[-1]), 4), "histogram": round(float(macd_hist[-1]), 4)},
                "pivot_points": {"R1": round(r1, 2), "R2": round(r2, 2), "R3": round(r3, 2), "Pivot": round(pivot, 2), "S1": round(s1, 2), "S2": round(s2, 2), "S3": round(s3, 2)},
                "volatility_20d_annualized_pct": round(float(vol_20d) * 100, 2)}
    except Exception as e: return {"error": f"技术指标计算失败: {str(e)}"}

def get_fundamental_scan(symbol):
    if not is_ashare(symbol): return {"error": f"{symbol} 不是 A 股代码"}
    try:
        stock_code = symbol[:6]; market_prefix = "sh" if symbol.startswith("6") else "sz"
        url = f"https://qt.gtimg.cn/q={market_prefix}{stock_code}"
        text = _http_get(url)
        if not text: return {"error": "无法获取基本面数据"}
        parts = text.split("~")
        if len(parts) < 55: return {"error": f"数据字段不足: {len(parts)}"}
        def safe_float(v): return float(v) if v and v.strip() and v != "-" else None
        return {"symbol": symbol, "name": parts[1] if len(parts) > 1 else "",
                "pe_ttm": safe_float(parts[52]) if len(parts) > 52 else None,
                "pb": safe_float(parts[46]) if len(parts) > 46 else None,
                "roe": safe_float(parts[49]) if len(parts) > 49 else None,
                "market_cap_total": safe_float(parts[44]) if len(parts) > 44 else None}
    except Exception as e: return {"error": f"基本面获取失败: {str(e)}"}

def get_news_sentiment(symbol):
    if not is_ashare(symbol): return {"error": f"{symbol} 不是 A 股代码"}
    try:
        stock_code = symbol[:6]
        market = "SHA" if symbol.startswith("6") else ("SZ" if symbol.startswith(("0", "3")) else "SH")
        url = f"https://np-anotice-stock.eastmoney.com/api/security/ann?sr=-1&page_size=10&page_index=1&ann_type={market}&stock_list={stock_code}"
        text = _http_get(url, encoding="utf-8")
        if not text: return {"error": "无法获取新闻"}
        data = json.loads(text)
        if data.get("data", {}).get("list") is None: return {"error": "新闻接口返回错误"}
        news_list = []
        for item in data["data"]["list"][:10]:
            news_list.append({"title": item.get("title_ch", ""), "datetime": item.get("notice_date", "")[:19] if item.get("notice_date") else None})
        sentiment_score = 50
        if news_list:
            pos_kw = ["涨", "增长", "突破", "利好", "盈利", "超预期", "买入", "增持", "提升", "分红", "送股"]
            neg_kw = ["跌", "下降", "风险", "利空", "亏损", "不及预期", "减持", "下调", "警告", "处罚"]
            title_text = " ".join([n["title"] for n in news_list])
            pos_count = sum(1 for kw in pos_kw if kw in title_text); neg_count = sum(1 for kw in neg_kw if kw in title_text)
            total = pos_count + neg_count
            if total > 0: sentiment_score = min(100, max(0, 50 + (pos_count - neg_count) * 10))
        return {"symbol": symbol, "news_count": len(news_list), "news": news_list, "sentiment_score": sentiment_score,
                "sentiment_label": "正面" if sentiment_score > 60 else "负面" if sentiment_score < 40 else "中性"}
    except Exception as e: return {"error": f"新闻获取失败: {str(e)}", "symbol": symbol}

INDEX_CODES = {"上证指数": "000001", "深证成指": "399001", "创业板指": "399006", "沪深300": "000300", "科创50": "000688", "上证50": "000016", "中证500": "000905", "中证1000": "000852"}

def get_market_snapshot():
    if not HAS_DEPS: return {"error": "akshare 未安装"}
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
                            curr = float(fields[3]) if fields[3] else 0
                            close = float(fields[2]) if fields[2] else 0
                            change = curr - close; change_pct = (change / close * 100) if close > 0 else 0
                            indices.append({"name": name, "code": code, "current": round(curr, 2), "change": round(change, 2), "change_pct": round(change_pct, 2)})
            except: continue
        if not indices: return {"error": "无法获取大盘指数数据"}
        return {"indices": indices, "count": len(indices)}
    except Exception as e: return {"error": f"大盘指数获取失败: {str(e)}"}

def get_fund_flow(symbol):
    if not is_ashare(symbol): return {"error": f"{symbol} 不是 A 股代码"}
    try:
        stock_code = symbol[:6]; market_prefix = "sh" if symbol.startswith("6") else "sz"
        url = f"https://qt.gtimg.cn/q={market_prefix}{stock_code}"
        text = _http_get(url, encoding="gbk")
        if not text: return {"error": "无法获取资金流向数据"}
        parts = text.split("~")
        if len(parts) < 50: return {"error": f"数据字段不足: {len(parts)}"}
        def safe_float(v, default=0): return float(v) if v and v.strip() and v != "-" else default
        return {"symbol": symbol, "note": "腾讯证券数据", "price": safe_float(parts[3]) if len(parts) > 3 else None,
                "close": safe_float(parts[4]) if len(parts) > 4 else None,
                "volume": safe_float(parts[36]) if len(parts) > 36 else None,
                "turnover_rate": safe_float(parts[38]) if len(parts) > 38 else None}
    except Exception as e: return {"error": f"资金流向获取失败: {str(e)}"}

def get_lhb(date=None):
    if not HAS_DEPS: return {"error": "akshare 未安装"}
    try:
        if date: df = ak.stock_lhb_detail_em(start_date=date, end_date=date)
        else: df = ak.stock_lhb_detail_em(start_date="20250101", end_date="20250125")
        if df is None or df.empty: return {"error": "无法获取龙虎榜数据"}
        records = []
        for _, row in df.head(20).iterrows():
            records.append({"date": str(row.get("发布日期", ""))[:10] if row.get("发布日期") else None,
                          "code": str(row.get("代码", "")), "name": str(row.get("名称", "")),
                          "close": float(row.get("收盘价")) if row.get("收盘价") is not None else 0,
                          "change_pct": float(row.get("涨跌幅")) if row.get("涨跌幅") is not None else 0,
                          "reason": str(row.get("上榜原因", "")),
                          "buy_amount": float(row.get("龙虎榜买入金额")) if row.get("龙虎榜买入金额") is not None else 0,
                          "sell_amount": float(row.get("龙虎榜卖出金额")) if row.get("龙虎榜卖出金额") is not None else 0})
        return {"records": records, "count": len(records)}
    except Exception as e: return {"error": f"龙虎榜获取失败: {str(e)}"}

TOOLS = [
    {"name": "ashare_quote", "description": "获取 A 股实时行情：价格/涨跌幅/成交量", "inputSchema": {"type": "object", "properties": {"symbol": {"type": "string", "description": "A 股代码，如 600318"}}, "required": ["symbol"]}},
    {"name": "ashare_technical_levels", "description": "获取 A 股技术指标：RSI/EMA/布林带/MACD/枢轴点/波动率", "inputSchema": {"type": "object", "properties": {"symbol": {"type": "string", "description": "A 股代码"}}, "required": ["symbol"]}},
    {"name": "ashare_fundamental_scan", "description": "获取 A 股基本面：ROE/净利润/营收/PE/PB", "inputSchema": {"type": "object", "properties": {"symbol": {"type": "string", "description": "A 股代码"}}, "required": ["symbol"]}},
    {"name": "ashare_news_sentiment", "description": "获取 A 股新闻及情绪评分", "inputSchema": {"type": "object", "properties": {"symbol": {"type": "string", "description": "A 股代码"}}, "required": ["symbol"]}},
    {"name": "ashare_market_snapshot", "description": "获取 A 股大盘指数（上证/深证/创业板/沪深300等）", "inputSchema": {"type": "object", "properties": {}}},
    {"name": "ashare_fund_flow", "description": "获取 A 股资金流向", "inputSchema": {"type": "object", "properties": {"symbol": {"type": "string", "description": "A 股代码"}}, "required": ["symbol"]}},
    {"name": "ashare_lhb", "description": "获取龙虎榜数据", "inputSchema": {"type": "object", "properties": {"date": {"type": "string", "description": "日期，格式 YYYYMMDD"}}}},
]

def handle_request(req):
    method = req.get("method", ""); params = req.get("params", {}); req_id = req.get("id")
    if method == "tools/list": return {"jsonrpc": "2.0", "result": {"tools": TOOLS}, "id": req_id}
    if method == "tools/call":
        name = params.get("name", ""); args = params.get("arguments", {}); symbol = args.get("symbol", "").strip()
        if name in ("ashare_quote", "ashare_technical_levels", "ashare_fundamental_scan", "ashare_news_sentiment", "ashare_fund_flow"):
            if not symbol: return {"jsonrpc": "2.0", "error": {"message": "缺少 symbol"}, "id": req_id}
        if name == "ashare_quote": result = get_quote(symbol)
        elif name == "ashare_technical_levels": result = get_technical_levels(symbol)
        elif name == "ashare_fundamental_scan": result = get_fundamental_scan(symbol)
        elif name == "ashare_news_sentiment": result = get_news_sentiment(symbol)
        elif name == "ashare_market_snapshot": result = get_market_snapshot()
        elif name == "ashare_fund_flow": result = get_fund_flow(symbol)
        elif name == "ashare_lhb": result = get_lhb(args.get("date"))
        else: return {"jsonrpc": "2.0", "error": {"message": f"Unknown tool: {name}"}, "id": req_id}
        return {"jsonrpc": "2.0", "result": {"content": [{"type": "text", "text": json.dumps(result, ensure_ascii=False, default=str)}]}, "id": req_id}
    return {"jsonrpc": "2.0", "error": {"message": f"Unknown method: {method}"}, "id": req_id}

if __name__ == "__main__":
    for line in sys.stdin:
        line = line.strip()
        if not line: continue
        try:
            resp = handle_request(json.loads(line))
            print(json.dumps(resp, ensure_ascii=False)); sys.stdout.flush()
        except Exception as e:
            print(json.dumps({"jsonrpc": "2.0", "error": {"message": str(e)}})); sys.stdout.flush()
ASHAREEOF
    echo "      ashare-mcp-server 完成"
}

# ---------- 加载 .env ----------
load_env_vars() {
    local env_file="$FIN_AGENT_DIR/.env"
    [[ ! -f "$env_file" ]] && return
    export FINNHUB_API_KEY="" FRED_API_KEY="" OILPRICE_API_KEY="" OILPRICEAPI_KEY="" FMP_API_KEY="" EDGAR_IDENTITY=""
    while IFS='=' read -r key value; do
        [[ "$key" =~ ^# ]] && continue; [[ -z "$key" ]] && continue
        value=$(echo "$value" | sed 's/^[[:space:]]*//;s/[[:space:]]*$//;s/^"//;s/"$//')
        case "$key" in
            FINNHUB_API_KEY) export FINNHUB_API_KEY="$value" ;;
            FRED_API_KEY) export FRED_API_KEY="$value" ;;
            OILPRICE_API_KEY) export OILPRICE_API_KEY="$value" ;;
            FMP_API_KEY) export FMP_API_KEY="$value" ;;
            EDGAR_IDENTITY) export EDGAR_IDENTITY="$value" ;;
            SEC_EDGAR_USER_AGENT) export SEC_EDGAR_USER_AGENT="$value" ;;
        esac
    done < "$env_file"
}

# ---------- 配置 mcp_server.json ----------
configure_mcp_servers() {
    local astrbot_data="$1"
    local mcp_file="$astrbot_data/mcp_server.json"

    load_env_vars

    # 路径
    local fin_path="$FIN_AGENT_DIR/dist/index.js"
    local fred_path="$MCP_SERVERS_BASE/fred-mcp-server/build/index.js"
    local risk_path="$MCP_SERVERS_BASE/risk-mcp/risk-mcp-server.py"
    local ashare_path="$MCP_SERVERS_BASE/ashare-mcp/ashare-mcp-server.py"

    local tmp=$(mktemp)
    local data="{}"

    if [[ -f "$mcp_file" ]]; then
        data=$(cat "$mcp_file")
    else
        mkdir -p "$(dirname "$mcp_file")"
    fi

    python3 << PYEOF
import json, sys, os

try:
    data = json.loads(open("$mcp_file").read()) if os.path.exists("$mcp_file") else {"mcpServers": {}}
except:
    data = {"mcpServers": {}}

if "mcpServers" not in data:
    data["mcpServers"] = {}

ms = data["mcpServers"]

# 读取已有配置的 env 作为 fallback（更新时保留原有 API key）
existing_env = ms.get("$FIN_AGENT_NAME", {}).get("env", {})
def env_val(key, fallback=""):
    val = os.environ.get(key, "").strip()
    return val if val else existing_env.get(key, fallback)

# fin-agent
ms["$FIN_AGENT_NAME"] = {
    "command": "node",
    "args": ["$fin_path"],
    "env": {
        "FINNHUB_API_KEY": env_val("FINNHUB_API_KEY"),
        "FRED_API_KEY": env_val("FRED_API_KEY"),
        "OILPRICE_API_KEY": env_val("OILPRICE_API_KEY"),
        "OILPRICEAPI_KEY": env_val("OILPRICEAPI_KEY"),
        "FMP_API_KEY": env_val("FMP_API_KEY"),
        "HTTP_PROXY": env_val("HTTP_PROXY"),
        "HTTPS_PROXY": env_val("HTTPS_PROXY"),
    }
}

# fred-mcp
fred_existing_env = ms.get("$FRED_MCP_NAME", {}).get("env", {})
def fred_env_val(key, fallback=""):
    val = os.environ.get(key, "").strip()
    return val if val else fred_existing_env.get(key, fallback)

if os.path.exists("$fred_path"):
    ms["$FRED_MCP_NAME"] = {
        "command": "node",
        "args": ["$fred_path"],
        "env": {
            "FRED_API_KEY": fred_env_val("FRED_API_KEY"),
            "HTTP_PROXY": fred_env_val("HTTP_PROXY"),
            "HTTPS_PROXY": fred_env_val("HTTPS_PROXY"),
        }
    }

# risk-mcp
if os.path.exists("$risk_path"):
    ms["$RISK_MCP_NAME"] = {
        "command": "python3",
        "args": ["$risk_path"],
        "env": {}
    }

# ashare-mcp (A 股数据)
if os.path.exists("$ashare_path"):
    ms["$ASHARE_MCP_NAME"] = {
        "command": "python3",
        "args": ["$ashare_path"],
        "env": {}
    }

with open("$tmp", "w", encoding="utf-8") as f:
    json.dump(data, f, indent=2, ensure_ascii=False)
PYEOF

    [[ -f "$tmp" ]] && mv "$tmp" "$mcp_file"
    echo "      mcp_server.json 已更新"
}

# ---------- 主流程 ----------
main() {
    # ---------- 参数解析 ----------
POSITIONAL=()
while [[ $# -gt 0 ]]; do
    case "$1" in
        --help|-h) usage; exit 0 ;;
        --uninstall) ACTION="uninstall"; shift ;;
        --update) ACTION="update"; shift ;;
        --astrbot-data)
            if [[ -z "$2" || "$2" == "--"* ]]; then
                echo "ERROR: --astrbot-data 需要一个路径参数" >&2; exit 1
            fi
            export ASTRBOT_ROOT="$2"; shift 2 ;;
        *) POSITIONAL+=("$1"); shift ;;
    esac
done
set -- "${POSITIONAL[@]}"

    if [[ "${1:-}" == "--update" || "$ACTION" == "update" ]]; then
        echo "============================================"
        echo "  fin-agent 更新模式"
        echo "============================================"
        echo ""
        echo "[1] 备份 .env 并拉取最新代码 ..."
        if [[ -f "$FIN_AGENT_DIR/.env" ]]; then
            cp "$FIN_AGENT_DIR/.env" "$SCRIPT_DIR/fin-agent-env-backup.tmp"
        fi
        git pull --ff-only 2>/dev/null || echo "      git pull 失败，继续使用当前代码"
        if [[ -f "$SCRIPT_DIR/fin-agent-env-backup.tmp" && ! -f "$FIN_AGENT_DIR/.env" ]]; then
            cp "$SCRIPT_DIR/fin-agent-env-backup.tmp" "$FIN_AGENT_DIR/.env"
            echo "      已恢复 .env 文件"
        fi
        rm -f "$SCRIPT_DIR/fin-agent-env-backup.tmp"
        echo ""

        ASTRBOT_DATA=$(detect_astrbot_data)
        echo "AstrBot: $ASTRBOT_DATA"
        echo ""

        echo "[2] 重建 fin-agent-mcp-server ..."
        (cd "$FIN_AGENT_DIR" && npm install && npm run build)
        echo "      完成"
        echo ""

        echo "[3] 更新 fred-mcp-server ..."
        if [[ -d "$MCP_SERVERS_BASE/fred-mcp-server/.git" ]]; then
            (cd "$MCP_SERVERS_BASE/fred-mcp-server" && git pull --ff-only 2>/dev/null && npm install && npm run build 2>/dev/null) || echo "      更新跳过"
        fi
        echo ""

        echo "[4] 更新 Skills ..."
        rm -rf "$ASTRBOT_DATA/skills/fin-agent" 2>/dev/null
        for sk in "${SKILL_NAMES[@]}"; do
            src="$SKILL_SOURCE_BASE/$sk/SKILL.md"
            if [[ -f "$src" ]]; then
                mkdir -p "$ASTRBOT_DATA/skills/$sk"
                cp "$src" "$ASTRBOT_DATA/skills/$sk/SKILL.md" && echo "      $sk"
            fi
        done
        echo ""

        echo "[5] 更新 mcp_server.json ..."
        configure_mcp_servers "$ASTRBOT_DATA"
        echo ""

        echo "============================================"
        echo "  更新完成，重启 AstrBot 后生效"
        echo "============================================"
        exit 0
    fi

    if [[ "$ACTION" == "uninstall" ]]; then
        ASTRBOT_DATA=$(detect_astrbot_data)
        echo "卸载 ..."
        python3 -c "
import json, os
f='$ASTRBOT_DATA/mcp_server.json'
if os.path.exists(f):
    d=json.load(open(f))
    for s in ['$FIN_AGENT_NAME','$FRED_MCP_NAME','$RISK_MCP_NAME','$ASHARE_MCP_NAME']:
        d.get('mcpServers',{}).pop(s,None)
    json.dump(d,open(f,'w'),indent=2)
" 2>/dev/null
        for sk in market-briefing stock-deep fin-review position-watch; do
            rm -rf "$ASTRBOT_DATA/skills/$sk" 2>/dev/null
            echo "已删除 $sk"
        done
        echo "卸载完成"
        exit 0
    fi

    echo "============================================"
    echo "  fin-agent 完整接入安装"
    echo "============================================"

    ASTRBOT_DATA=$(detect_astrbot_data)
    echo "AstrBot: $ASTRBOT_DATA"
    echo ""

    echo "[1/6] 构建 fin-agent-mcp-server ..."
    [[ ! -f "$FIN_AGENT_DIR/dist/index.js" ]] && (cd "$FIN_AGENT_DIR" && npm install && npm run build)
    echo "      完成"
    echo ""

    echo "[2/6] 安装 fred-mcp-server ..."
    install_fred_mcp
    echo ""

    echo "[3/6] 安装 risk-mcp-server ..."
    install_risk_mcp
    echo ""

    echo "[4/6] 安装 ashare-mcp-server (A 股) ..."
    install_ashare_mcp
    echo ""

    echo "[5/6] 安装 Skills ..."
    rm -rf "$ASTRBOT_DATA/skills/fin-agent" 2>/dev/null
    for sk in "${SKILL_NAMES[@]}"; do
        src="$SKILL_SOURCE_BASE/$sk/SKILL.md"
        if [[ -f "$src" ]]; then
            mkdir -p "$ASTRBOT_DATA/skills/$sk"
            cp "$src" "$ASTRBOT_DATA/skills/$sk/SKILL.md" && echo "      $sk"
        fi
    done
    echo ""

    echo "[6/6] 配置 MCP Servers ..."
    configure_mcp_servers "$ASTRBOT_DATA"
    echo ""

    echo "============================================"
    echo "  安装完成，重启 AstrBot 后生效"
    echo "============================================"
    echo ""
    echo "MCP Servers:"
    echo "  ✓ fin-agent   (node)"
    echo "  ✓ fred-mcp    (node)"
    echo "  ✓ risk-mcp    (python)"
    echo "  ✓ ashare-mcp  (python, A 股)"
    echo ""
    echo "Skills:"
    echo "  ✓ market-briefing"
    echo "  ✓ stock-deep"
    echo "  ✓ fin-review"
  echo "  ✓ position-watch"
}

main "$@"
