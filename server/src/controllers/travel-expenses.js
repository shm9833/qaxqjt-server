/* travel-expenses.js — 人员差旅路费 CRUD
 * 数据表：TravelExpenseV1（prisma schema 已定义）
 * 注意：schema 中无 scheduleTitle/description 列，scheduleTitle 读取时关联 ScheduleV2 拼接，
 *       description 输入映射到 remark 列；expenseDate 为 DateTime，月份过滤用日期范围。
 *
 * GET    /v1/travel-expenses              列表（分页+keyword+performerId+scheduleId+month）
 * GET    /v1/travel-expenses/:id          详情
 * POST   /v1/travel-expenses              新建（后台直登，status=active 立即计入工资）
 * PATCH  /v1/travel-expenses/:id          修改（审核动作也走此接口：pending→active/rejected）
 * DELETE /v1/travel-expenses/:id          删除
 * GET    /v1/travel-expenses/summary/:performerId/:month  按人员+月份汇总（工资核算调用）
 *
 * v20261024 天工资人员自助报销（审核制）：
 * GET    /v1/travel-expenses/mine         员工端查自己的报销记录
 * POST   /v1/travel-expenses/mine         员工端提交报销（status=pending 待审核，不计入工资）
 * 流程：员工提交(pending) → 管理员审核通过(active，计入工资) / 驳回(rejected)
 *
 * v20261025 路费防重：同员工同 expenseDate 已存在 pending/active 记录即 409
 * （提示已有单号/金额；rejected 不拦，驳回后可重新提交）。员工自助与后台直登均生效。
 */
'use strict';
const { nanoid } = require('nanoid');
const prisma = require('../utils/prisma');
const { success, created, noContent } = require('../utils/response');
const { idByCtx, nowMs } = require('../config');
const { BusinessError } = require('../middleware/error-handler');
const { audit } = require('../services/audit-service');
// v20261028f 差旅报销变动后自动同步覆盖日期的草稿批次工资（已确认/过账不动）
const { syncDraftWageForPerformer } = require('./wages/helpers');

// month(YYYY-MM) -> [start, end) Date 范围
function _monthRange(month) {
  const y = Number(month.substring(0, 4));
  const m = Number(month.substring(5, 7));
  return [new Date(Date.UTC(y, m - 1, 1)), new Date(Date.UTC(y, m, 1))];
}

// 同员工同日期防重（v20261025）：已有 pending/active 记录即 409。
// expenseDate 未传时默认当天；库中该列可能带时间分量，必须按当日 UTC [零点, 次日) 范围查。
// rejected 不拦，驳回后可重新提交。
async function _assertNoTravelDup(performerId, expenseDateRaw) {
  const dayStart = expenseDateRaw
    ? new Date(String(expenseDateRaw).substring(0, 10) + 'T00:00:00.000Z')
    : new Date(new Date().toISOString().substring(0, 10) + 'T00:00:00.000Z');
  const dayEnd = new Date(dayStart.getTime() + 86400000);
  const dup = await prisma.travelExpenseV1.findFirst({
    where: {
      performerId,
      expenseDate: { gte: dayStart, lt: dayEnd },
      status: { in: ['pending', 'active'] }
    },
    orderBy: { createdAt: 'desc' }
  });
  if (dup) {
    throw new BusinessError('CONFLICT', `该日期已提交过路费报销（单号${dup.expenseNo}，¥${Number(dup.amount)}，${dup.status === 'pending' ? '待审核' : '已计入'}），请勿重复提交`);
  }
}

// 批量取场次，构建 scheduleId -> 展示标题（v20261024f：拼接巡演途经场馆 ScheduleVenue[]）
async function _scheduleTitleMap(rows) {
  const ids = [...new Set(rows.map(r => r.scheduleId).filter(Boolean))];
  if (!ids.length) return {};
  const [scheds, venues] = await Promise.all([
    prisma.scheduleV2.findMany({
      where: { id: { in: ids } },
      select: { id: true, playTitle: true, scheduleDateStart: true, venueAddress: true }
    }),
    prisma.scheduleVenue.findMany({
      where: { scheduleId: { in: ids } },
      orderBy: { createdAt: 'asc' },
      select: { scheduleId: true, venueName: true }
    })
  ]);
  const vmap = {};
  for (const v of venues) {
    if (!v.venueName) continue;
    (vmap[v.scheduleId] = vmap[v.scheduleId] || []).push(v.venueName);
  }
  const map = {};
  for (const s of scheds) {
    const d = s.scheduleDateStart ? new Date(s.scheduleDateStart).toISOString().substring(0, 10) : '';
    const stops = (vmap[s.id] || []).join('—');
    map[s.id] = (`${s.playTitle || ''} ${d} ${s.venueAddress || ''}`.trim() + (stops ? `（途经：${stops}）` : '')).trim();
  }
  return map;
}

