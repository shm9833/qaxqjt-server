@echo off
REM ==================================================================
REM   秦安县秦剧团 · Admin Perf P99 日报
REM   Windows 定时任务 一键卸载脚本
REM ==================================================================
REM   使用：右键 → 以管理员身份运行
REM ==================================================================

setlocal EnableDelayedExpansion
chcp 65001 >nul 2>&1
set "TASK_NAME=QAXQJT_Perf_P99_Daily"

echo [*] 正在查询计划任务 "%TASK_NAME%" ...
schtasks /Query /TN "%TASK_NAME%" >nul 2>&1
if errorlevel 1 (
    echo [✔] 任务 "%TASK_NAME%" 不存在，无需卸载
    pause & exit /b 0
)

echo [*] 正在强制结束正在运行中的实例（如果有）...
schtasks /End /TN "%TASK_NAME%" 2>nul

echo [*] 正在删除计划任务 "%TASK_NAME%" ...
schtasks /Delete /F /TN "%TASK_NAME%"

if errorlevel 1 (
    echo [❌] 删除失败，请确认以管理员身份运行
    pause & exit /b 1
) else (
    echo.
    echo =======================================================================================
    echo   ✅  P99 日报定时任务已成功卸载（任务名：%TASK_NAME%）
    echo =======================================================================================
    echo     如需重装，请右键以管理员身份运行 install_daily_report_WINDOWS.bat
    echo.
)
pause
endlocal
