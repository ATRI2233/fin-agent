@echo off
title fin-agent
cd /d "%~dp0"
powershell -ExecutionPolicy Bypass -File "%~dp0start.ps1"
if %errorlevel% neq 0 (
    echo.
    echo [ERROR] Startup failed. Check the error above.
    pause
)
