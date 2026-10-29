/* wages/core.js — 核心 handlers（存在交叉调用，自 wages.js 拆分） */
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
 * POST   /v1/wage-batches/:id/post     批次过账（单事务生成支出台账分录 + 状态流转）
 * GET    /v1/wage-rules        规则列表
 * GET    /v1/wage-rules/:rankGrade  规则详情
 */
const { nanoid } = require('nanoid');
const prisma = require('../../utils/prisma');
const { success, created, noContent } = require('../../utils/response');
const { idByCtx, nowMs } = require('../../config');
const { BusinessError } = require('../../middleware/error-handler');
const { audit } = require('../../services/audit-service');
const { toApi, _batchToApi, _parseBatchPeriod, _attendanceByStaff, _orderBreakdownByStaff, _punchLateStatsByStaff, _travelExpenseByStaffMonth, _loanByStaffMonth, _loadUnloadAbsentByStaffMonth, _round2, _calcWageItem, SETTLE_MODES, _sanitizeSettleParams, _calcSettleWageItem } = require('./helpers');
const punchParamsSvc = require('../../services/punch-params');
const { detail } = require('./independent');

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
    early: Number(b.earlyDeduction) || 0,
    // v20261015：差旅路费明细编码到 otherDeductionNote
    travelExpense: Number(b.travelExpenseTotal) || 0,
    travelExpenseCount: Number(b.travelExpenseCount) || 0,
    travelExpenseItems: Array.isArray(b.travelExpenseItems) ? b.travelExpenseItems : []
  };
  var otherDeduction = breakdown.leave + breakdown.absent + breakdown.late + breakdown.early;
  var otherDeductionNote = JSON.stringify(breakdown);

  // 无底薪计算（未显式传 baseWage 时自动算），Fix-20261012：按日薪结算只取本人协议天工资，不再兜底职级工资标准
  var baseWage = 0;
  var attDaysNum = b.attDays ? Number(b.attDays) : (b.attendanceDays ? Number(b.attendanceDays) : 0);
  var perfDailyRate = perf && perf.dailyRate != null ? Number(perf.dailyRate) : null;
  var perfRank = b.rankGrade || (perf && perf.rankGrade) || null;
  if (b.baseWage !== undefined) {
    baseWage = Number(b.baseWage);
  } else if (attDaysNum && perfDailyRate != null && perfDailyRate > 0) {
    baseWage = Math.round(perfDailyRate * attDaysNum * 100) / 100;
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
  try { await audit({ ctx, module: 'wage', action: 'WAGE_CREATE', targetId: row.id, detail: { batchId: row.batchId || null, performerName: row.performerName, netPay: Number(row.netPay) } }); } catch (_) {}
  return created(ctx, toApi(row));
};


