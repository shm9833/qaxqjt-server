/* wages/helpers.js — 常量和内部工具函数（自 wages.js 拆分） */
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
const { success, created, pageMeta, noContent } = require('../../utils/response');
const { idByCtx, nowMs } = require('../../config');
const { BusinessError } = require('../../middleware/error-handler');
const { audit } = require('../../services/audit-service');

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

const WORK_DAY_TYPES = { full: 1, night: 1, double: 1, half: 0.5 };

// ========== 考勤扣罚规则（与《员工管理条例》第二条一致，唯一计算口径，勿在别处重复实现）==========

async function _attendanceByStaff(month) {
  // 一次性拉取该月全部考勤，按 staffId 聚合，避免 N 次查询
  const rows = await prisma.attendanceV1.findMany({
    where: { attendanceMonth: month },
    select: { staffId: true, attendanceType: true }
  });
  const map = {};
  for (const r of rows) {
    const m = map[r.staffId] || {
      workDays: 0, nightShows: 0, absent: 0, leave: 0, late: 0, lateOver: 0,
      early: 0, earlyOver: 0, sick: 0, paidLeave: 0
    };
    const t = r.attendanceType;
    if (WORK_DAY_TYPES[t] != null) {
      m.workDays += WORK_DAY_TYPES[t];
      if (t === 'night') m.nightShows += 1;
    } else if (t === 'absent') m.absent += 1;
    else if (t === 'late') m.late += 1;
    else if (t === 'late_over') { m.lateOver += 1; m.late += 1; } // 超30分钟迟到同时计入迟到次数（影响全勤奖）
    else if (t === 'early') m.early += 1;
    else if (t === 'early_over') { m.earlyOver += 1; m.early += 1; } // 早退超30分钟按旷工半天，同时计早退次数
    else if (t === 'PL') m.leave += 1;   // 事假：与 leave 同桶（monthly 按折算日薪扣回，影响全勤奖）
    else if (t === 'SL') m.sick += 1;    // 病假：monthly 按折算日薪50%扣回，影响全勤奖
    else if (t === 'AL' || t === 'ML' || t === 'BL') m.paidLeave += 1; // 年假/婚假/丧假：法定带薪，不扣款、不影响全勤
    else if (t === 'leave' || t === 'outing' || t === 'study' || t === 'business' || t === 'injury') m.leave += 1;
    map[r.staffId] = m;
  }
  return map;
}


function _round2(n) { return Math.round((Number(n) || 0) * 100) / 100; }

// 计算单条工资（按天·纯日结：纯日薪口径）
// - dailyRate: 本人协议天工资（元/天），优先
// - rule: 职级工资规则（无 dailyRate 时用 rule.baseDailyStandard 兜底）
// - params: 薪资参数（v20261003：迟到/早退/旷工扣罚受 en* 核算项开关控制）
// v20261002b：只发日薪 − 扣罚，不再发放夜场补贴/全勤奖/交通/餐补等福利项

