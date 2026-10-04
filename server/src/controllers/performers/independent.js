/* performers/independent.js — 无交叉依赖的 handlers（自 performers.js 拆分） */
'use strict';

/**
 * src/controllers/performers.js —— 演职人员花名册 CRUD
 */
const { nanoid } = require('nanoid');
const prisma = require('../../utils/prisma');
const { success, created, pageMeta } = require('../../utils/response');
const { idByCtx, nowMs } = require('../../config');
const { BusinessError } = require('../../middleware/error-handler');
const { audit } = require('../../services/audit-service');
// 复用工资核算唯一扣罚口径（迟到20元/次、迟到超30分钟扣半日、旷工1天扣两日）
const { computeAttendancePenalty } = require('../wages');
const { DATE_FIELDS, toDailyRate, syncPerformerToWageItems, classifyCrew, PRESENT_TYPES } = require('./helpers');

const list = async ctx => {
  const { skip, take, page, pageSize } = pageMeta(ctx.query.page, ctx.query.pageSize, 0);
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
  return success(ctx, rows, { ...pageMeta(page, pageSize, total), total });
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
  [
    'staffNo',
    'name',
    'gender',
    'phone',
    'idCardNo',
    'rankGrade',
    'primaryRole',
    'employmentType',
    'bankAccount',
    'bankName',
    'socialSecurityNo',
    'status',
    'remark',
    'avatarUrl',
    'agreedSalary',
    'transportType'
  ].forEach(k => {
    if (b[k] !== undefined) patch[k] = b[k];
  });
  if (b.dailyRate !== undefined) patch.dailyRate = toDailyRate(b.dailyRate);
  DATE_FIELDS.forEach(k => {
    if (b[k] !== undefined) patch[k] = b[k] ? new Date(b[k]) : null;
  });
  patch.updatedAt = new Date();
  patch.ts = BigInt(nowMs());
  const row = await prisma.performersDbV1.update({ where: { id: ctx.params.id }, data: patch });
  await audit({ ctx, module: 'performers', action: 'PERFORMER_UPDATE', targetId: row.id });
  // 人员变更时刷新现有 draft 批次工资条（name/staffNo/rankGrade/dailyRate）
  await syncPerformerToWageItems(row.id, { name: row.name, staffNo: row.staffNo, rankGrade: row.rankGrade, dailyRate: row.dailyRate });
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


module.exports = {
  list,
  detail,
  update,
  stats,
};
