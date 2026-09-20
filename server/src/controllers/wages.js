'use strict';

/**
 * src/controllers/wages.js —— 工资条管理 CRUD
 * 数据表：WageItemsV1 + WageBatchesV1 + WageRulesV1（prisma schema 已定义）
 *
 * 无底薪工资：baseWage = WageRulesV1.baseDailyStandard × attendanceDays
 * 4 项细分扣款编码到 otherDeduction + otherDeductionNote JSON：{"leave":50,"absent":100,"late":10,"early":0}
 *
 * GET    /v1/wages              列表（分页+keyword+month+batchId+performerId+staffNo）
 * GET    /v1/wages/:id          详情（含 batch 关联）
 * POST   /v1/wages              新建（自动计算 baseWage 如未显式传入）
 * PATCH  /v1/wages/:id          修改
 * DELETE /v1/wages/:id          删除
 * GET    /v1/wage-batches       批次列表
 * POST   /v1/wage-batches       新建批次
 * POST   /v1/wage-batches/:id/confirm  批次确认
 * POST   /v1/wage-batches/:id/post     批次过账
 * GET    /v1/wage-rules        规则列表
 * GET    /v1/wage-rules/:rankGrade  规则详情
 */
const { nanoid } = require('nanoid');
const prisma = require('../utils/prisma');
const { success, created, pageMeta, noContent } = require('../utils/response');
const { idByCtx, nowMs } = require('../config');
const { BusinessError } = require('../middleware/error-handler');
const { audit } = require('../services/audit-service');

// ========== 工具：DB WageItemsV1 + 关联 -> 前端 renderWage 期望字段 ==========
function toApi(row, batch) {
  if (!row) return null;
  // 解码 otherDeductionNote 中编码的细分扣款（JSON: {leave,absent,late,early}）
  var breakdown = { leave: 0, absent: 0, late: 0, early: 0 };
  try {
    if (row.otherDeductionNote) {
      var parsed = JSON.parse(row.otherDeductionNote);
      if (parsed && typeof parsed === 'object') {
        breakdown.leave = Number(parsed.leave) || 0;
        breakdown.absent = Number(parsed.absent) || 0;
        breakdown.late = Number(parsed.late) || 0;
        breakdown.early = Number(parsed.early) || 0;
      }
    }
  } catch (_) {}

  // nights: 夜场数
  // 推算优先级：_nightCount（DB 加的临时字段）> otherAllowanceNote 中的 nightCount > nightShowBonus/单价反推 > 0
  var nights = 0;
  if (row._nightCount !== undefined) {
    nights = Number(row._nightCount) || 0;
  } else {
    // 1. 从 otherAllowanceNote JSON 解码 nightCount（seed-wages.js 存入）
    try {
      if (row.otherAllowanceNote) {
        var noteParsed = JSON.parse(row.otherAllowanceNote);
        if (noteParsed && typeof noteParsed === 'object' && noteParsed.nightCount !== undefined) {
          nights = Number(noteParsed.nightCount) || 0;
        }
      }
    } catch (_) {}
    // 2. 兜底：nightShowBonus 金额 / WageRulesV1.nightShowBonus 单价反推（A+ = 200, A = 150, B = 100, C = 60）
    if (nights === 0 && Number(row.nightShowBonus) > 0) {
      var unitPrice = 0;
      var grade = row.rankGrade;
      if (grade === 'A+') unitPrice = 200;
      else if (grade === 'A') unitPrice = 150;
      else if (grade === 'B') unitPrice = 100;
      else if (grade === 'C') unitPrice = 60;
      if (unitPrice > 0) nights = Math.round(Number(row.nightShowBonus) / unitPrice);
    }
  }

  var fullBonus = Number(row.fullAttendanceBonus) || 0;
  var socialSecurity = (Number(row.socialInsuranceDeduct) || 0) + (Number(row.housingFundDeduct) || 0);
  return {
    id: row.id,
    batchId: row.batchId,
    month: batch && batch.wageMonth ? batch.wageMonth : '',
    batchNo: batch && batch.batchNo ? batch.batchNo : '',
    batchStatus: batch && batch.status ? batch.status : 'draft',
    performerId: row.performerId || '',
    name: row.performerName || '',
    staffNo: row.staffNo || '',
    role: row.rankGrade || '',
    rankGrade: row.rankGrade || '',
    attDays: row.attendanceDays ? Number(row.attendanceDays) : 0,
    nights: nights,
    baseSalary: Number(row.baseWage) || 0,
    fullBonus: fullBonus,
    nightSubsidy: Number(row.nightShowBonus) || 0,
    holidayBonus: Number(row.holidayBonus) || 0,
    transportAllowance: Number(row.transportAllowance) || 0,
    mealAllowance: Number(row.mealAllowance) || 0,
    performanceBonus: Number(row.performanceBonus) || 0,
    chiefRoleTotal: Number(row.chiefRoleTotal) || 0,
    supportingRoleTotal: Number(row.supportingRoleTotal) || 0,
    otherAllowance: Number(row.otherAllowance) || 0,
    otherAllowanceNote: row.otherAllowanceNote || '',
    leaveDeduction: breakdown.leave,
    absentDeduction: breakdown.absent,
    lateDeduction: breakdown.late,
    earlyDeduction: breakdown.early,
    otherDeduction: Number(row.otherDeduction) || 0,
    otherDeductionNote: row.otherDeductionNote || '',
    socialSecurity: socialSecurity,
    housingFund: Number(row.housingFundDeduct) || 0,
    tax: Number(row.taxDeduct) || 0,
    grossPay: Number(row.grossPay) || 0,
    totalDeduction: Number(row.totalDeduction) || 0,
    netPay: Number(row.netPay) || 0,
    isFull: fullBonus > 0 ? 1 : 0,
    payslipPublished: row.payslipPublished ? 1 : 0,
    payslipPublishedAt: row.payslipPublishedAt ? new Date(row.payslipPublishedAt).toISOString() : '',
    remark: row.remark || '',
    createdAt: row.createdAt ? new Date(row.createdAt).toISOString() : '',
    updatedAt: row.updatedAt ? new Date(row.updatedAt).toISOString() : ''
  };
}

