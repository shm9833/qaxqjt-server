/**
 * src/controllers/qrcode-manage.js —— 入职二维码管理控制器
 * 生成/查询/管理扫码入职二维码
 */
const { nanoid } = require('nanoid');
const prisma = require('../utils/prisma');
const { success, pagedSuccess, parsePage } = require('../utils/response');
const { idByCtx, nowMs } = require('../config');
const { BusinessError } = require('../middleware/error-handler');

const _baseUrl = () => process.env.FRONTEND_BASE_URL || 'https://1.14.106.173';
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

module.exports = { createQr, listQr, detailQr, disableQr };
