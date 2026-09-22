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

// ---- 金额服务端校验（不信赖前端/Joi 之外的任何调用方）----
const MONEY_FIELDS = ['totalAmount', 'discountAmount', 'finalAmount', 'depositAmount', 'paidAmount'];
const MAX_AMOUNT = 100000000; // 单字段 1 亿上限
const round2 = n => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

/**
 * 归一化并勾稽订单金额。
 * @param {object} raw  入参中的金额原始值（可能为 undefined）
 * @param {object|null} base 已存在订单的当前金额（update 时传入，create 传 null）
 * @returns {{values:object, moneyTouched:boolean, itemsTotal:number|null}}
 */
const _normalizeAmounts = (raw, base) => {
  const values = {};
  let moneyTouched = false;
  for (const k of MONEY_FIELDS) {
    if (raw[k] != null) {
      moneyTouched = true;
      const n = Number(raw[k]);
      if (!Number.isFinite(n)) throw new BusinessError('VALIDATION_ERROR', `${k} 必须是数字`);
      if (n < 0) throw new BusinessError('VALIDATION_ERROR', `${k} 不能为负数`);
      if (n > MAX_AMOUNT) throw new BusinessError('VALIDATION_ERROR', `${k} 超出允许上限`);
      values[k] = round2(n);
    } else if (base) {
      values[k] = round2(Number(base[k] || 0));
    }
  }

  // 明细：单价/小计非负，小计缺省=数量×单价
  let itemsTotal = null;
  if (Array.isArray(raw.items)) {
    moneyTouched = true;
    itemsTotal = 0;
    for (const it of raw.items) {
      const qty = Number(it.quantity) || 1;
      const unit = it.unitPrice != null ? Number(it.unitPrice) : 0;
      const sub = it.subtotal != null ? Number(it.subtotal) : qty * unit;
      if (!Number.isFinite(unit) || unit < 0) throw new BusinessError('VALIDATION_ERROR', '明细单价不能为负数');
      if (!Number.isFinite(sub) || sub < 0) throw new BusinessError('VALIDATION_ERROR', '明细小计不能为负数');
      if (sub > MAX_AMOUNT) throw new BusinessError('VALIDATION_ERROR', '明细小计超出允许上限');
      itemsTotal += round2(sub);
    }
    itemsTotal = round2(itemsTotal);
  }

  if (!moneyTouched) return { values, moneyTouched, itemsTotal };

  // create 时未提供总额但有明细：以明细汇总为总额
  if (!base && values.totalAmount == null && itemsTotal != null) values.totalAmount = itemsTotal;

  const total = values.totalAmount != null ? values.totalAmount : round2(base ? Number(base.totalAmount || 0) : 0);
  const discount = values.discountAmount != null ? values.discountAmount : round2(base ? Number(base.discountAmount || 0) : 0);
  const curFinalBase = base ? Number(base.finalAmount || 0) : null;
  let final = values.finalAmount != null ? values.finalAmount : curFinalBase;

  if (discount > total + 0.001) {
    throw new BusinessError('VALIDATION_ERROR', `优惠金额(${discount})不能大于订单总额(${total})`);
  }
  // 未显式给应付金额：默认 总额-优惠
  if (final == null) final = round2(Math.max(0, total - discount));
  values.finalAmount = round2(final);
  if (values.finalAmount < 0) throw new BusinessError('VALIDATION_ERROR', '应付金额不能为负数');
  if (values.finalAmount > total + 0.001) {
    throw new BusinessError('VALIDATION_ERROR', `应付金额(${values.finalAmount})不能大于订单总额(${total})`);
  }
  if (values.finalAmount + discount - total > 0.01) {
    throw new BusinessError(
      'VALIDATION_ERROR',
      `优惠金额(${discount})+应付金额(${values.finalAmount})不能大于订单总额(${total})`
    );
  }

  const deposit = values.depositAmount != null ? values.depositAmount : round2(base ? Number(base.depositAmount || 0) : 0);
  const paid = values.paidAmount != null ? values.paidAmount : round2(base ? Number(base.paidAmount || 0) : 0);
  values.depositAmount = deposit;
  values.paidAmount = paid;
  if (deposit - values.finalAmount > 0.001) {
    throw new BusinessError('VALIDATION_ERROR', `定金(${deposit})不能大于应付金额(${values.finalAmount})`);
  }
  if (paid - values.finalAmount > 0.001) {
    throw new BusinessError('VALIDATION_ERROR', `已付金额(${paid})不能大于应付金额(${values.finalAmount})，多收款项请走退款/预收流程`);
  }
  return { values, moneyTouched, itemsTotal };
};

/** 明细落库映射（单价/小计已在 _normalizeAmounts 校验，此处做缺省补算） */
const _mapOrderItems = (items, orderId) =>
  items.map(it => {
    const qty = Number(it.quantity) || 1;
    const unit = it.unitPrice != null ? round2(Number(it.unitPrice)) : 0;
    const sub = it.subtotal != null ? round2(Number(it.subtotal)) : round2(qty * unit);
    return {
      id: idByCtx('orderItem', 12, nanoid),
      orderId,
      itemType: it.itemType || 'performance',
      playId: it.playId || null,
      itemName: it.itemName || '演出服务',
      quantity: qty,
      unitPrice: unit,
      subtotal: sub,
      performanceDate: it.performanceDate ? new Date(it.performanceDate) : null,
      remark: it.remark || null,
      ts: BigInt(nowMs())
    };
  });


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

  // 金额服务端归一化 + 勾稽校验（非负/折扣/应付/已付上限），先于任何写操作
  const { values: amt } = _normalizeAmounts(b, null);
  const totalAmount = amt.totalAmount != null ? amt.totalAmount : 0;
  const discountAmount = amt.discountAmount != null ? amt.discountAmount : 0;
  const finalAmount = amt.finalAmount != null ? amt.finalAmount : totalAmount;
  const depositAmount = amt.depositAmount != null ? amt.depositAmount : 0;
  const paidAmount = amt.paidAmount != null ? amt.paidAmount : 0;

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
      totalAmount,
      discountAmount,
      finalAmount,
      depositAmount,
      paidAmount,
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
    await prisma.orderItem.createMany({ data: _mapOrderItems(b.items, row.id) });
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

  // 金额服务端归一化 + 与存量值合并勾稽（任何金额字段或明细变更都触发）
  const { values: amt, moneyTouched } = _normalizeAmounts(b, old);

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
  if (moneyTouched) {
    MONEY_FIELDS.forEach(k => {
      if (amt[k] != null) patch[k] = amt[k];
    });
  }
  if (b.performanceCount != null) patch.performanceCount = Number(b.performanceCount);
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
      await prisma.orderItem.createMany({ data: _mapOrderItems(b.items, id) });
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
