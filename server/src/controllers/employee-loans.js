/* employee-loans.js — 员工借款 CRUD
 * 数据表：EmployeeLoanV1
 * 流程：员工端申请(pending) → 后台审批(approved/rejected) → 工资抵扣 → 还款(repaid)
 * 额度：已审批未还借款总额 + 本次申请 ≤ 月工资(dailyRate×21.75) × 80%
 *
 * GET    /v1/employee-loans                  后台列表
 * GET    /v1/employee-loans/mine             员工端查自己的
 * POST   /v1/employee-loans                  员工提交申请
 * POST   /v1/employee-loans/:id/approve      审批通过
 * POST   /v1/employee-loans/:id/reject       驳回
 * POST   /v1/employee-loans/:id/repay        标记还款
 * DELETE /v1/employee-loans/:id              删除
 * GET    /v1/employee-loans/summary/:performerId/:month  按月汇总未还清借款
 */
'use strict';
const { nanoid } = require('nanoid');
const prisma = require('../utils/prisma');
const { success, created, noContent } = require('../utils/response');
const { idByCtx, nowMs } = require('../config');
const { BusinessError } = require('../middleware/error-handler');
const { audit } = require('../services/audit-service');

const STANDARD_WORK_DAYS = 21.75;
const LOAN_LIMIT_RATIO = 0.8;

function _monthRange(month) {
  const y = Number(month.substring(0, 4));
  const m = Number(month.substring(5, 7));
  return [new Date(Date.UTC(y, m - 1, 1)), new Date(Date.UTC(y, m, 1))];
}

function _toApi(row) {
  if (!row) return null;
  const amount = Number(row.amount) || 0;
  const repaid = Number(row.repaidAmount) || 0;
  return {
    id: row.id,
    loanNo: row.loanNo,
    performerId: row.performerId,
    performerName: row.performerName || '',
    amount,
    repaidAmount: repaid,
    outstanding: Math.max(0, amount - repaid),
    loanDate: row.loanDate ? new Date(row.loanDate).toISOString().substring(0, 10) : '',
    reason: row.reason || '',
    status: row.status || 'pending',
    rejectReason: row.rejectReason || '',
    approvedBy: row.approvedBy || '',
    approvedAt: row.approvedAt ? new Date(row.approvedAt).toISOString() : '',
    repaidDate: row.repaidDate ? new Date(row.repaidDate).toISOString().substring(0, 10) : '',
    remark: row.remark || '',
    createdAt: row.createdAt ? new Date(row.createdAt).toISOString() : '',
    updatedAt: row.updatedAt ? new Date(row.updatedAt).toISOString() : ''
  };
}

// 计算可借额度上限：dailyRate × 21.75 × 80%
async function _calcLoanLimit(performerId) {
  const perf = await prisma.performersDbV1.findUnique({
    where: { id: performerId },
    select: { dailyRate: true, name: true }
  });
  if (!perf) return { limit: 0, name: '' };
  const dailyRate = Number(perf.dailyRate) || 0;
  const monthlyBase = dailyRate * STANDARD_WORK_DAYS;
  return { limit: monthlyBase * LOAN_LIMIT_RATIO, name: perf.name, dailyRate, monthlyBase };
}

// 已审批未还清借款总额
async function _outstandingApproved(performerId) {
  const rows = await prisma.employeeLoanV1.findMany({
    where: {
      performerId,
      status: { in: ['approved'] }
    },
    select: { amount: true, repaidAmount: true }
  });
  return rows.reduce((sum, r) => sum + Math.max(0, Number(r.amount) - Number(r.repaidAmount)), 0);
}

