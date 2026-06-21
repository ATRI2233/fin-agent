#!/usr/bin/env bash
# Fin-Agent 一键启动脚本 (Linux/Mac)
# 用法: bash config/start.sh

set -euo pipefail

# 确定项目根
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$PROJECT_ROOT"

# 加载 .env (如果存在)
if [ -f "config/.env" ]; then
    set -a
    # shellcheck disable=SC1091
    source config/.env
    set +a
fi

echo "========================================"
echo "  fin-agent Startup (Linux/Mac)"
echo "  ROOT = $PROJECT_ROOT"
echo "========================================"
echo ""

# 准备目录
mkdir -p data config/logs

# Pre-flight: 工具链检查
if ! command -v python >/dev/null 2>&1; then
    echo "[ERROR] Python not found"
    exit 1
fi
if ! command -v node >/dev/null 2>&1; then
    echo "[ERROR] Node.js not found"
    exit 1
fi

if [ ! -f "src/main/main.py" ]; then
    echo "[ERROR] src/main/main.py not found"
    exit 1
fi
if [ ! -f "src/webui/package.json" ]; then
    echo "[ERROR] src/webui/package.json not found"
    exit 1
fi

# 1. 启动 opencode CLI (4096)
echo "[1/3] opencode (port 4096)..."
OC_BIN="$PROJECT_ROOT/src/agents/opencode/node_modules/opencode-ai/bin/opencode"
if [ ! -f "$OC_BIN" ]; then
    echo "  OpenCode binary not found, installing..."
    (cd "$PROJECT_ROOT/src/agents/opencode" && npm install)
fi
if [ ! -f "$OC_BIN" ]; then
    echo "[ERROR] OpenCode binary still not found at $OC_BIN after npm install"
    exit 1
fi
echo "  Launching opencode CLI on :4096..."
(cd "$PROJECT_ROOT/src/agents/opencode" && "$OC_BIN" serve --port 4096 > "$PROJECT_ROOT/config/logs/opencode.log" 2>&1) &
OC_PID=$!
echo "  opencode started (PID $OC_PID)"
sleep 3
echo ""

# 2. 启动后端 FastAPI (8000)
echo "[2/3] FastAPI (port 8000)..."
(python -m uvicorn src.main.main:app --host 0.0.0.0 --port 8000 > "$PROJECT_ROOT/config/logs/api.log" 2>&1) &
BACKEND_PID=$!
echo "  FastAPI started (PID $BACKEND_PID)"
sleep 3
echo ""

# 3. 启动 Vite dev server (5173)
echo "[3/3] Vite (port 5173)..."
if [ ! -d "$PROJECT_ROOT/src/webui/node_modules" ]; then
    echo "  node_modules not found, running npm install..."
    (cd "$PROJECT_ROOT/src/webui" && npm install)
fi
echo "  Launching Vite dev server on :5173..."
(cd "$PROJECT_ROOT/src/webui" && npm run dev > "$PROJECT_ROOT/config/logs/webui.log" 2>&1) &
VITE_PID=$!
echo "  Vite started (PID $VITE_PID)"
sleep 5
echo ""

echo "========================================"
echo "  opencode:       http://localhost:4096"
echo "  FastAPI:        http://localhost:8000"
echo "  WebUI:          http://localhost:5173"
echo "  Logs:           $PROJECT_ROOT/config/logs/"
echo "========================================"
echo ""
echo "  Press Ctrl+C or run config/stop.sh to stop all services."
echo ""

# 优雅关闭
cleanup() {
    echo ""
    echo "[start.sh] Shutting down..."
    kill "$BACKEND_PID" "$OC_PID" "$VITE_PID" 2>/dev/null || true
    wait 2>/dev/null || true
    echo "[start.sh] All services stopped."
}
trap cleanup INT TERM EXIT

# 保持脚本运行
wait
