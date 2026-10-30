'use strict';

/**
 * src/controllers/attendance.js —— 考勤管理 CRUD
 * 数据表：AttendanceV1 + LeaveApplication + OvertimeRecord（prisma schema 已定义）
 */
const { nanoid } = require('nanoid');
const prisma = require('../utils/prisma');
const { success, created, noContent, parsePage, pagedSuccess } = require('../utils/response');
const { idByCtx, nowMs } = require('../config');
const { BusinessError } = require('../middleware/error-handler');
const { audit } = require('../services/audit-service');
const punchParams = require('../services/punch-params');
// v20261029i：请假审批联动自动重算工资条（wages/helpers 的考勤/订单聚合口径）
const hWages = require('./wages/helpers');

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

// v20261012：类型映射统一走 services/punch-params（装台/卸台/事故分级新类型与员工端共用一份，避免漂移）
function _typeText(t) {
  return punchParams.ATT_TYPE_TEXT[t] || t || '';
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
    makeupDate: row.makeupDate ? new Date(row.makeupDate).toISOString().substring(0, 10) : '',
    approveStatus: row.approveStatus || 'pending',
    approverName: row.approverName || '',
    approvedAt: row.approvedAt ? new Date(row.approvedAt).toISOString() : '',
    rejectReason: row.rejectReason || '',
    createdAt: row.createdAt ? new Date(row.createdAt).toISOString() : ''
  };
}

// ========== 考勤记录 ==========
const list = async ctx => {
  const { skip, take, page, pageSize } = parsePage(ctx.query);
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
  return pagedSuccess(ctx, rows.map(toApi), total, page, pageSize);
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
  // v20261025 同人同日防重：考勤按天一条，重复录入会双算工资（存 UTC 零点口径，用当日范围查询兼容带时间分量的历史行）
  const attDate = b.date ? new Date(b.date) : new Date(_cnYMD(new Date()) + 'T00:00:00.000Z');
  const dup = await prisma.attendanceV1.findFirst({
    where: {
      staffId: b.staffId,
      attendanceDate: { gte: attDate, lt: new Date(attDate.getTime() + 86400000) }
    },
    select: { attendanceType: true }
  });
  if (dup) {
    throw new BusinessError('CONFLICT', `该员工已有 ${month} 当日考勤记录（类型：${_typeText(dup.attendanceType)}），不能重复录入`);
  }
  const data = {
    id: b.id || idByCtx('att', 12, nanoid),
    staffId: b.staffId,
    staffName: b.staffName,
    attendanceMonth: month,
    // 未传日期时按东八区“今天”落库（存为该日 UTC 零点，与显式传 YYYY-MM-DD 的存储口径一致），避免凌晨录入归前一天
    attendanceDate: attDate,
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
  // v20261025：支持修改日期（重算 attendanceMonth，口径与 create 一致取 YYYY-MM）
  let newDate = null;
  let newMonth = exists.attendanceMonth;
  if (b.date !== undefined && b.date !== null && b.date !== '') {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(b.date))) throw new BusinessError('VALIDATION_ERROR', '日期格式应为 YYYY-MM-DD');
    newDate = new Date(b.date + 'T00:00:00.000Z');
    if (isNaN(newDate.getTime())) throw new BusinessError('VALIDATION_ERROR', '日期不合法');
    newMonth = String(b.date).substring(0, 7);
  }
  // v20261025：改日期 → 同人同日查重（排除自身）
  if (newDate) {
    const dup = await prisma.attendanceV1.findFirst({
      where: {
        id: { not: exists.id },
        staffId: exists.staffId,
        attendanceDate: { gte: newDate, lt: new Date(newDate.getTime() + 86400000) }
      },
      select: { attendanceType: true }
    });
    if (dup) {
      throw new BusinessError('CONFLICT', `该员工已有 ${newMonth} 当日考勤记录（类型：${_typeText(dup.attendanceType)}），不能重复录入`);
    }
  }
  // 修改为事假（或事假记录跨月移动）时校验月度上限（本条记录本身不计入）
  const monthChanged = !!(newDate && newMonth !== exists.attendanceMonth);
  const targetType = b.type || exists.attendanceType;
  if (targetType === 'PL' && b.overLimitApproved !== true && (exists.attendanceType !== 'PL' || monthChanged)) {
    const cnt = await prisma.attendanceV1.count({
      where: { id: { not: exists.id }, staffId: exists.staffId, attendanceMonth: newMonth, attendanceType: 'PL' }
    });
    if (cnt + 1 > 2) {
      throw new BusinessError('VALIDATION_ERROR', `${newMonth} 事假已达上限（每月不超过2次且累计不超过2天）；如确有特殊情况，请报团长特批后勾选“超限特批”再提交`);
    }
  }
  const data = {};
  if (b.type) data.attendanceType = b.type;
  if (newDate) {
    data.attendanceDate = newDate;
    data.attendanceMonth = newMonth;
  }
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
  const { skip, take, page, pageSize } = parsePage(ctx.query);
  const where = {};
  const kw = (ctx.query.keyword || '').trim();
  if (kw) where.staffName = { contains: kw };
  if (ctx.query.staffId) where.staffId = ctx.query.staffId;
  if (ctx.query.status) where.approveStatus = ctx.query.status;
  const [rows, total] = await Promise.all([
    prisma.leaveApplication.findMany({ where, skip, take, orderBy: { createdAt: 'desc' } }),
    prisma.leaveApplication.count({ where })
  ]);
  return pagedSuccess(ctx, rows.map(_leaveToApi), total, page, pageSize);
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

