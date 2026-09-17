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
const prisma = require('../utils/prisma');
const { success, created, pageMeta, noContent } = require('../utils/response');
const { idByCtx, nowMs } = require('../config');
const { BusinessError } = require('../middleware/error-handler');
const { audit } = require('../services/audit-service');

// 合法状态流转（订单下游）
const STATUS_FLOW = {
  draft: ['confirmed', 'cancelled'],
  confirmed: ['partial_paid', 'paid', 'performance', 'cancelled', 'draft'],
  partial_paid: ['paid', 'performance', 'cancelled'],
  paid: ['performance', 'refunded'],
  performance: ['completed', 'cancelled'],
  completed: ['refunded'],
  cancelled: [],
  refunded: []
};
const _checkFlow = (from, to) => {
  if (from === to) return;
  const allows = STATUS_FLOW[from] || [];
  if (!allows.includes(to)) {
    throw new BusinessError('UNPROCESSABLE', `非法状态流转：${from} → ${to}，允许：${allows.join('/') || '无'}`);
  }
};

const _genOrderNo = () => {
  const d = new Date();
  const pad = n => String(n).padStart(2, '0');
  return (
    'ORD' +
    String(d.getFullYear()).slice(2) +
    pad(d.getMonth() + 1) +
    pad(d.getDate()) +
    pad(d.getHours()) +
    pad(d.getMinutes()) +
    nanoid(4).toUpperCase()
  );
};

// 订单→档期自动关联（2026-09-08）：有演出日期的订单自动生成/同步一条排期（幂等，失败不影响订单主流程）
const _syncOrderSchedules = async order => {
  try {
    if (!order || !order.performanceStartDate) return null;
    const start = new Date(order.performanceStartDate);
    start.setHours(19, 30, 0, 0);
    let end = order.performanceEndDate ? new Date(order.performanceEndDate) : null;
    if (!end && order.performanceCount && Number(order.performanceCount) > 1) {
      end = new Date(start.getTime() + (Number(order.performanceCount) - 1) * 86400000);
    }
    if (!end) end = new Date(start);
    end.setHours(23, 59, 0, 0);
    const base = {
      scheduleDateStart: start,
      scheduleDateEnd: end,
      playTitle: order.orderType || '演出',
      feeAmount: order.finalAmount != null ? Number(order.finalAmount) : null,
      remark: '关联订单 ' + order.orderNo + (order.performanceCount ? '（' + order.performanceCount + ' 场）' : ''),
      status: order.status === 'cancelled' ? 'cancelled' : order.status === 'completed' ? 'completed' : 'scheduled'
    };
    if (order.venueFullAddress) {
      const sep = order.venueFullAddress.indexOf('·');
      if (sep >= 0) {
        base.venueDistrict = order.venueFullAddress.slice(0, sep).trim();
        base.venueAddress = order.venueFullAddress.slice(sep + 1).trim();
      } else {
        base.venueAddress = order.venueFullAddress;
      }
    }
    const existing = await prisma.scheduleV2.findFirst({
      where: { orderId: order.id },
      orderBy: { scheduleDateStart: 'asc' }
    });
    if (existing) {
      return prisma.scheduleV2.update({
        where: { id: existing.id },
        data: { ...base, updatedAt: new Date(), ts: BigInt(nowMs()) }
      });
    }
    return prisma.scheduleV2.create({
      data: {
        id: idByCtx('sched', 12, nanoid),
        scheduleNo: 'SCH-' + Date.now().toString(36).toUpperCase() + nanoid(3).toUpperCase(),
        orderId: order.id,
        createdBy: order.createdBy || 'system',
        createdAt: new Date(),
        updatedAt: new Date(),
        ts: BigInt(nowMs()),
        ...base
      }
    });
  } catch (e) {
    console.error('[orders.syncSchedules] fail:', e && e.message);
    return null;
  }
};

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

