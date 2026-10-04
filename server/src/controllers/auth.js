'use strict';

/**
 * src/controllers/auth.js —— 认证控制器
 * POST /v1/auth/login         登录（用户名+密码 → access+refresh 双 token）
 * POST /v1/auth/refresh       刷新 access
 * POST /v1/auth/logout        注销
 * GET  /v1/auth/me            当前用户 + 角色/权限树（简化版）
 * GET  /v1/auth/captcha       下发图形验证码 challenge（开关启用时校验）
 */
const { nanoid } = require('nanoid');
const prisma = require('../utils/prisma');
const { hashPassword, verifyPassword, signAccess, signRefresh, verifyRefresh, nowMs } = require('../utils/crypto');
const { success, fail, pageMeta } = require('../utils/response');
const { idByCtx, nowMs: now } = require('../config');
const { BusinessError } = require('../middleware/error-handler');
const { audit } = require('../services/audit-service');
const captchaService = require('../services/captcha-service');
const securityConfig = require('../services/security-config');

// 验证码签发 IP 限流：同 IP 60s 内最多 30 次（防刷库/枚举）
const CAPTCHA_RATE_WINDOW_MS = 60 * 1000;
const CAPTCHA_RATE_MAX = 30;
const _captchaIpCount = new Map(); // ip -> { count, resetAt }
function _captchaIpLimited(ip) {
  const now = Date.now();
  const rec = _captchaIpCount.get(ip);
  if (!rec || rec.resetAt < now) {
    _captchaIpCount.set(ip, { count: 1, resetAt: now + CAPTCHA_RATE_WINDOW_MS });
    return false;
  }
  rec.count++;
  return rec.count > CAPTCHA_RATE_MAX;
}

// ========== 下发验证码 ==========
const issueCaptcha = async ctx => {
  if (_captchaIpLimited(ctx.ip)) {
    throw new BusinessError('RATE_LIMITED', '验证码请求过于频繁，请稍后再试');
  }
  // 顺手清理过期 challenge（懒清理，避免长积累）
  captchaService.cleanupExpired().catch(() => {});
  const { id, svg } = await captchaService.issue(ctx.ip);
  ctx.set('Cache-Control', 'no-store, no-cache, must-revalidate');
  return success(ctx, { id, imageType: 'svg+xml', imageData: svg });
};

