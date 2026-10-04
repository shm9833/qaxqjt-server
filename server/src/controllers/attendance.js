'use strict';

/**
 * src/controllers/attendance.js —— 考勤管理 CRUD
 * 数据表：AttendanceV1 + LeaveApplication + OvertimeRecord（prisma schema 已定义）
 */
const { nanoid } = require('nanoid');
const prisma = require('../utils/prisma');
const { success, created, pageMeta, noContent } = require('../utils/response');
const { idByCtx, nowMs } = require('../config');
const { BusinessError } = require('../middleware/error-handler');
const { audit } = require('../services/audit-service');

// ========== 工具：DB 行 -> API 字段 ==========
function toApi(row) {
  if (!row) return null;
  return {
    id: row.id,
    staffId: row.staffId,
    staffName: row.staffName,
    attendanceMonth: row.attendanceMonth || '',
    date: row.attendanceDate ? new Date(row.attendanceDate).toISOString().substring(0, 10) : '',
    type: row.attendanceType || '',
    typeText: _typeText(row.attendanceType),
    scheduleId: row.scheduleId || '',
    checkInTime: row.checkInTime ? new Date(row.checkInTime).toISOString() : '',
    checkOutTime: row.checkOutTime ? new Date(row.checkOutTime).toISOString() : '',
    workHours: row.workHours ? Number(row.workHours) : 0,
    overtimeHours: row.overtimeHours ? Number(row.overtimeHours) : 0,
    locationGps: row.locationGps || '',
    remark: row.remark || '',
    approveStatus: row.approveStatus || 'approved',
    approvedBy: row.approvedBy || '',
    createdAt: row.createdAt ? new Date(row.createdAt).toISOString() : '',
    updatedAt: row.updatedAt ? new Date(row.updatedAt).toISOString() : ''
  };
}

// v20261003：固定按东八区取日期/月份字符串，避免 UTC 归一导致本地凌晨 0-8 点录入被归到前一天/前一月的跨月边界
function _cnYMD(d) {
  const t = d instanceof Date ? d.getTime() : Date.now();
  return new Date(t + 8 * 3600 * 1000).toISOString().substring(0, 10);
}

function _typeText(t) {
  var map = {
    full: '全天班', night: '夜班', double: '双班', half: '半天班',
    rest: '公休', SL: '病假', PL: '事假(限2次/2天)', BL: '丧假', ML: '婚假',
    AL: '年假', absent: '旷工', rainout: '雨休', leave: '请假(其他)',
    late: '迟到(30分钟内)', late_over: '迟到超30分钟',
    early: '早退(30分钟内)', early_over: '早退超30分钟',
    outing: '外出', study: '学习', business: '出差', injury: '工伤'
  };
  return map[t] || t || '';
}

function _leaveToApi(row) {
  if (!row) return null;
  return {
    id: row.id,
    staffId: row.staffId,
    staffName: row.staffName,
    leaveType: row.leaveType || '',
    dateFrom: row.dateFrom ? new Date(row.dateFrom).toISOString().substring(0, 10) : '',
    dateTo: row.dateTo ? new Date(row.dateTo).toISOString().substring(0, 10) : '',
    totalDays: row.totalDays ? Number(row.totalDays) : 0,
    reason: row.reason || '',
    approveStatus: row.approveStatus || 'pending',
    approverName: row.approverName || '',
    approvedAt: row.approvedAt ? new Date(row.approvedAt).toISOString() : '',
    rejectReason: row.rejectReason || '',
    createdAt: row.createdAt ? new Date(row.createdAt).toISOString() : ''
  };
}

// ========== 考勤记录 ==========
const list = async ctx => {
  const { skip, take, page, pageSize } = pageMeta(ctx.query.page, ctx.query.pageSize, 0);
  const where = {};
  const kw = (ctx.query.keyword || '').trim();
  if (kw) where.staffName = { contains: kw };
  if (ctx.query.staffId) where.staffId = ctx.query.staffId;
  if (ctx.query.month) where.attendanceMonth = ctx.query.month;
  if (ctx.query.type) where.attendanceType = ctx.query.type;
  const [rows, total] = await Promise.all([
    prisma.attendanceV1.findMany({ where, skip, take, orderBy: { attendanceDate: 'desc' } }),
    prisma.attendanceV1.count({ where })
  ]);
  return success(ctx, rows.map(toApi), { ...pageMeta(page, pageSize, total), total });
};

const detail = async ctx => {
  const row = await prisma.attendanceV1.findUnique({ where: { id: ctx.params.id } });
  if (!row) throw new BusinessError('NOT_FOUND', '考勤记录不存在');
  return success(ctx, toApi(row));
};

