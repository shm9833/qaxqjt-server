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
// 复用工资核算唯一扣罚口径（v20261012 打卡新规：迟到按打卡分钟1元/分·单场封顶30元·≥30分本场失效；事故分级10/30/50元/天）
const { computeAttendancePenalty, _calcWageItem, _punchLateStatsByStaff, _parseBatchPeriod } = require('../wages');
const punchParamsSvc = require('../../services/punch-params');

const DATE_FIELDS = ['birthDate', 'hireDate'];


const toDailyRate = v => {
  if (v === undefined || v === null || v === '') return null;
  const n = Number(v);
  if (!isFinite(n) || n < 0) return null;
  return Math.round(n * 100) / 100;
};


// ========== 行当(primaryRole) ↔ 部门(employmentType) 关联映射 ==========
// DB 无 department 列：部门统一落 employment_type（队别：演员队/乐队/舞美队/服装道具/行政），
// 行当落 primary_role。历史上存在"部门名被误写入行当字段"的脏数据，此处统一归一化修复。
const DEPT_NAMES = ['演员队', '乐队', '舞美队', '服装道具', '行政'];
const DEPT_BY_CAT = { actor: '演员队', music: '乐队', stage: '舞美队' };

// 完整 行当→队别 映射（与前端编辑弹窗 optgroup 分组、stdRole 归一口径一致，并覆盖历史遗留写法）。
// 命中顺序：乐队 → 舞美队 → 演员队；均未命中（如"其他"）返回空串，保留用户所选队别。
const ROLE_DEPT_RULES = [
  ['乐队', ['武场', '文场', '文乐队', '打击', '司鼓', '板鼓', '堂鼓', '战鼓', '鼓师', '鼓', '大锣', '小锣', '马锣', '锣', '铙', '钹', '镲', '木鱼', '梆子', '武二手', '文二手', '二手', '板胡', '二胡', '高胡', '中胡', '椰胡', '胡', '扬琴', '月琴', '琴师', '琴', '琵琶', '三弦', '古筝', '竹笛', '笛', '笙', '唢呐', '海笛', '梅管', '大提琴', '贝斯', '贝司', '提琴', '电子琴']],
  ['舞美队', ['帽箱', '盔箱', '衣箱', '电工', '灯光', '音响', '话筒', '耳麦', '剧务', '前场', '后勤', '后场', '化妆', '道具', '服装', '跟包', '布景', '装置', '字幕', '舞台监督', '装台', '催场', '场记']],
  ['演员队', ['生', '旦', '净', '丑', '花脸', '青衣', '龙套', '青袍', '文堂', '校尉', '刀斧手', '刽子手', '丫鬟', '丫环', '使女', '彩女', '宫娥', '宫女', '长随', '门官', '家院', '管家', '老仆', '二架', '演员']]
];
const deptOfRoleFull = role => {
  const s = String(role || '');
  if (!s) return '';
  for (let i = 0; i < ROLE_DEPT_RULES.length; i++) {
    const kws = ROLE_DEPT_RULES[i][1];
    for (let j = 0; j < kws.length; j++) { if (s.indexOf(kws[j]) >= 0) return ROLE_DEPT_RULES[i][0]; }
  }
  return '';
};

// 归一化行当/部门，返回 { role, emp, migrated }
//  v20261015 配置变更：完全保留入职人员自行填写的内容，不做任何自动映射/规则转换/强制校验
const normalizeRoleDept = b => {
  const role = b.primaryRole;
  const emp = b.employmentType !== undefined ? b.employmentType : b.department;
  return { role, emp, migrated: false };
};

