'use strict';

/**
 * src/controllers/order-roster.js —— 洛门演出订单花名册 + 批量考勤
 * 数据表：OrderRosterV1（prisma schema 已定义）
 * 能力：
 *   1. 订单级人员明细 CRUD：姓名/身份证(18位校验码)/手机(11位)/角色(字典+自定义)/参演状态
 *   2. 批量录入：Excel/CSV 由前端 xlsx.min.js 解析为 JSON 后 POST /import；亦可 API 直接对接
 *      逐行校验 → 错误行原样返回（index + 原因），不中断整批；按 (orderId,idCardNo) upsert
 *   3. 批量考勤：勾选/全量人员一键更新考勤状态（事务），可带考勤日期与备注
 */
const { nanoid } = require('nanoid');
const prisma = require('../utils/prisma');
const { success, created, noContent, parsePage, pagedSuccess } = require('../utils/response');
const { idByCtx, nowMs } = require('../config');
const { BusinessError } = require('../middleware/error-handler');
const { audit } = require('../services/audit-service');
const { isValidName, isValidMobile, isValidIdCard, normalizeIdCard } = require('../utils/validators');

// ========== 常量 ==========
const IMPORT_LIMIT = 500;

const PERFORM_STATUSES = ['unconfirmed', 'confirmed', 'cancelled', 'completed'];
const PERFORM_STATUS_ALIASES = {
  未确认: 'unconfirmed',
  待确认: 'unconfirmed',
  未参加: 'unconfirmed',
  unconfirmed: 'unconfirmed',
  已确认: 'confirmed',
  确认: 'confirmed',
  confirmed: 'confirmed',
  已取消: 'cancelled',
  取消: 'cancelled',
  cancelled: 'cancelled',
  已完成: 'completed',
  完成: 'completed',
  已参演: 'completed',
  completed: 'completed'
};
const PERFORM_STATUS_TEXT = { unconfirmed: '未确认', confirmed: '已确认', cancelled: '已取消', completed: '已完成' };

const ATTENDANCE_STATUSES = ['present', 'absent', 'late', 'early', 'leave', 'rest'];
const ATTENDANCE_STATUS_ALIASES = {
  出勤: 'present',
  到岗: 'present',
  已考勤: 'present',
  正常: 'present',
  present: 'present',
  缺勤: 'absent',
  旷工: 'absent',
  未到: 'absent',
  absent: 'absent',
  迟到: 'late',
  late: 'late',
  早退: 'early',
  early: 'early',
  请假: 'leave',
  休假: 'leave',
  leave: 'leave',
  公休: 'rest',
  休息: 'rest',
  雨休: 'rest',
  rest: 'rest'
};
const ATTENDANCE_STATUS_TEXT = {
  present: '出勤',
  absent: '缺勤',
  late: '迟到',
  early: '早退',
  leave: '请假',
  rest: '公休'
};

const ROLE_DICT_KEY = 'order_roster_roles';
const DEFAULT_ROLES = [
  '主演',
  '配角',
  '龙套',
  '主持',
  '乐队',
  '舞美',
  '灯光',
  '音响',
  '服装',
  '道具',
  '化妆',
  '剧务',
  '后勤'
];

// ========== 工具 ==========
function toApi(row) {
  if (!row) {
    return null;
  }
  return {
    id: row.id,
    orderId: row.orderId,
    scheduleId: row.scheduleId || '',
    performerId: row.performerId || '',
    name: row.name,
    idCardNo: row.idCardNo,
    phone: row.phone,
    roleName: row.roleName,
    performStatus: row.performStatus || 'unconfirmed',
    performStatusText: PERFORM_STATUS_TEXT[row.performStatus] || row.performStatus,
    attendanceStatus: row.attendanceStatus || '',
    attendanceStatusText: row.attendanceStatus
      ? ATTENDANCE_STATUS_TEXT[row.attendanceStatus] || row.attendanceStatus
      : '',
    attendanceDate: row.attendanceDate ? new Date(row.attendanceDate).toISOString().substring(0, 10) : '',
    attendanceRemark: row.attendanceRemark || '',
    sortOrder: row.sortOrder || 0,
    remark: row.remark || '',
    createdBy: row.createdBy || '',
    createdAt: row.createdAt ? new Date(row.createdAt).toISOString() : '',
    updatedAt: row.updatedAt ? new Date(row.updatedAt).toISOString() : ''
  };
}

