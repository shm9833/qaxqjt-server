$ErrorActionPreference = 'Stop'
$PyPath = (Get-Command python).Source
if (-not $PyPath) { throw 'python not found' }
$ScriptPath = 'd:\全套最终整合交付（秦安县秦剧团云端预约系统·14文档+架构终审全汇总·可直接EdgeOne Pages部署）\qaxqjt\_serve_local.py'
$OutLog = 'C:\Users\hp\AppData\Local\Temp\trae-agent-toolhost\jobs\srv_out.log'
$ErrLog = 'C:\Users\hp\AppData\Local\Temp\trae-agent-toolhost\jobs\srv_err.log'
$P = Start-Process -FilePath $PyPath -ArgumentList $ScriptPath -PassThru -NoNewWindow `
    -RedirectStandardOutput $OutLog -RedirectStandardError $ErrLog
Start-Sleep -Seconds 4
if ($P.HasExited) {
    Write-Host "EXITED ExitCode=$($P.ExitCode)"
    Get-Content $OutLog -ErrorAction SilentlyContinue
    Get-Content $ErrLog -ErrorAction SilentlyContinue
    exit 1
} else {
    $R = Test-NetConnection 127.0.0.1 -Port 18089 -WarningAction SilentlyContinue
    Write-Host "PID=$($P.Id) tcp=$($R.TcpTestSucceeded)"
    try {
        $W = Invoke-WebRequest http://127.0.0.1:18089/ -UseBasicParsing -TimeoutSec 6
        Write-Host "HTTP200 len=$($W.Content.Length)"
    } catch {
        Write-Host "HTTP FAIL: $($_.Exception.Message)"
    }
    Get-Content $OutLog -ErrorAction SilentlyContinue
}
