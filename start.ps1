#!/usr/bin/env pwsh
# fin-agent single-window startup

$ErrorActionPreference = "Continue"
$PROJECT_ROOT = Split-Path -Parent $MyInvocation.MyCommand.Path
$pidFile = Join-Path $PROJECT_ROOT ".pids"
$script:processes = @()

# ── Cleanup: kill all tracked child processes ───────────────
function Stop-ChildProcesses {
    if (Test-Path $pidFile) {
        Get-Content $pidFile | ForEach-Object {
            $procId = $_.Trim()
            if ($procId -and $procId -match '^\d+$') {
                try {
                    $proc = Get-Process -Id ([int]$procId) -ErrorAction SilentlyContinue
                    if ($proc) {
                        Stop-Process -Id ([int]$procId) -Force -ErrorAction SilentlyContinue
                        Write-Host "  Killed PID $procId ($($proc.ProcessName))" -ForegroundColor Yellow
                    }
                } catch { }
            }
        }
        Remove-Item $pidFile -Force -ErrorAction SilentlyContinue
    }
}

# ── Kill leftover processes from previous run ───────────────
if (Test-Path $pidFile) {
    Write-Host "[Cleanup] Found .pids file from previous run, killing old processes..." -ForegroundColor Yellow
    Stop-ChildProcesses
}

# Load .env file
$envFile = Join-Path $PROJECT_ROOT ".env"
if (Test-Path $envFile) {
    Get-Content $envFile | ForEach-Object {
        if ($_ -match '^\s*#' -or $_ -match '^\s*$') { return }
        $parts = $_ -split '=', 2
        if ($parts.Length -eq 2) {
            $key = $parts[0].Trim()
            $val = $parts[1].Trim()
            # Strip surrounding quotes (single or double)
            if (($val.StartsWith('"') -and $val.EndsWith('"')) -or ($val.StartsWith("'") -and $val.EndsWith("'"))) {
                $val = $val.Substring(1, $val.Length - 2)
            }
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
    $p = Start-Process -FilePath $ocBin -ArgumentList "serve", "--port", "4096" -WorkingDirectory $PROJECT_ROOT -WindowStyle Hidden -PassThru
    $p.Id.ToString() | Out-File -FilePath $pidFile -Append -Encoding utf8
    $script:processes += $p
    Start-Sleep -Seconds 3
    Write-Host "  opencode serve started (PID $($p.Id))" -ForegroundColor Green
} else {
    Write-Host "  opencode binary not found, skipping" -ForegroundColor Red
}

# Start FastAPI
Write-Host "[2/4] FastAPI Framework (port 8000)..." -ForegroundColor Yellow
$p = Start-Process -FilePath "python" -ArgumentList "-m uvicorn main.framework.main:app --port 8000" -WorkingDirectory $PROJECT_ROOT -WindowStyle Hidden -PassThru
$p.Id.ToString() | Out-File -FilePath $pidFile -Append -Encoding utf8
$script:processes += $p
Start-Sleep -Seconds 2
Write-Host "  FastAPI started (PID $($p.Id))" -ForegroundColor Green

# Start WebUI Server
Write-Host "[3/4] WebUI Server (port 9876)..." -ForegroundColor Yellow
$webuiServerDir = Join-Path $PROJECT_ROOT "webui\server"
$p = Start-Process -FilePath "node" -ArgumentList "node_modules/tsx/dist/cli.mjs watch index.ts" -WorkingDirectory $webuiServerDir -WindowStyle Hidden -PassThru
$p.Id.ToString() | Out-File -FilePath $pidFile -Append -Encoding utf8
$script:processes += $p
Start-Sleep -Seconds 2
Write-Host "  WebUI Server started (PID $($p.Id))" -ForegroundColor Green

# Start WebUI Frontend
Write-Host "[4/4] WebUI Frontend (port 5173)..." -ForegroundColor Yellow
$webuiDir = Join-Path $PROJECT_ROOT "webui"
$p = Start-Process -FilePath "cmd" -ArgumentList "/c npm run dev" -WorkingDirectory $webuiDir -WindowStyle Hidden -PassThru
$p.Id.ToString() | Out-File -FilePath $pidFile -Append -Encoding utf8
$script:processes += $p
Write-Host "  WebUI Frontend started (PID $($p.Id))" -ForegroundColor Green

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

# ── Register Ctrl+C handler ────────────────────────────────
$cleanupDone = $false
try { [System.Console]::TreatControlCAsInput = $false } catch { }
[Console]::add_CancelKeyPress({
    param($sender, $e)
    $e.Cancel = $true
    if (-not $cleanupDone) {
        $cleanupDone = $true
        Write-Host ""
        Write-Host "[Shutdown] Ctrl+C detected, stopping all services..." -ForegroundColor Yellow
        Stop-ChildProcesses
        Write-Host "[Shutdown] All services stopped." -ForegroundColor Green
    }
})

# Keep window open
try {
    Read-Host "Press Enter to exit"
} catch {
    # Non-interactive mode — wait for a key press differently
    Write-Host "Press any key to exit..." -ForegroundColor Gray
    $null = [System.Console]::ReadKey($true)
} finally {
    if (-not $cleanupDone) {
        $cleanupDone = $true
        Write-Host ""
        Write-Host "[Shutdown] Stopping all services..." -ForegroundColor Yellow
        Stop-ChildProcesses
        Write-Host "[Shutdown] All services stopped." -ForegroundColor Green
    }
}
