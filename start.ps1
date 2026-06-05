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

# Start all services as background jobs
$jobs = @()

Write-Host "[1/4] FastAPI Framework (port 8000)..." -ForegroundColor Yellow
$jobs += Start-Job -Name "framework" -ScriptBlock {
    Set-Location $using:PROJECT_ROOT
    python -m uvicorn main.framework.main:app --port 8000 2>&1
}

Write-Host "[2/4] HAPI Hub (port 3006)..." -ForegroundColor Yellow
$jobs += Start-Job -Name "hapi" -ScriptBlock {
    Set-Location (Join-Path $using:PROJECT_ROOT "agents\hapi-hub")
    node node_modules/@twsxtd/hapi/bin/hapi.cjs hub 2>&1
}

Write-Host "[3/4] WebUI Server (port 9876)..." -ForegroundColor Yellow
$jobs += Start-Job -Name "webui-server" -ScriptBlock {
    Set-Location (Join-Path $using:PROJECT_ROOT "webui\server")
    node node_modules/tsx/dist/cli.mjs watch index.ts 2>&1
}

Write-Host "[4/4] WebUI Frontend (port 5173)..." -ForegroundColor Yellow
$jobs += Start-Job -Name "webui" -ScriptBlock {
    Set-Location (Join-Path $using:PROJECT_ROOT "webui")
    npm run dev 2>&1
}

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  All services started in background" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "  FastAPI Framework:  http://localhost:8000/api/v1/health" -ForegroundColor White
Write-Host "  HAPI Hub:           http://localhost:3006" -ForegroundColor White
Write-Host "  WebUI Server:       http://localhost:9876/api/health" -ForegroundColor White
Write-Host "  WebUI Frontend:     http://localhost:5173" -ForegroundColor White
Write-Host ""

# Wait for startup
Write-Host "Waiting for services..." -ForegroundColor Yellow
Start-Sleep -Seconds 6

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
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# Keep running and stream logs
try {
    while ($true) {
        foreach ($job in $jobs) {
            $output = Receive-Job -Job $job -ErrorAction SilentlyContinue
            if ($output) {
                $color = switch ($job.Name) {
                    "framework"    { "White" }
                    "hapi"         { "Cyan" }
                    "webui-server" { "Yellow" }
                    "webui"        { "Green" }
                    default        { "Gray" }
                }
                foreach ($line in $output) {
                    Write-Host "[$($job.Name)] $line" -ForegroundColor $color
                }
            }
        }
        Start-Sleep -Milliseconds 500
    }
} finally {
    Write-Host ""
    Write-Host "Stopping all services..." -ForegroundColor Red
    $jobs | Stop-Job -PassThru | Remove-Job -Force
    Write-Host "All services stopped." -ForegroundColor Red
}