// v20261029f：审批通过自动同步考勤（根因修复：此前审批只改状态，考勤表无请假行，工资聚合只看考勤 → 请假不扣款）
// 规则：批准 → 按请假区间逐日生成 attendanceType=leaveType 的考勤行（remark 前缀 请假#单号，可识别可回滚）；
//       当日已有其他考勤行（人工记录/补假行）则跳过不覆盖；驳回/撤回 → 删除本单同步的考勤行。
const _leaveSyncPrefix = '请假#';

const _syncLeaveAttendance = async (row) => {
  if (row.approveStatus === 'approved') {
    const from = row.dateFrom ? new Date(row.dateFrom) : null;
    const to = row.dateTo ? new Date(row.dateTo) : from;
    if (!from || isNaN(from.getTime())) return;
    const start = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate()));
    const end = to && !isNaN(to.getTime()) ? new Date(Date.UTC(to.getUTCFullYear(), to.getUTCMonth(), to.getUTCDate())) : start;
    let created = 0, skipped = 0;
    for (let d = new Date(start); d <= end && created + skipped < 31; d.setUTCDate(d.getUTCDate() + 1)) {
      const day = new Date(d.getTime());
      // 先清本单旧同步行（幂等 + 支持改期/改类型后重新审批）
      await prisma.attendanceV1.deleteMany({ where: { staffId: row.staffId, attendanceDate: day, remark: { startsWith: _leaveSyncPrefix + row.id } } });
      const dup = await prisma.attendanceV1.findFirst({ where: { staffId: row.staffId, attendanceDate: day } });
      if (dup) { skipped += 1; continue; }
      await prisma.attendanceV1.create({
        data: {
          id: idByCtx('att', 12, nanoid),
          staffId: row.staffId,
          staffName: row.staffName,
          attendanceMonth: day.toISOString().substring(0, 7),
          attendanceDate: day,
          attendanceType: row.leaveType,
          remark: _leaveSyncPrefix + row.id + '（' + (row.leaveType || '') + ' ' + day.toISOString().substring(0, 10) + '）',
          approveStatus: 'approved',
          approvedBy: row.approverName || null,
          ts: nowMs()
        }
      });
      created += 1;
    }
    return { created, skipped };
  }
  if (row.approveStatus === 'rejected' || row.approveStatus === 'cancelled') {
    await prisma.attendanceV1.deleteMany({ where: { staffId: row.staffId, remark: { startsWith: _leaveSyncPrefix + row.id } } });
  }
  return null;
};

