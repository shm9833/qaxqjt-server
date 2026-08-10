<#
.SYNOPSIS
    秦安县秦剧团云端预约系统 - Vercel 前端部署脚本
.DESCRIPTION
    一键完成：1) 替换后端回源地址  2) vercel login 认证  3) vercel deploy --prod
    部署模式：前端静态页托管到 Vercel，后端 API 通过 rewrites 回源到云服务器
.PARAMETER BackendPublicHost
    后端云服务器的公网域名或IP（不带协议，不带路径）
    例如：43.136.1.2  或  api.yourdomain.com
.PARAMETER UseProjectRoot
    切换部署目录：$true = 部署项目根（vercel.json -> outputDirectory=_deploy）
                  $false = 直接部署 _deploy/ 目录（vercel.json 内置）
.EXAMPLE
    # 方式1：用项目根 vercel.json（推荐）
    .\deploy-vercel.ps1 -BackendPublicHost 43.136.1.2
.EXAMPLE
    # 方式2：直接上传 _deploy/
    .\deploy-vercel.ps1 -BackendPublicHost 43.136.1.2 -UseProjectRoot $false
.EXAMPLE
    # 只替换配置，不执行部署（先改好配置再手动上传到 Vercel）
    .\deploy-vercel.ps1 -BackendPublicHost 43.136.1.2 -SkipDeploy
#>
param(
    [Parameter(Mandatory=$true, HelpMessage="后端公网域名或IP，如 43.136.xx.xx")]
    [string]$BackendPublicHost,
    [Parameter(Mandatory=$false)]
    [bool]$UseProjectRoot = $true,
    [Parameter(Mandatory=$false)]
    [switch]$SkipDeploy
)

$ErrorActionPreference = "Stop"
$ProjectRoot = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  秦安县秦剧团云端预约系统 - Vercel 部署" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  后端回源地址 : https://$BackendPublicHost"
Write-Host "  部署模式     : $(if($UseProjectRoot){'项目根(outputDirectory=_deploy)'}else{'_deploy/ 独立上传'})"
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

#---------- Step 1: 替换 vercel.json 中的回源占位符 ----------
Write-Host "[1/4] 替换 vercel.json 回源地址占位符..." -ForegroundColor Yellow

$replacements = @(
    @{ File = (Join-Path $ProjectRoot "vercel.json"); Old = "`${YOUR_BACKEND_PUBLIC_HOST}"; New = $BackendPublicHost },
    @{ File = (Join-Path $ProjectRoot "_deploy\vercel.json"); Old = "YOUR_BACKEND_PUBLIC_HOST"; New = $BackendPublicHost },
    @{ File = (Join-Path $ProjectRoot "_deploy\.edgeone\assets\vercel.json"); Old = "YOUR_BACKEND_PUBLIC_HOST"; New = $BackendPublicHost }
)

foreach ($r in $replacements) {
    if (Test-Path $r.File) {
        $content = Get-Content $r.File -Raw -Encoding UTF8
        if ($content -like "*$($r.Old)*") {
            $content = $content.Replace($r.Old, $BackendPublicHost)
            Set-Content $r.File -Value $content -Encoding UTF8 -NoNewline
            Write-Host "  [OK] 已替换: $($r.File.Replace($ProjectRoot,'.'))"
        } else {
            Write-Host "  [SKIP] 占位符已替换: $($r.File.Replace($ProjectRoot,'.'))"
        }
    }
}

# 同时同步到 EdgeOne 副本（如果 _deploy/.edgeone/assets/vercel.json 不存在则创建）
$edgeoneVercel = Join-Path $ProjectRoot "_deploy\.edgeone\assets\vercel.json"
if (-not (Test-Path $edgeoneVercel)) {
    $srcVercel = Join-Path $ProjectRoot "_deploy\vercel.json"
    if (Test-Path $srcVercel) {
        New-Item -ItemType Directory -Path (Split-Path $edgeoneVercel) -Force | Out-Null
        Copy-Item $srcVercel $edgeoneVercel -Force
        Write-Host "  [OK] 同步到 .edgeone/assets/ 副本"
    }
}

#---------- Step 2: 更新 server/.env CORS 白名单 ----------
Write-Host "[2/4] 更新后端 server/.env CORS 白名单..." -ForegroundColor Yellow
$envFile = Join-Path $ProjectRoot "server\.env"
if (Test-Path $envFile) {
    $envContent = Get-Content $envFile -Raw -Encoding UTF8
    $vercelDomainHint = "  提示：Vercel 部署完成后会分配 xxx.vercel.app 域名，届时在服务器上执行："
    if ($envContent -like "*your-edgeone-pages.domain*") {
        Write-Host "  [OK] server/.env 已有占位符 your-edgeone-pages.domain"
        Write-Host $vercelDomainHint -ForegroundColor DarkGray
        Write-Host "  sed -i 's|your-edgeone-pages.domain|xxx.vercel.app|g' ~/qaxqjt-server/.env && pm2 restart qaxqjt-api" -ForegroundColor DarkGray
    } else {
        Write-Host "  [SKIP] server/.env 已配置 CORS（非占位符）"
    }
}

