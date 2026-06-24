@echo off
chcp 65001 >nul
title fin-agent - stopping services

echo ========================================
echo   fin-agent - Stop all services
echo ========================================
echo.

set "KILLED=0"
for %%f in (config\logs\*.pid) do (
    for /f "delims=" %%p in (%%f) do (
        taskkill /F /PID %%p >nul 2>&1 && echo Stopped PID %%p
        set "KILLED=1"
    )
    del /f "%%f" 2>nul
)

if "%KILLED%"=="0" (
    echo No running services found.
) else (
    echo Done.
)