function _batchToApi(row) {
  if (!row) return null;
  return {
    id: row.id,
    batchNo: row.batchNo,
    wageMonth: row.wageMonth,
    status: row.status || 'draft',
    performanceCount: row.performanceCount || 0,
    totalPerformers: row.totalPerformers || 0,
    totalBaseWage: Number(row.totalBaseWage) || 0,
    totalAllowance: Number(row.totalAllowance) || 0,
    totalBonus: Number(row.totalBonus) || 0,
    totalDeduction: Number(row.totalDeduction) || 0,
    totalNetPay: Number(row.totalNetPay) || 0,
    confirmedBy: row.confirmedBy || '',
    confirmedAt: row.confirmedAt ? new Date(row.confirmedAt).toISOString() : '',
    postedToLedger: !!row.postedToLedger,
    postedAt: row.postedAt ? new Date(row.postedAt).toISOString() : '',
    createdBy: row.createdBy || '',
    createdAt: row.createdAt ? new Date(row.createdAt).toISOString() : '',
    updatedAt: row.updatedAt ? new Date(row.updatedAt).toISOString() : ''
  };
}

function _ruleToApi(row) {
  if (!row) return null;
  return {
    id: row.id,
    rankGrade: row.rankGrade,
    baseDailyStandard: Number(row.baseDailyStandard) || 0,
    chiefRoleAllowance: Number(row.chiefRoleAllowance) || 0,
    supportingRoleBase: Number(row.supportingRoleBase) || 0,
    ensembleBase: Number(row.ensembleBase) || 0,
    crewBandBase: Number(row.crewBandBase) || 0,
    techDancerBase: Number(row.techDancerBase) || 0,
    nightShowBonus: Number(row.nightShowBonus) || 0,
    holidayMultiplier: Number(row.holidayMultiplier) || 1.0,
    transportAllowance: Number(row.transportAllowance) || 0,
    mealAllowance: Number(row.mealAllowance) || 0,
    fullAttendanceBonus: Number(row.fullAttendanceBonus) || 0,
    performanceBonusRate: Number(row.performanceBonusRate) || 0,
    effectiveFromDate: row.effectiveFromDate ? new Date(row.effectiveFromDate).toISOString().substring(0, 10) : '',
    effectiveToDate: row.effectiveToDate ? new Date(row.effectiveToDate).toISOString().substring(0, 10) : '',
    status: row.status || 'active',
    createdAt: row.createdAt ? new Date(row.createdAt).toISOString() : '',
    updatedAt: row.updatedAt ? new Date(row.updatedAt).toISOString() : ''
  };
}

