'use strict';

/**
 * src/controllers/cast-sheets.js —— 演员表（阵容）CRUD
 * 数据表：CastSheetsV1 + CastSheetCrew（prisma schema 已定义）
 *
 * GET    /v1/cast-sheets                    列表（分页+scheduleId+playId+status，排除已软删除）
 * GET    /v1/cast-sheets/:id                详情（含 crew 明细）
 * POST   /v1/cast-sheets                    新建（含 crew 明细，整体提交）
 * PATCH  /v1/cast-sheets/:id                修改（sheet 字段 + crew 整体替换，写版本快照）
 * DELETE /v1/cast-sheets/:id                删除（软删除，保留 crew 与版本痕迹）
 * POST   /v1/cast-sheets/:id/visibility     一键公开/暂停公开
 * GET    /v1/cast-sheets/:id/versions       版本历史列表
 * GET    /v1/cast-sheets/:id/versions/:vid  版本快照明细
 * POST   /v1/cast-sheets/:id/versions/:vid/rollback  回滚至指定版本
 *
 * 权限：仅「阵容创建者或管理员(super_admin/admin)」可执行 改/删/公开切换/版本操作。
 * 结构对齐 attendance.js；crew 子资源整体替换策略对齐 orders.js items。
 */
const { nanoid } = require('nanoid');
const prisma = require('../utils/prisma');
const { success, created, noContent, parsePage, pagedSuccess } = require('../utils/response');
const { idByCtx, nowMs } = require('../config');
const { BusinessError } = require('../middleware/error-handler');
const { audit } = require('../services/audit-service');

// ========== 权限：仅创建者或管理员可操作 ==========
const ADMIN_ROLES = ['super_admin', 'admin'];

function _actorId(ctx) {
  const u = ctx.state && ctx.state.user;
  return u ? u.sub || u.username || '' : '';
}

function _isAdmin(ctx) {
  const u = ctx.state && ctx.state.user;
  return !!u && ADMIN_ROLES.indexOf(u.role) >= 0;
}

// 仅阵容创建者或管理员可执行；否则 FORBIDDEN
function _assertCanOperate(ctx, sheet) {
  if (_isAdmin(ctx)) return;
  const actor = _actorId(ctx);
  const owner = sheet && sheet.createdBy;
  if (owner && actor && owner === actor) return;
  throw new BusinessError('FORBIDDEN', '仅阵容创建者或管理员可执行此操作');
}

// ========== 版本快照工具 ==========
function _changeTypeOfStatus(status) {
  if (status === 'draft') return 'save_draft';
  if (status === 'confirmed') return 'republish';
  return 'update';
}

// 写一条版本快照（row 需带 crew 明细，快照结构 = toApi 输出）
async function _writeVersion(row, changeType, note, ctx) {
  if (!row) return;
  const api = toApi(row);
  await prisma.castSheetVersions.create({
    data: {
      id: idByCtx('castSheetVer', 12, nanoid),
      castSheetId: api.id,
      versionNumber: api.versionNumber != null ? Number(api.versionNumber) : 1,
      changeType: changeType,
      snapshotJson: JSON.stringify(api),
      note: note || null,
      createdBy: _actorId(ctx) || null,
      ts: BigInt(nowMs())
    }
  });
}

function _fetchFull(id) {
  return prisma.castSheetsV1.findUnique({
    where: { id },
    include: { crew: { orderBy: { sortOrder: 'asc' } } }
  });
}

// ========== 工具：生成 sheetNo（CS + YYMMDDHHmm + 4 位随机）==========
function _genSheetNo() {
  const d = new Date();
  const pad = n => String(n).padStart(2, '0');
  return (
    'CS' +
    String(d.getFullYear()).slice(2) +
    pad(d.getMonth() + 1) +
    pad(d.getDate()) +
    pad(d.getHours()) +
    pad(d.getMinutes()) +
    nanoid(4).toUpperCase()
  );
}

function _statusText(s) {
  var map = {
    draft: '草稿',
    confirmed: '已确认',
    locked: '已锁定',
    archived: '已归档'
  };
  return map[s] || s || '草稿';
}

function _categoryText(c) {
  var map = {
    主演: '主演',
    配角: '配角',
    龙套: '龙套',
    乐队: '乐队',
    舞美: '舞美',
    灯光: '灯光',
    服装: '服装',
    道具: '道具',
    化妆: '化妆'
  };
  return map[c] || c || '';
}

