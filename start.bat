@echo off
title fin-agent
setlocal enabledelayedexpansion

:: ============================================================
:: fin-agent 单窗口一键启动脚本
:: 支持: 双击运行 或命令行 ./start.bat
:: ============================================================

set "PROJECT_ROOT=%~dp0"
set "PID_FILE=%PROJECT_ROOT%.pids"
set "KILLED="
set "PYTHON_SERVER_PID="

:: ── 清理残留进程 ───────────────────────────────────────────
if exist "%PID_FILE%" (
    echo [Cleanup] 检测到残留进程文件，正在清理...
    for /f "usebackq tokens=*" %%i in ("%PID_FILE%") do (
        for /f "tokens=2 delims=, " %%j in ("%%i") do (
            set "PID=%%j"
            for /f "tokens=1" %%k in ("!PID:~1,-1!") do (
                taskkill /F /PID %%k 2>nul
            )
        )
    )
    del /f /q "%PID_FILE%" 2>nul
)

:: ── 加载 .env ─────────────────────────────────────────────
if exist "%PROJECT_ROOT%.env" (
    for /f "usebackq tokens=1,* delims==" %%a in ("%PROJECT_ROOT%.env") do (
        set "KEY=%%a"
        set "VAL=%%b"
        if not defined KEY (
        ) else if "!KEY:~0,1!"=="#" (
        ) else (
            setx !KEY! "!VAL!" >nul 2>&1
            set "!KEY!=!VAL!"
        )
    )
    echo [Env] .env loaded
)

:: ── 依赖检查 ──────────────────────────────────────────────
python --version 2>nul | find "Python" >nul
if errorlevel 1 (
    echo [ERROR] Python not found. Please install Python 3.11+
    pause
    exit /b 1
)

node --version 2>nul | find "v" >nul
if errorlevel 1 (
    echo [ERROR] Node.js not found. Please install Node.js
    pause
    exit /b 1
)

:: ── 启动 ──────────────────────────────────────────────────
echo.
echo ========================================
echo   fin-agent Startup
echo ========================================
echo.

:: [1/4] opencode serve
echo [1/4] opencode serve ^(port 4096^)...
set "OC_BIN=%PROJECT_ROOT%agents\opencode\node_modules\opencode-ai\bin\opencode.exe"
if exist "%OC_BIN%" (
    start /min cmd /c "title opencode-serve && "%OC_BIN%" serve --port 4096"
    echo   opencode serve started
) else (
    echo   [SKIP] opencode binary not found
)

:: [2/4] FastAPI
echo [2/4] FastAPI Framework ^(port 8000^)...
start /min cmd /c "title FastAPI-8000 && cd /d "%PROJECT_ROOT%" && python -m uvicorn main.framework.main:app --port 8000 --log-level error"

:: [3/4] WebUI Server
echo [3/4] WebUI Server ^(port 9876^)...
start /min cmd /c "title WebUI-Server-9876 && cd /d "%PROJECT_ROOT%webui\server" && node node_modules\tsx\dist\cli.mjs watch index.ts"

:: [4/4] WebUI Frontend (Vite)
echo [4/4] WebUI Frontend ^(port 5173^)...
start /min cmd /c "title Vite-5173 && cd /d "%PROJECT_ROOT%webui" && npm run dev"

echo.
echo ========================================
echo   All services started
echo ========================================
echo.
echo   opencode serve:     http://localhost:4096
echo   FastAPI Framework:  http://localhost:8000/api/v1/health
echo   WebUI Server:       http://localhost:9876/api/health
echo   WebUI Frontend:     http://localhost:5173
echo.
echo ========================================
echo   Press Ctrl+C to stop all services
echo   or close this window
echo ========================================
echo.

:: ── 等待服务启动 ──────────────────────────────────────────
timeout /t 8 /nobreak >nul

:: ── 健康检查 ─────────────────────────────────────────────
echo [Health Check]
curl -s --max-time 5 http://localhost:8000/api/v1/health | findstr "ok" >nul
if errorlevel 1 (
    echo   FastAPI: Not responding
) else (
    echo   FastAPI: OK
)

echo.
echo Services are running. Press Ctrl+C to stop.
pause
