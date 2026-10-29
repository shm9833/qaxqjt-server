/* performers/independent.js — 无交叉依赖的 handlers（自 performers.js 拆分） */
'use strict';

/**
 * src/controllers/performers.js —— 演职人员花名册 CRUD
 */
const { nanoid } = require('nanoid');
const prisma = require('../../utils/prisma');
const { success, created, parsePage, pagedSuccess } = require('../../utils/response');
const { idByCtx, nowMs } = require('../../config');
const { BusinessError } = require('../../middleware/error-handler');
const { audit } = require('../../services/audit-service');
// 复用工资核算唯一扣罚口径（迟到20元/次、迟到超30分钟扣半日、旷工1天扣两日）
const { computeAttendancePenalty } = require('../wages');
// 复用工资条订单溯源口径（v20261027c 演出日期天数）计算当月演出天数
const { _orderBreakdownByStaff } = require('../wages/helpers');
const { DATE_FIELDS, toDailyRate, syncPerformerToWageItems, classifyCrew, PRESENT_TYPES, normalizeRoleDept, deptOfRoleFull } = require('./helpers');

const list = async ctx => {
  const { skip, take, page, pageSize } = parsePage(ctx.query);
  const where = {};
  const kw = (ctx.query.keyword || '').trim();
  if (kw) {
    where.OR = [
      { name: { contains: kw } },
      { staffNo: { contains: kw } },
      { phone: { contains: kw } },
      { idCardNo: { contains: kw } },
      { primaryRole: { contains: kw } }
    ];
  }
  if (ctx.query.status) where.status = ctx.query.status;
  else where.status = { not: 'deleted' }; // 默认排除已删除（软删）记录
  if (ctx.query.gender) where.gender = ctx.query.gender;
  if (ctx.query.primaryRole) where.primaryRole = ctx.query.primaryRole;
  if (ctx.query.rankGrade) where.rankGrade = ctx.query.rankGrade;
  if (ctx.query.employmentType) where.employmentType = ctx.query.employmentType;
  const [rows, total] = await Promise.all([
    prisma.performersDbV1.findMany({
      where,
      skip,
      take,
      orderBy: { createdAt: 'desc' }
    }),
    prisma.performersDbV1.count({ where })
  ]);
  return pagedSuccess(ctx, rows, total, page, pageSize);
};

// 协议天工资：空串/非法值 -> null；合法数值保留两位小数

const detail = async ctx => {
  const row = await prisma.performersDbV1.findUnique({ where: { id: ctx.params.id } });
  if (!row) throw new BusinessError('NOT_FOUND', '演职人员不存在');
  return success(ctx, row);
};


const update = async ctx => {
  const b = ctx.request.body;
  const patch = {};
  // 行当/部门任一被提交即整体归一化：修复"部门名写进行当"的历史脏数据，并保证二者一致
  const roleProvided = b.primaryRole !== undefined;
  const deptProvided = b.employmentType !== undefined || b.department !== undefined;
  const nd = normalizeRoleDept(b);
  [
    'staffNo',
    'name',
    'gender',
    'phone',
    'idCardNo',
    'rankGrade',
    'bankAccount',
    'bankName',
    'socialSecurityNo',
    'status',
    'remark',
    'avatarUrl',
    'agreedSalary',
    'transportType',
    'travelFeeAmount',
    'loadUnloadParticipate'
  ].forEach(k => {
    if (b[k] !== undefined) patch[k] = b[k];
  });
  if (roleProvided) patch.primaryRole = nd.role || null;
  if (deptProvided) patch.employmentType = nd.emp || null;
  // v20261015：完全保留入职人员自行填写的内容，不做部门↔行当自动对齐/强制映射
  if (b.dailyRate !== undefined) patch.dailyRate = toDailyRate(b.dailyRate);
  if (b.travelFeeAmount !== undefined) patch.travelFeeAmount = toDailyRate(b.travelFeeAmount);
  // v20261028f 装卸车扣款单价（元/次）
  if (b.loadUnloadDeduct !== undefined) patch.loadUnloadDeduct = toDailyRate(b.loadUnloadDeduct) == null ? 0 : toDailyRate(b.loadUnloadDeduct);
  DATE_FIELDS.forEach(k => {
    if (b[k] !== undefined) patch[k] = b[k] ? new Date(b[k]) : null;
  });
  patch.updatedAt = new Date();
  patch.ts = BigInt(nowMs());
  const row = await prisma.performersDbV1.update({ where: { id: ctx.params.id }, data: patch });
  await audit({ ctx, module: 'performers', action: 'PERFORMER_UPDATE', targetId: row.id });
  // 人员变更时刷新现有 draft 批次工资条（name/staffNo/rankGrade/dailyRate）
  await syncPerformerToWageItems(row.id, { name: row.name, staffNo: row.staffNo, rankGrade: row.rankGrade, dailyRate: row.dailyRate });
  // v20261028f 装卸车单价变化后：重算该人员全部草稿工资条（缺席次数 × 新单价）
  if (b.loadUnloadDeduct !== undefined) {
    try { await require('../wages/helpers').syncDraftWagesForPerformerAll(row.id); } catch (_) {}
  }
  return success(ctx, row);
};


