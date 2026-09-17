'use strict';

/**
 * src/controllers/inventory.js —— 库存物品 CRUD + 出入库/借用记录
 * GET    /v1/inventory/items            物品列表（分页+keyword+category+status）
 * POST   /v1/inventory/items            新建物品
 * GET    /v1/inventory/items/:id        物品详情（含最近记录）
 * PATCH  /v1/inventory/items/:id        修改物品
 * DELETE /v1/inventory/items/:id        删除物品（含记录清理）
 * GET    /v1/inventory/records          出入库/借用记录列表
 * POST   /v1/inventory/records          记一笔（in/out/borrow/return/loss，事务联动数量与借用状态）
 */
const { nanoid } = require('nanoid');
const prisma = require('../utils/prisma');
const { success, created, pageMeta, noContent } = require('../utils/response');
const { idByCtx, nowMs } = require('../config');
const { BusinessError } = require('../middleware/error-handler');
const { audit } = require('../services/audit-service');

const OP_TYPES = ['in', 'out', 'borrow', 'return', 'loss'];

const listItems = async ctx => {
  const { skip, take, page, pageSize } = pageMeta(ctx.query.page, ctx.query.pageSize, 0);
  const where = {};
  const kw = (ctx.query.keyword || '').trim();
  if (kw) {
    where.OR = [{ name: { contains: kw } }, { sku: { contains: kw } }, { specModel: { contains: kw } }];
  }
  if (ctx.query.category) where.category = ctx.query.category;
  if (ctx.query.status) where.status = ctx.query.status;
  const [rows, total] = await Promise.all([
    prisma.inventoryItem.findMany({
      where,
      skip,
      take,
      orderBy: { createdAt: 'desc' }
    }),
    prisma.inventoryItem.count({ where })
  ]);
  return success(ctx, rows, { ...pageMeta(page, pageSize, total), total });
};

const createItem = async ctx => {
  const b = ctx.request.body;
  if (!b.name) throw new BusinessError('VALIDATION_ERROR', 'name 必填');
  const row = await prisma.inventoryItem.create({
    data: {
      id: b.id || idByCtx('invItem', 12, nanoid),
      sku: b.sku || null,
      name: b.name,
      category: b.category || null,
      specModel: b.specModel || null,
      quantity: b.quantity != null ? Number(b.quantity) : 0,
      safetyStock: b.safetyStock != null ? Number(b.safetyStock) : null,
      unit: b.unit || null,
      unitPrice: b.unitPrice != null ? Number(b.unitPrice) : null,
      location: b.location || null,
      status: b.status || 'in_stock',
      borrower: b.borrower || null,
      expectedReturnDate: b.expectedReturnDate ? new Date(b.expectedReturnDate) : null,
      lastCheckDate: b.lastCheckDate ? new Date(b.lastCheckDate) : null,
      imageUrl: b.imageUrl || null,
      remark: b.remark || null,
      updatedBy: ctx.state.user?.sub || 'system',
      ts: BigInt(nowMs())
    }
  });
  await audit({ ctx, module: 'inventory', action: 'INV_ITEM_CREATE', targetId: row.id, detail: { name: row.name } });
  return created(ctx, row);
};

const detailItem = async ctx => {
  const id = ctx.params.id;
  const item = await prisma.inventoryItem.findUnique({ where: { id } });
  if (!item) throw new BusinessError('NOT_FOUND', '物品不存在');
  const records = await prisma.inventoryRecord.findMany({
    where: { itemId: id },
    orderBy: { opDate: 'desc' },
    take: 20
  });
  return success(ctx, { ...item, records });
};

const updateItem = async ctx => {
  const id = ctx.params.id;
  const b = ctx.request.body;
  const old = await prisma.inventoryItem.findUnique({ where: { id } });
  if (!old) throw new BusinessError('NOT_FOUND', '物品不存在');

  const patch = {};
  ['sku', 'name', 'category', 'specModel', 'unit', 'location', 'status', 'borrower', 'imageUrl', 'remark'].forEach(k => {
    if (b[k] !== undefined) patch[k] = b[k];
  });
  ['quantity', 'safetyStock', 'unitPrice'].forEach(k => {
    if (b[k] != null) patch[k] = Number(b[k]);
  });
  ['expectedReturnDate', 'lastCheckDate'].forEach(k => {
    if (b[k]) patch[k] = new Date(b[k]);
  });
  patch.updatedBy = ctx.state.user?.sub || 'system';
  patch.updatedAt = new Date();
  patch.ts = BigInt(nowMs());
  const row = await prisma.inventoryItem.update({ where: { id }, data: patch });
  await audit({ ctx, module: 'inventory', action: 'INV_ITEM_UPDATE', targetId: id, detail: Object.keys(patch) });
  return success(ctx, row);
};

