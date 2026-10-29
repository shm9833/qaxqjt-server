/* orders/core.js — 核心 handlers（存在交叉调用，自 orders.js 拆分） */
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
const { _normalizeAmounts, _mapOrderItems, _genOrderNo, _syncOrderSchedules, _checkFlow, MONEY_FIELDS, _syncDispatchToCastSheet, round2, _cnStamp } = require('./helpers');
const { detail } = require('./independent');

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

  // 订单收款 → 收付款流水 + 台账收入凭证（建单即带已收款时；幂等，失败隔离）
  await _syncPaymentLedger(row, ctx);

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


const update = async ctx => {
  const id = ctx.params.id;
  const b = ctx.request.body;
  const old = await prisma.order.findUnique({ where: { id } });
  if (!old) throw new BusinessError('NOT_FOUND', '订单不存在');
  if (b.status && b.status !== old.status) _checkFlow(old.status, b.status);

  // v20261003 P2-4：cancelled/refunded 终态禁止变更金额/明细（否则可给已取消订单生成新收款凭证）
  if (['cancelled', 'refunded'].includes(old.status)) {
    const moneyChanged = MONEY_FIELDS.some(k => b[k] != null) || Array.isArray(b.items);
    if (moneyChanged) {
      throw new BusinessError('CONFLICT', `订单已处于「${old.status}」终态，禁止变更金额/明细；确需调整请财务红冲后重建`);
    }
  }

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

  // v20261003 P2-5：派工 JSON 自动同步到排期派工单（须在排期同步之后；幂等，失败隔离）
  await _syncDispatchToCastSheet(row);

  // 订单收款 → 收付款流水 + 台账收入凭证（paidAmount 增量自动补差；幂等，失败隔离）
  if (moneyTouched) await _syncPaymentLedger(row, ctx);

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
  // v20261003 P1-1：资金证据链保护——已收款或存在收款流水/退款单/台账凭证的订单禁止物理删除，
  // 否则收款流水被删而台账凭证（fin_ledger_v1.orderId 无外键）残留成孤儿，账实核查断裂；须先走退款/红冲流程
  const paidAmt = Number(old.paidAmount || 0);
  if (paidAmt > 0) {
    throw new BusinessError('CONFLICT', `订单已收款 ¥${paidAmt.toFixed(2)}，请先走退款/红冲流程再删除`);
  }
  const [payCnt, refundCnt, voucherCnt] = await Promise.all([
    prisma.finPaymentV1.count({ where: { orderId: id } }),
    prisma.orderRefund.count({ where: { orderId: id } }),
    prisma.finLedgerV1.count({ where: { orderId: id } })
  ]);
  if (payCnt > 0 || refundCnt > 0 || voucherCnt > 0) {
    throw new BusinessError(
      'CONFLICT',
      `订单存在资金痕迹（收款流水${payCnt}条/退款单${refundCnt}张/台账凭证${voucherCnt}张），禁止删除；请财务红冲清理后再删`
    );
  }
  await prisma.orderItem.deleteMany({ where: { orderId: id } });
  await prisma.orderRefund.deleteMany({ where: { orderId: id } });
  await prisma.finPaymentV1.deleteMany({ where: { orderId: id } });
  // v20261003 P2-3：删排期前先清其子资源（CastSheetsV1+CastSheetCrew、ScheduleVenue），
  // schema 无 onDelete:Cascade，直接删 ScheduleV2 会因外键约束抛 500
  const __scheds = await prisma.scheduleV2.findMany({ where: { orderId: id }, select: { id: true } });
  if (__scheds.length) {
    const __schedIds = __scheds.map(s => s.id);
    const __sheets = await prisma.castSheetsV1.findMany({
      where: { scheduleId: { in: __schedIds } },
      select: { id: true }
    });
    if (__sheets.length) {
      const __sheetIds = __sheets.map(s => s.id);
      await prisma.castSheetCrew.deleteMany({ where: { castSheetId: { in: __sheetIds } } });
      await prisma.castSheetsV1.deleteMany({ where: { id: { in: __sheetIds } } });
    }
    await prisma.scheduleVenue.deleteMany({ where: { scheduleId: { in: __schedIds } } });
    await prisma.scheduleV2.deleteMany({ where: { id: { in: __schedIds } } });
  }
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
  // v20261003 P3-7：退款原因不再丢弃——登记退款单（金额=订单已收余额，含原因/审批人）
  if (to === 'refunded') {
    const refundAmt = round2(Math.max(0, Number(old.paidAmount || 0)));
    if (refundAmt > 0 || (reason || '').trim()) {
      await prisma.orderRefund.create({
        data: {
          id: idByCtx('refund', 12, nanoid),
          orderId: id,
          refundNo: 'RF' + _cnStamp() + nanoid(5).toUpperCase().replace(/[^0-9A-Z]/g, '0'),
          refundDate: new Date(),
          refundChannel: 'transfer',
          amount: refundAmt,
          reason: reason || null,
          status: 'confirmed',
          approvedBy: ctx.state.user?.realName || ctx.state.user?.sub || 'system',
          ts: BigInt(nowMs())
        }
      });
    }
  }
  // 取消/完成订单时同步排期状态
  await _syncOrderSchedules(row);
  await audit({ ctx, module: 'order', action: 'ORDER_TRANSITION', targetId: id, detail: { from: old.status, to, reason: reason || null } });
  return success(ctx, row);
};

/**
 * v20261003 P3-8：收款独立登记 POST /v1/orders/:id/payments
 * 入参 { amount, payChannel, payDate, remark }：收款流水（真实渠道/日期）+ 台账收入凭证(draft) 同事务原子提交，
 * 回写订单 paidAmount 并按状态机推进 draft→confirmed→partial_paid/paid；演出/完成后补登记只写流水不改状态。
 */

