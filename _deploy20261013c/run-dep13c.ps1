# qaxqjt deploy 2026-10-13c : opera posters (20 jpg) + repertoire list svg (static assets only, no pm2)
$ErrorActionPreference='Stop'
$runId=[guid]::NewGuid().ToString('N').Substring(0,8)
$log='C:\qaxqjt-frontend\admin\p-dep13c-log.txt'
$mark='C:\qaxqjt-frontend\admin\p-dep13c-mark.txt'
Remove-Item $mark -Force -ErrorAction SilentlyContinue
"START run=$runId $(Get-Date -Format o)" | Out-File $log -Encoding ascii
try{
  [Net.ServicePointManager]::SecurityProtocol=[Net.SecurityProtocolType]::Tls12
  $zip='C:\Windows\Temp\bundle-dep13c.zip'
  $zu='https://raw.githubusercontent.com/shm9833/qaxqjt-server/main/_deploy20261013c/bundle-dep13c.zip'
  Invoke-WebRequest $zu -OutFile $zip -UseBasicParsing -TimeoutSec 300
  $zlen=(Get-Item $zip).Length
  $zhash=(Get-FileHash $zip -Algorithm SHA256).Hash
  "ZIP_LEN=$zlen ZIP_SHA256=$zhash" | Out-File $log -Append -Encoding ascii
  if($zhash -ne '10D00E0F72FD827522FE6AACF7E81D6451585F2DF7BEDC1A63F1A1018BDE9182'){ throw "ZIP_HASH_MISMATCH got=$zhash" }
  $x='C:\Windows\Temp\dep13cx'
  if(Test-Path $x){ Remove-Item $x -Recurse -Force }
  Expand-Archive -Path $zip -DestinationPath $x -Force
  "UNZIP_OK" | Out-File $log -Append -Encoding ascii
  # 1) posters: 20 jpg with final ASCII names, copy as-is
  $pdir=Join-Path $x 'img\posters'
  $jpgs=Get-ChildItem $pdir -Filter 'opera_*.jpg'
  "JPG_COUNT=$($jpgs.Count)" | Out-File $log -Append -Encoding ascii
  if($jpgs.Count -ne 20){ throw "JPG_COUNT_MISMATCH got=$($jpgs.Count)" }
  foreach($f in $jpgs){
    if($f.Length -lt 20000){ throw "TOO_SMALL $($f.Name) $($f.Length)" }
  }
  $dst='C:\qaxqjt-frontend\img\posters'
  if(!(Test-Path $dst)){ New-Item -ItemType Directory -Force $dst | Out-Null }
  Copy-Item (Join-Path $pdir 'opera_*.jpg') $dst -Force
  "POSTERS_COPIED 20" | Out-File $log -Append -Encoding ascii
  # 2) repertoire svg: old file has Chinese name, locate by exact old SHA256, overwrite
  $oldHash='1B57A663559CB6B21A9E8FBED21B38CBE6F43E4ED71790DA069D26C3A99AFA03'
  $newHash='2F3A0BF8EC5EEBC7DC415546E5B8CBB850E92481E910A2BB0EBB017D14F82201'
  $svgNew=Join-Path $x 'img\opera-more-new.svg'
  if(!(Test-Path $svgNew)){ throw 'MISSING_IN_ZIP opera-more-new.svg' }
  $newLen=(Get-Item $svgNew).Length
  $cands=Get-ChildItem 'C:\qaxqjt-frontend\img\opera_*.svg'
  $hit=$null
  foreach($c in $cands){
    if((Get-FileHash $c.FullName -Algorithm SHA256).Hash -eq $oldHash){ $hit=$c; break }
  }
  if($hit){
    Copy-Item $svgNew $hit.FullName -Force
    $vhash=(Get-FileHash $hit.FullName -Algorithm SHA256).Hash
    "SVG_REPLACED len=$newLen newhash=$vhash" | Out-File $log -Append -Encoding ascii
    if($vhash -ne $newHash){ throw 'SVG_VERIFY_MISMATCH' }
  }else{
    foreach($c in $cands){
      "SVG_CAND len=$($c.Length) hash=$((Get-FileHash $c.FullName -Algorithm SHA256).Hash)" | Out-File $log -Append -Encoding ascii
    }
    $already=Get-ChildItem 'C:\qaxqjt-frontend\img\opera_*.svg' | Where-Object { (Get-FileHash $_.FullName -Algorithm SHA256).Hash -eq $newHash }
    if($already){ "SVG_ALREADY_NEW" | Out-File $log -Append -Encoding ascii }
    else{ throw 'SVG_TARGET_NOT_FOUND' }
  }
  # 3) HTTP probes via local webroot
  Start-Sleep -Seconds 1
  $p1=Invoke-WebRequest 'http://127.0.0.1/img/posters/opera_poningguo.jpg' -UseBasicParsing -TimeoutSec 15
  "HTTP_POSTER $($p1.StatusCode) len=$($p1.RawContentLength)" | Out-File $log -Append -Encoding ascii
  $p2=Invoke-WebRequest 'http://127.0.0.1/img/posters/opera_zhourenhuifu.jpg' -UseBasicParsing -TimeoutSec 15
  "HTTP_POSTER2 $($p2.StatusCode) len=$($p2.RawContentLength)" | Out-File $log -Append -Encoding ascii
  $s1=Invoke-WebRequest 'http://127.0.0.1/img/opera_%E6%9B%B4%E5%A4%9A.svg' -UseBasicParsing -TimeoutSec 15
  "HTTP_SVG $($s1.StatusCode) len=$($s1.RawContentLength)" | Out-File $log -Append -Encoding ascii
  "DONE" | Out-File $mark -Encoding ascii
}catch{
  "FATAL $($_.Exception.Message)" | Out-File $log -Append -Encoding ascii
  "FATAL" | Out-File $mark -Encoding ascii
}
"RUN_FINISHED $runId"