const update = async ctx => {
  const b = ctx.request.body;
  const exists = await prisma.wageItemsV1.findUnique({
    where: { id: ctx.params.id },
    include: { batch: true }
  });
  if (!exists) throw new BusinessError('NOT_FOUND', '工资条不存在');
  // v20261029d 过账保护豁免：payslipPublished 仅是员工端可见性开关（非金额字段），
  // 已确认/已过账批次仍需支持「发放工资条」；请求体仅含 payslipPublished 时放行，其余字段维持冻结
  const publishOnly = Object.keys(b).length > 0 && Object.keys(b).every(k => k === 'payslipPublished');
  // 过账保护：confirmed/posted 批次的明细金额与字段冻结，与 DELETE 同口径
  if (!publishOnly && exists.batch && exists.batch.status && exists.batch.status !== 'draft') {
    const act = exists.batch.status === 'posted' ? '已过账发放' : '已确认';
    throw new BusinessError('UNPROCESSABLE', `工资批次${act}，工资明细不可修改（如需调整请先撤回批次）`);
  }
  const data = {};
  ['performerName', 'staffNo', 'rankGrade', 'performerId', 'remark'].forEach(k => {
    if (b[k] !== undefined) data[k] = b[k];
  });
  if (b.attDays !== undefined) data.attendanceDays = Number(b.attDays);
  if (b.attendanceDays !== undefined) data.attendanceDays = Number(b.attendanceDays);
  // v20261027c 审核环节支持改天工资：daily_pure 模式下 dailyRate 变动自动重算 baseWage=rate×days（显式传 baseWage 优先）
  if (b.dailyRate !== undefined) data.dailyRate = (b.dailyRate === null || b.dailyRate === '') ? null : Number(b.dailyRate);
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
  // 4 项细分扣款合并编码（v20261015：含差旅路费明细）
  if (b.leaveDeduction !== undefined || b.absentDeduction !== undefined || b.lateDeduction !== undefined || b.earlyDeduction !== undefined || b.travelExpenseTotal !== undefined || b.travelExpenseItems !== undefined || b.loadUnloadDeduction !== undefined) {
    var prev = { leave: 0, absent: 0, late: 0, early: 0, travelExpense: 0, travelExpenseCount: 0, travelExpenseItems: [] };
    try { if (exists.otherDeductionNote) prev = JSON.parse(exists.otherDeductionNote); } catch (_) {}
    if (b.leaveDeduction !== undefined) prev.leave = Number(b.leaveDeduction);
    if (b.absentDeduction !== undefined) prev.absent = Number(b.absentDeduction);
    if (b.lateDeduction !== undefined) prev.late = Number(b.lateDeduction);
    if (b.earlyDeduction !== undefined) prev.early = Number(b.earlyDeduction);
    if (b.travelExpenseTotal !== undefined) prev.travelExpense = Number(b.travelExpenseTotal);
    if (b.travelExpenseCount !== undefined) prev.travelExpenseCount = Number(b.travelExpenseCount);
    if (b.travelExpenseItems !== undefined) prev.travelExpenseItems = Array.isArray(b.travelExpenseItems) ? b.travelExpenseItems : [];
    // v20261029c 审核环节支持改装卸车扣款：note 已有的缺席次数/单价/逐笔明细原样保留
    if (b.loadUnloadDeduction !== undefined) prev.loadUnloadDeduction = Number(b.loadUnloadDeduction) || 0;
    data.otherDeduction = prev.leave + prev.absent + prev.late + prev.early;
    data.otherDeductionNote = JSON.stringify(prev);
  }
  // v20261027c daily_pure 天工资联动重算：rate/days 任一变动且未显式传 baseWage 时重算
  if (data.baseWage === undefined && (data.dailyRate !== undefined || data.attendanceDays !== undefined) && exists.wageMode === 'daily_pure') {
    const rate = data.dailyRate !== undefined ? data.dailyRate : (exists.dailyRate != null ? Number(exists.dailyRate) : null);
    const days = data.attendanceDays !== undefined ? data.attendanceDays : (exists.attendanceDays != null ? Number(exists.attendanceDays) : null);
    if (rate != null && days != null && rate > 0 && days > 0) {
      data.baseWage = Math.round(rate * days * 100) / 100;
    } else if (rate != null && days != null && (rate <= 0 || days <= 0)) {
      data.baseWage = 0;
    }
  }
  // v20261027c 金额字段变动后未显式传 netPay 时重算实发 = gross − totalDeduction（gross 不动则按原值）
  if (data.netPay === undefined && (data.totalDeduction !== undefined || data.grossPay !== undefined || data.baseWage !== undefined)) {
    const gross = data.grossPay !== undefined ? data.grossPay : Number(exists.grossPay) || 0;
    const ded = data.totalDeduction !== undefined ? data.totalDeduction : Number(exists.totalDeduction) || 0;
    data.netPay = Math.round((gross - ded) * 100) / 100;
  }
  data.ts = BigInt(nowMs());
  const row = await prisma.wageItemsV1.update({ where: { id: ctx.params.id }, data });
  try {
    const _safeDetail = Object.keys(data).filter(k => k !== 'ts').reduce((o, k) => {
      const v = data[k];
      o[k] = (typeof v === 'bigint') ? Number(v) : v;
      return o;
    }, {});
    await audit({ ctx, module: 'wage', action: 'WAGE_UPDATE', targetId: row.id, detail: _safeDetail });
  } catch (_) {}
  return success(ctx, toApi(row));
};


// ========== v20261027c 工资条逐人审核：批次确认前强制每条 approved ==========
// POST /wages/:id/review  body { reviewStatus: 'approved'|'pending', remark? }
// 仅 draft 批次可改审核状态（confirmed/posted 冻结）；审核通过记录审核人与时间
const review = async ctx => {
  const b = ctx.request.body || {};
  const status = b.reviewStatus === 'approved' ? 'approved' : 'pending';
  const exists = await prisma.wageItemsV1.findUnique({
    where: { id: ctx.params.id },
    include: { batch: { select: { id: true, status: true } } }
  });
  if (!exists) throw new BusinessError('NOT_FOUND', '工资条不存在');
  if (exists.batch && exists.batch.status && exists.batch.status !== 'draft') {
    const act = exists.batch.status === 'posted' ? '已过账发放' : '已确认';
    throw new BusinessError('UNPROCESSABLE', `工资批次${act}，审核状态不可修改`);
  }
  const reviewer = ctx.state.user ? ctx.state.user.username : 'admin';
  const row = await prisma.wageItemsV1.update({
    where: { id: ctx.params.id },
    data: {
      reviewStatus: status,
      reviewedBy: status === 'approved' ? reviewer : null,
      reviewedAt: status === 'approved' ? new Date() : null,
      ts: BigInt(nowMs())
    }
  });
  try { await audit({ ctx, module: 'wage', action: status === 'approved' ? 'WAGE_REVIEW_APPROVE' : 'WAGE_REVIEW_RESET', targetId: row.id, detail: { batchId: exists.batchId || null, performerName: row.performerName } }); } catch (_) {}
  return success(ctx, toApi(row));
};


