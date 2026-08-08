@echo off
chcp 65001 >nul 2>&1
REM ========================================================
REM  秦安县秦剧团云端预约系统 · 按钮兜底机制 一键验收
REM  Windows 双击运行版（无需命令行）
REM  使用：直接双击本文件即可；或右键"以管理员身份运行"
REM ========================================================
setlocal EnableDelayedExpansion
set SCRIPT_DIR=%~dp0
set TESTS_DIR=%SCRIPT_DIR%_tests
set LOG_FILE=%SCRIPT_DIR%验收报告_%date:~0,4%%date:~5,2%%date:~8,2%_%time:~0,2%%time:~3,2%%time:~6,2%.log
set LOG_FILE=%LOG_FILE: =0%

echo.
echo ╔══════════════════════════════════════════════════════════════════╗
echo ║  🎯  秦安县秦剧团云端预约系统 · 按钮兜底机制 一键验收            ║
echo ║     三阶段：42页注入验证  →  回归测试  →  200用户高并发压测      ║
echo ╚══════════════════════════════════════════════════════════════════╝
echo.
echo [ℹ️]  工作目录: %TESTS_DIR%
echo [ℹ️]  验收日志: %LOG_FILE%
echo.

REM ---------- 检查 Node.js ----------
where node >nul 2>&1
if %errorlevel% neq 0 (
    echo ❌  未检测到 Node.js，请先安装 Node.js 16+ ：
    echo      下载地址：https://nodejs.org/zh-cn/download
    echo.
    echo 安装完成后请重新双击运行本脚本。
    pause
    exit /b 1
)
for /f "tokens=*" %%i in ('node -v') do set NODE_VER=%%i
echo [✅] Node.js 已就绪: %NODE_VER%

REM ---------- 检查依赖 jsdom ----------
echo.
echo [⏳] 检查并安装运行依赖（jsdom，仅首次需要）...
if not exist "%TESTS_DIR%\node_modules\jsdom" (
    pushd "%TESTS_DIR%"
    call npm install jsdom --no-audit --no-fund --loglevel=error 2>nul
    popd
)
if exist "%TESTS_DIR%\node_modules\jsdom" (
    echo [✅] 依赖 jsdom 已就绪
) else (
    echo ⚠️  依赖安装未检测到，将尝试直接运行（如后续报"Cannot find module jsdom"请手动 cd _tests ^&^& npm install jsdom）
)

REM ---------- 运行三阶段验收 ----------
echo.
echo [🚀] 开始执行三阶段验收（预计耗时 30~60 秒，请勿关闭窗口）...
echo.
pushd "%TESTS_DIR%"
    call node run_all.js 2>&1 | tee "%LOG_FILE%"
    set EXIT_CODE=%errorlevel%
popd

echo.
echo ──────────────────────────────────────────────────────────────────
if %EXIT_CODE% equ 0 (
    echo ✅  全部验收通过！详细日志见: %LOG_FILE%
) else (
    echo ❌  验收未完全通过（退出码 %EXIT_CODE%），请查看上方红色错误提示或日志:
    echo     %LOG_FILE%
)
echo ──────────────────────────────────────────────────────────────────
echo.
echo （非开发人员：可截图本窗口底部结论，或直接把 .log 文件发给技术对接人）
echo.
pause
exit /b %EXIT_CODE%