const create = async ctx => {
  const b = ctx.request.body;
  if (!b.staffId) throw new BusinessError('VALIDATION_ERROR', 'staffId 必填');
  if (!b.staffName) throw new BusinessError('VALIDATION_ERROR', 'staffName 必填');
  const month = b.month || (b.date ? String(b.date).substring(0, 7) : _cnYMD(new Date()).substring(0, 7));
  const attType = b.type || 'full';
  // 《员工管理条例》第二条：每月事假不超过2次、累计不超过2天；超限须团长特批（overLimitApproved=true）
  if (attType === 'PL' && b.overLimitApproved !== true) {
    const rows = await prisma.attendanceV1.findMany({
      where: { staffId: b.staffId, attendanceMonth: month, attendanceType: 'PL' },
      select: { id: true }
    });
    const existed = b.id ? rows.filter(r => r.id !== b.id).length : rows.length;
    const usedTimes = existed + 1; // 考勤按天记，1条=1次=1天
    if (usedTimes > 2) {
      throw new BusinessError('VALIDATION_ERROR', `${month} 事假已达上限（每月不超过2次且累计不超过2天）；如确有特殊情况，请报团长特批后勾选“超限特批”再提交`);
    }
  }
  const data = {
    id: b.id || idByCtx('att', 12, nanoid),
    staffId: b.staffId,
    staffName: b.staffName,
    attendanceMonth: month,
    // 未传日期时按东八区“今天”落库（存为该日 UTC 零点，与显式传 YYYY-MM-DD 的存储口径一致），避免凌晨录入归前一天
    attendanceDate: b.date ? new Date(b.date) : new Date(_cnYMD(new Date()) + 'T00:00:00.000Z'),
    attendanceType: attType,
    scheduleId: b.scheduleId || null,
    checkInTime: b.checkInTime ? new Date(b.checkInTime) : null,
    checkOutTime: b.checkOutTime ? new Date(b.checkOutTime) : null,
    workHours: b.workHours ? Number(b.workHours) : null,
    overtimeHours: b.overtimeHours ? Number(b.overtimeHours) : null,
    locationGps: b.locationGps || null,
    remark: b.remark || null,
    approveStatus: b.approveStatus || 'approved',
    approvedBy: b.approvedBy || (ctx.state.user ? ctx.state.user.username : null),
    ts: nowMs()
  };
  const row = await prisma.attendanceV1.create({ data });
  try { await audit({ ctx, module: 'attendance', action: 'ATTENDANCE_CREATE', targetId: row.id, detail: { staffId: row.staffId, staffName: row.staffName, attendanceDate: row.attendanceDate, attendanceType: row.attendanceType } }); } catch (_) {}
  return created(ctx, toApi(row));
};

const update = async ctx => {
  const b = ctx.request.body;
  const exists = await prisma.attendanceV1.findUnique({ where: { id: ctx.params.id } });
  if (!exists) throw new BusinessError('NOT_FOUND', '考勤记录不存在');
  // 修改为事假时同样校验月度上限（本条记录本身不计入）
  if (b.type === 'PL' && exists.attendanceType !== 'PL' && b.overLimitApproved !== true) {
    const cnt = await prisma.attendanceV1.count({
      where: { staffId: exists.staffId, attendanceMonth: exists.attendanceMonth, attendanceType: 'PL' }
    });
    if (cnt + 1 > 2) {
      throw new BusinessError('VALIDATION_ERROR', `${exists.attendanceMonth} 事假已达上限（每月不超过2次且累计不超过2天）；如确有特殊情况，请报团长特批后勾选“超限特批”再提交`);
    }
  }
  const data = {};
  if (b.type) data.attendanceType = b.type;
  if (b.checkInTime) data.checkInTime = new Date(b.checkInTime);
  if (b.checkOutTime) data.checkOutTime = new Date(b.checkOutTime);
  if (b.workHours !== undefined) data.workHours = b.workHours ? Number(b.workHours) : null;
  if (b.overtimeHours !== undefined) data.overtimeHours = b.overtimeHours ? Number(b.overtimeHours) : null;
  if (b.remark !== undefined) data.remark = b.remark;
  if (b.approveStatus) data.approveStatus = b.approveStatus;
  const row = await prisma.attendanceV1.update({ where: { id: ctx.params.id }, data });
  try { await audit({ ctx, module: 'attendance', action: 'ATTENDANCE_UPDATE', targetId: row.id, detail: { fields: Object.keys(data) } }); } catch (_) {}
  return success(ctx, toApi(row));
};