const leaveApprove = async ctx => {
  const b = ctx.request.body;
  const exists = await prisma.leaveApplication.findUnique({ where: { id: ctx.params.id } });
  if (!exists) throw new BusinessError('NOT_FOUND', '请假申请不存在');
  // v20261017f：员工已撤回的请假单不允许再审批（避免管理侧列表残留导致误批）
  if (exists.approveStatus === 'cancelled') throw new BusinessError('VALIDATION_ERROR', '该请假单已被申请人撤回，不能审批');
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
  // v20261029f：审批结果同步考勤行（失败不阻断审批，仅记录日志）
  let syncInfo = null;
  try { syncInfo = await _syncLeaveAttendance(row); } catch (e) { syncInfo = { error: e.message }; }
  // v20261029i：审批通过/驳回 → 自动重算该员工受影响月份的工资条（口径与 recalc-leave-1029f 完全一致）
  // 通过 → 同步扣减；驳回 → 考勤行已删，重算恢复；失败不阻断审批，仅记录 recalcError
  try {
    if (row.approveStatus === 'approved' || row.approveStatus === 'rejected') {
      const mSet = new Set();
      for (const d of [row.dateFrom, row.dateTo]) { if (d && !isNaN(new Date(d).getTime())) mSet.add(new Date(d).toISOString().substring(0, 7)); }
      const recalcOut = [];
      for (const mo of mSet) {
        const mod = require('./wages/leave-recalc.js');
        recalcOut.push(await mod.recalcLeaveWages(prisma, hWages, { month: mo, staffIds: [row.staffId] }));
      }
      if (syncInfo) syncInfo.recalc = recalcOut; else syncInfo = { recalc: recalcOut };
    }
  } catch (e) { syncInfo = Object.assign(syncInfo || {}, { recalcError: e.message }); }
  return success(ctx, Object.assign(_leaveToApi(row), syncInfo ? { attendanceSync: syncInfo } : {}));
};

// v20261029h 管理端编辑请假单：可改类型/起止日期/天数/事由；已批准单编辑后重置为待审批，
// 并清除旧考勤同步行（重新批准时按新日期自动重建，见 _syncLeaveAttendance）
const leaveUpdate = async ctx => {
  const b = ctx.request.body || {};
  const exists = await prisma.leaveApplication.findUnique({ where: { id: ctx.params.id } });
  if (!exists) throw new BusinessError('NOT_FOUND', '请假申请不存在');
  if (exists.approveStatus === 'cancelled') throw new BusinessError('VALIDATION_ERROR', '已撤回的请假单不能编辑，请删除后重新申请');
  const data = {};
  if (b.leaveType != null) data.leaveType = String(b.leaveType).trim();
  if (b.dateFrom != null && b.dateFrom !== '') data.dateFrom = new Date(b.dateFrom + 'T00:00:00.000Z');
  if (b.dateTo != null && b.dateTo !== '') data.dateTo = new Date(b.dateTo + 'T00:00:00.000Z');
  if (b.totalDays != null) data.totalDays = Number(b.totalDays) || 1;
  if (b.reason != null) data.reason = String(b.reason).trim();
  if (!Object.keys(data).length) throw new BusinessError('VALIDATION_ERROR', '无可更新字段');
  if (data.dateFrom && isNaN(data.dateFrom.getTime())) throw new BusinessError('VALIDATION_ERROR', '开始日期格式错误');
  if (data.dateTo && isNaN(data.dateTo.getTime())) throw new BusinessError('VALIDATION_ERROR', '结束日期格式错误');
  const f = data.dateFrom || exists.dateFrom;
  const t = data.dateTo || exists.dateTo;
  if (f && t && new Date(t).getTime() < new Date(f).getTime()) throw new BusinessError('VALIDATION_ERROR', '结束日期不能早于开始日期');
  const wasApproved = exists.approveStatus === 'approved';
  if (wasApproved) {
    // 已批准单被编辑 → 重新走审批流（清审批人/时间，考勤同步行随之清除）
    data.approveStatus = 'pending';
    data.approverId = null;
    data.approverName = null;
    data.approvedAt = null;
    data.rejectReason = null;
  }
  const row = await prisma.leaveApplication.update({ where: { id: exists.id }, data });
  try { await audit({ ctx, module: 'attendance', action: 'LEAVE_UPDATE', targetId: row.id, detail: { staffId: row.staffId, before: { type: exists.leaveType, from: exists.dateFrom, to: exists.dateTo, days: exists.totalDays }, after: { type: row.leaveType, from: row.dateFrom, to: row.dateTo, days: row.totalDays }, reapprove: wasApproved } }); } catch (_) {}
  let syncInfo = null;
  if (wasApproved) {
    try {
      const r = await prisma.attendanceV1.deleteMany({ where: { staffId: exists.staffId, remark: { startsWith: _leaveSyncPrefix + exists.id } } });
      syncInfo = { attendanceCleared: r.count, note: '已批准假条被编辑，考勤同步行已清除，待重新批准后按新日期重建' };
    } catch (e) { syncInfo = { error: e.message }; }
  }
  return success(ctx, Object.assign(_leaveToApi(row), syncInfo ? { attendanceSync: syncInfo } : {}));
};

