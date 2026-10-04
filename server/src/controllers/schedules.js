'use strict';

/**
 * src/controllers/schedules.js —— 演出排期 CRUD（重构版 v2）
 *
 * 重构要点：
 *  1. list：使用 select 只取前端所需字段，避免大字段（remark/venueProvince 等）全量传输
 *  2. stats：改用 prisma groupBy 聚合，不再拉整月行到 Node 层计数
 *  3. 新增 calendar：月历/周视图专用轻量接口，仅返回 {id,date,title,status,venue,time}
 *  4. 新增 conflicts：后端计算档期冲突（同日 ≥2 场未取消），前端不再全量扫描
 *  5. 纯函数（toApi/_dateStr/_weekStr/_statusText）抽离，便于单测
 *  6. create/update 增加同日冲突预检（可选，conflictCheck=true 时返回 409）
 */
const { nanoid } = require('nanoid');
const prisma = require('../utils/prisma');
const { success, created, noContent, parsePage, pagedSuccess } = require('../utils/response');
const { idByCtx, nowMs } = require('../config');
const { BusinessError } = require('../middleware/error-handler');
const { audit } = require('../services/audit-service');
const { invalidateSchedulesCache } = require('./public');

// ========== 纯函数（可单测）==========

function _dateStr(d) {
  if (!d) return '';
  const dt = new Date(d);
  const y = dt.getFullYear();
  const m = String(dt.getMonth() + 1).padStart(2, '0');
  const dd = String(dt.getDate()).padStart(2, '0');
  return y + '-' + m + '-' + dd;
}

function _weekStr(d) {
  if (!d) return '';
  const weeks = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'];
  return weeks[new Date(d).getDay()];
}

const STATUS_TEXT_MAP = {
  scheduled: '已排期',
  confirmed: '已确认',
  draft: '待确认',
  cancelled: '已取消',
  completed: '已完成',
  conflict: '冲突'
};
function _statusText(s) {
  return STATUS_TEXT_MAP[s] || s || '待确认';
}

function _parseTypeFromRemark(remark) {
  if (!remark) return '';
  const m = String(remark).match(/^类型[:：]?(.*)$/m);
  return m ? m[1].trim() : '';
}

/** 把 DB 行转为前端 API 字段（snake_case 兼容） */
function toApi(row) {
  if (!row) return null;
  return {
    id: row.id,
    scheduleNo: row.scheduleNo,
    orderId: row.orderId,
    status: row.status,
    statusText: _statusText(row.status),
    playId: row.playId || '',
    playTitle: row.playTitle || '',
    date: _dateStr(row.scheduleDateStart),
    dateEnd: _dateStr(row.scheduleDateEnd),
    time: row.performanceTime || '',
    week: _weekStr(row.scheduleDateStart),
    type: _parseTypeFromRemark(row.remark),
    venue: [row.venueDistrict, row.venueAddress].filter(Boolean).join(' · '),
    venueProvince: row.venueProvince || '',
    venueCity: row.venueCity || '',
    venueDistrict: row.venueDistrict || '',
    venueAddress: row.venueAddress || '',
    audienceSize: row.audienceSize || 0,
    weatherForecast: row.weatherForecast || '',
    actualAttendance: row.actualAttendance || 0,
    feeAmount: row.feeAmount ? Number(row.feeAmount) : 0,
    castSheetId: row.castSheetId || '',
    attendanceStatus: row.attendanceStatus || '',
    completedDate: row.completedDate ? _dateStr(row.completedDate) : '',
    remark: row.remark || '',
    leader: row.createdBy || '',
    castCount: 0,
    shows: 1,
    createdAt: row.createdAt ? new Date(row.createdAt).toISOString() : '',
    updatedAt: row.updatedAt ? new Date(row.updatedAt).toISOString() : ''
  };
}

/** 日历视图精简投影（月历/周视图用，减少传输） */
function toCalendarItem(row) {
  if (!row) return null;
  return {
    id: row.id,
    scheduleNo: row.scheduleNo || '',
    date: _dateStr(row.scheduleDateStart),
    title: row.playTitle || '未命名演出',
    status: row.status,
    time: row.performanceTime || '',
    venue: [row.venueDistrict, row.venueAddress].filter(Boolean).join(' · ')
  };
}

