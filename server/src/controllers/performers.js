'use strict';

/**
 * src/controllers/performers.js —— 演职人员花名册 CRUD
 */
const { nanoid } = require('nanoid');
const prisma = require('../utils/prisma');
const { success, created, pageMeta } = require('../utils/response');
const { idByCtx, nowMs } = require('../config');
const { BusinessError } = require('../middleware/error-handler');
const { audit } = require('../services/audit-service');

const DATE_FIELDS = ['birthDate', 'hireDate'];

const list = async ctx => {
  const { skip, take, page, pageSize } = pageMeta(ctx.query.page, ctx.query.pageSize, 0);
  const where = {};
  const kw = (ctx.query.keyword || '').trim();
  if (kw) {
    where.OR = [
      { name: { contains: kw } },
      { staffNo: { contains: kw } },
      { phone: { contains: kw } },
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

const create = async ctx => {
  const b = ctx.request.body;
  const manualNo = (b.staffNo || '').toString().trim();
  let lastErr = null;
  // 自动分配工号时带唯一冲突重试（并发新增安全）；手工指定工号则不重试
  for (let attempt = 0; attempt < (manualNo ? 1 : 3); attempt++) {
    const staffNo = manualNo || await allocateStaffNo();
    const data = {
      id: b.id || idByCtx('performer', 12, nanoid),
      ...buildData({ ...b, staffNo })
    };
    try {
      const row = await prisma.performersDbV1.create({ data });
      await audit({ ctx, module: 'performers', action: 'PERFORMER_CREATE', targetId: row.id, detail: { name: row.name, staffNo: row.staffNo } });
      return created(ctx, row);
    } catch (e) {
      lastErr = e;
      if (!manualNo && e && e.code === 'P2002') continue; // 工号并发冲突，重新取号
      throw e;
    }
  }
  throw lastErr;
};

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
    'avatarUrl'
  ].forEach(k => {
    if (b[k] !== undefined) patch[k] = b[k];
  });
  DATE_FIELDS.forEach(k => {
    if (b[k] !== undefined) patch[k] = b[k] ? new Date(b[k]) : null;
  });
  patch.updatedAt = new Date();
  patch.ts = BigInt(nowMs());
  const row = await prisma.performersDbV1.update({ where: { id: ctx.params.id }, data: patch });
  await audit({ ctx, module: 'performers', action: 'PERFORMER_UPDATE', targetId: row.id });
  return success(ctx, row);
};

const remove = async ctx => {
  const id = ctx.params.id;
  // 软删
  const row = await prisma.performersDbV1.update({
    where: { id },
    data: { status: 'deleted', updatedAt: new Date(), ts: BigInt(nowMs()) }
  });
  await audit({ ctx, module: 'performers', action: 'PERFORMER_SOFT_DELETE', targetId: id });
  return success(ctx, { id: row.id, status: 'deleted' });
};

// ========== 演员自助入职登记（公开接口，无需登录） ==========
const selfRegister = async ctx => {
  const b = ctx.request.body || {};
  // 必须确认已阅读员工管理条例
  if (b.regulationsConfirmed !== true) {
    throw new BusinessError('VALIDATION_ERROR', '请先阅读并确认《公司员工管理条例》');
  }
  if (!b.name || String(b.name).trim().length < 2) {
    throw new BusinessError('VALIDATION_ERROR', '请填写姓名');
  }
  const data = {
    id: idByCtx('performer', 12, nanoid),
    staffNo: null, // 审核通过后由管理员分配工号
    name: String(b.name).trim(),
    gender: b.gender || null,
    phone: b.phone || null,
    primaryRole: b.primaryRole || null,
    agreedSalary: b.agreedSalary || null,
    transportType: b.transportType || null,
    remark: b.remark || null,
    status: 'pending',
    reviewStatus: 'pending',
    reviewFeedback: null,
    regulationsConfirmed: true,
    ts: BigInt(nowMs())
  };
  const row = await prisma.performersDbV1.create({ data });
  await audit({ ctx, module: 'performers', action: 'PERFORMER_SELF_REGISTER', targetId: row.id, detail: { name: row.name } });
  return created(ctx, { id: row.id, name: row.name, status: 'pending', message: '提交成功，等待管理员审核' });
};

// ========== 管理员审核（通过/退回） ==========
const review = async ctx => {
  const { id } = ctx.params;
  const b = ctx.request.body || {};
  const action = b.action; // 'approve' | 'reject'
  if (action !== 'approve' && action !== 'reject') {
    throw new BusinessError('VALIDATION_ERROR', 'action 必须为 approve 或 reject');
  }
  const row = await prisma.performersDbV1.findUnique({ where: { id } });
  if (!row) throw new BusinessError('NOT_FOUND', '演职人员不存在');

  let patch;
  if (action === 'approve') {
    const manualNo = (b.staffNo || '').toString().trim();
    // 自助登记者原本无工号：审核通过即由后端统一分配正式工号
    const staffNo = manualNo || row.staffNo || await allocateStaffNo();
    patch = {
      status: 'active',
      reviewStatus: 'approved',
      reviewFeedback: null,
      staffNo,
      updatedAt: new Date(),
      ts: BigInt(nowMs())
    };
  } else {
    patch = {
      status: 'pending',
      reviewStatus: 'rejected',
      reviewFeedback: b.feedback || '资料需补充，请重新填写',
      updatedAt: new Date(),
      ts: BigInt(nowMs())
    };
  }
  const updated = await prisma.performersDbV1.update({ where: { id }, data: patch });
  await audit({ ctx, module: 'performers', action: action === 'approve' ? 'PERFORMER_APPROVE' : 'PERFORMER_REJECT', targetId: id, detail: { name: updated.name, staffNo: updated.staffNo, feedback: patch.reviewFeedback } });
  return success(ctx, { id: updated.id, staffNo: updated.staffNo, reviewStatus: updated.reviewStatus, status: updated.status });
};

// ========== 统计聚合（真实数据） ==========
// 秦腔行当/岗位关键词（按子串匹配，兼容"铜锤花脸/刀马旦/W3正生"等复合写法）
const ACTOR_KW = ['生', '旦', '净', '丑', '花脸', '青衣', '龙套', '宫女', '演员', '二架男', '二架女', '彩女'];
const MUSIC_KW = ['板胡', '司鼓', '二胡', '高胡', '中胡', '扬琴', '月琴', '琵琶', '三弦', '笛子', '笙', '唢呐', '大提琴', '贝斯', '电子琴', '打击乐', '梆子', '锣', '铙钹', '铰子', '碰铃', '琴师', '鼓师', '乐队', '文场', '武场', '文二手', '武二手', '二手'];
const STAGE_KW = ['灯光', '音响', '服装', '道具', '化妆', '布景', '装置', '字幕', '电工', '舞美', '舞台监督', '后场'];

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

module.exports = { list, create, detail, update, remove, stats, selfRegister, review };
