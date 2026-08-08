#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
======================================================================
  秦安县秦剧团云端预约系统 · Admin 按钮兜底 Perf
  P99 日报自动化：每日报表生成 + 邮件发送 工具
======================================================================
  功能：
    1. 读配置文件 config_daily_report.json（ES连接 + SMTP 账户 + 收件人）
    2. 调用 elk_p99_report.py 生成最近 N 小时 P99 HTML 报表
    3. 通过 SMTP 发送邮件到指定收件人（支持 HTML 正文 + 附件
       HTML 报表附件
    4. 执行日志写 logs/ 目录，可追踪历史
    5. 同时输出执行状态码：0=成功，2=配置缺失 3=ES查询失败 4=SMTP发送失败

  运行方式（单次执行（定时调用的单次调试/定时任务直接调用这个脚本）：
    python daily_mailer.py                        # 默认读同目录config_daily_report.json
    python daily_mailer.py --config ./my.json # 指定配置
    python daily_mailer.py --dry-run          # 只生成HTML，不发邮件（调试）
    python daily_mailer.py --test-smtp       # 只测试SMTP连通性（发空邮件）
    python daily_mailer.py --hours 24 --out ./xx.html  # 临时覆盖参数
======================================================================
"""
from __future__ import annotations

import argparse
import contextlib
import datetime as dt
import json
import os
import sys
import time
import traceback
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from email.mime.base import MIMEBase
from email import encoders
from email.utils import formataddr, formatdate
import smtplib
import socket
import ssl
from typing import Any, Dict, List, Optional, Tuple

# =========================================================
# 同目录下的 elk_p99_report.py 模块导入（因为用 importlib
# =========================================================
import importlib.util
_HERE = os.path.dirname(os.path.abspath(__file__))


def _load_elk_rpt_mod():
    """动态加载 elk_p99_report 模块（保证独立可用）"""
    path = os.path.join(_HERE, 'elk_p99_report.py')
    spec = importlib.util.spec_from_file_location(
        'elk_p99_report', path
    )
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


# =========================================================
# 配置
# =========================================================
def load_config(path: str) -> Dict[str, Any]:
    if not os.path.isfile(path):
        raise FileNotFoundError(f"[❌ 找不到配置文件：{path}\n"
                                f"   请从 config_daily_report.example.json 复制改名并填写后运行")
    with open(path, 'r', encoding='utf-8-sig') as f:
        cfg = json.load(f)
    # 简单校验必填字段
    for sec, keys in (
        ('es', ['host', 'index']),
        ('smtp', [
            'server', 'port', 'sender_email'
        ])
    ):
        if sec not in cfg:
            raise ValueError(f"[❌ 配置缺 section=[{sec}] 缺失")
        for k in keys:
            if k not in cfg[sec]:
                raise ValueError(f"[❌ 配置 [{sec}].{k} 缺失")
    if 'recipients' not in cfg or not cfg['recipients']:
        raise ValueError("[❌] recipients（收件人列表）为空")
    # 端口转 int
    cfg['smtp']['port'] = int(cfg['smtp']['port'])
    return cfg


def example_config() -> Dict[str, Any]:
    """生成示例配置（用于 --gen-example 打印/或者用户首次使用示例生成）"""
    return {
        "_comment": "=== 秦安县秦剧团 Admin Perf P99 日报配置示例 · 把此文件复制为 config_daily_report.json 并填入真实值 ===",
        "es": {
            "host": "http://127.0.0.1:9200",
            "index": "qaxqjt-admin-perf-*",
            "user": "elastic",
            "password": "your_es_password_here_or leave empty if xpack security",
            "hours": 24,
            "bucket": "5m",
            "no_verify_ssl": True
        },
        "smtp": {
            "server": "smtp.exmail.qq.com",
            "port": 465,
            "use_ssl": True,
            "sender_email": "perf-bot@your-company.com",
            "sender_name": "🎭 秦剧团Perf监控机器人",
            "password": "your_smtp_auth_code_or_password",
            "timeout_sec": 30
        },
        "recipients": [
            "you@your-company.com",
            "ops-team@your-company.com"
        ],
        "cc": [],
        "subject_prefix": "[秦剧团Perf日报]",
        "output_dir": "./reports",
        "log_dir": "./logs",
        "keep_report_days": 30,
        "email_body_summary_inline_summary_lines_max": 10
    }


# =========================================================
# 日志（简单文件 logger）
# =========================================================
def ensure_dir(p: str) -> None:
    os.makedirs(p, exist_ok=True)


class Logger:
    LEVELS = {'DEBUG': 0, 'INFO': 1, 'WARN': 2, 'ERROR': 3}

    def __init__(self, log_dir: str):
        ensure_dir(log_dir)
        ts = dt.datetime.now().strftime('%Y%m%d')
        self.path = os.path.join(log_dir, f'daily_mailer_{ts}.log')
        self.fp = open(self.path, 'a', encoding='utf-8')

    def log(self, level: str, msg: str) -> None:
        line = f"[{dt.datetime.now().strftime('%Y-%m-%d %H:%M:%S')}] [{level}] {msg}"
        print(line)
        try:
            self.fp.write(line + '\n')
            self.fp.flush()
        except Exception:
            pass

    def close(self) -> None:
        try:
            self.fp.close()
        except Exception:
            pass


# =========================================================
# HTML 报告生成（调用 elk_p99_report 模块）
# =========================================================
def gen_report(cfg: Dict[str, Any], logger: Logger, args: argparse.Namespace) -> Tuple[Dict[str, Any], str, Dict[str, Any]]:
    rpt = _load_elk_rpt_mod()
    hours = int(getattr(args, 'hours', None) or int(cfg['es'].get('hours', 24)))
    bucket = cfg['es'].get('bucket', '5m')

    fake_cfg_ns = argparse.Namespace(
        host=cfg['es']['host'],
        index=cfg['es']['index'],
        user=cfg['es'].get('user') or None,
        pwd=cfg['es'].get('password') or None,
        hours=hours,
        bucket=bucket,
        out=None,
        no_verify=bool(cfg['es'].get('no_verify_ssl', True)),
    )
    url = f"{fake_cfg_ns.host.rstrip('/')}/{rpt.urllib.parse.quote(fake_cfg_ns.index, safe='*')}/_search"
    body = rpt.build_query(fake_cfg_ns.hours, fake_cfg_ns.bucket)

    logger.log('INFO', f'[ES_QUERY_BEGIN] host={fake_cfg_ns.host} index={fake_cfg_ns.index} 最近{hours}h 分桶{bucket}')
    code, result = None, None
    try:
        code, result = rpt._req('POST', url, body=body, user=fake_cfg_ns.user, password=fake_cfg_ns.pwd, timeout=60)
    except Exception as e:
        cls_name = e.__class__.__name__
        if isinstance(e, (socket.timeout, TimeoutError)):
            reason, hint = '请求超时', '确认ES可访问 / 调大timeout / 检查代理'
        elif isinstance(e, ConnectionRefusedError):
            reason, hint = '连接被拒绝', '检查端口正确 / ES服务已启动 / 防火墙放行9200端口'
        elif isinstance(e, (ssl.SSLError, ssl.SSLCertVerificationError)):
            reason, hint = 'SSL错误', 'no_verify_ssl=true / 检查证书域名匹配'
        else:
            reason, hint = f'网络/未知错误({cls_name})', f'{e}'[:120]
        logger.log('ERROR', f'[ES_QUERY_RESULT] FAIL HTTP={code} reason={reason} 排错建议={hint}\n{traceback.format_exc()}')
        raise RuntimeError(f'ES 查询失败({reason}): {e}') from e

    # HTTP 层面结果判断
    try:
        if not isinstance(result, dict):
            raise ValueError(f'ES 返回非 dict 对象: {type(result).__name__} raw={str(result)[:200]}')
        if code >= 400:
            err_type = result.get('error', {}) if isinstance(result.get('error'), dict) else {}
            reason_root = err_type.get('type') or err_type.get('reason') or 'HTTP ' + str(code)
            logger.log('ERROR', f'[ES_QUERY_RESULT] FAIL HTTP={code} type={err_type.get("type", "-")} reason={err_type.get("reason", str(result)[:200])}')
            raise RuntimeError(f'ES 查询失败 HTTP {code}: {reason_root}')
    except (TypeError, KeyError, ValueError) as e:
        logger.log('ERROR', f'[ES_QUERY_RESULT] FAIL HTTP={code} reason=响应结构解析异常 {e.__class__.__name__}: {e}')
        raise

    # 聚合结果提取
    try:
        data = rpt.extract(result)
    except (KeyError, TypeError, ValueError) as e:
        logger.log('ERROR', f'[ES_QUERY_RESULT] FAIL HTTP={code} reason=聚合提取失败 {e.__class__.__name__}: {e}')
        logger.log('ERROR', f'[ES_QUERY_TRACEBACK] {traceback.format_exc()}')
        raise RuntimeError('ES 响应缺少必要字段') from e

    took_ms = (result.get('took') or -1) if isinstance(result, dict) else -1
    hits_total = -1
    try:
        _ht = (result.get('hits') or {}).get('total', -1)
        if isinstance(_ht, dict):
            hits_total = _ht.get('value', -1)
        else:
            hits_total = _ht if isinstance(_ht, int) else -1
    except Exception:
        pass
    p99_val = data.get('overall_p99')
    buckets = len(data.get('per_minute', []) or [])
    logger.log('INFO', f'[ES_QUERY_RESULT] OK HTTP={code} took_ms={took_ms} hits_total={hits_total} sample_count={data.get("total_count", 0)} P99={p99_val}ms buckets={buckets}')

    # 渲染HTML
    try:
        html_text = rpt.render_html(data, fake_cfg_ns)
    except Exception as e:
        logger.log('ERROR', f'[ES_QUERY_RESULT] FAIL 渲染HTML失败: {e.__class__.__name__}: {e}')
        logger.log('ERROR', f'[ES_HTML_RENDER_TRACEBACK] {traceback.format_exc()}')
        raise RuntimeError(f'渲染 HTML失败: {e}') from e

    out_dir = os.path.abspath(cfg.get('output_dir') or './reports')
    ensure_dir(out_dir)
    ts = dt.datetime.now().strftime('%Y%m%d_%H%M%S')
    out_path = args.out or os.path.join(out_dir, f'qaxqjt_p99_daily_{ts}.html')
    try:
        with open(out_path, 'w', encoding='utf-8') as f:
            f.write(html_text)
    except (OSError, PermissionError) as e:
        logger.log('ERROR', f'[ES_QUERY_RESULT] FAIL 写报表文件失败: {e.__class__.__name__}: {e}')
        raise RuntimeError(f'写入报表失败: {e}') from e

    szKB = os.path.getsize(out_path) // 1024
    logger.log('INFO', f'HTML 报表已保存：{out_path} 大小 {szKB} KB')
    return data, out_path, vars(fake_cfg_ns)


# =========================================================
# 邮件发送（SMTP）
# =========================================================
def _smtp_connect(cfg_smtp: Dict[str, Any], logger: Logger, *, verbose: bool = False) -> smtplib.SMTP:
    srv = cfg_smtp['server']
    port = cfg_smtp['port']
    use_ssl = bool(cfg_smtp.get('use_ssl', True))
    do_starttls = bool(cfg_smtp.get('starttls', True))
    timeout = int(cfg_smtp.get('timeout_sec', 30))
    user = cfg_smtp['sender_email']
    pwd = cfg_smtp.get('password') or ''

    # ---------- local_hostname 解析+校验+fallback链（新增：显式传参避免EHLO被拒）----------
    def _resolve_local_hostname() -> Tuple[str, str, List[str]]:
        """return (hostname, source, warnings)
        source取值链：cfg 配置 → socket.getfqdn() → fallback默认值
        """
        warnings: List[str] = []
        import re as _re
        _DNS_LABEL_RE = _re.compile(r'^(?=.{1,253}$)([a-zA-Z0-9]([a-zA-Z0-9\-]{0,61}[a-zA-Z0-9])?)(\.[a-zA-Z0-9]([a-zA-Z0-9\-]{0,61}[a-zA-Z0-9])?)*$')
        _FORBIDDEN = {'localhost', 'localhost.localdomain', '', None, '127.0.0.1', '::1', '[::1]', '[127.0.0.1]'}

        def _ok(h: Optional[str]) -> bool:
            if h in _FORBIDDEN:
                return False
            if not isinstance(h, str) or not h:
                return False
            # 纯IP（v4）不行
            if _re.match(r'^(\d{1,3}\.){3}\d{1,3}$', h):
                return False
            return bool(_DNS_LABEL_RE.match(h))

        candidate = cfg_smtp.get('local_hostname')
        if candidate and str(candidate).strip():
            candidate = str(candidate).strip()
            if _ok(candidate):
                return candidate, 'cfg[smtp.local_hostname]', warnings
            warnings.append(f'cfg[smtp.local_hostname]={candidate!r} 不符合DNS域名格式，已忽略')
        # fallback 2: socket.getfqdn()
        try:
            candidate = socket.getfqdn()
            if _ok(candidate):
                return candidate, 'socket.getfqdn()', warnings
            warnings.append(f'socket.getfqdn()={candidate!r} 不是合法FQDN/DNS不可解析')
        except Exception as _e:
            warnings.append(f'socket.getfqdn() 调用失败: {_e.__class__.__name__}: {_e}')
        # fallback 3: 安全默认值
        fallback = 'mailer-client.qaxqjt.local'
        warnings.append(f'使用安全默认 fallback local_hostname={fallback!r}（如遇EHLO被拒，请在配置中显式设置smtp.local_hostname为服务器可识别的合法FQDN）')
        return fallback, 'fallback默认值', warnings

    resolved_lh, lh_source, lh_warnings = _resolve_local_hostname()
    for w in lh_warnings:
        logger.log('WARN', f'[LOCAL_HOSTNAME_FALLBACK] {w}')
    if verbose:
        logger.log('INFO', f'[VERBOSE] local_hostname解析链：最终={resolved_lh!r} 来源={lh_source}  候选校验告警数={len(lh_warnings)}')
    # -------------------------------------------------------------------------

    # 兼容：端口587/25 + use_ssl=False → 默认 STARTTLS；但如果显式 starttls=false 就不调
    if use_ssl or port == 465:
        do_starttls = False
    mode_label = ('SSL/TLS(465)' if (use_ssl or port == 465) else ('STARTTLS(587/25)' if do_starttls else 'PLAIN(25,无加密)'))
    logger.log('INFO', f'[SMTP_CONNECT_BEGIN] {srv}:{port} mode={mode_label} timeout={timeout}s user={user} starttls={do_starttls} local_hostname={resolved_lh}({lh_source})')

    def _err(msg: str, hint: str = '') -> None:
        extra = f' 排错建议={hint}' if hint else ''
        logger.log('ERROR', f'[SMTP_CONNECT_RESULT] FAIL server={srv}:{port} mode={mode_label} reason={msg}{extra}')

    smtp = None
    try:
        if use_ssl or port == 465:
            ctx = ssl.create_default_context()
            ctx.check_hostname = False
            ctx.verify_mode = ssl.CERT_NONE
            smtp = smtplib.SMTP_SSL(srv, port, timeout=timeout, context=ctx, local_hostname=resolved_lh)
        else:
            smtp = smtplib.SMTP(srv, port, timeout=timeout, local_hostname=resolved_lh)
            if do_starttls:
                smtp.starttls()
        if pwd:
            smtp.login(user, pwd)
    except socket.gaierror as e:
        _err('DNS域名解析失败', f'确认{srv}能ping通 / 检查防火墙、代理、公司内网DNS')
        raise RuntimeError(f'SMTP DNS解析失败: {e}') from e
    except socket.timeout as e:
        _err(f'连接超时({timeout}s)', '确认端口未被防火墙拦截；或调大 timeout_sec')
        raise RuntimeError(f'SMTP 连接超时: {e}') from e
    except ConnectionRefusedError as e:
        _err('连接被拒绝', '确认端口正确：465=SSL / 587=STARTTLS / 25=PLAIN；SMTP服务是否开启 / 防火墙放行该端口')
        raise RuntimeError(f'SMTP 连接被拒绝: {e}') from e
    except ssl.SSLCertVerificationError as e:
        _err('SSL证书校验失败', '如用自签证书可开启use_ssl=true同时保持no_verify；或确认系统根证书完整')
        raise RuntimeError(f'SMTP SSL证书错误: {e}') from e
    except ssl.SSLError as e:
        _err('SSL握手错误', '常见原因：端口465配了STARTTLS / 端口587配了SSL → 检查use_ssl与端口匹配')
        raise RuntimeError(f'SMTP SSL握手错误: {e}') from e
    except smtplib.SMTPAuthenticationError as e:
        code = getattr(e, 'smtp_code', 0)
        code_txt = code if code else str(e)
        _err(f'认证失败(code={code_txt})',
             'QQ企业邮/163邮箱：必须使用"客户端授权码/专用密码"，而不是网页登录密码；检查大小写/是否开启SMTP服务')
        raise RuntimeError(f'SMTP 认证失败: {e}') from e
    except smtplib.SMTPNotSupportedError as e:
        if 'STARTTLS' in str(e):
            _err('服务器不支持STARTTLS', '尝试切换 use_ssl=true + port=465 走 SSL/TLS；或内网可临时 starttls=false')
        else:
            _err(f'SMTP命令不支持({e})', '检查客户端是否启用了服务器不支持的扩展(如8BITMIME/CHUNKING)')
        raise RuntimeError(f'SMTP 协议错误: {e}') from e
    except smtplib.SMTPConnectError as e:
        _err('SMTP连接阶段错误(220握手失败)', '查看SMTP服务端日志 / 确认IP未被临时封禁/频率限流 / 检查greylist')
        raise RuntimeError(f'SMTP 连接阶段错误: {e}') from e
    except smtplib.SMTPException as e:
        _err(f'SMTP协议错误: {e.__class__.__name__}', '若EHLO失败：检查域名反解、服务器问候语；若DATA失败：检查附件大小是否超限')
        raise RuntimeError(f'SMTP 协议错误: {e}') from e
    except OSError as e:
        _err(f'OS网络错误: {e.__class__.__name__}: {e}', '网络不通 / 代理设置问题 / 本地防火墙出站拦截')
        raise RuntimeError(f'SMTP 网络错误: {e}') from e

    logger.log('INFO', f'[SMTP_CONNECT_RESULT] OK server={srv}:{port} mode={mode_label} user={user} local_hostname={resolved_lh}')
    if verbose:
        try:
            _ehlo = smtp.ehlo()
            _sock = getattr(smtp, 'sock', None)
            _peer = None
            if _sock is not None:
                try:
                    _peer = _sock.getpeername()
                except Exception:
                    _peer = None
            logger.log('INFO', (
                f'[VERBOSE] SMTP握手细节：ehlo(code={_ehlo[0] if isinstance(_ehlo, tuple) and len(_ehlo) >= 1 else "-"}, '
                f'peer={_peer}, starttls_executed={do_starttls}, local_hostname={resolved_lh} 来源={lh_source})'
            ))
        except Exception as _ve:
            logger.log('INFO', f'[VERBOSE] SMTP握手细节收集失败：{_ve.__class__.__name__}: {_ve}')
    return smtp


def _build_email_body(data: Dict[str, Any]) -> Tuple[str, str]:
    """返回 (text_plain, text_html) 邮件正文（附件单独加。附件的正文邮件正文不含图片，附件是完整报表 HTML"""
    # KPI
    def fv(v, unit=''): return ('-' if v is None else f'{v}{unit}')
    total = data['total_count']
    p50, p90, p95, p99 = data['overall_p50'], data['overall_p90'], data['overall_p95'], data['overall_p99']
    # 评级
    if total == 0:
        badge = '⚠️ 无样本'
        badge_c = '#b45309'
    elif (p99 or 0) <= 50:
        badge = '✅ 优秀 (P99≤50ms)'
        badge_c = '#166534'
    elif (p99 or 0) <= 200:
        badge = '⚠️ 一般 (P99≤200ms)'
        badge_c = '#92400e'
    else:
        badge = '❌ 告警 (P99>200ms)'
        badge_c = '#991b1b'

    by_branch_top = data['by_branch'][:5]
    bound_kv = list(data['by_bound'].items())
    bound_txt = '\n'.join(f'  · {k}：{v:,}' for k, v in bound_kv) if bound_kv else '  · （无数据）'

    # 文本
    plain = f"""🎭 秦安县秦剧团 Admin 按钮兜底 Perf · P99 日报
