/* tests/wage-engine.unit.spec.js — js/app.js WageEngine 工资引擎单元测试
 *
 * 用法：node tests/wage-engine.unit.spec.js
 * 依赖：无（Node 内置 vm/assert/fs；DEFAULT_WAGE_RULES + WageEngine 直接从 js/app.js 切片）
 *
 * 覆盖：
 *   1. getBaseDailyWage  行当×职级矩阵、兜底、本人协议日薪优先（元→分）
 *   2. _parsePct / _hhmmToMinutes / isInTimeRange
 *   3. judgeAttendance   两次打卡判定、迟到、补卡 2 次上限、外勤豁免
 *   4. calcDailyWage     正常/迟到两档/事假/病假/旷工全天半天/休息日演出
 *   5. checkFullAttendance 全勤判定（工作日/周末/半天/迟到≥3）
 *   6. calcMonthlyWage   汇总计数、全勤奖 80000 分、社保公积金折算、实发
 */

'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const SRC = path.join(__dirname, '..', 'js', 'app.js');
const src = fs.readFileSync(SRC, 'utf8');

function sliceBetween(s, markA, markB) {
  const a = s.indexOf(markA);
  const b = s.indexOf(markB, a);
  assert(a >= 0 && b > a, '抽取失败：' + markA + ' / ' + markB);
  return s.slice(a, b);
}

/* DEFAULT_WAGE_RULES 整段（到 WageEngine 前，含自身闭合） */
const CODE_RULES = sliceBetween(src, 'var DEFAULT_WAGE_RULES = {', 'var WageEngine = {');
/* WageEngine 切到 calcMonthlyWage 结束（generateMonthlyPayslips 依赖 Storage/Utils，不纳入） */
const CODE_ENGINE =
  sliceBetween(src, 'var WageEngine = {', '// ---------- 批量生成月度工资条') +
  '\n  };';

const sb = { console, isFinite: Number.isFinite, parseInt: parseInt, parseFloat: parseFloat, Date: Date, Math: Math, JSON: JSON, Object: Object, Array: Array, String: String, Number: Number };
vm.createContext(sb);
vm.runInContext(CODE_RULES + '\n' + CODE_ENGINE, sb, { filename: 'wage-engine.js' });
const WE = sb.WageEngine, R = sb.DEFAULT_WAGE_RULES;

const results = [];
async function t(name, fn) {
  try { await fn(); results.push({ name, ok: true }); console.log('  ✓ ' + name); }
  catch (e) { results.push({ name, ok: false, err: e }); console.log('  ✗ ' + name + ' — ' + (e && e.message)); }
}

const STAFF = { id: 'p1', name: '张三', roleCategory: '灯光', level: '舞美师', seniorityYears: 2 };
// 正常日：base 42000 + 工龄 400 + 餐补 3000 + 交通 2000 = 47400
const NORMAL_GROSS = 42000 + 400 + 3000 + 2000;

