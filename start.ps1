#!/usr/bin/env pwsh
# fin-agent single-window startup

$ErrorActionPreference = "SilentlyContinue"
$PROJECT_ROOT = Split-Path -Parent $MyInvocation.MyCommand.Path

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  fin-agent Startup" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# Check dependencies
Write-Host "[Check] Python..." -NoNewline
$pyVer = python --version 2>&1
if ($pyVer -match "Python 3") { Write-Host " OK" -ForegroundColor Green }
else { Write-Host " Not found" -ForegroundColor Red; exit 1 }

Write-Host "[Check] Node.js..." -NoNewline
$nodeVer = node --version 2>&1
if ($nodeVer -match "v") { Write-Host " OK" -ForegroundColor Green }
else { Write-Host " Not found" -ForegroundColor Red; exit 1 }

Write-Host ""

# Start HAPI Hub
Write-Host "[1/5] HAPI Hub (port 3006)..." -ForegroundColor Yellow
$hapiHubDir = Join-Path $PROJECT_ROOT "agents\hapi-hub"
Start-Process -FilePath "node" -ArgumentList "node_modules/@twsxtd/hapi/bin/hapi.cjs hub" -WorkingDirectory $hapiHubDir -WindowStyle Hidden
Start-Sleep -Seconds 3

# Start HAPI Runner
Write-Host "[2/5] HAPI Runner..." -ForegroundColor Yellow
$hapiExe = Join-Path $PROJECT_ROOT "agents\hapi-hub\node_modules\@twsxtd\hapi-win32-x64\bin\hapi.exe"
Start-Process -FilePath $hapiExe -ArgumentList "runner start" -WorkingDirectory $PROJECT_ROOT -WindowStyle Hidden
Start-Sleep -Seconds 3

# Read HAPI token
$HAPI_SETTINGS = "$env:USERPROFILE\.hapi\settings.json"
$HAPI_TOKEN = ""
if (Test-Path $HAPI_SETTINGS) {
    $settings = Get-Content $HAPI_SETTINGS | ConvertFrom-Json
    $HAPI_TOKEN = $settings.cliApiToken
    Write-Host "  HAPI Token: $HAPI_TOKEN" -ForegroundColor Gray
}

# Start FastAPI
Write-Host "[3/5] FastAPI Framework (port 8000)..." -ForegroundColor Yellow
$env:FIN_AGENT_HAPI_API_TOKEN = $HAPI_TOKEN
Start-Process -FilePath "python" -ArgumentList "-m uvicorn main.framework.main:app --port 8000" -WorkingDirectory $PROJECT_ROOT -WindowStyle Hidden
Start-Sleep -Seconds 2

# Start WebUI Server
Write-Host "[4/5] WebUI Server (port 9876)..." -ForegroundColor Yellow
$webuiServerDir = Join-Path $PROJECT_ROOT "webui\server"
Start-Process -FilePath "node" -ArgumentList "node_modules/tsx/dist/cli.mjs watch index.ts" -WorkingDirectory $webuiServerDir -WindowStyle Hidden
Start-Sleep -Seconds 2

# Start WebUI Frontend
Write-Host "[5/5] WebUI Frontend (port 5173)..." -ForegroundColor Yellow
$webuiDir = Join-Path $PROJECT_ROOT "webui"
Start-Process -FilePath "cmd" -ArgumentList "/c npm run dev" -WorkingDirectory $webuiDir -WindowStyle Hidden

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  All services started" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "  FastAPI Framework:  http://localhost:8000/api/v1/health" -ForegroundColor White
Write-Host "  HAPI Hub:           http://localhost:3006" -ForegroundColor White
Write-Host "  WebUI Server:       http://localhost:9876/api/health" -ForegroundColor White
Write-Host "  WebUI Frontend:     http://localhost:5173" -ForegroundColor White
Write-Host ""

# Wait for startup
Write-Host "Waiting for services..." -ForegroundColor Yellow
Start-Sleep -Seconds 8

# Health check
Write-Host ""
Write-Host "[Health Check]" -ForegroundColor Cyan

$checks = @(
    @{ Name = "FastAPI";  Url = "http://localhost:8000/api/v1/health" },
    @{ Name = "HAPI Hub"; Url = "http://localhost:3006" },
    @{ Name = "WebUI";    Url = "http://localhost:9876/api/health" }
)

foreach ($check in $checks) {
    Write-Host "  $($check.Name): " -NoNewline
    try {
        Invoke-RestMethod -Uri $check.Url -TimeoutSec 5 | Out-Null
        Write-Host "OK" -ForegroundColor Green
    } catch {
        Write-Host "Not responding" -ForegroundColor Red
    }
}

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  Press Ctrl+C to stop all services" -ForegroundColor Cyan
Write-Host "  Or close this window" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# Keep window open
Read-Host "Press Enter to exit"