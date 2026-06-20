@echo off
title fin-agent
setlocal enabledelayedexpansion

set "ROOT=%~dp0..\"
pushd "%ROOT%"

echo ========================================
echo   fin-agent
echo   ROOT = %CD%
echo ========================================
echo.

python --version >nul 2>&1 || (echo [ERROR] Python not found & pause & exit /b 1)
node --version >nul 2>&1   || (echo [ERROR] Node.js not found & pause & exit /b 1)

if not exist "%CD%\src\main\main.py" (
    echo [ERROR] src\main\main.py not found at %CD%
    pause & exit /b 1
)
if not exist "%CD%\src\webui\package.json" (
    echo [ERROR] src\webui\package.json not found at %CD%
    pause & exit /b 1
)

if not exist "%CD%\data" mkdir "%CD%\data"
if not exist "%CD%\logs" mkdir "%CD%\logs"

echo [1/2] FastAPI (port 8000)...
start /b "" python -m src.main.main > "%CD%\logs\api.log" 2>&1
echo        OK - http://localhost:8000

echo [2/2] Vite (port 5173)...
start /b "" cmd /c "cd /d %CD%\src\webui && npm run dev" > "%CD%\logs\webui.log" 2>&1
echo        OK - http://localhost:5173

echo.
echo ========================================
echo   FastAPI:  http://localhost:8000
echo   WebUI:    http://localhost:5173
echo   Logs:     %CD%\logs\
echo ========================================
echo.
echo   Press Ctrl+C or close this window

:loop
timeout /t 10 >nul
goto loop