// v20261028b：批量取订单号（报销关联订单后在列表/工资条标注所属订单）
async function _orderNoMap(rows) {
  const ids = [...new Set(rows.map(r => r.orderId).filter(Boolean))];
  if (!ids.length) return {};
  const orders = await prisma.order.findMany({ where: { id: { in: ids } }, select: { id: true, orderNo: true, customerName: true } });
  const map = {};
  for (const o of orders) map[o.id] = o.orderNo || '';
  return map;
}

// v20261028b：场次 → 所属订单自动解析（关联场次即关联订单的核心保障）
async function _resolveOrderId(scheduleId) {
  if (!scheduleId) return null;
  const s = await prisma.scheduleV2.findUnique({ where: { id: scheduleId }, select: { orderId: true } });
  return (s && s.orderId) || null;
}

function _toApi(row, schedMap, orderMap) {
  if (!row) return null;
  return {
    id: row.id,
    expenseNo: row.expenseNo,
    performerId: row.performerId,
    performerName: row.performerName || '',
    scheduleId: row.scheduleId || null,
    scheduleTitle: (schedMap && schedMap[row.scheduleId]) || '',
    orderId: row.orderId || null,
    orderNo: (orderMap && orderMap[row.orderId]) || '',
    expenseDate: row.expenseDate ? new Date(row.expenseDate).toISOString().substring(0, 10) : '',
    amount: Number(row.amount) || 0,
    transportType: row.transportType || '',
    description: row.remark || '',
    status: row.status || 'active',
    remark: row.remark || '',
    createdAt: row.createdAt ? new Date(row.createdAt).toISOString() : '',
    updatedAt: row.updatedAt ? new Date(row.updatedAt).toISOString() : ''
  };
}

