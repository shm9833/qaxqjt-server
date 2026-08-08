'use strict';

/**
 * src/controllers/roles.js —— 角色 + 权限
 * GET    /v1/roles                 列表
 * POST   /v1/roles                 新建
 * PATCH  /v1/roles/:id             修改
 * DELETE /v1/roles/:id             删除
 * PUT    /v1/roles/:id/permissions 批量赋权
 * GET    /v1/permissions           权限字典（系统预置，无写操作）
 */
const { nanoid } = require('nanoid');
const prisma = require('../utils/prisma');
const { success, created, pageMeta } = require('../utils/response');
const { idByCtx, nowMs } = require('../config');
const { BusinessError } = require('../middleware/error-handler');
const { audit } = require('../services/audit-service');

const listRoles = async ctx => {
  const { skip, take, page, pageSize } = pageMeta(ctx.query.page, ctx.query.pageSize, 0);
  const where = {};
  if (ctx.query.keyword) {
    where.OR = [{ name: { contains: ctx.query.keyword } }, { description: { contains: ctx.query.keyword } }];
  }
  if (ctx.query.status) where.status = ctx.query.status;
  const [rows, total] = await Promise.all([
    prisma.role.findMany({
      where,
      skip,
      take,
      orderBy: { level: 'desc' },
      include: { _count: { select: { userRoles: true, rolePermissions: true } } }
    }),
    prisma.role.count({ where })
  ]);
  return success(ctx, rows, { ...pageMeta(page, pageSize, total), total });
};

const createRole = async ctx => {
  const b = ctx.request.body;
  const r = await prisma.role.create({
    data: {
      id: b.id || idByCtx('role', 10, nanoid),
      name: b.name,
      description: b.description || null,
      level: Number(b.level) || 100,
      status: b.status || 'active',
      createdBy: ctx.state.user?.sub || 'system',
      ts: BigInt(nowMs())
    }
  });
  await audit({ ctx, module: 'iam', action: 'ROLE_CREATE', targetId: r.id, detail: { name: r.name } });
  return created(ctx, r);
};

const updateRole = async ctx => {
  const b = ctx.request.body;
  const patch = {};
  ['name', 'description', 'level', 'status'].forEach(k => {
    if (b[k] !== undefined) patch[k] = b[k];
  });
  patch.updatedAt = new Date();
  patch.ts = BigInt(nowMs());
  const r = await prisma.role.update({ where: { id: ctx.params.id }, data: patch });
  await audit({ ctx, module: 'iam', action: 'ROLE_UPDATE', targetId: r.id });
  return success(ctx, r);
};

const removeRole = async ctx => {
  const count = await prisma.userRole.count({ where: { roleId: ctx.params.id } });
  if (count > 0) throw new BusinessError('CONFLICT', '该角色下仍有账号，无法删除');
  await prisma.rolePermission.deleteMany({ where: { roleId: ctx.params.id } });
  const r = await prisma.role.delete({ where: { id: ctx.params.id } });
  await audit({ ctx, module: 'iam', action: 'ROLE_DELETE', targetId: r.id });
  return success(ctx, { id: r.id, deleted: true });
};

const assignPermissions = async ctx => {
  const permissionIds = Array.isArray(ctx.request.body.permissionIds)
    ? ctx.request.body.permissionIds.map(String)
    : [];
  await prisma.$transaction(async tx => {
    await tx.rolePermission.deleteMany({ where: { roleId: ctx.params.id } });
    if (permissionIds.length) {
      const valid = await tx.permission.findMany({ where: { id: { in: permissionIds } }, select: { id: true } });
      await tx.rolePermission.createMany({
        data: valid.map(p => ({
          roleId: ctx.params.id,
          permissionId: p.id,
          ts: BigInt(nowMs())
        })),
        skipDuplicates: true
      });
    }
  });
  await audit({ ctx, module: 'iam', action: 'ROLE_ASSIGN_PERM', targetId: ctx.params.id, detail: permissionIds });
  const r = await prisma.role.findUnique({
    where: { id: ctx.params.id },
    include: { rolePermissions: { include: { permission: true } } }
  });
  return success(ctx, r);
};

const listPermissions = async ctx => {
  const { skip, take, page, pageSize } = pageMeta(ctx.query.page, ctx.query.pageSize, 0);
  const where = {};
  if (ctx.query.module) where.module = String(ctx.query.module);
  if (ctx.query.keyword) {
    where.OR = [{ name: { contains: ctx.query.keyword } }, { code: { contains: ctx.query.keyword } }];
  }
  const [rows, total] = await Promise.all([
    prisma.permission.findMany({ where, skip, take, orderBy: { module: 'asc' } }),
    prisma.permission.count({ where })
  ]);
  return success(ctx, rows, { ...pageMeta(page, pageSize, total), total });
};

module.exports = {
  listRoles,
  createRole,
  updateRole,
  removeRole,
  assignPermissions,
  listPermissions
};
