/* performers/helpers.js — 常量和内部工具函数（自 performers.js 拆分） */
'use strict';

/**
 * src/controllers/performers.js —— 演职人员花名册 CRUD
 */
const { nanoid } = require('nanoid');
const prisma = require('../../utils/prisma');
const { success, created } = require('../../utils/response');
const { idByCtx, nowMs } = require('../../config');
const { BusinessError } = require('../../middleware/error-handler');
const { audit } = require('../../services/audit-service');
// 复用工资核算唯一扣罚口径（迟到20元/次、迟到超30分钟扣半日、旷工1天扣两日）
const { computeAttendancePenalty } = require('../wages');

const DATE_FIELDS = ['birthDate', 'hireDate'];


const toDailyRate = v => {
  if (v === undefined || v === null || v === '') return null;
  const n = Number(v);
  if (!isFinite(n) || n < 0) return null;
  return Math.round(n * 100) / 100;
};


const buildData = b => {
  const data = {
    staffNo: b.staffNo || null,
    name: b.name,
    gender: b.gender || null,
    phone: b.phone || null,
    idCardNo: b.idCardNo || null,
    rankGrade: b.rankGrade || null,
    primaryRole: b.primaryRole || null,
    employmentType: b.employmentType || null,
    bankAccount: b.bankAccount || null,
    bankName: b.bankName || null,
    socialSecurityNo: b.socialSecurityNo || null,
    status: b.status || 'active',
    remark: b.remark || null,
    avatarUrl: b.avatarUrl || null,
    agreedSalary: b.agreedSalary || null,
    dailyRate: toDailyRate(b.dailyRate),
    transportType: b.transportType || null,
    regulationsConfirmed: b.regulationsConfirmed === true,
    reviewStatus: b.reviewStatus || 'approved',
    reviewFeedback: b.reviewFeedback || null,
    ts: BigInt(nowMs())
  };
  DATE_FIELDS.forEach(k => {
    if (b[k]) data[k] = new Date(b[k]);
    else data[k] = null;
  });
  return data;
};

// ========== 花名册 → 工资条：关键字段同步 ==========
// 触发时机：create / update / review approve
// 同步范围：batch.status='draft' 的工资条；已确认/已过账批次冻结不动
// 行为：
//   1. 该人员在 draft 批次中已有 wage_item → 更新 name/staffNo/rankGrade；dailyRate 变化按差值增量更新金额
//   2. 该人员在 draft 批次中无 wage_item → 查当月考勤+职级规则，按 wages.generate 同口径自动创建一条
//      （当月无考勤且未设 dailyRate 的跳过，与 generate 跳过规则一致）
//   3. 新建/变更后增量回写批次 totalPerformers 与汇总金额
// 错误不阻断主流程，仅返回 { synced, created, error? }

const SYNC_WORK_DAY_TYPES = { full: 1, night: 1, double: 1, half: 0.5 };

const _round2 = n => Math.round((Number(n) || 0) * 100) / 100;


async function _attendanceOfMonth(performerId, month) {
  const rows = await prisma.attendanceV1.findMany({
    where: { staffId: performerId, attendanceMonth: month },
    select: { attendanceType: true }
  });
  const m = {
    workDays: 0, nightShows: 0, absent: 0, leave: 0, late: 0, lateOver: 0,
    early: 0, earlyOver: 0, sick: 0, paidLeave: 0
  };
  for (const r of rows) {
    const t = r.attendanceType;
    if (SYNC_WORK_DAY_TYPES[t] != null) {
      m.workDays += SYNC_WORK_DAY_TYPES[t];
      if (t === 'night') m.nightShows += 1;
    } else if (t === 'absent') m.absent += 1;
    else if (t === 'late') m.late += 1;
    else if (t === 'late_over') { m.lateOver += 1; m.late += 1; }
    else if (t === 'early') m.early += 1;
    else if (t === 'early_over') { m.earlyOver += 1; m.early += 1; }
    else if (t === 'PL') m.leave += 1;
    else if (t === 'SL') m.sick += 1;
    else if (t === 'AL' || t === 'ML' || t === 'BL') m.paidLeave += 1;
    else if (t === 'leave' || t === 'outing' || t === 'study' || t === 'business' || t === 'injury') m.leave += 1;
  }
  return m;
}


