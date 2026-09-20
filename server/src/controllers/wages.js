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

// ========== 无底薪工资批量生成：baseWage = 协议天工资 × 实际出勤天数 ==========
// 实际出勤天数口径：full/night/double 各计 1 天，half 计 0.5 天（与 performers.stats 一致）
const WORK_DAY_TYPES = { full: 1, night: 1, double: 1, half: 0.5 };

async function _attendanceByStaff(month) {
  // 一次性拉取该月全部考勤，按 staffId 聚合，避免 N 次查询
  const rows = await prisma.attendanceV1.findMany({
    where: { attendanceMonth: month },
    select: { staffId: true, attendanceType: true }
  });
  const map = {};
  for (const r of rows) {
    const m = map[r.staffId] || { workDays: 0, nightShows: 0, absent: 0, leave: 0, late: 0 };
    const t = r.attendanceType;
    if (WORK_DAY_TYPES[t] != null) {
      m.workDays += WORK_DAY_TYPES[t];
      if (t === 'night') m.nightShows += 1;
    } else if (t === 'absent') m.absent += 1;
    else if (t === 'late') m.late += 1;
    else if (t === 'leave' || t === 'outing' || t === 'study' || t === 'business' || t === 'injury') m.leave += 1;
    map[r.staffId] = m;
  }
  return map;
}

function _round2(n) { return Math.round((Number(n) || 0) * 100) / 100; }

// 计算单条工资（无底薪）
// - dailyRate: 本人协议天工资（元/天），优先
// - rule: 职级工资规则（无 dailyRate 时用 rule.baseDailyStandard 兜底）
function _calcWageItem(perf, att, rule) {
  const workDays = att ? att.workDays : 0;
  const nightly = att ? att.nightShows : 0;
  const dailyRate = perf.dailyRate != null && Number(perf.dailyRate) > 0 ? Number(perf.dailyRate) : (rule ? Number(rule.baseDailyStandard) || 0 : 0);

  const baseWage = _round2(dailyRate * workDays);
  const nightShowBonus = rule ? _round2(Number(rule.nightShowBonus) || 0) * nightly : 0;
  // 全勤奖：当月无缺勤/请假才发
  const isFull = att && att.absent === 0 && att.leave === 0;
  const fullAttendanceBonus = isFull ? (rule ? Number(rule.fullAttendanceBonus) || 0 : 0) : 0;
  const transportAllowance = rule ? Number(rule.transportAllowance) || 0 : 0;
  const mealAllowance = rule ? Number(rule.mealAllowance) || 0 : 0;

  const grossPay = _round2(baseWage + nightShowBonus + fullAttendanceBonus + transportAllowance + mealAllowance);
  const totalDeduction = 0; // 社保/公积金/个税/扣款默认 0，可在明细里手工补
  const netPay = _round2(grossPay - totalDeduction);

  return {
    performerId: perf.id,
    performerName: perf.name,
    staffNo: perf.staffNo || null,
    rankGrade: perf.rankGrade || null,
    attendanceDays: workDays,
    dailyRate: dailyRate,
    baseWage,
    nightShowBonus,
    fullAttendanceBonus,
    transportAllowance,
    mealAllowance,
    grossPay,
    totalDeduction,
    netPay,
    otherDeductionNote: JSON.stringify({ leave: 0, absent: 0, late: att ? att.late : 0, early: 0 }),
    remark: dailyRate > 0
      ? `无底薪：协议天工资 ¥${dailyRate}/天 × ${workDays}天`
      : `无底薪：职级日薪 ¥${dailyRate}/天 × ${workDays}天`
  };
}