function _validDate(s) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(s || ''))) {
    return false;
  }
  const d = new Date(s + 'T00:00:00.000Z');
  return !isNaN(d.getTime()) && d.toISOString().substring(0, 10) === s;
}

async function _assertOrderExists(orderId) {
  const order = await prisma.order.findUnique({ where: { id: orderId }, select: { id: true, orderNo: true } });
  if (!order) {
    throw new BusinessError('NOT_FOUND', `订单不存在: ${orderId}`);
  }
  return order;
}

async function _getRoleDict() {
  const row = await prisma.setting.findUnique({ where: { key: ROLE_DICT_KEY } });
  let custom = [];
  if (row && row.value) {
    try {
      const parsed = JSON.parse(row.value);
      if (Array.isArray(parsed)) {
        custom = parsed.map(r => String(r).trim()).filter(Boolean);
      }
    } catch (_) {
      custom = [];
    }
  }
  // 默认角色 + 自定义角色（去重，保持顺序）
  return Array.from(new Set(DEFAULT_ROLES.concat(custom)));
}

async function _addRolesToDict(newRoles) {
  if (!newRoles || !newRoles.length) {
    return;
  }
  const row = await prisma.setting.findUnique({ where: { key: ROLE_DICT_KEY } });
  let custom = [];
  if (row && row.value) {
    try {
      const p = JSON.parse(row.value);
      if (Array.isArray(p)) {
        custom = p;
      }
    } catch (_) {
      custom = [];
    }
  }
  const known = new Set(DEFAULT_ROLES.concat(custom.map(r => String(r))));
  const merged = custom.map(r => String(r));
  newRoles.forEach(r => {
    if (!known.has(r)) {
      merged.push(r);
    }
  });
  const value = JSON.stringify(merged);
  if (row) {
    await prisma.setting.update({ where: { id: row.id }, data: { value, updatedBy: 'roster_auto', ts: nowMs() } });
  } else {
    await prisma.setting.create({
      data: {
        id: idByCtx('set', 12, nanoid),
        key: ROLE_DICT_KEY,
        value,
        group: 'roster',
        description: '订单花名册角色自定义字典',
        isPublic: false,
        updatedBy: 'sys_init',
        ts: nowMs()
      }
    });
  }
}

// ========== 角色字典 ==========
const rolesList = async ctx => {
  const roles = await _getRoleDict();
  return success(ctx, { roles, defaults: DEFAULT_ROLES });
};

const rolesAdd = async ctx => {
  const name = String((ctx.request.body && ctx.request.body.name) || '').trim();
  if (!name || name.length > 30) {
    throw new BusinessError('VALIDATION_ERROR', '角色名称必填（1-30 字符）');
  }
  const all = await _getRoleDict();
  if (all.includes(name)) {
    return success(ctx, { roles: all });
  }
  await _addRolesToDict([name]);
  try {
    await audit({ ctx, module: 'order-roster', action: 'ROSTER_ROLE_ADD', detail: { name } });
  } catch (_) {
    /* 忽略非关键副作用（如审计/关联回填）失败 */
  }
  return success(ctx, { roles: await _getRoleDict() });
};

// ========== CRUD ==========
const list = async ctx => {
  const orderId = String(ctx.query.orderId || '').trim();
  if (!orderId) {
    throw new BusinessError('VALIDATION_ERROR', 'orderId 必填');
  }
  const { skip, take, page, pageSize } = parsePage(ctx.query);
  const where = { orderId };
  const kw = String(ctx.query.keyword || '').trim();
  if (kw) {
    where.OR = [{ name: { contains: kw } }, { phone: { contains: kw } }, { idCardNo: { contains: kw } }];
  }
  if (ctx.query.performStatus) {
    where.performStatus = ctx.query.performStatus;
  }
  if (ctx.query.attendanceStatus === 'null') {
    where.attendanceStatus = null;
  } else if (ctx.query.attendanceStatus) {
    where.attendanceStatus = ctx.query.attendanceStatus;
  }
  const [rows, total] = await Promise.all([
    prisma.orderRosterV1.findMany({ where, skip, take, orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }] }),
    prisma.orderRosterV1.count({ where })
  ]);
  return pagedSuccess(ctx, rows.map(toApi), total, page, pageSize);
};