// ========== 登录 ==========
const login = async ctx => {
  const { username, password, captcha, captchaId } = ctx.request.body;

  // 0. 验证码校验（开关启用时强制；失败不消耗账号锁定次数）
  if (securityConfig.getCaptchaEnabled()) {
    const r = await captchaService.verify(captchaId, captcha);
    if (!r.ok) {
      const msgMap = {
        MISSING: '请输入验证码',
        NOT_FOUND: '验证码不存在，请刷新',
        EXPIRED: '验证码已过期，请刷新',
        CONSUMED: '验证码已使用，请刷新',
        WRONG: '验证码错误，请重新输入'
      };
      throw new BusinessError('CAPTCHA_INVALID', msgMap[r.code] || '验证码错误');
    }
  }

  const ua = (ctx.get('user-agent') || '').slice(0, 480);
  const ip = ctx.ip;

  // 1. 锁定拦截
  const recent = await prisma.loginAttempt.findMany({
    where: { ipAddress: ip, successFlag: false, attemptedAt: { gte: new Date(Date.now() - 5 * 60 * 1000) } },
    take: 20
  });
  if (recent.length >= 10) {
    await _recordAttempt({ username, ip, success: false, reason: 'IP_RATE_LIMIT' });
    throw new BusinessError('RATE_LIMITED', '该 IP 尝试过于频繁，请 5 分钟后再试');
  }

  // 2. 找账号
  const acc = await prisma.accountsV2.findUnique({ where: { username }, include: { userRoles: { include: { role: true } } } });
  if (!acc || acc.status !== 'active') {
    await _recordAttempt({ username, ip, success: false, reason: 'USER_NOT_FOUND' });
    await audit({ ctx, module: 'auth', action: 'LOGIN_FAIL_USER', targetId: username, detail: { ip } });
    throw new BusinessError('UNAUTHORIZED', '用户名或密码错误');
  }
  if (acc.lockedUntil && new Date(acc.lockedUntil) > new Date()) {
    throw new BusinessError('FORBIDDEN', `账号已锁定，解锁时间：${acc.lockedUntil.toISOString()}`);
  }

  // 3. 密码校验
  const pwdOk = await verifyPassword(password, acc.passwordHash);
  if (!pwdOk) {
    const fails = (acc.failedLoginCount || 0) + 1;
    const patch = { failedLoginCount: fails, lastLoginIp: ip };
    if (fails >= 5) {
      patch.lockedUntil = new Date(Date.now() + 30 * 60 * 1000);
    }
    await prisma.accountsV2.update({ where: { id: acc.id }, data: patch });
    await _recordAttempt({ username, ip, success: false, reason: 'BAD_PASSWORD' });
    await audit({ ctx, module: 'auth', action: 'LOGIN_FAIL_PASSWORD', targetId: acc.id, detail: { fails } });
    throw new BusinessError('UNAUTHORIZED', `用户名或密码错误（剩余 ${5 - fails} 次）`);
  }

  // 4. 首次登录强制改密码标记 → 仍可登录但前端强制跳改密页
  const payload = {
    sub: acc.id,
    username: acc.username,
    role: acc.role,
    realName: acc.realName,
    roles: (acc.userRoles || []).map(ur => ur.role?.name).filter(Boolean)
  };
  const accessToken = signAccess(payload);
  const refreshToken = signRefresh(payload);

  await prisma.accountsV2.update({
    where: { id: acc.id },
    data: { lastLoginAt: new Date(), lastLoginIp: ip, failedLoginCount: 0, lockedUntil: null, ts: BigInt(now()) }
  });
  await prisma.adminSession.deleteMany({ where: { accountId: acc.id, expiresAt: { lt: new Date() } } });
  await prisma.adminSession.create({
    data: {
      id: idByCtx('session', 16, nanoid),
      accountId: acc.id,
      tokenHash: refreshToken.slice(-16),
      ipAddress: ip,
      userAgent: ua,
      expiresAt: new Date(Date.now() + 7 * 24 * 3600 * 1000),
      ts: BigInt(now())
    }
  });
  await _recordAttempt({ username, ip, success: true });
  await audit({ ctx, module: 'auth', action: 'LOGIN_SUCCESS', targetId: acc.id });

  // cookie 下发（仅同源；跨域前端请用 Authorization: Bearer）
  if (ctx.request.hostname !== 'localhost') {
    ctx.cookies.set('x_a_t', accessToken, { httpOnly: true, sameSite: 'lax', secure: /https/i.test(ctx.protocol) });
  }
  return success(ctx, {
    accessToken,
    refreshToken,
    tokenType: 'Bearer',
    expiresInMin: 30,
    user: {
      id: acc.id,
      username: acc.username,
      realName: acc.realName,
      role: acc.role,
      roles: payload.roles,
      forcePwdChange: acc.forcePwdChange,
      avatarUrl: acc.avatarUrl,
      phone: acc.phone,
      email: acc.email
    }
  });
};

// ========== 刷新 ==========
const refresh = async ctx => {
  const { refreshToken } = ctx.request.body;
  if (!refreshToken) throw new BusinessError('VALIDATION_ERROR', 'refreshToken 必填');
  let p;
  try {
    p = verifyRefresh(refreshToken);
  } catch (e) {
    throw new BusinessError('UNAUTHORIZED', 'refresh_token 已失效，请重新登录');
  }
  const acc = await prisma.accountsV2.findUnique({ where: { id: p.sub } });
  if (!acc || acc.status !== 'active') throw new BusinessError('UNAUTHORIZED', '账号已停用');
  // 服务端会话白名单：登出/改密/封禁后 admin_sessions 行已删除，旧 refresh token 立即失效
  const session = await prisma.adminSession.findUnique({ where: { tokenHash: refreshToken.slice(-16) } });
  if (!session || session.accountId !== acc.id || session.expiresAt < new Date()) {
    throw new BusinessError('UNAUTHORIZED', '登录会话已失效，请重新登录');
  }
  const payload = { sub: acc.id, username: acc.username, role: acc.role, realName: acc.realName };
  return success(ctx, { accessToken: signAccess(payload), expiresInMin: 30, tokenType: 'Bearer' });
};

// ========== 注销 ==========
const logout = async ctx => {
  const callerId = ctx.state?.user?.sub || null;
  // 前端回传 refreshToken 时精确删除本人该条会话（不能带 refreshToken 也返回成功，仅本地丢弃令牌）
  const rt = ctx.request.body?.refreshToken;
  if (callerId && typeof rt === 'string' && rt.length) {
    await prisma.adminSession.deleteMany({ where: { tokenHash: rt.slice(-16), accountId: callerId } });
  }
  if (callerId) {
    await audit({ ctx, module: 'auth', action: 'LOGOUT', targetId: callerId });
  }
  ctx.cookies.set('x_a_t', null);
  return success(ctx, { ok: true });
};