async function syncPerformerToWageItems(performerId, fields) {
  if (!performerId) return { synced: 0, created: 0 };
  try {
    const draftBatches = await prisma.wageBatchesV1.findMany({
      where: { status: 'draft' },
      select: { id: true, wageMonth: true }
    });
    if (!draftBatches.length) return { synced: 0, created: 0 };

    // 取人员最新完整字段（create 调用时 fields 已够，但 update/approve 统一从库里取以保证口径一致）
    const perf = await prisma.performersDbV1.findUnique({
      where: { id: performerId },
      select: { id: true, staffNo: true, name: true, rankGrade: true, dailyRate: true, employmentType: true, status: true }
    });
    if (!perf || perf.status === 'deleted') return { synced: 0, created: 0 };
    // 只有在职（active）人员才自动新建工资条；pending/left 等状态仅更新已有明细，不新增
    const canCreate = perf.status === 'active';

    const newDailyRate = perf.dailyRate != null && Number(perf.dailyRate) > 0 ? Number(perf.dailyRate) : null;

    const basePatch = {};
    if (perf.name != null) basePatch.performerName = perf.name;
    if (perf.staffNo != null) basePatch.staffNo = perf.staffNo;
    if (perf.rankGrade != null) basePatch.rankGrade = perf.rankGrade;

    let synced = 0;
    let created = 0;

    // P0 性能修复：消除 N+1——一次性取出该人员在全部草稿批次的已有明细，循环内只查 Map
    const draftIds = draftBatches.map(x => x.id);
    const existingRows = await prisma.wageItemsV1.findMany({
      where: { performerId, batchId: { in: draftIds } }
    });
    const existingByBatch = new Map(existingRows.map(r => [r.batchId, r]));
    // 职级工资规则仅依赖 perf.rankGrade，与批次无关，提升到循环外只查一次
    const ruleRow = perf.rankGrade
      ? await prisma.wageRulesV1.findFirst({ where: { rankGrade: perf.rankGrade, status: 'active' } })
      : null;

    for (const batch of draftBatches) {
      const existing = existingByBatch.get(batch.id) || null;

      if (existing) {
        // ---- 已有明细：更新字段 ----
        const patch = { ...basePatch };
        let batchIncr = null;
        if (newDailyRate != null) {
          const days = Number(existing.attendanceDays) || 0;
          const oldBase = Number(existing.baseWage) || 0;
          const newBase = _round2(newDailyRate * days);
          const baseDiff = _round2(newBase - oldBase);
          const oldGross = Number(existing.grossPay) || 0;
          const newGross = _round2(oldGross + baseDiff);
          // 日工资变化会同步影响“迟到超30分钟/旷工”等与日薪挂钩的扣罚，按唯一口径重算
          let oldNote = {};
          try { oldNote = JSON.parse(existing.otherDeductionNote || '{}'); } catch (_) {}
          const penalty = computeAttendancePenalty(
            { late: oldNote.late || 0, lateOver: oldNote.lateOver || 0, absent: oldNote.absent || 0 },
            newDailyRate
          );
          const oldDeduct = Number(existing.totalDeduction) || 0;
          const newDeduct = _round2(Math.min(penalty.total, newGross));
          const unpaidCarryOver = _round2(Math.max(0, penalty.total - newGross));
          const newNet = _round2(newGross - newDeduct);
          const parts = [];
          if (penalty.lateFine) parts.push(`迟到${penalty.lateTimes}次×20元=¥${penalty.lateFine}`);
          if (penalty.lateOverFine) parts.push(`迟到超30分钟${penalty.lateOverTimes}次按旷工半天扣¥${penalty.lateOverFine}`);
          if (penalty.absentFine) parts.push(`旷工${penalty.absentDays}天扣两日工资¥${penalty.absentFine}`);
          if (unpaidCarryOver) parts.push(`扣罚超出应发¥${unpaidCarryOver}，本次按0元发放，余额依条例另行追缴`);
          patch.baseWage = newBase;
          patch.grossPay = newGross;
          patch.totalDeduction = newDeduct;
          patch.netPay = newNet;
          patch.otherDeductionNote = JSON.stringify({
            leave: oldNote.leave || 0,
            absent: penalty.absentDays,
            late: penalty.lateTimes,
            lateOver: penalty.lateOverTimes,
            lateFine: penalty.lateFine,
            lateOverFine: penalty.lateOverFine,
            absentFine: penalty.absentFine,
            unpaidCarryOver
          });
          patch.remark = `协议天工资 ¥${newDailyRate}/天 × ${days}天${parts.length ? '；扣罚：' + parts.join('；') : ''}`;
          batchIncr = {
            base: baseDiff,
            deduct: _round2(newDeduct - oldDeduct),
            net: _round2(newNet - (Number(existing.netPay) || 0))
          };
        }
        patch.ts = BigInt(nowMs());
        await prisma.wageItemsV1.update({ where: { id: existing.id }, data: patch });
        // 金额有变化时增量回写批次汇总
        if (batchIncr) {
          await prisma.wageBatchesV1.update({
            where: { id: batch.id },
            data: {
              totalBaseWage: { increment: batchIncr.base },
              totalDeduction: { increment: batchIncr.deduct },
              totalNetPay: { increment: batchIncr.net },
              ts: BigInt(nowMs())
            }
          });
        }
        synced++;
      } else {
        // ---- 无明细：仅在职人员按当月考勤自动创建 ----
        if (!canCreate) continue;
        const att = await _attendanceOfMonth(performerId, batch.wageMonth);
        // 与 wages.generate 跳过规则一致：无考勤且无协议天工资不创建
        if (att.workDays <= 0 && newDailyRate == null) continue;

        const dailyRate = newDailyRate != null
          ? newDailyRate
          : (ruleRow ? Number(ruleRow.baseDailyStandard) || 0 : 0);
        const baseWage = _round2(dailyRate * att.workDays);
        const nightShowBonus = ruleRow ? _round2((Number(ruleRow.nightShowBonus) || 0) * att.nightShows) : 0;
        const isFull = att.workDays > 0 && att.absent === 0 && att.leave === 0
          && att.sick === 0 && att.late < 3 && att.early < 3;
        const fullAttendanceBonus = isFull ? (ruleRow ? Number(ruleRow.fullAttendanceBonus) || 0 : 0) : 0;
        const transportAllowance = ruleRow ? _round2((Number(ruleRow.transportAllowance) || 0) * att.workDays) : 0;
        const mealAllowance = ruleRow ? _round2((Number(ruleRow.mealAllowance) || 0) * att.workDays) : 0;
        const grossPay = _round2(baseWage + nightShowBonus + fullAttendanceBonus + transportAllowance + mealAllowance);
        // 考勤扣罚（与 wages.generate 同一口径）
        const penalty = computeAttendancePenalty(att, dailyRate);
        const totalDeduction = _round2(Math.min(penalty.total, grossPay));
        const unpaidCarryOver = _round2(Math.max(0, penalty.total - grossPay));
        const netPay = _round2(grossPay - totalDeduction);
        const rateNote = newDailyRate != null
          ? `花名册同步：协议天工资 ¥${dailyRate}/天 × ${att.workDays}天`
          : `花名册同步：职级日薪 ¥${dailyRate}/天 × ${att.workDays}天`;
        const penaltyParts = [];
        if (penalty.lateFine) penaltyParts.push(`迟到${penalty.lateTimes}次×20元=¥${penalty.lateFine}`);
        if (penalty.lateOverFine) penaltyParts.push(`迟到超30分钟${penalty.lateOverTimes}次按旷工半天扣¥${penalty.lateOverFine}`);
        if (penalty.earlyFine) penaltyParts.push(`早退${penalty.earlyTimes}次×20元=¥${penalty.earlyFine}`);
        if (penalty.earlyOverFine) penaltyParts.push(`早退超30分钟${penalty.earlyOverTimes}次按旷工半天扣¥${penalty.earlyOverFine}`);
        if (penalty.absentFine) penaltyParts.push(`旷工${penalty.absentDays}天扣两日工资¥${penalty.absentFine}`);
        if (unpaidCarryOver) penaltyParts.push(`扣罚超出应发¥${unpaidCarryOver}，本次按0元发放，余额依条例另行追缴`);
        const remark = penaltyParts.length ? `${rateNote}；扣罚：${penaltyParts.join('；')}` : rateNote;

        await prisma.wageItemsV1.create({
          data: {
            id: idByCtx('wage', 12, nanoid),
            batchId: batch.id,
            performerId: perf.id,
            performerName: perf.name,
            staffNo: perf.staffNo || null,
            rankGrade: perf.rankGrade || null,
            attendanceDays: att.workDays,
            baseWage,
            nightShowBonus,
            fullAttendanceBonus,
            transportAllowance,
            mealAllowance,
            grossPay,
            totalDeduction,
            netPay,
            otherDeduction: _round2(
              penalty.absentFine + penalty.lateFine + penalty.lateOverFine
              + penalty.earlyFine + penalty.earlyOverFine
            ),
            otherDeductionNote: JSON.stringify({
              mode: 'daily_pure',
              leave: 0,
              absent: penalty.absentFine,
              late: _round2(penalty.lateFine + penalty.lateOverFine),
              early: _round2(penalty.earlyFine + penalty.earlyOverFine),
              lateTimes: penalty.lateTimes, lateOverTimes: penalty.lateOverTimes,
              earlyTimes: penalty.earlyTimes, earlyOverTimes: penalty.earlyOverTimes,
              absentDays: penalty.absentDays,
              unpaidCarryOver
            }),
            remark,
            ts: BigInt(nowMs())
          }
        });
        // 批次汇总增量
        await prisma.wageBatchesV1.update({
          where: { id: batch.id },
          data: {
            totalPerformers: { increment: 1 },
            totalBaseWage: { increment: baseWage },
            totalAllowance: { increment: _round2(transportAllowance + mealAllowance) },
            totalBonus: { increment: _round2(nightShowBonus + fullAttendanceBonus) },
            totalDeduction: { increment: totalDeduction },
            totalNetPay: { increment: netPay },
            ts: BigInt(nowMs())
          }
        });
        created++;
      }
    }
    return { synced, created };
  } catch (e) {
    return { synced: 0, created: 0, error: e && e.message ? e.message : String(e) };
  }
}