const stats = async ctx => {
  const orderId = String(ctx.query.orderId || '').trim();
  if (!orderId) {
    throw new BusinessError('VALIDATION_ERROR', 'orderId 必填');
  }
  const where = { orderId };
  const [total, perfGroups, attGroups, unAttended] = await Promise.all([
    prisma.orderRosterV1.count({ where }),
    prisma.orderRosterV1.groupBy({ by: ['performStatus'], where, _count: true }),
    prisma.orderRosterV1.groupBy({
      by: ['attendanceStatus'],
      where: { ...where, NOT: { attendanceStatus: null } },
      _count: true
    }),
    prisma.orderRosterV1.count({ where: { ...where, attendanceStatus: null } })
  ]);
  const performBreakdown = { unconfirmed: 0, confirmed: 0, cancelled: 0, completed: 0 };
  perfGroups.forEach(g => {
    performBreakdown[g.performStatus] = g._count;
  });
  const attendanceBreakdown = {};
  attGroups.forEach(g => {
    attendanceBreakdown[g.attendanceStatus] = g._count;
  });
  return success(ctx, { orderId, total, performBreakdown, attendanceBreakdown, unAttended });
};

const detail = async ctx => {
  const row = await prisma.orderRosterV1.findUnique({ where: { id: ctx.params.id } });
  if (!row) {
    throw new BusinessError('NOT_FOUND', '花名册记录不存在');
  }
  return success(ctx, toApi(row));
};

function _validatePayload(b) {
  const name = String(b.name || '').trim();
  if (!isValidName(name)) {
    throw new BusinessError('VALIDATION_ERROR', '姓名须为 2-50 个汉字/字母字符');
  }
  const idCardNo = normalizeIdCard(b.idCardNo);
  if (!isValidIdCard(idCardNo)) {
    throw new BusinessError('VALIDATION_ERROR', '身份证号格式非法（需 18 位且校验码正确，GB 11643）');
  }
  const phone = String(b.phone || '').replace(/\s|-/g, '');
  if (!isValidMobile(phone)) {
    throw new BusinessError('VALIDATION_ERROR', '联系方式须为 11 位有效手机号（1 开头）');
  }
  const roleName = String(b.roleName || '').trim();
  if (!roleName || roleName.length > 30) {
    throw new BusinessError('VALIDATION_ERROR', '角色分配必填（≤30 字符，可自定义）');
  }
  const performStatus = b.performStatus ? String(b.performStatus) : 'unconfirmed';
  if (!PERFORM_STATUSES.includes(performStatus)) {
    throw new BusinessError('VALIDATION_ERROR', `参演状态非法: ${performStatus}`);
  }
  let attendanceStatus = null;
  if (b.attendanceStatus) {
    attendanceStatus = String(b.attendanceStatus);
    if (!ATTENDANCE_STATUSES.includes(attendanceStatus)) {
      throw new BusinessError('VALIDATION_ERROR', `考勤状态非法: ${attendanceStatus}`);
    }
  }
  let attendanceDate = null;
  if (b.attendanceDate) {
    if (!_validDate(b.attendanceDate)) {
      throw new BusinessError('VALIDATION_ERROR', `考勤日期非法（需 YYYY-MM-DD）: ${b.attendanceDate}`);
    }
    attendanceDate = new Date(b.attendanceDate + 'T00:00:00.000Z');
  }
  return { name, idCardNo, phone, roleName, performStatus, attendanceStatus, attendanceDate };
}

