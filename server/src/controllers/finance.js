'use strict';

/**
 * src/controllers/finance.js —— 财务台账 CRUD + 月度汇总
 * GET    /v1/fin/ledger         台账列表（分页+keyword+voucherType+status+日期区间）
 * POST   /v1/fin/ledger         制单（voucherNo 自动生成）
 * GET    /v1/fin/ledger/:id     凭证详情
 * PATCH  /v1/fin/ledger/:id     修改
 * PATCH  /v1/fin/ledger/:id/void 作废（仅 checked 可作废；void=终态；留审计痕迹）
 * DELETE /v1/fin/ledger/:id     删除（仅 draft/reconciled=false 可删）
 * GET    /v1/fin/summary        月度汇总（收入/支出/分类/净利/利润率）
 *
 * 语义：creditAmount=收入（贷），debitAmount=支出（借）
 * 分类（voucherCategory）：演出收入/人员成本/道具设备/差旅杂费/其他
 */
const { nanoid } = require('nanoid');
const prisma = require('../utils/prisma');
const { success, created, noContent, parsePage, pagedSuccess } = require('../utils/response');
const { idByCtx, nowMs } = require('../config');
const { BusinessError } = require('../middleware/error-handler');
const { audit } = require('../services/audit-service');

const _genVoucherNo = () => {
  const d = new Date();
  const pad = n => String(n).padStart(2, '0');
  return (
    'LED' +
    d.getFullYear() +
    pad(d.getMonth() + 1) +
    pad(d.getDate()) +
    pad(d.getHours()) +
    pad(d.getMinutes()) +
    nanoid(4).toUpperCase()
  );
};

const list = async ctx => {
  const { skip, take, page, pageSize } = parsePage(ctx.query);
  const where = {};
  const kw = (ctx.query.keyword || '').trim();
  if (kw) {
    where.OR = [{ voucherNo: { contains: kw } }, { summary: { contains: kw } }, { offsetAccount: { contains: kw } }];
  }
  if (ctx.query.voucherType) where.voucherType = ctx.query.voucherType;
  if (ctx.query.voucherCategory) where.voucherCategory = ctx.query.voucherCategory;
  // v20261028 作废凭证（void=终态）不计入任何账目统计、不出现在任何数据展示页：
  // 列表默认始终排除 void；显式传 status 保留为审计查询入口（如 status=void 对账核查）
  if (ctx.query.status) where.status = ctx.query.status;
  else where.status = { not: 'void' };
  if (ctx.query.orderId) where.orderId = ctx.query.orderId;
  if (ctx.query.fromDate) where.voucherDate = { gte: new Date(ctx.query.fromDate) };
  if (ctx.query.toDate) {
    where.voucherDate = { ...(where.voucherDate || {}), lte: new Date(ctx.query.toDate) };
  }
  const [rows, total] = await Promise.all([
    prisma.finLedgerV1.findMany({
      where,
      skip,
      take,
      orderBy: { voucherDate: 'desc' }
    }),
    prisma.finLedgerV1.count({ where })
  ]);
  return pagedSuccess(ctx, rows, total, page, pageSize);
};

