'use strict';

/**
 * src/controllers/wage-report.js —— 真实统计与报表：员工日薪实时统计
 * GET /v1/reports/daily-wage
 *
 * 口径与工资核算 daily_pure（wages.js）完全一致，保证"报表数 = 工资数"：
 *   出勤天：full/night/double=1，half=0.5；迟到满30分钟本场失效的场次不计薪（出勤天扣减）
 *   日薪取价：本人协议天工资 dailyRate（按日薪结算不使用等级工资兜底）
 *   应发日薪合计 = 日薪 × 出勤天（round2）
 *   扣罚 = 迟到按打卡分钟1元/分（单场封顶30元，≥30分本场失效不计薪）+ 早退/旷工按条例 + 事故分级10/30/50元/天
 *          （computeAttendancePenalty 唯一口径，迟到罚款来自打卡记录重算）
 *   实发 = 应发 − min(扣罚, 应发)（不为负，超出部分另行追缴）
 *
 * 维度：date=按日期 / performer=按人员 / empType=按用工类型 / rank=按职级
 * 数据实时计算：每次请求均从考勤表 + 花名册现算，不读工资批次快照
 */
const prisma = require('../utils/prisma');
const { success } = require('../utils/response');
const { BusinessError } = require('../middleware/error-handler');
const { computeAttendancePenalty, _punchLateStatsByStaff } = require('./wages');
const punchParamsSvc = require('../services/punch-params');

const WORK_DAY_TYPES = { full: 1, night: 1, double: 1, half: 0.5 }; // 与 wages.js WORK_DAY_TYPES 一致
const LEAVE_TYPES = ['leave', 'outing', 'study', 'business', 'injury'];
const GROUP_BYS = ['date', 'performer', 'empType', 'rank'];
const round2 = n => Math.round((Number(n) || 0) * 100) / 100;
const dateKey = d => (d ? new Date(d).toISOString().substring(0, 10) : '');

