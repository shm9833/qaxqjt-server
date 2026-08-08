/**
 * scripts/mock-api-server.js
 * ----------------------------------------------------------------------------
 * 轻量级 3001 端口 Mock API 服务器（零数据库依赖，纯 Node.js 原生 http）
 * 用途：
 *   1) 模拟后端 /v1/auth/login / /v1/appointments / /v1/healthz 响应
 *   2) 启动后：管理员登录 + booking.html 预约提交 → 走真·API 流程
 *   3) Ctrl+C 关掉 mock 后：前端自动降级 localStorage (可直观对比 fallback 日志)
 *
 * 运行：  node scripts/mock-api-server.js
 * 停止：  Ctrl+C
 */
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const URL = require('url');

const PORT = parseInt(process.env.PORT || '3001', 10);
const PREFIX = '/api';
const ROOT = process.cwd();
const TTL_ACCESS_MIN = 30;
const JWT_SECRET = 'mock-server-jwt-secret-change-me-in-production-please-000000000000000000000000000000000000000000000000000000000000001';
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js':   'application/javascript; charset=utf-8',
  '.css':  'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg':  'image/svg+xml',
  '.png':  'image/png',
  '.jpg':  'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif':  'image/gif',
  '.ico':  'image/x-icon',
  '.woff': 'font/woff',
  '.woff2':'font/woff2',
  '.ttf':  'font/ttf',
  '.map':  'application/json; charset=utf-8',
  '.webp': 'image/webp'
};

// ====================== 模拟账号 ======================
// 同时支持两套密码：
//   1) 前端 Demo 动态密码格式：Qaxqjt@YYYYMMddHH! （每小时变化，与 login.html __getDemoUsers 完全一致）
//   2) 固定演示密码（兼容 Postman / 自动化脚本）：admin/ChangeMe123!  caiwu/Qaxqjt@2026  yuangong/Qaxqjt@2026
function getDynamicPassword() {
  const now = new Date();
  const pad2 = (n) => (n < 10 ? '0' + n : '' + n);
  const suffix = now.getFullYear().toString() + pad2(now.getMonth()+1) + pad2(now.getDate()) + pad2(now.getHours());
  return 'Qaxqjt@' + suffix + '!';
}
const MOCK_USERS = [
  { id: 'acc_admin', username: 'admin', password: 'ChangeMe123!', realName: '系统管理员', role: 'super_admin', roleName: '超级管理员', phone: '13800000000', email: 'admin@demo.local', status: 'active', forcePwdChange: false },
  { id: 'acc_ops',   username: 'caiwu', password: 'Qaxqjt@2026',  realName: '财务人员',   role: 'finance_view', roleName: '财务', phone: '13800000002', email: 'caiwu@demo.local', status: 'active', forcePwdChange: false },
  { id: 'acc_ops2',  username: 'yuangong', password: 'Qaxqjt@2026', realName: '剧团员工', role: 'staff', roleName: '剧团员工', phone: '13800000003', email: 'yg@demo.local', status: 'active', forcePwdChange: false }
];
function verifyPassword(user, inputPwd) {
  if (!inputPwd) return false;
  if (user.password === inputPwd) return true;
  const dyn = getDynamicPassword();
  if (dyn === inputPwd) return true;
  // 容错：上一小时的动态密码（防止页面打开太久密码过期）
  const prev = new Date(Date.now() - 3600*1000);
  const pad2 = (n) => (n < 10 ? '0' + n : '' + n);
  const prevSuffix = prev.getFullYear().toString() + pad2(prev.getMonth()+1) + pad2(prev.getDate()) + pad2(prev.getHours());
  if (('Qaxqjt@' + prevSuffix + '!') === inputPwd) return true;
  return false;
}

let seqAppt = 1000;
let seqCust = 500;
let seqAudit = 1;
const DATA = {
  appointments: [],
  customers: [],
  auditLogs: []
};