const create = async ctx => {
  const b = ctx.request.body || {};
  const orderId = String(b.orderId || '').trim();
  if (!orderId) {
    throw new BusinessError('VALIDATION_ERROR', 'orderId 必填');
  }
  await _assertOrderExists(orderId);
  const v = _validatePayload(b);
  const dup = await prisma.orderRosterV1.findUnique({ where: { orderId_idCardNo: { orderId, idCardNo: v.idCardNo } } });
  if (dup) {
    throw new BusinessError('DUPLICATE_KEY', `该订单已存在身份证号 ${v.idCardNo} 的人员：${dup.name}`);
  }
  // 自动关联在册演职人员（身份证优先，手机号兜底）
  let performerId = b.performerId ? String(b.performerId) : null;
  if (!performerId) {
    const perf = await prisma.performersDbV1.findFirst({
      where: { OR: [{ idCardNo: v.idCardNo }, { phone: v.phone }] },
      select: { id: true },
      orderBy: { createdAt: 'desc' }
    });
    if (perf) {
      performerId = perf.id;
    }
  }
  const maxRow = await prisma.orderRosterV1.findFirst({
    where: { orderId },
    orderBy: { sortOrder: 'desc' },
    select: { sortOrder: true }
  });
  const row = await prisma.orderRosterV1.create({
    data: {
      id: idByCtx('roster', 12, nanoid),
      orderId,
      scheduleId: b.scheduleId ? String(b.scheduleId) : null,
      performerId,
      name: v.name,
      idCardNo: v.idCardNo,
      phone: v.phone,
      roleName: v.roleName,
      performStatus: v.performStatus,
      attendanceStatus: v.attendanceStatus,
      attendanceDate: v.attendanceDate,
      attendanceRemark: b.attendanceRemark ? String(b.attendanceRemark).slice(0, 200) : null,
      sortOrder: Number.isInteger(b.sortOrder) ? b.sortOrder : maxRow ? maxRow.sortOrder + 1 : 0,
      remark: b.remark ? String(b.remark).slice(0, 300) : null,
      createdBy: ctx.state.user ? ctx.state.user.username : null,
      ts: nowMs()
    }
  });
  if (!DEFAULT_ROLES.includes(v.roleName)) {
    await _addRolesToDict([v.roleName]).catch(() => {});
  }
  try {
    await audit({
      ctx,
      module: 'order-roster',
      action: 'ROSTER_CREATE',
      targetId: row.id,
      detail: { orderId, name: row.name }
    });
  } catch (_) {
    /* 忽略非关键副作用（如审计/关联回填）失败 */
  }
  return created(ctx, toApi(row));
};

const update = async ctx => {
  const exists = await prisma.orderRosterV1.findUnique({ where: { id: ctx.params.id } });
  if (!exists) {
    throw new BusinessError('NOT_FOUND', '花名册记录不存在');
  }
  const b = ctx.request.body || {};
  // 部分更新：仅在字段提供时校验（合并现有行做整单校验）
  const merged = {
    name: b.name !== undefined ? b.name : exists.name,
    idCardNo: b.idCardNo !== undefined ? b.idCardNo : exists.idCardNo,
    phone: b.phone !== undefined ? b.phone : exists.phone,
    roleName: b.roleName !== undefined ? b.roleName : exists.roleName,
    performStatus: b.performStatus !== undefined ? b.performStatus : exists.performStatus,
    attendanceStatus: b.attendanceStatus !== undefined ? b.attendanceStatus : exists.attendanceStatus,
    attendanceDate:
      b.attendanceDate !== undefined
        ? b.attendanceDate || ''
        : exists.attendanceDate
          ? new Date(exists.attendanceDate).toISOString().substring(0, 10)
          : ''
  };
  const v = _validatePayload(merged);
  if (v.idCardNo !== exists.idCardNo) {
    const dup = await prisma.orderRosterV1.findUnique({
      where: { orderId_idCardNo: { orderId: exists.orderId, idCardNo: v.idCardNo } }
    });
    if (dup && dup.id !== exists.id) {
      throw new BusinessError('DUPLICATE_KEY', `该订单已存在身份证号 ${v.idCardNo} 的人员：${dup.name}`);
    }
  }
  const data = {
    name: v.name,
    idCardNo: v.idCardNo,
    phone: v.phone,
    roleName: v.roleName,
    performStatus: v.performStatus,
    attendanceStatus: v.attendanceStatus,
    attendanceDate: v.attendanceDate,
    ts: nowMs()
  };
  if (b.scheduleId !== undefined) {
    data.scheduleId = b.scheduleId ? String(b.scheduleId) : null;
  }
  if (b.attendanceRemark !== undefined) {
    data.attendanceRemark = b.attendanceRemark ? String(b.attendanceRemark).slice(0, 200) : null;
  }
  if (b.remark !== undefined) {
    data.remark = b.remark ? String(b.remark).slice(0, 300) : null;
  }
  if (b.sortOrder !== undefined && Number.isInteger(b.sortOrder)) {
    data.sortOrder = b.sortOrder;
  }
  const row = await prisma.orderRosterV1.update({ where: { id: ctx.params.id }, data });
  if (!DEFAULT_ROLES.includes(v.roleName)) {
    await _addRolesToDict([v.roleName]).catch(() => {});
  }
  try {
    await audit({
      ctx,
      module: 'order-roster',
      action: 'ROSTER_UPDATE',
      targetId: row.id,
      detail: { orderId: exists.orderId, fields: Object.keys(data) }
    });
  } catch (_) {
    /* 忽略非关键副作用（如审计/关联回填）失败 */
  }
  return success(ctx, toApi(row));
};

