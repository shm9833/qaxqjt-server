'use strict';

/**
 * src/controllers/schedules.js —— 演出排期 CRUD
 * 数据表：ScheduleV2（prisma schema 已定义）
 */
const { nanoid } = require('nanoid');
const prisma = require('../utils/prisma');
const { success, created, pageMeta, noContent } = require('../utils/response');
const { idByCtx, nowMs } = require('../config');
const { BusinessError } = require('../middleware/error-handler');
const { audit } = require('../services/audit-service');

// ========== 工具：把 DB 行转为前端需要的字段名（snake_case 兼容） ==========
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
    type: row.remark && row.remark.match(/^类型[:：]?(.*)$/m) ? RegExp.$1.trim() : '',
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

function _dateStr(d) {
  if (!d) return '';
  var dt = new Date(d);
  var y = dt.getFullYear();
  var m = String(dt.getMonth() + 1).padStart(2, '0');
  var dd = String(dt.getDate()).padStart(2, '0');
  return y + '-' + m + '-' + dd;
}

function _weekStr(d) {
  if (!d) return '';
  var weeks = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'];
  return weeks[new Date(d).getDay()];
}

function _statusText(s) {
  var map = {
    scheduled: '已排期',
    confirmed: '已确认',
    draft: '待确认',
    cancelled: '已取消',
    completed: '已完成',
    conflict: '冲突'
  };
  return map[s] || s || '待确认';
}

// ========== 列表 ==========
const list = async ctx => {
  const { skip, take, page, pageSize } = pageMeta(ctx.query.page, ctx.query.pageSize, 0);
  const where = {};
  const kw = (ctx.query.keyword || '').trim();
  if (kw) {
    where.OR = [
      { scheduleNo: { contains: kw } },
      { playTitle: { contains: kw } },
      { venueAddress: { contains: kw } },
      { venueDistrict: { contains: kw } }
    ];
  }
  if (ctx.query.status) where.status = ctx.query.status;
  // 按年月筛选（前端 schedule.html 传 year + month）
  if (ctx.query.year || ctx.query.month) {
    var y = parseInt(ctx.query.year, 10);
    var m = parseInt(ctx.query.month, 10);
    if (y && m) {
      var start = new Date(y, m - 1, 1);
      var end = new Date(y, m, 0, 23, 59, 59);
      where.scheduleDateStart = { gte: start, lte: end };
    }
  }
  // 按日期范围筛选
  if (ctx.query.dateFrom || ctx.query.dateTo) {
    where.scheduleDateStart = where.scheduleDateStart || {};
    if (ctx.query.dateFrom) where.scheduleDateStart.gte = new Date(ctx.query.dateFrom);
    if (ctx.query.dateTo) where.scheduleDateStart.lte = new Date(ctx.query.dateTo + 'T23:59:59');
  }
  const [rows, total] = await Promise.all([
    prisma.scheduleV2.findMany({
      where,
      skip,
      take,
      orderBy: { scheduleDateStart: 'asc' }
    }),
    prisma.scheduleV2.count({ where })
  ]);
  return success(ctx, rows.map(toApi), { ...pageMeta(page, pageSize, total), total });
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

  const id = idByCtx('sched', 12, nanoid);
  const scheduleNo = b.scheduleNo || ('SCH-' + Date.now().toString(36).toUpperCase());

  // 解析日期 + 时间
  var dateStart = new Date(b.date + 'T' + (b.time || '19:30') + ':00');
  var dateEnd = b.dateEnd ? new Date(b.dateEnd + 'T23:59:59') : new Date(dateStart);
  dateEnd.setHours(dateEnd.getHours() + 3); // 默认 +3 小时

  var remarkParts = [];
  if (b.type) remarkParts.push('类型:' + b.type);
  if (b.remark) remarkParts.push(b.remark);
  var remarkStr = remarkParts.join('\n');

  // 解析地点
  var venueParts = (b.venue || '').split(' · ');
  var venueDistrict = venueParts[0] || b.venueDistrict || '';
  var venueAddress = venueParts[1] || venueParts[0] || b.venueAddress || '';

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
    await audit(ctx, {
      action: 'schedule.create',
      targetId: id,
      targetType: 'schedule',
      detail: '创建排期：' + scheduleNo + ' ' + (b.title || '')
    });
  } catch (_) {}

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
    var venueParts = String(b.venue).split(' · ');
    data.venueDistrict = venueParts[0] || data.venueDistrict;
    data.venueAddress = venueParts[1] || venueParts[0] || data.venueAddress;
  }
  if (b.venueDistrict) data.venueDistrict = b.venueDistrict;
  if (b.venueAddress) data.venueAddress = b.venueAddress;
  if (b.audienceSize !== undefined) data.audienceSize = parseInt(b.audienceSize, 10) || null;
  if (b.actualAttendance !== undefined) data.actualAttendance = parseInt(b.actualAttendance, 10) || null;
  if (b.feeAmount !== undefined) data.feeAmount = parseFloat(b.feeAmount) || null;
  if (b.remark !== undefined || b.type !== undefined) {
    var remarkParts = [];
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
    await audit(ctx, {
      action: 'schedule.update',
      targetId: id,
      targetType: 'schedule',
      detail: '更新排期：' + (row.scheduleNo || id)
    });
  } catch (_) {}

  return success(ctx, toApi(row));
};

// ========== 删除 ==========
const remove = async ctx => {
  const id = ctx.params.id;
  const exists = await prisma.scheduleV2.findUnique({ where: { id } });
  if (!exists) throw new BusinessError('NOT_FOUND', '排期不存在');
  await prisma.scheduleV2.delete({ where: { id } });
  try {
    await audit(ctx, {
      action: 'schedule.delete',
      targetId: id,
      targetType: 'schedule',
      detail: '删除排期：' + (exists.scheduleNo || id)
    });
  } catch (_) {}
  return noContent(ctx);
};

// ========== 月度统计 ==========
const stats = async ctx => {
  const y = parseInt(ctx.query.year, 10) || new Date().getFullYear();
  const m = parseInt(ctx.query.month, 10) || (new Date().getMonth() + 1);
  var start = new Date(y, m - 1, 1);
  var end = new Date(y, m, 0, 23, 59, 59);

  const rows = await prisma.scheduleV2.findMany({
    where: { scheduleDateStart: { gte: start, lte: end } },
    select: { status: true, feeAmount: true, audienceSize: true, actualAttendance: true }
  });

  var result = {
    year: y,
    month: m,
    total: rows.length,
    scheduled: 0,
    confirmed: 0,
    draft: 0,
    cancelled: 0,
    completed: 0,
    conflict: 0,
    totalFee: 0,
    totalAudience: 0,
    totalAttendance: 0
  };
  rows.forEach(function (r) {
    if (r.status && result[r.status] !== undefined) result[r.status]++;
    if (r.feeAmount) result.totalFee += Number(r.feeAmount);
    if (r.audienceSize) result.totalAudience += r.audienceSize;
    if (r.actualAttendance) result.totalAttendance += r.actualAttendance;
  });
  result.totalFee = Math.round(result.totalFee * 100) / 100;

  return success(ctx, result);
};

module.exports = { list, detail, create, update, remove, stats };