// ====================== JWT 轻量实现 ======================
function b64url(buf) {
  return Buffer.isBuffer(buf)
    ? buf.toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_')
    : Buffer.from(String(buf)).toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}
function signHS256(payload) {
  const header = { alg: 'HS256', typ: 'JWT' };
  const h = b64url(JSON.stringify(header));
  const p = b64url(JSON.stringify(Object.assign({ iat: Math.floor(Date.now()/1000), iss: 'qaxqjt-mock', aud: 'qaxqjt-admin' }, payload)));
  const sig = crypto.createHmac('sha256', JWT_SECRET).update(`${h}.${p}`).digest();
  return `${h}.${p}.${b64url(sig)}`;
}
function readBody(req, limitMb = 2) {
  return new Promise((resolve, reject) => {
    let buf = Buffer.alloc(0);
    let len = 0;
    const MAX = (limitMb || 2) * 1024 * 1024;
    req.on('data', (chunk) => {
      len += chunk.length;
      if (len > MAX) { req.destroy(); reject(new Error('BODY_TOO_BIG')); return; }
      buf = Buffer.concat([buf, chunk]);
    });
    req.on('end', () => { try { resolve(buf.length ? JSON.parse(buf.toString('utf8')) : {}); } catch (e) { reject(e); } });
    req.on('error', reject);
  });
}
function ok(ctx, data, code = 200) {
  ctx.res.statusCode = code;
  ctx.res.setHeader('Content-Type', 'application/json; charset=utf-8');
  ctx.res.setHeader('Cache-Control', 'no-store');
  ctx.res.end(JSON.stringify({ ok: true, code: 0, data, msg: 'ok', ts: Date.now() }));
}
function fail(ctx, msg, code, httpStatus = 400) {
  ctx.res.statusCode = httpStatus;
  ctx.res.setHeader('Content-Type', 'application/json; charset=utf-8');
  ctx.res.end(JSON.stringify({ ok: false, code: code || 'ERROR', msg: msg || 'error', ts: Date.now() }));
}
function cors(ctx) {
  const origin = ctx.req.headers.origin || '*';
  ctx.res.setHeader('Access-Control-Allow-Origin', origin);
  ctx.res.setHeader('Access-Control-Allow-Credentials', 'true');
  ctx.res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With');
  ctx.res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PATCH,PUT,DELETE,OPTIONS,HEAD');
  ctx.res.setHeader('Access-Control-Max-Age', '86400');
  if (ctx.req.method === 'OPTIONS') { ctx.res.statusCode = 204; ctx.res.end(); return true; }
  return false;
}
function stripPrefix(p) {
  if (p.indexOf(PREFIX) === 0) return p.slice(PREFIX.length);
  return p;
}
// ====================== 静态文件托管（同源前端页面） ======================
function serveStatic(ctx, pname) {
  let rel = decodeURIComponent(pname.split('?')[0]);
  if (rel === '/') rel = '/index.html';
  // 目录浏览防护 & 路径穿越防护
  if (rel.indexOf('..') !== -1 || rel.indexOf('\\') !== -1 || /%2e/i.test(pname)) {
    ctx.res.statusCode = 403;
    ctx.res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    ctx.res.end('Forbidden');
    return;
  }
  const fp = path.normalize(path.join(ROOT, rel));
  // 二次检查：必须在 ROOT 内
  if (!fp.startsWith(ROOT)) {
    ctx.res.statusCode = 403;
    ctx.res.end('Forbidden');
    return;
  }
  fs.stat(fp, (err, st) => {
    if (err) {
      // /admin/  →  /admin/index.html 尝试
      if (pname === '/admin' || pname === '/admin/') {
        return serveStatic(ctx, '/admin/index.html');
      }
      ctx.res.statusCode = 404;
      ctx.res.setHeader('Content-Type', 'text/html; charset=utf-8');
      ctx.res.end(`<html><head><meta charset="utf-8"><title>404 Not Found</title>
<style>body{font-family:-apple-system,Segoe UI,"Microsoft YaHei",sans-serif;background:#f5f5f7;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0}.c{background:#fff;border-radius:12px;padding:48px 56px;box-shadow:0 2px 16px rgba(0,0,0,.06);max-width:560px}h1{margin:0 0 12px;color:#e74c3c;font-size:28px}p{color:#555;line-height:1.8;margin:6px 0}.tip{background:#fff4e5;border-left:4px solid #f5a623;padding:12px 16px;border-radius:4px;margin-top:20px}.tip b{color:#d48806}.routes{margin-top:20px;padding-top:20px;border-top:1px dashed #eee}a{color:#2f54eb;text-decoration:none}a:hover{text-decoration:underline}</style>
</head><body><div class="c"><h1>404 · Not Found</h1><p>请求路径：<code style="background:#f0f0f0;padding:2px 6px;border-radius:3px">${rel}</code> 不存在或尚未路由。</p>
<div class="tip"><b>📡 快速入口（现在 3001 同时托管前端 + Mock API）：</b><div class="routes">
<p>🎫 官网首页：<a href="/">/index.html</a> &nbsp;|&nbsp; 预约：<a href="/booking.html">/booking.html</a><br>🔐 管理登录：<a href="/admin/login.html">/admin/login.html</a><br>🧩 API 健康检查：<a href="/v1/healthz">/v1/healthz</a> &nbsp;|&nbsp; <a href="/v1/auth/login">/v1/auth/login (POST)</a> &nbsp;|&nbsp; <a href="/v1/appointments">/v1/appointments (POST 公开)</a></p>
</div></div></div></body></html>`);
      return;
    }
    let filePath = fp;
    if (st.isDirectory()) {
      filePath = path.join(fp, 'index.html');
    }
    fs.readFile(filePath, (e2, buf) => {
      if (e2) {
        ctx.res.statusCode = 404;
        ctx.res.setHeader('Content-Type', 'text/plain; charset=utf-8');
        ctx.res.end('Not Found');
        return;
      }
      const ext = path.extname(filePath).toLowerCase();
      ctx.res.statusCode = 200;
      ctx.res.setHeader('Content-Type', MIME[ext] || 'application/octet-stream');
      ctx.res.setHeader('Content-Length', buf.length);
      ctx.res.setHeader('Cache-Control', ext === '.html' ? 'no-cache' : 'public, max-age=600');
      ctx.res.end(buf);
    });
  });
}