// ========== 工号自动分配（后端为唯一事实来源）==========
// 规则：扫描全表（含软删除记录——staffNo 唯一索引覆盖它们）所有 PF\d+ 工号，取最大序号 +1，格式 PF001/PF002...
// 历史 QA-P-xxxx 工号为历史批次，保留不动、不计入 PF 序列；唯一冲突时重试。
// 注意：不能只查在岗记录，否则停用/删除的最大号会被重新分配，触发唯一约束冲突。

const allocateStaffNo = async (maxRetries = 3) => {
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    const rows = await prisma.performersDbV1.findMany({
      where: { staffNo: { not: null } },
      select: { staffNo: true }
    });
    let max = 0;
    rows.forEach(r => {
      const m = /^PF(\d+)$/i.exec(r.staffNo || '');
      if (m) max = Math.max(max, parseInt(m[1], 10));
    });
    const candidate = 'PF' + String(max + 1).padStart(3, '0');
    const clash = rows.some(r => r.staffNo === candidate);
    if (!clash) return candidate;
  }
  throw new BusinessError('INTERNAL_ERROR', '工号分配失败：序号冲突，请重试');
};


const REJECTED_TTL_MIN = 10;

async function cleanupRejectedRecords() {
  try {
    const cutoff = new Date(Date.now() - REJECTED_TTL_MIN * 60 * 1000);
    const expired = await prisma.performersDbV1.findMany({
      where: { reviewStatus: 'rejected', status: { not: 'deleted' }, updatedAt: { lt: cutoff } },
      select: { id: true, name: true }
    });
    if (!expired.length) return 0;
    await prisma.performersDbV1.updateMany({
      where: { id: { in: expired.map(r => r.id) } },
      data: { status: 'deleted', reviewStatus: 'expired', reviewFeedback: null, updatedAt: new Date(), ts: BigInt(nowMs()) }
    });
    console.log(`[cleanupRejected] ${expired.length} 条退回记录已过期清除`);
    return expired.length;
  } catch (e) {
    console.error('[cleanupRejected] error:', e.message);
    return 0;
  }
}
// 定时清理：每 60 秒执行一次
setInterval(cleanupRejectedRecords, 60 * 1000);
// 启动时延迟 5 秒执行一次
setTimeout(cleanupRejectedRecords, 5000);


