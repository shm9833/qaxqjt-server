@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"
echo.
echo ================================================================
echo   秦安县秦剧团 · 一键本地完整演示（Windows双击版）
echo ================================================================
echo.
where py >nul 2>nul
if errorlevel 1 (
    echo [ERROR] 未检测到 Python 3，请先安装并勾选 "Add Python to PATH"
    pause
    exit /b 1
)
py -3 _demo_launcher.py
echo.
echo ================================================================
echo   演示结束，按任意键关闭窗口...
echo ================================================================
pause >nul
endlocal