if ($SkipDeploy) {
    Write-Host ""
    Write-Host "  [SKIP] 已跳过部署步骤（-SkipDeploy 已指定）" -ForegroundColor DarkGray
    Write-Host "  下一步："
    Write-Host "  1. 打开 https://vercel.com 登录"
    Write-Host "  2. 新建 Project → 选择部署包目录 (Upload $(if($UseProjectRoot){'项目根 _deploy/'}else{'_deploy/'}))"
    Write-Host "  3. Framework Preset 选 Other，Build/Install/Dev 命令全部留空"
    Write-Host "  4. Deploy，获取分配的域名（如 qaxqjt-xxx.vercel.app）"
    Write-Host "  5. 回到服务器更新 CORS_ORIGINS = https://qaxqjt-xxx.vercel.app"
    Write-Host "  6. pm2 restart qaxqjt-api"
    Write-Host ""
    exit 0
}

#---------- Step 3: 验证 npx vercel ----------
Write-Host "[3/4] 准备 Vercel CLI..." -ForegroundColor Yellow

# 检查 Node.js
$nodeVer = node -v 2>$null
if (-not $nodeVer) {
    Write-Host "  [FAIL] 未检测到 Node.js，请先安装 Node.js 18+" -ForegroundColor Red
    exit 1
}
Write-Host "  Node.js: $nodeVer"

# 检查 Vercel 登录状态
Write-Host "  检查 Vercel 登录状态..."
try {
    $vercelStatus = & npx --yes vercel whoami 2>&1
    if ($LASTEXITCODE -eq 0 -and $vercelStatus -notlike "*not logged*") {
        Write-Host "  [OK] 已登录 Vercel: $vercelStatus"
    } else {
        Write-Host "  请在浏览器中完成 Vercel 登录..." -ForegroundColor Yellow
        Write-Host "  命令: npx vercel login"
        Write-Host "  将打开浏览器，点击确认后再返回此处继续。" -ForegroundColor Yellow
        pause

        & npx --yes vercel login
        if ($LASTEXITCODE -ne 0) {
            Write-Host "  [FAIL] Vercel 登录失败" -ForegroundColor Red
            exit 1
        }
        Write-Host "  [OK] Vercel 登录成功"
    }
} catch {
    Write-Host "  [FAIL] 无法执行 Vercel CLI：$($_.Exception.Message)" -ForegroundColor Red
    exit 1
}

#---------- Step 4: 预览部署（vercel，生成预览URL）----------
Write-Host "[4/5] Vercel 预览部署..." -ForegroundColor Yellow
$deployDir = if ($UseProjectRoot) { $ProjectRoot } else { Join-Path $ProjectRoot "_deploy" }

Push-Location $deployDir
try {
    Write-Host "  部署目录: $deployDir"
    Write-Host "  执行: npx vercel (预览部署)"
    Write-Host "  (首次部署会交互式询问项目名/团队/目录，按提示选择即可)" -ForegroundColor DarkGray
    Write-Host ""

    & npx --yes vercel
    $previewResult = $LASTEXITCODE

    if ($previewResult -ne 0) {
        Write-Host "  [FAIL] 预览部署失败（exit code = $previewResult）" -ForegroundColor Red
        Write-Host "  常见问题：" -ForegroundColor Yellow
        Write-Host "  - 第一次部署需要手动确认项目选项"
        Write-Host "  - 或直接登录 https://vercel.com 手动上传 _deploy/ 目录"
        exit 1
    }
    Write-Host "  [OK] 预览部署成功" -ForegroundColor Green
    Write-Host ""

    #---------- Step 5: 生产部署（vercel --prod）----------
    Write-Host "[5/5] Vercel 生产部署..." -ForegroundColor Yellow
    Write-Host "  执行: npx vercel --prod"
    Write-Host ""

    & npx --yes vercel --prod
    $deployResult = $LASTEXITCODE

    if ($deployResult -eq 0) {
        Write-Host ""
        Write-Host "========================================" -ForegroundColor Green
        Write-Host "  Vercel 生产部署成功！" -ForegroundColor Green
        Write-Host "========================================" -ForegroundColor Green
        Write-Host ""
        Write-Host "  下一步："
        Write-Host "  1. 复制上面输出的 Production URL（如 https://qaxqjt-xxx.vercel.app）"
        Write-Host "  2. SSH 登录服务器，执行："
        Write-Host "     cd ~/qaxqjt-server && nano .env"
        Write-Host "     将 CORS_ORIGINS=... 改为 =https://qaxqjt-xxx.vercel.app"
        Write-Host "     pm2 restart qaxqjt-api"
        Write-Host ""
        Write-Host "  3. 浏览器访问验证："
        Write-Host "     https://qaxqjt-xxx.vercel.app/api/v1/healthz  <- 应该返回 ok:true"
        Write-Host "     https://qaxqjt-xxx.vercel.app/booking.html        <- 打开预约页"
        Write-Host "     提交预约后检查返回 bookingId 前缀是否为 apt_"
        Write-Host ""
    } else {
        Write-Host "  [FAIL] 生产部署失败（exit code = $deployResult）" -ForegroundColor Red
        Write-Host "  预览URL已生成，可先检查预览效果，再手动执行 vercel --prod"
        exit 1
    }
} finally {
    Pop-Location
}