const create = async ctx => {
  const b = ctx.request.body;
  if (!b.summary) throw new BusinessError('VALIDATION_ERROR', 'summary 必填');
  const debit = Number(b.debitAmount) || 0;
  const credit = Number(b.creditAmount) || 0;
  if (debit <= 0 && credit <= 0) {
    throw new BusinessError('VALIDATION_ERROR', 'creditAmount（收入）与 debitAmount（支出）至少一项大于 0');
  }
  const row = await prisma.finLedgerV1.create({
    data: {
      id: b.id || idByCtx('ledger', 12, nanoid),
      voucherNo: b.voucherNo || _genVoucherNo(),
      voucherDate: b.voucherDate ? new Date(b.voucherDate) : new Date(),
      voucherType: b.voucherType || (credit > 0 ? 'receipt' : 'payment'),
      voucherCategory: b.voucherCategory || null,
      summary: b.summary,
      orderId: b.orderId || null,
      relatedBatchId: b.relatedBatchId || null,
      debitAmount: debit,
      creditAmount: credit,
      balanceAmount: b.balanceAmount != null ? Number(b.balanceAmount) : 0,
      offsetAccount: b.offsetAccount || null,
      cashFlowType: b.cashFlowType || null,
      cashFlowAmount: b.cashFlowAmount != null ? Number(b.cashFlowAmount) : null,
      // 安全：制单入口只允许落草稿，已复核状态必须由另一人经 PATCH 复核流转（M-15）
      status: 'draft',
      makerAccountId: ctx.state.user?.sub || null,
      madeAt: new Date(),
      doubleCheckRequired: b.doubleCheckRequired != null ? !!b.doubleCheckRequired : credit + debit >= 10000,
      remark: b.remark || null,
      createdBy: ctx.state.user?.sub || 'system',
      ts: BigInt(nowMs())
    }
  });
  await audit({
    ctx,
    module: 'finance',
    action: 'LEDGER_CREATE',
    targetId: row.id,
    detail: { no: row.voucherNo, credit, debit }
  });
  return created(ctx, row);
};

const detail = async ctx => {
  const r = await prisma.finLedgerV1.findUnique({ where: { id: ctx.params.id } });
  if (!r) throw new BusinessError('NOT_FOUND', '凭证不存在');
  return success(ctx, r);
};

const update = async ctx => {
  const id = ctx.params.id;
  const b = ctx.request.body;
  const old = await prisma.finLedgerV1.findUnique({ where: { id } });
  if (!old) throw new BusinessError('NOT_FOUND', '凭证不存在');
  if (old.isReconciled) throw new BusinessError('CONFLICT', '已对账凭证不允许修改');
  if (old.status === 'void') throw new BusinessError('CONFLICT', '已作废凭证不允许修改');

  // 复核人仅可执行"提交复核"（status=checked）这一个动作，不得借 PATCH 改任何业务字段
  if (ctx.state.user?.role === 'finance_checker') {
    const extra = Object.keys(b).filter(k => k !== 'status');
    if (b.status !== 'checked' || extra.length > 0) {
      throw new BusinessError('FORBIDDEN', '复核账号仅可提交复核，不能修改凭证内容');
    }
  }

  const patch = {};
  ['voucherType', 'voucherCategory', 'summary', 'orderId', 'offsetAccount', 'cashFlowType', 'remark'].forEach(k => {
    if (b[k] !== undefined) patch[k] = b[k];
  });
  ['debitAmount', 'creditAmount', 'balanceAmount', 'cashFlowAmount'].forEach(k => {
    if (b[k] != null) patch[k] = Number(b[k]);
  });
  if (b.voucherDate) patch.voucherDate = new Date(b.voucherDate);
  // 状态机：仅允许 draft→checked 单向流转；其他状态值/回退一律拒绝
  const LEDGER_STATUS_FLOW = ['draft', 'checked'];
  if (b.status !== undefined) {
    if (!LEDGER_STATUS_FLOW.includes(b.status)) {
      throw new BusinessError('VALIDATION_ERROR', 'status 仅允许 draft / checked');
    }
    if (b.status === 'checked' && old.status !== 'draft') {
      throw new BusinessError('CONFLICT', '仅草稿状态凭证可提交复核');
    }
    if (b.status === 'draft' && old.status === 'checked') {
      throw new BusinessError('CONFLICT', '已复核凭证不可撤回为草稿');
    }
    patch.status = b.status;
  }
  if (patch.status === 'checked') {
    patch.checkerAccountId = ctx.state.user?.sub || null;
    patch.checkedAt = new Date();
    // M-15 双角色：admin/super_admin 角色豁免（允许复核自己制单的凭证）；其他角色仍强制制单≠复核
    const M15_EXEMPT_ROLES = ['admin', 'super_admin'];
    if (!M15_EXEMPT_ROLES.includes(ctx.state.user?.role) && String(patch.checkerAccountId) === String(old.makerAccountId)) {
      throw new BusinessError('FORBIDDEN', '制单人与复核人不可为同一人（M-15 双角色）');
    }
  }
  patch.updatedAt = new Date();
  patch.ts = BigInt(nowMs());
  const row = await prisma.finLedgerV1.update({ where: { id }, data: patch });
  await audit({ ctx, module: 'finance', action: 'LEDGER_UPDATE', targetId: id, detail: Object.keys(patch) });
  return success(ctx, row);
};

