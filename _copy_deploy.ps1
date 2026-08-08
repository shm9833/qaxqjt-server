$ErrorActionPreference = "Stop"
$root = "d:\全套最终整合交付（秦安县秦剧团云端预约系统·14文档+架构终审全汇总·可直接EdgeOne Pages部署）\qaxqjt"
$base = Join-Path $root "admin"
$dest1 = Join-Path $root "_deploy\admin"
$dest2 = Join-Path $root "_deploy\.edgeone\assets\admin"
$files = @('index.html','orders.html','operas.html','schedule.html','cast-sheet.html','content.html','finance.html','staff.html','system.html','accounts.html','inventory.html','reports.html')
foreach ($f in $files) {
  $src = Join-Path $base $f
  $d1 = Join-Path $dest1 $f
  $d2 = Join-Path $dest2 $f
  Copy-Item $src -Destination $d1 -Force
  Copy-Item $src -Destination $d2 -Force
  Write-Host "COPIED: $f  ->  _deploy/admin + _deploy/.edgeone/assets/admin"
}
Write-Host "`nAll 12 files deployed successfully." -ForegroundColor Green
