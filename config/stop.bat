@echo off
title fin-agent - stopping services
setlocal enabledelayedexpansion

echo ========================================
echo   fin-agent - Stop all services
echo ========================================
echo.

rem -- Kill processes on the three known ports ----------------------
set "KILLED=0"

for %%P in (8000 5173 4096) do (
    set "FOUND=0"
    for /f "tokens=5" %%A in ('netstat -ano -p tcp ^| findstr /R /C:":%%P .*LISTENING" 2^>nul') do (
        if not "%%A"=="0" (
            echo   [STOP] Killing PID %%A on port %%P
            taskkill /F /PID %%A >nul 2>&1
            set /a "KILLED+=1"
            set "FOUND=1"
        )
    )
    if "!FOUND!"=="0" echo   [SKIP] Port %%P is free
)

echo.
if !KILLED! EQU 0 (
    echo   All services were already stopped.
) else (
    echo   Stopped !KILLED! process(es).
)
echo.
echo   Logs: %~dp0logs\
echo.
pause