// v20261017g：删除请假单（仅限已驳回/已撤回，供 E2E 测试数据自动清理及日常纠错）
const leaveRemove = async ctx => {
  const exists = await prisma.leaveApplication.findUnique({ where: { id: ctx.params.id } });
  if (!exists) throw new BusinessError('NOT_FOUND', '请假申请不存在');
  if (['rejected', 'cancelled'].indexOf(exists.approveStatus) < 0) {
    throw new BusinessError('VALIDATION_ERROR', '仅已驳回/已撤回的请假单可删除');
  }
  await prisma.leaveApplication.delete({ where: { id: exists.id } });
  try { await audit({ ctx, module: 'attendance', action: 'LEAVE_DELETE', targetId: exists.id, detail: { staffId: exists.staffId, status: exists.approveStatus, reason: exists.reason } }); } catch (_) {}
  return success(ctx, { id: exists.id });
};

// ========== 补假（v20261028b）==========
// 已批准的请假单可安排补假日期：自动生成一条 attendanceType=full 的出勤考勤（按出勤计薪，
// 员工补上班一天拿一天天工资，弥补请假扣款；请假记录与扣款口径不变）。
// 幂等：重复调用=改期（先删旧补假考勤再建新）；leaveMakeupCancel 取消补假并删考勤。
const _makeupRemarkPrefix = '补假#';

