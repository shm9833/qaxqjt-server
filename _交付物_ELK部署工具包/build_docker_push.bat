@echo off
REM ==================================================================
REM   秦安县秦剧团 · Admin Perf P99 日报
REM   Docker 镜像本地构建 + 推送到私有仓库一键脚本（Windows CI/本地构建用）
REM ==================================================================
REM   使用前：
REM     1) 已安装 Docker Desktop 且服务启动
REM     2) 已登录到目标镜像仓库：docker login harbor.your-company.local -u 用户名
REM     3) 按需修改下面的 REGISTRY / IMAGE_NAME / TAG
REM ==================================================================
setlocal EnableDelayedExpansion
chcp 65001 >nul 2>&1
cd /d "%~dp0"

REM ================================
REM  ↓↓↓  改这里的仓库配置即可  ↓↓↓
REM ================================
set "REGISTRY=harbor.your-company.local"
set "NAMESPACE=qaxqjt"
set "IMAGE_NAME=perf-p99-mailer"
set "TAG=v1.0"
set "PLATFORMS=linux/amd64,linux/arm64"   :: 常用双架构；如果只部署 x86 可只留 linux/amd64 加快构建
REM ================================
set "FULL_IMAGE=%REGISTRY%/%NAMESPACE%/%IMAGE_NAME%:%TAG%"
set "LATEST=%REGISTRY%/%NAMESPACE%/%IMAGE_NAME%:latest"

echo.
echo ================================================================================
echo  [1/5] 构建前校验：Dockerfile + daily_mailer.py + elk_p99_report.py 是否存在
echo ================================================================================
set "MISSING="
for %%F in (Dockerfile daily_mailer.py elk_p99_report.py) do (
    if not exist "%%F" ( echo   [❌] 缺少 %%F & set "MISSING=1" ) else ( echo   [✔] %%F )
)
if defined MISSING ( echo.& echo 缺少关键文件，终止构建 & pause & exit /b 1 )

echo.
echo ================================================================================
echo  [2/5] 本地构建单架构（linux/amd64）+ 本地启动快速 smoke test（--mock-es --dry-run）
echo ================================================================================
docker build -t "%IMAGE_NAME%:smoke" --build-arg PY_VER=3.11-slim-bookworm -f Dockerfile .
if errorlevel 1 ( echo [❌] 构建失败，终止 & pause & exit /b 2 )
echo [✔] 本地镜像构建完成: %IMAGE_NAME%:smoke

REM ---- smoke test：--mock-es --dry-run 应 exit=0 ----
echo.
echo [3/5] Smoke Test：docker run --rm %IMAGE_NAME%:smoke --mock-es --dry-run -v ...
set /a EXIT=99
for /f "tokens=*" %%i in ('docker run --rm -e TZ^=Asia/Shanghai "%IMAGE_NAME%:smoke" --mock-es --dry-run 2^>^&1 ^| findstr /c:"FINAL_STATUS" /c:"dry-run OK" ') do echo   %%i
docker run --rm -e TZ=Asia/Shanghai "%IMAGE_NAME%:smoke" --mock-es --dry-run >nul 2>&1
set EXIT=%ERRORLEVEL%
if %EXIT%==0 ( echo [✔] Smoke Test 通过: exit_code=%EXIT% ) else ( echo [❌] Smoke Test 失败 exit=%EXIT%，构建产物可能有问题 & pause & exit /b 3 )

echo.
echo ================================================================================
echo  [4/5] Buildx 多架构构建并推送：PLATFORMS=%PLATFORMS%
echo        目标镜像: %FULL_IMAGE%
echo ================================================================================
REM 需要先启用 buildx builder（第一次运行会自动创建）
docker buildx inspect qaxqjt-builder >nul 2>&1
if errorlevel 1 (
    echo [*] 创建 buildx builder: qaxqjt-builder
    docker buildx create --name qaxqjt-builder --driver docker-container --use
) else (
    docker buildx use qaxqjt-builder
)
REM 双架构构建并 push 到仓库；如需本地加载测试把 --push 改成 --load（但 --load 只支持单架构）
docker buildx build --platform %PLATFORMS% ^
    --build-arg PY_VER=3.11-slim-bookworm ^
    -t "%FULL_IMAGE%" ^
    -t "%LATEST%" ^
    --push ^
    -f Dockerfile .
if errorlevel 1 ( echo [❌] 多架构构建+推送失败 & pause & exit /b 4 )

echo.
echo ================================================================================
echo  [5/5] 最终产物清单
echo ================================================================================
echo   主镜像(tag)   : %FULL_IMAGE%
echo   主镜像(latest): %LATEST%
echo.
echo   架构：%PLATFORMS%
echo   Dockerfile   : %~dp0Dockerfile
echo   K8s CronJob  : %~dp0k8s\cronjob-perf-p99-daily.yaml
echo   ConfigMap    : %~dp0k8s\configmap-perf-p99-daily.yaml
echo   Secret       : %~dp0k8s\secret-perf-p99-daily.yaml
echo.
echo   👉  下一步：
echo      1) 在 K8s 部署侧把 cronjob-perf-p99-daily.yaml 里 image: 改为 %FULL_IMAGE%
echo      2) 填好 configmap / secret 真实值
echo      3) kubectl apply -f k8s\cronjob-perf-p99-daily.yaml -f k8s\configmap-perf-p99-daily.yaml -f k8s\secret-perf-p99-daily.yaml
echo      4) kubectl -n qaxqjt-monitoring create job test-run-1 --from cronjob/qaxqjt-perf-p99-daily 立即触发一次验证
echo ================================================================================
pause
endlocal