const remove = async ctx => {
  const exists = await prisma.orderRosterV1.findUnique({ where: { id: ctx.params.id } });
  if (!exists) {
    throw new BusinessError('NOT_FOUND', '花名册记录不存在');
  }
  await prisma.orderRosterV1.delete({ where: { id: ctx.params.id } });
  try {
    await audit({
      ctx,
      module: 'order-roster',
      action: 'ROSTER_DELETE',
      targetId: ctx.params.id,
      detail: { orderId: exists.orderId, name: exists.name }
    });
  } catch (_) {
    /* 忽略非关键副作用（如审计/关联回填）失败 */
  }
  return noContent(ctx);
};

// ========== 批量导入（Excel/CSV 经前端解析为 JSON；API 可直接对接）==========
// 表头别名：中英兼容
const FIELD_ALIASES = {
  name: ['姓名', '人员姓名', '演职人员', 'name'],
  idCardNo: ['身份证号', '身份证', '证件号', 'idcardno', 'idcard', 'id_card_no'],
  phone: ['手机号', '手机', '联系方式', '联系电话', '电话', 'phone', 'mobile'],
  roleName: ['角色', '角色分配', '分配角色', '行当', '岗位', 'rolename', 'role'],
  performStatus: ['参演状态', '参演确认', '状态', 'performstatus', 'perform_status'],
  attendanceStatus: ['考勤状态', '考勤', 'attendancestatus', 'attendance_status'],
  attendanceDate: ['考勤日期', '出勤日期', 'attendancedate'],
  remark: ['备注', '说明', 'remark', 'note']
};

function _normalizeRow(raw) {
  const out = {};
  if (!raw || typeof raw !== 'object') {
    return out;
  }
  Object.keys(raw).forEach(k => {
    const key = String(k)
      .replace(/^\uFEFF/, '')
      .trim()
      .toLowerCase()
      .replace(/[\s_-]/g, '');
    Object.keys(FIELD_ALIASES).forEach(field => {
      if (out[field] !== undefined) {
        return;
      }
      const hit = FIELD_ALIASES[field].some(a => a.toLowerCase().replace(/[\s_-]/g, '') === key);
      if (hit) {
        out[field] = raw[k];
      }
    });
  });
  return out;
}

