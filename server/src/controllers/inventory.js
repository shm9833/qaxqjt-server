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

/**
 * 库存写互斥：SQLite 同一时刻只允许一个写事务。高并发下多个交互式事务同时
 * BEGIN 并争抢写锁会在 rollback-journal 模式下互相阻塞直至 Prisma 5s 事务超时
 * （P1008/P2028）。单 Node 进程内用 Promise 链把库存写事务串行化，
 * 每笔仅两条语句、毫秒级完成，请求侧无感知；原子条件扣减仍保留为数据层最终防线。
 */
let writeChain = Promise.resolve();
function withInventoryWrite(fn) {
  const run = writeChain.then(fn, fn);
  writeChain = run.then(
    () => {},
    () => {}
  );
  return run;
}

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
  // quantity 不允许无痕直改：仅 safetyStock/unitPrice 可直接更新；
  // 库存数量差异必须走下方"调整台账"流程（adjustReason + in/out 记录）
  ['safetyStock', 'unitPrice'].forEach(k => {
    if (b[k] != null) patch[k] = Number(b[k]);
  });
  ['expectedReturnDate', 'lastCheckDate'].forEach(k => {
    if (b[k]) patch[k] = new Date(b[k]);
  });

  let adjustRecord = null;
  if (b.quantity != null) {
    const targetQty = Number(b.quantity);
    if (!(Number.isInteger(targetQty) && targetQty >= 0)) {
      throw new BusinessError('VALIDATION_ERROR', 'quantity 必须为非负整数');
    }
    const delta = targetQty - Number(old.quantity);
    if (delta !== 0) {
      const reason = (b.adjustReason == null ? '' : String(b.adjustReason)).trim();
      if (!reason) {
        throw new BusinessError(
          'VALIDATION_ERROR',
          '修改库存数量必须填写调整原因(adjustReason)，系统将自动登记出入库台账'
        );
      }
      if (reason.length > 200) throw new BusinessError('VALIDATION_ERROR', '调整原因最长 200 字');
      const opType = delta > 0 ? 'in' : 'out';
      const qty = Math.abs(delta);
      const now = new Date();
      const operator = ctx.state.user?.realName || ctx.state.user?.sub || 'system';
      // 与 createRecord 同一把写互斥 + 条件原子扣减，杜绝绕过台账/并发穿负
      const recId = await withInventoryWrite(() => prisma.$transaction(async tx => {
        const itemData = { updatedBy: ctx.state.user?.sub || 'system', updatedAt: now, ts: BigInt(nowMs()) };
        if (delta > 0) {
          const u = await tx.inventoryItem.updateMany({
            where: { id },
            data: { quantity: { increment: qty }, ...itemData, ...patch }
          });
          if (u.count === 0) throw new BusinessError('NOT_FOUND', '物品不存在');
        } else {
          const u = await tx.inventoryItem.updateMany({
            where: { id, quantity: { gte: qty } },
            data: { quantity: { decrement: qty }, ...itemData, ...patch }
          });
          if (u.count === 0) {
            const cur = await tx.inventoryItem.findUnique({ where: { id }, select: { quantity: true } });
            throw new BusinessError('CONFLICT', `库存不足：当前 ${cur ? cur.quantity : 0}，本次调整出库 ${qty}`);
          }
        }
        const rec = await tx.inventoryRecord.create({
          data: {
            id: idByCtx('invRecord', 12, nanoid),
            itemId: id,
            opType,
            opDate: now,
            quantity: qty,
            operator,
            remark: '库存调整：' + reason,
            ts: BigInt(nowMs())
          }
        });
        return rec.id;
      }));
      adjustRecord = { id: recId, opType, quantity: qty, from: Number(old.quantity), to: targetQty, reason };
    }
  }

  if (!adjustRecord) {
    patch.updatedBy = ctx.state.user?.sub || 'system';
    patch.updatedAt = new Date();
    patch.ts = BigInt(nowMs());
    await prisma.inventoryItem.update({ where: { id }, data: patch });
  }

  await audit({
    ctx,
    module: 'inventory',
    action: 'INV_ITEM_UPDATE',
    targetId: id,
    detail: adjustRecord ? { adjusted: adjustRecord, fields: Object.keys(patch) } : Object.keys(patch)
  });
  const row = await prisma.inventoryItem.findUnique({ where: { id } });
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
 *
 * 并发安全：扣减类（out/borrow/loss）在事务内执行条件原子更新
 * UPDATE ... SET quantity = quantity - qty WHERE id = ? AND quantity >= qty，
 * 影响行数为 0 即库存不足（或被并发事务抢先扣减），抛错回滚——杜绝"先查后改"TOCTOU 超发。
 */
const OP_LABEL = { in: '入库', out: '出库', borrow: '借出', return: '归还', loss: '报损' };

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

  // 仅做存在性与名称等快照读取；库存是否足够一律以事务内条件更新为准
  const item = await prisma.inventoryItem.findUnique({ where: { id: b.itemId } });
  if (!item) throw new BusinessError('NOT_FOUND', '物品不存在');

  const isIncrease = b.opType === 'in' || b.opType === 'return';
  const now = new Date();

  const record = await withInventoryWrite(() => prisma.$transaction(async tx => {
    const itemData = {
      updatedBy: ctx.state.user?.sub || 'system',
      updatedAt: now,
      ts: BigInt(nowMs())
    };
    // 借用/归还联动借用状态
    if (b.opType === 'borrow') {
      itemData.status = 'borrowed';
      itemData.borrower = b.borrower || item.borrower || null;
      itemData.expectedReturnDate = b.expectedReturnDate
        ? new Date(b.expectedReturnDate)
        : item.expectedReturnDate;
    }
    if (b.opType === 'return') {
      itemData.status = 'in_stock';
      itemData.borrower = null;
      itemData.expectedReturnDate = null;
    }

    let updated;
    if (isIncrease) {
      updated = await tx.inventoryItem.updateMany({
        where: { id: b.itemId },
        data: { quantity: { increment: qty }, ...itemData }
      });
      if (updated.count === 0) throw new BusinessError('NOT_FOUND', '物品不存在');
    } else {
      // 原子条件扣减：库存充足才会命中，SQLite 写事务串行化保证并发下只有一笔能扣到最后一件
      updated = await tx.inventoryItem.updateMany({
        where: { id: b.itemId, quantity: { gte: qty } },
        data: { quantity: { decrement: qty }, ...itemData }
      });
      if (updated.count === 0) {
        const cur = await tx.inventoryItem.findUnique({
          where: { id: b.itemId },
          select: { quantity: true }
        });
        throw new BusinessError(
          'CONFLICT',
          `库存不足：当前 ${cur ? cur.quantity : 0}，本次${OP_LABEL[b.opType] || b.opType} ${qty}`
        );
      }
    }

    return tx.inventoryRecord.create({
      data: {
        id: idByCtx('invRecord', 12, nanoid),
        itemId: b.itemId,
        opType: b.opType,
        opDate: b.opDate ? new Date(b.opDate) : now,
        quantity: qty,
        relatedScheduleId: b.relatedScheduleId || null,
        operator: b.operator || ctx.state.user?.realName || ctx.state.user?.sub || 'system',
        remark: b.remark || b.usage || null,
        ts: BigInt(nowMs())
      }
    });
  }));

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
