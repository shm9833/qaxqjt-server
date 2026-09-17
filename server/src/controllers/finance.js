'use strict';

/**
 * src/controllers/finance.js —— 财务台账 CRUD + 月度汇总
 * GET    /v1/fin/ledger         台账列表（分页+keyword+voucherType+status+日期区间）
 * POST   /v1/fin/ledger         制单（voucherNo 自动生成）
 * GET    /v1/fin/ledger/:id     凭证详情
 * PATCH  /v1/fin/ledger/:id     修改
 * DELETE /v1/fin/ledger/:id     删除（仅 draft/reconciled=false 可删）
 * GET    /v1/fin/summary        月度汇总（收入/支出/分类/净利/利润率）
 *
 * 语义：creditAmount=收入（贷），debitAmount=支出（借）
 * 分类（voucherCategory）：演出收入/人员成本/道具设备/差旅杂费/其他
 */
const { nanoid } = require('nanoid');
const prisma = require('../utils/prisma');
const { success, created, pageMeta, noContent } = require('../utils/response');
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
  const { skip, take, page, pageSize } = pageMeta(ctx.query.page, ctx.query.pageSize, 0);
  const where = {};
  const kw = (ctx.query.keyword || '').trim();
  if (kw) {
    where.OR = [{ voucherNo: { contains: kw } }, { summary: { contains: kw } }, { offsetAccount: { contains: kw } }];
  }
  if (ctx.query.voucherType) where.voucherType = ctx.query.voucherType;
  if (ctx.query.voucherCategory) where.voucherCategory = ctx.query.voucherCategory;
  if (ctx.query.status) where.status = ctx.query.status;
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
  return success(ctx, rows, { ...pageMeta(page, pageSize, total), total });
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
      status: b.status || 'draft',
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

  const patch = {};
  ['voucherType', 'voucherCategory', 'summary', 'orderId', 'offsetAccount', 'cashFlowType', 'status', 'remark'].forEach(k => {
    if (b[k] !== undefined) patch[k] = b[k];
  });
  ['debitAmount', 'creditAmount', 'balanceAmount', 'cashFlowAmount'].forEach(k => {
    if (b[k] != null) patch[k] = Number(b[k]);
  });
  if (b.voucherDate) patch.voucherDate = new Date(b.voucherDate);
  if (b.status === 'checked') {
    patch.checkerAccountId = ctx.state.user?.sub || null;
    patch.checkedAt = new Date();
    if (String(patch.checkerAccountId) === String(old.makerAccountId)) {
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
  await prisma.finLedgerV1.delete({ where: { id } });
  await audit({ ctx, module: 'finance', action: 'LEDGER_DELETE', targetId: id, detail: { no: old.voucherNo } });
  return noContent(ctx);
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
      where: { voucherDate: { gte: start } },
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

module.exports = { list, create, detail, update, remove, summary };
