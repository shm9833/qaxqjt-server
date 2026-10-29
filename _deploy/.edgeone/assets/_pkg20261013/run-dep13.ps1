# qaxqjt deploy 2026-10-13 : 5 backend files + 4 frontend files + pm2 restart
# Paste this ENTIRE block into the server PowerShell (Run as Administrator), then press Enter.
$ErrorActionPreference='Stop'
$log='C:\qaxqjt-frontend\admin\p-dep13-log.txt'
$mark='C:\qaxqjt-frontend\admin\p-dep13-mark.txt'
Remove-Item $mark -Force -ErrorAction SilentlyContinue
"START $(Get-Date -Format o)" | Out-File $log -Encoding ascii
try{
  [Net.ServicePointManager]::SecurityProtocol=[Net.SecurityProtocolType]::Tls12
  $apiToken='lDkluejBTrNP9BtoynmxVJhIXloRWcMbbvoWIP5ONOU='
  $base='https://qaxqjt-upload-whyv8l5f.edgeone.cool'
  $body=@{Action='DescribePagesEncipherToken';Text='qaxqjt-upload-whyv8l5f.edgeone.cool'}|ConvertTo-Json -Compress
  $resp=Invoke-RestMethod -Uri 'https://pages-api.cloud.tencent.com/v1' -Method POST -Headers @{Authorization="Bearer $apiToken"} -Body $body -ContentType 'application/json' -TimeoutSec 30
  $tok=$resp.Data.Response.Token; $ts=$resp.Data.Response.Timestamp
  Invoke-WebRequest "$base/?eo_token=$tok&eo_time=$ts" -SessionVariable S -UseBasicParsing -TimeoutSec 30 | Out-Null
  "SIGN_OK" | Out-File $log -Append -Encoding ascii
  $tmp='C:\Windows\Temp\dep13'; New-Item -ItemType Directory -Force $tmp | Out-Null
  $F=@(
    @('_pkg20261013/services-perf-ops-window.js','C:\qaxqjt-server\src\services\perf-ops-window.js',5994),
    @('_pkg20261013/controllers-perf-ops-window.js','C:\qaxqjt-server\src\controllers\perf-ops-window.js',2029),
    @('_pkg20261013/controllers-self-service.js','C:\qaxqjt-server\src\controllers\self-service.js',21583),
    @('_pkg20261013/controllers-performers-core.js','C:\qaxqjt-server\src\controllers\performers\core.js',18728),
    @('_pkg20261013/routes-v1-index.js','C:\qaxqjt-server\src\routes\v1\index.js',59141),
    @('admin/self-register.html','C:\qaxqjt-frontend\admin\self-register.html',36160),
    @('admin/self-portal.html','C:\qaxqjt-frontend\admin\self-portal.html',48596),
    @('admin/staff.html','C:\qaxqjt-frontend\admin\staff.html',112876),
    @('js/admin-pages/staff.js','C:\qaxqjt-frontend\js\admin-pages\staff.js',76329)
  )
  foreach($x in $F){
    $o=Join-Path $tmp (Split-Path $x[0] -Leaf)
    Invoke-WebRequest "$base/$($x[0])" -WebSession $S -OutFile $o -UseBasicParsing -TimeoutSec 90
    $t=[IO.File]::ReadAllText($o)
    $t2=[regex]::Replace($t,'<script defer src="https://cdnstatic\.tencentcs\.com/edgeone/pages/assets/unified\.js"[^>]*></script>','')
    if($t2 -ne $t){ "EO_INJECT_STRIPPED $($x[0])" | Out-File $log -Append -Encoding ascii }
    [IO.File]::WriteAllText($o,$t2,(New-Object System.Text.UTF8Encoding($false)))
    $sz=(Get-Item $o).Length
    if($sz -ne $x[2]){ throw "SIZE_MISMATCH $($x[0]) got=$sz want=$($x[2])" }
    "DL_OK $($x[0]) $sz" | Out-File $log -Append -Encoding ascii
  }
  foreach($x in $F){
    $src=Join-Path $tmp (Split-Path $x[0] -Leaf); $dst=$x[1]
    $dir=Split-Path $dst; if(!(Test-Path $dir)){ New-Item -ItemType Directory -Force $dir | Out-Null }
    if(Test-Path $dst){ $bk="$dst.bak-dep13"; if(!(Test-Path $bk)){ Copy-Item $dst $bk -Force } }
    Copy-Item $src $dst -Force
    "PUT_OK $dst" | Out-File $log -Append -Encoding ascii
  }
  $js=@('C:\qaxqjt-server\src\services\perf-ops-window.js','C:\qaxqjt-server\src\controllers\perf-ops-window.js','C:\qaxqjt-server\src\controllers\self-service.js','C:\qaxqjt-server\src\controllers\performers\core.js','C:\qaxqjt-server\src\routes\v1\index.js')
  foreach($j in $js){
    & 'C:\nodejs\node.exe' --check $j 2>&1 | Out-File $log -Append -Encoding ascii
    if($LASTEXITCODE -ne 0){ throw "SYNTAX_FAIL $j" }
  }
  "SYNTAX_ALL_OK" | Out-File $log -Append -Encoding ascii
  & 'C:\nodejs\pm2.cmd' restart qaxqjt-api 2>&1 | Out-File $log -Append -Encoding ascii
  Start-Sleep -Seconds 4
  $h=Invoke-WebRequest 'http://127.0.0.1:3001/v1/healthz' -UseBasicParsing -TimeoutSec 15
  "HEALTH $($h.StatusCode)" | Out-File $log -Append -Encoding ascii
  $w=Invoke-WebRequest 'http://127.0.0.1:3001/v1/performers/self-register/window' -UseBasicParsing -TimeoutSec 15
  $wc=$w.Content; if($wc.Length -gt 220){ $wc=$wc.Substring(0,220) }
  "WINDOW_API $($w.StatusCode) $wc" | Out-File $log -Append -Encoding ascii
  & 'C:\nodejs\pm2.cmd' save 2>&1 | Out-File $log -Append -Encoding ascii
  "DONE" | Out-File $mark -Encoding ascii
}catch{
  "FATAL $($_.Exception.Message)" | Out-File $log -Append -Encoding ascii
  "FATAL" | Out-File $mark -Encoding ascii
}
Write-Host "DEPLOY SCRIPT FINISHED - check p-dep13-mark.txt"
