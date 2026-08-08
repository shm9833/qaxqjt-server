#!/usr/bin/env bash
# ================================================================
#   秦安县秦剧团 · Admin Perf P99 日报
#   macOS LaunchAgent 一键安装（每天 凌晨 02:00 自动运行，唤醒可执行）
# ================================================================
#   使用：
#     1) cp config_daily_report.example.json config_daily_report.json
#        → 填入真实 ES / SMTP 账号
#     2) 先测试一次：
#          python3 daily_mailer.py --dry-run
#          python3 daily_mailer.py --test-smtp
#     3) bash install_daily_report_macos.sh
# ================================================================
set -e
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
cd "$SCRIPT_DIR"

# 1. 环境检查
if ! command -v python3 >/dev/null 2>&1; then
  echo "[❌] 未检测到 python3，执行 brew install python 或到 https://www.python.org 安装"
  exit 2
fi
PY3="$(command -v python3)"
if [ ! -f config_daily_report.json ]; then
  echo "[⚠️]  尚未发现 config_daily_report.json，自动从 example 复制，请编辑后重新运行本脚本"
  cp config_daily_report.example.json config_daily_report.json
  echo "  → 请编辑：$SCRIPT_DIR/config_daily_report.json"
  exit 3
fi

# 2. 一次 dry-run 校验
echo "[1/3] dry-run 校验（不发邮件）"
"$PY3" "$SCRIPT_DIR/daily_mailer.py" --dry-run

# 3. 生成 LaunchAgent plist
TARGET_HOUR=2        # 每天 凌晨 02:00
TARGET_MINUTE=0
LA_LABEL="com.qaxqjt.daily.perf.p99.report"
LA_DIR="$HOME/Library/LaunchAgents"
LA_PLIST="$LA_DIR/${LA_LABEL}.plist"
LOG_STDOUT="$SCRIPT_DIR/logs/launchd.out.log"
LOG_STDERR="$SCRIPT_DIR/logs/launchd.err.log"
mkdir -p "$LA_DIR" "$SCRIPT_DIR/logs" "$SCRIPT_DIR/reports"

cat > "$LA_PLIST" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${LA_LABEL}</string>

  <key>ProgramArguments</key>
  <array>
    <string>${PY3}</string>
    <string>${SCRIPT_DIR}/daily_mailer.py</string>
    <string>--config</string>
    <string>${SCRIPT_DIR}/config_daily_report.json</string>
  </array>

  <key>StartCalendarInterval</key>
  <dict>
    <key>Hour</key>
    <integer>${TARGET_HOUR}</integer>
    <key>Minute</key>
    <integer>${TARGET_MINUTE}</integer>
  </dict>

  <!-- 若到点电脑在睡眠，唤醒后补跑 -->
  <key>RunAtLoad</key>
  <false/>
  <key>StartCalendarIntervalLeeway</key>
  <integer>60</integer>

  <key>WorkingDirectory</key>
  <string>${SCRIPT_DIR}</string>
  <key>StandardOutPath</key>
  <string>${LOG_STDOUT}</string>
  <key>StandardErrorPath</key>
  <string>${LOG_STDERR}</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key>
    <string>/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin</string>
    <key>LANG</key>
    <string>zh_CN.UTF-8</string>
  </dict>
</dict>
</plist>
PLIST

chmod 644 "$LA_PLIST"

# 4. 加载（先卸载旧的）
echo "[2/3] 加载 LaunchAgent：${LA_PLIST}"
launchctl unload "$LA_PLIST" 2>/dev/null || true
sleep 1
launchctl load "$LA_PLIST"
sleep 1
launchctl start "$LA_LABEL"

echo "[3/3] 已触发一次立即执行（可查看日志 $LOG_STDOUT）"

sleep 2
echo ""
echo "======================================================================================="
echo "   ✅ macOS 日报定时任务安装成功"
echo "======================================================================================="
echo "   plist:        $LA_PLIST"
echo "   运行时间:     每天 ${TARGET_HOUR}:$(printf '%02d' $TARGET_MINUTE)"
echo "   立即手动跑:   launchctl start $LA_LABEL"
echo "   停止运行:     launchctl stop  $LA_LABEL"
echo "   卸载任务:     launchctl unload $LA_PLIST && rm $LA_PLIST"
echo "   查看日志:     tail -f $LOG_STDOUT   （错误日志：$LOG_STDERR）"
echo "   睡眠唤醒：    macOS 默认支持 StartCalendarInterval，电脑合上盖子会在唤醒后补跑"
echo "======================================================================================="
