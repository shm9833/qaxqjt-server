# Batch Create Chrome App Mode Desktop Shortcuts for QAXQJT Admin Pages
# Usage: powershell -ExecutionPolicy Bypass -File create-all-shortcuts.ps1

$baseUrl = "https://qaxqjt.cn/admin"
$desktopPath = [Environment]::GetFolderPath("Desktop")

# Page list: URL path + Shortcut name
$pages = @(
    @{ path = "login.html";        name = "QAXQJT-Login" },
    @{ path = "staff.html";        name = "QAXQJT-Staff" },
    @{ path = "cast-sheet.html";   name = "QAXQJT-CastSheet" },
    @{ path = "finance.html";      name = "QAXQJT-Finance" },
    @{ path = "attendance.html";   name = "QAXQJT-Attendance" },
    @{ path = "accounts.html";     name = "QAXQJT-Accounts" },
    @{ path = "reports.html";      name = "QAXQJT-Reports" },
    @{ path = "schedule.html";     name = "QAXQJT-Schedule" },
    @{ path = "self-portal.html";  name = "QAXQJT-SelfPortal" }
)

# Find Chrome
$chromePath = $null
$possiblePaths = @(
    "${env:ProgramFiles}\Google\Chrome\Application\chrome.exe",
    "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe",
    "$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe"
)
foreach ($p in $possiblePaths) {
    if (Test-Path $p) { $chromePath = $p; break }
}

if (-not $chromePath) {
    Write-Output "ERROR: Chrome not found. Please install Google Chrome first."
    exit 1
}

Write-Output "Chrome found: $chromePath"
Write-Output ""

$created = 0
$failed = 0

foreach ($page in $pages) {
    $url = "$baseUrl/$($page.path)"
    $name = $page.name
    $shortcutPath = Join-Path $desktopPath "$name.lnk"

    try {
        $WshShell = New-Object -ComObject WScript.Shell
        $shortcut = $WshShell.CreateShortcut($shortcutPath)
        $shortcut.TargetPath = $chromePath
        $shortcut.Arguments = "--app=$url"
        $shortcut.WorkingDirectory = Split-Path $chromePath -Parent
        $shortcut.IconLocation = "$chromePath,0"
        $shortcut.Description = "QAXQJT - $($page.path)"
        $shortcut.Save()

        if (Test-Path $shortcutPath) {
            Write-Output "[OK] $name -> $url"
            $created++
        } else {
            Write-Output "[FAIL] $name -> Save failed"
            $failed++
        }
    } catch {
        Write-Output "[FAIL] $name -> $($_.Exception.Message)"
        $failed++
    }
}

Write-Output ""
Write-Output "========================================"
Write-Output "Created: $created shortcuts"
Write-Output "Failed:  $failed shortcuts"
Write-Output "========================================"
Write-Output ""
Write-Output "All shortcuts are on your Desktop."
Write-Output "Double-click any shortcut to open in app mode (no Chrome UI)."
Write-Output "To remove: delete the .lnk files from Desktop."