function _calcWageItem(perf, att, rule, params) {
  const workDays = att ? att.workDays : 0;
  // 取价优先级：本人协议天工资 > 职级工资标准；hasPersonalRate 同时用于备注口径，勿合并变量
  const hasPersonalRate = perf.dailyRate != null && Number(perf.dailyRate) > 0;
  const dailyRate = hasPersonalRate
    ? Number(perf.dailyRate)
    : (rule ? Number(rule.baseDailyStandard) || 0 : 0);

  const baseWage = _round2(dailyRate * workDays);
  const nightShowBonus = 0;
  const fullAttendanceBonus = 0;
  const transportAllowance = 0;
  const mealAllowance = 0;

  const grossPay = baseWage;

  // 考勤扣罚（条例第二条）：迟到/早退20元/次；超30分钟扣半日工资；旷工1天扣两日工资；均受核算项开关控制
  const penalty = computeAttendancePenalty(att, dailyRate, params || null);
  const lateTotal = _round2(penalty.lateFine + penalty.lateOverFine);
  const earlyTotal = _round2(penalty.earlyFine + penalty.earlyOverFine);
  // 扣款不超过应发：实发不出现负数，未能扣足部分在备注中注明另行追缴
  const totalDeduction = _round2(Math.min(penalty.total, grossPay));
  const unpaidCarryOver = _round2(Math.max(0, penalty.total - grossPay));
  const netPay = _round2(grossPay - totalDeduction);

  const rateNote = hasPersonalRate
    ? `无底薪：协议天工资 ¥${dailyRate}/天 × ${workDays}天`
    : `无底薪：职级日薪 ¥${dailyRate}/天 × ${workDays}天`;
  const penaltyParts = [];
  if (penalty.lateFine) penaltyParts.push(`迟到${penalty.lateTimes}次×20元=¥${penalty.lateFine}`);
  if (penalty.lateOverFine) penaltyParts.push(`迟到超30分钟${penalty.lateOverTimes}次按旷工半天扣¥${penalty.lateOverFine}`);
  if (penalty.earlyFine) penaltyParts.push(`早退${penalty.earlyTimes}次×20元=¥${penalty.earlyFine}`);
  if (penalty.earlyOverFine) penaltyParts.push(`早退超30分钟${penalty.earlyOverTimes}次按旷工半天扣¥${penalty.earlyOverFine}`);
  if (penalty.absentFine) penaltyParts.push(`旷工${penalty.absentDays}天扣两日工资¥${penalty.absentFine}`);
  if (unpaidCarryOver) penaltyParts.push(`扣罚超出应发¥${unpaidCarryOver}，本次按0元发放，余额依条例另行追缴`);
  const remark = penaltyParts.length ? `${rateNote}；扣罚：${penaltyParts.join('；')}` : rateNote;

  const otherDeduction = _round2(penalty.absentFine + lateTotal + earlyTotal);
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
    otherDeduction,
    totalDeduction,
    netPay,
    otherDeductionNote: JSON.stringify({
      mode: 'daily_pure',
      leave: 0,              // 纯日结按出勤天计酬，请假日无日薪（workDays 已体现），不另扣
      absent: penalty.absentFine,
      late: lateTotal,
      early: earlyTotal,
      lateTimes: penalty.lateTimes, lateOverTimes: penalty.lateOverTimes,
      earlyTimes: penalty.earlyTimes, earlyOverTimes: penalty.earlyOverTimes,
      absentDays: penalty.absentDays,
      unpaidCarryOver
    }),
    remark
  };
}

// ========== 按天/按月结算（v20261002 薪资参数·按天结算功能；v20261002b 纯日薪口径） ==========
// 三种结算模式：
//   daily_pure     按天·纯日结（协议天工资/职级日薪 × 出勤天 − 扣罚，纯日薪口径：不发全勤奖/夜场补贴/交通/餐补）
//   daily_prorated 按天·月薪折算（底薪/应勤天数=日薪，× 实际出勤天数；同纯日薪口径，不发福利项）
//   monthly        按月结算（底薪全额，全勤奖/夜场补贴/各项扣款/社保/个税，均受核算项开关控制）

const SETTLE_MODES = ['daily_pure', 'daily_prorated', 'monthly'];
// 月度参数默认值（与前端 DEFAULT_PARAMS 对齐；前端可在核算时传 monthlyParams 覆盖）
// en* 键 = 核算项开关（v20261002b 自定义结算选项）：true=启用 / false=停用，仅影响本次核算

const SETTLE_PARAM_DEFAULTS = {
  base: 3800, fullBonus: 200, nightSub: 80, social: 420, shouldWork: 26,
  taxThreshold: 5000, lateDeduct: 30, earlyDeduct: 30, absentMult: 2, lateProgressive: 1,
  enBase: true, enFullBonus: true, enNightSub: true, enLateDeduct: true, enEarlyDeduct: true,
  enAbsentDeduct: true, enLeaveDeduct: true, enSocial: true, enTax: true
};