const generate = async ctx => {
  const b = ctx.request.body || {};
  const month = b.month;
  if (!month || !/^\d{4}-\d{2}$/.test(month)) {
    throw new BusinessError('VALIDATION_ERROR', 'month 必填（YYYY-MM）');
  }
  const dryRun = b.dryRun === true || b.preview === true;

  const performers = await prisma.performersDbV1.findMany({
    where: { status: { not: 'deleted' } },
    select: { id: true, staffNo: true, name: true, rankGrade: true, dailyRate: true, employmentType: true }
  });
  if (!performers.length) {
    throw new BusinessError('UNPROCESSABLE', '花名册无在册人员');
  }

  // 职级规则一次取齐
  const ruleRows = await prisma.wageRulesV1.findMany({ where: { status: 'active' } });
  const ruleMap = {};
  ruleRows.forEach(r => { ruleMap[r.rankGrade] = r; });

  const attMap = await _attendanceByStaff(month);

  const items = [];
  let totalBase = 0, totalAllow = 0, totalBonus = 0, totalDeduct = 0, totalNet = 0;
  for (const p of performers) {
    const att = attMap[p.id] || { workDays: 0, nightShows: 0, absent: 0, leave: 0, late: 0 };
    // 无出勤且无天工资的人员跳过（避免全 0 噪声），但允许有 dailyRate 的人保留（0 天 = 0 元）
    if (att.workDays <= 0 && (p.dailyRate == null || Number(p.dailyRate) <= 0)) continue;
    const rule = p.rankGrade ? ruleMap[p.rankGrade] : null;
    const calc = _calcWageItem(p, att, rule);
    items.push(calc);
    totalBase += calc.baseWage;
    totalAllow += calc.transportAllowance + calc.mealAllowance;
    totalBonus += calc.nightShowBonus + calc.fullAttendanceBonus;
    totalDeduct += calc.totalDeduction;
    totalNet += calc.netPay;
  }

  if (dryRun) {
    return success(ctx, {
      month,
      dryRun: true,
      totalPerformers: items.length,
      totalBaseWage: _round2(totalBase),
      totalAllowance: _round2(totalAllow),
      totalBonus: _round2(totalBonus),
      totalDeduction: _round2(totalDeduct),
      totalNetPay: _round2(totalNet),
      items
    });
  }

  // 正式生成：建批次 + 批量写入明细
  const batchNo = b.batchNo || ('WB-' + month.replace('-', '') + '-' + Date.now().toString(36).toUpperCase());
  const batch = await prisma.wageBatchesV1.create({
    data: {
      id: idByCtx('wbatch', 12, nanoid),
      batchNo,
      wageMonth: month,
      status: 'draft',
      totalPerformers: items.length,
      totalBaseWage: _round2(totalBase),
      totalAllowance: _round2(totalAllow),
      totalBonus: _round2(totalBonus),
      totalDeduction: _round2(totalDeduct),
      totalNetPay: _round2(totalNet),
      createdBy: ctx.state.user ? ctx.state.user.username : null,
      ts: BigInt(nowMs())
    }
  });

  const createdItems = [];
  for (const it of items) {
    const row = await prisma.wageItemsV1.create({
      data: {
        id: idByCtx('wage', 12, nanoid),
        batchId: batch.id,
        performerId: it.performerId,
        performerName: it.performerName,
        staffNo: it.staffNo,
        rankGrade: it.rankGrade,
        attendanceDays: it.attendanceDays,
        baseWage: it.baseWage,
        nightShowBonus: it.nightShowBonus,
        fullAttendanceBonus: it.fullAttendanceBonus,
        transportAllowance: it.transportAllowance,
        mealAllowance: it.mealAllowance,
        otherDeductionNote: it.otherDeductionNote,
        grossPay: it.grossPay,
        totalDeduction: it.totalDeduction,
        netPay: it.netPay,
        remark: it.remark,
        ts: BigInt(nowMs())
      }
    });
    createdItems.push(toApi(row, batch));
  }

  try { await audit(ctx, 'wages:generate', batch.id, { batchNo, month, count: createdItems.length }); } catch (_) {}
  return created(ctx, {
    batch: _batchToApi(batch),
    items: createdItems,
    summary: {
      totalPerformers: createdItems.length,
      totalBaseWage: _round2(totalBase),
      totalAllowance: _round2(totalAllow),
      totalBonus: _round2(totalBonus),
      totalDeduction: _round2(totalDeduct),
      totalNetPay: _round2(totalNet)
    }
  });
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
  generate,
  batchList,
  batchCreate,
  batchConfirm,
  batchPost,
  rulesList,
  rulesDetail,
  toApi
};