/** list 接口的 select 字段集（仅 toApi 实际读取的列） */
const LIST_SELECT = {
  id: true,
  scheduleNo: true,
  orderId: true,
  status: true,
  playId: true,
  playTitle: true,
  scheduleDateStart: true,
  scheduleDateEnd: true,
  performanceTime: true,
  venueProvince: true,
  venueCity: true,
  venueDistrict: true,
  venueAddress: true,
  audienceSize: true,
  weatherForecast: true,
  actualAttendance: true,
  feeAmount: true,
  castSheetId: true,
  attendanceStatus: true,
  completedDate: true,
  remark: true,
  createdBy: true,
  createdAt: true,
  updatedAt: true
};

const CALENDAR_SELECT = {
  id: true,
  scheduleNo: true,
  playTitle: true,
  status: true,
  scheduleDateStart: true,
  performanceTime: true,
  venueDistrict: true,
  venueAddress: true
};

// ========== 查询条件构造（可单测）==========

function buildListWhere(query) {
  const where = {};
  const kw = (query.keyword || '').trim();
  if (kw) {
    where.OR = [
      { scheduleNo: { contains: kw } },
      { playTitle: { contains: kw } },
      { venueAddress: { contains: kw } },
      { venueDistrict: { contains: kw } }
    ];
  }
  if (query.status) where.status = query.status;
  if (query.playId) where.playId = query.playId;
  if (query.orderId) where.orderId = query.orderId;

  // 年月筛选（前端 schedule.html 传 year + month）
  if (query.year || query.month) {
    const y = parseInt(query.year, 10);
    const m = parseInt(query.month, 10);
    if (y && m) {
      const start = new Date(y, m - 1, 1);
      const end = new Date(y, m, 0, 23, 59, 59);
      where.scheduleDateStart = { gte: start, lte: end };
    }
  }
  // 日期范围筛选
  if (query.dateFrom || query.dateTo) {
    where.scheduleDateStart = where.scheduleDateStart || {};
    if (query.dateFrom) where.scheduleDateStart.gte = new Date(query.dateFrom);
    if (query.dateTo) where.scheduleDateStart.lte = new Date(query.dateTo + 'T23:59:59');
  }
  return where;
}

// ========== 列表 ==========
const list = async ctx => {
  const { skip, take, page, pageSize } = parsePage(ctx.query);
  const where = buildListWhere(ctx.query);

  const [rows, total] = await Promise.all([
    prisma.scheduleV2.findMany({
      where,
      select: LIST_SELECT,
      skip,
      take,
      orderBy: { scheduleDateStart: 'asc' }
    }),
    prisma.scheduleV2.count({ where })
  ]);
  return pagedSuccess(ctx, rows.map(toApi), total, page, pageSize);
};

// ========== 日历视图（月历/周视图专用，轻量）==========
const calendar = async ctx => {
  const y = parseInt(ctx.query.year, 10) || new Date().getFullYear();
  const m = parseInt(ctx.query.month, 10) || (new Date().getMonth() + 1);
  const start = new Date(y, m - 1, 1);
  const end = new Date(y, m, 0, 23, 59, 59);

  const where = { scheduleDateStart: { gte: start, lte: end } };
  if (ctx.query.status) where.status = ctx.query.status;

  const rows = await prisma.scheduleV2.findMany({
    where,
    select: CALENDAR_SELECT,
    orderBy: { scheduleDateStart: 'asc' }
  });
  return success(ctx, rows.map(toCalendarItem), { year: y, month: m, total: rows.length });
};

// ========== 档期冲突检测（后端计算，前端不再全量扫描）==========
const conflicts = async ctx => {
  const dateFrom = ctx.query.dateFrom ? new Date(ctx.query.dateFrom) : new Date(new Date().getFullYear(), 0, 1);
  const dateTo = ctx.query.dateTo
    ? new Date(ctx.query.dateTo + 'T23:59:59')
    : new Date(new Date().getFullYear(), 11, 31, 23, 59, 59);

  // 只取需要的列，按日期聚合
  const rows = await prisma.scheduleV2.findMany({
    where: {
      scheduleDateStart: { gte: dateFrom, lte: dateTo },
      status: { notIn: ['cancelled', 'canceled'] }
    },
    select: { id: true, scheduleNo: true, playTitle: true, scheduleDateStart: true }
  });

  const byDate = {};
  rows.forEach(r => {
    const d = _dateStr(r.scheduleDateStart);
    (byDate[d] = byDate[d] || []).push({ id: r.id, scheduleNo: r.scheduleNo, playTitle: r.playTitle });
  });

  const conflictDates = Object.keys(byDate)
    .filter(d => byDate[d].length >= 2)
    .sort()
    .map(d => ({ date: d, count: byDate[d].length, items: byDate[d] }));

  return success(ctx, { total: conflictDates.length, conflicts: conflictDates });
};