// ========== 我 ==========
const me = async ctx => {
  const u = ctx.state.user;
  if (!u) throw new BusinessError('UNAUTHORIZED', '请先登录');
  // 兼容不同版本 Prisma schema：新版 RolePermission 关联为小写 permission，
  // 旧版生产 schema 为大写 Permission；若权限关联完全缺失则降级为仅角色查询
  let acc = null;
  try {
    acc = await prisma.accountsV2.findUnique({
      where: { id: u.sub },
      include: { userRoles: { include: { role: { include: { rolePermissions: { include: { permission: true } } } } } } }
    });
  } catch (e) {
    try {
      acc = await prisma.accountsV2.findUnique({
        where: { id: u.sub },
        include: { userRoles: { include: { role: { include: { rolePermissions: { include: { Permission: true } } } } } } }
      });
    } catch (e2) {
      acc = await prisma.accountsV2.findUnique({
        where: { id: u.sub },
        include: { userRoles: { include: { role: true } } }
      });
    }
  }
  if (!acc) throw new BusinessError('NOT_FOUND', '账号不存在');
  const roles = (acc.userRoles || []).map(ur => ({
    id: ur.role.id,
    name: ur.role.name,
    level: ur.role.level,
    perms: (ur.role.rolePermissions || []).map(rp => {
      const p = rp.permission || rp.Permission;
      return p && p.code;
    }).filter(Boolean)
  }));
  const perms = Array.from(new Set(roles.flatMap(r => r.perms)));
  return success(ctx, {
    id: acc.id,
    username: acc.username,
    realName: acc.realName,
    role: acc.role,
    phone: acc.phone,
    email: acc.email,
    avatarUrl: acc.avatarUrl,
    forcePwdChange: acc.forcePwdChange,
    lastLoginAt: acc.lastLoginAt,
    status: acc.status,
    roles,
    permissions: perms
  });
};

// ========== 扫码登录：内存 token 存储（5 分钟过期）==========
const QR_TTL_MS = 5 * 60 * 1000;
const qrStore = new Map(); // token -> { status, accountId, accessToken, refreshToken, user, expiresAt }

function _cleanQrStore() {
  const now = Date.now();
  for (const [k, v] of qrStore) {
    if (v.expiresAt < now) qrStore.delete(k);
  }
}

// 创建扫码登录 token
const qrcodeCreate = async ctx => {
  _cleanQrStore();
  const token = nanoid(32);
  qrStore.set(token, {
    status: 'pending',
    accountId: null,
    accessToken: null,
    refreshToken: null,
    user: null,
    createdAt: new Date(),
    expiresAt: new Date(Date.now() + QR_TTL_MS)
  });
  return success(ctx, { token, expiresAt: new Date(Date.now() + QR_TTL_MS).toISOString() });
};

// 查询扫码登录状态
const qrcodeStatus = async ctx => {
  const { token } = ctx.params;
  const entry = qrStore.get(token);
  if (!entry) return success(ctx, { status: 'expired' });
  if (entry.expiresAt < new Date()) {
    qrStore.delete(token);
    return success(ctx, { status: 'expired' });
  }
  const resp = { status: entry.status };
  if (entry.status === 'confirmed') {
    resp.accessToken = entry.accessToken;
    resp.refreshToken = entry.refreshToken;
    resp.user = entry.user;
    // 确认后立即清理，防止重放
    qrStore.delete(token);
  }
  return success(ctx, resp);
};

