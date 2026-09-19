'use strict';

/**
 * src/controllers/play-categories.js —— 剧目分类管理（v20260909b 新增，20260919 移植到 Vercel 渠道）
 * 分类以名称与 play.genre 关联：重命名分类会同步迁移剧目，分类下有剧目时禁止删除（可停用）。
 */
const { nanoid } = require('nanoid');
const prisma = require('../utils/prisma');
const { success, created } = require('../utils/response');
const { idByCtx, nowMs } = require('../config');
const { BusinessError } = require('../middleware/error-handler');
const { audit } = require('../services/audit-service');

const list = async ctx => {
  const [cats, groups] = await Promise.all([
    prisma.playCategory.findMany({ orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }] }),
    prisma.play.groupBy({ by: ['genre'], _count: { _all: true } })
  ]);
  const countMap = {};
  groups.forEach(g => { if (g.genre) countMap[g.genre] = g._count._all; });
  const rows = cats.map(c => ({ ...c, playCount: countMap[c.name] || 0 }));
  return success(ctx, rows, { total: rows.length });
};

const create = async ctx => {
  const b = ctx.request.body || {};
  const name = String(b.name || '').trim();
  if (!name) throw new BusinessError('VALIDATION_ERROR', '分类名称必填');
  if (name.length > 30) throw new BusinessError('VALIDATION_ERROR', '分类名称最长 30 字');
  const exists = await prisma.playCategory.findUnique({ where: { name } });
  if (exists) throw new BusinessError('VALIDATION_ERROR', '分类「' + name + '」已存在');
  let sortOrder = Number(b.sortOrder);
  if (!Number.isInteger(sortOrder) || sortOrder <= 0) {
    const agg = await prisma.playCategory.aggregate({ _max: { sortOrder: true } });
    sortOrder = (agg._max.sortOrder || 0) + 1;
  }
  const row = await prisma.playCategory.create({
    data: {
      id: idByCtx('pcat', 10, nanoid),
      name,
      sortOrder,
      status: b.status === 'disabled' ? 'disabled' : 'active',
      note: b.note || null,
      ts: BigInt(nowMs())
    }
  });
  await audit({ ctx, module: 'plays', action: 'PLAYCAT_CREATE', targetId: row.id, detail: { name } });
  return created(ctx, { ...row, playCount: 0 });
};

const update = async ctx => {
  const id = ctx.params.id;
  const b = ctx.request.body || {};
  const old = await prisma.playCategory.findUnique({ where: { id } });
  if (!old) throw new BusinessError('NOT_FOUND', '分类不存在');
  const patch = { updatedAt: new Date(), ts: BigInt(nowMs()) };
  let newName = old.name;
  if (b.name !== undefined) {
    newName = String(b.name || '').trim();
    if (!newName) throw new BusinessError('VALIDATION_ERROR', '分类名称不能为空');
    if (newName !== old.name) {
      const dup = await prisma.playCategory.findFirst({ where: { name: newName, NOT: { id } } });
      if (dup) throw new BusinessError('VALIDATION_ERROR', '分类名称「' + newName + '」已存在');
      patch.name = newName;
    }
  }
  if (b.sortOrder !== undefined && Number.isInteger(Number(b.sortOrder))) patch.sortOrder = Number(b.sortOrder);
  if (b.status !== undefined) {
    const st = String(b.status);
    if (st !== 'active' && st !== 'disabled') throw new BusinessError('VALIDATION_ERROR', '状态仅支持 active/disabled');
    patch.status = st;
  }
  if (b.note !== undefined) patch.note = b.note ? String(b.note) : null;
  const row = await prisma.playCategory.update({ where: { id }, data: patch });
  // 分类重命名 → 同步迁移该分类下全部剧目的 genre
  if (patch.name && patch.name !== old.name) {
    const n = await prisma.play.updateMany({
      where: { genre: old.name },
      data: { genre: patch.name, ts: BigInt(nowMs()) }
    });
    await audit({ ctx, module: 'plays', action: 'PLAYCAT_RENAME', targetId: id, detail: { from: old.name, to: patch.name, moved: n.count } });
  }
  await audit({ ctx, module: 'plays', action: 'PLAYCAT_UPDATE', targetId: id, detail: { name: row.name, status: row.status, sortOrder: row.sortOrder } });
  return success(ctx, row);
};

const remove = async ctx => {
  const id = ctx.params.id;
  const old = await prisma.playCategory.findUnique({ where: { id } });
  if (!old) throw new BusinessError('NOT_FOUND', '分类不存在');
  const used = await prisma.play.count({ where: { genre: old.name } });
  if (used > 0) throw new BusinessError('VALIDATION_ERROR', '分类「' + old.name + '」下还有 ' + used + ' 个剧目，请先停用或重命名迁移后再删除');
  await prisma.playCategory.delete({ where: { id } });
  await audit({ ctx, module: 'plays', action: 'PLAYCAT_DELETE', targetId: id, detail: { name: old.name } });
  return success(ctx, { id });
};

module.exports = { list, create, update, remove };