═══════════════════════════════════════
总体评级：{badge}
═══════════════════════════════════════
总点击 span 样本量：{total:,}
P50 延迟：{fv(p50)} ms
P90 延迟：{fv(p90)} ms
P95 延迟：{fv(p95)} ms
P99 延迟：{fv(p99)} ms

真实绑定 vs 兜底命中：
{bound_txt}

最慢 Top5 分支（按 P99 倒序）：
{chr(10).join(f'  {i+1}. {r["branch"]:<22s} P99={fv(r["p99"], " ms")}  点击{r["count"]:,} 次' for i, r in by_branch_top)}

═══════════════════════════════════════
完整报表查看附件 HTML（浏览器打开即可看 4 张交互图）
生成时间：{dt.datetime.now().strftime('%Y-%m-%d %H:%M:%S')}
"""

    html = f"""<div style="font-family:-apple-system,BlinkMacSystemFont,'PingFang SC','Microsoft YaHei',sans-serif;color:#0f172a;max-width:680px;margin:0 auto;padding:18px;background:#fff;border-radius:14px;box-shadow:0 2px 10px rgba(15,23,42,.08)">
<h2 style="margin:0 0 14px;color:#0a3a63">🎭 秦安县秦剧团 · Admin按钮兜底 Perf P99 日报</h2>
<div style="padding:10px 14px;border-radius:10px;background:#f8fafc;margin-bottom:18px">总体评级：<b style="color:{badge_c};font-size:16px">{badge}</b></div>
<table style="width:100%;border-collapse:collapse;margin-bottom:16px">
<tr><td style="padding:10px;border:1px solid #e2e8f0;background:#f8fafc">总样本量</td><td style="padding:10px;border:1px solid #e2e8f0;text-align:right;font-weight:700;font-size:18px;color:#4338ca">{total:,}</td>
<td style="padding:10px;border:1px solid #e2e8f0;background:#f8fafc">P50</td><td style="padding:10px;border:1px solid #e2e8f0;text-align:right;font-weight:700;color:#15803d">{fv(p50, ' ms')}</td></tr>
<tr><td style="padding:10px;border:1px solid #e2e8f0;background:#f8fafc">P90</td><td style="padding:10px;border:1px solid #e2e8f0;text-align:right;font-weight:700;color:#15803d">{fv(p90, ' ms')}</td>
<td style="padding:10px;border:1px solid #e2e8f0;background:#f8fafc">P95</td><td style="padding:10px;border:1px solid #e2e8f0;text-align:right;font-weight:700;color:#b45309">{fv(p95, ' ms')}</td></tr>
<tr style="background:#fff7ed"><td style="padding:10px;border:1px solid #e2e8f0">P99</td><td colspan="3" style="padding:10px;border:1px solid #e2e8f0;text-align:right;font-weight:800;color:#b91c1c;font-size:20px">{fv(p99, ' ms')}</td></tr>
</table>
<h3 style="margin:18px 0 8px;font-size:15px;color:#334155">🍩 真实绑定 vs 兜底命中</h3>
<table style="width:100%;border-collapse:collapse;margin-bottom:12px">
<tr style="background:#f1f5f9"><th style="padding:8px 12px;border:1px solid #cbd5e1;text-align:left">类别</th><th style="padding:8px 12px;border:1px solid #cbd5e1;text-align:right">次数</th></tr>
{''.join(f'<tr><td style="padding:8px 12px;border:1px solid #e2e8f0">{k}</td><td style="padding:8px 12px;border:1px solid #e2e8f0;text-align:right;font-variant-numeric:tabular-nums">{v:,}</td></tr>' for k, v in bound_kv) if bound_kv else '<tr><td colspan=2 style="padding:10px;color:#94a3b8">无数据</td></tr>'}
</table>
<h3 style="margin:18px 0 8px;font-size:15px;color:#334155">🐢 最慢 Top5 分支（按 P99 倒序）</h3>
<table style="width:100%;border-collapse:collapse">
<tr style="background:#f1f5f9"><th style="padding:8px 12px;border:1px solid #cbd5e1;text-align:left">#</th><th style="padding:8px 12px;border:1px solid #cbd5e1;text-align:left">branch</th><th style="padding:8px 12px;border:1px solid #cbd5e1;text-align:right">点击次数</th><th style="padding:8px 12px;border:1px solid #cbd5e1;text-align:right">P99 (ms)</th></tr>
{''.join(f'''<tr><td style="padding:8px 12px;border:1px solid #e2e8f0">{i+1}</td><td style="padding:8px 12px;border:1px solid #e2e8f0"><code style="background:#f1f5f9;padding:1px 6px;border-radius:4px">{r['branch']}</code></td><td style="padding:8px 12px;border:1px solid #e2e8f0;text-align:right">{r['count']:,}</td><td style="padding:8px 12px;border:1px solid #e2e8f0;text-align:right;font-weight:700;color:{'#991b1b' if (r['p99'] or 0) >= 200 else '#92400e' if (r['p99'] or 0) >= 50 else '#166534'}">{fv(r['p99'])}</td></tr>''' for i, r in enumerate(by_branch_top))}
</table>
<p style="color:#64748b;margin-top:20px;font-size:12px">📎 完整交互报表（P95/P99 趋势图、分支对比、饼图等）请查看附件 HTML，双击浏览器打开即可。生成时间：{dt.datetime.now().strftime('%Y-%m-%d %H:%M:%S')}</p>
</div>
"""
    return plain, html


def send_email(
    cfg: Dict[str, Any],
    logger: Logger,
    data: Dict[str, Any],
    report_html_path: str,
    *,
    retry_count: int = 3,
    retry_interval_sec: int = 10,
    verbose: bool = False,
    mock_smtp: Optional[str] = None,
) -> None:
    """生成 MIME + 发邮件（带内部重试循环 + 结构化调试日志）
    retry_count: 含首次尝试的总次数（默认3）
    """
    retry_count = max(1, int(retry_count or 1))
    retry_interval_sec = max(0, int(retry_interval_sec or 0))
    smtp_cfg: Dict[str, Any] = cfg['smtp']
    sender = smtp_cfg['sender_email']
    sender_name = (smtp_cfg.get('sender_name') or '秦剧团Perf日报')
    recipients: List[str] = list(cfg['recipients'])
    cc: List[str] = list(cfg.get('cc') or [])
    all_rcpt = recipients + cc

    # ==== Verbose 调试：参数快照（不含 password）====
    if verbose:
        _sanitized_smtp_cfg = {k: ('***' if ('pass' in str(k).lower() or 'secret' in str(k).lower()) else v) for k, v in smtp_cfg.items()}
        logger.log('INFO', f'[VERBOSE] send_email 入参：retry_count={retry_count} retry_interval_sec={retry_interval_sec} verbose={verbose} mock_smtp={mock_smtp}')
        logger.log('INFO', f'[VERBOSE] smtp_cfg(脱敏)={json.dumps(_sanitized_smtp_cfg, ensure_ascii=False, default=str)}')
        logger.log('INFO', f'[VERBOSE] recipients={recipients} cc={cc} report={report_html_path}')

    # 主题
    prefix = cfg.get('subject_prefix') or '[秦剧团Perf日报]'
    day = dt.datetime.now().strftime('%Y-%m-%d')
    p99v = data['overall_p99']
    if data['overall_p99'] is not None:
        flag = '✅' if p99v <= 50 else '⚠️' if p99v <= 200 else '❌告警'
        subject = f"{prefix} {day} 样本{data['total_count']:,} P99={p99v:.0f}ms {flag}"
    else:
        subject = f"{prefix} {day} 无样本"
    logger.log('INFO', f'[EMAIL_BUILD_BEGIN] To={recipients} Cc={cc} subject={subject}')

    msg = MIMEMultipart('alternative')
    msg['From'] = formataddr((sender_name, sender))
    msg['To'] = ', '.join(recipients)
    if cc:
        msg['Cc'] = ', '.join(cc)
    msg['Subject'] = subject
    msg['Date'] = formatdate(localtime=True)
    att_size_kb = 0
    try:
        plain, body_html = _build_email_body(data)
        msg.attach(MIMEText(plain, 'plain', 'utf-8'))
        msg.attach(MIMEText(body_html, 'html', 'utf-8'))

        # 附件：完整报表 HTML
        if not os.path.isfile(report_html_path):
            raise FileNotFoundError(f'报表附件不存在: {report_html_path}')
        att_size_kb = os.path.getsize(report_html_path) // 1024
        logger.log('INFO', f'附加报表附件：{os.path.basename(report_html_path)} 大小 {att_size_kb} KB')
        with open(report_html_path, 'rb') as f:
            part = MIMEBase('application', 'octet-stream')
            part.set_payload(f.read())
        encoders.encode_base64(part)
        fname_enc = os.path.basename(report_html_path).encode('utf-8')
        part.add_header('Content-Disposition',
                        f"attachment; filename=\"=?UTF-8?B?{base64_encode(fname_enc)}?=\"")
        msg.attach(part)
    except (FileNotFoundError, PermissionError, OSError) as e:
        logger.log('ERROR', f'[EMAIL_BUILD_RESULT] FAIL reason=附件读取失败: {e.__class__.__name__}: {e}')
        raise RuntimeError(f'报表附件处理失败: {e}') from e
    except Exception as e:
        logger.log('ERROR', f'[EMAIL_BUILD_RESULT] FAIL reason=MIME构建异常: {e.__class__.__name__}: {e}\n{traceback.format_exc()}')
        raise RuntimeError(f'MIME邮件构建失败: {e}') from e
    logger.log('INFO', f'[EMAIL_BUILD_RESULT] OK plain_body_len={len(plain)} html_body_len={len(body_html)} attachment_kb={att_size_kb} total_recipients={len(all_rcpt)}')
    if verbose:
        try:
            logger.log('INFO', f'[VERBOSE] MIME头部清单：keys={list(msg.keys())}  boundary={msg.get_boundary() or "(无)"}  charset={msg.get_content_charset() or "(无)"}')
            if report_html_path:
                import os.path as _p
                _stat = os.stat(report_html_path)
                logger.log('INFO', f'[VERBOSE] 附件详情：file={_p.basename(report_html_path)} size_bytes={_stat.st_size} mtime={dt.datetime.fromtimestamp(_stat.st_mtime).strftime("%Y-%m-%d %H:%M:%S")}')
        except Exception as _ve:
            logger.log('INFO', f'[VERBOSE] MIME头部收集失败：{_ve.__class__.__name__}: {_ve}')

    # ==================== 发送阶段内部重试循环（新增）====================
    logger.log('INFO', f'[EMAIL_SEND_LOOP_BEGIN] total_attempts={retry_count} retry_interval_sec={retry_interval_sec} recipients={len(all_rcpt)}')
    last_err: Optional[BaseException] = None
    attempts_used = 0
    for attempt in range(1, retry_count + 1):
        attempts_used = attempt
        smtp: Optional[smtplib.SMTP] = None
        phase_label = 'connect'
        try:
            logger.log('INFO', f'[EMAIL_SEND_ATTEMPT attempt={attempt}/{retry_count}] phase=connect start — SMTP server={smtp_cfg.get("server")}:{smtp_cfg.get("port")} user={smtp_cfg.get("sender_email")} ssl={smtp_cfg.get("use_ssl", True)}')
            smtp = _smtp_connect(smtp_cfg, logger, verbose=verbose)
            phase_label = 'sendmail'
            logger.log('INFO', f'[EMAIL_SEND_ATTEMPT attempt={attempt}/{retry_count}] phase=connect OK → 进入 sendmail（all_rcpt={len(all_rcpt)}）')
            refused_result = smtp.sendmail(from_addr=sender, to_addrs=all_rcpt, msg=msg.as_string())
            refused_result = refused_result or {}
            if refused_result:
                refused_detail = ', '.join([f'{rcpt}={code_msg[0]} {code_msg[1].decode(errors="ignore")[:80]}' if isinstance(code_msg, tuple) else str(rcpt) for rcpt, code_msg in refused_result.items()])[:300]
                ok_cnt = len(all_rcpt) - len(refused_result)
                logger.log('WARN', f'[EMAIL_SEND_RESULT] PARTIAL_OK total={len(all_rcpt)} ok={ok_cnt} refused={len(refused_result)} detail={refused_detail} 排错建议=检查被拒收件人地址是否存在/是否被SPF/DKIM/DMARC策略拦截')
            logger.log('INFO', f'[EMAIL_SEND_ATTEMPT attempt={attempt}/{retry_count}] phase=sendmail OK')
            logger.log('INFO', f'[EMAIL_SEND_RESULT] OK recipients={len(recipients)} cc={len(cc)} subject={subject} attachment={os.path.basename(report_html_path)}({att_size_kb}KB)')
            logger.log('INFO', f'[EMAIL_SEND_LOOP_RESULT] OK attempts_used={attempts_used}/{retry_count}')
            return  # 成功：直接返回
        except smtplib.SMTPRecipientsRefused as e:
            refused = {addr: info for addr, info in (e.recipients or {}).items()}
            logger.log('ERROR', f'[EMAIL_SEND_ATTEMPT attempt={attempt}/{retry_count}] FAIL phase={phase_label} reason=收件人被拒: {json.dumps(refused, ensure_ascii=False, default=str)} 排错建议=检查是否写错邮箱格式/域名不存在')
            last_err = RuntimeError(f'SMTP 收件人被拒: {e}')
            last_err.__cause__ = e
        except smtplib.SMTPSenderRefused as e:
            logger.log('ERROR', f'[EMAIL_SEND_ATTEMPT attempt={attempt}/{retry_count}] FAIL phase={phase_label} reason=发件人被拒: {e} 排错建议=检查 sender_email 是否在 SMTP 服务商白名单/是否开启SPF/DKIM')
            last_err = RuntimeError(f'SMTP 发件人被拒: {e}')
            last_err.__cause__ = e
        except smtplib.SMTPDataError as e:
            logger.log('ERROR', f'[EMAIL_SEND_ATTEMPT attempt={attempt}/{retry_count}] FAIL phase={phase_label} reason=DATA阶段错误(code={getattr(e, "smtp_code", None)}): {e} 排错建议=附件超限/内容被判定为垃圾邮件/触发频率限制')
            last_err = RuntimeError(f'SMTP DATA错误: {e}')
            last_err.__cause__ = e
        except smtplib.SMTPNotSupportedError as e:
            logger.log('ERROR', f'[EMAIL_SEND_ATTEMPT attempt={attempt}/{retry_count}] FAIL phase={phase_label} reason=命令不支持: {e} 排错建议=若8BITMIME报错，检查是否为服务商限制')
            last_err = RuntimeError(f'SMTP 命令不支持: {e}')
            last_err.__cause__ = e
        except smtplib.SMTPException as e:
            logger.log('ERROR', f'[EMAIL_SEND_ATTEMPT attempt={attempt}/{retry_count}] FAIL phase={phase_label} reason=SMTPException({e.__class__.__name__}): {e}')
            last_err = RuntimeError(f'SMTP 发送错误: {e}')
            last_err.__cause__ = e
        except Exception as e:
            # 包括 ConnectionRefused / Timeout / SSL 错误等网络层异常（_smtp_connect 已打分类日志）
            logger.log('ERROR', f'[EMAIL_SEND_ATTEMPT attempt={attempt}/{retry_count}] FAIL phase={phase_label} reason={e.__class__.__name__}: {str(e)[:200]}')
            last_err = e
        finally:
            try:
                if smtp is not None:
                    try:
                        smtp.quit()
                    except Exception:
                        pass
            except Exception:
                pass

        # 走到这里说明本次 attempt 失败：决定是否重试
        if attempt < retry_count:
            logger.log('WARN', f'[EMAIL_SEND_RETRY_SLEEP attempt={attempt}/{retry_count}] next_attempt={attempt + 1} sleep_sec={retry_interval_sec} reason={last_err.__class__.__name__}: {str(last_err)[:120]}')
            if verbose and last_err is not None:
                try:
                    _tb = ''.join(traceback.format_exception(type(last_err), last_err, last_err.__traceback__))
                    logger.log('INFO', f'[VERBOSE] attempt={attempt} last_err_full_traceback:\n{_tb.rstrip()}')
                except Exception:
                    pass
            time.sleep(retry_interval_sec)
        else:
            logger.log('ERROR', f'[EMAIL_SEND_LOOP_RESULT] FAIL attempts_used={attempts_used}/{retry_count} last_error={last_err.__class__.__name__}: {str(last_err)[:200]}')
            raise last_err if isinstance(last_err, Exception) else RuntimeError(str(last_err))


def base64_encode(b: bytes) -> str:
    import base64 as _b64
    return _b64.b64encode(b).decode('ascii')


# =========================================================
# Mock SMTP（纯内存 unittest.mock，无需真实网络，Python3.14+兼容）
# =========================================================
_MOCK_SMTP_CALL_COUNTER = {'n': 0}


class FakeSMTP:
    """按 scenario 模拟真实 SMTP 对象的行为"""

    def __init__(self, scenario: str, *vargs, **kwargs):
        _MOCK_SMTP_CALL_COUNTER['n'] += 1
        self._scenario = scenario
        self._call_idx = _MOCK_SMTP_CALL_COUNTER['n']
        # 场景：连接阶段就抛错（构造函数阶段抛 ConnectionRefusedError）
        if scenario == 'conn_fail':
            raise ConnectionRefusedError(
                f'[MOCK conn_fail call={self._call_idx}] 模拟 127.0.0.1:25 端口无监听（连接被拒）')
        if scenario == 'send_then_succ_3rd' and self._call_idx < 3:
            raise ConnectionRefusedError(
                f'[MOCK send_then_succ_3rd call={self._call_idx} <3 模拟临时网络抖动（连接被拒）')
        if scenario == 'send_all_fail_3x':
            raise ConnectionRefusedError(
                f'[MOCK send_all_fail_3x call={self._call_idx} 模拟 SMTP 服务器持续不可达）')
        # 其他场景正常构造
        self._vargs = vargs
        self._kwargs = kwargs
        self._connected = True

    # 模拟 SMTP_SSL 同样调用时的路径：构造函数阶段已经抛错的不会跑到这里
    def starttls(self, *a, **kw):
        return (220, b'Mock ready to start TLS')

    def login(self, user: str, password: str):
        if self._scenario == 'auth_fail':
            import smtplib as _s
            raise _s.SMTPAuthenticationError(
                code=535, msg=('5.7.8 [MOCK auth_fail] 认证失败：客户端授权码错误 / 账号密码错误').encode('utf-8'))
        return (235, b'Mock auth succeeded')

    def sendmail(self, from_addr: str, to_addrs: list, msg_str: str, *a, **kw):
        import smtplib as _s
        if self._scenario == 'rcpt_fail':
            refused = {}
            for r in to_addrs:
                refused[r] = (550, f'[MOCK rcpt_fail] 5.1.1 <{r}> Recipient unknown (mock)'.encode())
            raise _s.SMTPRecipientsRefused(refused)
        if self._scenario == 'partial_refuse':
            refused = {}
            for r in to_addrs:
                if ('bad' in r) or ('invalid' in r):
                    refused[r] = (550, f'[MOCK partial_refuse] 5.1.1 <{r}> 被拒收(mock)'.encode())
            return refused
        # 正常 send 成功：返回空 dict
        return {}

    def quit(self, *a, **kw):
        return (221, b'Bye mock')

    def close(self, *a, **kw):
        return None


@contextlib.contextmanager
def with_smtp_mock_if_enabled(mock_scenario: Optional[str], logger: Optional[Logger] = None):
    """有 --mock-smtp 时，patch smtplib.SMTP / smtplib.SMTP_SSL 为 FakeSMTP"""
    import unittest.mock as _mock
    if not mock_scenario:
        yield
        return
    # 重置调用计数器
    _MOCK_SMTP_CALL_COUNTER['n'] = 0
    if logger:
        logger.log('WARN', ('=' * 60))
        logger.log('WARN', f'[SMTP_MOCK_MODE_BEGIN] scenario={mock_scenario}：此运行会用 unittest.mock 替换 smtplib.SMTP/SMTP_SSL，**不会发起真实网络请求**')
    try:
        def _factory(*a, **kw):
            return FakeSMTP(mock_scenario, *a, **kw)
        with _mock.patch.object(smtplib, 'SMTP', _factory), \
             _mock.patch.object(smtplib, 'SMTP_SSL', _factory):
            yield
    finally:
        if logger:
            logger.log('WARN', f'[SMTP_MOCK_MODE_END] scenario={mock_scenario} total_smtp_instances={_MOCK_SMTP_CALL_COUNTER["n"]}')
            logger.log('WARN', ('=' * 60))


# =========================================================
# 历史报表清理
# =========================================================
def cleanup_old(cfg: Dict[str, Any], logger: Logger) -> None:
    keep_days = int(cfg.get('keep_report_days', 30) or 30)
    out_dir = os.path.abspath(cfg.get('output_dir') or './reports')
    if not os.path.isdir(out_dir):
        return
    cutoff = dt.datetime.now() - dt.timedelta(days=keep_days)
    removed = 0
    for fn in os.listdir(out_dir):
        fp = os.path.join(out_dir, fn)
        try:
            st = os.stat(fp)
            mtime = dt.datetime.fromtimestamp(st.st_mtime)
            if mtime < cutoff:
                os.remove(fp)
                removed += 1
        except Exception:
            pass
    if removed:
        logger.log('INFO', f'清理超过 {keep_days} 天旧报表：删除 {removed} 个')


# =========================================================
# 入口
# =========================================================
def main() -> int:
    p = argparse.ArgumentParser(description='秦剧团 Admin Perf P99 日报：生成 + 发邮件')
    p.add_argument('--config', '-c', default=os.path.join(_HERE, 'config_daily_report.json'),
                   help='配置文件路径（默认：同目录 config_daily_report.json）')
    p.add_argument('--hours', type=int, default=None, help='临时覆盖最近 N 小时')
    p.add_argument('--out', default=None, help='临时覆盖输出 HTML 路径')
    p.add_argument('--dry-run', action='store_true', help='只生成报表，不发邮件（调试用）')
    p.add_argument('--gen-example', action='store_true', help='生成示例配置到标准输出')
    p.add_argument('--test-smtp', action='store_true', help='只测试 SMTP 连通性（发送一封测试邮件）')
    # ==== 新增：发送阶段重试参数 ====
    p.add_argument('--smtp-retry-count', type=int, default=3,
                   help='SMTP 发送阶段内部重试次数（默认 3，含首次尝试）')
    p.add_argument('--smtp-retry-interval-sec', type=int, default=10,
                   help='SMTP 发送阶段重试间隔秒数（默认 10 秒）')
    # ==== 新增：Mock SMTP 失败场景（纯内存 unittest.mock，不碰真实网络，Python3.14 兼容）====
    p.add_argument('--mock-smtp', default=None,
                   choices=['auth_fail', 'conn_fail', 'rcpt_fail', 'partial_refuse', 'send_then_succ_3rd', 'send_all_fail_3x'],
                   help=('Mock SMTP 失败场景（测试重试/异常日志用）：auth_fail=认证失败；'
                         'conn_fail=连接被拒；rcpt_fail=收件人被拒异常；partial_refuse=不抛异常但返回部分拒收dict；'
                         'send_then_succ_3rd=前2次连接被拒第3次成功；send_all_fail_3x=3次都被拒'))
    # ==== 新增：Verbose 调试开关 ====
    p.add_argument('--verbose', '-v', action='store_true', help='关键节点输出更详细的调试级结构化日志（不带密码）')
    args = p.parse_args()

    # ---- gen-example 不需要任何 logger/配置，直接返回 ----
    if args.gen_example:
        print(json.dumps(example_config(), ensure_ascii=False, indent=2))
        return 0

    # ---- 最外层兜底 logger（配置加载失败时也能 stderr 打印结构化信息）----
    final_code, final_summary = 0, '未开始'
    logger: Optional[Logger] = None
    cfg: Optional[Dict[str, Any]] = None
    try:
        # 1. 加载配置（可能抛 FileNotFoundError / ValueError）
        try:
            cfg = load_config(args.config)
        except (FileNotFoundError, ValueError) as e:
            err_msg = str(e)
            # 尝试写日志到默认位置
            try:
                fallback_logger = Logger(os.path.abspath('./logs'))
                fallback_logger.log('ERROR', f'[FINAL_STATUS] FAIL exit_code=2 phase=load_config reason={err_msg}')
                fallback_logger.close()
            except Exception:
                pass
            print(f'[CONFIG_ERROR] {err_msg}', file=sys.stderr)
            print("\n💡 第一次使用运行：python daily_mailer.py --gen-example > config_daily_report.json")
            print("   然后编辑填入真实的ES/SMTP配置")
            final_code, final_summary = 2, f'配置加载失败：{err_msg[:120]}'
            return final_code

        # 2. 建立 Logger（从 cfg.log_dir 读）
        log_dir = os.path.abspath((cfg or {}).get('log_dir') or './logs')
        logger = Logger(log_dir)
        logger.log('INFO', '=' * 60)
        logger.log('INFO', f'[TASK_BEGIN] pid={os.getpid()} dry_run={args.dry_run} test_smtp={args.test_smtp} hours={args.hours} out={args.out}')
        logger.log('INFO', f'[TASK_BEGIN_EX] smtp_retry={args.smtp_retry_count}x@{args.smtp_retry_interval_sec}s mock_smtp={args.mock_smtp} verbose={args.verbose}')
        logger.log('INFO', f'配置文件：{args.config}（SMTP发件人：{cfg["smtp"]["sender_email"]}）')

        # 3-A. test-smtp 模式：带重试循环 + 详细结构化调试日志
        if args.test_smtp:
            smtp_cfg = cfg['smtp']
            recipients = list(cfg['recipients'])
            test_subject = f"[测试SMTP连通性] {dt.datetime.now().strftime('%Y-%m-%d %H:%M:%S')}"
            retry_count = max(1, int(args.smtp_retry_count or 1))
            retry_interval_sec = max(0, int(args.smtp_retry_interval_sec or 0))
            if args.verbose:
                logger.log('INFO', f'[VERBOSE] test-smtp 入参：retry_count={retry_count} retry_interval_sec={retry_interval_sec} mock_smtp={args.mock_smtp}')
            msg = MIMEMultipart()
            try:
                logger.log('INFO', '[test-smtp 模式开始]')
                msg['From'] = formataddr(((smtp_cfg.get('sender_name') or 'Test Bot'), smtp_cfg['sender_email']))
                msg['To'] = ', '.join(recipients)
                msg['Subject'] = test_subject
                body = ('✅ SMTP 连通性测试邮件，你能收到说明 SMTP 配置正确 ✅\n\n'
                        f'SMTP 服务器：{smtp_cfg["server"]}:{smtp_cfg["port"]}  SSL={bool(smtp_cfg.get("use_ssl", True))}\n'
                        f'发件人：{smtp_cfg["sender_email"]}\n收件人：{recipients}\n'
                        f'生成时间：{dt.datetime.now().strftime("%Y-%m-%d %H:%M:%S")}\n'
                        f'Mock模式：{args.mock_smtp or "(真实SMTP)"}')
                msg.attach(MIMEText(body, 'plain', 'utf-8'))
                logger.log('INFO', f'[EMAIL_BUILD_BEGIN] phase=test-smtp To={recipients} Cc=[] subject={test_subject}')
            except Exception as e:
                logger.log('ERROR', f'[EMAIL_BUILD_RESULT] FAIL reason=MIME构建失败({e.__class__.__name__}): {e} 排错建议=检查收件人/发件人邮箱格式、字符编码')
                tb = traceback.format_exc()
                logger.log('ERROR', f'[test-smtp FAIL] MIME构建异常: {e.__class__.__name__}: {e}\n{tb}')
                final_code, final_summary = 4, f'test-smtp失败(MIME构建): {e.__class__.__name__}: {e}'
                return final_code
            logger.log('INFO', f'[EMAIL_BUILD_RESULT] OK phase=test-smtp subject_len={len(test_subject)} recipients={len(recipients)}')
            if args.verbose:
                try:
                    logger.log('INFO', f'[VERBOSE] test-smtp MIME头部清单：keys={list(msg.keys())}  charset={msg.get_content_charset() or "(无)"}')
                except Exception as _ve:
                    logger.log('INFO', f'[VERBOSE] test-smtp MIME头部收集失败：{_ve.__class__.__name__}: {_ve}')

            # ============ test-smtp 发送阶段：内部重试循环 ============
            with with_smtp_mock_if_enabled(args.mock_smtp, logger):
                logger.log('INFO', f'[TEST_SMTP_LOOP_BEGIN] total_attempts={retry_count} retry_interval_sec={retry_interval_sec} recipients={len(recipients)}')
                last_err: Optional[BaseException] = None
                attempts_used = 0
                for attempt in range(1, retry_count + 1):
                    attempts_used = attempt
                    smtp = None
                    phase_label = 'connect'
                    try:
                        logger.log('INFO', f'[TEST_SMTP_ATTEMPT attempt={attempt}/{retry_count}] phase=connect start — server={smtp_cfg.get("server")}:{smtp_cfg.get("port")} user={smtp_cfg.get("sender_email")} ssl={smtp_cfg.get("use_ssl", True)}')
                        smtp = _smtp_connect(smtp_cfg, logger, verbose=args.verbose)
                        phase_label = 'sendmail'
                        logger.log('INFO', f'[TEST_SMTP_ATTEMPT attempt={attempt}/{retry_count}] phase=connect OK → sendmail recipients={len(recipients)}')
                        # 处理 sendmail 返回值（部分收件人被静默拒收但不抛异常）
                        refused_result = smtp.sendmail(smtp_cfg['sender_email'], recipients, msg.as_string())
                        refused_result = refused_result or {}
                        if refused_result:
                            refused_detail = ', '.join([f'{rcpt}={code_msg[0]} {code_msg[1].decode(errors="ignore")[:80]}' if isinstance(code_msg, tuple) else str(rcpt) for rcpt, code_msg in refused_result.items()])[:300]
                            ok_cnt = len(recipients) - len(refused_result)
                            logger.log('WARN', f'[EMAIL_SEND_RESULT] PARTIAL_OK phase=test-smtp total={len(recipients)} ok={ok_cnt} refused={len(refused_result)} detail={refused_detail} 排错建议=检查被拒收件人地址是否存在/是否被SPF/DKIM/DMARC策略拦截')
                        logger.log('INFO', f'[TEST_SMTP_ATTEMPT attempt={attempt}/{retry_count}] phase=sendmail OK')
                        logger.log('INFO', '[EMAIL_SEND_RESULT] OK phase=test-smtp')
                        logger.log('INFO', f'[TEST_SMTP_LOOP_RESULT] OK attempts_used={attempts_used}/{retry_count}')
                        final_code, final_summary = 0, f'test-smtp 发送成功（To {recipients}，使用了 {attempts_used} 次尝试）'
                        return final_code
                    except smtplib.SMTPRecipientsRefused as e:
                        refused_detail = ', '.join([f'{rcpt}={code_msg[0]} {code_msg[1].decode(errors="ignore")[:80]}' if isinstance(code_msg, tuple) else str(rcpt) for rcpt, code_msg in (e.recipients or {}).items()])[:200]
                        logger.log('ERROR', f'[TEST_SMTP_ATTEMPT attempt={attempt}/{retry_count}] FAIL phase={phase_label} reason=收件人被拒: {refused_detail} 排错建议=检查收件人地址是否存在/大小写拼写/是否在收件人白名单')
                        last_err = RuntimeError(f'SMTP 收件人被拒: {e}')
                        last_err.__cause__ = e
                    except smtplib.SMTPSenderRefused as e:
                        logger.log('ERROR', f'[TEST_SMTP_ATTEMPT attempt={attempt}/{retry_count}] FAIL phase={phase_label} reason=发件人被拒: {e} 排错建议=检查 sender_email 是否在 SMTP 服务商白名单/是否开启SPF/DKIM')
                        last_err = RuntimeError(f'SMTP 发件人被拒: {e}')
                        last_err.__cause__ = e
                    except smtplib.SMTPDataError as e:
                        logger.log('ERROR', f'[TEST_SMTP_ATTEMPT attempt={attempt}/{retry_count}] FAIL phase={phase_label} reason=DATA阶段错误(code={getattr(e, "smtp_code", None)}): {e} 排错建议=附件超限/内容被判定为垃圾邮件/触发频率限制')
                        last_err = RuntimeError(f'SMTP DATA错误: {e}')
                        last_err.__cause__ = e
                    except smtplib.SMTPNotSupportedError as e:
                        logger.log('ERROR', f'[TEST_SMTP_ATTEMPT attempt={attempt}/{retry_count}] FAIL phase={phase_label} reason=命令不支持: {e} 排错建议=若8BITMIME报错，检查是否为服务商限制/关闭8bitmime')
                        last_err = RuntimeError(f'SMTP 命令不支持: {e}')
                        last_err.__cause__ = e
                    except smtplib.SMTPException as e:
                        logger.log('ERROR', f'[TEST_SMTP_ATTEMPT attempt={attempt}/{retry_count}] FAIL phase={phase_label} reason=SMTPException({e.__class__.__name__}): {e}')
                        last_err = RuntimeError(f'SMTP 发送错误: {e}')
                        last_err.__cause__ = e
                    except Exception as e:
                        logger.log('ERROR', f'[TEST_SMTP_ATTEMPT attempt={attempt}/{retry_count}] FAIL phase={phase_label} reason={e.__class__.__name__}: {str(e)[:200]}')
                        last_err = e
                    finally:
                        try:
                            if smtp is not None:
                                try:
                                    smtp.quit()
                                except Exception:
                                    pass
                        except Exception:
                            pass

                    # 决定是否重试
                    if attempt < retry_count:
                        logger.log('WARN', f'[TEST_SMTP_RETRY_SLEEP attempt={attempt}/{retry_count}] next_attempt={attempt+1} sleep_sec={retry_interval_sec} reason={last_err.__class__.__name__}: {str(last_err)[:120]}')
                        if args.verbose and last_err is not None:
                            try:
                                _tb = ''.join(traceback.format_exception(type(last_err), last_err, last_err.__traceback__))
                                logger.log('INFO', f'[VERBOSE] test-smtp attempt={attempt} last_err_full_traceback:\n{_tb.rstrip()}')
                            except Exception:
                                pass
                        time.sleep(retry_interval_sec)
                    else:
                        logger.log('ERROR', f'[TEST_SMTP_LOOP_RESULT] FAIL attempts_used={attempts_used}/{retry_count} last_error={last_err.__class__.__name__}: {str(last_err)[:200]}')
                        tb = traceback.format_exc()
                        logger.log('ERROR', f'[test-smtp FAIL] {last_err.__class__.__name__}: {last_err}\n{tb}')
                        final_code, final_summary = 4, f'test-smtp失败({attempts_used}次尝试后)：{last_err.__class__.__name__}: {last_err}'
                        return final_code

        # 3-B. 主流程：dry-run / 正常
        data = html_path = None
        # ① 生成报表
        try:
            data, html_path, _ns = gen_report(cfg, logger, args)
        except Exception as e:
            tb = traceback.format_exc()
            logger.log('ERROR', f'[PHASE_GEN_REPORT FAIL] {e.__class__.__name__}: {e}\n{tb}')
            final_code, final_summary = 3, f'报表生成失败：{e.__class__.__name__}: {e}'
            return final_code

        # ② 清理旧报表（软失败，只 WARN）
        try:
            cleanup_old(cfg, logger)
        except Exception as e:
            logger.log('WARN', f'[CLEANUP_OLD SOFT_FAIL] {e.__class__.__name__}: {e}')

        # ③ dry-run：到此结束
        if args.dry_run:
            logger.log('INFO', f'[DRY_RUN_OK] 报表已生成：{html_path} P99={data.get("overall_p99")}ms 样本量={data.get("total_count")}')
            print(f'\n[dry-run OK] ✅ 报表已生成：{html_path}')
            print(f'            · 样本量: {data.get("total_count"):,}')
            print(f'            · P50/P90/P95/P99 = {data.get("overall_p50")}/{data.get("overall_p90")}/{data.get("overall_p95")}/{data.get("overall_p99")} ms')
            print(f'            · 分桶数: {len(data.get("per_minute", []) or [])}')
            print(f'            · 最慢分支Top1: {(data.get("by_branch") or [{}])[0].get("branch", "-")} @ P99 = {(data.get("by_branch") or [{}])[0].get("p99", "-")} ms')
            final_code, final_summary = 0, f'dry-run OK（样本量 {data.get("total_count")}，P99 {data.get("overall_p99")}ms）'
            return final_code

        # ④ 正式发邮件（带 Mock 模式上下文 + 新参数传递）
        with with_smtp_mock_if_enabled(args.mock_smtp, logger):
            try:
                send_email(
                    cfg, logger, data, html_path,
                    retry_count=args.smtp_retry_count,
                    retry_interval_sec=args.smtp_retry_interval_sec,
                    verbose=args.verbose,
                    mock_smtp=args.mock_smtp,
                )
                final_code, final_summary = 0, f'日报发送成功（样本量 {data.get("total_count")}，P99 {data.get("overall_p99")}ms）'
                logger.log('INFO', '✅ 日报任务全部完成 ✅')
                return final_code
            except Exception as e:
                tb = traceback.format_exc()
                logger.log('ERROR', f'[PHASE_SEND_EMAIL FAIL] {e.__class__.__name__}: {e}\n{tb}')
                final_code, final_summary = 4, f'邮件发送失败：{e.__class__.__name__}: {e}'
                return final_code

    # 最外层兜底（任何未预见的异常都会走到这里）
    except KeyboardInterrupt:
        print('\n[中断]', file=sys.stderr)
        final_code, final_summary = 130, '用户 Ctrl+C 中断'
        return final_code
    except Exception as e:
        tb = traceback.format_exc()
        if logger is not None:
            try:
                logger.log('ERROR', f'[UNEXPECTED_EXCEPTION] {e.__class__.__name__}: {e}\n{tb}')
            except Exception:
                pass
        else:
            print(f'[UNEXPECTED_EXCEPTION] {e.__class__.__name__}: {e}\n{tb}', file=sys.stderr)
        final_code, final_summary = 99, f'未预见异常：{e.__class__.__name__}: {e}'
        return final_code
    finally:
        # 最终固定关键字 [FINAL_STATUS] 写入日志（便于 grep/ELK 检索）
        ts = dt.datetime.now().strftime('%Y-%m-%d %H:%M:%S')
        status_label = 'OK' if final_code == 0 else f'FAIL({final_code})'
        summary_line = (f'[{ts}] [FINAL_STATUS] exit_code={final_code} status={status_label} '
                        f'summary={final_summary} cfg={args.config} dry_run={args.dry_run} test_smtp={args.test_smtp}')
        if logger is not None:
            try:
                logger.log('INFO', summary_line)
            except Exception:
                pass
        try:
            print(summary_line, file=sys.stderr if final_code != 0 else sys.stdout)
        except Exception:
            pass
        if logger is not None:
            try:
                logger.close()
            except Exception:
                pass


if __name__ == '__main__':
    try:
        sys.exit(main())
    except KeyboardInterrupt:
        print('\n[中断]')
        sys.exit(130)