// ========== 详情 ==========
const detail = async ctx => {
  const row = await prisma.scheduleV2.findUnique({ where: { id: ctx.params.id } });
  if (!row) throw new BusinessError('NOT_FOUND', '排期不存在');
  return success(ctx, toApi(row));
};

// ========== 新建 ==========
const create = async ctx => {
  const b = ctx.request.body || {};
  if (!b.date) throw new BusinessError('VALIDATION_ERROR', '排期日期 date 必填');
  if (!b.orderId) throw new BusinessError('VALIDATION_ERROR', '关联订单 orderId 必填（可使用「散客订单」占位 ID）');

  // 同日冲突预检
  if (b.conflictCheck) {
    const dayStart = new Date(b.date + 'T00:00:00');
    const dayEnd = new Date(b.date + 'T23:59:59');
    const sameDay = await prisma.scheduleV2.count({
      where: {
        scheduleDateStart: { gte: dayStart, lte: dayEnd },
        status: { notIn: ['cancelled', 'canceled'] }
      }
    });
    if (sameDay > 0) {
      throw new BusinessError('CONFLICT', `${b.date} 已有 ${sameDay} 场排期，请确认是否连台`);
    }
  }

  const id = idByCtx('sched', 12, nanoid);
  const scheduleNo = b.scheduleNo || ('SCH-' + Date.now().toString(36).toUpperCase());

  const dateStart = new Date(b.date + 'T' + (b.time || '19:30') + ':00');
  const dateEnd = b.dateEnd ? new Date(b.dateEnd + 'T23:59:59') : new Date(dateStart);
  dateEnd.setHours(dateEnd.getHours() + 3);

  const remarkParts = [];
  if (b.type) remarkParts.push('类型:' + b.type);
  if (b.remark) remarkParts.push(b.remark);
  const remarkStr = remarkParts.join('\n');

  const venueParts = (b.venue || '').split(' · ');
  const venueDistrict = venueParts[0] || b.venueDistrict || '';
  const venueAddress = venueParts[1] || venueParts[0] || b.venueAddress || '';

  const data = {
    id,
    scheduleNo,
    orderId: b.orderId,
    status: b.status || 'draft',
    playId: b.playId || null,
    playTitle: b.title || b.plays || b.playTitle || null,
    scheduleDateStart: dateStart,
    scheduleDateEnd: dateEnd,
    performanceTime: b.time || null,
    venueProvince: b.venueProvince || '甘肃省',
    venueCity: b.venueCity || '天水市',
    venueDistrict: venueDistrict || null,
    venueAddress: venueAddress || null,
    audienceSize: b.audienceSize ? parseInt(b.audienceSize, 10) : null,
    feeAmount: b.feeAmount ? parseFloat(b.feeAmount) : null,
    castSheetId: b.castSheetId || null,
    remark: remarkStr || null,
    createdBy: ctx.state.user ? ctx.state.user.username : null,
    ts: nowMs()
  };

  const row = await prisma.scheduleV2.create({ data });

  try {
    await audit({
      ctx,
      module: 'schedule',
      action: 'SCHEDULE_CREATE',
      targetId: row.id,
      targetType: 'schedule',
      detail: { scheduleNo: scheduleNo, title: b.title || b.plays || b.playTitle || '' }
    });
  } catch (_) {}

  invalidateSchedulesCache();
  return created(ctx, toApi(row));
};

