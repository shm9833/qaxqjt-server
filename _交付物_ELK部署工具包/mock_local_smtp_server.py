#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
======================================================================
 秦安县秦剧团 · 本地演示用 Mock SMTP 服务器（零依赖，纯标准库）
======================================================================
功能：
  • 监听 127.0.0.1:10025 （无需管理员权限，避开 25/1025 等 Windows 保留端口）
  • 完整模拟 SMTP 协议：EHLO/HELO / MAIL FROM / RCPT TO / DATA / QUIT
  • 支持 PLAIN / LOGIN 认证（任意用户名/密码均通过，适合演示）
  • 收到的邮件：
      1) 控制台打印主题、收件人、正文前 300 字预览
      2) 保存为 .eml 到 _demo_received_emails/ 目录（Foxmail/Outlook 可直接打开）
  • 启动后按 Ctrl+C 优雅退出

使用（两个终端）：
  终端1：py -3 mock_local_smtp_server.py          ← 保持运行
  终端2：py -3 daily_mailer.py --config config_daily_report_LOCAL_DEMO.json

💡 小提示（端口冲突）：
  • 若启动报 [WinError 10013/10061] 端口被占用 →
    改本文件 L30 的 BIND_PORT = 10026 / 20025 等空闲端口，
    同时同步修改 config_daily_report_LOCAL_DEMO.json 里的 smtp.port 为同一个端口。