const buildData = b => {
  const nd = normalizeRoleDept(b);
  const data = {
    staffNo: b.staffNo || null,
    name: b.name,
    gender: b.gender || null,
    phone: b.phone || null,
    idCardNo: b.idCardNo || null,
    rankGrade: b.rankGrade || null,
    primaryRole: nd.role || null,
    employmentType: nd.emp || null,
    bankAccount: b.bankAccount || null,
    bankName: b.bankName || null,
    socialSecurityNo: b.socialSecurityNo || null,
    status: b.status || 'active',
    remark: b.remark || null,
    avatarUrl: b.avatarUrl || null,
    agreedSalary: b.agreedSalary || null,
    dailyRate: toDailyRate(b.dailyRate),
    transportType: b.transportType || null,
    travelFeeAmount: toDailyRate(b.travelFeeAmount),
    // v20261028f 装卸车扣款单价（元/次）：装卸车登记缺席次数 × 该单价计入工资扣款
    loadUnloadParticipate: b.loadUnloadParticipate === undefined ? true : !!b.loadUnloadParticipate,
    loadUnloadDeduct: toDailyRate(b.loadUnloadDeduct) == null ? 0 : toDailyRate(b.loadUnloadDeduct),
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


// v20261024 区间结算（wrange1024）：从批次解析结算周期 → 归集 range；整月批次返回 null（等价历史整月行为）
function _batchPeriodRange(batch) {
  const p = batch && _parseBatchPeriod(batch.batchNo, batch.wageMonth);
  if (!p) return null;
  const ltT = Date.UTC(Number(p.end.substring(0, 4)), Number(p.end.substring(5, 7)) - 1, Number(p.end.substring(8, 10))) + 86400000;
  return { gte: new Date(p.start + 'T00:00:00.000Z'), lt: new Date(ltT) };
}

async function _attendanceOfMonth(performerId, month, range) {
  // v20261024 区间结算：传 range（子区间批次）时按考勤日期过滤；缺省按 attendanceMonth 整月
  const rows = await prisma.attendanceV1.findMany({
    where: range && range.gte && range.lt
      ? { staffId: performerId, attendanceDate: { gte: range.gte, lt: range.lt } }
      : { staffId: performerId, attendanceMonth: month },
    select: { attendanceType: true }
  });
  const m = {
    workDays: 0, nightShows: 0, absent: 0, leave: 0, late: 0, lateOver: 0,
    early: 0, earlyOver: 0, sick: 0, paidLeave: 0, accident1: 0, accident2: 0, accident3: 0
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
    else if (t === 'stage_in' || t === 'stage_out') { /* 装台/卸台日：不计薪资、不计迟到、不计奖励 */ }
    else if (t === 'accident_l1') m.accident1 += 1;
    else if (t === 'accident_l2') m.accident2 += 1;
    else if (t === 'accident_l3') m.accident3 += 1;
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
          // 日工资变化会同步影响“旷工”等与日薪挂钩的扣罚；迟到罚款按打卡分钟口径不随日薪变化（从旧备注透传）
          let oldNote = {};
          try { oldNote = JSON.parse(existing.otherDeductionNote || '{}'); } catch (_) {}
          const punchP = await punchParamsSvc.getPunchParams();
          const penalty = computeAttendancePenalty(
            {
              late: oldNote.lateTimes || 0, lateOver: oldNote.lateOverTimes || 0,
              absent: oldNote.absentDays || 0,
              lateFinePunch: oldNote.lateFine || 0,
              accident1: oldNote.accident1 || 0, accident2: oldNote.accident2 || 0, accident3: oldNote.accident3 || 0
            },
            newDailyRate, null, punchP
          );
          const oldDeduct = Number(existing.totalDeduction) || 0;
          const newDeduct = _round2(Math.min(penalty.total, newGross));
          const unpaidCarryOver = _round2(Math.max(0, penalty.total - newGross));
          const newNet = _round2(newGross - newDeduct);
          const parts = [];
          if (penalty.lateFine) parts.push(`迟到${oldNote.lateMinutes || 0}分钟（${oldNote.lateShows || penalty.lateTimes}场）按${punchP.lateFinePerMin}元/分钟·单场封顶${punchP.lateFineCap}元=¥${penalty.lateFine}`);
          if (oldNote.invalidShows) parts.push(`迟到满${punchP.lateInvalidMinutes}分钟${oldNote.invalidShows}场本场失效，该场不计薪`);
          if (penalty.accidentFine) parts.push(`事故扣款：一级${oldNote.accident1 || 0}天×${punchP.accidentLevel1Fine}元 + 二级${oldNote.accident2 || 0}天×${punchP.accidentLevel2Fine}元 + 三级${oldNote.accident3 || 0}天×${punchP.accidentLevel3Fine}元=¥${penalty.accidentFine}`);
          if (penalty.absentFine) parts.push(`旷工${penalty.absentDays}天扣两日工资¥${penalty.absentFine}`);
          if (unpaidCarryOver) parts.push(`扣罚超出应发¥${unpaidCarryOver}，本次按0元发放，余额依条例另行追缴`);
          patch.baseWage = newBase;
          patch.grossPay = newGross;
          patch.totalDeduction = newDeduct;
          patch.netPay = newNet;
          patch.otherDeductionNote = JSON.stringify({
            ...oldNote,
            leave: oldNote.leave || 0,
            absent: penalty.absentDays,
            late: penalty.lateFine,
            lateFine: penalty.lateFine,
            lateOverFine: penalty.lateOverFine,
            absentFine: penalty.absentFine,
            accident: penalty.accidentFine,
            accident1: oldNote.accident1 || 0,
            accident2: oldNote.accident2 || 0,
            accident3: oldNote.accident3 || 0,
            invalidShows: oldNote.invalidShows || 0,
            lateMinutes: oldNote.lateMinutes || 0,
            lateShows: oldNote.lateShows || 0,
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
        // ---- 无明细：仅在职人员按当月/区间考勤自动创建 ----
        if (!canCreate) continue;
        const periodRange = _batchPeriodRange(batch); // v20261024 区间批次只按其结算周期补建，避免整月补建错账
        const att = await _attendanceOfMonth(performerId, batch.wageMonth, periodRange);
        // 与 wages.generate 跳过规则一致：无考勤且无协议天工资不创建
        if (att.workDays <= 0 && newDailyRate == null) continue;

        // v20261012 与 wages.generate 唯一口径统一：按日薪结算（不用等级工资）+ 打卡迟到新规 + 事故分级
        const punchP = await punchParamsSvc.getPunchParams();
        const punchMap = await _punchLateStatsByStaff(batch.wageMonth, punchP, periodRange);
        const ps = punchMap[performerId];
        if (ps) {
          att.lateFinePunch = ps.lateFine;
          att.lateMinutes = ps.lateMinutes;
          att.lateShows = ps.lateShows;
          att.invalidShows = ps.invalidShows;
        }
        const calc = _calcWageItem(perf, att, ruleRow, null, punchP);
        const remark = `花名册同步：${calc.remark}`;

        await prisma.wageItemsV1.create({
          data: {
            id: idByCtx('wage', 12, nanoid),
            batchId: batch.id,
            performerId: perf.id,
            performerName: perf.name,
            staffNo: perf.staffNo || null,
            rankGrade: perf.rankGrade || null,
            attendanceDays: calc.attendanceDays,
            baseWage: calc.baseWage,
            nightShowBonus: calc.nightShowBonus,
            fullAttendanceBonus: calc.fullAttendanceBonus,
            transportAllowance: calc.transportAllowance,
            mealAllowance: calc.mealAllowance,
            grossPay: calc.grossPay,
            totalDeduction: calc.totalDeduction,
            netPay: calc.netPay,
            otherDeduction: calc.otherDeduction,
            otherDeductionNote: calc.otherDeductionNote,
            remark,
            ts: BigInt(nowMs())
          }
        });
        // 批次汇总增量
        await prisma.wageBatchesV1.update({
          where: { id: batch.id },
          data: {
            totalPerformers: { increment: 1 },
            totalBaseWage: { increment: calc.baseWage },
            totalAllowance: { increment: _round2(calc.transportAllowance + calc.mealAllowance) },
            totalBonus: { increment: _round2(calc.nightShowBonus + calc.fullAttendanceBonus) },
            totalDeduction: { increment: calc.totalDeduction },
            totalNetPay: { increment: calc.netPay },
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
  DEPT_NAMES,
  normalizeRoleDept,
  deptOfRoleFull,
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
