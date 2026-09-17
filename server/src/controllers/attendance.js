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

function _typeText(t) {
  var map = {
    full: '全天班', night: '夜班', double: '双班', half: '半天班',
    rest: '公休', SL: '病假', PL: '事假', BL: '丧假', ML: '婚假',
    AL: '年假', absent: '缺勤', rainout: '雨休', leave: '请假',
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
  const data = {
    id: b.id || idByCtx('att', 12, nanoid),
    staffId: b.staffId,
    staffName: b.staffName,
    attendanceMonth: b.month || (b.date ? String(b.date).substring(0, 7) : new Date().toISOString().substring(0, 7)),
    attendanceDate: b.date ? new Date(b.date) : new Date(),
    attendanceType: b.type || 'full',
    scheduleId: b.scheduleId || null,
    checkInTime: b.checkInTime ? new Date(b.checkInTime) : null,
    checkOutTime: b.checkOutTime ? new Date(b.checkOutTime) : null,
    workHours: b.workHours ? Number(b.workHours) : null,
    overtimeHours: b.overtimeHours ? Number(b.overtimeHours) : null,
    locationGps: b.locationGps || null,
    remark: b.remark || null,
    approveStatus: b.approveStatus || 'approved',
    approvedBy: b.approvedBy || ctx.state.user ? (ctx.state.user && ctx.state.user.username) : null,
    ts: nowMs()
  };
  const row = await prisma.attendanceV1.create({ data });
  try { await audit(ctx, 'attendance:create', row.id, { staffId: row.staffId, staffName: row.staffName }); } catch (_) {}
  return created(ctx, toApi(row));
};

const update = async ctx => {
  const b = ctx.request.body;
  const exists = await prisma.attendanceV1.findUnique({ where: { id: ctx.params.id } });
  if (!exists) throw new BusinessError('NOT_FOUND', '考勤记录不存在');
  const data = {};
  if (b.type) data.attendanceType = b.type;
  if (b.checkInTime) data.checkInTime = new Date(b.checkInTime);
  if (b.checkOutTime) data.checkOutTime = new Date(b.checkOutTime);
  if (b.workHours !== undefined) data.workHours = b.workHours ? Number(b.workHours) : null;
  if (b.overtimeHours !== undefined) data.overtimeHours = b.overtimeHours ? Number(b.overtimeHours) : null;
  if (b.remark !== undefined) data.remark = b.remark;
  if (b.approveStatus) data.approveStatus = b.approveStatus;
  const row = await prisma.attendanceV1.update({ where: { id: ctx.params.id }, data });
  try { await audit(ctx, 'attendance:update', row.id, data); } catch (_) {}
  return success(ctx, toApi(row));
};

const remove = async ctx => {
  const row = await prisma.attendanceV1.delete({ where: { id: ctx.params.id } });
  try { await audit(ctx, 'attendance:delete', ctx.params.id, { staffId: row.staffId }); } catch (_) {}
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
  const data = {
    id: b.id || idByCtx('leave', 12, nanoid),
    staffId: b.staffId,
    staffName: b.staffName,
    leaveType: b.leaveType,
    dateFrom: b.dateFrom ? new Date(b.dateFrom) : new Date(),
    dateTo: b.dateTo ? new Date(b.dateTo) : new Date(),
    totalDays: b.totalDays ? Number(b.totalDays) : 1,
    totalHours: b.totalHours ? Number(b.totalHours) : null,
    reason: b.reason,
    attachmentUrls: b.attachmentUrls || null,
    approveStatus: 'pending',
    ts: nowMs()
  };
  const row = await prisma.leaveApplication.create({ data });
  try { await audit(ctx, 'leave:create', row.id, { staffId: row.staffId }); } catch (_) {}
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
      approverId: ctx.state.user ? ctx.state.user.id : null,
      approverName: ctx.state.user ? ctx.state.user.username : null,
      approvedAt: new Date(),
      rejectReason: b.rejectReason || null
    }
  });
  try { await audit(ctx, 'leave:approve', row.id, { status: row.approveStatus }); } catch (_) {}
  return success(ctx, _leaveToApi(row));
};

// ========== 统计 ==========
const stats = async ctx => {
  const month = ctx.query.month || new Date().toISOString().substring(0, 7);
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
  toApi
};
