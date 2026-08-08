@echo off
REM ==================================================================
REM   秦安县秦剧团 · Admin Perf P99 日报
REM   计划任务 Wrapper 脚本（由 schtasks 调用，不建议用户直接双击）
REM ==================================================================
REM   功能：
REM     1) 防重复运行（lock 文件机制）
REM     2) stdout / stderr 完整重定向到 logs\task_runner_YYYYMMDD.log
REM     3) 运行失败自动重试：最多 3 次，每次间隔 30 分钟
REM     4) 调度专用汇总日志：logs\scheduler.log（每次运行一行，便于检索）
REM ==================================================================

setlocal EnableDelayedExpansion
chcp 65001 >nul 2>&1
set "SCRIPT_DIR=%~dp0"
cd /d "%SCRIPT_DIR%"

REM ========== 1. 初始化目录 ==========
if not exist "logs" mkdir logs
if not exist "reports" mkdir reports
set "LOG_DIR=%SCRIPT_DIR%logs"
set "LOCK_FILE=%LOG_DIR%\_daily_mailer_running.lock"
set "TODAY=%date:~0,4%%date:~5,2%%date:~8,2%"
set "NOW=%date:~0,4%-%date:~5,2%-%date:~8,2% %time:~0,2%:%time:~3,2%:%time:~6,2%"
set "RUN_LOG=%LOG_DIR%\task_runner_%TODAY%.log"
set "SCHED_LOG=%LOG_DIR%\scheduler.log"

REM ========== 2. 防重复运行 ==========
if exist "%LOCK_FILE%" (
    set /p OLD_PID=<"%LOCK_FILE%" 2>nul
    REM 检查进程是否还活着
    tasklist /FI "PID eq !OLD_PID!" 2>nul | findstr /i "python" >nul 2>&1
    if !errorlevel!==0 (
        echo [%NOW%] [SKIP] 检测到已有运行中的 daily_mailer.py（PID=!OLD_PID!），跳过本次运行 >> "%SCHED_LOG%"
        echo [SKIP] 已有运行中的实例（PID=!OLD_PID!），退出
        exit /b 7
    ) else (
        echo [%NOW%] [WARN] 发现过期 lock 文件（PID=!OLD_PID!），进程已不存在，清理后继续 >> "%SCHED_LOG%"
        del /f /q "%LOCK_FILE%" 2>nul
    )
)
REM 写入新的 lock 文件，保存当前 cmd 的 PID
echo %PROCESSOR_IDENTIFIER%_PID_%RANDOM% >nul
echo %PID% > "%LOCK_FILE%"

REM ========== 3. 重试配置 ==========
set /a MAX_RETRY=3
set /a RETRY_INTERVAL_SEC=1800
set /a TRY=0
set "FINAL_EXIT=99"
set "PY_CMD=python"
where py >nul 2>&1 && set "PY_CMD=py -3"

:RUN_LOOP
set /a TRY+=1
set "RUN_NOW=%date:~0,4%-%date:~5,2%-%date:~8,2% %time:~0,2%:%time:~3,2%:%time:~6,2%"
echo. >> "%RUN_LOG%"
echo ================================================================================ >> "%RUN_LOG%"
echo [%RUN_NOW%] [RUNNER] 第 %TRY%/%MAX_RETRY% 次尝试运行 daily_mailer.py >> "%RUN_LOG%"
echo ================================================================================ >> "%RUN_LOG%"

REM 真正执行，所有输出都追加重定向到 RUN_LOG
%PY_CMD% "%SCRIPT_DIR%daily_mailer.py" --config "%SCRIPT_DIR%config_daily_report.json" >> "%RUN_LOG%" 2>&1
set "EXIT_CODE=%errorlevel%"

if %EXIT_CODE%==0 (
    set "FINAL_EXIT=0"
    echo [%RUN_NOW%] [RUNNER] 第 %TRY% 次运行 SUCCESS（exit_code=0） >> "%SCHED_LOG%"
    goto CLEANUP
)

REM 失败了
if %TRY% LSS %MAX_RETRY% (
    echo [%RUN_NOW%] [RUNNER] 第 %TRY% 次运行 FAIL（exit_code=%EXIT_CODE%），%RETRY_INTERVAL_SEC% 秒后重试 >> "%SCHED_LOG%"
    echo [%RUN_NOW%] [RETRY] exit_code=%EXIT_CODE%，等待 %RETRY_INTERVAL_SEC% 秒后第 %TRY% -> %MAX_RETRY% 次重试 >> "%RUN_LOG%"
    REM 等待 30 分钟（1800秒），timeout 支持中断
    timeout /t %RETRY_INTERVAL_SEC% /nobreak >nul 2>&1
    goto RUN_LOOP
) else (
    set "FINAL_EXIT=%EXIT_CODE%"
    echo [%RUN_NOW%] [RUNNER] 第 %TRY% 次运行 FAIL（exit_code=%EXIT_CODE%），已达最大重试次数，最终失败 >> "%SCHED_LOG%"
    echo [%RUN_NOW%] [FATAL_FAIL] 已重试 %MAX_RETRY% 次仍失败，最终 exit_code=%EXIT_CODE% >> "%RUN_LOG%"
    goto CLEANUP
)

:CLEANUP
del /f /q "%LOCK_FILE%" 2>nul
endlocal & exit /b %FINAL_EXIT%
