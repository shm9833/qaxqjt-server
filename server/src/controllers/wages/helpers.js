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
const { success, created, noContent } = require('../../utils/response');
const { idByCtx, nowMs } = require('../../config');
const { BusinessError } = require('../../middleware/error-handler');
const { audit } = require('../../services/audit-service');
const punchParamsSvc = require('../../services/punch-params');
const punchControlSvc = require('../../services/punch-control');

// ========== v20261024 区间结算（wrange1024）：从 batchNo 解析结算周期 ==========
// 子区间批次：WB-YYYYMM-YYYYMMDD-YYYYMMDD-<rand>（generate 生成，如 WB-202610-20261001-20261015-K3JH2X9M）
// 整月批次：WB-YYYYMM-<rand> 或自定义 batchNo → 返回 null（语义=整月；解析失败保守按整月处理，宁可多拦不错放）
function _parseBatchPeriod(batchNo, wageMonth) {
  if (!batchNo || typeof batchNo !== 'string') return null;
  const m = batchNo.match(/^WB-(\d{6})-(\d{8})-(\d{8})-[A-Za-z0-9]+$/);
  if (!m) return null;
  const s = m[2], e = m[3];
  const sd = s.substring(0, 4) + '-' + s.substring(4, 6) + '-' + s.substring(6, 8);
  const ed = e.substring(0, 4) + '-' + e.substring(4, 6) + '-' + e.substring(6, 8);
  if (sd > ed) return null;
  return { start: sd, end: ed };
}

