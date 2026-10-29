# 创建 Chrome 独立窗口桌面快捷方式
# 目标：https://qaxqjt.cn/admin/login.html
# 效果：无浏览器工具栏的独立窗口运行，类似原生应用

$targetUrl = "https://qaxqjt.cn/admin/login.html"
$shortcutName = "秦安县秦剧团云端预约系统"
$desktopPath = [Environment]::GetFolderPath("Desktop")
$shortcutPath = Join-Path $desktopPath "$shortcutName.lnk"

# 查找 Chrome 安装路径
$chromePaths = @(
    "${env:ProgramFiles}\Google\Chrome\Application\chrome.exe",
    "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe",
    "$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe"
)

$chromePath = $null
foreach ($path in $chromePaths) {
    if (Test-Path $path) {
        $chromePath = $path
        break
    }
}

if (-not $chromePath) {
    Write-Host "未找到 Chrome 浏览器，请先安装 Google Chrome" -ForegroundColor Red
    exit 1
}

Write-Host "找到 Chrome: $chromePath" -ForegroundColor Green

# 创建快捷方式
$WshShell = New-Object -ComObject WScript.Shell
$shortcut = $WshShell.CreateShortcut($shortcutPath)
$shortcut.TargetPath = $chromePath
$shortcut.Arguments = "--app=$targetUrl"
$shortcut.WorkingDirectory = Split-Path $chromePath -Parent
$shortcut.IconLocation = "$chromePath,0"
$shortcut.Description = "秦安县秦剧团文化演出有限公司云端预约系统"
$shortcut.Save()

if (Test-Path $shortcutPath) {
    Write-Host "桌面快捷方式已创建: $shortcutName.lnk" -ForegroundColor Green
    Write-Host ""
    Write-Host "验证步骤：" -ForegroundColor Cyan
    Write-Host "1. 双击桌面上的「$shortcutName」图标"
    Write-Host "2. 确认窗口无地址栏、无标签页、无浏览器工具栏"
    Write-Host "3. 窗口标题应显示网页标题，而非 Chrome 界面"
    Write-Host ""
    Write-Host "如需删除快捷方式，直接删除桌面上的「$shortcutName.lnk」即可。" -ForegroundColor Yellow
} else {
    Write-Host "快捷方式创建失败" -ForegroundColor Red
    exit 1
}