const importRoster = async ctx => {
  const b = ctx.request.body || {};
  const orderId = String(b.orderId || '').trim();
  if (!orderId) {
    throw new BusinessError('VALIDATION_ERROR', 'orderId 必填');
  }
  await _assertOrderExists(orderId);
  const items = Array.isArray(b.items) ? b.items : [];
  if (!items.length) {
    throw new BusinessError('VALIDATION_ERROR', 'items 必填（1-500 条）');
  }
  if (items.length > IMPORT_LIMIT) {
    throw new BusinessError(
      'VALIDATION_ERROR',
      `单次最多导入 ${IMPORT_LIMIT} 条（当前 ${items.length} 条），请分批提交`
    );
  }

  // 1) 逐行校验
  const failed = [];
  const valid = [];
  const batchIdCards = new Set();
  const newRoles = new Set();
  items.forEach((rawItem, i) => {
    const it = _normalizeRow(rawItem);
    const name = String(it.name || '').trim();
    const idCardNo = normalizeIdCard(it.idCardNo);
    const phone = String(it.phone || '').replace(/\s|-/g, '');
    const roleName = String(it.roleName || '').trim() || '后勤';
    let performStatus = String(it.performStatus || 'unconfirmed').trim();
    performStatus =
      PERFORM_STATUS_ALIASES[performStatus] || (PERFORM_STATUSES.includes(performStatus) ? performStatus : '');
    let attendanceStatus = null;
    if (
      it.attendanceStatus !== undefined &&
      it.attendanceStatus !== null &&
      String(it.attendanceStatus).trim() !== ''
    ) {
      const raw = String(it.attendanceStatus).trim();
      attendanceStatus = ATTENDANCE_STATUS_ALIASES[raw] || (ATTENDANCE_STATUSES.includes(raw) ? raw : null);
      if (!attendanceStatus) {
        failed.push({ index: i, name, reason: `考勤状态无法识别: ${raw}（出勤/缺勤/迟到/早退/请假/公休）` });
        return;
      }
    }
    let attendanceDate = null;
    if (it.attendanceDate) {
      const d = String(it.attendanceDate).trim().substring(0, 10);
      if (!_validDate(d)) {
        failed.push({ index: i, name, reason: `考勤日期非法: ${it.attendanceDate}` });
        return;
      }
      attendanceDate = d;
    }
    if (!isValidName(name)) {
      failed.push({ index: i, name, reason: '姓名须为 2-50 个汉字/字母字符' });
      return;
    }
    if (!isValidIdCard(idCardNo)) {
      failed.push({ index: i, name, reason: `身份证号格式非法（18位+校验码）: ${it.idCardNo || '(空)'}` });
      return;
    }
    if (!isValidMobile(phone)) {
      failed.push({ index: i, name, reason: `手机号格式非法（11位）: ${it.phone || '(空)'}` });
      return;
    }
    if (!performStatus) {
      failed.push({ index: i, name, reason: `参演状态无法识别: ${it.performStatus}（已确认/未确认/已取消/已完成）` });
      return;
    }
    if (batchIdCards.has(idCardNo)) {
      failed.push({ index: i, name, reason: `批内身份证号重复: ${idCardNo}` });
      return;
    }
    batchIdCards.add(idCardNo);
    if (!DEFAULT_ROLES.includes(roleName)) {
      newRoles.add(roleName);
    }
    valid.push({
      index: i,
      orderId,
      name,
      idCardNo,
      phone,
      roleName,
      performStatus,
      attendanceStatus,
      attendanceDate,
      remark:
        String(it.remark || '')
          .trim()
          .slice(0, 300) || null
    });
  });

  // 2) 自动关联在册演职人员
  const perfByIdCard = {};
  const perfByPhone = {};
  if (valid.length) {
    const perfs = await prisma.performersDbV1.findMany({
      where: {
        OR: [
          { idCardNo: { in: Array.from(new Set(valid.map(v => v.idCardNo))) } },
          { phone: { in: Array.from(new Set(valid.map(v => v.phone))) } }
        ]
      },
      select: { id: true, idCardNo: true, phone: true }
    });
    perfs.forEach(p => {
      if (p.idCardNo) {
        perfByIdCard[p.idCardNo] = p.id;
      }
      if (p.phone) {
        perfByPhone[p.phone] = p.id;
      }
    });
  }

  // 3) upsert（同订单同身份证 → 更新；否则新建）
  const existed = await prisma.orderRosterV1.findMany({
    where: { orderId, idCardNo: { in: Array.from(batchIdCards) } },
    select: { id: true, idCardNo: true }
  });
  const existMap = {};
  existed.forEach(e => {
    existMap[e.idCardNo] = e.id;
  });

  let created = 0;
  let updated = 0;
  const username = ctx.state.user ? ctx.state.user.username : null;
  for (const v of valid) {
    const performerId = perfByIdCard[v.idCardNo] || perfByPhone[v.phone] || null;
    const baseData = {
      orderId: v.orderId,
      performerId,
      name: v.name,
      idCardNo: v.idCardNo,
      phone: v.phone,
      roleName: v.roleName,
      performStatus: v.performStatus,
      attendanceStatus: v.attendanceStatus,
      attendanceDate: v.attendanceDate ? new Date(v.attendanceDate + 'T00:00:00.000Z') : null,
      remark: v.remark,
      ts: nowMs()
    };
    try {
      if (existMap[v.idCardNo]) {
        await prisma.orderRosterV1.update({ where: { id: existMap[v.idCardNo] }, data: baseData });
        updated += 1;
      } else {
        await prisma.orderRosterV1.create({
          data: {
            id: idByCtx('roster', 12, nanoid),
            ...baseData,
            sortOrder: created + updated,
            createdBy: username
          }
        });
        created += 1;
      }
    } catch (e) {
      failed.push({ index: v.index, name: v.name, reason: '写入失败: ' + ((e && e.message) || e) });
    }
  }
  if (newRoles.size) {
    await _addRolesToDict(Array.from(newRoles)).catch(() => {});
  }
  try {
    await audit({
      ctx,
      module: 'order-roster',
      action: 'ROSTER_IMPORT',
      detail: { orderId, total: items.length, created, updated, failedCount: failed.length }
    });
  } catch (_) {
    /* 忽略非关键副作用（如审计/关联回填）失败 */
  }
  return success(ctx, { total: items.length, created, updated, failedCount: failed.length, failed });
};

