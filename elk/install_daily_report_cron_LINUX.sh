#!/usr/bin/env bash
# ================================================================
#   秦安县秦剧团 · Admin Perf P99 日报
#   Linux / cron 一键安装（每天 凌晨 02:00 自动运行）
# ================================================================
#   使用：
#     1) cp config_daily_report.example.json config_daily_report.json
#        → 填入真实 ES / SMTP 账号
#     2) 先测试一次：
#          python3 daily_mailer.py --dry-run
#          python3 daily_mailer.py --test-smtp
#     3) bash install_daily_report_cron.sh
# ================================================================
set -e
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
cd "$SCRIPT_DIR"

if ! command -v python3 >/dev/null 2>&1; then
  echo "[❌] 未检测到 python3，请先 apt install python3 / yum install python3"
  exit 2
fi
PY3="$(command -v python3)"

if [ ! -f config_daily_report.json ]; then
  echo "[⚠️]  尚未发现 config_daily_report.json，自动从 example 复制，请编辑后重新运行本脚本"
  cp config_daily_report.example.json config_daily_report.json
  echo "  → 请编辑：$SCRIPT_DIR/config_daily_report.json"
  exit 3
fi

# 1. dry-run 校验
echo "[1/3] dry-run 校验"
"$PY3" "$SCRIPT_DIR/daily_mailer.py" --dry-run || { echo "[❌] dry-run 失败"; exit 5; }

CRON_HOUR=2
CRON_MIN=0
CRON_LOG="$SCRIPT_DIR/logs/cron.log"
CRON_MARKER="# QAXQJT-Admin-Perf-P99-Daily-Report"

mkdir -p "$SCRIPT_DIR/logs" "$SCRIPT_DIR/reports"

# 2. 构造 cron 条目
CRON_LINE="${CRON_MIN} ${CRON_HOUR} * * *  cd ${SCRIPT_DIR} && ${PY3} ${SCRIPT_DIR}/daily_mailer.py --config ${SCRIPT_DIR}/config_daily_report.json >> ${CRON_LOG} 2>&1  ${CRON_MARKER}"

# 3. 写入 crontab（去掉旧标记行，然后追加新行）
echo "[2/3] 写入 crontab：每天 ${CRON_HOUR}:$(printf '%02d' $CRON_MIN) 触发"
TEMP_CRON=$(mktemp)
crontab -l 2>/dev/null | grep -v -F "$CRON_MARKER" > "$TEMP_CRON" || true
echo "$CRON_LINE" >> "$TEMP_CRON"
crontab "$TEMP_CRON"
rm -f "$TEMP_CRON"

# 4. 立即触发一次（直接后台执行）
echo "[3/3] 立即手动触发一次（后台运行，日志：$CRON_LOG）"
( cd "$SCRIPT_DIR" && "$PY3" "$SCRIPT_DIR/daily_mailer.py" --config "$SCRIPT_DIR/config_daily_report.json" >> "$CRON_LOG" 2>&1 ) &

sleep 2
echo ""
echo "======================================================================================="
echo "   ✅ Linux crontab 日报定时任务安装成功"
echo "======================================================================================="
echo "   cron 条目:   $CRON_LINE"
echo "   查看 crontab: crontab -l"
echo "   立即手动跑:   cd $SCRIPT_DIR && $PY3 daily_mailer.py"
echo "   查看日志:     tail -f $CRON_LOG"
echo "   卸载任务:     crontab -l | grep -v -F \"$CRON_MARKER\" | crontab -"
echo "======================================================================================="
