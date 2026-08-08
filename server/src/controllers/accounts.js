'use strict';

/**
 * src/controllers/accounts.js —— 账号 CRUD
 * GET    /v1/accounts         列表（分页+关键字）
 * POST   /v1/accounts         新建（密码必填，bcrypt 存储）
 * GET    /v1/accounts/:id     详情
 * PATCH  /v1/accounts/:id     修改（密码不传则不改）
 * DELETE /v1/accounts/:id     软删 = status=deleted
 * POST   /v1/accounts/:id/reset-password   管理员重置密码
 * PATCH  /v1/accounts/me/password           自己改密码（M-14 强制改密后走这里）
 */
const { nanoid } = require('nanoid');
const prisma = require('../utils/prisma');
const { success, created, pageMeta } = require('../utils/response');
const { idByCtx, nowMs } = require('../config');
const { hashPassword, verifyPassword } = require('../utils/crypto');
const { BusinessError } = require('../middleware/error-handler');
const { audit } = require('../services/audit-service');

const list = async ctx => {
  const { page, pageSize, skip, take, total } = pageMeta(ctx.query.page, ctx.query.pageSize, 0);
  const kw = (ctx.query.keyword || '').trim();
  const where = {};
  if (kw) {
    where.OR = [
      { username: { contains: kw } },
      { realName: { contains: kw } },
      { phone: { contains: kw } },
      { email: { contains: kw } }
    ];
  }
  if (ctx.query.role) where.role = String(ctx.query.role);
  if (ctx.query.status) where.status = String(ctx.query.status);
  const [rows, count] = await Promise.all([
    prisma.accountsV2.findMany({
      where,
      skip,
      take,
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        username: true,
        realName: true,
        role: true,
        phone: true,
        email: true,
        avatarUrl: true,
        status: true,
        forcePwdChange: true,
        lastLoginAt: true,
        lastLoginIp: true,
        failedLoginCount: true,
        lockedUntil: true,
        createdAt: true,
        updatedAt: true
      }
    }),
    prisma.accountsV2.count({ where })
  ]);
  return success(ctx, rows, { ...pageMeta(page, pageSize, count), total: count });
};

const create = async ctx => {
  const b = ctx.request.body;
  if (!b.password || String(b.password).length < 8) {
    throw new BusinessError('VALIDATION_ERROR', '密码至少 8 位');
  }
  const data = {
    id: b.id || idByCtx('account', 12, nanoid),
    username: b.username,
    passwordHash: await hashPassword(String(b.password)),
    realName: b.realName,
    role: b.role || 'staff',
    phone: b.phone || null,
    email: b.email || null,
    avatarUrl: b.avatarUrl || null,
    forcePwdChange: b.forcePwdChange !== false,
    status: b.status || 'active',
    createdBy: ctx.state.user?.sub || 'system',
    ts: BigInt(nowMs())
  };
  const row = await prisma.accountsV2.create({ data });
  await audit({ ctx, module: 'iam', action: 'ACCOUNT_CREATE', targetId: row.id, detail: { username: row.username, role: row.role } });
  return created(ctx, _stripPwd(row));
};

const detail = async ctx => {
  const row = await prisma.accountsV2.findUnique({
    where: { id: ctx.params.id },
    include: { userRoles: { include: { role: true } } }
  });
  if (!row) throw new BusinessError('NOT_FOUND', '账号不存在');
  return success(ctx, {
    ..._stripPwd(row),
    roles: (row.userRoles || []).map(ur => ({ id: ur.role.id, name: ur.role.name }))
  });
};

const update = async ctx => {
  const b = ctx.request.body;
  const patch = {};
  ['realName', 'role', 'phone', 'email', 'avatarUrl', 'status', 'forcePwdChange'].forEach(k => {
    if (b[k] !== undefined) patch[k] = b[k];
  });
  if (b.password) {
    if (String(b.password).length < 8) throw new BusinessError('VALIDATION_ERROR', '密码至少 8 位');
    patch.passwordHash = await hashPassword(String(b.password));
  }
  patch.updatedAt = new Date();
  patch.ts = BigInt(nowMs());
  const row = await prisma.accountsV2.update({ where: { id: ctx.params.id }, data: patch });
  await audit({ ctx, module: 'iam', action: 'ACCOUNT_UPDATE', targetId: row.id, detail: Object.keys(patch) });
  return success(ctx, _stripPwd(row));
};

const remove = async ctx => {
  if (ctx.params.id === ctx.state.user?.sub) {
    throw new BusinessError('FORBIDDEN', '不能删除自己');
  }
  const row = await prisma.accountsV2.update({
    where: { id: ctx.params.id },
    data: { status: 'deleted', updatedAt: new Date(), ts: BigInt(nowMs()) }
  });
  await audit({ ctx, module: 'iam', action: 'ACCOUNT_DELETE', targetId: row.id });
  return success(ctx, { id: row.id, status: 'deleted' });
};

const resetPwd = async ctx => {
  const { password } = ctx.request.body;
  if (!password || String(password).length < 8) {
    throw new BusinessError('VALIDATION_ERROR', '密码至少 8 位');
  }
  const row = await prisma.accountsV2.update({
    where: { id: ctx.params.id },
    data: { passwordHash: await hashPassword(String(password)), forcePwdChange: true, updatedAt: new Date(), ts: BigInt(nowMs()) }
  });
  await audit({ ctx, module: 'iam', action: 'ACCOUNT_RESET_PWD', targetId: row.id });
  return success(ctx, { id: row.id, forcePwdChange: true });
};

const changeMyPwd = async ctx => {
  const meId = ctx.state.user.sub;
  const { oldPassword, newPassword } = ctx.request.body;
  if (!oldPassword || !newPassword || String(newPassword).length < 8) {
    throw new BusinessError('VALIDATION_ERROR', 'newPassword 至少 8 位');
  }
  const me = await prisma.accountsV2.findUnique({ where: { id: meId } });
  if (!(await verifyPassword(oldPassword, me.passwordHash))) {
    throw new BusinessError('FORBIDDEN', '原密码错误');
  }
  await prisma.accountsV2.update({
    where: { id: meId },
    data: { passwordHash: await hashPassword(String(newPassword)), forcePwdChange: false, updatedAt: new Date(), ts: BigInt(nowMs()) }
  });
  await audit({ ctx, module: 'iam', action: 'ACCOUNT_CHANGE_MY_PWD', targetId: meId });
  return success(ctx, { ok: true, forcePwdChange: false });
};

function _stripPwd(r) {
  const { passwordHash, ...rest } = r;
  return rest;
}

module.exports = { list, create, detail, update, remove, resetPwd, changeMyPwd };