const dailyWage = async ctx => {
  const month = String(ctx.query.month || '');
  if (!/^\d{4}-\d{2}$/.test(month)) {
    throw new BusinessError('VALIDATION_ERROR', 'month 必填（YYYY-MM）');
  }
  const groupBy = GROUP_BYS.indexOf(ctx.query.groupBy) >= 0 ? ctx.query.groupBy : 'date';
  const day = /^\d{2}$/.test(String(ctx.query.day || '')) ? String(ctx.query.day) : null; // DD，按日下钻
  const empTypeF = String(ctx.query.empType || '').trim();
  const rankF = String(ctx.query.rank || '').trim();
  const kw = String(ctx.query.keyword || '').trim();

  // 1) 在册人员 + 职级日薪兜底规则（一次取齐）
  const [performers, ruleRows] = await Promise.all([
    prisma.performersDbV1.findMany({
      where: { status: { not: 'deleted' } },
      select: {
        id: true, staffNo: true, name: true, rankGrade: true,
        primaryRole: true, employmentType: true, dailyRate: true
      }
    }),
    prisma.wageRulesV1.findMany({
      where: { status: 'active' },
      select: { rankGrade: true, baseDailyStandard: true }
    })
  ]);
  const ruleMap = {};
  ruleRows.forEach(r => { ruleMap[r.rankGrade] = Number(r.baseDailyStandard) || 0; });

  let staff = performers;
  if (empTypeF) staff = staff.filter(p => (p.employmentType || '') === empTypeF);
  if (rankF) staff = staff.filter(p => (p.rankGrade || '') === rankF);
  if (kw) {
    staff = staff.filter(p =>
      (p.name || '').indexOf(kw) >= 0 ||
      (p.staffNo || '').indexOf(kw) >= 0 ||
      (p.primaryRole || '').indexOf(kw) >= 0
    );
  }
  const staffMap = {};
  staff.forEach(p => { staffMap[p.id] = p; });

  // 2) 当月考勤明细（实时现算，不读批次快照）
  const attRows = await prisma.attendanceV1.findMany({
    where: { attendanceMonth: month },
    select: { staffId: true, attendanceType: true, attendanceDate: true }
  });

  // v20261012 打卡新规：打卡参数 + 按打卡记录重算迟到分钟/罚款/本场失效
  const punchP = await punchParamsSvc.getPunchParams();
  const punchMap = await _punchLateStatsByStaff(month, punchP);

  // 3) 逐人聚合：出勤天/应发/异常计数 + 按日明细
  const perPerson = {};
  for (const r of attRows) {
    const p = staffMap[r.staffId];
    if (!p) continue;
    const rate = (p.dailyRate != null && Number(p.dailyRate) > 0)
      ? Number(p.dailyRate)
      : (ruleMap[p.rankGrade] || 0);
    const m = perPerson[p.id] || {
      p, rate, workDays: 0, late: 0, lateOver: 0, absent: 0, leave: 0,
      accident1: 0, accident2: 0, accident3: 0,
      byDate: {}
    };
    const t = r.attendanceType;
    const w = WORK_DAY_TYPES[t];
    if (w != null) {
      m.workDays += w;
      const dk = dateKey(r.attendanceDate);
      const dayHit = !day || (dk && dk.substring(8, 10) === day);
      if (dayHit) {
        // 命中（未指定 day 或当日）：计入按日明细与月度合计
        m.byDate[dk] = m.byDate[dk] || { headcountSet: {}, workDays: 0, gross: 0 };
        m.byDate[dk].workDays += w;
        m.byDate[dk].gross += rate * w;
        m.byDate[dk].headcountSet[p.id] = 1;
      } else {
        // 指定 day 下钻：非当日出勤从月度合计剔除（下钻只看当日；异常扣罚计数不受影响）
        m.workDays -= w;
        m.workDays = round2(m.workDays);
      }
    } else if (t === 'absent') m.absent += 1;
    else if (t === 'late') m.late += 1;
    else if (t === 'late_over') { m.lateOver += 1; m.late += 1; } // 与 wages.js 一致：同时计入迟到次数
    else if (LEAVE_TYPES.indexOf(t) >= 0) m.leave += 1;
    else if (t === 'stage_in' || t === 'stage_out') { /* 装台/卸台日：不计薪资、不计迟到、不计奖励 */ }
    else if (t === 'accident_l1') m.accident1 += 1;
    else if (t === 'accident_l2') m.accident2 += 1;
    else if (t === 'accident_l3') m.accident3 += 1;
    perPerson[p.id] = m;
  }

  // 4) 逐人结算：应发/扣罚/实发（computeAttendancePenalty 唯一口径；迟到罚款按打卡分钟）
  const persons = Object.keys(perPerson).map(id => {
    const m = perPerson[id];
    const ps = punchMap[id];
    const invalidShows = ps ? ps.invalidShows : 0;
    // 迟到满30分钟本场失效的场次不计薪：出勤天扣减（与 wages.generate 口径一致）
    const effDays = Math.max(0, round2(m.workDays - invalidShows));
    const gross = round2(m.rate * effDays);
    const penalty = computeAttendancePenalty(
      {
        workDays: effDays, nightShows: 0, absent: m.absent, leave: m.leave,
        late: m.late, lateOver: m.lateOver,
        accident1: m.accident1, accident2: m.accident2, accident3: m.accident3,
        lateFinePunch: ps ? ps.lateFine : 0,
        lateMinutes: ps ? ps.lateMinutes : 0,
        lateShows: ps ? ps.lateShows : 0
      },
      m.rate, null, punchP
    );
    const deduction = round2(Math.min(penalty.total, gross));
    const net = round2(gross - deduction);
    return {
      p: m.p, rate: m.rate, workDays: effDays, gross,
      late: m.late, lateOver: m.lateOver, absent: m.absent, leave: m.leave,
      invalidShows, lateMinutes: ps ? ps.lateMinutes : 0,
      penalty, deduction, net, byDate: m.byDate
    };
  });

  const sum = (arr, f) => round2(arr.reduce((s, x) => s + (Number(f(x)) || 0), 0));
  const totals = {
    headcount: persons.length,
    workDays: sum(persons, x => x.workDays),
    gross: sum(persons, x => x.gross),
    deduction: sum(persons, x => x.deduction),
    net: sum(persons, x => x.net)
  };

  // 5) 按维度出行
  let rows = [];
  if (groupBy === 'performer') {
    rows = persons
      .map(x => ({
        performerId: x.p.id,
        name: x.p.name,
        staffNo: x.p.staffNo || '',
        primaryRole: x.p.primaryRole || '',
        employmentType: x.p.employmentType || '',
        rankGrade: x.p.rankGrade || '',
        dailyRate: x.rate,
        workDays: x.workDays,
        gross: x.gross,
        lateTimes: x.penalty.lateTimes,
        lateOverTimes: x.penalty.lateOverTimes,
        absentDays: x.penalty.absentDays,
        leaveDays: x.leave,
        lateFine: x.penalty.lateFine,
        lateOverFine: x.penalty.lateOverFine,
        absentFine: x.penalty.absentFine,
        deduction: x.deduction,
        net: x.net
      }))
      .sort((a, b) => b.net - a.net || b.gross - a.gross);
  } else if (groupBy === 'empType' || groupBy === 'rank') {
    const bucket = {};
    const keyOf = groupBy === 'empType'
      ? x => (x.p.employmentType || '未填')
      : x => (x.p.rankGrade || '未定');
    persons.forEach(x => {
      const k = keyOf(x);
      const b = bucket[k] || { key: k, headcount: 0, workDays: 0, gross: 0, deduction: 0, net: 0 };
      b.headcount += 1;
      b.workDays += x.workDays;
      b.gross += x.gross;
      b.deduction += x.deduction;
      b.net += x.net;
      bucket[k] = b;
    });
    rows = Object.keys(bucket)
      .map(k => {
        const b = bucket[k];
        return {
          key: b.key,
          headcount: b.headcount,
          workDays: round2(b.workDays),
          gross: round2(b.gross),
          deduction: round2(b.deduction),
          net: round2(b.net)
        };
      })
      .sort((a, b) => b.net - a.net);
  } else {
    // date：按日期汇总（应发日薪合计为当日 Σ日薪×权重；扣罚为月度口径，不在日行体现）
    const dayMap = {};
    persons.forEach(x => {
      Object.keys(x.byDate).forEach(dk => {
        const d = x.byDate[dk];
        const b = dayMap[dk] || { date: dk, headcountSet: {}, workDays: 0, gross: 0 };
        Object.keys(d.headcountSet).forEach(id => { b.headcountSet[id] = 1; });
        b.workDays += d.workDays;
        b.gross += d.gross;
        dayMap[dk] = b;
      });
    });
    rows = Object.keys(dayMap)
      .map(dk => ({
        date: dayMap[dk].date,
        headcount: Object.keys(dayMap[dk].headcountSet).length,
        workDays: round2(dayMap[dk].workDays),
        gross: round2(dayMap[dk].gross)
      }))
      .sort((a, b) => (a.date < b.date ? -1 : 1));
  }

  return success(ctx, {
    month,
    day,
    groupBy,
    generatedAt: new Date().toISOString(),
    totals,
    count: rows.length,
    rows,
    note: '实时口径：考勤×日薪现算，与工资核算 daily_pure 一致；扣罚=迟到20元/次、迟到超30分钟扣半日、旷工1天扣2日'
  });
};

