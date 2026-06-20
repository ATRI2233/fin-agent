@echo off
title fin-agent
setlocal enabledelayedexpansion

:: ============================================================
:: fin-agent 单窗口一键启动脚本
:: 支持: 双击运行 或命令行 ./start.bat
:: ============================================================

set "PROJECT_ROOT=%~dp0.."
set "PID_FILE=%PROJECT_ROOT%.pids"
set "KILLED="
set "PYTHON_SERVER_PID="

:: ── 清理残留进程 ───────────────────────────────────────────
if exist "%PID_FILE%" (
    echo [Cleanup] 检测到残留进程文件，正在清理...
    for /f "usebackq tokens=*" %%i in ("%PID_FILE%") do (
        set "PID=%%i"
        for /f "tokens=1" %%k in ("!PID!") do (
            taskkill /F /PID %%k 2>nul
        )
    )
    del /f /q "%PID_FILE%" 2>nul
)

:: ── 加载 .env ─────────────────────────────────────────────
if exist "%PROJECT_ROOT%config\.env" (
    for /f "usebackq tokens=1,* delims==" %%a in ("%PROJECT_ROOT%config\.env") do (
        set "KEY=%%a"
        set "VAL=%%b"
        if not defined KEY (
        ) else if "!KEY:~0,1!"=="#" (
        ) else (
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
set "OC_BIN=%PROJECT_ROOT%src\agents\opencode\node_modules\opencode-ai\bin\opencode.exe"
if exist "%OC_BIN%" (
    powershell -Command "$p = Start-Process -FilePath \"%OC_BIN%\" -ArgumentList \"serve --port 4096\" -WorkingDirectory \"%PROJECT_ROOT%\" -WindowStyle Hidden -PassThru; $p.Id | Out-File -FilePath \"%PID_FILE%\" -Append"
    echo   opencode serve started
) else (
    echo   [SKIP] opencode binary not found
)

:: [2/4] FastAPI
echo [2/4] FastAPI Framework ^(port 8000^)...
powershell -Command "$p = Start-Process -FilePath \"python\" -ArgumentList \"-m src.main.main\" -WorkingDirectory \"%PROJECT_ROOT%\" -WindowStyle Hidden -PassThru; $p.Id | Out-File -FilePath \"%PID_FILE%\" -Append"

:: [3/4] WebUI Server
echo [3/4] WebUI Server ^(port 9876^)...
powershell -Command "$p = Start-Process -FilePath \"node\" -ArgumentList \"node_modules/tsx/dist/cli.mjs watch index.ts\" -WorkingDirectory \"%PROJECT_ROOT%src\webui\server\" -WindowStyle Hidden -PassThru; $p.Id | Out-File -FilePath \"%PID_FILE%\" -Append"

:: [4/4] WebUI Frontend (Vite)
echo [4/4] WebUI Frontend ^(port 5173^)...
powershell -Command "$p = Start-Process -FilePath \"cmd\" -ArgumentList \"/c npm run dev\" -WorkingDirectory \"%PROJECT_ROOT%src\webui\" -WindowStyle Hidden -PassThru; $p.Id | Out-File -FilePath \"%PID_FILE%\" -Append"

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
