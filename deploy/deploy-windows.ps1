<#
.SYNOPSIS
    Windows Server 一键部署脚本（支持 WebShell 和远程桌面）
.DESCRIPTION
    在 WebShell 或远程桌面管理员 PowerShell 中运行此脚本，自动完成：
    1. 检查/安装 Node.js 18
    2. 安装 PM2（自动刷新 PATH）
    3. 放行防火墙（检测管理员权限）
    4. 解压代码（多位置自动查找 ZIP）
    5. 安装依赖
    6. 生成 Prisma Client
    7. 初始化数据库
    8. 启动服务
    9. 验证
#>

$ErrorActionPreference = "Stop"

function Refresh-Path {
    $env:Path = [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User")
}

function Test-IsAdmin {
    $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
    $principal = New-Object Security.Principal.WindowsPrincipal($identity)
    return $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  秦安县秦剧团 - Windows Server 一键部署" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# ===== Step 0: 检查管理员权限 =====
Write-Host "[0/9] 检查管理员权限..." -ForegroundColor Yellow
if (Test-IsAdmin) {
    Write-Host "  [OK] 管理员权限已获取" -ForegroundColor Green
} else {
    Write-Host "  [WARN] 当前未以管理员身份运行，防火墙规则可能设置失败" -ForegroundColor Yellow
    Write-Host "         如需放行防火墙，请以管理员身份运行 PowerShell" -ForegroundColor White
}
Write-Host ""

# ===== Step 1: 检查/安装 Node.js =====
Write-Host "[1/9] 检查 Node.js..." -ForegroundColor Yellow
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
Write-Host "[2/9] 检查 PM2..." -ForegroundColor Yellow
Refresh-Path
$pm2Path = Get-Command pm2 -ErrorAction SilentlyContinue
if ($pm2Path) {
    Write-Host "  [OK] PM2 已安装" -ForegroundColor Green
} else {
    Write-Host "  正在安装 PM2..." -ForegroundColor Yellow
    npm install -g pm2 2>&1 | ForEach-Object { Write-Host "    $_" }
    Refresh-Path
    $pm2Path = Get-Command pm2 -ErrorAction SilentlyContinue
    if ($pm2Path) {
        Write-Host "  [OK] PM2 安装成功" -ForegroundColor Green
    } else {
        # 尝试用 npx 方式查找
        $npmGlobalPath = npm config get prefix
        $pm2Exe = Join-Path $npmGlobalPath "pm2.cmd"
        if (Test-Path $pm2Exe) {
            Write-Host "  [OK] PM2 已安装在: $pm2Exe" -ForegroundColor Green
        } else {
            Write-Host "  [FAIL] PM2 安装失败，请手动执行: npm install -g pm2" -ForegroundColor Red
            exit 1
        }
    }
}
Write-Host ""

# ===== Step 3: 放行防火墙 =====
Write-Host "[3/9] 设置防火墙规则..." -ForegroundColor Yellow
$ports = @(80, 443, 3001)
foreach ($port in $ports) {
    $ruleName = "Qaxqjt-Port-$port"
    $ruleExists = netsh advfirewall firewall show rule name=$ruleName 2>$null
    if ($ruleExists -match "规则已找到") {
        Write-Host "  [OK] 端口 $port 规则已存在" -ForegroundColor Green
    } else {
        if (Test-IsAdmin) {
            $result = netsh advfirewall firewall add rule name=$ruleName dir=in action=allow protocol=TCP localport=$port 2>&1
            if ($LASTEXITCODE -eq 0) {
                Write-Host "  [OK] 端口 $port 已放行" -ForegroundColor Green
            } else {
                Write-Host "  [WARN] 端口 $port 放行失败: $result" -ForegroundColor Yellow
            }
        } else {
            Write-Host "  [SKIP] 端口 $port 需要管理员权限，请手动执行:" -ForegroundColor Yellow
            Write-Host "         netsh advfirewall firewall add rule name=$ruleName dir=in action=allow protocol=TCP localport=$port" -ForegroundColor White
        }
    }
}
Write-Host ""

# ===== Step 4: 准备代码目录并解压 ZIP =====
Write-Host "[4/9] 准备代码目录并解压 ZIP..." -ForegroundColor Yellow
$deployDir = "C:\qaxqjt-server"
if (-not (Test-Path $deployDir)) {
    New-Item -ItemType Directory -Path $deployDir -Force | Out-Null
    Write-Host "  [OK] 创建目录: $deployDir" -ForegroundColor Green
}

# 如果 deployDir 没有 package.json，查找 ZIP 文件并解压
if (-not (Test-Path "$deployDir\package.json")) {
    Write-Host "  未检测到 package.json，正在查找 qaxqjt-server.zip ..." -ForegroundColor Yellow
    Write-Host ""

    # 按优先级查找 ZIP 文件
    $zipSearchPaths = @(
        "$deployDir\qaxqjt-server.zip",
        "$env:USERPROFILE\qaxqjt-server.zip",
        "$env:USERPROFILE\Downloads\qaxqjt-server.zip",
        "$env:USERPROFILE\Desktop\qaxqjt-server.zip",
        "C:\qaxqjt-server.zip",
        "C:\Users\Public\qaxqjt-server.zip",
        "$env:TEMP\qaxqjt-server.zip"
    )

    $foundZip = $null
    foreach ($searchPath in $zipSearchPaths) {
        Write-Host "    查找: $searchPath" -ForegroundColor Gray
        if (Test-Path $searchPath) {
            $fileSize = (Get-Item $searchPath).Length / 1MB
            Write-Host "    [找到] 文件大小: $([math]::Round($fileSize, 2)) MB" -ForegroundColor Green
            $foundZip = $searchPath
            break
        }
    }

    # 如果用户提供了 -ZipPath 参数，也检查一下
    if (-not $foundZip -and $ZipPath -and (Test-Path $ZipPath)) {
        $foundZip = $ZipPath
    }

    if (-not $foundZip) {
        Write-Host ""
        Write-Host "  [FAIL] 未找到 qaxqjt-server.zip！" -ForegroundColor Red
        Write-Host ""
        Write-Host "  ===== 请先按以下任一方式上传 ZIP 文件 =====" -ForegroundColor Yellow
        Write-Host "  方式1：远程桌面磁盘共享" -ForegroundColor White
        Write-Host "    - mstsc → 显示选项 → 本地资源 → 详细信息 → 勾选本地C盘" -ForegroundColor White
        Write-Host "    - 连接后，在服务器 PowerShell 执行:" -ForegroundColor White
        Write-Host "      Copy-Item '\\tsclient\C\本地路径\qaxqjt-server.zip' 'C:\qaxqjt-server\'" -ForegroundColor White
        Write-Host ""
        Write-Host "  方式2：腾讯云 WebShell 上传" -ForegroundColor White
        Write-Host "    - 打开 WebShell，点击右上角「上传文件」按钮" -ForegroundColor White
        Write-Host "    - 选择 qaxqjt-server.zip，上传到默认目录即可" -ForegroundColor White
        Write-Host ""
        Write-Host "  ===== 上传后，用以下命令确认文件是否存在 =====" -ForegroundColor Cyan
        Write-Host "    # 查看 C:\qaxqjt-server\ 目录" -ForegroundColor White
        Write-Host "    dir C:\qaxqjt-server\" -ForegroundColor Yellow
        Write-Host ""
        Write-Host "    # 全盘搜索 ZIP 文件" -ForegroundColor White
        Write-Host "    Get-ChildItem -Path C:\ -Name 'qaxqjt-server.zip' -Recurse -ErrorAction SilentlyContinue" -ForegroundColor Yellow
        Write-Host ""
        exit 1
    }

    # 解压 ZIP
    Write-Host ""
    Write-Host "  正在解压 ZIP 文件..." -ForegroundColor Yellow
    try {
        Expand-Archive -Path $foundZip -DestinationPath $deployDir -Force
        Write-Host "  [OK] ZIP 解压完成" -ForegroundColor Green
    } catch {
        Write-Host "  [FAIL] ZIP 解压失败: $($_.Exception.Message)" -ForegroundColor Red
        Write-Host "         请手动解压到: $deployDir" -ForegroundColor White
        exit 1
    }

    # 检查解压结果
    Write-Host "  解压后文件清单:" -ForegroundColor Cyan
    Get-ChildItem $deployDir -Depth 1 | ForEach-Object {
        $prefix = if ($_.PSIsContainer) { "[DIR] " } else { "[FILE]" }
        Write-Host "    $prefix $($_.Name)" -ForegroundColor Gray
    }
} else {
    Write-Host "  [OK] 代码已存在于 $deployDir" -ForegroundColor Green
}

# 验证关键文件
$missingFiles = @()
if (-not (Test-Path "$deployDir\package.json")) { $missingFiles += "package.json" }
if (-not (Test-Path "$deployDir\src\server.js")) { $missingFiles += "src\server.js" }
if (-not (Test-Path "$deployDir\prisma\schema.prisma")) { $missingFiles += "prisma\schema.prisma" }
if (-not (Test-Path "$deployDir\prisma\seed.js")) { $missingFiles += "prisma\seed.js" }

if ($missingFiles.Count -gt 0) {
    Write-Host "  [FAIL] 缺少关键文件: $($missingFiles -join ', ')" -ForegroundColor Red
    Write-Host "         请检查 ZIP 包内容是否完整，或手动复制 server/ 目录下的文件到 $deployDir" -ForegroundColor White
    exit 1
} else {
    Write-Host "  [OK] 关键文件验证通过" -ForegroundColor Green
}
Write-Host ""

# ===== Step 5: 安装依赖 =====
Write-Host "[5/9] 安装 npm 依赖..." -ForegroundColor Yellow
Set-Location $deployDir
Refresh-Path

# 清理旧的 node_modules（可选，避免冲突）
if (Test-Path "node_modules") {
    Write-Host "  检测到旧 node_modules，跳过清理（如需强制清理请手动删除）" -ForegroundColor Gray
}

Write-Host "  执行 npm install --omit=dev （约3-10分钟，请耐心等待）..." -ForegroundColor Yellow
npm install --omit=dev 2>&1 | ForEach-Object {
    if ($_ -match "ERR|error|fail") {
        Write-Host "    $_" -ForegroundColor Red
    } elseif ($_ -match "warn|WARN") {
        Write-Host "    $_" -ForegroundColor Yellow
    } else {
        Write-Host "    $_" -ForegroundColor Gray
    }
}

if ($LASTEXITCODE -eq 0) {
    Write-Host "  [OK] 依赖安装完成" -ForegroundColor Green
} else {
    Write-Host "  [FAIL] npm install 失败，退出码: $LASTEXITCODE" -ForegroundColor Red
    Write-Host "  常见原因:" -ForegroundColor Yellow
    Write-Host "    1. 磁盘空间不足 → 执行: Get-PSDrive C | Select-Object Used,Free" -ForegroundColor White
    Write-Host "    2. 网络问题 → 重试: npm install --omit=dev" -ForegroundColor White
    Write-Host "    3. 权限问题 → 以管理员身份运行" -ForegroundColor White
    exit 1
}
Write-Host ""

# ===== Step 6: 生成 Prisma Client =====
Write-Host "[6/9] 生成 Prisma Client..." -ForegroundColor Yellow
Set-Location $deployDir
Refresh-Path

npx prisma generate 2>&1 | ForEach-Object {
    if ($_ -match "Error|error") {
        Write-Host "    $_" -ForegroundColor Red
    } else {
        Write-Host "    $_" -ForegroundColor Gray
    }
}

if ($LASTEXITCODE -eq 0) {
    Write-Host "  [OK] Prisma Client 生成完成" -ForegroundColor Green
} else {
    Write-Host "  [FAIL] Prisma generate 失败" -ForegroundColor Red
    exit 1
}
Write-Host ""

# ===== Step 7: 初始化数据库 =====
Write-Host "[7/9] 初始化数据库..." -ForegroundColor Yellow
Set-Location $deployDir

npx prisma db push 2>&1 | ForEach-Object {
    if ($_ -match "Error|error") {
        Write-Host "    $_" -ForegroundColor Red
    } else {
        Write-Host "    $_" -ForegroundColor Gray
    }
}
if ($LASTEXITCODE -ne 0) {
    Write-Host "  [WARN] db push 首次失败，尝试 --accept-data-loss..." -ForegroundColor Yellow
    npx prisma db push --accept-data-loss
}

# 执行 seed（可能已执行过，允许失败）
Write-Host "  执行 seed.js 初始化数据..." -ForegroundColor Yellow
$seedOutput = & node prisma/seed.js 2>&1
$seedExitCode = $LASTEXITCODE
$seedOutput | ForEach-Object { Write-Host "    $_" -ForegroundColor Gray }

if ($seedExitCode -eq 0) {
    Write-Host "  [OK] 数据库初始化完成" -ForegroundColor Green
} else {
    Write-Host "  [WARN] Seed 执行失败（可能数据已存在，通常可忽略）" -ForegroundColor Yellow
}
Write-Host ""

# ===== Step 8: 启动服务 =====
Write-Host "[8/9] 使用 PM2 启动服务..." -ForegroundColor Yellow
Set-Location $deployDir
Refresh-Path

# 停止旧进程（忽略错误）
pm2 delete qaxqjt-api 2>$null | Out-Null

# 启动新进程
pm2 start src/server.js --name qaxqjt-api --env production 2>&1 | ForEach-Object { Write-Host "    $_" }
pm2 save 2>&1 | Out-Null

Write-Host "  [OK] 服务已启动" -ForegroundColor Green
Write-Host ""
Write-Host "  PM2 进程列表:" -ForegroundColor Cyan
pm2 list 2>&1 | ForEach-Object { Write-Host "    $_" }
Write-Host ""

# ===== Step 9: 健康检查验证 =====
Write-Host "[9/9] 验证服务健康状态..." -ForegroundColor Yellow
Write-Host "  等待服务启动（5秒）..." -ForegroundColor Gray
Start-Sleep -Seconds 5

$maxAttempts = 3
$success = $false
for ($i = 1; $i -le $maxAttempts; $i++) {
    try {
        Write-Host "  尝试 $i / $maxAttempts ..." -ForegroundColor Gray
        $response = Invoke-RestMethod -Uri "http://127.0.0.1:3001/v1/healthz" -TimeoutSec 10
        Write-Host "  [OK] 健康检查通过！" -ForegroundColor Green
        Write-Host "  响应内容: $($response | ConvertTo-Json -Compress)" -ForegroundColor White
        $success = $true
        break
    } catch {
        Write-Host "  失败: $($_.Exception.Message)" -ForegroundColor Yellow
        if ($i -lt $maxAttempts) {
            Write-Host "  5秒后重试..." -ForegroundColor Gray
            Start-Sleep -Seconds 5
        }
    }
}

if (-not $success) {
    Write-Host ""
    Write-Host "  [FAIL] 健康检查未通过，查看 PM2 日志:" -ForegroundColor Red
    pm2 logs qaxqjt-api --lines 30 --nostream 2>&1 | ForEach-Object { Write-Host "    $_" }
}
Write-Host ""

# ===== 完成 =====
Write-Host "========================================" -ForegroundColor Green
Write-Host "  部署完成！" -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Green
Write-Host ""
Write-Host "  本地访问:    http://127.0.0.1:3001" -ForegroundColor White
Write-Host "  公网访问:    http://1.14.106.173:3001" -ForegroundColor White
Write-Host "  健康检查:    http://1.14.106.173:3001/v1/healthz" -ForegroundColor White
Write-Host ""
Write-Host "  常用 PM2 命令:" -ForegroundColor Cyan
Write-Host "    pm2 list              查看进程列表" -ForegroundColor White
Write-Host "    pm2 logs qaxqjt-api   查看日志" -ForegroundColor White
Write-Host "    pm2 restart all       重启所有服务" -ForegroundColor White
Write-Host "    pm2 stop qaxqjt-api   停止服务" -ForegroundColor White
Write-Host "    pm2 save              保存进程列表（开机自启）" -ForegroundColor White
Write-Host ""
Write-Host "  下一步: 在 EdgeOne Pages 控制台配置 API 反向代理/重写规则" -ForegroundColor Yellow
Write-Host "         目标地址: http://1.14.106.173:3001" -ForegroundColor Yellow
Write-Host ""