const leaveMakeup = async ctx => {
  const b = ctx.request.body;
  const exists = await prisma.leaveApplication.findUnique({ where: { id: ctx.params.id } });
  if (!exists) throw new BusinessError('NOT_FOUND', '请假申请不存在');
  if (exists.approveStatus !== 'approved') throw new BusinessError('VALIDATION_ERROR', '仅已批准的请假单可安排补假');
  if (!b.makeupDate || !/^\d{4}-\d{2}-\d{2}$/.test(String(b.makeupDate))) throw new BusinessError('VALIDATION_ERROR', '补假日期格式应为 YYYY-MM-DD');
  const makeupDay = new Date(String(b.makeupDate) + 'T00:00:00.000Z');
  if (isNaN(makeupDay.getTime())) throw new BusinessError('VALIDATION_ERROR', '补假日期无效');
  const dateFrom = exists.dateFrom ? new Date(exists.dateFrom).toISOString().substring(0, 10) : '';
  const dateTo = exists.dateTo ? new Date(exists.dateTo).toISOString().substring(0, 10) : '';
  // 改期：删除旧补假考勤（带补假#前缀防误删人工记录）
  if (exists.makeupAttId) {
    await prisma.attendanceV1.deleteMany({ where: { id: exists.makeupAttId, remark: { startsWith: _makeupRemarkPrefix } } });
  }
  // 同人同日防重：补假目标日已有其他考勤记录时拒绝（避免双份计薪）
  const dup = await prisma.attendanceV1.findFirst({ where: { staffId: exists.staffId, attendanceDate: makeupDay, id: { not: exists.makeupAttId || '' } } });
  if (dup) throw new BusinessError('CONFLICT', '该员工 ' + String(b.makeupDate) + ' 已有考勤记录（类型：' + dup.attendanceType + '），请选择其他补假日期');
  const att = await prisma.attendanceV1.create({
    data: {
      id: idByCtx('att', 12, nanoid),
      staffId: exists.staffId,
      staffName: exists.staffName,
      attendanceMonth: String(b.makeupDate).substring(0, 7),
      attendanceDate: makeupDay,
      attendanceType: 'full',
      remark: _makeupRemarkPrefix + exists.id + '（原请假 ' + dateFrom + '~' + dateTo + '）',
      approveStatus: 'approved',
      approvedBy: ctx.state.user ? (ctx.state.user.username || null) : null,
      ts: nowMs()
    }
  });
  const row = await prisma.leaveApplication.update({
    where: { id: exists.id },
    data: { makeupDate: makeupDay, makeupAttId: att.id }
  });
  try { await audit({ ctx, module: 'attendance', action: 'LEAVE_MAKEUP', targetId: row.id, detail: { staffId: row.staffId, makeupDate: String(b.makeupDate), attId: att.id } }); } catch (_) {}
  return success(ctx, _leaveToApi(row));
};

// 取消补假：删除补假考勤并清空补假日期（请假单恢复为未安排补假状态）
const leaveMakeupCancel = async ctx => {
  const exists = await prisma.leaveApplication.findUnique({ where: { id: ctx.params.id } });
  if (!exists) throw new BusinessError('NOT_FOUND', '请假申请不存在');
  if (!exists.makeupDate && !exists.makeupAttId) throw new BusinessError('VALIDATION_ERROR', '该请假单未安排补假');
  if (exists.makeupAttId) {
    await prisma.attendanceV1.deleteMany({ where: { id: exists.makeupAttId, remark: { startsWith: _makeupRemarkPrefix } } });
  }
  const row = await prisma.leaveApplication.update({
    where: { id: exists.id },
    data: { makeupDate: null, makeupAttId: null }
  });
  try { await audit({ ctx, module: 'attendance', action: 'LEAVE_MAKEUP_CANCEL', targetId: row.id, detail: { staffId: row.staffId } }); } catch (_) {}
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
  '学习': 'study', '出差': 'business', '工伤': 'injury',
  // v20261012 打卡新规：装台/卸台日 + 事故分级（代打卡查实按三级）
  '装台': 'stage_in', '装台日': 'stage_in',
  '卸台': 'stage_out', '卸台日': 'stage_out',
  '事故一级': 'accident_l1', '一级事故': 'accident_l1', '一级': 'accident_l1',
  '事故二级': 'accident_l2', '二级事故': 'accident_l2', '二级': 'accident_l2',
  '事故三级': 'accident_l3', '三级事故': 'accident_l3', '三级': 'accident_l3',
  '代打卡': 'accident_l3', '代打卡查实': 'accident_l3'
};
const IMPORT_TYPES = ['full', 'night', 'double', 'half', 'rest', 'SL', 'PL', 'BL', 'ML', 'AL',
  'absent', 'rainout', 'leave', 'late', 'late_over', 'early', 'early_over',
  'outing', 'study', 'business', 'injury',
  'stage_in', 'stage_out', 'accident_l1', 'accident_l2', 'accident_l3'];

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

