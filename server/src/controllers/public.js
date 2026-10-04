'use strict';

/**
 * src/controllers/public.js —— 前台公开只读接口（无鉴权）
 * 用于门户页面展示真实业务数据：剧目、剧目分类、演职员花名册、演出排期、汇总计数。
 * 安全原则：仅返回公开展示字段，绝不泄露手机号/身份证/银行卡/工资等敏感信息。
 */
const prisma = require('../utils/prisma');
const { success } = require('../utils/response');
const { BusinessError } = require('../middleware/error-handler');

// ========== 公开剧目（仅 active）==========
const plays = async ctx => {
  const where = { status: 'active' };
  const genre = (ctx.query.genre || '').trim();
  if (genre) where.genre = genre;
  const kw = (ctx.query.keyword || '').trim();
  if (kw) where.OR = [{ title: { contains: kw } }, { subtitle: { contains: kw } }, { author: { contains: kw } }];
  const take = Math.min(Number(ctx.query.pageSize) || 200, 200);
  const rows = await prisma.play.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    take,
    select: {
      id: true,
      playCode: true,
      title: true,
      subtitle: true,
      genre: true,
      durationMinutes: true,
      author: true,
      posterUrl: true,
      synopsis: true,
      castSummary: true,
      difficultyLevel: true
    }
  });
  return success(ctx, rows, { total: rows.length });
};

// ========== 公开剧目分类 ==========
const playCategories = async ctx => {
  const rows = await prisma.playCategory.findMany({
    where: { status: 'active' },
    orderBy: { sortOrder: 'asc' },
    take: 100,
    select: { id: true, name: true, sortOrder: true, note: true }
  });
  return success(ctx, rows, { total: rows.length });
};

// ========== 公开演职员花名册（仅在岗+审核通过；脱敏）==========
const performers = async ctx => {
  const where = { status: 'active', reviewStatus: 'approved' };
  const primaryRole = (ctx.query.primaryRole || '').trim();
  if (primaryRole) where.primaryRole = primaryRole;
  const rankGrade = (ctx.query.rankGrade || '').trim();
  if (rankGrade) where.rankGrade = rankGrade;
  const take = Math.min(Number(ctx.query.pageSize) || 300, 300);
  const rows = await prisma.performersDbV1.findMany({
    where,
    orderBy: [{ primaryRole: 'asc' }, { staffNo: 'asc' }],
    take,
    select: {
      id: true,
      staffNo: true,
      name: true,
      gender: true,
      rankGrade: true,
      primaryRole: true,
      employmentType: true,
      avatarUrl: true,
      hireDate: true
    }
  });
  const list = rows.map(r => ({
    id: r.id,
    staffNo: r.staffNo || '',
    name: r.name,
    gender: r.gender || '',
    rankGrade: r.rankGrade || '',
    primaryRole: r.primaryRole || '',
    employmentType: r.employmentType || '',
    avatarUrl: r.avatarUrl || '',
    hireDate: r.hireDate ? new Date(r.hireDate).toISOString().slice(0, 10) : ''
  }));
  return success(ctx, list, { total: list.length });
};

// ========== 公开演出排期（仅未来已排期/已确认，不含内部财务字段）==========
// 短 TTL 缓存（5s）+ 写时失效：管理端 create/update/remove 后主动清缓存，
// 确保公开页数据同步延迟 ≤5s（满足实时同步要求）
let _pubSchedulesCache = null;
let _pubSchedulesCacheTs = 0;
const PUB_SCHEDULES_TTL = 5 * 1000;

/** 失效公开排期缓存（供 schedules 控制器在写操作后调用） */
function invalidateSchedulesCache() {
  _pubSchedulesCache = null;
  _pubSchedulesCacheTs = 0;
}

