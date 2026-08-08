#!/usr/bin/env bash
# ==================================================================
# 秦安县秦剧团 · 前端 UI 回归测试 · 一键运行脚本 (Linux/macOS)
# 用法：bash run_ui_test.sh  或  chmod +x run_ui_test.sh && ./run_ui_test.sh
# 依赖：Python 3.x（仅需标准库，无需 pip install）
# ==================================================================
set -euo pipefail
cd "$(dirname "$0")"

echo ""
echo "================================================================"
echo "  秦安县秦剧团 · 前端 UI 回归测试"
echo "  防止 Bug 回归: 系统动态无限延长 / 派工单取消无显示 / HeightGuard 误判"
echo "================================================================"
echo ""

# ---- 1. 检查 Python ----
if command -v python3 &>/dev/null; then
    PY_CMD="python3 -u"
elif command -v python &>/dev/null; then
    PY_CMD="python -u"
else
    echo "[ERROR] 未找到 Python，请先安装 Python 3.x"
    exit 1
fi

# ---- 2. 检查测试脚本 ----
if [ ! -f "test_ui_regression.py" ]; then
    echo "[ERROR] 未找到 test_ui_regression.py，请确认在项目根目录运行"
    exit 1
fi

# ---- 3. 运行测试 ----
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
REPORT_DIR="reports"
mkdir -p "$REPORT_DIR"
REPORT_FILE="${REPORT_DIR}/ui_test_report_${TIMESTAMP}.txt"

echo "[INFO] Python: $PY_CMD"
echo "[INFO] 报告输出: $REPORT_FILE"
echo ""

set +e
$PY_CMD test_ui_regression.py 2>&1 | tee "$REPORT_FILE"
EXIT_CODE=${PIPESTATUS[0]}
set -e

echo ""
echo "================================================================"
if [ "$EXIT_CODE" -eq 0 ]; then
    echo "  ✅ 全部通过 - 0 失败"
else
    echo "  ❌ 存在失败项 - 请查看上方 [FAIL] 行"
fi
echo "  报告已保存: $REPORT_FILE"
echo "================================================================"
echo ""

exit "$EXIT_CODE"
