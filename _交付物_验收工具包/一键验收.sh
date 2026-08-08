#!/usr/bin/env bash
# ========================================================
#  秦安县秦剧团云端预约系统 · 按钮兜底机制 一键验收
#  Linux / macOS 双击 / 命令行运行版
#  使用：
#     方式一：chmod +x 一键验收.sh && ./一键验收.sh
#     方式二：在 Finder 中右键 → 打开方式 → 终端
# ========================================================
set -e
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
TESTS_DIR="$SCRIPT_DIR/_tests"
TS=$(date +%Y%m%d_%H%M%S)
LOG_FILE="$SCRIPT_DIR/验收报告_${TS}.log"

echo
echo "╔══════════════════════════════════════════════════════════════════╗"
echo "║  🎯  秦安县秦剧团云端预约系统 · 按钮兜底机制 一键验收            ║"
echo "║     三阶段：42页注入验证  →  回归测试  →  200用户高并发压测      ║"
echo "╚══════════════════════════════════════════════════════════════════╝"
echo
echo "[ℹ️]  工作目录: $TESTS_DIR"
echo "[ℹ️]  验收日志: $LOG_FILE"
echo

# ---------- 检查 Node.js ----------
if ! command -v node >/dev/null 2>&1; then
    echo "❌  未检测到 Node.js，请先安装 Node.js 16+"
    echo "     macOS:   brew install node@20"
    echo "     Ubuntu:  sudo apt install -y nodejs npm"
    echo "     下载:    https://nodejs.org/"
    echo
    read -n 1 -s -r -p "按任意键退出..."
    exit 1
fi
NODE_VER=$(node -v)
echo "[✅] Node.js 已就绪: $NODE_VER"

# ---------- 检查依赖 jsdom ----------
echo
echo "[⏳] 检查并安装运行依赖（jsdom，仅首次需要）..."
if [ ! -d "$TESTS_DIR/node_modules/jsdom" ]; then
    ( cd "$TESTS_DIR" && npm install jsdom --no-audit --no-fund --loglevel=error 2>/dev/null || true )
fi
if [ -d "$TESTS_DIR/node_modules/jsdom" ]; then
    echo "[✅] 依赖 jsdom 已就绪"
else
    echo "⚠️  依赖安装未检测到，将尝试直接运行（如报 Cannot find module jsdom，请手动: cd _tests && npm install jsdom）"
fi

# ---------- 运行三阶段验收 ----------
echo
echo "[🚀] 开始执行三阶段验收（预计耗时 30~60 秒，请勿关闭窗口）..."
echo
EXIT_CODE=0
( cd "$TESTS_DIR" && node run_all.js ) 2>&1 | tee "$LOG_FILE" || EXIT_CODE=$?

echo
echo "──────────────────────────────────────────────────────────────────"
if [ "$EXIT_CODE" -eq 0 ]; then
    echo "✅  全部验收通过！详细日志见: $LOG_FILE"
else
    echo "❌  验收未完全通过（退出码 $EXIT_CODE），请查看上方红色错误提示或日志:"
    echo "    $LOG_FILE"
fi
echo "──────────────────────────────────────────────────────────────────"
echo
echo "（可截图本窗口底部结论，或直接把 .log 文件发给技术对接人）"
echo
read -n 1 -s -r -p "按任意键退出..."
exit $EXIT_CODE