function _sanitizeSettleParams(raw) {
  const src = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const p = {};
  for (const k of Object.keys(SETTLE_PARAM_DEFAULTS)) {
    const dflt = SETTLE_PARAM_DEFAULTS[k];
    if (typeof dflt === 'boolean') {
      p[k] = src[k] === undefined ? true : !!src[k]; // 缺省启用；显式传 false 才停用
    } else {
      const v = Number(src[k]);
      p[k] = isFinite(v) && v >= 0 ? v : dflt;
    }
  }
  if (p.shouldWork < 1) p.shouldWork = SETTLE_PARAM_DEFAULTS.shouldWork; // 防除零
  return p;
}

// 简易个税：应纳税所得额 = gross − 起征点；>0 部分 3%/10%/20% 累进（速算扣除数 0/210/1410）

function _calcSimpleTax(gross, params) {
  const taxable = _round2((Number(gross) || 0) - params.taxThreshold);
  if (taxable <= 0) return 0;
  if (taxable <= 3000) return _round2(taxable * 0.03);
  if (taxable <= 12000) return _round2(taxable * 0.10 - 210);
  return _round2(taxable * 0.20 - 1410);
}

// 按天·月薪折算 / 按月结算 的单条工资计算（att 缺省按全 0 处理）
// v20261002b：daily_prorated 纯日薪口径（不发全勤奖/夜场补贴）；monthly 福利项与各项扣款受 en* 开关控制

