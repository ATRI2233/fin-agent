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

rem -- Pre-flight: toolchain checks ---------------------------------
python --version >nul 2>&1 || (echo [ERROR] Python not found & pause & exit /b 1)
node --version >nul 2>&1   || (echo [ERROR] Node.js not found & pause & exit /b 1)

if not exist "%CD%\src\main\main.py"      ( echo [ERROR] src\main\main.py not found      & pause & exit /b 1 )
if not exist "%CD%\src\webui\package.json"      ( echo [ERROR] src\webui\package.json not found      & pause & exit /b 1 )

rem -- Prepare directories -------------------------------------------
if not exist "%CD%\data"         mkdir "%CD%\data"
if not exist "%CD%\config\logs"  mkdir "%CD%\config\logs"

rem -- Free up ports that may be held by stale processes -------------
powershell -NoProfile -Command "Write-Host '[0/3]' -ForegroundColor Cyan -NoNewline; Write-Host ' Freeing ports 8000 / 5173 / 4096 (if held)...'"
call :kill_port 8000
call :kill_port 5173
call :kill_port 4096
echo.

rem -- [1/3] opencode -----------------------------------------------
powershell -NoProfile -Command "Write-Host '[1/3]' -ForegroundColor Cyan -NoNewline; Write-Host ' opencode (port 4096)...'"
rem -- Detect OS-specific binary (opencode.exe on Windows, opencode on Linux/Mac via Git-Bash/WSL) --
if exist "%CD%\src\agents\opencode\node_modules\opencode-ai\bin\opencode.exe" (
    set "OC_BIN=%CD%\src\agents\opencode\node_modules\opencode-ai\bin\opencode.exe"
) else if exist "%CD%\src\agents\opencode\node_modules\opencode-ai\bin\opencode" (
    set "OC_BIN=%CD%\src\agents\opencode\node_modules\opencode-ai\bin\opencode"
) else (
    echo        [ERROR] opencode binary not found. Run: cd src\agents\opencode ^&^& npm install
    pause
    exit /b 1
)
if exist "%OC_BIN%" (
    start /b "" cmd /c "cd /d %CD%\src\agents\opencode && \"%OC_BIN%\" serve --port 4096 > %CD%\config\logs\opencode.log 2>&1"
    call :wait_tcp 127.0.0.1 4096 30
) else (
    echo        [WARN] opencode binary not found, skipping
)
echo.

rem -- [2/3] FastAPI -------------------------------------------------
powershell -NoProfile -Command "Write-Host '[2/3]' -ForegroundColor Cyan -NoNewline; Write-Host ' FastAPI (port 8000)...'"
start /b "" cmd /c "python -m src.main.main > %CD%\config\logs\api.log 2>&1"
call :wait_health "http://localhost:8000/api/v1/health" 30
echo.

rem -- [3/3] Vite ----------------------------------------------------
powershell -NoProfile -Command "Write-Host '[3/3]' -ForegroundColor Cyan -NoNewline; Write-Host ' Vite (port 5173)...'"
start /b "" cmd /c "cd /d %CD%\src\webui && npm run dev" > "%CD%\config\logs\webui.log" 2>&1
call :wait_tcp 127.0.0.1 5173 30
echo.

echo ========================================
echo   opencode:       http://localhost:4096
echo   FastAPI:        http://localhost:8000
echo   WebUI:          http://localhost:5173
echo   Logs:           %CD%\config\logs\
echo   Stop:           run config\stop.bat
echo ========================================
echo.
echo   Press Ctrl+C or close this window.

:loop
timeout /t 10 >nul
goto loop

rem ==================================================================
rem  Helper: kill_port  <port>
rem ==================================================================
:kill_port
set "KP_PORT=%~1"
set "KP_FOUND=0"
set "KP_TMP=%TEMP%\kp_%KP_PORT%.txt"
netstat -ano -p tcp > "%KP_TMP%" 2>nul
for /f "tokens=5" %%P in ('type "%KP_TMP%" ^| findstr /R /C:":%KP_PORT% .*LISTENING"') do (
    if not "%%P"=="0" (
        echo        killing PID %%P ^(port %KP_PORT%^)
        taskkill /F /PID %%P >nul 2>&1
        set "KP_FOUND=1"
    )
)
del "%KP_TMP%" >nul 2>&1
if "!KP_FOUND!"=="0" echo        port %KP_PORT% free
goto :eof

rem ==================================================================
rem  Helper: wait_health  <url>  <max_tries>
rem ==================================================================
:wait_health
set "WH_URL=%~1"
set "WH_MAX=%~2"
set "WH_I=0"
:wait_health_loop
set /a "WH_I+=1"
curl -fsS --max-time 2 "%WH_URL%" >nul 2>&1
if !errorlevel! EQU 0 (
    echo        OK - %WH_URL%
    goto :eof
)
if !WH_I! GEQ %WH_MAX% (
    echo        [WARN] %WH_URL% not ready after %WH_MAX% tries - check config\logs\api.log
    goto :eof
)
timeout /t 1 >nul
goto wait_health_loop

rem ==================================================================
rem  Helper: wait_tcp  <host>  <port>  <max_tries>
rem ==================================================================
:wait_tcp
set "WT_HOST=%~1"
set "WT_PORT=%~2"
set "WT_MAX=%~3"
set "WT_I=0"
:wait_tcp_loop
set /a "WT_I+=1"
powershell -NoProfile -Command "try { if (Test-NetConnection -ComputerName '%WT_HOST%' -Port %WT_PORT% -InformationLevel Quiet) { exit 0 } else { exit 1 } } catch { exit 1 }" >nul 2>&1
if !errorlevel! EQU 0 (
    echo        OK - %WT_HOST%:%WT_PORT%
    goto :eof
)
if !WT_I! GEQ %WT_MAX% (
    echo        [WARN] %WT_HOST%:%WT_PORT% not ready after %WT_MAX% tries - check config\logs\
    goto :eof
)
timeout /t 1 >nul
goto wait_tcp_loop
