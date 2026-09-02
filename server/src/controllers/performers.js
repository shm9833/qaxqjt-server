'use strict';

/**
 * src/controllers/performers.js —— 演职人员花名册 CRUD
 */
const { nanoid } = require('nanoid');
const prisma = require('../utils/prisma');
const { success, created, pageMeta } = require('../utils/response');
const { idByCtx, nowMs } = require('../config');
const { BusinessError } = require('../middleware/error-handler');
const { audit } = require('../services/audit-service');

const DATE_FIELDS = ['birthDate', 'hireDate'];

const list = async ctx => {
  const { skip, take, page, pageSize } = pageMeta(ctx.query.page, ctx.query.pageSize, 0);
  const where = {};
  const kw = (ctx.query.keyword || '').trim();
  if (kw) {
    where.OR = [
      { name: { contains: kw } },
      { staffNo: { contains: kw } },
      { phone: { contains: kw } },
      { primaryRole: { contains: kw } }
    ];
  }
  if (ctx.query.status) where.status = ctx.query.status;
  if (ctx.query.gender) where.gender = ctx.query.gender;
  if (ctx.query.primaryRole) where.primaryRole = ctx.query.primaryRole;
  if (ctx.query.rankGrade) where.rankGrade = ctx.query.rankGrade;
  if (ctx.query.employmentType) where.employmentType = ctx.query.employmentType;
  const [rows, total] = await Promise.all([
    prisma.performersDbV1.findMany({
      where,
      skip,
      take,
      orderBy: { createdAt: 'desc' }
    }),
    prisma.performersDbV1.count({ where })
  ]);
  return success(ctx, rows, { ...pageMeta(page, pageSize, total), total });
};

const buildData = b => {
  const data = {
    staffNo: b.staffNo || null,
    name: b.name,
    gender: b.gender || null,
    phone: b.phone || null,
    idCardNo: b.idCardNo || null,
    rankGrade: b.rankGrade || null,
    primaryRole: b.primaryRole || null,
    employmentType: b.employmentType || null,
    bankAccount: b.bankAccount || null,
    bankName: b.bankName || null,
    socialSecurityNo: b.socialSecurityNo || null,
    status: b.status || 'active',
    remark: b.remark || null,
    avatarUrl: b.avatarUrl || null,
    ts: BigInt(nowMs())
  };
  DATE_FIELDS.forEach(k => {
    if (b[k]) data[k] = new Date(b[k]);
    else data[k] = null;
  });
  return data;
};

const create = async ctx => {
  const b = ctx.request.body;
  const data = {
    id: b.id || idByCtx('performer', 12, nanoid),
    ...buildData(b)
  };
  const row = await prisma.performersDbV1.create({ data });
  await audit({ ctx, module: 'performers', action: 'PERFORMER_CREATE', targetId: row.id, detail: { name: row.name } });
  return created(ctx, row);
};

const detail = async ctx => {
  const row = await prisma.performersDbV1.findUnique({ where: { id: ctx.params.id } });
  if (!row) throw new BusinessError('NOT_FOUND', '演职人员不存在');
  return success(ctx, row);
};

const update = async ctx => {
  const b = ctx.request.body;
  const patch = {};
  [
    'staffNo',
    'name',
    'gender',
    'phone',
    'idCardNo',
    'rankGrade',
    'primaryRole',
    'employmentType',
    'bankAccount',
    'bankName',
    'socialSecurityNo',
    'status',
    'remark',
    'avatarUrl'
  ].forEach(k => {
    if (b[k] !== undefined) patch[k] = b[k];
  });
  DATE_FIELDS.forEach(k => {
    if (b[k] !== undefined) patch[k] = b[k] ? new Date(b[k]) : null;
  });
  patch.updatedAt = new Date();
  patch.ts = BigInt(nowMs());
  const row = await prisma.performersDbV1.update({ where: { id: ctx.params.id }, data: patch });
  await audit({ ctx, module: 'performers', action: 'PERFORMER_UPDATE', targetId: row.id });
  return success(ctx, row);
};

const remove = async ctx => {
  const id = ctx.params.id;
  // 软删
  const row = await prisma.performersDbV1.update({
    where: { id },
    data: { status: 'deleted', updatedAt: new Date(), ts: BigInt(nowMs()) }
  });
  await audit({ ctx, module: 'performers', action: 'PERFORMER_SOFT_DELETE', targetId: id });
  return success(ctx, { id: row.id, status: 'deleted' });
};

module.exports = { list, create, detail, update, remove };