// ====================== 路由处理 ======================
async function route(req, res) {
  const ctx = { req, res };
  const parsed = URL.parse(req.url, true);
  const path = stripPrefix(parsed.pathname.replace(/\/+$/, '') || '/');
  const query = parsed.query;

  // ---- 0. Healthz ----
  if (path === '/v1/healthz') {
    return ok(ctx, { service: 'qaxqjt-api', version: 'MOCK-1.0', env: 'mock', ts: Date.now(), pid: process.pid });
  }

  // ---- 1. Auth Login (公开) ----
  if (path === '/v1/auth/login' && req.method === 'POST') {
    const body = await readBody(req);
    const { username, password } = body || {};
    if (!username || !password) return fail(ctx, '账号密码必填', 'VALIDATION_ERROR', 400);
    const u = MOCK_USERS.find(x => x.username === username && verifyPassword(x, password));
    if (!u) {
      DATA.auditLogs.push({ id: 'audit_' + (seqAudit++), module: 'auth', action: 'LOGIN_FAIL', targetId: String(username), detail: { ip: req.socket.remoteAddress }, createdAt: new Date().toISOString() });
      return fail(ctx, '用户名或密码错误', 'UNAUTHORIZED', 401);
    }
    const accessToken = signHS256({ sub: u.id, username: u.username, role: u.role, exp: Math.floor(Date.now()/1000) + TTL_ACCESS_MIN * 60 });
    const refreshToken = signHS256({ sub: u.id, rt: 1, exp: Math.floor(Date.now()/1000) + 7*24*3600 });
    DATA.auditLogs.push({ id: 'audit_' + (seqAudit++), module: 'auth', action: 'LOGIN_SUCCESS', targetId: u.id, detail: { ip: req.socket.remoteAddress }, createdAt: new Date().toISOString() });
    console.info('[MOCK] ✅ 登录成功 user=' + u.username + ' role=' + u.role);
    return ok(ctx, {
      accessToken,
      refreshToken,
      tokenType: 'Bearer',
      expiresInMin: TTL_ACCESS_MIN,
      sessionId: 'sess_mock_' + Date.now(),
      user: {
        id: u.id, username: u.username, realName: u.realName, role: u.role,
        roles: [{ name: u.role, displayName: u.roleName }],
        forcePwdChange: !!u.forcePwdChange, avatarUrl: null, phone: u.phone, email: u.email
      }
    });
  }

  // ---- 2. Refresh ----
  if (path === '/v1/auth/refresh' && req.method === 'POST') {
    const body = await readBody(req);
    return ok(ctx, { accessToken: signHS256({ sub: 'mock_refresh_user', exp: Math.floor(Date.now()/1000) + TTL_ACCESS_MIN*60 }), expiresInMin: TTL_ACCESS_MIN, tokenType: 'Bearer' });
  }

  // ---- 3. Logout ----
  if (path === '/v1/auth/logout' && req.method === 'POST') return ok(ctx, { ok: true });

  // ---- 4. Auth Me (需要 Token) ----
  if (path === '/v1/auth/me') {
    const auth = req.headers.authorization || '';
    if (!auth.startsWith('Bearer ')) return fail(ctx, '请先登录', 'UNAUTHORIZED', 401);
    const token = auth.slice(7);
    try {
      const parts = token.split('.');
      const payload = JSON.parse(Buffer.from(parts[1], 'base64').toString('utf8'));
      const u = MOCK_USERS.find(x => x.id === payload.sub) || MOCK_USERS[0];
      return ok(ctx, {
        id: u.id, username: u.username, realName: u.realName, role: u.role,
        phone: u.phone, email: u.email, avatarUrl: null, forcePwdChange: !!u.forcePwdChange,
        lastLoginAt: new Date().toISOString(), status: u.status,
        roles: [{ id: 'r_' + u.role, name: u.role, level: u.role === 'super_admin' ? 1 : 50, perms: ['*'] }],
        permissions: ['*']
      });
    } catch (e) { return fail(ctx, 'Token 非法或已过期', 'UNAUTHORIZED', 401); }
  }

  // ---- 5. 公开 POST Appointments (booking.html) ----
  if (path === '/v1/appointments' && req.method === 'POST') {
    const body = await readBody(req);
    const id = 'BK' + new Date().getFullYear() + String(Date.now()).slice(-8) + (++seqAppt);
    const now = new Date().toISOString();
    const a = Object.assign({}, body, {
      id, bookingId: id, bookingNo: id,
      status: 'pending', auditStatus: 'pending',
      createdAt: now, updatedAt: now, version: 1, fromMockApi: true
    });
    DATA.appointments.unshift(a);
    // 客户自动建档
    if (body.phone && body.customerName) {
      const exist = DATA.customers.find(c => c.phone === body.phone);
      if (!exist) {
        const cid = 'CUST_' + (++seqCust);
        DATA.customers.push({ id: cid, customerName: body.customerName, phone: body.phone, customerType: body.customerType || 'personal', status: 'active', createdAt: now });
      }
    }
    DATA.auditLogs.push({ id: 'audit_' + (seqAudit++), module: 'appointments', action: 'CREATE', targetId: id, detail: { customerName: body.customerName, phone: body.phone }, createdAt: now });
    console.info('[MOCK] ✅ 创建预约 id=' + id + ' customer=' + (body.customerName || '') + ' phone=' + (body.phone || ''));
    return ok(ctx, a, 201);
  }

  // ---- 6. 受保护接口：鉴权检查 ----
  const authH = req.headers.authorization || '';
  if (!authH.startsWith('Bearer ')) return fail(ctx, '请先登录', 'UNAUTHORIZED', 401);

  // ---- 7. Appointments (已鉴权) ----
  if (path === '/v1/appointments' && req.method === 'GET') {
    const { page = 1, pageSize = 20, status } = query;
    const pg = Math.max(1, parseInt(page, 10));
    const ps = Math.max(1, parseInt(pageSize, 10));
    const filtered = status ? DATA.appointments.filter(x => x.status === status) : DATA.appointments.slice();
    const total = filtered.length;
    const list = filtered.slice((pg - 1) * ps, pg * ps);
    return ok(ctx, { list, total, page: pg, pageSize: ps, totalPages: Math.ceil(total / ps) });
  }
  if (path === '/v1/appointments/stats') {
    const byStatus = {};
    DATA.appointments.forEach(a => { byStatus[a.status] = (byStatus[a.status] || 0) + 1; });
    return ok(ctx, {
      total: DATA.appointments.length,
      byStatus,
      byPackageType: { temple_fair: 0, cultural_tourism: 0, campus_tour: 0, custom: 0 },
      revenueTotal: DATA.appointments.reduce((s, a) => s + (Number(a.totalPerformanceFee) || 0), 0),
      thisMonth: DATA.appointments.length
    });
  }
  const mA = path.match(/^\/v1\/appointments\/([^/]+)$/);
  if (mA) {
    const id = mA[1];
    const a = DATA.appointments.find(x => x.id === id);
    if (!a) return fail(ctx, '预约不存在', 'NOT_FOUND', 404);
    if (req.method === 'GET') return ok(ctx, a);
    if (req.method === 'PATCH') {
      const body = await readBody(req);
      Object.assign(a, body, { updatedAt: new Date().toISOString(), version: (a.version || 1) + 1 });
      return ok(ctx, a);
    }
    if (req.method === 'DELETE') {
      DATA.appointments = DATA.appointments.filter(x => x.id !== id);
      return ok(ctx, { id, deleted: true });
    }
  }
  const mTrans = path.match(/^\/v1\/appointments\/([^/]+)\/transition$/);
  if (mTrans && req.method === 'POST') {
    const a = DATA.appointments.find(x => x.id === mTrans[1]);
    if (!a) return fail(ctx, '预约不存在', 'NOT_FOUND', 404);
    const { to, reason } = await readBody(req);
    if (!['confirmed', 'rejected', 'cancelled', 'converted', 'pending'].includes(to)) return fail(ctx, '状态非法', 'VALIDATION_ERROR', 400);
    a.status = to;
    a.statusUpdatedAt = new Date().toISOString();
    a.rejectReason = to === 'rejected' ? (reason || '') : a.rejectReason;
    DATA.auditLogs.push({ id: 'audit_' + (seqAudit++), module: 'appointments', action: 'TRANSITION_' + String(to).toUpperCase(), targetId: a.id, detail: { reason }, createdAt: a.statusUpdatedAt });
    return ok(ctx, { id: a.id, status: to, ok: true });
  }
  const mAudit = path.match(/^\/v1\/appointments\/([^/]+)\/audit-logs$/);
  if (mAudit) return ok(ctx, DATA.auditLogs.filter(x => x.targetId === mAudit[1]).slice(-20));

  // ---- 8. Customers ----
  if (path === '/v1/customers' && req.method === 'GET') {
    const { page = 1, pageSize = 50, customerType } = query;
    const list = customerType ? DATA.customers.filter(c => c.customerType === customerType) : DATA.customers;
    return ok(ctx, list.slice(0, parseInt(pageSize, 10)));
  }
  if (path === '/v1/customers' && req.method === 'POST') {
    const body = await readBody(req);
    const cid = 'CUST_' + (++seqCust);
    const c = Object.assign({ id: cid, createdAt: new Date().toISOString() }, body);
    DATA.customers.push(c);
    return ok(ctx, c, 201);
  }
  const mC = path.match(/^\/v1\/customers\/([^/]+)$/);
  if (mC) {
    const c = DATA.customers.find(x => x.id === mC[1]);
    if (!c) return fail(ctx, '客户不存在', 'NOT_FOUND', 404);
    if (req.method === 'GET') return ok(ctx, c);
    if (req.method === 'PATCH') { Object.assign(c, await readBody(req), { updatedAt: new Date().toISOString() }); return ok(ctx, c); }
    if (req.method === 'DELETE') { DATA.customers = DATA.customers.filter(x => x.id !== mC[1]); return ok(ctx, { id: mC[1], deleted: true }); }
  }

  // ---- 9. Accounts ----
  if (path === '/v1/accounts' && req.method === 'GET') return ok(ctx, MOCK_USERS.map(u => ({ id: u.id, username: u.username, realName: u.realName, role: u.role, phone: u.phone, email: u.email, status: u.status, lastLoginAt: new Date().toISOString() })));
  if (path === '/v1/accounts' && req.method === 'POST') {
    const body = await readBody(req);
    const id = 'acc_' + (++seqCust);
    const acc = Object.assign({ id, createdAt: new Date().toISOString(), status: 'active' }, body);
    MOCK_USERS.push({ id, username: body.username, password: body.password, realName: body.realName, role: body.role, phone: body.phone, email: body.email, status: 'active', forcePwdChange: !!body.forcePwdChange });
    return ok(ctx, acc, 201);
  }
  const mAcc = path.match(/^\/v1\/accounts\/([^/]+)$/);
  if (mAcc) {
    const u = MOCK_USERS.find(x => x.id === mAcc[1]);
    if (!u) return fail(ctx, '账号不存在', 'NOT_FOUND', 404);
    if (req.method === 'GET') return ok(ctx, { id: u.id, username: u.username, realName: u.realName, role: u.role, phone: u.phone, email: u.email, status: u.status, forcePwdChange: u.forcePwdChange });
    if (req.method === 'PATCH') { const b = await readBody(req); Object.assign(u, { realName: b.realName, role: b.role, phone: b.phone, email: b.email, status: b.status }); return ok(ctx, { id: u.id, ok: true }); }
    if (req.method === 'DELETE') { const idx = MOCK_USERS.findIndex(x => x.id === mAcc[1]); if (idx >= 0) MOCK_USERS.splice(idx, 1); return ok(ctx, { id: mAcc[1], deleted: true }); }
  }

  // ---- 10. Roles & Permissions ----
  if (path === '/v1/roles' && req.method === 'GET') return ok(ctx, [
    { id: 'r_sa', name: 'super_admin', description: '超级管理员', level: 1, status: 'active', createdAt: new Date().toISOString() },
    { id: 'r_op', name: 'ops', description: '运营/预约管理', level: 50, status: 'active' },
    { id: 'r_fi', name: 'finance_view', description: '财务查看', level: 80, status: 'active' }
  ]);
  if (path === '/v1/permissions') return ok(ctx, [
    { id: 'p1', module: 'appointments', code: 'appointments:read', name: '查看预约' },
    { id: 'p2', module: 'appointments', code: 'appointments:write', name: '写预约' },
    { id: 'p3', module: 'customers', code: 'customers:read', name: '查看客户' },
    { id: 'p4', module: 'finance', code: 'finance:view', name: '查看财务' }
  ]);

  // ---- 11. Audit logs ----
  if (path === '/v1/audit-logs') return ok(ctx, DATA.auditLogs.slice().reverse().slice(0, 100));

  // ---- 12. 其他 (orders/schedules/performers/cast-sheets/attendances/wage-batches/fin-ledger/inventory/contents) ----
  // 简单返回空列表/占位，保证连通性验证通过
  const simpleListRoutes = ['/v1/orders', '/v1/schedules', '/v1/performers', '/v1/cast-sheets', '/v1/attendances', '/v1/wage-batches', '/v1/fin-ledger', '/v1/inventory', '/v1/contents', '/v1/plays'];
  for (const r of simpleListRoutes) {
    if (path.startsWith(r)) return ok(ctx, { list: [], total: 0, page: query.page || 1, pageSize: query.pageSize || 20 });
  }
  if (path.startsWith('/v1/finance/')) return ok(ctx, { revenueTotal: 0, costTotal: 0, profit: 0, months: [] });

  // ---- 不匹配 ----
  return fail(ctx, `Route 未实现 Mock：${req.method} ${path}`, 'NOT_FOUND', 404);
}