function _calcSettleWageItem(perf, att, mode, params) {
  const workDays = att ? (att.workDays || 0) : 0;
  const nightly = att ? (att.nightShows || 0) : 0;
  const absentDays = att ? (att.absent || 0) : 0;
  const leaveDays = att ? (att.leave || 0) : 0;
  const sickDays = att ? (att.sick || 0) : 0;
  const lateTimes = att ? (att.late || 0) : 0;
  const earlyTimes = att ? (att.early || 0) : 0;
  const isMonthly = mode === 'monthly';

  const dailyBase = _round2(params.base / params.shouldWork);
  // 全勤口径：当月有出勤、无旷工、无事假/病假、迟到 < 3 次、早退 < 3 次（年假/婚假/丧假为法定带薪假，不影响全勤）
  const isFull = workDays > 0 && absentDays === 0 && leaveDays === 0 && sickDays === 0
    && lateTimes < 3 && earlyTimes < 3;
  const fullAttendanceBonus = (isMonthly && params.enFullBonus && isFull) ? _round2(params.fullBonus) : 0;
  const nightShowBonus = (isMonthly && params.enNightSub) ? _round2(params.nightSub * nightly) : 0;

  let baseWage, rateNote;
  if (isMonthly) {
    baseWage = params.enBase ? _round2(params.base) : 0;
    rateNote = params.enBase ? `按月结算：底薪¥${params.base}` : '按月结算：底薪已停用（核算项开关）';
  } else {
    // v20261003：满勤尾差修正——出勤天 ≥ 应勤天时直接发全额底薪，避免 round(底薪/应勤)×应勤 的舍入尾差
    // （如 3800/26=146.15×26=3799.90，差 0.10 元）；超出应勤的天数不再另计，月薪折算口径以全月底薪封顶
    const fullMonth = workDays >= params.shouldWork;
    baseWage = params.enBase ? (fullMonth ? _round2(params.base) : _round2(dailyBase * workDays)) : 0;
    rateNote = params.enBase
      ? (fullMonth
        ? `月薪折算：满勤（出勤${workDays}天≥应勤${params.shouldWork}天）按全额底薪¥${params.base}计（纯日薪口径，不发全勤奖/夜场补贴）`
        : `月薪折算：¥${dailyBase}/天×${workDays}天（纯日薪口径，不发全勤奖/夜场补贴）`)
      : '月薪折算：底薪已停用（核算项开关，按天折算为0）';
  }
  const grossPay = _round2(baseWage + nightShowBonus + fullAttendanceBonus);

  // 扣款：迟到/早退按次定额，旷工按折算日薪×倍数；按月模式另扣事假（按折算日薪）；各项受开关控制
  const lateFine = params.enLateDeduct ? _round2(lateTimes * params.lateDeduct) : 0;
  const earlyFine = params.enEarlyDeduct ? _round2(earlyTimes * params.earlyDeduct) : 0;
  const absentFine = params.enAbsentDeduct ? _round2(absentDays * dailyBase * params.absentMult) : 0;
  const leaveFine = (isMonthly && params.enLeaveDeduct) ? _round2(leaveDays * dailyBase) : 0;
  // 病假：仅按月结算需从已全额发放的底薪中扣回（折算模式病假不在出勤天，天然少发）；比例 50%，与事假同受假期扣款开关控制
  const sickFine = (isMonthly && params.enLeaveDeduct)
    ? _round2(sickDays * dailyBase * WAGE_DEDUCT_RULES.SICK_DEDUCT_RATIO) : 0;
  const social = params.enSocial ? _round2(params.social) : 0;
  const tax = params.enTax ? _calcSimpleTax(grossPay, params) : 0;
  const deductionRaw = _round2(lateFine + earlyFine + absentFine + leaveFine + sickFine + social + tax);
  // 实发不为负：超出应发部分在备注中注明另行追缴
  const totalDeduction = _round2(Math.min(deductionRaw, grossPay));
  const unpaidCarryOver = _round2(Math.max(0, deductionRaw - grossPay));
  const netPay = _round2(grossPay - totalDeduction);

  const parts = [];
  if (leaveFine) parts.push(`事假${leaveDays}天×¥${dailyBase}=¥${leaveFine}`);
  if (sickFine) parts.push(`病假${sickDays}天×¥${dailyBase}×50%=¥${sickFine}`);
  if (absentFine) parts.push(`旷工${absentDays}天×¥${dailyBase}×${params.absentMult}=¥${absentFine}`);
  if (lateFine) parts.push(`迟到${lateTimes}次×¥${params.lateDeduct}=¥${lateFine}`);
  if (earlyFine) parts.push(`早退${earlyTimes}次×¥${params.earlyDeduct}=¥${earlyFine}`);
  if (social) parts.push(`社保公积金¥${social}`);
  if (tax) parts.push(`个税¥${tax}`);
  if (unpaidCarryOver) parts.push(`扣款超出应发¥${unpaidCarryOver}，本次按0元发放，余额另行追缴`);
  const remark = parts.length ? `${rateNote}；扣款：${parts.join('；')}` : rateNote;

  return {
    performerId: perf.id,
    performerName: perf.name,
    staffNo: perf.staffNo || null,
    rankGrade: perf.rankGrade || null,
    attendanceDays: workDays,
    dailyRate: dailyBase,
    baseWage,
    nightShowBonus,
    fullAttendanceBonus,
    transportAllowance: 0,
    mealAllowance: 0,
    otherDeduction: _round2(leaveFine + sickFine + absentFine + lateFine + earlyFine),
    socialInsuranceDeduct: social,
    taxDeduct: tax,
    grossPay,
    totalDeduction,
    netPay,
    otherDeductionNote: JSON.stringify({
      mode,
      leave: leaveFine, sick: sickFine, absent: absentFine, late: lateFine, early: earlyFine,
      leaveDays, sickDays, absentDays, lateTimes, earlyTimes,
      social, tax, dailyBase, unpaidCarryOver
    }),
    remark
  };
}