const create = async ctx => {
  const b = ctx.request.body;
  if (!b.customerName || !b.phone) {
    throw new BusinessError('VALIDATION_ERROR', 'customerName/phone 必填');
  }

  // 客户：phone 复用老客户 or 新建
  let customer = await prisma.customersV1.findFirst({ where: { phone: b.phone } });
  if (!customer) {
    customer = await prisma.customersV1.create({
      data: {
        id: idByCtx('customer', 12, nanoid),
        customerType: b.organization ? 'organization' : 'personal',
        customerName: b.customerName,
        organization: b.organization || null,
        contactPerson: b.customerName,
        phone: b.phone,
        firstContactDate: new Date(),
        createdBy: ctx.state.user?.sub || 'system',
        status: 'active',
        ts: BigInt(nowMs())
      }
    });
  }

  const row = await prisma.order.create({
    data: {
      id: b.id || idByCtx('order', 12, nanoid),
      orderNo: b.orderNo || _genOrderNo(),
      orderType: b.orderType || 'performance',
      status: 'draft',
      customerId: customer.id,
      customerName: b.customerName,
      organization: b.organization || customer.organization || null,
      phone: b.phone,
      appointmentId: b.appointmentId || null,
      orderDate: b.orderDate ? new Date(b.orderDate) : new Date(),
      totalAmount: b.totalAmount != null ? Number(b.totalAmount) : 0,
      discountAmount: b.discountAmount != null ? Number(b.discountAmount) : 0,
      finalAmount: b.finalAmount != null ? Number(b.finalAmount) : Number(b.totalAmount || 0),
      depositAmount: b.depositAmount != null ? Number(b.depositAmount) : 0,
      paidAmount: b.paidAmount != null ? Number(b.paidAmount) : 0,
      invoiceTitle: b.invoiceTitle || null,
      taxNo: b.taxNo || null,
      contractNo: b.contractNo || null,
      contractUrl: b.contractUrl || null,
      salesmanName: b.salesmanName || null,
      performanceStartDate: b.performanceStartDate ? new Date(b.performanceStartDate) : null,
      performanceEndDate: b.performanceEndDate ? new Date(b.performanceEndDate) : null,
      performanceCount: b.performanceCount != null ? Number(b.performanceCount) : null,
      venueFullAddress: b.venueFullAddress || null,
      specialRequirements: b.specialRequirements || null,
      internalRemark: b.internalRemark || null,
      createdBy: ctx.state.user?.sub || 'system',
      ts: BigInt(nowMs())
    }
  });

  // 明细项（items: [{itemType, itemName, quantity, unitPrice, performanceDate}]）
  if (Array.isArray(b.items) && b.items.length) {
    await prisma.orderItem.createMany({
      data: b.items.map(it => ({
        id: idByCtx('orderItem', 12, nanoid),
        orderId: row.id,
        itemType: it.itemType || 'performance',
        playId: it.playId || null,
        itemName: it.itemName || '演出服务',
        quantity: Number(it.quantity) || 1,
        unitPrice: Number(it.unitPrice) || 0,
        subtotal: Number(it.subtotal) || Number(it.quantity || 1) * Number(it.unitPrice || 0),
        performanceDate: it.performanceDate ? new Date(it.performanceDate) : null,
        remark: it.remark || null,
        ts: BigInt(nowMs())
      }))
    });
  }

  // 订单→档期自动关联（含演出日期的订单自动生成排期）
  await _syncOrderSchedules(row);

  await audit({
    ctx,
    module: 'order',
    action: 'ORDER_CREATE',
    targetId: row.id,
    detail: { no: row.orderNo, amount: row.finalAmount }
  });
  const result = await prisma.order.findUnique({
    where: { id: row.id },
    include: { items: true, customer: true }
  });
  return created(ctx, result);
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

const update = async ctx => {
  const id = ctx.params.id;
  const b = ctx.request.body;
  const old = await prisma.order.findUnique({ where: { id } });
  if (!old) throw new BusinessError('NOT_FOUND', '订单不存在');
  if (b.status && b.status !== old.status) _checkFlow(old.status, b.status);

  const patch = {};
  [
    'orderType',
    'organization',
    'phone',
    'customerName',
    'invoiceTitle',
    'taxNo',
    'contractNo',
    'contractUrl',
    'salesmanName',
    'venueFullAddress',
    'specialRequirements',
    'internalRemark',
    'cancellationReason'
  ].forEach(k => {
    if (b[k] !== undefined) patch[k] = b[k];
  });
  ['totalAmount', 'discountAmount', 'finalAmount', 'depositAmount', 'paidAmount', 'performanceCount'].forEach(k => {
    if (b[k] != null) patch[k] = Number(b[k]);
  });
  ['orderDate', 'performanceStartDate', 'performanceEndDate'].forEach(k => {
    if (b[k]) patch[k] = new Date(b[k]);
  });

  // 状态相关时间戳
  if (b.status && b.status !== old.status) {
    patch.status = b.status;
    if (b.status === 'cancelled') {
      patch.cancelledDate = new Date();
      patch.cancelledBy = ctx.state.user?.realName || ctx.state.user?.sub || 'system';
    }
    if (b.status === 'completed') patch.completedDate = new Date();
  }
  patch.updatedAt = new Date();
  patch.ts = BigInt(nowMs());

  const row = await prisma.order.update({ where: { id }, data: patch });

  // 子资源：明细整体替换
  if (Array.isArray(b.items)) {
    await prisma.orderItem.deleteMany({ where: { orderId: id } });
    if (b.items.length) {
      await prisma.orderItem.createMany({
        data: b.items.map(it => ({
          id: idByCtx('orderItem', 12, nanoid),
          orderId: id,
          itemType: it.itemType || 'performance',
          playId: it.playId || null,
          itemName: it.itemName || '演出服务',
          quantity: Number(it.quantity) || 1,
          unitPrice: Number(it.unitPrice) || 0,
          subtotal: Number(it.subtotal) || Number(it.quantity || 1) * Number(it.unitPrice || 0),
          performanceDate: it.performanceDate ? new Date(it.performanceDate) : null,
          remark: it.remark || null,
          ts: BigInt(nowMs())
        }))
      });
    }
  }

  // 订单→档期自动关联（演出日期/状态变更时同步排期；空 PATCH 也会补建缺失排期）
  await _syncOrderSchedules(row);

  await audit({ ctx, module: 'order', action: 'ORDER_UPDATE', targetId: id, detail: { from: old.status, to: patch.status || old.status } });
  return success(ctx, row);
};

const remove = async ctx => {
  const id = ctx.params.id;
  const old = await prisma.order.findUnique({ where: { id } });
  if (!old) throw new BusinessError('NOT_FOUND', '订单不存在');
  if (!['draft', 'cancelled'].includes(old.status)) {
    throw new BusinessError('CONFLICT', '仅草稿/已取消订单允许删除');
  }
  await prisma.orderItem.deleteMany({ where: { orderId: id } });
  await prisma.orderRefund.deleteMany({ where: { orderId: id } });
  await prisma.finPaymentV1.deleteMany({ where: { orderId: id } });
  await prisma.scheduleV2.deleteMany({ where: { orderId: id } }); // 先删关联排期，防 ScheduleV2.orderId 外键约束
  await prisma.order.delete({ where: { id } });
  await audit({ ctx, module: 'order', action: 'ORDER_DELETE', targetId: id, detail: { no: old.orderNo } });
  return noContent(ctx);
};

/** 状态推进（简版接口）POST /v1/orders/:id/transition { to, reason } */
const transition = async ctx => {
  const id = ctx.params.id;
  const { to, reason } = ctx.request.body;
  if (!to) throw new BusinessError('VALIDATION_ERROR', 'to 必填');
  const old = await prisma.order.findUnique({ where: { id } });
  if (!old) throw new BusinessError('NOT_FOUND', '订单不存在');
  _checkFlow(old.status, to);
  const patch = { status: to, updatedAt: new Date(), ts: BigInt(nowMs()) };
  if (to === 'cancelled') {
    patch.cancelledDate = new Date();
    patch.cancelledBy = ctx.state.user?.realName || ctx.state.user?.sub || 'system';
    if (reason) patch.cancellationReason = reason;
  }
  if (to === 'completed') patch.completedDate = new Date();
  const row = await prisma.order.update({ where: { id }, data: patch });
  // 取消/完成订单时同步排期状态
  await _syncOrderSchedules(row);
  await audit({ ctx, module: 'order', action: 'ORDER_TRANSITION', targetId: id, detail: { from: old.status, to, reason: reason || null } });
  return success(ctx, row);
};

module.exports = { list, stats, create, detail, update, remove, transition, STATUS_FLOW };
