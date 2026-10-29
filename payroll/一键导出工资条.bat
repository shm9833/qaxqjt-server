@echo off
setlocal
cd /d "%~dp0"
rem ============================================================
rem  QAXQJT Payroll One-Click Export
rem  Default: exports the CURRENT month batch (auto-detected).
rem  Optional month argument:  2026-11
rem  Output: payroll\YYYY-MM\  (33 payslips + master CSV + smoke report)
rem ============================================================
set "YM="
if not "%~1"=="" set "YM=%~1"
if "%YM%"=="" for /f "usebackq delims=" %%i in (`powershell -NoProfile -Command "Get-Date -Format yyyy-MM"`) do set "YM=%%i"
echo ==============================================
echo   QAXQJT Payroll Export   month = %YM%
echo ==============================================
where node >nul 2>nul
if errorlevel 1 (
  echo [FAIL] node not found in PATH. Install Node.js first.
  pause
  exit /b 1
)
node "%~dp0export-payroll.js" --month=%YM%
set "RC=%errorlevel%"
if not "%RC%"=="0" (
  echo.
  echo [FAIL] export failed, RC=%RC%. See messages above.
) else (
  echo.
  echo [OK] payslips saved to: payroll\%YM%\
  start "" "%~dp0%YM%"
)
pause
exit /b %RC%