// ========== 工资条项 ==========
const list = async ctx => {
  const { skip, take, page, pageSize } = pageMeta(ctx.query.page, ctx.query.pageSize, 0);
  const where = {};
  if (ctx.query.batchId) where.batchId = ctx.query.batchId;
  if (ctx.query.performerId) where.performerId = ctx.query.performerId;
  if (ctx.query.staffNo) where.staffNo = ctx.query.staffNo;
  const kw = (ctx.query.keyword || '').trim();
  if (kw) where.performerName = { contains: kw };
  if (ctx.query.month) {
    const batches = await prisma.wageBatchesV1.findMany({
      where: { wageMonth: ctx.query.month },
      select: { id: true }
    });
    where.batchId = { in: batches.map(b => b.id) };
  }
  const [rows, total] = await Promise.all([
    prisma.wageItemsV1.findMany({
      where, skip, take,
      orderBy: { createdAt: 'desc' },
      include: { batch: true }
    }),
    prisma.wageItemsV1.count({ where })
  ]);
  return success(ctx, rows.map(r => toApi(r, r.batch)), { ...pageMeta(page, pageSize, total), total });
};

const detail = async ctx => {
  const row = await prisma.wageItemsV1.findUnique({
    where: { id: ctx.params.id },
    include: { batch: true }
  });
  if (!row) throw new BusinessError('NOT_FOUND', '工资条不存在');
  return success(ctx, toApi(row, row.batch));
};

