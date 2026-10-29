/* orders/helpers.js — 常量和内部工具函数（自 orders.js 拆分） */
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
const { success, created, noContent } = require('../../utils/response');
const { idByCtx, nowMs } = require('../../config');
const { BusinessError } = require('../../middleware/error-handler');
const { audit } = require('../../services/audit-service');
const { syncOrderPayments } = require('../../services/order-payment-sync');

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

// v20261003 P3-10：单号/凭证号时间戳固定按东八区生成，不依赖服务器时区设置

const _cnStamp = () => {
  const d = new Date(Date.now() + 8 * 3600 * 1000);
  const p = n => String(n).padStart(2, '0');
  return (
    d.getUTCFullYear() +
    p(d.getUTCMonth() + 1) +
    p(d.getUTCDate()) +
    p(d.getUTCHours()) +
    p(d.getUTCMinutes())
  );
};

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
  // v20261003 P3-10：固定东八区
  const d = new Date(Date.now() + 8 * 3600 * 1000);
  const pad = n => String(n).padStart(2, '0');
  return (
    'ORD' +
    String(d.getUTCFullYear()).slice(2) +
    pad(d.getUTCMonth() + 1) +
    pad(d.getUTCDate()) +
    pad(d.getUTCHours()) +
    pad(d.getUTCMinutes()) +
    nanoid(4).toUpperCase()
  );
};

// 订单→档期自动关联（2026-09-08）：有演出日期的订单自动生成/同步一条排期（幂等，失败不影响订单主流程）

