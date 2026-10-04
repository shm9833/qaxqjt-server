'use strict';

/**
 * src/controllers/wage-report.js —— 真实统计与报表：员工日薪实时统计
 * GET /v1/reports/daily-wage
 *
 * 口径与工资核算 daily_pure（wages.js）完全一致，保证"报表数 = 工资数"：
 *   出勤天：full/night/double=1，half=0.5
 *   日薪取价：本人协议天工资 dailyRate > 职级规则 baseDailyStandard 兜底
 *   应发日薪合计 = 日薪 × 出勤天（round2）
 *   扣罚 = 迟到20元/次 + 迟到超30分钟按旷工半天 + 旷工1天扣2日（computeAttendancePenalty 唯一口径）
 *   实发 = 应发 − min(扣罚, 应发)（不为负，超出部分另行追缴）
 *
 * 维度：date=按日期 / performer=按人员 / empType=按用工类型 / rank=按职级
 * 数据实时计算：每次请求均从考勤表 + 花名册现算，不读工资批次快照
 */
const prisma = require('../utils/prisma');
const { success } = require('../utils/response');
const { BusinessError } = require('../middleware/error-handler');
const { computeAttendancePenalty } = require('./wages');

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
    perPerson[p.id] = m;
  }

  // 4) 逐人结算：应发/扣罚/实发（computeAttendancePenalty 唯一口径）
  const persons = Object.keys(perPerson).map(id => {
    const m = perPerson[id];
    const gross = round2(m.rate * m.workDays);
    const penalty = computeAttendancePenalty(
      { workDays: m.workDays, nightShows: 0, absent: m.absent, leave: m.leave, late: m.late, lateOver: m.lateOver },
      m.rate
    );
    const deduction = round2(Math.min(penalty.total, gross));
    const net = round2(gross - deduction);
    return {
      p: m.p, rate: m.rate, workDays: round2(m.workDays), gross,
      late: m.late, lateOver: m.lateOver, absent: m.absent, leave: m.leave,
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

module.exports = { dailyWage };