const schedules = async ctx => {
  const now = Date.now();
  if (_pubSchedulesCache && now - _pubSchedulesCacheTs < PUB_SCHEDULES_TTL) {
    ctx.set('X-Cache', 'HIT');
    return success(ctx, _pubSchedulesCache, { total: _pubSchedulesCache.length });
  }

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const rows = await prisma.scheduleV2.findMany({
    where: {
      status: { in: ['scheduled', 'confirmed'] },
      scheduleDateStart: { gte: today }
    },
    orderBy: { scheduleDateStart: 'asc' },
    take: 100,
    select: {
      id: true,
      scheduleNo: true,
      status: true,
      playId: true,
      playTitle: true,
      scheduleDateStart: true,
      scheduleDateEnd: true,
      performanceTime: true,
      venueProvince: true,
      venueCity: true,
      venueDistrict: true,
      venueAddress: true
    }
  });
  const weeks = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'];
  const statusText = { scheduled: '已排期', confirmed: '已确认' };
  const list = rows.map(r => {
    const d = new Date(r.scheduleDateStart);
    const pad = n => String(n).padStart(2, '0');
    const dateStr = d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
    const end = r.scheduleDateEnd ? new Date(r.scheduleDateEnd) : null;
    return {
      id: r.id,
      scheduleNo: r.scheduleNo || '',
      status: r.status,
      statusText: statusText[r.status] || r.status,
      playId: r.playId || '',
      playTitle: r.playTitle || '',
      date: dateStr,
      dateEnd: end && end.getTime() !== d.getTime() ? end.getFullYear() + '-' + pad(end.getMonth() + 1) + '-' + pad(end.getDate()) : '',
      week: weeks[d.getDay()],
      time: r.performanceTime || '',
      venue: [r.venueDistrict, r.venueAddress].filter(Boolean).join(' · '),
      venueCity: r.venueCity || '',
      venueDistrict: r.venueDistrict || '',
      venueAddress: r.venueAddress || ''
    };
  });

  _pubSchedulesCache = list;
  _pubSchedulesCacheTs = now;
  ctx.set('X-Cache', 'MISS');
  return success(ctx, list, { total: list.length });
};

// ========== 公开汇总计数（首页真实统计）==========
const stats = async ctx => {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const [plays, performers, categories, news, upcomingShows] = await Promise.all([
    prisma.play.count({ where: { status: 'active' } }),
    prisma.performersDbV1.count({ where: { status: 'active' } }),
    prisma.playCategory.count({ where: { status: 'active' } }),
    prisma.contentV2.count({ where: { publishStatus: 'published' } }),
    prisma.scheduleV2.count({
      where: { status: { in: ['scheduled', 'confirmed'] }, scheduleDateStart: { gte: today } }
    })
  ]);
  return success(ctx, { plays, performers, categories, news, upcomingShows });
};

// ========== 公开演出阵容列表（仅已确认/已锁定，扫码可见）==========
const castSheets = async ctx => {
  const where = { status: { in: ['confirmed', 'locked'] } };
  const play = (ctx.query.play || ctx.query.playTitle || '').trim();
  if (play) where.playTitle = { contains: play };
  const take = Math.min(Number(ctx.query.pageSize) || 20, 50);
  const rows = await prisma.castSheetsV1.findMany({
    where,
    orderBy: [{ performanceDate: 'desc' }, { updatedAt: 'desc' }],
    take,
    select: {
      id: true,
      sheetNo: true,
      status: true,
      playId: true,
      playTitle: true,
      performanceDate: true,
      performanceTime: true,
      venueFull: true,
      directorName: true,
      conductorName: true,
      stageManagerName: true
    }
  });
  const list = rows.map(r => ({
    id: r.id,
    sheetNo: r.sheetNo || '',
    status: r.status,
    statusText: r.status === 'locked' ? '已锁定' : '已确认',
    playId: r.playId || '',
    playTitle: r.playTitle || '',
    performanceDate: r.performanceDate ? new Date(r.performanceDate).toISOString().slice(0, 10) : '',
    performanceTime: r.performanceTime || '',
    venueFull: r.venueFull || '',
    directorName: r.directorName || '',
    conductorName: r.conductorName || '',
    stageManagerName: r.stageManagerName || ''
  }));
  return success(ctx, list, { total: list.length });
};

// ========== 公开演出阵容详情（仅已确认/已锁定；不含工资/考勤等内部字段）==========
const castSheetDetail = async ctx => {
  const row = await prisma.castSheetsV1.findUnique({
    where: { id: ctx.params.id },
    include: { crew: { orderBy: { sortOrder: 'asc' } } }
  });
  if (!row || ['confirmed', 'locked'].indexOf(row.status) === -1) {
    throw new BusinessError('NOT_FOUND', '演出阵容暂未发布');
  }
  const crew = row.crew.map((c, idx) => ({
    category: c.category || '',
    roleName: c.roleName || '',
    performerName: c.performerName || '',
    note: c.note || '',
    sortOrder: c.sortOrder != null ? Number(c.sortOrder) : idx
  }));
  return success(ctx, {
    id: row.id,
    sheetNo: row.sheetNo || '',
    status: row.status,
    statusText: row.status === 'locked' ? '已锁定' : '已确认',
    playId: row.playId || '',
    playTitle: row.playTitle || '',
    performanceDate: row.performanceDate ? new Date(row.performanceDate).toISOString().slice(0, 10) : '',
    performanceTime: row.performanceTime || '',
    venueFull: row.venueFull || '',
    directorName: row.directorName || '',
    conductorName: row.conductorName || '',
    stageManagerName: row.stageManagerName || '',
    crewNote: row.crewNote || '',
    crew
  });
};

module.exports = { plays, playCategories, performers, schedules, stats, castSheets, castSheetDetail, invalidateSchedulesCache };
