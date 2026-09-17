'use strict';

/**
 * src/controllers/content.js —— 内容管理（新闻/公告/Banner/文章）CRUD
 */
const { nanoid } = require('nanoid');
const prisma = require('../utils/prisma');
const { success, created, pageMeta, noContent } = require('../utils/response');
const { idByCtx, nowMs } = require('../config');
const { BusinessError } = require('../middleware/error-handler');
const { audit } = require('../services/audit-service');

const list = async ctx => {
  const { skip, take, page, pageSize } = pageMeta(ctx.query.page, ctx.query.pageSize, 0);
  const where = {};
  const kw = (ctx.query.keyword || '').trim();
  if (kw) where.OR = [{ title: { contains: kw } }, { subtitle: { contains: kw } }];
  if (ctx.query.type) where.type = ctx.query.type;
  if (ctx.query.publishStatus) where.publishStatus = ctx.query.publishStatus;
  const [rows, total] = await Promise.all([
    prisma.contentV2.findMany({ where, skip, take, orderBy: { sortWeight: 'desc' } }),
    prisma.contentV2.count({ where })
  ]);
  return success(ctx, rows, { ...pageMeta(page, pageSize, total), total });
};

const create = async ctx => {
  const b = ctx.request.body;
  if (!b.title) throw new BusinessError('VALIDATION_ERROR', 'title 必填');
  if (!b.type) throw new BusinessError('VALIDATION_ERROR', 'type 必填');
  const data = {
    id: b.id || idByCtx('content', 12, nanoid),
    type: b.type,
    title: b.title,
    subtitle: b.subtitle || null,
    coverImage: b.coverImage || null,
    contentBody: b.contentBody || null,
    summary: b.summary || null,
    publishStatus: b.publishStatus || 'draft',
    publishDate: b.publishDate ? new Date(b.publishDate) : null,
    authorName: b.authorName || null,
    sortWeight: b.sortWeight ? Number(b.sortWeight) : 0,
    tagsJson: b.tagsJson || null,
    extraJson: b.extraJson || null,
    createdBy: ctx.state.user?.sub || 'system',
    ts: BigInt(nowMs())
  };
  const row = await prisma.contentV2.create({ data });
  await audit({ ctx, module: 'content', action: 'CONTENT_CREATE', targetId: row.id, detail: { title: row.title } });
  return created(ctx, row);
};

const detail = async ctx => {
  const row = await prisma.contentV2.findUnique({ where: { id: ctx.params.id } });
  if (!row) throw new BusinessError('NOT_FOUND', '内容不存在');
  return success(ctx, row);
};

const update = async ctx => {
  const id = ctx.params.id;
  const b = ctx.request.body;
  const old = await prisma.contentV2.findUnique({ where: { id } });
  if (!old) throw new BusinessError('NOT_FOUND', '内容不存在');
  const patch = {};
  ['type', 'title', 'subtitle', 'coverImage', 'contentBody', 'summary', 'publishStatus', 'authorName', 'tagsJson', 'extraJson'].forEach(k => {
    if (b[k] !== undefined) patch[k] = b[k];
  });
  if (b.sortWeight != null) patch.sortWeight = Number(b.sortWeight);
  if (b.publishDate) patch.publishDate = new Date(b.publishDate);
  patch.updatedAt = new Date();
  patch.ts = BigInt(nowMs());
  const row = await prisma.contentV2.update({ where: { id }, data: patch });
  await audit({ ctx, module: 'content', action: 'CONTENT_UPDATE', targetId: id, detail: { title: old.title } });
  return success(ctx, row);
};

const remove = async ctx => {
  const id = ctx.params.id;
  const old = await prisma.contentV2.findUnique({ where: { id } });
  if (!old) throw new BusinessError('NOT_FOUND', '内容不存在');
  await prisma.contentV2.delete({ where: { id } });
  await audit({ ctx, module: 'content', action: 'CONTENT_DELETE', targetId: id, detail: { title: old.title } });
  return success(ctx, { id });
};

module.exports = { list, create, detail, update, remove };
