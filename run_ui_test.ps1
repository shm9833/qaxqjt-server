﻿# ==================================================================
# UI Regression Test Runner (PowerShell)
# Usage: .\run_ui_test.ps1
# Requires: Python 3.x (stdlib only)
# ==================================================================
$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

Write-Host ""
Write-Host "================================================================"
Write-Host "  QAXQJT UI Regression Test"
Write-Host "  Bug regression: notice-list height / dispatch toast / HeightGuard"
Write-Host "================================================================"
Write-Host ""

# 1. Find Python
$pyCmd = $null
foreach ($c in @("py","python","python3")) {
    if (Get-Command $c -ErrorAction SilentlyContinue) {
        $pyCmd = "$c -3 -u"
        break
    }
}
if (-not $pyCmd) {
    Write-Host "[ERROR] Python not found. Install Python 3.x first." -ForegroundColor Red
    Read-Host "Press Enter to exit"
    exit 1
}

# 2. Check test script
if (-not (Test-Path "test_ui_regression.py")) {
    Write-Host "[ERROR] test_ui_regression.py not found. Run from project root." -ForegroundColor Red
    Read-Host "Press Enter to exit"
    exit 1
}

# 3. Run test
$ts = Get-Date -Format "yyyyMMdd_HHmmss"
$rdir = "reports"
if (-not (Test-Path $rdir)) { New-Item -ItemType Directory -Path $rdir -Force | Out-Null }
$rfile = "$rdir\ui_test_report_$ts.txt"

Write-Host "[INFO] Python: $pyCmd"
Write-Host "[INFO] Report: $rfile"
Write-Host ""

$out = Invoke-Expression "$pyCmd test_ui_regression.py 2>&1"
$out | Tee-Object -FilePath $rfile
$exitCode = $LASTEXITCODE

Write-Host ""
Write-Host "================================================================"
if ($exitCode -eq 0) {
    Write-Host "  PASS - 0 failures" -ForegroundColor Green
} else {
    Write-Host "  FAIL - check [FAIL] lines above" -ForegroundColor Red
}
Write-Host "  Report saved: $rfile"
Write-Host "================================================================"
Write-Host ""

if ($Host.Name -ne "ConsoleHost" -or -not [Environment]::UserInteractive) {
    exit $exitCode
} else {
    Read-Host "Press Enter to exit"
    exit $exitCode
}