// 列表
const list = async ctx => {
  const { keyword, performerId, scheduleId, month, status } = ctx.query;
  const page = Math.max(1, Number(ctx.query.page) || 1);
  const pageSize = Math.min(200, Math.max(1, Number(ctx.query.pageSize) || 20));
  const where = {};
  if (performerId) where.performerId = performerId;
  if (scheduleId) where.scheduleId = scheduleId;
  if (status) where.status = status;
  if (month) {
    const [g, e] = _monthRange(month);
    where.expenseDate = { gte: g, lt: e };
  }
  if (keyword) {
    where.OR = [
      { expenseNo: { contains: keyword } },
      { performerName: { contains: keyword } },
      { remark: { contains: keyword } }
    ];
  }
  const [total, rows] = await Promise.all([
    prisma.travelExpenseV1.count({ where }),
    prisma.travelExpenseV1.findMany({
      where,
      orderBy: { expenseDate: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize
    })
  ]);
  const [schedMap, orderMap] = await Promise.all([_scheduleTitleMap(rows), _orderNoMap(rows)]);
  return success(ctx, { list: rows.map(r => _toApi(r, schedMap, orderMap)), total, page, pageSize });
};

// 详情
const detail = async ctx => {
  const row = await prisma.travelExpenseV1.findUnique({ where: { id: ctx.params.id } });
  if (!row) throw new BusinessError('NOT_FOUND', '路费记录不存在');
  const [schedMap, orderMap] = await Promise.all([_scheduleTitleMap([row]), _orderNoMap([row])]);
  return success(ctx, _toApi(row, schedMap, orderMap));
};

// 新建
const create = async ctx => {
  const b = ctx.request.body;
  if (!b.performerId) throw new BusinessError('VALIDATION_ERROR', 'performerId 必填');
  if (!b.amount || Number(b.amount) <= 0) throw new BusinessError('VALIDATION_ERROR', '金额必须大于0');

  // 自动关联人员姓名
  const perf = await prisma.performersDbV1.findUnique({
    where: { id: b.performerId },
    select: { name: true }
  });
  if (!perf) throw new BusinessError('NOT_FOUND', '人员不存在');

  await _assertNoTravelDup(b.performerId, b.expenseDate);

  const expenseNo = b.expenseNo || ('TE-' + Date.now().toString(36).toUpperCase());
  // v20261028b：选了场次自动解析所属订单（选场次=关联订单）
  const autoOrderId = b.orderId || (await _resolveOrderId(b.scheduleId));
  const data = {
    id: b.id || idByCtx('te', 12, nanoid),
    expenseNo,
    performerId: b.performerId,
    performerName: perf.name,
    scheduleId: b.scheduleId || null,
    orderId: autoOrderId || null,
    expenseDate: b.expenseDate ? new Date(b.expenseDate + 'T00:00:00.000Z') : new Date(),
    transportType: b.transportType || null,
    amount: Number(b.amount),
    status: b.status || 'active',
    remark: b.remark || b.description || '',
    ts: BigInt(nowMs())
  };
  const row = await prisma.travelExpenseV1.create({ data });
  try { await audit({ ctx, module: 'travel_expense', action: 'TE_CREATE', targetId: row.id, detail: { expenseNo, performerName: perf.name, amount: data.amount } }); } catch (_) {}
  // v20261028f：登记后自动同步草稿批次（差旅路费计入应发）
  try { await syncDraftWageForPerformer(b.performerId, data.expenseDate); } catch (_) {}
  const [schedMap, orderMap] = await Promise.all([_scheduleTitleMap([row]), _orderNoMap([row])]);
  return created(ctx, _toApi(row, schedMap, orderMap));
};

// 修改
const update = async ctx => {
  const b = ctx.request.body;
  const exists = await prisma.travelExpenseV1.findUnique({ where: { id: ctx.params.id } });
  if (!exists) throw new BusinessError('NOT_FOUND', '路费记录不存在');

  const data = {};
  ['performerId', 'scheduleId', 'orderId', 'status', 'transportType'].forEach(k => {
    if (b[k] !== undefined) data[k] = b[k];
  });
  // v20261028b：改了场次且未显式传 orderId 时自动解析所属订单；清空场次则同步清空订单
  if (b.scheduleId !== undefined && b.orderId === undefined) {
    data.orderId = b.scheduleId ? (await _resolveOrderId(b.scheduleId)) : null;
  }
  if (b.amount !== undefined) data.amount = Number(b.amount);
  if (b.expenseNo !== undefined) data.expenseNo = b.expenseNo;
  if (b.expenseDate !== undefined) data.expenseDate = b.expenseDate ? new Date(b.expenseDate + 'T00:00:00.000Z') : null;
  if (b.remark !== undefined || b.description !== undefined) data.remark = b.remark !== undefined ? b.remark : b.description;

  // 如果变更了人员，更新姓名
  if (b.performerId) {
    const perf = await prisma.performersDbV1.findUnique({
      where: { id: b.performerId },
      select: { name: true }
    });
    if (perf) data.performerName = perf.name;
  }

  data.ts = BigInt(nowMs());
  const row = await prisma.travelExpenseV1.update({ where: { id: ctx.params.id }, data });
  try { await audit({ ctx, module: 'travel_expense', action: 'TE_UPDATE', targetId: row.id, detail: { amount: data.amount, scheduleId: data.scheduleId !== undefined ? data.scheduleId : undefined, orderId: data.orderId !== undefined ? data.orderId : undefined } }); } catch (_) {}
  // v20261028f：人员/日期/金额/状态变动后自动同步草稿批次（新旧位置都同步，防迁移遗漏）
  try {
    await syncDraftWageForPerformer(row.performerId, row.expenseDate);
    if (exists.performerId !== row.performerId) await syncDraftWageForPerformer(exists.performerId, exists.expenseDate);
    else if (exists.expenseDate && row.expenseDate && new Date(exists.expenseDate).getTime() !== new Date(row.expenseDate).getTime()) {
      await syncDraftWageForPerformer(exists.performerId, exists.expenseDate);
    }
  } catch (_) {}
  const [schedMap, orderMap] = await Promise.all([_scheduleTitleMap([row]), _orderNoMap([row])]);
  return success(ctx, _toApi(row, schedMap, orderMap));
};

// 删除
const remove = async ctx => {
  const exists = await prisma.travelExpenseV1.findUnique({ where: { id: ctx.params.id } });
  if (!exists) throw new BusinessError('NOT_FOUND', '路费记录不存在');
  await prisma.travelExpenseV1.delete({ where: { id: ctx.params.id } });
  try { await audit({ ctx, module: 'travel_expense', action: 'TE_DELETE', targetId: ctx.params.id, detail: { expenseNo: exists.expenseNo } }); } catch (_) {}
  // v20261028f：删除后自动同步草稿批次（差旅路费从应发中移除）
  try { await syncDraftWageForPerformer(exists.performerId, exists.expenseDate); } catch (_) {}
  return noContent(ctx);
};

// 按人员+月份汇总（供工资核算调用）
const summaryByPerformerMonth = async ctx => {
  const { performerId, month } = ctx.params;
  if (!performerId || !month) throw new BusinessError('VALIDATION_ERROR', 'performerId 和 month 必填');
  const [g, e] = _monthRange(month);
  const rows = await prisma.travelExpenseV1.findMany({
    where: {
      performerId,
      expenseDate: { gte: g, lt: e },
      status: 'active'
    },
    select: { amount: true, expenseDate: true, scheduleId: true, orderId: true }
  });
  const [schedMap, orderMap] = await Promise.all([_scheduleTitleMap(rows), _orderNoMap(rows)]);
  const items = rows.map(r => ({
    scheduleId: r.scheduleId || null,
    scheduleTitle: schedMap[r.scheduleId] || '',
    orderId: r.orderId || null,
    orderNo: orderMap[r.orderId] || '',
    expenseDate: r.expenseDate ? new Date(r.expenseDate).toISOString().substring(0, 10) : '',
    amount: Number(r.amount) || 0
  }));
  const total = items.reduce((s, r) => s + r.amount, 0);
  return success(ctx, { performerId, month, total: Math.round(total * 100) / 100, count: items.length, items });
};

/* ====== 天工资人员自助路费报销（v20261024：员工端提交 → 后台审核 → 计入工资）====== */

// 取当前登录员工 performerId（自助 JWT：role=performer）
function _selfPerformerId(ctx) {
  const u = (ctx.state && ctx.state.user) || {};
  return u.performerId || u.sub || null;
}

// 员工端查自己的报销记录（身份仅取自 JWT，杜绝代查/代提交）
const myList = async ctx => {
  const performerId = _selfPerformerId(ctx);
  if (!performerId) throw new BusinessError('VALIDATION_ERROR', '未获取到员工身份，请重新登录');
  const page = Math.max(1, Number(ctx.query.page) || 1);
  const pageSize = Math.min(100, Math.max(1, Number(ctx.query.pageSize) || 50));
  const [total, rows] = await Promise.all([
    prisma.travelExpenseV1.count({ where: { performerId } }),
    prisma.travelExpenseV1.findMany({
      where: { performerId },
      orderBy: [{ expenseDate: 'desc' }, { createdAt: 'desc' }],
      skip: (page - 1) * pageSize,
      take: pageSize
    })
  ]);
  const [schedMap, orderMap] = await Promise.all([_scheduleTitleMap(rows), _orderNoMap(rows)]);
  return success(ctx, { list: rows.map(r => _toApi(r, schedMap, orderMap)), total, page, pageSize });
};

// 员工端提交报销（status=pending 待审核，审核通过后计入工资）
const myCreate = async ctx => {
  const b = ctx.request.body || {};
  const performerId = _selfPerformerId(ctx);
  if (!performerId) throw new BusinessError('VALIDATION_ERROR', '未获取到员工身份，请重新登录');
  const amount = Number(b.amount);
  if (!amount || amount <= 0) throw new BusinessError('VALIDATION_ERROR', '金额必须大于0');
  if (amount > 10000) throw new BusinessError('VALIDATION_ERROR', '单笔金额超过10000元，请联系管理员登记');
  if (b.expenseDate && !/^\d{4}-\d{2}-\d{2}$/.test(String(b.expenseDate))) throw new BusinessError('VALIDATION_ERROR', '日期格式应为 YYYY-MM-DD');
  const perf = await prisma.performersDbV1.findUnique({
    where: { id: performerId },
    select: { name: true, dailyRate: true }
  });
  if (!perf) throw new BusinessError('NOT_FOUND', '人员不存在');
  if (perf.dailyRate == null) throw new BusinessError('VALIDATION_ERROR', '仅天工资人员可自助报销路费，请联系管理员登记');

  await _assertNoTravelDup(performerId, b.expenseDate);

  const expenseNo = 'TE-S-' + Date.now().toString(36).toUpperCase();
  const data = {
    id: idByCtx('te', 12, nanoid),
    expenseNo,
    performerId,
    performerName: perf.name,
    scheduleId: b.scheduleId || null,
    orderId: b.orderId || (await _resolveOrderId(b.scheduleId)) || null,
    expenseDate: b.expenseDate ? new Date(b.expenseDate + 'T00:00:00.000Z') : new Date(),
    transportType: b.transportType || null,
    amount,
    status: 'pending',
    remark: b.remark || b.description || '',
    createdBy: 'self',
    ts: BigInt(nowMs())
  };
  const row = await prisma.travelExpenseV1.create({ data });
  try { await audit({ ctx, module: 'travel_expense', action: 'TE_SELF_SUBMIT', targetId: row.id, detail: { expenseNo, performerName: perf.name, amount } }); } catch (_) {}
  const [schedMap, orderMap] = await Promise.all([_scheduleTitleMap([row]), _orderNoMap([row])]);
  return created(ctx, _toApi(row, schedMap, orderMap));
};

module.exports = { list, detail, create, update, remove, summaryByPerformerMonth, myList, myCreate, _toApi };