const create = async ctx => {
  const b = ctx.request.body;
  if (!b.batchId) throw new BusinessError('VALIDATION_ERROR', 'batchId 必填');
  // 允许仅传 performerId：先查演员回填姓名/工号/职级/协议天工资，再校验姓名
  var perf = null;
  if (b.performerId) {
    perf = await prisma.performersDbV1.findUnique({
      where: { id: b.performerId },
      select: { dailyRate: true, rankGrade: true, staffNo: true, name: true }
    });
  }
  const performerName = b.performerName || (perf ? perf.name : '') || '';
  if (!performerName) throw new BusinessError('VALIDATION_ERROR', 'performerName 必填');
  // 编码 4 项细分扣款到 otherDeduction + otherDeductionNote
  var breakdown = {
    leave: Number(b.leaveDeduction) || 0,
    absent: Number(b.absentDeduction) || 0,
    late: Number(b.lateDeduction) || 0,
    early: Number(b.earlyDeduction) || 0
  };
  var otherDeduction = breakdown.leave + breakdown.absent + breakdown.late + breakdown.early;
  var otherDeductionNote = JSON.stringify(breakdown);

  // 无底薪计算（未显式传 baseWage 时自动算），取价优先级：
  // 1) 本人协议天工资 performers.dailyRate × 出勤天数（扫码入职协议薪酬，逐人约定）
  // 2) 职级工资标准 WageRulesV1.baseDailyStandard × 出勤天数
  var baseWage = 0;
  var attDaysNum = b.attDays ? Number(b.attDays) : (b.attendanceDays ? Number(b.attendanceDays) : 0);
  var perfDailyRate = perf && perf.dailyRate != null ? Number(perf.dailyRate) : null;
  var perfRank = b.rankGrade || (perf && perf.rankGrade) || null;
  if (b.baseWage !== undefined) {
    baseWage = Number(b.baseWage);
  } else if (attDaysNum) {
    if (perfDailyRate != null && perfDailyRate > 0) {
      baseWage = Math.round(perfDailyRate * attDaysNum * 100) / 100;
    } else if (perfRank) {
      var rule = await prisma.wageRulesV1.findUnique({ where: { rankGrade: perfRank } });
      if (rule) baseWage = Number(rule.baseDailyStandard) * attDaysNum;
    }
  }
  if (b.baseSalary !== undefined) baseWage = Number(b.baseSalary);

  const data = {
    id: b.id || idByCtx('wage', 12, nanoid),
    batchId: b.batchId,
    performerId: b.performerId || null,
    performerName: performerName,
    staffNo: b.staffNo || (perf ? perf.staffNo : null),
    rankGrade: perfRank || null,
    attendanceDays: b.attDays ? Number(b.attDays) : (b.attendanceDays ? Number(b.attendanceDays) : null),
    baseWage: baseWage,
    chiefRoleTotal: Number(b.chiefRoleTotal) || 0,
    supportingRoleTotal: Number(b.supportingRoleTotal) || 0,
    nightShowBonus: Number(b.nightSubsidy) || Number(b.nightShowBonus) || 0,
    holidayBonus: Number(b.holidayBonus) || 0,
    transportAllowance: Number(b.transportAllowance) || 0,
    mealAllowance: Number(b.mealAllowance) || 0,
    fullAttendanceBonus: Number(b.fullBonus) || Number(b.fullAttendanceBonus) || 0,
    performanceBonus: Number(b.performanceBonus) || 0,
    otherAllowance: Number(b.otherAllowance) || 0,
    otherAllowanceNote: b.otherAllowanceNote || null,
    socialInsuranceDeduct: Number(b.socialSecurity) || Number(b.socialInsuranceDeduct) || 0,
    housingFundDeduct: Number(b.housingFund) || Number(b.housingFundDeduct) || 0,
    taxDeduct: Number(b.tax) || Number(b.taxDeduct) || 0,
    otherDeduction: otherDeduction,
    otherDeductionNote: otherDeductionNote,
    grossPay: Number(b.grossPay) || 0,
    totalDeduction: Number(b.totalDeduction) || 0,
    netPay: Number(b.netPay) || 0,
    payslipPublished: !!b.payslipPublished,
    payslipPublishedAt: b.payslipPublished ? new Date() : null,
    remark: b.remark || null,
    ts: BigInt(nowMs())
  };
  const row = await prisma.wageItemsV1.create({ data });
  try { await audit(ctx, 'wages:create', row.id, { performerName: row.performerName, netPay: row.netPay.toString() }); } catch (_) {}
  return created(ctx, toApi(row));
};

