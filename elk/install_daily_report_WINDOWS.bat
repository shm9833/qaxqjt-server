@echo off
REM ==================================================================
REM   秦安县秦剧团 · Admin Perf P99 日报
REM   Windows 定时任务 一键安装脚本 v2（每天 凌晨 02:00 自动运行）
REM ==================================================================
REM   改进（对比 v1）：
REM     1. 统一调用 run_daily_mailer_wrapper.bat，支持：
REM        - 防重复运行（lock 文件）
REM        - 运行失败自动重试（最多3次，每次隔30分钟）
REM        - stdout/stderr 完整重定向到 logs\task_runner_YYYYMMDD.log
REM        - 调度汇总日志 logs\scheduler.log
REM     2. 优先用 PowerShell ScheduledTasks 模块精细配置：
REM        - 唤醒计算机运行此任务
REM        - 失败后 30 分钟重启，最多重试 3 次
REM        - 空闲条件不阻塞、执行时长限制 2 小时
REM        - 多实例策略：忽略新实例（防止并发跑）
REM     3. schtasks 作为 fallback
REM ==================================================================
REM   使用步骤：
REM     1) 先编辑好 config_daily_report.json（从 TESTENV/example 复制改名后填真实值）
REM     2) 手动验证 2 步：
REM           py daily_mailer.py --dry-run          (验证 ES 连通+报表生成)
REM           py daily_mailer.py --test-smtp        (验证 SMTP 发邮件配置)
REM     3) 右键本脚本 → 以【管理员身份】运行（schtasks/Register-ScheduledTask 需要管理员）
REM ==================================================================

setlocal EnableDelayedExpansion
chcp 65001 >nul 2>&1
set "SCRIPT_DIR=%~dp0"
cd /d "%SCRIPT_DIR%"
set "TASK_NAME=QAXQJT_Perf_P99_Daily"
set "WRAPPER=%SCRIPT_DIR%run_daily_mailer_wrapper.bat"
set "CFG=%SCRIPT_DIR%config_daily_report.json"
set "PY_CMD=python"
where py >nul 2>&1 && set "PY_CMD=py -3"

REM ========== 1. 基础环境检查 ==========
echo.
echo =======================================================================================
echo   [0/5] 基础环境检查
echo =======================================================================================

where py >nul 2>&1 || where python >nul 2>&1
if errorlevel 1 (
    echo [❌] 未检测到 Python 3，请先安装 https://www.python.org/downloads/windows/
    echo      安装时务必勾选 "Add Python to PATH"，安装完成后重开 CMD 再重试
    pause & exit /b 2
)
echo [✔] Python 就绪：%PY_CMD%

if not exist "%CFG%" (
    echo [⚠️]  还没有 config_daily_report.json
    echo      自动从 config_daily_report_TESTENV.json 复制一份，请编辑后重新运行
    if exist "config_daily_report_TESTENV.json" (
        copy "config_daily_report_TESTENV.json" "config_daily_report.json" >nul
    ) else (
        copy "config_daily_report.example.json" "config_daily_report.json" >nul
    )
    echo [✔] 已生成模板：%CFG%
    echo      请填入 ES/SMTP 真实值后，重新右键以管理员身份运行本脚本
    echo.
    pause & exit /b 3
)
echo [✔] 配置文件存在：%CFG%

if not exist "daily_mailer.py" (
    echo [❌] 找不到 daily_mailer.py
    pause & exit /b 4
)
if not exist "%WRAPPER%" (
    echo [❌] 找不到 run_daily_mailer_wrapper.bat
    pause & exit /b 4
)
echo [✔] 脚本文件就绪（daily_mailer.py + wrapper）

REM ========== 2. Dry-run 校验 ==========
echo.
echo =======================================================================================
echo   [1/5] Dry-run 快速校验（不发邮件，仅确认 ES 连通 + 报表生成 OK）
echo =======================================================================================
%PY_CMD% "%SCRIPT_DIR%daily_mailer.py" --dry-run --config "%CFG%"
set "DRY_RUN_EXIT=%errorlevel%"
if not %DRY_RUN_EXIT%==0 (
    echo.
    echo [❌] dry-run 失败（exit_code=%DRY_RUN_EXIT%），请参考上方日志修正配置
    echo      常见原因：ES 地址不通 / 认证失败 / 索引不存在
    echo.
    pause & exit /b 5
)
echo [✔] dry-run 通过