const remove = async ctx => {
  const id = ctx.params.id;
  const old = await prisma.finLedgerV1.findUnique({ where: { id } });
  if (!old) throw new BusinessError('NOT_FOUND', '凭证不存在');
  if (old.isReconciled) throw new BusinessError('CONFLICT', '已对账凭证不允许删除');
  if (old.status === 'void') throw new BusinessError('CONFLICT', '已作废凭证不可删除（保留审计痕迹）');
  if (old.status !== 'draft') throw new BusinessError('CONFLICT', '仅草稿状态凭证可删除，已复核凭证须走作废流程');
  await prisma.finLedgerV1.delete({ where: { id } });
  await audit({ ctx, module: 'finance', action: 'LEDGER_DELETE', targetId: id, detail: { no: old.voucherNo } });
  return noContent(ctx);
};

/**
 * 作废凭证 PATCH /v1/fin/ledger/:id/void   body { reason }
 * 仅 super_admin/finance_admin；前置状态 checked（草稿请直接删除）；已对账不可作废。
 * 语义：status 落 'void' 终态（前端徽章「已作废」），保留凭证与 voidReason/voidedAt/voidedBy
 * 审计痕迹，不可再修改/删除；月度汇总（summary）排除 status=void，作废金额不计入收支。
 * 审计：LEDGER_VOID。
 */
const voidVoucher = async ctx => {
  const id = ctx.params.id;
  const b = ctx.request.body || {};
  const reason = String(b.reason || '').trim();
  if (reason.length < 2 || reason.length > 200) {
    throw new BusinessError('VALIDATION_ERROR', '作废原因必填（2-200 字）');
  }
  const old = await prisma.finLedgerV1.findUnique({ where: { id } });
  if (!old) throw new BusinessError('NOT_FOUND', '凭证不存在');
  if (old.isReconciled) throw new BusinessError('CONFLICT', '已对账凭证不可作废（须先取消对账）');
  if (old.status === 'void') throw new BusinessError('CONFLICT', '凭证已作废，无需重复操作');
  if (old.status !== 'checked') throw new BusinessError('CONFLICT', '仅已复核凭证可作废（草稿凭证请直接删除）');
  const row = await prisma.finLedgerV1.update({
    where: { id },
    data: {
      status: 'void',
      voidReason: reason,
      voidedAt: new Date(),
      voidedBy: ctx.state.user?.sub || null,
      updatedAt: new Date(),
      ts: BigInt(nowMs())
    }
  });
  await audit({
    ctx,
    module: 'finance',
    action: 'LEDGER_VOID',
    targetId: id,
    detail: { no: old.voucherNo, reason }
  });
  return success(ctx, row);
};

/**
 * 月度汇总 GET /v1/fin/summary?months=6
 * 返回近 N 个月：{ month, totalIncome, totalExpense, staffCost, propCost, travelCost, otherCost, netProfit, margin, orderCount }
 */