// ========== 批量考勤 ==========
const batchAttendance = async ctx => {
  const b = ctx.request.body || {};
  const orderId = String(b.orderId || '').trim();
  const status = b.attendanceStatus ? String(b.attendanceStatus) : '';
  if (!ATTENDANCE_STATUSES.includes(status)) {
    throw new BusinessError(
      'VALIDATION_ERROR',
      `考勤状态非法: ${status || '(空)'}（${ATTENDANCE_STATUSES.join('/')}）`
    );
  }
  let attendanceDate = null;
  if (b.attendanceDate) {
    if (!_validDate(b.attendanceDate)) {
      throw new BusinessError('VALIDATION_ERROR', `考勤日期非法（需 YYYY-MM-DD）: ${b.attendanceDate}`);
    }
    attendanceDate = new Date(b.attendanceDate + 'T00:00:00.000Z');
  }
  const ids = Array.isArray(b.ids) ? b.ids.map(String) : [];
  // scope 三选一：勾选 ids > 全订单 orderId > 按参演状态过滤（performStatusIn）
  const where = {};
  if (ids.length) {
    where.id = { in: ids };
  } else if (orderId) {
    where.orderId = orderId;
    if (Array.isArray(b.performStatusIn) && b.performStatusIn.length) {
      where.performStatus = { in: b.performStatusIn };
    }
  } else {
    throw new BusinessError('VALIDATION_ERROR', '必须提供 ids（勾选人员）或 orderId（整单）');
  }
  const targets = await prisma.orderRosterV1.findMany({ where, select: { id: true } });
  if (!targets.length) {
    throw new BusinessError('VALIDATION_ERROR', '没有匹配的花名册人员可更新');
  }
  // 事务更新：全部成功或全部回滚，保证一致性
  const data = {
    attendanceStatus: status,
    attendanceDate,
    attendanceRemark: b.remark ? String(b.remark).slice(0, 200) : null,
    ts: nowMs()
  };
  await prisma.$transaction(targets.map(t => prisma.orderRosterV1.update({ where: { id: t.id }, data })));
  try {
    await audit({
      ctx,
      module: 'order-roster',
      action: 'ROSTER_BATCH_ATTENDANCE',
      detail: { orderId: orderId || null, ids: ids.length, count: targets.length, status }
    });
  } catch (_) {
    /* 忽略非关键副作用（如审计/关联回填）失败 */
  }
  return success(ctx, { updated: targets.length, attendanceStatus: status });
};

module.exports = {
  list,
  stats,
  detail,
  create,
  update,
  remove,
  importRoster,
  batchAttendance,
  rolesList,
  rolesAdd,
  toApi,
  // 导出供测试
  _normalizeRow,
  _validatePayload,
  PERFORM_STATUSES,
  ATTENDANCE_STATUSES,
  PERFORM_STATUS_ALIASES,
  ATTENDANCE_STATUS_ALIASES,
  DEFAULT_ROLES,
  ROLE_DICT_KEY
};