const stats = async ctx => {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.toISOString().substring(0, 7);
  const yearStart = new Date(year, 0, 1);
  const yearEnd = new Date(year + 1, 0, 1);

  const [activeRows, allRows, attRows, attTypeGroups, castCrewYear] = await Promise.all([
    prisma.performersDbV1.findMany({ where: { status: 'active' }, select: { primaryRole: true, employmentType: true } }),
    prisma.performersDbV1.findMany({ select: { id: true, primaryRole: true } }),
    prisma.attendanceV1.findMany({ where: { attendanceMonth: month }, select: { attendanceType: true } }),
    prisma.attendanceV1.groupBy({ by: ['attendanceType'], where: { attendanceMonth: month }, _count: true }),
    prisma.castSheetCrew.findMany({
      where: { castSheet: { performanceDate: { gte: yearStart, lt: yearEnd } } },
      select: { id: true, castSheet: { select: { playId: true } } }
    })
  ]).catch(() => [[], [], [], [], []]);

  // 1) 在职人数 + 部门拆分
  const totalActive = activeRows.length;
  let actorCount = 0, musicCount = 0, stageCount = 0, otherCount = 0;
  activeRows.forEach(p => {
    const cat = classifyCrew(p.primaryRole, p.employmentType);
    if (cat === 'actor') actorCount++;
    else if (cat === 'music') musicCount++;
    else if (cat === 'stage') stageCount++;
    else otherCount++;
  });

  // 2) 本月在岗率 = 出勤记录数 / (出勤+异常) * 100
  let present = 0, absent = 0, late = 0, leave = 0;
  attTypeGroups.forEach(g => {
    const t = g.attendanceType;
    if (PRESENT_TYPES.indexOf(t) >= 0) present += g._count;
    else if (t === 'absent') absent += g._count;
    else if (t === 'late') late += g._count;
    else if (t === 'leave' || t === 'outing' || t === 'study' || t === 'business' || t === 'injury') leave += g._count;
  });
  const totalAtt = present + absent + late + leave;
  const attendanceRate = totalAtt > 0 ? Math.round((present / totalAtt) * 1000) / 10 : 0;

  // 3) 本年度累计参演（按 cast_sheet_crew 人次统计）
  const totalPerformances = castCrewYear.length;
  // 本戏/折子拆分：查 play 表按 category 归类
  let benxi = 0, zhezi = 0;
  try {
    const playIds = [...new Set(castCrewYear.map(c => c.castSheet?.playId).filter(Boolean))];
    if (playIds.length) {
      const plays = await prisma.play.findMany({ where: { id: { in: playIds } }, select: { id: true, category: true } });
      const playCatMap = {};
      plays.forEach(p => { playCatMap[p.id] = p.category; });
      castCrewYear.forEach(c => {
        const cat = playCatMap[c.castSheet?.playId] || '';
        if (/本戏/.test(cat)) benxi++;
        else if (/折子/.test(cat)) zhezi++;
      });
    }
  } catch (_) { /* ignore */ }

  // 4) 待考勤异常 = 本月异常类型记录数
  const pendingExceptions = absent + late + leave;

  return success(ctx, {
    year,
    month,
    totalActive,
    deptBreakdown: { actor: actorCount, music: musicCount, stage: stageCount, other: otherCount },
    monthlyAttendanceRate: attendanceRate,
    monthlyAttendance: { present, absent, late, leave, total: totalAtt },
    yearlyPerformances: { total: totalPerformances, benxi, zhezi },
    pendingExceptions,
    exceptionBreakdown: { late, absent }
  });
};


