@echo off
chcp 65001 >nul
title fin-agent

echo ========================================
echo   fin-agent TypeScript
echo   All services in one window
echo ========================================
echo.

where node >nul 2>nul || (
    echo [ERROR] node not found. Please install Node.js ^(v20+^)
    pause
    exit /b 1
)

node "%~dp0start-all.mjs"
if errorlevel 1 (
    echo.
    echo [ERROR] Start failed. Press any key to exit.
    pause >nul
    exit /b 1
)
