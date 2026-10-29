# qaxqjt deploy 2026-10-13b : zip bundle (injection-immune) + verify + deploy + pm2
$ErrorActionPreference='Stop'
$runId=[guid]::NewGuid().ToString('N').Substring(0,8)
$log='C:\qaxqjt-frontend\admin\p-dep13-log.txt'
$mark='C:\qaxqjt-frontend\admin\p-dep13-mark.txt'
Remove-Item $mark -Force -ErrorAction SilentlyContinue
"START run=$runId $(Get-Date -Format o)" | Out-File $log -Encoding ascii
try{
  [Net.ServicePointManager]::SecurityProtocol=[Net.SecurityProtocolType]::Tls12
  $zip='C:\Windows\Temp\bundle-dep13.zip'
  $zu='https://raw.githubusercontent.com/shm9833/qaxqjt-server/main/_deploy20261013b/bundle-dep13.zip'
  Invoke-WebRequest $zu -OutFile $zip -UseBasicParsing -TimeoutSec 120
  $zlen=(Get-Item $zip).Length
  $zhash=(Get-FileHash $zip -Algorithm SHA256).Hash
  "ZIP_LEN=$zlen ZIP_SHA256=$zhash" | Out-File $log -Append -Encoding ascii
  if($zhash -ne '9C01F7C0BBBB1E2119437B8074FC72EFCAD3079D47B8EAB414C278B09A6671AF'){ throw "ZIP_HASH_MISMATCH got=$zhash" }
  $x='C:\Windows\Temp\dep13x'
  if(Test-Path $x){ Remove-Item $x -Recurse -Force }
  Expand-Archive -Path $zip -DestinationPath $x -Force
  "UNZIP_OK" | Out-File $log -Append -Encoding ascii
  $F=@(
    @('_pkg20261013\services-perf-ops-window.js','C:\qaxqjt-server\src\services\perf-ops-window.js',5994),
    @('_pkg20261013\controllers-perf-ops-window.js','C:\qaxqjt-server\src\controllers\perf-ops-window.js',2029),
    @('_pkg20261013\controllers-self-service.js','C:\qaxqjt-server\src\controllers\self-service.js',21583),
    @('_pkg20261013\controllers-performers-core.js','C:\qaxqjt-server\src\controllers\performers\core.js',18728),
    @('_pkg20261013\routes-v1-index.js','C:\qaxqjt-server\src\routes\v1\index.js',59141),
    @('admin\self-register.html','C:\qaxqjt-frontend\admin\self-register.html',36160),
    @('admin\self-portal.html','C:\qaxqjt-frontend\admin\self-portal.html',48596),
    @('admin\staff.html','C:\qaxqjt-frontend\admin\staff.html',112876),
    @('js\admin-pages\staff.js','C:\qaxqjt-frontend\js\admin-pages\staff.js',76329)
  )
  foreach($fx in $F){
    $src=Join-Path $x $fx[0]; $dst=$fx[1]
    if(!(Test-Path $src)){ throw "MISSING_IN_ZIP $($fx[0])" }
    $sz=(Get-Item $src).Length
    if($sz -ne $fx[2]){ throw "SIZE_MISMATCH $($fx[0]) got=$sz want=$($fx[2])" }
    $dir=Split-Path $dst
    if(!(Test-Path $dir)){ New-Item -ItemType Directory -Force $dir | Out-Null }
    if(Test-Path $dst){ $bk="$dst.bak-dep13"; if(!(Test-Path $bk)){ Copy-Item $dst $bk -Force } }
    Copy-Item $src $dst -Force
    "PUT_OK $($fx[0]) $sz" | Out-File $log -Append -Encoding ascii
  }
  $jl=@('C:\qaxqjt-server\src\services\perf-ops-window.js','C:\qaxqjt-server\src\controllers\perf-ops-window.js','C:\qaxqjt-server\src\controllers\self-service.js','C:\qaxqjt-server\src\controllers\performers\core.js','C:\qaxqjt-server\src\routes\v1\index.js')
  foreach($j in $jl){
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
"RUN_FINISHED $runId"