// ========== 工具：DB CastSheetCrew -> 前端字段 ==========
function crewToApi(row) {
  if (!row) return null;
  return {
    id: row.id,
    castSheetId: row.castSheetId,
    performerId: row.performerId || '',
    performerName: row.performerName || '',
    category: row.category || '',
    categoryText: _categoryText(row.category),
    roleName: row.roleName || '',
    sortOrder: row.sortOrder != null ? Number(row.sortOrder) : 0,
    attendanceType: row.attendanceType || '',
    wageAmount: row.wageAmount != null ? Number(row.wageAmount) : 0,
    note: row.note || '',
    createdAt: row.createdAt ? new Date(row.createdAt).toISOString() : ''
  };
}

// ========== 工具：DB CastSheetsV1 -> 前端字段 ==========
function toApi(row) {
  if (!row) return null;
  return {
    id: row.id,
    sheetNo: row.sheetNo || '',
    scheduleId: row.scheduleId || '',
    status: row.status || 'draft',
    statusText: _statusText(row.status),
    lockFlag: !!row.lockFlag,
    playId: row.playId || '',
    playTitle: row.playTitle || '',
    performanceDate: row.performanceDate
      ? new Date(row.performanceDate).toISOString().substring(0, 10)
      : '',
    performanceTime: row.performanceTime || '',
    venueFull: row.venueFull || '',
    directorName: row.directorName || '',
    conductorName: row.conductorName || '',
    stageManagerName: row.stageManagerName || '',
    crewNote: row.crewNote || '',
    versionNumber: row.versionNumber != null ? Number(row.versionNumber) : 1,
    confirmedBy: row.confirmedBy || '',
    confirmedAt: row.confirmedAt ? new Date(row.confirmedAt).toISOString() : '',
    createdBy: row.createdBy || '',
    createdAt: row.createdAt ? new Date(row.createdAt).toISOString() : '',
    updatedAt: row.updatedAt ? new Date(row.updatedAt).toISOString() : '',
    crew: Array.isArray(row.crew) ? row.crew.map(crewToApi) : []
  };
}

// ========== 工具：crew 数组 -> createMany data ==========
function _crewCreateData(items, castSheetId) {
  return items.map(function (c, idx) {
    return {
      id: c.id || idByCtx('castCrew', 12, nanoid),
      castSheetId: castSheetId,
      performerId: c.performerId || null,
      performerName: c.performerName || '',
      category: c.category || '龙套',
      roleName: c.roleName || null,
      sortOrder: c.sortOrder != null ? Number(c.sortOrder) : idx,
      attendanceType: c.attendanceType || null,
      wageAmount: c.wageAmount != null ? Number(c.wageAmount) : null,
      note: c.note || null,
      ts: BigInt(nowMs())
    };
  });
}

// ========== 列表 ==========
const list = async ctx => {
  const { skip, take, page, pageSize } = parsePage(ctx.query);
  const where = { deletedAt: null };
  if (ctx.query.scheduleId) where.scheduleId = ctx.query.scheduleId;
  if (ctx.query.playId) where.playId = ctx.query.playId;
  if (ctx.query.status) where.status = ctx.query.status;
  const [rows, total] = await Promise.all([
    prisma.castSheetsV1.findMany({
      where,
      skip,
      take,
      orderBy: { performanceDate: 'desc' },
      include: { _count: { select: { crew: true } } }
    }),
    prisma.castSheetsV1.count({ where })
  ]);
  return pagedSuccess(
    ctx,
    rows.map(function (r) {
      var api = toApi(r);
      api.crewCount = r._count ? r._count.crew : 0;
      return api;
    }),
    total, page, pageSize
  );
};

// ========== 详情 ==========
const detail = async ctx => {
  const row = await _fetchFull(ctx.params.id);
  if (!row || row.deletedAt) throw new BusinessError('NOT_FOUND', '演员表不存在');
  return success(ctx, toApi(row));
};