======================================================================
"""
import os
import re
import sys
import socket
import threading
import datetime as dt
from typing import List, Tuple, Optional

BIND_HOST = '127.0.0.1'
BIND_PORT = 10025  # 避开 Windows 上可能被保留/占用的 1025；如仍冲突可改 10026/20025 等
OUTPUT_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), '_demo_received_emails')
CRLF = '\r\n'
RECV_CHUNK = 8192
TIMEOUT = 30.0

_banner_lock = threading.Lock()
_email_counter = 0


def _log(tag: str, msg: str, *, peer: str = '') -> None:
    ts = dt.datetime.now().strftime('%H:%M:%S.%f')[:-3]
    peer_p = f' [{peer}]' if peer else ''
    color = {
        'S←': '\x1b[36m', 'S→': '\x1b[35m', 'INFO': '\x1b[32m', 'ERR ': '\x1b[31m',
        'RCVD': '\x1b[33m'
    }.get(tag, '\x1b[0m')
    print(f'{color}[{ts}]{peer_p} {tag}  {msg}\x1b[0m', flush=True)


def _parse_subject_and_preview(raw_email_bytes: bytes) -> Tuple[str, str, List[str]]:
    """从原始邮件字节流中提取 Subject、正文预览、收件人列表（仅作展示用，不严谨解析）"""
    try:
        raw = raw_email_bytes.decode('utf-8', errors='replace')
    except Exception:
        raw = raw_email_bytes.decode('latin-1', errors='replace')
    subject = '(无主题)'
    recipients: List[str] = []
    body = ''
    in_header = True
    lines = raw.split('\n')
    body_start = -1
    for idx, line in enumerate(lines):
        if line.strip() == '' and in_header:
            in_header = False
            body_start = idx + 1
            continue
        if in_header:
            low = line.lower()
            if low.startswith('subject:'):
                subject = line.split(':', 1)[1].strip()[:120]
            elif low.startswith('to:'):
                to_line = line.split(':', 1)[1].strip()
                for m in re.findall(r'[<]?([A-Za-z0-9_.+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,})[>]?', to_line):
                    recipients.append(m)
    if body_start > 0 and body_start < len(lines):
        body_lines = [l.rstrip('\r') for l in lines[body_start:] if l.strip()]
        body = '\n'.join(body_lines[:20])[:300]
    # 清除多余换行
    body = re.sub(r'\n{3,}', '\n\n', body)
    return subject, body, recipients


class SMTPSession(threading.Thread):
    def __init__(self, conn: socket.socket, addr: Tuple[str, int]):
        super().__init__(daemon=True)
        self.conn = conn
        self.addr = f'{addr[0]}:{addr[1]}'
        self.buf = bytearray()
        self.state = 'init'   # init -> helo -> mail -> rcpt -> data -> done
        self.mail_from: Optional[str] = None
        self.rcpt_to: List[str] = []
        self.data_buf = bytearray()
        self.in_data = False

    def run(self) -> None:
        global _email_counter
        try:
            self.conn.settimeout(TIMEOUT)
            self._send('220 qaxqjt-demo-smtp Mock ESMTP server ready')
            while True:
                chunk = self.conn.recv(RECV_CHUNK)
                if not chunk:
                    break
                self.buf.extend(chunk)
                while True:
                    # 逐行处理（DATA模式时特殊处理，直到 .\r\n）
                    if self.in_data:
                        end_marker = b'\r\n.\r\n'
                        idx = self.buf.find(end_marker)
                        if idx == -1:
                            # 还没收到结束符
                            break
                        # 把结束符之前的内容加入 data_buf
                        self.data_buf.extend(self.buf[:idx])
                        # 结束符后面的内容保留在 buf
                        rest = bytes(self.buf[idx + len(end_marker):])
                        self.buf = bytearray(rest)
                        self._on_data_end()
                        self.in_data = False
                        self.state = 'done'
                    else:
                        end_line = self.buf.find(b'\r\n')
                        if end_line == -1:
                            break
                        line_bytes = bytes(self.buf[:end_line])
                        self.buf = bytearray(self.buf[end_line + 2:])
                        try:
                            line = line_bytes.decode('utf-8', errors='replace')
                        except Exception:
                            line = line_bytes.decode('latin-1', errors='replace')
                        self._log_recv(line)
                        if not self._handle_command(line):
                            return
        except socket.timeout:
            _log('ERR ', f'会话超时 {TIMEOUT}s 无数据', peer=self.addr)
        except Exception as e:
            _log('ERR ', f'会话异常: {type(e).__name__}: {e}', peer=self.addr)
        finally:
            try:
                self.conn.close()
            except Exception:
                pass

    def _send(self, line: str) -> None:
        raw = (line + CRLF).encode('utf-8')
        try:
            self.conn.sendall(raw)
            _log('S→', line[:200], peer=self.addr)
        except Exception as e:
            _log('ERR ', f'发送失败: {e}', peer=self.addr)

    def _log_recv(self, line: str) -> None:
        # DATA 阶段不打印每行（太吵）
        if self.in_data:
            return
        _log('S←', line[:200], peer=self.addr)

    def _handle_command(self, line: str) -> bool:
        """返回 True 继续会话，False 断开"""
        up = line.strip().upper()
        # --- QUIT 随时接受 ---
        if up.startswith('QUIT'):
            self._send('221 2.0.0 Bye, qaxqjt-demo-smtp closing connection')
            return False
        # --- RSET 重置状态 ---
        if up.startswith('RSET'):
            self.mail_from = None
            self.rcpt_to.clear()
            self.data_buf.clear()
            self.state = 'helo' if self.state != 'init' else 'init'
            self.in_data = False
            self._send('250 2.0.0 Reset OK')
            return True
        # --- NOOP ---
        if up.startswith('NOOP'):
            self._send('250 2.0.0 OK')
            return True
        # --- VRFY/EXPN ---
        if up.startswith(('VRFY', 'EXPN')):
            self._send('252 Cannot VRFY user (demo mode)')
            return True
        # --- EHLO/HELO ---
        if up.startswith('EHLO') or up.startswith('HELO'):
            try:
                domain = line.split(None, 1)[1].strip()
            except IndexError:
                domain = 'unknown-client.local'
            self.state = 'helo'
            self._send(f'250-qaxqjt-demo-smtp Hello {domain} [{self.addr}]')
            self._send('250-SIZE 10485760')
            self._send('250-8BITMIME')
            self._send('250-AUTH PLAIN LOGIN')
            self._send('250 HELP')
            return True
        # --- AUTH (PLAIN / LOGIN) 任意凭据通过 ---
        if up.startswith('AUTH'):
            self._handle_auth(line)
            return True
        # --- MAIL FROM ---
        if up.startswith('MAIL FROM'):
            if self.state not in ('helo', 'auth', 'done'):
                self._send('503 5.5.1 Bad sequence of commands (need EHLO first)')
                return True
            m = re.search(r'<([^>]+)>|:\s*(\S+)', line)
            if m:
                self.mail_from = m.group(1) or m.group(2)
            else:
                self.mail_from = 'unknown@demo.local'
            self.rcpt_to.clear()
            self.data_buf.clear()
            self.state = 'mail'
            self._send(f'250 2.1.0 OK <{self.mail_from}>')
            return True
        # --- RCPT TO ---
        if up.startswith('RCPT TO'):
            if self.state not in ('mail', 'rcpt'):
                self._send('503 5.5.1 Bad sequence of commands (need MAIL FROM first)')
                return True
            m = re.search(r'<([^>]+)>|:\s*(\S+)', line)
            if m:
                rcpt = m.group(1) or m.group(2)
                self.rcpt_to.append(rcpt)
                self._send(f'250 2.1.5 OK <{rcpt}>')
                self.state = 'rcpt'
            else:
                self._send('501 5.1.3 Bad recipient address syntax')
            return True
        # --- DATA ---
        if up.startswith('DATA'):
            if self.state != 'rcpt' or not self.rcpt_to:
                self._send('503 5.5.1 Bad sequence of commands (need valid RCPT TO)')
                return True
            self.in_data = True
            self._send('354 Enter mail, end with "." on a line by itself')
            return True
        # --- 其他未识别命令 ---
        self._send('500 5.5.2 Command not recognized')
        return True

    def _handle_auth(self, line: str) -> None:
        parts = line.strip().split(None, 2)
        mech = parts[1].upper() if len(parts) > 1 else ''
        # AUTH PLAIN (可能带 base64 payload 或者等下一步)
        if mech == 'PLAIN':
            if len(parts) > 2 and parts[2]:
                self._send('235 2.7.0 Authentication successful (demo mode, any cred)')
                self.state = 'auth'
                return
            # 等客户端发 payload
            self._send('334 ')
            try:
                resp = self.conn.recv(4096).strip()
                _log('S←', f'[AUTH PLAIN payload len={len(resp)}]', peer=self.addr)
            except Exception:
                resp = b''
            self._send('235 2.7.0 Authentication successful (demo mode, any cred)')
            self.state = 'auth'
            return
        if mech == 'LOGIN':
            self._send('334 VXNlcm5hbWU6')  # Username:
            try:
                self.conn.recv(4096)
            except Exception:
                pass
            self._send('334 UGFzc3dvcmQ6')  # Password:
            try:
                self.conn.recv(4096)
            except Exception:
                pass
            self._send('235 2.7.0 Authentication successful (demo mode, any cred)')
            self.state = 'auth'
            return
        # 不支持的机制，直接放行（演示模式）
        self._send('504 5.5.4 Unrecognized authentication type, but demo mode bypass')
        self._send('235 2.7.0 Authentication successful (demo mode)')
        self.state = 'auth'

    def _on_data_end(self) -> None:
        global _email_counter
        _email_counter += 1
        # 保存为 .eml
        os.makedirs(OUTPUT_DIR, exist_ok=True)
        ts = dt.datetime.now().strftime('%Y%m%d_%H%M%S')
        eml_path = os.path.join(OUTPUT_DIR, f'email_{ts}_{_email_counter:03d}.eml')
        with open(eml_path, 'wb') as f:
            f.write(bytes(self.data_buf))
        # 提取展示信息
        subject, preview, rcpts_in_email = _parse_subject_and_preview(bytes(self.data_buf))
        # 展示收件人：优先 DATA 解析到的，其次 RCPT TO 阶段的
        shown_rcpts = rcpts_in_email or self.rcpt_to
        sep = '─' * 78
        _log('RCVD', sep, peer=self.addr)
        _log('RCVD', f'📧 第{_email_counter}封邮件  已保存到: {eml_path}', peer=self.addr)
        _log('RCVD', f'  MAIL FROM: <{self.mail_from or "?"}>', peer=self.addr)
        _log('RCVD', f'  RCPT TO  : {", ".join(f"<{r}>" for r in shown_rcpts)}', peer=self.addr)
        _log('RCVD', f'  SUBJECT  : {subject}', peer=self.addr)
        _log('RCVD', f'  SIZE     : {len(self.data_buf)} bytes', peer=self.addr)
        if preview:
            _log('RCVD', f'  BODY预览 :\n{preview}', peer=self.addr)
        _log('RCVD', sep, peer=self.addr)
        # 响应 250 OK
        self._send(f'250 2.0.0 OK: message accepted id={os.path.basename(eml_path)}')


def main() -> None:
    os.makedirs(OUTPUT_DIR, exist_ok=True)
    srv = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    srv.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    try:
        srv.bind((BIND_HOST, BIND_PORT))
    except OSError as e:
        _log('ERR ', f'无法绑定 {BIND_HOST}:{BIND_PORT}：{e}')
        _log('INFO', '请关闭占用 1025 端口的进程，或修改本文件顶部的 BIND_PORT 为其他空闲端口（如 2025）')
        sys.exit(1)
    srv.listen(16)
    srv.settimeout(1.0)  # 让 Ctrl+C 有机会响应
    with _banner_lock:
        print('\x1b[32m' + '═' * 78)
        print('  🚀 秦安县秦剧团 · Mock SMTP 演示服务器 已启动')
        print(f'     监听地址  : {BIND_HOST}:{BIND_PORT}')
        print(f'     收件箱目录: {OUTPUT_DIR}')
        print('     认证模式  : PLAIN / LOGIN （任意用户名/密码均通过）')
        print('')
        print('  📝 下一步：另开一个终端运行：')
        print('     py -3 daily_mailer.py --config config_daily_report_LOCAL_DEMO.json')
        print('     或者先跑连通性测试：')
        print('     py -3 daily_mailer.py --config config_daily_report_LOCAL_DEMO.json --test-smtp')
        print('')
        print('  ⏹️  按 Ctrl+C 停止服务器')
        print('═' * 78 + '\x1b[0m', flush=True)
    try:
        while True:
            try:
                conn, addr = srv.accept()
            except socket.timeout:
                continue
            _log('INFO', f'新连接建立 {addr[0]}:{addr[1]}', peer=f'{addr[0]}:{addr[1]}')
            SMTPSession(conn, addr).start()
    except KeyboardInterrupt:
        _log('INFO', '收到 Ctrl+C，服务器退出')
    finally:
        try:
            srv.close()
        except Exception:
            pass
    _log('INFO', f'本次会话共接收 {_email_counter} 封邮件，均保存在 {OUTPUT_DIR}')


if __name__ == '__main__':
    main()
