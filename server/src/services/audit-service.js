'use strict';

/**
 * src/services/audit-service.js —— 审计日志便捷方法
 * 每个关键写操作（新增/改状态/删除）都要留痕：写入 audit_logs 表
 */
const prisma = require('../utils/prisma');
const { idByCtx, nowMs } = require('../config');
const { nanoid } = require('nanoid');

const write = async ({ ctx, module: m, action, targetType, targetId, detail }) => {
  const u = ctx.state?.user || {};
  const record = {
    id: idByCtx('audit', 12, nanoid),
    accountId: u.sub || null,
    username: u.username || (ctx.request.body?.username) || 'anonymous',
    module: m || 'general',
    action,
    targetType: targetType || null,
    targetId: targetId || null,
    actionTs: new Date(),
    ipAddress: ctx.ip || null,
    userAgent: (ctx.get('user-agent') || '').slice(0, 480) || null,
    detailJson: detail ? JSON.stringify(detail) : null,
    ts: BigInt(nowMs())
  };
  // 审计日志失败不阻塞业务
  try {
    await prisma.auditLog.create({ data: record });
  } catch (e) {
    // eslint-disable-next-line no-console
    console.warn('[audit] write failed:', e.message);
  }
};

module.exports = { audit: write };
