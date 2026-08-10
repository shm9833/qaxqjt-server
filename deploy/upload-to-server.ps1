<#
.SYNOPSIS
    秦安县秦剧团云端预约系统 - Windows 上传后端代码到 Linux 服务器
.DESCRIPTION
    将 server/ 目录和部署脚本上传到远程服务器
    使用前请先修改下方 $SERVER_IP 和 $SSH_USER
.EXAMPLE
    .\upload-to-server.ps1                          # 使用脚本内默认IP
    .\upload-to-server.ps1 -ServerIP 43.136.1.2.3   # 命令行指定IP
    .\upload-to-server.ps1 -ServerIP 43.136.1.2.3 -SshUser ubuntu
#>
param(
    [Parameter(Mandatory=$true, HelpMessage="服务器公网IP，如 43.136.xx.xx")]
    [string]$ServerIP,
    [Parameter(Mandatory=$false)]
    [string]$SshUser = "ubuntu",
    [Parameter(Mandatory=$false)]
    [string]$IdentityFile = ""
)

$ErrorActionPreference = "Stop"
$ProjectRoot = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$ServerDir = Join-Path $ProjectRoot "server"
$DeployDir = Join-Path $ProjectRoot "deploy"

# 验证 server 目录存在
if (-not (Test-Path $ServerDir)) {
    Write-Host "[ERROR] server 目录不存在: $ServerDir" -ForegroundColor Red
    exit 1
}

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  上传后端代码到服务器" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  服务器IP : $ServerIP"
Write-Host "  SSH用户  : $SshUser"
Write-Host "  源目录   : $ServerDir"
Write-Host "  目标路径 : /home/$SshUser/qaxqjt-server"
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# 构建 SCP 参数
$scpTarget = "${SshUser}@${ServerIP}:/home/$SshUser/qaxqjt-server"
$scpArgs = @("-r", "-o", "StrictHostKeyChecking=accept-new")
if ($IdentityFile) {
    $scpArgs += @("-i", $IdentityFile)
}

# Step 1: 上传环境安装脚本
Write-Host "[1/4] 上传 setup-server.sh..." -ForegroundColor Yellow
$setupScript = Join-Path $DeployDir "setup-server.sh"
$scpArgs1 = @("-o", "StrictHostKeyChecking=accept-new")
if ($IdentityFile) { $scpArgs1 += @("-i", $IdentityFile) }
$scpArgs1 += @($setupScript, "${SshUser}@${ServerIP}:/home/$SshUser/")
& scp @scpArgs1
if ($LASTEXITCODE -eq 0) { Write-Host "  [OK] setup-server.sh 上传成功" -ForegroundColor Green }
else { Write-Host "  [FAIL] setup-server.sh 上传失败" -ForegroundColor Red; exit 1 }

# Step 2: 上传 Nginx 配置
Write-Host "[2/4] 上传 nginx 配置..." -ForegroundColor Yellow
$nginxConf = Join-Path $DeployDir "nginx-qaxqjt.conf"
if (Test-Path $nginxConf) {
    $scpArgs2 = @("-o", "StrictHostKeyChecking=accept-new")
    if ($IdentityFile) { $scpArgs2 += @("-i", $IdentityFile) }
    $scpArgs2 += @($nginxConf, "${SshUser}@${ServerIP}:/home/$SshUser/")
    & scp @scpArgs2
    if ($LASTEXITCODE -eq 0) { Write-Host "  [OK] nginx-qaxqjt.conf 上传成功" -ForegroundColor Green }
    else { Write-Host "  [FAIL] nginx 配置上传失败" -ForegroundColor Red; exit 1 }
} else {
    Write-Host "  [SKIP] nginx-qaxqjt.conf 不存在" -ForegroundColor DarkGray
}

# Step 3: 上传部署脚本
Write-Host "[3/4] 上传 deploy-production.sh..." -ForegroundColor Yellow
$deployScript = Join-Path $DeployDir "deploy-production.sh"
if (Test-Path $deployScript) {
    $scpArgs3 = @("-o", "StrictHostKeyChecking=accept-new")
    if ($IdentityFile) { $scpArgs3 += @("-i", $IdentityFile) }
    $scpArgs3 += @($deployScript, "${SshUser}@${ServerIP}:/home/$SshUser/")
    & scp @scpArgs3
    if ($LASTEXITCODE -eq 0) { Write-Host "  [OK] deploy-production.sh 上传成功" -ForegroundColor Green }
    else { Write-Host "  [FAIL] 部署脚本上传失败" -ForegroundColor Red; exit 1 }
} else {
    Write-Host "  [SKIP] deploy-production.sh 不存在" -ForegroundColor DarkGray
}

# Step 4: 上传 server 目录（排除 node_modules）
Write-Host "[4/4] 上传 server/ 目录（排除 node_modules）..." -ForegroundColor Yellow
$scpArgs4 = @("-r", "-o", "StrictHostKeyChecking=accept-new")
if ($IdentityFile) { $scpArgs4 += @("-i", $IdentityFile) }
# scp 不支持 --exclude，先创建目标目录再排除上传
# 创建临时打包目录
$tempZip = Join-Path $env:TEMP "qaxqjt-server-upload"
if (Test-Path $tempZip) { Remove-Item $tempZip -Recurse -Force }
New-Item -ItemType Directory -Path $tempZip -Force | Out-Null
Copy-Item -Path $ServerDir -Destination $tempZip -Recurse -Force
# 删除 node_modules 和 dev.db 减小传输体积
$nm = Join-Path $tempZip "server\node_modules"
if (Test-Path $nm) { Remove-Item $nm -Recurse -Force }
$dbFile = Join-Path $tempZip "server\prisma\dev.db"
if (Test-Path $dbFile) { Remove-Item $dbFile -Force }
$dbJournal = Join-Path $tempZip "server\prisma\dev.db-journal"
if (Test-Path $dbJournal) { Remove-Item $dbJournal -Force }

$scpArgs4 += @("$tempZip\server", $scpTarget)
& scp @scpArgs4
$uploadResult = $LASTEXITCODE
Remove-Item $tempZip -Recurse -Force -ErrorAction SilentlyContinue

if ($uploadResult -eq 0) {
    Write-Host "  [OK] server/ 目录上传成功" -ForegroundColor Green
} else {
    Write-Host "  [FAIL] server/ 目录上传失败" -ForegroundColor Red
    exit 1
}

Write-Host ""
Write-Host "========================================" -ForegroundColor Green
Write-Host "  上传完成！下一步操作：" -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Green
Write-Host ""
Write-Host "  1. SSH 登录服务器："
Write-Host "     ssh $SshUser@$ServerIP"
Write-Host ""
Write-Host "  2. 执行环境安装（首次）："
Write-Host "     chmod +x setup-server.sh && ./setup-server.sh"
Write-Host ""
Write-Host "  3. 执行生产部署："
Write-Host "     chmod +x deploy-production.sh && ./deploy-production.sh"
Write-Host ""
Write-Host "  4. 验证后端服务："
Write-Host "     curl http://127.0.0.1:3001/v1/healthz"
Write-Host ""
