# ============================================================
#  秦安县秦剧团云端预约系统 · 部署后冒烟连通性检测 V2026.8.3
#  用法：PowerShell 执行 →  .\_smoke_check.ps1 -BaseUrl "https://你的域名"
#  作用：10秒内 14 个关键页 HTTP 200 + 标题关键词 双校验
# ============================================================
param(
    [string]$BaseUrl = ""   # 例如：https://qaxqjt.example.com （不要尾部 /）
)

$ErrorActionPreference = "Stop"
$pages = @(
    @{ Rel = "/index.html";              Title = "秦安县秦剧团" },
    @{ Rel = "/booking.html";            Title = "在线预约" },
    @{ Rel = "/operas.html";             Title = "剧目展演" },
    @{ Rel = "/cast-public.html";        Title = "阵容公开" },
    @{ Rel = "/news.html";               Title = "新闻动态" },
    @{ Rel = "/contact.html";            Title = "联系我们" },
    @{ Rel = "/qualifications.html";     Title = "资质核验" },
    @{ Rel = "/services.html";           Title = "演出服务" },
    @{ Rel = "/admin/login.html";        Title = "后台登录" },
    @{ Rel = "/admin/index.html";        Title = "控制台" },
    @{ Rel = "/admin/orders.html";       Title = "订单预约管理" },
    @{ Rel = "/admin/finance.html";      Title = "财务收支台账" },
    @{ Rel = "/admin/attendance.html";   Title = "考勤与工资核算" },
    @{ Rel = "/admin/cast-sheet.html";   Title = "演出演员表配置" }
)

if ([string]::IsNullOrWhiteSpace($BaseUrl)) {
    Write-Host "`n❌ 请先部署 ZIP 到 EdgeOne Pages 获取域名后，执行：" -ForegroundColor Red
    Write-Host "   .\_smoke_check.ps1 -BaseUrl `"https://你的域名`"`n" -ForegroundColor Yellow
    Write-Host "本地临时调试可运行： .\_smoke_check.ps1 -BaseUrl `"http://localhost:8080`"`n"
    exit 1
}

$BaseUrl = $BaseUrl.TrimEnd('/')
$pass = 0; $fail = 0; $results = @()
$sw = [System.Diagnostics.Stopwatch]::StartNew()

Write-Host "`n============================================================" -ForegroundColor Cyan
Write-Host "  🚀 部署后冒烟连通性检测 · 14 关键页" -ForegroundColor Cyan
Write-Host "  📍 BaseUrl: $BaseUrl" -ForegroundColor Cyan
Write-Host "  ⏱️  开始: $(Get-Date -Format 'HH:mm:ss')" -ForegroundColor Cyan
Write-Host "============================================================`n"

foreach ($p in $pages) {
    $url = $BaseUrl + $p.Rel
    try {
        $resp = Invoke-WebRequest -Uri $url -Method Get -UseBasicParsing -TimeoutSec 8
        $code = [int]$resp.StatusCode
        $html = $resp.Content
        $titleOk = ($html -match "<title>[^<]*$($p.Title)[^<]*</title>") -or ($html -match [regex]::Escape($p.Title))
        $ok = ($code -eq 200) -and $titleOk
        if ($ok) {
            Write-Host ("✅ " + $p.Rel.PadRight(35) + " HTTP " + $code + "  ·  标题命中: " + $p.Title) -ForegroundColor Green
            $pass++
            $results += @{ Rel=$p.Rel; Status="PASS"; HTTP=$code; Note="OK" }
        } else {
            $note = if ($code -ne 200) {"HTTP $code"} else {"标题未匹配 '$($p.Title)'"}
            Write-Host ("❌ " + $p.Rel.PadRight(35) + " HTTP " + $code + "  ·  失败原因: " + $note) -ForegroundColor Red
            $fail++
            $results += @{ Rel=$p.Rel; Status="FAIL"; HTTP=$code; Note=$note }
        }
    } catch {
        $err = $_.Exception.Message
        if ($err.Length -gt 80) { $err = $err.Substring(0,80) + "…" }
        Write-Host ("💥 " + $p.Rel.PadRight(35) + " 异常: " + $err) -ForegroundColor Red
        $fail++
        $results += @{ Rel=$p.Rel; Status="EXCEPTION"; HTTP=0; Note=$err }
    }
}

$sw.Stop()
Write-Host "`n============================================================" -ForegroundColor Cyan
Write-Host ("  📊 结果:  PASS " + $pass + "  /  FAIL " + $fail + "  /  总计 " + $pages.Count) -ForegroundColor $(if($fail -eq 0){"Green"}else{"Red"})
Write-Host ("  ⏱️  耗时: " + [math]::Round($sw.Elapsed.TotalSeconds,2) + " 秒") -ForegroundColor Cyan
Write-Host "============================================================`n"

if ($fail -eq 0) {
    Write-Host "🎉 全部 14 页连通性通过！接下来请按 8 页冒烟清单手动验证 Console + 功能`n" -ForegroundColor Green
} else {
    Write-Host "⚠️  存在 $fail 项失败，请先检查：域名是否正确 / EdgeOne Pages 版本是否已上线 / ZIP 是否完整`n" -ForegroundColor Yellow
    Write-Host "失败详情：" -ForegroundColor Yellow
    $results | Where-Object { $_.Status -ne "PASS" } | ForEach-Object {
        Write-Host ("  · " + $_.Rel + " → " + $_.Status + "｜" + $_.Note) -ForegroundColor Yellow
    }
    Write-Host ""
}

# 导出 CSV 报告（可选）
$outCsv = "_output\smoke_$(Get-Date -Format 'yyyyMMdd_HHmmss').csv"
try {
    $results | ForEach-Object { [PSCustomObject]$_ } | Export-Csv -Path $outCsv -NoTypeInformation -Encoding UTF8
    Write-Host "📄 详情已导出: $outCsv`n" -ForegroundColor Gray
} catch {}