(async () => {
  console.log('wage-engine.unit.spec — WageEngine 工资规则与考勤判定\n');

  /* ===== 1. 基准日薪 ===== */
  await t('getBaseDailyWage: 行当×职级矩阵取值（单位：分）', () => {
    assert.strictEqual(WE.getBaseDailyWage('灯光', '舞美师', R), 42000); // 420 元
    assert.strictEqual(WE.getBaseDailyWage('音响', '高级舞美', R), 54000);
    assert.strictEqual(WE.getBaseDailyWage('道具', '学员', R), 13000);
  });
  await t('getBaseDailyWage: 空行当→其他；空职级→该行当首个职级；未知行当→其他兜底', () => {
    assert.strictEqual(WE.getBaseDailyWage('', '', R), 26000);                 // 其他/普通员工
    assert.strictEqual(WE.getBaseDailyWage('外星人行当', '??', R), 60000);    // 其他首键=高级职称 60000
    assert.strictEqual(WE.getBaseDailyWage('灯光', '不存在职级', R), 56000);  // 灯光首键 56000
  });
  await t('getBaseDailyWage: 本人协议日薪(元)优先且四舍五入到分', () => {
    assert.strictEqual(WE.getBaseDailyWage('灯光', '舞美师', R, { dailyWage: 500 }), 50000);
    assert.strictEqual(WE.getBaseDailyWage('灯光', '舞美师', R, { dailyWage: 333.335 }), 33334);
    assert.strictEqual(WE.getBaseDailyWage('灯光', '舞美师', R, { dailyWage: 0 }), 42000);    // 0 回退矩阵
    assert.strictEqual(WE.getBaseDailyWage('灯光', '舞美师', R, { dailyWage: -5 }), 42000);
    assert.strictEqual(WE.getBaseDailyWage('灯光', '舞美师', R, { dailyWage: 'x' }), 42000);
  });

  /* ===== 2. 解析与时间工具 ===== */
  await t('_parsePct: 百分比字符串/数字/非法值', () => {
    assert.strictEqual(WE._parsePct('50%'), 0.5);
    assert.strictEqual(WE._parsePct('10.5%'), 0.105);
    assert.strictEqual(WE._parsePct(0.3), 0.3);
    assert.strictEqual(WE._parsePct('x'), 0);
    assert.strictEqual(WE._parsePct(null), 0);
  });
  await t('_hhmmToMinutes: HH:mm / 带日期前缀 / 非法 → -1', () => {
    assert.strictEqual(WE._hhmmToMinutes('08:05'), 485);
    assert.strictEqual(WE._hhmmToMinutes('13:10:30'), 790);
    assert.strictEqual(WE._hhmmToMinutes('2026-09-07 13:10'), 790);
    assert.strictEqual(WE._hhmmToMinutes(''), -1);
    assert.strictEqual(WE._hhmmToMinutes('xx'), -1);
  });
  await t('isInTimeRange: 提前/正常/迟到/超时四态，空参 -1', () => {
    const af = WE.ATTENDANCE_CLOCK_RULES.afternoonIn;
    assert.strictEqual(WE.isInTimeRange('12:00', af), -1);
    assert.strictEqual(WE.isInTimeRange('12:45', af), 0);
    assert.strictEqual(WE.isInTimeRange('13:00', af), 1);   // 踩到 lateStart
    assert.strictEqual(WE.isInTimeRange('14:30', af), 2);
    assert.strictEqual(WE.isInTimeRange('', af), -1);
    assert.strictEqual(WE.isInTimeRange('12:45', null), -1);
  });

  /* ===== 3. 两次打卡判定 ===== */
  await t('judgeAttendance: 外勤批准直接 full_day', () => {
    const r = WE.judgeAttendance('p1', '2026-09-07', [], { fieldworkApproved: true });
    assert.strictEqual(r.status, 'full_day');
    assert.strictEqual(r.hasAfternoonIn && r.hasNightIn, true);
  });
  await t('judgeAttendance: 午场+夜场正常 → full_day，无迟到', () => {
    const r = WE.judgeAttendance('p1', '2026-09-07', ['12:45', '18:45']);
    assert.strictEqual(r.status, 'full_day');
    assert.strictEqual(r.lateCount, 0);
    assert.strictEqual(r.used.length, 2);
  });
  await t('judgeAttendance: 两场都迟到 → full_day + lateCount=2', () => {
    const r = WE.judgeAttendance('p1', '2026-09-07', ['13:10', '19:10']);
    assert.strictEqual(r.status, 'full_day');
    assert.strictEqual(r.lateAfternoon && r.lateNight, true);
    assert.strictEqual(r.lateCount, 2);
  });
  await t('judgeAttendance: 仅一场 → half_afternoon / half_night；无卡 → absent', () => {
    assert.strictEqual(WE.judgeAttendance('p1', 'd', ['12:45']).status, 'half_afternoon');
    assert.strictEqual(WE.judgeAttendance('p1', 'd', ['18:45']).status, 'half_night');
    assert.strictEqual(WE.judgeAttendance('p1', 'd', []).status, 'absent');
    assert.strictEqual(WE.judgeAttendance('p1', 'd', ['11:00', '20:00']).status, 'absent'); // 均在区间外
  });
  await t('judgeAttendance: 补卡生效并计数，满 2 次后第三次被拦截', () => {
    const opt1 = { makeupAfternoon: true, makeupsUsed: 0 };
    const r1 = WE.judgeAttendance('p1', 'd', [], opt1);
    assert.strictEqual(r1.status, 'half_afternoon');
    assert.strictEqual(r1.makeupApplied, true);
    assert.strictEqual(opt1.makeupsUsed, 1);
    const opt2 = { makeupAfternoon: true, makeupNight: true, makeupsUsed: 0 };
    const r2 = WE.judgeAttendance('p2', 'd', [], opt2);
    assert.strictEqual(r2.status, 'full_day');
    assert.strictEqual(opt2.makeupsUsed, 2);
    const opt3 = { makeupNight: true, makeupsUsed: 2 };
    const r3 = WE.judgeAttendance('p3', 'd', [], opt3);
    assert.strictEqual(r3.status, 'absent');
    assert.strictEqual(r3.makeupBlockedByLimit, true);
  });

  /* ===== 4. 单日工资 ===== */
  await t('calcDailyWage: 正常日 = 基准+工龄+餐补+交通补，无扣款', () => {
    const d = WE.calcDailyWage(STAFF, { date: '2026-09-07', status: 'normal' }, R);
    assert.strictEqual(d.base, 42000);
    assert.strictEqual(d.seniority, 400);
    assert.strictEqual(d.mealAllowance, 3000);
    assert.strictEqual(d.trafficAllowance, 2000);
    assert.strictEqual(d.gross, NORMAL_GROSS);
    assert.strictEqual(d.deduction, 0);
    assert.strictEqual(d.net, NORMAL_GROSS);
  });
  await t('calcDailyWage: 迟到<30分钟 扣固定 2000 分；≥30分钟 按当日 50%', () => {
    const d1 = WE.calcDailyWage(STAFF, { status: 'late', lateMinutes: 10 }, R);
    assert.strictEqual(d1.deduction, 2000);
    assert.strictEqual(d1.net, NORMAL_GROSS - 2000);
    assert(Object.keys(d1.deductionDetail)[0].indexOf('迟到<10分钟') >= 0);
    const d2 = WE.calcDailyWage(STAFF, { status: 'late', lateMinutes: 45 }, R);
    assert.strictEqual(d2.deduction, 21000);
    assert.strictEqual(d2.net, NORMAL_GROSS - 21000);
    assert(Object.keys(d2.deductionDetail)[0].indexOf('按旷工半天') >= 0);
  });
  await t('calcDailyWage: 事假扣 100%、病假扣 30%、旷工全天 200%、旷工半天 100%', () => {
    const pl = WE.calcDailyWage(STAFF, { status: 'leave_personal' }, R);
    assert.strictEqual(pl.base, 0);
    assert.strictEqual(pl.deductionDetail['事假'], 42000);
    assert.strictEqual(pl.net, 0);
    const sl = WE.calcDailyWage(STAFF, { status: 'leave_sick' }, R);
    assert.strictEqual(sl.deductionDetail['病假'], 12600);
    assert.strictEqual(sl.net, 0);
    const ab = WE.calcDailyWage(STAFF, { status: 'absent', absentType: 'full' }, R);
    assert.strictEqual(ab.deductionDetail['旷工'], 84000);
    const ah = WE.calcDailyWage(STAFF, { status: 'absent', absentType: 'half' }, R);
    assert.strictEqual(ah.deductionDetail['旷工半天'], 42000);
  });
  await t('calcDailyWage: 休息日 0 基准 0 扣款；演出补助照常发放', () => {
    const off = WE.calcDailyWage(STAFF, { status: 'off', performType: 'benxi', performCount: 1 }, R);
    assert.strictEqual(off.base, 0);
    assert.strictEqual(off.deduction, 0);
    assert.strictEqual(off.performance, 12000);
    assert.strictEqual(off.net, 12000);
    const xx = WE.calcDailyWage(STAFF, { status: 'normal', performType: 'xiaxiang', performCount: 2 }, R);
    assert.strictEqual(xx.performance, 16000);
    assert.strictEqual(xx.gross, NORMAL_GROSS + 16000);
  });

  /* ===== 5. 全勤判定 ===== */
  // 2026-09-07 周一 … 09-11 周五，09-12 周六，09-13 周日
  const wk = n => ({ date: '2026-09-0' + (7 + n) });
  await t('checkFullAttendance: 工作日全 full_day 即全勤；空记录不算', () => {
    assert.strictEqual(WE.checkFullAttendance([0, 1, 2, 3, 4].map(wk)), true);
    assert.strictEqual(WE.checkFullAttendance([]), false);
  });
  await t('checkFullAttendance: 迟到<3 全勤；满 3 次取消；半天/工作日请假/旷工均不达标', () => {
    assert.strictEqual(WE.checkFullAttendance([0, 1, 2, 3, 4].map(wk), 2), true);
    assert.strictEqual(WE.checkFullAttendance([0, 1, 2, 3, 4].map(wk), 3), false);
    const half = [0, 1, 2, 3, 4].map(wk); half[2].status = 'half_afternoon';
    assert.strictEqual(WE.checkFullAttendance(half), false);
    const pl = [0, 1, 2, 3, 4].map(wk); pl[2].status = 'leave_personal';
    assert.strictEqual(WE.checkFullAttendance(pl), false);
    const ab = [0, 1, 2, 3, 4].map(wk); ab[2].status = 'absent';
    assert.strictEqual(WE.checkFullAttendance(ab), false);
  });
  await t('checkFullAttendance: 修复后周末请假/旷工不影响全勤（周末不纳入考勤考核）', () => {
    const list = [0, 1, 2, 3, 4].map(wk);
    list.push({ date: '2026-09-12', status: 'leave_personal' }); // 周六事假
    list.push({ date: '2026-09-13', status: 'absent' });        // 周日旷工
    assert.strictEqual(WE.checkFullAttendance(list), true);
  });
  await t('checkFullAttendance: 周末 full_day/normal 不影响全勤', () => {
    const list = [0, 1, 2, 3, 4].map(wk);
    list.push({ date: '2026-09-12', status: 'full_day' });
    list.push({ date: '2026-09-13', status: 'normal' });
    assert.strictEqual(WE.checkFullAttendance(list), true);
  });
  await t('checkFullAttendance: 修复后周末半天也不影响；工作日半天仍不达标', () => {
    const wkHalf = [0, 1, 2, 3, 4].map(wk);
    wkHalf.push({ date: '2026-09-12', status: 'half_afternoon' }); // 周六半天
    assert.strictEqual(WE.checkFullAttendance(wkHalf), true);
    const wdHalf = [0, 1, 2, 3, 4].map(wk);
    wdHalf[1] = { date: wdHalf[1].date, status: 'half_night' };    // 周二半天
    assert.strictEqual(WE.checkFullAttendance(wdHalf), false);
  });

  /* ===== 6. 月度汇总 ===== */
  await t('calcMonthlyWage: 22 个正常日 — 汇总计数、全勤奖 80000、社保10.5%/公积金12% 折算', () => {
    const att = [];
    for (let i = 0; i < 22; i++) att.push({ date: '2026-09-' + String(i + 1).padStart(2, '0'), status: 'normal' });
    const r = WE.calcMonthlyWage(STAFF, att, 0, 0, R);
    assert.strictEqual(r.summary.workDays, 22);
    assert.strictEqual(r.items.baseSalary, 42000 * 22);
    assert.strictEqual(r.items.perfectBonus, 80000);           // 全勤奖 800 元
    const socialBase = Math.round((42000 * 22) / 22 * 21.75);
    assert.strictEqual(r.items.socialInsurance, Math.round(socialBase * 0.105));
    assert.strictEqual(r.items.housingFund, Math.round(socialBase * 0.12));
    const gross = NORMAL_GROSS * 22 + 80000;
    assert.strictEqual(r.items.grossPay, gross);
    assert.strictEqual(r.items.netPay, gross - r.items.socialInsurance - r.items.housingFund);
  });
  await t('calcMonthlyWage: 迟到 3 天取消全勤奖；考勤扣款逐项计入', () => {
    const att = [
      { date: '2026-09-01', status: 'late', lateMinutes: 10 },
      { date: '2026-09-02', status: 'late', lateMinutes: 10 },
      { date: '2026-09-03', status: 'late', lateMinutes: 10 },
      { date: '2026-09-04', status: 'normal' },
    ];
    const r = WE.calcMonthlyWage(STAFF, att, 0, 0, R);
    assert.strictEqual(r.summary.lateDays, 3);
    assert.strictEqual(r.items.perfectBonus, 0);
    assert.strictEqual(r.items.attendanceDeduction, 6000);    // 3×2000（不含社保公积金/额外扣款）
  });
  await t('calcMonthlyWage: 汇总 6 类天数与 3 类演出场次', () => {
    const att = [
      { status: 'normal', performType: 'benxi', performCount: 1 },
      { status: 'late' },
      { status: 'absent', absentType: 'full' },
      { status: 'absent', absentType: 'half' },
      { status: 'leave_sick' },
      { status: 'leave_personal' },
      { status: 'off', performType: 'zhezi', performCount: 2 },
      { status: 'normal', performType: 'xiaxiang', performCount: 1 },
      { status: 'normal', performType: 'festival', performCount: 1 }, // 归入 performOther
    ];
    const s = WE.calcMonthlyWage(STAFF, att, 0, 0, R).summary;
    assert.strictEqual(s.workDays, 4);   // 3 normal（本戏/下乡/节庆）+ 1 late
    assert.strictEqual(s.lateDays, 1);
    assert.strictEqual(s.absentFullDays, 1);
    assert.strictEqual(s.absentHalfDays, 1);
    assert.strictEqual(s.sickDays, 1);
    assert.strictEqual(s.personalDays, 1);
    assert.strictEqual(s.performBenxi, 1);
    assert.strictEqual(s.performZhezi, 2);
    assert.strictEqual(s.performXiaxiang, 1);
    assert.strictEqual(s.performOther, 1);
  });
  await t('calcMonthlyWage: 修复后零工作日考勤不发全勤奖；额外奖金仍计入', () => {
    const r1 = WE.calcMonthlyWage(STAFF, [], 50000, 0, R);
    assert.strictEqual(r1.items.extraBonus, 50000);
    assert.strictEqual(r1.items.perfectBonus, 0);    // 零出勤不发全勤奖
    assert.strictEqual(r1.items.grossPay, 50000);    // 仅额外奖金
    const r2 = WE.calcMonthlyWage(STAFF, [], 0, 999999, R);
    assert.strictEqual(r2.items.extraDeduction, 999999);
    assert.strictEqual(r2.items.netPay, 0);                    // 扣穿地板 0
  });
  await t('calcMonthlyWage: 修复后周末事假/病假/旷工不取消全勤奖且不计入考核天数', () => {
    const att = [0, 1, 2, 3, 4].map(wk).map(w => Object.assign({}, w, { status: 'full_day' }));
    att.push({ date: '2026-09-12', status: 'leave_personal' }); // 周六事假
    att.push({ date: '2026-09-13', status: 'absent', absentType: 'full' }); // 周日旷工
    const r = WE.calcMonthlyWage(STAFF, att, 0, 0, R);
    assert.strictEqual(r.summary.personalDays, 0);
    assert.strictEqual(r.summary.absentFullDays, 0);
    assert.strictEqual(r.items.perfectBonus, 80000);           // 全勤奖照发
  });
  await t('calcMonthlyWage: 工作日事假/旷工仍取消全勤奖', () => {
    const att = [0, 1, 2, 3, 4].map(wk).map(w => Object.assign({}, w, { status: 'full_day' }));
    att[2].status = 'leave_personal';                          // 周三事假
    const r = WE.calcMonthlyWage(STAFF, att, 0, 0, R);
    assert.strictEqual(r.summary.personalDays, 1);
    assert.strictEqual(r.items.perfectBonus, 0);
  });
  await t('calcMonthlyWage: 仅周末有记录（无工作日考勤）视为零出勤，不发全勤奖', () => {
    const att = [
      { date: '2026-09-12', status: 'full_day' },
      { date: '2026-09-13', status: 'full_day', performType: 'benxi', performCount: 1 },
    ];
    const r = WE.calcMonthlyWage(STAFF, att, 0, 0, R);
    assert.strictEqual(r.items.perfectBonus, 0);
    assert.strictEqual(r.summary.performBenxi, 1);            // 周末演出补助场次仍统计
  });

  /* ---------- 汇总 ---------- */
  const failed = results.filter(r => !r.ok);
  console.log('\n========================================');
  console.log('总计 ' + results.length + ' 项：✓ ' + (results.length - failed.length) + ' 通过，✗ ' + failed.length + ' 失败');
  if (failed.length) {
    failed.forEach(f => { console.log('\n[FAIL] ' + f.name); console.log(f.err && f.err.stack || f.err); });
    process.exit(1);
  }
  console.log('全部通过');
  process.exit(0);
})().catch(e => { console.error('测试运行器异常:', e); process.exit(2); });