// 后台列表
const list = async ctx => {
  const { keyword, performerId, status, month } = ctx.query;
  const page = Math.max(1, Number(ctx.query.page) || 1);
  const pageSize = Math.min(200, Math.max(1, Number(ctx.query.pageSize) || 20));
  const where = {};
  if (performerId) where.performerId = performerId;
  if (status) where.status = status;
  if (month) {
    const [g, e] = _monthRange(month);
    where.loanDate = { gte: g, lt: e };
  }
  if (keyword) {
    where.OR = [
      { loanNo: { contains: keyword } },
      { performerName: { contains: keyword } },
      { reason: { contains: keyword } }
    ];
  }
  const [total, rows] = await Promise.all([
    prisma.employeeLoanV1.count({ where }),
    prisma.employeeLoanV1.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize
    })
  ]);
  return success(ctx, { list: rows.map(_toApi), total, page, pageSize });
};

// 员工端查自己的
const myLoans = async ctx => {
  const performerId = ctx.state?.user?.performerId || ctx.query.performerId;
  if (!performerId) throw new BusinessError('VALIDATION_ERROR', '缺少 performerId');
  const page = Math.max(1, Number(ctx.query.page) || 1);
  const pageSize = Math.min(100, Math.max(1, Number(ctx.query.pageSize) || 20));
  const [total, rows] = await Promise.all([
    prisma.employeeLoanV1.count({ where: { performerId } }),
    prisma.employeeLoanV1.findMany({
      where: { performerId },
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize
    })
  ]);
  const limitInfo = await _calcLoanLimit(performerId);
  const outstanding = await _outstandingApproved(performerId);
  return success(ctx, {
    list: rows.map(_toApi), total, page, pageSize,
    loanLimit: limitInfo.limit,
    outstanding,
    available: Math.max(0, limitInfo.limit - outstanding)
  });
};

// 员工提交申请
const create = async ctx => {
  const b = ctx.request.body;
  if (!b.performerId) throw new BusinessError('VALIDATION_ERROR', 'performerId 必填');
  if (!b.amount || Number(b.amount) <= 0) throw new BusinessError('VALIDATION_ERROR', '金额必须大于0');

  const limitInfo = await _calcLoanLimit(b.performerId);
  if (!limitInfo.name) throw new BusinessError('NOT_FOUND', '人员不存在');

  const reqAmount = Number(b.amount);
  const outstanding = await _outstandingApproved(b.performerId);
  if (outstanding + reqAmount > limitInfo.limit + 0.01) {
    throw new BusinessError('VALIDATION_ERROR',
      `借款额度不足：可借上限${limitInfo.limit.toFixed(2)}元，已借未还${outstanding.toFixed(2)}元，本次最多可借${Math.max(0, limitInfo.limit - outstanding).toFixed(2)}元`);
  }

  const loanNo = b.loanNo || ('LN-' + Date.now().toString(36).toUpperCase());
  const data = {
    id: b.id || idByCtx('ln', 12, nanoid),
    loanNo,
    performerId: b.performerId,
    performerName: limitInfo.name,
    amount: reqAmount,
    loanDate: b.loanDate ? new Date(b.loanDate + 'T00:00:00.000Z') : new Date(),
    reason: b.reason || '',
    status: 'pending',
    remark: b.remark || '',
    createdBy: ctx.state?.user?.username || 'employee',
    ts: BigInt(nowMs())
  };
  const row = await prisma.employeeLoanV1.create({ data });
  try { await audit({ ctx, module: 'employee_loan', action: 'LN_APPLY', targetId: row.id, detail: { loanNo, amount: reqAmount } }); } catch (_) {}
  return created(ctx, _toApi(row));
};

// 审批通过
const approve = async ctx => {
  const row = await prisma.employeeLoanV1.findUnique({ where: { id: ctx.params.id } });
  if (!row) throw new BusinessError('NOT_FOUND', '借款记录不存在');
  if (row.status !== 'pending') throw new BusinessError('VALIDATION_ERROR', '只有待审批状态可通过');

  const updated = await prisma.employeeLoanV1.update({
    where: { id: ctx.params.id },
    data: {
      status: 'approved',
      approvedBy: ctx.state?.user?.username || 'admin',
      approvedAt: new Date(),
      ts: BigInt(nowMs())
    }
  });
  try { await audit({ ctx, module: 'employee_loan', action: 'LN_APPROVE', targetId: row.id, detail: { loanNo: row.loanNo } }); } catch (_) {}
  return success(ctx, _toApi(updated));
};

