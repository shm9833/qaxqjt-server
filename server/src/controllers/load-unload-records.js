/* load-unload-records.js — 装卸车登记 CRUD（v20261028f）
 * 数据表：LoadUnloadRecordV1（prisma schema 已定义）
 *
 * 业务口径（用户确认）：
 *   - 逐条手工登记：每次装车/卸车记录一条（performerId + recordDate + recordType 唯一）
 *   - attend=true 参加（不扣款）；attend=false 缺席（计一次缺席）
 *   - 工资扣款 = 缺席次数 × 人员 loadUnloadDeduct 单价，不论场次
 *   - 登记/修改/删除后自动同步覆盖日期的草稿批次工资（仅草稿，已确认/过账不动）
 *
 * GET    /v1/load-unload-records              列表（分页+performerId+month+recordType）
 * GET    /v1/load-unload-records/:id          详情
 * POST   /v1/load-unload-records              新建（重复同日同类型 → 409）
 * PATCH  /v1/load-unload-records/:id          修改
 * DELETE /v1/load-unload-records/:id          删除
 */
'use strict';
const { nanoid } = require('nanoid');
const prisma = require('../utils/prisma');
const { success, created, noContent } = require('../utils/response');
const { idByCtx, nowMs } = require('../config');
const { BusinessError } = require('../middleware/error-handler');
const { audit } = require('../services/audit-service');
const { syncDraftWageForPerformer } = require('./wages/helpers');

const RECORD_TYPES = ['load', 'unload'];

// 同人员同日同类型防重（唯一约束前置校验，给出友好提示）
async function _assertNoDup(performerId, recordDateStr, recordType, excludeId) {
  const dayStart = new Date(recordDateStr + 'T00:00:00.000Z');
  const dayEnd = new Date(dayStart.getTime() + 86400000);
  const dup = await prisma.loadUnloadRecordV1.findFirst({
    where: {
      performerId,
      recordDate: { gte: dayStart, lt: dayEnd },
      recordType,
      ...(excludeId ? { id: { not: excludeId } } : {})
    },
    orderBy: { createdAt: 'desc' }
  });
  if (dup) {
    throw new BusinessError('CONFLICT', `该员工 ${recordDateStr} 的${recordType === 'unload' ? '卸车' : '装车'}记录已存在（${dup.attend ? '参加' : '缺席'}），请直接修改该条记录`);
  }
}

// 批量取人员（姓名冗余兜底 + 返回单价供前端展示）
async function _performerMap(ids) {
  const uniq = [...new Set(ids.filter(Boolean))];
  if (!uniq.length) return {};
  const rows = await prisma.performersDbV1.findMany({
    where: { id: { in: uniq } },
    select: { id: true, name: true, staffNo: true, loadUnloadDeduct: true }
  });
  const map = {};
  for (const p of rows) {
    map[p.id] = { name: p.name || '', staffNo: p.staffNo || '', loadUnloadDeduct: Number(p.loadUnloadDeduct) || 0 };
  }
  return map;
}

function _toApi(row, pmap) {
  if (!row) return null;
  const p = (pmap && pmap[row.performerId]) || {};
  return {
    id: row.id,
    performerId: row.performerId,
    performerName: row.performerName || p.name || '',
    staffNo: p.staffNo || '',
    loadUnloadDeduct: p.loadUnloadDeduct || 0,
    recordDate: row.recordDate ? new Date(row.recordDate).toISOString().substring(0, 10) : '',
    recordType: row.recordType,
    attend: !!row.attend,
    remark: row.remark || '',
    createdBy: row.createdBy || '',
    createdAt: row.createdAt ? new Date(row.createdAt).toISOString() : '',
    updatedAt: row.updatedAt ? new Date(row.updatedAt).toISOString() : ''
  };
}

// 列表（分页+过滤）
const list = async ctx => {
  const q = ctx.query || {};
  const page = Math.max(1, Number(q.page) || 1);
  const pageSize = Math.min(200, Math.max(1, Number(q.pageSize) || 20));
  const where = {};
  if (q.performerId) where.performerId = q.performerId;
  if (q.recordType) where.recordType = q.recordType;
  if (q.attend === 'true') where.attend = true;
  if (q.attend === 'false') where.attend = false;
  if (q.month && /^\d{4}-\d{2}$/.test(q.month)) {
    const y = Number(q.month.substring(0, 4)), m = Number(q.month.substring(5, 7));
    where.recordDate = { gte: new Date(Date.UTC(y, m - 1, 1)), lt: new Date(Date.UTC(y, m, 1)) };
  }
  const [total, rows] = await Promise.all([
    prisma.loadUnloadRecordV1.count({ where }),
    prisma.loadUnloadRecordV1.findMany({
      where,
      orderBy: [{ recordDate: 'desc' }, { createdAt: 'desc' }],
      skip: (page - 1) * pageSize,
      take: pageSize
    })
  ]);
  const pmap = await _performerMap(rows.map(r => r.performerId));
  return success(ctx, {
    list: rows.map(r => _toApi(r, pmap)),
    total,
    page,
    pageSize
  });
};