// ========== 管理员批量补打卡（POST /v1/attendance/batch-punch）==========
// 一次为多个员工补录 in+out 两条打卡记录，无 GPS，状态按时间自动判定
const BATCH_PUNCH_LIMIT = 200;
const batchPunch = async ctx => {
  const b = ctx.request.body || {};
  const performerIds = Array.isArray(b.performerIds) ? b.performerIds : [];
  if (!performerIds.length) throw new BusinessError('VALIDATION_ERROR', 'performerIds 必填（1-200 人）');
  if (performerIds.length > BATCH_PUNCH_LIMIT) {
    throw new BusinessError('VALIDATION_ERROR', `单次最多 ${BATCH_PUNCH_LIMIT} 人（当前 ${performerIds.length} 人）`);
  }

  const punchDate = String(b.punchDate || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(punchDate)) {
    throw new BusinessError('VALIDATION_ERROR', 'punchDate 格式应为 YYYY-MM-DD');
  }
  const dayStart = new Date(punchDate + 'T00:00:00.000Z');
  if (isNaN(dayStart.getTime())) {
    throw new BusinessError('VALIDATION_ERROR', 'punchDate 日期不合法');
  }

  // punchTime 可选，默认当前时间，格式 HH:MM（东八区时间）
  let punchHour = 9, punchMin = 0;
  const pt = String(b.punchTime || '').trim();
  if (pt) {
    const m = pt.match(/^(\d{1,2}):(\d{2})$/);
    if (!m) throw new BusinessError('VALIDATION_ERROR', 'punchTime 格式应为 HH:MM');
    punchHour = Number(m[1]); punchMin = Number(m[2]);
    if (punchHour > 23 || punchMin > 59) throw new BusinessError('VALIDATION_ERROR', 'punchTime 时间不合法');
  }
  // 管理员补打卡输入的是东八区时间，需转 UTC 存储（与员工端自助打卡口径一致）

  // 补卡类型：in=仅上班，out=仅下班，both=上班+下班（默认）
  const punchType = String(b.punchType || 'both').trim();
  if (!['in', 'out', 'both'].includes(punchType)) {
    throw new BusinessError('VALIDATION_ERROR', 'punchType 枚举非法（in/out/both）');
  }
  const types = punchType === 'in' ? ['in'] : punchType === 'out' ? ['out'] : ['in', 'out'];

  // 状态全部由管理员手动指定，默认 normal（不再按时间自动判定）
  let inStatus = b.inStatus || 'normal';
  let outStatus = b.outStatus || 'normal';
  if (!['normal', 'late', 'early', 'absent'].includes(inStatus)) {
    throw new BusinessError('VALIDATION_ERROR', 'inStatus 枚举非法（normal/late/early/absent）');
  }
  if (!['normal', 'late', 'early', 'absent'].includes(outStatus)) {
    throw new BusinessError('VALIDATION_ERROR', 'outStatus 枚举非法（normal/late/early/absent）');
  }

  const remark = b.remark ? String(b.remark).trim().slice(0, 200) : null;
  const uniqueIds = [...new Set(performerIds.map(String))];

  // 验证员工是否存在
  const perfs = await prisma.performersDbV1.findMany({
    where: { id: { in: uniqueIds } },
    select: { id: true, name: true, staffNo: true }
  });
  const perfMap = new Map(perfs.map(p => [p.id, p]));

  // 查已有打卡记录（同人同日）
  const existing = await prisma.employeePunchV1.findMany({
    where: {
      performerId: { in: uniqueIds },
      punchDate: { gte: dayStart, lt: new Date(dayStart.getTime() + 24 * 3600 * 1000) }
    }
  });
  const existSet = new Set(existing.map(r => r.performerId + '|' + r.punchType));

  const punchTime = new Date(punchDate + 'T' + String(punchHour).padStart(2, '0') + ':' + String(punchMin).padStart(2, '0') + ':00+08:00');
  const ts = BigInt(nowMs());
  let created = 0, skipped = 0;
  const failed = [];
  const toCreate = [];

  for (const pid of uniqueIds) {
    if (!perfMap.has(pid)) { failed.push({ performerId: pid, reason: '员工不存在' }); continue; }
    for (const t of types) {
      if (existSet.has(pid + '|' + t)) { skipped++; } else {
        toCreate.push({ id: idByCtx('punch', 12, nanoid), performerId: pid, punchDate: dayStart, punchType: t, punchTime, status: t === 'in' ? inStatus : outStatus, remark, ts });
      }
    }
  }

  if (toCreate.length) {
    try {
      const result = await prisma.employeePunchV1.createMany({ data: toCreate });
      created = result.count;
    } catch (e) {
      // 逐条回退（可能唯一约束冲突）
      for (const rec of toCreate) {
        try {
          await prisma.employeePunchV1.create({ data: rec });
          created++;
        } catch (_) { skipped++; }
      }
    }
  }

  try { await audit({ ctx, module: 'attendance', action: 'ATTENDANCE_BATCH_PUNCH', detail: { performerCount: uniqueIds.length, created, skipped, failedCount: failed.length, punchDate, punchTime: pt || '(now)', punchType } }); } catch (_) {}
  return success(ctx, { created, skipped, failed });
};

