'use strict';

/**
 * src/controllers/auth.js —— 认证控制器
 * POST /v1/auth/login         登录（用户名+密码 → access+refresh 双 token）
 * POST /v1/auth/refresh       刷新 access
 * POST /v1/auth/logout        注销
 * GET  /v1/auth/me            当前用户 + 角色/权限树（简化版）
 */
const { nanoid } = require('nanoid');
const prisma = require('../utils/prisma');
const { hashPassword, verifyPassword, signAccess, signRefresh, verifyRefresh, nowMs } = require('../utils/crypto');
const { success, fail, pageMeta } = require('../utils/response');
const { idByCtx, nowMs: now } = require('../config');
const { BusinessError } = require('../middleware/error-handler');
const { audit } = require('../services/audit-service');

// ========== 登录 ==========
const login = async ctx => {
  const { username, password, captcha } = ctx.request.body;

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
  const payload = { sub: acc.id, username: acc.username, role: acc.role, realName: acc.realName };
  return success(ctx, { accessToken: signAccess(payload), expiresInMin: 30, tokenType: 'Bearer' });
};

// ========== 注销 ==========
const logout = async ctx => {
  if (ctx.state?.user?.sub) {
    await audit({ ctx, module: 'auth', action: 'LOGOUT', targetId: ctx.state.user.sub });
  }
  ctx.cookies.set('x_a_t', null);
  return success(ctx, { ok: true });
};

// ========== 我 ==========
const me = async ctx => {
  const u = ctx.state.user;
  if (!u) throw new BusinessError('UNAUTHORIZED', '请先登录');
  const acc = await prisma.accountsV2.findUnique({
    where: { id: u.sub },
    include: { userRoles: { include: { role: { include: { rolePermissions: { include: { permission: true } } } } } } }
  });
  if (!acc) throw new BusinessError('NOT_FOUND', '账号不存在');
  const roles = (acc.userRoles || []).map(ur => ({
    id: ur.role.id,
    name: ur.role.name,
    level: ur.role.level,
    perms: (ur.role.rolePermissions || []).map(rp => rp.permission.code)
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

module.exports = { login, refresh, logout, me, _hashPwdForSeed: hashPassword };