// ========== 新建 ==========
const create = async ctx => {
  const b = ctx.request.body || {};
  if (!b.scheduleId) throw new BusinessError('VALIDATION_ERROR', 'scheduleId 必填');
  const sheetId = b.id || idByCtx('castSheet', 12, nanoid);
  const sheetNo = b.sheetNo || _genSheetNo();
  const data = {
    id: sheetId,
    sheetNo: sheetNo,
    scheduleId: b.scheduleId,
    status: b.status || 'draft',
    lockFlag: !!b.lockFlag,
    playId: b.playId || null,
    playTitle: b.playTitle || null,
    performanceDate: b.performanceDate ? new Date(b.performanceDate) : new Date(),
    performanceTime: b.performanceTime || null,
    venueFull: b.venueFull || null,
    directorName: b.directorName || null,
    conductorName: b.conductorName || null,
    stageManagerName: b.stageManagerName || null,
    crewNote: b.crewNote || null,
    versionNumber: b.versionNumber != null ? Number(b.versionNumber) : 1,
    confirmedBy: b.confirmedBy || null,
    confirmedAt: b.confirmedAt ? new Date(b.confirmedAt) : null,
    createdBy: ctx.state.user ? ctx.state.user.sub || ctx.state.user.username : null,
    ts: BigInt(nowMs())
  };
  const row = await prisma.castSheetsV1.create({ data });

  // crew 明细整体写入
  if (Array.isArray(b.crew) && b.crew.length) {
    await prisma.castSheetCrew.createMany({ data: _crewCreateData(b.crew, sheetId) });
  }

  try {
    await audit({
      ctx,
      module: 'cast-sheet',
      action: 'CAST_SHEET_CREATE',
      targetId: sheetId,
      detail: {
        sheetNo: sheetNo,
        scheduleId: b.scheduleId,
        crewCount: Array.isArray(b.crew) ? b.crew.length : 0
      }
    });
  } catch (_) {}

  const result = await prisma.castSheetsV1.findUnique({
    where: { id: sheetId },
    include: { crew: { orderBy: { sortOrder: 'asc' } } }
  });
  try { await _writeVersion(result, 'create', '新建阵容', ctx); } catch (_) {}
  return created(ctx, toApi(result));
};

// ========== 修改 ==========
const update = async ctx => {
  const id = ctx.params.id;
  const b = ctx.request.body || {};
  const exists = await prisma.castSheetsV1.findUnique({ where: { id } });
  if (!exists || exists.deletedAt) throw new BusinessError('NOT_FOUND', '演员表不存在');
  _assertCanOperate(ctx, exists);

  const data = { ts: BigInt(nowMs()) };
  if (b.status) data.status = b.status;
  if (b.lockFlag !== undefined) data.lockFlag = !!b.lockFlag;
  if (b.playId !== undefined) data.playId = b.playId || null;
  if (b.playTitle !== undefined) data.playTitle = b.playTitle || null;
  if (b.performanceDate) data.performanceDate = new Date(b.performanceDate);
  if (b.performanceTime !== undefined) data.performanceTime = b.performanceTime || null;
  if (b.venueFull !== undefined) data.venueFull = b.venueFull || null;
  if (b.directorName !== undefined) data.directorName = b.directorName || null;
  if (b.conductorName !== undefined) data.conductorName = b.conductorName || null;
  if (b.stageManagerName !== undefined) data.stageManagerName = b.stageManagerName || null;
  if (b.crewNote !== undefined) data.crewNote = b.crewNote || null;
  if (b.confirmedBy !== undefined) data.confirmedBy = b.confirmedBy || null;
  if (b.confirmedAt) data.confirmedAt = new Date(b.confirmedAt);

  // 内容有实质变更 → 版本号自增（客户端显式传 versionNumber 时以客户端为准）
  const touched =
    ['status', 'lockFlag', 'playId', 'playTitle', 'performanceDate', 'performanceTime',
      'venueFull', 'directorName', 'conductorName', 'stageManagerName', 'crewNote'
    ].some(function (k) { return b[k] !== undefined; }) || Array.isArray(b.crew);
  if (b.versionNumber != null) data.versionNumber = Number(b.versionNumber);
  else if (touched) data.versionNumber = { increment: 1 };

  // 置 confirmed 且尚未确认时，自动补 confirmedAt/confirmedBy（对齐 orders.js 状态时间戳策略）
  if (b.status === 'confirmed' && !exists.confirmedAt && !data.confirmedAt) {
    data.confirmedAt = new Date();
    if (data.confirmedBy === undefined || !data.confirmedBy) {
      data.confirmedBy = ctx.state.user ? ctx.state.user.sub || ctx.state.user.username : null;
    }
  }

  await prisma.castSheetsV1.update({ where: { id }, data });

  // crew 整体替换（与 orders.js items 同策略：先删后建）
  if (Array.isArray(b.crew)) {
    await prisma.castSheetCrew.deleteMany({ where: { castSheetId: id } });
    if (b.crew.length) {
      await prisma.castSheetCrew.createMany({ data: _crewCreateData(b.crew, id) });
    }
  }

  try {
    await audit({
      ctx,
      module: 'cast-sheet',
      action: 'CAST_SHEET_UPDATE',
      targetId: id,
      detail: {
        from: exists.status,
        to: data.status || exists.status,
        crewReplaced: Array.isArray(b.crew)
      }
    });
  } catch (_) {}

  const result = await _fetchFull(id);
  // 保存为草稿 / 重新发布 / 普通修改，各写一条版本快照
  try { await _writeVersion(result, _changeTypeOfStatus(result.status), '修改阵容', ctx); } catch (_) {}
  return success(ctx, toApi(result));
};