const ACTOR_KW = ['生', '旦', '净', '丑', '花脸', '青衣', '龙套', '宫女', '演员', '二架男', '二架女', '彩女', '长随官'];

const MUSIC_KW = ['板胡', '司鼓', '二胡', '高胡', '中胡', '扬琴', '月琴', '琵琶', '三弦', '笛子', '笙', '唢呐', '大提琴', '贝斯', '电子琴', '打击乐', '梆子', '锣', '铙钹', '铰子', '碰铃', '琴师', '鼓师', '乐队', '文场', '武场', '文二手', '武二手', '二手'];

const STAGE_KW = ['灯光', '音响', '服装', '道具', '化妆', '布景', '装置', '字幕', '电工', '舞美', '舞台监督', '后场', '剧务', '帽箱', '衣箱', '前场'];

// 按行当(primaryRole)归类，无法判定时用部门(employmentType)兜底；返回 actor/music/stage/other

const classifyCrew = (role, dept) => {
  const r = String(role || '');
  const d = String(dept || '');
  const hit = kw => kw.some(k => r.indexOf(k) >= 0);
  if (r) {
    if (hit(ACTOR_KW)) return 'actor';
    if (hit(MUSIC_KW)) return 'music';
    if (hit(STAGE_KW)) return 'stage';
  }
  if (d.indexOf('乐队') >= 0 || d.indexOf('文武场') >= 0) return 'music';
  if (d.indexOf('舞美') >= 0 || d.indexOf('舞台') >= 0) return 'stage';
  if (d.indexOf('演员') >= 0) return 'actor';
  return 'other';
};

const PRESENT_TYPES = ['full', 'night', 'double', 'half'];

const EXCEPTION_TYPES = ['absent', 'late', 'leave', 'outing', 'study', 'business', 'injury'];


module.exports = {
  DATE_FIELDS,
  toDailyRate,
  buildData,
  SYNC_WORK_DAY_TYPES,
  _round2,
  _attendanceOfMonth,
  syncPerformerToWageItems,
  allocateStaffNo,
  REJECTED_TTL_MIN,
  cleanupRejectedRecords,
  ACTOR_KW,
  MUSIC_KW,
  STAGE_KW,
  classifyCrew,
  PRESENT_TYPES,
  EXCEPTION_TYPES,
};