// ========== 更新 ==========
const update = async ctx => {
  const id = ctx.params.id;
  const b = ctx.request.body || {};

  const exists = await prisma.scheduleV2.findUnique({ where: { id } });
  if (!exists) throw new BusinessError('NOT_FOUND', '排期不存在');

  const data = {};
  if (b.status) data.status = b.status;
  if (b.title || b.plays || b.playTitle) data.playTitle = b.title || b.plays || b.playTitle;
  if (b.date) {
    data.scheduleDateStart = new Date(b.date + 'T' + (b.time || exists.performanceTime || '19:30') + ':00');
  }
  if (b.dateEnd) data.scheduleDateEnd = new Date(b.dateEnd + 'T23:59:59');
  if (b.time) data.performanceTime = b.time;
  if (b.venue) {
    const venueParts = String(b.venue).split(' · ');
    data.venueDistrict = venueParts[0] || data.venueDistrict;
    data.venueAddress = venueParts[1] || venueParts[0] || data.venueAddress;
  }
  if (b.venueDistrict) data.venueDistrict = b.venueDistrict;
  if (b.venueAddress) data.venueAddress = b.venueAddress;
  if (b.audienceSize !== undefined) data.audienceSize = parseInt(b.audienceSize, 10) || null;
  if (b.actualAttendance !== undefined) data.actualAttendance = parseInt(b.actualAttendance, 10) || null;
  if (b.feeAmount !== undefined) data.feeAmount = parseFloat(b.feeAmount) || null;
  if (b.remark !== undefined || b.type !== undefined) {
    const remarkParts = [];
    if (b.type) remarkParts.push('类型:' + b.type);
    if (b.remark) remarkParts.push(b.remark);
    data.remark = remarkParts.join('\n') || null;
  }
  if (b.completedDate) {
    data.completedDate = new Date(b.completedDate);
    data.status = 'completed';
    data.attendanceStatus = b.attendanceStatus || '已完成';
  }
  data.ts = nowMs();

  const row = await prisma.scheduleV2.update({ where: { id }, data });

  try {
    await audit({
      ctx,
      module: 'schedule',
      action: 'SCHEDULE_UPDATE',
      targetId: id,
      targetType: 'schedule',
      detail: { scheduleNo: row.scheduleNo || id, fields: Object.keys(data).filter(k => k !== 'ts') }
    });
  } catch (_) {}

  invalidateSchedulesCache();
  return success(ctx, toApi(row));
};

// ========== 删除 ==========
const remove = async ctx => {
  const id = ctx.params.id;
  const exists = await prisma.scheduleV2.findUnique({ where: { id } });
  if (!exists) throw new BusinessError('NOT_FOUND', '排期不存在');
  await prisma.scheduleV2.delete({ where: { id } });
  try {
    await audit({
      ctx,
      module: 'schedule',
      action: 'SCHEDULE_DELETE',
      targetId: id,
      targetType: 'schedule',
      detail: { scheduleNo: exists.scheduleNo || id }
    });
  } catch (_) {}
  invalidateSchedulesCache();
  return noContent(ctx);
};

// ========== 月度统计（改用 groupBy 聚合）==========
const stats = async ctx => {
  const y = parseInt(ctx.query.year, 10) || new Date().getFullYear();
  const m = parseInt(ctx.query.month, 10) || (new Date().getMonth() + 1);
  const start = new Date(y, m - 1, 1);
  const end = new Date(y, m, 0, 23, 59, 59);
  const range = { scheduleDateStart: { gte: start, lte: end } };

  // 并行：按状态分组计数 + 费用/观众聚合
  const [statusGroups, agg] = await Promise.all([
    prisma.scheduleV2.groupBy({
      by: ['status'],
      where: range,
      _count: { id: true }
    }),
    prisma.scheduleV2.aggregate({
      where: range,
      _sum: { feeAmount: true, audienceSize: true, actualAttendance: true },
      _count: { id: true }
    })
  ]);

  const result = {
    year: y,
    month: m,
    total: agg._count.id || 0,
    scheduled: 0,
    confirmed: 0,
    draft: 0,
    cancelled: 0,
    completed: 0,
    conflict: 0,
    totalFee: agg._sum.feeAmount ? Number(agg._sum.feeAmount) : 0,
    totalAudience: agg._sum.audienceSize || 0,
    totalAttendance: agg._sum.actualAttendance || 0
  };

  statusGroups.forEach(g => {
    if (result[g.status] !== undefined) result[g.status] = g._count.id;
  });
  result.totalFee = Math.round(result.totalFee * 100) / 100;

  return success(ctx, result);
};

module.exports = {
  list,
  calendar,
  conflicts,
  detail,
  create,
  update,
  remove,
  stats,
  // 导出纯函数供测试
  toApi,
  toCalendarItem,
  buildListWhere,
  _dateStr,
  _weekStr,
  _statusText,
  _parseTypeFromRemark
};
