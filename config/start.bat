@echo off
title fin-agent
setlocal enabledelayedexpansion

set "PROJECT_ROOT=%~dp0.."

echo ========================================
echo   fin-agent
echo   PROJECT_ROOT = %PROJECT_ROOT%
echo ========================================
echo.

:: ── 依赖检查 ───────────────────────────────────────────────
python --version 2>nul || (echo [ERROR] Python not found! && pause && exit /b 1)
node --version 2>nul || (echo [ERROR] Node.js not found! && pause && exit /b 1)

:: ── 路径检查 ───────────────────────────────────────────────
if not exist "%PROJECT_ROOT%src\main\main.py" (
    echo [ERROR] %PROJECT_ROOT%src\main\main.py not found
    pause
    exit /b 1
)
if not exist "%PROJECT_ROOT%src\webui\package.json" (
    echo [ERROR] %PROJECT_ROOT%src\webui\package.json not found
    pause
    exit /b 1
)

echo [OK] All paths verified
echo.

:: ── 启动服务 (每个在独立窗口,可看到错误) ─────────────────

echo [1/3] FastAPI ^(port 8000^)...
start "fin-agent-api" cmd /k "title fin-agent-api && cd /d %PROJECT_ROOT% && echo Starting FastAPI... && python -m src.main.main"

echo [2/3] WebUI Server ^(port 9876^)...
start "fin-agent-server" cmd /k "title fin-agent-server && cd /d %PROJECT_ROOT%src\webui\server && echo Starting WebUI Server... && npx tsx index.ts"

echo [3/3] WebUI Frontend ^(port 5173^)...
start "fin-agent-webui" cmd /k "title fin-agent-webui && cd /d %PROJECT_ROOT%src\webui && echo Starting Vite... && npm run dev"

echo.
echo ========================================
echo   All services started!
echo   FastAPI:   http://localhost:8000
echo   WebUI:     http://localhost:5173
echo ========================================
echo.
echo   每个服务有独立窗口，可以看到报错。
echo   关闭服务窗口即停止对应服务。

pause
