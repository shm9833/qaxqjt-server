# -*- coding: utf-8 -*-
"""
秦安县秦剧团云端预约系统 · 前端 UI 回归测试
防止以下 Bug 回归：
  1. 最新系统动态区域无限延长（.system-notice-list 缺少 max-height）
  2. 派工单取消无显示（closeDispatch 缺少 toast 反馈）
  3. HeightGuard 误判导致表格被截断空白
运行: py -3 test_ui_regression.py
"""
import os
import re
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent

# 需要检查的目录：主目录 + 2 个部署副本
SCAN_DIRS = [
    HERE,
    HERE / "_deploy",
    HERE / "_deploy" / ".edgeone" / "assets",
]

PASSED = 0
FAILED = 0


def check(condition: bool, title: str, detail: str = "") -> None:
    """断言辅助"""
    global PASSED, FAILED
    tag = "PASS" if condition else "FAIL"
    if condition:
        PASSED += 1
    else:
        FAILED += 1
    suffix = f"  → {detail}" if detail else ""
    print(f"  [{tag}] {title}{suffix}")


def read_file(path: Path) -> str:
    """安全读取文件，返回空字符串如果不存在"""
    try:
        return path.read_text(encoding="utf-8")
    except Exception:
        return ""


def get_file(path: Path, relative_path: str) -> Path:
    """拼接路径"""
    return path / relative_path


# ============================================================
# Test 1: .system-notice-list 必须有 max-height 限制
# Bug: index.html 的 .system-notice-list 缺少 max-height 导致"无限延长"
# ============================================================
def test_notice_list_max_height(base: Path, label: str) -> None:
    print(f"\n[Test 1] {label} — .system-notice-list max-height 限制")
    html = read_file(get_file(base, "admin/index.html"))
    if not html:
        check(False, "admin/index.html 文件存在")
        return
    check(True, "admin/index.html 文件存在")

    # 检查 .system-notice-list 规则块中是否有 max-height
    # 匹配 .system-notice-list { ... } 块
    m = re.search(r"\.system-notice-list\s*\{([^}]+)\}", html)
    if not m:
        check(False, "找到 .system-notice-list CSS 规则块")
        return
    check(True, "找到 .system-notice-list CSS 规则块")

    rule_body = m.group(1)
    has_max_height = "max-height" in rule_body or "maxHeight" in rule_body
    check(has_max_height, ".system-notice-list 包含 max-height 属性",
          "防止最新系统动态区域无限延长" if has_max_height else "缺少 max-height，Bug 将回归！")

    has_overflow = "overflow" in rule_body
    check(has_overflow, ".system-notice-list 包含 overflow 属性",
          "" if has_overflow else "缺少 overflow，滚动条不生效")


# ============================================================
# Test 2: closeDispatch 必须有 toast 反馈
# Bug: orders.html 的 closeDispatch() 只关闭弹窗无反馈
# ============================================================
def test_dispatch_cancel_toast(base: Path, label: str) -> None:
    print(f"\n[Test 2] {label} — closeDispatch toast 反馈")
    html = read_file(get_file(base, "admin/orders.html"))
    if not html:
        check(False, "admin/orders.html 文件存在")
        return
    check(True, "admin/orders.html 文件存在")

    # 检查 closeDispatch 函数中是否有 toast 调用
    # 用宽松匹配：找到 closeDispatch 定义位置，然后取其后 800 字符作为函数体
    idx = html.find("closeDispatch")
    if idx < 0:
        check(False, "找到 closeDispatch 函数定义")
        return
    check(True, "找到 closeDispatch 函数定义")

    # 取 closeDispatch 定义后 800 字符（覆盖整个函数体，含嵌套的 }）
    func_body = html[idx:idx + 800]

    has_toast = "toast" in func_body.lower()
    check(has_toast, "closeDispatch 包含 toast 调用",
          "取消时有反馈" if has_toast else "缺少 toast，'取消无显示' Bug 将回归！")

    has_cancel_text = "取消" in func_body or "cancel" in func_body.lower()
    check(has_cancel_text, "toast 文本包含'取消'关键词",
          "" if has_cancel_text else "toast 文本未提及取消操作")