// ========== 按结算区间多员工批量手工考勤（POST /v1/attendance/batch-entry，v20261025）==========
// 前端把「多选员工 × 起止日期区间 × 统一类型」展开为 items 一次提交；≤500条/次。
// 同人同日已有（库中或批内）→ skipped（无强制覆盖语义）；PL 月度上限超限 → failed 逐条报原因，不整批中断。
const BATCH_ENTRY_LIMIT = 500;
const batchEntry = async ctx => {
  const b = ctx.request.body || {};
  const items = Array.isArray(b.items) ? b.items : [];
  // v20261029j：事假超限团长特批豁免（批量入口；单条 create/update 已支持 overLimitApproved）
  const allowOver = b.overLimitApproved === true;
  if (!items.length) throw new BusinessError('VALIDATION_ERROR', 'items 必填（1-500 条）');
  if (items.length > BATCH_ENTRY_LIMIT) {
    throw new BusinessError('VALIDATION_ERROR', `单次最多 ${BATCH_ENTRY_LIMIT} 条（当前 ${items.length} 条），请分批提交`);
  }

  // 1) 逐条静态校验（staffId / 日期格式 / 类型枚举），失败计入 failed 不中断
  const failed = [];
  const valid = [];
  const idRefs = new Set();
  items.forEach((it, i) => {
    it = it || {};
    const sid = String(it.staffId || '').trim();
    const wd = String(it.date || '').trim();
    const type = String(it.type || '').trim();
    if (!sid) { failed.push({ index: i, reason: '缺少 staffId' }); return; }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(wd)) { failed.push({ index: i, reason: `日期非法（需 YYYY-MM-DD）: ${wd || '(空)'}` }); return; }
    const d = new Date(wd + 'T00:00:00.000Z');
    if (isNaN(d.getTime()) || d.toISOString().substring(0, 10) !== wd) { failed.push({ index: i, reason: `日期不存在: ${wd}` }); return; }
    if (!IMPORT_TYPES.includes(type)) { failed.push({ index: i, reason: `状态非法: ${type || '(空)'}` }); return; }
    idRefs.add(sid);
    valid.push({ index: i, staffId: sid, workDate: wd, type, remark: String(it.remark || '').trim() || null });
  });

  // 2) 人员解析（staffId → 姓名）
  const perfs = idRefs.size ? await prisma.performersDbV1.findMany({
    where: { id: { in: Array.from(idRefs) } },
    select: { id: true, name: true }
  }) : [];
  const perfMap = new Map(perfs.map(p => [p.id, p]));

  // 3) 同人同日去重：库中已有 + 批内重复 → skipped
  const existKeys = new Set();
  if (valid.length) {
    const existed = await prisma.attendanceV1.findMany({
      where: {
        staffId: { in: Array.from(new Set(valid.map(r => r.staffId))) },
        attendanceDate: { in: Array.from(new Set(valid.map(r => new Date(r.workDate)))) }
      },
      select: { staffId: true, attendanceDate: true }
    });
    existed.forEach(e => existKeys.add(e.staffId + '|' + new Date(e.attendanceDate).toISOString().substring(0, 10)));
  }

  // 4) PL 月度上限预检（每员工每月 ≤2 条，含库中已有 PL 计数）
  const plCounts = {};
  const plReq = valid.filter(r => r.type === 'PL');
  if (plReq.length) {
    const plExist = await prisma.attendanceV1.findMany({
      where: {
        staffId: { in: Array.from(new Set(plReq.map(r => r.staffId))) },
        attendanceType: 'PL',
        attendanceMonth: { in: Array.from(new Set(plReq.map(r => r.workDate.substring(0, 7)))) }
      },
      select: { staffId: true, attendanceMonth: true }
    });
    plExist.forEach(e => { const k = e.staffId + '|' + e.attendanceMonth; plCounts[k] = (plCounts[k] || 0) + 1; });
  }

  // 5) 串行写入（与 importRecords 同模式）
  const approvedBy = ctx.state.user ? ctx.state.user.username : null;
  const ts = nowMs();
  let created = 0;
  let skipped = 0;
  const batchKeys = new Set();
  for (const r of valid) {
    const p = perfMap.get(r.staffId);
    if (!p) { failed.push({ index: r.index, reason: `人员不存在: ${r.staffId}` }); continue; }
    const key = r.staffId + '|' + r.workDate;
    if (existKeys.has(key) || batchKeys.has(key)) { skipped++; continue; }
    if (r.type === 'PL' && !allowOver) {
      const mk = r.staffId + '|' + r.workDate.substring(0, 7);
      const used = (plCounts[mk] || 0) + 1;
      if (used > 2) {
        failed.push({ index: r.index, reason: `${r.workDate.substring(0, 7)} 事假已达上限（每月不超过2次且累计不超过2天），需团长特批` });
        continue;
      }
      plCounts[mk] = used;
    }
    batchKeys.add(key);
    try {
      await prisma.attendanceV1.create({
        data: {
          id: idByCtx('att', 12, nanoid),
          staffId: r.staffId,
          staffName: p.name,
          attendanceMonth: r.workDate.substring(0, 7),
          attendanceDate: new Date(r.workDate), // 与 create() 口径一致：YYYY-MM-DD 存 UTC 零点
          attendanceType: r.type,
          remark: r.remark,
          approveStatus: 'approved',
          approvedBy,
          ts
        }
      });
      created++;
    } catch (e) {
      failed.push({ index: r.index, reason: '写入失败: ' + ((e && e.message) || e) });
    }
  }
  try { await audit({ ctx, module: 'attendance', action: 'ATTENDANCE_BATCH_ENTRY', detail: { created, skipped, failedCount: failed.length } }); } catch (_) {}
  return success(ctx, { created, skipped, failed });
};

// ========== 打卡参数（v20261012 打卡新规：窗口/基准/迟到罚款/事故分级，存 Setting 表）==========
const getPunchParamsCtrl = async ctx => {
  return success(ctx, await punchParams.getPunchParams());
};

const savePunchParamsCtrl = async ctx => {
  const saved = await punchParams.savePunchParams(ctx.request.body, ctx.state.user ? ctx.state.user.username : null);
  try { await audit({ ctx, module: 'attendance', action: 'PUNCH_PARAMS_UPDATE', targetId: 'punch_params', detail: { params: saved } }); } catch (_) {}
  return success(ctx, saved);
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
  leaveUpdate,
  leaveRemove,
  leaveMakeup,
  leaveMakeupCancel,
  stats,
  importRecords,
  batchPunch,
  batchEntry,
  getPunchParamsCtrl,
  savePunchParamsCtrl,
  toApi
};