/* ==============================================================================
 * v20261030c 工资报表中心（批次口径，读 WageBatchesV1/WageItemsV1 快照，非实时现算）
 *   GET /v1/reports/wage-monthly?year=YYYY   —— 月度工资对比 + 年度汇总
 *   GET /v1/reports/wage-bank-transfer?month=YYYY-MM —— 银行代发表（联查花名册银行信息）
 * 口径：仅统计 confirmed/posted 批次（draft 草稿不进报表）；金额直接取批次快照
 *   grossPay(应发)/totalDeduction(扣款)/netPay(实发)，与工资条、CSV 导出口径完全一致
 * ============================================================================== */
const num = v => Number(v) || 0;

const _itemKey = it => it.performerId || (it.staffNo ? 'SN:' + it.staffNo : 'NM:' + it.performerName);

const wageMonthly = async ctx => {
  const year = String(ctx.query.year || '');
  if (!/^\d{4}$/.test(year)) {
    throw new BusinessError('VALIDATION_ERROR', 'year 必填（YYYY）');
  }

  const batches = await prisma.wageBatchesV1.findMany({
    where: { wageMonth: { startsWith: year + '-' }, status: { in: ['confirmed', 'posted'] } },
    orderBy: { wageMonth: 'asc' },
    select: {
      id: true, batchNo: true, wageMonth: true, status: true, postedToLedger: true,
      totalPerformers: true, totalNetPay: true,
      items: {
        select: {
          performerId: true, performerName: true, staffNo: true, rankGrade: true,
          grossPay: true, totalDeduction: true, netPay: true,
          reviewStatus: true, payslipPublished: true
        }
      }
    }
  });

  // 1) 按月聚合
  const monthMap = {};
  for (let m = 1; m <= 12; m++) {
    const mm = (m < 10 ? '0' : '') + m;
    monthMap[year + '-' + mm] = { month: year + '-' + mm, batches: [], headcountSet: {}, gross: 0, deduction: 0, net: 0, itemCount: 0, publishedCount: 0 };
  }
  // 2) 按人年度聚合（跨月明细）
  const personMap = {};

  batches.forEach(b => {
    const mb = monthMap[b.wageMonth];
    if (mb) {
      mb.batches.push({ batchNo: b.batchNo, status: b.status, postedToLedger: b.postedToLedger });
      b.items.forEach(it => {
        const k = _itemKey(it);
        mb.headcountSet[k] = 1;
        mb.gross += num(it.grossPay);
        mb.deduction += num(it.totalDeduction);
        mb.net += num(it.netPay);
        mb.itemCount += 1;
        if (it.payslipPublished) mb.publishedCount += 1;

        const pk = it.performerId || k;
        const pp = personMap[pk] || {
          performerId: it.performerId || null, staffNo: it.staffNo || '', name: it.performerName,
          rankGrade: it.rankGrade || '', monthNets: {}, activeMonths: 0, gross: 0, deduction: 0, net: 0
        };
        if (!pp.monthNets[b.wageMonth]) { pp.monthNets[b.wageMonth] = num(it.netPay); pp.activeMonths += 1; }
        else pp.monthNets[b.wageMonth] += num(it.netPay); // 同月多批次兜底合并
        pp.gross += num(it.grossPay);
        pp.deduction += num(it.totalDeduction);
        pp.net += num(it.netPay);
        personMap[pk] = pp;
      });
    }
  });

  const months = Object.keys(monthMap).sort().map(k => {
    const mb = monthMap[k];
    const posted = mb.batches.some(x => x.status === 'posted');
    return {
      month: mb.month,
      batchCount: mb.batches.length,
      posted,
      headcount: Object.keys(mb.headcountSet).length,
      itemCount: mb.itemCount,
      publishedCount: mb.publishedCount,
      gross: round2(mb.gross),
      deduction: round2(mb.deduction),
      net: round2(mb.net)
    };
  });

  const persons = Object.keys(personMap).map(k => {
    const pp = personMap[k];
    return {
      performerId: pp.performerId, staffNo: pp.staffNo, name: pp.name, rankGrade: pp.rankGrade,
      activeMonths: pp.activeMonths, gross: round2(pp.gross), deduction: round2(pp.deduction), net: round2(pp.net),
      monthNets: pp.monthNets
    };
  }).sort((a, b) => b.net - a.net);

  const totals = {
    gross: round2(months.reduce((s, m) => s + m.gross, 0)),
    deduction: round2(months.reduce((s, m) => s + m.deduction, 0)),
    net: round2(months.reduce((s, m) => s + m.net, 0)),
    postedMonths: months.filter(m => m.posted).length,
    batchMonths: months.filter(m => m.batchCount > 0).length,
    activePersons: persons.length
  };

  return success(ctx, {
    year, generatedAt: new Date().toISOString(), months, persons, totals,
    count: batches.length,
    note: '批次口径：仅含已确认/已过账批次的工资条快照；与工资条、CSV 导出、凭证过账同源'
  });
};

