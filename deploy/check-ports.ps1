param(
    [Parameter(Mandatory=$true)]
    [string]$ServerIP
)

$ports = @(22, 80, 443, 3001)
$portNames = @{
    22   = "SSH"
    80   = "HTTP"
    443  = "HTTPS"
    3001 = "API"
}

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  Port Check: $ServerIP" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

$allOpen = $true

foreach ($port in $ports) {
    $name = $portNames[$port]
    try {
        $tcp = New-Object System.Net.Sockets.TcpClient
        $result = $tcp.BeginConnect($ServerIP, $port, $null, $null)
        $wait = $result.AsyncWaitHandle.WaitOne(3000, $false)

        if ($wait -and $tcp.Connected) {
            Write-Host "  [OK]   Port $port ($name) - OPEN" -ForegroundColor Green
        } else {
            Write-Host "  [FAIL] Port $port ($name) - CLOSED" -ForegroundColor Red
            $allOpen = $false
        }
        $tcp.Close()
    } catch {
        Write-Host "  [FAIL] Port $port ($name) - CLOSED" -ForegroundColor Red
        $allOpen = $false
    }
}

Write-Host ""

if ($allOpen) {
    Write-Host "  All ports OPEN! Ready to deploy." -ForegroundColor Green
    Write-Host ""
    Write-Host "  Next: run upload script" -ForegroundColor Yellow
    Write-Host "    .\upload-to-server.ps1 -ServerIP $ServerIP -SshUser ubuntu" -ForegroundColor White
} else {
    Write-Host "  Some ports CLOSED. Configure firewall first:" -ForegroundColor Yellow
    Write-Host ""
    Write-Host "  1. https://console.cloud.tencent.com/lighthouse" -ForegroundColor White
    Write-Host "  2. Click instance -> Firewall tab" -ForegroundColor White
    Write-Host "  3. Add rules: TCP 22, 80, 443, 3001" -ForegroundColor White
    Write-Host ""
    Write-Host "  After config, re-run:" -ForegroundColor Yellow
    Write-Host "    .\check-ports.ps1 -ServerIP $ServerIP" -ForegroundColor White
}

Write-Host ""