const _syncOrderSchedules = async order => {
  try {
    if (!order || !order.performanceStartDate) return null;
    // v20261003 P3-10：演出起止固定按东八区时刻构造（夜场19:30=UTC11:30；当晚23:59=UTC15:59），
    // 不再用 setHours 依赖服务器本地时区（performanceStartDate 为 UTC 午夜的日期串）
    const psd = new Date(order.performanceStartDate);
    const start = new Date(Date.UTC(psd.getUTCFullYear(), psd.getUTCMonth(), psd.getUTCDate(), 11, 30, 0));
    let endBase = order.performanceEndDate ? new Date(order.performanceEndDate) : null;
    if (!endBase && order.performanceCount && Number(order.performanceCount) > 1) {
      endBase = new Date(Date.UTC(psd.getUTCFullYear(), psd.getUTCMonth(), psd.getUTCDate() + Number(order.performanceCount) - 1));
    }
    if (!endBase) endBase = new Date(Date.UTC(psd.getUTCFullYear(), psd.getUTCMonth(), psd.getUTCDate()));
    const end = new Date(Date.UTC(endBase.getUTCFullYear(), endBase.getUTCMonth(), endBase.getUTCDate(), 15, 59, 0));
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

/**
 * 订单收款 → 财务凭证联动（失败隔离，不阻断订单主流程；内部增量对账，重复调用幂等）
 */

const _DISPATCH_CATEGORY = {
  sheng: '主演', dan: '主演',
  jing: '配角', chou: '配角', erjia: '配角',
  juezi: '龙套',
  houqin: '舞美',
  wuchang: '乐队', wenchang: '乐队'
};

const _syncDispatchToCastSheet = async order => {
  try {
    if (!order || !order.internalRemark) return null;
    let disp;
    try { disp = JSON.parse(order.internalRemark); } catch (_) { return null; }
    if (!disp || disp.type !== 'dispatch' || !Array.isArray(disp.people)) return null;

    const sched = await prisma.scheduleV2.findFirst({
      where: { orderId: order.id },
      orderBy: { scheduleDateStart: 'asc' }
    });
    if (!sched) return 'NO_SCHEDULE';

    // v20261011 performerId 打通：落库 CastSheetCrew.performerId。
    // 优先用前端携带的档案 id（候选来自 /v1/performers）；无携带时按姓名批量解析兜底
    // （同名多条记录不落 id，防止串人；口径排除软删除，兼容历史派工单补建场景）
    let byName = new Map();
    try {
      const _names = Array.from(new Set(disp.people.map(p => String(p.name || '').trim()).filter(Boolean)));
      if (_names.length) {
        const pfRows = await prisma.performersDbV1.findMany({
          where: { name: { in: _names }, status: { not: 'deleted' } },
          select: { id: true, name: true }
        });
        const cnt = new Map();
        pfRows.forEach(r => cnt.set(r.name, (cnt.get(r.name) || 0) + 1));
        pfRows.forEach(r => { if (cnt.get(r.name) === 1) byName.set(r.name, r.id); });
      }
    } catch (_) { /* 解析失败不阻断派工单同步 */ }

    const crewData = disp.people.map((p, idx) => {
      const nm = String(p.name || '').trim();
      return {
        id: idByCtx('castCrew', 12, nanoid),
        performerId: (p.performerId && String(p.performerId)) || byName.get(nm) || null,
        performerName: String(p.name || ''),
        category: _DISPATCH_CATEGORY[p.group] || '龙套',
        roleName: p.role || null,
        sortOrder: idx,
        note: p.note || null,
        ts: BigInt(nowMs())
      };
    });
    const base = {
      playTitle: order.orderType || null,
      performanceDate: sched.scheduleDateStart,
      performanceTime: '夜场',
      venueFull: order.venueFullAddress || null,
      crewNote: disp.remark || null
    };
    const existing = await prisma.castSheetsV1.findFirst({
      where: { scheduleId: sched.id },
      orderBy: { createdAt: 'desc' }
    });
    if (existing) {
      await prisma.castSheetCrew.deleteMany({ where: { castSheetId: existing.id } });
      await prisma.castSheetsV1.update({
        where: { id: existing.id },
        data: { ...base, versionNumber: { increment: 1 }, updatedAt: new Date(), ts: BigInt(nowMs()) }
      });
      if (crewData.length) {
        crewData.forEach(c => { c.castSheetId = existing.id; });
        await prisma.castSheetCrew.createMany({ data: crewData });
      }
      return 'UPDATED';
    }
    const sheetId = idByCtx('castSheet', 12, nanoid);
    await prisma.castSheetsV1.create({
      data: {
        id: sheetId,
        sheetNo: 'CS' + _cnStamp() + nanoid(4).toUpperCase().replace(/[^0-9A-Z]/g, '0'),
        scheduleId: sched.id,
        status: 'draft',
        createdBy: order.createdBy || 'system',
        ts: BigInt(nowMs()),
        ...base
      }
    });
    if (crewData.length) {
      crewData.forEach(c => { c.castSheetId = sheetId; });
      await prisma.castSheetCrew.createMany({ data: crewData });
    }
    return 'CREATED';
  } catch (e) {
    console.error('[orders.syncDispatchToCastSheet] fail:', e && e.message);
    return null;
  }
};


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

// v20261029b 演出结束自动完结：performance 状态且演出结束日期已过（< 今天 0 点）→ completed
// 修复「演出已结束，订单状态还在演出中」：此前状态机只能人工推进，演出结束后无自动流转。
// 触发点：GET /orders 列表 / /orders/stats / /orders/:id 详情前惰性执行（幂等；无过期单时仅一次索引查询）。
// completedDate 取演出结束日（业务口径准确）；逐单 try/catch，单单失败不影响其余（下次访问重试）。
const _SYS_AUDIT_CTX = { state: { user: { sub: 'system', username: 'system', realName: '系统自动完结' } }, ip: null, get: () => '' };
const autoCompleteExpiredOrders = async () => {
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  const expired = await prisma.order.findMany({
    where: { status: 'performance', performanceEndDate: { lt: startOfToday } },
    select: { id: true, orderNo: true, performanceEndDate: true }
  });
  let completed = 0;
  for (const o of expired) {
    try {
      const row = await prisma.order.update({
        where: { id: o.id },
        data: {
          status: 'completed',
          completedDate: o.performanceEndDate || new Date(),
          ts: BigInt(nowMs())
        }
      });
      // 与人工 transition 口径一致：完成后同步排期状态
      await _syncOrderSchedules(row);
      await audit({ ctx: _SYS_AUDIT_CTX, module: 'order', action: 'ORDER_AUTO_COMPLETE', targetId: o.id, detail: { orderNo: o.orderNo, performanceEndDate: o.performanceEndDate } });
      completed++;
    } catch (_) { /* 单单失败跳过，下次访问重试 */ }
  }
  return { expired: expired.length, completed };
};

module.exports = {
  _checkFlow,
  MONEY_FIELDS,
  MAX_AMOUNT,
  round2,
  _cnStamp,
  _normalizeAmounts,
  _mapOrderItems,
  _genOrderNo,
  _syncOrderSchedules,
  _DISPATCH_CATEGORY,
  _syncDispatchToCastSheet,
  STATUS_FLOW,
  autoCompleteExpiredOrders,
};
