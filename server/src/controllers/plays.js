'use strict';

/**
 * src/controllers/plays.js —— 剧目资源管理 CRUD
 */
const { nanoid } = require('nanoid');
const prisma = require('../utils/prisma');
const { success, created, pageMeta } = require('../utils/response');
const { idByCtx, nowMs } = require('../config');
const { BusinessError } = require('../middleware/error-handler');
const { audit } = require('../services/audit-service');

const list = async ctx => {
  const { skip, take, page, pageSize } = pageMeta(ctx.query.page, ctx.query.pageSize, 0);
  const where = {};
  const kw = (ctx.query.keyword || '').trim();
  if (kw) {
    where.OR = [
      { title: { contains: kw } },
      { playCode: { contains: kw } },
      { author: { contains: kw } }
    ];
  }
  if (ctx.query.genre) where.genre = ctx.query.genre;
  if (ctx.query.status) where.status = ctx.query.status;
  const [rows, total] = await Promise.all([
    prisma.play.findMany({
      where,
      skip,
      take,
      orderBy: { createdAt: 'desc' },
      include: { _count: { select: { playCasts: true } } }
    }),
    prisma.play.count({ where })
  ]);
  return success(ctx, rows, { ...pageMeta(page, pageSize, total), total });
};

const create = async ctx => {
  const b = ctx.request.body;
  if (!b.title) throw new BusinessError('VALIDATION_ERROR', 'title 必填');
  const data = {
    id: b.id || idByCtx('play', 12, nanoid),
    playCode: b.playCode || null,
    title: b.title,
    subtitle: b.subtitle || null,
    genre: b.genre || null,
    durationMinutes: b.durationMinutes ? Number(b.durationMinutes) : null,
    author: b.author || null,
    posterUrl: b.posterUrl || null,
    synopsis: b.synopsis || null,
    castSummary: b.castSummary || null,
    difficultyLevel: b.difficultyLevel || null,
    status: b.status || 'active',
    createdBy: ctx.state.user?.sub || 'system',
    ts: BigInt(nowMs())
  };
  const row = await prisma.play.create({ data });
  await audit({ ctx, module: 'plays', action: 'PLAY_CREATE', targetId: row.id, detail: { title: row.title } });
  return created(ctx, row);
};

const detail = async ctx => {
  const row = await prisma.play.findUnique({
    where: { id: ctx.params.id },
    include: { playCasts: { orderBy: { sortOrder: 'asc' } } }
  });
  if (!row) throw new BusinessError('NOT_FOUND', '剧目不存在');
  return success(ctx, row);
};

const update = async ctx => {
  const id = ctx.params.id;
  const b = ctx.request.body;
  const old = await prisma.play.findUnique({ where: { id } });
  if (!old) throw new BusinessError('NOT_FOUND', '剧目不存在');
  const patch = {};
  ['playCode', 'title', 'subtitle', 'genre', 'author', 'posterUrl', 'synopsis', 'castSummary', 'difficultyLevel', 'status'].forEach(k => {
    if (b[k] !== undefined) patch[k] = b[k];
  });
  if (b.durationMinutes != null) patch.durationMinutes = Number(b.durationMinutes);
  patch.updatedAt = new Date();
  patch.ts = BigInt(nowMs());
  const row = await prisma.play.update({ where: { id }, data: patch });
  await audit({ ctx, module: 'plays', action: 'PLAY_UPDATE', targetId: id, detail: { from: old.title, to: patch.title || old.title } });
  return success(ctx, row);
};

const remove = async ctx => {
  const id = ctx.params.id;
  const old = await prisma.play.findUnique({ where: { id } });
  if (!old) throw new BusinessError('NOT_FOUND', '剧目不存在');
  await prisma.playCast.deleteMany({ where: { playId: id } });
  await prisma.play.delete({ where: { id } });
  await audit({ ctx, module: 'plays', action: 'PLAY_DELETE', targetId: id, detail: { title: old.title } });
  return success(ctx, { id });
};

module.exports = { list, create, detail, update, remove };
