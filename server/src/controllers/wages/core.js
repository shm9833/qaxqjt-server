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
const { toApi, _batchToApi, _attendanceByStaff, _round2, _calcWageItem, SETTLE_MODES, _sanitizeSettleParams, _calcSettleWageItem } = require('./helpers');
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
  // 过账保护：confirmed/posted 批次的明细金额与字段冻结，与 DELETE 同口径
  if (exists.batch && exists.batch.status && exists.batch.status !== 'draft') {
    const act = exists.batch.status === 'posted' ? '已过账发放' : '已确认';
    throw new BusinessError('UNPROCESSABLE', `工资批次${act}，工资明细不可修改（如需调整请先撤回批次）`);
  }
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

const generate = async ctx => {
  const b = ctx.request.body || {};
  const month = b.month;
  if (!month || !/^\d{4}-\d{2}$/.test(month)) {
    throw new BusinessError('VALIDATION_ERROR', 'month 必填（YYYY-MM）');
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

  const attMap = await _attendanceByStaff(month);

  const items = [];
  let totalBase = 0, totalAllow = 0, totalBonus = 0, totalDeduct = 0, totalNet = 0;
  for (const p of performers) {
    const att = attMap[p.id] || {
      workDays: 0, nightShows: 0, absent: 0, leave: 0, late: 0, lateOver: 0,
      early: 0, earlyOver: 0, sick: 0, paidLeave: 0
    };
    // 模式解析顺序：按人覆盖 settleModes[id] → 全员默认 defaultMode → daily_pure
    const ov = settleModes[p.id];
    const mode = SETTLE_MODES.indexOf(ov) >= 0 ? ov : defaultMode;
    // 无出勤且无天工资的人员跳过（避免全 0 噪声）；按月结算人员有底薪，始终纳入核算
    if (mode !== 'monthly' && att.workDays <= 0 && (p.dailyRate == null || Number(p.dailyRate) <= 0)) continue;
    const rule = p.rankGrade ? ruleMap[p.rankGrade] : null;
    const calc = mode === 'daily_pure'
      ? _calcWageItem(p, att, rule, settleParams)
      : _calcSettleWageItem(p, att, mode, settleParams);
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

  // 幂等重建（v20260921）：同月 draft 草稿批次先删后建，重复点击/改完参数重算都不会产生重复批次；
  // confirmed/posted 批次已锁定，拒绝重算，防止已确认/已发放工资被意外覆盖
  const existingBatches = await prisma.wageBatchesV1.findMany({ where: { wageMonth: month } });
  const lockedBatch = existingBatches.find(x => x.status === 'confirmed' || x.status === 'posted');
  if (lockedBatch) {
    throw new BusinessError(
      'CONFLICT',
      `${month} 工资批次 ${lockedBatch.batchNo} 已${lockedBatch.status === 'posted' ? '过账发放' : '确认'}，不可重新核算；如需调整请先撤回该批次`
    );
  }
  const staleDraftBatches = existingBatches.filter(x => x.status === 'draft');
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
      baseWage: it.baseWage,
      nightShowBonus: it.nightShowBonus,
      fullAttendanceBonus: it.fullAttendanceBonus,
      transportAllowance: it.transportAllowance,
      mealAllowance: it.mealAllowance,
      otherDeduction: it.otherDeduction || 0,
      otherDeductionNote: it.otherDeductionNote,
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

  try { await audit({ ctx, module: 'wage', action: 'WAGE_GENERATE', targetId: batch.id, detail: { batchNo, wageMonth: month, count: createdItems.length, defaultMode, modeOverrides: Object.keys(settleModes).length } }); } catch (_) {}
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
      const summary =
        `工资发放 ${exists.batchNo}（${exists.wageMonth}）` +
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

// ========== 工资规则（WageRulesV1） ==========

module.exports = {
  create,
  update,
  remove,
  generate,
  batchCreate,
  batchConfirm,
  batchPost,
};