// 手机端确认登录（输入账号密码后调用）
const qrcodeConfirm = async ctx => {
  const { token, username, password } = ctx.request.body;
  if (!token || !username || !password) {
    throw new BusinessError('VALIDATION_ERROR', 'token、username、password 必填');
  }
  const entry = qrStore.get(token);
  if (!entry || entry.expiresAt < new Date()) {
    throw new BusinessError('NOT_FOUND', '二维码已过期，请刷新');
  }
  if (entry.status === 'confirmed') {
    throw new BusinessError('FORBIDDEN', '该二维码已被使用');
  }

  // 与账密登录同一套安全策略：IP 限流 + 账号锁定 + 失败计数
  // （扫码通道不能成为锁定后的撞库旁路）
  const ip = ctx.ip;
  const recent = await prisma.loginAttempt.findMany({
    where: { ipAddress: ip, successFlag: false, attemptedAt: { gte: new Date(Date.now() - 5 * 60 * 1000) } },
    take: 20
  });
  if (recent.length >= 10) {
    await _recordAttempt({ username, ip, success: false, reason: 'QR_IP_RATE_LIMIT' });
    throw new BusinessError('RATE_LIMITED', '该 IP 尝试过于频繁，请 5 分钟后再试');
  }

  const acc = await prisma.accountsV2.findUnique({
    where: { username },
    include: { userRoles: { include: { role: true } } }
  });
  if (!acc || acc.status !== 'active') {
    await _recordAttempt({ username, ip, success: false, reason: 'QR_USER_NOT_FOUND' });
    throw new BusinessError('UNAUTHORIZED', '用户名或密码错误');
  }
  if (acc.lockedUntil && new Date(acc.lockedUntil) > new Date()) {
    throw new BusinessError('FORBIDDEN', `账号已锁定，解锁时间：${acc.lockedUntil.toISOString()}`);
  }
  const pwdOk = await verifyPassword(password, acc.passwordHash);
  if (!pwdOk) {
    const fails = (acc.failedLoginCount || 0) + 1;
    const patch = { failedLoginCount: fails, lastLoginIp: ip };
    if (fails >= 5) {
      patch.lockedUntil = new Date(Date.now() + 30 * 60 * 1000);
    }
    await prisma.accountsV2.update({ where: { id: acc.id }, data: patch });
    await _recordAttempt({ username, ip, success: false, reason: 'QR_BAD_PASSWORD' });
    await audit({ ctx, module: 'auth', action: 'QR_LOGIN_FAIL_PASSWORD', targetId: acc.id, detail: { fails } });
    throw new BusinessError('UNAUTHORIZED', `用户名或密码错误（剩余 ${5 - fails} 次）`);
  }

  const ua = (ctx.get('user-agent') || '').slice(0, 480);
  const payload = {
    sub: acc.id,
    username: acc.username,
    role: acc.role,
    realName: acc.realName,
    roles: (acc.userRoles || []).map(ur => ur.role?.name).filter(Boolean)
  };
  const accessToken = signAccess(payload);
  const refreshToken = signRefresh(payload);

  await prisma.accountsV2.update({
    where: { id: acc.id },
    data: { lastLoginAt: new Date(), lastLoginIp: ip, failedLoginCount: 0, lockedUntil: null, ts: BigInt(now()) }
  });
  await prisma.adminSession.deleteMany({ where: { accountId: acc.id, expiresAt: { lt: new Date() } } });
  await prisma.adminSession.create({
    data: {
      id: idByCtx('session', 16, nanoid),
      accountId: acc.id,
      tokenHash: refreshToken.slice(-16),
      ipAddress: ip,
      userAgent: ua,
      expiresAt: new Date(Date.now() + 7 * 24 * 3600 * 1000),
      ts: BigInt(now())
    }
  });
  await _recordAttempt({ username, ip, success: true });
  await audit({ ctx, module: 'auth', action: 'LOGIN_QRCODE', targetId: acc.id });

  entry.status = 'confirmed';
  entry.accountId = acc.id;
  entry.accessToken = accessToken;
  entry.refreshToken = refreshToken;
  entry.user = {
    id: acc.id,
    username: acc.username,
    realName: acc.realName,
    role: acc.role,
    roles: payload.roles,
    forcePwdChange: acc.forcePwdChange,
    avatarUrl: acc.avatarUrl,
    phone: acc.phone,
    email: acc.email
  };

  return success(ctx, { ok: true });
};

// ========== 辅助：记录登录尝试 ==========
async function _recordAttempt({ username, ip, success, reason }) {
  try {
    await prisma.loginAttempt.create({
      data: {
        id: idByCtx('loginAttempt', 12, nanoid),
        username: username || null,
        ipAddress: ip,
        attemptedAt: new Date(),
        successFlag: !!success,
        failReason: reason || null,
        ts: BigInt(now())
      }
    });
  } catch (_) {
    /* noop */
  }
}

module.exports = { login, refresh, logout, me, qrcodeCreate, qrcodeStatus, qrcodeConfirm, issueCaptcha, _hashPwdForSeed: hashPassword };