const update = async ctx => {
  const b = ctx.request.body;
  const exists = await prisma.wageItemsV1.findUnique({ where: { id: ctx.params.id } });
  if (!exists) throw new BusinessError('NOT_FOUND', '工资条不存在');
  const data = {};
  ['performerName', 'staffNo', 'rankGrade', 'performerId', 'remark'].forEach(k => {
    if (b[k] !== undefined) data[k] = b[k];
  });
  if (b.attDays !== undefined) data.attendanceDays = Number(b.attDays);
  if (b.attendanceDays !== undefined) data.attendanceDays = Number(b.attendanceDays);
  if (b.baseWage !== undefined) data.baseWage = Number(b.baseWage);
  if (b.baseSalary !== undefined) data.baseWage = Number(b.baseSalary);
  if (b.fullBonus !== undefined) data.fullAttendanceBonus = Number(b.fullBonus);
  if (b.fullAttendanceBonus !== undefined) data.fullAttendanceBonus = Number(b.fullAttendanceBonus);
  if (b.nightSubsidy !== undefined) data.nightShowBonus = Number(b.nightSubsidy);
  if (b.nightShowBonus !== undefined) data.nightShowBonus = Number(b.nightShowBonus);
  if (b.holidayBonus !== undefined) data.holidayBonus = Number(b.holidayBonus);
  if (b.transportAllowance !== undefined) data.transportAllowance = Number(b.transportAllowance);
  if (b.mealAllowance !== undefined) data.mealAllowance = Number(b.mealAllowance);
  if (b.performanceBonus !== undefined) data.performanceBonus = Number(b.performanceBonus);
  if (b.chiefRoleTotal !== undefined) data.chiefRoleTotal = Number(b.chiefRoleTotal);
  if (b.supportingRoleTotal !== undefined) data.supportingRoleTotal = Number(b.supportingRoleTotal);
  if (b.otherAllowance !== undefined) data.otherAllowance = Number(b.otherAllowance);
  if (b.otherAllowanceNote !== undefined) data.otherAllowanceNote = b.otherAllowanceNote;
  if (b.socialSecurity !== undefined) data.socialInsuranceDeduct = Number(b.socialSecurity);
  if (b.socialInsuranceDeduct !== undefined) data.socialInsuranceDeduct = Number(b.socialInsuranceDeduct);
  if (b.housingFund !== undefined) data.housingFundDeduct = Number(b.housingFund);
  if (b.housingFundDeduct !== undefined) data.housingFundDeduct = Number(b.housingFundDeduct);
  if (b.tax !== undefined) data.taxDeduct = Number(b.tax);
  if (b.taxDeduct !== undefined) data.taxDeduct = Number(b.taxDeduct);
  if (b.grossPay !== undefined) data.grossPay = Number(b.grossPay);
  if (b.totalDeduction !== undefined) data.totalDeduction = Number(b.totalDeduction);
  if (b.netPay !== undefined) data.netPay = Number(b.netPay);
  if (b.payslipPublished !== undefined) {
    data.payslipPublished = !!b.payslipPublished;
    data.payslipPublishedAt = b.payslipPublished ? new Date() : null;
  }
  // 4 项细分扣款合并编码
  if (b.leaveDeduction !== undefined || b.absentDeduction !== undefined || b.lateDeduction !== undefined || b.earlyDeduction !== undefined) {
    var prev = { leave: 0, absent: 0, late: 0, early: 0 };
    try { if (exists.otherDeductionNote) prev = JSON.parse(exists.otherDeductionNote); } catch (_) {}
    if (b.leaveDeduction !== undefined) prev.leave = Number(b.leaveDeduction);
    if (b.absentDeduction !== undefined) prev.absent = Number(b.absentDeduction);
    if (b.lateDeduction !== undefined) prev.late = Number(b.lateDeduction);
    if (b.earlyDeduction !== undefined) prev.early = Number(b.earlyDeduction);
    data.otherDeduction = prev.leave + prev.absent + prev.late + prev.early;
    data.otherDeductionNote = JSON.stringify(prev);
  }
  data.ts = BigInt(nowMs());
  const row = await prisma.wageItemsV1.update({ where: { id: ctx.params.id }, data });
  try { await audit(ctx, 'wages:update', row.id, data); } catch (_) {}
  return success(ctx, toApi(row));
};

const remove = async ctx => {
  const row = await prisma.wageItemsV1.delete({ where: { id: ctx.params.id } });
  try { await audit(ctx, 'wages:delete', ctx.params.id, { performerName: row.performerName }); } catch (_) {}
  return noContent(ctx);
};

// ========== 工资批次（WageBatchesV1） ==========
const batchList = async ctx => {
  const { skip, take, page, pageSize } = pageMeta(ctx.query.page, ctx.query.pageSize, 0);
  const where = {};
  if (ctx.query.month) where.wageMonth = ctx.query.month;
  if (ctx.query.status) where.status = ctx.query.status;
  const [rows, total] = await Promise.all([
    prisma.wageBatchesV1.findMany({ where, skip, take, orderBy: { createdAt: 'desc' } }),
    prisma.wageBatchesV1.count({ where })
  ]);
  return success(ctx, rows.map(_batchToApi), { ...pageMeta(page, pageSize, total), total });
};

