// leave-recalc.js — v20261029i 假条联动自动重算模块
// 口径与 recalc-leave-1029f 脚本完全一致（外科手术式重算：订单溯源扣减请假天 + OL/OL2 并桶 + 病假全额），
// 抽成模块供双入口复用：① 审批通过/驳回后自动定向重算（attendance.js leaveApprove）
//                       ② 运维脚本全量重算（recalc-leave-1029f，保持脚本壳）
// 与脚本差异：
//   - 不做考勤回填（审批时 _syncLeaveAttendance 已即时同步，编辑重批时旧行已清）
//   - 支持 staffIds 定向重算（审批场景只动该员工；批次汇总仍含全部条目原值）
//   - 批次范围 posted + confirmed；posted 批次重算后同步更新关联 draft 台账分录金额
//     （分录已复核 → 整批跳过记 skippedLedgerLocked，避免批次与凭证永久不一致）
'use strict';

const r2 = v => Math.round((Number(v) || 0) * 100) / 100;
const TAX_CANDIDATES = [5000, 0, 1000, 2000, 3000, 3500, 4000, 6000];
const SHOULD_WORK = 26;
const DAY = 86400000;

// 请假类型 → 中文（工资条 otherDeductionNote.leaveTypes 展示用，与 recalc 补丁口径一致）
const LCN = { PL: '事假', SL: '病假', AL: '年假', ML: '婚假', BL: '丧假', leave: '请假', outing: '外出', study: '学习', business: '出差', injury: '工伤', OL: '调休', OL2: '调休' };

function calcTax(gross, threshold) {
  const taxable = r2((Number(gross) || 0) - threshold);
  if (taxable <= 0) return 0;
  if (taxable <= 3000) return r2(taxable * 0.03);
  if (taxable <= 12000) return r2(taxable * 0.10 - 210);
  return r2(taxable * 0.20 - 1410);
}

/**
 * 重算指定月份（可选定向员工）的已确认/已发放批次工资条（请假不带薪口径）
 * @param {object} prisma Prisma 客户端（server/src/utils/prisma.js）
 * @param {object} h wages/helpers.js 模块（需 _attendanceByStaff/_orderBreakdownByStaff）
 * @param {object} opt { month: 'YYYY-MM', staffIds?: string[] }
 * @returns {object} summary 重算汇总
 */
