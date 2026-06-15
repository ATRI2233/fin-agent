#!/usr/bin/env pwsh
# fin-agent single-window startup

$ErrorActionPreference = "SilentlyContinue"
$PROJECT_ROOT = Split-Path -Parent $MyInvocation.MyCommand.Path

# Load .env file
$envFile = Join-Path $PROJECT_ROOT ".env"
if (Test-Path $envFile) {
    Get-Content $envFile | ForEach-Object {
        if ($_ -match '^\s*#' -or $_ -match '^\s*$') { return }
        $parts = $_ -split '=', 2
        if ($parts.Length -eq 2) {
            $key = $parts[0].Trim()
            $val = $parts[1].Trim()
            [System.Environment]::SetEnvironmentVariable($key, $val, "Process")
        }
    }
    Write-Host "[Env] .env loaded" -ForegroundColor Green
}

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

# Check opencode binary
Write-Host "[Check] opencode..." -NoNewline
$ocBin = Join-Path $PROJECT_ROOT "agents\opencode\node_modules\opencode-ai\bin\opencode.exe"
if (Test-Path $ocBin) { Write-Host " OK" -ForegroundColor Green }
else { Write-Host " Not found at $ocBin" -ForegroundColor Red }

Write-Host ""

# Start opencode serve
Write-Host "[1/4] opencode serve (port 4096)..." -ForegroundColor Yellow
$ocBin = Join-Path $PROJECT_ROOT "agents\opencode\node_modules\opencode-ai\bin\opencode.exe"
if (Test-Path $ocBin) {
    Start-Process -FilePath $ocBin -ArgumentList "serve", "--port", "4096" -WorkingDirectory $PROJECT_ROOT -WindowStyle Hidden
    Start-Sleep -Seconds 3
    Write-Host "  opencode serve started" -ForegroundColor Green
} else {
    Write-Host "  opencode binary not found, skipping" -ForegroundColor Red
}

# Start FastAPI
Write-Host "[2/4] FastAPI Framework (port 8000)..." -ForegroundColor Yellow
Start-Process -FilePath "python" -ArgumentList "-m uvicorn main.framework.main:app --port 8000" -WorkingDirectory $PROJECT_ROOT -WindowStyle Hidden
Start-Sleep -Seconds 2

# Start WebUI Server
Write-Host "[3/4] WebUI Server (port 9876)..." -ForegroundColor Yellow
$webuiServerDir = Join-Path $PROJECT_ROOT "webui\server"
Start-Process -FilePath "node" -ArgumentList "node_modules/tsx/dist/cli.mjs watch index.ts" -WorkingDirectory $webuiServerDir -WindowStyle Hidden
Start-Sleep -Seconds 2

# Start WebUI Frontend
Write-Host "[4/4] WebUI Frontend (port 5173)..." -ForegroundColor Yellow
$webuiDir = Join-Path $PROJECT_ROOT "webui"
Start-Process -FilePath "cmd" -ArgumentList "/c npm run dev" -WorkingDirectory $webuiDir -WindowStyle Hidden

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  All services started" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "  opencode serve:     http://localhost:4096" -ForegroundColor White
Write-Host "  FastAPI Framework:  http://localhost:8000/api/v1/health" -ForegroundColor White
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
    @{ Name = "opencode";  Url = "http://localhost:4096/session" },
    @{ Name = "FastAPI";   Url = "http://localhost:8000/api/v1/health" },
    @{ Name = "WebUI";     Url = "http://localhost:9876/api/health" }
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