// 详情
const detail = async ctx => {
  const row = await prisma.loadUnloadRecordV1.findUnique({ where: { id: ctx.params.id } });
  if (!row) throw new BusinessError('NOT_FOUND', '装卸车记录不存在');
  const pmap = await _performerMap([row.performerId]);
  return success(ctx, _toApi(row, pmap));
};

// 新建
const create = async ctx => {
  const b = ctx.request.body;
  if (!b.performerId) throw new BusinessError('VALIDATION_ERROR', 'performerId 必填');
  if (RECORD_TYPES.indexOf(b.recordType) < 0) throw new BusinessError('VALIDATION_ERROR', 'recordType 必须为 load（装车）或 unload（卸车）');
  const dateStr = b.recordDate ? String(b.recordDate).substring(0, 10) : new Date().toISOString().substring(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) throw new BusinessError('VALIDATION_ERROR', 'recordDate 格式应为 YYYY-MM-DD');

  const perf = await prisma.performersDbV1.findUnique({
    where: { id: b.performerId },
    select: { name: true }
  });
  if (!perf) throw new BusinessError('NOT_FOUND', '人员不存在');

  await _assertNoDup(b.performerId, dateStr, b.recordType, null);

  const u = (ctx.state && ctx.state.user) || {};
  const data = {
    id: b.id || idByCtx('lu', 12, nanoid),
    performerId: b.performerId,
    performerName: perf.name,
    recordDate: new Date(dateStr + 'T00:00:00.000Z'),
    recordType: b.recordType,
    attend: b.attend === undefined ? true : !!b.attend,
    remark: b.remark || '',
    createdBy: u.username || u.name || '',
    ts: BigInt(nowMs())
  };
  const row = await prisma.loadUnloadRecordV1.create({ data });
  try { await audit({ ctx, module: 'load_unload', action: 'LU_CREATE', targetId: row.id, detail: { performerName: perf.name, recordDate: dateStr, recordType: row.recordType, attend: row.attend } }); } catch (_) {}
  // 自动同步覆盖日期的草稿批次（缺席记录影响扣款）
  try { await syncDraftWageForPerformer(b.performerId, dateStr); } catch (_) {}
  const pmap = await _performerMap([row.performerId]);
  return created(ctx, _toApi(row, pmap));
};

// 修改
const update = async ctx => {
  const b = ctx.request.body;
  const exists = await prisma.loadUnloadRecordV1.findUnique({ where: { id: ctx.params.id } });
  if (!exists) throw new BusinessError('NOT_FOUND', '装卸车记录不存在');

  const data = {};
  if (b.recordType !== undefined) {
    if (RECORD_TYPES.indexOf(b.recordType) < 0) throw new BusinessError('VALIDATION_ERROR', 'recordType 必须为 load 或 unload');
    data.recordType = b.recordType;
  }
  if (b.attend !== undefined) data.attend = !!b.attend;
  if (b.remark !== undefined) data.remark = b.remark;
  if (b.recordDate !== undefined) {
    const dateStr = b.recordDate ? String(b.recordDate).substring(0, 10) : '';
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) throw new BusinessError('VALIDATION_ERROR', 'recordDate 格式应为 YYYY-MM-DD');
    data.recordDate = new Date(dateStr + 'T00:00:00.000Z');
  }

  const newType = data.recordType || exists.recordType;
  const newDateStr = data.recordDate
    ? new Date(data.recordDate).toISOString().substring(0, 10)
    : new Date(exists.recordDate).toISOString().substring(0, 10);
  // 人员/日期/类型任一变动时防重校验
  if (data.recordDate !== undefined || data.recordType !== undefined) {
    await _assertNoDup(exists.performerId, newDateStr, newType, exists.id);
  }

  data.ts = BigInt(nowMs());
  const row = await prisma.loadUnloadRecordV1.update({ where: { id: ctx.params.id }, data });
  try { await audit({ ctx, module: 'load_unload', action: 'LU_UPDATE', targetId: row.id, detail: { recordDate: newDateStr, recordType: row.recordType, attend: row.attend } }); } catch (_) {}
  // 新旧位置都同步（改期防遗漏）
  try {
    await syncDraftWageForPerformer(exists.performerId, newDateStr);
    const oldDateStr = new Date(exists.recordDate).toISOString().substring(0, 10);
    if (oldDateStr !== newDateStr) await syncDraftWageForPerformer(exists.performerId, oldDateStr);
  } catch (_) {}
  const pmap = await _performerMap([row.performerId]);
  return success(ctx, _toApi(row, pmap));
};

// 删除
const remove = async ctx => {
  const exists = await prisma.loadUnloadRecordV1.findUnique({ where: { id: ctx.params.id } });
  if (!exists) throw new BusinessError('NOT_FOUND', '装卸车记录不存在');
  await prisma.loadUnloadRecordV1.delete({ where: { id: ctx.params.id } });
  try { await audit({ ctx, module: 'load_unload', action: 'LU_DELETE', targetId: ctx.params.id, detail: { performerName: exists.performerName, recordType: exists.recordType, attend: exists.attend } }); } catch (_) {}
  // 删除后同步（缺席减少 → 扣款回退）
  try { await syncDraftWageForPerformer(exists.performerId, exists.recordDate); } catch (_) {}
  return noContent(ctx);
};

module.exports = { list, detail, create, update, remove };