function toApi(row, batch) {
  if (!row) return null;
  // 解码 otherDeductionNote 中编码的细分扣款（JSON: {leave,absent,late,early}）与结算模式（v20261002 增 mode 键）
  var breakdown = { leave: 0, absent: 0, late: 0, early: 0 };
  var settleMode = 'daily_pure';
  try {
    if (row.otherDeductionNote) {
      var parsed = JSON.parse(row.otherDeductionNote);
      if (parsed && typeof parsed === 'object') {
        breakdown.leave = Number(parsed.leave) || 0;
        breakdown.absent = Number(parsed.absent) || 0;
        breakdown.late = Number(parsed.late) || 0;
        breakdown.early = Number(parsed.early) || 0;
        if (typeof parsed.mode === 'string' && parsed.mode) settleMode = parsed.mode;
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
    settleMode: settleMode,
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


function computeAttendancePenalty(att, dailyRate, switches) {
  const sw = switches && typeof switches === 'object' ? switches : {};
  const enLate = sw.enLateDeduct !== false;
  const enEarly = sw.enEarlyDeduct !== false;
  const enAbsent = sw.enAbsentDeduct !== false;
  const lateTimes = att && att.late ? att.late : 0;
  const lateOverTimes = att && att.lateOver ? att.lateOver : 0;
  const earlyTimes = att && att.early ? att.early : 0;
  const earlyOverTimes = att && att.earlyOver ? att.earlyOver : 0;
  const absentDays = att && att.absent ? att.absent : 0;
  const rate = Number(dailyRate) || 0;
  const lateFine = enLate ? _round2(lateTimes * WAGE_DEDUCT_RULES.LATE_FINE_PER_TIME) : 0;
  const lateOverFine = enLate ? _round2(lateOverTimes * rate * WAGE_DEDUCT_RULES.LATE_OVER_DEDUCT_DAYS) : 0;
  const earlyFine = enEarly ? _round2(earlyTimes * WAGE_DEDUCT_RULES.LATE_FINE_PER_TIME) : 0;
  const earlyOverFine = enEarly ? _round2(earlyOverTimes * rate * WAGE_DEDUCT_RULES.LATE_OVER_DEDUCT_DAYS) : 0;
  const absentFine = enAbsent ? _round2(absentDays * rate * WAGE_DEDUCT_RULES.ABSENT_DEDUCT_DAYS) : 0;
  const total = _round2(lateFine + lateOverFine + earlyFine + earlyOverFine + absentFine);
  return {
    lateTimes, lateOverTimes, earlyTimes, earlyOverTimes, absentDays,
    lateFine, lateOverFine, earlyFine, earlyOverFine, absentFine, total
  };
}


const WAGE_DEDUCT_RULES = {
  LATE_FINE_PER_TIME: 20,       // 迟到/早退30分钟以内：20元/次
  LATE_OVER_DEDUCT_DAYS: 0.5,   // 迟到/早退超30分钟：按旷工半天，扣当日一半日工资
  ABSENT_DEDUCT_DAYS: 2,        // 旷工1天：扣两日工资
  SICK_DEDUCT_RATIO: 0.5,       // 病假扣回比例（monthly 底薪已全额发，病假按折算日薪50%扣回；可调）
  PERSONAL_LEAVE_MAX_TIMES: 2,  // 每月事假上限：2次
  PERSONAL_LEAVE_MAX_DAYS: 2    // 每月事假上限：累计2天
};

// 根据考勤聚合与日工资计算扣罚明细（performers 同步建条复用，保证两处口径一致）
// att: { workDays, nightShows, absent, leave, late, lateOver, early, earlyOver, sick, paidLeave }
// switches（可选）: { enLateDeduct, enEarlyDeduct, enAbsentDeduct }；不传或缺省一律启用（向后兼容）

module.exports = {
  _batchToApi,
  _ruleToApi,
  WORK_DAY_TYPES,
  _attendanceByStaff,
  _round2,
  _calcWageItem,
  SETTLE_MODES,
  SETTLE_PARAM_DEFAULTS,
  _sanitizeSettleParams,
  _calcSimpleTax,
  _calcSettleWageItem,
  toApi,
  computeAttendancePenalty,
  WAGE_DEDUCT_RULES,
};
