'use strict';

/**
 * src/controllers/audit.js —— 审计日志只读
 * GET /v1/audit-logs  分页列表：模块、操作人、时间范围、关键字
 */
const prisma = require('../utils/prisma');
const { success, pageMeta } = require('../utils/response');

const listAuditLogs = async ctx => {
  const { skip, take, page, pageSize } = pageMeta(ctx.query.page, ctx.query.pageSize, 0);
  const where = {};
  if (ctx.query.module) where.module = String(ctx.query.module);
  if (ctx.query.action) where.action = String(ctx.query.action);
  if (ctx.query.accountId) where.accountId = String(ctx.query.accountId);
  if (ctx.query.username) where.username = { contains: String(ctx.query.username) };
  if (ctx.query.from || ctx.query.to) {
    where.actionTs = {};
    if (ctx.query.from) where.actionTs.gte = new Date(String(ctx.query.from));
    if (ctx.query.to) where.actionTs.lte = new Date(String(ctx.query.to));
  }
  const [rows, total] = await Promise.all([
    prisma.auditLog.findMany({ where, skip, take, orderBy: { actionTs: 'desc' } }),
    prisma.auditLog.count({ where })
  ]);
  return success(ctx, rows, { ...pageMeta(page, pageSize, total), total });
};

module.exports = { listAuditLogs };