const removeItem = async ctx => {
  const id = ctx.params.id;
  const old = await prisma.inventoryItem.findUnique({ where: { id } });
  if (!old) throw new BusinessError('NOT_FOUND', '物品不存在');
  await prisma.inventoryRecord.deleteMany({ where: { itemId: id } });
  await prisma.inventoryItem.delete({ where: { id } });
  await audit({ ctx, module: 'inventory', action: 'INV_ITEM_DELETE', targetId: id, detail: { name: old.name } });
  return noContent(ctx);
};

const listRecords = async ctx => {
  const { skip, take, page, pageSize } = pageMeta(ctx.query.page, ctx.query.pageSize, 0);
  const where = {};
  if (ctx.query.itemId) where.itemId = ctx.query.itemId;
  if (ctx.query.opType) where.opType = ctx.query.opType;
  if (ctx.query.fromDate) where.opDate = { gte: new Date(ctx.query.fromDate) };
  if (ctx.query.toDate) {
    where.opDate = { ...(where.opDate || {}), lte: new Date(ctx.query.toDate) };
  }
  const [rawRows, total] = await Promise.all([
    prisma.inventoryRecord.findMany({
      where,
      skip,
      take,
      orderBy: { opDate: 'desc' }
    }),
    prisma.inventoryRecord.count({ where })
  ]);
  // 无外键 relation：手动补充物品摘要
  const itemIds = [...new Set(rawRows.map(r => r.itemId))];
  const items = itemIds.length
    ? await prisma.inventoryItem.findMany({
        where: { id: { in: itemIds } },
        select: { id: true, name: true, sku: true, category: true, unit: true }
      })
    : [];
  const itemMap = Object.fromEntries(items.map(i => [i.id, i]));
  const rows = rawRows.map(r => ({ ...r, item: itemMap[r.itemId] || null }));
  return success(ctx, rows, { ...pageMeta(page, pageSize, total), total });
};

/**
 * 记一笔出入库/借用（事务联动）
 * body: { itemId, opType, quantity, opDate, relatedScheduleId, operator, remark,
 *         borrower, expectedReturnDate, playTitle, usage }
 */
const createRecord = async ctx => {
  const b = ctx.request.body;
  if (!b.itemId || !b.opType || b.quantity == null) {
    throw new BusinessError('VALIDATION_ERROR', 'itemId/opType/quantity 必填');
  }
  if (!OP_TYPES.includes(b.opType)) {
    throw new BusinessError('VALIDATION_ERROR', `opType 仅允许：${OP_TYPES.join('/')}`);
  }
  const qty = Number(b.quantity);
  if (!(qty > 0)) throw new BusinessError('VALIDATION_ERROR', 'quantity 必须大于 0');

  const item = await prisma.inventoryItem.findUnique({ where: { id: b.itemId } });
  if (!item) throw new BusinessError('NOT_FOUND', '物品不存在');

  // 数量影响：in/return 加，out/borrow/loss 减
  const delta = b.opType === 'in' || b.opType === 'return' ? qty : -qty;
  if (item.quantity + delta < 0) {
    throw new BusinessError('CONFLICT', `库存不足：当前 ${item.quantity}，本次${b.opType} ${qty}`);
  }

  const itemPatch = {
    quantity: item.quantity + delta,
    updatedBy: ctx.state.user?.sub || 'system',
    updatedAt: new Date(),
    ts: BigInt(nowMs())
  };
  // 借用/归还联动借用状态
  if (b.opType === 'borrow') {
    itemPatch.status = 'borrowed';
    itemPatch.borrower = b.borrower || item.borrower || null;
    itemPatch.expectedReturnDate = b.expectedReturnDate ? new Date(b.expectedReturnDate) : item.expectedReturnDate;
  }
  if (b.opType === 'return') {
    itemPatch.status = 'in_stock';
    itemPatch.borrower = null;
    itemPatch.expectedReturnDate = null;
  }

  const record = await prisma.$transaction(async tx => {
    const rec = await tx.inventoryRecord.create({
      data: {
        id: idByCtx('invRecord', 12, nanoid),
        itemId: b.itemId,
        opType: b.opType,
        opDate: b.opDate ? new Date(b.opDate) : new Date(),
        quantity: qty,
        relatedScheduleId: b.relatedScheduleId || null,
        operator: b.operator || ctx.state.user?.realName || ctx.state.user?.sub || 'system',
        remark: b.remark || b.usage || null,
        ts: BigInt(nowMs())
      }
    });
    await tx.inventoryItem.update({ where: { id: b.itemId }, data: itemPatch });
    return rec;
  });

  await audit({
    ctx,
    module: 'inventory',
    action: 'INV_RECORD_CREATE',
    targetId: record.id,
    detail: { item: item.name, opType: b.opType, quantity: qty }
  });
  return created(ctx, record);
};

module.exports = { listItems, createItem, detailItem, updateItem, removeItem, listRecords, createRecord, OP_TYPES };