const remove = async ctx => {
  // 过账保护：仅 draft 批次允许删除明细；confirmed/posted 已锁定（posted 已入发放台账）
  const exists = await prisma.wageItemsV1.findUnique({
    where: { id: ctx.params.id },
    include: { batch: true }
  });
  if (!exists) throw new BusinessError('NOT_FOUND', '工资条不存在');
  if (exists.batch && exists.batch.status && exists.batch.status !== 'draft') {
    const act = exists.batch.status === 'posted' ? '已过账发放' : '已确认';
    throw new BusinessError('UNPROCESSABLE', `工资批次${act}，工资明细不可删除（如需调整请先撤回批次）`);
  }
  const row = await prisma.wageItemsV1.delete({ where: { id: ctx.params.id } });
  try { await audit({ ctx, module: 'wage', action: 'WAGE_DELETE', targetId: ctx.params.id, detail: { batchId: exists.batchId || null, performerName: row.performerName } }); } catch (_) {}
  return noContent(ctx);
};

// ========== 无底薪工资批量生成：baseWage = 协议天工资 × 实际出勤天数 ==========
// 实际出勤天数口径：full/night/double 各计 1 天，half 计 0.5 天（与 performers.stats 一致）

// ===== v20261024 区间结算（wrange1024）区间工具 =====
// YYYY-MM → 该月最后一天字符串（如 '2026-10' → '2026-10-31'）
function _monthLastDayStr(ym) {
  const y = Number(ym.substring(0, 4)), m = Number(ym.substring(5, 7));
  const last = new Date(Date.UTC(y, m, 0));
  return ym + '-' + String(last.getUTCDate()).padStart(2, '0');
}
// 区间恰为整月（开始=当月1日且结束=当月末日）→ 批次沿用旧 batchNo 格式
function _isFullMonthRange(sd, ed) {
  if (sd.substring(0, 7) !== ed.substring(0, 7)) return false;
  if (!sd.endsWith('-01')) return false;
  return ed === _monthLastDayStr(sd.substring(0, 7));
}
// 归属月 → 结束月（含）之间的全部月份字符串列表（跨月区间候选批次查询用）
function _monthSpan(fromYm, toYm) {
  const list = [];
  let y = Number(fromYm.substring(0, 4)), m = Number(fromYm.substring(5, 7));
  const ty = Number(toYm.substring(0, 4)), tm = Number(toYm.substring(5, 7));
  let guard = 0;
  while ((y < ty || (y === ty && m <= tm)) && guard++ < 32) {
    list.push(y + '-' + String(m).padStart(2, '0'));
    m += 1;
    if (m > 12) { m = 1; y += 1; }
  }
  return list;
}