// ====================== 主循环 ======================
const server = http.createServer(async (req, res) => {
  const ctx = { req, res };
  try {
    if (cors(ctx)) return;
    const parsedUrl = URL.parse(req.url, true);
    const pathname = parsedUrl.pathname.replace(/\/+$/, '') || '/';
    // ---- 同源策略： /v1/* 或 /api/* → API 路由；其余 → 静态文件（前端页面） ----
    const isApi = pathname.startsWith('/v1') || pathname.startsWith('/api') || pathname.endsWith('/v1') || pathname.endsWith('/api');
    if (isApi) {
      await route(req, res);
    } else {
      serveStatic(ctx, parsedUrl.pathname || '/');
    }
  } catch (e) {
    console.error('[MOCK] ❌ 未捕获异常:', e && e.stack ? e.stack : e);
    try { fail(ctx, e.message || 'INTERNAL_ERROR', 'SERVER_ERROR', 500); } catch (_) {}
  }
});

server.listen(PORT, '127.0.0.1', () => {
  console.log('\n' + '='.repeat(72));
  console.log('✅ 秦安县秦剧团云端预约系统 · MOCK API + 前端静态服务 已启动');
  console.log('   单端口托管：前端页面 + Mock API 同源，无需在 8080 / 3001 之间切换');
  console.log('');
  console.log('   统一入口：  http://127.0.0.1:' + PORT + '/');
  console.log('');
  console.log('   🎫 前端页面：');
  console.log('     · 官网首页           http://127.0.0.1:' + PORT + '/index.html');
  console.log('     · 在线预约           http://127.0.0.1:' + PORT + '/booking.html');
  console.log('     · 后台管理登录       http://127.0.0.1:' + PORT + '/admin/login.html');
  console.log('');
  console.log('   🧩 Mock API：');
  console.log('     · 健康检查           http://127.0.0.1:' + PORT + '/v1/healthz');
  console.log('     · 登录接口           POST http://127.0.0.1:' + PORT + '/v1/auth/login');
  console.log('     · 预约提交(公开)     POST http://127.0.0.1:' + PORT + '/v1/appointments');
  console.log('');
  console.log('🧑‍💻 演示账号 (admin/login.html):');
  MOCK_USERS.forEach(u => console.log('     · ' + u.username.padEnd(10, ' ') + ' / ' + u.password.padEnd(15, ' ') + ' → ' + u.roleName + ' (' + u.role + ')'));
  console.log('');
  console.log('🔁 API ↔ localStorage 降级验证：');
  console.log('   · 现在前端发请求 →  200 ✅  (Mock 返回真实 token / bookingId)');
  console.log('   · Ctrl+C 关闭 Mock 后再操作 →  Console 输出 "[submitAppointment] API 不可用，已降级 localStorage 写入"');
  console.log('='.repeat(72) + '\n');
});
server.on('error', (e) => {
  if (e.code === 'EADDRINUSE') {
    console.error('[MOCK] ❌ 端口 ' + PORT + ' 已被占用，请先关闭占用该端口的程序（如真正后端 Koa 服务）或改 PORT 环境变量');
    process.exit(1);
  }
  console.error(e);
});
process.on('SIGINT', () => {
  console.log('\n[MOCK] 收到 SIGINT，Mock 服务关闭。前端接下来会自动降级 localStorage。');
  server.close(() => process.exit(0));
});