const summary = async ctx => {
  const months = Math.min(24, Math.max(1, Number(ctx.query.months) || 6));
  const start = new Date();
  start.setDate(1);
  start.setHours(0, 0, 0, 0);
  start.setMonth(start.getMonth() - (months - 1));

  const [ledgers, orderAgg] = await Promise.all([
    prisma.finLedgerV1.findMany({
      where: { voucherDate: { gte: start }, status: { not: 'void' } }, // 作废凭证不计入收支汇总
      select: { voucherDate: true, voucherCategory: true, debitAmount: true, creditAmount: true }
    }),
    prisma.order.findMany({
      where: { orderDate: { gte: start } },
      select: { orderDate: true },
      orderBy: { orderDate: 'asc' }
    })
  ]);

  const bucket = {};
  const _key = d => {
    const dt = new Date(d);
    return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}`;
  };
  for (let i = 0; i < months; i++) {
    const d = new Date(start);
    d.setMonth(d.getMonth() + i);
    const k = _key(d);
    bucket[k] = {
      month: k,
      totalIncome: 0,
      totalExpense: 0,
      staffCost: 0,
      propCost: 0,
      travelCost: 0,
      otherCost: 0,
      netProfit: 0,
      margin: 0,
      orderCount: 0
    };
  }
  ledgers.forEach(l => {
    const k = _key(l.voucherDate);
    if (!bucket[k]) return;
    bucket[k].totalIncome += Number(l.creditAmount || 0);
    bucket[k].totalExpense += Number(l.debitAmount || 0);
    const cat = l.voucherCategory || '其他';
    const amt = Number(l.debitAmount || 0);
    if (/人员|工资|薪酬|社保/.test(cat)) bucket[k].staffCost += amt;
    else if (/道具|设备|服装/.test(cat)) bucket[k].propCost += amt;
    else if (/差旅|交通|杂费|食宿/.test(cat)) bucket[k].travelCost += amt;
    else bucket[k].otherCost += amt;
  });
  for (const o of orderAgg) {
    const k = _key(o.orderDate);
    if (bucket[k]) bucket[k].orderCount += 1;
  }
  const rows = Object.values(bucket).map(r => {
    r.netProfit = r.totalIncome - r.totalExpense;
    r.margin = r.totalIncome > 0 ? Number(((r.netProfit / r.totalIncome) * 100).toFixed(1)) : 0;
    r.totalIncome = Number(r.totalIncome.toFixed(2));
    r.totalExpense = Number(r.totalExpense.toFixed(2));
    r.netProfit = Number(r.netProfit.toFixed(2));
    return r;
  });
  return success(ctx, rows);
};

// 应收账款（v20261027 recv1027）：演出收入关联订单未付金额
// 口径：有效订单（排除 cancelled/refunded/draft）的 finalAmount - paidAmount > 0
// 返回：未付清订单明细 + 合计 + 全量 orderId→unpaid 映射（供台账凭证行展示关联订单未付余额）
const receivables = async ctx => {
  const orders = await prisma.order.findMany({
    where: { status: { notIn: ['cancelled', 'refunded', 'draft'] } },
    select: {
      id: true, orderNo: true, customerName: true, status: true,
      finalAmount: true, paidAmount: true, performanceStartDate: true, performanceEndDate: true
    }
  });
  const round2 = n => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
  const unpaidByOrderId = {};
  const items = [];
  let totalUnpaid = 0;
  for (const o of orders) {
    const finalAmount = round2(o.finalAmount);
    const paidAmount = round2(o.paidAmount);
    const unpaid = round2(finalAmount - paidAmount);
    unpaidByOrderId[o.id] = unpaid;
    if (unpaid > 0.005) {
      totalUnpaid += unpaid;
      items.push({
        orderId: o.id,
        orderNo: o.orderNo,
        customerName: o.customerName,
        status: o.status,
        finalAmount,
        paidAmount,
        unpaid,
        performanceStartDate: o.performanceStartDate,
        performanceEndDate: o.performanceEndDate
      });
    }
  }
  items.sort((a, b) => b.unpaid - a.unpaid);
  return success(ctx, {
    items,
    count: items.length,
    totalUnpaid: round2(totalUnpaid),
    unpaidByOrderId
  });
};

module.exports = { list, create, detail, update, remove, voidVoucher, summary, receivables };
