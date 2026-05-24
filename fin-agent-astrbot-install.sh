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
        (cd "$dir" && npm install --silent 2>/dev/null || npm install)
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
    pip install yfinance numpy pandas -q 2>/dev/null || pip install yfinance numpy pandas

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

    local tmp=$(mktemp)
    local data="{}"

    if [[ -f "$mcp_file" ]]; then
        data=$(cat "$mcp_file")
    else
        mkdir -p "$(dirname "$mcp_file")"
    fi

    python << PYEOF
import json, sys, os

try:
    data = json.loads(open("$mcp_file").read()) if os.path.exists("$mcp_file") else {"mcpServers": {}}
except:
    data = {"mcpServers": {}}

if "mcpServers" not in data:
    data["mcpServers"] = {}

ms = data["mcpServers"]

# fin-agent
ms["$FIN_AGENT_NAME"] = {
    "command": "node",
    "args": ["$fin_path"],
    "env": {
        "FINNHUB_API_KEY": os.environ.get("FINNHUB_API_KEY", ""),
        "FRED_API_KEY": os.environ.get("FRED_API_KEY", ""),
        "OILPRICE_API_KEY": os.environ.get("OILPRICE_API_KEY", ""),
        "OILPRICEAPI_KEY": os.environ.get("OILPRICEAPI_KEY", ""),
        "FMP_API_KEY": os.environ.get("FMP_API_KEY", ""),
        "HTTP_PROXY": os.environ.get("HTTP_PROXY", ""),
        "HTTPS_PROXY": os.environ.get("HTTPS_PROXY", ""),
    }
}

# fred-mcp
if os.path.exists("$fred_path"):
    ms["$FRED_MCP_NAME"] = {
        "command": "node",
        "args": ["$fred_path"],
        "env": {
            "FRED_API_KEY": os.environ.get("FRED_API_KEY", ""),
            "HTTP_PROXY": os.environ.get("HTTP_PROXY", ""),
            "HTTPS_PROXY": os.environ.get("HTTPS_PROXY", ""),
        }
    }

# risk-mcp
if os.path.exists("$risk_path"):
    ms["$RISK_MCP_NAME"] = {
        "command": "python",
        "args": ["$risk_path"],
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
    case "${1:-}" in
        --help|-h) usage; exit 0 ;;
        --uninstall)
            ASTRBOT_DATA=$(detect_astrbot_data)
            echo "卸载 ..."
            python -c "
import json, os
f='$ASTRBOT_DATA/mcp_server.json'
if os.path.exists(f):
    d=json.load(open(f))
    for s in ['$FIN_AGENT_NAME','$FRED_MCP_NAME','$RISK_MCP_NAME']:
        d.get('mcpServers',{}).pop(s,None)
    json.dump(d,open(f,'w'),indent=2)
" 2>/dev/null
            for sk in market-briefing stock-deep fin-review position-watch; do
                rm -rf "$ASTRBOT_DATA/skills/$sk" 2>/dev/null
                echo "已删除 $sk"
            done
            echo "卸载完成"
            exit 0
            ;;
        --astrbot-data)
            export ASTRBOT_ROOT="$2"; shift 2 ;;
        --update)
            shift;;
    esac

    if [[ "${1:-}" == "--update" || "$ACTION" == "update" ]]; then
        echo "============================================"
        echo "  fin-agent 更新模式"
        echo "============================================"
        echo ""
        echo "[1] 拉取最新代码 ..."
        git pull --ff-only 2>/dev/null || echo "      git pull 失败，继续使用当前代码"
        echo ""

        ASTRBOT_DATA=$(detect_astrbot_data)
        echo "AstrBot: $ASTRBOT_DATA"
        echo ""

        echo "[2] 重建 fin-agent-mcp-server ..."
        (cd "$FIN_AGENT_DIR" && npm install --silent 2>/dev/null && npm run build)
        echo "      完成"
        echo ""

        echo "[3] 更新 fred-mcp-server ..."
        if [[ -d "$MCP_SERVERS_BASE/fred-mcp-server/.git" ]]; then
            (cd "$MCP_SERVERS_BASE/fred-mcp-server" && git pull --ff-only 2>/dev/null && npm install --silent 2>/dev/null && npm run build 2>/dev/null) || echo "      更新跳过"
        fi
        echo ""

        echo "[4] 更新 Skills ..."
        rm -rf "$ASTRBOT_DATA/skills/fin-agent" 2>/dev/null
        for sk in "${SKILL_NAMES[@]}"; do
            src="$SKILL_SOURCE_BASE/$sk/SKILL.md"
            [[ -f "$src" ]] && cp "$src" "$ASTRBOT_DATA/skills/$sk/SKILL.md" && echo "      $sk"
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

    echo "============================================"
    echo "  fin-agent 完整接入安装"
    echo "============================================"

    ASTRBOT_DATA=$(detect_astrbot_data)
    echo "AstrBot: $ASTRBOT_DATA"
    echo ""

    echo "[1/6] 构建 fin-agent-mcp-server ..."
    [[ ! -f "$FIN_AGENT_DIR/dist/index.js" ]] && (cd "$FIN_AGENT_DIR" && npm install --silent 2>/dev/null && npm run build)
    echo "      完成"
    echo ""

    echo "[2/6] 安装 fred-mcp-server ..."
    install_fred_mcp
    echo ""

    echo "[3/6] 安装 risk-mcp-server ..."
    install_risk_mcp
    echo ""

    echo "[5/6] 安装 Skills ..."
    rm -rf "$ASTRBOT_DATA/skills/fin-agent" 2>/dev/null
    for sk in "${SKILL_NAMES[@]}"; do
        src="$SKILL_SOURCE_BASE/$sk/SKILL.md"
        [[ -f "$src" ]] && cp "$src" "$ASTRBOT_DATA/skills/$sk/SKILL.md" && echo "      $sk"
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
    echo ""
    echo "Skills:"
    echo "  ✓ market-briefing"
    echo "  ✓ stock-deep"
    echo "  ✓ fin-review"
  echo "  ✓ position-watch"
}

main "$@"