// v20261028 员工编辑弹窗工资预览（GET /v1/performers/:id/salary-preview?month=YYYY-MM）：
//   performanceDays = 当月演出天数（复用 _orderBreakdownByStaff 口径：Σ 参与订单演出段 showDays，
//                     与工资 daily_pure 计薪天一致，弹窗「演出期间天工资合计 = 协议天工资 × 演出天数」）；
//   unlinkedIncome  = 当月未挂演出订单的收入（已生效 active 且未挂场次 scheduleId 为空的差旅路费合计）。
// v20261028j（travelgrace1028）修复「已挂场次的报销被排除、显示 ¥0.00 误导」：
//   travelTotal  = 当月全部已生效（active）差旅报销合计（含挂场次+未挂场次）——与工资「差旅路费」口径一致；
//   pendingTotal = 当月待审核（pending）报销合计（尚未计入工资，弹窗单独提示）；
//   travelItems  = 全部报销明细（active+pending，含状态与场次标题）。
const salaryPreview = async ctx => {
  const { id } = ctx.params;
  const month = /^\d{4}-\d{2}$/.test(String(ctx.query.month || '')) ? String(ctx.query.month) : new Date().toISOString().substring(0, 7);
  const perf = await prisma.performersDbV1.findUnique({ where: { id }, select: { name: true, dailyRate: true } });
  if (!perf) throw new BusinessError('NOT_FOUND', '人员不存在');
  const ob = await _orderBreakdownByStaff(month);
  const mine = ob[id];
  let performanceDays = 0;
  if (mine) Object.keys(mine.orders).forEach(oid => { performanceDays += mine.orders[oid].showDays || 0; });
  const y = Number(month.substring(0, 4));
  const m = Number(month.substring(5, 7));
  // v20261028j：一次拉取当月该人员全部报销（active+pending），前端按状态分组展示
  const allRows = await prisma.travelExpenseV1.findMany({
    where: {
      performerId: id,
      expenseDate: { gte: new Date(Date.UTC(y, m - 1, 1)), lt: new Date(Date.UTC(y, m, 1)) },
      status: { in: ['active', 'pending'] }
    },
    select: { id: true, expenseNo: true, expenseDate: true, amount: true, transportType: true, remark: true, status: true, scheduleId: true },
    orderBy: { expenseDate: 'asc' }
  });
  const unlinkedRows = allRows.filter(r => r.status === 'active' && !r.scheduleId);
  const unlinkedIncome = Math.round(unlinkedRows.reduce((s, r) => s + (Number(r.amount) || 0), 0) * 100) / 100;
  // v20261028b：未关联明细行（供编辑弹窗逐笔关联订单）
  const unlinkedItems = unlinkedRows.map(r => ({
    id: r.id,
    expenseNo: r.expenseNo,
    expenseDate: r.expenseDate ? new Date(r.expenseDate).toISOString().substring(0, 10) : '',
    amount: Number(r.amount) || 0,
    transportType: r.transportType || '',
    remark: r.remark || ''
  }));
  // v20261028j：差旅合计（active 含挂场次）+ 待审核合计 + 全明细（关联场次标题）
  const travelTotal = Math.round(allRows.filter(r => r.status === 'active').reduce((s, r) => s + (Number(r.amount) || 0), 0) * 100) / 100;
  const pendingTotal = Math.round(allRows.filter(r => r.status === 'pending').reduce((s, r) => s + (Number(r.amount) || 0), 0) * 100) / 100;
  const schedIds = [...new Set(allRows.map(r => r.scheduleId).filter(Boolean))];
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
  const travelItems = allRows.map(r => ({
    id: r.id,
    expenseNo: r.expenseNo,
    expenseDate: r.expenseDate ? new Date(r.expenseDate).toISOString().substring(0, 10) : '',
    amount: Number(r.amount) || 0,
    transportType: r.transportType || '',
    remark: r.remark || '',
    status: r.status,
    linkedToSchedule: !!r.scheduleId,
    scheduleTitle: r.scheduleId ? (schedMap[r.scheduleId] || '（场次已删除）') : ''
  }));
  return success(ctx, {
    performerId: id,
    month,
    performanceDays,
    unlinkedIncome,
    unlinkedItems,
    travelTotal,
    pendingTotal,
    travelItems,
    dailyRate: perf.dailyRate != null ? Number(perf.dailyRate) : null
  });
};

module.exports = {
  list,
  detail,
  update,
  stats,
  salaryPreview,
};
