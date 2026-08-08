'use strict';

/**
 * src/controllers/customers.js —— 客户 CRUD（预约上游）
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
      { customerName: { contains: kw } },
      { organization: { contains: kw } },
      { phone: { contains: kw } },
      { contactPerson: { contains: kw } }
    ];
  }
  if (ctx.query.customerType) where.customerType = ctx.query.customerType;
  if (ctx.query.level) where.level = ctx.query.level;
  if (ctx.query.status) where.status = ctx.query.status;
  const [rows, total] = await Promise.all([
    prisma.customersV1.findMany({
      where,
      skip,
      take,
      orderBy: { createdAt: 'desc' },
      include: { _count: { select: { appointments: true, orders: true } } }
    }),
    prisma.customersV1.count({ where })
  ]);
  return success(ctx, rows, { ...pageMeta(page, pageSize, total), total });
};

const create = async ctx => {
  const b = ctx.request.body;
  const data = {
    id: b.id || idByCtx('customer', 12, nanoid),
    customerType: b.customerType || 'personal',
    customerName: b.customerName,
    organization: b.organization || null,
    unifiedSocialCode: b.unifiedSocialCode || null,
    contactPerson: b.contactPerson || b.customerName,
    phone: b.phone,
    backupPhone: b.backupPhone || null,
    wechatId: b.wechatId || null,
    email: b.email || null,
    region: b.region || null,
    address: b.address || null,
    sourceChannel: b.sourceChannel || null,
    level: b.level || null,
    creditLevel: b.creditLevel || null,
    remark: b.remark || null,
    tagsJson: b.tagsJson || null,
    firstContactDate: b.firstContactDate ? new Date(b.firstContactDate) : null,
    createdBy: ctx.state.user?.sub || 'public_booking',
    status: b.status || 'active',
    ts: BigInt(nowMs())
  };
  const row = await prisma.customersV1.create({ data });
  // 可选：联系人子表
  if (Array.isArray(b.contacts) && b.contacts.length) {
    await prisma.customerContact.createMany({
      data: b.contacts.map((c, i) => ({
        id: idByCtx('customer', 12, nanoid) + '_c' + i,
        customerId: row.id,
        name: c.name,
        position: c.position || null,
        phone: c.phone,
        wechatId: c.wechatId || null,
        email: c.email || null,
        isPrimary: !!c.isPrimary || i === 0,
        remark: c.remark || null,
        ts: BigInt(nowMs())
      })),
      skipDuplicates: true
    });
  }
  // tags
  if (Array.isArray(b.tags) && b.tags.length) {
    await prisma.customerTag.createMany({
      data: b.tags.map(t => ({ customerId: row.id, tag: String(t), ts: BigInt(nowMs()) })),
      skipDuplicates: true
    });
  }
  await audit({ ctx, module: 'crm', action: 'CUSTOMER_CREATE', targetId: row.id, detail: { phone: row.phone } });
  return created(ctx, row);
};

const detail = async ctx => {
  const row = await prisma.customersV1.findUnique({
    where: { id: ctx.params.id },
    include: {
      customerContacts: { orderBy: { createdAt: 'asc' } },
      customerTags: true,
      appointments: { orderBy: { createdAt: 'desc' }, take: 10 },
      orders: { orderBy: { createdAt: 'desc' }, take: 10 }
    }
  });
  if (!row) throw new BusinessError('NOT_FOUND', '客户不存在');
  return success(ctx, row);
};

const update = async ctx => {
  const b = ctx.request.body;
  const patch = {};
  [
    'customerType',
    'customerName',
    'organization',
    'unifiedSocialCode',
    'contactPerson',
    'phone',
    'backupPhone',
    'wechatId',
    'email',
    'region',
    'address',
    'sourceChannel',
    'level',
    'creditLevel',
    'remark',
    'tagsJson',
    'status',
    'firstContactDate'
  ].forEach(k => {
    if (b[k] !== undefined) patch[k] = b[k];
  });
  if (patch.firstContactDate) patch.firstContactDate = new Date(patch.firstContactDate);
  patch.updatedAt = new Date();
  patch.ts = BigInt(nowMs());
  const row = await prisma.customersV1.update({ where: { id: ctx.params.id }, data: patch });
  await audit({ ctx, module: 'crm', action: 'CUSTOMER_UPDATE', targetId: row.id });
  return success(ctx, row);
};

const remove = async ctx => {
  const id = ctx.params.id;
  const apptCount = await prisma.appointment.count({ where: { customerId: id } });
  const orderCount = await prisma.order.count({ where: { customerId: id } });
  if (apptCount || orderCount) {
    // 软删
    const row = await prisma.customersV1.update({
      where: { id },
      data: { status: 'deleted', updatedAt: new Date(), ts: BigInt(nowMs()) }
    });
    await audit({ ctx, module: 'crm', action: 'CUSTOMER_SOFT_DELETE', targetId: id });
    return success(ctx, { id: row.id, status: 'deleted' });
  }
  await prisma.customerTag.deleteMany({ where: { customerId: id } });
  await prisma.customerContact.deleteMany({ where: { customerId: id } });
  await prisma.customersV1.delete({ where: { id } });
  await audit({ ctx, module: 'crm', action: 'CUSTOMER_DELETE', targetId: id });
  return success(ctx, { id, deleted: true });
};

module.exports = { list, create, detail, update, remove };