// 驳回
const reject = async ctx => {
  const b = ctx.request.body || {};
  const row = await prisma.employeeLoanV1.findUnique({ where: { id: ctx.params.id } });
  if (!row) throw new BusinessError('NOT_FOUND', '借款记录不存在');
  if (row.status !== 'pending') throw new BusinessError('VALIDATION_ERROR', '只有待审批状态可驳回');

  const updated = await prisma.employeeLoanV1.update({
    where: { id: ctx.params.id },
    data: {
      status: 'rejected',
      rejectReason: b.reason || b.rejectReason || '',
      approvedBy: ctx.state?.user?.username || 'admin',
      approvedAt: new Date(),
      ts: BigInt(nowMs())
    }
  });
  try { await audit({ ctx, module: 'employee_loan', action: 'LN_REJECT', targetId: row.id, detail: { loanNo: row.loanNo } }); } catch (_) {}
  return success(ctx, _toApi(updated));
};

// 标记还款
const repay = async ctx => {
  const b = ctx.request.body || {};
  const row = await prisma.employeeLoanV1.findUnique({ where: { id: ctx.params.id } });
  if (!row) throw new BusinessError('NOT_FOUND', '借款记录不存在');
  if (!['approved', 'repaid'].includes(row.status)) throw new BusinessError('VALIDATION_ERROR', '只有已通过状态可还款');

  const repayAmount = b.repaidAmount != null ? Number(b.repaidAmount) : (Number(row.amount) - Number(row.repaidAmount));
  const newRepaid = Math.min(Number(row.amount), Number(row.repaidAmount) + repayAmount);
  const data = {
    repaidAmount: newRepaid,
    ts: BigInt(nowMs())
  };
  if (newRepaid >= Number(row.amount) - 0.01) {
    data.status = 'repaid';
    data.repaidDate = new Date();
  }
  const updated = await prisma.employeeLoanV1.update({ where: { id: ctx.params.id }, data });
  try { await audit({ ctx, module: 'employee_loan', action: 'LN_REPAY', targetId: row.id, detail: { loanNo: row.loanNo, repayAmount } }); } catch (_) {}
  return success(ctx, _toApi(updated));
};

// 删除
const remove = async ctx => {
  const row = await prisma.employeeLoanV1.findUnique({ where: { id: ctx.params.id } });
  if (!row) throw new BusinessError('NOT_FOUND', '借款记录不存在');
  if (row.status === 'approved' && Number(row.repaidAmount) < Number(row.amount)) {
    throw new BusinessError('VALIDATION_ERROR', '已通过且未还清的借款不可删除，请先标记还款');
  }
  await prisma.employeeLoanV1.delete({ where: { id: ctx.params.id } });
  return noContent(ctx);
};

// 按月汇总未还清借款（工资核算调用）
const summary = async ctx => {
  const { performerId, month } = ctx.params;
  if (!performerId || !month) throw new BusinessError('VALIDATION_ERROR', 'performerId 和 month 必填');
  const [g, e] = _monthRange(month);
  const rows = await prisma.employeeLoanV1.findMany({
    where: {
      performerId,
      status: 'approved',
      loanDate: { gte: g, lt: e }
    }
  });
  const total = rows.reduce((s, r) => s + Math.max(0, Number(r.amount) - Number(r.repaidAmount)), 0);
  return success(ctx, {
    performerId,
    month,
    total,
    count: rows.length,
    items: rows.map(r => ({ id: r.id, loanNo: r.loanNo, amount: Number(r.amount), repaidAmount: Number(r.repaidAmount), outstanding: Math.max(0, Number(r.amount) - Number(r.repaidAmount)) }))
  });
};

module.exports = { list, myLoans, create, approve, reject, repay, remove, summary };