function _batchToApi(row) {
  if (!row) return null;
  return {
    id: row.id,
    batchNo: row.batchNo,
    wageMonth: row.wageMonth,
    // v20261024 区间结算：{ start:'YYYY-MM-DD', end:'YYYY-MM-DD' } 或 null(=整月)
    settlePeriod: _parseBatchPeriod(row.batchNo, row.wageMonth),
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

async function _attendanceByStaff(month, range) {
  // v20261024 区间结算：传 range({gte,lt}) 时按考勤日期过滤（支持跨月子区间）；缺省按 attendanceMonth 整月
  const where = range && range.gte && range.lt
    ? { attendanceDate: { gte: range.gte, lt: range.lt } }
    : { attendanceMonth: month };
  // 一次性拉取该月全部考勤，按 staffId 聚合，避免 N 次查询
  const rows = await prisma.attendanceV1.findMany({
    where,
    select: { staffId: true, attendanceType: true, attendanceDate: true }
  });
  // v20261017 全团打卡总控：休假/暂停区间内的考勤记录统一跳过（不计工资、不进任何桶）
  const ctlState = await punchControlSvc.getState();
  const map = {};
  for (const r of rows) {
    if (r.attendanceDate && punchControlSvc.isDateExcludedIn(ctlState, r.attendanceDate.getTime())) continue;
    const m = map[r.staffId] || {
      workDays: 0, nightShows: 0, absent: 0, leave: 0, late: 0, lateOver: 0,
      early: 0, earlyOver: 0, sick: 0, paidLeave: 0,
      accident1: 0, accident2: 0, accident3: 0
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
    else if (t === 'stage_in' || t === 'stage_out') { /* 装台/卸台日：不计薪资、不计迟到、不计奖励，不进任何桶 */ }
    else if (t === 'accident_l1') m.accident1 += 1; // v20261012 事故分级：一级 10 元/天
    else if (t === 'accident_l2') m.accident2 += 1; // 二级 30 元/天
    else if (t === 'accident_l3') m.accident3 += 1; // 三级 50 元/天（代打卡查实按三级登记）
    map[r.staffId] = m;
  }
  return map;
}

// ========== v20261026 工资条订单溯源 → v20261027c 演出日期天数口径 ==========
// 返回 map: staffId -> { orders: { [orderId]: { orderNo, workDays, nightShows, showDays } }, fallback: { workDays, nightShows } }
// v20261027c 参与判定不再依赖考勤 scheduleId（生产数据 scheduleId 覆盖率为 0）：
//   考勤日期（任意类型，排除打卡总控暂停期）落在订单演出日期段 [performanceStartDate, performanceEndDate]
//   内即视为「参与该订单」，计薪天 showDays = 结算区间与演出段的交集天数（一天两场时 12 场 = 6 个工作日，
//   天工资 = 一个工作日）；同一考勤日期命中多个订单演出段时计入场次最多的订单（避免重复计薪）；
//   未命中任何订单演出段的计薪考勤归 fallback（非演出考勤，不计薪，仅展示）；
//   workDays 仍按 WORK_DAY_TYPES 聚合（展示用），nightShows 仅 night 类型累计。
async function _orderBreakdownByStaff(month, range) {
  const where = range && range.gte && range.lt
    ? { attendanceDate: { gte: range.gte, lt: range.lt } }
    : { attendanceMonth: month };
  const rows = await prisma.attendanceV1.findMany({
    where,
    select: { staffId: true, attendanceType: true, attendanceDate: true }
  });
  const ctlState = await punchControlSvc.getState();
  // 与结算区间有交集且未取消/退款的演出订单（同字段条件合并避免 Prisma 冲突）
  const rangeEnd = range && range.lt ? range.lt : new Date(Date.UTC(Number(month.substring(0, 4)), Number(month.substring(5, 7)), 1));
  const rangeStart = range && range.gte ? range.gte : new Date(month + '-01T00:00:00.000Z');
  const orders = await prisma.order.findMany({
    where: {
      status: { notIn: ['cancelled', 'refunded'] },
      performanceStartDate: { not: null, lt: rangeEnd },
      performanceEndDate: { not: null, gte: rangeStart }
    },
    select: { id: true, orderNo: true, performanceStartDate: true, performanceEndDate: true, performanceCount: true }
  });
  // 各订单结算区间∩演出段的工作日天数（含首尾；区间 [gte, lt) 开口收缩一天）
  const DAY = 86400000;
  const orderDays = {};
  for (const o of orders) {
    const s = Math.max(o.performanceStartDate.getTime(), rangeStart.getTime());
    const e = Math.min(o.performanceEndDate.getTime(), rangeEnd.getTime() - DAY);
    orderDays[o.id] = e >= s ? Math.round((e - s) / DAY) + 1 : 0;
  }
  const map = {};
  for (const r of rows) {
    if (r.attendanceDate && punchControlSvc.isDateExcludedIn(ctlState, r.attendanceDate.getTime())) continue;
    const t = r.attendanceDate ? r.attendanceDate.getTime() : null;
    const m = map[r.staffId] || { orders: {}, fallback: { workDays: 0, nightShows: 0 } };
    const payType = WORK_DAY_TYPES[r.attendanceType] != null;
    // 命中订单演出段：场次最多的订单优先（重叠日期段避免重复计薪）
    let hit = null;
    if (t != null) {
      for (const o of orders) {
        if (t >= o.performanceStartDate.getTime() && t <= o.performanceEndDate.getTime()) {
          if (!hit || (Number(o.performanceCount) || 1) > (Number(hit.performanceCount) || 1)) hit = o;
        }
      }
    }
    if (hit) {
      const b = m.orders[hit.id] || (m.orders[hit.id] = {
        orderNo: hit.orderNo || hit.id,
        workDays: 0, nightShows: 0,
        showDays: Math.max(1, orderDays[hit.id] || 1)
      });
      if (payType) {
        b.workDays += WORK_DAY_TYPES[r.attendanceType];
        if (r.attendanceType === 'night') b.nightShows += 1;
      }
    } else if (payType) {
      m.fallback.workDays += WORK_DAY_TYPES[r.attendanceType];
      if (r.attendanceType === 'night') m.fallback.nightShows += 1;
    }
    map[r.staffId] = m;
  }
  return map;
}

// ========== v20261012 迟到罚款新口径：按打卡记录分钟数（1元/分·单场封顶·≥30分本场失效）==========
// 逐月拉取迟到打卡（status late/late_invalid），按打卡参数的基准时间重算迟到分钟与罚款：
//   迟到罚款 = Σ min(迟到分钟 × lateFinePerMin, lateFineCap)
//   本场失效场数 = 迟到分钟 ≥ lateInvalidMinutes 的打卡次数（该场不计薪，在出勤天中扣减）
async function _punchLateStatsByStaff(month, P, range) {
  // v20261024 区间结算：传 range 时按区间过滤；缺省由 month 推导整月边界
  const start = range && range.gte ? range.gte : new Date(month + '-01T00:00:00.000Z');
  const end = range && range.lt ? range.lt : new Date(Date.UTC(Number(month.substring(0, 4)), Number(month.substring(5, 7)), 1));
  const rows = await prisma.employeePunchV1.findMany({
    where: { punchDate: { gte: start, lt: end }, punchType: 'in', status: { in: ['late', 'late_invalid'] } },
    select: { performerId: true, punchTime: true, status: true }
  });
  const map = {};
  for (const r of rows) {
    const mins = punchParamsSvc.cnMinutesFromUtcDate(r.punchTime);
    const session = punchParamsSvc.sessionForMinutes(mins, P);
    const baseline = session === 'night' ? punchParamsSvc.hmToMin(P.nightBaseline) : punchParamsSvc.hmToMin(P.dayBaseline);
    const lm = Math.max(0, mins - baseline);
    const invalid = r.status === 'late_invalid' || lm >= Number(P.lateInvalidMinutes);
    const fine = Math.min(Math.round(lm * Number(P.lateFinePerMin) * 100) / 100, Number(P.lateFineCap));
    const m = map[r.performerId] || { lateMinutes: 0, lateFine: 0, lateShows: 0, invalidShows: 0 };
    m.lateMinutes += lm;
    m.lateFine = Math.round((m.lateFine + fine) * 100) / 100;
    m.lateShows += 1;
    if (invalid) m.invalidShows += 1;
    map[r.performerId] = m;
  }
  return map;
}


// ========== v20261015 差旅路费归集：按月查询人员差旅路费，纳入工资核算 ==========
// 返回 map: performerId -> { total, count, items[] }
// expenseDate 为 DateTime 列，月份用日期范围过滤；scheduleTitle 关联 ScheduleV2 批量拼接
async function _travelExpenseByStaffMonth(month, range) {
  const y = Number(month.substring(0, 4));
  const m = Number(month.substring(5, 7));
  // v20261024 区间结算：传 range 时按区间过滤；缺省整月边界
  const gte = range && range.gte ? range.gte : new Date(Date.UTC(y, m - 1, 1));
  const lt = range && range.lt ? range.lt : new Date(Date.UTC(y, m, 1));
  // v20261028j 差旅宽限窗（travelgrace1028）：演出前 1~3 天的路费（如 10-19 赴 10-20 开演戏出的车费）
  // 天然落在结算区间 [10-20,10-28) 之外被漏计。区间结算时把差旅查询窗扩为 [gte-3天, lt+3天)，
  // 区间外的记录在 items 上标 graceOutside=true（工资条可注明「区间外宽限计入」）。
  // 注意：仅区间结算启用宽限（整月模式不扩窗，避免跨月双计）。
  const hasRange = !!(range && range.gte && range.lt);
  const graceGte = hasRange ? new Date(gte.getTime() - 3 * 86400000) : gte;
  const graceLt = hasRange ? new Date(lt.getTime() + 3 * 86400000) : lt;
  const rows = await prisma.travelExpenseV1.findMany({
    where: {
      expenseDate: { gte: graceGte, lt: graceLt },
      status: 'active'
    },
    select: { performerId: true, amount: true, expenseDate: true, scheduleId: true }
  });
  // 批量取场次标题
  const schedIds = [...new Set(rows.map(r => r.scheduleId).filter(Boolean))];
  const schedMap = {};
  if (schedIds.length) {
    const scheds = await prisma.scheduleV2.findMany({
      where: { id: { in: schedIds } },
      select: { id: true, playTitle: true, scheduleDateStart: true, venueAddress: true }
    });
    for (const s of scheds) {
      const d = s.scheduleDateStart ? new Date(s.scheduleDateStart).toISOString().substring(0, 10) : '';
      schedMap[s.id] = `${s.playTitle || ''} ${d} ${s.venueAddress || ''}`.trim();
    }
  }
  const map = {};
  for (const r of rows) {
    if (!r.performerId) continue;
    const m2 = map[r.performerId] || { total: 0, count: 0, items: [] };
    m2.total = Math.round((m2.total + (Number(r.amount) || 0)) * 100) / 100;
    m2.count += 1;
    m2.items.push({
      scheduleTitle: schedMap[r.scheduleId] || '',
      expenseDate: r.expenseDate ? new Date(r.expenseDate).toISOString().substring(0, 10) : '',
      amount: Number(r.amount) || 0,
      // v20261028j：区间外宽限计入的差旅（演出前 1~3 天路费），供工资条注明
      graceOutside: hasRange && !!(r.expenseDate && (r.expenseDate < gte || r.expenseDate >= lt))
    });
    map[r.performerId] = m2;
  }
  return map;
}

// ========== v20261017 借款归集：按月查询已审批未还清借款，纳入工资抵扣 ==========
// 返回 map: performerId -> { total, count, items[] }
async function _loanByStaffMonth(month, range) {
  const y = Number(month.substring(0, 4));
  const m = Number(month.substring(5, 7));
  // v20261024 区间结算：传 range 时按区间过滤；缺省整月边界
  const gte = range && range.gte ? range.gte : new Date(Date.UTC(y, m - 1, 1));
  const lt = range && range.lt ? range.lt : new Date(Date.UTC(y, m, 1));
  const rows = await prisma.employeeLoanV1.findMany({
    where: {
      loanDate: { gte, lt },
      status: 'approved'
    },
    select: { performerId: true, amount: true, repaidAmount: true, loanNo: true, loanDate: true }
  });
  const map = {};
  for (const r of rows) {
    if (!r.performerId) continue;
    const outstanding = Math.max(0, Number(r.amount) - Number(r.repaidAmount));
    if (outstanding <= 0) continue;
    const m2 = map[r.performerId] || { total: 0, count: 0, items: [] };
    m2.total = Math.round((m2.total + outstanding) * 100) / 100;
    m2.count += 1;
    m2.items.push({
      loanNo: r.loanNo,
      loanDate: r.loanDate ? new Date(r.loanDate).toISOString().substring(0, 10) : '',
      amount: Number(r.amount),
      repaidAmount: Number(r.repaidAmount),
      outstanding
    });
    map[r.performerId] = m2;
  }
  return map;
}


// ========== v20261028f 装卸车缺席归集：按月/区间统计每人装车/卸车缺席次数 ==========
// 口径（用户确认）：不论场次，装车记一次、卸车记一次，按实际参加记录（attend=false 计缺席）
// 返回 map: performerId -> { loadAbsent, unloadAbsent, absentCount, dates[] }（扣款额 = absentCount × 人员 loadUnloadDeduct）
async function _loadUnloadAbsentByStaffMonth(month, range) {
  const y = Number(month.substring(0, 4));
  const m = Number(month.substring(5, 7));
  const gte = range && range.gte ? range.gte : new Date(Date.UTC(y, m - 1, 1));
  const lt = range && range.lt ? range.lt : new Date(Date.UTC(y, m, 1));
  const rows = await prisma.loadUnloadRecordV1.findMany({
    where: { recordDate: { gte, lt }, attend: false },
    select: { performerId: true, recordType: true, recordDate: true }
  });
  const map = {};
  for (const r of rows) {
    if (!r.performerId) continue;
    // v20261029b items 逐笔明细（日期+装/卸），写入 otherDeductionNote 供工资条分项卡展示
    const m2 = map[r.performerId] || { loadAbsent: 0, unloadAbsent: 0, absentCount: 0, dates: [], items: [] };
    if (r.recordType === 'unload') m2.unloadAbsent += 1;
    else m2.loadAbsent += 1;
    m2.absentCount += 1;
    m2.dates.push(r.recordDate ? new Date(r.recordDate).toISOString().substring(0, 10) : '');
    m2.items.push({ date: r.recordDate ? new Date(r.recordDate).toISOString().substring(0, 10) : '', type: r.recordType === 'unload' ? 'unload' : 'load' });
    map[r.performerId] = m2;
  }
  return map;
}


function _round2(n) { return Math.round((Number(n) || 0) * 100) / 100; }

// v20261029a 装卸车扣款单价：人员档案 loadUnloadDeduct 优先；未配置（≤0/空）时兜底默认 30 元/次
// （与已配置人员口径一致），防止漏配单价导致登记缺席后工资条不出现扣款
const LU_DEDUCT_DEFAULT = 30;
function _luUnitPrice(perf, luAbsent) {
  if (!luAbsent) return 0;
  const v = Number(perf && perf.loadUnloadDeduct);
  return _round2(v > 0 ? v : LU_DEDUCT_DEFAULT);
}

// 计算单条工资（按天·纯日结：纯日薪口径）
// - dailyRate: 本人协议天工资（元/天），优先
// - rule: 职级工资规则（仅用于展示 rankGrade，不再参与日薪计算；Fix-20261012 按日薪结算不使用等级工资）
// - params: 薪资参数（v20261003：迟到/早退/旷工扣罚受 en* 核算项开关控制）
// - travelExp: 差旅路费数据（v20261015：{ total, count, items[] }，纳入 transportAllowance）
// v20261002b：只发日薪 − 扣罚，不再发放夜场补贴/全勤奖/交通/餐补等福利项
// v20261015：差旅路费纳入 transportAllowance，与工资合并计算
// v20261027b：showBased=true 时 workDays 为「演出场次数」（纯演出天数口径），备注中注明

function _calcWageItem(perf, att, rule, params, punchP, travelExp, loanExp, periodLabel, showBased, luExp) {
  const P = punchP || punchParamsSvc.DEFAULT_PUNCH_PARAMS;
  const invalidShows = att && att.invalidShows ? att.invalidShows : 0;
  // v20261012：迟到≥30分钟本场失效的场次不计薪（workDays 扣减）；装台/卸台日本就不进 workDays
  const workDays = Math.max(0, (att ? att.workDays : 0) - invalidShows);
  // Fix-20261012：按日薪结算（daily_pure）只使用本人协议天工资，不再兜底职级工资标准（等级工资）。
  // 无协议天工资的人员 baseWage=0（备注中标注未设置天工资），避免等级工资混入日薪结算口径。
  const hasPersonalRate = perf.dailyRate != null && Number(perf.dailyRate) > 0;
  const dailyRate = hasPersonalRate ? Number(perf.dailyRate) : 0;

  const baseWage = _round2(dailyRate * workDays);
  const nightShowBonus = 0;
  const fullAttendanceBonus = 0;
  // v20261015：差旅路费纳入 transportAllowance
  const transportAllowance = travelExp && travelExp.total ? _round2(travelExp.total) : 0;
  const mealAllowance = 0;

  const grossPay = _round2(baseWage + transportAllowance);

  // v20261017：借款抵扣（已审批未还清借款从工资中扣除，不超过应发）
  const loanDeduction = loanExp && loanExp.total ? _round2(loanExp.total) : 0;
  // v20261028f 装卸车缺席扣款：缺席次数 × 人员单价（loadUnloadDeduct）
  const luAbsent = luExp && luExp.absentCount ? luExp.absentCount : 0;
  const luUnit = _luUnitPrice(perf, luAbsent); // v20261029a 单价未配置时兜底默认30元/次
  const luDeduction = _round2(luAbsent * luUnit);

  // 考勤扣罚（v20261012 新口径）：迟到按打卡分钟 1元/分（单场封顶30元，≥30分本场失效不计薪）；
  // 早退/旷工仍按《员工管理条例》；事故分级按天 10/30/50 元（代打卡查实按三级）
  const penalty = computeAttendancePenalty(att, dailyRate, params || null, P);
  const lateTotal = _round2(penalty.lateFine);
  const earlyTotal = _round2(penalty.earlyFine + penalty.earlyOverFine);
  // 扣款不超过应发：实发不出现负数，未能扣足部分在备注中注明另行追缴
  // v20261017：先扣考勤罚，再扣借款，两者合计不超过 grossPay
  // v20261028f：扣款顺序 考勤罚 → 装卸车缺席 → 借款，合计不超过 grossPay
  const penaltyDeduction = _round2(Math.min(penalty.total, grossPay));
  const luDedApplied = _round2(Math.min(luDeduction, Math.max(0, grossPay - penaltyDeduction)));
  const loanDedApplied = _round2(Math.min(loanDeduction, Math.max(0, grossPay - penaltyDeduction - luDedApplied)));
  const totalDeduction = _round2(penaltyDeduction + luDedApplied + loanDedApplied);
  const unpaidCarryOver = _round2(Math.max(0, penalty.total + luDeduction + loanDeduction - grossPay));
  const netPay = _round2(grossPay - totalDeduction);

  const rateNote = hasPersonalRate
    ? `无底薪：协议天工资 ¥${dailyRate}/天 × ${workDays}${showBased ? '天（按订单演出日期计薪，一天两场）' : '天'}` + (invalidShows ? `（迟到满${P.lateInvalidMinutes}分钟本场失效${invalidShows}场已扣减）` : '')
    : `无底薪：未设置协议天工资，按日薪结算 baseWage=0（请在花名册维护天工资）`;
  const penaltyParts = [];
  if (penalty.lateFine) penaltyParts.push(`迟到${att && att.lateMinutes ? att.lateMinutes : 0}分钟（${att && att.lateShows ? att.lateShows : 0}场）按${P.lateFinePerMin}元/分钟·单场封顶${P.lateFineCap}元=¥${penalty.lateFine}`);
  if (invalidShows) penaltyParts.push(`迟到满${P.lateInvalidMinutes}分钟${invalidShows}场本场失效，该场不计薪`);
  if (penalty.accidentFine) penaltyParts.push(`事故扣款：一级${att && att.accident1 ? att.accident1 : 0}天×${P.accidentLevel1Fine}元 + 二级${att && att.accident2 ? att.accident2 : 0}天×${P.accidentLevel2Fine}元 + 三级${att && att.accident3 ? att.accident3 : 0}天×${P.accidentLevel3Fine}元=¥${penalty.accidentFine}`);
  if (penalty.earlyFine) penaltyParts.push(`早退${penalty.earlyTimes}次×20元=¥${penalty.earlyFine}`);
  if (penalty.earlyOverFine) penaltyParts.push(`早退超30分钟${penalty.earlyOverTimes}次按旷工半天扣¥${penalty.earlyOverFine}`);
  if (penalty.absentFine) penaltyParts.push(`旷工${penalty.absentDays}天扣两日工资¥${penalty.absentFine}`);
  if (luDedApplied) penaltyParts.push(`装卸车缺席${luAbsent}次（装${luExp.loadAbsent || 0}/卸${luExp.unloadAbsent || 0}）×¥${luUnit}=¥${luDedApplied}`);
  if (unpaidCarryOver) penaltyParts.push(`扣罚超出应发¥${unpaidCarryOver}，本次按0元发放，余额依条例另行追缴`);
  // v20261024 区间结算：子区间批次在备注中标注结算周期（如「结算周期 10-01~10-15」），工资条可追溯
  const rateNoteBase = rateNote + (periodLabel ? `；结算周期 ${periodLabel}` : '');
  const remark = penaltyParts.length ? `${rateNoteBase}；扣罚：${penaltyParts.join('；')}` : rateNoteBase;

  const otherDeduction = _round2(penalty.absentFine + lateTotal + earlyTotal + penalty.accidentFine);
  return {
    performerId: perf.id,
    performerName: perf.name,
    staffNo: perf.staffNo || null,
    rankGrade: perf.rankGrade || null,
    attendanceDays: workDays,
    dailyRate: dailyRate,
    wageMode: 'daily_pure',
    baseWage,
    nightShowBonus,
    fullAttendanceBonus,
    transportAllowance,
    mealAllowance,
    grossPay,
    loanDeduction: loanDedApplied,
    otherDeduction,
    totalDeduction,
    netPay,
    travelExpenseTotal: transportAllowance,
    travelExpenseCount: travelExp && travelExp.count ? travelExp.count : 0,
    travelExpenseItems: travelExp && travelExp.items ? travelExp.items : [],
    otherDeductionNote: JSON.stringify({
      mode: 'daily_pure',
      leave: 0,              // 纯日结按出勤天计酬，请假日无日薪（workDays 已体现），不另扣
      absent: penalty.absentFine,
      late: lateTotal,
      early: earlyTotal,
      accident: penalty.accidentFine,
      accident1: att && att.accident1 ? att.accident1 : 0,
      accident2: att && att.accident2 ? att.accident2 : 0,
      accident3: att && att.accident3 ? att.accident3 : 0,
      invalidShows,
      lateMinutes: att && att.lateMinutes ? att.lateMinutes : 0,
      lateShows: att && att.lateShows ? att.lateShows : 0,
      unpaidCarryOver,
      travelExpense: transportAllowance,
      travelExpenseCount: travelExp && travelExp.count ? travelExp.count : 0,
      travelExpenseItems: travelExp && travelExp.items ? travelExp.items : [],
      loanDeduction: loanDedApplied,
      loanItems: loanExp && loanExp.items ? loanExp.items : [],
      loadUnloadDeduction: luDedApplied,
      loadUnloadAbsentCount: luAbsent,
      loadUnloadUnitPrice: luUnit,
      loadUnloadItems: luExp && Array.isArray(luExp.items) ? luExp.items : []
    }),
    remark: remark
      + (transportAllowance > 0 ? `；差旅路费¥${transportAllowance}（${travelExp.count}笔）` : '')
      + (luDedApplied > 0 ? `；装卸车缺席扣¥${luDedApplied}（${luAbsent}次×¥${luUnit}）` : '')
      + (loanDedApplied > 0 ? `；借款抵扣¥${loanDedApplied}（${loanExp.count}笔）` : '')
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

function _calcSettleWageItem(perf, att, mode, params, luExp) {
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

  // 扣款：迟到 v20261012 新口径（按打卡分钟 1元/分·封顶30，att.lateFinePunch 预聚合；无打卡迟到记录时回退按次定额），
  // 旷工按折算日薪×倍数；按月模式另扣事假（按折算日薪）；各项受开关控制；事故分级按天 10/30/50
  const lateFine = params.enLateDeduct
    ? _round2(att && att.lateFinePunch != null ? att.lateFinePunch : lateTimes * params.lateDeduct) : 0;
  const earlyFine = params.enEarlyDeduct ? _round2(earlyTimes * params.earlyDeduct) : 0;
  const absentFine = params.enAbsentDeduct ? _round2(absentDays * dailyBase * params.absentMult) : 0;
  const leaveFine = (isMonthly && params.enLeaveDeduct) ? _round2(leaveDays * dailyBase) : 0;
  // 病假：仅按月结算需从已全额发放的底薪中扣回（折算模式病假不在出勤天，天然少发）；比例 50%，与事假同受假期扣款开关控制
  const sickFine = (isMonthly && params.enLeaveDeduct)
    ? _round2(sickDays * dailyBase * WAGE_DEDUCT_RULES.SICK_DEDUCT_RATIO) : 0;
  const social = params.enSocial ? _round2(params.social) : 0;
  const tax = params.enTax ? _calcSimpleTax(grossPay, params) : 0;
  // v20261012：事故分级扣款（元/天）按考勤登记计入，不受开关控制
  const accidentFine = _round2(
    (att && att.accident1 ? att.accident1 : 0) * 10
    + (att && att.accident2 ? att.accident2 : 0) * 30
    + (att && att.accident3 ? att.accident3 : 0) * 50
  );
  // v20261028f 装卸车缺席扣款（按登记记录计次 × 人员单价）
  const luAbsent = luExp && luExp.absentCount ? luExp.absentCount : 0;
  const luUnit = _luUnitPrice(perf, luAbsent); // v20261029a 单价未配置时兜底默认30元/次
  const luFine = _round2(luAbsent * luUnit);
  const deductionRaw = _round2(lateFine + earlyFine + absentFine + leaveFine + sickFine + social + tax + accidentFine + luFine);
  // 实发不为负：超出应发部分在备注中注明另行追缴
  const totalDeduction = _round2(Math.min(deductionRaw, grossPay));
  const unpaidCarryOver = _round2(Math.max(0, deductionRaw - grossPay));
  const netPay = _round2(grossPay - totalDeduction);

  const parts = [];
  if (leaveFine) parts.push(`事假${leaveDays}天×¥${dailyBase}=¥${leaveFine}`);
  if (sickFine) parts.push(`病假${sickDays}天×¥${dailyBase}×50%=¥${sickFine}`);
  if (absentFine) parts.push(`旷工${absentDays}天×¥${dailyBase}×${params.absentMult}=¥${absentFine}`);
  if (lateFine) parts.push(`迟到${lateTimes}次按新规¥${lateFine}`);
  if (earlyFine) parts.push(`早退${earlyTimes}次×¥${params.earlyDeduct}=¥${earlyFine}`);
  if (accidentFine) parts.push(`事故扣款：一级${att && att.accident1 ? att.accident1 : 0}天 + 二级${att && att.accident2 ? att.accident2 : 0}天 + 三级${att && att.accident3 ? att.accident3 : 0}天=¥${accidentFine}`);
  if (luFine) parts.push(`装卸车缺席${luAbsent}次×¥${luUnit}=¥${luFine}`);
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
    wageMode: mode,
    baseWage,
    nightShowBonus,
    fullAttendanceBonus,
    transportAllowance: 0,
    mealAllowance: 0,
    otherDeduction: _round2(leaveFine + sickFine + absentFine + lateFine + earlyFine + accidentFine),
    socialInsuranceDeduct: social,
    taxDeduct: tax,
    loadUnloadDeduction: luFine,
    grossPay,
    totalDeduction,
    netPay,
    otherDeductionNote: JSON.stringify({
      mode,
      leave: leaveFine, sick: sickFine, absent: absentFine, late: lateFine, early: earlyFine,
      accident: accidentFine,
      accident1: att && att.accident1 ? att.accident1 : 0,
      accident2: att && att.accident2 ? att.accident2 : 0,
      accident3: att && att.accident3 ? att.accident3 : 0,
      leaveDays, sickDays, absentDays, lateTimes, earlyTimes,
      social, tax, dailyBase, unpaidCarryOver,
      loadUnloadDeduction: luFine,
      loadUnloadAbsentCount: luAbsent,
      loadUnloadUnitPrice: luUnit,
      loadUnloadItems: luExp && Array.isArray(luExp.items) ? luExp.items : []
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
  // v20261015：从 otherDeductionNote JSON 解析差旅路费明细
  var travelExpenseTotal = 0, travelExpenseCount = 0, travelExpenseItems = [];
  try {
    if (row.otherDeductionNote) {
      var parsed2 = JSON.parse(row.otherDeductionNote);
      if (parsed2 && typeof parsed2 === 'object') {
        travelExpenseTotal = Number(parsed2.travelExpense) || 0;
        travelExpenseCount = Number(parsed2.travelExpenseCount) || 0;
        travelExpenseItems = Array.isArray(parsed2.travelExpenseItems) ? parsed2.travelExpenseItems : [];
      }
    }
  } catch (_) {}
  // v20261026：订单收入明细（JSON 文本 → 数组 [{orderId,orderNo,workDays,nightShows,baseShare}]）
  var orderBreakdown = [];
  try {
    if (row.orderBreakdown) {
      var ob = JSON.parse(row.orderBreakdown);
      if (Array.isArray(ob)) orderBreakdown = ob;
    }
  } catch (_) {}
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
    travelExpenseTotal: travelExpenseTotal,
    travelExpenseCount: travelExpenseCount,
    travelExpenseItems: travelExpenseItems,
    orderBreakdown: orderBreakdown,
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
    reviewStatus: row.reviewStatus || 'pending',
    reviewedBy: row.reviewedBy || '',
    reviewedAt: row.reviewedAt ? new Date(row.reviewedAt).toISOString() : '',
    dailyRate: row.dailyRate != null ? Number(row.dailyRate) : 0,
    isFull: fullBonus > 0 ? 1 : 0,
    payslipPublished: row.payslipPublished ? 1 : 0,
    payslipPublishedAt: row.payslipPublishedAt ? new Date(row.payslipPublishedAt).toISOString() : '',
    remark: row.remark || '',
    createdAt: row.createdAt ? new Date(row.createdAt).toISOString() : '',
    updatedAt: row.updatedAt ? new Date(row.updatedAt).toISOString() : ''
  };
}


function computeAttendancePenalty(att, dailyRate, switches, punchP) {
  const sw = switches && typeof switches === 'object' ? switches : {};
  const P = punchP || punchParamsSvc.DEFAULT_PUNCH_PARAMS;
  const enLate = sw.enLateDeduct !== false;
  const enEarly = sw.enEarlyDeduct !== false;
  const enAbsent = sw.enAbsentDeduct !== false;
  const lateTimes = att && att.late ? att.late : 0;
  const lateOverTimes = att && att.lateOver ? att.lateOver : 0;
  const earlyTimes = att && att.early ? att.early : 0;
  const earlyOverTimes = att && att.earlyOver ? att.earlyOver : 0;
  const absentDays = att && att.absent ? att.absent : 0;
  const rate = Number(dailyRate) || 0;
  // v20261012 新口径：迟到罚款按打卡分钟数计算（1元/分·单场封顶30元），由 _punchLateStatsByStaff
  // 预聚合到 att.lateFinePunch；旧「20元/次 + 超30分钟扣半日」口径废止（本场失效不计薪已在出勤天扣减）
  const lateFine = enLate ? _round2(att && att.lateFinePunch ? att.lateFinePunch : 0) : 0;
  const lateOverFine = 0;
  const earlyFine = enEarly ? _round2(earlyTimes * WAGE_DEDUCT_RULES.LATE_FINE_PER_TIME) : 0;
  const earlyOverFine = enEarly ? _round2(earlyOverTimes * rate * WAGE_DEDUCT_RULES.LATE_OVER_DEDUCT_DAYS) : 0;
  const absentFine = enAbsent ? _round2(absentDays * rate * WAGE_DEDUCT_RULES.ABSENT_DEDUCT_DAYS) : 0;
  // 事故分级扣款（元/天）：一级/二级/三级由管理侧按天登记（accident_l1/l2/l3），代打卡查实按三级；不受开关控制
  const accidentFine = _round2(
    (att && att.accident1 ? att.accident1 : 0) * Number(P.accidentLevel1Fine)
    + (att && att.accident2 ? att.accident2 : 0) * Number(P.accidentLevel2Fine)
    + (att && att.accident3 ? att.accident3 : 0) * Number(P.accidentLevel3Fine)
  );
  const total = _round2(lateFine + lateOverFine + earlyFine + earlyOverFine + absentFine + accidentFine);
  return {
    lateTimes, lateOverTimes, earlyTimes, earlyOverTimes, absentDays,
    lateFine, lateOverFine, earlyFine, earlyOverFine, absentFine, accidentFine, total
  };
}


// ========== v20261028f 草稿工资自动同步（差旅路费 / 装卸车登记变动后） ==========
// 语义：仅重算「草稿」批次中该人员的工资条；已确认/过账批次为快照，冻结不动。
// 全程 try/catch，任何异常不阻塞登记主操作（同步失败可由批次重新生成兜底）。
const _AUDIT_SYS_CTX = { state: { user: { username: 'system' } }, ip: null, get: () => '' };

function _monthLastDayStrL(month) {
  const y = Number(month.substring(0, 4)), m = Number(month.substring(5, 7));
  return month + '-' + String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, '0');
}

function _normDateStrL(v) {
  if (!v) return '';
  if (v instanceof Date) return isNaN(v.getTime()) ? '' : v.toISOString().substring(0, 10);
  return String(v).substring(0, 10);
}

// 重算一条草稿工资行（按所在批次结算区间归集），返回是否落库
async function _resyncDraftWageRow(row, batch, perf) {
  const p = _parseBatchPeriod(batch.batchNo, batch.wageMonth);
  const monthForCalc = p ? p.start.substring(0, 7) : batch.wageMonth;
  const range = p ? { gte: new Date(p.start + 'T00:00:00.000Z'), lt: new Date(new Date(p.end + 'T00:00:00.000Z').getTime() + 86400000) } : null;
  const punchP = await punchParamsSvc.getPunchParams();
  const [attMap, punchMap, travelExpMap, loanExpMap, luMap] = await Promise.all([
    _attendanceByStaff(monthForCalc, range),
    _punchLateStatsByStaff(monthForCalc, punchP, range),
    _travelExpenseByStaffMonth(monthForCalc, range),
    _loanByStaffMonth(monthForCalc, range),
    _loadUnloadAbsentByStaffMonth(monthForCalc, range)
  ]);
  const att0 = attMap[perf.id] || { workDays: 0, nightShows: 0, absent: 0, leave: 0, late: 0, lateOver: 0, early: 0, earlyOver: 0, sick: 0, paidLeave: 0 };
  const ps = punchMap[perf.id];
  if (ps) { att0.lateFinePunch = ps.lateFine; att0.lateMinutes = ps.lateMinutes; att0.lateShows = ps.lateShows; att0.invalidShows = ps.invalidShows; }
  const travelExp = travelExpMap[perf.id] || null;
  const loanExp = loanExpMap[perf.id] || null;
  const luExp = luMap[perf.id] || null;
  const rule = perf.rankGrade ? await prisma.wageRulesV1.findFirst({ where: { rankGrade: perf.rankGrade, status: 'active' } }) : null;
  const settleParams = _sanitizeSettleParams(null);
  const mode = (row.wageMode && SETTLE_MODES.indexOf(row.wageMode) >= 0) ? row.wageMode : 'daily_pure';

  let data;
  let deltaAllow = 0;
  if (mode === 'daily_pure') {
    // 与 generate 同口径全量重算；orderBreakdown 保留原值（订单归属不因报销/装卸变动）
    const ob = (() => { try { return row.orderBreakdown ? JSON.parse(row.orderBreakdown) : null; } catch (_) { return null; } })();
    let showDaysTotal = 0;
    if (Array.isArray(ob)) ob.forEach(o => { showDaysTotal += o.showDays || 0; });
    const attForCalc = showDaysTotal > 0 ? Object.assign({}, att0, { workDays: showDaysTotal }) : att0;
    const periodLabel = p ? (p.start.substring(0, 4) === p.end.substring(0, 4) ? p.start.substring(5) + '~' + p.end.substring(5) : p.start + '~' + p.end) : '';
    const patch = _calcWageItem(perf, attForCalc, rule, settleParams, punchP, travelExp, loanExp, periodLabel, showDaysTotal > 0, luExp);
    deltaAllow = _round2(patch.transportAllowance - (Number(row.transportAllowance) || 0));
    data = {
      attendanceDays: patch.attendanceDays,
      baseWage: patch.baseWage,
      transportAllowance: patch.transportAllowance,
      otherDeduction: patch.otherDeduction,
      otherDeductionNote: patch.otherDeductionNote,
      loanDeduction: patch.loanDeduction || 0,
      grossPay: patch.grossPay,
      totalDeduction: patch.totalDeduction,
      netPay: patch.netPay,
      remark: patch.remark,
      ts: BigInt(nowMs())
    };
  } else {
    // daily_prorated / monthly：底薪与考勤扣罚维持原值，仅把装卸车缺席扣款并入合计（该模式差旅不并入应发）
    const note = (() => { try { return row.otherDeductionNote ? JSON.parse(row.otherDeductionNote) : {}; } catch (_) { return {}; } })();
    const luAbsent = luExp && luExp.absentCount ? luExp.absentCount : 0;
    const luUnit = _luUnitPrice(perf, luAbsent); // v20261029a 单价未配置时兜底默认30元/次
    const luFine = _round2(luAbsent * luUnit);
    const dedRaw = _round2((Number(note.leave) || 0) + (Number(note.sick) || 0) + (Number(note.absent) || 0) + (Number(note.late) || 0)
      + (Number(note.early) || 0) + (Number(note.accident) || 0) + (Number(note.social) || 0) + (Number(note.tax) || 0) + luFine);
    const gross = Number(row.grossPay) || 0;
    const totalDeduction = _round2(Math.min(dedRaw, gross));
    const unpaid = _round2(Math.max(0, dedRaw - gross));
    const netPay = _round2(gross - totalDeduction);
    let remark = String(row.remark || '').split('；装卸车')[0];
    if (luFine) remark += `；装卸车缺席${luAbsent}次×¥${luUnit}=¥${luFine}`;
    note.loadUnloadDeduction = luFine;
    note.loadUnloadAbsentCount = luAbsent;
    note.loadUnloadUnitPrice = luUnit;
    note.loadUnloadItems = luExp && Array.isArray(luExp.items) ? luExp.items : [];
    note.unpaidCarryOver = unpaid;
    data = {
      totalDeduction,
      netPay,
      otherDeductionNote: JSON.stringify(note),
      remark,
      ts: BigInt(nowMs())
    };
  }

  const oldTot = Number(row.totalDeduction) || 0;
  const oldNet = Number(row.netPay) || 0;
  await prisma.$transaction([
    prisma.wageItemsV1.update({ where: { id: row.id }, data }),
    prisma.wageBatchesV1.update({
      where: { id: batch.id },
      data: {
        ...(deltaAllow ? { totalAllowance: { increment: deltaAllow } } : {}),
        totalDeduction: { increment: _round2((Number(data.totalDeduction) || 0) - oldTot) },
        totalNetPay: { increment: _round2((Number(data.netPay) || 0) - oldNet) }
      }
    })
  ]);
  try {
    await audit({
      ctx: _AUDIT_SYS_CTX, module: 'wage', action: 'WAGE_AUTO_SYNC', targetId: row.id,
      detail: {
        performerId: perf.id, performerName: perf.name, batchNo: batch.batchNo, mode,
        travelTotal: Number(data.transportAllowance) || 0,
        luDeduction: (() => { try { return Number(JSON.parse(data.otherDeductionNote).loadUnloadDeduction) || 0; } catch (_) { return 0; } })(),
        netPay: Number(data.netPay) || 0
      }
    });
  } catch (_) {}
  return true;
}

// 差旅路费 / 装卸车登记变动后调用：同步覆盖该日期的草稿批次中该人员的工资条
async function syncDraftWageForPerformer(performerId, dateStr) {
  try {
    const ds = _normDateStrL(dateStr);
    if (!performerId || !ds || !/^\d{4}-\d{2}-\d{2}$/.test(ds)) return false;
    const month = ds.substring(0, 7);
    const batches = await prisma.wageBatchesV1.findMany({ where: { wageMonth: month, status: 'draft' } });
    if (!batches.length) return false;
    const perf = await prisma.performersDbV1.findUnique({
      where: { id: performerId },
      select: { id: true, name: true, staffNo: true, rankGrade: true, dailyRate: true, loadUnloadDeduct: true }
    });
    if (!perf) return false;
    const hits = batches.filter(b => {
      const p = _parseBatchPeriod(b.batchNo, b.wageMonth);
      const bs = p ? p.start : (b.wageMonth + '-01');
      const be = p ? p.end : _monthLastDayStrL(b.wageMonth);
      return bs <= ds && ds <= be;
    });
    let done = false;
    for (const b of hits) {
      const row = await prisma.wageItemsV1.findFirst({ where: { batchId: b.id, performerId } });
      if (row) { await _resyncDraftWageRow(row, b, perf); done = true; }
    }
    return done;
  } catch (_) { return false; } // 同步失败不阻塞登记主操作
}

// 人员装卸车单价（loadUnloadDeduct）变化后调用：同步该人员全部草稿工资条
async function syncDraftWagesForPerformerAll(performerId) {
  try {
    if (!performerId) return false;
    const perf = await prisma.performersDbV1.findUnique({
      where: { id: performerId },
      select: { id: true, name: true, staffNo: true, rankGrade: true, dailyRate: true, loadUnloadDeduct: true }
    });
    if (!perf) return false;
    const rows = await prisma.wageItemsV1.findMany({
      where: { performerId, batch: { status: 'draft' } },
      include: { batch: true }
    });
    let done = false;
    for (const row of rows) {
      if (row.batch) { await _resyncDraftWageRow(row, row.batch, perf); done = true; }
    }
    return done;
  } catch (_) { return false; }
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
  _parseBatchPeriod,
  _ruleToApi,
  WORK_DAY_TYPES,
  _attendanceByStaff,
  _orderBreakdownByStaff,
  _punchLateStatsByStaff,
  _travelExpenseByStaffMonth,
  _loanByStaffMonth,
  _loadUnloadAbsentByStaffMonth,
  syncDraftWageForPerformer,
  syncDraftWagesForPerformerAll,
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