const batchCreate = async ctx => {
  const b = ctx.request.body;
  if (!b.wageMonth) throw new BusinessError('VALIDATION_ERROR', 'wageMonth 必填（YYYY-MM）');
  const batchNo = b.batchNo || ('WB-' + b.wageMonth.replace('-', '') + '-' + Date.now().toString(36).toUpperCase());
  const data = {
    id: b.id || idByCtx('wbatch', 12, nanoid),
    batchNo: batchNo,
    wageMonth: b.wageMonth,
    status: b.status || 'draft',
    performanceCount: b.performanceCount ? Number(b.performanceCount) : null,
    totalPerformers: b.totalPerformers ? Number(b.totalPerformers) : null,
    totalBaseWage: Number(b.totalBaseWage) || 0,
    totalAllowance: Number(b.totalAllowance) || 0,
    totalBonus: Number(b.totalBonus) || 0,
    totalDeduction: Number(b.totalDeduction) || 0,
    totalNetPay: Number(b.totalNetPay) || 0,
    postedToLedger: false,
    createdBy: ctx.state.user ? ctx.state.user.username : null,
    ts: BigInt(nowMs())
  };
  const row = await prisma.wageBatchesV1.create({ data });
  try { await audit(ctx, 'wages:batchCreate', row.id, { batchNo: row.batchNo, wageMonth: row.wageMonth }); } catch (_) {}
  return created(ctx, _batchToApi(row));
};

const batchConfirm = async ctx => {
  const exists = await prisma.wageBatchesV1.findUnique({ where: { id: ctx.params.id } });
  if (!exists) throw new BusinessError('NOT_FOUND', '工资批次不存在');
  if (exists.status !== 'draft') throw new BusinessError('UNPROCESSABLE', '仅 draft 状态批次可确认');
  const row = await prisma.wageBatchesV1.update({
    where: { id: ctx.params.id },
    data: {
      status: 'confirmed',
      confirmedBy: ctx.state.user ? ctx.state.user.username : null,
      confirmedAt: new Date(),
      ts: BigInt(nowMs())
    }
  });
  try { await audit(ctx, 'wages:batchConfirm', row.id, { batchNo: row.batchNo }); } catch (_) {}
  return success(ctx, _batchToApi(row));
};

const batchPost = async ctx => {
  const exists = await prisma.wageBatchesV1.findUnique({ where: { id: ctx.params.id } });
  if (!exists) throw new BusinessError('NOT_FOUND', '工资批次不存在');
  if (exists.status !== 'confirmed') throw new BusinessError('UNPROCESSABLE', '仅 confirmed 状态批次可过账');
  const row = await prisma.wageBatchesV1.update({
    where: { id: ctx.params.id },
    data: {
      status: 'posted',
      postedToLedger: true,
      postedAt: new Date(),
      ts: BigInt(nowMs())
    }
  });
  try { await audit(ctx, 'wages:batchPost', row.id, { batchNo: row.batchNo }); } catch (_) {}
  return success(ctx, _batchToApi(row));
};

// ========== 工资规则（WageRulesV1） ==========
const rulesList = async ctx => {
  const { skip, take, page, pageSize } = pageMeta(ctx.query.page, ctx.query.pageSize, 0);
  const where = {};
  if (ctx.query.status) where.status = ctx.query.status;
  const [rows, total] = await Promise.all([
    prisma.wageRulesV1.findMany({ where, skip, take, orderBy: { rankGrade: 'asc' } }),
    prisma.wageRulesV1.count({ where })
  ]);
  return success(ctx, rows.map(_ruleToApi), { ...pageMeta(page, pageSize, total), total });
};

const rulesDetail = async ctx => {
  const row = await prisma.wageRulesV1.findUnique({ where: { rankGrade: ctx.params.rankGrade } });
  if (!row) throw new BusinessError('NOT_FOUND', '工资规则不存在');
  return success(ctx, _ruleToApi(row));
};

module.exports = {
  list,
  detail,
  create,
  update,
  remove,
  batchList,
  batchCreate,
  batchConfirm,
  batchPost,
  rulesList,
  rulesDetail,
  toApi
};