const remove = async ctx => {
  const row = await prisma.attendanceV1.delete({ where: { id: ctx.params.id } });
  try { await audit({ ctx, module: 'attendance', action: 'ATTENDANCE_DELETE', targetId: ctx.params.id, detail: { staffId: row.staffId, staffName: row.staffName } }); } catch (_) {}
  return noContent(ctx);
};

// ========== 请假申请 ==========
const leaveList = async ctx => {
  const { skip, take, page, pageSize } = pageMeta(ctx.query.page, ctx.query.pageSize, 0);
  const where = {};
  const kw = (ctx.query.keyword || '').trim();
  if (kw) where.staffName = { contains: kw };
  if (ctx.query.staffId) where.staffId = ctx.query.staffId;
  if (ctx.query.status) where.approveStatus = ctx.query.status;
  const [rows, total] = await Promise.all([
    prisma.leaveApplication.findMany({ where, skip, take, orderBy: { createdAt: 'desc' } }),
    prisma.leaveApplication.count({ where })
  ]);
  return success(ctx, rows.map(_leaveToApi), { ...pageMeta(page, pageSize, total), total });
};

const leaveCreate = async ctx => {
  const b = ctx.request.body;
  if (!b.staffId) throw new BusinessError('VALIDATION_ERROR', 'staffId 必填');
  if (!b.staffName) throw new BusinessError('VALIDATION_ERROR', 'staffName 必填');
  if (!b.leaveType) throw new BusinessError('VALIDATION_ERROR', 'leaveType 必填');
  if (!b.reason) throw new BusinessError('VALIDATION_ERROR', 'reason 必填');
  // 未传开始日期时按东八区“今天”；月份归属同样按东八区取，避免凌晨申请归前一月的跨月边界
  const dateFrom = b.dateFrom ? new Date(b.dateFrom) : new Date(_cnYMD(new Date()) + 'T00:00:00.000Z');
  const month = b.dateFrom ? String(b.dateFrom).substring(0, 7) : _cnYMD(new Date()).substring(0, 7);
  const thisDays = b.totalDays ? Number(b.totalDays) : 1;
  // 《员工管理条例》第二条：每月事假不超过2次、累计不超过2天；超限须团长特批（specialApproval=true）
  if (b.leaveType === 'PL' && b.specialApproval !== true) {
    const monthStart = new Date(Date.UTC(Number(month.substring(0, 4)), Number(month.substring(5, 7)) - 1, 1));
    const monthEnd = new Date(Date.UTC(Number(month.substring(0, 4)), Number(month.substring(5, 7)), 1));
    const rows = await prisma.leaveApplication.findMany({
      where: {
        staffId: b.staffId,
        leaveType: 'PL',
        approveStatus: { in: ['pending', 'approved'] },
        dateFrom: { gte: monthStart, lt: monthEnd }
      },
      select: { id: true, totalDays: true }
    });
    const existed = b.id ? rows.filter(r => r.id !== b.id) : rows;
    const usedTimes = existed.length + 1;
    const usedDays = existed.reduce((s, r) => s + (Number(r.totalDays) || 0), 0) + thisDays;
    if (usedTimes > 2 || usedDays > 2) {
      throw new BusinessError('VALIDATION_ERROR', `${month} 事假已达上限（每月不超过2次且累计不超过2天，当前申请后为${usedTimes}次/${Math.round(usedDays * 100) / 100}天）；如确有重病、婚丧等特殊情况，请报团长特批后勾选“超限特批”再提交`);
    }
  }
  const data = {
    id: b.id || idByCtx('leave', 12, nanoid),
    staffId: b.staffId,
    staffName: b.staffName,
    leaveType: b.leaveType,
    dateFrom,
    dateTo: b.dateTo ? new Date(b.dateTo) : new Date(),
    totalDays: thisDays,
    totalHours: b.totalHours ? Number(b.totalHours) : null,
    reason: b.reason,
    attachmentUrls: b.attachmentUrls || null,
    approveStatus: 'pending',
    ts: nowMs()
  };
  const row = await prisma.leaveApplication.create({ data });
  try { await audit({ ctx, module: 'attendance', action: 'LEAVE_CREATE', targetId: row.id, detail: { staffId: row.staffId, leaveType: row.leaveType, totalDays: Number(row.totalDays) || null } }); } catch (_) {}
  return created(ctx, _leaveToApi(row));
};

