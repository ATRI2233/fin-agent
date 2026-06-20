@echo off
title fin-agent
setlocal enabledelayedexpansion

set "ROOT=%~dp0.."

echo ========================================
echo   fin-agent
echo ========================================
echo.

:: check deps
python --version >nul 2>&1 || (echo [ERROR] Python not found & pause & exit /b 1)
node --version >nul 2>&1   || (echo [ERROR] Node.js not found & pause & exit /b 1)

:: check paths
if not exist "%ROOT%src\main\main.py" (
    echo [ERROR] src\main\main.py not found
    pause & exit /b 1
)
if not exist "%ROOT%src\webui\package.json" (
    echo [ERROR] src\webui\package.json not found
    pause & exit /b 1
)

:: create data dir if missing (for sqlite)
if not exist "%ROOT%data" mkdir "%ROOT%data"

echo [1/2] Starting FastAPI ^(port 8000^)...
start /b "" python -m src.main.main > "%ROOT%logs\api.log" 2>&1
echo        OK - http://localhost:8000

echo [2/2] Starting Vite dev server ^(port 5173^)...
start /b "" cmd /c "cd /d %ROOT%src\webui && npm run dev" > "%ROOT%logs\webui.log" 2>&1
echo        OK - http://localhost:5173

echo.
echo ========================================
echo   FastAPI:  http://localhost:8000
echo   Frontend: http://localhost:5173
echo   Logs:     %ROOT%logs\
echo ========================================
echo.
echo   按 Ctrl+C 停止所有服务

:: keep window open
:loop
timeout /t 10 >nul
goto loop
