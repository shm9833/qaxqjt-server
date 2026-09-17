'use strict';

/**
 * src/controllers/cast-sheets.js —— 演员表（阵容）CRUD
 * 数据表：CastSheetsV1 + CastSheetCrew（prisma schema 已定义）
 *
 * GET    /v1/cast-sheets          列表（分页+scheduleId+playId+status）
 * GET    /v1/cast-sheets/:id      详情（含 crew 明细）
 * POST   /v1/cast-sheets          新建（含 crew 明细，整体提交）
 * PATCH  /v1/cast-sheets/:id      修改（sheet 字段 + crew 整体替换）
 * DELETE /v1/cast-sheets/:id      删除（级联删 crew）
 *
 * 结构对齐 attendance.js；crew 子资源整体替换策略对齐 orders.js items。
 */
const { nanoid } = require('nanoid');
const prisma = require('../utils/prisma');
const { success, created, pageMeta, noContent } = require('../utils/response');
const { idByCtx, nowMs } = require('../config');
const { BusinessError } = require('../middleware/error-handler');
const { audit } = require('../services/audit-service');

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
  const { skip, take, page, pageSize } = pageMeta(ctx.query.page, ctx.query.pageSize, 0);
  const where = {};
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
  return success(
    ctx,
    rows.map(function (r) {
      var api = toApi(r);
      api.crewCount = r._count ? r._count.crew : 0;
      return api;
    }),
    { ...pageMeta(page, pageSize, total), total }
  );
};

// ========== 详情 ==========
const detail = async ctx => {
  const row = await prisma.castSheetsV1.findUnique({
    where: { id: ctx.params.id },
    include: { crew: { orderBy: { sortOrder: 'asc' } } }
  });
  if (!row) throw new BusinessError('NOT_FOUND', '演员表不存在');
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
  return created(ctx, toApi(result));
};

// ========== 修改 ==========
const update = async ctx => {
  const id = ctx.params.id;
  const b = ctx.request.body || {};
  const exists = await prisma.castSheetsV1.findUnique({ where: { id } });
  if (!exists) throw new BusinessError('NOT_FOUND', '演员表不存在');

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
  if (b.versionNumber != null) data.versionNumber = Number(b.versionNumber);
  if (b.confirmedBy !== undefined) data.confirmedBy = b.confirmedBy || null;
  if (b.confirmedAt) data.confirmedAt = new Date(b.confirmedAt);

  // 置 confirmed 且尚未确认时，自动补 confirmedAt/confirmedBy（对齐 orders.js 状态时间戳策略）
  if (b.status === 'confirmed' && !exists.confirmedAt && !data.confirmedAt) {
    data.confirmedAt = new Date();
    if (data.confirmedBy === undefined || !data.confirmedBy) {
      data.confirmedBy = ctx.state.user ? ctx.state.user.sub || ctx.state.user.username : null;
    }
  }

  const row = await prisma.castSheetsV1.update({ where: { id }, data });

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

  const result = await prisma.castSheetsV1.findUnique({
    where: { id },
    include: { crew: { orderBy: { sortOrder: 'asc' } } }
  });
  return success(ctx, toApi(result));
};

// ========== 删除 ==========
const remove = async ctx => {
  const id = ctx.params.id;
  const exists = await prisma.castSheetsV1.findUnique({ where: { id } });
  if (!exists) throw new BusinessError('NOT_FOUND', '演员表不存在');
  // 级联删除 crew（外键约束）
  await prisma.castSheetCrew.deleteMany({ where: { castSheetId: id } });
  await prisma.castSheetsV1.delete({ where: { id } });
  try {
    await audit({
      ctx,
      module: 'cast-sheet',
      action: 'CAST_SHEET_DELETE',
      targetId: id,
      detail: { sheetNo: exists.sheetNo }
    });
  } catch (_) {}
  return noContent(ctx);
};

module.exports = {
  list,
  detail,
  create,
  update,
  remove,
  toApi,
  crewToApi
};