const registerPayment = async ctx => {
  const id = ctx.params.id;
  const b = ctx.request.body || {};
  const old = await prisma.order.findUnique({ where: { id } });
  if (!old) throw new BusinessError('NOT_FOUND', '订单不存在');
  if (['cancelled', 'refunded'].includes(old.status)) {
    throw new BusinessError('CONFLICT', '订单已取消/退款，不能登记收款');
  }

  const amount = round2(Number(b.amount));
  if (!Number.isFinite(amount) || amount <= 0) throw new BusinessError('VALIDATION_ERROR', '收款金额必须大于 0');
  const payChannel = ['cash', 'transfer', 'wechat', 'alipay', 'cheque'].includes(b.payChannel) ? b.payChannel : 'transfer';
  const payDate = b.payDate ? new Date(b.payDate) : new Date();
  const remark = b.remark || null;

  const finalAmt = round2(Number(old.finalAmount || 0));
  const curPaid = round2(Number(old.paidAmount || 0));
  const newPaid = round2(curPaid + amount);
  if (newPaid - finalAmt > 0.001) {
    throw new BusinessError('CONFLICT', `收款后累计 ¥${newPaid} 超过应付 ¥${finalAmt}，多收款项请走预收/退款流程`);
  }

  // 状态机推进路径（仅业务前段状态自动推进；draft 须先经 confirmed）
  let targetStatus = null;
  if (['draft', 'confirmed', 'partial_paid'].includes(old.status)) {
    targetStatus = finalAmt > 0 && newPaid + 0.001 >= finalAmt ? 'paid' : 'partial_paid';
  }
  const path = [];
  if (old.status === 'draft') path.push('confirmed');
  if (targetStatus && targetStatus !== old.status) path.push(targetStatus);
  let stCur = old.status;
  for (const t of path) {
    _checkFlow(stCur, t);
    stCur = t;
  }

  const now = new Date();
  const stamp = _cnStamp();
  const payNo = 'PAY' + stamp + nanoid(6).toUpperCase().replace(/[^0-9A-Z]/g, '0');
  const voucherNo = 'LSR' + stamp + nanoid(4).toUpperCase().replace(/[^0-9A-Z]/g, '0');
  const customerName = old.customerName || '';
  const summary = '订单收款（' + old.orderNo + '）' + (customerName ? ' - ' + customerName : '');
  const actor = ctx.state.user?.sub || 'system';

  await prisma.$transaction(async tx => {
    await tx.finPaymentV1.create({
      data: {
        id: idByCtx('pay', 12, nanoid),
        orderId: id,
        payNo,
        payDate,
        payChannel,
        payType: 'in',
        amount,
        currency: 'CNY',
        payerName: customerName || null,
        voucherNo,
        status: 'confirmed',
        remark: remark || '订单收款登记（' + old.orderNo + '）',
        createdBy: actor,
        ts: BigInt(nowMs())
      }
    });
    await tx.finLedgerV1.create({
      data: {
        id: idByCtx('ledger', 12, nanoid),
        voucherNo,
        voucherDate: payDate,
        voucherType: 'receipt',
        voucherCategory: '演出收入',
        summary,
        orderId: id,
        debitAmount: 0,
        creditAmount: amount,
        balanceAmount: 0,
        cashFlowType: 'in',
        cashFlowAmount: amount,
        status: 'draft',
        makerAccountId: actor === 'system' ? null : actor,
        madeAt: now,
        doubleCheckRequired: amount >= 10000,
        isReconciled: false,
        remark: '收款登记自动生成，流水号 ' + payNo,
        createdBy: actor,
        ts: BigInt(nowMs())
      }
    });
    const orderPatch = { paidAmount: newPaid, updatedAt: new Date(), ts: BigInt(nowMs()) };
    if (path.length) orderPatch.status = path[path.length - 1];
    await tx.order.update({ where: { id }, data: orderPatch });
  });

  await audit({
    ctx,
    module: 'order',
    action: 'ORDER_PAYMENT_REGISTER',
    targetId: id,
    detail: {
      no: old.orderNo,
      amount,
      payChannel,
      payDate: payDate.toISOString(),
      to: path[path.length - 1] || old.status
    }
  });
  const result = await prisma.order.findUnique({
    where: { id },
    include: { payments: { orderBy: { payDate: 'desc' } } }
  });
  return created(ctx, result);
};


const _syncPaymentLedger = async (row, ctx) => {
  try {
    if (!row || Number(row.paidAmount || 0) <= 0) return null;
    const r = await syncOrderPayments(row, { actor: ctx.state.user?.sub || 'system' });
    if (r && r.synced === 1 && r.ledger) {
      await audit({
        ctx,
        module: 'finance',
        action: 'AUTO_LEDGER_FROM_ORDER',
        targetId: r.ledger.id,
        detail: {
          orderNo: row.orderNo,
          voucherNo: r.ledger.voucherNo,
          payNo: r.payment && r.payment.payNo,
          amount: r.diff
        }
      });
    }
    return r;
  } catch (e) {
    console.error('[orders.syncPaymentLedger] fail:', e && e.message);
    return null;
  }
};

/**
 * v20261003 P2-5：订单派工（internalRemark JSON）→ 排期派工单（CastSheetsV1+CastSheetCrew）自动同步
 * 在 _syncOrderSchedules 之后调用（确保排期已存在）；幂等：已存在派工单则 crew 整体替换 + 版本号递增。
 * 无关联排期（订单未填演出日期）时跳过；失败隔离不阻断订单主流程。
 */

module.exports = {
  create,
  update,
  remove,
  transition,
  registerPayment,
  _syncPaymentLedger,
};
