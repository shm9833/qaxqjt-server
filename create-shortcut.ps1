# Create Chrome App Mode Desktop Shortcut
$targetUrl = "https://qaxqjt.cn/admin/login.html"
$shortcutName = "QAXQJT-Admin"
$desktopPath = [Environment]::GetFolderPath("Desktop")
$shortcutPath = Join-Path $desktopPath "$shortcutName.lnk"

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
    Write-Output "Chrome not found. Please install Google Chrome first."
    exit 1
}

Write-Output "Chrome found: $chromePath"

# Create shortcut
$WshShell = New-Object -ComObject WScript.Shell
$shortcut = $WshShell.CreateShortcut($shortcutPath)
$shortcut.TargetPath = $chromePath
$shortcut.Arguments = "--app=$targetUrl"
$shortcut.WorkingDirectory = Split-Path $chromePath -Parent
$shortcut.IconLocation = "$chromePath,0"
$shortcut.Description = "QAXQJT Cloud Booking System"
$shortcut.Save()

if (Test-Path $shortcutPath) {
    Write-Output "SUCCESS: Desktop shortcut created: $shortcutName.lnk"
    Write-Output ""
    Write-Output "Verification steps:"
    Write-Output "1. Double-click the shortcut on desktop"
    Write-Output "2. Confirm no address bar, no tabs, no Chrome toolbar"
    Write-Output "3. Window should show only the web app content"
    Write-Output ""
    Write-Output "To remove: simply delete $shortcutName.lnk from desktop"
} else {
    Write-Output "FAILED: Could not create shortcut"
    exit 1
}