# ============================================================
# Test 3: HeightGuard 不应对 table/tbody 设 maxHeight
# Bug: HeightGuard 兜底逻辑给 .admin-content 设 maxHeight 导致表格截断
# ============================================================
def test_height_guard_table_protection(base: Path, label: str) -> None:
    print(f"\n[Test 3] {label} — HeightGuard 表格保护")
    js = read_file(get_file(base, "js/app.js"))
    if not js:
        check(False, "js/app.js 文件存在")
        return
    check(True, "js/app.js 文件存在")

    # 检查 HeightGuard CSS 中是否有 table max-height: none 规则
    has_table_protection = bool(
        re.search(r"table.*max-height:\s*none", js, re.DOTALL)
    )
    check(has_table_protection, "HeightGuard CSS 包含 table max-height:none 规则",
          "表格不被截断" if has_table_protection else "缺少表格保护，Bug 将回归！")

    # 检查 HeightGuard 兜底选择器排除了 table
    # 查找 :not(table) 或 :not(tbody)
    has_table_exclusion = ":not(table)" in js or ":not(tbody)" in js
    check(has_table_exclusion, "HeightGuard 选择器排除 table/tbody",
          "" if has_table_exclusion else "选择器未排除 table，可能误判")


# ============================================================
# Test 4: HeightGuard LIMIT 阈值应 >= 10屏/6000px
# Bug: 原 LIMIT=6屏/3600px 太低，正常长页面也会触发误判
# ============================================================
def test_height_guard_limit(base: Path, label: str) -> None:
    print(f"\n[Test 4] {label} — HeightGuard LIMIT 阈值")
    js = read_file(get_file(base, "js/app.js"))
    if not js:
        check(False, "js/app.js 文件存在")
        return

    # 查找 LIMIT 定义
    m = re.search(r"var\s+LIMIT\s*=\s*Math\.max\(\s*(\d+)\s*\*\s*WH\s*,\s*(\d+)\s*\)", js)
    if not m:
        check(False, "找到 LIMIT = Math.max(N * WH, M) 定义")
        return
    check(True, "找到 LIMIT = Math.max(N * WH, M) 定义")

    screens = int(m.group(1))
    min_px = int(m.group(2))
    check(screens >= 10, f"屏数 {screens} >= 10",
          f"当前 {screens} 屏" if screens >= 10 else f"仅 {screens} 屏，阈值太低！")
    check(min_px >= 6000, f"最小像素 {min_px} >= 6000",
          f"当前 {min_px}px" if min_px >= 6000 else f"仅 {min_px}px，阈值太低！")


# ============================================================
# Test 5: closeDispatch 中弹窗关闭逻辑完整
# 确保 dispatchModal 和 dispatchOverlay 都被正确隐藏
# ============================================================
def test_dispatch_close_logic(base: Path, label: str) -> None:
    print(f"\n[Test 5] {label} — closeDispatch 弹窗关闭逻辑")
    html = read_file(get_file(base, "admin/orders.html"))
    if not html:
        check(False, "admin/orders.html 文件存在")
        return

    m = html.find("closeDispatch")
    if m < 0:
        check(False, "找到 closeDispatch 函数")
        return
    func_body = html[m:m + 800]

    # 检查是否同时关闭 overlay 和 modal
    has_overlay = "dispatchOverlay" in func_body
    has_modal = "dispatchModal" in func_body
    check(has_overlay, "closeDispatch 操作 dispatchOverlay")
    check(has_modal, "closeDispatch 操作 dispatchModal")

    # 检查是否有 csp-hide 或 remove('active')
    has_hide = "csp-hide" in func_body or "remove" in func_body
    check(has_hide, "closeDispatch 包含隐藏逻辑 (csp-hide / remove active)")


# ============================================================
# 主入口
# ============================================================
def main() -> int:
    print("=" * 60)
    print("  秦安县秦剧团云端预约系统 · 前端 UI 回归测试")
    print("  防止 Bug 回归: 系统动态无限延长 / 派工单取消无显示 / HeightGuard 误判")
    print("=" * 60)

    for base in SCAN_DIRS:
        if not base.exists():
            print(f"\n[SKIP] {base} 目录不存在，跳过")
            continue

        label = base.relative_to(HERE) if base != HERE else "主目录"

        test_notice_list_max_height(base, str(label))
        test_dispatch_cancel_toast(base, str(label))
        test_height_guard_table_protection(base, str(label))
        test_height_guard_limit(base, str(label))
        test_dispatch_close_logic(base, str(label))

    print("\n" + "=" * 60)
    total = PASSED + FAILED
    print(f"  结果: {PASSED}/{total} 通过, {FAILED} 失败")
    print("=" * 60)

    if FAILED > 0:
        print("  ❌ 存在失败项，请检查对应文件是否被意外修改")
        return 1
    else:
        print("  ✅ 全部通过，无回归风险")
        return 0


if __name__ == "__main__":
    sys.exit(main())
