#!/usr/bin/env bash
#==============================================================================
# fin-agent/install.sh - Fin Agent MCP Server 安装脚本
#
# 将 fin-agent MCP Server 及相关 MCP Server 接入 AstrBot
#
# 包含：fin-agent-mcp-server, fred-mcp, ashare-mcp, risk-mcp
# 使用方式: ./install.sh [--uninstall] [--update]
#==============================================================================

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

# 路径配置
FIN_AGENT_DIR="$PROJECT_ROOT/mcp-server"
MCP_SERVERS_BASE="$PROJECT_ROOT/mcp-servers"

FIN_AGENT_NAME="fin-agent"
FRED_MCP_NAME="fred-mcp"
RISK_MCP_NAME="risk-mcp"
ASHARE_MCP_NAME="ashare-mcp"

SKILL_NAMES=("market-briefing" "stock-deep" "fin-review" "position-watch")
SKILL_SOURCE_BASE="$PROJECT_ROOT/skill"

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
    echo "  --update              更新 fin-agent (重建 + 更新 skills)"
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

# ---------- 安装 Python 依赖 (兼容 python3 -m pip) ----------
install_python_deps() {
    local pkg="$1"
    python3 -m pip install "$pkg" -q 2>/dev/null || pip install "$pkg" -q 2>/dev/null || pip install "$pkg"
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
            OILPRICEAPI_KEY) export OILPRICEAPI_KEY="$value" ;;
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
    local fred_path="$MCP_SERVERS_BASE/fred/build/index.js"
    local risk_path="$MCP_SERVERS_BASE/risk/risk_mcp_server.py"
    local ashare_path="$MCP_SERVERS_BASE/ashare/ashare_mcp_server.py"

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

        ASTRBOT_DATA=$(detect_astrbot_data)
        echo "AstrBot: $ASTRBOT_DATA"
        echo ""

        echo "[1] 重建 fin-agent-mcp-server ..."
        (cd "$FIN_AGENT_DIR" && npm install && npm run build)
        echo "      完成"
        echo ""

        echo "[2] 重建 fred-mcp-server ..."
        (cd "$MCP_SERVERS_BASE/fred" && npm install && npm run build 2>/dev/null) || echo "      更新跳过"
        echo ""

        echo "[3] 更新 Skills ..."
        rm -rf "$ASTRBOT_DATA/skills/fin-agent" 2>/dev/null
        for sk in "${SKILL_NAMES[@]}"; do
            src="$SKILL_SOURCE_BASE/$sk/SKILL.md"
            if [[ -f "$src" ]]; then
                mkdir -p "$ASTRBOT_DATA/skills/$sk"
                cp "$src" "$ASTRBOT_DATA/skills/$sk/SKILL.md" && echo "      $sk"
            fi
        done
        echo ""

        echo "[4] 更新 mcp_server.json ..."
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

    echo "[2/6] 构建 fred-mcp-server ..."
    if [[ -d "$MCP_SERVERS_BASE/fred" ]]; then
        (cd "$MCP_SERVERS_BASE/fred" && npm install && npm run build) || echo "      构建跳过"
    fi
    echo ""

    echo "[3/6] 安装 Python 依赖 (risk-mcp) ..."
    install_python_deps "yfinance"
    install_python_deps "numpy"
    install_python_deps "pandas"
    echo "      完成"
    echo ""

    echo "[4/6] 安装 Python 依赖 (ashare-mcp, A 股) ..."
    install_python_deps "akshare"
    install_python_deps "requests"
    echo "      完成"
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