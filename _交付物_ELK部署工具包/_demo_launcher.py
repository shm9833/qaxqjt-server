#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
秦安县秦剧团 · 一键完整演示启动器
流程：
  1) 后台启动 mock_local_smtp_server.py（监听 127.0.0.1:10025）
  2) 等待服务器就绪
  3) 先跑 --test-smtp（连通性测试，发送测试邮件到 Mock）
  4) 再跑完整 daily_mailer.py --mock-es 流程（内置假ES聚合数据生成P99报表+SMTP发送，exit=0）
  5) 打印产物路径（eml 文件 / logs / reports / HTML报表）
  6) 优雅终止 Mock SMTP 服务器并退出

使用：
  cd elk
  py -3 _demo_launcher.py

💡 小提示：
  • 端口冲突（10013/10061）→ 改 mock_local_smtp_server.py#L35 的 BIND_PORT，
    同时同步 config_daily_report_LOCAL_DEMO.json 里的 smtp.port。
  • 想看真实 ES P99 HTML 报表 → 填 config_daily_report_LOCAL_DEMO.json 的 es.* 为你真实ELK，
    去掉 --mock-es 参数，先跑 --dry-run（只生成报表不发邮件）
"""
import os
import sys
import time
import signal
import subprocess
import datetime as dt

HERE = os.path.dirname(os.path.abspath(__file__))
os.chdir(HERE)
PY = sys.executable
CFG = 'config_daily_report_LOCAL_DEMO.json'
SMTP_SCRIPT = 'mock_local_smtp_server.py'

COLOR_OK = '\x1b[32m'
COLOR_WARN = '\x1b[33m'
COLOR_ERR = '\x1b[31m'
COLOR_INFO = '\x1b[36m'
COLOR_RESET = '\x1b[0m'


def banner(title: str, color: str = COLOR_INFO) -> None:
    line = '━' * 82
    print(f'\n{color}{line}')
    print(f'  {title}')
    print(f'{line}{COLOR_RESET}\n', flush=True)


def run(cmd: list, *, tag: str) -> int:
    print(f'{COLOR_INFO}[{tag}] 执行: {" ".join(cmd)}{COLOR_RESET}', flush=True)
    p = subprocess.run(cmd, text=True)
    return p.returncode


def list_artifacts() -> None:
    dirs = {
        '📥 收到的邮件 (.eml)': '_demo_received_emails',
        '📊 生成的报表 (HTML)': 'reports',
        '📜 运行日志 (logs)': 'logs',
    }
    for title, d in dirs.items():
        full = os.path.join(HERE, d)
        if not os.path.isdir(full):
            print(f'{COLOR_WARN}{title}: 目录不存在{COLOR_RESET}')
            continue
        files = sorted(os.listdir(full))
        if not files:
            print(f'{COLOR_WARN}{title}: 目录为空{COLOR_RESET}')
            continue
        print(f'{COLOR_OK}{title} (共{len(files)}个文件):{COLOR_RESET}')
        for name in files[:10]:
            fp = os.path.join(full, name)
            try:
                sz = os.path.getsize(fp)
                mt = dt.datetime.fromtimestamp(os.path.getmtime(fp)).strftime('%H:%M:%S')
                print(f'  · {name}  {sz:>8,} 字节  修改 {mt}')
            except OSError:
                print(f'  · {name}')
        if len(files) > 10:
            print(f'  … 另有 {len(files)-10} 个文件未显示')


def main() -> int:
    banner('秦安县秦剧团 · 本地完整演示启动器 🚀')

    # ========== 1) 检查配置文件/脚本是否存在 ==========
    for fp in [CFG, SMTP_SCRIPT, 'daily_mailer.py']:
        if not os.path.isfile(os.path.join(HERE, fp)):
            print(f'{COLOR_ERR}缺少文件: {fp}，请在 elk 目录下运行本脚本{COLOR_RESET}')
            return 2
    # 清理上次的 _demo_received_emails（可选，注释掉即保留）
    # import shutil
    # if os.path.isdir('_demo_received_emails'):
    #     shutil.rmtree('_demo_received_emails', ignore_errors=True)

    # ========== 2) 启动 Mock SMTP 服务器 ==========
    banner(f'① 启动 Mock SMTP 服务器（{SMTP_SCRIPT}）')
    smtp_proc = subprocess.Popen(
        [PY, SMTP_SCRIPT],
        text=True,
        stdout=sys.stdout,
        stderr=sys.stderr,
        creationflags=getattr(subprocess, 'CREATE_NEW_PROCESS_GROUP', 0),
    )
    time.sleep(3.0)
    if smtp_proc.poll() is not None:
        print(f'{COLOR_ERR}Mock SMTP 启动失败，exit={smtp_proc.returncode}{COLOR_RESET}')
        return 3
    print(f'{COLOR_OK}  Mock SMTP PID={smtp_proc.pid}，127.0.0.1:10025 就绪{COLOR_RESET}')

    overall_exit = 0
    try:
        # ========== 3) --test-smtp 连通性测试 ==========
        banner('② daily_mailer.py --test-smtp（连通性测试，应 exit=0）')
        ec = run([PY, 'daily_mailer.py', '--config', CFG, '--test-smtp', '-v'], tag='TEST-SMTP')
        print(f'{COLOR_OK if ec == 0 else COLOR_ERR}  TEST-SMTP exit={ec}{COLOR_RESET}')
        overall_exit |= (0 if ec == 0 else 1)
        time.sleep(1.0)

        # ========== 4) 完整流程（--mock-es 内置假ES数据，应 exit=0）==========
        banner('③ 完整 daily_mailer.py --mock-es 流程（内置假ES聚合→生成HTML报表→SMTP发送，应 exit=0）')
        print(f'{COLOR_INFO}  说明：--mock-es 模式使用内置 P99 假聚合数据（不调用真实ES），'
              f'可完整走完「报表生成 + 邮件发送 + 附件」全链路{COLOR_RESET}')
        ec = run([PY, 'daily_mailer.py', '--config', CFG, '--mock-es', '-v'], tag='FULL-PIPELINE')
        print(f'{COLOR_OK if ec == 0 else COLOR_ERR}  FULL-PIPELINE exit={ec}{COLOR_RESET}')
        overall_exit |= (0 if ec == 0 else 1)
        time.sleep(1.0)

        # ========== 5) 产物汇总 ==========
        banner('④ 产物汇总（邮件.eml / HTML报表 / logs）')
        list_artifacts()
    finally:
        # ========== 6) 优雅终止 Mock SMTP ==========
        banner('⑤ 终止 Mock SMTP 服务器')
        try:
            if sys.platform == 'win32':
                # Windows 下发送 CTRL_BREAK 更优雅
                os.kill(smtp_proc.pid, signal.CTRL_BREAK_EVENT)
            else:
                smtp_proc.terminate()
            try:
                smtp_proc.wait(timeout=5)
                print(f'{COLOR_OK}  Mock SMTP 已停止，exit={smtp_proc.returncode}{COLOR_RESET}')
            except subprocess.TimeoutExpired:
                smtp_proc.kill()
                smtp_proc.wait(timeout=3)
                print(f'{COLOR_WARN}  Mock SMTP 强制停止{COLOR_RESET}')
        except Exception as e:
            print(f'{COLOR_ERR}  停止Mock SMTP时出错: {e}{COLOR_RESET}')

    banner(f'演示完成。总体状态: {"全部通过 ✅" if overall_exit == 0 else "存在问题，请查看上方日志 ⚠️"}',
           COLOR_OK if overall_exit == 0 else COLOR_WARN)
    print(f'{COLOR_INFO}小贴士：如需真实查看HTML报表，请在 {CFG} 中填入实际可用的 ES 配置。'
          f'收到的 .eml 文件可用 Foxmail / Outlook 直接双击打开。{COLOR_RESET}')
    return overall_exit


if __name__ == '__main__':
    try:
        sys.exit(main())
    except KeyboardInterrupt:
        print(f'\n{COLOR_WARN}用户中断，退出{COLOR_RESET}')
        sys.exit(130)