// ========== 删除（软删除）==========
const remove = async ctx => {
  const id = ctx.params.id;
  const exists = await prisma.castSheetsV1.findUnique({ where: { id } });
  if (!exists || exists.deletedAt) throw new BusinessError('NOT_FOUND', '演员表不存在');
  _assertCanOperate(ctx, exists);

  // 关联校验：被排期引用的阵容禁止删除，避免破坏已关联业务数据
  const refCount = await prisma.scheduleV2.count({ where: { castSheetId: id } });
  if (refCount > 0) {
    throw new BusinessError('CONFLICT', '该阵容已被排期关联，请先解除关联后再删除');
  }

  // 软删除：保留 crew 明细与版本痕迹，便于追溯/恢复
  await prisma.castSheetsV1.update({
    where: { id },
    data: { deletedAt: new Date(), deletedBy: _actorId(ctx) || null, ts: BigInt(nowMs()) }
  });

  const full = await _fetchFull(id);
  try { await _writeVersion(full, 'delete', '软删除阵容', ctx); } catch (_) {}
  try {
    await audit({
      ctx,
      module: 'cast-sheet',
      action: 'CAST_SHEET_SOFT_DELETE',
      targetId: id,
      detail: { sheetNo: exists.sheetNo }
    });
  } catch (_) {}
  return noContent(ctx);
};

// ========== 一键公开 / 暂停公开 ==========
const setVisibility = async ctx => {
  const id = ctx.params.id;
  const b = ctx.request.body || {};
  if (typeof b.public !== 'boolean') {
    throw new BusinessError('VALIDATION_ERROR', 'public 必填且为布尔值');
  }
  const exists = await prisma.castSheetsV1.findUnique({ where: { id } });
  if (!exists || exists.deletedAt) throw new BusinessError('NOT_FOUND', '演员表不存在');
  _assertCanOperate(ctx, exists);

  const isPublicNow = exists.status === 'confirmed' || exists.status === 'locked';
  // 幂等：目标状态与当前一致 → 原样返回，不重复写版本
  if (b.public === isPublicNow) {
    return success(ctx, toApi(await _fetchFull(id)));
  }

  const data = {
    status: b.public ? 'confirmed' : 'draft',
    versionNumber: { increment: 1 },
    ts: BigInt(nowMs())
  };
  if (b.public) {
    data.confirmedAt = exists.confirmedAt || new Date();
    data.confirmedBy = exists.confirmedBy || _actorId(ctx) || null;
  }
  await prisma.castSheetsV1.update({ where: { id }, data });

  const result = await _fetchFull(id);
  const note = b.public ? '恢复公开' : '暂停公开';
  try { await _writeVersion(result, b.public ? 'republish' : 'unpublish', note, ctx); } catch (_) {}
  try {
    await audit({
      ctx,
      module: 'cast-sheet',
      action: b.public ? 'CAST_SHEET_PUBLISH' : 'CAST_SHEET_UNPUBLISH',
      targetId: id,
      detail: { from: exists.status, to: data.status, sheetNo: exists.sheetNo }
    });
  } catch (_) {}
  return success(ctx, toApi(result));
};