REM ========== 3. 如果有旧任务，先卸载 ==========
echo.
echo =======================================================================================
echo   [2/5] 清理旧任务（如果存在）
echo =======================================================================================
schtasks /Query /TN "%TASK_NAME%" >nul 2>&1
if !errorlevel!==0 (
    echo [*] 检测到旧任务，先强制结束 + 删除...
    schtasks /End /TN "%TASK_NAME%" 2>nul
    schtasks /Delete /F /TN "%TASK_NAME%" >nul 2>&1
    echo [✔] 旧任务已清理
) else (
    echo [✔] 无同名旧任务，跳过清理
)

REM ========== 4. 创建新计划任务（优先 PowerShell） ==========
echo.
echo =======================================================================================
echo   [3/5] 创建计划任务：每天 02:00 运行（带失败重试 + 唤醒 + 防并发）
echo =======================================================================================
set "PS_OK=0"
REM 尝试用 PowerShell ScheduledTasks 模块（精细控制）
powershell -NoProfile -ExecutionPolicy Bypass -Command "$ErrorActionPreference='Stop'; $taskName='%TASK_NAME%'; $wrapper='%WRAPPER%'; $startTime='02:00'; $action=New-ScheduledTaskAction -Execute 'cmd.exe' -Argument \"/c start /min /WAIT \\\"\\\" \\\"$wrapper\\\" \\\"\\\"\"; $trigger=New-ScheduledTaskTrigger -Daily -At $startTime; $settings=New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -WakeToRun -StartWhenAvailable -MultipleInstances IgnoreNew -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 30) -ExecutionTimeLimit (New-TimeSpan -Hours 2); $principal=New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType Interactive -RunLevel Highest; Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Settings $settings -Principal $principal -Force | Out-Null; Write-Output 'PS_OK=1'" >nul 2>&1
if %errorlevel%==0 set "PS_OK=1"

REM 如果 PowerShell 方式失败，fallback 到 schtasks
if not "%PS_OK%"=="1" (
    echo [⚠️]  PowerShell ScheduledTasks 不可用，fallback 到 schtasks
    schtasks /Create /F /TN "%TASK_NAME%" ^
        /SC DAILY /ST 02:00 ^
        /TR "\"cmd.exe\" /c start /min /WAIT \"%WRAPPER%\"" ^
        /RL HIGHEST /IT
    if errorlevel 1 (
        echo [❌] schtasks 创建失败，请确认：
        echo      ① 是否以【管理员身份】运行本 .bat
        echo      ② 账户密码不能为空（部分Windows版本空密码无法建计划任务，可用 /RP 密码参数）
        pause & exit /b 6
    )
    REM 用 XML 注入唤醒策略
    echo [*] 调整高级选项：唤醒运行 + 失败重试 + 不等待空闲
    set "TASK_XML=%TEMP%\_qaxqjt_scheduledtask_v2.xml"
    schtasks /Query /TN "%TASK_NAME%" /XML > "!TASK_XML!" 2>nul
    if exist "!TASK_XML!" (
        powershell -NoProfile -ExecutionPolicy Bypass -Command "$xml = Get-Content '!TASK_XML!' -Raw; if ($xml -notmatch '<WakeToRun>') { $xml = $xml -replace '(</IdleSettings>)', \"`$1<WakeToRun>true</WakeToRun>\" } else { $xml = $xml -replace '(?s)<WakeToRun>.*?</WakeToRun>', '<WakeToRun>true</WakeToRun>' }; $xml = $xml -replace '(?s)<MultipleInstancesPolicy>.*?</MultipleInstancesPolicy>', '<MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy>'; if ($xml -notmatch '<IdleSettings>') { $xml = $xml -replace '(<WakeToRun>.*?</WakeToRun>)', \"<IdleSettings><Duration>PT0S</Duration><WaitTimeout>PT0S</WaitTimeout><StopOnIdleEnd>false</StopOnIdleEnd><RestartOnIdle>false</RestartOnIdle></IdleSettings>`$1\" } else { $xml = $xml -replace '(?s)<IdleSettings>.*?</IdleSettings>', '<IdleSettings><Duration>PT0S</Duration><WaitTimeout>PT0S</WaitTimeout><StopOnIdleEnd>false</StopOnIdleEnd><RestartOnIdle>false</RestartOnIdle></IdleSettings>' }; Set-Content '!TASK_XML!' $xml -Encoding UTF8" >nul 2>&1
        schtasks /Create /F /TN "%TASK_NAME%" /XML "!TASK_XML!" >nul 2>&1
        del /f /q "!TASK_XML!" 2>nul
    )
)
echo [✔] 计划任务创建成功（任务名：%TASK_NAME%）