async function recalcLeaveWages(prisma, h, opt) {
  const month = opt && opt.month;
  if (!month || !/^\d{4}-\d{2}$/.test(month)) throw new Error('recalcLeaveWages: month (YYYY-MM) required');
  const staffIds = Array.isArray(opt.staffIds) ? opt.staffIds.filter(Boolean) : null;

  const summary = { month, scope: staffIds ? staffIds.length + '人定向' : '全量', batches: [], changed: 0, skippedClean: 0, skippedFail: [], skippedLedgerLocked: [], taxThreshold: null, ledgerSynced: 0, forceTrace: {} };

  // v20261029i：含 draft（批次撤回后回 draft，需重算修正；从未发放的草稿批次 clean 判定天然跳过无关条目）
  const batches = await prisma.wageBatchesV1.findMany({
    where: { wageMonth: month, status: { in: ['posted', 'confirmed', 'draft'] } }
  });
  if (!batches.length) { summary.note = 'NO_POSTED_OR_CONFIRMED_BATCH'; return summary; }

  // 强制重算集合：已批请假单 × 订单演出段交集（演出时段请假必扣，不受打卡总控暂停期 clean 判定影响）
  const y = Number(month.substring(0, 4)), m = Number(month.substring(5, 7));
  const mStart = new Date(Date.UTC(y, m - 1, 1));
  const mEnd = new Date(Date.UTC(y, m, 1));
  const gLeaves = (await prisma.leaveApplication.findMany({ where: { approveStatus: 'approved' } }))
    .filter(l => l.dateFrom && l.dateTo && l.dateFrom.getTime() < mEnd.getTime() && l.dateTo.getTime() >= mStart.getTime());
  const gOrders = await prisma.order.findMany({
    where: { status: { notIn: ['cancelled', 'refunded'] }, performanceStartDate: { not: null, lt: mEnd }, performanceEndDate: { not: null, gte: mStart } },
    select: { id: true, performanceStartDate: true, performanceEndDate: true }
  });
  const forceBy = {};
  const leaveTypesBy = {};
  for (const l of gLeaves) {
    const tcn = LCN[l.leaveType] || l.leaveType;
    if (tcn && (leaveTypesBy[l.staffId] || []).indexOf(tcn) < 0) (leaveTypesBy[l.staffId] = leaveTypesBy[l.staffId] || []).push(tcn);
    for (const o of gOrders) {
      const s = Math.max(l.dateFrom.getTime(), o.performanceStartDate.getTime());
      const e = Math.min(l.dateTo.getTime(), o.performanceEndDate.getTime());
      if (e >= s) forceBy[l.staffId] = (forceBy[l.staffId] || 0) + Math.round((e - s) / DAY) + 1;
    }
  }
  summary.forceTrace = forceBy;

  // 考勤补充桶（补假/AL/ML/BL 行计数，clean 判定用）
  const attRows = await prisma.attendanceV1.findMany({
    where: { attendanceMonth: month },
    select: { staffId: true, attendanceType: true, remark: true }
  });
  const makeupBy = {}, almlblBy = {};
  for (const r of attRows) {
    const rm = String(r.remark || '');
    if (rm.indexOf('补假#') === 0) makeupBy[r.staffId] = (makeupBy[r.staffId] || 0) + 1;
    else if (r.attendanceType === 'AL' || r.attendanceType === 'ML' || r.attendanceType === 'BL') almlblBy[r.staffId] = (almlblBy[r.staffId] || 0) + 1;
  }
  const attMap = await h._attendanceByStaff(month, null);
  const orderMap = await h._orderBreakdownByStaff(month, null);

  // 个税起征点反推（口径与脚本一致）
  const allItems0 = await prisma.wageItemsV1.findMany({ where: { batchId: { in: batches.map(b => b.id) } } });
  const taxRows = [];
  for (const it of allItems0) {
    let note = {}; try { note = JSON.parse(it.otherDeductionNote || '{}'); } catch (e) { note = {}; }
    if ((it.wageMode || note.mode) !== 'daily_pure' && Number(note.tax) > 0) taxRows.push({ gross: Number(it.grossPay) || 0, tax: Number(note.tax) });
  }
  let taxThreshold = 5000;
  for (const c of TAX_CANDIDATES) {
    if (taxRows.length && taxRows.every(x => calcTax(x.gross, c) === x.tax)) { taxThreshold = c; break; }
  }
  summary.taxThreshold = taxThreshold;

  for (const batch of batches) {
    // posted/confirmed 批次若关联台账分录已复核（draft/void 豁免，生产枚举实测 draft/checked/void）→ 跳过该批
    if (batch.status !== 'draft') {
      const ledgerRows = await prisma.finLedgerV1.findMany({ where: { relatedBatchId: batch.id } });
      if (ledgerRows.some(x => x.status !== 'draft' && x.status !== 'void')) {
        summary.skippedLedgerLocked.push(batch.batchNo);
        continue;
      }
    }
    const items = await prisma.wageItemsV1.findMany({ where: { batchId: batch.id } });
    let tBase = 0, tAllow = 0, tBonus = 0, tDed = 0, tNet = 0;
    const txOps = [];
    for (const it of items) {
      const isTarget = !staffIds || staffIds.indexOf(it.performerId) >= 0;
      const agg = () => { tBase += Number(it.baseWage) || 0; tAllow += (Number(it.transportAllowance) || 0) + (Number(it.mealAllowance) || 0); tBonus += (Number(it.nightShowBonus) || 0) + (Number(it.fullAttendanceBonus) || 0); tDed += Number(it.totalDeduction) || 0; tNet += Number(it.netPay) || 0; };
      if (!isTarget) { agg(); continue; }
      let note = {}; try { note = JSON.parse(it.otherDeductionNote || '{}'); } catch (e) { note = {}; }
      const mode = it.wageMode || note.mode || 'daily_pure';
      const att = attMap[it.performerId] || { workDays: 0, nightShows: 0, absent: 0, leave: 0, late: 0, early: 0, sick: 0, accident1: 0, accident2: 0, accident3: 0 };
      const hasMakeup = !!makeupBy[it.performerId];
      const hasALMLBL = !!almlblBy[it.performerId];
      const leaveChg = (att.leave || 0) !== (note.leaveDays || 0);
      const sickChg = (att.sick || 0) !== (note.sickDays || 0);
      const typesChg = (leaveTypesBy[it.performerId] || []).join('、') !== (note.leaveTypes || '');
      const clean = !hasMakeup && !hasALMLBL && !leaveChg && !sickChg && !typesChg && !forceBy[it.performerId];

      if (clean) { summary.skippedClean += 1; agg(); continue; }

      let nu = null;
      try {
        if (mode === 'daily_pure') {
          const ob = orderMap[it.performerId];
          let showNew = 0;
          if (ob) Object.keys(ob.orders).forEach(oid => { showNew += ob.orders[oid].showDays || 0; });
          let obOrig = null; try { obOrig = JSON.parse(it.orderBreakdown || 'null'); } catch (e) { obOrig = null; }
          let showOrig = null;
          if (Array.isArray(obOrig)) { showOrig = 0; obOrig.forEach(o => { if (o.orderId) showOrig += o.showDays || 0; }); }
          const showBased = showNew > 0;
          const workDaysNew = att.workDays || 0;
          const attDaysNew = showBased ? showNew : workDaysNew;
          const rate = Number(it.dailyRate) || 0;
          const baseNew = rate > 0 && attDaysNew > 0 ? r2(rate * attDaysNew) : (showBased || workDaysNew > 0 ? 0 : it.baseWage);
          if (!hasMakeup && showOrig != null && showOrig === showNew && r2(baseNew) !== r2(it.baseWage)) throw new Error('daily_pure clean baseWage mismatch');
          const transportNew = Number(it.transportAllowance) || 0;
          const grossNew = r2(baseNew + transportNew);
          const penaltyOrig = Number(it.otherDeduction) || 0;
          const luOrig = Number(it.loadUnloadDeduction) || 0;
          const loanOrig = Number(it.loanDeduction) || 0;
          const rawOrig = (Number(it.totalDeduction) || 0) + (Number(note.unpaidCarryOver) || 0);
          const penNew = r2(Math.min(penaltyOrig, Math.max(0, grossNew)));
          const luNew = r2(Math.min(luOrig, Math.max(0, grossNew - penNew)));
          const loanNew = r2(Math.min(loanOrig, Math.max(0, grossNew - penNew - luNew)));
          const totalNew = r2(penNew + luNew + loanNew);
          const carryNew = r2(Math.max(0, rawOrig - grossNew));
          const netNew = r2(grossNew - totalNew);
          let remarkNew = String(it.remark || '');
          const origAttDays = Number(it.attendanceDays) || 0;
          if (attDaysNew !== origAttDays) remarkNew = remarkNew.replace(/× \d+(\.\d+)?天/, '× ' + attDaysNew + '天');
          if (carryNew !== (Number(note.unpaidCarryOver) || 0)) {
            remarkNew = remarkNew.replace(/扣款超出应发¥[\d.]+，本次按0元发放，余额另行追缴/, carryNew > 0 ? ('扣款超出应发¥' + carryNew + '，本次按0元发放，余额另行追缴') : '');
            remarkNew = remarkNew.replace(/；；+/g, '；').replace(/；$/, '');
            if (carryNew > 0 && remarkNew.indexOf('扣款超出应发') < 0) remarkNew += (remarkNew ? '；' : '') + '扣款超出应发¥' + carryNew + '，本次按0元发放，余额另行追缴';
          }
          let obNew = null;
          if (ob) {
            const rateO = rate;
            const obOrders = Object.keys(ob.orders).map(oid => ({
              orderId: oid,
              orderNo: ob.orders[oid].orderNo || oid,
              workDays: showBased ? (ob.orders[oid].showDays || 0) : Math.round((ob.orders[oid].workDays || 0) * 100) / 100,
              showDays: ob.orders[oid].showDays || 0,
              nightShows: ob.orders[oid].nightShows,
              baseShare: r2(rateO * (ob.orders[oid].showDays || 0))
            })).sort((a, b) => (b.showDays || 0) - (a.showDays || 0));
            const fb = ob.fallback;
            if (fb && (fb.workDays > 0 || fb.nightShows > 0)) obOrders.push({ orderId: null, orderNo: '非演出考勤', workDays: Math.round((fb.workDays || 0) * 100) / 100, showDays: 0, nightShows: fb.nightShows || 0, baseShare: 0 });
            if (obOrders.length) obNew = JSON.stringify(obOrders);
          }
          const noteNew = Object.assign({}, note, {
            unpaidCarryOver: carryNew,
            // v20261029i 溯源扣减明细：orderBreakdown 已是扣减后值，扣减天数唯一真源 = forceBy（请假单×演出段交集）
            leave: ((forceBy[it.performerId] || 0) > 0 && rate > 0) ? r2(rate * (forceBy[it.performerId] || 0)) : (Number(note.leave) || 0),
            leaveDays: (forceBy[it.performerId] || 0) > 0 ? (forceBy[it.performerId] || 0) : (att.leave || 0),
            leaveTypes: (leaveTypesBy[it.performerId] || []).join('、'),
            sickDays: att.sick || 0,
            recalc1029f: 'leave-sync-unpaid'
          });
          nu = { attendanceDays: attDaysNew, baseWage: r2(baseNew), grossPay: grossNew, totalDeduction: totalNew, netPay: netNew, otherDeduction: penaltyOrig, otherDeductionNote: JSON.stringify(noteNew), remark: remarkNew, orderBreakdown: obNew, fullAttendanceBonus: it.fullAttendanceBonus, nightShowBonus: it.nightShowBonus };
        } else {
          const dailyBase = Number(note.dailyBase) || 0;
          if (dailyBase <= 0) throw new Error('dailyBase missing');
          const workDaysNew = att.workDays || 0;
          const leaveDaysNew = att.leave || 0;
          const sickDaysNew = att.sick || 0;
          const isMonthly = mode === 'monthly';
          const enLeave = (Number(note.leaveDays) > 0 || Number(note.sickDays) > 0) ? ((Number(note.leave) > 0 || Number(note.sick) > 0)) : true;
          let baseNew;
          const origBase = Number(it.baseWage) || 0;
          if (origBase === 0) baseNew = 0;
          else if (isMonthly) baseNew = origBase;
          else {
            const fullMonth = workDaysNew >= SHOULD_WORK;
            baseNew = fullMonth ? origBase : r2(dailyBase * workDaysNew);
          }
          const isFullNew = workDaysNew > 0 && (note.absentDays || 0) === 0 && leaveDaysNew === 0 && sickDaysNew === 0 && (note.lateTimes || 0) < 3 && (note.earlyTimes || 0) < 3;
          const origFull = Number(it.fullAttendanceBonus) || 0;
          const fullNew = (origFull > 0 && isFullNew) ? origFull : 0;
          const nightNew = Number(it.nightShowBonus) || 0;
          const grossNew = r2(baseNew + nightNew + fullNew);
          const leaveFineNew = (isMonthly && enLeave) ? r2(leaveDaysNew * dailyBase) : 0;
          const sickFineNew = (isMonthly && enLeave) ? r2(sickDaysNew * dailyBase * 1) : 0;
          const absentFine = Number(note.absent) || 0;
          const lateFine = Number(note.late) || 0;
          const earlyFine = Number(note.early) || 0;
          const accidentFine = Number(note.accident) || 0;
          const social = Number(note.social) || 0;
          const taxNew = (Number(note.tax) || 0) > 0 ? calcTax(grossNew, taxThreshold) : 0;
          const luFine = Number(note.loadUnloadDeduction) || 0;
          const rawNew = r2(lateFine + earlyFine + absentFine + leaveFineNew + sickFineNew + social + taxNew + accidentFine + luFine);
          const totalNew = r2(Math.min(rawNew, grossNew));
          const carryNew = r2(Math.max(0, rawNew - grossNew));
          const netNew = r2(grossNew - totalNew);
          if (!hasMakeup && netNew > (Number(it.netPay) || 0) + 0.011) throw new Error('netPay increased unexpectedly');
          const baseForText = (() => { const c = Math.round(dailyBase * SHOULD_WORK); return r2(c / SHOULD_WORK) === dailyBase ? c : r2(dailyBase * SHOULD_WORK); })();
          let rateNote;
          if (origBase === 0) rateNote = isMonthly ? '按月结算：底薪已停用（核算项开关）' : '月薪折算：底薪已停用（核算项开关，按天折算为0）';
          else if (isMonthly) rateNote = '按月结算：底薪¥' + baseForText;
          else {
            const fullMonth = workDaysNew >= SHOULD_WORK;
            rateNote = fullMonth
              ? '月薪折算：满勤（出勤' + workDaysNew + '天≥应勤' + SHOULD_WORK + '天）按全额底薪¥' + baseForText + '计（纯日薪口径，不发全勤奖/夜场补贴）'
              : '月薪折算：¥' + dailyBase + '/天×' + workDaysNew + '天（纯日薪口径，不发全勤奖/夜场补贴）';
          }
          const parts = [];
          if (leaveFineNew) parts.push('事假' + leaveDaysNew + '天×¥' + dailyBase + '=¥' + leaveFineNew);
          if (sickFineNew) parts.push('病假' + sickDaysNew + '天×¥' + dailyBase + '=¥' + sickFineNew);
          if (absentFine) parts.push('旷工' + (note.absentDays || 0) + '天×¥' + dailyBase + '×' + ((Number(note.absentDays) > 0 && dailyBase > 0) ? r2((absentFine / (note.absentDays * dailyBase)) * 100) / 100 : 2) + '=¥' + absentFine);
          if (lateFine) parts.push('迟到' + (note.lateTimes || 0) + '次按新规¥' + lateFine);
          if (earlyFine) parts.push('早退' + (note.earlyTimes || 0) + '次×¥' + ((Number(note.earlyTimes) > 0) ? r2(earlyFine / note.earlyTimes) : 30) + '=¥' + earlyFine);
          if (accidentFine) parts.push('事故扣款：一级' + (note.accident1 || 0) + '天 + 二级' + (note.accident2 || 0) + '天 + 三级' + (note.accident3 || 0) + '天=¥' + accidentFine);
          if (luFine) parts.push('装卸车缺席' + (note.loadUnloadAbsentCount || 0) + '次×¥' + (note.loadUnloadUnitPrice || 30) + '=¥' + luFine);
          if (social) parts.push('社保公积金¥' + social);
          if (taxNew) parts.push('个税¥' + taxNew);
          if (carryNew) parts.push('扣款超出应发¥' + carryNew + '，本次按0元发放，余额另行追缴');
          const remarkNew = parts.length ? rateNote + '；扣款：' + parts.join('；') : rateNote;
          const noteNew = Object.assign({}, note, {
            leave: leaveFineNew, sick: sickFineNew, leaveDays: leaveDaysNew, sickDays: sickDaysNew,
            leaveTypes: (leaveTypesBy[it.performerId] || []).join('、'),
            tax: taxNew, unpaidCarryOver: carryNew, recalc1029f: 'leave-sync-unpaid'
          });
          nu = { attendanceDays: workDaysNew, baseWage: r2(baseNew), fullAttendanceBonus: fullNew, nightShowBonus: nightNew, grossPay: grossNew, otherDeduction: r2(leaveFineNew + sickFineNew + absentFine + lateFine + earlyFine + accidentFine), socialInsuranceDeduct: social, taxDeduct: taxNew, loadUnloadDeduction: luFine, totalDeduction: totalNew, netPay: netNew, otherDeductionNote: JSON.stringify(noteNew), remark: remarkNew };
        }
      } catch (ve) {
        summary.skippedFail.push({ itemId: it.id, performerId: it.performerId, mode, reason: String(ve.message || ve) });
        agg();
        continue;
      }
      const data = { attendanceDays: nu.attendanceDays, baseWage: nu.baseWage, nightShowBonus: nu.nightShowBonus != null ? nu.nightShowBonus : it.nightShowBonus, fullAttendanceBonus: nu.fullAttendanceBonus != null ? nu.fullAttendanceBonus : it.fullAttendanceBonus, transportAllowance: it.transportAllowance, mealAllowance: it.mealAllowance, otherDeduction: nu.otherDeduction != null ? nu.otherDeduction : it.otherDeduction, otherDeductionNote: nu.otherDeductionNote, grossPay: nu.grossPay, totalDeduction: nu.totalDeduction, netPay: nu.netPay, remark: nu.remark != null ? nu.remark : it.remark };
      // schema 无 loadUnloadDeduction/loanDeduction 列（其金额已折算进 totalDeduction 与 note），不得落库
      if (nu.socialInsuranceDeduct != null) data.socialInsuranceDeduct = nu.socialInsuranceDeduct;
      if (nu.taxDeduct != null) data.taxDeduct = nu.taxDeduct;
      if (nu.orderBreakdown !== undefined) data.orderBreakdown = nu.orderBreakdown;
      txOps.push(prisma.wageItemsV1.update({ where: { id: it.id }, data }));
      summary.changed += 1;
      tBase += nu.baseWage; tAllow += (Number(it.transportAllowance) || 0) + (Number(it.mealAllowance) || 0); tBonus += (data.nightShowBonus || 0) + (data.fullAttendanceBonus || 0); tDed += nu.totalDeduction; tNet += nu.netPay;
    }
    txOps.push(prisma.wageBatchesV1.update({
      where: { id: batch.id },
      data: { totalBaseWage: r2(tBase), totalAllowance: r2(tAllow), totalBonus: r2(tBonus), totalDeduction: r2(tDed), totalNetPay: r2(tNet) }
    }));
    // posted 批次：同步更新关联 draft 台账分录金额（凭证号不变，保持批次↔凭证一致）
    if (batch.status === 'posted') {
      txOps.push(prisma.finLedgerV1.updateMany({
        where: { relatedBatchId: batch.id, status: 'draft' },
        data: { debitAmount: r2(tNet), ts: BigInt(Date.now()) }
      }));
      summary.ledgerSynced += 1;
    }
    await prisma.$transaction(txOps);
    summary.batches.push({ batchNo: batch.batchNo, status: batch.status, items: items.length, changed: summary.changed });
  }
  return summary;
}

module.exports = { recalcLeaveWages };