const bankTransfer = async ctx => {
  const month = String(ctx.query.month || '');
  if (!/^\d{4}-\d{2}$/.test(month)) {
    throw new BusinessError('VALIDATION_ERROR', 'month 必填（YYYY-MM）');
  }

  const batches = await prisma.wageBatchesV1.findMany({
    where: { wageMonth: month, status: { in: ['confirmed', 'posted'] } },
    orderBy: [{ status: 'desc' }, { updatedAt: 'desc' }], // posted 优先，其次最新
    include: {
      items: {
        select: {
          performerId: true, performerName: true, staffNo: true, rankGrade: true,
          netPay: true, reviewStatus: true, payslipPublished: true
        }
      }
    }
  });
  if (!batches.length) {
    return success(ctx, { month, batch: null, rows: [], totals: { count: 0, totalNet: 0, missingBank: 0 }, note: '该月份暂无已确认/已过账批次' });
  }
  const batch = batches[0];

  // 花名册银行信息：先按 performerId 精准联查，staffNo 兜底
  const perfIds = batch.items.map(it => it.performerId).filter(Boolean);
  const staffNos = batch.items.map(it => it.staffNo).filter(Boolean);
  const [perfById, perfByNo] = await Promise.all([
    perfIds.length ? prisma.performersDbV1.findMany({
      where: { id: { in: perfIds }, status: { not: 'deleted' } },
      select: { id: true, staffNo: true, name: true, idCardNo: true, bankName: true, bankAccount: true }
    }) : Promise.resolve([]),
    staffNos.length ? prisma.performersDbV1.findMany({
      where: { staffNo: { in: staffNos }, status: { not: 'deleted' } },
      select: { id: true, staffNo: true, name: true, idCardNo: true, bankName: true, bankAccount: true }
    }) : Promise.resolve([])
  ]);
  const pMap = {};
  perfById.forEach(p => { pMap['ID:' + p.id] = p; });
  perfByNo.forEach(p => { if (!pMap['SN:' + p.staffNo]) pMap['SN:' + p.staffNo] = p; });

  const rows = batch.items.map(it => {
    const perf = (it.performerId && pMap['ID:' + it.performerId]) || (it.staffNo && pMap['SN:' + it.staffNo]) || null;
    const bankAccount = perf ? (perf.bankAccount || '') : '';
    const bankName = perf ? (perf.bankName || '') : '';
    return {
      performerId: it.performerId || null,
      staffNo: it.staffNo || '',
      name: it.performerName,
      rankGrade: it.rankGrade || '',
      bankName,
      bankAccount,
      idCardNo: perf ? (perf.idCardNo || '') : '',
      netPay: round2(num(it.netPay)),
      hasBank: !!(bankAccount && bankName),
      reviewStatus: it.reviewStatus,
      payslipPublished: !!it.payslipPublished
    };
  }).sort((a, b) => (a.staffNo < b.staffNo ? -1 : 1));

  const missing = rows.filter(r => !r.hasBank);
  return success(ctx, {
    month,
    batch: { batchNo: batch.batchNo, status: batch.status, postedToLedger: batch.postedToLedger, postedAt: batch.postedAt },
    generatedAt: new Date().toISOString(),
    rows,
    totals: {
      count: rows.length,
      totalNet: round2(rows.reduce((s, r) => s + r.netPay, 0)),
      missingBank: missing.length,
      missingBankNames: missing.map(r => r.name + (r.staffNo ? '(' + r.staffNo + ')' : ''))
    },
    note: '银行账号/开户行取自花名册档案（员工自助端可维护）；缺卡人员需先补录档案再导出'
  });
};

module.exports = { dailyWage, wageMonthly, bankTransfer };