const leaveApprove = async ctx => {
  const b = ctx.request.body;
  const exists = await prisma.leaveApplication.findUnique({ where: { id: ctx.params.id } });
  if (!exists) throw new BusinessError('NOT_FOUND', '请假申请不存在');
  const row = await prisma.leaveApplication.update({
    where: { id: ctx.params.id },
    data: {
      approveStatus: b.status || 'approved',
      approverId: ctx.state.user ? (ctx.state.user.sub || null) : null,
      approverName: ctx.state.user ? ctx.state.user.username : null,
      approvedAt: new Date(),
      rejectReason: b.rejectReason || null
    }
  });
  try { await audit({ ctx, module: 'attendance', action: 'LEAVE_APPROVE', targetId: row.id, detail: { staffId: row.staffId, status: row.approveStatus } }); } catch (_) {}
  return success(ctx, _leaveToApi(row));
};

// ========== 统计 ==========
const stats = async ctx => {
  const month = ctx.query.month || _cnYMD(new Date()).substring(0, 7);
  const where = { attendanceMonth: month };
  const [total, types] = await Promise.all([
    prisma.attendanceV1.count({ where }),
    prisma.attendanceV1.groupBy({ by: ['attendanceType'], where, _count: true })
  ]);
  const pendingLeaves = await prisma.leaveApplication.count({ where: { approveStatus: 'pending' } });
  const typeMap = {};
  types.forEach(function (t) { typeMap[t.attendanceType] = t._count; });
  return success(ctx, {
    month: month,
    totalRecords: total,
    typeBreakdown: typeMap,
    pendingLeaves: pendingLeaves
  });
};

// ========== 批量导入（v20261004a：POST /v1/attendance/import，单次上限 500 条）==========
// AttendanceV1 无 (staffId, attendanceDate) 唯一约束：同人同日已存在靠预查询判定，默认跳过不覆盖
const IMPORT_LIMIT = 500;
// 中文/别名 → attendanceType 枚举（对齐 schema 注释与 _typeText 映射）
const IMPORT_TYPE_ALIASES = {
  '出勤': 'full', '全天班': 'full', '全天': 'full', '正常': 'full',
  '夜班': 'night', '双班': 'double', '半天班': 'half', '半天': 'half',
  '公休': 'rest', '休息': 'rest', '雨休': 'rainout',
  '事假': 'PL', '病假': 'SL', '丧假': 'BL', '婚假': 'ML', '年假': 'AL',
  '迟到': 'late', '迟到超30分钟': 'late_over', '早退': 'early', '早退超30分钟': 'early_over',
  '旷工': 'absent', '缺勤': 'absent', '请假': 'leave', '外出': 'outing',
  '学习': 'study', '出差': 'business', '工伤': 'injury'
};
const IMPORT_TYPES = ['full', 'night', 'double', 'half', 'rest', 'SL', 'PL', 'BL', 'ML', 'AL',
  'absent', 'rainout', 'leave', 'late', 'late_over', 'early', 'early_over',
  'outing', 'study', 'business', 'injury'];