REM ========== 5. 立即触发一次，验证调度 OK ==========
echo.
echo =======================================================================================
echo   [4/5] 立即触发一次（验证计划任务能正常拉起 wrapper）
echo =======================================================================================
schtasks /Run /TN "%TASK_NAME%"
if errorlevel 1 (
    echo [⚠️]  立即触发失败（可能是权限问题），但任务本身已创建，会在每天 02:00 正常触发
) else (
    timeout /t 8 /nobreak >nul
)

REM 输出任务摘要
echo.
echo =======================================================================================
echo   [5/5] 任务状态查询
echo =======================================================================================
schtasks /Query /TN "%TASK_NAME%" /V /FO LIST | findstr /i /R "任务名 状态 上次运行时间 上次运行结果 下次运行时间 计划类型 任务将运行"

REM ========== 6. 最终成功输出 ==========
echo.
echo.
echo =======================================================================================
echo    ✅  秦剧团 Admin Perf P99 日报定时任务 安装成功 ✅
echo =======================================================================================
echo.
echo    📌 核心调度参数：
echo       · 任务名      ：%TASK_NAME%
echo       · 触发时间    ：每天 凌晨 02:00
echo       · 失败重试    ：最多 3 次，每次间隔 30 分钟（wrapper + 任务计划双重保障）
echo       · 多实例策略  ：忽略新实例（防并发）
echo       · 唤醒策略    ：唤醒计算机运行此任务
echo       · 执行时长限制：2 小时
echo.
echo    📌 关键文件与目录：
echo       · 主脚本      ：%SCRIPT_DIR%daily_mailer.py
echo       · Wrapper     ：%WRAPPER%（防重/重试/日志，计划任务实际调它）
echo       · 配置文件    ：%CFG%
echo       · 调度汇总日志：%SCRIPT_DIR%logs\scheduler.log（每次一行，便于 grep）
echo       · 单次运行日志：%SCRIPT_DIR%logs\task_runner_YYYYMMDD.log（stdout+stderr完整）
echo       · 报表脚本日志：%SCRIPT_DIR%logs\daily_mailer_YYYYMMDD.log（结构化[FINAL_STATUS]）
echo       · 报表输出    ：%SCRIPT_DIR%reports\*.html / *.csv
echo.
echo    📌 常用维护命令：
echo       · 查看任务    ：schtasks /Query /TN "%TASK_NAME%" /V /FO LIST
echo       · 立即执行    ：schtasks /Run /TN "%TASK_NAME%"
echo       · 结束任务    ：schtasks /End /TN "%TASK_NAME%"
echo       · 卸载任务    ：右键管理员身份运行 uninstall_daily_report_WINDOWS.bat
echo       · 修改触发时间：把本脚本开头 "$startTime='02:00'" 或 schtasks 里的 /ST 改成目标时间后再运行一次
echo.
echo    📌 首次验收动作（运维必做）：
echo       ① 立即手动执行一次后，等 1~2 分钟，查看 logs\scheduler.log 最后一行是否 [RUNNER] SUCCESS
echo       ② 检查 logs\daily_mailer_YYYYMMDD.log 最后一行是否 [FINAL_STATUS] exit_code=0 status=OK
echo       ③ 检查收件人邮箱是否收到当天的 P99 日报邮件（带 HTML 报表附件）
echo.
pause
endlocal