// ========== 版本历史列表 ==========
const listVersions = async ctx => {
  const id = ctx.params.id;
  const exists = await prisma.castSheetsV1.findUnique({ where: { id } });
  if (!exists) throw new BusinessError('NOT_FOUND', '演员表不存在');
  _assertCanOperate(ctx, exists);
  const rows = await prisma.castSheetVersions.findMany({
    where: { castSheetId: id },
    orderBy: { createdAt: 'desc' }
  });
  return success(ctx, rows.map(function (v) {
    return {
      id: v.id,
      castSheetId: v.castSheetId,
      versionNumber: Number(v.versionNumber),
      changeType: v.changeType,
      note: v.note || '',
      createdBy: v.createdBy || '',
      createdAt: v.createdAt ? new Date(v.createdAt).toISOString() : ''
    };
  }));
};

// ========== 版本快照明细 ==========
const getVersion = async ctx => {
  const id = ctx.params.id;
  const vid = ctx.params.vid;
  const exists = await prisma.castSheetsV1.findUnique({ where: { id } });
  if (!exists) throw new BusinessError('NOT_FOUND', '演员表不存在');
  _assertCanOperate(ctx, exists);
  const v = await prisma.castSheetVersions.findUnique({ where: { id: vid } });
  if (!v || v.castSheetId !== id) throw new BusinessError('NOT_FOUND', '版本记录不存在');
  let snapshot = null;
  try { snapshot = JSON.parse(v.snapshotJson); } catch (_) {}
  return success(ctx, {
    id: v.id,
    castSheetId: v.castSheetId,
    versionNumber: Number(v.versionNumber),
    changeType: v.changeType,
    note: v.note || '',
    createdBy: v.createdBy || '',
    createdAt: v.createdAt ? new Date(v.createdAt).toISOString() : '',
    snapshot: snapshot
  });
};

// ========== 回滚至指定版本 ==========
const rollback = async ctx => {
  const id = ctx.params.id;
  const vid = ctx.params.vid;
  const exists = await prisma.castSheetsV1.findUnique({ where: { id } });
  if (!exists || exists.deletedAt) throw new BusinessError('NOT_FOUND', '演员表不存在');
  _assertCanOperate(ctx, exists);

  const v = await prisma.castSheetVersions.findUnique({ where: { id: vid } });
  if (!v || v.castSheetId !== id) throw new BusinessError('NOT_FOUND', '版本记录不存在');

  let snap = null;
  try { snap = JSON.parse(v.snapshotJson); } catch (_) {}
  if (!snap) throw new BusinessError('VALIDATION_ERROR', '版本快照不可解析');

  // 回滚前先存当前状态，便于再次回退
  const before = await _fetchFull(id);
  try { await _writeVersion(before, 'rollback', '回滚前快照', ctx); } catch (_) {}

  const data = {
    status: snap.status || exists.status,
    lockFlag: !!snap.lockFlag,
    playId: snap.playId || null,
    playTitle: snap.playTitle || null,
    performanceTime: snap.performanceTime || null,
    venueFull: snap.venueFull || null,
    directorName: snap.directorName || null,
    conductorName: snap.conductorName || null,
    stageManagerName: snap.stageManagerName || null,
    crewNote: snap.crewNote || null,
    versionNumber: { increment: 1 },
    ts: BigInt(nowMs())
  };
  if (snap.performanceDate) data.performanceDate = new Date(snap.performanceDate);
  await prisma.castSheetsV1.update({ where: { id }, data });

  // crew 明细按快照重建
  await prisma.castSheetCrew.deleteMany({ where: { castSheetId: id } });
  if (Array.isArray(snap.crew) && snap.crew.length) {
    await prisma.castSheetCrew.createMany({ data: _crewCreateData(snap.crew, id) });
  }

  const result = await _fetchFull(id);
  try { await _writeVersion(result, 'rollback', '回滚至 v' + Number(v.versionNumber), ctx); } catch (_) {}
  try {
    await audit({
      ctx,
      module: 'cast-sheet',
      action: 'CAST_SHEET_ROLLBACK',
      targetId: id,
      detail: { toVersion: Number(v.versionNumber) }
    });
  } catch (_) {}
  return success(ctx, toApi(result));
};

module.exports = {
  list,
  detail,
  create,
  update,
  remove,
  setVisibility,
  listVersions,
  getVersion,
  rollback,
  toApi,
  crewToApi
};
