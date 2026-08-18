<#
.SYNOPSIS
    WebShell 专用一键部署脚本（无需上传任何文件）
.DESCRIPTION
    在腾讯云 WebShell 或远程桌面 PowerShell 中执行：
    直接从 GitHub 下载代码、自动配置、安装依赖、初始化数据库、启动服务
.EXAMPLE
    # 一行命令下载并执行（在 WebShell 中粘贴）：
    irm https://github.com/shm9833/qaxqjt-server/raw/main/deploy/deploy-webshell.ps1 | iex
#>

$ErrorActionPreference = "Stop"

function Refresh-Path {
    $env:Path = [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User")
}

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  秦安县秦剧团 - WebShell 一键部署" -ForegroundColor Cyan
Write-Host "  无需上传文件，自动从 GitHub 拉取" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# ===== Step 1: 检查/安装 Node.js =====
Write-Host "[1/8] 检查 Node.js..." -ForegroundColor Yellow
Refresh-Path
$nodePath = Get-Command node -ErrorAction SilentlyContinue
if ($nodePath) {
    $nodeVer = node -v
    Write-Host "  [OK] Node.js 已安装: $nodeVer" -ForegroundColor Green
} else {
    Write-Host "  Node.js 未找到，开始安装 v18.20.4..." -ForegroundColor Yellow
    $msiPath = "$env:TEMP\node18.msi"
    try {
        Invoke-WebRequest -Uri "https://nodejs.org/dist/v18.20.4/node-v18.20.4-x64.msi" -OutFile $msiPath -UseBasicParsing
        Write-Host "  下载完成，正在安装（约2分钟）..." -ForegroundColor Yellow
        Start-Process msiexec.exe -ArgumentList "/i","`"$msiPath`"","/quiet","/norestart" -Wait
        Refresh-Path
        $nodeVer = node -v
        Write-Host "  [OK] Node.js 安装成功: $nodeVer" -ForegroundColor Green
    } catch {
        Write-Host "  [FAIL] Node.js 安装失败: $($_.Exception.Message)" -ForegroundColor Red
        Write-Host "         请手动下载安装: https://nodejs.org/dist/v18.20.4/node-v18.20.4-x64.msi" -ForegroundColor White
        exit 1
    }
}
Write-Host ""

# ===== Step 2: 安装 PM2 =====
Write-Host "[2/8] 检查 PM2..." -ForegroundColor Yellow
Refresh-Path
$pm2Path = Get-Command pm2 -ErrorAction SilentlyContinue
if ($pm2Path) {
    Write-Host "  [OK] PM2 已安装" -ForegroundColor Green
} else {
    Write-Host "  正在安装 PM2..." -ForegroundColor Yellow
    npm install -g pm2 2>&1 | Out-Null
    Refresh-Path
    $pm2Path = Get-Command pm2 -ErrorAction SilentlyContinue
    if ($pm2Path) {
        Write-Host "  [OK] PM2 安装成功" -ForegroundColor Green
    } else {
        Write-Host "  [FAIL] PM2 安装失败" -ForegroundColor Red
        exit 1
    }
}
Write-Host ""

# ===== Step 3: 放行防火墙 =====
Write-Host "[3/8] 设置防火墙规则..." -ForegroundColor Yellow
$ports = @(80, 443, 3001)
foreach ($port in $ports) {
    $ruleName = "Qaxqjt-Port-$port"
    $ruleExists = netsh advfirewall firewall show rule name=$ruleName 2>$null
    if ($ruleExists -match "规则已找到") {
        Write-Host "  [OK] 端口 $port 规则已存在" -ForegroundColor Green
    } else {
        $result = netsh advfirewall firewall add rule name=$ruleName dir=in action=allow protocol=TCP localport=$port 2>&1
        Write-Host "  [OK] 端口 $port 已放行" -ForegroundColor Green
    }
}
Write-Host ""

# ===== Step 4: 下载代码 =====
Write-Host "[4/8] 从 GitHub 下载代码..." -ForegroundColor Yellow
$deployDir = "C:\qaxqjt-server"

# 如果已有代码且有 package.json，跳过下载
if (Test-Path "$deployDir\package.json") {
    Write-Host "  [OK] 代码已存在，跳过下载" -ForegroundColor Green
} else {
    # 清理旧目录
    if (Test-Path $deployDir) { Remove-Item $deployDir -Recurse -Force }
    New-Item -ItemType Directory -Path $deployDir -Force | Out-Null

    $zipUrl = "https://github.com/shm9833/qaxqjt-server/archive/refs/heads/main.zip"
    $zipPath = "$env:TEMP\qaxqjt-server.zip"

    Write-Host "  正在从 GitHub 下载代码包..." -ForegroundColor Yellow
    try {
        Invoke-WebRequest -Uri $zipUrl -OutFile $zipPath -UseBasicParsing
        Write-Host "  下载完成，正在解压..." -ForegroundColor Yellow
        $tempExtract = "$env:TEMP\qaxqjt-extract"
        if (Test-Path $tempExtract) { Remove-Item $tempExtract -Recurse -Force }
        Expand-Archive -Path $zipPath -DestinationPath $tempExtract -Force

        # GitHub ZIP 解压后会有一个 qaxqjt-server-main 子目录，把内容移到 deployDir
        $innerDir = Get-ChildItem $tempExtract -Directory | Select-Object -First 1
        if ($innerDir) {
            Copy-Item -Path "$($innerDir.FullName)\*" -Destination $deployDir -Recurse -Force
        }
        Remove-Item $tempExtract -Recurse -Force
        Remove-Item $zipPath -Force
        Write-Host "  [OK] 代码下载并解压完成" -ForegroundColor Green
    } catch {
        Write-Host "  [FAIL] GitHub 下载失败: $($_.Exception.Message)" -ForegroundColor Red
        Write-Host ""
        Write-Host "  ===== 备用方案：从 Gitee 下载 =====" -ForegroundColor Yellow
        Write-Host "  1. 在浏览器打开 https://gitee.com/projects/import?url=https://github.com/shm9833/qaxqjt-server" -ForegroundColor White
        Write-Host "  2. 点击「导入」创建 Gitee 仓库" -ForegroundColor White
        Write-Host "  3. 重新运行此脚本，将 GitHub URL 替换为 Gitee URL" -ForegroundColor White
        exit 1
    }
}

# 验证关键文件
if (-not (Test-Path "$deployDir\package.json")) {
    Write-Host "  [FAIL] 代码不完整，缺少 package.json" -ForegroundColor Red
    exit 1
}
Write-Host "  [OK] 代码验证通过" -ForegroundColor Green
Write-Host ""

# ===== Step 5: 创建生产环境 .env =====
Write-Host "[5/8] 创建生产环境 .env..." -ForegroundColor Yellow
$envFile = "$deployDir\.env"

if (Test-Path $envFile) {
    Write-Host "  .env 已存在，跳过创建" -ForegroundColor Green
} else {
    # 生成随机 JWT 密钥
    $accessSecret = [System.Guid]::NewGuid().ToString("N") + [System.Guid]::NewGuid().ToString("N")
    $refreshSecret = [System.Guid]::NewGuid().ToString("N") + [System.Guid]::NewGuid().ToString("N")

    $envContent = @"
# ====== 生产环境配置（自动生成）======
NODE_ENV=production
APP_PORT=3001
APP_NAME=qaxqjt-cloud-booking
APP_VERSION=V2026.8.3
APP_BASE_URL=http://1.14.106.173:3001
ADMIN_BASE_URL=https://edgeone-3t3ka30u6h84.edgeone.app
FRONT_BASE_URL=https://edgeone-3t3ka30u6h84.edgeone.app

# ====== 数据库（SQLite，文件存在服务器硬盘，不会丢失）======
DATABASE_URL=file:./prod.db

# ====== JWT 密钥（自动生成）======
JWT_ACCESS_SECRET=$accessSecret
JWT_REFRESH_SECRET=$refreshSecret
JWT_ACCESS_TTL_MIN=30
JWT_REFRESH_TTL_DAY=7
JWT_ISSUER=qaxqjt-cloud
JWT_AUDIENCE=qaxqjt-admin-front
BCRYPT_ROUNDS=12

# ====== CORS 白名单 ======
CORS_ORIGINS=https://edgeone-3t3ka30u6h84.edgeone.app,http://localhost:8080,http://127.0.0.1:8080
CORS_CREDENTIALS=true

# ====== 限流 ======
RATE_LIMIT_WINDOW_MS=60000
RATE_LIMIT_MAX=200

# ====== 其他 ======
LOG_LEVEL=info
FIN_DOUBLE_CHECK_ABOVE=10000
"@

    Set-Content -Path $envFile -Value $envContent -Encoding UTF8
    Write-Host "  [OK] 生产 .env 已创建（含随机 JWT 密钥）" -ForegroundColor Green
}
Write-Host ""

# ===== Step 6: 安装依赖 =====
Write-Host "[6/8] 安装 npm 依赖（约3-10分钟，请耐心等待）..." -ForegroundColor Yellow
Set-Location $deployDir
Refresh-Path

npm install --omit=dev 2>&1 | ForEach-Object {
    if ($_ -match "ERR|error|fail") {
        Write-Host "    $_" -ForegroundColor Red
    } else {
        Write-Host "    $_" -ForegroundColor Gray
    }
}

if ($LASTEXITCODE -eq 0) {
    Write-Host "  [OK] 依赖安装完成" -ForegroundColor Green
} else {
    Write-Host "  [FAIL] npm install 失败" -ForegroundColor Red
    Write-Host "  尝试重试..." -ForegroundColor Yellow
    npm install --omit=dev
    if ($LASTEXITCODE -ne 0) {
        Write-Host "  [FAIL] 重试仍失败，请检查磁盘空间和网络" -ForegroundColor Red
        exit 1
    }
}
Write-Host ""

# ===== Step 7: 初始化数据库 =====
Write-Host "[7/8] 初始化数据库..." -ForegroundColor Yellow
Set-Location $deployDir
Refresh-Path

Write-Host "  执行 prisma db push..." -ForegroundColor Gray
npx prisma db push 2>&1 | ForEach-Object { Write-Host "    $_" -ForegroundColor Gray }
if ($LASTEXITCODE -ne 0) {
    Write-Host "  [WARN] 首次失败，尝试 --accept-data-loss..." -ForegroundColor Yellow
    npx prisma db push --accept-data-loss
}

Write-Host "  执行 seed.js 初始化数据..." -ForegroundColor Gray
& node prisma/seed.js 2>&1 | ForEach-Object { Write-Host "    $_" -ForegroundColor Gray }
if ($LASTEXITCODE -eq 0) {
    Write-Host "  [OK] 数据库初始化完成" -ForegroundColor Green
} else {
    Write-Host "  [WARN] Seed 失败（可能数据已存在，通常可忽略）" -ForegroundColor Yellow
}
Write-Host ""

# ===== Step 8: 启动服务并验证 =====
Write-Host "[8/8] 启动服务..." -ForegroundColor Yellow
Set-Location $deployDir
Refresh-Path

# 停止旧进程
pm2 delete qaxqjt-api 2>$null | Out-Null

# 启动新进程
pm2 start src/server.js --name qaxqjt-api --env production 2>&1 | ForEach-Object { Write-Host "    $_" }
pm2 save 2>&1 | Out-Null

Write-Host "  等待服务启动（5秒）..." -ForegroundColor Gray
Start-Sleep -Seconds 5

# 健康检查
$maxAttempts = 3
$success = $false
for ($i = 1; $i -le $maxAttempts; $i++) {
    try {
        Write-Host "  健康检查尝试 $i / $maxAttempts ..." -ForegroundColor Gray
        $response = Invoke-RestMethod -Uri "http://127.0.0.1:3001/v1/healthz" -TimeoutSec 10
        Write-Host "  [OK] 健康检查通过！" -ForegroundColor Green
        $success = $true
        break
    } catch {
        Write-Host "  失败: $($_.Exception.Message)" -ForegroundColor Yellow
        if ($i -lt $maxAttempts) { Start-Sleep -Seconds 5 }
    }
}

if (-not $success) {
    Write-Host "  [FAIL] 健康检查未通过，查看日志:" -ForegroundColor Red
    pm2 logs qaxqjt-api --lines 30 --nostream 2>&1 | ForEach-Object { Write-Host "    $_" }
} else {
    Write-Host ""
    Write-Host "========================================" -ForegroundColor Green
    Write-Host "  部署成功！" -ForegroundColor Green
    Write-Host "========================================" -ForegroundColor Green
    Write-Host ""
    Write-Host "  本地访问:  http://127.0.0.1:3001" -ForegroundColor White
    Write-Host "  公网访问:  http://1.14.106.173:3001" -ForegroundColor White
    Write-Host "  健康检查:  http://1.14.106.173:3001/v1/healthz" -ForegroundColor White
    Write-Host ""
    Write-Host "  PM2 命令:" -ForegroundColor Cyan
    Write-Host "    pm2 list              查看进程" -ForegroundColor White
    Write-Host "    pm2 logs qaxqjt-api   查看日志" -ForegroundColor White
    Write-Host "    pm2 restart qaxqjt-api 重启服务" -ForegroundColor White
    Write-Host ""
}
