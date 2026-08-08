@echo off
REM ==================================================================
REM   秦安县秦剧团 · 前端 UI 回归测试 · 一键运行脚本 (Windows)
REM   用法：双击运行 或 命令行 run_ui_test.bat
REM   依赖：Python 3.x（仅需标准库，无需 pip install）
REM ==================================================================
setlocal EnableDelayedExpansion
chcp 65001 >nul 2>&1
cd /d "%~dp0"

echo.
echo ================================================================
echo   秦安县秦剧团 · 前端 UI 回归测试
echo   防止 Bug 回归: 系统动态无限延长 / 派工单取消无显示 / HeightGuard 误判
echo ================================================================
echo.

REM ---- 1. 检查 Python ----
where py >nul 2>&1
if %ERRORLEVEL%==0 (
    set "PY_CMD=py -3 -u"
) else (
    where python >nul 2>&1
    if %ERRORLEVEL%==0 (
        set "PY_CMD=python -u"
    ) else (
        echo [ERROR] 未找到 Python，请先安装 Python 3.x
        pause
        exit /b 1
    )
)

REM ---- 2. 检查测试脚本存在 ----
if not exist "test_ui_regression.py" (
    echo [ERROR] 未找到 test_ui_regression.py，请确认在项目根目录运行
    pause
    exit /b 1
)

REM ---- 3. 运行测试 ----
set "TIMESTAMP=%date:~0,4%%date:~5,2%%date:~8,2%_%time:~0,2%%time:~3,2%%time:~6,2%"
set "TIMESTAMP=%TIMESTAMP: =0%"
set "REPORT_DIR=reports"
if not exist "%REPORT_DIR%" mkdir "%REPORT_DIR%"
set "REPORT_FILE=%REPORT_DIR%\ui_test_report_%TIMESTAMP%.txt"

echo [INFO] Python: %PY_CMD%
echo [INFO] 报告输出: %REPORT_FILE%
echo.

%PY_CMD% test_ui_regression.py > "%REPORT_FILE%" 2>&1
set "EXIT_CODE=%ERRORLEVEL%"

REM ---- 4. 打印报告内容 ----
type "%REPORT_FILE%"

echo.
echo ================================================================
if %EXIT_CODE%==0 (
    echo   ✅ 全部通过 - 0 失败
) else (
    echo   ❌ 存在失败项 - 请查看上方 [FAIL] 行
)
echo   报告已保存: %REPORT_FILE%
echo ================================================================
echo.
pause
exit /b %EXIT_CODE%
