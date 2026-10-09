/**
 * src/controllers/qrcode-manage.js —— 入职二维码管理控制器
 * 生成/查询/管理扫码入职二维码
 */
const { nanoid } = require('nanoid');
const prisma = require('../utils/prisma');
const { success, pagedSuccess, parsePage } = require('../utils/response');
const { idByCtx, nowMs } = require('../config');
const { BusinessError } = require('../middleware/error-handler');
const { audit } = require('../services/audit-service');

const _baseUrl = () => process.env.FRONTEND_BASE_URL || 'http://1.14.106.173';
const _fmt = r => ({
  id: r.id,
  qrToken: r.qrToken,
  title: r.title,
  url: _baseUrl() + '/admin/self-register.html?qr=' + r.qrToken,
  status: r.status,
  maxUses: r.maxUses,
  usedCount: r.usedCount,
  expiresAt: r.expiresAt ? r.expiresAt.toISOString() : null,
  createdAt: r.createdAt.toISOString()
});

// 生成二维码 token（供前端生成二维码图片）
const createQr = async ctx => {
  const user = ctx.state.user;
  const { title, maxUses, expiresAt } = ctx.request.body;
  if (!title) throw new BusinessError('VALIDATION_ERROR', '二维码标题必填');

  let expireDate = null;
  if (expiresAt) {
    expireDate = new Date(expiresAt);
    if (isNaN(expireDate.getTime()) || expireDate.getTime() < Date.now()) {
      throw new BusinessError('VALIDATION_ERROR', '过期时间不合法或早于当前时间');
    }
  }

  const qrToken = idByCtx('qr', 24, nanoid);
  const rec = await prisma.qrCodeInviteV1.create({
    data: {
      id: idByCtx('qr', 12, nanoid),
      qrToken,
      title,
      maxUses: maxUses ? Number(maxUses) : null,
      expiresAt: expireDate,
      createdBy: user ? user.sub : null,
      ts: BigInt(nowMs())
    }
  });

  return success(ctx, _fmt(rec), undefined, 201);
};

// 二维码列表
const listQr = async ctx => {
  const { page, pageSize, skip, take } = parsePage(ctx.query);
  const where = {};
  const status = (ctx.query.status || '').trim();
  if (status) where.status = status;
  const [rows, total] = await Promise.all([
    prisma.qrCodeInviteV1.findMany({ where, orderBy: { createdAt: 'desc' }, skip, take }),
    prisma.qrCodeInviteV1.count({ where })
  ]);
  return pagedSuccess(ctx, rows.map(_fmt), total, page, pageSize);
};

// 二维码详情
const detailQr = async ctx => {
  const { id } = ctx.params;
  const rec = await prisma.qrCodeInviteV1.findUnique({ where: { id } });
  if (!rec) throw new BusinessError('NOT_FOUND', '二维码不存在');
  return success(ctx, _fmt(rec));
};

// 禁用二维码
const disableQr = async ctx => {
  const { id } = ctx.params;
  const rec = await prisma.qrCodeInviteV1.findUnique({ where: { id } });
  if (!rec) throw new BusinessError('NOT_FOUND', '二维码不存在');
  const updated = await prisma.qrCodeInviteV1.update({
    where: { id },
    data: { status: 'disabled', ts: BigInt(nowMs()) }
  });
  return success(ctx, { id: updated.id, status: updated.status });
};

// 判断是否已过期（存储 status=expired，或 expiresAt 已过，或次数用尽）
const _isExpired = r =>
  r.status === 'expired' ||
  (r.expiresAt && r.expiresAt.getTime() < Date.now()) ||
  (r.maxUses != null && r.usedCount >= r.maxUses);

// 删除二维码（单条）
// 规则：有效（active 且未过期）二维码须先禁用；已产生入职登记记录（usedCount>0）的不可删除（保留审计追溯）
const deleteQr = async ctx => {
  const { id } = ctx.params;
  const rec = await prisma.qrCodeInviteV1.findUnique({ where: { id } });
  if (!rec) throw new BusinessError('NOT_FOUND', '二维码不存在');
  if (rec.status === 'active' && !_isExpired(rec)) {
    throw new BusinessError('VALIDATION_ERROR', '有效状态的二维码不可直接删除，请先禁用');
  }
  if (rec.usedCount > 0) {
    throw new BusinessError('VALIDATION_ERROR', '该二维码已产生入职登记记录，为保证可追溯不可删除');
  }
  await prisma.qrCodeInviteV1.delete({ where: { id } });
  await audit({
    ctx,
    module: 'qrcode',
    action: 'delete',
    targetType: 'qrcode_invite',
    targetId: id,
    detail: { title: rec.title, status: rec.status, usedCount: rec.usedCount }
  });
  return success(ctx, { id, deleted: true });
};

// 一键清理：删除所有已过期且从未使用（usedCount=0）的二维码
const cleanupExpired = async ctx => {
  const rows = await prisma.qrCodeInviteV1.findMany({
    where: {
      usedCount: 0,
      OR: [{ status: 'expired' }, { expiresAt: { lt: new Date() } }]
    },
    select: { id: true, title: true }
  });
  if (!rows.length) return success(ctx, { count: 0 });
  const res = await prisma.qrCodeInviteV1.deleteMany({ where: { id: { in: rows.map(r => r.id) } } });
  await audit({
    ctx,
    module: 'qrcode',
    action: 'cleanup_expired',
    targetType: 'qrcode_invite',
    detail: { count: res.count, titles: rows.map(r => r.title).slice(0, 50) }
  });
  return success(ctx, { count: res.count });
};

module.exports = { createQr, listQr, detailQr, disableQr, deleteQr, cleanupExpired };