const importRecords = async ctx => {
  const b = ctx.request.body || {};
  const items = Array.isArray(b.items) ? b.items : [];
  if (!items.length) throw new BusinessError('VALIDATION_ERROR', 'items 必填（1-500 条）');
  if (items.length > IMPORT_LIMIT) {
    throw new BusinessError('VALIDATION_ERROR', `单次最多导入 ${IMPORT_LIMIT} 条（当前 ${items.length} 条），请分批提交`);
  }

  // 1) 逐条静态校验（必填 / 日期格式 / 状态枚举 / 工时数值），失败计入 failed 不中断
  const failed = [];
  const valid = [];
  const idRefs = new Set();
  const noRefs = new Set();
  const nameRefs = new Set();
  items.forEach((it, i) => {
    it = it || {};
    const idRef = String(it.performerId || it.staffId || '').trim();
    const noRef = String(it.performerNo || it.staffNo || '').trim();
    const nameRef = String(it.performerName || it.staffName || '').trim();
    const wd = String(it.workDate || it.date || '').trim();
    if (!idRef && !noRef && !nameRef) { failed.push({ index: i, reason: '缺少 performerId/performerNo/performerName' }); return; }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(wd)) { failed.push({ index: i, reason: `日期非法（需 YYYY-MM-DD）: ${wd || '(空)'}` }); return; }
    const d = new Date(wd + 'T00:00:00.000Z');
    if (isNaN(d.getTime()) || d.toISOString().substring(0, 10) !== wd) { failed.push({ index: i, reason: `日期不存在: ${wd}` }); return; }
    const rawStatus = String(it.status || it.type || '').trim();
    const type = IMPORT_TYPE_ALIASES[rawStatus] || rawStatus;
    if (!IMPORT_TYPES.includes(type)) { failed.push({ index: i, reason: `状态非法: ${rawStatus || '(空)'}（可用 ${IMPORT_TYPES.join('/')} 或中文别名）` }); return; }
    let hours = null;
    if (it.hours !== undefined && it.hours !== null && it.hours !== '') {
      hours = Number(it.hours);
      if (!isFinite(hours) || hours < 0 || hours > 24) { failed.push({ index: i, reason: `工时非法（0-24）: ${it.hours}` }); return; }
    }
    if (idRef) idRefs.add(idRef);
    else if (noRef) noRefs.add(noRef);
    else nameRefs.add(nameRef);
    valid.push({ index: i, refId: idRef, refNo: noRef, refName: nameRef, workDate: wd, type, hours, remark: String(it.remark || '').trim() || null });
  });

  // 2) 人员解析：performerId > performerNo（工号，performers_db_v1 唯一）> performerName（重名→failed，需用工号）
  const byId = {}; const byNo = {}; const byName = {};
  if (idRefs.size || noRefs.size || nameRefs.size) {
    const ors = [];
    if (idRefs.size) ors.push({ id: { in: Array.from(idRefs) } });
    if (noRefs.size) ors.push({ staffNo: { in: Array.from(noRefs) } });
    if (nameRefs.size) ors.push({ name: { in: Array.from(nameRefs) } });
    const perfs = await prisma.performersDbV1.findMany({
      where: { OR: ors },
      select: { id: true, name: true, staffNo: true }
    });
    perfs.forEach(p => {
      byId[p.id] = p;
      if (p.staffNo) byNo[p.staffNo] = p;
      (byName[p.name] = byName[p.name] || []).push(p);
    });
  }
  const rows = [];
  valid.forEach(v => {
    let p = null;
    if (v.refId) p = byId[v.refId];
    else if (v.refNo) p = byNo[v.refNo];
    else {
      const list = byName[v.refName] || [];
      if (list.length > 1) { failed.push({ index: v.index, reason: `姓名「${v.refName}」对应多名人员，请改用工号导入` }); return; }
      p = list[0];
    }
    if (!p) { failed.push({ index: v.index, reason: `人员不存在: ${v.refId || v.refNo || v.refName}` }); return; }
    rows.push({ index: v.index, staffId: p.id, staffName: p.name, workDate: v.workDate, type: v.type, hours: v.hours, remark: v.remark });
  });

  // 3) 同人同日去重：库中已有 + 批内重复 → 跳过；写串行（同 inventory.js 写互斥先例，for-await 天然串行）
  const existKeys = new Set();
  if (rows.length) {
    const existed = await prisma.attendanceV1.findMany({
      where: {
        staffId: { in: Array.from(new Set(rows.map(r => r.staffId))) },
        attendanceDate: { in: Array.from(new Set(rows.map(r => new Date(r.workDate)))) }
      },
      select: { staffId: true, attendanceDate: true }
    });
    existed.forEach(e => existKeys.add(e.staffId + '|' + new Date(e.attendanceDate).toISOString().substring(0, 10)));
  }
  let created = 0;
  let skipped = 0;
  for (const r of rows) {
    const key = r.staffId + '|' + r.workDate;
    if (existKeys.has(key)) { skipped++; continue; }
    existKeys.add(key); // 批内同人同日只录第一条
    try {
      await prisma.attendanceV1.create({
        data: {
          id: idByCtx('att', 12, nanoid),
          staffId: r.staffId,
          staffName: r.staffName,
          attendanceMonth: r.workDate.substring(0, 7),
          attendanceDate: new Date(r.workDate), // 与 create() 口径一致：YYYY-MM-DD 存 UTC 零点
          attendanceType: r.type,
          workHours: r.hours,
          remark: r.remark,
          approveStatus: 'approved',
          approvedBy: ctx.state.user ? ctx.state.user.username : null,
          ts: nowMs()
        }
      });
      created++;
    } catch (e) {
      failed.push({ index: r.index, reason: '写入失败: ' + ((e && e.message) || e) });
    }
  }
  try { await audit({ ctx, module: 'attendance', action: 'ATTENDANCE_IMPORT', detail: { created, skipped, failedCount: failed.length } }); } catch (_) {}
  return success(ctx, { created, skipped, failed });
};

module.exports = {
  list,
  detail,
  create,
  update,
  remove,
  leaveList,
  leaveCreate,
  leaveApprove,
  stats,
  importRecords,
  toApi
};