const generate = async ctx => {
  const b = ctx.request.body || {};
  // ===== v20261024 区间结算双形态（wrange1024）=====
  //   新形态：传 startDate+endDate（YYYY-MM-DD，不传 month）→ wageMonth 自动=开始日期所在月，
  //           考勤/迟到/路费/借款只归集区间内数据（支持跨月，如 09-28~10-05 归属 9 月）
  //   旧形态：只传 month（YYYY-MM）→ 整月核算，行为与历史完全一致（attendance.js 等沿用）
  const hasRange = b.startDate != null || b.endDate != null;
  let month, range = null, periodLabel = null, isFullMonth = true, reqStartStr, reqEndStr;
  if (hasRange) {
    const sd = String(b.startDate || ''), ed = String(b.endDate || '');
    const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
    if (!DATE_RE.test(sd) || !DATE_RE.test(ed)) {
      throw new BusinessError('VALIDATION_ERROR', 'startDate/endDate 必填且格式为 YYYY-MM-DD（或改传 month 整月核算）');
    }
    if (sd > ed) {
      throw new BusinessError('VALIDATION_ERROR', '开始日期不能晚于结束日期');
    }
    const sT = Date.UTC(Number(sd.substring(0, 4)), Number(sd.substring(5, 7)) - 1, Number(sd.substring(8, 10)));
    const eT = Date.UTC(Number(ed.substring(0, 4)), Number(ed.substring(5, 7)) - 1, Number(ed.substring(8, 10)));
    if ((eT - sT) / 86400000 > 400) {
      throw new BusinessError('VALIDATION_ERROR', '结算区间跨度不能超过 400 天');
    }
    month = sd.substring(0, 7); // 归属月份 = 开始日期所在月
    // gte=开始日 00:00 UTC，lt=结束日次日 00:00 UTC（与路费/打卡的 UTC 日界一致）
    range = { gte: new Date(sT), lt: new Date(eT + 86400000) };
    isFullMonth = _isFullMonthRange(sd, ed);
    reqStartStr = sd;
    reqEndStr = ed;
    if (!isFullMonth) {
      periodLabel = (sd.substring(0, 4) === ed.substring(0, 4))
        ? sd.substring(5) + '~' + ed.substring(5)
        : sd + '~' + ed;
    }
  } else {
    month = b.month;
    if (!month || !/^\d{4}-\d{2}$/.test(month)) {
      throw new BusinessError('VALIDATION_ERROR', 'month 必填（YYYY-MM），或改传 startDate/endDate（YYYY-MM-DD）按区间结算');
    }
    reqStartStr = month + '-01';
    reqEndStr = _monthLastDayStr(month);
  }
  const dryRun = b.dryRun === true || b.preview === true;
  // 结算模式：defaultMode 全员默认（缺省 daily_pure 保持旧行为），settleModes 按人覆盖 {performerId: mode}
  const defaultMode = SETTLE_MODES.indexOf(b.defaultMode) >= 0 ? b.defaultMode : 'daily_pure';
  const settleModes = (b.settleModes && typeof b.settleModes === 'object' && !Array.isArray(b.settleModes)) ? b.settleModes : {};
  const settleParams = _sanitizeSettleParams(b.monthlyParams);

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

  const attMap = await _attendanceByStaff(month, range);
  // v20261012 打卡新规：取打卡参数 + 按打卡记录重算迟到分钟/罚款/本场失效，并入考勤桶
  const punchP = await punchParamsSvc.getPunchParams();
  const punchMap = await _punchLateStatsByStaff(month, punchP, range);
  // v20261015 差旅路费：按月/区间查询人员差旅路费，纳入 transportAllowance
  const travelExpMap = await _travelExpenseByStaffMonth(month, range);
  // v20261017 借款：按月/区间查询已审批未还清借款，纳入 loanDeduction
  const loanExpMap = await _loanByStaffMonth(month, range);
  // v20261028f 装卸车缺席：按月/区间统计装车/卸车缺席次数，扣款 = 次数 × 人员单价
  const luExpMap = await _loadUnloadAbsentByStaffMonth(month, range);
  // v20261026 订单溯源：按考勤→排期→订单聚合各人员收入构成（计薪天/夜场分单归属）
  const orderMap = await _orderBreakdownByStaff(month, range);

  const items = [];
  let totalBase = 0, totalAllow = 0, totalBonus = 0, totalDeduct = 0, totalNet = 0;
  for (const p of performers) {
    const att = attMap[p.id] || {
      workDays: 0, nightShows: 0, absent: 0, leave: 0, late: 0, lateOver: 0,
      early: 0, earlyOver: 0, sick: 0, paidLeave: 0
    };
    const ps = punchMap[p.id];
    if (ps) {
      att.lateFinePunch = ps.lateFine;
      att.lateMinutes = ps.lateMinutes;
      att.lateShows = ps.lateShows;
      att.invalidShows = ps.invalidShows;
    }
    // 模式解析顺序：按人覆盖 settleModes[id] → 全员默认 defaultMode → daily_pure
    const ov = settleModes[p.id];
    const mode = SETTLE_MODES.indexOf(ov) >= 0 ? ov : defaultMode;
    // v20261027b 纯演出天数：Σ 参与订单演出场次数（orderMap 各单 showDays 合计）
    const ob0 = orderMap[p.id];
    let showDaysTotal = 0;
    if (ob0) Object.keys(ob0.orders).forEach(oid => { showDaysTotal += ob0.orders[oid].showDays || 0; });
    // 无出勤、无演出场次且无天工资的人员跳过（避免全 0 噪声）；按月结算人员有底薪，始终纳入核算
    if (mode !== 'monthly' && att.workDays <= 0 && showDaysTotal <= 0 && (p.dailyRate == null || Number(p.dailyRate) <= 0)) continue;
    const rule = p.rankGrade ? ruleMap[p.rankGrade] : null;
    const travelExp = travelExpMap[p.id] || null;
    const loanExp = loanExpMap[p.id] || null;
    const luExp = luExpMap[p.id] || null;
    // v20261027b daily_pure 计薪天 = Σ演出场次（考勤只用于扣罚，不影响计薪天）；showBased 备注标注口径
    // v20261029h leaveTrace 溯源扣减留痕随 att 传入计算器 → otherDeductionNote.leave 工资条展示
    const attForCalc = (mode === 'daily_pure' && showDaysTotal > 0)
      ? Object.assign({}, att, { workDays: showDaysTotal, leaveTrace: (ob0 && ob0.leaveTrace) || null })
      : (mode === 'daily_pure' && ob0 && ob0.leaveTrace && ob0.leaveTrace.days ? Object.assign({}, att, { leaveTrace: ob0.leaveTrace }) : att);
    const calc = mode === 'daily_pure'
      ? _calcWageItem(p, attForCalc, rule, settleParams, punchP, travelExp, loanExp, periodLabel, showDaysTotal > 0, luExp)
      : _calcSettleWageItem(p, att, mode, settleParams, luExp);
    // v20261026 订单收入明细 → v20261027b 纯演出天数口径：baseShare=协议天工资×演出场次数（showDays）；
    // 未设置天工资者 baseShare=0；showDays 倒序；未命中订单演出段的计薪考勤归「非演出考勤」兜底桶（不计薪，baseShare=0）
    const ob = orderMap[p.id];
    if (ob) {
      const rate = (p.dailyRate != null && Number(p.dailyRate) > 0) ? Number(p.dailyRate) : 0;
      // v20261028g 订单出勤天与计薪口径对齐：daily_pure 下金额=日工资×showDays、出勤=showDaysTotal，
      // 演出中期制单时考勤快照偏小（历史 ORD2609071207IHU3 出勤天1≠6），统一取 showDays 防口径打架
      const obOrders = Object.keys(ob.orders).map(oid => ({
        orderId: oid,
        orderNo: ob.orders[oid].orderNo || oid,
        workDays: (mode === 'daily_pure' && showDaysTotal > 0)
          ? (ob.orders[oid].showDays || 0)
          : Math.round(ob.orders[oid].workDays * 100) / 100,
        showDays: ob.orders[oid].showDays || 0,
        nightShows: ob.orders[oid].nightShows,
        baseShare: _round2(rate * (ob.orders[oid].showDays || 0))
      })).sort((a, b2) => (b2.showDays || 0) - (a.showDays || 0));
      const fb = ob.fallback;
      if (fb.workDays > 0 || fb.nightShows > 0) {
        obOrders.push({
          orderId: null, orderNo: '非演出考勤',
          workDays: Math.round(fb.workDays * 100) / 100,
          showDays: 0,
          nightShows: fb.nightShows,
          baseShare: 0
        });
      }
      if (obOrders.length) calc.orderBreakdown = JSON.stringify(obOrders);
    }
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

  // 无有效核算明细时不建空批次（出勤为 0 且无协议天工资的人员已在上方跳过）
  if (!items.length) {
    throw new BusinessError(
      'UNPROCESSABLE',
      `${month} 无可核算人员：全员当月出勤为 0 且未设置协议天工资；请先录入考勤或在花名册维护天工资`
    );
  }

  // 幂等重建（v20260921）+ 区间重叠语义（v20261024 wrange1024）：
  //   候选批次 = wageMonth ∈ [归属月, 结束月]（整月路径即单月）；
  //   confirmed/posted 批次与本次结算区间重叠 → 拒绝（防重复计薪）；不重叠的其他区间不受影响；
  //   draft 批次与本次区间重叠 → 连同明细删除重建（幂等）；不重叠的 draft 保留（修复同月重算误删其他区间草稿）
  const candidateMonths = _monthSpan(month, reqEndStr.substring(0, 7));
  const existingBatches = await prisma.wageBatchesV1.findMany({ where: { wageMonth: { in: candidateMonths } } });
  const _overlaps = batch => {
    const p = _parseBatchPeriod(batch.batchNo, batch.wageMonth);
    const bs = p ? p.start : (batch.wageMonth + '-01');
    const be = p ? p.end : _monthLastDayStr(batch.wageMonth);
    return reqStartStr <= be && bs <= reqEndStr;
  };
  const lockedBatch = existingBatches.find(x => (x.status === 'confirmed' || x.status === 'posted') && _overlaps(x));
  if (lockedBatch) {
    const lp = _parseBatchPeriod(lockedBatch.batchNo, lockedBatch.wageMonth);
    const periodText = lp ? `${lp.start} ~ ${lp.end}` : `${lockedBatch.wageMonth} 整月`;
    throw new BusinessError(
      'CONFLICT',
      `本次结算区间 ${reqStartStr} ~ ${reqEndStr} 与已${lockedBatch.status === 'posted' ? '过账发放' : '确认'}批次 ${lockedBatch.batchNo}（结算周期 ${periodText}）重叠，不可重复核算；如需调整请先撤回该批次`
    );
  }
  const staleDraftBatches = existingBatches.filter(x => x.status === 'draft' && _overlaps(x));
  const staleDraftIds = staleDraftBatches.map(x => x.id);
  if (staleDraftIds.length) {
    // P0 性能修复：清明细+删批次合并为单事务，保证原子性且减少一次事务往返
    await prisma.$transaction([
      prisma.wageItemsV1.deleteMany({ where: { batchId: { in: staleDraftIds } } }),
      prisma.wageBatchesV1.deleteMany({ where: { id: { in: staleDraftIds } } })
    ]);
  }
  const replaced = staleDraftBatches.map(x => ({ id: x.id, batchNo: x.batchNo }));

  // 正式生成：建批次 + 批量写入明细
  // v20261024：子区间批次 batchNo 编码结算周期（WB-YYYYMM-YYYYMMDD-YYYYMMDD-<rand>），整月请求沿用旧格式
  const batchNo = b.batchNo || (isFullMonth
    ? ('WB-' + month.replace('-', '') + '-' + Date.now().toString(36).toUpperCase())
    : ('WB-' + month.replace('-', '') + '-' + reqStartStr.replace(/-/g, '') + '-' + reqEndStr.replace(/-/g, '') + '-' + Date.now().toString(36).toUpperCase()));
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

  // P0 性能修复：明细落库由逐条 await 改为单事务批量提交（原子 + 减少 N 次事务开销），返回行序与入参一致
  const ts = BigInt(nowMs());
  const rows = await prisma.$transaction(items.map(it => prisma.wageItemsV1.create({
    data: {
      id: idByCtx('wage', 12, nanoid),
      batchId: batch.id,
      performerId: it.performerId,
      performerName: it.performerName,
      staffNo: it.staffNo,
      rankGrade: it.rankGrade,
      attendanceDays: it.attendanceDays,
      // v20261027c 落库协议天工资与结算模式（审核弹窗预填天工资用）
      dailyRate: it.dailyRate != null ? it.dailyRate : null,
      wageMode: it.wageMode || null,
      baseWage: it.baseWage,
      nightShowBonus: it.nightShowBonus,
      fullAttendanceBonus: it.fullAttendanceBonus,
      transportAllowance: it.transportAllowance,
      mealAllowance: it.mealAllowance,
      otherDeduction: it.otherDeduction || 0,
      otherDeductionNote: it.otherDeductionNote,
      orderBreakdown: it.orderBreakdown || null,
      loanDeduction: it.loanDeduction || 0,
      socialInsuranceDeduct: it.socialInsuranceDeduct || 0,
      taxDeduct: it.taxDeduct || 0,
      grossPay: it.grossPay,
      totalDeduction: it.totalDeduction,
      netPay: it.netPay,
      remark: it.remark,
      ts
    }
  })));
  const createdItems = rows.map(row => toApi(row, batch));

  try { await audit({ ctx, module: 'wage', action: 'WAGE_GENERATE', targetId: batch.id, detail: { batchNo, wageMonth: month, settleStart: reqStartStr, settleEnd: reqEndStr, count: createdItems.length, defaultMode, modeOverrides: Object.keys(settleModes).length } }); } catch (_) {}
  return created(ctx, {
    batch: _batchToApi(batch),
    items: createdItems,
    replaced,
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
  try { await audit({ ctx, module: 'wage', action: 'WAGE_BATCH_CREATE', targetId: row.id, detail: { batchNo: row.batchNo, wageMonth: row.wageMonth } }); } catch (_) {}
  return created(ctx, _batchToApi(row));
};


const batchConfirm = async ctx => {
  const exists = await prisma.wageBatchesV1.findUnique({ where: { id: ctx.params.id } });
  if (!exists) throw new BusinessError('NOT_FOUND', '工资批次不存在');
  if (exists.status !== 'draft') throw new BusinessError('UNPROCESSABLE', '仅 draft 状态批次可确认');
  // v20261027c 强制逐人审核：批次内全部工资条 reviewStatus=approved 才允许确认
  const pending = await prisma.wageItemsV1.findMany({
    where: { batchId: exists.id, reviewStatus: { not: 'approved' } },
    select: { performerName: true, staffNo: true }
  });
  if (pending.length) {
    const names = pending.slice(0, 5).map(p => p.performerName + (p.staffNo ? '(' + p.staffNo + ')' : '')).join('、');
    throw new BusinessError('UNPROCESSABLE', `尚有 ${pending.length} 人未审核通过（${names}${pending.length > 5 ? ' 等' : ''}），请逐人审核工资条后再确认批次`);
  }
  const row = await prisma.wageBatchesV1.update({
    where: { id: ctx.params.id },
    data: {
      status: 'confirmed',
      confirmedBy: ctx.state.user ? ctx.state.user.username : null,
      confirmedAt: new Date(),
      ts: BigInt(nowMs())
    }
  });
  try { await audit({ ctx, module: 'wage', action: 'WAGE_BATCH_CONFIRM', targetId: row.id, detail: { batchNo: row.batchNo } }); } catch (_) {}
  return success(ctx, _batchToApi(row));
};


const batchPost = async ctx => {
  const exists = await prisma.wageBatchesV1.findUnique({ where: { id: ctx.params.id } });
  if (!exists) throw new BusinessError('NOT_FOUND', '工资批次不存在');
  if (exists.status !== 'confirmed') throw new BusinessError('UNPROCESSABLE', '仅 confirmed 状态批次可过账');

  // 幂等护栏：该批次已存在关联台账分录（如撤回后重过账）则跳过建分录，仅补状态流转，避免重复记账
  const existedLedger = await prisma.finLedgerV1.findFirst({
    where: { relatedBatchId: exists.id },
    orderBy: { createdAt: 'asc' }
  });

  // 金额口径：以 totalNetPay 为准；与四项分项合计（底薪+补贴+奖金−扣款）差异超过 0.01 时记录差异
  const net = _round2(exists.totalNetPay);
  const partsSum = _round2(
    (Number(exists.totalBaseWage) || 0) +
      (Number(exists.totalAllowance) || 0) +
      (Number(exists.totalBonus) || 0) -
      (Number(exists.totalDeduction) || 0)
  );
  const amountDiff = _round2(net - partsSum);
  const amountMismatch = Math.abs(amountDiff) > 0.01;
  if (!existedLedger && net <= 0) {
    // 与 finance 制单口径一致：金额为 0 不生成凭证
    throw new BusinessError('UNPROCESSABLE', '批次实发金额为 0，无需生成台账支出分录');
  }

  let row;
  let ledger = null;
  if (existedLedger) {
    row = await prisma.wageBatchesV1.update({
      where: { id: exists.id },
      data: {
        status: 'posted',
        postedToLedger: true,
        postedAt: new Date(),
        ts: BigInt(nowMs())
      }
    });
  } else {
    // 单事务：创建支出台账分录 + 批次状态流转；事务内复查状态，防并发重复过账
    const txResult = await prisma.$transaction(async tx => {
      const cur = await tx.wageBatchesV1.findUnique({ where: { id: exists.id } });
      if (!cur || cur.status !== 'confirmed') {
        throw new BusinessError('CONFLICT', '批次状态已变化，请刷新后重试');
      }
      // v20261024 区间结算（wrange1024）：子区间批次在台账摘要标注结算周期，财务凭证可追溯
      const bp = _parseBatchPeriod(exists.batchNo, exists.wageMonth);
      const periodText = bp ? `，结算周期 ${bp.start} ~ ${bp.end}` : '';
      const summary =
        `工资发放 ${exists.batchNo}（${exists.wageMonth}${periodText}）` +
        (amountMismatch ? `；实发与分项合计差异 ¥${amountDiff}，以实发 ¥${net} 为准` : '');
      const entry = await tx.finLedgerV1.create({
        data: {
          id: idByCtx('ledger', 12, nanoid),
          // 凭证号由唯一 batchNo 派生，天然防同批次重复入账（fin_ledger_v1.idx_ledger_voucherno 唯一约束兜底）
          voucherNo: 'WBP-' + exists.batchNo,
          voucherDate: new Date(),
          voucherType: 'payment',
          voucherCategory: '人员成本',
          summary: summary,
          relatedBatchId: exists.id,
          debitAmount: net, // 台账语义：debitAmount=支出（借），creditAmount=收入（贷）
          creditAmount: 0,
          balanceAmount: 0,
          // 安全：与 finance 制单口径一致仅落草稿，复核流转由财务模块双角色完成（M-15）
          status: 'draft',
          makerAccountId: (ctx.state.user && ctx.state.user.sub) || null,
          madeAt: new Date(),
          doubleCheckRequired: net >= 10000,
          remark: amountMismatch
            ? `分项合计 ¥${partsSum}（底薪¥${_round2(exists.totalBaseWage)}+补贴¥${_round2(exists.totalAllowance)}+奖金¥${_round2(exists.totalBonus)}−扣款¥${_round2(exists.totalDeduction)}）与实发差异 ¥${amountDiff}，以实发为准`
            : null,
          createdBy: (ctx.state.user && ctx.state.user.sub) || 'system',
          ts: BigInt(nowMs())
        }
      });
      const updated = await tx.wageBatchesV1.update({
        where: { id: exists.id },
        data: {
          status: 'posted',
          postedToLedger: true,
          postedAt: new Date(),
          ts: BigInt(nowMs())
        }
      });
      return { row: updated, ledger: entry };
    });
    row = txResult.row;
    ledger = txResult.ledger;
  }

  try {
    await audit({
      ctx,
      module: 'wage',
      action: 'WAGE_BATCH_POST',
      targetId: row.id,
      detail: {
        batchNo: row.batchNo,
        wageMonth: row.wageMonth,
        amount: net,
        ledgerId: (ledger || existedLedger).id,
        ledgerVoucherNo: (ledger || existedLedger).voucherNo,
        ledgerCreated: !!ledger,
        amountDiff: amountMismatch ? amountDiff : 0
      }
    });
  } catch (_) {}
  return success(ctx, _batchToApi(row));
};

// ========== v20261029i 批次撤回（发放错误修正闭环：撤回 → 修正 → 审核 → 重新发放） ==========
// POST /wages/batches/:id/unpost
// 仅 confirmed/posted 批次可撤回；posted 撤回时同步删除本批次自动生成的 draft 台账分录
// （凭证已复核 → 拒绝自动撤回，交财务模块处理）；撤回后批次回 draft，明细可改、可重新审核发放。
// batchPost 的幂等护栏已兼容"撤回后重过账"（撤回删分录 → 重过账重建分录，不重复记账）。
const batchUnpost = async ctx => {
  const exists = await prisma.wageBatchesV1.findUnique({ where: { id: ctx.params.id } });
  if (!exists) throw new BusinessError('NOT_FOUND', '工资批次不存在');
  if (exists.status !== 'posted' && exists.status !== 'confirmed') {
    throw new BusinessError('UNPROCESSABLE', '仅已确认/已过账发放的批次可撤回，当前状态：' + (exists.status || 'draft'));
  }
  const ledgerRows = await prisma.finLedgerV1.findMany({ where: { relatedBatchId: exists.id } });
  // void（已作废）凭证不阻止撤回：作废即财务侧已处理完毕，撤回批次后重过账生成新凭证
  // （生产 FinLedgerV1.status 枚举实测为 draft/checked/void）
  const locked = ledgerRows.filter(x => x.status !== 'draft' && x.status !== 'void');
  if (locked.length) {
    throw new BusinessError('UNPROCESSABLE', `本批次关联台账凭证已复核（${locked[0].voucherNo}），不可自动撤回；请先在财务模块作废该凭证`);
  }
  const txResult = await prisma.$transaction(async tx => {
    const cur = await tx.wageBatchesV1.findUnique({ where: { id: exists.id } });
    if (!cur || (cur.status !== 'posted' && cur.status !== 'confirmed')) {
      throw new BusinessError('CONFLICT', '批次状态已变化，请刷新后重试');
    }
    // 事务内复查后：删 draft 台账分录（仅本批次自动生成的 WBP-* 凭证）+ 批次回 draft
    const del = await tx.finLedgerV1.deleteMany({ where: { relatedBatchId: exists.id } });
    const row = await tx.wageBatchesV1.update({
      where: { id: exists.id },
      data: { status: 'draft', postedToLedger: false, postedAt: null, ts: BigInt(nowMs()) }
    });
    return { row, ledgerDeleted: del.count };
  });
  // 撤回后明细审核状态保留（已 approved 条目无需重审，直接可重新确认/过账；如需重审可逐条 reset）
  // v20261029i 撤回后自动重算该月工资条（假条变更等修正即时生效），失败不阻断撤回
  let recalcOut = null;
  try {
    const { recalcLeaveWages } = require('./leave-recalc.js');
    recalcOut = await recalcLeaveWages(prisma, { _attendanceByStaff, _orderBreakdownByStaff }, { month: exists.wageMonth });
  } catch (e) { recalcOut = { error: String(e.message || e) }; }
  try {
    await audit({
      ctx,
      module: 'wage',
      action: 'WAGE_BATCH_UNPOST',
      targetId: txResult.row.id,
      detail: { batchNo: txResult.row.batchNo, wageMonth: txResult.row.wageMonth, prevStatus: exists.status, ledgerDeleted: txResult.ledgerDeleted, recalc: recalcOut }
    });
  } catch (_) {}
  return success(ctx, Object.assign(_batchToApi(txResult.row), { unpostInfo: { ledgerDeleted: txResult.ledgerDeleted, recalc: recalcOut } }));
};

// ========== 工资规则（WageRulesV1） ==========

module.exports = {
  create,
  update,
  review,
  remove,
  generate,
  batchCreate,
  batchConfirm,
  batchPost,
  batchUnpost,
};
