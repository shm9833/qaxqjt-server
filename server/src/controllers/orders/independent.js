/* orders/independent.js — 无交叉依赖的 handlers（自 orders.js 拆分） */
'use strict';

/**
 * src/controllers/orders.js —— 订单 CRUD
 * GET    /v1/orders              列表（分页+keyword+status+orderType+日期区间）
 * GET    /v1/orders/stats        统计（按状态计数 + 金额汇总）
 * POST   /v1/orders              新建（手机号复用老客户或自动建档）
 * GET    /v1/orders/:id          详情（含 items/payments/refunds/schedules）
 * PATCH  /v1/orders/:id          修改（状态流转校验）
 * DELETE /v1/orders/:id          删除（仅 draft/cancelled 可删）
 * POST   /v1/orders/:id/transition  状态推进 { to, reason }
 */
const { nanoid } = require('nanoid');
const prisma = require('../../utils/prisma');
const { success, created, pageMeta, noContent } = require('../../utils/response');
const { idByCtx, nowMs } = require('../../config');
const { BusinessError } = require('../../middleware/error-handler');
const { audit } = require('../../services/audit-service');
const { syncOrderPayments } = require('../../services/order-payment-sync');

const list = async ctx => {
  const { skip, take, page, pageSize } = pageMeta(ctx.query.page, ctx.query.pageSize, 0);
  const where = {};
  const kw = (ctx.query.keyword || '').trim();
  if (kw) {
    where.OR = [
      { orderNo: { contains: kw } },
      { customerName: { contains: kw } },
      { organization: { contains: kw } },
      { phone: { contains: kw } }
    ];
  }
  if (ctx.query.status) where.status = ctx.query.status;
  if (ctx.query.orderType) where.orderType = ctx.query.orderType;
  if (ctx.query.customerId) where.customerId = ctx.query.customerId;
  if (ctx.query.fromDate) where.orderDate = { gte: new Date(ctx.query.fromDate) };
  if (ctx.query.toDate) {
    where.orderDate = { ...(where.orderDate || {}), lte: new Date(ctx.query.toDate) };
  }
  const [rows, total] = await Promise.all([
    prisma.order.findMany({
      where,
      skip,
      take,
      orderBy: { createdAt: 'desc' },
      include: {
        customer: { select: { id: true, customerName: true, phone: true, level: true } },
        _count: { select: { items: true, payments: true, schedules: true } }
      }
    }),
    prisma.order.count({ where })
  ]);
  return success(ctx, rows, { ...pageMeta(page, pageSize, total), total });
};


const stats = async ctx => {
  const [byStatus, total, agg] = await Promise.all([
    prisma.order.groupBy({ by: ['status'], _count: { id: true } }),
    prisma.order.count(),
    prisma.order.aggregate({
      _sum: { totalAmount: true, finalAmount: true, paidAmount: true }
    })
  ]);
  return success(ctx, {
    total,
    byStatus: Object.fromEntries(byStatus.map(s => [s.status, s._count.id])),
    totalAmount: Number(agg._sum.totalAmount || 0),
    finalAmount: Number(agg._sum.finalAmount || 0),
    paidAmount: Number(agg._sum.paidAmount || 0)
  });
};


const detail = async ctx => {
  const r = await prisma.order.findUnique({
    where: { id: ctx.params.id },
    include: {
      items: true,
      payments: { orderBy: { payDate: 'desc' } },
      refunds: true,
      schedules: true,
      customer: true,
      appointment: true
    }
  });
  if (!r) throw new BusinessError('NOT_FOUND', '订单不存在');
  return success(ctx, r);
};


module.exports = {
  list,
  stats,
  detail,
};
